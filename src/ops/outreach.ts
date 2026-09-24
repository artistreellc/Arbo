/*
  SLOW::ARBO — this file sends customer-facing texts. The note at the top of
  src/db/client.ts applies here in full.
*/
// Text outreach via Quo — owner ruling R22 (Mike, 2026-09-24): "set up the
// ability to send texts via quo to have people reach back out to 7573195131
// if they are still intrested in a quote for the past week only and after
// that use the same templet for follow ups".
//
// Two jobs, one template (guardrails.afterHoursAndOverflow.quoteFollowUpText):
//   CATCH-UP  — everyone who reached the Quo line in the past 7 days and has
//               not been texted: one text each. Runs once, on Mike's tap or
//               the ARBO_OUTREACH_CATCHUP=live switch.
//   FOLLOW-UP — from then on, every new inbound inquiry that has not booked
//               an estimate and has not heard from us gets the same text
//               48 hours after their last contact. Hourly, only while
//               ARBO_OUTREACH=live.
//
// LAWS, in the order they are applied to every single text:
//   1. Who: only a number that CONTACTED US (an incoming call or text) —
//      the call-in is the consent basis (compliance.json consentModel).
//      Never a number we only dialed. Never our own numbers.
//   2. STOP is permanent and read from QUO'S OWN RECORD before every send —
//      an in-memory list would forget on redeploy; Quo's message history
//      does not. Same for "already texted": any outgoing message in the
//      last 30 days, from Arbo OR Mike, means no automated text.
//   3. A solicitor or a wrong number, decided ONLY from the caller's own
//      words (never a carrier label — "spam likely calls could be clients",
//      Mike, 2026-09-24). A hang-up stays a possible client.
//   4. The gate: inspectMessage — consent, STOP, 8am–9pm ET quiet hours,
//      no price, no diagnosis, no date promise. A quiet-hours block DEFERS
//      to the next open hour; any other block DROPS the text. Never a
//      pivot line — an outreach text is the template or nothing.
//   5. Never blast: one at a time, spaced. Quo's own refusals (texting not
//      registered, daily cap) pause the whole queue and are named on screen.
// §4.3: logs carry counts, ids and reasons — never a number or the words.
// Numbers appear only in the keywalled app (R17).

import type { Guardrails } from '../config/guardrails.schema.js';
import type { LegalConfig } from '../config/legal.schema.js';
import { inspectMessage } from '../binder/policyEngine.js';
import { clampToQuietHours } from './followUps.js';
import type { QuoApi, QuoCall, QuoMessage } from '../integrations/quo.js';
import type { QuoSender } from '../integrations/quoSend.js';
import type { SonaExtractor } from './quoExtract.js';
import { normalizeCallerId } from '../reception/callMemory.js';

export type SkipReason =
  | 'no_inbound'
  | 'opted_out'
  | 'already_texted'
  | 'not_customer'
  | 'own_number'
  | 'excluded'
  | 'estimate_booked'
  | 'unreadable';

export type CallerClass = 'customer' | 'unclear' | 'solicitor' | 'wrong_number' | 'unreadable';

export interface Candidate {
  conversationId: string;
  /** E.164 — keywalled app only. */
  number: string;
  lastInboundAt: string | null;
  inboundCalls: number;
  inboundTexts: number;
  classification: CallerClass;
  /** null = eligible for a text. */
  skip: SkipReason | null;
}

export interface SendRecord {
  at: string;
  kind: 'catchup' | 'followup';
  number: string;
  conversationId: string;
  outcome: 'sent' | 'refused' | 'blocked';
  /** Reason or rule names — never the words. */
  detail: string;
  messageId: string | null;
  status: string | null;
}

export interface OutreachDeps {
  quo: QuoApi;
  sender: QuoSender | null;
  guardrails: Guardrails;
  legal: LegalConfig;
  extractor: SonaExtractor | null;
  /** Normalized numbers Sona already booked an estimate hold for (QuoIntake). */
  bookedCallers: () => Set<string>;
  /** ARBO_OUTREACH === 'live' — gates AUTOMATIC sends only; Mike's tap is never gated. */
  enabled: () => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  spacingMs?: number;
}

export const CATCHUP_WINDOW_DAYS = 7;
export const FOLLOWUP_MIN_AGE_MS = 48 * 60 * 60 * 1000;
export const DEDUPE_LOOKBACK_DAYS = 30;
/** "Never blast" — one text every 20 seconds. */
export const DEFAULT_SPACING_MS = 20_000;
const FOLLOWUP_EVERY_MS = 60 * 60 * 1000;
/** After Quo refuses the line (not registered / cap), wait before trying again. */
const REFUSAL_PAUSE_MS = 6 * 60 * 60 * 1000;
const RECORD_CAP = 300;
/** Fewer caller words than this is a hang-up, not a conversation. */
const MIN_CALLER_WORDS = 3;
/** Quo's own opt-out vocabulary, as the first word of a text. */
const STOP_WORDS = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\b/i;

