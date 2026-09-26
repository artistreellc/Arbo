// Sona's calls, learned by Arbo (Mike, 2026-09-24: "im just going to turn call
// forwarding on to quo and let sona handle it for a while while arbo learns
// from it" → "auto do it").
//
// Quo pushes four kinds of event to POST /webhooks/quo: a text arrived, a
// call ended, its transcript is ready, its summary is ready. Arbo verifies
// every delivery, answers 200 at once, and does the work off the request:
//   - checks every line SONA spoke against Mike's rules (the same code guard
//     that polices Arbo's own voice) plus an Opus read for the rules that
//     have no word patterns (dates, credentials, service area);
//   - pulls out what the caller said and files the calendar hold EXACTLY the
//     way Mike files estimates (the shared builder), remembers the caller,
//     and keeps the call record — the same R18 stores Arbo's calls use;
//   - keeps the transcript and Quo's summary for the Calls tab and Today.
// What it never does: send anything, edit a calendar event, or log a
// customer's number or words (§4.3 — ids and counts only).
//
// "Need arbo to start learning from QUO" (Mike, 2026-09-24): webhooks alone
// were not enough — eight Sona calls reached Arbo, were answered 200, and
// were dropped without a word. So (1) every event Arbo does not use is now
// NAMED in the log and on /api/quo, and (2) Arbo also reads Sona's calls
// straight from Quo's own record on a timer (`reconcile`), so a call the
// webhook missed is still learned. A call from BEFORE this process started
// is learned WITHOUT a calendar hold — an earlier deploy may already have
// filed it, and holds are never duplicated or edited.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Guardrails } from '../config/guardrails.schema.js';
import { guardReply } from '../reception/outputGuard.js';
import type { QualState } from '../reception/qualification.js';
import { resolveServiceCity } from '../lib/address.js';
import { CallMemory, CallRecordStore, normalizeCallerId } from '../reception/callMemory.js';
import { buildEstimateHold, type CallHold } from '../reception/estimateHold.js';
import { parseRequestedWindow } from './requestedWindow.js';
import type { SonaCallFacts, SonaExtractor } from './quoExtract.js';
import { verifySvixSignature } from './webhooks.js';
import { QuoHttpError, type QuoApi } from '../integrations/quo.js';

/** Quo signs with a millisecond timestamp; reject anything older than 5 minutes. */
const TOLERANCE_MS = 5 * 60 * 1000;
const CALL_CAP = 150;
/** A caller who said fewer words than this hung up — nothing to extract. */
const MIN_CALLER_WORDS = 3;
/** Quo call states while a call is still live — its transcript cannot exist yet. */
const LIVE_CALL = new Set(['queued', 'initiated', 'ringing', 'in-progress']);
/** Most calls one reconcile pass reads — never a runaway on a busy week. */
const RECONCILE_CAP = 100;
/** A transcript still absent/failed this long after the call will not appear. */
const SETTLE_MS = 30 * 60 * 1000;
/** Quo allows 10 requests a second; reading its record stays well under that. */
const PACE_MS = 150;
/** On Quo's 429, wait and try again — twice — before naming the pass failed. */
const RATE_RETRY_MS = 2_000;

// ─── Signature ────────────────────────────────────────────────────────────

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Verify a Quo delivery against any of Arbo's webhook signing keys. Two
 * schemes exist (Quo docs): the OpenPhone-era header
 * `openphone-signature: hmac;1;<ms timestamp>;<base64 HMAC-SHA256>` over
 * `<timestamp>.<body>` with the base64-decoded key, and Standard Webhooks
 * (`webhook-id` / `webhook-timestamp` / `webhook-signature`). The body is
 * tried raw first, then compact-reserialized, since the legacy scheme signs
 * the payload with whitespace removed.
 */
