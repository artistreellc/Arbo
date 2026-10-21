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
import { describe, it, expect, vi, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
vi.hoisted(() => { process.env.APP_ACCESS_KEY = 'test-owner-key'; });
import { createTodayStops, TODAY_LINES, type TodayStopsDeps } from '../src/ops/todayStops.js';
import { planRouteBest, type BestPlan, type PlanInput } from '../src/ops/routePlanner.js';
import { createGoogleCalendarApi, type CalendarEvent } from '../src/integrations/calendar.js';
import { createArborRequestHandler } from '../src/server.js';
import { ownerFetch } from './ownerKey.js';

// R35 (Mike, 2026-10-20): "so its automated and when i select a name in my
// schedule it asks if i want to open google maps and its pre loaded".
// Today's stops are READ from Google Calendar 'primary' — a GET, in memory,
// nothing saved (R24, R33 #3) — for the ET day, and planned without Mike
// typing them. §1B: a calendar Arbo could not read is NAMED, never "nothing
// on the calendar today"; an event with no location is listed and says so.

const WED = new Date('2026-10-21T14:00:00Z'); // Wed 10:00 ET
const ev = (id: string, summary: string, startIso: string, location?: string): CalendarEvent => ({
  id, summary, startIso, endIso: startIso, ...(location ? { location } : {}),
});
const DAY_EVENTS = [
  ev('e1', 'Estimate - SIM-Alder, Test - 757-555-0101', '2026-10-21T16:00:00-04:00', '101 Simulation Row, Virginia Beach, VA 23451, USA'),
  ev('e2', 'SIM-Birch', '2026-10-21T17:00:00-04:00', '202 Placeholder Way, Norfolk, VA 23503'),
  ev('e3', 'SIM-Cedar call', '2026-10-21T17:30:00-04:00'),
  ev('e4', 'SIM-Dogwood', '2026-10-21T18:00:00-04:00', '12 Nowhere Lane, Norfolk'),
  ev('e5', 'SIM- Crew day', '2026-10-21'),
];

function harness(over: Partial<TodayStopsDeps> & { events?: CalendarEvent[] | (() => Promise<CalendarEvent[]>) } = {}) {
  const reads: Array<[string, string, string]> = [];
  const plans: PlanInput[] = [];
  let nowMs = (over.now ? over.now() : WED).getTime();
  const events = over.events ?? DAY_EVENTS;
  const deps: TodayStopsDeps = {
    now: () => new Date(nowMs),
    practice: () => false,
    calendar: () => async (id, a, b) => { reads.push([id, a, b]); return typeof events === 'function' ? events() : events; },
    anchors: () => ({ startZip: '23452', homeZip: null }),
    plan: async (input) => { plans.push(input); return planRouteBest(input, { tomtom: null, google: { apiKey: null, fetchMatrix: async () => [] } }); },
    tomtomSet: false,
    ...over,
  };
  return { stops: createTodayStops(deps), reads, plans, tick: (ms: number) => { nowMs += ms; } };
}

describe('reading today from the calendar', () => {
  it("reads 'primary' for the ET day (the server is on UTC) and lists every event: time, title, city", async () => {
    const h = harness({ now: () => new Date('2026-10-21T03:30:00Z') }); // Tue 23:30 ET
    const v = await h.stops.read();
    expect(h.reads[0]![0]).toBe('primary');
    expect(h.reads[0]![1]).toBe('2026-10-20T04:00:00.000Z');
    expect(h.reads[0]![2]).toBe('2026-10-21T04:00:00.000Z');
    expect(v.day).toBe('2026-10-20');
    expect(v.calendarId).toBe('primary');
    expect(v.state).toBe('ok');
  });

  it('each event becomes a stop; no address, no ZIP and all-day are listed and say why they are not routed', async () => {
    const v = await harness().stops.read();
    expect(v.stops.map((s) => [s.time, s.title, s.city])).toEqual([
      ['16:00', 'Estimate - SIM-Alder, Test - 757-555-0101', 'Virginia Beach'],
      ['17:00', 'SIM-Birch', 'Norfolk'],
      ['17:30', 'SIM-Cedar call', null],
      ['18:00', 'SIM-Dogwood', 'Norfolk'],
      [null, 'SIM- Crew day', null],
    ]);
    expect(v.stops[2]!.address).toBeNull();
    expect(v.stops[2]!.why).toBe('No address on the event');
    expect(v.stops[3]!.why).toBe('No ZIP in the address — not in the plan');
    expect(v.stops[4]!.allDay).toBe(true);
    expect(v.stops[4]!.why).toBe('All-day event — not routed');
    // The two routable stops are planned (ZIP planner here) and matched back by id.
    expect(v.stops[0]!.plan).toMatchObject({ order: 1, start: '16:00' });
    expect(v.stops[1]!.plan).toMatchObject({ order: 2 });
    expect(v.plan!.engine).toBe('zip');
    expect(v.plan!.order).toEqual([v.stops[0]!.id, v.stops[1]!.id]);
    expect(v.plan!.line).toContain('ZIP estimates');
    expect(v.plan!.line).toContain('2 stops');
    expect(v.plan!.line).toContain('25 min driving between stops');
  });

  it('only the location and ZIP reach the planner as the address — the planner label stays on Arbo’s side', async () => {
    const h = harness();
    await h.stops.read();
    expect(h.plans[0]!.stops.map((s) => s.address)).toEqual(['101 Simulation Row, Virginia Beach, VA 23451, USA', '202 Placeholder Way, Norfolk, VA 23503']);
    expect(h.plans[0]!.stops.map((s) => s.zip)).toEqual(['23451', '23503']);
    expect(h.plans[0]!.day).toBe('weekday');
    expect(h.plans[0]!.startZip).toBe('23452');
  });

  it('a ZIP is the LAST 23xxx in the address — a 5-digit house number is not a ZIP', async () => {
    const h = harness({ events: [ev('x', 'SIM-Elm', '2026-10-21T16:00:00-04:00', '23415 Shore Dr, Virginia Beach, VA 23451')] });
    const v = await h.stops.read();
    expect(h.plans[0]!.stops[0]!.zip).toBe('23451');
    expect(v.stops[0]!.city).toBe('Virginia Beach');
  });

  it('Saturday in ET plans by the Saturday rule; a weekday stop booked before 4 says so on its own row (R35 review)', async () => {
    const sat = harness({ now: () => new Date('2026-10-25T02:00:00Z'), events: [ev('s', 'SIM-Sat', '2026-10-24T10:00:00-04:00', '1 SIM Row, Norfolk, VA 23503')] }); // Sat 22:00 ET
    await sat.stops.read();
    expect(sat.plans[0]!.day).toBe('saturday');
    const early = await harness({ events: [ev('m', 'SIM-Fir', '2026-10-21T09:00:00-04:00', '1 SIM Row, Norfolk, VA 23503')] }).stops.read();
    expect(early.stops[0]!.why).toBe('Booked before 4 PM — not in the after-4 run');
    expect(early.stops[0]!.time).toBe('09:00');
  });

  it('Sunday has no R16 rule: nothing is planned, nothing is asked of a map engine, and the plan says why', async () => {
    // The same day's events, dated Sunday (listEvents only returns events that touch the day read).
    const sunday = DAY_EVENTS.map((e) => ({ ...e, startIso: e.startIso.replace('2026-10-21', '2026-10-25'), endIso: e.endIso.replace('2026-10-21', '2026-10-25') }));
    const h = harness({ now: () => new Date('2026-10-25T16:00:00Z'), events: sunday }); // Sun noon ET
    const v = await h.stops.read();
    expect(v.dayKind).toBe('sunday');
    expect(h.plans).toHaveLength(0);
    expect(v.plan!.engine).toBeNull();
    expect(v.plan!.line).toContain('Sunday');
    expect(v.plan!.line).toContain('calendar order');
    expect(v.stops.every((s) => s.plan === null)).toBe(true);
    // "Route the whole day" still has a way: the addressed, timed stops in calendar order.
    expect(v.plan!.order).toEqual([v.stops[0]!.id, v.stops[1]!.id, v.stops[3]!.id]);
  });

  it('an empty calendar that WAS read says nothing is on it; nothing to route is not a plan', async () => {
    const v = await harness({ events: [] }).stops.read();
    expect(v.state).toBe('ok');
    expect(v.stops).toEqual([]);
    expect(v.plan).toBeNull();
  });
});

describe('a calendar Arbo could not read is named — never an empty day (§1B)', () => {
  it('Google not connected', async () => {
    const v = await harness({ calendar: () => null }).stops.read();
    expect(v.state).toBe('google_not_connected');
    expect(v.line).toBe(TODAY_LINES.google_not_connected);
  });

  it('sign-in refused, read refused, anything else — each its own words', async () => {
    const fail = (msg: string) => harness({ events: async () => { throw new Error(msg); } }).stops.read();
    const signin = await fail('token refresh failed: HTTP 400');
    expect(signin.state).toBe('google_signin');
    expect(signin.line!.toLowerCase()).toContain("couldn't read your calendar — google sign-in needs reconnecting");
    expect((await fail('Calendar listEvents failed: 401')).state).toBe('google_signin');
    expect((await fail('Calendar listEvents failed: 403')).state).toBe('calendar_refused');
    expect((await fail('socket hang up')).state).toBe('calendar_error');
    for (const k of Object.keys(TODAY_LINES) as Array<keyof typeof TODAY_LINES>) {
      expect(TODAY_LINES[k]).toContain('not an empty day');
      expect(TODAY_LINES[k].toLowerCase()).not.toContain('nothing on');
    }
  });
});

describe('practice mode', () => {
  it('shows SIM stops, never reads the calendar, never asks a map engine', async () => {
    const h = harness({ practice: () => true, tomtomSet: true });
    const v = await h.stops.read();
    expect(v.state).toBe('practice');
    expect(v.practice).toBe(true);
    expect(h.reads).toHaveLength(0);
    expect(h.plans).toHaveLength(0);
    expect(v.stops.length).toBeGreaterThan(2);
    expect(v.stops.every((s) => s.title.includes('SIM-'))).toBe(true);
    expect(v.stops.some((s) => s.address === null && s.why === 'No address on the event')).toBe(true);
    expect(v.stops.some((s) => /555-01\d\d/.test(s.title))).toBe(true);
    expect(v.plan!.kind).toBe('practice');
  });
});

describe('cost and quiet', () => {
  it('the minute refresh does not re-read the calendar each minute, nor re-plan an unchanged day for 15 minutes', async () => {
    const h = harness();
    await h.stops.read();
    await h.stops.read();
    expect(h.reads).toHaveLength(1);
    h.tick(61_000);
    await h.stops.read();
    expect(h.reads).toHaveLength(2);
    expect(h.plans).toHaveLength(1); // same events, same anchors: the plan in memory
    h.tick(15 * 60_000);
    await h.stops.read();
    expect(h.plans).toHaveLength(2);
  });

  it('logs carry counts and codes — never a title, an address or a name', async () => {
    const logs: string[] = [];
    const h = harness({ log: (l) => logs.push(l) });
    await h.stops.read();
    await harness({ log: (l) => logs.push(l), events: async () => { throw new Error('token refresh failed: HTTP 400'); } }).stops.read();
    expect(logs.length).toBeGreaterThan(1);
    for (const l of logs) {
      expect(l).not.toMatch(/SIM|Simulation|Placeholder|Norfolk|Virginia Beach|555/);
    }
  });
});

describe('the calendar client carries the event location (read only)', () => {
  it('listEvents maps location — still a GET', async () => {
    const seen: string[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      seen.push(init?.method ?? 'GET');
      return new Response(JSON.stringify({ items: [{ id: 'SIM-e1', summary: 'SIM', location: '101 Simulation Row, Virginia Beach, VA 23451', start: { dateTime: '2026-10-21T20:00:00Z' }, end: { dateTime: '2026-10-21T20:20:00Z' } }, { id: 'SIM-e2', summary: 'SIM 2', start: { date: '2026-10-21' }, end: { date: '2026-10-22' } }] }), { status: 200 });
    });
    const events = await createGoogleCalendarApi(async () => 'SIM-token').listEvents('primary', '2026-10-21T04:00:00Z', '2026-10-22T04:00:00Z');
    spy.mockRestore();
    expect(events[0]!.location).toBe('101 Simulation Row, Virginia Beach, VA 23451');
    expect(events[1]!.location).toBeUndefined();
    expect(seen).toEqual(['GET']);
  });
});

