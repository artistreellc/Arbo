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
// Each timed event with a location carrying a ZIP is planned without Mike
// typing it (src/ops/routePlanner.ts: TomTom, else Google, else ZIP — the
// line names which); everything else is listed and says why it is not.
//
// §1B: a calendar Arbo could not read is NAMED in its own words and never
// renders as "nothing on the calendar today". Logs carry counts and codes,
// never a title, an address or a name (§4.3).

import type { CalendarEvent } from '../integrations/calendar.js';
import { TOMTOM_NOT_SET_LINE } from '../integrations/tomtom.js';
import { etDayWindow, etHourMinute, etToday, etWeekday } from '../lib/etDay.js';
import { parseAddress, serviceCityForZip } from '../lib/address.js';
import { simTodayEvents } from '../dev/simTodayStops.js';
import { driveBetween, planRoute, type BestPlan, type PlanInput, type PlanStop } from './routePlanner.js';

export const TODAY_CALENDAR_ID = 'primary';
const CALENDAR_FRESH_MS = 60_000; // the page refreshes every minute; Google is asked at most once a minute
const PLAN_FRESH_MS = 15 * 60_000; // an unchanged day is not re-planned (TomTom / Google cost) for 15 minutes

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
const NOTHING_TO_ROUTE = 'Nothing to route — no stop today has an address with a ZIP.';
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
  /** The event's own start time, "HH:MM" ET; null for an all-day event. */
  time: string | null;
  allDay: boolean;
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

type Row = TodayStop & { zip: string | null };

