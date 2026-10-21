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
// R35 (Mike, 2026-10-20, verbatim): "and for a route planner intergrate
// tomtom" / "so its automated and when i select a name in my schedule it asks
// if i want to open google maps and its pre loaded or we just use the calender
// feture alreasy esists".
//
// TODAY'S STOPS. Today's events are READ from Google Calendar 'primary' — the
// signed-in account's main calendar, assumed to be the same calendar as the
// Calendar tab's frame (artistreeofvirginia@gmail.com) — for the ET day, with
// listEvents (a GET; R33 left Google read-only). Reading is not importing
// (R24, R33 #3): the events live in memory only — nothing is saved anywhere,
// and nothing on the calendar is ever created, edited, moved or deleted.
// Each timed event with a location carrying a ZIP (on a weekday, booked at 4
// PM or later — R16's run) is planned without Mike typing it
// (src/ops/routePlanner.ts: TomTom, else Google, else ZIP — the line names
// which); everything else is listed and says why it is not.
//
// §1B: a calendar Arbo could not read is NAMED in its own words and never
// renders as "nothing on the calendar today". Logs carry counts and codes,
// never a title, an address or a name (§4.3).

import type { CalendarEvent } from '../integrations/calendar.js';
import { TOMTOM_NOT_SET_LINE } from '../integrations/tomtom.js';
import { etDayWindow, etHourMinute, etToday, etWeekday } from '../lib/etDay.js';
import { OFF_FOCUS_CITIES, SERVICE_CITIES, serviceCityForZip } from '../lib/address.js';
import { simTodayEvents } from '../dev/simTodayStops.js';
import { driveBetween, planRoute, type BestPlan, type PlanInput, type PlanStop } from './routePlanner.js';

export const TODAY_CALENDAR_ID = 'primary';
const CALENDAR_FRESH_MS = 60_000; // the page refreshes every minute; a GOOD read is reused for a minute
const PLAN_FRESH_MS = 15 * 60_000; // an unchanged day is not re-planned (TomTom / Google cost) for 15 minutes
// R35 review: a failed read or a failed plan is never held — "tap ↻ to try
// again" asks again at once. And once the day's first R16 run has started
// (weekdays 4 PM, Saturdays 8 AM), the plan is HELD for the day: the phone
// moving mid-run must not re-plan the stops already driven. Only a change to
// today's events re-plans it.
const RUN_START_MIN = { weekday: 16 * 60, saturday: 8 * 60 } as const;

export type TodayState = 'ok' | 'practice' | 'google_not_connected' | 'google_signin' | 'calendar_refused' | 'calendar_error';
type ReadFailure = Exclude<TodayState, 'ok' | 'practice'>;

/** A calendar Arbo could not read, in words — each one says it is not an empty day. */
export const TODAY_LINES: Record<ReadFailure, string> = {
  google_not_connected: "Couldn't read your calendar — Google isn't connected (Settings → Reconnect Google). This is not an empty day.",
  google_signin: "Couldn't read your calendar — Google sign-in needs reconnecting (Settings → Reconnect Google). This is not an empty day.",
  calendar_refused: "Couldn't read your calendar — Google refused the read. Reconnect Google and allow calendar access. This is not an empty day.",
  calendar_error: "Couldn't read your calendar just now. This is not an empty day — tap ↻ to try again.",
};

const SUNDAY_LINE = 'Sunday has no route rule yet (R16 covers weekdays and Saturdays), so nothing was planned — stops are in calendar order.';
const NOTHING_TO_ROUTE = "Nothing to route — none of today's events can be planned (each one says why).";
const UNPLACED_WHY = "TomTom couldn't place this address — not in the plan";

/** Why a read failed, by code (the error text could quote the event — §4.3). */
export function calendarReadFailure(err: unknown): Exclude<ReadFailure, 'google_not_connected'> {
  const m = err instanceof Error ? err.message : '';
  if (/token refresh failed/i.test(m) || /listEvents failed: 401\b/.test(m)) return 'google_signin';
  if (/listEvents failed: 403\b/.test(m)) return 'calendar_refused';
  return 'calendar_error';
}

