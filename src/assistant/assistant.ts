// R28 (Mike, 2026-10-20): "Make it safe, then set it up" and "put it in the
// arbo app". The business assistant is a Claude Managed Agent that Mike
// creates in the Claude Console from the config he approves. This module is
// Arbo's side of it:
//
//   - STARTS sessions — exactly four kinds, and the agent's prompt names the
//     same four: a Quo text, missed call or finished INBOUND call (one session
//     per item, never two — a create whose answer was lost is found by its key
//     and adopted, not made again); a Gmail sweep every 30 minutes 7am–9pm ET
//     over a named window; the crew-route summary at 6:30am ET; and the daily
//     office check at 7am ET Monday–Saturday (Mike, 2026-10-20: "One daily
//     office check") — weather for today's and tomorrow's jobs, invoices
//     unpaid past their terms, equipment due, anything waiting on Mike;
//   - starts NOTHING until the agent's environment reads back as Limited
//     networking — an environment it could not read is named, never "ready";
//   - WATCHES each session's events (stream + history, deduped — a dropped
//     stream never loses an event) and turns every call the agent pauses on
//     into an Approval card in the owner app. Only the session's own end (or
//     a 404) finishes a watch: an outage is retried every minute at most and
//     named while it lasts; a session paused at its budget stays watched;
//   - SENDS Mike's decision back as user.tool_confirmation — the only event
//     Arbo ever sends into a running session. It also sends one decision of
//     its own: a Gmail send by draft id is refused at once (Gmail would send
//     the saved draft and ignore the words on the card), never shown as a card.
//
// What it cannot do: answer a live phone call (Sona/Quo still does), create
// or change the agent, or decide anything for Mike. Every email, text,
// payment, Drive write and calendar booking waits for his tap — that is set
// in the agent's permission policies (always_ask) and surfaces here. A
// customer text he allows outside 8am–9pm ET is refused here by name
// (quiet_hours), unless it answers, within the hour, that customer's own text
// or call, or goes to one of his crew numbers (ARBO_AGENT_CREW_NUMBERS).
//
// Law it keeps: OFF unless ARBO_AGENT is exactly 'live' (like
// ARBO_DATA_LINKS); a missing key or id is NAMED, never a quiet no-op (§1B);
// logs carry counts and ids only — never a name, number, address or a word
// anyone wrote (§4.3); it never touches Arbo's database (§3 — the links stay
// cut). Customer contact appears only in the keywalled app (R17).

import { assistantEnv } from '../env.js';
import { etOffsetMs, etToday } from '../lib/etDay.js';
import { AssistantApiError, createAnthropicAssistantApi, type AgentEvent, type AssistantApi, type EventStream } from './client.js';
import { classify, clip, describeToolCall, draftIdOf, familyOf, textRecipients, toolLabel, type ApprovalDetail } from './describe.js';
import { AssistantStore, type ActivityItem, type ActivityKind, type Approval, type QueuedTrigger, type SessionRec, type StoredApproval, type Trigger } from './store.js';

/** At most this many sessions WORKING at once; the rest queue, in order. A session parked on Mike's OK does not hold a slot. */
export const MAX_WORKING = 3;
const QUEUE_CAP = 100;
const SWEEP_EVERY_MS = 30 * 60_000;
/** Minutes after midnight ET. */
const SWEEP_FROM = 7 * 60;
const SWEEP_UNTIL = 21 * 60;
const ROUTE_AT = 6 * 60 + 30;
/** A redeploy across 6:30 still sends the route summary — until 8:00, then that day is skipped. */
const ROUTE_UNTIL = 8 * 60;
/** The daily office check: 7am ET. */
const OFFICE_AT = 7 * 60;
/** A redeploy across 7:00 still runs it — until 10:00; a day it could not run by then is NAMED as missed. */
const OFFICE_UNTIL = 10 * 60;
/** Monday–Saturday (0 = Sunday). Never Sunday unless Mike says. */
const OFFICE_DAYS = new Set([1, 2, 3, 4, 5, 6]);
/** TCPA quiet hours for customer texts: they may go out from 8:00 until 21:00 ET. */
const TEXTS_FROM = 8 * 60;
const TEXTS_UNTIL = 21 * 60;
/** A reply to the customer whose own text or call started a session is not held — within this long of it coming in. */
const REPLY_WINDOW_MS = 60 * 60_000;
/** The office check's report is kept whole up to this many characters (Activity clips at 1,000). */
const REPORT_LIMIT = 4000;
const TICK_MS = 60_000;
/** Waits between session-start retries after Anthropic refuses or is unreachable. */
const START_BACKOFF_MS = [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];
/** Waits between stream reconnects, then every minute (the last) for as long as it takes; this many tries in a row that never reach the session and the loss is named. */
const RECONNECT_MS = [1_000, 2_000, 5_000, 15_000, 30_000, 60_000, 60_000, 60_000];
/** A stream that stayed open this long before dropping was healthy — the failure count starts over. */
const HEALTHY_STREAM_MS = 60_000;
/** This long without reaching a session at all and the loss is named, however slowly each try fails. */
const LOST_AFTER_MS = 5 * 60_000;
/** A Limited environment, once read back, is trusted this long before Arbo reads it again (every minute while it is not). */
const ENV_RECHECK_MS = 15 * 60_000;
const NOTE_CAP = 2000;
/** What the agent is told about a call Arbo never saw end (a redeploy, or Quo's events out of order). */
const DIRECTION_UNKNOWN = 'unknown — Arbo did not see this call end. Check Quo first: an outgoing call (Mike calling out) is not an item — stop without acting.';
/** Incoming call states that mean nobody — not Mike, not Sona — picked up. */
const MISSED_STATUSES = new Set(['missed', 'no-answer', 'busy', 'canceled', 'abandoned']);

/** What the agent is told when it tries to send a Gmail draft by its id. Refused at once; never a card. */
export const DRAFT_ID_REFUSAL = 'Put To, Subject and the full Body in the call; a draft id is never sent';

const ROUTE_MESSAGE = "Prepare each crew's route summary for today and request approval to text it.";
/** Gmail only — Quo items each start their own session. The window ends when the sweep is sent; the next one starts there. */
const sweepMessage = (sinceIso: string, untilIso: string): string =>
  `Sweep job from Arbo: check Gmail for emails that arrived between ${sinceIso} and ${untilIso}, including website contact-form and quote-request emails. Treat each one as its own item and handle each per your instructions. Do not work Quo texts or calls — Arbo starts a separate session for each of those. Then stop.`;
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** 0 = Sunday, for an ET date (YYYY-MM-DD). */
const weekdayOf = (day: string): number => new Date(`${day}T12:00:00Z`).getUTCDay();
/** The daily office check — the four things Mike asked for, a report, and every send still his to allow. */
const officeMessage = (day: string): string => [
  `Daily office check from Arbo for ${WEEKDAY[weekdayOf(day)]} ${day}. Look, report, then stop:`,
  "1. Weather: the forecast for today's and tomorrow's jobs and estimates on the calendar. Flag any storm, high wind, heavy rain or other hazard to outdoor work, with a suggested new day. Never move an event.",
  "2. Unpaid invoices: Square invoices unpaid past their due date. List each one. Every Square call waits for Mike's OK for now, lookups included, so find them in as few calls as you can. A reminder to a customer may be requested by email — it waits for Mike's OK, points to the invoice and never restates the amount. A text reminder before 8am goes in your update instead.",
  '3. Equipment: trucks, chippers and other equipment due for service soon, from the equipment log in Drive.',
  '4. Waiting on Mike: anything in Gmail, Quo, Calendar or Drive that needs his decision or his call.',
  'Finish with one short update under four headings — Weather, Unpaid invoices, Equipment, Waiting on you. Say plainly what you could not read: "I couldn\'t read it" is never "there\'s nothing there".',
].join('\n');

