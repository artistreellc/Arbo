// R28 (Mike, 2026-10-20): "Make it safe, then set it up" and "put it in the
// arbo app". The business assistant is a Claude Managed Agent that Mike
// creates in the Claude Console from the config he approves. This module is
// Arbo's side of it:
//
//   - STARTS sessions when something arrives: a Quo text, missed call or
//     finished call (one session per item, never two), a sweep every 30
//     minutes 7am–9pm ET, and the crew-route summary at 6:30am ET;
//   - WATCHES each session's events (stream + history, deduped — a dropped
//     stream never loses an event) and turns every call the agent pauses on
//     into an Approval card in the owner app;
//   - SENDS Mike's decision back as user.tool_confirmation — the only event
//     Arbo ever sends into a running session.
//
// What it cannot do: answer a live phone call (Sona/Quo still does), create
// or change the agent, or decide anything for Mike. Every email, text,
// payment, Drive write and calendar booking waits for his tap — that is set
// in the agent's permission policies (always_ask) and surfaces here.
//
// Law it keeps: OFF unless ARBO_AGENT is exactly 'live' (like
// ARBO_DATA_LINKS); a missing key or id is NAMED, never a quiet no-op (§1B);
// logs carry counts and ids only — never a name, number, address or a word
// anyone wrote (§4.3); it never touches Arbo's database (§3 — the links stay
// cut). Customer contact appears only in the keywalled app (R17).

import { assistantEnv } from '../env.js';
import { etOffsetMs, etToday } from '../lib/etDay.js';
import { AssistantApiError, createAnthropicAssistantApi, type AgentEvent, type AssistantApi, type EventStream } from './client.js';
import { classify, clip, describeToolCall, toolLabel, type ApprovalDetail } from './describe.js';
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
const TICK_MS = 60_000;
/** Waits between session-start retries after Anthropic refuses or is unreachable. */
const START_BACKOFF_MS = [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];
/** Waits between stream reconnects; this many quick failures in a row and the session is named lost. */
const RECONNECT_MS = [1_000, 2_000, 5_000, 15_000, 30_000, 60_000, 60_000, 60_000];
/** A stream that stayed open this long before dropping was healthy — the failure count starts over. */
const HEALTHY_STREAM_MS = 60_000;
const NOTE_CAP = 2000;
/** Incoming call states that mean nobody — not Mike, not Sona — picked up. */
const MISSED_STATUSES = new Set(['missed', 'no-answer', 'busy', 'canceled', 'abandoned']);

const ROUTE_MESSAGE = "Prepare each crew's route summary for today and request approval to text it.";
const sweepMessage = (sinceIso: string): string =>
  `Check Gmail (including website form emails) and Quo for anything new since ${sinceIso} that no earlier session handled; handle each, then stop.`;

type Config = ReturnType<typeof assistantEnv>;

