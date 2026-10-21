// Maps wave A, M1 (docs/MAPS_PLAN.md "M1 Today's stops + route"): the map
// frame's Today helpers, lifted out of the SERVED page and run — numbers follow
// R35's plan, a pin with no number shows none, the dashed line joins numbered
// pins only, the counts line and the practice banner render, the empty-day line
// shows only after a good read, and the pan limit holds every placed pin (§1B).
// Also the Map button in Calendar's Today's stops header; the calendar frame
// below it is untouched (R2).
import { describe, it, expect } from 'vitest';
import { loadMapHtml, loadAppHtml } from '../src/server/appPage.js';
import { FOUR_CITY_BOX } from '../src/lib/zipCentroids.js';

const page = loadMapHtml();
const script = [...page.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)][0]![1]!;
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

type Stop = { id: string; n: number | null; time: string | null; title: string; city: string | null; address: string; lat: number; lon: number; placedBy: 'tomtom' | 'zip' | 'practice'; why: string | null; outside: boolean };
const S = (o: Partial<Stop>): Stop => ({ id: 's1', n: null, time: '16:00', title: 'SIM-A', city: 'Norfolk', address: '1 Sim St, Norfolk, VA 23503', lat: 36.93, lon: -76.25, placedBy: 'zip', why: null, outside: false, ...o });