type Config = ReturnType<typeof assistantEnv>;

/** Today's office check, in one line for the app. Null when none is due today (before 7am, or a Sunday). */
export interface OfficeCheckStatus {
  /** ET date (YYYY-MM-DD). */
  day: string;
  state: 'queued' | 'working' | 'waiting' | 'done' | 'error' | 'missed';
  line: string;
  /** A done check's report, in its own words — kept apart from Activity, so a busy morning never scrolls it away. */
  report?: { at: string; text: string };
}

export interface AssistantStatus {
  state: 'off' | 'not_set_up' | 'ready' | 'error';
  missing: string[];
  reason: string | null;
  sessionsOpen: number;
  lastEventAt: string | null;
  officeCheck: OfficeCheckStatus | null;
}

export interface RouteAnswer {
  status: number;
  body: unknown;
}

export interface AssistantDeps {
  /** Read at call time — defaults to the live environment (src/env.ts). */
  config?: () => Config;
  makeApi?: (apiKey: string) => AssistantApi;
  store?: AssistantStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Env var NAMES that are missing or malformed. Never a value. */
export function missingNames(cfg: Config): string[] {
  const m: string[] = [];
  if (!cfg.apiKey) m.push('ANTHROPIC_API_KEY');
  if (!cfg.agentId) m.push('ARBO_AGENT_ID');
  if (!cfg.environmentId) m.push('ARBO_AGENT_ENVIRONMENT_ID');
  if (!cfg.vaultId) m.push('ARBO_AGENT_VAULT_ID');
  if (cfg.budgetCents === null) m.push('ARBO_AGENT_SESSION_BUDGET_USD');
  return m;
}

/** Minutes after midnight in Hampton Roads. */
function etMinutes(nowMs: number): number {
  const local = new Date(nowMs + etOffsetMs(new Date(nowMs)));
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

function etClock(nowMs: number): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(nowMs));
}

/** One line for the app when Anthropic refuses or cannot be reached. Status codes only ever reach the log. */
function apiErrorLine(err: unknown): string {
  const status = err instanceof AssistantApiError ? err.status : null;
  const msg = err instanceof Error ? err.message : 'error';
  if (status === 401) return 'Anthropic answered 401 — check ANTHROPIC_API_KEY';
  if (status === 403) return 'Anthropic answered 403 — this key may not use Managed Agents; check ANTHROPIC_API_KEY and its workspace';
  if (status === 404) return 'Anthropic answered 404 — check ARBO_AGENT_ID, ARBO_AGENT_ENVIRONMENT_ID and ARBO_AGENT_VAULT_ID';
  if (status === 400) return `Anthropic refused the request (400): ${clip(msg, 200)}`;
  if (status === 409) return `Anthropic answered 409: ${clip(msg, 200)}`;
  if (status === 429) return 'Anthropic answered 429 — rate limited; Arbo will try again';
  if (status !== null && status >= 500) return `Anthropic answered ${status} — a problem on their side; Arbo will try again`;
  return `Could not reach Anthropic (${clip(msg, 120)}) — Arbo will try again`;
}

const statusOf = (err: unknown): string => (err instanceof AssistantApiError && err.status !== null ? String(err.status) : 'no answer');

/** The request may have landed even though it failed: no answer, a timeout, a conflict, a rate limit, or their side. */
function mayHaveLanded(err: unknown): boolean {
  const st = err instanceof AssistantApiError ? err.status : null;
  return st === null || st === 408 || st === 409 || st === 429 || st >= 500;
}

/** The last 10 digits of a phone number — how two spellings of one number are compared. Never logged. */
const tail10 = (v: string): string | null => {
  const d = v.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
};

/**
 * An email or text that went out, a calendar, Drive or Quo write, or a Square
 * call that changes money — each should have waited for Mike (R28: every send
 * and every write waits). A READ is not a write: the read tools Arbo turns on
 * are named list / get / search / read / download / fetch / suggest, and every
 * calendar write waits too (Mike, 2026-10-20: "Each booking waits for my
 * OK"). Square reads ride the same one tool as its writes, so only a
 * write-shaped method counts.
 */
function sentWithoutAsking(ev: AgentEvent): boolean {
  const kind = classify(ev.mcp_server_name, ev.name ?? '');
  const name = ev.name ?? '';
  if (kind === 'email' || kind === 'text') return true;
  if (kind === 'calendar') return !/^(list|get|search|suggest|find|query|free)/i.test(name);
  if (kind === 'drive') return !/^(search|read|download|get|list)/i.test(name);
  if (familyOf(ev.mcp_server_name) === 'quo') return !/^(fetch|list|get)/i.test(name); // contact, note and task writes
  if (kind !== 'payment') return false;
  const method = `${ev.name ?? ''} ${typeof ev.input?.method === 'string' ? ev.input.method : ''}`;
  return /create|pay|publish|send|update|cancel|refund|charge|complete|delete/i.test(method);
}

// ─── Quo events → one item each ──────────────────────────────────────────

interface QuoItem {
  /** One call or one text — the dedupe key, so a call's summary AND transcript start one session, not two. */
  itemKey: string;
  eventId: string | null;
  label: string;
  message: string;
  /** Last 10 digits of the customer whose own text or call this is — kept off the message, the title and the log. */
  contact: string | null;
  /** When that text or call came in, by Quo's clock — a reply is let through quiet hours only within the hour of it. */
  contactAt: string | null;
}

const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const callIdOf = (v: unknown): string | null => {
  const x = s(v);
  return x && x.startsWith('AC') ? x : null;
};

interface CallInfo {
  direction: string | null;
  conversationId: string | null;
  at: string | null;
  /** Last 10 digits of the caller. */
  from: string | null;
}

function itemMessage(what: string, eventId: string | null, lines: Array<[string, string | null]>): string {
  const body = [
    `New from Quo: ${what}.`,
    ...(eventId ? [`Quo event id: ${eventId}`] : []),
    ...lines.map(([k, v]) => `${k}: ${v ?? 'not in this event — look it up in Quo'}`),
    'Handle this one item per your instructions, then stop.',
  ];
  return body.join('\n');
}

/**
 * The Quo deliveries that start a session: an inbound text, a missed call,
 * and a finished INBOUND call's summary or transcript. The message names the
 * item by Quo ids only — the agent reads the words itself, through its Quo
 * tools. Our own outgoing texts and calls (Mike calling back) start nothing.
 */
