// Maps wave B, M2 (docs/MAPS_PLAN.md "M2 Permit areas"): Virginia DEQ's
// statewide RPA layer (EDMA layer 33) as translucent shading on the map. The
// phone asks DEQ's MapServer export for the box in view — only the box, the
// image size and the dpi, never a ZIP, a pin or an address — and only at zooms
// where DEQ draws the layer (layer 33's minScale, recorded with its date in
// layers.ts). A new box replaces the old image; a failed image takes the old
// one down too and says so. Shading that is missing is never a "no" (§1B), the
// legend says VERIFY W/ CITY, and nothing says "clear". The frame's helpers
// are lifted out of the SERVED page and run.
import { describe, it, expect } from 'vitest';
import { loadMapHtml, loadAppHtml } from '../src/server/appPage.js';
import { DEQ_MAPSERVER_BASE, DEQ_RPA_LAYER, DEQ_RPA_LIMITS, CITY_GIS_LAYERS, RPA_PROXIMITY_PROBE_METERS } from '../src/permitting/gis/layers.js';

const page = loadMapHtml();
// R27 Phase A (es-owner-a): the Spanish runtime is inlined just before the page's own script — the page's is the last.
const script = [...page.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)].at(-1)![1]!;
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
const DEQ = JSON.parse(/<script type="application\/json" id="map-deq">([\s\S]*?)<\/script>/.exec(page)![1]!) as {
  base: string; layer: number; limits: { minScale: number; maxScale: number; maxImageWidth: number; maxImageHeight: number; checked: string };
};

type Box = { west: number; south: number; east: number; north: number };
type Export = { url: string; size: [number, number]; dpi: number; bounds: number[][] } | null;
const rpaScale = frameFn<(z: number) => number>('rpaScale');
const rpaDraws = frameFn<(z: number, limits: unknown) => boolean>('rpaDraws', { rpaScale });
const rpaExport = frameFn<(deq: unknown, box: Box, w: number, h: number, dpr: number) => Export>('rpaExport');

describe('layer 33\'s limits are recorded, dated, from one source (M2)', () => {
  it('layers.ts holds what DEQ\'s services said on 2026-10-21: minScale 1:50,000, no maxScale, 4096 px images', () => {
    expect(DEQ_RPA_LIMITS).toEqual({ minScale: 50000, maxScale: 0, maxImageWidth: 4096, maxImageHeight: 4096, checked: '2026-10-21' });
  });

  it('the served page carries those limits, and the export base is layers.ts\'s layer 33 minus "/33" — the two never drift', () => {
    expect(DEQ.limits).toEqual(DEQ_RPA_LIMITS);
    expect(DEQ.base).toBe(DEQ_MAPSERVER_BASE);
    expect(DEQ.layer).toBe(DEQ_RPA_LAYER);
    for (const city of ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Portsmouth'] as const) {
      const deq = CITY_GIS_LAYERS[city].find((l) => l.status === 'live')!;
      expect(`${DEQ_MAPSERVER_BASE}/${DEQ_RPA_LAYER}`, city).toBe(deq.url);
    }
  });
});

describe('DEQ draws layer 33 only at 1:50,000 or closer — which zooms that is (M2)', () => {
  it('the scale DEQ\'s server works out for a Web Mercator view (96 dpi, projected metres): z13 ≈ 1:72k, z14 ≈ 1:36k', () => {
    expect(rpaScale(13)).toBeCloseTo(72223.82, 1);
    expect(rpaScale(14)).toBeCloseTo(36111.91, 1);
    expect(rpaScale(13.5)).toBeCloseTo(51069.95, 1);
    expect(rpaScale(13.75)).toBeCloseTo(42944.54, 1);
  });

  it('with the recorded limits: zooms 13 and 13.5 ask nothing (Zoom in…); 13.75 and closer ask DEQ', () => {
    for (const z of [8, 10, 12, 13, 13.25, 13.5]) expect(rpaDraws(z, DEQ.limits), String(z)).toBe(false);
    for (const z of [13.75, 14, 15, 16, 18]) expect(rpaDraws(z, DEQ.limits), String(z)).toBe(true);
  });

  it('at this latitude the ground scale is about 0.80 of the projected one — the gate uses the larger, so the map never asks below DEQ\'s limit', () => {
    const ground = (z: number) => rpaScale(z) * Math.cos((36.8 * Math.PI) / 180);
    expect(ground(13.25)).toBeLessThan(50000); // by ground scale z13.25 and z13.5 would pass …
    expect(rpaDraws(13.25, DEQ.limits)).toBe(false); // … but DEQ's server counts projected metres, so they are not asked
    expect(rpaDraws(13.5, DEQ.limits)).toBe(false);
    expect(rpaScale(13.75)).toBeLessThanOrEqual(50000);
  });

  it('limits not recorded: nothing is asked — never a guessed request', () => {
    expect(rpaDraws(16, { minScale: null, maxScale: null })).toBe(false);
    expect(rpaDraws(16, null)).toBe(false);
    expect(rpaExport({ ...DEQ, limits: { ...DEQ.limits, maxImageWidth: null } }, { west: -76.3, south: 36.8, east: -76.2, north: 36.9 }, 390, 589, 3)).toBeNull();
  });
});

