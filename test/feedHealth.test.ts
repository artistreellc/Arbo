// M14 (audit 2026-10-20): nobody was told when Arbo lost a feed — /health
// answered 200 "ok" through the week Google was dead. GET /health/feeds
// lists every feed with its NAMED state and when it last worked, behind the
// owner key, and answers 503 when any feed is down so an outside monitor
// (Mike's choice, docs/GO_LIVE.md) can page him. Arbo itself sends nothing.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { buildFeedHealth, trackedAlerts, type FeedInputs, type FeedLog } from '../src/ops/feedHealth.js';
import type { InboxWatchResult } from '../src/ops/inboxWatch.js';

const NOW = new Date('2026-10-20T15:00:00Z');
const T = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000).toISOString();

const pass = (status: InboxWatchResult['status'], reason?: string): InboxWatchResult => ({
  ranAtIso: T(1), status, ...(reason ? { reason } : {}), scanned: 0, alreadySeen: 0, leads: [], channelOff: {}, unparsedKnownSenderIds: [], otherMail: 0, cityMail: [], unreadable: status === 'unavailable' ? ['inbox unreadable'] : [],
});

function quoStatus(over: Record<string, unknown> = {}) {
  return {
    registration: { state: 'ok', detail: 'Wired to Quo.', retryAt: null }, reading: true, received: 3, rejected: 0, lastAt: T(30), lastError: null,
    sonaCalls: 2, slips: 0, callsWithSlips: 0, holdsFiled: 1, holdsFailed: 0, holdsWaiting: 0, readsRetrying: 0, readRetryMax: 5, hangups: 0, learnedFromRecord: 2,
    feedLog: { holdFiledAt: T(60), holdFailedAt: null, holdError: null, readOkAt: T(60) },
    notUsed: {},
    quoRecord: { lastAt: T(5), lastOkAt: T(5), learned: 2, pending: 0, error: null, unreadable: null, threadsNotRead: 0, weekThreadsNotRead: 0, weekReadOkAt: T(60), callCap: 100 },
    ...over,
  };
}

function healthy(): FeedInputs {
  return {
    gmail: { configured: true, started: true, last: pass('ok'), state: { lastGoodReadAt: T(1), unavailableSince: null, gap: null } },
    holds: { configured: true },
    quo: { configured: true, status: quoStatus() as unknown as NonNullable<FeedInputs['quo']['status']> },
    study: { reading: true, lastAt: T(10), lastOkAt: T(10), driveOkAt: T(10), read: 3, unchanged: 1, failed: 0, quoError: null, driveError: null, driveFiles: 2, threadsInWindow: 4, threadsStudied: 4, customers: 4, byStage: {}, note: '' },
    storm: { lastOkAt: T(3), lastErrorAt: null, lastError: null },
    bouncie: { state: 'link_cut', readAt: null },
  };
}

const byFeed = (inputs: FeedInputs) => Object.fromEntries(buildFeedHealth(inputs, NOW).feeds.map((f) => [f.feed, f]));

afterEach(() => vi.restoreAllMocks());