export function quoItemFrom(event: unknown, calls: Map<string, CallInfo>): QuoItem | null {
  if (typeof event !== 'object' || event === null) return null;
  const e = event as { id?: unknown; type?: unknown; createdAt?: unknown; data?: { object?: Record<string, unknown> } };
  const o = e.data?.object ?? {};
  const eventId = s(e.id);
  switch (s(e.type)) {
    case 'message.received': {
      if (o.direction && o.direction !== 'incoming') return null;
      const id = s(o.id);
      if (!id) return null;
      return {
        itemKey: `quo:message:${id}`,
        eventId,
        label: 'quo text',
        contact: tail10(s(o.from) ?? ''),
        contactAt: s(o.createdAt) ?? s(e.createdAt),
        message: itemMessage('an inbound text', eventId, [
          ['Message id', id],
          ['Conversation id', s(o.conversationId)],
          ['At', s(o.createdAt) ?? s(e.createdAt)],
          ['Direction', s(o.direction) ?? 'incoming'],
        ]),
      };
    }
    case 'call.completed': {
      const id = s(o.id);
      if (!id) return null;
      const info: CallInfo = { direction: s(o.direction), conversationId: s(o.conversationId), at: s(o.createdAt), from: tail10(s(o.from) ?? '') };
      calls.set(id, info);
      while (calls.size > 500) {
        const oldest = calls.keys().next().value;
        if (oldest === undefined) break;
        calls.delete(oldest);
      }
      if (o.direction && o.direction !== 'incoming') return null;
      const missed = !s(o.answeredAt) || MISSED_STATUSES.has(s(o.status) ?? '');
      if (!missed) return null; // an answered call starts its session from its summary or transcript
      return {
        itemKey: `quo:call:${id}`,
        eventId,
        label: 'quo missed call',
        contact: info.from,
        contactAt: info.at ?? s(e.createdAt),
        message: itemMessage('a missed call', eventId, [
          ['Call id', id],
          ['Conversation id', info.conversationId],
          ['At', info.at ?? s(e.createdAt)],
          ['Direction', info.direction ?? 'incoming'],
          ['Call status', s(o.status)],
        ]),
      };
    }
    case 'call.summary.completed':
    case 'call.transcript.completed': {
      const transcript = e.type === 'call.transcript.completed';
      const callId = s(o.callId) ?? (transcript ? (Array.isArray(o.dialogue) ? callIdOf(o.id) : null) : callIdOf(o.id));
      if (!callId) return null;
      // A transcript Quo has not finished writing is not "finished" — the
      // finished one (or the summary) starts the session.
      if (transcript && ((s(o.status) && o.status !== 'completed') || !Array.isArray(o.dialogue))) return null;
      const info = calls.get(callId);
      // Our own outgoing call (Mike calling a customer back from Quo) is not an
      // item — the same rule as an outgoing text and call.completed above.
      if (info?.direction && info.direction !== 'incoming') return null;
      return {
        itemKey: `quo:call:${callId}`,
        eventId,
        label: transcript ? 'quo call transcript' : 'quo call summary',
        contact: info?.from ?? null,
        contactAt: info?.at ?? null,
        message: itemMessage(transcript ? "a finished call's transcript" : "a finished call's summary", eventId, [
          ['Call id', callId],
          ['Conversation id', info?.conversationId ?? s(o.conversationId)],
          ['At', info?.at ?? s(o.createdAt) ?? s(e.createdAt)],
          // Mike's own call out is not an item: when Arbo cannot tell, the agent checks first.
          ['Direction', info?.direction ?? DIRECTION_UNKNOWN],
        ]),
      };
    }
    default:
      return null;
  }
}

// ─── The assistant ───────────────────────────────────────────────────────

export class Assistant {
  readonly store: AssistantStore;
  private readonly cfg: () => Config;
  private readonly makeApi: (apiKey: string) => AssistantApi;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private apiFor: { key: string; api: AssistantApi } | null = null;
  private lastApiError: string | null = null;
  private startFailures = 0;
  private retryAt = 0;
  private pumping = false;
  private pumpAgain = false;
  private readonly watchers = new Map<string, Promise<void>>();
  private readonly streams = new Map<string, EventStream>();
  private readonly deciding = new Set<string>();
  /** Mike's own decision, seen echoed on the stream while decide() still waited for Anthropic's answer — proof it landed. */
  private readonly echoed = new Map<string, 'allow' | 'deny'>();
  /** Draft-id sends being refused right now (one refusal per ask). */
  private readonly refusing = new Set<string>();
  /** Sessions Arbo cannot reach right now — still retried every minute; named on the status line. */
  private readonly lostTouch = new Set<string>();
  /** Whether the agent's environment read back as Limited networking, and when. Null = not read yet: nothing starts. */
  private envState: { ok: boolean; reason: string | null; at: number } | null = null;
  private envChecking: Promise<void> | null = null;
  private readonly calls = new Map<string, CallInfo>();
  private timer: NodeJS.Timeout | null = null;

  constructor(deps: AssistantDeps = {}) {
    this.cfg = deps.config ?? assistantEnv;
    this.makeApi = deps.makeApi ?? createAnthropicAssistantApi;
    this.store = deps.store ?? new AssistantStore();
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    // Which way each recent call went survives a redeploy (ids and direction only).
    for (const c of this.store.data.callDirections) this.calls.set(c.id, { direction: c.direction, conversationId: null, at: null, from: null });
  }

  // ── state ──

  /** On, every name set, and the store readable. Triggers fire only then. */
  private ready(): Config | null {
    const c = this.cfg();
    if (!c.on || missingNames(c).length > 0 || this.store.unreadable) return null;
    return c;
  }

  private api(): AssistantApi | null {
    const c = this.ready();
    if (!c || !c.apiKey) return null;
    if (!this.apiFor || this.apiFor.key !== c.apiKey) this.apiFor = { key: c.apiKey, api: this.makeApi(c.apiKey) };
    return this.apiFor.api;
  }

  private openSessions(): SessionRec[] {
    return this.store.data.sessions.filter((x) => x.state === 'working' || x.state === 'waiting');
  }

  status(): AssistantStatus {
    const c = this.cfg();
    const missing = missingNames(c);
    const base = { missing, sessionsOpen: this.openSessions().length, lastEventAt: this.store.data.lastEventAt, officeCheck: null };
    if (!c.on) {
      return { state: 'off', reason: 'ARBO_AGENT is not "live" — the assistant is OFF and starts nothing. Set ARBO_AGENT=live in Railway to turn it on.', ...base };
    }
    if (missing.length) {
      return { state: 'not_set_up', reason: `Not set up — missing in Railway: ${missing.join(', ')}. Nothing starts until they are set.`, ...base };
    }
    if (this.store.unreadable) {
      return { state: 'error', reason: `Arbo could not read its assistant store (${this.store.unreadable}). Nothing starts until it can; the file was left untouched.`, ...base };
    }
    const on = { ...base, officeCheck: this.officeCheck() };
    if (!this.envState) return { state: 'error', reason: 'Checking that the agent environment is Limited networking — nothing starts until it is confirmed.', ...on };
    if (!this.envState.ok) return { state: 'error', reason: this.envState.reason, ...on };
    if (this.lastApiError) return { state: 'error', reason: this.lastApiError, ...on };
    if (this.lostTouch.size) {
      return { state: 'error', reason: `Arbo has lost touch with ${this.lostTouch.size} session(s) and is still trying every minute — anything they ask for reaches the app once it reconnects.`, ...on };
    }
    return {
      state: 'ready',
      reason: this.store.where === 'memory' ? 'Approvals are kept in memory only — the storage disk could not be written, so a redeploy forgets them.' : null,
      ...on,
    };
  }

