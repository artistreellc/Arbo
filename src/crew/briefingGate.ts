/*
  ═══════════════════════════════════════════════════════════════════════
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
*/
// The gated morning safety briefing (brief §6V.4, CREW_SYSTEM_SPEC §5) — the
// OSHA-defensible attendance trail. Three conditions, ALL required before GO
// unlocks the day: scrolled to the bottom, top checkbox ticked, and a
// realistic read-timer elapsed (length-scaled ~10–15s).
//
// The gate is pure logic so it is testable and identical on every surface;
// the UI reports facts (scrolled / checked / seconds elapsed), the gate
// decides. A briefing can never be skippable (§6V.4, CREW spec §8).
//
// Acknowledgment writes a TRAINING EVENT with a payable TIME ENTRY (§4.6):
// briefing time is compensable — that is wage law, not a preference.

export interface BriefingContent {
  id: string;
  /** Full text as the crew will read it (drives the read-timer floor). */
  body: string;
  /** Clause-level citations only — standard text is never reproduced (§6U.3). */
  standardRefs: string[];
}

export interface GateState {
  scrolledToBottom: boolean;
  checkboxTicked: boolean;
  secondsOnScreen: number;
}

export interface GateVerdict {
  unlocked: boolean;
  /** Named blockers, in the order the crew should resolve them. */
  missing: Array<'scroll' | 'checkbox' | 'read_time'>;
  requiredSeconds: number;
}

/** Words per second a fast reader manages on a phone in the field. */
const WORDS_PER_SECOND = 4;
const MIN_SECONDS = 10;
/** Ceiling on payable minutes for ONE acknowledgment (see buildAcknowledgment). */
export const MAX_ACK_MINUTES = 15;
const MAX_SECONDS = 15;

/** Length-scaled read floor: never under 10s, never a punitive wait over 15s. */
export function requiredReadSeconds(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  const scaled = Math.ceil(words / WORDS_PER_SECOND);
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, scaled));
}

/** The gate. All three conditions or the day stays locked. */
export function evaluateGate(content: BriefingContent, state: GateState): GateVerdict {
  const requiredSeconds = requiredReadSeconds(content.body);
  const missing: GateVerdict['missing'] = [];
  if (!state.scrolledToBottom) missing.push('scroll');
  if (!state.checkboxTicked) missing.push('checkbox');
  if (!(state.secondsOnScreen >= requiredSeconds)) missing.push('read_time');
  return { unlocked: missing.length === 0, missing, requiredSeconds };
}

export interface AcknowledgmentRecord {
  crewMemberId: string;
  itemIds: string[];
  context: 'tailgate_ack';
  startedAtIso: string;
  completedAtIso: string;
  /** Minutes of PAYABLE time this acknowledgment earned (§4.6). */
  payableMinutes: number;
}

/**
 * Build the acknowledgment record for a passed gate. Throws if the gate did
 * NOT pass — a record can never exist for a skipped briefing (that record is
 * the OSHA evidence; a false one is worse than none).
 */
export function buildAcknowledgment(params: {
  content: BriefingContent;
  state: GateState;
  crewMemberId: string;
  startedAtIso: string;
  completedAtIso: string;
}): AcknowledgmentRecord {
  const verdict = evaluateGate(params.content, params.state);
  if (!verdict.unlocked) {
    throw new Error(`briefing not acknowledged: missing ${verdict.missing.join(',')}`);
  }
  const elapsedMs = Date.parse(params.completedAtIso) - Date.parse(params.startedAtIso);
  // Never round paid time to zero — and never let a client-supplied span mint
  // a fraudulent one: the gate itself tops out at 15 seconds of required
  // reading, so anything past a few minutes is a bad clock or a bad actor.
  const minutes = Math.min(MAX_ACK_MINUTES, Math.max(1, Math.ceil(elapsedMs / 60_000)));
  return {
    crewMemberId: params.crewMemberId,
    itemIds: [params.content.id],
    context: 'tailgate_ack',
    startedAtIso: params.startedAtIso,
    completedAtIso: params.completedAtIso,
    payableMinutes: minutes,
  };
}
