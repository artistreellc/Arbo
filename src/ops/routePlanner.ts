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
import { TOMTOM_NOT_SET_LINE } from '../integrations/tomtom.js';

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
  /** R35: the caller's own id for the stop, carried onto its visit so a list can match it back. */
  id?: string;
  /**
   * R35: what a map engine is asked to find. Today's stops set it from the
   * calendar event's location, so the label (the event title — often a
   * customer's name) never leaves Arbo. Unset = the label is the address, as
   * the typed planner always sent it.
   */
  address?: string;
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
  /** The stop's id when it had one (R35). */
  id?: string;
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
      ...(s.id !== undefined ? { id: s.id } : {}),
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

export type PlanMode = 'live_traffic' | 'zip_estimate' | 'tomtom_traffic';

export interface LivePlanDeps {
  apiKey: string | null;
  fetchMatrix: (addresses: string[], apiKey: string, departureIso?: string) => Promise<number[][]>;
  /** Injected clock for the traffic departure time. */
  nowIso?: () => string;
}

// Exported for the map (Maps wave A, M1): its TomTom peek uses the planner's own key.
export function addressOf(s: PlanStop): string {
  if (s.address) return s.address; // R35: the event's location — never its title
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
    visits.push({ order: startOrder + visits.length, label: s.label, zip: s.zip, ...(s.id !== undefined ? { id: s.id } : {}), window, startTime: fmt(t), endTime: fmt(t + slotMin) });
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
    // R35: by a KNOWN code only (googleRoutes.ts's own messages) — a raw error
    // text can quote a URL or a key, and this note goes to the phone.
    return {
      ...base,
      note: base.note + ` Live traffic was requested but the Maps call failed (${googleFailure(err)}) — these are ZIP estimates.`,
      mode: 'zip_estimate',
    };
  }
}

/** googleRoutes.ts's own failure messages pass through; anything else is "no answer". */
function googleFailure(err: unknown): string {
  const m = err instanceof Error ? err.message : '';
  return /^routes matrix(?: HTTP \d{3}|: unexpected response shape|: incomplete)$/.test(m) ? m : 'no answer';
}

// ═══ TOMTOM LAYER (R35, Mike 2026-10-20: "and for a route planner intergrate tomtom") ═══
// TomTom orders each run — only INSIDE the run R16 already decided: the
// weekday run after 4, Saturday's Norfolk/Chesapeake/Portsmouth run from 8,
// Saturday's Virginia Beach run after 12. It can reorder a run's stops; it
// can never move a stop into another run, change the minutes on site, or
// start a run anywhere but its window's start (the first visit starts AT the
// window, as above). One calculateRoute call per run: origin = the start ZIP
// (the R16 anchor: live ping, then Settings' work ZIP, then home), destination
// = the home ZIP when set (OPS_CONVENTIONS: estimate routes "start and end at
// Mike's home"), every stop between them a waypoint TomTom may reorder. No
// start ZIP at all: the run loops from its first stop listed. Saturday's
// afternoon run starts where the morning ended. TomTom is sent each stop's
// ADDRESS (addressOf) and ZIPs for the ends — never a label, never a name.

export interface TomTomPoint {
  lat: number;
  lon: number;
}

export interface TomTomPlanDeps {
  /** One address → a point; null = TomTom could not place it. Throws on any failure. */
  geocode: (query: string) => Promise<TomTomPoint | null>;
  /** points[0] and the last point are fixed; between them TomTom may reorder (bestOrder). */
  route: (points: TomTomPoint[], opts: { bestOrder: boolean; departAtIso?: string }) => Promise<{ order: number[]; legMinutes: number[] }>;
  /**
   * RFC 3339 departure for a run that starts `startMin` minutes into the
   * plan's day — TomTom then FORECASTS traffic for that time; undefined =
   * TomTom's documented default, "now" (live traffic at planning time). The
   * note says which one each run got.
   */
  departAt?: (startMin: number) => string | undefined;
}

