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
import { readFileSync } from 'node:fs';
vi.hoisted(() => { process.env.APP_ACCESS_KEY = 'test-owner-key'; });
import { createTodayStops, type TodayStopsDeps } from '../src/ops/todayStops.js';
import { planRouteBest, planRouteTomTom, ROUTE_MAX_STOPS, type BestPlan, type PlanInput, type PlanStop, type TomTomPlanDeps } from '../src/ops/routePlanner.js';
import { createTomTomClient, TOMTOM_MAX_PLACES, type TomTomFetch } from '../src/integrations/tomtom.js';
import { etDayWindow } from '../src/lib/etDay.js';
import type { CalendarEvent } from '../src/integrations/calendar.js';
import { createArborRequestHandler } from '../src/server.js';
import { ownerFetch } from './ownerKey.js';

// R35 review fixes (2026-10-21). Each test here failed on route-day-2 @
// 2b0cdda and names the review finding it pins. Mike's R16 law stands: 20
// minutes on site, weekday estimates from 4, Saturdays Norfolk/Chesapeake/
// Portsmouth from 8 and Virginia Beach after 12. §1B: what Arbo could not do
// is named, never dressed as an answer.

type Pt = { lat: number; lon: number };
const ev = (id: string, summary: string, startIso: string, location?: string, endIso = startIso): CalendarEvent => ({
  id, summary, startIso, endIso, ...(location ? { location } : {}),
});

function fakeTomTom(opts: { fail?: () => Error | null } = {}) {
  const geocoded: string[] = [];
  const routed: Array<{ points: Pt[]; departAtIso?: string }> = [];
  const where = new Map<string, Pt>();
  let n = 0;
  const deps: TomTomPlanDeps = {
    geocode: async (q) => {
      geocoded.push(q);
      const f = opts.fail?.();
      if (f) throw f;
      if (!where.has(q)) where.set(q, { lat: 36 + ++n / 100, lon: -76 });
      return where.get(q)!;
    },
    route: async (points, o) => {
      routed.push({ points, ...(o.departAtIso ? { departAtIso: o.departAtIso } : {}) });
      const w = points.length - 2;
      return { order: Array.from({ length: w }, (_, i) => i), legMinutes: Array.from({ length: w + 1 }, () => 10) };
    },
    departAt: (min) => `2026-10-24T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00-04:00`,
  };
  return { deps, geocoded, routed, where };
}
const noGoogle = { apiKey: null, fetchMatrix: async () => { throw new Error('never'); } };

function harness(over: Partial<TodayStopsDeps> & { at: string; events: CalendarEvent[] | (() => Promise<CalendarEvent[]>); startZip?: string | null }) {
  const reads: Array<[string, string, string]> = [];
  const plans: PlanInput[] = [];
  let nowMs = Date.parse(over.at);
  let startZip: string | null = over.startZip === undefined ? '23452' : over.startZip;
  const events = over.events;
  const deps: TodayStopsDeps = {
    now: () => new Date(nowMs),
    practice: () => false,
    calendar: () => async (id, a, b) => { reads.push([id, a, b]); return typeof events === 'function' ? events() : events; },
    anchors: () => ({ startZip, homeZip: null }),
    plan: async (input) => { plans.push(input); return planRouteBest(input, { tomtom: null, google: noGoogle }); },
    tomtomSet: false,
    log: () => {},
    ...over,
  };
  return {
    stops: createTodayStops(deps),
    reads,
    plans,
    tick: (ms: number) => { nowMs += ms; },
    setStartZip: (z: string | null) => { startZip = z; },
  };
}

