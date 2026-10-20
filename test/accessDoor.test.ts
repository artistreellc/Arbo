// The /api door, over the wire (audit 2026-10-20, Lane A: M1, M2, L1, L2).
//
// M1 — no APP_ACCESS_KEY used to OPEN the door whenever the data links were
//      cut. Quo calls, transcripts, texts and inbox cards do not live in the
//      database, so "nothing to leak" was never true. Now: no key set = every
//      /api route answers 401 no_app_key, in every data mode. There is NO
//      keyless carve-out — not even sim, because Quo, Gmail and the relays
//      are real in every mode.
// M2 — wrong keys could be guessed without limit. Now: per connection (the
//      X-Real-IP Railway's edge sets, else the socket), 10 DIFFERENT wrong
//      keys in 10 minutes slow that connection to one key check a minute for
//      15 minutes (429 + Retry-After). Missing keys never count; the same
//      stale key sent again counts once; another connection is untouched;
//      the right key opens on the next check. Counted in /health, no IPs.
// L1 — the key is read from the x-arbor-key header only, never ?key=.
// L2 — keys are compared in constant time (unit tests: accessGuard.test.ts).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';

const realFetch = globalThis.fetch;
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A fresh server on a fresh env. Outbound network is refused: nothing here may leave the box. */
async function serve(envOverrides: Record<string, string | undefined>, opts: Record<string, unknown> = {}): Promise<{ base: string; srv: Server }> {
  vi.resetModules();
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('ARBO_LINK_') || ['APP_ACCESS_KEY', 'CREW_ACCESS_KEY', 'ARBO_DATA_LINKS', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY', 'QUO_API_KEY'].includes(k)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', async (u: string | URL) => {
    const s = String(u);
    if (s.startsWith('http://127.0.0.1:')) return realFetch(u);
    throw new Error('no network in this test');
  });
  const { createArborRequestHandler } = await import('../src/server.js');
  const srv = createServer((createArborRequestHandler as (o?: unknown) => ReturnType<typeof createArborRequestHandler>)(opts));
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const addr = srv.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, srv };
}
const hit = (base: string, path: string, init: { method?: string; key?: string; ip?: string; body?: string } = {}) =>
  realFetch(base + path, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.key !== undefined ? { 'x-arbor-key': init.key } : {}),
      ...(init.ip ? { 'x-real-ip': init.ip } : {}),
    },
    ...(init.body !== undefined ? { body: init.body } : {}),
  });

// The routes the audit opened keyless (M1 evidence), plus the Opus-spending ones.
const AUDITED_GETS = [
  '/api/quo', '/api/calls/records', '/api/webhooks', '/api/webhooks/forms', '/api/webhooks/texts',
  '/api/webhooks/calls', '/api/inbox', '/api/inbox/intents', '/api/relay/call-notes', '/api/settings/channels',
  '/api/leads', '/api/links', '/api/crew/briefing', '/api/crew/workorders',
];
const AUDITED_POSTS: Array<[string, string]> = [
  ['/api/relay/text', JSON.stringify({ from: '+17575550100', text: 'injected' })],
  ['/api/relay/call-notes', JSON.stringify({ text: 'injected' })],
  ['/api/sim/run', JSON.stringify({ brain: 'scripted' })],
  ['/api/agents/sections/run', '{}'],
  ['/api/inbox/backfill', JSON.stringify({ sinceIso: new Date().toISOString() })],
];

