/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  Owner instruction from Mike, 2026-08-03. This is not decoration and it
  is not optional. It is here because this is the point in a build where
  things get broken by moving fast, and that already happened to him once
  on the website. It does not happen here.
  ═══════════════════════════════════════════════════════════════════════

  SLOW DOWN. DRASTICALLY. Then:

  1. READ EVERY LINE BEFORE YOU EDIT ONE. Every line, every letter,
     slowly. You are not skimming to find the spot to change — you are
     building a model of what this file already does. If you cannot say
     what the code above and below your edit does, you have not read it.

  2. AN AUDIT IS READ-ONLY. If you were asked to audit, you do not edit.
     You do not "fix it while you are in there." You do not refactor, or
     tidy, or rename. You READ, and you REPORT. Editing during an audit
     is disobeying the instruction, full stop.

  3. THINK BEFORE YOU TYPE. What does this already handle? What depends
     on it? What breaks downstream? Recognise the PATTERN before you call
     something a bug — most things in here that look wrong are a
     deliberate correction. Check docs/OWNER_RULINGS.md first. Use what
     you already know about this codebase instead of re-deciding it.

  4. BRING IT TO MIKE — DO NOT DECIDE IT. Anything that looks wrong,
     ambiguous, or outside what was asked: say it and WAIT. Flagging
     costs one sentence. Deciding on his behalf has cost real work and
     real money more than once.

  5. DO EXACTLY WHAT WAS ASKED. Not the adjacent thing. Not the bigger
     thing you thought of on the way. Not the cleanup. Exactly what was
     asked, and nothing else.

  If you are moving fast right now, you are already off the rails.

  Remember the marker: SLOW::ARBO
*/
// CALL MEMORY — the learning R18 turned ON, scoped exactly as Mike scoped
// it: conversation and pattern recognition, nothing else. What lives here is
// DATA the receptionist consults (who called before, what is already on
// file); it can never write code, prompts, guardrails, or anything in the
// app — there is no method here that could.
//
// In-memory and bounded: a redeploy forgets, and the greeting note the model
// receives says only what is genuinely on file. The note is conclusion-only
// in spirit (R15's discipline): it hands the model facts to CONFIRM with the
// caller, and explicitly forbids inventing beyond them.

import type { QualState } from './qualification.js';

export interface CallerRecord {
  /** Normalized caller number — the key. Never logged (§4.3). */
  callerId: string;
  calls: number;
  firstCallIso: string;
  lastCallIso: string;
  name?: string;
  address?: string;
  city?: string;
  zip?: string;
  /** Job types heard across calls, newest last, deduped. */
  jobTypes: string[];
  /** One line about how the last call ended — internal, redaction-free zone (keywall only). */
  lastOutcomeNote?: string;
}

const CALLERS_CAP = 500;

/** A caller id is a phone number; anything else is not remembered. */
export function normalizeCallerId(raw: string | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  return /^\+?\d{7,15}$/.test(digits) ? digits : null;
}

export class CallMemory {
  /** Insertion-ordered for LRU-ish eviction: re-set on every remember. */
  private readonly map = new Map<string, CallerRecord>();

  recall(callerId: string | null): CallerRecord | null {
    if (!callerId) return null;
    return this.map.get(callerId) ?? null;
  }

  /** Merge one finished call into the record. New facts win; absence never erases. */
  remember(
    callerId: string | null,
    call: { state: QualState; zip?: string; outcomeNote?: string },
    nowIso: string,
  ): void {
    if (!callerId) return;
    const prev = this.map.get(callerId);
    const rec: CallerRecord = prev
      ? { ...prev, calls: prev.calls + 1, lastCallIso: nowIso }
      : { callerId, calls: 1, firstCallIso: nowIso, lastCallIso: nowIso, jobTypes: [] };
    const s = call.state;
    if (s.name) rec.name = s.name;
    if (s.address) rec.address = s.address;
    if (s.city) rec.city = s.city;
    if (call.zip) rec.zip = call.zip;
    if (s.jobType && !rec.jobTypes.includes(s.jobType)) rec.jobTypes = [...rec.jobTypes, s.jobType];
    if (call.outcomeNote) rec.lastOutcomeNote = call.outcomeNote;
    this.map.delete(callerId);
    this.map.set(callerId, rec);
    while (this.map.size > CALLERS_CAP) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

/** One finished call, as kept for Mike (R18: "she needs to be keeping a record"). */
export interface CallRecordEntry {
  atIso: string;
  /** Caller number — keywall-only surface (R17 boundary), never logs. */
  callerId: string | null;
  state: QualState;
  zip?: string;
  intent: string;
  emergency: boolean;
  turns: number;
  /** What the caller asked for, when a window was parseable. */
  requestedWindow?: string;
  /**
   * Whether a calendar hold was ATTEMPTED for this call. 'attempted' means
   * fired, not confirmed — the insert is async and a failure lands in the
   * server log, not back in this record. Honest label over a pleasing one.
   */
  calendarHold: 'attempted' | 'no_writer';
}

const RECORDS_CAP = 200;

export class CallRecordStore {
  private readonly list_: CallRecordEntry[] = [];

  add(entry: CallRecordEntry): void {
    this.list_.unshift(entry);
    while (this.list_.length > RECORDS_CAP) this.list_.pop();
  }

  list(): CallRecordEntry[] {
    return [...this.list_];
  }
}

/**
 * The line the model gets when a known number calls back. Facts to CONFIRM,
 * never to assert cold — a shared number (spouse, office line) means the
 * voice on the phone may not be the person on file, so the model is told to
 * check, not declare. And it must never recite the number itself.
 */
export function repeatCallerNote(rec: CallerRecord | null): string | null {
  if (!rec || rec.calls < 1) return null;
  const facts: string[] = [];
  if (rec.name) facts.push(`name on file: ${rec.name}`);
  if (rec.address) facts.push(`property on file: ${rec.address}${rec.city ? ', ' + rec.city : ''}`);
  if (rec.jobTypes.length > 0) facts.push(`prior interest: ${rec.jobTypes.join(', ')}`);
  return (
    `REPEAT CALLER: this number has called ${rec.calls} time(s) before` +
    (facts.length ? ` — ${facts.join('; ')}` : '') +
    `. Greet them like the returning customer they are. CONFIRM what is on file instead of re-asking it ` +
    `("still at [address]?"), but verify you are talking to the same person before assuming. ` +
    `Never invent details beyond these, and never read their phone number back to them.`
  );
}