describe('rules #1 — the city is the ZIP’s city, never a street name', () => {
  const SAT_9AM = '2026-10-24T13:00:00Z'; // Sat 09:00 ET
  const day = [
    ev('n', 'SIM-Norfolk stop', '2026-10-24T09:00:00-04:00', '4500 Virginia Beach Blvd, Norfolk, VA 23502'),
    ev('v', 'SIM-VB stop', '2026-10-24T13:00:00-04:00', '1 SIM Row, Virginia Beach, VA 23451'),
  ];

  it('a Norfolk address on Virginia Beach Blvd is Norfolk, runs in the Saturday MORNING, and is not warned as a VB stop', async () => {
    const v = await harness({ at: SAT_9AM, events: day }).stops.read();
    expect(v.stops[0]!.city).toBe('Norfolk');
    expect(v.stops[0]!.plan).toMatchObject({ order: 1, start: '08:00' });
    expect(v.stops[1]!.plan).toMatchObject({ start: '12:00' });
    expect(v.plan!.warnings.join(' ')).not.toMatch(/Virginia Beach stop/);
  });

  it('the same on the TomTom path: the morning run carries the Norfolk stop', async () => {
    const tt = fakeTomTom();
    const h = harness({ at: SAT_9AM, events: day, plan: async (input) => planRouteBest(input, { tomtom: tt.deps, google: noGoogle }), tomtomSet: true });
    const v = await h.stops.read();
    expect(v.plan!.engine).toBe('tomtom');
    expect(tt.routed).toHaveLength(2);
    expect(tt.routed[0]!.points).toHaveLength(3); // start → the Norfolk stop → end
    expect(tt.routed[0]!.points[1]).toEqual(tt.where.get('4500 Virginia Beach Blvd, Norfolk, VA 23502'));
  });

  it('a Suffolk ZIP on Portsmouth Blvd shows Suffolk, not Portsmouth', async () => {
    const v = await harness({ at: '2026-10-21T14:00:00Z', events: [ev('s', 'SIM-Suffolk', '2026-10-21T17:00:00-04:00', '5900 Portsmouth Blvd, Suffolk, VA 23435')] }).stops.read();
    expect(v.stops[0]!.city).toBe('Suffolk');
  });
});

describe('rules #2 — an event that started on an earlier day is not today’s stop', () => {
  it('a multi-day job is listed as ongoing, not routed, and raises no booking warning', async () => {
    const v = await harness({
      at: '2026-10-21T14:00:00Z',
      events: [
        ev('m', 'SIM-Two-day job', '2026-10-20T08:00:00-04:00', '1 SIM Row, Norfolk, VA 23503', '2026-10-21T17:00:00-04:00'),
        ev('e', 'SIM-Estimate', '2026-10-21T16:30:00-04:00', '2 SIM Row, Norfolk, VA 23503'),
      ],
    }).stops.read();
    const m = v.stops[0]!;
    expect(m.ongoing).toBe(true);
    expect(m.time).toBeNull();
    expect(m.why).toBe('Started on an earlier day — not routed');
    expect(m.plan).toBeNull();
    expect(v.plan!.order).toEqual([v.stops[1]!.id]);
    expect(v.plan!.warnings.join(' ')).not.toMatch(/before 4 PM/);
  });
});