describe('M1 — with no APP_ACCESS_KEY the /api door is LOCKED in every data mode', () => {
  for (const mode of [undefined, 'off', 'sim', 'live', 'readonly', 'LIVE', 'live ']) {
    it(`ARBO_DATA_LINKS=${JSON.stringify(mode)}: every audited route answers 401 no_app_key, and says what to do`, async () => {
      const { base, srv } = await serve({ ARBO_DATA_LINKS: mode, APP_ACCESS_KEY: undefined, CREW_ACCESS_KEY: undefined });
      try {
        for (const p of AUDITED_GETS) {
          const r = await hit(base, p);
          expect(r.status, p).toBe(401);
          const b = await r.json() as { error: string; message: string };
          expect(b.error, p).toBe('no_app_key');
          expect(b.message, p).toContain('APP_ACCESS_KEY is not set on the server');
          expect(b.message, p).toContain('Set it on Railway');
        }
        for (const [p, body] of AUDITED_POSTS) {
          const r = await hit(base, p, { method: 'POST', body });
          expect(r.status, p).toBe(401);
          expect(((await r.json()) as { error: string }).error, p).toBe('no_app_key');
        }
      } finally { srv.close(); }
    });
  }

  it('a guessed key opens nothing either, and the crew key alone opens nothing — no key is "the" key', async () => {
    const { base, srv } = await serve({ ARBO_DATA_LINKS: 'sim', APP_ACCESS_KEY: undefined, CREW_ACCESS_KEY: 'crew-k' });
    try {
      for (const key of ['anything', 'crew-k', '']) {
        for (const p of ['/api/quo', '/api/crew/briefing']) {
          const r = await hit(base, p, { key });
          expect(r.status, `${p} ${key}`).toBe(401);
          expect(((await r.json()) as { error: string }).error).toBe('no_app_key');
        }
      }
    } finally { srv.close(); }
  });

  it('a whitespace-only APP_ACCESS_KEY is no key (env trims it) — locked, never open', async () => {
    const { base, srv } = await serve({ ARBO_DATA_LINKS: 'sim', APP_ACCESS_KEY: '   ' });
    try {
      const r = await hit(base, '/api/webhooks/texts');
      expect(r.status).toBe(401);
      expect(((await r.json()) as { error: string }).error).toBe('no_app_key');
    } finally { srv.close(); }
  });

  it('the public pages stay public: /health, /app, /crew answer without a key', async () => {
    const { base, srv } = await serve({ ARBO_DATA_LINKS: undefined, APP_ACCESS_KEY: undefined });
    try {
      for (const p of ['/health', '/app', '/crew']) expect((await hit(base, p)).status, p).toBe(200);
    } finally { srv.close(); }
  });
});

