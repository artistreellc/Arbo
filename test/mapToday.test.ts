// Maps wave A, M1 (docs/MAPS_PLAN.md "M1 Today's stops + route"): today's
// calendar stops on the map. The map NEVER asks TomTom itself — an exact pin
// comes only from TomTom's day memory, where the R35 planner already put it
// (peek). Every other stop with a ZIP sits at its ZIP area (hollow, grouped),
// and every stop that can't be drawn is named with why (§1B). Numbers follow
// R35's plan only when an engine planned it. Calendar's /api/route/today stays
// exactly as it was: the phone gets what it shows, and no coordinate.
import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
vi.hoisted(() => { process.env.APP_ACCESS_KEY = 'test-owner-key'; });
import { createTodayStops, TODAY_LINES, type TodayStopsDeps } from '../src/ops/todayStops.js';
import { planRouteBest, addressOf } from '../src/ops/routePlanner.js';
import { createTomTomClient, TOMTOM_NOT_SET_LINE, type TomTomFetch } from '../src/integrations/tomtom.js';
import type { CalendarEvent } from '../src/integrations/calendar.js';
import { buildMapToday } from '../src/ops/mapToday.js';
import { ZIP_WHY, type ZipPlace } from '../src/lib/zipCentroids.js';
import { OWNER_KEY } from './ownerKey.js';

const WED = new Date('2026-10-21T14:00:00Z'); // Wed 10:00 ET
const SUN = new Date('2026-10-25T14:00:00Z'); // Sun 10:00 ET
const ev = (id: string, summary: string, startIso: string, location?: string): CalendarEvent => ({ id, summary, startIso, endIso: startIso, ...(location ? { location } : {}) });

// Test points only — fake, inside the four-city box, never shipped.
const TEST_ZIPS: Record<string, { lat: number; lon: number }> = { '23451': { lat: 36.85, lon: -76.0 }, '23503': { lat: 36.93, lon: -76.25 }, '23320': { lat: 36.75, lon: -76.22 } };
const testZip = (zip: string | null): ZipPlace => {
  if (!zip) return { ok: false, why: 'outside' };
  if (zip === '23541') return { ok: false, why: 'no_area' };
  if (zip === '23434') return { ok: false, why: 'outside' };
  const p = TEST_ZIPS[zip];
  return p ? { ok: true, ...p } : { ok: false, why: 'not_loaded' };
};

/** A TomTom that answers by a spy: geocodes from a table, routes in the order given. */
function tomtomSpy(places: Record<string, [number, number] | null>, status = 200) {
  const calls: string[] = [];
  const fetchFn: TomTomFetch = async (url) => {
    calls.push(url);
    if (status !== 200) return { ok: false, status, json: async () => ({}) };
    if (url.includes('/search/2/geocode/')) {
      const q = decodeURIComponent(url.split('/search/2/geocode/')[1]!.split('.json')[0]!);
      const hit = Object.entries(places).find(([k]) => q === k.trim().replace(/[.\s]+$/, ''));
      const p = hit ? hit[1] : [36.86, -76.1];
      return { ok: true, status: 200, json: async () => ({ results: p ? [{ position: { lat: p[0], lon: p[1] }, address: { countrySubdivision: 'VA' } }] : [] }) };
    }
    const locs = url.split('/calculateRoute/')[1]!.split('/json')[0]!.split(':');
    const w = locs.length - 2;
    return { ok: true, status: 200, json: async () => ({ routes: [{ legs: Array.from({ length: w + 1 }, () => ({ summary: { travelTimeInSeconds: 600 } })) }], optimizedWaypoints: Array.from({ length: w }, (_, i) => ({ providedIndex: i, optimizedIndex: i })) }) };
  };
  return { calls, fetchFn };
}

function harness(o: { events?: CalendarEvent[]; now?: Date; practice?: boolean; tomtom?: ReturnType<typeof tomtomSpy> | null; calendarFails?: Error; noCalendar?: boolean } = {}) {
  const now = o.now ?? WED;
  const day = '2026-10-' + String(now.getUTCDate()).padStart(2, '0');
  const client = o.tomtom ? createTomTomClient('SECRET-TT-KEY', { fetchFn: o.tomtom.fetchFn, today: () => day, timeoutMs: 500 }) : null;
  const logs: string[] = [];
  const deps: TodayStopsDeps = {
    now: () => now,
    practice: () => o.practice ?? false,
    calendar: () => (o.noCalendar ? null : async () => { if (o.calendarFails) throw o.calendarFails; return o.events ?? []; }),
    anchors: () => ({ startZip: null, homeZip: null }),
    plan: (input) => planRouteBest(input, { tomtom: client ? { geocode: (q) => client.geocode(q), route: (p, x) => client.route(p, x) } : null, google: { apiKey: null, fetchMatrix: async () => [] } }),
    tomtomSet: client !== null,
    log: (l) => logs.push(l),
  };
  const stops = createTodayStops(deps);
  const peek = client ? (q: string) => client.peek(q) : () => undefined;
  return { stops, client, logs, map: async () => buildMapToday(await stops.readRows(), { peek, zipPoint: testZip, practice: o.practice ?? false }) };
}