export function verifyQuoSignature(
  keys: string[],
  headers: Record<string, string | undefined>,
  rawBody: string,
  nowMs: number,
): { ok: boolean; reason: string | null } {
  if (keys.length === 0) return { ok: false, reason: 'not_wired' };
  const legacy = headers['openphone-signature'];
  if (legacy) {
    const [scheme, version, ts, sig] = legacy.split(';');
    if (scheme !== 'hmac' || version !== '1' || !ts || !sig) return { ok: false, reason: 'bad_header' };
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) return { ok: false, reason: 'bad_timestamp' };
    const tsMs = tsNum > 1e12 ? tsNum : tsNum * 1000;
    if (Math.abs(nowMs - tsMs) > TOLERANCE_MS) return { ok: false, reason: 'stale_timestamp' };
    const bodies = [rawBody];
    try {
      const compact = JSON.stringify(JSON.parse(rawBody));
      if (compact !== rawBody) bodies.push(compact);
    } catch {
      /* raw body only */
    }
    for (const key of keys) {
      const k = Buffer.from(key, 'base64');
      for (const b of bodies) {
        const expected = createHmac('sha256', k).update(`${ts}.${b}`).digest('base64');
        if (safeEqual(sig, expected)) return { ok: true, reason: null };
      }
    }
    return { ok: false, reason: 'bad_signature' };
  }
  const sw = { id: headers['webhook-id'], timestamp: headers['webhook-timestamp'], signature: headers['webhook-signature'] };
  if (sw.signature) {
    let last: string | null = 'bad_signature';
    for (const key of keys) {
      const v = verifySvixSignature(key.startsWith('whsec_') ? key : `whsec_${key}`, sw, rawBody, nowMs);
      if (v.ok) return v;
      last = v.reason;
    }
    return { ok: false, reason: last };
  }
  return { ok: false, reason: 'missing_headers' };
}

// ─── Store ────────────────────────────────────────────────────────────────

export interface QuoDialogueLine {
  speaker: 'agent' | 'caller' | 'mike';
  text: string;
}

export type HoldOutcome = 'attempted' | 'no_writer' | 'not_requested' | 'hangup' | 'extraction_unavailable' | 'not_sona' | 'learned_only';

export interface QuoCallEntry {
  callId: string;
  at: string;
  /** Caller number — keywall app UI only (R17), never logs. */
  from: string | null;
  handledBy: 'sona' | 'mike' | 'unknown';
  status: string | null;
  durationSec: number | null;
  dialogue: QuoDialogueLine[];
  summary: string[];
  nextSteps: string[];
  /** Every rule Sona broke, quoted — from the code guard and the Opus read. */
  slips: Array<{ rule: string; said: string }>;
  facts: SonaCallFacts | null;
  hold: HoldOutcome;
  processed: boolean;
  /** Quo's own flag: 'ai-agent' when Sona answered. Trusted over per-line user tags. */
  aiHandled: string | null;
  /** How Arbo got it: pushed by Quo's webhook, or read from Quo's record. */
  source: 'webhook' | 'quo_record';
}

export interface QuoIntakeDeps {
  guardrails: Guardrails;
  extractor: SonaExtractor | null;
  callMemory: CallMemory;
  callRecords: CallRecordStore;
  calendarHold: ((hold: CallHold) => Promise<void>) | null;
  /** Where Quo texts go — the shared Texts list. */
  onText: (t: { at: string; messageSid: string | null; from: string | null; body: string; media: Array<{ url: string; contentType: string | null }> }) => void;
  /** A delivery receipt for a text Arbo sent (R22) — status only. */
  onDelivery?: (messageId: string | null, status: string | null) => void;
  now?: () => number;
  /** Test seam for reconcile's pacing. */
  sleep?: (ms: number) => Promise<void>;
}

