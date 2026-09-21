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
// R16 (Mike, 2026-09-21): "create a route planner tool that optimizes the
// route for the most efficient way possible and allow for 20 mins at each
// estimate."
//
// ═══ DELIBERATELY A PLANNER, NOT A MAP ═══
// Ordering is nearest-neighbor over ZIP distance (same ZIP = 0, same first-3
// prefix = close, otherwise far) — no routing engine, no live traffic, and
// the plan SAYS SO: times are planning estimates, not a mapped route (§1B).
// Mike's standing rules are law here: Saturdays run Norfolk/Chesapeake/
// Portsmouth in the MORNING (from 8) and Virginia Beach AFTER 12; weekday
// estimates start after 4. Twenty minutes on site per stop; drive gaps are
// 15 minutes inside a ZIP prefix, 25 across prefixes.

export interface PlanStop {
  label: string;
  city?: string;
  zip: string;
}

export interface PlanInput {
  stops: PlanStop[];
  day: 'saturday' | 'weekday';
  slotMinutes?: number;
  /** Where Mike starts (work anchor). Falls back to home, then to the first stop. */
  startZip?: string | null;
  homeZip?: string | null;
}

export interface PlannedVisit {
  order: number;
  label: string;
  zip: string;
  window: 'morning' | 'afternoon' | 'after_work';
  startTime: string; // "HH:MM" ET
  endTime: string;
}

export interface RoutePlan {
  visits: PlannedVisit[];
  totalStops: number;
  /** §1B: what this plan can and cannot know, stated on the plan itself. */
  note: string;
  warnings: string[];
}

const SLOT_DEFAULT_MIN = 20;
const DRIVE_SAME_PREFIX_MIN = 15;
const DRIVE_CROSS_PREFIX_MIN = 25;

function zipDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.slice(0, 3) === b.slice(0, 3)) return 1;
  return 10 + Math.abs(Number(a) - Number(b)) / 100;
}

/** Nearest-neighbor from an anchor — greedy, good enough, and honest about it. */
function order(stops: PlanStop[], fromZip: string | null): PlanStop[] {
  const remaining = [...stops];
  const out: PlanStop[] = [];
  let at = fromZip ?? remaining[0]?.zip ?? null;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let best = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = at ? zipDistance(at, remaining[i]!.zip) : 0;
      if (d < best) {
        best = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0]!;
    out.push(next);
    at = next.zip;
  }
  return out;
}

function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isVirginiaBeach(s: PlanStop): boolean {
  if (s.city && /virginia\s*beach/i.test(s.city)) return true;
  if (s.city) return false;
  // No city given: VB ZIPs are 2345x/2346x — a stated approximation.
  return /^234[56]/.test(s.zip);
}

function schedule(stops: PlanStop[], startMin: number, slotMin: number, window: PlannedVisit['window'], startOrder: number): { visits: PlannedVisit[]; endMin: number } {
  const visits: PlannedVisit[] = [];
  let t = startMin;
  let prevZip: string | null = null;
  for (const s of stops) {
    if (prevZip !== null) {
      t += prevZip.slice(0, 3) === s.zip.slice(0, 3) ? DRIVE_SAME_PREFIX_MIN : DRIVE_CROSS_PREFIX_MIN;
    }
    visits.push({
      order: startOrder + visits.length,
      label: s.label,
      zip: s.zip,
      window,
      startTime: fmt(t),
      endTime: fmt(t + slotMin),
    });
    t += slotMin;
    prevZip = s.zip;
  }
  return { visits, endMin: t };
}

export function planRoute(input: PlanInput): RoutePlan {
  const slotMin = input.slotMinutes ?? SLOT_DEFAULT_MIN;
  const warnings: string[] = [];
  const note = `Times are planning estimates from ZIP distances — ${slotMin} min on site, ${DRIVE_SAME_PREFIX_MIN}/${DRIVE_CROSS_PREFIX_MIN} min drive gaps. Not a mapped route; confirm against real traffic.`;

  if (input.stops.length === 0) {
    return { visits: [], totalStops: 0, note, warnings: ['No stops to plan.'] };
  }
  const anchor = input.startZip ?? input.homeZip ?? null;

  if (input.day === 'weekday') {
    const ordered = order(input.stops, anchor);
    const { visits, endMin } = schedule(ordered, 16 * 60, slotMin, 'after_work', 1);
    if (endMin > 20 * 60) warnings.push(`Plan runs past 8pm (ends ${fmt(endMin)}) — consider moving a stop to another day.`);
    return { visits, totalStops: visits.length, note, warnings };
  }

  // Saturday: Mike's split — Norfolk/Chesapeake/Portsmouth mornings, VB after 12.
  const vb = input.stops.filter((s) => isVirginiaBeach(s));
  const others = input.stops.filter((s) => !isVirginiaBeach(s));
  const morning = schedule(order(others, anchor), 8 * 60, slotMin, 'morning', 1);
  if (morning.endMin > 12 * 60) warnings.push(`Morning run spills past noon (ends ${fmt(morning.endMin)}) — trim it or start earlier.`);
  const lastMorningZip = morning.visits.length > 0 ? morning.visits[morning.visits.length - 1]!.zip : anchor;
  const afternoon = schedule(order(vb, lastMorningZip), 12 * 60, slotMin, 'afternoon', morning.visits.length + 1);
  if (afternoon.endMin > 20 * 60) warnings.push(`Afternoon run passes 8pm (ends ${fmt(afternoon.endMin)}).`);
  return {
    visits: [...morning.visits, ...afternoon.visits],
    totalStops: morning.visits.length + afternoon.visits.length,
    note,
    warnings,
  };
}

