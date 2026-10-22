// Maps wave B, M4 (docs/MAPS_PLAN.md "M4 Crew & trucks"): trucks on the map
// from the MAP HOOK, GET /api/fleet/positions — owner only and working hours
// only, both enforced by the server (R31). Every PositionsState is said in the
// server's own words; only `ok` and `unreadable` draw, and `unreadable` draws
// grey (last-known spots). Each motion has its style; no_fix and after_hours
// are listed, never drawn. Dots come down after a failed refresh, when Map
// comes back from hidden (until a fresh answer), and at 8 pm ET by the phone's
// clock — before the server's next answer. A truck's card offers Today's trips
// (TRIPS_SAYS word for word; a 400 shows the server's message; a 404 re-reads
// the positions once). Nothing is stored, nothing logged. Crew are named as
// having no location source (Q8: not built); the crew door gets no map.
import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { loadMapHtml, loadAppHtml, loadCrewHtml } from '../src/server/appPage.js';
import { POSITIONS_SAYS, TRIPS_SAYS } from '../src/integrations/bouncie.js';
import { inspectMessage } from '../src/binder/policyEngine.js';
import { loadAllConfig } from '../src/config/loadConfig.js';

const page = loadMapHtml();
const script = [...page.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)][0]![1]!;
const shell = loadAppHtml();
function srcOf(text: string, name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(text);
  if (!m) throw new Error(`no function ${name}`);
  return m[0];
}
function frameFn<T>(name: string, deps: Record<string, unknown> = {}): T {
  return new Function(...Object.keys(deps), `${srcOf(script, name)}\nreturn ${name};`)(...Object.values(deps)) as T;
}
function constBlock<T>(name: string): T {
  const at = script.indexOf(`\nconst ${name} = {`);
  if (at < 0) throw new Error(`no const ${name} block in the map page`);
  const end = script.indexOf('\n};', at);
  return new Function(`return (${script.slice(script.indexOf('{', at), end + 2)});`)() as T;
}
const MAP_SAYS = constBlock<Record<string, string>>('MAP_SAYS');

type Truck = { id: string; label: string; unit: string | null; lat: number | null; lon: number | null; heading: number | null; motion: string; age: number | null };
const view = (o: Record<string, unknown> = {}) => ({
  id: 'a1b2c3d4e5f6', name: 'Bucket truck', vin4: '1234', device4: '9876', lat: 36.8512345, lon: -76.2856789, heading: 90,
  reportedAt: '2026-10-21T15:00:00Z', ageMinutes: 2, positionAt: '2026-10-21T14:58:00Z', positionAgeMinutes: 3, motion: 'driving', lastTrip: null, ...o,
});
const positions = (state: string, o: Record<string, unknown> = {}) => ({ state, message: (POSITIONS_SAYS as Record<string, string>)[state], readAt: null, units: [], unitsError: null, unmatched: [], ...o });

const agoWords = frameFn<(m: number | null) => string>('agoWords', { MAP_SAYS });
const keepTrucks = frameFn<(b: unknown) => Truck[]>('keepTrucks');
const truckStyle = frameFn<(t: Truck, state: string) => 'solid' | 'grey' | null>('truckStyle');
const truckWords = frameFn<(t: Truck, state: string) => string>('truckWords', { MAP_SAYS, agoWords, truckStyle });
const fleetWhy = frameFn<(e: string, links: string | null) => string>('fleetWhy', { MAP_SAYS });
const truckGaps = frameFn<(T: Record<string, unknown>, links: string | null) => Array<{ cls: string; text: string; retry: unknown }>>('truckGaps', { MAP_SAYS, fleetWhy });
const truckHoursOk = frameFn<(now: Date) => boolean>('truckHoursOk');