export interface TomTomPlan extends RoutePlan {
  mode: 'tomtom_traffic';
  /** Stops TomTom could not place — left out of the plan and NAMED, never silently dropped. */
  unplaced: Array<{ id?: string; label: string }>;
}

async function tomtomRun(
  stops: PlanStop[],
  at: Map<PlanStop, TomTomPoint>,
  origin: TomTomPoint | null,
  destination: TomTomPoint | null,
  startMin: number,
  slotMin: number,
  window: PlannedVisit['window'],
  startOrder: number,
  deps: TomTomPlanDeps,
): Promise<{ visits: PlannedVisit[]; endMin: number; last: PlanStop | null; traffic: 'forecast' | 'now' | null }> {
  if (stops.length === 0) return { visits: [], endMin: startMin, last: null, traffic: null };
  // No start point: the run begins at its first stop listed and loops back to it.
  const first = origin ? null : stops[0]!;
  const from = origin ?? at.get(stops[0]!)!;
  const waypoints = first ? stops.slice(1) : stops;
  const to = destination ?? from;
  let seq: PlanStop[] = first ? [first] : [];
  // gapBefore[k]: drive minutes into seq[k] from the stop before it (k = 0 is never used).
  let gapBefore: number[] = [0];
  // Which traffic TomTom timed this run with — null when nothing was driven (one stop, no start point).
  let traffic: 'forecast' | 'now' | null = null;
  if (waypoints.length > 0) {
    const dep = deps.departAt?.(startMin);
    traffic = dep ? 'forecast' : 'now';
    const r = await deps.route([from, ...waypoints.map((s) => at.get(s)!), to], { bestOrder: waypoints.length >= 2, ...(dep ? { departAtIso: dep } : {}) });
    const n = waypoints.length;
    const isOrder = r.order.length === n && new Set(r.order).size === n && r.order.every((i) => Number.isInteger(i) && i >= 0 && i < n);
    if (!isOrder || r.legMinutes.length !== n + 1 || !r.legMinutes.every((m) => Number.isFinite(m) && m >= 0)) {
      throw new Error('TomTom unreadable answer');
    }
    const ordered = r.order.map((i) => waypoints[i]!);
    // Leg i ends at ordered[i]. With a first stop in front, ordered[i] is seq[i + 1].
    seq = first ? [first, ...ordered] : ordered;
    gapBefore = first ? [0, ...r.legMinutes.slice(0, n)] : r.legMinutes.slice(0, n);
  }
  const visits: PlannedVisit[] = [];
  let t = startMin;
  seq.forEach((s, k) => {
    if (k > 0) t += gapBefore[k]!;
    visits.push({ order: startOrder + k, label: s.label, zip: s.zip, ...(s.id !== undefined ? { id: s.id } : {}), window, startTime: fmt(t), endTime: fmt(t + slotMin) });
    t += slotMin;
  });
  return { visits, endMin: t, last: seq[seq.length - 1] ?? null, traffic };
}

/** What traffic the drive times rest on, in Mike's words — never "live" for a forecast (R35 review). */
function tomtomTrafficWords(runs: Array<'forecast' | 'now' | null>): string {
  const used = runs.filter((r): r is 'forecast' | 'now' => r !== null);
  if (used.length === 0) return 'no drive between stops to time';
  if (used.every((r) => r === 'forecast')) return "drive times are TomTom's traffic forecast for when each run starts";
  if (used.every((r) => r === 'now')) return "drive times are TomTom's live traffic when it was planned";
  return "drive times are TomTom's live traffic for a run already under way and its forecast for a run still ahead";
}