const DAY = [
  ev('a', 'SIM-Alder', '2026-10-21T16:00:00-04:00', '101 Simulation Row, Virginia Beach, VA 23451'),
  ev('b', 'SIM-Birch', '2026-10-21T17:00:00-04:00', '202 Placeholder Way, Norfolk, VA 23503'),
  ev('c', 'SIM-Cedar', '2026-10-21T09:00:00-04:00', '303 Fictional Ct, Chesapeake, VA 23320'), // before 4: skipped by the planner
  ev('d', 'SIM-Dogwood call', '2026-10-21T18:00:00-04:00'), // no address
];

describe('the calendar states: R35\'s own line, and no pins', () => {
  it.each([
    ['google_not_connected', { noCalendar: true }],
    ['google_signin', { calendarFails: new Error('listEvents failed: 401 unauthorized') }],
    ['calendar_refused', { calendarFails: new Error('listEvents failed: 403 forbidden') }],
    ['calendar_error', { calendarFails: new Error('socket hang up') }],
  ] as const)('%s', async (state, o) => {
    const m = await harness(o).map();
    expect(m.state).toBe(state);
    expect(m.line).toBe(TODAY_LINES[state]);
    expect(m.stops).toEqual([]);
    expect(m.notOnMap).toEqual([]);
    expect(m.counts).toEqual({ events: null, onMap: 0, notOnMap: 0 }); // unknown, never 0 events
  });

  it('a good read of an empty day: state ok, zero events — the frame may say the day is empty only now', async () => {
    const m = await harness({ events: [] }).map();
    expect(m.state).toBe('ok');
    expect(m.line).toBeNull();
    expect(m.counts).toEqual({ events: 0, onMap: 0, notOnMap: 0 });
  });
});

describe('exact pins come only from the planner\'s TomTom memory', () => {
  it('after a plan, peek returns the planner\'s point and the stop is exact; the map adds no TomTom call', async () => {
    const tt = tomtomSpy({ '101 Simulation Row, Virginia Beach, VA 23451': [36.8512345, -75.9876549], '202 Placeholder Way, Norfolk, VA 23503': [36.9312, -76.2509] });
    const h = harness({ events: DAY, tomtom: tt });
    await h.stops.read(); // Calendar's read plans the day
    const before = tt.calls.length;
    expect(before).toBeGreaterThan(0);
    const m = await h.map();
    expect(tt.calls.length, 'the map asked TomTom nothing').toBe(before);
    const a = m.stops.find((s) => s.id === 's1')!;
    expect(a).toMatchObject({ placedBy: 'tomtom', lat: 36.85123, lon: -75.98765, n: 1, title: 'SIM-Alder', city: 'Virginia Beach' });
    expect(h.client!.peek(addressOf({ label: 'x', zip: '23451', address: '101 Simulation Row, Virginia Beach, VA 23451' }))).toEqual({ lat: 36.8512345, lon: -75.9876549 });
  });

  it('a stop the planner skips (before 4 PM) gets a ZIP-area pin with R35\'s why and no number — TomTom is never asked for it', async () => {
    const tt = tomtomSpy({});
    const h = harness({ events: DAY, tomtom: tt });
    const m = await h.map();
    const c = m.stops.find((s) => s.title === 'SIM-Cedar')!;
    expect(c).toMatchObject({ placedBy: 'zip', n: null, why: 'Booked before 4 PM — not in the after-4 run', lat: 36.75, lon: -76.22 });
    expect(tt.calls.some((u) => u.includes(encodeURIComponent('303 Fictional Ct'))), 'the skipped address never went to TomTom').toBe(false);
  });

  it('without the key: ZIP-area pins, numbered by the ZIP plan, and TOMTOM_NOT_SET_LINE', async () => {
    const m = await harness({ events: DAY }).map();
    expect(m.tomtomLine).toBe(TOMTOM_NOT_SET_LINE);
    expect(m.engine).toBe('zip');
    expect(m.stops.filter((s) => s.n !== null).map((s) => [s.n, s.placedBy, s.title])).toEqual([[1, 'zip', 'SIM-Alder'], [2, 'zip', 'SIM-Birch']]);
  });

  it('on a TomTom 403: the fixed code only — no key and no TomTom address in the answer or the log', async () => {
    const tt = tomtomSpy({}, 403);
    const h = harness({ events: DAY, tomtom: tt });
    const m = await h.map();
    expect(m.tomtomLine).toContain('TomTom HTTP 403');
    const body = JSON.stringify(m) + h.logs.join('\n');
    expect(body).not.toContain('SECRET-TT-KEY');
    expect(body).not.toMatch(/api\.tomtom\.com|key=/);
    expect(m.stops.every((s) => s.placedBy === 'zip')).toBe(true);
  });

  it('a TomTom pin outside the four cities is drawn, and its reason is never "ZIP outside the four cities"', async () => {
    const tt = tomtomSpy({ '9 Far Rd, Suffolk, VA 23434': [36.72, -76.58] });
    const m = await harness({ events: [ev('x', 'SIM-Far', '2026-10-21T16:00:00-04:00', '9 Far Rd, Suffolk, VA 23434')], tomtom: tt }).map();
    expect(m.stops).toHaveLength(1);
    expect(m.stops[0]).toMatchObject({ placedBy: 'tomtom', outside: true, n: 1 });
    expect(m.stops[0]!.why).not.toBe(ZIP_WHY.outside);
    expect(m.notOnMap).toEqual([]);
  });
});