describe('M14 — every feed, named, with when it last worked', () => {
  it('a healthy Arbo lists every feed and is ok; a feed switched off on purpose is OFF, never ok', () => {
    const h = buildFeedHealth(healthy(), NOW);
    expect(h.ok).toBe(true);
    expect(h.down).toEqual([]);
    expect(h.feeds.map((f) => f.feed)).toEqual(['gmail', 'calendar_holds', 'quo_webhooks', 'quo_record', 'sona_reading', 'quo_study', 'drive_lead_logs', 'nws_storm', 'bouncie']);
    expect(byFeed(healthy()).bouncie).toMatchObject({ state: 'off' });
    expect(byFeed(healthy()).gmail).toMatchObject({ state: 'ok', lastGoodAt: T(1) });
  });

  it('the week Google was dead: Gmail, the calendar holds and the Drive logs are DOWN, with when they last worked', () => {
    const i = healthy();
    i.gmail = { configured: true, started: true, last: pass('unavailable', 'token refresh failed: HTTP 400'), state: { lastGoodReadAt: T(7 * 24 * 60), unavailableSince: T(7 * 24 * 60 - 5), gap: null } };
    i.quo.status = quoStatus({ feedLog: { holdFiledAt: null, holdFailedAt: T(30), holdError: 'google_signin', readOkAt: T(30) } }) as never;
    i.study = { ...i.study!, driveError: 'token refresh failed: HTTP 400', driveOkAt: null };
    const h = buildFeedHealth(i, NOW);
    expect(h.ok).toBe(false);
    expect(h.down).toEqual(['gmail', 'calendar_holds', 'drive_lead_logs']);
    const f = byFeed(i);
    expect(f.gmail!.detail).toContain('token refresh failed');
    expect(f.gmail!.lastGoodAt).toBe(T(7 * 24 * 60));
    expect(f.calendar_holds!.detail).toContain('FAILED (google_signin)');
    expect(f.drive_lead_logs!.lastGoodAt).toBeNull();
  });

  it('no evidence is WAITING, never ok: no hold needed yet, no storm read yet, a first pass not finished', () => {
    const i = healthy();
    i.quo.status = quoStatus({ feedLog: { holdFiledAt: null, holdFailedAt: null, holdError: null, readOkAt: null } }) as never;
    i.storm = { lastOkAt: null, lastErrorAt: null, lastError: null };
    i.gmail = { configured: true, started: true, last: null, state: null };
    const f = byFeed(i);
    expect(f.calendar_holds!.state).toBe('waiting');
    expect(f.nws_storm!.state).toBe('waiting');
    expect(f.gmail!.state).toBe('waiting');
    expect(buildFeedHealth(i, NOW).ok).toBe(true); // waiting does not page
  });

  it('a read that is capped, gapped or retrying is DEGRADED — read, with what is missing named', () => {
    const i = healthy();
    i.gmail.state = { lastGoodReadAt: T(1), unavailableSince: null, gap: { fromIso: null, toIso: T(60), why: 'no_record' } };
    i.quo.status = quoStatus({ readsRetrying: 1, quoRecord: { ...quoStatus().quoRecord, weekThreadsNotRead: 20 } }) as never;
    i.study = { ...i.study!, threadsInWindow: 84, threadsStudied: 60 };
    const f = byFeed(i);
    expect(f.gmail!.state).toBe('degraded');
    expect(f.sona_reading!.state).toBe('degraded');
    expect(f.quo_record!.state).toBe('degraded');
    expect(f.quo_study!.detail).toContain('60 most recent of 84');
  });

  it('no Quo key is DOWN for every Quo feed — not zero calls', () => {
    const i = healthy();
    i.quo = { configured: false, status: null };
    i.study = null;
    expect(buildFeedHealth(i, NOW).down).toEqual(['quo_webhooks', 'quo_record', 'sona_reading', 'quo_study', 'drive_lead_logs']);
  });

  it('the storm wrapper records the last good read and the last failure, and passes both through unchanged', async () => {
    const log: FeedLog = { lastOkAt: null, lastErrorAt: null, lastError: null };
    let fail = false;
    const p = trackedAlerts({ activeAlerts: async () => { if (fail) throw new Error('NWS 500'); return []; } }, log, () => NOW.getTime());
    await expect(p.activeAlerts()).resolves.toEqual([]);
    expect(log.lastOkAt).toBe(NOW.toISOString());
    fail = true;
    await expect(p.activeAlerts()).rejects.toThrow('NWS 500');
    expect(log).toMatchObject({ lastErrorAt: NOW.toISOString(), lastError: 'NWS 500' });
  });

  it('the report carries no customer: no phone-shaped or email-shaped text anywhere', () => {
    const json = JSON.stringify(buildFeedHealth(healthy(), NOW));
    expect(json).not.toMatch(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|\+1\d{10}|@[\w-]+\.[a-z]{2,}/i);
  });
});

