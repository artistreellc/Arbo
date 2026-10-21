// Maps wave A, M0 (docs/MAPS_PLAN.md "M0: the one shared map"): the /map
// routes. /map is the map page, open like /app and carrying no data, with a
// CSP that makes the browser enforce the same host list the tests scan for.
// Leaflet is served from Arbo's own node_modules on two exact routes; anything
// else under /map/ is a 404, including a path that tries to walk out. The
// service worker's PRECACHE is unchanged and still never caches /api/.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import { readFileSync } from 'node:fs';

const saved = { ...process.env };
afterAll(() => { process.env = { ...saved }; vi.resetModules(); });

async function serve(): Promise<{ base: string; port: number; srv: Server }> {
  vi.resetModules();
  const { createArborRequestHandler } = await import('../src/server.js');
  const srv = createServer(createArborRequestHandler());
  await new Promise<void>((r) => srv.listen(0, r));
  const addr = srv.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { base: `http://127.0.0.1:${port}`, port, srv };
}

const CSP = "default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org https://gisdata.deq.virginia.gov; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'";

/** A raw GET: the path goes on the wire exactly as written (fetch would normalise "/map/../x" first). */
function rawGet(port: number, path: string): Promise<number> {
  return new Promise((ok, no) => {
    const r = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => { res.resume(); ok(res.statusCode ?? 0); });
    r.on('error', no);
    r.end();
  });
}

describe('/map routes (M0)', () => {
  it('/map answers 200, no-store, with the exact CSP, and carries no data', async () => {
    const { base, srv } = await serve();
    try {
      const r = await fetch(base + '/map');
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toMatch(/text\/html/);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.headers.get('content-security-policy')).toBe(CSP);
      // OSM's tile policy: the Referer must reach it, so /map never strips it.
      expect(r.headers.get('referrer-policy')).toBeNull();
      const body = await r.text();
      expect(body).toContain('<!doctype html>');
      expect(body).not.toMatch(/SIM-|555-01/); // no data in the page itself
    } finally { srv.close(); }
  });

  it('both Leaflet files answer 200 from Arbo itself, cached a day', async () => {
    const { base, srv } = await serve();
    try {
      const js = await fetch(base + '/map/leaflet.js');
      expect(js.status).toBe(200);
      expect(js.headers.get('content-type')).toMatch(/javascript/);
      expect(js.headers.get('cache-control')).toBe('public, max-age=86400');
      const jsText = await js.text();
      expect(jsText).toContain('Leaflet 1.9.4');
      expect(jsText).toMatch(/BSD 2-Clause/i); // the licence notice stays in the served file
      const css = await fetch(base + '/map/leaflet.css');
      expect(css.status).toBe(200);
      expect(css.headers.get('content-type')).toMatch(/text\/css/);
      expect(css.headers.get('cache-control')).toBe('public, max-age=86400');
      expect(await css.text()).toContain('.leaflet-container');
    } finally { srv.close(); }
  });

  it('anything else under /map/ is a 404 — a source map, a made-up name, and a raw walk out of the folder', async () => {
    const { base, port, srv } = await serve();
    try {
      expect((await fetch(base + '/map/x')).status).toBe(404);
      expect((await fetch(base + '/map/leaflet.js.map')).status).toBe(404);
      expect((await fetch(base + '/map/images/marker-icon.png')).status).toBe(404);
      expect(await rawGet(port, '/map/../package.json')).toBe(404);
      expect(await rawGet(port, '/map/..%2fpackage.json')).toBe(404);
      expect(await rawGet(port, '/map/%2e%2e/package.json')).toBe(404);
    } finally { srv.close(); }
  });
});

describe('the service worker and the dependency (M0)', () => {
  const sw = readFileSync(new URL('../src/app/sw.js', import.meta.url), 'utf8');

  it('PRECACHE is unchanged: one missing file would fail the whole install, and /crew phones share the worker', () => {
    const m = /const PRECACHE = \[([\s\S]*?)\];/.exec(sw)!;
    const list = [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(list).toEqual([
      '/app', '/crew',
      '/fonts/fraunces.woff2', '/fonts/instrument-sans.woff2',
      '/icons/arbo-180.png', '/icons/arbo-192.png', '/icons/arbo-512.png',
      '/manifest.webmanifest', '/crew.webmanifest',
    ]);
  });

  it('still never caches /api/, and never touches another origin (OSM tiles and DEQ images pass straight through)', () => {
    expect(sw).toContain("return url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhooks/') || url.pathname.startsWith('/talk');");
    expect(sw).toContain('if (url.origin !== self.location.origin || neverCache(url)) return;');
  });

  it('/map is network-first (cached when used); the two Leaflet files are cache-first', () => {
    expect(sw).toMatch(/url\.pathname === '\/map'/);
    expect(sw).toMatch(/url\.pathname === '\/map\/leaflet\.js' \|\| url\.pathname === '\/map\/leaflet\.css'/);
  });

  it('leaflet is a runtime dependency, pinned exactly to 1.9.4', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string>; devDependencies?: Record<string, string> };
    expect(pkg.dependencies.leaflet).toBe('1.9.4');
    expect(pkg.devDependencies?.leaflet).toBeUndefined();
    const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')) as { packages: Record<string, { version?: string; license?: string; dev?: boolean }> };
    expect(lock.packages['node_modules/leaflet']?.version).toBe('1.9.4');
    expect(lock.packages['node_modules/leaflet']?.license).toBe('BSD-2-Clause');
    expect(lock.packages['node_modules/leaflet']?.dev).toBeUndefined();
  });
});
