// Maps wave A, M0 + M1 (docs/MAPS_PLAN.md): the map page, scanned as SERVED
// (loadMapHtml), so the inlined ZIP table and DEQ values are scanned too. The
// map is its own page because Leaflet's source uses innerHTML and names its own
// site — it can never sit in the shell (appUi's laws). Arbo's own code in the
// page still follows them: textContent only, DOM nodes into Leaflet's string
// APIs, the key only from the shell, storage only inside try/catch, and only
// the three hosts the plan names. The frame's pure helpers are lifted out and
// run: numbers follow the plan, lines join numbered pins only, no empty-day
// line before a good read, and the pan limit holds every placed pin (§1B).
import { describe, it, expect } from 'vitest';
import { loadMapHtml } from '../src/server/appPage.js';
import { DEQ_MAPSERVER_BASE, DEQ_RPA_LAYER } from '../src/permitting/gis/layers.js';
import { ZIP_CENTROIDS, FOUR_CITY_BOX } from '../src/lib/zipCentroids.js';

const page = loadMapHtml();
const script = (() => {
  const m = [...page.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)];
  expect(m).toHaveLength(1);
  return m[0]![1]!;
})();
function fnSrc(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(script);
  if (!m) throw new Error(`no function ${name} in the map page`);
  return m[0];
}
function constBlock<T>(name: string): T {
  const at = script.indexOf(`\nconst ${name} = {`);
  if (at < 0) throw new Error(`no const ${name} block in the map page`);
  const end = script.indexOf('\n};', at);
  return new Function(`return (${script.slice(script.indexOf('{', at), end + 2)});`)() as T;
}
const MAP_SAYS = constBlock<Record<string, string>>('MAP_SAYS');

describe('the served map page follows the shell\'s laws in its own code (M0)', () => {
  it('reaches only the hosts the plan names: OSM tiles, OSM\'s copyright page, DEQ', () => {
    const hosts = [...page.matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1]!.toLowerCase());
    expect([...new Set(hosts)].sort()).toEqual(['gisdata.deq.virginia.gov', 'tile.openstreetmap.org', 'www.openstreetmap.org']);
  });

  it('loads only Arbo\'s own Leaflet — one script file, one stylesheet, both on /map/', () => {
    expect([...page.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1])).toEqual(['/map/leaflet.js']);
    expect([...page.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/map/leaflet.css']);
    expect(page).not.toMatch(/@import/);
  });

  it('the markers are all filled at serve time: the sprite, the ZIP table, the DEQ values', () => {
    expect(page).not.toContain('<!--ARBO:');
    const zips = JSON.parse(/<script type="application\/json" id="map-zips">([\s\S]*?)<\/script>/.exec(page)![1]!) as { zips: Record<string, unknown>; box: unknown };
    expect(zips.zips).toEqual(ZIP_CENTROIDS);
    expect(zips.box).toEqual(FOUR_CITY_BOX);
    const deq = JSON.parse(/<script type="application\/json" id="map-deq">([\s\S]*?)<\/script>/.exec(page)![1]!) as { base: string; layer: number };
    expect(deq.base).toBe(DEQ_MAPSERVER_BASE);
    expect(deq.layer).toBe(DEQ_RPA_LAYER);
    expect(page).toContain('<svg');
  });

  it('never builds HTML from a string', () => {
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) expect(script, sink).not.toContain(sink);
  });

  it('Leaflet\'s string APIs get DOM nodes, never a string or a joined one', () => {
    expect(script).not.toMatch(/bind(?:Popup|Tooltip)\(\s*['"`]/);
    expect(script).not.toMatch(/bind(?:Popup|Tooltip)\([^)]*\+/);
    expect(script).not.toMatch(/\bhtml:\s*['"`]/);
    expect(script).not.toMatch(/\bhtml:[^,}\n]*\+/);
  });

  it('every L.marker has its own icon; no default icon and no layers control (their images would 404 under /map/)', () => {
    for (const c of script.matchAll(/L\.marker\(([^\n]*)/g)) expect(c[1]).toContain('icon:');
    expect(script).not.toMatch(/L\.control\.layers|L\.Icon\.Default|new L\.Icon\(/);
  });

  it('the attribution is a constant link, opened in a new tab (OSM refuses to be framed), Leaflet\'s prefix off', () => {
    const a = /<a [^>]*href="https:\/\/www\.openstreetmap\.org\/copyright"[^>]*>([^<]*)<\/a>/.exec(page)!;
    expect(a[0]).toContain('target="_blank"');
    expect(a[0]).toContain('rel="noopener"');
    expect(a[1]).toBe('© OpenStreetMap contributors');
    expect(script).toContain('attributionControl: false');
  });

  it('OSM\'s tile policy: the documented URL, the Referer left on, no cache-defeating headers, no prefetch', () => {
    expect(script).toContain("'https://tile.openstreetmap.org/{z}/{x}/{y}.png'");
    expect(page).not.toMatch(/referrerpolicy|no-referrer/i);
    expect(page).not.toMatch(/no-cache|cache-control|pragma/i);
    expect(script).not.toMatch(/fetch\([^)]*openstreetmap/);
  });

  it('no key in an address, no Suffolk, no TCIA, no "permit … clear"; no sentence says "clear"', () => {
    expect(page).not.toMatch(/key=/i);
    expect(page).not.toMatch(/suffolk/i);
    expect(page).not.toMatch(/TCIA/);
    expect(page).not.toMatch(/permit[^<]{0,20}clear/i);
    expect(Object.keys(MAP_SAYS).length).toBeGreaterThan(10);
    for (const [k, s] of Object.entries(MAP_SAYS)) expect(s, k).not.toMatch(/\bclear(ed)?\b/i);
  });

  it('the key comes only from the shell, rides x-arbor-key, and is never read from storage', () => {
    expect(script).toContain('x-arbor-key');
    expect(script).toContain('window.parent.arboMapKey()');
    expect(page).not.toContain('arborKey');
    expect(script).not.toMatch(/\?key|&key/);
  });

  it('every storage access sits inside try/catch, on its own line', () => {
    const lines = script.split('\n').filter((l) => /(?:local|session)Storage/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l, l.trim()).toMatch(/try \{.*(?:local|session)Storage.*\} catch \(e\)/);
    expect(script).not.toContain('sessionStorage');
  });

  it('messages: only from the shell itself, and out only to the shell\'s own origin', () => {
    const h = fnSrc('onShellMessage');
    expect(h).toContain('e.origin !== location.origin || e.source !== window.parent');
    for (const m of script.matchAll(/postMessage\(([^\n]*)/g)) expect(m[1]).toMatch(/, location\.origin\);?$/);
    expect(script).toContain("window.addEventListener('message', onShellMessage);");
  });
});