export interface TodayStop {
  id: string;
  /** The event's own start time, "HH:MM" ET; null for an all-day event or one that started before today. */
  time: string | null;
  allDay: boolean;
  /** A timed event that started on an earlier day and runs into today — listed, never routed (R35 review). */
  ongoing: boolean;
  title: string;
  city: string | null;
  /** The event's location as typed on the calendar; null = none. */
  address: string | null;
  /** Why it is not in the plan; null when it is routable. */
  why: string | null;
  /** Its place in the plan — a suggestion; the booked time on the event stands. */
  plan: { order: number; start: string; end: string } | null;
}

export type PlanKind = 'live' | 'estimate' | 'estimate_failed' | 'none' | 'practice';

export interface TodayPlan {
  engine: 'tomtom' | 'google' | 'zip' | null;
  kind: PlanKind;
  line: string;
  note: string;
  warnings: string[];
  /** Stop ids in driving order — what "Route the whole day" opens. */
  order: string[];
  driveMinutes: number | null;
}

export interface TodayStopsView {
  state: TodayState;
  line: string | null;
  practice: boolean;
  day: string;
  dayKind: 'weekday' | 'saturday' | 'sunday';
  calendarId: string;
  stops: TodayStop[];
  plan: TodayPlan | null;
  tomtom: { set: boolean; state: BestPlan['tomtom']['state']; line: string | null };
  readAt: string;
}

export interface TodayStopsDeps {
  now: () => Date;
  /** ARBO_DATA_LINKS=sim: SIM stops, no calendar read, no map engine. */
  practice: () => boolean;
  /** The calendar reader (listEvents only), or null when Google is not connected. */
  calendar: () => ((calendarId: string, timeMinIso: string, timeMaxIso: string) => Promise<CalendarEvent[]>) | null;
  /** The R16 anchors, read at plan time. */
  anchors: () => { startZip: string | null; homeZip: string | null };
  /** The engine order (planRouteBest); `day` is the ET date the runs fall on. */
  plan: (input: PlanInput, day: string) => Promise<BestPlan>;
  tomtomSet: boolean;
  log?: (line: string) => void;
}

const VA_ZIP = /\b(23\d{3})(?:-\d{4})?\b/g;
/** The LAST 23xxx in the address: a ZIP comes at the end, and a five-digit house number does not count. */
function lastVaZip(address: string): string | null {
  const all = [...address.matchAll(VA_ZIP)];
  return all.length > 0 ? all[all.length - 1]![1]! : null;
}

/** A stop as the server holds it: with the ZIP the planner used (the phone's copy drops it — strip()). */
export type TodayStopFull = TodayStop & { zip: string | null };
/** Today's stops before strip() — for the map (Maps wave A, M1), which places a stop by its ZIP area. */
export type TodayStopsFull = Omit<TodayStopsView, 'stops'> & { stops: TodayStopFull[] };
type Row = TodayStopFull;

const CITY_NAMES: readonly string[] = [...SERVICE_CITIES, ...OFF_FOCUS_CITIES];
/**
 * The address's city (R35 review): the ZIP's own city when the ZIP is one of
 * the four; otherwise the city named LAST — a city comes after the street, so
 * "4500 Virginia Beach Blvd, Norfolk" is Norfolk and "5900 Portsmouth Blvd,
 * Suffolk" is Suffolk. Saturday's R16 split rests on this, so a street name
 * must never pass for the city.
 */