describe('ZIP-area pins and the stops not on the map', () => {
  it('two stops in one ZIP share one point — the frame groups them; each keeps its own time and number', async () => {
    const m = await harness({ events: [ev('a', 'SIM-One', '2026-10-21T16:00:00-04:00', '1 Sim St, Norfolk, VA 23503'), ev('b', 'SIM-Two', '2026-10-21T16:40:00-04:00', '2 Sim St, Norfolk, VA 23503')] }).map();
    expect(m.stops.map((s) => [s.title, s.lat, s.lon, s.placedBy, s.time])).toEqual([['SIM-One', 36.93, -76.25, 'zip', '16:00'], ['SIM-Two', 36.93, -76.25, 'zip', '16:40']]);
  });

  it('each stop the map can\'t draw is named with why; the counts say how many', async () => {
    const m = await harness({
      events: [
        ...DAY,
        ev('e', 'SIM-Elm', '2026-10-21T16:30:00-04:00', '5 Box Rd, Norfolk, VA 23541'), // a PO box ZIP
        ev('f', 'SIM-Fir', '2026-10-21T16:50:00-04:00', '6 Out Rd, Suffolk, VA 23434'), // outside, no TomTom point
        ev('g', 'SIM-Gum', '2026-10-21T17:10:00-04:00', '7 Nozip Ln, Norfolk'),
        ev('h', 'SIM-Holly', '2026-10-21T17:20:00-04:00', '8 Sim Pl, Portsmouth, VA 23704'), // accepted, not in the test table
      ],
    }).map();
    expect(m.notOnMap).toEqual([
      { id: 's4', title: 'SIM-Dogwood call', why: 'No address on the event' },
      { id: 's5', title: 'SIM-Elm', why: ZIP_WHY.no_area },
      { id: 's6', title: 'SIM-Fir', why: ZIP_WHY.outside },
      { id: 's7', title: 'SIM-Gum', why: 'No ZIP in the address — not in the plan' },
      { id: 's8', title: 'SIM-Holly', why: ZIP_WHY.not_loaded },
    ]);
    expect(m.counts).toEqual({ events: 8, onMap: 3, notOnMap: 5 });
    expect(m.stops.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });

  it('points carry 5 decimals at most, and only the fields the map draws', async () => {
    const m = await harness({ events: DAY }).map();
    for (const s of m.stops) {
      expect(Object.keys(s).sort()).toEqual(['address', 'city', 'id', 'lat', 'lon', 'n', 'outside', 'placedBy', 'time', 'title', 'why']);
      expect(Math.round(s.lat * 1e5) / 1e5).toBe(s.lat);
    }
    expect(JSON.stringify(m)).not.toMatch(/"zip":/); // no ZIP key (the value "zip" names the engine)
  });
});

describe('numbers follow R35\'s plan', () => {
  it('Sunday: SUNDAY_LINE word for word, engine null, no numbers', async () => {
    const m = await harness({ now: SUN, events: [ev('a', 'SIM-Sun', '2026-10-25T13:00:00-04:00', '1 Sim St, Norfolk, VA 23503')] }).map();
    expect(m.engine).toBeNull();
    expect(m.planLine).toBe('Sunday has no route rule yet (R16 covers weekdays and Saturdays), so nothing was planned — stops are in calendar order.');
    expect(m.stops[0]!.n).toBeNull();
  });

  it('engine null for any reason means no numbers', async () => {
    const m = await harness({ events: [ev('c', 'SIM-Cedar', '2026-10-21T09:00:00-04:00', '303 Fictional Ct, Chesapeake, VA 23320')] }).map();
    expect(m.engine).toBeNull(); // nothing routable
    expect(m.stops.every((s) => s.n === null)).toBe(true);
  });
});

describe('practice', () => {
  it('SIM stops; TomTom and Census are never asked; the practice flag rides the answer (the frame words the banner)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    try {
      const m = await harness({ practice: true }).map();
      expect(m.practice).toBe(true);
      expect(m.state).toBe('practice');
      expect(m.stops.every((s) => s.placedBy === 'practice')).toBe(true);
      expect(spy.mock.calls.map((c) => String(c[0])).filter((u) => /tomtom|census/i.test(u))).toEqual([]);
    } finally { spy.mockRestore(); }
  });
});