function toRow(e: CalendarEvent, i: number): Row {
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(e.startIso);
  const address = e.location?.trim() || null;
  const zip = address ? lastVaZip(address) : null;
  const parsed = address ? parseAddress(address) : null;
  const city = parsed ? (parsed.city ?? parsed.offFocusCity ?? serviceCityForZip(zip)) : null;
  const start = new Date(e.startIso);
  const time = allDay || Number.isNaN(start.getTime()) ? null : etHourMinute(start);
  // An all-day event is never routed, address or not; the page says "No address on the event" whenever there is none.
  const why = allDay ? 'All-day event — not routed'
    : !address ? 'No address on the event'
    : !zip ? 'No ZIP in the address — not in the plan'
    : null;
  return { id: `s${i + 1}`, time, allDay, title: e.summary.trim(), city, address, zip, why, plan: null };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Booked times R16 would plan elsewhere — said, never silently moved: the booking stands. */
function bookingWarnings(rows: Row[], dayKind: TodayStopsView['dayKind']): string[] {
  const out: string[] = [];
  const timed = rows.filter((r) => r.why === null && r.time !== null);
  if (dayKind === 'weekday') {
    const early = timed.filter((r) => r.time! < '16:00').length;
    if (early) out.push(`${count(early, 'stop is', 'stops are')} booked before 4 PM — R16 plans weekday stops after 4. The booked time on the calendar stands.`);
  } else if (dayKind === 'saturday') {
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
    : engine === 'tomtom' ? 'Planned by TomTom with live traffic'
    : engine === 'google' ? 'Planned by Google Maps with live traffic'
    : 'ZIP estimates — not a mapped route';
  return `${by} · ${count(stops, 'stop')} · ${stops > 1 ? `about ${drive} min driving between stops` : 'no driving between stops'}`;
}

function toPlanStop(r: Row): PlanStop {
  return { id: r.id, label: r.title || 'No title', zip: r.zip!, address: r.address!, ...(r.city ? { city: r.city } : {}) };
}

export function createTodayStops(deps: TodayStopsDeps) {
  const log = deps.log ?? ((l: string) => console.log(l));
  let cal: { day: string; atMs: number; read: { events: CalendarEvent[] } | { failure: Exclude<ReadFailure, 'google_not_connected'> } } | null = null;
  let planned: { key: string; atMs: number; plan: BestPlan } | null = null;
  let inflight: Promise<TodayStopsView> | null = null;

  async function build(): Promise<TodayStopsView> {
    const now = deps.now();
    const nowMs = now.getTime();
    const day = etToday(now);
    const wd = etWeekday(now);
    const dayKind: TodayStopsView['dayKind'] = wd === 'Sat' ? 'saturday' : wd === 'Sun' ? 'sunday' : 'weekday';
    const tomtom: TodayStopsView['tomtom'] = { set: deps.tomtomSet, state: deps.tomtomSet ? 'idle' : 'not_set', line: deps.tomtomSet ? null : TOMTOM_NOT_SET_LINE };
    const base = { day, dayKind, calendarId: TODAY_CALENDAR_ID, readAt: now.toISOString() };
    const practice = deps.practice();

    let events: CalendarEvent[];
    if (practice) {
      events = simTodayEvents(day);
    } else {
      const reader = deps.calendar();
      if (!reader) {
        return { ...base, state: 'google_not_connected', line: TODAY_LINES.google_not_connected, practice: false, stops: [], plan: null, tomtom };
      }
      if (!cal || cal.day !== day || nowMs - cal.atMs >= CALENDAR_FRESH_MS) {
        const w = etDayWindow(day);
        let read: NonNullable<typeof cal>['read'];
        try {
          read = { events: await reader(TODAY_CALENDAR_ID, w.startUtc.toISOString(), w.endUtc.toISOString()) };
        } catch (err) {
          read = { failure: calendarReadFailure(err) };
          log(`[today-stops] calendar read failed: ${read.failure}`);
        }
        cal = { day, atMs: nowMs, read };
      }
      if ('failure' in cal.read) {
        return { ...base, state: cal.read.failure, line: TODAY_LINES[cal.read.failure], practice: false, stops: [], plan: null, tomtom };
      }
      events = cal.read.events;
    }

    const rows = events.map(toRow);
    const view: TodayStopsView = { ...base, state: practice ? 'practice' : 'ok', line: null, practice, stops: rows, plan: null, tomtom };
    if (rows.length === 0) return strip(view);

    if (dayKind === 'sunday') {
      const order = rows.filter((r) => r.address && !r.allDay).map((r) => r.id);
      view.plan = { engine: null, kind: 'none', line: SUNDAY_LINE, note: '', warnings: [], order, driveMinutes: null };
      return strip(view);
    }
    const routable = rows.filter((r) => r.why === null);
    if (routable.length === 0) {
      view.plan = { engine: null, kind: 'none', line: NOTHING_TO_ROUTE, note: '', warnings: [], order: [], driveMinutes: null };
      return strip(view);
    }

    const input: PlanInput = { stops: routable.map(toPlanStop), day: dayKind };
    let p: BestPlan;
    if (practice) {
      // Practice streets do not exist: ZIP estimates only, and no engine is asked.
      const z = planRoute(input);
      p = { ...z, note: `${z.note} Practice mode: TomTom and Google are not asked.`, mode: 'zip_estimate', engine: 'zip', driveMinutes: driveBetween(z.visits), unplaced: [], tomtom: { state: tomtom.state, line: tomtom.line } };
    } else {
      const a = deps.anchors();
      const full: PlanInput = { ...input, startZip: a.startZip, homeZip: a.homeZip };
      const key = JSON.stringify([day, dayKind, a.startZip, a.homeZip, routable.map((r) => [r.id, r.title, r.address, r.zip, r.city])]);
      if (planned && planned.key === key && nowMs - planned.atMs < PLAN_FRESH_MS) {
        p = planned.plan;
      } else {
        try {
          p = await deps.plan(full, day);
        } catch {
          // planRouteBest names its own failures; this is the belt for a bug in it.
          const z = planRoute(full);
          p = { ...z, note: `${z.note} The route engines could not be asked.`, mode: 'zip_estimate', engine: 'zip', driveMinutes: driveBetween(z.visits), unplaced: [], tomtom: { state: deps.tomtomSet ? 'failed' : 'not_set', line: deps.tomtomSet ? "TomTom couldn't plan it (TomTom error) — these are ZIP estimates." : TOMTOM_NOT_SET_LINE } };
        }
        planned = { key, atMs: nowMs, plan: p };
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
      note: `${p.note} The booked time on each event stands — the plan's order and times are a suggestion.`,
      warnings: [...p.warnings, ...bookingWarnings(routable, dayKind)],
      order: p.visits.map((v) => v.id).filter((id): id is string => typeof id === 'string'),
      driveMinutes: p.driveMinutes,
    };
    return strip(view);
  }

  return {
    /** Today's stops, as the Calendar tab shows them. Concurrent reads share one build. */
    read(): Promise<TodayStopsView> {
      if (!inflight) inflight = build().finally(() => { inflight = null; });
      return inflight;
    },
  };
}

/** The phone gets what it shows — the ZIP the planner used stays on Arbo's side. */
function strip(view: TodayStopsView): TodayStopsView {
  return { ...view, stops: view.stops.map(({ id, time, allDay, title, city, address, why, plan }) => ({ id, time, allDay, title, city, address, why, plan })) };
}
