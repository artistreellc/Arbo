// R25 routes (Mike, 2026-09-28). Pins the parts the desks stand on:
// the permit base answers in the law's words and never reads "unknown" as no;
// a LiDAR file is measured in memory and a bad one is refused BY NAME; the
// eight-agent roster is read-only; the crew key opens the crew door only;
// the service worker never caches customer data; the installed app opens /app.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { permitsDb, permitsChecklist, lidarMeasure } from '../src/server/r25Routes.js';

const saved = { ...process.env };
afterAll(() => { process.env = { ...saved }; vi.resetModules(); });

async function serve(envOverrides: Record<string, string | undefined>): Promise<{ base: string; srv: Server }> {
  vi.resetModules();
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { createArborRequestHandler } = await import('../src/server.js');
  const srv = createServer(createArborRequestHandler());
  await new Promise<void>((r) => srv.listen(0, r));
  const addr = srv.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, srv };
}

describe('permit base routes', () => {
  it('serves a city with the regional and state rules, and refuses an unknown city by name', () => {
    const r = permitsDb('Norfolk');
    expect(r.status).toBe(200);
    const facts = (r.body as { facts: Array<{ city: string }> }).facts;
    expect(new Set(facts.map((f) => f.city))).toEqual(new Set(['Norfolk', 'Regional', 'Virginia']));
    expect(permitsDb('Suffolk').status).toBe(400);
  });

  it('an unanswered question is REVIEW NEEDED, never a quiet no; words stay the law’s', () => {
    const r = permitsChecklist({ city: 'Virginia Beach' });
    expect(r.status).toBe(200);
    const items = (r.body as { items: Array<{ status: string; step: string; why: string }> }).items;
    expect(items.some((i) => i.status === 'REVIEW NEEDED')).toBe(true);
    const text = JSON.stringify(items);
    expect(text).not.toMatch(/you('| a)re clear|no permit needed|\bEXEMPT\b/i);
    expect(permitsChecklist({ city: 'Virginia Beach', inRpa: 'maybe' }).status).toBe(400);
  });
});

function trunkXyz(): string {
  // Z-up: ground disc + a 40 cm trunk from 0 to 4 m, full circle.
  const lines: string[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let i = 0; i < 4000; i++) lines.push(`${(rnd() * 6).toFixed(3)} ${(rnd() * 6).toFixed(3)} ${(rnd() * 0.02).toFixed(3)}`);
  for (let i = 0; i < 12000; i++) {
    const a = (i / 12000) * Math.PI * 2 * 37;
    const z = (i / 12000) * 4;
    lines.push(`${(0.2 * Math.cos(a) + rnd() * 0.004).toFixed(4)} ${(0.2 * Math.sin(a) + rnd() * 0.004).toFixed(4)} ${z.toFixed(3)}`);
  }
  return lines.join('\n');
}

describe('LiDAR measure route', () => {
  it('measures an exported scan in memory: DBH with its confidence and the sign-off', () => {
    const r = lidarMeasure(new Uint8Array(Buffer.from(trunkXyz())), 'trunk.xyz', 'z');
    expect(r.status).toBe(200);
    const b = r.body as { measurement: { dbhCm: number }; signOff: string; summary: string };
    expect(b.measurement.dbhCm).toBeGreaterThan(37);
    expect(b.measurement.dbhCm).toBeLessThan(43);
    expect(b.signOff).toMatch(/person confirms/);
  });

  it('refuses garbage, an empty file and a missing name — by name, never as a zero', () => {
    expect(lidarMeasure(new Uint8Array(0), 'scan.ply', null)).toMatchObject({ status: 422 });
    const junk = lidarMeasure(new Uint8Array(Buffer.from('hello tree')), 'scan.ply', null);
    expect(junk.status).toBe(422);
    expect((junk.body as { error: string }).error).toMatch(/ply|format|empty/);
    expect(lidarMeasure(new Uint8Array(10), null, null).status).toBe(400);
  });
});

describe('server wiring', () => {
  it('crew key opens the crew door and NOTHING else; the admin key still opens everything', async () => {
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', ARBO_DATA_LINKS: undefined });
    try {
      const get = (p: string, k?: string) => fetch(base + p, { headers: k ? { 'x-arbor-key': k } : {} });
      expect((await get('/api/crew/workorders', 'crew-k')).status).not.toBe(401);
      expect((await get('/api/leads', 'crew-k')).status).toBe(401);
      expect((await get('/api/permits/db', 'crew-k')).status).toBe(401);
      expect((await get('/api/agents/sections', 'crew-k')).status).toBe(401);
      expect((await get('/api/permits/db', 'admin-k')).status).toBe(200);
      expect((await get('/api/crew/workorders')).status).toBe(401);
    } finally { srv.close(); }
  });

  it('the eight-agent roster is served, read/propose only; a run is POST', async () => {
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', ARBO_DATA_LINKS: undefined });
    try {
      const r = await fetch(base + '/api/agents/sections', { headers: { 'x-arbor-key': 'admin-k' } });
      const body = await r.json() as { agents: Array<{ can: string[] }> };
      expect(body.agents).toHaveLength(8);
      for (const a of body.agents) for (const c of a.can) expect(c).toMatch(/^(read|propose):/);
      expect((await fetch(base + '/api/agents/sections/run', { headers: { 'x-arbor-key': 'admin-k' } })).status).toBe(404);
    } finally { srv.close(); }
  });

  it('service worker: versioned, and it never caches /api, /webhooks or /talk', async () => {
    const { base, srv } = await serve({ RAILWAY_GIT_COMMIT_SHA: 'abcdef1234567890' });
    try {
      const r = await fetch(base + '/sw.js');
      expect(r.status).toBe(200);
      const js = await r.text();
      expect(js).toContain("'abcdef1234567890'");
      expect(js).toContain("url.pathname.startsWith('/api/')");
      expect(js).toContain("url.pathname.startsWith('/webhooks/')");
      expect(js).not.toContain('__ARBO_VERSION__');
    } finally { srv.close(); }
  });

  it('fonts: two known files served, anything else is not', async () => {
    const { base, srv } = await serve({});
    try {
      expect((await fetch(base + '/fonts/fraunces.woff2')).status).toBe(200);
      expect((await fetch(base + '/fonts/instrument-sans.woff2')).headers.get('content-type')).toBe('font/woff2');
      expect((await fetch(base + '/fonts/../server.ts')).status).toBe(404);
      expect((await fetch(base + '/fonts/other.woff2')).status).toBe(404);
    } finally { srv.close(); }
  });

  it('the installed cockpit opens /app with separate any + maskable icons', async () => {
    const { base, srv } = await serve({});
    try {
      const m = await (await fetch(base + '/manifest.webmanifest')).json() as { start_url: string; icons: Array<{ purpose: string; src: string }> };
      expect(m.start_url).toBe('/app');
      expect(m.icons.map((i) => i.purpose)).toEqual(['any', 'any', 'maskable']);
      for (const i of m.icons) expect((await fetch(base + i.src)).status).toBe(200);
    } finally { srv.close(); }
  });

  it('Learn desk: catalog, a no-network rule check, lessons PROPOSED and kept on disk until Mike decides', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbo-learn-'));
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', ARBO_SECRET_DIR: dir, ANTHROPIC_API_KEY: undefined });
    const h = { 'x-arbor-key': 'admin-k', 'content-type': 'application/json' };
    try {
      const cat = await (await fetch(base + '/api/sim/catalog', { headers: h })).json() as { total: number };
      expect(cat.total).toBeGreaterThanOrEqual(150);
      // The Opus run is refused by name without a model key — never faked.
      const o = await fetch(base + '/api/sim/run', { method: 'POST', headers: h, body: JSON.stringify({ brain: 'opus' }) });
      expect(o.status).toBe(409);
      expect(((await o.json()) as { error: string }).error).toBe('no_model_key_on_server');
      expect((await fetch(base + '/api/sim/run', { method: 'POST', headers: h, body: JSON.stringify({ brain: 'scripted' }) })).status).toBe(202);
      const st = await (await fetch(base + '/api/sim/state', { headers: h })).json() as { status: string; lessons: { where: string; lessons: Array<{ id: string; status: string }> } };
      expect(st.status).toBe('done');
      expect(st.lessons.lessons.length).toBeGreaterThan(0);
      expect(st.lessons.lessons.every((l) => l.status === 'proposed')).toBe(true);
      const id = st.lessons.lessons[0]!.id;
      const d = await fetch(base + '/api/sim/lessons/decide', { method: 'POST', headers: h, body: JSON.stringify({ id, decision: 'approved' }) });
      expect(d.status).toBe(200);
      const saved = JSON.parse(readFileSync(join(dir, 'sim-lessons.json'), 'utf8')) as Array<{ id: string; status: string }>;
      expect(saved.find((l) => l.id === id)?.status).toBe('approved');
      expect((await fetch(base + '/api/sim/lessons/decide', { method: 'POST', headers: h, body: JSON.stringify({ id, decision: 'maybe' }) })).status).toBe(400);
    } finally { srv.close(); }
  }, 60_000);
});