describe('GET /health/feeds — over the wire, behind the owner key', () => {
  let srv: Server | null = null;
  afterEach(() => { srv?.close(); srv = null; });

  async function serve(envOverrides: Record<string, string | undefined>): Promise<string> {
    vi.resetModules();
    for (const [k, v] of Object.entries(envOverrides)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const { createArborRequestHandler } = await import('../src/server.js');
    srv = createServer(createArborRequestHandler());
    await new Promise<void>((r) => srv!.listen(0, r));
    return `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  }

  it('no key, a wrong key, the crew key and ?key= are refused; the owner key in the header reads it — 503 while feeds are down', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const base = await serve({ APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', QUO_API_KEY: undefined, GMAIL_OAUTH_REFRESH_TOKEN: undefined, ARBO_SECRET_DIR: '/nonexistent-arbo-test' });
    expect((await fetch(`${base}/health/feeds`)).status).toBe(401);
    expect((await fetch(`${base}/health/feeds`, { headers: { 'x-arbor-key': 'nope' } })).status).toBe(401);
    expect((await fetch(`${base}/health/feeds`, { headers: { 'x-arbor-key': 'crew-k' } })).status).toBe(401);
    expect((await fetch(`${base}/health/feeds?key=admin-k`)).status).toBe(401);
    const res = await fetch(`${base}/health/feeds`, { headers: { 'x-arbor-key': 'admin-k' } });
    expect(res.status).toBe(503); // nothing is wired in a test server: named down, never a quiet 200
    const body = (await res.json()) as { ok: boolean; down: string[]; feeds: Array<{ feed: string; state: string }> };
    expect(body.ok).toBe(false);
    expect(body.down).toContain('quo_webhooks');
    expect(body.feeds.find((f) => f.feed === 'bouncie')!.state).toBe('off');
  });

  it('with no APP_ACCESS_KEY the feeds page is locked', async () => {
    const base = await serve({ APP_ACCESS_KEY: undefined });
    const res = await fetch(`${base}/health/feeds`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('no_app_key');
  });

  it('GO_LIVE names the monitor as Mike’s choice and says how to point it', () => {
    const doc = readFileSync(new URL('../docs/GO_LIVE.md', import.meta.url), 'utf8');
    expect(doc).toContain('Being told when something dies (audit M14');
    expect(doc).toContain('`GET /health/feeds`');
    expect(doc).toContain('An outside uptime monitor — which one is your call.');
    expect(doc).toContain('Arbo sends nothing');
  });
});

// ─── merged under Lane A's door and R33 (audit wave 1 integration) ─────────
describe('GET /health/feeds under Lane A’s door and R33 (Mike, 2026-10-20: "Connect Google as a read only and connect quo as read only")', () => {
  it('R33: holds off on purpose are OFF — never down (no page), never waiting — and a Quo hook Arbo won’t create is OFF in R33’s words', () => {
    const i = healthy();
    i.holds = { configured: true, readOnly: true };
    i.quo.status = quoStatus({
      holds: 'read_only',
      registration: { state: 'read_only', detail: 'Quo webhook missing — Arbo is read-only and won’t create it; texts and calls are read from Quo’s record instead.', retryAt: null },
      feedLog: { holdFiledAt: null, holdFailedAt: null, holdError: null, readOkAt: T(60) },
    }) as never;
    const h = buildFeedHealth(i, NOW);
    expect(h.ok).toBe(true);
    expect(h.down).toEqual([]);
    const f = byFeed(i);
    expect(f.calendar_holds).toMatchObject({ state: 'off' });
    expect(f.calendar_holds!.detail).toContain('Google is connected read-only');
    expect(f.calendar_holds!.detail).not.toMatch(/FAILED|No Google sign-in/);
    expect(f.quo_webhooks).toMatchObject({ state: 'off', detail: 'Quo webhook missing — Arbo is read-only and won’t create it; texts and calls are read from Quo’s record instead.' });
    // Read-only with NO Google sign-in at all is still off on purpose — not "no sign-in, down".
    i.holds = { configured: false, readOnly: true };
    expect(byFeed(i).calendar_holds!.state).toBe('off');
  });

  it('R33: the no-model-key line does not blame missing holds on the key while holds are off', () => {
    const i = healthy();
    i.quo.status = quoStatus({ reading: false, holds: 'read_only' }) as never;
    expect(byFeed(i).sona_reading!.detail).not.toContain('no hold is filed');
    i.quo.status = quoStatus({ reading: false }) as never; // holds on (the dormant path): as M14 built it
    expect(byFeed(i).sona_reading!.detail).toContain('no hold is filed');
  });

  async function serveWith(envOverrides: Record<string, string | undefined>, opts: Record<string, unknown>): Promise<{ base: string; srv: Server }> {
    vi.resetModules();
    for (const [k, v] of Object.entries(envOverrides)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { createArborRequestHandler } = await import('../src/server.js');
    const srv = createServer((createArborRequestHandler as (o?: unknown) => ReturnType<typeof createArborRequestHandler>)(opts));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    return { base: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, srv };
  }

  it('Lane A M2: wrong keys at /health/feeds are counted by the SAME limiter as /api — never a way round it to guess the key', async () => {
    let now = Date.parse('2026-10-20T12:00:00Z');
    const { KeyAttemptGuard } = await import('../src/server/accessDoor.js');
    const keyGuard = new KeyAttemptGuard({ now: () => now, log: () => {} });
    const { base, srv } = await serveWith({ APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', QUO_API_KEY: undefined, GMAIL_OAUTH_REFRESH_TOKEN: undefined, ARBO_SECRET_DIR: '/nonexistent-arbo-test' }, { keyGuard });
    const hit = (path: string, key: string) => fetch(base + path, { headers: { 'x-arbor-key': key, 'x-real-ip': '203.0.113.9' } });
    try {
      for (let i = 1; i <= 9; i++) expect((await hit('/health/feeds', `guess-${i}`)).status).toBe(401);
      const tenth = await hit('/health/feeds', 'guess-10');
      expect(tenth.status).toBe(429);
      expect(tenth.headers.get('retry-after')).toBeTruthy();
      expect(await tenth.json()).toMatchObject({ error: 'too_many_attempts' });
      // The same connection is now throttled at the /api door too — one owner door, one count.
      expect((await hit('/api/leads', 'guess-11')).status).toBe(429);
      // The crew key at this owner-only page is refused and never counted as a guess.
      expect((await fetch(base + '/health/feeds', { headers: { 'x-arbor-key': 'crew-k', 'x-real-ip': '198.51.100.4' } })).status).toBe(401);
      now += 60_000;
      // The right key opens on the next one-a-minute check — 503 because nothing is wired in a test server.
      expect((await hit('/health/feeds', 'admin-k')).status).toBe(503);
    } finally { srv.close(); }
  });

  it('R33 over the wire: with the owner key the calendar-holds feed reads OFF, not down — it never pages', async () => {
    const { base, srv } = await serveWith({ APP_ACCESS_KEY: 'admin-k', QUO_API_KEY: undefined, GMAIL_OAUTH_REFRESH_TOKEN: undefined, ARBO_SECRET_DIR: '/nonexistent-arbo-test' }, {});
    try {
      const body = (await (await fetch(`${base}/health/feeds`, { headers: { 'x-arbor-key': 'admin-k' } })).json()) as { down: string[]; feeds: Array<{ feed: string; state: string }> };
      expect(body.feeds.find((f) => f.feed === 'calendar_holds')!.state).toBe('off');
      expect(body.down).not.toContain('calendar_holds');
    } finally { srv.close(); }
  });
});
