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
// Area and campaign performance (brief §6D, §6N.3).
//
// This is the surface most likely to produce a confident lie, so it is built
// defensively. Three rules, all of them §1B applied to statistics:
//
//   §6N.3  A rate is computed AFTER controlling for job factors, never as a
//          naive average. A neighbourhood of big removals will out-earn a
//          neighbourhood of small prunings per job no matter how well either
//          was priced — comparing raw totals rewards job MIX, not performance.
//
//   Small samples do not get an answer. Three jobs is an anecdote. An area
//   below the floor is reported as NOT ENOUGH DATA, never as a low performer
//   and never as a high one — because acting on either is the same mistake.
//
//   Attribution absent is not attribution zero. A campaign with no tracking
//   number cannot have a cost-per-job, and saying "0 jobs" about it would
//   read as "it failed" when the truth is "we never measured it".

export interface AreaJobFact {
  jobId: string;
  areaKey: string;
  /** Truck-to-truck hours actually worked. */
  hours: number;
  crewSize: number;
  /** What the customer paid (or agreed to). Never Arbo's number. */
  revenue: number;
  jobType: 'removal' | 'pruning' | 'other';
}

/** Below this, an area gets no verdict at all. */
export const MIN_JOBS_FOR_VERDICT = 5;

export type AreaVerdict = 'above' | 'at' | 'below' | 'not_enough_data';

export interface AreaResult {
  areaKey: string;
  jobs: number;
  /** Revenue per CREW-HOUR: the §6N.3 control for job size and crew scale. */
  normalizedRatePerCrewHour: number | null;
  /** Raw revenue per job. Shown for context, never used for the verdict. */
  rawRevenuePerJob: number | null;
  /** How this area compares to the normalized fleet-wide rate. */
  verdict: AreaVerdict;
  /** Plain line for the admin surface. */
  line: string;
  /** The mix, so a verdict can always be sanity-checked against it. */
  mix: Record<string, number>;
}

export interface AreaReport {
  areas: AreaResult[];
  /** The normalized benchmark every verdict is measured against. */
  fleetRatePerCrewHour: number | null;
  /** Areas held back for thin data, so they are visible but unjudged. */
  withheld: string[];
  blindSpots: string[];
}

/** How far from the benchmark counts as genuinely above or below. */
const BAND = 0.12;

function crewHours(f: AreaJobFact): number {
  return f.hours * Math.max(1, f.crewSize);
}

/**
 * Rank areas on a normalized rate. Deliberately conservative: an area with a
 * thin sample is listed and NOT judged, and the job mix rides along so a
 * verdict can never be read without the context that produced it.
 */