describe('the export request: the box, the size, the dpi — nothing else (M2)', () => {
  const box = { west: -76.32, south: 36.84, east: -76.28, north: 36.87 };

  it('a 390×589 map on a 3× phone asks 1170×1767 at 288 dpi, layer 33 only, PNG32, transparent, as an image', () => {
    const r = rpaExport(DEQ, box, 390, 589, 3)!;
    expect(r.url).toBe(`${DEQ_MAPSERVER_BASE}/export?bbox=-76.320000,36.840000,-76.280000,36.870000&bboxSR=4326&imageSR=3857&size=1170,1767&dpi=288&format=png32&transparent=true&layers=show:33&f=image`);
    expect(r.size).toEqual([1170, 1767]);
    expect(r.dpi).toBe(288);
    expect(r.bounds).toEqual([[36.84, -76.32], [36.87, -76.28]]);
  });

  it('only the box, the size and the dpi vary: no ZIP, no pin, no address, no query of any feature', () => {
    const r = rpaExport(DEQ, box, 390, 589, 3)!;
    const u = new URL(r.url);
    expect(u.origin + u.pathname).toBe(`${DEQ_MAPSERVER_BASE}/export`);
    expect([...u.searchParams.keys()]).toEqual(['bbox', 'bboxSR', 'imageSR', 'size', 'dpi', 'format', 'transparent', 'layers', 'f']);
    expect(u.searchParams.get('layers')).toBe('show:33');
    expect(r.url).not.toMatch(/zip|address|where|geometry|query|token|key=/i);
  });

  it('past DEQ\'s 4096 px both sides shrink together (the image keeps the box\'s shape) and the dpi with them (the scale holds)', () => {
    const r = rpaExport(DEQ, box, 2000, 1500, 3)!;
    expect(r.size[0]).toBeLessThanOrEqual(4096);
    expect(r.size[1]).toBeLessThanOrEqual(4096);
    expect(r.size).toEqual([4096, 3072]);
    expect(r.size[0] / r.size[1]).toBeCloseTo(2000 / 1500, 3);
    // The server's scale = box width / image width × dpi: the same as the uncapped request (dpi is whole, so within 0.5%).
    expect((r.dpi / r.size[0]) / (288 / 6000)).toBeCloseTo(1, 2);
  });

  it('the image has the box\'s shape in Web Mercator, so the shading lands on the right streets', () => {
    const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const w = 390, h = 589, west = -76.33, east = -76.27, south = 36.83;
    // The box a 390×589 map shows: its height in Mercator units is h/w of its width.
    const dx = ((east - west) * Math.PI) / 180;
    const north = (Math.atan(Math.exp(merc(south) + (dx * h) / w)) - Math.PI / 4) * 360 / Math.PI;
    const r = rpaExport(DEQ, { west, south, east, north }, w, h, 3)!;
    const boxShape = dx / (merc(north) - merc(south));
    expect(Math.abs(r.size[0] / r.size[1] - boxShape)).toBeLessThan(1 / r.size[1]);
  });

  it('only show:33 is ever asked, and no candidate city layer is in the served page', () => {
    expect(script).toContain("'layers=show:' + deq.layer");
    expect(script).not.toMatch(/show:\d/);
    for (const host of ['gis.data.vbgov.com', 'norfolkgisdata', 'gis.cityofchesapeake.net', 'MapServer/6', 'MapServer/25']) expect(page, host).not.toContain(host);
  });
});