// ═══ LIVE-TRAFFIC LAYER (Mike: "uses a live traffic app like google maps") ═══
// Same windows and slots; ordering and drive gaps come from a real traffic-
// aware matrix when a Maps key is configured AND the request succeeds. Any
// other outcome falls back to the ZIP planner above and the plan SAYS which
// mode produced it — a guessed time labelled "live" is a §1B lie.

export type PlanMode = 'live_traffic' | 'zip_estimate';

export interface LivePlanDeps {
  apiKey: string | null;
  fetchMatrix: (addresses: string[], apiKey: string, departureIso?: string) => Promise<number[][]>;
  /** Injected clock for the traffic departure time. */
  nowIso?: () => string;
}

function addressOf(s: PlanStop): string {
  return `${s.label}, ${s.city ?? ''} VA ${s.zip}`.replace(/\s+/g, ' ').trim();
}

function orderByMatrix(stops: PlanStop[], idx: Map<PlanStop, number>, matrix: number[][], fromIdx: number | null): PlanStop[] {
  const remaining = [...stops];
  const out: PlanStop[] = [];
  let at = fromIdx;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let best = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const j = idx.get(remaining[i]!)!;
      const d = at === null ? 0 : matrix[at]![j]!;
      if (d < best) {
        best = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0]!;
    out.push(next);
    at = idx.get(next)!;
  }
  return out;
}

function scheduleByMatrix(
  stops: PlanStop[],
  idx: Map<PlanStop, number>,
  matrix: number[][],
  startMin: number,
  slotMin: number,
  window: PlannedVisit['window'],
  startOrder: number,
): { visits: PlannedVisit[]; endMin: number } {
  const visits: PlannedVisit[] = [];
  let t = startMin;
  let prev: number | null = null;
  for (const s of stops) {
    const j = idx.get(s)!;
    if (prev !== null) t += matrix[prev]![j]!;
    visits.push({ order: startOrder + visits.length, label: s.label, zip: s.zip, window, startTime: fmt(t), endTime: fmt(t + slotMin) });
    t += slotMin;
    prev = j;
  }
  return { visits, endMin: t };
}

export async function planRouteLive(input: PlanInput, deps: LivePlanDeps): Promise<RoutePlan & { mode: PlanMode }> {
  const slotMin = input.slotMinutes ?? SLOT_DEFAULT_MIN;
  if (input.stops.length === 0 || !deps.apiKey) {
    const base = planRoute(input);
    const why = input.stops.length === 0 ? '' : ' Live traffic is OFF: no Google Maps key is configured on the server.';
    return { ...base, note: base.note + why, mode: 'zip_estimate' };
  }
  try {
    const anchorAddr = input.startZip ? `${input.startZip}, VA` : input.homeZip ? `${input.homeZip}, VA` : null;
    const points = [...(anchorAddr ? [anchorAddr] : []), ...input.stops.map(addressOf)];
    const matrix = await deps.fetchMatrix(points, deps.apiKey, deps.nowIso ? deps.nowIso() : undefined);
    const offset = anchorAddr ? 1 : 0;
    const idx = new Map<PlanStop, number>(input.stops.map((s, i) => [s, i + offset]));
    const anchorIdx = anchorAddr ? 0 : null;
    const warnings: string[] = [];
    const note = `Live traffic route via Google Maps — ${slotMin} min on site, drive times traffic-aware at planning time. Re-plan if you leave much later.`;

    if (input.day === 'weekday') {
      const ordered = orderByMatrix(input.stops, idx, matrix, anchorIdx);
      const { visits, endMin } = scheduleByMatrix(ordered, idx, matrix, 16 * 60, slotMin, 'after_work', 1);
      if (endMin > 20 * 60) warnings.push(`Plan runs past 8pm (ends ${fmt(endMin)}) — consider moving a stop to another day.`);
      return { visits, totalStops: visits.length, note, warnings, mode: 'live_traffic' };
    }
    const vb = input.stops.filter((s) => isVirginiaBeach(s));
    const others = input.stops.filter((s) => !isVirginiaBeach(s));
    const morningStops = orderByMatrix(others, idx, matrix, anchorIdx);
    const morning = scheduleByMatrix(morningStops, idx, matrix, 8 * 60, slotMin, 'morning', 1);
    if (morning.endMin > 12 * 60) warnings.push(`Morning run spills past noon (ends ${fmt(morning.endMin)}) — trim it or start earlier.`);
    const lastIdx = morningStops.length > 0 ? idx.get(morningStops[morningStops.length - 1]!)! : anchorIdx;
    const afternoonStops = orderByMatrix(vb, idx, matrix, lastIdx);
    const afternoon = scheduleByMatrix(afternoonStops, idx, matrix, 12 * 60, slotMin, 'afternoon', morning.visits.length + 1);
    if (afternoon.endMin > 20 * 60) warnings.push(`Afternoon run passes 8pm (ends ${fmt(afternoon.endMin)}).`);
    return { visits: [...morning.visits, ...afternoon.visits], totalStops: morning.visits.length + afternoon.visits.length, note, warnings, mode: 'live_traffic' };
  } catch (err) {
    const base = planRoute(input);
    // Degrade LOUDLY: the plan names the failure instead of posing as live.
    return {
      ...base,
      note: base.note + ` Live traffic was requested but the Maps call failed (${err instanceof Error ? err.message : 'error'}) — these are ZIP estimates.`,
      mode: 'zip_estimate',
    };
  }
}