describe('Calendar\'s own answer is unchanged', () => {
  it('/api/route/today\'s stops keep exactly R35\'s fields — no ZIP, no coordinate', async () => {
    const h = harness({ events: DAY });
    const v = await h.stops.read();
    for (const s of v.stops) expect(Object.keys(s)).toEqual(['id', 'time', 'allDay', 'ongoing', 'title', 'city', 'address', 'why', 'plan']);
    expect(JSON.stringify(v)).not.toMatch(/"zip":|"lat":|"lon":/);
  });

  it('readRows and read share one in-flight build and one plan memory', async () => {
    let reads = 0;
    const deps: TodayStopsDeps = {
      now: () => WED, practice: () => false, anchors: () => ({ startZip: null, homeZip: null }), tomtomSet: false, log: () => {},
      calendar: () => async () => { reads++; await new Promise((r) => setTimeout(r, 5)); return DAY; },
      plan: (input) => planRouteBest(input, { tomtom: null, google: { apiKey: null, fetchMatrix: async () => [] } }),
    };
    const s = createTodayStops(deps);
    const [a, b] = await Promise.all([s.read(), s.readRows()]);
    expect(reads).toBe(1);
    expect(a.stops.map((x) => x.id)).toEqual(b.stops.map((x) => x.id));
    expect(b.stops[0]!.zip).toBe('23451');
  });
});

describe('GET /api/map/today', () => {
  const saved = { ...process.env };
  afterAll(() => { process.env = { ...saved }; vi.resetModules(); });
  beforeEach(() => { vi.resetModules(); });
  async function serve(env: Record<string, string | undefined>): Promise<{ base: string; srv: Server }> {
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    const { createArborRequestHandler } = await import('../src/server.js');
    const srv = createServer(createArborRequestHandler());
    await new Promise<void>((r) => srv.listen(0, r));
    const addr = srv.address();
    return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, srv };
  }

  it('owner key: 200, no-store; in practice no TomTom or Census call', async () => {
    const { base, srv } = await serve({ ARBO_DATA_LINKS: 'sim', APP_ACCESS_KEY: OWNER_KEY, CREW_ACCESS_KEY: 'crew-key-1' });
    const spy = vi.spyOn(globalThis, 'fetch');
    try {
      const r = await fetch(base + '/api/map/today', { headers: { 'x-arbor-key': OWNER_KEY } });
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
      const b = await r.json() as { practice: boolean; counts: { events: number } };
      expect(b.practice).toBe(true);
      expect(b.counts.events).toBe(4);
      const out = spy.mock.calls.map((c) => String(c[0])).filter((u) => !u.startsWith(base));
      expect(out.filter((u) => /tomtom|census/i.test(u))).toEqual([]);
    } finally { spy.mockRestore(); srv.close(); }
  });

  it('the crew key is refused, and so is a key in the address', async () => {
    const { base, srv } = await serve({ ARBO_DATA_LINKS: 'sim', APP_ACCESS_KEY: OWNER_KEY, CREW_ACCESS_KEY: 'crew-key-1' });
    try {
      expect((await fetch(base + '/api/map/today', { headers: { 'x-arbor-key': 'crew-key-1' } })).status).toBe(401);
      expect((await fetch(base + '/api/map/today?key=' + OWNER_KEY)).status).toBe(401);
    } finally { srv.close(); }
  });

  it('no APP_ACCESS_KEY: locked, 401 no_app_key', async () => {
    const { base, srv } = await serve({ ARBO_DATA_LINKS: 'sim', APP_ACCESS_KEY: undefined });
    try {
      const r = await fetch(base + '/api/map/today', { headers: { 'x-arbor-key': OWNER_KEY } });
      expect(r.status).toBe(401);
      expect((await r.json() as { error: string }).error).toBe('no_app_key');
    } finally { srv.close(); }
  });
});
