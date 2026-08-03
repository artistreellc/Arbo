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
// THE ASSISTANT'S JUDGMENT LAYER — docs/VA_TRAINING_BRIEF.md.
//
// "The assistant's hardest job is not answering the phone. It is deciding what
// reaches Mike right now, what waits until the truck stops, and what it
// handles without him."
//
// This module holds the three decisions §3 does not resolve on its own:
//
//   1. THE DEAD-AIR TEST (brief §2.2) — how a robocall gets filtered WITHOUT
//      ever refusing a call. Answer everything; filter after answering.
//   2. THE CAPTURE FLOOR (brief Part 4) — name + callable number + service
//      address. A call that ends without all three is a MISS, and it gets
//      logged as one. §1E: silence is never success.
//   3. THE NOTIFY TIER (brief Part 6) — NOW / when the truck stops / never.
//
// Everything here is pure. No sending, no writing, no I/O — it decides, and
// the caller acts. That keeps the judgment testable and keeps this file
// incapable of doing anything to a customer.

import type { CallIntent, IncidentType } from './intent.js';

// ───────────────────────────── 1. THE DEAD-AIR TEST ─────────────────────────

/**
 * Brief §2.1 is absolute: ANSWER EVERY CALL. A carrier's "Spam Likely" label
 * is not evidence — flyer leads arrive on the CallRail tracking number, and
 * tracking numbers get flagged routinely, so a real customer holding a flyer
 * looks exactly like spam. Filtering happens AFTER answering, never before.
 *
 * This is how a robocall gets dropped without ever refusing a call: greet up
 * to three times, and hang up only after ten seconds of no human voice.
 */
export const DEAD_AIR_MAX_GREETINGS = 3;
export const DEAD_AIR_TIMEOUT_MS = 10_000;

export interface DeadAirState {
  /** Greetings spoken so far. */
  greetings: number;
  /** Milliseconds since the call connected. */
  elapsedMs: number;
  /** True the moment ANY human voice is heard, at any point. */
  heardVoice: boolean;
}

export type DeadAirAction =
  | { action: 'greet'; greetingNumber: number }
  | { action: 'wait' }
  | { action: 'handle_as_live' }
  | { action: 'hang_up'; logAs: 'dead_air'; reason: string };

/**
 * Decide the next move on a connected call with no speech yet.
 *
 * The ordering matters and is deliberate: heardVoice is checked FIRST, before
 * any timer or greeting count. "A caller who speaks at any point in those ten
 * seconds is a live call and gets handled normally, including a slow, elderly,
 * or hesitant caller — those are customers." A timeout must never be able to
 * cut off someone who already spoke.
 */
export function deadAirStep(state: DeadAirState): DeadAirAction {
  if (state.heardVoice) return { action: 'handle_as_live' };

  // Only silence reaches here. Both conditions must be met to hang up: three
  // greetings AND the full ten seconds. Either alone is too eager — a slow
  // caller can easily sit through three quick greetings inside four seconds.
  if (state.greetings >= DEAD_AIR_MAX_GREETINGS && state.elapsedMs >= DEAD_AIR_TIMEOUT_MS) {
    return {
      action: 'hang_up',
      logAs: 'dead_air',
      reason: `no human voice after ${DEAD_AIR_MAX_GREETINGS} greetings and ${Math.round(state.elapsedMs / 1000)}s`,
    };
  }

  if (state.greetings < DEAD_AIR_MAX_GREETINGS) {
    return { action: 'greet', greetingNumber: state.greetings + 1 };
  }
  // Greeted three times, clock not yet run out. Wait it out rather than hang
  // up early — the remaining seconds cost nothing and are the whole margin a
  // hesitant caller gets.
  return { action: 'wait' };
}

// ───────────────────────────── 2. THE CAPTURE FLOOR ─────────────────────────

/**
 * Brief Part 4: "name + callable number + service address. If a call ends
 * without those three, that is a miss, and it gets logged as one."
 *
 * A street with no city is explicitly NOT a bookable address (§5.1): "never
 * dispatch Mike to a street name." So the floor requires a resolved city, not
 * merely some text in the address field.
 */
export interface CaptureState {
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
}

export interface CaptureFloorResult {
  /** True only when all three are present AND the address is bookable. */
  met: boolean;
  /** Which parts of the floor are missing — plain words, for the log. */
  missing: string[];
  /** True when a street was captured but no city resolved (§5.1). */
  addressNotBookable: boolean;
}

