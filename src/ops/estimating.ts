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
// The estimating & rate engine (brief §6J2) — build the number in the yard.
// INTERNAL ONLY: nothing this module produces is ever quoted, texted, or
// spoken to a customer (§6J2.5); the API route lives behind the admin key and
// every result carries internalOnly:true so no downstream surface can forget.
//
// The core correction (§6J2.2/6J2.3): the job is truck-arrival → arrival at
// the NEXT job. Windshield time is a job cost. The leakage line (§6J2.4) is
// re-derived from actual logged events — never a fixed markup.

export interface RateTargets {
  removalRatePerHr: number;   // $1,000/hr target (§6J2.1)
  pruningRatePerHr: number;   // $700/hr target
  dayFloor: number;           // $5,000/day base floor
  baseCrewSize: number;       // the 5-man crew the floor assumes
  billableHoursPerDay: number; // ~5 truly billable hours in a real day
}

export const defaultTargets: RateTargets = {
  removalRatePerHr: 1000,
  pruningRatePerHr: 700,
  dayFloor: 5000,
  baseCrewSize: 5,
  billableHoursPerDay: 5,
};

export interface QuoteCheckInput {
  jobType: 'removal' | 'pruning' | 'other';
  /** Predicted truck-to-truck hours — arrival here to arrival at the next job. */
  truckToTruckHours: number;
  crewSize: number;
  quotedPrice: number;
  /** Direct per-job costs Mike already knows. */
  equipmentCost?: number;
  dumpFees?: number;
  materials?: number;
  /** Fully-loaded labor $/man-hour (wages + burden). */
  loadedLaborPerManHour: number;
  /** Leakage load as a fraction of revenue, re-derived from actuals (see leakagePct). */
  leakagePct: number;
}

export interface QuoteCheckResult {
  internalOnly: true;
  effectiveRatePerHr: number;
  targetRatePerHr: number;
  laborCost: number;
  directCosts: number;
  leakageLoad: number;
  allInCost: number;
  margin: number;
  dayFloorEquivalent: number;
  verdict: 'ON_TARGET' | 'BELOW_TARGET' | 'LOSES_MONEY';
  drivers: string[];
}

/**
 * The yard check. Pure math over stated inputs — when a number is missing it
 * is treated as zero and NAMED in drivers, never invented (§1B).
 */
export function quoteCheck(input: QuoteCheckInput, targets: RateTargets = defaultTargets): QuoteCheckResult {
  const drivers: string[] = [];
  const hours = Math.max(0.25, input.truckToTruckHours);

  const target =
    input.jobType === 'removal' ? targets.removalRatePerHr :
    input.jobType === 'pruning' ? targets.pruningRatePerHr :
    targets.dayFloor / targets.billableHoursPerDay;

  const effective = input.quotedPrice / hours;

  const laborCost = hours * input.crewSize * input.loadedLaborPerManHour;
  const directCosts = (input.equipmentCost ?? 0) + (input.dumpFees ?? 0) + (input.materials ?? 0);
  if (input.equipmentCost === undefined) drivers.push('equipment cost not captured — treated as $0');
  if (input.dumpFees === undefined) drivers.push('dump fees not captured — treated as $0');

  const leakageLoad = input.quotedPrice * input.leakagePct;
  const allInCost = laborCost + directCosts + leakageLoad;
  const margin = input.quotedPrice - allInCost;

  // What this quote implies for a full day at this pace, vs the floor. The
  // $5,000 floor assumes the 5-man crew (§6J2.1) — a smaller crew's day costs
  // less and may honestly gross less, so the floor scales with crew size.
  const dayFloorEquivalent = effective * targets.billableHoursPerDay;
  const scaledFloor = targets.dayFloor * (input.crewSize / targets.baseCrewSize);

  if (effective < target) {
    drivers.push(`effective $${Math.round(effective)}/hr is under the $${target}/hr ${input.jobType} target`);
  }
  if (dayFloorEquivalent < scaledFloor) {
    drivers.push(`a day at this pace grosses ~$${Math.round(dayFloorEquivalent)} — under the $${Math.round(scaledFloor)} floor for a ${input.crewSize}-man crew`);
  }
  if (input.crewSize > targets.baseCrewSize) {
    drivers.push(`crew of ${input.crewSize} is larger than the ${targets.baseCrewSize}-man baseline the floor assumes`);
  }
  if (leakageLoad > 0) {
    drivers.push(`leakage load $${Math.round(leakageLoad)} (${(input.leakagePct * 100).toFixed(1)}% re-derived from actuals)`);
  }

  const verdict: QuoteCheckResult['verdict'] =
    margin < 0 ? 'LOSES_MONEY' :
    effective < target || dayFloorEquivalent < scaledFloor ? 'BELOW_TARGET' :
    'ON_TARGET';

  return {
    internalOnly: true,
    effectiveRatePerHr: round2(effective),
    targetRatePerHr: target,
    laborCost: round2(laborCost),
    directCosts: round2(directCosts),
    leakageLoad: round2(leakageLoad),
    allInCost: round2(allInCost),
    margin: round2(margin),
    dayFloorEquivalent: round2(dayFloorEquivalent),
    verdict,
    drivers,
  };
}

/**
 * Re-derive the leakage percentage from logged actuals (§6J2.4): total leakage
 * cost over the window divided by revenue baseline. Returns the DEFAULT ~8%
 * with a named reason when there is not enough data to derive honestly.
 */
export function deriveLeakagePct(params: {
  leakageTotal: number | null;
  revenueTotal: number | null;
}): { pct: number; basis: 'derived' | 'default_insufficient_data' } {
  const { leakageTotal, revenueTotal } = params;
  if (leakageTotal === null || revenueTotal === null || revenueTotal <= 0) {
    return { pct: 0.08, basis: 'default_insufficient_data' };
  }
  // Clamp to a sane band: a single freak week must not poison every bid.
  const raw = leakageTotal / revenueTotal;
  return { pct: Math.min(0.2, Math.max(0, raw)), basis: 'derived' };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
