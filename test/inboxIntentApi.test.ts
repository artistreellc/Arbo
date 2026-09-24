// The intent engine's HTTP surface + the Today-screen pins that keep it
// rendering in production (the links-cut early-return has hidden a feature
// before — the talk button — so placement is pinned, not assumed).
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { createArborRequestHandler } from '../src/server.js';

let server: Server | null = null;
async function listen(): Promise<string> {
  server = createServer(createArborRequestHandler());
  await new Promise<void>((r) => server!.listen(0, r));
  const addr = server!.address();
  return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}
afterAll(() => {
  server?.close();
});

describe('inbox intents API (engine not started — honest states, never invented data)', () => {
  it('GET /api/inbox/intents says not_started instead of an empty inbox', async () => {
    const base = await listen();
    const res = await fetch(`${base}/api/inbox/intents`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pipeline: 'not_started' });
  });

  it('POST relabel/approve/reject refuse loudly without the engine', async () => {
    const base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
    for (const path of ['/api/inbox/relabel', '/api/inbox/intents/approve', '/api/inbox/intents/reject']) {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ threadId: 't', intent: 'callrail', id: 'x' }),
      });
      expect(res.status, path).toBe(503);
      expect(((await res.json()) as { error: string }).error).toBe('intent_engine_not_started');
    }
  });

  it('POST /api/inbox/convert refuses by name while the links are cut — nothing is changed', async () => {
    const base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
    const res = await fetch(`${base}/api/inbox/convert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ threadId: 't' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('links_cut');
    expect(body.message).toContain('Nothing was changed');
  });
});

describe('Today-screen intent panel (source pins)', () => {
  const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');

  it('renders ABOVE the brief fetch — the links-cut early return must not hide it', () => {
    const panel = html.indexOf('inboxIntentPanel().then');
    const brief = html.indexOf("api('/api/brief?from=");
    expect(panel).toBeGreaterThan(-1);
    expect(brief).toBeGreaterThan(-1);
    expect(panel).toBeLessThan(brief);
  });

  it('a dead Gmail feed is NAMED, never rendered as a quiet zero (§1B)', () => {
    expect(html).toContain('This is not zero mail');
  });

  it('carries the maybe lane and proposal cards — and NO ignored log on screen (Mike, 2026-09-24)', () => {
    expect(html).toContain('Maybe — check this');
    expect(html).not.toContain('Ignored log');
    expect(html).toContain('Proposed new intent');
  });

  it('conversion asks first and refusals say nothing was changed', () => {
    expect(html).toContain('convert to job (asks first)');
    expect(html).toContain('Nothing was changed');
  });

  it('in-memory approvals admit they reset on a redeploy', () => {
    expect(html).toContain('reset on a redeploy until committed');
  });
});

describe('public legal pages (OAuth publishing requirement)', () => {
  it('serves /privacy and /terms without auth, with the Limited Use line', async () => {
    const srv = createServer(createArborRequestHandler());
    await new Promise<void>((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const priv = await fetch(`${base}/privacy`);
    expect(priv.status).toBe(200);
    const privText = await priv.text();
    expect(privText).toContain('Google API Services User Data Policy');
    expect(privText).toContain('Limited Use');
    const terms = await fetch(`${base}/terms`);
    expect(terms.status).toBe(200);
    expect(await terms.text()).toContain('Art-is-Tree LLC');
    // the front door explains the app with NO key wall in the way
    const home = await fetch(`${base}/`);
    expect(home.status).toBe(200);
    const homeText = await home.text();
    expect(homeText).toContain('reception and operations assistant');
    expect(homeText).toContain('/app');
    expect(homeText).not.toContain('keywall');
    srv.close();
  });
});

describe('POST /api/inbox/backfill (catch-up sweep)', () => {
  it('refuses honestly without the watch, a bad date, or a too-deep reach', async () => {
    const srv2 = createServer(createArborRequestHandler());
    await new Promise<void>((r) => srv2.listen(0, r));
    const base = `http://127.0.0.1:${(srv2.address() as { port: number }).port}`;
    const post = (body: unknown) =>
      fetch(`${base}/api/inbox/backfill`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const noWatch = await post({ sinceIso: new Date(Date.now() - 3600_000).toISOString() });
    expect(noWatch.status).toBe(503);
    expect(((await noWatch.json()) as { error: string }).error).toBe('inbox_watch_not_started');
    expect((await post({})).status).toBe(400);
    expect((await post({ sinceIso: 'not-a-date' })).status).toBe(400);
    const tooFar = await post({ sinceIso: new Date(Date.now() - 30 * 24 * 3600_000).toISOString() });
    expect(tooFar.status).toBe(400);
    expect(((await tooFar.json()) as { message: string }).message).toContain('Nothing was scanned');
    srv2.close();
  });

  it('the app carries the catch-up picker with all six reach-back options', () => {
    const html2 = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
    for (const lab of ['Last 5 minutes', 'Last 15 minutes', 'Last 30 minutes', 'Last hour', 'Last day', 'Last week']) {
      expect(html2).toContain(lab);
    }
    expect(html2).toContain("api('/api/inbox/backfill'");
  });
});
