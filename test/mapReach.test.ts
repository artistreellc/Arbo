// Maps wave B review round (D108): nothing on the map hides under anything,
// and nothing placed is out of reach. The correctness review found a Today stop
// covered by a lead's ZIP-area marker on the same Census point (stop 2 could not
// be seen or tapped while the card said "3 of 4 events on the map"); the UI
// review found three trucks parked together drawn as one dot, every tap opening
// the same truck, a lead count "1" reading as stop 1, a parked truck styled like
// an exact stop, a truck outside the pan limit drawn and counted but unreachable,
// and a trip path running off the edge in Today's route green.
// The rules: Today's stops stay where they are; trucks that would touch share one
// marker listing each; a later layer's marker that would sit on an earlier one
// steps aside, joined to its point by a thin line; every placed point widens the
// pan limit; a truck off the view is counted with the stops; Today's trips fit
// the view when Mike asks for them, in their own colour.
import { describe, it, expect } from 'vitest';
import { loadMapHtml } from '../src/server/appPage.js';
import { ZIP_CENTROIDS, ZIP_NO_AREA, ZCTA_SOURCE, FOUR_CITY_BOX } from '../src/lib/zipCentroids.js';

const page = loadMapHtml();
const script = [...page.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)][0]![1]!;
const css = page.slice(page.indexOf('<style>'), page.indexOf('</style>'));
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
const rule = (sel: string) => {
  const m = new RegExp(`(?:^|\\n|\\})${sel.replace(/[.#*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error('no CSS rule ' + sel);
  return m[1]!;
};
const MAP_SAYS = constBlock<Record<string, string>>('MAP_SAYS');
const ZIPS = { zips: ZIP_CENTROIDS, noArea: ZIP_NO_AREA, checked: ZCTA_SOURCE.checked };

// A DOM stand-in for the node builders: text joins as a browser's textContent would.
type N = { tag: string; className: string; text: string; kids: N[]; textContent: string; disabled?: boolean; type?: string; style: Record<string, string>; appendChild: (c: N) => N; setAttribute: () => void; addEventListener: (t: string, f: () => void) => void; on: Record<string, () => void> };
function el(tag: string, cls?: string, text?: string): N {
  const n: N = {
    tag, className: cls || '', text: text ?? '', kids: [], style: {}, on: {},
    get textContent() { return this.text + this.kids.map((k) => k.textContent).join(''); },
    appendChild(c) { this.kids.push(c); return c; },
    setAttribute() {},
    addEventListener(t, f) { this.on[t] = f; },
  };
  return n;
}
const all = (n: N): N[] => [n, ...n.kids.flatMap(all)];

type Box = { x: number; y: number; hw: number; hh: number };
const overlaps = (a: Box, b: Box) => Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh;

describe('a later layer\'s marker steps aside from what is drawn — never on top of it', () => {
  const stepAside = frameFn<(p: { x: number; y: number }, hw: number, hh: number, taken: Box[], inClear?: (x: number, y: number, hw: number, hh: number) => boolean) => { x: number; y: number; moved: boolean }>('stepAside');
  const asidePlaces = frameFn<(items: Array<{ lat: number; lon: number }>, toPx: (g: { lat: number; lon: number }) => { x: number; y: number }, sizeOf: (g: unknown) => { hw: number; hh: number }, taken: Box[], inClear?: unknown) => Array<{ mk: unknown; x: number; y: number; moved: boolean }>>('asidePlaces', { stepAside });

  it('a free spot keeps its own point; one on a drawn marker moves — above it first — and touches nothing', () => {
    expect(stepAside({ x: 100, y: 100 }, 22, 22, [{ x: 300, y: 300, hw: 22, hh: 22 }])).toEqual({ x: 100, y: 100, moved: false });
    const stop = { x: 100, y: 100, hw: 22, hh: 22 };
    const q = stepAside({ x: 100, y: 100 }, 22, 22, [stop]);
    expect(q.moved).toBe(true);
    expect(q.x).toBe(100);
    expect(q.y).toBeLessThan(100);
    expect(overlaps({ ...q, hw: 22, hh: 22 }, stop)).toBe(false);
  });

  it('a marker moved aside lands in the clear part of the map (not under the notes card) when it can', () => {
    const stop = { x: 100, y: 100, hw: 22, hh: 22 };
    const clear = (x: number, y: number, hw: number, hh: number) => y - hh >= 90; // the card covers the top 90 px
    const q = stepAside({ x: 100, y: 100 }, 22, 22, [stop], clear);
    expect(q.moved).toBe(true);
    expect(q.y - 22).toBeGreaterThanOrEqual(90);
    expect(overlaps({ ...q, hw: 22, hh: 22 }, stop)).toBe(false);
    // Nowhere clear: still moved off the stop, never left on it.
    const none = stepAside({ x: 100, y: 100 }, 22, 22, [stop], () => false);
    expect(overlaps({ ...none, hw: 22, hh: 22 }, stop)).toBe(false);
    expect(srcOf(script, 'drawTrucks')).toContain('clearAt');
    expect(srcOf(script, 'drawLeadPins')).toContain('clearAt');
  });

  it('crowded: every marker placed touches no other, whatever is around it', () => {
    const taken: Box[] = [{ x: 100, y: 100, hw: 30, hh: 22 }, { x: 100, y: 52, hw: 22, hh: 22 }, { x: 150, y: 100, hw: 22, hh: 22 }];
    const before = taken.length;
    const items = [0, 1, 2, 3, 4].map(() => ({ lat: 100, lon: 100 }));
    const out = asidePlaces(items, (g) => ({ x: g.lon, y: g.lat }), () => ({ hw: 22, hh: 22 }), taken);
    expect(taken).toHaveLength(before + 5);
    const boxes = out.map((o) => ({ x: o.x, y: o.y, hw: 22, hh: 22 }));
    for (const [i, b] of boxes.entries()) {
      for (const t of taken.slice(0, before)) expect(overlaps(b, t), `marker ${i} on a drawn one`).toBe(false);
      for (const [j, c] of boxes.entries()) if (i !== j) expect(overlaps(b, c), `markers ${i} and ${j}`).toBe(false);
    }
  });

  it('the review\'s case: a lead in the Today stop\'s own ZIP area — the stop stays put, the lead marker steps aside', () => {
    const p = ZIP_CENTROIDS['23503']!;
    const toPx = (g: { lat: number; lon: number }) => ({ x: (g.lon + 77) * 2000, y: (37.5 - g.lat) * 2000 });
    const stopBox = { ...toPx(p), hw: 22, hh: 22 };
    const out = asidePlaces([{ lat: p.lat, lon: p.lon }], toPx, () => ({ hw: 22, hh: 22 }), [stopBox]);
    expect(out[0]!.moved).toBe(true);
    expect(overlaps({ x: out[0]!.x, y: out[0]!.y, hw: 22, hh: 22 }, stopBox)).toBe(false);
  });

  it('the order on the map: Today\'s stops, then trucks (stepping aside from stops), then leads (from both); a moved marker is joined to its point', () => {
    expect(srcOf(script, 'drawMarkers')).toMatch(/drawPins\(\);\s*drawTrucks\(\);\s*drawLeadPins\(\);/);
    expect(srcOf(script, 'drawTrucks')).toContain('boxesPx(TODAY.boxes)');
    expect(srcOf(script, 'drawLeadPins')).toMatch(/boxesPx\(TODAY\.boxes\.concat\(TRUCKS\.boxes\)\)/);
    expect(srcOf(script, 'drawTrucks')).toContain('leader(');
    expect(srcOf(script, 'drawLeadPins')).toContain('leader(');
    // A zoom regroups every layer; Today's redraw re-places the others.
    expect(script).toContain("MAP.on('zoomend', drawMarkers);");
    expect(srcOf(script, 'drawToday')).toContain('drawMarkers();');
  });

  it('the minute\'s truck read re-places the leads, but the same markers in the same places are not redrawn — an open list stays open', () => {
    const s = srcOf(script, 'drawLeadPins');
    expect(s).toContain('if (sig === LEADS.sig) return;');
  });
});

describe('a lead marker, a truck and a stop never look alike', () => {
  it('a lead marker says "lead" — "1 lead", "3 leads" — never a bare number that reads as a stop', () => {
    const leadPinNode = frameFn<(parts: Array<{ leads: Array<{ emergency: boolean }> }>, sample: boolean) => N>('leadPinNode', { el, MAP_SAYS });
    const one = leadPinNode([{ leads: [{ emergency: false }] }], false);
    expect(one.textContent).toBe('1lead');
    expect(all(one).map((n) => n.text)).toEqual(['', '1', 'lead']);
    const three = leadPinNode([{ leads: [{ emergency: false }, { emergency: true }] }, { leads: [{ emergency: false }] }], false);
    expect(three.textContent).toBe('3leads');
    expect(three.className).toContain('alarm');
    expect(leadPinNode([{ leads: [{ emergency: false }] }], true).textContent).toBe('leads');
  });
  it('shapes and colours: stops round; leads square-cornered and gold; trucks square-cornered in ink — never the exact stop\'s forest', () => {
    expect(rule('.pin')).toContain('border-radius:22px');
    expect(rule('.pin.leadpin')).toMatch(/border-radius:(?:[0-9]|1[0-2])px/);
    expect(rule('.pin.leadpin')).toContain('var(--gold)');
    expect(rule('.pin.truck')).toMatch(/border-radius:(?:[0-9]|1[0-2])px/);
    expect(rule('.pin.truck.solid')).toContain('background:var(--ink-1)');
    expect(rule('.pin.truck.solid')).not.toContain('var(--forest)');
    expect(rule('.pin.exact')).toContain('background:var(--forest)');
  });
});

describe('trucks parked together share one marker listing each (UI review #1)', () => {
  const byTime = frameFn('byTime');
  const screenGroups = frameFn<(g: unknown[], toPx: (g: { lat: number; lon: number }) => { x: number; y: number }, gap: number, join?: (p: unknown[]) => unknown) => Array<Record<string, unknown>>>('screenGroups', { byTime });
  const joinTrucks = frameFn<(p: unknown[]) => { trucks: unknown[] }>('joinTrucks');
  const gap = Number(/\nconst TRUCK_GAP = (\d+);/.exec(script)![1]);
  const T = (id: string, label: string, lat: number, lon: number, motion = 'parked') => ({ id, label, unit: null, lat, lon, heading: 90, motion, age: 3 });
  const yard = [T('a', 'Bucket truck', 36.8512, -76.2857), T('b', 'Chipper truck', 36.8512, -76.2857), T('c', 'Dump truck', 36.85121, -76.28571)];
  const px = (g: { lat: number; lon: number }) => ({ x: g.lon * 4000, y: -g.lat * 4000 });

  it('three trucks at the yard: one marker listing all three, at any zoom', () => {
    const out = screenGroups(yard, px, gap, joinTrucks);
    expect(out).toHaveLength(1);
    expect((out[0]!.trucks as Array<{ id: string }>).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
  it('the gap is the truck pill\'s widest: two pills closer than that would touch', () => {
    const max = Number(/max-width:(\d+)px/.exec(rule('.pin.truck'))![1]);
    expect(gap).toBeGreaterThanOrEqual(max);
    const apart = screenGroups([T('a', 'A', 36.85, -76.30), T('b', 'B', 36.85, -76.20)], px, gap, joinTrucks);
    expect(apart).toHaveLength(2);
  });
  it('one truck\'s marker carries its name; a shared one says how many trucks — never a bare number', () => {
    const truckPinNode = frameFn<(list: Array<Record<string, unknown>>, style: string) => N>('truckPinNode', { el, MAP_SAYS, shortLabel: frameFn('shortLabel') });
    expect(truckPinNode([yard[0]!], 'solid').textContent).toBe('Bucket truck');
    expect(truckPinNode([{ ...yard[0]!, motion: 'driving' }], 'solid').textContent).toBe('▲Bucket truck');
    expect(truckPinNode(yard, 'solid').textContent).toBe('3 trucks');
    const shortLabel = frameFn<(s: string) => string>('shortLabel');
    expect(shortLabel('Big Green Bucket Truck 2')).toBe('Big Green Bu…');
    expect(shortLabel('VIN …1234')).toBe('VIN …1234');
  });
  it('a shared marker\'s list names each truck, how and when it was fixed, its Fleet unit — and its own Today\'s trips', () => {
    const agoWords = frameFn('agoWords', { MAP_SAYS });
    const truckStyle = frameFn('truckStyle');
    const truckWords = frameFn('truckWords', { MAP_SAYS, agoWords, truckStyle });
    const picked: string[] = [];
    const trucksNode = frameFn<(list: Array<Record<string, unknown>>, state: string) => N>('truckNode', { el, MAP_SAYS, truckWords, MAP: null, readTrips: (t: { id: string }) => picked.push(t.id) });
    const n = trucksNode(yard, 'ok');
    const texts = all(n).map((x) => x.text).filter(Boolean);
    expect(texts[0]).toBe('3 trucks here');
    for (const t of yard) expect(texts).toContain(t.label);
    const buttons = all(n).filter((x) => x.tag === 'button');
    expect(buttons.map((b) => b.textContent)).toEqual(yard.map((t) => 'Today’s trips — ' + t.label));
    buttons[1]!.on.click!();
    expect(picked).toEqual(['b']);
    // One truck alone: its own card, as before.
    expect(all(trucksNode([yard[0]!], 'ok')).filter((x) => x.tag === 'button').map((b) => b.textContent)).toEqual([MAP_SAYS.todaysTrips]);
  });
  it('the truck marker is built from that list; every truck drawn is in exactly one marker', () => {
    const s = srcOf(script, 'drawTrucks');
    expect(s).toContain('screenGroups(shown, toPx, TRUCK_GAP, joinTrucks)');
    expect(s).toContain('mk.trucks || [mk]');
  });
});

describe('nothing placed is out of reach (correctness review #4)', () => {
  const panBox = frameFn<(box: typeof FOUR_CITY_BOX, s: Array<{ lat: number; lon: number }>) => number[][]>('panBox');
  const truckStyle = frameFn('truckStyle');
  const leadPlace = frameFn('leadPlace');
  const byLead = frameFn('byLead');
  const leadGroups = frameFn('leadGroups', { leadPlace, byLead });
  const richmond = { id: 'r', label: 'West', unit: null, lat: 37.6, lon: -77.7, heading: null, motion: 'parked', age: 3 };
  const lead = { id: 'L1', name: 'SIM-A', zip: '23508', city: 'Norfolk', ageDays: 1, older: false, emergency: false, status: 'new' };
  const placedPoints = (o: { today?: boolean; trucks?: boolean; leads?: boolean; tripBox?: unknown }) => frameFn<() => Array<{ lat: number; lon: number }>>('placedPoints', {
    ON: { today: o.today ?? true, trucks: o.trucks ?? true, leads: o.leads ?? true },
    TODAY: { d: { stops: [{ lat: 36.9, lon: -76.2 }] } },
    TRUCKS: { d: { state: 'ok', trucks: [richmond, { ...richmond, id: 'n', lat: null, lon: null, motion: 'no_fix' }] }, tripBox: o.tripBox ?? null },
    LEADS: { d: { leads: [lead] }, showOlder: false },
    truckStyle, leadGroups, ZIPS, shownLeads: () => [lead],
  })();

  it('the pan limit takes in every truck drawn, today\'s trips and the leads\' ZIP areas — a truck in Richmond is reachable', () => {
    const pts = placedPoints({ tripBox: [{ lat: 37.9, lon: -77.9 }, { lat: 36.7, lon: -76.1 }] });
    expect(pts).toContainEqual(expect.objectContaining({ lat: 37.6, lon: -77.7 }));
    expect(pts).toContainEqual({ lat: 37.9, lon: -77.9 });
    expect(pts).toContainEqual(expect.objectContaining({ lat: ZIP_CENTROIDS['23508']!.lat }));
    expect(pts.some((p) => p.lat === null)).toBe(false); // a truck with no fix is not a point
    const [[s, w], [n]] = panBox(FOUR_CITY_BOX, pts) as [[number, number], [number, number]];
    expect(w).toBeLessThan(-77.9);
    expect(n).toBeGreaterThan(37.9);
    expect(s).toBeLessThan(FOUR_CITY_BOX.south);
  });
  it('a layer switched off adds nothing', () => {
    expect(placedPoints({ trucks: false, leads: false })).toEqual([{ lat: 36.9, lon: -76.2 }]);
  });
  it('the limit is set from every placed point, after each layer draws', () => {
    expect(srcOf(script, 'setPanLimit')).toContain('panBox(BOX, placedPoints())');
    for (const f of ['drawPins', 'drawTrucks', 'drawLeadPins']) expect(srcOf(script, f), f).toContain('setPanLimit();');
    expect(script).not.toMatch(/setPanLimit\([^)]/);
  });
  it('a truck off the view is counted with the stops — the button names both, and show all fits both', () => {
    const offWords = frameFn<(s: number, t: number) => string>('offWords', { MAP_SAYS });
    expect(offWords(1, 0)).toBe(MAP_SAYS.offOne);
    expect(offWords(3, 0)).toBe('3 stops are off this view — show all');
    expect(offWords(0, 1)).toBe('1 truck is off this view — show all');
    expect(offWords(0, 2)).toBe('2 trucks are off this view — show all');
    expect(offWords(1, 1)).toBe('1 stop and 1 truck are off this view — show all');
    expect(offWords(2, 3)).toBe('2 stops and 3 trucks are off this view — show all');
    expect(srcOf(script, 'showAll')).toContain('offItems()');
  });
});

describe('today\'s trips: in view when Mike asks, in their own colour (UI review #9)', () => {
  it('a fitted box stays clear of the notes card, Route the day and the zoom buttons', () => {
    expect(srcOf(script, 'fitClear')).toContain('bottomPad()');
    expect(srcOf(script, 'bottomPad')).toContain('.leaflet-control-zoom');
  });
  it('when the notes card or Route the day changes size, markers moved aside are placed again (never left under the card)', () => {
    expect(srcOf(script, 'placeAgain')).toMatch(/drawTrucks\(\);\s*drawLeadPins\(\);/);
    expect(script).toContain('const ro = new ResizeObserver(() => { if (KEEP_VIEW) openView(); offView(); placeAgain(); moreCue(); });');
  });
  it('drawn trips fit the clear part of the map (Mike\'s own tap) and widen the pan limit', () => {
    const s = srcOf(script, 'readTrips');
    expect(s).toContain('fitTrips(');
    expect(s).toContain('setPanLimit();');
    expect(srcOf(script, 'fitTrips')).toContain('fitClear(');
  });
  it('the trip line has its own colour, Day and Night — never Today\'s route green', () => {
    expect(srcOf(script, 'readTrips')).toContain('color: tripColor()');
    expect(srcOf(script, 'readTrips')).not.toContain('forestColor()');
    const day = /:root\{[\s\S]*?--trip:(#[0-9A-Fa-f]{6})/.exec(css)![1]!;
    const night = /html\.night\{[\s\S]*?--trip:(#[0-9A-Fa-f]{6})/.exec(css)![1]!;
    const forest = /:root\{[\s\S]*?--forest:(#[0-9A-Fa-f]{6})/.exec(css)![1]!;
    expect(day.toLowerCase()).not.toBe(forest.toLowerCase());
    expect(night.toLowerCase()).not.toBe(day.toLowerCase());
    expect(rule('.tripkey')).toContain('var(--trip)');
  });
});