export async function planRouteTomTom(input: PlanInput, deps: TomTomPlanDeps): Promise<TomTomPlan> {
  const slotMin = input.slotMinutes ?? SLOT_DEFAULT_MIN;
  const startZip = input.startZip ?? input.homeZip ?? null;
  const start = startZip ? await deps.geocode(`${startZip}, VA`) : null;
  const home = input.homeZip ? (input.homeZip === startZip ? start : await deps.geocode(`${input.homeZip}, VA`)) : null;
  const at = new Map<PlanStop, TomTomPoint>();
  const unplaced: PlanStop[] = [];
  for (const s of input.stops) {
    const p = await deps.geocode(addressOf(s));
    if (p) at.set(s, p);
    else unplaced.push(s);
  }
  const placed = input.stops.filter((s) => at.has(s));
  if (placed.length === 0) throw new Error("TomTom couldn't place any address");
  const end = home ?? start;
  const warnings: string[] = [];
  let visits: PlannedVisit[];
  let traffic: Array<'forecast' | 'now' | null>;
  if (input.day === 'weekday') {
    const run = await tomtomRun(placed, at, start, end, 16 * 60, slotMin, 'after_work', 1, deps);
    if (run.endMin > 20 * 60) warnings.push(`Plan runs past 8pm (ends ${fmt(run.endMin)}) — consider moving a stop to another day.`);
    visits = run.visits;
    traffic = [run.traffic];
  } else {
    // Saturday: Mike's split decides the run; TomTom only orders inside it.
    const vb = placed.filter((s) => isVirginiaBeach(s));
    const others = placed.filter((s) => !isVirginiaBeach(s));
    const morning = await tomtomRun(others, at, start, end, 8 * 60, slotMin, 'morning', 1, deps);
    if (morning.endMin > 12 * 60) warnings.push(`Morning run spills past noon (ends ${fmt(morning.endMin)}) — trim it or start earlier.`);
    const afternoonFrom = morning.last ? at.get(morning.last)! : start;
    const afternoon = await tomtomRun(vb, at, afternoonFrom, end, 12 * 60, slotMin, 'afternoon', morning.visits.length + 1, deps);
    if (afternoon.endMin > 20 * 60) warnings.push(`Afternoon run passes 8pm (ends ${fmt(afternoon.endMin)}).`);
    visits = [...morning.visits, ...afternoon.visits];
    traffic = [morning.traffic, afternoon.traffic];
  }
  if (unplaced.length > 0) {
    warnings.push(`TomTom couldn't place ${unplaced.map((s) => s.label).join('; ')} — not in the plan. Check the address.`);
  }
  const from = start
    ? `It starts from ${input.startZip ? 'where you are working today (by ZIP)' : 'your home ZIP'}${home ? ' and ends at your home ZIP' : ''}.`
    : startZip
      ? "TomTom couldn't place the start ZIP, so the route starts at the first stop listed."
      : 'No start ZIP is set (Settings), so the route starts at the first stop listed.';
  // R35 review: a run timed for its start is a FORECAST, not "live traffic at
  // planning time"; and the note is on Mike's own screen, so it says "your".
  const note = `Planned by TomTom — ${slotMin} min on site; ${tomtomTrafficWords(traffic)}. TomTom picks the order inside your windows (weekdays after 4; Saturdays Norfolk, Chesapeake and Portsmouth from 8, Virginia Beach after 12). ${from}`;
  return {
    visits,
    totalStops: visits.length,
    note,
    warnings,
    mode: 'tomtom_traffic',
    unplaced: unplaced.map((s) => ({ ...(s.id !== undefined ? { id: s.id } : {}), label: s.label })),
  };
}

// ═══ ENGINE ORDER (R35) — TomTom when its key is set (Mike's latest word),
// else the Google Routes upgrade (R16), else the ZIP planner. The plan ALWAYS
// names the engine that produced it, and TomTom's absence or failure is said
// on its own line — a fallback that looks like TomTom ran is the §1B lie. ═══

export type PlanEngine = 'tomtom' | 'google' | 'zip';