const dayMs = 24 * 60 * 60 * 1000;
const iso = (ms: number): string => new Date(ms).toISOString();
const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

export function isStopText(text: string): boolean {
  return STOP_WORDS.test(text);
}

export interface QueuedText {
  kind: 'catchup' | 'followup';
  number: string;
  conversationId: string;
}

export class OutreachEngine {
  private readonly deps: OutreachDeps;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly spacingMs: number;
  private line: { phoneNumberId: string; number: string; own: Set<string> } | null = null;
  private readonly optOuts = new Set<string>();
  private readonly excluded = new Set<string>();
  private queue: QueuedText[] = [];
  private draining: Promise<void> = Promise.resolve();
  private readonly records: SendRecord[] = [];
  private lastCandidates: Candidate[] = [];
  private lastRunAt: string | null = null;
  private lastFollowUpAt = 0;
  private paused: { until: number; reason: string } | null = null;
  private deferredUntil: number | null = null;
  private catchupRan = false;

  constructor(deps: OutreachDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.spacingMs = deps.spacingMs ?? DEFAULT_SPACING_MS;
  }

  /** The Quo line Arbo texts from — learned at boot from Quo, never guessed. */
  setLine(input: { phoneNumberId: string; number: string; ownNumbers: string[] }): void {
    const own = new Set<string>();
    for (const n of [input.number, ...input.ownNumbers]) {
      const norm = normalizeCallerId(n);
      if (norm) own.add(norm);
    }
    this.line = { phoneNumberId: input.phoneNumberId, number: input.number, own };
  }

  template(): string {
    return this.deps.guardrails.afterHoursAndOverflow.quoteFollowUpText;
  }

  /**
   * Is the template itself lawful? Business identity, the opt-out line, and
   * the content rules — checked at a daytime moment so quiet hours cannot
   * mask a content problem. A failing template sends NOTHING, by name.
   */
  verifyTemplate(): { ok: boolean; problems: string[] } {
    const t = this.template();
    const tcpa = this.deps.legal.tcpa;
    const problems: string[] = [];
    if (!t.includes(tcpa.businessIdentityInFirstMessage)) problems.push(`missing business identity "${tcpa.businessIdentityInFirstMessage}"`);
    if (!t.toLowerCase().includes(tcpa.optOut.instructionText.toLowerCase())) problems.push(`missing opt-out line "${tcpa.optOut.instructionText}"`);
    const noon = `${iso(this.now()).slice(0, 10)}T17:00:00Z`; // 1pm EST / noon EDT — inside 8–21 either way
    const verdict = inspectMessage({
      audience: 'customer',
      channel: 'sms',
      text: t,
      guardrails: this.deps.guardrails,
      contact: { consented: true, optedOut: false },
      atIso: noon,
    });
    for (const b of verdict.blocks) problems.push(`${b.rule}: ${b.detail}`);
    return { ok: problems.length === 0, problems };
  }

  /** An inbound text on the Quo line (from the intake). STOP is permanent. */
  noteInbound(t: { from: string | null; body: string }): void {
    const n = normalizeCallerId(t.from ?? undefined);
    if (!n) return;
    if (isStopText(t.body)) {
      this.optOuts.add(n);
      this.queue = this.queue.filter((q) => normalizeCallerId(q.number) !== n);
      console.error(`[outreach] STOP received — opt-outs since deploy: ${this.optOuts.size}`);
    }
  }

  /** A delivery receipt for a text Arbo sent (message.delivered webhook). */
  noteDelivery(messageId: string | null, status: string | null): void {
    if (!messageId) return;
    const r = this.records.find((x) => x.messageId === messageId);
    if (r && status) r.status = status;
  }

  exclude(conversationId: string): void {
    this.excluded.add(conversationId);
    this.queue = this.queue.filter((q) => q.conversationId !== conversationId);
  }

  private record(r: SendRecord): void {
    this.records.unshift(r);
    while (this.records.length > RECORD_CAP) this.records.pop();
  }

  // ─── Who qualifies ────────────────────────────────────────────────────