  /** Today's office check as the app shows it (§1B: a day it could not run is said, never a quiet nothing). */
  private officeCheck(): OfficeCheckStatus | null {
    const day = etToday(new Date(this.now()));
    const d = this.store.data;
    const key = `office:${day}`;
    if (d.officeMissedDay === day) {
      return { day, state: 'missed', line: "Today's office check did not run — the assistant was off, not set up or not running between 7 and 10am ET. It runs again at 7am on the next day that is not a Sunday." };
    }
    if (d.lastOfficeDay !== day) return null;
    if (d.queue.some((q) => q.key === key)) return { day, state: 'queued', line: "Today's office check is waiting its turn to start." };
    const rec = d.sessions.find((x) => x.key === key);
    if (!rec) return { day, state: 'error', line: "Today's office check could not start — see More → Assistant." };
    if (rec.state === 'working') return { day, state: 'working', line: "Today's office check is running." };
    if (rec.state === 'waiting') return { day, state: 'waiting', line: "Today's office check is waiting — on your OK, or paused at its budget. See More → Assistant." };
    if (rec.state === 'done') {
      const r = d.officeReport?.day === day ? d.officeReport : null;
      if (!r) return { day, state: 'done', line: "Today's office check finished without a report — see More → Assistant." };
      return { day, state: 'done', line: "Today's office check is done. Its report:", report: { at: r.at, text: r.text } };
    }
    return { day, state: 'error', line: "Today's office check stopped before it finished — see More → Assistant." };
  }

  /** The 503 every assistant route answers when it cannot serve. */
  private gate(): RouteAnswer | null {
    const c = this.cfg();
    if (!c.on) return { status: 503, body: { error: 'assistant_off' } };
    if (missingNames(c).length) return { status: 503, body: { error: 'assistant_not_set_up' } };
    if (this.store.unreadable) return { status: 503, body: { error: 'unreadable' } };
    return null;
  }

  // ── the environment ──

  private envDue(): boolean {
    const e = this.envState;
    if (!e) return true;
    return this.now() - e.at >= (e.ok ? ENV_RECHECK_MS : TICK_MS);
  }

  /**
   * Reads the agent's environment back and records whether it is a cloud
   * environment on Limited networking (the hosts list in the setup guide).
   * Nothing starts until it is. One read at a time; never throws.
   */
  async checkEnvironment(): Promise<void> {
    if (this.envChecking) return this.envChecking;
    const c = this.ready();
    const api = this.api();
    if (!c || !api) return;
    this.envChecking = (async () => {
      try {
        const e = await api.describeEnvironment(c.environmentId!);
        let reason: string | null = null;
        if (e.archived) reason = 'The agent environment (ARBO_AGENT_ENVIRONMENT_ID) is archived — nothing starts. Create a new one: docs/ASSISTANT_SETUP.md, Step 3.';
        else if (e.type !== 'cloud') reason = `The agent environment is "${e.type}", not a cloud environment — nothing starts. See docs/ASSISTANT_SETUP.md, Step 3.`;
        else if (e.networking !== 'limited') reason = `The agent environment's networking is "${e.networking ?? 'not set'}", not Limited — nothing starts until it is. Set it to Limited: docs/ASSISTANT_SETUP.md, Step 3.`;
        const was = this.envState;
        this.envState = { ok: reason === null, reason, at: this.now() };
        if (reason && (!was || was.ok)) console.error('[assistant] environment is not a Limited cloud environment (or is archived) — nothing starts');
        if (!reason && was && !was.ok) console.log('[assistant] environment confirmed Limited — starting');
      } catch (err) {
        this.envState = { ok: false, reason: `Arbo could not read the agent environment — ${apiErrorLine(err)}. Nothing starts until it can confirm Limited networking.`, at: this.now() };
        console.error(`[assistant] environment not read — Anthropic ${statusOf(err)}; nothing starts`);
      }
    })().finally(() => {
      this.envChecking = null;
    });
    return this.envChecking;
  }

  private async environmentOk(): Promise<boolean> {
    if (this.envDue()) await this.checkEnvironment();
    return Boolean(this.envState?.ok);
  }

  // ── routes ──

  /** Why a text may not go out now (TCPA quiet hours), or null when it may. Worked out when Mike looks and when he taps. */
  private quietHold(a: StoredApproval): string | null {
    const nowMs = this.now();
    const mins = etMinutes(nowMs);
    if (mins >= TEXTS_FROM && mins < TEXTS_UNTIL) return null;
    // Not held: a reply, within the hour, to the customer whose own text or
    // call started this session, or a text to one of Mike's crew phones.
    // Anything Arbo cannot tell — no recipient it can read, no time the
    // customer's text came in — is held.
    const crew = new Set(this.cfg().crewNumbers);
    const rec = this.store.data.sessions.find((x) => x.id === a.sessionId);
    const since = rec?.replyToAt ? Date.parse(rec.replyToAt) : NaN;
    const replyTo = rec?.replyTo && Number.isFinite(since) && Math.abs(nowMs - since) <= REPLY_WINDOW_MS ? rec.replyTo : null; // an hour either side of Arbo's clock, no more
    const to = (a.textTo ?? []).map(tail10);
    if (to.length && to.every((t) => t !== null && (crew.has(t) || t === replyTo))) return null;
    return `It is ${etClock(nowMs)} ET — a text can go to a customer only from 8am to 9pm (TCPA quiet hours). Nothing was sent — it is still waiting: allow it after 8am, or deny it. A reply within the hour to the customer whose own text or call started this, or a text to a number in ARBO_AGENT_CREW_NUMBERS, is not held.`;
  }

  approvals(): RouteAnswer {
    const g = this.gate();
    if (g) return g;
    const nowMs = this.now();
    const list: Approval[] = this.store.data.approvals
      .filter((a) => !a.decided)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .map((a) => {
        const details: ApprovalDetail[] = [...a.details];
        // Worked out when Mike looks, not when it was asked: what matters is
        // the time the text would go out. Same rule as the refusal at Allow.
        if (a.kind === 'text' && this.quietHold(a)) {
          details.push({ label: 'Heads-up', value: `It is ${etClock(nowMs)} ET — outside 8am–9pm. Arbo holds a customer text until 8am (TCPA quiet hours): Allow is refused until then. A reply within the hour to the customer whose own text or call started this, or a text to your crew (ARBO_AGENT_CREW_NUMBERS), is not held.` });
        }
        return { id: a.id, sessionId: a.sessionId, tool: a.tool, kind: a.kind, summary: a.summary, details, requestedAt: a.requestedAt };
      });
    return { status: 200, body: { approvals: list } };
  }

  activity(): RouteAnswer {
    const g = this.gate();
    if (g) return g;
    const items = [...this.store.data.activity].reverse().slice(0, 100);
    return { status: 200, body: { items } };
  }

  /** A user.tool_confirmation for this tool call in the session's history: its result, null when there is none, 'unknown' when the history could not be read. */
  private async confirmationIn(api: AssistantApi, sessionId: string, toolUseId: string): Promise<'allow' | 'deny' | null | 'unknown'> {
    try {
      for await (const e of api.listEvents(sessionId)) {
        if (e.type === 'user.tool_confirmation' && e.tool_use_id === toolUseId && (e.result === 'allow' || e.result === 'deny')) return e.result;
      }
      return null;
    } catch {
      return 'unknown';
    }
  }