describe('what the layer says (M2, §1B)', () => {
  const cutLine = frameFn<(kind: string, links: string | null) => string>('cutLine', { MAP_SAYS });
  const permitLines = frameFn<(state: string | null, links: string | null) => Array<{ cls: string; text: string; retry: boolean }>>('permitLines', { MAP_SAYS, cutLine });

  it('the plan\'s words, exactly — and the legend says VERIFY W/ CITY and never "clear"', () => {
    expect(MAP_SAYS.rpaZoom).toBe('Zoom in to see RPA areas — DEQ doesn’t draw them at this zoom; not drawn is not “no RPA”.');
    expect(MAP_SAYS.rpaFailed).toBe('Couldn’t load the DEQ RPA layer just now — this is not “no RPA here”.');
    expect(MAP_SAYS.rpaMissing).toBe('Not on this map: the Virginia Beach, Norfolk and Chesapeake city RPA layers (found, not verified); Portsmouth (no city layer found); floodplain, Norfolk CRO and reservoir areas (no layer). Missing shading is never a “no”.');
    expect(MAP_SAYS.rpaLegend).toBe('Shaded: Resource Protection Area — Virginia DEQ statewide layer 33 (checked 2026-08-01). Not shaded does not mean no permit — VERIFY W/ CITY. Arbo’s permit screen checks 300 m around an address, because an address point can sit 150–300 m from a rear-lot buffer. For one address’s permit word, use Estimate → prep.');
    expect(MAP_SAYS.rpaLegend).toContain('VERIFY W/ CITY');
    for (const k of Object.keys(MAP_SAYS).filter((x) => /^rpa|^permits/.test(x))) expect(MAP_SAYS[k], k).not.toMatch(/\bclear(ed)?\b|PERMIT LIKELY|REVIEW NEEDED|NO OVERLAY/i);
  });

  it('the legend\'s date and distance are layers.ts\'s own (DEQ verified 2026-08-01, the 300 m probe)', () => {
    const deq = CITY_GIS_LAYERS.Norfolk.find((l) => l.status === 'live')!;
    expect(MAP_SAYS.rpaLegend).toContain(`(checked ${deq.lastVerified})`);
    expect(MAP_SAYS.rpaLegend).toContain(`checks ${RPA_PROXIMITY_PROBE_METERS} m around an address`);
  });

  it('zoomed out: the zoom line first, then what is not on this map, then the permit records — never a bare map', () => {
    const z = permitLines('zoom', 'readonly');
    expect(z.map((l) => l.text)).toEqual([MAP_SAYS.rpaZoom, MAP_SAYS.rpaMissing, 'Permit records are cut on purpose (R32) — none are drawn.']);
    expect(z.every((l) => l.retry === false)).toBe(true);
  });

  it('a failed image: its line with ↻; drawn or reading: only what is not on this map and the records line', () => {
    const f = permitLines('failed', 'readonly');
    expect(f[0]).toEqual({ cls: 'unread', text: MAP_SAYS.rpaFailed, retry: true });
    expect(permitLines('ok', 'readonly').map((l) => l.text)).toEqual([MAP_SAYS.rpaMissing, 'Permit records are cut on purpose (R32) — none are drawn.']);
    expect(permitLines('reading', 'readonly')[0]!.text).toBe(MAP_SAYS.rpaReading);
  });

  it('the permit records line says what is true in each mode: R32 read-only, everything cut, practice or live', () => {
    expect(cutLine('permits', 'readonly')).toBe('Permit records are cut on purpose (R32) — none are drawn.');
    expect(cutLine('permits', 'cut')).toBe('Permit records are cut on purpose — none are drawn.');
    for (const l of ['simulation', 'live', null]) expect(cutLine('permits', l), String(l)).toBe(MAP_SAYS.permitsNotDrawn);
    expect(MAP_SAYS.permitsNotDrawn).not.toMatch(/cut/);
  });
});