  private async classifyCalls(participant: string, calls: QuoCall[]): Promise<CallerClass> {
    const sona = calls
      .filter((c) => c.direction === 'incoming' && c.aiHandled === 'ai-agent')
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .slice(0, 2);
    // A person (Mike) answered and Sona never did: he spoke to them — a customer until he says otherwise.
    if (sona.length === 0) return 'customer';
    const norm = normalizeCallerId(participant);
    let sawConversation = false;
    let verdict: CallerClass = 'unclear';
    for (const c of sona) {
      let tr;
      try {
        tr = await this.deps.quo.getCallTranscript(c.id);
      } catch {
        return 'unreadable';
      }
      if (!tr || tr.status !== 'completed' || !tr.dialogue) continue;
      const callerWords = tr.dialogue
        .filter((l) => normalizeCallerId(l.identifier ?? undefined) === norm)
        .reduce((n, l) => n + words(l.content), 0);
      if (callerWords < MIN_CALLER_WORDS) continue; // a hang-up — says nothing either way
      sawConversation = true;
      if (!this.deps.extractor) return 'unreadable';
      const transcript = tr.dialogue
        .map((l) => `${normalizeCallerId(l.identifier ?? undefined) === norm ? 'Caller' : 'Sona'}: ${l.content}`)
        .join('\n');
      try {
        const facts = await this.deps.extractor.extract(transcript);
        const type = facts.callerType ?? 'unclear';
        if (type === 'customer' || facts.wantsEstimate) return 'customer';
        verdict = type;
      } catch {
        return 'unreadable';
      }
    }
    return sawConversation ? verdict : 'unclear';
  }

  private async classify(conversationId: string, participant: string, windowStartMs: number): Promise<Candidate> {
    const line = this.line!;
    const base: Candidate = { conversationId, number: participant, lastInboundAt: null, inboundCalls: 0, inboundTexts: 0, classification: 'unclear', skip: null };
    const norm = normalizeCallerId(participant);
    if (!norm || line.own.has(norm)) return { ...base, skip: 'own_number' };
    let calls: QuoCall[];
    let msgs: QuoMessage[];
    try {
      calls = await this.deps.quo.listCalls({ phoneNumberId: line.phoneNumberId, participant, createdAfterIso: iso(windowStartMs) });
      msgs = await this.deps.quo.listMessages({ phoneNumberId: line.phoneNumberId, participant, createdAfterIso: iso(this.now() - DEDUPE_LOOKBACK_DAYS * dayMs) });
    } catch {
      return { ...base, classification: 'unreadable', skip: 'unreadable' };
    }
    const inCalls = calls.filter((c) => c.direction === 'incoming');
    const inTexts = msgs.filter((m) => m.direction === 'incoming' && (m.createdAt ?? '') >= iso(windowStartMs));
    const lastInboundAt = [...inCalls, ...inTexts].map((x) => x.createdAt ?? '').filter(Boolean).sort().at(-1) ?? null;
    const c: Candidate = { ...base, lastInboundAt, inboundCalls: inCalls.length, inboundTexts: inTexts.length };
    if (msgs.some((m) => m.direction === 'incoming' && isStopText(m.text)) || this.optOuts.has(norm)) {
      this.optOuts.add(norm);
      return { ...c, skip: 'opted_out' };
    }
    if (msgs.some((m) => m.direction === 'outgoing')) return { ...c, skip: 'already_texted' };
    if (inCalls.length === 0 && inTexts.length === 0) return { ...c, skip: 'no_inbound' };
    if (this.deps.bookedCallers().has(norm)) return { ...c, skip: 'estimate_booked' };
    if (this.excluded.has(conversationId)) return { ...c, skip: 'excluded' };
    const classification: CallerClass = inTexts.length > 0 ? 'customer' : await this.classifyCalls(participant, calls);
    if (classification === 'solicitor' || classification === 'wrong_number') return { ...c, classification, skip: 'not_customer' };
    if (classification === 'unreadable') return { ...c, classification, skip: 'unreadable' };
    return { ...c, classification };
  }

  /** Everyone who reached the line in the window, classified. Numbers stay in memory for the keywalled app. */
  async buildCandidates(windowDays = CATCHUP_WINDOW_DAYS): Promise<Candidate[]> {
    if (!this.line) return [];
    const windowStartMs = this.now() - windowDays * dayMs;
    const conversations = await this.deps.quo.listConversations({ phoneNumberId: this.line.phoneNumberId, updatedAfterIso: iso(windowStartMs) });
    const seen = new Set<string>();
    const out: Candidate[] = [];
    for (const conv of conversations) {
      if (conv.participants.length !== 1) continue; // group threads are never auto-texted
      const p = conv.participants[0]!;
      const norm = normalizeCallerId(p) ?? p;
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push(await this.classify(conv.id, p, windowStartMs));
    }
    this.lastCandidates = out;
    this.lastRunAt = iso(this.now());
    const skipped = out.filter((x) => x.skip).length;
    console.error(`[outreach] candidates: ${out.length} seen, ${out.length - skipped} eligible, ${skipped} skipped`);
    return out;
  }