describe('Today on the map: the frame\'s helpers (M1)', () => {
  const byTime = frameFn<(a: Stop, b: Stop) => number>('byTime');
  const mapGroups = frameFn<(s: Stop[]) => Array<{ lat: number; lon: number; exact: boolean; practice: boolean; stops: Stop[] }>>('mapGroups', { byTime });
  const routeLine = frameFn<(s: Stop[]) => number[][]>('routeLine');
  const pinText = frameFn<(g: { stops: Stop[] }) => string>('pinText');
  const panBox = frameFn<(box: typeof FOUR_CITY_BOX, s: Stop[]) => number[][]>('panBox');
  const countsLine = frameFn<(d: { counts: { events: number | null; onMap: number; notOnMap: number } }) => string | null>('countsLine', { MAP_SAYS });
  const todayLines = frameFn<(d: Record<string, unknown>) => Array<{ cls: string; text: string; retry: boolean }>>('todayLines', { MAP_SAYS });
  const todayFacts = frameFn<(d: Record<string, unknown>) => string[]>('todayFacts', { MAP_SAYS });
  const planNote = frameFn<(d: Record<string, unknown>) => string | null>('planNote');

  it('two stops in one ZIP area: one hollow marker listing both, in time order; an exact pin at the same spot stays its own', () => {
    const g = mapGroups([S({ id: 's2', time: '17:00', title: 'SIM-Late' }), S({ id: 's1', time: '16:00', title: 'SIM-Early' }), S({ id: 's3', placedBy: 'tomtom', title: 'SIM-Exact' })]);
    expect(g).toHaveLength(2);
    expect(g[0]!.exact).toBe(false);
    expect(g[0]!.stops.map((s) => s.title)).toEqual(['SIM-Early', 'SIM-Late']);
    expect(g[1]!.exact).toBe(true);
  });

  it('a pin\'s text is its plan numbers; a pin with n:null has no number', () => {
    expect(pinText({ stops: [S({ n: 2 }), S({ n: 1 })] })).toBe('1·2');
    expect(pinText({ stops: [S({ n: null })] })).toBe('');
    expect(pinText({ stops: [S({ n: null }), S({ n: null })] })).toBe('');
  });

  it('the dashed line joins numbered pins only, in the plan\'s order', () => {
    const line = routeLine([S({ n: 2, lat: 1, lon: 1 }), S({ n: null, lat: 9, lon: 9 }), S({ n: 1, lat: 0, lon: 0 }), S({ n: 3, lat: 2, lon: 2 })]);
    expect(line).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(routeLine([S({ n: 1 })])).toEqual([]); // one stop: nothing to join
  });

  it('the counts line: always shown after a read with events, never a count over a calendar not read', () => {
    expect(countsLine({ counts: { events: 8, onMap: 6, notOnMap: 2 } })).toBe('6 of 8 events on the map · 2 not on the map');
    expect(countsLine({ counts: { events: 1, onMap: 1, notOnMap: 0 } })).toBe('1 of 1 event on the map');
    expect(countsLine({ counts: { events: null, onMap: 0, notOnMap: 0 } })).toBeNull();
    expect(countsLine({ counts: { events: 0, onMap: 0, notOnMap: 0 } })).toBeNull();
  });

  it('a calendar not read: R35\'s line, and never the empty-day line', () => {
    const d = { state: 'google_signin', line: "Couldn't read your calendar — Google sign-in needs reconnecting (Settings → Reconnect Google). This is not an empty day.", practice: false, tomtomLine: null, counts: { events: null, onMap: 0, notOnMap: 0 }, stops: [] };
    expect(todayLines(d)).toEqual([{ cls: 'unread', text: d.line, retry: true }]);
    expect(todayFacts(d)).not.toContain(MAP_SAYS.emptyDay);
    expect(planNote(d)).toBeNull();
    expect(todayLines({ ...d, state: 'google_not_connected' })[0]!.cls).toBe('unset');
  });

  it('the empty-day line only after a good read', () => {
    const ok = { state: 'ok', line: null, practice: false, tomtomLine: null, counts: { events: 0, onMap: 0, notOnMap: 0 }, stops: [] };
    expect(todayFacts(ok)).toContain(MAP_SAYS.emptyDay);
    expect(todayLines(ok)).toEqual([]);
    expect(MAP_SAYS.emptyDay).toBe('Nothing on your Google Calendar today.');
  });

  it('practice: the banner; TomTom\'s own line named; the plan line shown', () => {
    const d = { state: 'practice', line: null, practice: true, tomtomLine: 'TomTom not set up — add TOMTOM_API_KEY in Railway.', planLine: 'Practice plan — ZIP estimates · 3 stops', counts: { events: 4, onMap: 3, notOnMap: 1 }, stops: [] };
    expect(todayLines(d)).toEqual([
      { cls: 'sim', text: 'PRACTICE DATA — pins sit in their ZIP area; these are not real places.', retry: false },
      { cls: 'unset', text: 'TomTom not set up — add TOMTOM_API_KEY in Railway.', retry: false },
    ]);
    expect(MAP_SAYS.practice).toBe('PRACTICE DATA — pins sit in their ZIP area; these are not real places.');
    expect(planNote(d)).toBe('Practice plan — ZIP estimates · 3 stops');
    expect(todayFacts(d)).toEqual([]);
    const failed = todayLines({ ...d, practice: false, state: 'ok', tomtomLine: "TomTom couldn't plan it (TomTom HTTP 403) — these are ZIP estimates." });
    expect(failed).toEqual([{ cls: 'unread', text: "TomTom couldn't plan it (TomTom HTTP 403) — these are ZIP estimates.", retry: false }]);
  });

  it('the pan limit holds the four cities and every placed pin, padded — even one far outside', () => {
    const b = panBox(FOUR_CITY_BOX, [S({ lat: 37.5, lon: -77.4 }), S({ lat: 36.8, lon: -76.1 })]);
    expect(b[0]![0]).toBeLessThan(FOUR_CITY_BOX.south);
    expect(b[0]![1]).toBeLessThan(-77.4);
    expect(b[1]![0]).toBeGreaterThan(37.5);
    expect(b[1]![1]).toBeGreaterThan(FOUR_CITY_BOX.east);
    const plain = panBox(FOUR_CITY_BOX, []);
    expect(plain[0]![0]).toBeLessThan(FOUR_CITY_BOX.south);
    expect(plain[1]![1]).toBeGreaterThan(FOUR_CITY_BOX.east);
  });

  it('the legend says what the lines and pins are, in the plan\'s words', () => {
    expect(MAP_SAYS.orderOnly).toBe('Order only — straight lines, not roads. Google Maps draws the road.');
    expect(MAP_SAYS.zipArea).toBe('ZIP area — not the exact spot');
    expect(MAP_SAYS.outside).toBe('placed outside the four cities');
    expect(MAP_SAYS.tilesFailed).toBe('Street map didn’t load (OpenStreetMap) — pins are still placed; this is not an empty map.');
    expect(MAP_SAYS.offline).toBe('No signal — the street map needs one.');
    expect(MAP_SAYS.noKey).toBe('Open Arbo and enter the key first.');
    expect(MAP_SAYS.outsideShell).toBe('Open Map from Arbo.');
  });
});