describe('GET /api/route/today', () => {
  let server: Server | null = null;
  afterAll(() => { server?.close(); delete process.env.ARBO_DATA_LINKS; });
  async function base(): Promise<string> {
    if (!server) {
      server = createServer(createArborRequestHandler());
      await new Promise<void>((r) => server!.listen(0, r));
    }
    const a = server.address();
    return `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
  }

  it('is behind the owner key like every /api route', async () => {
    const res = await fetch(`${await base()}/api/route/today`);
    expect(res.status).toBe(401);
  });

  it('in practice mode answers SIM stops and names TomTom as not set up', async () => {
    process.env.ARBO_DATA_LINKS = 'sim';
    const net = vi.spyOn(globalThis, 'fetch');
    const res = await ownerFetch(`${await base()}/api/route/today`);
    const calls = net.mock.calls.filter(([u]) => /tomtom|googleapis|google\.com/.test(String(u)));
    net.mockRestore();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; stops: Array<{ title: string }>; tomtom: { set: boolean; line: string } };
    expect(body.state).toBe('practice');
    expect(body.stops.every((s) => s.title.includes('SIM-'))).toBe(true);
    expect(body.tomtom).toMatchObject({ set: false, line: 'TomTom not set up — add TOMTOM_API_KEY in Railway.' });
    expect(calls).toEqual([]); // no map engine or Google read was asked
  });

  it('with no Google sign-in it says so by name', async () => {
    delete process.env.ARBO_DATA_LINKS;
    const res = await ownerFetch(`${await base()}/api/route/today`);
    const body = (await res.json()) as { state: string; line: string };
    expect(body.state).toBe('google_not_connected');
    expect(body.line).toBe(TODAY_LINES.google_not_connected);
  });

  it('POST /api/route/plan names TomTom as not set up beside the engine that did plan', async () => {
    const res = await ownerFetch(`${await base()}/api/route/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ day: 'weekday', stops: [{ label: '1 Example St, Norfolk, 23503', zip: '23503', city: 'Norfolk' }] }),
    });
    const plan = (await res.json()) as BestPlan;
    expect(plan.engine).toBe('zip');
    expect(plan.tomtom).toEqual({ state: 'not_set', line: 'TomTom not set up — add TOMTOM_API_KEY in Railway.' });
  });
});