  async decide(id: string, decision: 'allow' | 'deny', note?: string): Promise<RouteAnswer> {
    const g = this.gate();
    if (g) return g;
    const a = this.store.data.approvals.find((x) => x.id === id);
    if (!a) return { status: 404, body: { error: 'not_found' } };
    if (a.decided || this.deciding.has(id)) return { status: 409, body: { error: 'already_decided' } };
    const api = this.api();
    if (!api) return { status: 503, body: { error: 'assistant_not_set_up' } };
    // TCPA quiet hours are enforced here, not only shown: Allow on a customer
    // text outside 8am–9pm ET is refused by name and the card keeps waiting.
    if (decision === 'allow' && a.kind === 'text') {
      const held = this.quietHold(a);
      if (held) {
        console.log(`[assistant] ${id} held — a text outside 8am–9pm ET; nothing sent`);
        return { status: 409, body: { error: 'quiet_hours', line: held } };
      }
    }
    const cleanNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, NOTE_CAP) : undefined;
    this.deciding.add(id);
    let landed: 'allow' | 'deny';
    try {
      try {
        await api.sendConfirmation(a.sessionId, {
          type: 'user.tool_confirmation',
          tool_use_id: id,
          result: decision,
          ...(decision === 'deny' ? { deny_message: cleanNote ?? 'Mike did not approve this.' } : {}),
        });
        landed = decision;
      } catch (err) {
        // It may have landed anyway (the answer was lost; or a re-send met an
        // event no longer waiting): the echo seen on the stream, or the
        // session's own history, says — before anything is called unsent.
        const found = this.echoed.get(id) ?? (await this.confirmationIn(api, a.sessionId, id));
        if (found === 'allow' || found === 'deny') {
          landed = found;
          console.log(`[assistant] decision on ${id} reached the session although Anthropic answered ${statusOf(err)}`);
        } else {
          // A session that has truly ended can never take this decision: close
          // the card by name rather than leave it waiting forever. Anything else
          // (a blip, their side) keeps it waiting for another tap.
          const rec = this.store.data.sessions.find((x) => x.id === a.sessionId);
          const gone = rec && this.finished(rec) && err instanceof AssistantApiError && (err.status === 400 || err.status === 404);
          if (gone) {
            this.store.data.approvals = this.store.data.approvals.filter((x) => x.id !== id);
            const unread = found === 'unknown'; // its history could not be read either: say only what is known
            this.activity_(a.sessionId, 'error', unread
              ? `Closed — the session has ended and Arbo could not read its history, so it cannot say whether your decision reached it first: ${a.summary}`
              : `Closed without sending — the session ended before your decision could reach it: ${a.summary}`, { tool: a.tool });
            this.store.save();
            console.error(`[assistant] decision on ${id} — session ${a.sessionId} has ended (${statusOf(err)}${unread ? ', history unreadable' : ''}); card closed`);
            return {
              status: 502,
              body: {
                error: 'send_failed',
                line: unread
                  ? 'That session has ended and Arbo could not read its history, so it cannot say whether your answer reached it first. The card is closed — check Gmail, Quo or Square before you do it by hand.'
                  : 'That session has ended, so nothing was sent and the card is closed. If it still needs doing, it needs doing by hand.',
              },
            };
          }
          if (found === 'unknown') {
            console.error(`[assistant] decision on ${id} — Anthropic ${statusOf(err)} and the history could not be read; still waiting`);
            return { status: 502, body: { error: 'send_failed', line: `${apiErrorLine(err)}. Arbo could not check whether your ${decision === 'allow' ? 'OK' : 'no'} reached it — tap ↻ to see if it is still waiting before you tap again.` } };
          }
          console.error(`[assistant] decision on ${id} NOT delivered — Anthropic ${statusOf(err)}; it is still waiting`);
          return { status: 502, body: { error: 'send_failed', line: `${apiErrorLine(err)}. Nothing was ${decision === 'allow' ? 'allowed' : 'denied'} — it is still waiting.` } };
        }
      }
    } finally {
      this.deciding.delete(id);
      this.echoed.delete(id);
    }
    const at = new Date(this.now()).toISOString();
    if (landed !== decision) {
      // Answered another way first (the Console): that answer is the one that stands.
      a.decided = { decision: landed, at, by: 'elsewhere' };
      this.activity_(a.sessionId, 'decided', `${landed === 'allow' ? 'Allowed' : 'Denied'} outside the app: ${a.summary}`, { tool: a.tool });
      this.store.save();
      return { status: 409, body: { error: 'already_decided' } };
    }
    a.decided = { decision, at, by: 'mike', ...(cleanNote ? { note: cleanNote } : {}) };
    this.activity_(a.sessionId, 'decided', `You ${decision === 'allow' ? 'allowed' : 'denied'}: ${a.summary}${cleanNote ? ` — “${cleanNote}”` : ''}`, { tool: a.tool });
    // The session resumes on the decision; if Arbo is not watching it (it
    // lost touch, or this is after a restart), watch it again. Marked
    // working BEFORE the save, so its seen ids are kept for the replay.
    const rec = this.store.data.sessions.find((x) => x.id === a.sessionId);
    const rewatch = Boolean(rec && rec.state !== 'done' && !this.watchers.has(rec.id));
    if (rec && rewatch) rec.state = 'working';
    this.store.save();
    console.log(`[assistant] ${id} ${decision === 'allow' ? 'allowed' : 'denied'} (${a.kind}) — ${this.pending()} approval(s) still waiting`);
    if (rec && rewatch) this.watch(rec);
    return { status: 200, body: { ok: true } };
  }

  private pending(): number {
    return this.store.data.approvals.filter((a) => !a.decided).length;
  }

  private activity_(sessionId: string, kind: ActivityKind, text: string, extra: { tool?: string; permission?: 'allow' | 'ask' | 'deny'; at?: string } = {}): void {
    const item: ActivityItem = {
      at: extra.at ?? new Date(this.now()).toISOString(),
      sessionId,
      kind,
      text: clip(text, 1000),
      ...(extra.tool ? { tool: extra.tool } : {}),
      ...(extra.permission ? { permission: extra.permission } : {}),
    };
    this.store.data.activity.push(item);
  }

  // ── triggers ──

  /**
   * Called by /webhooks/quo AFTER Quo's signature was verified (only on its
   * 200). Never throws — a bad event must not touch the webhook's answer.
   */
  noteQuoEvent(rawBody: string): void {
    try {
      if (!this.ready()) return;
      const event: unknown = JSON.parse(rawBody);
      const item = quoItemFrom(event, this.calls);
      this.rememberDirection(event);
      if (!item) return;
      this.enqueue({
        trigger: 'quo',
        label: item.label,
        message: item.message,
        keys: [item.itemKey, ...(item.eventId ? [`quo:event:${item.eventId}`] : [])],
        ...(item.contact ? { replyTo: item.contact, ...(item.contactAt ? { replyToAt: item.contactAt } : {}) } : {}),
      });
    } catch (err) {
      console.error('[assistant] Quo event not read:', err instanceof Error ? err.name : 'error');
    }
  }

  /**
   * A finished call's direction, kept on disk (id and direction only), so a
   * summary that arrives after a redeploy still knows Mike's own call out is
   * not an item.
   */
  private rememberDirection(event: unknown): void {
    const e = event as { type?: unknown; data?: { object?: Record<string, unknown> } } | null;
    if (!e || typeof e !== 'object' || e.type !== 'call.completed') return;
    const id = s(e.data?.object?.id);
    const direction = s(e.data?.object?.direction);
    const list = this.store.data.callDirections;
    if (!id || !direction || list.some((c) => c.id === id)) return;
    list.push({ id, direction });
    this.store.save();
  }

  /** Queue a session unless one of its keys was already started or queued. Persisted before anything starts. */
  private enqueue(t: { trigger: Trigger; label: string; message: string; keys: string[]; replyTo?: string; replyToAt?: string }): boolean {
    const d = this.store.data;
    if (t.keys.some((k) => d.processed.includes(k))) return false;
    d.processed.push(...t.keys);
    const at = new Date(this.now()).toISOString();
    if (d.queue.length >= QUEUE_CAP) {
      this.activity_('', 'error', `Not started — ${QUEUE_CAP} items are already waiting to start (${t.label}). Nothing else will pick it up: check it by hand.`);
      console.error(`[assistant] queue full — 1 ${t.label} not started (${QUEUE_CAP} waiting)`);
      this.store.save();
      return false;
    }
    const q: QueuedTrigger = {
      key: t.keys[0]!,
      trigger: t.trigger,
      label: t.label,
      title: `Arbo · ${t.label} · ${at.slice(0, 16)}Z`,
      message: t.message,
      queuedAt: at,
      ...(t.replyTo ? { replyTo: t.replyTo } : {}),
      ...(t.replyToAt ? { replyToAt: t.replyToAt } : {}),
    };
    d.queue.push(q);
    this.store.save();
    void this.pump();
    return true;
  }

  /** The clock: the 6:30am crew routes, the 7am office check (Mon–Sat), and the 30-minute Gmail sweep (7am–9pm ET). */
  tick(): void {
    if (!this.ready()) return;
    const nowMs = this.now();
    const mins = etMinutes(nowMs);
    const d = this.store.data;
    const day = etToday(new Date(nowMs));
    // The environment is read again when due — every minute while it is not Limited.
    if (this.envDue()) void this.checkEnvironment();
    if (mins >= ROUTE_AT && mins < ROUTE_UNTIL && d.lastRouteDay !== day) {
      d.lastRouteDay = day;
      this.enqueue({ trigger: 'route', label: 'crew routes', message: ROUTE_MESSAGE, keys: [`route:${day}`] });
    }
    // The daily office check (Mike, 2026-10-20: "One daily office check"):
    // once, 7–10am ET, Monday to Saturday. A day it could not run is named.
    if (OFFICE_DAYS.has(weekdayOf(day)) && d.lastOfficeDay !== day) {
      if (mins >= OFFICE_AT && mins < OFFICE_UNTIL) {
        d.lastOfficeDay = day;
        this.enqueue({ trigger: 'office', label: 'office check', message: officeMessage(day), keys: [`office:${day}`] });
      } else if (mins >= OFFICE_UNTIL && d.officeMissedDay !== day) {
        d.officeMissedDay = day;
        this.activity_('', 'error', "Today's office check did not run — the assistant was off, not set up or not running between 7 and 10am ET. It runs again at 7am on the next day that is not a Sunday.");
        this.store.save();
        console.error(`[assistant] office check for ${day} did not run — missed its 7–10am ET window`);
      }
    }
    // One sweep at a time: not while one is queued or still working (a sweep
    // parked on Mike's OK does not hold the next one back).
    const sweepBusy = d.queue.some((q) => q.trigger === 'sweep') || d.sessions.some((x) => x.trigger === 'sweep' && x.state === 'working');
    if (mins >= SWEEP_FROM && mins <= SWEEP_UNTIL && !sweepBusy) {
      const last = d.lastSweepAt ? Date.parse(d.lastSweepAt) : NaN;
      if (!Number.isFinite(last) || nowMs - last >= SWEEP_EVERY_MS) {
        const since = Number.isFinite(last) ? new Date(last).toISOString() : new Date(nowMs - SWEEP_EVERY_MS).toISOString();
        const at = new Date(nowMs).toISOString();
        d.lastSweepAt = at;
        this.enqueue({ trigger: 'sweep', label: 'sweep', message: sweepMessage(since, at), keys: [`sweep:${at}`] });
      }
    }
    // enqueue() saved anything it queued; this retries a start that is backing off.
    void this.pump();
  }

  /** Boot: name the state, read the environment, re-attach to sessions still open, start the clock. */
  start(): void {
    const c = this.cfg();
    if (!c.on) console.log('[assistant] OFF — ARBO_AGENT is not "live"; nothing starts');
    else if (missingNames(c).length) console.error(`[assistant] NOT SET UP — missing: ${missingNames(c).join(', ')}; nothing starts`);
    else if (this.store.unreadable) console.error('[assistant] store UNREADABLE — nothing starts; the file was left untouched');
    else {
      const open = this.openSessions();
      console.log(`[assistant] on — ${open.length} session(s) to re-attach, ${this.pending()} approval(s) waiting, ${this.store.data.queue.length} queued; reading the environment before anything starts`);
      void this.checkEnvironment();
      for (const rec of open) this.watch(rec);
    }
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
      this.timer.unref?.();
    }
    this.tick();
  }

  /** Start queued sessions while fewer than MAX_WORKING are working. One pump at a time. */
  async pump(): Promise<void> {
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.pumpAgain = false;
        const d = this.store.data;
        while (d.queue.length > 0 && this.now() >= this.retryAt) {
          if (d.sessions.filter((x) => x.state === 'working').length >= MAX_WORKING) break;
          const cfg = this.ready();
          const api = this.api();
          if (!cfg || !api) break;
          if (!(await this.environmentOk())) break; // named on the status line; read again within a minute
          const q = d.queue[0]!;
          const key = q.key.slice(0, 500);
          let id: string | null = null;
          let adopted = false;
          let creating = false;
          try {
            // A create that may already have landed (its answer was lost, or
            // the process stopped mid-create) is looked up by its key first —
            // one item is one session, never two. A lookup that fails is a
            // failed start, never "there is none" (§1B).
            if (q.triedAt) {
              id = (await api.findSession(cfg.agentId!, key, q.queuedAt))?.id ?? null;
              adopted = id !== null;
            }
            if (id === null) {
              q.triedAt = new Date(this.now()).toISOString();
              this.store.save();
              creating = true;
              ({ id } = await api.createSession({
                agentId: cfg.agentId!,
                environmentId: cfg.environmentId!,
                vaultId: cfg.vaultId!,
                budgetCents: cfg.budgetCents!,
                title: q.title,
                metadata: { arbo_trigger: q.trigger, arbo_key: key },
                firstMessage: q.message,
              }));
            }
          } catch (err) {
            // A definitive refusal made nothing: the next try creates without a lookup.
            if (creating && !mayHaveLanded(err)) {
              delete q.triedAt;
              this.store.save();
            }
            this.lastApiError = apiErrorLine(err);
            this.startFailures += 1;
            this.retryAt = this.now() + START_BACKOFF_MS[Math.min(this.startFailures - 1, START_BACKOFF_MS.length - 1)]!;
            console.error(`[assistant] could not start a session — Anthropic ${statusOf(err)}; ${d.queue.length} waiting, retry in ${Math.round((this.retryAt - this.now()) / 60_000)} min`);
            break;
          }
          this.lastApiError = null;
          this.startFailures = 0;
          d.queue.shift();
          if (id === null || d.sessions.some((x) => x.id === id)) {
            this.store.save(); // already recorded: nothing more to start
            continue;
          }
          const rec: SessionRec = {
            id,
            trigger: q.trigger,
            label: q.label,
            startedAt: new Date(this.now()).toISOString(),
            state: 'working',
            seen: [],
            key,
            ...(q.replyTo ? { replyTo: q.replyTo } : {}),
            ...(q.replyToAt ? { replyToAt: q.replyToAt } : {}),
          };
          d.sessions.push(rec);
          this.activity_(id, 'started', adopted ? `Started — ${q.label} (its session had already started; Arbo picked it up)` : `Started — ${q.label}`);
          this.store.save();
          console.log(`[assistant] session ${id} ${adopted ? 'adopted' : 'started'} (${q.label})`);
          this.watch(rec);
        }
      } while (this.pumpAgain);
    } finally {
      this.pumping = false;
    }
  }

  // ── watching ──

  private watch(rec: SessionRec): void {
    if (this.watchers.has(rec.id)) return;
    const run = this.runWatch(rec)
      .catch((err) => {
        console.error(`[assistant] watcher for ${rec.id} stopped:`, err instanceof Error ? err.name : 'error');
      })
      .finally(() => {
        this.watchers.delete(rec.id);
        this.streams.delete(rec.id);
        this.lostTouch.delete(rec.id);
        void this.pump();
      });
    this.watchers.set(rec.id, run);
  }

  /** Test seam: is a watcher running for this session? */
  isWatching(sessionId: string): boolean {
    return this.watchers.has(sessionId);
  }

  private finished(rec: SessionRec): boolean {
    return rec.state === 'done' || rec.state === 'error';
  }

  /**
   * The consolidation pattern: open the stream FIRST, then read the history,
   * then tail the stream — deduped by event id, so the gap between a drop and
   * a reconnect never loses an event. Reconnects until the session finishes:
   * only its own events (or a 404) finish it. An outage is retried, the wait
   * capped at a minute, and named on the status line while it lasts.
   */
  private async runWatch(rec: SessionRec): Promise<void> {
    const seen = new Set(rec.seen);
    /** Streams that ended within a minute in a row — sets the wait only. */
    let quickFailures = 0;
    /** Tries in a row that never reached the session — this, not quickFailures, names a loss. */
    let unreached = 0;
    let lastReachedAt = this.now();
    while (!this.finished(rec)) {
      const api = this.api();
      if (!api) return; // switched off or unset mid-run: re-attached at the next boot
      const openedAt = this.now();
      let stream: EventStream | null = null;
      let reached = false;
      try {
        stream = await api.openStream(rec.id);
        this.streams.set(rec.id, stream);
        for await (const ev of api.listEvents(rec.id)) {
          this.handle(rec, ev, seen);
          if (this.finished(rec)) break;
        }
        reached = true;
        lastReachedAt = this.now();
        this.backInTouch(rec);
        if (!this.finished(rec)) {
          for await (const ev of stream.events) {
            this.handle(rec, ev, seen);
            if (this.finished(rec)) break;
          }
        }
      } catch (err) {
        if (err instanceof AssistantApiError && err.status === 404) {
          this.finish(rec, 'error', `This session no longer exists at Anthropic (${rec.id}) — ${rec.label}`);
          console.error(`[assistant] session ${rec.id} not found (404)`);
          break;
        }
      } finally {
        stream?.close();
      }
      if (this.finished(rec)) break;
      quickFailures = this.now() - openedAt >= HEALTHY_STREAM_MS ? 0 : quickFailures + 1;
      unreached = reached ? 0 : unreached + 1;
      // Named lost after many tries in a row that never reached it, or after
      // LOST_AFTER_MS with no reach at all (an outage where each try hangs
      // before it fails). Short streams that still read the history are not
      // a loss, so one blip after them is not either.
      const lost = unreached > RECONNECT_MS.length || this.now() - lastReachedAt >= LOST_AFTER_MS;
      if (!reached && lost && !this.lostTouch.has(rec.id)) {
        this.lostTouch.add(rec.id);
        this.activity_(rec.id, 'error', `Arbo lost touch with this session (${rec.label}) — still trying every minute. Anything it asks for meanwhile shows up here once Arbo reconnects; if this stays, open ${rec.id} in the Claude Console.`);
        this.store.save();
        console.error(`[assistant] session ${rec.id} — lost touch after ${unreached} tries in a row; still trying every minute`);
      }
      await this.sleep(RECONNECT_MS[Math.min(Math.max(0, quickFailures - 1), RECONNECT_MS.length - 1)]!);
    }
  }

  private backInTouch(rec: SessionRec): void {
    if (!this.lostTouch.delete(rec.id)) return;
    this.activity_(rec.id, 'info', `Back in touch with this session (${rec.label}) — anything it asked for meanwhile is shown.`);
    this.store.save();
    console.log(`[assistant] session ${rec.id} — back in touch`);
  }

  private finish(rec: SessionRec, state: 'done' | 'error', text: string): void {
    rec.state = state;
    this.activity_(rec.id, state === 'done' ? 'done' : 'error', text);
    this.store.save();
  }

  /**
   * A Gmail send by draft id: Gmail would send the saved draft as it is and
   * ignore the To, Subject and Body a card would show. It never reaches Mike —
   * refused at once with the rule. The event is remembered only once the
   * refusal has landed, so a restart tries again; one that cannot be
   * delivered is named.
   */
  private async refuseDraftSend(rec: SessionRec, eventId: string, tool: string, draftId: string, at: string): Promise<void> {
    this.refusing.add(eventId);
    try {
      for (let attempt = 0; ; attempt++) {
        const api = this.api();
        if (!api || this.finished(rec)) return;
        let landed = false;
        try {
          await api.sendConfirmation(rec.id, { type: 'user.tool_confirmation', tool_use_id: eventId, result: 'deny', deny_message: DRAFT_ID_REFUSAL });
          landed = true;
        } catch {
          const found = await this.confirmationIn(api, rec.id, eventId);
          landed = found === 'allow' || found === 'deny';
        }
        if (landed) {
          if (!rec.seen.includes(eventId)) rec.seen.push(eventId);
          this.activity_(rec.id, 'tool', `Refused at once: a send by draft id (${tool}, draft ${draftId}). Gmail sends a draft as saved and ignores the words in the request, so you could not have seen what would go out. The agent was told to put To, Subject and the full Body in the call.`, { tool, permission: 'deny', at });
          this.store.save();
          console.log(`[assistant] refused a send by draft id in ${rec.id} (${eventId})`);
          return;
        }
        if (attempt + 1 >= RECONNECT_MS.length) {
          this.activity_(rec.id, 'error', `Arbo could not deliver its refusal of a send by draft id (${tool}) — the session is still waiting on it. Deny it in the Claude Console (${rec.id}).`, { tool });
          this.store.save();
          console.error(`[assistant] could not deliver the draft-id refusal in ${rec.id} (${eventId})`);
          return;
        }
        await this.sleep(RECONNECT_MS[attempt]!);
      }
    } finally {
      this.refusing.delete(eventId);
    }
  }

  /**
   * One event. State changes are applied on every sighting (a replayed
   * history must land on the right state); side effects — an Approval, an
   * activity line — only the first time the event id is seen.
   */
  private handle(rec: SessionRec, ev: AgentEvent, seen: Set<string>): void {
    if (!ev || typeof ev.id !== 'string') return;
    const isNew = !seen.has(ev.id);
    seen.add(ev.id);
    const at = typeof ev.processed_at === 'string' && Number.isFinite(Date.parse(ev.processed_at)) ? ev.processed_at : new Date(this.now()).toISOString();
    let changed = false;
    const remember = () => {
      if (isNew) rec.seen.push(ev.id);
      changed = true;
    };

    switch (ev.type) {
      case 'agent.tool_use':
      case 'agent.mcp_tool_use': {
        if (!isNew) break;
        const tool = toolLabel(ev);
        if (ev.evaluated_permission === 'ask') {
          // Never a card: refused at once (see refuseDraftSend). Not
          // remembered here — only once the refusal has landed.
          const draftId = draftIdOf(ev);
          if (draftId !== null) {
            if (!this.refusing.has(ev.id)) void this.refuseDraftSend(rec, ev.id, tool, draftId, at);
            break;
          }
          remember();
          if (!this.store.data.approvals.some((a) => a.id === ev.id)) {
            const card = describeToolCall(ev);
            const ap: StoredApproval = {
              id: ev.id,
              sessionId: rec.id,
              tool: card.tool,
              kind: card.kind,
              summary: card.summary,
              details: card.details,
              requestedAt: at,
              ...(card.kind === 'text' ? { textTo: textRecipients(ev.input) } : {}),
              decided: null,
            };
            this.store.data.approvals.push(ap);
            this.activity_(rec.id, 'waiting', `Waiting for your OK: ${card.summary}`, { tool, permission: 'ask', at });
            console.log(`[assistant] ${this.pending()} approval(s) waiting — new: ${card.kind} in ${rec.id}`);
          }
        } else if (ev.evaluated_permission === 'deny') {
          remember();
          this.activity_(rec.id, 'tool', `${tool} was refused by Anthropic's safety check — it did not run`, { tool, permission: 'deny', at });
        } else {
          remember();
          this.activity_(rec.id, 'tool', `Used ${tool}`, { tool, permission: 'allow', at });
          // R28: every send and every booking waits for Mike. One that RAN
          // without asking means the agent's permission policy is wrong —
          // after the fact, but named, never silent.
          if (sentWithoutAsking(ev)) {
            this.activity_(rec.id, 'error', `${tool} ran WITHOUT your OK — the agent's permission policy for it is not "always ask". Fix the agent in the Claude Console before it sends again.`, { tool, permission: 'allow', at });
            console.error(`[assistant] WARNING ${rec.id}: ${tool} (${classify(ev.mcp_server_name, ev.name ?? '')}) ran without approval — check the agent's permission policy`);
          }
        }
        break;
      }
      case 'agent.custom_tool_use': {
        if (!isNew) break;
        remember();
        this.activity_(rec.id, 'error', `Asked for a tool Arbo does not have (${ev.name ?? 'unnamed'}) — the session will wait; open ${rec.id} in the Claude Console.`, { at });
        console.error(`[assistant] session ${rec.id} asked for a custom tool Arbo does not run`);
        break;
      }
      case 'user.tool_confirmation': {
        if (!isNew) break;
        remember();
        const a = this.store.data.approvals.find((x) => x.id === ev.tool_use_id);
        if (a && !a.decided && (ev.result === 'allow' || ev.result === 'deny')) {
          // Mike's own decision echoed while decide() still waits for its
          // answer: kept as proof it landed. Otherwise it was answered
          // somewhere else (the Console).
          if (this.deciding.has(a.id)) this.echoed.set(a.id, ev.result);
          else {
            a.decided = { decision: ev.result, at, by: 'elsewhere' };
            this.activity_(rec.id, 'decided', `${ev.result === 'allow' ? 'Allowed' : 'Denied'} outside the app: ${a.summary}`, { tool: a.tool, at });
          }
        }
        break;
      }
      case 'agent.message': {
        if (!isNew) break;
        remember();
        const text = (ev.content ?? []).map((b) => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('').trim();
        if (text) this.activity_(rec.id, 'message', text, { at });
        // The office check's words are also kept on their own for Today —
        // Activity keeps only the newest lines, and clips each at 1,000.
        if (text && rec.trigger === 'office' && rec.key?.startsWith('office:')) {
          this.store.data.officeReport = { day: rec.key.slice('office:'.length), at, text: clip(text, REPORT_LIMIT) };
        }
        break;
      }
      case 'session.error': {
        if (!isNew) break;
        remember();
        const type = ev.error?.type ?? 'error';
        const server = ev.error?.mcp_server_name ? ` (${ev.error.mcp_server_name})` : '';
        this.activity_(rec.id, 'error', `Error: ${type}${server}${ev.error?.message ? ` — ${clip(ev.error.message, 300)}` : ''}`, { at });
        console.error(`[assistant] session ${rec.id} error: ${type}${server}`);
        break;
      }
      case 'session.status_running':
      case 'session.status_rescheduled':
        if (rec.state === 'waiting') {
          rec.state = 'working';
          changed = true;
        }
        break;
      case 'session.status_idle': {
        const why = ev.stop_reason?.type;
        // Only these two finish a session from an idle. Anything else —
        // waiting on Mike, paused at its budget (it resumes on its own when
        // the budget is raised), a reason Arbo does not know — is parked and
        // still watched.
        if (why === 'end_turn' || why === 'retries_exhausted') {
          if (isNew) remember();
          rec.state = why === 'end_turn' ? 'done' : 'error';
          changed = true;
          if (!isNew) break;
          if (why === 'end_turn') {
            this.activity_(rec.id, 'done', `Finished — ${rec.label}`, { at });
            console.log(`[assistant] session ${rec.id} done`);
          } else {
            this.activity_(rec.id, 'error', `Stopped — Anthropic gave up after repeated errors (${rec.label})`, { at });
            console.error(`[assistant] session ${rec.id} stopped: retries_exhausted`);
          }
          break;
        }
        if (rec.state !== 'waiting') {
          rec.state = 'waiting';
          changed = true;
        }
        if (why === 'requires_action' || !isNew) break;
        remember();
        if (why === 'budget_reached') {
          const c = this.cfg();
          this.activity_(rec.id, 'error', `Paused at its $${((c.budgetCents ?? 300) / 100).toFixed(2)} budget (${rec.label}). Raise or remove its budget in the Claude Console and it picks up where it stopped — anything it then asks for shows up here.`, { at });
          console.error(`[assistant] session ${rec.id} paused at its budget — still watched`);
        } else {
          this.activity_(rec.id, 'error', `Paused — it stopped for a reason Arbo does not know (${why ?? 'none given'}) (${rec.label}). Arbo keeps watching it; open ${rec.id} in the Claude Console.`, { at });
          console.error(`[assistant] session ${rec.id} idle (${why ?? 'unknown'}) — still watched`);
        }
        break;
      }
      case 'session.status_terminated':
      case 'session.deleted': {
        if (isNew) remember();
        const wasOpen = !this.finished(rec);
        if (wasOpen) {
          rec.state = ev.type === 'session.deleted' ? 'error' : 'done';
          changed = true;
        }
        if (isNew && wasOpen) {
          this.activity_(rec.id, ev.type === 'session.deleted' ? 'error' : 'done', ev.type === 'session.deleted' ? `The session was deleted at Anthropic (${rec.label})` : `Ended — ${rec.label}`, { at });
          console.log(`[assistant] session ${rec.id} ${ev.type === 'session.deleted' ? 'deleted' : 'ended'}`);
        }
        break;
      }
      default:
        break; // thinking, spans, usage — nothing for Mike
    }
    // Never backwards: a re-attach replays older history.
    if (isNew && (!this.store.data.lastEventAt || at > this.store.data.lastEventAt)) this.store.data.lastEventAt = at;
    if (changed) this.store.save();
    // A session that stopped working frees its slot for the next in the queue.
    if (changed && rec.state !== 'working') void this.pump();
  }
}