/** A number a human could actually ring back. Ten digits, US. */
function isCallable(phone: string | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  // 10 digits, or 11 starting with the US country code.
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

export function checkCaptureFloor(state: CaptureState): CaptureFloorResult {
  const missing: string[] = [];
  if (!state.name?.trim()) missing.push('name');
  if (!isCallable(state.phone)) missing.push('a callable number');

  const hasStreet = Boolean(state.address?.trim());
  const hasCity = Boolean(state.city?.trim());
  // A street with no city is worse than no address, because it LOOKS captured.
  const addressNotBookable = hasStreet && !hasCity;
  if (!hasStreet) missing.push('a service address');
  else if (!hasCity) missing.push('a city for that address');

  return { met: missing.length === 0, missing, addressNotBookable };
}

export interface MissRecord {
  /** Always true — this exists so a miss is never silent (§1E). */
  isMiss: true;
  missing: string[];
  line: string;
}

/**
 * What to log when a call ends. Returns null when the floor was met — there is
 * nothing to report on a good call.
 *
 * A screened solicitation is NOT a miss: brief §3.2 says a solicitor is logged
 * as a solicitation and never becomes a lead, so counting it as a lost lead
 * would corrupt the very number §6O uses to judge marketing.
 */
export function missOnCallEnd(
  state: CaptureState,
  opts: { screenedAsSolicitation?: boolean } = {},
): MissRecord | null {
  if (opts.screenedAsSolicitation) return null;
  const floor = checkCaptureFloor(state);
  if (floor.met) return null;
  return {
    isMiss: true,
    missing: floor.missing,
    line: floor.addressNotBookable
      ? `Call ended without ${floor.missing.join(' and ')}. A street with no city is not bookable — this cannot be dispatched.`
      : `Call ended without ${floor.missing.join(' and ')}. Logged as a miss.`,
  };
}

// ───────────────────────────── 3. THE NOTIFY TIER ───────────────────────────

/**
 * Brief Part 6. Three tiers, and the default when unsure is the MIDDLE one:
 * "the safe default is the batch, with a note that it was borderline. Never
 * the third tier — an unlogged judgment call is invisible, and invisible is
 * how leads die."
 */
export type NotifyTier = 'now' | 'when_the_truck_stops' | 'never';

export interface NotifyInput {
  intent: CallIntent;
  incidentType?: IncidentType;
  /** A hazard to a person, damage, or a job in progress that has gone wrong. */
  hazardToPerson?: boolean;
  /** Power line, permit stop, or a neighbour dispute on an ACTIVE job. */
  activeJobComplication?: boolean;
  /** Mike has personally flagged this customer. */
  customerFlaggedByMike?: boolean;
  /** Money, scope change, reschedule, or a promised callback. */
  needsMikesDecision?: boolean;
  /** A routine confirmation, or a question the knowledge base answered. */
  routine?: boolean;
}

export interface NotifyDecision {
  tier: NotifyTier;
  reason: string;
  /** True when the tier was a default rather than a clear match — logged. */
  borderline: boolean;
}

export function notifyTier(input: NotifyInput): NotifyDecision {
  // NOW — interrupt him whatever he is doing. Checked first, and generously:
  // the cost of a wrong "now" is one interrupted cut. The cost of a wrong
  // "later" is an injury nobody told him about.
  if (input.hazardToPerson) {
    return { tier: 'now', reason: 'hazard to a person', borderline: false };
  }
  if (input.intent === 'emergency') {
    return { tier: 'now', reason: 'emergency call', borderline: false };
  }
  if (input.incidentType === 'injury' || input.incidentType === 'damage') {
    return { tier: 'now', reason: `${input.incidentType} reported`, borderline: false };
  }
  // §3.9: an angry customer asking for the owner goes straight to Mike, and
  // §1.2 forbids the assistant explaining anything personal before he has.
  if (input.incidentType === 'angry' || input.intent === 'wants_human') {
    return { tier: 'now', reason: 'caller is asking for the owner', borderline: false };
  }
  if (input.activeJobComplication) {
    return { tier: 'now', reason: 'complication on an active job', borderline: false };
  }
  if (input.customerFlaggedByMike) {
    return { tier: 'now', reason: 'customer Mike flagged personally', borderline: false };
  }

  // NEVER — handled and logged, but not surfaced. The ONLY two things that
  // qualify are a screened solicitation and a genuinely routine call. This
  // tier is deliberately hard to reach.
  if (input.intent === 'spam') {
    return { tier: 'never', reason: 'solicitation — removed from list and logged', borderline: false };
  }
  if (input.routine === true) {
    return { tier: 'never', reason: 'routine, answered from the knowledge base', borderline: false };
  }

  // WHEN THE TRUCK STOPS — everything else, including every money question.
  if (input.needsMikesDecision) {
    return { tier: 'when_the_truck_stops', reason: 'needs Mike\'s decision', borderline: false };
  }

  // The default. Marked borderline so the judgment is visible rather than
  // silent — an unlogged call is how a lead dies unnoticed.
  return {
    tier: 'when_the_truck_stops',
    reason: 'no clear tier — defaulted to the batch',
    borderline: true,
  };
}

// ─────────────────────── 4. ZERO FINANCIAL AUTHORITY ────────────────────────

/**
 * Brief §1.3. §3 already forbids QUOTING a price; this forbids giving money
 * away, which the brief calls the one that actually leaks: discounts, waived
 * fees, "we'll throw that in", scope add-ons at the quoted number, payment
 * plans, and accepting the customer's version of what was agreed.
 *
 * Every one of these is "that's Mike's call — I'll get it in front of him."
 */
// These patterns are deliberately GENERAL. A first version matched the exact
// phrasings its own tests used — "knock some off", "throw that in" — and a
// live proof walked straight through it with "knock a hundred off" and "throw
// the stump in for free". A money guard that only catches the wording you
// thought of is not a guard.
//
// The bias here is toward blocking. A false positive costs one slightly stiff
// sentence ("that's Mike's call"); a false negative costs the stump.
// OWNER RULING R8, 2026-08-03 — PAYMENT PLANS ARE ALLOWED. Mike: "its
// supposed to be the oposite we can set them up on a payment plan." The VA
// training brief §1.3 lists payment plans as forbidden; Mike says otherwise
// and he owns the business, so there is deliberately NO payment-plan pattern
// below. Do not add one back from reading the brief.
//
// What still holds: ARBO may say a plan is possible, never the TERMS. Amounts,
// instalments and dates are numbers, and §3 no-price already blocks those.
const FINANCIAL_COMMITMENTS: Array<{ re: RegExp; what: string }> = [
  // knock/take/cut ANY amount off — a number, "some", "a bit", nothing at all.
  { re: /\b(discount|(?:knock|take|cut)\b[^.!?]{0,25}\boff\b|cut you a deal)/i, what: 'a discount' },
  { re: /\b(we'?ll work with you|meet you halfway|match (?:that|their|the other))\b/i, what: 'matching or negotiating a figure' },
  // "throw it in", and "throw <anything> in ... for free / no charge / on us".
  {
    re: /\b(waive|no charge|free of charge|won'?t charge|on the house|throw(?:ing)?\s+(?:that|it|those|them)\s+in\b|throw(?:ing)?\b[^.!?]{0,30}\bin\b[^.!?]{0,20}\b(?:free|no charge|on us)\b)/i,
    what: 'waiving a charge',
  },
  // Any first-person commitment to do something at no cost.
  { re: /\b(?:we'?ll|we can|we could|i'?ll|i can)\b[^.!?]{0,40}\bfor free\b/i, what: 'waiving a charge' },
  { re: /\b(while (?:we'?re|he'?s|you'?re) (?:out )?there,? (?:we|he)(?:'ll| can| will))\b/i, what: 'a scope add-on at the quoted figure' },
  { re: /\b(that (?:was|is) included|it includes the stump|includes? the (?:stump|haul|cleanup))\b/i, what: "accepting the customer's version of what was included" },
];

export interface FinancialGuardResult {
  /** True when the line commits the company to money it has not agreed to. */
  blocked: boolean;
  what: string | null;
  /** The line to say instead. Never a figure, never a refusal of the request. */
  sayInstead: string;
}

export const FINANCIAL_DEFERRAL =
  "That's Mike's call — I'll get it in front of him and he'll come back to you on it.";

/**
 * Screen a line the assistant is about to say. Returns blocked=true when it
 * would commit money. This runs on the OUTBOUND line, not the caller's words:
 * a customer asking for a discount is a normal question, and only the
 * assistant agreeing to one is the failure.
 */
export function screenFinancialCommitment(line: string): FinancialGuardResult {
  for (const { re, what } of FINANCIAL_COMMITMENTS) {
    if (re.test(line)) {
      return { blocked: true, what, sayInstead: FINANCIAL_DEFERRAL };
    }
  }
  return { blocked: false, what: null, sayInstead: line };
}