  // ─── Sending ──────────────────────────────────────────────────────────

  private enqueue(kind: QueuedText['kind'], c: Candidate): void {
    if (this.queue.some((q) => q.conversationId === c.conversationId)) return;
    this.queue.push({ kind, number: c.number, conversationId: c.conversationId });
  }

  /** Serial. One text, gate, send, space; a refusal from Quo pauses everything. */
  drain(): Promise<void> {
    this.draining = this.draining.then(() => this.drainNow()).catch((err) => {
      console.error('[outreach] drain failed:', err instanceof Error ? err.message : 'error');
    });
    return this.draining;
  }

  private async drainNow(): Promise<void> {
    if (!this.line) return;
    const line = this.line;
    while (this.queue.length > 0) {
      const nowMs = this.now();
      if (this.paused && this.paused.until > nowMs) return;
      this.paused = null;
      const item = this.queue[0]!;
      const norm = normalizeCallerId(item.number);
      const text = this.template();
      const verdict = inspectMessage({
        audience: 'customer',
        channel: 'sms',
        text,
        guardrails: this.deps.guardrails,
        contact: { consented: true, optedOut: norm ? this.optOuts.has(norm) : false },
        atIso: iso(nowMs),
      });
      if (verdict.blocks.some((b) => b.rule === 'quiet-hours')) {
        // Not dropped — held until the window opens. The tick brings us back.
        const until = clampToQuietHours(this.deps.legal, new Date(nowMs)).getTime();
        if (this.deferredUntil !== until) {
          this.deferredUntil = until;
          console.error(`[outreach] ${this.queue.length} text(s) waiting for quiet hours to end`);
        }
        return;
      }
      this.deferredUntil = null;
      this.queue.shift();
      if (!verdict.allowed || verdict.blocks.length > 0) {
        // An outreach text is the template or nothing — never a pivot line.
        this.record({ at: iso(nowMs), kind: item.kind, number: item.number, conversationId: item.conversationId, outcome: 'blocked', detail: verdict.blocks.map((b) => b.rule).join(', '), messageId: null, status: null });
        continue;
      }
      // Durable pre-send check against Quo's own record: STOP or a text from
      // us (Arbo or Mike) since the candidate list was built.
      let recent: QuoMessage[] = [];
      try {
        recent = await this.deps.quo.listMessages({ phoneNumberId: line.phoneNumberId, participant: item.number, createdAfterIso: iso(nowMs - DEDUPE_LOOKBACK_DAYS * dayMs) });
      } catch {
        this.record({ at: iso(nowMs), kind: item.kind, number: item.number, conversationId: item.conversationId, outcome: 'blocked', detail: 'quo_unreadable_before_send', messageId: null, status: null });
        continue;
      }
      if (recent.some((m) => m.direction === 'incoming' && isStopText(m.text))) {
        if (norm) this.optOuts.add(norm);
        this.record({ at: iso(nowMs), kind: item.kind, number: item.number, conversationId: item.conversationId, outcome: 'blocked', detail: 'opted_out', messageId: null, status: null });
        continue;
      }
      if (recent.some((m) => m.direction === 'outgoing')) {
        this.record({ at: iso(nowMs), kind: item.kind, number: item.number, conversationId: item.conversationId, outcome: 'blocked', detail: 'already_texted', messageId: null, status: null });
        continue;
      }
      if (!this.deps.sender) {
        this.record({ at: iso(nowMs), kind: item.kind, number: item.number, conversationId: item.conversationId, outcome: 'refused', detail: 'no_sender', messageId: null, status: null });
        continue;
      }
      let res = await this.deps.sender.send({ from: line.number, to: item.number, content: text });
      if (!res.ok && res.reason === 'rate_limited') {
        await this.sleep(2_000);
        res = await this.deps.sender.send({ from: line.number, to: item.number, content: text });
      }
      if (res.ok) {
        this.record({ at: iso(nowMs), kind: item.kind, number: item.number, conversationId: item.conversationId, outcome: 'sent', detail: item.kind, messageId: res.id, status: res.status });
        console.error(`[outreach] text sent (${item.kind}) — ${this.records.filter((r) => r.outcome === 'sent').length} sent since deploy`);
      } else {
        this.record({ at: iso(nowMs), kind: item.kind, number: item.number, conversationId: item.conversationId, outcome: 'refused', detail: res.reason, messageId: null, status: null });
        if (res.reason === 'not_registered' || res.reason === 'daily_cap' || res.reason === 'unauthorized' || res.reason === 'subscription_expired') {
          // The line itself is refused — nothing else would go through either.
          this.queue.unshift(item);
          this.paused = { until: nowMs + REFUSAL_PAUSE_MS, reason: res.reason };
          console.error(`[outreach] PAUSED — Quo refused the line: ${res.reason}. ${this.queue.length} text(s) waiting.`);
          return;
        }
      }
      if (this.queue.length > 0) await this.sleep(this.spacingMs);
    }
  }