describe('what the map keeps of the answer — and nothing more (M4)', () => {
  it('per truck: id, a label (its name, else the last 4 of its VIN), its Fleet unit or none, the fix rounded to 5 decimals, heading, motion, age', () => {
    const ts = keepTrucks(positions('ok', {
      units: [{ unitId: 'u1', unitName: 'Unit 7', match: 'vin', truck: view() }, { unitId: 'u2', unitName: 'Chipper', match: null, truck: null }],
      unmatched: [view({ id: 'ffffffffffff', name: null, vin4: '5678', motion: 'parked', heading: null })],
    }));
    expect(ts).toEqual([
      { id: 'a1b2c3d4e5f6', label: 'Bucket truck', unit: 'Unit 7', lat: 36.85123, lon: -76.28568, heading: 90, motion: 'driving', age: 3 },
      { id: 'ffffffffffff', label: 'VIN …5678', unit: null, lat: 36.85123, lon: -76.28568, heading: null, motion: 'parked', age: 3 },
    ]);
    for (const t of ts) expect(Object.keys(t).sort()).toEqual(['age', 'heading', 'id', 'label', 'lat', 'lon', 'motion', 'unit']);
  });
  it('the answer is cut down as it lands and replaced whole; no coordinate is stored or logged', () => {
    expect(srcOf(script, 'readTrucks')).toContain('keepTrucks(body)');
    expect(script).not.toMatch(/TRUCKS\.\w+ = body\s*[;,)}]/); // the answer itself is never held (its message text may be)
    expect(script).not.toMatch(/console\./);
    expect(page).not.toMatch(/sessionStorage|indexedDB|document\.cookie/);
  });
});

describe('every PositionsState in the server\'s own words; only ok and unreadable draw (M4, §1B)', () => {
  it('each state other than ok and no_trucks is a line, word for word — "This is not \\"no trucks\\"" where the server says it', () => {
    for (const [state, message] of Object.entries(POSITIONS_SAYS)) {
      const lines = truckGaps({ d: { state, message, unitsError: null, trucks: [] }, failed: false, afterHours: false, tripLine: null }, 'readonly');
      if (state === 'ok' || state === 'no_trucks') expect(lines.map((l) => l.text), state).not.toContain(message);
      else expect(lines[0], state).toMatchObject({ text: message });
    }
    expect(truckGaps({ d: positions('keys_missing'), failed: false, afterHours: false, tripLine: null }, 'readonly')[0]!.text).toBe('Bouncie is not set up on the server — BOUNCIE_CLIENT_ID and BOUNCIE_CLIENT_SECRET are missing. This is not "no trucks".');
  });
  it('only ok and unreadable ever draw; unreadable draws every truck grey (its last-known spot)', () => {
    const t = keepTrucks(positions('ok', { unmatched: [view()] }))[0]!;
    for (const state of Object.keys(POSITIONS_SAYS)) {
      const s = truckStyle(t, state);
      if (state === 'ok') expect(s).toBe('solid');
      else if (state === 'unreadable') expect(s).toBe('grey');
      else expect(s, state).toBeNull();
    }
    expect(truckWords(t, 'unreadable')).toMatch(/last known spot/i);
  });
  it('each motion has its style and words; no_fix and after_hours are listed, never drawn; no fix, no dot', () => {
    const T = (motion: string, o: Record<string, unknown> = {}) => keepTrucks(positions('ok', { unmatched: [view({ motion, ...o })] }))[0]!;
    expect(truckStyle(T('driving'), 'ok')).toBe('solid');
    expect(truckStyle(T('parked'), 'ok')).toBe('solid');
    expect(truckStyle(T('seen'), 'ok')).toBe('solid');
    expect(truckStyle(T('stale', { positionAgeMinutes: 190 }), 'ok')).toBe('grey');
    expect(truckStyle(T('unplugged'), 'ok')).toBe('grey');
    expect(truckStyle(T('no_fix', { lat: null, lon: null }), 'ok')).toBeNull();
    expect(truckStyle(T('after_hours'), 'ok')).toBeNull();
    expect(truckStyle(T('driving', { lat: null }), 'ok')).toBeNull();
    expect(truckWords(T('driving'), 'ok')).toBe('Driving · seen 3 min ago');
    expect(truckWords(T('parked', { positionAgeMinutes: 1 }), 'ok')).toBe('Parked · seen 1 min ago');
    expect(truckWords(T('stale', { positionAgeMinutes: 190 }), 'ok')).toBe('Last fix 3 h ago — may have moved');
    expect(truckWords(T('unplugged'), 'ok')).toBe('Bouncie unplugged — last known spot');
    expect(truckWords(T('no_fix'), 'ok')).toBe('No position yet — not on the map');
    expect(truckWords(T('after_hours'), 'ok')).toBe('After hours — where it is now isn’t shown');
  });
  it('the dot sits at the fix (positionAt), never the last report\'s time: the age is positionAgeMinutes', () => {
    const t = keepTrucks(positions('ok', { unmatched: [view({ ageMinutes: 0, positionAgeMinutes: 42 })] }))[0]!;
    expect(t.age).toBe(42);
    expect(truckWords(t, 'ok')).toBe('Driving · seen 42 min ago');
  });
  it('a truck not matched to a Fleet unit says so; a Fleet list that failed is named — cut on purpose, or couldn\'t be read — trucks by VIN', () => {
    expect(MAP_SAYS.truckUnmatched).toBe('Not matched to a Fleet unit');
    for (const [err, word] of [['link_cut', 'cut on purpose'], ['unreadable', 'couldn’t be read']]) {
      const lines = truckGaps({ d: { state: 'ok', message: POSITIONS_SAYS.ok, unitsError: err, trucks: [] }, failed: false, afterHours: false, tripLine: null }, 'readonly');
      expect(lines.map((l) => l.text)).toContain(`Couldn’t read the Fleet list (${word}) — trucks show by VIN.`);
    }
    expect(fleetWhy('db_not_configured', 'readonly')).toBe('not set up yet');
    expect(fleetWhy('db_not_configured', 'cut')).toBe('cut on purpose');
  });
  it('crew are named, always: no crew location source exists (Q8)', () => {
    expect(MAP_SAYS.crew).toBe('Crew aren’t on the map — Arbo has no crew location. Trucks show where crews drive.');
    for (const T of [{ d: positions('keys_missing') }, { failed: true }, {}]) {
      expect(truckGaps({ failed: false, afterHours: false, tripLine: null, d: null, ...T }, 'readonly').at(-1)!.text).toBe(MAP_SAYS.crew);
    }
  });
});