describe('the Today pins are DOM nodes with their own icon (M1)', () => {
  it('every marker is L.marker with a divIcon whose html is a node built by pinNode', () => {
    const calls = [...script.matchAll(/L\.marker\(([^\n]*)/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c[1]).toContain('icon:');
    expect(script).toMatch(/\bhtml: pinNode\(/);
    expect(srcOf(script, 'pinNode')).toContain('textContent');
  });
});

const shell = loadAppHtml();
describe('the Map button in Calendar\'s Today\'s stops header (M1)', () => {
  it('sits in the header, beside the plan, and opens the Today layer', () => {
    const r = srcOf(shell, 'renderTodayStops');
    expect(r).toContain('todayStopsHead()');
    const h = srcOf(shell, 'todayStopsHead');
    expect(h).toContain("openMap('today')");
    expect(h).toContain("'Map'");
  });
  it('the calendar frame below is untouched (R2)', () => {
    expect(srcOf(shell, 'renderCalendar')).toContain("frame.id = 'gcal-frame';");
    expect(srcOf(shell, 'renderCalendar')).toContain('frame.src = gcalEmbedUrl();');
  });
});

// Review round (D106): the frame on an old day, and a throttled connection named as what it is (§1B).
describe('the map never sits on an old day (review round)', () => {
  const etToday = frameFn<(now: Date) => string | null>('etToday');
  const staleDay = frameFn<(day: unknown, today: string | null) => boolean>('staleDay');

  it('etToday is the ET calendar day, whatever the phone\'s own zone', () => {
    expect(etToday(new Date('2026-10-22T03:30:00Z'))).toBe('2026-10-21'); // 11:30 PM EDT
    expect(etToday(new Date('2026-10-22T04:30:00Z'))).toBe('2026-10-22'); // 12:30 AM EDT
    expect(etToday(new Date('2026-12-01T04:30:00Z'))).toBe('2026-11-30'); // 11:30 PM EST
  });

  it('a drawn day that is not today is stale; an unknown clock never clears anything', () => {
    expect(staleDay('2026-10-21', '2026-10-22')).toBe(true);
    expect(staleDay('2026-10-22', '2026-10-22')).toBe(false);
    expect(staleDay('2026-10-21', null)).toBe(false);
    expect(staleDay(undefined, '2026-10-22')).toBe(false);
  });

  function tickHarness(o: { shown: boolean; day: string | null; today: string }) {
    const did: string[] = [];
    const GAPS: Record<string, unknown[]> = { today: [] };
    const TODAY = { d: o.day ? { day: o.day } : null };
    const dropStaleDay = frameFn<() => void>('dropStaleDay', {
      TODAY, staleDay, etToday: () => o.today, GAPS, MAP_SAYS, clearToday: () => { did.push('clear'); TODAY.d = null; }, drawStatus: () => did.push('status'),
    });
    const onTick = frameFn<() => void>('onTick', { shownNow: () => o.shown, dropStaleDay, readLayer: (l: string) => did.push('read:' + l) });
    onTick();
    return { did, GAPS };
  }
  it('the shell\'s tick re-reads Today while Map shows; an old day comes down at once, named "Reading…"', () => {
    expect(tickHarness({ shown: true, day: '2026-10-21', today: '2026-10-21' }).did).toEqual(['read:today']);
    const old = tickHarness({ shown: true, day: '2026-10-21', today: '2026-10-22' });
    expect(old.did).toEqual(['clear', 'status', 'read:today']);
    expect(old.GAPS.today).toEqual([{ cls: 'unset', text: MAP_SAYS.readingToday }]);
    expect(tickHarness({ shown: false, day: '2026-10-21', today: '2026-10-22' }).did).toEqual([]);
    // Map coming back on screen (the shell's view class) drops an old day the same way, then reads every layer.
    expect(srcOf(script, 'watchShown')).toContain('if (now && !shown) { dropStaleDay(); readAll(); }');
  });

  it('the tick is taken from the shell only, on this origin', () => {
    const seen: string[] = [];
    const parent = {};
    const deps = {
      location: { origin: 'https://arbo.test' }, window: { parent }, LAYERS: ['today', 'permits', 'leads', 'trucks'], ON: { today: true },
      readLayer: () => seen.push('read'), setLayer: () => seen.push('set'), GAPS: { key: [] }, retryTiles: () => seen.push('tiles'), readAll: () => seen.push('all'), onTick: () => seen.push('tick'),
    };
    const on = frameFn<(e: unknown) => void>('onShellMessage', deps);
    on({ origin: 'https://evil.test', source: parent, data: { type: 'tick' } });
    on({ origin: 'https://arbo.test', source: {}, data: { type: 'tick' } });
    expect(seen).toEqual([]);
    on({ origin: 'https://arbo.test', source: parent, data: { type: 'tick' } });
    expect(seen).toEqual(['tick']);
  });
});

describe('a refused or slowed key is named as what it is (review round)', () => {
  async function why(status: number, body: unknown) {
    const mapGet = frameFn<(p: string) => Promise<unknown>>('mapGet', {
      shellKey: () => 'k', fetch: async () => ({ status, ok: status >= 200 && status < 300, json: async () => body }),
    });
    try { await mapGet('/api/map/today'); return 'ok'; } catch (e) { return (e as { why: string }).why; }
  }
  it('429 too_many_attempts is "throttled" (wait, then ↻) — never "Arbo didn\'t take this phone\'s key"', async () => {
    expect(await why(429, { error: 'too_many_attempts', message: 'wait 40 seconds', retryAfterSec: 40 })).toBe('throttled');
    expect(await why(429, { error: 'busy' })).toBe('unread');
    expect(await why(401, { error: 'no_app_key' })).toBe('noAppKey');
    expect(await why(401, { error: 'wrong_key' })).toBe('refused');
    expect(MAP_SAYS.throttled).toMatch(/wait a minute/i);
    expect(MAP_SAYS.throttled).toMatch(/Wi-Fi and cellular/);
    expect(MAP_SAYS.throttled).not.toBe(MAP_SAYS.refused);
  });
  it('the throttled line carries its own ↻; the others do not need one (Arbo\'s key screen fixes them)', () => {
    const GAPS: { key: Array<{ retry?: unknown; text: string }> } = { key: [] };
    const keyGap = frameFn<(e: unknown) => boolean>('keyGap', { MAP_SAYS, GAPS, drawStatus: () => {}, readAll: () => {} });
    expect(keyGap({ why: 'throttled' })).toBe(true);
    expect(GAPS.key[0]!.text).toBe(MAP_SAYS.throttled);
    expect(typeof GAPS.key[0]!.retry).toBe('function');
    keyGap({ why: 'refused' });
    expect(GAPS.key[0]!.text).toBe(MAP_SAYS.refused);
  });
});

describe('the minute re-read leaves an unchanged map alone (review round)', () => {
  it('the same answer again is not redrawn — an open stop list stays open; a changed one is drawn', async () => {
    const day = { state: 'ok', day: '2026-10-21', stops: [], notOnMap: [], counts: { events: 0, onMap: 0, notOnMap: 0 } };
    let answer: unknown = day;
    const drawn: unknown[] = [];
    const TODAY = { seq: 0, d: null as unknown };
    const readToday = frameFn<() => Promise<void>>('readToday', {
      TODAY, ON: { today: true }, GAPS: { key: [], today: [] }, MAP_SAYS, mapGet: async () => JSON.parse(JSON.stringify(answer)),
      clearToday: () => {}, keyGap: () => false, drawStatus: () => {}, drawToday: (d: unknown) => { drawn.push(d); TODAY.d = d; },
    });
    await readToday();
    await readToday();
    expect(drawn).toHaveLength(1);
    answer = { ...day, counts: { events: 1, onMap: 0, notOnMap: 1 }, notOnMap: [{ id: 'a', title: 'SIM-A', why: 'No address on the event' }] };
    await readToday();
    expect(drawn).toHaveLength(2);
  });
});