function cityOf(address: string, zip: string | null): string | null {
  const byZip = serviceCityForZip(zip);
  if (byZip) return byZip;
  const text = ` ${address.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  let best: string | null = null;
  let at = -1;
  for (const c of CITY_NAMES) {
    const i = text.lastIndexOf(` ${c.toLowerCase()} `);
    if (i > at) { at = i; best = c; }
  }
  return best;
}

function toRow(e: CalendarEvent, i: number, dayStartMs: number, dayKind: TodayStopsView['dayKind']): Row {
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(e.startIso);
  const address = e.location?.trim() || null;
  const zip = address ? lastVaZip(address) : null;
  const city = address ? cityOf(address, zip) : null;
  const start = new Date(e.startIso);
  const timed = !allDay && !Number.isNaN(start.getTime());
  // listEvents returns every event that OVERLAPS today; one that began on an earlier day is not a stop today.
  const ongoing = timed && start.getTime() < dayStartMs;
  const time = timed && !ongoing ? etHourMinute(start) : null;
  // An all-day or carried-over event is never routed, address or not; the page says "No address on the event" whenever there is none.
  // A weekday event booked before 4 is not put in R16's after-4 estimate run: weekday mornings are crew time (OPS_CONVENTIONS) — it is listed at its own time and says why.
  const why = allDay ? 'All-day event — not routed'
    : ongoing ? 'Started on an earlier day — not routed'
    : !address ? 'No address on the event'
    : !zip ? 'No ZIP in the address — not in the plan'
    : dayKind === 'weekday' && time !== null && time < '16:00' ? 'Booked before 4 PM — not in the after-4 run'
    : null;
  return { id: `s${i + 1}`, time, allDay, ongoing, title: e.summary.trim(), city, address, zip, why, plan: null };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
/** The typed planner's advice (Google's note) — Today's stops re-plan by themselves, so it is dropped there. */
const REPLAN_HINT = / ?Re-plan if you leave much later\./;

/**
 * Saturday bookings R16 would plan in the other run — said, never silently
 * moved: the booking stands. (A weekday booking before 4 never reaches the
 * plan at all; its own row says why — see toRow.)
 */
function bookingWarnings(rows: Row[], dayKind: TodayStopsView['dayKind']): string[] {
  const out: string[] = [];
  const timed = rows.filter((r) => r.why === null && r.time !== null);
  if (dayKind === 'saturday') {
    const vb = (r: Row) => (r.city ? /virginia\s*beach/i.test(r.city) : /^234[56]/.test(r.zip ?? ''));
    const vbEarly = timed.filter((r) => vb(r) && r.time! < '12:00').length;
    const othersLate = timed.filter((r) => !vb(r) && r.time! >= '12:00').length;
    if (vbEarly) out.push(`${count(vbEarly, 'Virginia Beach stop is', 'Virginia Beach stops are')} booked before noon — R16 puts Virginia Beach after 12 on Saturdays. The booked time on the calendar stands.`);
    if (othersLate) out.push(`${count(othersLate, 'stop outside Virginia Beach is', 'stops outside Virginia Beach are')} booked after noon — R16 puts them in the Saturday morning run. The booked time on the calendar stands.`);
  }
  return out;
}

function planLine(engine: 'tomtom' | 'google' | 'zip', stops: number, drive: number, practice: boolean): string {
  const by = practice ? 'Practice plan — ZIP estimates'
    : engine === 'tomtom' ? 'Planned by TomTom (traffic-aware)'
    : engine === 'google' ? 'Planned by Google Maps with live traffic'
    : 'ZIP estimates — not a mapped route';
  return `${by} · ${count(stops, 'stop')} · ${stops > 1 ? `about ${drive} min driving between stops` : 'no driving between stops'}`;
}

function toPlanStop(r: Row): PlanStop {
  return { id: r.id, label: r.title || 'No title', zip: r.zip!, address: r.address!, ...(r.city ? { city: r.city } : {}) };
}

export function createTodayStops(deps: TodayStopsDeps) {
  const log = deps.log ?? ((l: string) => console.log(l));
  // Only GOOD answers are kept: a failed read or a failed plan is asked again on the next read.
  let cal: { day: string; atMs: number; events: CalendarEvent[] } | null = null;
  let planned: { stopsKey: string; anchorsKey: string; atMs: number; plan: BestPlan; held: boolean } | null = null;
  let inflight: Promise<TodayStopsFull> | null = null;

  async function build(): Promise<TodayStopsFull> {
    const now = deps.now();
    const nowMs = now.getTime();
    const day = etToday(now);
    const wd = etWeekday(now);
    const dayKind: TodayStopsView['dayKind'] = wd === 'Sat' ? 'saturday' : wd === 'Sun' ? 'sunday' : 'weekday';
    const tomtom: TodayStopsView['tomtom'] = { set: deps.tomtomSet, state: deps.tomtomSet ? 'idle' : 'not_set', line: deps.tomtomSet ? null : TOMTOM_NOT_SET_LINE };
    const base = { day, dayKind, calendarId: TODAY_CALENDAR_ID, readAt: now.toISOString() };
    const practice = deps.practice();
    const w = etDayWindow(day);

    let events: CalendarEvent[];
    if (practice) {
      events = simTodayEvents(day);
    } else {
      const reader = deps.calendar();
      if (!reader) {
        return { ...base, state: 'google_not_connected', line: TODAY_LINES.google_not_connected, practice: false, stops: [], plan: null, tomtom };
      }
      if (!cal || cal.day !== day || nowMs - cal.atMs >= CALENDAR_FRESH_MS) {
        try {
          cal = { day, atMs: nowMs, events: await reader(TODAY_CALENDAR_ID, w.startUtc.toISOString(), w.endUtc.toISOString()) };
        } catch (err) {
          cal = null; // never held: "tap ↻ to try again" asks Google again at once
          const failure = calendarReadFailure(err);
          log(`[today-stops] calendar read failed: ${failure}`);
          return { ...base, state: failure, line: TODAY_LINES[failure], practice: false, stops: [], plan: null, tomtom };
        }
      }
      events = cal.events;
    }

    const dayStartMs = w.startUtc.getTime();
    const rows = events.map((e, i) => toRow(e, i, dayStartMs, dayKind));
    const view: TodayStopsFull = { ...base, state: practice ? 'practice' : 'ok', line: null, practice, stops: rows, plan: null, tomtom };
    if (rows.length === 0) return view;

    if (dayKind === 'sunday') {
      const order = rows.filter((r) => r.address && !r.allDay && !r.ongoing).map((r) => r.id);
      view.plan = { engine: null, kind: 'none', line: SUNDAY_LINE, note: '', warnings: [], order, driveMinutes: null };
      return view;
    }
    const routable = rows.filter((r) => r.why === null);
    if (routable.length === 0) {
      view.plan = { engine: null, kind: 'none', line: NOTHING_TO_ROUTE, note: '', warnings: [], order: [], driveMinutes: null };
      return view;
    }

    const input: PlanInput = { stops: routable.map(toPlanStop), day: dayKind };
    let p: BestPlan;
    let held = false;
    if (practice) {
      // Practice streets do not exist: ZIP estimates only, and no engine is asked.
      const z = planRoute(input);
      p = { ...z, note: `${z.note} Practice mode: TomTom and Google are not asked.`, mode: 'zip_estimate', engine: 'zip', driveMinutes: driveBetween(z.visits), unplaced: [], tomtom: { state: tomtom.state, line: tomtom.line } };
    } else {
      const a = deps.anchors();
      const full: PlanInput = { ...input, startZip: a.startZip, homeZip: a.homeZip };
      const stopsKey = JSON.stringify([day, dayKind, routable.map((r) => [r.id, r.title, r.address, r.zip, r.city, r.time])]);
      const anchorsKey = JSON.stringify([a.startZip, a.homeZip]);
      // Weekday 4 PM / Saturday 8 AM, ET: from here the plan made for today's events holds (no reshuffle mid-run).
      const runStarted = minutesOf(etHourMinute(now)) >= RUN_START_MIN[dayKind];
      const fresh = planned !== null && nowMs - planned.atMs < PLAN_FRESH_MS;
      const reuse = planned !== null && planned.stopsKey === stopsKey
        && (planned.held || (fresh && (runStarted || planned.anchorsKey === anchorsKey)));
      if (planned && reuse) {
        if (runStarted) planned.held = true;
        p = planned.plan;
        held = planned.held;
      } else {
        let failed = false;
        try {
          p = await deps.plan(full, day);
          failed = p.tomtom.state === 'failed' || /Maps call failed/.test(p.note);
        } catch {
          // planRouteBest names its own failures; this is the belt for a bug in it.
          const z = planRoute(full);
          p = { ...z, note: `${z.note} The route engines could not be asked.`, mode: 'zip_estimate', engine: 'zip', driveMinutes: driveBetween(z.visits), unplaced: [], tomtom: { state: deps.tomtomSet ? 'failed' : 'not_set', line: deps.tomtomSet ? "TomTom couldn't plan it (TomTom error) — these are ZIP estimates." : TOMTOM_NOT_SET_LINE } };
          failed = true;
        }
        // A failed plan is never kept (or held): the next read asks the engines again.
        planned = failed ? null : { stopsKey, anchorsKey, atMs: nowMs, plan: p, held: runStarted };
        held = !failed && runStarted;
        log(`[today-stops] ${count(rows.length, 'event')}, ${routable.length} routable, planned by ${p.engine}`);
      }
      view.tomtom = { set: deps.tomtomSet, state: p.tomtom.state, line: p.tomtom.line };
    }

    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const v of p.visits) {
      const r = v.id ? byId.get(v.id) : undefined;
      if (r) r.plan = { order: v.order, start: v.startTime, end: v.endTime };
    }
    for (const u of p.unplaced) {
      const r = u.id ? byId.get(u.id) : undefined;
      if (r) r.why = UNPLACED_WHY;
    }
    const kind: PlanKind = practice ? 'practice'
      : p.engine !== 'zip' ? 'live'
      : p.tomtom.state === 'failed' || /Maps call failed/.test(p.note) ? 'estimate_failed'
      : 'estimate';
    view.plan = {
      engine: p.engine,
      kind,
      line: planLine(p.engine, p.totalStops, p.driveMinutes, practice),
      // Today's stops re-plan on their own, so the typed planner's "re-plan" advice does not apply here.
      note: `${p.note.replace(REPLAN_HINT, '')} The booked time on each event stands — the plan's order and times are a suggestion.${practice ? '' : held ? " Plan held since the run started — it changes only if today's calendar does." : ' It re-plans on its own until the run starts, then holds.'}`,
      warnings: [...p.warnings, ...bookingWarnings(routable, dayKind)],
      order: p.visits.map((v) => v.id).filter((id): id is string => typeof id === 'string'),
      driveMinutes: p.driveMinutes,
    };
    return view;
  }

  // One build at a time, shared by Calendar's read and the map's — the same calendar read, the same plan memory.
  function shared(): Promise<TodayStopsFull> {
    if (!inflight) inflight = build().finally(() => { inflight = null; });
    return inflight;
  }

  return {
    /** Today's stops, as the Calendar tab shows them. Concurrent reads share one build. */
    read(): Promise<TodayStopsView> {
      return shared().then(strip);
    },
    /**
     * Maps wave A (M1): the same answer before strip() — each stop keeps its ZIP —
     * for the map's server-side placing (src/ops/mapToday.ts) only. Never sent to the phone as it is.
     */
    readRows(): Promise<TodayStopsFull> {
      return shared();
    },
  };
}

/** The phone gets what it shows — the ZIP the planner used stays on Arbo's side. */
function strip(view: TodayStopsFull): TodayStopsView {
  return { ...view, stops: view.stops.map(({ id, time, allDay, ongoing, title, city, address, why, plan }) => ({ id, time, allDay, ongoing, title, city, address, why, plan })) };
}