  /**
   * The past-week catch-up. Mike's tap is never gated; an automatic run
   * (the boot switch) is. Returns what was queued and why the rest was not.
   */
  async runCatchup(trigger: 'mike' | 'auto'): Promise<{ ran: boolean; queued: number; skipped: Record<string, number>; reason?: string }> {
    if (!this.line) return { ran: false, queued: 0, skipped: {}, reason: 'quo_not_wired' };
    const tv = this.verifyTemplate();
    if (!tv.ok) return { ran: false, queued: 0, skipped: {}, reason: `template: ${tv.problems.join('; ')}` };
    if (trigger === 'auto' && this.catchupRan) return { ran: false, queued: 0, skipped: {}, reason: 'already_ran' };
    const candidates = await this.buildCandidates(CATCHUP_WINDOW_DAYS);
    const skipped: Record<string, number> = {};
    let queued = 0;
    for (const c of candidates) {
      if (c.skip) {
        skipped[c.skip] = (skipped[c.skip] ?? 0) + 1;
        continue;
      }
      this.enqueue('catchup', c);
      queued += 1;
    }
    this.catchupRan = true;
    console.error(`[outreach] catch-up (${trigger}): ${queued} queued`);
    void this.drain();
    return { ran: true, queued, skipped };
  }

  /** Hourly: every inquiry older than 48h with no estimate and no text from us. */
  async followUpTick(): Promise<number> {
    if (!this.line || !this.deps.enabled() || !this.verifyTemplate().ok) return 0;
    const candidates = await this.buildCandidates(CATCHUP_WINDOW_DAYS);
    const cutoff = iso(this.now() - FOLLOWUP_MIN_AGE_MS);
    let queued = 0;
    for (const c of candidates) {
      if (c.skip || !c.lastInboundAt || c.lastInboundAt > cutoff) continue;
      this.enqueue('followup', c);
      queued += 1;
    }
    if (queued) console.error(`[outreach] follow-ups: ${queued} queued`);
    void this.drain();
    return queued;
  }

  /** The scheduler's heartbeat: release deferred texts, run follow-ups on the hour. */
  async tick(): Promise<void> {
    if (this.queue.length > 0) await this.drain();
    if (this.deps.enabled() && this.now() - this.lastFollowUpAt >= FOLLOWUP_EVERY_MS) {
      this.lastFollowUpAt = this.now();
      try {
        await this.followUpTick();
      } catch (err) {
        console.error('[outreach] follow-up tick failed:', err instanceof Error ? err.message : 'error');
      }
    }
  }

  candidates(): Candidate[] {
    return [...this.lastCandidates];
  }

  sends(): SendRecord[] {
    return [...this.records];
  }

  status() {
    const t = this.verifyTemplate();
    const sent = this.records.filter((r) => r.outcome === 'sent').length;
    const bySkip: Record<string, number> = {};
    for (const c of this.lastCandidates) if (c.skip) bySkip[c.skip] = (bySkip[c.skip] ?? 0) + 1;
    return {
      wired: this.line !== null,
      fromNumber: this.line?.number ?? null,
      senderPresent: this.deps.sender !== null,
      autoFollowUps: this.deps.enabled(),
      template: { text: this.template(), ok: t.ok, problems: t.problems },
      paused: this.paused ? { until: iso(this.paused.until), reason: this.paused.reason } : null,
      deferredUntil: this.deferredUntil ? iso(this.deferredUntil) : null,
      queued: this.queue.length,
      lastRunAt: this.lastRunAt,
      catchupRan: this.catchupRan,
      candidates: { total: this.lastCandidates.length, eligible: this.lastCandidates.filter((c) => !c.skip).length, skipped: bySkip },
      sent,
      refused: this.records.filter((r) => r.outcome === 'refused').length,
      blocked: this.records.filter((r) => r.outcome === 'blocked').length,
      optOuts: this.optOuts.size,
      note: 'Sends are one at a time, 8am–9pm ET only, never to a number that texted STOP or already heard from us (checked against Quo before every send). In-memory since deploy; Quo holds the durable record.',
    };
  }
}