export function buildAreaReport(facts: AreaJobFact[]): AreaReport {
  const blindSpots: string[] = [];
  // A job with no hours cannot be normalized. Dropping it silently would
  // quietly bias the benchmark toward whoever fills in timesheets.
  const usable = facts.filter((f) => f.hours > 0 && f.revenue > 0);
  const unusable = facts.length - usable.length;
  if (unusable > 0) {
    blindSpots.push(`${unusable} job(s) had no hours or no revenue on file and could not be normalized — they are excluded, not counted as zero.`);
  }
  if (usable.length === 0) {
    return { areas: [], fleetRatePerCrewHour: null, withheld: [], blindSpots: [...blindSpots, 'No usable job data — no area can be rated.'] };
  }

  const fleetRevenue = usable.reduce((s, f) => s + f.revenue, 0);
  const fleetCrewHours = usable.reduce((s, f) => s + crewHours(f), 0);
  const fleetRate = fleetCrewHours > 0 ? fleetRevenue / fleetCrewHours : null;

  const byArea = new Map<string, AreaJobFact[]>();
  for (const f of usable) {
    const list = byArea.get(f.areaKey) ?? [];
    list.push(f);
    byArea.set(f.areaKey, list);
  }

  const withheld: string[] = [];
  const areas: AreaResult[] = [];

  for (const [areaKey, rows] of byArea) {
    const mix: Record<string, number> = {};
    for (const r of rows) mix[r.jobType] = (mix[r.jobType] ?? 0) + 1;

    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const ch = rows.reduce((s, r) => s + crewHours(r), 0);
    const rate = ch > 0 ? Math.round((revenue / ch) * 100) / 100 : null;
    const rawPerJob = Math.round((revenue / rows.length) * 100) / 100;

    if (rows.length < MIN_JOBS_FOR_VERDICT) {
      withheld.push(areaKey);
      areas.push({
        areaKey, jobs: rows.length, normalizedRatePerCrewHour: rate, rawRevenuePerJob: rawPerJob,
        verdict: 'not_enough_data',
        line: `${rows.length} job(s) — too few to rate. This is not a good area or a bad one; it is an unmeasured one.`,
        mix,
      });
      continue;
    }

    let verdict: AreaVerdict = 'at';
    if (rate !== null && fleetRate) {
      const delta = (rate - fleetRate) / fleetRate;
      verdict = delta > BAND ? 'above' : delta < -BAND ? 'below' : 'at';
    }
    const pct = rate !== null && fleetRate ? Math.round(((rate - fleetRate) / fleetRate) * 100) : 0;
    areas.push({
      areaKey, jobs: rows.length, normalizedRatePerCrewHour: rate, rawRevenuePerJob: rawPerJob,
      verdict,
      line: verdict === 'at'
        ? `${rows.length} jobs, in line with the fleet rate.`
        : `${rows.length} jobs, ${Math.abs(pct)}% ${verdict === 'above' ? 'above' : 'below'} the fleet rate per crew-hour.`,
      mix,
    });
  }

  // Best first among the judged; unjudged areas always sort last so they can
  // never be mistaken for the bottom of the ranking.
  areas.sort((a, b) => {
    const aJudged = a.verdict !== 'not_enough_data';
    const bJudged = b.verdict !== 'not_enough_data';
    if (aJudged !== bJudged) return aJudged ? -1 : 1;
    return (b.normalizedRatePerCrewHour ?? 0) - (a.normalizedRatePerCrewHour ?? 0);
  });

  return {
    areas,
    fleetRatePerCrewHour: fleetRate === null ? null : Math.round(fleetRate * 100) / 100,
    withheld,
    blindSpots,
  };
}

export interface CampaignFact {
  id: string;
  type: 'flyer' | 'ads' | 'seasonal' | 'neighbor_around_job';
  cost: number | null;
  /** How many attributed leads became booked jobs. */
  bookedJobs: number;
  /** False when this campaign has no tracking number / no attribution path. */
  attributionWired: boolean;
}

export interface CampaignResult {
  id: string;
  type: string;
  cost: number | null;
  bookedJobs: number | null;
  costPerBookedJob: number | null;
  line: string;
}

/**
 * Campaign cost-per-job. The whole point is to refuse the two comfortable
 * lies: an unmeasured campaign reported as zero jobs, and a costless campaign
 * reported as infinitely efficient.
 */
export function buildCampaignReport(facts: CampaignFact[]): CampaignResult[] {
  return facts.map((c) => {
    if (!c.attributionWired) {
      return {
        id: c.id, type: c.type, cost: c.cost, bookedJobs: null, costPerBookedJob: null,
        line: 'No tracking on this one — Arbo cannot tell whether it worked. That is not the same as it failing.',
      };
    }
    if (c.cost === null) {
      return {
        id: c.id, type: c.type, cost: null, bookedJobs: c.bookedJobs, costPerBookedJob: null,
        line: `${c.bookedJobs} booked job(s), but no cost on file — cost per job is unknown.`,
      };
    }
    if (c.bookedJobs === 0) {
      return {
        id: c.id, type: c.type, cost: c.cost, bookedJobs: 0, costPerBookedJob: null,
        line: 'Tracked, and no booked jobs came from it.',
      };
    }
    const cpj = Math.round((c.cost / c.bookedJobs) * 100) / 100;
    return {
      id: c.id, type: c.type, cost: c.cost, bookedJobs: c.bookedJobs, costPerBookedJob: cpj,
      line: `${c.bookedJobs} booked job(s) at ${cpj} per job.`,
    };
  }).sort((a, b) => {
    // Cheapest measured campaign first; unmeasurable ones last, never ranked
    // as if they were the worst performers.
    if ((a.costPerBookedJob === null) !== (b.costPerBookedJob === null)) {
      return a.costPerBookedJob === null ? 1 : -1;
    }
    return (a.costPerBookedJob ?? 0) - (b.costPerBookedJob ?? 0);
  });
}