export interface BestPlan extends RoutePlan {
  mode: PlanMode;
  engine: PlanEngine;
  /** Drive minutes between consecutive stops inside each run — not the drive to the first stop, not the drive home. */
  driveMinutes: number;
  unplaced: Array<{ id?: string; label: string }>;
  /**
   * used = TomTom planned it; not_set = no key; failed = asked and failed (line
   * names how); too_many = more stops than ROUTE_MAX_STOPS, so not asked;
   * idle = nothing to plan.
   */
  tomtom: { state: 'used' | 'not_set' | 'failed' | 'too_many' | 'idle'; line: string | null };
}

/**
 * The most stops one plan takes (R35 security review). A day is a dozen
 * stops — 25 is a long day twice over — and it keeps every TomTom call well
 * under TomTom's documented 150-waypoint limit, so one request can never spend
 * hundreds of lookups on a route TomTom must refuse. The typed planner refuses
 * more (400 too_many_stops); a calendar day with more is planned without
 * TomTom, and the plan says so.
 */
export const ROUTE_MAX_STOPS = 25;

export interface BestPlanDeps {
  /** Null = no TOMTOM_API_KEY. */
  tomtom: TomTomPlanDeps | null;
  google: LivePlanDeps;
}

function toMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h! * 60 + m!;
}

/** Drive time between consecutive visits of the same run, read from the plan's own times. */
export function driveBetween(visits: PlannedVisit[]): number {
  let total = 0;
  for (let i = 1; i < visits.length; i++) {
    const a = visits[i - 1]!;
    const b = visits[i]!;
    if (a.window === b.window) total += toMinutes(b.startTime) - toMinutes(a.endTime);
  }
  return total;
}

/** TomTom's own fixed failure names pass through (src/integrations/tomtom.ts); anything else is "TomTom error". */
function tomtomFailure(err: unknown): string {
  const m = err instanceof Error ? err.message : '';
  return /^TomTom (?:HTTP \d{3}|timed out|unreachable|unreadable answer|couldn't place any address)$/.test(m) ? m : 'TomTom error';
}

/** What Mike can do about a TomTom refusal (R35 review: a bare "HTTP 403" is not a next step). */
function tomtomNextStep(failed: string): string {
  if (/^TomTom HTTP 40[13]$/.test(failed)) return ' Check TOMTOM_API_KEY in Railway, and that the key is switched on for Search and Routing.';
  if (failed === 'TomTom HTTP 429') return " TomTom's request limit for the key was reached — it is asked again on the next refresh.";
  return '';
}

export async function planRouteBest(input: PlanInput, deps: BestPlanDeps): Promise<BestPlan> {
  let tomtom: BestPlan['tomtom'] = deps.tomtom ? { state: 'idle', line: null } : { state: 'not_set', line: TOMTOM_NOT_SET_LINE };
  let failed: string | null = null;
  const tooMany = input.stops.length > ROUTE_MAX_STOPS;
  if (deps.tomtom && input.stops.length > 0 && !tooMany) {
    try {
      const t = await planRouteTomTom(input, deps.tomtom);
      return { ...t, engine: 'tomtom', driveMinutes: driveBetween(t.visits), tomtom: { state: 'used', line: null } };
    } catch (err) {
      failed = tomtomFailure(err);
    }
  }
  const g = await planRouteLive(input, deps.google);
  const engine: PlanEngine = g.mode === 'live_traffic' ? 'google' : 'zip';
  const instead = engine === 'google' ? 'planned by Google Maps instead' : 'these are ZIP estimates';
  if (failed) {
    tomtom = { state: 'failed', line: `TomTom couldn't plan it (${failed}) — ${instead}.${tomtomNextStep(failed)}` };
  } else if (deps.tomtom && tooMany) {
    tomtom = { state: 'too_many', line: `TomTom not asked — ${input.stops.length} stops is more than ${ROUTE_MAX_STOPS} for one plan, so ${instead}.` };
  }
  return { ...g, engine, driveMinutes: driveBetween(g.visits), unplaced: [], tomtom };
}