interface QuoEvent {
  type?: string;
  data?: { object?: Record<string, unknown> };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
/** A phone number's last 10 digits — so "+17576069432", "17576069432" and "(757) 606-9432" match. */
const tail10 = (v: string | null | undefined): string | null => {
  const d = (v ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
};
/** A Quo call id (AC…) — the fallback when a transcript payload carries it as `id`. */
const callIdOf = (v: unknown): string | null => {
  const s = str(v);
  return s && s.startsWith('AC') ? s : null;
};
const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

export class QuoIntake {
  private readonly deps: QuoIntakeDeps;
  private readonly now: () => number;
  private keys: string[] = [];
  /** Numbers on the Quo account — lines spoken from these are Sona or Mike, not the caller. */
  private ownNumbers = new Set<string>();
  private readonly calls = new Map<string, QuoCallEntry>();
  /** Serial so two events for one call never race the processing. */
  private queue: Promise<void> = Promise.resolve();
  private readonly counters = { received: 0, rejected: 0, lastAt: null as string | null, lastError: null as string | null };
  /** Events verified and then NOT used, by reason — never silence (§1B). */
  private readonly dropped: Record<string, number> = {};
  private readonly bootMs: number;
  private sweep: { lastAt: string | null; learned: number; pending: number; error: string | null; unreadable: string | null } = { lastAt: null, learned: 0, pending: 0, error: null, unreadable: null };
  private registration: { state: 'not_configured' | 'pending' | 'ok' | 'failed'; detail: string } = {
    state: 'not_configured',
    detail: 'No QUO_API_KEY on the server — Sona calls are not reaching Arbo. This is not zero calls.',
  };

  constructor(deps: QuoIntakeDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.bootMs = this.now();
  }

  /** Name an event Arbo verified but did not use. Reason and payload KEY names only — never values (§4.3). */
  private drop(reason: string, keys?: string[]): void {
    this.dropped[reason] = (this.dropped[reason] ?? 0) + 1;
    console.error(`[quo] event not used — ${reason}${keys ? ` (payload keys: ${keys.slice(0, 20).join(',')})` : ''}`);
  }

  setRegistration(state: 'pending' | 'ok' | 'failed', detail: string, keys: string[] = [], ownNumbers: string[] = []): void {
    this.registration = { state, detail };
    if (keys.length) this.keys = keys;
    if (ownNumbers.length) this.ownNumbers = new Set(ownNumbers.map((n) => normalizeCallerId(n) ?? n));
  }

  /** POST /webhooks/quo — verify, answer at once, work off the request. */
  handle(headers: Record<string, string | undefined>, rawBody: string): { status: number; body: unknown } {
    const v = verifyQuoSignature(this.keys, headers, rawBody, this.now());
    if (!v.ok) {
      this.counters.rejected += 1;
      this.counters.lastError = v.reason;
      console.error(`[quo] delivery refused: ${v.reason}`);
      return v.reason === 'not_wired'
        ? { status: 503, body: { error: 'quo_not_wired' } }
        : { status: 401, body: { error: 'signature_rejected', reason: v.reason } };
    }
    let event: QuoEvent;
    try {
      event = JSON.parse(rawBody) as QuoEvent;
    } catch {
      return { status: 400, body: { error: 'bad_json' } };
    }
    this.counters.received += 1;
    this.counters.lastAt = new Date(this.now()).toISOString();
    this.queue = this.queue.then(() => this.apply(event)).catch((err) => {
      // Id-free, text-free: the error class only (§4.3).
      console.error('[quo] event processing failed:', err instanceof Error ? err.message : 'error');
    });
    return { status: 200, body: { ok: true } };
  }

  /** Test seam: resolves when every queued event has been applied. */
  async settled(): Promise<void> {
    await this.queue;
  }

  private entry(callId: string): QuoCallEntry {
    let e = this.calls.get(callId);
    if (!e) {
      e = {
        callId,
        at: new Date(this.now()).toISOString(),
        from: null,
        handledBy: 'unknown',
        status: null,
        durationSec: null,
        dialogue: [],
        summary: [],
        nextSteps: [],
        slips: [],
        facts: null,
        hold: 'not_sona',
        processed: false,
        aiHandled: null,
        source: 'webhook',
      };
      this.calls.set(callId, e);
      while (this.calls.size > CALL_CAP) {
        const oldest = this.calls.keys().next().value;
        if (oldest === undefined) break;
        this.calls.delete(oldest);
      }
    }
    return e;
  }

  private async apply(event: QuoEvent): Promise<void> {
    const o = event.data?.object ?? {};
    switch (event.type) {
      case 'message.received': {
        if (o.direction && o.direction !== 'incoming') return;
        const media = Array.isArray(o.media)
          ? (o.media as Array<Record<string, unknown>>)
              .map((m) => ({ url: str(m.url), contentType: str(m.type) }))
              .filter((m): m is { url: string; contentType: string | null } => m.url !== null && m.url.startsWith('https://'))
          : [];
        this.deps.onText({
          at: str(o.createdAt) ?? new Date(this.now()).toISOString(),
          messageSid: str(o.id),
          from: str(o.from),
          body: str(o.body) ?? str(o.text) ?? '',
          media,
        });
        console.error(`[quo] text received — ${media.length} photo(s)`);
        return;
      }
      case 'message.delivered': {
        // Delivery receipts exist only for texts we sent; tolerate a missing
        // direction the same way message.received does.
        if (o.direction === 'incoming') return;
        this.deps.onDelivery?.(str(o.id), str(o.status));
        return;
      }
      case 'call.completed': {
        const callId = str(o.id);
        if (!callId) return;
        if (o.direction && o.direction !== 'incoming') return;
        const e = this.entry(callId);
        e.from = str(o.from) ?? e.from;
        e.status = str(o.status);
        e.aiHandled = str(o.aiHandled) ?? e.aiHandled;
        e.at = str(o.createdAt) ?? e.at;
        const answered = Date.parse(str(o.answeredAt) ?? '');
        const done = Date.parse(str(o.completedAt) ?? '');
        if (Number.isFinite(answered) && Number.isFinite(done)) e.durationSec = Math.max(0, Math.round((done - answered) / 1000));
        return;
      }
      case 'call.summary.completed': {
        const callId = str(o.callId) ?? callIdOf(o.id);
        if (!callId) return this.drop('summary_without_call_id', Object.keys(o));
        const e = this.entry(callId);
        e.summary = Array.isArray(o.summary) ? o.summary.filter((l): l is string => typeof l === 'string') : e.summary;
        e.nextSteps = Array.isArray(o.nextSteps) ? o.nextSteps.filter((l): l is string => typeof l === 'string') : e.nextSteps;
        return;
      }
      case 'call.transcript.completed': {
        const callId = str(o.callId) ?? (Array.isArray(o.dialogue) ? callIdOf(o.id) : null);
        if (!callId) return this.drop('transcript_without_call_id', Object.keys(o));
        const e = this.entry(callId);
        if (e.processed) return; // Quo retried, or Quo's record got there first
        const tStatus = str(o.status);
        if ((tStatus && tStatus !== 'completed') || !Array.isArray(o.dialogue)) {
          // Not written yet — left unprocessed so reading Quo's record picks it up later.
          return this.drop(`transcript_not_ready:${tStatus ?? 'no_dialogue'}`);
        }
        e.processed = true;
        await this.process(e, o.dialogue as Array<Record<string, unknown>>);
        return;
      }
      default:
        return this.drop(`unhandled_type:${str(event.type) ?? 'none'}`);
    }
  }

  private async process(e: QuoCallEntry, raw: Array<Record<string, unknown>>, opts: { fileHold: boolean; atMs: number } = { fileHold: true, atMs: this.now() }): Promise<void> {
    // Who spoke each line. Lines from the account's own numbers are Sona
    // (no user) or Mike (a user answered); everything else is the caller.
    // Without the number list, Sona greets first, so line one marks her side.
    // When the caller's number is known, THAT decides: their lines are the
    // caller's, every other line (our number, a blank, a number written
    // another way) is our side. A Sona call once came through with none of
    // her lines matching the Quo number and was re-read 78 times, never
    // learned (2026-09-25).
    const callerTail = tail10(e.from);
    const ownTails = new Set([...this.ownNumbers].map((n) => tail10(n)).filter((n): n is string => n !== null));
    const agentTail = ownTails.size ? null : tail10(str(raw[0]?.identifier));
    for (const l of raw) {
      const text = str(l.content);
      if (!text) continue;
      const id = normalizeCallerId(str(l.identifier) ?? undefined);
      const idTail = tail10(str(l.identifier));
      const ours = callerTail ? idTail !== callerTail : idTail !== null && (ownTails.size ? ownTails.has(idTail) : idTail === agentTail);
      // Quo's own call flag wins: on a call Sona answered, our side is Sona
      // even if Quo tags her lines with a user id.
      const speaker: QuoDialogueLine['speaker'] = ours ? (e.aiHandled === 'ai-agent' || !str(l.userId) ? 'agent' : 'mike') : 'caller';
      if (speaker === 'caller' && !e.from && id) e.from = id;
      e.dialogue.push({ speaker, text: text.slice(0, 1000) });
    }
    // Quo's own "Sona answered" flag is the answer when it is there.
    e.handledBy = e.aiHandled === 'ai-agent' ? 'sona' : e.dialogue.some((d) => d.speaker === 'mike') ? 'mike' : e.dialogue.some((d) => d.speaker === 'agent') ? 'sona' : 'unknown';
    if (e.handledBy !== 'sona') {
      e.hold = 'not_sona';
      const n = (sp: QuoDialogueLine['speaker']) => e.dialogue.filter((d) => d.speaker === sp).length;
      const tagged = raw.filter((l) => str(l.userId)).length;
      console.error(`[quo] call kept as notes, not Sona's — handled by ${e.handledBy} (${n('agent')} agent, ${n('mike')} Mike, ${n('caller')} caller line(s); ${tagged} user-tagged; Quo flag ${e.aiHandled ?? 'none'})`);
      return;
    }

    // Rule check, part 1: the same code guard that polices Arbo's own voice.
    for (const d of e.dialogue) {
      if (d.speaker !== 'agent') continue;
      for (const v of guardReply(d.text, this.deps.guardrails).violations) e.slips.push({ rule: v.rule, said: d.text });
    }

    const callerWords = e.dialogue.filter((d) => d.speaker === 'caller').reduce((n, d) => n + words(d.text), 0);
    if (callerWords < MIN_CALLER_WORDS) {
      e.hold = 'hangup';
      console.error(`[quo] sona call processed (${e.source}) — caller hung up, ${e.slips.length} slip(s)`);
      return;
    }
    if (!this.deps.extractor) {
      e.hold = 'extraction_unavailable';
      console.error('[quo] sona call NOT read — no model key; no hold filed (this is not "no estimate")');
      return;
    }
    const transcript = e.dialogue.map((d) => `${d.speaker === 'agent' ? 'Sona' : 'Caller'}: ${d.text}`).join('\n');
    let facts: SonaCallFacts;
    try {
      facts = await this.deps.extractor.extract(transcript);
    } catch (err) {
      e.hold = 'extraction_unavailable';
      console.error('[quo] sona call NOT read — no hold filed:', err instanceof Error ? err.message : 'error');
      return;
    }
    e.facts = facts;
    // Rule check, part 2: the rules with no word patterns (dates, credentials, area).
    for (const said of facts.agentSlips) e.slips.push({ rule: 'opus-read', said: said.slice(0, 500) });

    const city = resolveServiceCity(facts.city);
    const state: QualState = {
      ...(facts.name ? { name: facts.name } : {}),
      ...(facts.address ? { address: facts.address } : {}),
      ...(city ? { city } : {}),
      ...(facts.jobType ? { jobType: facts.jobType } : {}),
      ...(facts.treeDetails ? { treeInfo: facts.treeDetails } : {}),
      ...(facts.powerLines ? { proximityPowerLines: facts.powerLines } : {}),
    };
    const nowMs = opts.atMs;
    const atIso = new Date(nowMs).toISOString();
    const callerId = normalizeCallerId(e.from ?? undefined);
    const window = facts.requestedTime ? parseRequestedWindow(facts.requestedTime, new Date(nowMs)) : null;
    this.deps.callMemory.remember(
      callerId,
      { state, outcomeNote: `sona:${facts.wantsEstimate ? 'estimate' : 'info'}${facts.emergency ? ' emergency' : ''}` },
      atIso,
    );

    if (!facts.wantsEstimate) e.hold = 'not_requested';
    else if (!opts.fileHold) e.hold = 'learned_only';
    else if (!this.deps.calendarHold) e.hold = 'no_writer';
    else {
      e.hold = 'attempted';
      const hold = buildEstimateHold({ state, callerId, window, nowMs, bookedBy: 'Sona (Quo)' });
      void this.deps.calendarHold(hold).catch((err) => {
        console.error('[calendar] sona hold failed:', err instanceof Error ? err.message : 'error');
      });
    }
    this.deps.callRecords.add({
      atIso,
      callerId,
      state,
      intent: 'sona_call',
      emergency: facts.emergency,
      turns: e.dialogue.length,
      ...(window ? { requestedWindow: window.label } : {}),
      calendarHold: e.hold === 'attempted' ? 'attempted' : e.hold === 'not_requested' ? 'not_requested' : 'no_writer',
    });
    console.error(`[quo] sona call processed (${e.source}) — hold ${e.hold}, ${e.slips.length} slip(s)${facts.emergency ? ', EMERGENCY' : ''}`);
  }

  /**
   * Learn from Quo's OWN record: every incoming call on the line in the
   * window that Arbo has not processed (or processed as "not Sona's" while
   * Quo says Sona answered). Serial with the webhook queue, so one call is
   * never processed twice. A call from before this process started is
   * learned without a hold (hold 'learned_only'); a later one the webhook
   * missed is handled exactly as the webhook would have.
   */
  async reconcile(api: QuoApi, phoneNumberId: string, windowMs: number): Promise<{ learned: number; pending: number }> {
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    // Paced, and patient with Quo's rate limit: the boot pass of 2026-09-24
    // hit 429 mid-way and stopped.
    const paced = async <T>(fn: () => Promise<T>): Promise<T> => {
      for (let attempt = 0; ; attempt += 1) {
        await sleep(PACE_MS);
        try {
          return await fn();
        } catch (err) {
          if (!(err instanceof QuoHttpError && err.status === 429) || attempt >= 2) throw err;
          await sleep(RATE_RETRY_MS * (attempt + 1));
        }
      }
    };
    const nowMs = this.now();
    const sinceIso = new Date(nowMs - windowMs).toISOString();
    let learned = 0;
    let pending = 0;
    let examined = 0;
    let unreadable = 0;
    let unreadableWhy: string | null = null;
    try {
      const convs = await paced(() => api.listConversations({ phoneNumberId, updatedAfterIso: sinceIso }));
      for (const conv of convs) {
        if (conv.participants.length !== 1 || examined >= RECONCILE_CAP) continue;
        const participant = conv.participants[0]!;
        const calls = (await paced(() => api.listCalls({ phoneNumberId, participant, createdAfterIso: sinceIso })))
          .filter((c) => c.direction === 'incoming')
          .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
        for (const c of calls) {
          if (examined >= RECONCILE_CAP) break;
          const known = this.calls.get(c.id);
          // Re-read ONLY a webhook entry filed as "not Sona's" when Quo says she
          // answered — once. Never loop on Arbo's own record read.
          const misread = known?.processed && known.source === 'webhook' && known.handledBy !== 'sona' && c.aiHandled === 'ai-agent';
          if (known?.processed && !misread) continue;
          examined += 1;
          if (LIVE_CALL.has(c.status ?? '')) {
            pending += 1;
            continue;
          }
          let tr: Awaited<ReturnType<QuoApi['getCallTranscript']>>;
          try {
            tr = await paced(() => api.getCallTranscript(c.id));
          } catch (err) {
            // One unreadable call is skipped and counted — it never stops the
            // pass (a 404 on one transcript did, 78 times, 2026-09-25). A rate
            // limit still stops it: no hammering Quo.
            if (err instanceof QuoHttpError && err.status === 429) throw err;
            unreadable += 1;
            unreadableWhy = err instanceof Error ? err.message : 'error';
            continue;
          }
          const atMs = Date.parse(c.createdAt ?? '') || nowMs;
          if (!tr || tr.status !== 'completed' || !tr.dialogue) {
            const settled = nowMs - atMs > SETTLE_MS && (!tr || tr.status === 'absent' || tr.status === 'failed');
            if (!settled) {
              pending += 1; // still being written — tried again next pass
              continue;
            }
            // Quo will never write this one: a call too short to transcribe
            // (absent) or one Quo failed on — kept and NAMED, not skipped.
            const e = this.entry(c.id);
            Object.assign(e, {
              at: c.createdAt ?? e.at, from: participant, status: c.status, aiHandled: c.aiHandled, source: 'quo_record', processed: true,
              handledBy: c.aiHandled === 'ai-agent' ? 'sona' : 'unknown',
              hold: tr?.status === 'failed' ? 'extraction_unavailable' : 'hangup',
            });
            learned += 1;
            continue;
          }
          const dialogue = tr.dialogue.map((l) => ({ identifier: l.identifier, content: l.content, userId: l.userId }));
          this.queue = this.queue.then(async () => {
            const e = this.entry(c.id);
            if (e.processed && !(e.source === 'webhook' && e.handledBy !== 'sona' && c.aiHandled === 'ai-agent')) return;
            Object.assign(e, { at: c.createdAt ?? e.at, from: participant, status: c.status, aiHandled: c.aiHandled, source: 'quo_record', processed: true, dialogue: [], slips: [], facts: null, handledBy: 'unknown' });
            await this.process(e, dialogue, { fileHold: atMs >= this.bootMs, atMs });
            learned += 1;
          }).catch((err) => {
            // Never leave the shared queue rejected — the next webhook must still run.
            console.error('[quo] learning one call from Quo\'s record failed:', err instanceof Error ? err.message : 'error');
          });
        }
      }
      await this.queue;
      this.sweep = { lastAt: new Date(nowMs).toISOString(), learned: this.sweep.learned + learned, pending, error: null, unreadable: unreadable ? `${unreadable} call(s) could not be read (${unreadableWhy})` : null };
      if (learned || pending || unreadable) console.error(`[quo] read Quo's record — learned ${learned} call(s), ${pending} not ready yet, ${unreadable} unreadable`);
    } catch (err) {
      const why = err instanceof Error ? err.message : 'error';
      this.sweep = { ...this.sweep, lastAt: new Date(nowMs).toISOString(), error: why };
      console.error(`[quo] reading Quo's record FAILED — ${why}. Calls the webhook missed are not being learned.`);
    }
    return { learned, pending };
  }

  /** Newest first, for the app (keywall). */
  list(): QuoCallEntry[] {
    return [...this.calls.values()].reverse();
  }

  status() {
    const all = [...this.calls.values()];
    const sona = all.filter((c) => c.handledBy === 'sona');
    return {
      registration: this.registration,
      reading: Boolean(this.deps.extractor),
      received: this.counters.received,
      rejected: this.counters.rejected,
      lastAt: this.counters.lastAt,
      lastError: this.counters.lastError,
      sonaCalls: sona.length,
      slips: sona.reduce((n, c) => n + c.slips.length, 0),
      callsWithSlips: sona.filter((c) => c.slips.length > 0).length,
      holdsAttempted: sona.filter((c) => c.hold === 'attempted').length,
      hangups: sona.filter((c) => c.hold === 'hangup').length,
      learnedFromRecord: all.filter((c) => c.source === 'quo_record').length,
      notUsed: { ...this.dropped },
      quoRecord: { ...this.sweep },
    };
  }
}