describe('dots come down: a failed refresh, a return from hidden, 8 pm ET (M4)', () => {
  it('Arbo\'s working hours by the ET clock: 8am–8pm, Monday to Saturday — whatever the phone\'s own zone', () => {
    expect(truckHoursOk(new Date('2026-10-21T12:00:00Z'))).toBe(true); // Wed 8:00 AM EDT
    expect(truckHoursOk(new Date('2026-10-21T11:59:00Z'))).toBe(false); // Wed 7:59 AM
    expect(truckHoursOk(new Date('2026-10-21T23:59:00Z'))).toBe(true); // Wed 7:59 PM
    expect(truckHoursOk(new Date('2026-10-22T00:00:00Z'))).toBe(false); // Wed 8:00 PM
    expect(truckHoursOk(new Date('2026-10-25T16:00:00Z'))).toBe(false); // Sunday noon
    expect(truckHoursOk(new Date('2026-10-24T16:00:00Z'))).toBe(true); // Saturday noon
    expect(truckHoursOk(new Date('2026-12-01T13:00:00Z'))).toBe(true); // Tue 8:00 AM EST
  });

  function harness(o: { answer: () => unknown; shown?: boolean }) {
    const did: string[] = [];
    const TRUCKS = { seq: 0, d: null as null | { state: string; trucks: Truck[] }, failed: false as boolean | string, afterHours: false, layer: { clearLayers: () => did.push('clear') }, trips: { clearLayers: () => did.push('clear-trips') }, tripFor: null, tripLine: null, tripsOk: null, tripSeq: 0 };
    const GAPS = { key: [] as unknown[], trucks: [] as unknown[] };
    const deps = {
      TRUCKS, GAPS, ON: { trucks: true }, MAP_SAYS, keepTrucks,
      mapGet: async () => o.answer(), keyGap: () => false, truckHoursOk: () => true,
      setTruckLines: () => did.push('lines'), drawTrucks: () => did.push('draw'), drawStatus: () => {},
    };
    const dropTrucks = frameFn<() => void>('dropTrucks', deps);
    const readTrucks = frameFn<() => Promise<void>>('readTrucks', { ...deps, dropTrucks });
    return { readTrucks, dropTrucks, did, TRUCKS, deps };
  }
  it('a refresh that fails drops every dot (and today\'s trips) and names it with ↻ — never old dots as current', async () => {
    let answer: () => unknown = () => positions('ok', { unmatched: [view()] });
    const h = harness({ answer: () => answer() });
    await h.readTrucks();
    expect(h.TRUCKS.d!.trucks).toHaveLength(1);
    answer = () => { throw Object.assign(new Error('x'), { why: 'unread' }); };
    await h.readTrucks();
    expect(h.TRUCKS.d).toBeNull();
    expect(h.TRUCKS.failed).toBe(true);
    expect(h.did).toContain('clear');
    expect(h.did).toContain('clear-trips');
    const lines = truckGaps({ ...h.TRUCKS }, 'readonly');
    expect(lines[0]).toEqual({ cls: 'unread', text: MAP_SAYS.trucksFailed, retry: true });
    expect(MAP_SAYS.trucksFailed).toMatch(/not “no trucks”/);
  });
  it('an answer without its state is a failed read too', async () => {
    const h = harness({ answer: () => ({ trucks: [] }) });
    await h.readTrucks();
    expect(h.TRUCKS.failed).toBe(true);
    expect(h.did).not.toContain('draw');
  });
  it('Map hidden, or another screen on: the dots come down and stay down until a fresh answer', () => {
    const did: string[] = [];
    const TRUCKS = { seq: 3, d: { state: 'ok', trucks: [] }, failed: false, afterHours: false };
    const pauseTrucks = frameFn<() => void>('pauseTrucks', { TRUCKS, ON: { trucks: true }, dropTrucks: () => { did.push('drop'); TRUCKS.d = null as never; }, setTruckLines: () => did.push('lines') });
    pauseTrucks();
    expect(did).toEqual(['drop', 'lines']);
    expect(TRUCKS.seq).toBe(4); // an answer already on its way is not drawn
    expect(srcOf(script, 'watchShown')).toContain('if (!now && shown) pauseTrucks();');
    expect(script).toMatch(/document\.addEventListener\('visibilitychange', \(\) => \{ if \(document\.hidden\) pauseTrucks\(\);/);
  });
  it('at 8:00 pm ET the dots come down by this phone\'s clock, before the server\'s next answer — and the line says after hours', () => {
    const did: string[] = [];
    const TRUCKS = { d: { state: 'ok', message: POSITIONS_SAYS.ok, unitsError: null, trucks: [{ id: 'a' }] }, afterHours: false, failed: false, tripLine: null };
    const truckTick = frameFn<(now: Date) => void>('truckTick', {
      TRUCKS, ON: { trucks: true }, truckHoursOk, shownNow: () => false, readTrucks: () => did.push('read'),
      dropDots: () => { did.push('drop'); TRUCKS.d.trucks = []; }, setTruckLines: () => did.push('lines'),
    });
    truckTick(new Date('2026-10-21T23:59:30Z')); // 7:59 PM
    expect(did).toEqual([]);
    truckTick(new Date('2026-10-22T00:00:10Z')); // 8:00 PM
    expect(did).toEqual(['drop', 'lines']);
    expect(TRUCKS.afterHours).toBe(true);
    expect(truckGaps({ ...TRUCKS }, 'readonly')[0]!.text).toBe(MAP_SAYS.trucksAfterHours);
    expect(MAP_SAYS.trucksAfterHours).toMatch(/8am–8pm, Monday to Saturday/);
  });
  it('the minute read: only while Trucks is on and Map is on screen', () => {
    const run = (on: boolean, shown: boolean) => {
      const did: string[] = [];
      const truckTick = frameFn<(now: Date) => void>('truckTick', {
        TRUCKS: { d: null, afterHours: false }, ON: { trucks: on }, truckHoursOk: () => true, shownNow: () => shown, readTrucks: () => did.push('read'), dropDots: () => {}, setTruckLines: () => {},
      });
      truckTick(new Date());
      return did;
    };
    expect(run(true, true)).toEqual(['read']);
    expect(run(true, false)).toEqual([]);
    expect(run(false, true)).toEqual([]);
    expect(script).toContain('setInterval(() => truckTick(new Date()), 60000);');
  });
});

describe('Today\'s trips on a truck\'s card (M4)', () => {
  function harness(answer: () => unknown) {
    const did: string[] = [];
    const asked: string[] = [];
    const lines: unknown[] = [];
    const TRUCKS: Record<string, unknown> = { tripSeq: 0, tripFor: null, tripLine: null, tripsOk: null, trips: { clearLayers: () => did.push('clear-trips'), addLayer: (l: { pts: unknown[] }) => did.push('path:' + l.pts.length) } };
    const readTrips = frameFn<(t: { id: string; label: string }) => Promise<void>>('readTrips', {
      TRUCKS, ON: { trucks: true }, MAP_SAYS, etToday: () => '2026-10-21', keyGap: () => false, capPath: frameFn('capPath'), forestColor: () => '#1B4D3E',
      L: { polyline: (pts: unknown[]) => ({ pts }) }, mapGet: async (p: string) => { asked.push(p); return answer(); },
      setTruckLines: () => lines.push(TRUCKS.tripLine), readTrucks: () => did.push('read-positions'), dropTrips: () => did.push('drop-trips'), drawLegend: () => {},
    });
    return { readTrips, did, asked, TRUCKS, lines };
  }
  const t = { id: 'a1b2c3d4e5f6', label: 'Bucket truck' };
  it('asks for this truck on today\'s ET date only', async () => {
    const h = harness(() => ({ state: 'ok', message: TRIPS_SAYS.ok, day: '2026-10-21', trips: [] }));
    await h.readTrips(t);
    expect(h.asked).toEqual(['/api/fleet/trips?truck=a1b2c3d4e5f6&day=2026-10-21']);
  });
  it('every state other than ok is the server\'s own words (TRIPS_SAYS), and nothing is drawn', async () => {
    for (const [state, message] of Object.entries(TRIPS_SAYS)) {
      if (state === 'ok') continue;
      const h = harness(() => ({ state, message, day: '2026-10-21', trips: [] }));
      await h.readTrips(t);
      expect((h.TRUCKS.tripLine as { text: string }).text, state).toBe(message);
      expect(h.did.filter((d) => d.startsWith('path:')), state).toEqual([]);
    }
  });
  it('ok: each trip\'s path drawn, at most 2,000 points a path', async () => {
    const long = Array.from({ length: 5000 }, (_, i) => ({ lat: 36.8 + i / 1e5, lon: -76.3 }));
    const h = harness(() => ({ state: 'ok', message: TRIPS_SAYS.ok, day: '2026-10-21', trips: [{ id: 'x', path: long }, { id: 'y', path: long.slice(0, 10) }, { id: 'z', path: null }] }));
    await h.readTrips(t);
    expect(h.did.filter((d) => d.startsWith('path:'))).toEqual(['path:2000', 'path:10']);
    expect(h.TRUCKS.tripsOk).toContain(TRIPS_SAYS.ok);
  });
  it('a 400 shows the server\'s message; a 404 unknown_truck re-reads the positions once and says the list changed', async () => {
    const bad = harness(() => { throw Object.assign(new Error('unread'), { why: 'unread', code: 400, message: 'bad_day', said: 'day must be a date written YYYY-MM-DD, from 2026-01-01 to today.' }); });
    await bad.readTrips(t);
    expect((bad.TRUCKS.tripLine as { text: string }).text).toBe('day must be a date written YYYY-MM-DD, from 2026-01-01 to today.');
    const gone = harness(() => { throw Object.assign(new Error('unread'), { why: 'unread', code: 404, message: 'unknown_truck', said: 'Arbo doesn’t know that truck id …' }); });
    await gone.readTrips(t);
    expect((gone.TRUCKS.tripLine as { text: string }).text).toBe('The truck list changed — pick the truck again.');
    expect(gone.did.filter((d) => d === 'read-positions')).toHaveLength(1);
  });
  it('mapGet carries the server\'s own message for a refusal, so a 400 can be said', () => {
    expect(srcOf(script, 'mapGet')).toMatch(/said: body && typeof body\.message === 'string' \? body\.message : null/);
  });
});

describe('owner only: the crew door gets no map and no truck read (M4)', () => {
  it('crew.html has no /map and no /api/fleet/; the frame offers no crew chip', () => {
    const crew = loadCrewHtml();
    expect(crew).not.toMatch(/['"`]\/map\b/);
    expect(crew).not.toContain('/api/fleet/');
    expect(constBlockArray('LAYERS')).toEqual(['today', 'permits', 'leads', 'trucks']);
  });
  it('the policy engine still walls tracking (and Bouncie) off every crew surface', () => {
    const { guardrails } = loadAllConfig();
    const v = inspectMessage({ audience: 'crew', channel: 'app', guardrails, text: 'The truck tracking shows the chipper on Oak St.' });
    expect(v.allowed).toBe(false);
    expect(v.blocks.map((b) => b.detail)).toContain('tracking');
  });

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
  it('the crew key is refused on /api/map/today, /api/fleet/positions and /api/fleet/trips', async () => {
    const { base, srv } = await serve({ ARBO_DATA_LINKS: 'sim', APP_ACCESS_KEY: 'owner-key-123', CREW_ACCESS_KEY: 'crew-key-1' });
    try {
      for (const p of ['/api/map/today', '/api/fleet/positions', '/api/fleet/trips?truck=a1b2c3d4e5f6&day=2026-10-21']) {
        expect((await fetch(base + p, { headers: { 'x-arbor-key': 'crew-key-1' } })).status, p).toBe(401);
      }
    } finally { srv.close(); }
  });
});

describe('the way in: Office → Fleet (M4)', () => {
  it('the Fleet screen\'s header carries "Trucks on the map" → the Trucks layer; Back returns to Fleet', () => {
    const s = srcOf(shell, 'renderFleetView');
    expect(s).toContain("'Trucks on the map'");
    expect(s).toContain("openMap('trucks')");
    expect(srcOf(shell, 'deskView')).toContain('if (headExtra) head.appendChild(headExtra());');
  });
});

function constBlockArray(name: string): string[] {
  const m = new RegExp(`\\nconst ${name} = (\\[[^\\]]*\\]);`).exec(script);
  if (!m) throw new Error('no const ' + name);
  return new Function(`return ${m[1]};`)() as string[];
}

// Self-review of wave B (D108): what the first browser run and the reread of the diff found.
describe('review fixes (wave B)', () => {
  it('trips still on their way when the dots come down are never drawn over an empty map', () => {
    const T = { tripSeq: 5, d: { state: 'ok' }, layer: { clearLayers: () => {} }, trips: { clearLayers: () => {} }, tripFor: 'x', tripLine: null, tripsOk: 'x' };
    frameFn<() => void>('dropTrucks', { TRUCKS: T })();
    expect(T.tripSeq).toBe(6);
  });
  it('after hours by this phone\'s clock, "Positions from Bouncie." is not said over the after-hours line', () => {
    const facts = (afterHours: boolean) => {
      const at = script.indexOf('\nFACTS.trucks = () => {');
      const body = script.slice(at + 1, script.indexOf('\n};', at) + 3);
      const FACTS: Record<string, () => Array<{ textContent: string }>> = {};
      const el = (_t: string, _c: string, text = '') => ({ textContent: text, appendChild() {} });
      new Function('FACTS', 'TRUCKS', 'el', 'MAP_SAYS', 'truckStyle', 'truckWords', body)(FACTS, { d: { state: 'ok', message: POSITIONS_SAYS.ok, trucks: [] }, afterHours, tripsOk: null }, el, MAP_SAYS, truckStyle, truckWords);
      return FACTS.trucks!().map((n) => n.textContent);
    };
    expect(facts(false)).toContain(POSITIONS_SAYS.ok);
    expect(facts(true)).not.toContain(POSITIONS_SAYS.ok);
  });
  it('an opened key is scrolled into the notes card; the zoom buttons step aside while a list is open', () => {
    expect(srcOf(script, 'keyButton')).toContain("if (KEY_OPEN) $('card').scrollTop = Math.max(0, $('legend').offsetTop - 8);");
    expect(script).toContain("$('mapbox').classList.add('popopen')");
    expect(script).toContain("$('mapbox').classList.remove('popopen')");
    expect(page).toContain('#mapbox.popopen .leaflet-control-zoom{visibility:hidden}');
  });
  it('the prep sheet\'s two buttons keep a gap side by side and line up when they wrap at 320', () => {
    expect(shell).toContain('.verdict .prep-jc{margin-right:8px}');
    expect(shell).not.toContain('.prep-jc + .prep-jc');
  });
});