// The image's life: a new box replaces the old one; a failure takes every image down; a zoom out drops it.
describe('a new box replaces the old image; a failed one takes it down (M2)', () => {
  type Ov = { url: string; on: (t: string, f: () => void) => Ov; addTo: () => Ov; remove: () => void; fire: (t: string) => void; removed: boolean };
  function harness() {
    const made: Ov[] = [];
    const states: string[] = [];
    let zoom = 14;
    let bounds = { w: -76.32, s: 36.84, e: -76.28, n: 36.87 };
    const MAP = {
      getZoom: () => zoom,
      getSize: () => ({ x: 390, y: 589 }),
      getBounds: () => ({ getWest: () => bounds.w, getSouth: () => bounds.s, getEast: () => bounds.e, getNorth: () => bounds.n }),
    };
    const L = {
      imageOverlay: (url: string) => {
        const h: Record<string, () => void> = {};
        const ov: Ov = { url, removed: false, on: (t, f) => { h[t] = f; return ov; }, addTo: () => ov, remove: () => { ov.removed = true; }, fire: (t) => h[t]!() };
        made.push(ov);
        return ov;
      },
    };
    const RPA = { seq: 0, url: null as string | null, state: null as string | null, live: [] as Ov[] };
    const dropRpa = frameFn<() => void>('dropRpa', { RPA });
    const setRpa = (s: string) => { RPA.state = s; states.push(s); };
    const readPermits = frameFn<(force?: boolean) => void>('readPermits', {
      ON: { permits: true }, MAP, L, DEQ, RPA, rpaDraws, rpaExport, dropRpa, setRpa, window: { devicePixelRatio: 3 },
    });
    return { readPermits, made, states, RPA, zoomTo: (z: number) => { zoom = z; }, pan: (dx: number) => { bounds = { ...bounds, w: bounds.w + dx, e: bounds.e + dx }; } };
  }

  it('zoomed in: one request, "Reading…" until it lands, then drawn', () => {
    const h = harness();
    h.readPermits();
    expect(h.made).toHaveLength(1);
    expect(h.made[0]!.url).toContain('layers=show:33');
    expect(h.states).toEqual(['reading']);
    h.made[0]!.fire('load');
    expect(h.states).toEqual(['reading', 'ok']);
    expect(h.RPA.live).toEqual([h.made[0]]);
    h.readPermits(); // the same box again (a refit that moved nothing): no second request
    expect(h.made).toHaveLength(1);
  });

  it('a pan asks again; the old image stays where it belongs until the new one lands, then comes down', () => {
    const h = harness();
    h.readPermits();
    h.made[0]!.fire('load');
    h.pan(0.01);
    h.readPermits();
    expect(h.made).toHaveLength(2);
    expect(h.made[0]!.removed).toBe(false);
    h.made[1]!.fire('load');
    expect(h.made[0]!.removed).toBe(true);
    expect(h.RPA.live).toEqual([h.made[1]]);
  });

  it('an image that fails says so and takes the old image down with it — no shading from another box is left', () => {
    const h = harness();
    h.readPermits();
    h.made[0]!.fire('load');
    h.pan(0.01);
    h.readPermits();
    h.made[1]!.fire('error');
    expect(h.made[0]!.removed).toBe(true);
    expect(h.made[1]!.removed).toBe(true);
    expect(h.RPA.live).toEqual([]);
    expect(h.states.at(-1)).toBe('failed');
  });

  it('an answer for an older box never lands over a newer one', () => {
    const h = harness();
    h.readPermits();
    h.pan(0.01);
    h.readPermits();
    h.made[0]!.fire('load'); // the first box arrives late
    expect(h.made[0]!.removed).toBe(true);
    expect(h.states).toEqual(['reading']);
    h.made[0]!.fire('error');
    expect(h.states).toEqual(['reading']); // its failure is not this box's
  });

  it('zooming out past DEQ\'s limit drops every image at once and names it; no request is made', () => {
    const h = harness();
    h.readPermits();
    h.made[0]!.fire('load');
    h.zoomTo(13);
    h.readPermits();
    expect(h.made).toHaveLength(1);
    expect(h.made[0]!.removed).toBe(true);
    expect(h.states.at(-1)).toBe('zoom');
  });

  it('↻ asks again even for the same box', () => {
    const h = harness();
    h.readPermits();
    h.made[0]!.fire('error');
    h.readPermits(true);
    expect(h.made).toHaveLength(2);
  });
});

describe('the served page wires the layer (M2)', () => {
  it('Permit areas reads on open, on ↻, after every move; switched off, every image comes down', () => {
    expect(script).toMatch(/LAYER_READ\.permits = /);
    expect(script).toMatch(/LAYER_CLEAR\.permits = /);
    expect(script).toContain("MAP.on('moveend', rpaMove);");
    expect(srcOf(script, 'rpaOff')).toContain('dropRpa();');
    expect(script).not.toContain('permitsSoon');
  });
  it('the image overlay takes no click and no string of HTML; the key shows the shading', () => {
    expect(script).toMatch(/L\.imageOverlay\(want\.url, want\.bounds, \{[^}]*interactive: false/);
    expect(script).toMatch(/KEYS\.permits = /);
  });
});

const shell = loadAppHtml();
describe('the way in: Estimate (M2)', () => {
  it('the Permit rules header and the prep\'s permit result each carry "RPA areas on the map" → the Permit areas layer', () => {
    for (const fn of ['renderPermits', 'estimatePrepPanel']) {
      const s = srcOf(shell, fn);
      expect(s, fn).toContain("'RPA areas on the map'");
      expect(s, fn).toContain("openMap('permits')");
    }
  });
  it('the map opens on the four-city view (Q11): no address, no point, no city is handed to it', () => {
    for (const m of shell.matchAll(/openMap\('permits'([^)]*)\)/g)) expect(m[1]).toBe('');
  });
  it('the frame learns the links\' word (cut, read-only, practice) from the shell, never by a read of its own', () => {
    expect(shell).toContain('window.arboMapLinks = () => LINKS_READY;');
    expect(script).toContain('window.parent.arboMapLinks()');
    expect(script).not.toMatch(/['"`]\/health/);
  });
});