describe('rules #3 — the ET day is 23 or 25 hours on a clock change', () => {
  it('etDayWindow ends at the NEXT ET midnight, not 24 hours later', () => {
    const fallBack = etDayWindow('2026-11-01');
    expect(fallBack.startUtc.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(fallBack.endUtc.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    const springForward = etDayWindow('2027-03-14');
    expect(springForward.startUtc.toISOString()).toBe('2027-03-14T05:00:00.000Z');
    expect(springForward.endUtc.toISOString()).toBe('2027-03-15T04:00:00.000Z');
    const plain = etDayWindow('2026-10-21');
    expect(plain.endUtc.getTime() - plain.startUtc.getTime()).toBe(86400_000);
  });

  it('today’s stops read the whole 25-hour day', async () => {
    const h = harness({ at: '2026-11-01T16:00:00Z', events: [] });
    await h.stops.read();
    expect(h.reads[0]![1]).toBe('2026-11-01T04:00:00.000Z');
    expect(h.reads[0]![2]).toBe('2026-11-02T05:00:00.000Z');
  });
});

describe('rules #4 / UI #5 — "tap ↻ to try again" really tries again', () => {
  it('a failed calendar read is not held: the next read asks Google again', async () => {
    let fail = true;
    const h = harness({ at: '2026-10-21T14:00:00Z', events: async () => { if (fail) throw new Error('socket hang up'); return []; } });
    expect((await h.stops.read()).state).toBe('calendar_error');
    fail = false;
    h.tick(5_000);
    expect((await h.stops.read()).state).toBe('ok');
    expect(h.reads).toHaveLength(2);
  });

  it('a plan TomTom failed on is not held: the next read asks again', async () => {
    let tomtomDown = true;
    const tt = fakeTomTom({ fail: () => (tomtomDown ? new Error('TomTom HTTP 500') : null) });
    const h = harness({
      at: '2026-10-21T14:00:00Z',
      events: [ev('e', 'SIM-Estimate', '2026-10-21T16:30:00-04:00', '2 SIM Row, Norfolk, VA 23503')],
      plan: async (input) => planRouteBest(input, { tomtom: tt.deps, google: noGoogle }),
      tomtomSet: true,
    });
    const first = await h.stops.read();
    expect(first.tomtom.state).toBe('failed');
    tomtomDown = false;
    h.tick(5_000);
    const second = await h.stops.read();
    expect(second.tomtom.state).toBe('used');
    expect(second.plan!.engine).toBe('tomtom');
  });
});

describe('UI #5 — Today’s stops re-plan on their own, so the note never asks Mike to', () => {
  it('Google’s "re-plan if you leave much later" is dropped here, and the screen says how the plan updates', async () => {
    const h = harness({
      at: '2026-10-21T14:00:00Z',
      events: [
        ev('a', 'SIM-A', '2026-10-21T16:00:00-04:00', '1 SIM Row, Virginia Beach, VA 23451'),
        ev('b', 'SIM-B', '2026-10-21T16:45:00-04:00', '2 SIM Row, Norfolk, VA 23503'),
      ],
      plan: async (input) => planRouteBest(input, { tomtom: null, google: { apiKey: 'g-key', fetchMatrix: async () => [[0, 5, 9], [5, 0, 7], [9, 7, 0]] } }),
    });
    const v = await h.stops.read();
    expect(v.plan!.engine).toBe('google');
    expect(v.plan!.note).not.toContain('Re-plan');
    expect(v.plan!.note).toContain('re-plans on its own until the run starts');
  });
});

describe('UI #1 — once the run has started, the plan holds (no reshuffle back to done stops)', () => {
  const day = [
    ev('a', 'SIM-A', '2026-10-21T16:00:00-04:00', '1 SIM Row, Virginia Beach, VA 23451'),
    ev('b', 'SIM-B', '2026-10-21T16:45:00-04:00', '2 SIM Row, Norfolk, VA 23503'),
    ev('c', 'SIM-C', '2026-10-21T17:30:00-04:00', '3 SIM Row, Chesapeake, VA 23320'),
  ];

  it('the phone moving mid-run does not re-plan the day', async () => {
    const h = harness({ at: '2026-10-21T20:00:00Z', events: day, startZip: '23451' }); // Wed 16:00 ET
    const first = await h.stops.read();
    h.tick(100 * 60_000); // 17:40 ET
    h.setStartZip('23503');
    const later = await h.stops.read();
    expect(h.plans).toHaveLength(1);
    expect(later.plan!.order).toEqual(first.plan!.order);
    expect(later.stops.map((s) => s.plan)).toEqual(first.stops.map((s) => s.plan));
    expect(later.plan!.note).toContain('held since the run started');
  });

  it('before the run starts, a new start ZIP still re-plans; a calendar change re-plans mid-run', async () => {
    let events = day;
    const h = harness({ at: '2026-10-21T14:00:00Z', events: async () => events, startZip: '23451' }); // 10:00 ET
    await h.stops.read();
    h.setStartZip('23503');
    h.tick(61_000);
    await h.stops.read();
    expect(h.plans).toHaveLength(2);
    h.tick(7 * 3600_000); // 17:01 ET — the run is under way
    await h.stops.read();
    const held = h.plans.length;
    events = [...day, ev('d', 'SIM-D', '2026-10-21T18:30:00-04:00', '4 SIM Row, Norfolk, VA 23505')];
    h.tick(61_000);
    await h.stops.read();
    expect(h.plans.length).toBe(held + 1);
  });
});

describe('UI #2 / rules #6 — a weekday event booked before 4 is not put in the after-4 run', () => {
  it('a morning crew job keeps its own time, says why, and stays out of the plan and its order', async () => {
    const h = harness({
      at: '2026-10-21T14:00:00Z',
      events: [
        ev('j', 'JOB - SIM-Oak removal - crew', '2026-10-21T08:30:00-04:00', '9 SIM Row, Norfolk, VA 23503'),
        ev('e1', 'Estimate - SIM-Alder', '2026-10-21T16:30:00-04:00', '1 SIM Row, Virginia Beach, VA 23451'),
        ev('e2', 'Estimate - SIM-Birch', '2026-10-21T17:15:00-04:00', '2 SIM Row, Norfolk, VA 23503'),
      ],
    });
    const v = await h.stops.read();
    const job = v.stops[0]!;
    expect(job.time).toBe('08:30');
    expect(job.plan).toBeNull();
    expect(job.why).toBe('Booked before 4 PM — not in the after-4 run');
    expect(h.plans[0]!.stops.map((s) => s.id)).toEqual([v.stops[1]!.id, v.stops[2]!.id]);
    expect(v.plan!.order).not.toContain(job.id);
    expect(v.plan!.warnings.join(' ')).not.toMatch(/booked before 4 PM/);
  });
});

describe('UI #6 — lines that are right and say what to do', () => {
  it('"nothing to route" does not claim no address has a ZIP when an all-day event has one', async () => {
    const v = await harness({ at: '2026-10-21T14:00:00Z', events: [ev('d', 'SIM-All day', '2026-10-21', '1 SIM Row, Norfolk, VA 23503')] }).stops.read();
    expect(v.plan!.line).not.toContain('no stop today has an address with a ZIP');
    expect(v.plan!.line).toContain('each one says why');
  });

  const stops: PlanStop[] = [{ id: 'a', label: 'SIM-a', zip: '23503', city: 'Norfolk', address: '1 SIM Row, Norfolk, VA 23503' }];
  it('a refused TomTom key says where to fix it; a rate limit says so; a server error adds nothing', async () => {
    const line = async (msg: string) => (await planRouteBest({ stops, day: 'weekday' }, { tomtom: fakeTomTom({ fail: () => new Error(msg) }).deps, google: noGoogle })).tomtom.line!;
    expect(await line('TomTom HTTP 403')).toContain('Check TOMTOM_API_KEY in Railway');
    expect(await line('TomTom HTTP 401')).toContain('Check TOMTOM_API_KEY in Railway');
    expect(await line('TomTom HTTP 429')).toContain('request limit');
    expect(await line('TomTom HTTP 500')).toBe("TomTom couldn't plan it (TomTom HTTP 500) — these are ZIP estimates.");
  });
});

describe('rules #5 / UI #6 — the TomTom note says what traffic it used, to Mike', () => {
  const stops: PlanStop[] = [
    { id: 'a', label: 'SIM-a', zip: '23503', city: 'Norfolk', address: '1 SIM Row, Norfolk, VA 23503' },
    { id: 'b', label: 'SIM-b', zip: '23505', city: 'Norfolk', address: '2 SIM Row, Norfolk, VA 23505' },
  ];
  it('a run departing at its start time is a FORECAST, not live traffic at planning time', async () => {
    const t = await planRouteTomTom({ stops, day: 'weekday', startZip: '23452' }, fakeTomTom().deps);
    expect(t.note).toContain('forecast');
    expect(t.note).not.toMatch(/at planning time/);
    expect(t.note).not.toContain("Mike's");
    expect(t.note).toContain('your windows');
  });

  it('a run departing now is live traffic', async () => {
    const tt = fakeTomTom();
    const t = await planRouteTomTom({ stops, day: 'weekday', startZip: '23452' }, { ...tt.deps, departAt: () => undefined });
    expect(t.note).toContain('live traffic');
    expect(t.note).not.toContain('forecast');
  });
});

describe('security #1 — TomTom lookups are capped', () => {
  const many = (n: number): PlanStop[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, label: `SIM-${i}`, zip: '23503', city: 'Norfolk', address: `${i} SIM Row, Norfolk, VA 23503` }));

  it('the cap is under TomTom’s 150-waypoint limit; above it TomTom is not asked, and the plan says so', async () => {
    expect(ROUTE_MAX_STOPS).toBeGreaterThanOrEqual(10);
    expect(ROUTE_MAX_STOPS).toBeLessThanOrEqual(148);
    const over = fakeTomTom();
    const p: BestPlan = await planRouteBest({ stops: many(ROUTE_MAX_STOPS + 1), day: 'weekday' }, { tomtom: over.deps, google: noGoogle });
    expect(over.geocoded).toEqual([]);
    expect(over.routed).toEqual([]);
    expect(p.engine).toBe('zip');
    expect(p.tomtom.state).toBe('too_many');
    expect(p.tomtom.line).toContain(String(ROUTE_MAX_STOPS));
    const at = fakeTomTom();
    expect((await planRouteBest({ stops: many(ROUTE_MAX_STOPS), day: 'weekday' }, { tomtom: at.deps, google: noGoogle })).engine).toBe('tomtom');
  });

  it('the day’s geocode memory has a ceiling', async () => {
    let calls = 0;
    const fn: TomTomFetch = async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({ results: [{ position: { lat: 36.8, lon: -76.2 }, address: { countrySubdivision: 'VA' } }] }) };
    };
    const client = createTomTomClient('tt-test-key', { fetchFn: fn, today: () => '2026-10-21' });
    for (let i = 0; i <= TOMTOM_MAX_PLACES; i++) await client.geocode(`${i} SIM Row`);
    expect(calls).toBe(TOMTOM_MAX_PLACES + 1);
    await client.geocode(`${TOMTOM_MAX_PLACES} SIM Row`); // the newest is still remembered
    expect(calls).toBe(TOMTOM_MAX_PLACES + 1);
    await client.geocode('0 SIM Row'); // the oldest made room
    expect(calls).toBe(TOMTOM_MAX_PLACES + 2);
  });

  describe('POST /api/route/plan', () => {
    let server: Server | null = null;
    afterAll(() => { server?.close(); });
    async function base(): Promise<string> {
      if (!server) {
        server = createServer(createArborRequestHandler());
        await new Promise<void>((r) => server!.listen(0, r));
      }
      const a = server.address();
      return `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
    }
    const post = async (n: number) => ownerFetch(`${await base()}/api/route/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ day: 'weekday', stops: Array.from({ length: n }, (_, i) => ({ label: `${i} Example St, Norfolk`, zip: '23503' })) }),
    });

    it('refuses more stops than one day can hold, before any engine is asked', async () => {
      const res = await post(ROUTE_MAX_STOPS + 1);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; max: number; line: string };
      expect(body).toMatchObject({ error: 'too_many_stops', max: ROUTE_MAX_STOPS });
      expect(body.line).toContain(`up to ${ROUTE_MAX_STOPS} stops`); // the planner box shows the server's words
      expect(readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8')).toContain("pout.appendChild(el('div', 'storm', (e && e.line) || T('Could not plan the route"); // R27 Phase A (es-owner-a)
      expect((await post(1000)).status).toBe(400);
      expect((await post(ROUTE_MAX_STOPS)).status).toBe(200);
    });
  });
});
