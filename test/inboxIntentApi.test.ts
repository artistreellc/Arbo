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

  it('carries the maybe lane, the ignored log, and the proposal cards', () => {
    expect(html).toContain('Maybe — check this');
    expect(html).toContain('Ignored log');
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
    srv.close();
  });
});