describe('L1 — the key rides the x-arbor-key header only, never the web address', () => {
  it('?key= with the right owner key or crew key is refused, and the 401 says to use the header', async () => {
    const { base, srv } = await serve({ ARBO_DATA_LINKS: 'sim', APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k' });
    try {
      const owner = await hit(base, '/api/webhooks/texts?key=admin-k');
      expect(owner.status).toBe(401);
      const ob = await owner.json() as { error: string; message: string };
      expect(ob.error).toBe('unauthorized');
      expect(ob.message).toContain('A key in the web address is not accepted');
      expect(ob.message).toContain('x-arbor-key');
      const crew = await hit(base, '/api/crew/briefing?key=crew-k');
      expect(crew.status).toBe(401);
      // The header still works for both.
      expect((await hit(base, '/api/webhooks/texts', { key: 'admin-k' })).status).toBe(200);
      expect((await hit(base, '/api/crew/briefing', { key: 'crew-k' })).status).not.toBe(401);
    } finally { srv.close(); }
  });

  it('every 401 says plainly what to do', async () => {
    const { base, srv } = await serve({ ARBO_DATA_LINKS: 'sim', APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k' });
    try {
      const none = await (await hit(base, '/api/leads')).json() as { error: string; message: string };
      expect(none).toEqual({ error: 'unauthorized', message: expect.stringContaining('Enter it on the app’s key screen') });
      const crewAtOwner = await (await hit(base, '/api/leads', { key: 'crew-k' })).json() as { error: string; message: string };
      expect(crewAtOwner.error).toBe('unauthorized');
      expect(crewAtOwner.message).toContain('crew door key opens the crew door only');
      const wrongCrew = await (await hit(base, '/api/crew/briefing', { key: 'nope' })).json() as { error: string; message: string };
      expect(wrongCrew.message).toContain('not the crew door key');
    } finally { srv.close(); }
  });

  it('with no CREW_ACCESS_KEY the crew door still names it (D89), now with the words', async () => {
    const { base, srv } = await serve({ ARBO_DATA_LINKS: 'sim', APP_ACCESS_KEY: 'admin-k' });
    try {
      const r = await hit(base, '/api/crew/briefing');
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: 'crew_key_not_set', message: 'No crew door key has been set up on the server yet. Ask Mike to set one.' });
    } finally { srv.close(); }
  });
});

describe('M2 — wrong keys are limited per connection; the right key is never shut out for long', () => {
  const ENV = { ARBO_DATA_LINKS: 'sim', APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k' };

  it('10 different wrong keys from one connection: 429 with Retry-After; keyless never counts; another connection is untouched', async () => {
    const { base, srv } = await serve(ENV);
    try {
      // Mike's phone fires keyless calls before the key is entered: never counted.
      for (let i = 0; i < 30; i++) expect((await hit(base, '/api/leads', { ip: '203.0.113.7' })).status).toBe(401);
      for (let i = 1; i <= 9; i++) expect((await hit(base, '/api/leads', { key: `guess-${i}`, ip: '203.0.113.7' })).status, `guess ${i}`).toBe(401);
      const tenth = await hit(base, '/api/leads', { key: 'guess-10', ip: '203.0.113.7' });
      expect(tenth.status).toBe(429);
      expect(Number(tenth.headers.get('retry-after'))).toBeGreaterThan(0);
      const b = await tenth.json() as { error: string; message: string; retryAfterSec: number };
      expect(b.error).toBe('too_many_attempts');
      expect(b.message).toContain('Too many different wrong keys from this connection');
      expect(b.message).toContain('switch networks');
      // Throttled: the next key — even the right one — waits for the next one-a-minute check.
      expect((await hit(base, '/api/leads', { key: 'guess-11', ip: '203.0.113.7' })).status).toBe(429);
      // Keyless still gets the plain 401 there — nothing to check, nothing counted.
      expect((await hit(base, '/api/leads', { ip: '203.0.113.7' })).status).toBe(401);
      // Another connection is never shut out by this one — owner key opens at once.
      expect((await hit(base, '/api/webhooks/texts', { key: 'admin-k', ip: '198.51.100.20' })).status).toBe(200);
      expect((await hit(base, '/api/leads', { key: 'guess-1', ip: '198.51.100.20' })).status).toBe(401);
    } finally { srv.close(); }
  });

  it('a stale key sent over and over (a phone after a key change) counts ONCE — it never throttles the owner', async () => {
    const { base, srv } = await serve(ENV);
    try {
      for (let i = 0; i < 40; i++) expect((await hit(base, '/api/leads', { key: 'old-key', ip: '203.0.113.9' })).status).toBe(401);
      expect((await hit(base, '/api/webhooks/texts', { key: 'admin-k', ip: '203.0.113.9' })).status).toBe(200);
    } finally { srv.close(); }
  });

  it('the crew door counts on its own: crew typos never slow Mike’s side from the same yard Wi-Fi', async () => {
    const { base, srv } = await serve(ENV);
    try {
      for (let i = 1; i <= 10; i++) await hit(base, '/api/crew/briefing', { key: `typo-${i}`, ip: '203.0.113.30' });
      expect((await hit(base, '/api/crew/briefing', { key: 'typo-11', ip: '203.0.113.30' })).status).toBe(429);
      expect((await hit(base, '/api/webhooks/texts', { key: 'admin-k', ip: '203.0.113.30' })).status).toBe(200);
    } finally { srv.close(); }
  });

  it('on the next one-a-minute check the right key opens and the connection is forgiven; /health counts it, never an IP or a key', async () => {
    let now = Date.parse('2026-10-20T12:00:00Z');
    const { KeyAttemptGuard } = await import('../src/server/accessDoor.js');
    const keyGuard = new KeyAttemptGuard({ now: () => now, log: () => {} });
    const { base, srv } = await serve(ENV, { keyGuard });
    try {
      for (let i = 1; i <= 10; i++) await hit(base, '/api/leads', { key: `guess-${i}`, ip: '203.0.113.7' });
      const locked = await hit(base, '/api/webhooks/texts', { key: 'admin-k', ip: '203.0.113.7' });
      expect(locked.status).toBe(429);
      const health = await (await hit(base, '/health')).json() as Record<string, unknown>;
      expect(health.access).toEqual({ wrongKeysSinceBoot: 10, throttlesSinceBoot: 1, throttledNow: 1, refusedWhileThrottledSinceBoot: 1 });
      const text = JSON.stringify(health);
      expect(text).not.toContain('203.0.113');
      expect(text).not.toContain('guess-');
      now += 60_000;
      expect((await hit(base, '/api/webhooks/texts', { key: 'admin-k', ip: '203.0.113.7' })).status).toBe(200);
      // Forgiven: the next wrong key starts a fresh count (a 401, not a 429).
      expect((await hit(base, '/api/leads', { key: 'guess-12', ip: '203.0.113.7' })).status).toBe(401);
      const after = await (await hit(base, '/health')).json() as { access: { throttledNow: number } };
      expect(after.access.throttledNow).toBe(0);
    } finally { srv.close(); }
  });
});