export interface AssistantStatus {
  state: 'off' | 'not_set_up' | 'ready' | 'error';
  missing: string[];
  reason: string | null;
  sessionsOpen: number;
  lastEventAt: string | null;
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

/**
 * An email or text that went out, or a Square call that changes money. Drive
 * and calendar are left out on purpose: their read tools share the server and
 * would cry wolf. Square reads ride the same one tool as its writes, so only
 * a write-shaped method counts.
 */
function sentWithoutAsking(ev: AgentEvent): boolean {
  const kind = classify(ev.mcp_server_name, ev.name ?? '');
  if (kind === 'email' || kind === 'text') return true;
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
 * and a finished call's summary or transcript. The message names the item by
 * Quo ids only — the agent reads the words itself, through its Quo tools.
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
      const info: CallInfo = { direction: s(o.direction), conversationId: s(o.conversationId), at: s(o.createdAt) };
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
      return {
        itemKey: `quo:call:${callId}`,
        eventId,
        label: transcript ? 'quo call transcript' : 'quo call summary',
        message: itemMessage(transcript ? "a finished call's transcript" : "a finished call's summary", eventId, [
          ['Call id', callId],
          ['Conversation id', info?.conversationId ?? s(o.conversationId)],
          ['At', info?.at ?? s(o.createdAt) ?? s(e.createdAt)],
          ['Direction', info?.direction ?? null],
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
  private readonly calls = new Map<string, CallInfo>();
  private timer: NodeJS.Timeout | null = null;

  constructor(deps: AssistantDeps = {}) {
    this.cfg = deps.config ?? assistantEnv;
    this.makeApi = deps.makeApi ?? createAnthropicAssistantApi;
    this.store = deps.store ?? new AssistantStore();
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
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
    const base = { missing, sessionsOpen: this.openSessions().length, lastEventAt: this.store.data.lastEventAt };
    if (!c.on) {
      return { state: 'off', reason: 'ARBO_AGENT is not "live" — the assistant is OFF and starts nothing. Set ARBO_AGENT=live in Railway to turn it on.', ...base };
    }
    if (missing.length) {
      return { state: 'not_set_up', reason: `Not set up — missing in Railway: ${missing.join(', ')}. Nothing starts until they are set.`, ...base };
    }
    if (this.store.unreadable) {
      return { state: 'error', reason: `Arbo could not read its assistant store (${this.store.unreadable}). Nothing starts until it can; the file was left untouched.`, ...base };
    }
    if (this.lastApiError) return { state: 'error', reason: this.lastApiError, ...base };
    return {
      state: 'ready',
      reason: this.store.where === 'memory' ? 'Approvals are kept in memory only — the storage disk could not be written, so a redeploy forgets them.' : null,
      ...base,
    };
  }

  /** The 503 every assistant route answers when it cannot serve. */
  private gate(): RouteAnswer | null {
    const c = this.cfg();
    if (!c.on) return { status: 503, body: { error: 'assistant_off' } };
    if (missingNames(c).length) return { status: 503, body: { error: 'assistant_not_set_up' } };
    if (this.store.unreadable) return { status: 503, body: { error: 'unreadable' } };
    return null;
  }

  // ── routes ──

  approvals(): RouteAnswer {
    const g = this.gate();
    if (g) return g;
    const nowMs = this.now();
    const mins = etMinutes(nowMs);
    const quiet = mins < 8 * 60 || mins >= 21 * 60;
    const list: Approval[] = this.store.data.approvals
      .filter((a) => !a.decided)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .map((a) => {
        const details: ApprovalDetail[] = [...a.details];
        // Worked out when Mike looks, not when it was asked: what matters is
        // the time the text would go out.
        if (a.kind === 'text' && quiet) {
          details.push({ label: 'Heads-up', value: `It is ${etClock(nowMs)} ET — outside 8am–9pm. A text to a customer must wait until 8am (TCPA quiet hours); a text to your own crew is fine.` });
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

  async decide(id: string, decision: 'allow' | 'deny', note?: string): Promise<RouteAnswer> {
    const g = this.gate();
    if (g) return g;
    const a = this.store.data.approvals.find((x) => x.id === id);
    if (!a) return { status: 404, body: { error: 'not_found' } };
    if (a.decided || this.deciding.has(id)) return { status: 409, body: { error: 'already_decided' } };
    const api = this.api();
    if (!api) return { status: 503, body: { error: 'assistant_not_set_up' } };
    const cleanNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, NOTE_CAP) : undefined;
    this.deciding.add(id);
    try {
      await api.sendConfirmation(a.sessionId, {
        type: 'user.tool_confirmation',
        tool_use_id: id,
        result: decision,
        ...(decision === 'deny' ? { deny_message: cleanNote ?? 'Mike did not approve this.' } : {}),
      });
    } catch (err) {
      // A session that has truly ended can never take this decision: close
      // the card by name rather than leave it waiting forever. Anything else
      // (a blip, their side) keeps it waiting for another tap.
      const rec = this.store.data.sessions.find((x) => x.id === a.sessionId);
      const gone = rec && this.finished(rec) && err instanceof AssistantApiError && (err.status === 400 || err.status === 404);
      if (gone) {
        this.store.data.approvals = this.store.data.approvals.filter((x) => x.id !== id);
        this.activity_(a.sessionId, 'error', `Closed without sending — the session ended before your decision could reach it: ${a.summary}`, { tool: a.tool });
        this.store.save();
        console.error(`[assistant] decision on ${id} NOT delivered — session ${a.sessionId} has ended (${statusOf(err)}); card closed`);
        return { status: 502, body: { error: 'send_failed', line: 'That session has ended, so nothing was sent and the card is closed. If it still needs doing, it needs doing by hand.' } };
      }
      console.error(`[assistant] decision on ${id} NOT delivered — Anthropic ${statusOf(err)}; it is still waiting`);
      return { status: 502, body: { error: 'send_failed', line: `${apiErrorLine(err)}. Nothing was ${decision === 'allow' ? 'allowed' : 'denied'} — it is still waiting.` } };
    } finally {
      this.deciding.delete(id);
    }
    a.decided = { decision, at: new Date(this.now()).toISOString(), by: 'mike', ...(cleanNote ? { note: cleanNote } : {}) };
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
      const item = quoItemFrom(JSON.parse(rawBody), this.calls);
      if (!item) return;
      this.enqueue({ trigger: 'quo', label: item.label, message: item.message, keys: [item.itemKey, ...(item.eventId ? [`quo:event:${item.eventId}`] : [])] });
    } catch (err) {
      console.error('[assistant] Quo event not read:', err instanceof Error ? err.name : 'error');
    }
  }

  /** Queue a session unless one of its keys was already started or queued. Persisted before anything starts. */
  private enqueue(t: { trigger: Trigger; label: string; message: string; keys: string[] }): boolean {
    const d = this.store.data;
    if (t.keys.some((k) => d.processed.includes(k))) return false;
    d.processed.push(...t.keys);
    const at = new Date(this.now()).toISOString();
    if (d.queue.length >= QUEUE_CAP) {
      this.activity_('', 'error', `Not started — ${QUEUE_CAP} items are already waiting to start (${t.label}). The next sweep checks Gmail and Quo for it.`);
      console.error(`[assistant] queue full — 1 ${t.label} not started (${QUEUE_CAP} waiting)`);
      this.store.save();
      return false;
    }
    const q: QueuedTrigger = { key: t.keys[0]!, trigger: t.trigger, label: t.label, title: `Arbo · ${t.label} · ${at.slice(0, 16)}Z`, message: t.message, queuedAt: at };
    d.queue.push(q);
    this.store.save();
    void this.pump();
    return true;
  }

  /** The clock: the 30-minute sweep (7am–9pm ET) and the 6:30am crew routes. */
  tick(): void {
    if (!this.ready()) return;
    const nowMs = this.now();
    const mins = etMinutes(nowMs);
    const d = this.store.data;
    const day = etToday(new Date(nowMs));
    if (mins >= ROUTE_AT && mins < ROUTE_UNTIL && d.lastRouteDay !== day) {
      d.lastRouteDay = day;
      this.enqueue({ trigger: 'route', label: 'crew routes', message: ROUTE_MESSAGE, keys: [`route:${day}`] });
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
        this.enqueue({ trigger: 'sweep', label: 'sweep', message: sweepMessage(since), keys: [`sweep:${at}`] });
      }
    }
    // enqueue() saved anything it queued; this retries a start that is backing off.
    void this.pump();
  }

  /** Boot: name the state, re-attach to sessions still open, start the clock. */
  start(): void {
    const st = this.status();
    if (st.state === 'off') console.log('[assistant] OFF — ARBO_AGENT is not "live"; nothing starts');
    else if (st.state === 'not_set_up') console.error(`[assistant] NOT SET UP — missing: ${st.missing.join(', ')}; nothing starts`);
    else if (this.store.unreadable) console.error('[assistant] store UNREADABLE — nothing starts; the file was left untouched');
    else {
      const open = this.openSessions();
      console.log(`[assistant] ready — ${open.length} session(s) to re-attach, ${this.pending()} approval(s) waiting, ${this.store.data.queue.length} queued`);
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
          const q = d.queue[0]!;
          let id: string;
          try {
            ({ id } = await api.createSession({
              agentId: cfg.agentId!,
              environmentId: cfg.environmentId!,
              vaultId: cfg.vaultId!,
              budgetCents: cfg.budgetCents!,
              title: q.title,
              metadata: { arbo_trigger: q.trigger, arbo_key: q.key.slice(0, 500) },
              firstMessage: q.message,
            }));
          } catch (err) {
            this.lastApiError = apiErrorLine(err);
            this.startFailures += 1;
            this.retryAt = this.now() + START_BACKOFF_MS[Math.min(this.startFailures - 1, START_BACKOFF_MS.length - 1)]!;
            console.error(`[assistant] could not start a session — Anthropic ${statusOf(err)}; ${d.queue.length} waiting, retry in ${Math.round((this.retryAt - this.now()) / 60_000)} min`);
            break;
          }
          this.lastApiError = null;
          this.startFailures = 0;
          d.queue.shift();
          const rec: SessionRec = { id, trigger: q.trigger, label: q.label, startedAt: new Date(this.now()).toISOString(), state: 'working', seen: [] };
          d.sessions.push(rec);
          this.activity_(id, 'started', `Started — ${q.label}`);
          this.store.save();
          console.log(`[assistant] session ${id} started (${q.label})`);
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
   * a reconnect never loses an event. Reconnects until the session finishes.
   */
  private async runWatch(rec: SessionRec): Promise<void> {
    const seen = new Set(rec.seen);
    let quickFailures = 0;
    while (!this.finished(rec)) {
      const api = this.api();
      if (!api) return; // switched off or unset mid-run: re-attached at the next boot
      const openedAt = this.now();
      let stream: EventStream | null = null;
      try {
        stream = await api.openStream(rec.id);
        this.streams.set(rec.id, stream);
        for await (const ev of api.listEvents(rec.id)) {
          this.handle(rec, ev, seen);
          if (this.finished(rec)) break;
        }
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
      if (quickFailures > RECONNECT_MS.length) {
        this.finish(rec, 'error', `Arbo lost touch with this session after ${quickFailures} tries — open ${rec.id} in the Claude Console. Anything waiting on your OK is still here.`);
        console.error(`[assistant] session ${rec.id} — lost touch after ${quickFailures} reconnects`);
        break;
      }
      await this.sleep(RECONNECT_MS[Math.max(0, quickFailures - 1)] ?? 60_000);
    }
  }

  private finish(rec: SessionRec, state: 'done' | 'error', text: string): void {
    rec.state = state;
    this.activity_(rec.id, state === 'done' ? 'done' : 'error', text);
    this.store.save();
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
        remember();
        const tool = toolLabel(ev);
        if (ev.evaluated_permission === 'ask') {
          if (!this.store.data.approvals.some((a) => a.id === ev.id)) {
            const card = describeToolCall(ev);
            const ap: StoredApproval = { id: ev.id, sessionId: rec.id, tool: card.tool, kind: card.kind, summary: card.summary, details: card.details, requestedAt: at, decided: null };
            this.store.data.approvals.push(ap);
            this.activity_(rec.id, 'waiting', `Waiting for your OK: ${card.summary}`, { tool, permission: 'ask', at });
            console.log(`[assistant] ${this.pending()} approval(s) waiting — new: ${card.kind} in ${rec.id}`);
          }
        } else if (ev.evaluated_permission === 'deny') {
          this.activity_(rec.id, 'tool', `${tool} was refused by Anthropic's safety check — it did not run`, { tool, permission: 'deny', at });
        } else {
          this.activity_(rec.id, 'tool', `Used ${tool}`, { tool, permission: 'allow', at });
          // R28: every send waits for Mike. One that RAN without asking means
          // the agent's permission policy is wrong — after the fact, but named,
          // never silent.
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
        if (a && !a.decided && !this.deciding.has(a.id) && (ev.result === 'allow' || ev.result === 'deny')) {
          a.decided = { decision: ev.result, at, by: 'elsewhere' };
          this.activity_(rec.id, 'decided', `${ev.result === 'allow' ? 'Allowed' : 'Denied'} outside the app: ${a.summary}`, { tool: a.tool, at });
        }
        break;
      }
      case 'agent.message': {
        if (!isNew) break;
        remember();
        const text = (ev.content ?? []).map((b) => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('').trim();
        if (text) this.activity_(rec.id, 'message', text, { at });
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
        if (why === 'requires_action') {
          if (rec.state !== 'waiting') {
            rec.state = 'waiting';
            changed = true;
          }
          break;
        }
        if (isNew) remember();
        rec.state = why === 'end_turn' ? 'done' : 'error';
        changed = true;
        if (!isNew) break;
        if (why === 'end_turn') {
          this.activity_(rec.id, 'done', `Finished — ${rec.label}`, { at });
          console.log(`[assistant] session ${rec.id} done`);
        } else if (why === 'budget_reached') {
          const c = this.cfg();
          this.activity_(rec.id, 'error', `Stopped at its $${((c.budgetCents ?? 300) / 100).toFixed(2)} budget — nothing more runs in this session (${rec.label}). Raise or remove its budget in the Claude Console to let it finish.`, { at });
          console.error(`[assistant] session ${rec.id} stopped at its budget`);
        } else {
          this.activity_(rec.id, 'error', `Stopped — ${why === 'retries_exhausted' ? 'Anthropic gave up after repeated errors' : `it ended (${why ?? 'no reason given'})`} (${rec.label})`, { at });
          console.error(`[assistant] session ${rec.id} stopped: ${why ?? 'unknown'}`);
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
