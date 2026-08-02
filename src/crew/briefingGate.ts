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
