// R31 draft — Bouncie truck tracking (Mike, 2026-10-20: "why dont you build
// and then i add later"). Built dormant: these tests run the whole path with
// a fake Bouncie — the sign-in, the rotating refresh token, the webhook, the
// positions states, the owner-only routes, and the two page pieces Mike sees.
// Every value below is made up: no real token, VIN, device or place.
import { describe, it, expect, vi, afterAll, afterEach, beforeEach } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  Bouncie,
  BouncieTokenStore,
  diskTokenBackend,
  supabaseTokenBackend,
  bouncieTokenBackend,
  authorizeUrl,
  pkceChallenge,
  bouncieLinked,
  matchTrucks,
  callbackPage,
  POSITIONS_SAYS,
  AUTHORIZE_URL,
  TOKEN_URL,
  API_BASE,
  BOUNCIE_REDIRECT,
  BOUNCIE_CALLBACK_PATH,
  RETIRED_CALLBACK_PATH,
  BOUNCIE_WEBHOOK_URL,
  TRIPS_SAYS,
  type BouncieHttp,
  type TokenBackend,
} from '../src/integrations/bouncie.js';
import { CredentialStore, openCredential, type CredentialHttp } from '../src/db/credentialStore.js';
import { inspectMessage } from '../src/binder/policyEngine.js';
import { loadAllConfig } from '../src/config/loadConfig.js';
import { loadAppHtml, loadCrewHtml } from '../src/server/appPage.js';

// ---------- made-up values ----------
const CLIENT = 'arbo-app'; // Mike's Client ID (2026-10-20) — it reaches Arbo only from BOUNCIE_CLIENT_ID
const SECRET = 'fake-client-secret-0042';
const HOOK_KEY = 'fake-hook-key-made-up-77';
const IMEI = '864000000009876';
const VIN = '1FAKEVIN000000001';
const LAT = 36.85291;
const LON = -75.97802;
const T0 = Date.parse('2026-10-20T14:00:00Z'); // Tuesday 10:00 in Virginia Beach — inside working hours
const AFTER = Date.parse('2026-10-21T01:30:00Z'); // Tuesday 9:30 PM there — after hours
const SUNDAY = Date.parse('2026-10-18T16:00:00Z'); // Sunday noon there — no working hours at all
const iso = (ms: number) => new Date(ms).toISOString();
const min = 60_000;

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});
afterAll(() => {
  process.env = { ...saved };
  vi.resetModules();
  vi.unstubAllGlobals();
});

type Init = Parameters<BouncieHttp>[1];
const answer = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const tmp = () => mkdtempSync(join(tmpdir(), 'arbo-bouncie-'));

/** A fake Bouncie: token grants in order, then whatever `vehicles` says. Every call is recorded. */
function fakeBouncie(over: { grants?: Array<() => ReturnType<typeof answer> | Promise<ReturnType<typeof answer>>>; vehicles?: (token: string, url: string) => ReturnType<typeof answer> } = {}) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: Record<string, string> | null; redirect: unknown }> = [];
  let g = 0;
  const http: BouncieHttp = async (url: string, init: Init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null, redirect: init.redirect });
    if (url === TOKEN_URL) {
      const next = over.grants?.[g++];
      return next ? next() : answer(400, { error: 'invalid_grant' });
    }
    return over.vehicles ? over.vehicles(init.headers.authorization ?? '', url) : answer(200, []);
  };
  return { http, calls, tokenCalls: () => calls.filter((c) => c.url === TOKEN_URL), reads: () => calls.filter((c) => c.url.startsWith(API_BASE)) };
}
const grant = (n: number, expiresIn = 3600) => () => answer(200, { access_token: `ACCESS-FAKE-${n}`, refresh_token: `REFRESH-FAKE-${n}`, expires_in: expiresIn, token_type: 'Bearer' });

/** A Bouncie on the practice-mode disk store (or the store given), on a clock the test moves. */
function make(over: Partial<ConstructorParameters<typeof Bouncie>[0]> & { clock?: { t: number }; dir?: string } = {}) {
  const { clock: given, dir: givenDir, ...rest } = over;
  const clock = given ?? { t: T0 };
  const dir = givenDir ?? tmp();
  const b = new Bouncie({ clientId: CLIENT, clientSecret: SECRET, webhookKey: HOOK_KEY, tokens: diskTokenBackend(dir), now: () => clock.t, ...rest });
  return { b, clock, dir };
}
/** Start a sign-in and hand back the state and challenge it put in the authorize URL. */
function begin(b: Bouncie) {
  const r = b.beginConnect();
  if (!r.ok) throw new Error('keys missing');
  const u = new URL(r.authorizeUrl);
  return { state: u.searchParams.get('state')!, challenge: u.searchParams.get('code_challenge')!, url: u };
}
async function connected(over: Parameters<typeof make>[0] = {}) {
  const m = make(over);
  const { state } = begin(m.b);
  const r = await m.b.finishConnect({ code: 'CODE-FAKE-1', state });
  expect(r.ok).toBe(true);
  return m;
}
const hook = (b: Bouncie, body: unknown, h: { authorization?: unknown; xBouncie?: unknown } = { authorization: HOOK_KEY, xBouncie: HOOK_KEY }) =>
  b.handleWebhook(h, async () => (body === null ? null : typeof body === 'string' ? body : JSON.stringify(body)));
const tripData = (points: Array<[number, number, number]>, imei = IMEI) => ({
  eventType: 'tripData', imei, vin: VIN, transactionId: `${imei}-1-1`,
  data: points.map(([at, lat, lon]) => ({ timestamp: iso(at), speed: 30, gps: { lat, lon, heading: 90 } })),
});
const vehicle = (over: Record<string, unknown> = {}, stats: Record<string, unknown> = {}) => ({
  imei: IMEI, vin: VIN, nickName: 'Bucket truck', model: { make: 'Fake', name: 'Truck', year: 2020 },
  stats: { lastUpdated: iso(T0 - 12 * min), isRunning: false, location: { lat: LAT, lon: LON, heading: 0, address: '1 Made Up Way' }, ...stats },
  ...over,
});
const UNITS = { ok: true as const, units: [{ id: 'u-bucket', name: 'Bucket truck', vinOrSerial: VIN }, { id: 'u-chip', name: 'Chip truck', vinOrSerial: 'OTHERVIN' }] };

// ---------- the switch ----------
describe('the Bouncie link switch fails closed', () => {
  it('is open only when ARBO_LINK_BOUNCIE is exactly "live"', () => {
    delete process.env.ARBO_LINK_BOUNCIE;
    expect(bouncieLinked()).toBe(false);
    for (const v of ['', 'off', 'true', 'LIVE', 'live ', ' live', 'Live']) {
      process.env.ARBO_LINK_BOUNCIE = v;
      expect(bouncieLinked(), JSON.stringify(v)).toBe(false);
    }
    process.env.ARBO_LINK_BOUNCIE = 'live';
    expect(bouncieLinked()).toBe(true);
  });
});

// ---------- sign-in ----------
describe('Connect Bouncie — the authorize address', () => {
  it('carries the client id, the exact redirect, a state and an S256 challenge — never the secret', () => {
    const u = new URL(authorizeUrl(CLIENT, 'S'.repeat(32), 'v'.repeat(64)));
    expect(`${u.origin}${u.pathname}`).toBe(AUTHORIZE_URL);
    expect(u.origin).toBe('https://auth.bouncie.com');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: 'arbo-app',
      response_type: 'code',
      redirect_uri: 'https://arbor-server-production.up.railway.app/api/bouncie/callback',
      state: 'S'.repeat(32),
      code_challenge: createHash('sha256').update('v'.repeat(64)).digest('base64url'),
      code_challenge_method: 'S256',
    });
    // Mike's spec (2026-10-20) moved the callback: pin updated from /bouncie/callback on purpose.
    expect(BOUNCIE_REDIRECT).toBe('https://arbor-server-production.up.railway.app/api/bouncie/callback');
    expect(u.toString()).not.toContain(SECRET);
  });

  it('refuses to start with no keys on the server, by name', () => {
    const { b } = make({ clientId: null });
    expect(b.beginConnect()).toEqual({ ok: false, error: 'bouncie_keys_missing' });
    expect(b.signInState()).toBe('keys_missing');
  });

  it('every tap mints a fresh, long state', () => {
    const { b } = make();
    const a = begin(b);
    const c = begin(b);
    expect(a.state).not.toBe(c.state);
    expect(a.state).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe('the callback — state checked, single use, and the code swapped server-side', () => {
  it('swaps the code with the verifier that matches the challenge, and saves the pair on the disk (0600)', async () => {
    const f = fakeBouncie({ grants: [grant(1)] });
    const { b, dir } = make({ http: f.http });
    const { state, challenge } = begin(b);
    const r = await b.finishConnect({ code: 'CODE-FAKE-1', state });
    expect(r).toMatchObject({ status: 200, ok: true, title: 'Bouncie is connected' });
    const [call] = f.tokenCalls();
    expect(call!.method).toBe('POST');
    expect(call!.headers['content-type']).toBe('application/json');
    expect(call!.body).toMatchObject({ client_id: CLIENT, client_secret: SECRET, grant_type: 'authorization_code', code: 'CODE-FAKE-1', redirect_uri: BOUNCIE_REDIRECT });
    expect(pkceChallenge(call!.body!.code_verifier!)).toBe(challenge);
    expect(call!.body!.code_verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    const file = join(dir, 'bouncie-token.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ accessToken: 'ACCESS-FAKE-1', refreshToken: 'REFRESH-FAKE-1', expiresAt: T0 + 3600_000 });
    expect(b.signInState()).toBe('connected');
    expect(JSON.stringify(await b.status())).not.toMatch(/ACCESS-FAKE|REFRESH-FAKE|fake-client-secret|fake-hook-key/);
  });

  it('a state Arbo never minted is refused before Bouncie is asked anything', async () => {
    const f = fakeBouncie({ grants: [grant(1)] });
    const { b } = make({ http: f.http });
    begin(b);
    const r = await b.finishConnect({ code: 'CODE-FAKE-1', state: 'x'.repeat(32) });
    expect(r).toMatchObject({ status: 400, ok: false, title: 'That sign-in link is not one Arbo is waiting for' });
    expect((await b.finishConnect({ code: 'CODE-FAKE-1', state: null })).status).toBe(400);
    expect((await b.finishConnect({ code: 'CODE-FAKE-1', state: '<script>' })).status).toBe(400);
    expect(f.calls).toEqual([]);
    expect(b.signInState()).toBe('not_connected');
  });

  it('a state works once: the same link again is refused, whatever happened the first time', async () => {
    const f = fakeBouncie({ grants: [grant(1), grant(2)] });
    const { b } = make({ http: f.http });
    const { state } = begin(b);
    expect((await b.finishConnect({ code: 'CODE-FAKE-1', state })).ok).toBe(true);
    const again = await b.finishConnect({ code: 'CODE-FAKE-1', state });
    expect(again.status).toBe(400);
    expect(f.tokenCalls()).toHaveLength(1);
    // A refused swap uses the state up too.
    const g = fakeBouncie();
    const m = make({ http: g.http });
    const s2 = begin(m.b).state;
    expect((await m.b.finishConnect({ code: 'CODE-BAD', state: s2 })).title).toBe('Bouncie refused the sign-in');
    expect((await m.b.finishConnect({ code: 'CODE-BAD', state: s2 })).title).toBe('That sign-in link is not one Arbo is waiting for');
  });

  it('a state older than ten minutes is refused', async () => {
    const f = fakeBouncie({ grants: [grant(1)] });
    const { b, clock } = make({ http: f.http });
    const { state } = begin(b);
    clock.t += 11 * min;
    expect((await b.finishConnect({ code: 'CODE-FAKE-1', state })).status).toBe(400);
    expect(f.calls).toEqual([]);
  });

  it('no code, a refusal, and an outage are three different sentences — and none saves anything', async () => {
    const none = make({ http: fakeBouncie({ grants: [grant(1)] }).http });
    expect(await none.b.finishConnect({ code: null, state: begin(none.b).state })).toMatchObject({ status: 400, title: 'Bouncie did not send a sign-in code' });
    const refused = make({ http: fakeBouncie().http });
    const no = await refused.b.finishConnect({ code: 'C', state: begin(refused.b).state });
    expect(no).toMatchObject({ status: 400, title: 'Bouncie refused the sign-in' });
    // A refusal says what Bouncie answered and names the likeliest cause — a secret pasted wrong — not a redirect
    // (a wrong redirect fails on Bouncie's own page and never reaches Arbo).
    expect(no.line).toBe('Bouncie said no (HTTP 400): the code was already used or replaced, or BOUNCIE_CLIENT_SECRET on Railway doesn’t match the portal. Nothing was saved. Go back to Settings in Arbo and tap Connect Bouncie again.');
    const wrongSecret = make({ http: fakeBouncie({ grants: [() => answer(401, { error: 'invalid_client' })] }).http });
    expect((await wrongSecret.b.finishConnect({ code: 'C', state: begin(wrongSecret.b).state })).line).toContain('Bouncie said no (HTTP 401)');
    const down = make({ http: async () => { throw new Error('ENOTFOUND'); } });
    expect(await down.b.finishConnect({ code: 'C', state: begin(down.b).state })).toMatchObject({ status: 502, title: 'Arbo couldn’t reach Bouncie' });
    const noRefresh = make({ http: fakeBouncie({ grants: [() => answer(200, { access_token: 'ACCESS-ONLY', expires_in: 3600 })] }).http });
    expect((await noRefresh.b.finishConnect({ code: 'C', state: begin(noRefresh.b).state })).ok).toBe(false);
    for (const m of [none, refused, wrongSecret, down, noRefresh]) {
      expect(m.b.signInState()).toBe('not_connected');
      expect(existsSync(join(m.dir, 'bouncie-token.json'))).toBe(false);
    }
  });

  it('with no keys on the server the callback says so and swaps nothing', async () => {
    const f = fakeBouncie({ grants: [grant(1)] });
    const { b } = make({ http: f.http, clientSecret: null });
    expect(await b.finishConnect({ code: 'C', state: 'y'.repeat(32) })).toMatchObject({ status: 503, title: 'Bouncie isn’t set up on the server' });
    expect(f.calls).toEqual([]);
  });

  it('the result page is a whole page with a way back — it never repeats the code or the state', () => {
    const page = callbackPage({ status: 400, ok: false, title: 'A <b> & "c"', line: 'Nothing was saved.' });
    expect(page).toContain('<!doctype html>');
    expect(page).toContain('A &lt;b&gt; &amp; &quot;c&quot;');
    expect(page).toContain('<a class="btn" href="/app">Back to the app</a>');
    expect(page).toContain('<meta name="referrer" content="no-referrer">');
    expect(page).not.toMatch(/code=|state=/);
  });
});

// ---------- the token on the disk (practice mode and tests only — production keeps it in Supabase) ----------
describe('the Bouncie token store — practice mode keeps the first build\'s disk file', () => {
  const loaded = async (backend: TokenBackend) => {
    const s = new BouncieTokenStore(backend);
    await s.load(T0);
    return s;
  };
  it('survives a restart, and its status never carries a token', async () => {
    const dir = tmp();
    const s = await loaded(diskTokenBackend(dir));
    expect(s.status()).toEqual({ stored: false, where: null, savedAt: null, problem: null });
    expect(await s.save({ accessToken: 'ACCESS-FAKE-9', refreshToken: 'REFRESH-FAKE-9', expiresAt: T0, savedAt: iso(T0) })).toEqual({ ok: true, where: 'disk' });
    const again = await loaded(diskTokenBackend(dir));
    expect(again.current()).toMatchObject({ accessToken: 'ACCESS-FAKE-9', refreshToken: 'REFRESH-FAKE-9' });
    expect(again.status()).toEqual({ stored: true, where: 'disk', savedAt: iso(T0), problem: null });
    expect(JSON.stringify(again.status())).not.toContain('FAKE-9');
  });

  it('with no usable disk it holds the pair in memory and says so', async () => {
    const dir = tmp();
    const blocker = join(dir, 'not-a-dir');
    writeFileSync(blocker, 'x');
    const s = await loaded(diskTokenBackend(join(blocker, 'sub')));
    expect(await s.save({ accessToken: 'A', refreshToken: 'R', expiresAt: T0, savedAt: iso(T0) })).toEqual({ ok: true, where: 'memory' });
    expect(s.status()).toMatchObject({ stored: true, where: 'memory' });
  });

  it('a damaged file is not a sign-in', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'bouncie-token.json'), '{"accessToken":"A"}');
    expect((await loaded(diskTokenBackend(dir))).status().stored).toBe(false);
    writeFileSync(join(dir, 'bouncie-token.json'), 'not json');
    expect((await loaded(diskTokenBackend(dir))).current()).toBeNull();
  });
});

// ---------- refresh with rotation ----------
describe('the access token — refreshed early, one refresh at a time, the rotated pair saved first', () => {
  it('concurrent callers share ONE refresh, and the next refresh uses the NEW refresh token', async () => {
    const f = fakeBouncie({ grants: [grant(1), grant(2), grant(3)] });
    const { b, clock, dir } = await connected({ http: f.http });
    expect(await b.accessToken()).toEqual({ ok: true, token: 'ACCESS-FAKE-1' });
    clock.t = T0 + 3600_000 - 30_000; // inside the one-minute margin
    const all = await Promise.all([b.accessToken(), b.accessToken(), b.accessToken()]);
    expect(all).toEqual([0, 1, 2].map(() => ({ ok: true, token: 'ACCESS-FAKE-2' })));
    expect(f.tokenCalls()).toHaveLength(2); // the sign-in + exactly one refresh
    expect(f.tokenCalls()[1]!.body).toEqual({ client_id: CLIENT, client_secret: SECRET, grant_type: 'refresh_token', refresh_token: 'REFRESH-FAKE-1' });
    expect(JSON.parse(readFileSync(join(dir, 'bouncie-token.json'), 'utf8'))).toMatchObject({ accessToken: 'ACCESS-FAKE-2', refreshToken: 'REFRESH-FAKE-2' });
    clock.t += 3600_000;
    expect(await b.accessToken()).toEqual({ ok: true, token: 'ACCESS-FAKE-3' });
    expect(f.tokenCalls()[2]!.body!.refresh_token).toBe('REFRESH-FAKE-2'); // never the dead one
    expect(f.tokenCalls().map((c) => c.body!.refresh_token).filter((t) => t === 'REFRESH-FAKE-1')).toHaveLength(1);
  });

  it('the new pair is on the disk before the new access token is used', async () => {
    const dir = tmp();
    let onDiskWhenUsed: string | null = null;
    const f = fakeBouncie({
      grants: [grant(1), grant(2)],
      vehicles: (token) => {
        onDiskWhenUsed = JSON.parse(readFileSync(join(dir, 'bouncie-token.json'), 'utf8')).accessToken;
        return token === 'ACCESS-FAKE-2' ? answer(200, []) : answer(401, {});
      },
    });
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const { b, clock } = await connected({ http: f.http, dir });
    clock.t = T0 + 3600_000; // expired
    expect((await b.positions(UNITS)).state).toBe('no_trucks');
    expect(onDiskWhenUsed).toBe('ACCESS-FAKE-2');
  });

  it('Bouncie refusing the refresh token is "token expired — reconnect": no more tries until Mike reconnects', async () => {
    const f = fakeBouncie({ grants: [grant(1), () => answer(400, { error: 'invalid_grant' }), grant(3)] });
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const { b, clock } = await connected({ http: f.http });
    clock.t = T0 + 3600_000;
    expect(await b.accessToken()).toEqual({ ok: false, reason: 'expired' });
    expect(b.signInState()).toBe('expired');
    expect((await b.positions(UNITS)).state).toBe('token_expired');
    await b.accessToken();
    expect(f.tokenCalls()).toHaveLength(2);
    // Reconnecting clears it.
    const r = await b.finishConnect({ code: 'CODE-FAKE-3', state: begin(b).state });
    expect(r.ok).toBe(true);
    expect(b.signInState()).toBe('connected');
  });

  it('an outage keeps the old pair and tries again next time — it is "couldn\'t read", not "expired"', async () => {
    let down = true;
    const f = fakeBouncie({ grants: [grant(1), () => (down ? answer(503, {}) : grant(2)()), () => grant(2)()] });
    const { b, clock, dir } = await connected({ http: f.http });
    clock.t = T0 + 3600_000;
    expect(await b.accessToken()).toEqual({ ok: false, reason: 'unreadable' });
    expect(b.signInState()).toBe('connected');
    expect(JSON.parse(readFileSync(join(dir, 'bouncie-token.json'), 'utf8')).refreshToken).toBe('REFRESH-FAKE-1');
    down = false;
    expect(await b.accessToken()).toEqual({ ok: true, token: 'ACCESS-FAKE-2' });
    expect(f.tokenCalls()[2]!.body!.refresh_token).toBe('REFRESH-FAKE-1');
  });

  it('a Connect that lands while a refresh is in flight wins; the late refresh answer is never saved', async () => {
    let release: (v: ReturnType<typeof answer>) => void = () => {};
    const slow = new Promise<ReturnType<typeof answer>>((r) => { release = r; });
    const f = fakeBouncie({ grants: [grant(1), () => slow, grant(5)] });
    const { b, clock, dir } = await connected({ http: f.http });
    clock.t = T0 + 3600_000;
    const pending = b.accessToken();
    await Promise.resolve();
    expect((await b.finishConnect({ code: 'CODE-FAKE-5', state: begin(b).state })).ok).toBe(true);
    release(grant(2)());
    expect(await pending).toEqual({ ok: true, token: 'ACCESS-FAKE-5' });
    expect(JSON.parse(readFileSync(join(dir, 'bouncie-token.json'), 'utf8')).accessToken).toBe('ACCESS-FAKE-5');
  });

  it('a 401 from the REST side refreshes once and retries once; a second 401 is "reconnect"', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const f = fakeBouncie({ grants: [grant(1), grant(2)], vehicles: (t) => (t === 'ACCESS-FAKE-2' ? answer(200, [vehicle()]) : answer(401, {})) });
    const { b } = await connected({ http: f.http });
    expect((await b.positions(UNITS)).state).toBe('ok');
    expect(f.tokenCalls()).toHaveLength(2);
    const g = fakeBouncie({ grants: [grant(1), grant(2)], vehicles: () => answer(401, {}) });
    const m = await connected({ http: g.http });
    expect((await m.b.positions(UNITS)).state).toBe('token_expired');
    expect(m.b.signInState()).toBe('expired');
  });
});

// ---------- read only ----------
describe('Arbo reads Bouncie; it never writes to it', () => {
  it('the vehicles read is a GET with the bare token — no "Bearer" — and at most once a minute', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const f = fakeBouncie({ grants: [grant(1)], vehicles: () => answer(200, [vehicle()]) });
    const { b, clock } = await connected({ http: f.http });
    await b.positions(UNITS);
    await b.positions(UNITS);
    await b.status();
    expect(f.reads()).toHaveLength(1);
    const [r] = f.reads();
    expect(r!.method).toBe('GET');
    expect(r!.url).toBe(`${API_BASE}vehicles?limit=10`);
    expect(r!.headers.authorization).toBe('ACCESS-FAKE-1');
    clock.t += 61_000;
    await b.positions(UNITS);
    expect(f.reads()).toHaveLength(2);
    expect(f.calls.every((c) => (c.method === 'POST' ? c.url === TOKEN_URL : c.url.startsWith(`${API_BASE}vehicles?`)))).toBe(true);
  });

  it('the source has no write path: one POST (the token swap), two GETs (vehicles, trips), no webhook setup, geo-zones, locations or schedules', () => {
    const src = readFileSync(new URL('../src/integrations/bouncie.ts', import.meta.url), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/'(PUT|PATCH|DELETE)'/);
    expect(code).not.toMatch(/geozones|\/locations|\/schedules|v1\/webhooks|\/user\b/);
    // One door out (call → http), one POST through it (the token swap), one GET (the vehicles and trips reads share it).
    expect(code.match(/this\.http\(/g)).toHaveLength(1);
    expect(code.match(/this\.call\('POST'/g)).toEqual(["this.call('POST'"]);
    expect(code).toContain("this.call('POST', TOKEN_URL,");
    expect(code.match(/this\.call\('GET'/g)).toHaveLength(1);
    // Pin updated for Mike's spec (2026-10-20, "a read-only pull of vehicles and trips"): trips joins vehicles.
    expect(code).toContain("return method === 'POST' ? url === TOKEN_URL : url.startsWith(`${API_BASE}vehicles?`) || url.startsWith(`${API_BASE}trips?`);");
    // The business data never: no getDb, no repositories, no table of its own. Mike's spec keeps the
    // SIGN-IN in Supabase — reached only through the credential door, the one db import here.
    expect(code).not.toMatch(/getDb|repositories|\.from\(|\/rest\/v1|createClient/);
    expect(code.match(/from '\.\.\/db\/[^']+'/g)).toEqual(["from '../db/credentialStore.js'"]);
  });

  it('no call follows a redirect — a 3xx can never carry the secret or a refresh token to another host', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const f = fakeBouncie({ grants: [grant(1), grant(2)], vehicles: () => answer(200, [vehicle()]) });
    const { b, clock } = await connected({ http: f.http });
    clock.t = T0 + 3600_000; // the read below refreshes first: sign-in, refresh and read all go through the one door
    await b.positions(UNITS);
    expect(f.calls.map((c) => c.url)).toEqual([TOKEN_URL, TOKEN_URL, `${API_BASE}vehicles?limit=10`]);
    expect(f.calls.map((c) => c.redirect)).toEqual(['error', 'error', 'error']);
    // And the real door (no fake http) hands the same setting to fetch.
    const seen: unknown[] = [];
    vi.stubGlobal('fetch', async (_u: unknown, init?: RequestInit) => {
      seen.push(init?.redirect);
      return new Response(JSON.stringify({ access_token: 'ACCESS-FAKE-7', refresh_token: 'REFRESH-FAKE-7', expires_in: 3600 }), { status: 200 });
    });
    try {
      const real = new Bouncie({ clientId: CLIENT, clientSecret: SECRET, webhookKey: HOOK_KEY, tokens: diskTokenBackend(tmp()) });
      expect((await real.finishConnect({ code: 'CODE-FAKE-7', state: begin(real).state })).ok).toBe(true);
    } finally { vi.unstubAllGlobals(); }
    expect(seen).toEqual(['error']);
    // A redirect makes fetch throw — and a throw is "couldn't reach Bouncie", nothing saved.
    const bounced = make({ http: async () => { throw new TypeError('fetch failed: unexpected redirect'); } });
    expect(await bounced.b.finishConnect({ code: 'C', state: begin(bounced.b).state })).toMatchObject({ status: 502, ok: false });
    expect(bounced.b.signInState()).toBe('not_connected');
  });
});

// ---------- the webhook ----------
describe('the webhook — 401 for a wrong key, 200 at once for anything authentic', () => {
  it('no key on the server: refused by name (not wired), never accepted unverified', async () => {
    const { b } = make({ webhookKey: null });
    expect(await hook(b, tripData([[T0, LAT, LON]]))).toEqual({ status: 503, body: { error: 'webhook_not_wired' } });
    expect((await b.status()).webhook).toMatchObject({ wired: false, refusedNotWired: 1, received: 0 });
  });

  it('a wrong or missing key is 401 and the body is never read; either header carrying the right key is enough', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const { b } = make();
    let reads = 0;
    const call = (h: Record<string, unknown>) => b.handleWebhook(h, async () => { reads++; return JSON.stringify(tripData([[T0, LAT, LON]])); });
    expect(await call({})).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(await call({ authorization: 'nope', xBouncie: 'nope' })).toMatchObject({ status: 401 });
    expect(await call({ authorization: HOOK_KEY + 'x' })).toMatchObject({ status: 401 });
    expect(await call({ authorization: ['x', HOOK_KEY] })).toMatchObject({ status: 401 });
    expect(reads).toBe(0);
    expect(await call({ authorization: HOOK_KEY })).toEqual({ status: 200, body: { ok: true } });
    expect(await call({ authorization: 'stripped-by-a-proxy', xBouncie: HOOK_KEY })).toEqual({ status: 200, body: { ok: true } });
    expect((await b.status()).webhook).toMatchObject({ rejected: 4 });
  });

  it('the key is compared in constant time over a digest of both sides', () => {
    const src = readFileSync(new URL('../src/integrations/bouncie.ts', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('function sameKey('), src.indexOf('\n}\n', src.indexOf('function sameKey(')));
    expect(fn).toContain("createHash('sha256').update(g).digest()");
    expect(fn).toContain('timingSafeEqual(a, b)');
    // The key itself is never compared with == or ===, which would stop at the first wrong letter.
    expect(fn).not.toMatch(/(g|given|key)\s*[!=]==?\s*(g|given|key)\b/);
  });

  it('a cut link still answers 200 — and keeps nothing; the drop is counted and named', async () => {
    delete process.env.ARBO_LINK_BOUNCIE;
    const { b } = await connected({ http: fakeBouncie({ grants: [grant(1)] }).http });
    expect(await hook(b, tripData([[T0 - min, LAT, LON]]))).toEqual({ status: 200, body: { ok: true } });
    const s = await b.status();
    expect(s.webhook).toMatchObject({ whileCut: 1, received: 0 });
    expect(s.trucks.known).toBe(0);
    expect(s.positions.state).toBe('link_cut');
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const p = await b.positions(UNITS);
    expect(p.unmatched).toEqual([]);
    expect(p.units!.every((u) => u.truck === null)).toBe(true);
  });

  it('with the sign-in keys missing an authentic call is answered 200 and dropped too — counted as that, not as "cut"', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const { b } = make({ clientId: null, clientSecret: null });
    expect(await hook(b, tripData([[T0, LAT, LON]]))).toEqual({ status: 200, body: { ok: true } });
    expect((await b.status()).webhook).toMatchObject({ droppedKeysMissing: 1, whileCut: 0, deliveries: 0, received: 0, lastAuthenticAt: iso(T0) });
    // Cut AND keys missing: the cut is the reason named.
    delete process.env.ARBO_LINK_BOUNCIE;
    await hook(b, tripData([[T0, LAT, LON]]));
    expect((await b.status()).webhook).toMatchObject({ droppedKeysMissing: 1, whileCut: 1 });
  });

  it('the last refused call and the last authentic one are both timed, so Settings can tell a stranger from a wrong key', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const { b, clock } = make();
    expect((await b.status()).webhook).toMatchObject({ lastRejectedAt: null, lastAuthenticAt: null });
    await hook(b, {}, {});
    clock.t += min;
    await hook(b, tripData([[T0, LAT, LON]]));
    expect((await b.status()).webhook).toMatchObject({ rejected: 1, lastRejectedAt: iso(T0), lastAuthenticAt: iso(T0 + min) });
  });

  it('a duplicated tripData point is kept once; a burst out of order never moves a truck backwards', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const { b } = await connected({ http: fakeBouncie({ grants: [grant(1)], vehicles: () => answer(200, []) }).http });
    // Real-time stream: three points.
    await hook(b, tripData([[T0 - 3 * min, 36.80001, -75.90001], [T0 - 2 * min, 36.80002, -75.90002], [T0 - min, 36.80003, -75.90003]]));
    // Periodic stream: two of the same points, again.
    await hook(b, tripData([[T0 - 2 * min, 36.80002, -75.90002], [T0 - min, 36.80003, -75.90003]]));
    // A late burst from a signal loss: older points, arriving last.
    await hook(b, tripData([[T0 - 9 * min, 36.70009, -75.80009], [T0 - 8 * min, 36.70008, -75.80008]]));
    const s = await b.status();
    expect(s.webhook).toMatchObject({ received: 2, duplicates: 1 });
    const p = await b.positions(UNITS);
    const truck = p.units!.find((u) => u.unitId === 'u-bucket')!.truck!;
    expect(truck).toMatchObject({ lat: 36.80003, lon: -75.90003, motion: 'driving', ageMinutes: 1, reportedAt: iso(T0 - min) });
  });

  it('a trip end outranks a late point from the same trip; a stored disconnect never overrides a newer connect', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const { b } = await connected({ http: fakeBouncie({ grants: [grant(1)], vehicles: () => answer(200, []) }).http });
    await hook(b, { eventType: 'tripEnd', imei: IMEI, vin: VIN, transactionId: 't', end: { timestamp: iso(T0 - 2 * min), timeZone: 'America/New_York', odometer: 1, fuelConsumed: 0.1 } });
    await hook(b, tripData([[T0 - 2 * min, LAT, LON], [T0 - 3 * min, LAT, LON]]));
    let t = (await b.positions(UNITS)).units![0]!.truck!;
    expect(t.motion).toBe('parked');
    await hook(b, { eventType: 'connect', imei: IMEI, vin: VIN, connect: { timestamp: iso(T0 - min), timeZone: 'America/New_York', latitude: LAT, longitude: LON } });
    await hook(b, { eventType: 'disconnect', imei: IMEI, vin: VIN, disconnect: { timestamp: iso(T0 - 30 * min), timeZone: 'America/New_York', latitude: LAT, longitude: LON } });
    t = (await b.positions(UNITS)).units![0]!.truck!;
    expect(t.motion).toBe('parked');
    await hook(b, { eventType: 'disconnect', imei: IMEI, vin: VIN, disconnect: { timestamp: iso(T0), timeZone: 'America/New_York', latitude: LAT, longitude: LON } });
    await hook(b, { eventType: 'disconnect', imei: IMEI, vin: VIN, disconnect: { timestamp: iso(T0), timeZone: 'America/New_York', latitude: LAT, longitude: LON } });
    t = (await b.positions(UNITS)).units![0]!.truck!;
    expect(t.motion).toBe('unplugged');
    expect((await b.status()).webhook.duplicates).toBe(1); // the twice-sent unplug is one incident
  });

  it('unknown types, bad JSON, bad timestamps and an oversized body are all 200 — skipped and counted, never "now"', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const { b } = await connected({ http: fakeBouncie({ grants: [grant(1)], vehicles: () => answer(200, []) }).http });
    const ok = { status: 200, body: { ok: true } };
    expect(await hook(b, { eventType: 'somethingNew', imei: IMEI, vin: VIN })).toEqual(ok);
    expect(await hook(b, { eventType: 'constructor', imei: IMEI })).toEqual(ok);
    expect(await hook(b, '{not json')).toEqual(ok);
    expect(await hook(b, null)).toEqual(ok);
    // Bouncie's own docs show "T010:01" — unparseable, so dropped, never stamped with the time it arrived.
    expect(await hook(b, { eventType: 'tripData', imei: IMEI, vin: VIN, transactionId: 't', data: [{ timestamp: '2026-01-01T010:01:00.000Z', gps: { lat: LAT, lon: LON, heading: 1 } }] })).toEqual(ok);
    // A clock far ahead is not "now" either.
    expect(await hook(b, tripData([[T0 + 60 * min, LAT, LON]]))).toEqual(ok);
    const w = (await b.status()).webhook;
    expect(w).toMatchObject({ unknownTypes: 2, badJson: 1, oversized: 1, badEvents: 2, received: 0, deliveries: 6 });
    expect((await b.positions(UNITS)).state).toBe('no_trucks');
  });

  it('several events in one body are each read; a 0,0 fix is "no position", never a point in the ocean', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const { b } = await connected({ http: fakeBouncie({ grants: [grant(1)], vehicles: () => answer(200, []) }).http });
    await hook(b, [
      { eventType: 'tripStart', imei: IMEI, vin: VIN, transactionId: 't', start: { timestamp: iso(T0 - 2 * min), timeZone: 'America/New_York', odometer: 5 } },
      tripData([[T0 - min, 0, 0]]),
      { eventType: 'battery', imei: IMEI, vin: VIN, battery: { timestamp: iso(T0 - min), value: 'low' } },
    ]);
    const t = (await b.positions(UNITS)).units![0]!.truck!;
    expect(t).toMatchObject({ motion: 'no_fix', lat: null, lon: null });
    expect((await b.status()).webhook.received).toBe(3);
  });

  it('a report with no position never makes an old position look new (positionAt is the fix\'s own time)', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const { b } = await connected({ http: fakeBouncie({ grants: [grant(1)], vehicles: () => answer(200, []) }).http });
    const yesterday = T0 - 15 * 60 * min;
    await hook(b, tripData([[yesterday, 36.9, -75.9]]));
    await hook(b, { eventType: 'tripEnd', imei: IMEI, vin: VIN, transactionId: 't', end: { timestamp: iso(yesterday + min), timeZone: 'America/New_York', odometer: 1, fuelConsumed: 0.1 } });
    // This morning: the trip starts, no fix yet.
    await hook(b, { eventType: 'tripStart', imei: IMEI, vin: VIN, transactionId: 't2', start: { timestamp: iso(T0 - min), timeZone: 'America/New_York', odometer: 2 } });
    let t = (await b.positions(UNITS)).units![0]!.truck!;
    expect(t).toMatchObject({ lat: 36.9, positionAt: iso(yesterday), positionAgeMinutes: 15 * 60, reportedAt: iso(T0 - min), ageMinutes: 1 });
    expect(t.motion).toBe('stale'); // "driving" needs a fresh FIX, not just a fresh report
    // Parked, then a battery report: the truck's last fix keeps its own age.
    await hook(b, { eventType: 'tripEnd', imei: IMEI, vin: VIN, transactionId: 't2', end: { timestamp: iso(T0 - 30_000), timeZone: 'America/New_York', odometer: 2, fuelConsumed: 0 } });
    await hook(b, { eventType: 'battery', imei: IMEI, vin: VIN, battery: { timestamp: iso(T0), value: 'normal' } });
    t = (await b.positions(UNITS)).units![0]!.truck!;
    expect(t).toMatchObject({ motion: 'parked', ageMinutes: 0, positionAgeMinutes: 15 * 60 });
  });

  it('the vehicles read never moves a truck back past a fresh webhook fix; once the webhook is quiet it fills in again', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const clock = { t: T0 };
    // Bouncie's vehicle document: updated "now", but its stored location lags behind the live stream.
    const f = fakeBouncie({ grants: [grant(1)], vehicles: () => answer(200, [vehicle({}, { lastUpdated: iso(clock.t), isRunning: false, location: { lat: 36.0, lon: -76.0, heading: 0 } })]) });
    const { b } = await connected({ http: f.http, clock });
    await hook(b, tripData([[T0 - min, 36.9, -75.9]]));
    let t = (await b.positions(UNITS)).units![0]!.truck!;
    expect(f.reads()).toHaveLength(1);
    expect(t).toMatchObject({ lat: 36.9, lon: -75.9, motion: 'driving', positionAt: iso(T0 - min) });
    expect(t.name).toBe('Bucket truck'); // the read still names the truck
    // Twenty minutes with nothing from the webhook: the vehicles read is the best there is again.
    clock.t = T0 + 20 * min;
    t = (await b.positions(UNITS)).units![0]!.truck!;
    expect(f.reads()).toHaveLength(2);
    expect(t).toMatchObject({ lat: 36.0, lon: -76.0, motion: 'parked', positionAt: iso(T0 + 20 * min) });
  });

  it('a trip summary is kept short: miles and minutes only', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const { b } = await connected({ http: fakeBouncie({ grants: [grant(1)], vehicles: () => answer(200, [vehicle()]) }).http });
    await hook(b, { eventType: 'tripMetrics', imei: IMEI, vin: VIN, transactionId: 't', metrics: { timestamp: iso(T0 - 5 * min), tripTime: 1800, tripDistance: 12.5, totalIdlingTime: 60, maxSpeed: 61, averageDriveSpeed: 30, hardBrakingCounts: 1, hardAccelerationCounts: 0 } });
    const t = (await b.positions(UNITS)).units![0]!.truck!;
    expect(t.lastTrip).toEqual({ endedAt: iso(T0 - 5 * min), miles: 12.5, minutes: 30 });
  });
});

// ---------- positions: every state its own ----------
describe('GET /api/fleet/positions — every state named, and "no trucks" only when Bouncie says so', () => {
  it('the ten sentences are ten different sentences', () => {
    // 7 → 9 with Mike's spec (2026-10-20): the saved sign-in unreadable, and after hours.
    // 9 → 10 after the §11 audit: the sign-in store cut on purpose is not "can't open it".
    const says = Object.values(POSITIONS_SAYS);
    expect(new Set(says).size).toBe(10);
    for (const [k, v] of Object.entries(POSITIONS_SAYS)) {
      if (k === 'no_trucks' || k === 'ok') continue;
      expect(v, k).toContain('This is not "no trucks".');
    }
  });

  it('keys missing → link cut → not connected → expired → unreadable → no trucks → ok, each in turn', async () => {
    const states: string[] = [];
    process.env.ARBO_LINK_BOUNCIE = 'live';
    states.push((await make({ clientId: null }).b.positions(UNITS)).state);
    delete process.env.ARBO_LINK_BOUNCIE;
    states.push((await make().b.positions(UNITS)).state);
    process.env.ARBO_LINK_BOUNCIE = 'live';
    states.push((await make().b.positions(UNITS)).state);
    const expired = await connected({ http: fakeBouncie({ grants: [grant(1)] }).http });
    expired.clock.t = T0 + 2 * 3600_000;
    states.push((await expired.b.positions(UNITS)).state);
    states.push((await (await connected({ http: fakeBouncie({ grants: [grant(1)], vehicles: () => answer(500, {}) }).http })).b.positions(UNITS)).state);
    states.push((await (await connected({ http: fakeBouncie({ grants: [grant(1)], vehicles: () => answer(200, { not: 'a list' }) }).http })).b.positions(UNITS)).state);
    states.push((await (await connected({ http: fakeBouncie({ grants: [grant(1)], vehicles: () => answer(200, []) }).http })).b.positions(UNITS)).state);
    states.push((await (await connected({ http: fakeBouncie({ grants: [grant(1)], vehicles: () => answer(200, [vehicle()]) }).http })).b.positions(UNITS)).state);
    expect(states).toEqual(['keys_missing', 'link_cut', 'not_connected', 'token_expired', 'unreadable', 'unreadable', 'no_trucks', 'ok']);
  });

  it('a fresh parked truck, a stale one, a driving one gone quiet, and one with no fix', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const list = [
      vehicle(),
      // Stamped yesterday at 8:00 AM (inside working hours), 26 hours ago: stale. The first build used 30 hours —
      // 4:00 AM, after hours — which Mike's spec (2026-10-20) now withholds; that case has its own test below.
      vehicle({ imei: '864000000001111', vin: 'STALEVIN000000002', nickName: 'Chip truck' }, { lastUpdated: iso(T0 - 26 * 60 * min) }),
      vehicle({ imei: '864000000002222', vin: 'NOFIXVIN000000003', nickName: 'Dump truck' }, { location: undefined }),
    ];
    const { b, clock } = await connected({ http: fakeBouncie({ grants: [grant(1)], vehicles: () => answer(200, list) }).http });
    let p = await b.positions(UNITS);
    expect(p.units!.find((u) => u.unitId === 'u-bucket')).toMatchObject({ match: 'vin', truck: { motion: 'parked', ageMinutes: 12, name: 'Bucket truck', vin4: '0001', device4: '9876' } });
    expect(p.units!.find((u) => u.unitId === 'u-chip')).toMatchObject({ match: 'name', truck: { motion: 'stale' } });
    expect(p.unmatched).toHaveLength(1);
    expect(p.unmatched[0]).toMatchObject({ name: 'Dump truck', motion: 'no_fix', lat: null, lon: null });
    // Never the whole VIN, the whole device number, or the street address.
    const json = JSON.stringify(p);
    expect(json).not.toContain(VIN);
    expect(json).not.toContain(IMEI);
    expect(json).not.toContain('Made Up Way');
    // Driving, then quiet for 20 minutes: no longer "driving".
    await hook(b, tripData([[T0, LAT, LON]]));
    p = await b.positions(UNITS);
    expect(p.units!.find((u) => u.unitId === 'u-bucket')!.truck!.motion).toBe('driving');
    clock.t += 20 * min;
    p = await b.positions(UNITS);
    expect(p.units!.find((u) => u.unitId === 'u-bucket')!.truck!.motion).toBe('stale');
  });

  it('with the fleet list unreadable the trucks still list, unmatched, and the reason is named', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const { b } = await connected({ http: fakeBouncie({ grants: [grant(1)], vehicles: () => answer(200, [vehicle()]) }).http });
    const p = await b.positions({ ok: false, error: 'link_cut' });
    expect(p).toMatchObject({ state: 'ok', units: null, unitsError: 'link_cut' });
    expect(p.unmatched).toHaveLength(1);
  });
});

describe('matching a Bouncie truck to a Fleet unit — only when unambiguous', () => {
  const t = (vin: string | null, name: string | null) => ({ vin, name });
  it('VIN first (spacing and case ignored), then a unique name', () => {
    const units = [{ id: 'a', name: 'Bucket Truck', vinOrSerial: '1fake vin-0000 00001' }, { id: 'b', name: 'Chip truck', vinOrSerial: null }];
    const r = matchTrucks(units, [t(VIN, 'Something else'), t(null, '  chip   TRUCK ')]);
    expect(r.matched.get('a')!.by).toBe('vin');
    expect(r.matched.get('b')!.by).toBe('name');
    expect(r.unmatched).toEqual([]);
  });
  it('two units or two trucks on one VIN or one name: nobody is guessed', () => {
    const r = matchTrucks([{ id: 'a', name: 'Truck', vinOrSerial: 'V1' }, { id: 'b', name: 'Truck', vinOrSerial: 'V1' }], [t('V1', 'Truck')]);
    expect(r.matched.size).toBe(0);
    expect(r.unmatched).toHaveLength(1);
    const r2 = matchTrucks([{ id: 'a', name: 'Truck' }], [t(null, 'Truck'), t(null, 'truck')]);
    expect(r2.matched.size).toBe(0);
    expect(r2.unmatched).toHaveLength(2);
  });
  it('two different real VINs are evidence against a pairing: the same name never overrides them', () => {
    const units = [{ id: 'a', name: 'Bucket Truck', vinOrSerial: '1FDUF5HT0BEA00001' }];
    const r = matchTrucks(units, [t('3ALACWDT9JDJZ0002', 'Bucket Truck')]);
    expect(r.matched.size).toBe(0);
    expect(r.unmatched).toHaveLength(1);
    // A serial number on the unit (a chipper, a trailer) is not a VIN, so it says nothing against the name.
    expect(matchTrucks([{ id: 'c', name: 'Chip truck', vinOrSerial: 'SN-4471' }], [t('3ALACWDT9JDJZ0002', 'Chip truck')]).matched.get('c')!.by).toBe('name');
    // A truck Bouncie has no VIN for is matched on its name as before.
    expect(matchTrucks(units, [t(null, 'bucket truck')]).matched.get('a')!.by).toBe('name');
  });
  it('a unit taken by VIN is not handed a second truck by name', () => {
    const r = matchTrucks([{ id: 'a', name: 'Truck', vinOrSerial: 'V1' }], [t('V1', 'Other'), t(null, 'Truck')]);
    expect(r.matched.get('a')!.truck.vin).toBe('V1');
    expect(r.unmatched).toEqual([t(null, 'Truck')]);
  });
});

// ---------- the crew never sees any of it ----------
describe('owner only — the crew surfaces carry no truck position', () => {
  it('the policy engine walls Bouncie and tracking off crew text (unchanged, still green)', () => {
    const { guardrails } = loadAllConfig();
    const v = inspectMessage({ audience: 'crew', channel: 'app', guardrails, text: 'Bouncie tracking: the bucket truck is parked on Oak St.' });
    expect(v.allowed).toBe(false);
    expect(v.blocks.filter((x) => x.rule === 'admin-data-wall').map((x) => x.detail).sort()).toEqual(['bouncie', 'tracking']);
  });

  it('the crew page never calls a Bouncie or positions route', () => {
    const crew = loadCrewHtml();
    expect(crew).not.toContain('/api/bouncie');
    expect(crew).not.toContain('/api/fleet/positions');
    expect(crew.toLowerCase()).not.toContain('bouncie');
  });
});

// ---------- over the wire ----------
const realFetch = globalThis.fetch;
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
const KEYS = { APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', BOUNCIE_CLIENT_ID: CLIENT, BOUNCIE_CLIENT_SECRET: SECRET, BOUNCIE_WEBHOOK_KEY: HOOK_KEY, ARBO_DATA_LINKS: 'sim' };

/** Bouncie's two hosts answered by a fake; everything else (this test's own calls) goes through. */
function stubBouncieHosts(now: () => number) {
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === TOKEN_URL) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>;
      return new Response(JSON.stringify(body.code === 'CODE-FAKE-1' ? { access_token: 'ACCESS-FAKE-1', refresh_token: 'REFRESH-FAKE-1', expires_in: 3600 } : { error: 'invalid_grant' }), { status: body.code === 'CODE-FAKE-1' ? 200 : 400 });
    }
    if (u.startsWith(API_BASE)) {
      const ok = (init?.headers as Record<string, string>).authorization === 'ACCESS-FAKE-1';
      // The practice fleet's chip truck carries VIN SIM-VIN-0001.
      const v = { imei: IMEI, vin: 'SIM-VIN-0001', nickName: 'SIM Chip truck', stats: { lastUpdated: new Date(now() - 12 * min).toISOString(), isRunning: false, location: { lat: LAT, lon: LON, heading: 0, address: '1 Made Up Way' } } };
      return new Response(JSON.stringify(ok ? [v] : {}), { status: ok ? 200 : 401 });
    }
    return realFetch(url, init);
  });
}

describe('the routes, end to end with a fake Bouncie', () => {
  // The server's clock is pinned inside working hours (Tuesday 10:00 in Virginia Beach): with the hours
  // enforced (Mike's spec, 2026-10-20), a real clock would make these tests fail every evening.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('owner only: the crew key and no key are refused on every Bouncie route; with no APP_ACCESS_KEY they stay locked', async () => {
    const { base, srv } = await serve({ ...KEYS, ARBO_SECRET_DIR: tmp() });
    try {
      for (const [method, path, owner] of [['GET', '/api/bouncie', 200], ['POST', '/api/bouncie/connect', 200], ['GET', '/api/fleet/positions', 200], ['GET', '/api/fleet/trips', 400]] as const) {
        for (const key of ['crew-k', 'wrong', undefined]) {
          const r = await realFetch(base + path, { method, headers: key ? { 'x-arbor-key': key } : {} });
          expect(r.status, `${method} ${path} with ${key}`).toBe(401);
        }
        // The owner key gets through (trips with no truck or day is the route's own named 400).
        expect((await realFetch(base + path, { method, headers: { 'x-arbor-key': 'admin-k' } })).status).toBe(owner);
      }
      // No crew twin of any of them.
      expect((await realFetch(base + '/api/crew/fleet/positions', { headers: { 'x-arbor-key': 'crew-k' } })).status).toBe(404);
      expect((await realFetch(base + '/api/crew/fleet/trips', { headers: { 'x-arbor-key': 'crew-k' } })).status).toBe(404);
    } finally { srv.close(); }
    const open = await serve({ ...KEYS, APP_ACCESS_KEY: undefined, CREW_ACCESS_KEY: undefined, ARBO_DATA_LINKS: undefined, ARBO_SECRET_DIR: tmp() });
    try {
      for (const p of ['/api/bouncie', '/api/fleet/positions', '/api/fleet/trips']) {
        const r = await realFetch(open.base + p);
        expect(r.status).toBe(401);
        expect(((await r.json()) as { error: string }).error).toBe('no_app_key');
      }
    } finally { open.srv.close(); }
  });

  it('the webhook answers without an Authorization header on every outcome, and the not-wired door names itself', async () => {
    const { base, srv } = await serve({ ...KEYS, ARBO_SECRET_DIR: tmp(), ARBO_LINK_BOUNCIE: undefined });
    const post = (h: Record<string, string>, body = JSON.stringify(tripData([[Date.now() - min, LAT, LON]]))) =>
      realFetch(base + '/webhooks/bouncie', { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body });
    try {
      const outcomes = [
        await post({}),
        await post({ authorization: 'wrong' }),
        await post({ authorization: HOOK_KEY }), // link cut: accepted and dropped
        await post({ 'x-bouncie-authorization': HOOK_KEY }, '{oops'),
        await post({ authorization: HOOK_KEY }, 'x'.repeat(1_100_000)), // over the 1 MB cap
      ];
      expect(outcomes.map((r) => r.status)).toEqual([401, 401, 200, 200, 200]);
      for (const r of outcomes) {
        expect(r.headers.get('authorization')).toBeNull();
        expect(r.headers.get('content-type')).toBe('application/json');
        JSON.parse(await r.text()); // always valid JSON — Bouncie retries anything else
      }
      const s = await (await realFetch(base + '/api/bouncie', { headers: { 'x-arbor-key': 'admin-k' } })).json() as { webhook: Record<string, number>; link: { open: boolean } };
      expect(s.link.open).toBe(false);
      expect(s.webhook).toMatchObject({ rejected: 2, whileCut: 3 });
    } finally { srv.close(); }
    const unwired = await serve({ ...KEYS, BOUNCIE_WEBHOOK_KEY: undefined, ARBO_SECRET_DIR: tmp() });
    try {
      const r = await realFetch(unwired.base + '/webhooks/bouncie', { method: 'POST', headers: { authorization: HOOK_KEY }, body: '{}' });
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ error: 'webhook_not_wired' });
    } finally { unwired.srv.close(); }
  });

  it('an oversized body with the right key is drained and answered 200 — never a reset (2, 5 and 8 MB, streamed in 64 KB chunks)', async () => {
    const { base, srv } = await serve({ ...KEYS, ARBO_SECRET_DIR: tmp(), ARBO_LINK_BOUNCIE: 'live' });
    const u = new URL(base);
    const stream = (bytes: number) => new Promise<number>((resolve, reject) => {
      const r = request({ host: u.hostname, port: u.port, path: '/webhooks/bouncie', method: 'POST', headers: { authorization: HOOK_KEY, 'content-type': 'application/json' } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      r.on('error', reject); // ECONNRESET / EPIPE: Bouncie would see a failure and retry, then switch the webhook off
      r.setTimeout(10_000, () => r.destroy(new Error(`no answer to a ${bytes}-byte body`))); // a hang is a failure too
      const chunk = Buffer.alloc(64 * 1024, 0x78);
      let left = bytes;
      const pump = (): void => {
        while (left > 0) {
          const n = Math.min(left, chunk.length);
          left -= n;
          if (!r.write(n === chunk.length ? chunk : chunk.subarray(0, n))) { r.once('drain', pump); return; }
        }
        r.end();
      };
      pump();
    });
    try {
      for (const mb of [2, 5, 8]) expect(await stream(mb * 1_000_000), `${mb} MB`).toBe(200);
      const s = await (await realFetch(base + '/api/bouncie', { headers: { 'x-arbor-key': 'admin-k' } })).json() as { webhook: Record<string, number> };
      expect(s.webhook).toMatchObject({ oversized: 3, deliveries: 3, received: 0 });
    } finally { srv.close(); }
  }, 60_000);

  it('Connect → callback → positions, with the crew door reading nothing of it and the logs carrying no secret, place or id', async () => {
    const dir = tmp();
    const lines: string[] = [];
    const spies = (['log', 'error', 'warn', 'info'] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); }));
    stubBouncieHosts(() => Date.now());
    const { base, srv } = await serve({ ...KEYS, ARBO_SECRET_DIR: dir, ARBO_LINK_BOUNCIE: 'live' });
    const owner = { 'x-arbor-key': 'admin-k' };
    try {
      // Not connected yet — named, never "no trucks".
      let p = await (await realFetch(base + '/api/fleet/positions', { headers: owner })).json() as { state: string };
      expect(p.state).toBe('not_connected');
      // Mike taps Connect.
      const c = await realFetch(base + '/api/bouncie/connect', { method: 'POST', headers: owner });
      const { authorizeUrl: go } = await c.json() as { authorizeUrl: string };
      const state = new URL(go).searchParams.get('state')!;
      // The first build's address is retired: a named 410 that points at the new door, and it spends nothing.
      const retired = await realFetch(`${base}${RETIRED_CALLBACK_PATH}?code=CODE-FAKE-1&state=${state}`);
      expect(retired.status).toBe(410);
      expect(retired.headers.get('cache-control')).toBe('no-store');
      const retiredPage = await retired.text();
      expect(retiredPage).toContain('This sign-in address has moved');
      expect(retiredPage).toContain(BOUNCIE_REDIRECT);
      expect(retiredPage).not.toContain('CODE-FAKE-1');
      expect(retiredPage).not.toContain(state);
      // A forged state is refused, and the page repeats neither value. The callback answers with NO app key.
      const forged = await realFetch(`${base}${BOUNCIE_CALLBACK_PATH}?code=CODE-FAKE-1&state=${'z'.repeat(32)}`);
      expect(forged.status).toBe(400);
      expect(forged.headers.get('cache-control')).toBe('no-store');
      expect(forged.headers.get('referrer-policy')).toBe('no-referrer');
      const forgedPage = await forged.text();
      expect(forgedPage).toContain('That sign-in link is not one Arbo is waiting for');
      expect(forgedPage).not.toContain('CODE-FAKE-1');
      // The real one connects, once.
      const cb = await realFetch(`${base}${BOUNCIE_CALLBACK_PATH}?code=CODE-FAKE-1&state=${state}`);
      expect(cb.status).toBe(200);
      const page = await cb.text();
      expect(page).toContain('Bouncie is connected');
      expect(page).toContain('Back to the app');
      expect(page).not.toContain('CODE-FAKE-1');
      expect(page).not.toContain(state);
      expect(statSync(join(dir, 'bouncie-token.json')).mode & 0o777).toBe(0o600);
      expect((await realFetch(`${base}${BOUNCIE_CALLBACK_PATH}?code=CODE-FAKE-1&state=${state}`)).status).toBe(400);
      // Positions: the practice chip truck, matched by VIN, parked 12 minutes ago.
      p = await (await realFetch(base + '/api/fleet/positions', { headers: owner })).json() as { state: string };
      const pos = p as unknown as { state: string; units: Array<{ unitId: string; match: string | null; truck: { motion: string; lat: number; ageMinutes: number } | null }> };
      expect(pos.state).toBe('ok');
      expect(pos.units.find((u) => u.unitId === 'sim-unit-1')).toMatchObject({ match: 'vin', truck: { motion: 'parked', lat: LAT, ageMinutes: 12 } });
      // A live update moves it.
      const moved = await realFetch(base + '/webhooks/bouncie', { method: 'POST', headers: { authorization: HOOK_KEY }, body: JSON.stringify(tripData([[Date.now() - 1000, 36.86012, -75.99001]])) });
      expect(moved.status).toBe(200);
      const pos2 = await (await realFetch(base + '/api/fleet/positions', { headers: owner })).json() as typeof pos;
      expect(pos2.units.find((u) => u.unitId === 'sim-unit-1')!.truck).toMatchObject({ motion: 'driving', lat: 36.86012 });
      // The crew door: work orders and the briefing carry none of it.
      // Deliberately updated (CREW_PLAN C4, D109): the crew key now meets the
      // sign-off lock on work orders (a 403 that carries nothing), so the work
      // orders are ALSO read the way they still render — through the owner key
      // (Mike's look-only preview) — and the payload itself is checked, as before.
      const today = new Date().toISOString().slice(0, 10);
      for (const [path, key] of [[`/api/crew/workorders?date=${today}`, 'crew-k'], [`/api/crew/workorders?date=${today}`, 'admin-k'], ['/api/crew/briefing', 'crew-k']] as const) {
        const r = await realFetch(base + path, { headers: { 'x-arbor-key': key, ...(key === 'admin-k' ? { 'x-arbo-preview': '1' } : {}) } });
        const text = (await r.text()).toLowerCase();
        if (key === 'admin-k') expect(text, 'the preview read the practice work orders').toContain('workorders');
        for (const leak of [String(LAT), String(LON), '36.86012', '-75.99001', IMEI, 'bouncie', 'tracking']) {
          expect(text, `${path} leaked ${leak}`).not.toContain(leak.toLowerCase());
        }
      }
      // Status for Settings: states and counts, no secrets.
      const status = await (await realFetch(base + '/api/bouncie', { headers: owner })).text();
      expect(status).not.toMatch(/ACCESS-FAKE|REFRESH-FAKE|fake-client-secret|fake-hook-key|CODE-FAKE/);
      expect(JSON.parse(status)).toMatchObject({ signIn: { state: 'connected', where: 'disk' }, link: { open: true }, trucks: { known: 1 }, webhook: { url: BOUNCIE_WEBHOOK_URL } });
    } finally {
      srv.close();
      vi.unstubAllGlobals();
      for (const s of spies) s.mockRestore();
    }
    const logs = lines.join('\n');
    expect(logs).toContain('[bouncie] connected — sign-in kept on disk');
    for (const secret of ['ACCESS-FAKE', 'REFRESH-FAKE', SECRET, HOOK_KEY, 'CODE-FAKE', IMEI, 'SIM-VIN-0001', VIN, String(LAT), String(LON), '36.86012', '-75.99001', 'Made Up Way']) {
      expect(logs, `a log line carried ${secret}`).not.toContain(secret);
    }
  });
});

// ---------- the binding rulings file holds rulings only ----------
describe('R31 is filed in the binding rulings file, in Mike\'s words, with no draft left behind', () => {
  // Filed at integration (D93): Mike's "why dont you build and then i add later"
  // is the go; the two open choices are named as defaults in R31 and BOUNCIE.md.
  it('OWNER_RULINGS.md carries R31 with Mike\'s words and no DRAFT heading; BOUNCIE.md points to it', () => {
    const rulings = readFileSync(new URL('../docs/OWNER_RULINGS.md', import.meta.url), 'utf8');
    expect(rulings).toMatch(/^## R31 — Bouncie truck tracking, built dormant \(Mike, 2026-10-20\)$/m);
    expect(rulings).toContain('*"why dont you build and then i add later"*');
    expect(rulings).not.toMatch(/^## .*DRAFT/m);
    const doc = readFileSync(new URL('../docs/BOUNCIE.md', import.meta.url), 'utf8');
    const waiting = doc.slice(doc.indexOf('## Waiting on Mike'));
    expect(waiting).toContain('filed as **R31**');
    expect(doc).not.toContain('### Draft R31');
  });
});

// ---------- the page: the Settings card and the Fleet line ----------
const html = loadAppHtml();
function fnSrc(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
function pageFn<T>(name: string, deps: Record<string, unknown> = {}): T {
  return new Function(...Object.keys(deps), `${fnSrc(name)}\nreturn ${name};`)(...Object.values(deps)) as T;
}
function pageConst<T>(name: string, deps: Record<string, unknown> = {}): T {
  const m = new RegExp(`^const ${name} = ([\\s\\S]*?);$`, 'm').exec(html);
  if (!m) throw new Error(`no const ${name} in the page`);
  return new Function(...Object.keys(deps), `return ${m[1]}`)(...Object.values(deps)) as T;
}
class N {
  className = '';
  textContent = '';
  disabled = false;
  children: N[] = [];
  dataset: Record<string, string> = {};
  handlers: Array<() => unknown> = [];
  constructor(readonly tag: string) {}
  has(c: string): boolean { return this.className.split(' ').includes(c); }
  appendChild(n: N): N { this.children.push(n); return n; }
  replaceChildren(...ns: N[]): void { this.children = [...ns]; }
  addEventListener(_t: string, f: () => unknown): void { this.handlers.push(f); }
  async click(): Promise<void> { for (const h of this.handlers) await h(); }
  all(): N[] { return [this, ...this.children.flatMap((c) => c.all())]; }
  querySelectorAll(sel: string): N[] { return this.all().slice(1).filter((n) => n.has(sel.slice(1))); }
  text(): string { return this.all().map((n) => n.textContent).filter(Boolean).join(' | '); }
}
const el = (tag: string, cls?: string, text?: string): N => {
  const n = new N(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const chip = (text: string, tone: string): N => { const n = el('span', 'badge', text); n.dataset.tone = tone; return n; };
const FEED_WORD = pageConst<Record<string, string>>('FEED_WORD');
const RETRY = pageConst<string>('RETRY');
const plural = pageFn<(n: number, one: string) => string>('plural');
const fmtWhen = pageFn<(v: unknown) => string>('fmtWhen');
const feedKind = pageFn<(e: unknown) => string>('feedKind', { LINKS: 'cut' });
const agoWords = pageFn<(m: unknown) => string>('agoWords');
const truckWords = pageFn<(k: Record<string, unknown>) => [string, string]>('truckWords', { fmtWhen, agoWords });
const TRACK_SAYS = pageConst<Record<string, [string, string]>>('TRACK_SAYS');
const trackWords = pageFn<(t: unknown, unitId: string) => [string, string]>('trackWords', { FEED_WORD, feedKind, TRACK_SAYS, truckWords });
const bouncieRows = pageFn<(b: unknown) => Array<[string, string, string]>>('bouncieRows', { plural, fmtWhen, RETRY });

const truck = (over: Record<string, unknown>) => {
  const at = iso(Date.now() - 12 * min);
  return { id: 'x', name: 'Bucket truck', vin4: '0001', device4: '9876', lat: LAT, lon: LON, heading: 0, reportedAt: at, ageMinutes: 12, positionAt: at, positionAgeMinutes: 12, motion: 'parked', lastTrip: null, ...over };
};
const answerFor = (state: string, t: Record<string, unknown> | null = null) => ({ state, units: [{ unitId: 'u1', unitName: 'Bucket truck', match: t ? 'vin' : null, truck: t }], unmatched: [] });

describe('the Fleet card — one line per unit, in words, never a coordinate', () => {
  it('each state reads differently, and a gap wears the feed-state look', () => {
    const lines = [
      trackWords(answerFor('keys_missing'), 'u1'),
      trackWords(answerFor('link_cut'), 'u1'),
      trackWords(answerFor('not_connected'), 'u1'),
      trackWords(answerFor('token_expired'), 'u1'),
      trackWords(answerFor('unreadable'), 'u1'),
      trackWords(answerFor('no_trucks'), 'u1'),
      trackWords(answerFor('ok'), 'u1'),
      trackWords(answerFor('ok', truck({})), 'u1'),
      trackWords(answerFor('ok', truck({ motion: 'driving', ageMinutes: 2 })), 'u1'),
      trackWords(answerFor('ok', truck({ motion: 'stale', reportedAt: '2026-10-17T21:05:00Z', ageMinutes: 4000, positionAt: '2026-10-17T21:05:00Z', positionAgeMinutes: 4000 })), 'u1'),
      trackWords(answerFor('ok', truck({ motion: 'unplugged' })), 'u1'),
      trackWords(answerFor('ok', truck({ motion: 'no_fix', lat: null, lon: null })), 'u1'),
    ];
    const words = lines.map(([w]) => w);
    expect(new Set(words).size).toBe(words.length);
    expect(words.slice(0, 9)).toEqual([
      'Tracking not set up — the Bouncie keys aren’t on the server',
      'Tracking cut on purpose — Arbo reads no positions until it is reconnected',
      'Tracking not connected — connect Bouncie in Settings',
      'Tracking stopped — the Bouncie sign-in expired; reconnect it in Settings',
      'Tracking: couldn’t read Bouncie just now',
      'Bouncie lists no trucks on this account',
      'No Bouncie truck matched to this unit',
      'Last seen 12 min ago · parked',
      'Driving · last report 2 min ago',
    ]);
    expect(words[9]).toBe('No Bouncie report since ' + fmtWhen('2026-10-17T21:05:00Z'));
    expect(words[10]).toMatch(/^Bouncie tracker unplugged since /);
    expect(words[11]).toBe('Bouncie has no position for this truck yet');
    // Looks: the gaps are feed-state lines; a live answer is plain help text.
    expect(lines.map(([, look]) => look)).toEqual([
      'feed-state unset', 'feed-state cut', 'feed-state unset', 'feed-state unset', 'feed-state unread',
      'storm-muted', 'storm-muted', 'storm-muted', 'storm-muted', 'feed-state unread', 'feed-state unset', 'feed-state unread',
    ]);
    for (const w of words) expect(w).not.toMatch(/36\.8|-75\.9|\d+\.\d{3,}/);
  });

  it('a failed read is named in the shared words; a locked route is named; no answer yet draws nothing rather than guess', () => {
    expect(trackWords({ failed: { code: 500 } }, 'u1')).toEqual(['Tracking: couldn’t read it', 'feed-state unread']);
    // The Fleet list beside it just read with this same key, so a 401 here is the route's own lock (no APP_ACCESS_KEY).
    expect(trackWords({ failed: { code: 401 } }, 'u1')).toEqual(['Tracking locked — APP_ACCESS_KEY isn’t set on the server', 'feed-state unset']);
    expect(trackWords(null, 'u1')[0]).toBe('');
  });

  it('"Last seen" is the age of the position itself — a newer report with no fix never makes it look fresh', () => {
    // Parked yesterday evening, a battery report this minute: the truck was last SEEN 15 h ago.
    expect(truckWords(truck({ motion: 'parked', ageMinutes: 0, positionAgeMinutes: 900 }))[0]).toBe('Last seen 15 h ago · parked');
    expect(truckWords(truck({ motion: 'seen', ageMinutes: 0, positionAgeMinutes: 45 }))[0]).toBe('Last seen 45 min ago');
    // Stale with the fix older than the last report: says the POSITION is old, and when Bouncie last said anything.
    const stale = truckWords(truck({ motion: 'stale', reportedAt: iso(Date.now() - min), ageMinutes: 1, positionAt: '2026-10-19T21:00:00Z', positionAgeMinutes: 900 }));
    expect(stale).toEqual(['No Bouncie position since ' + fmtWhen('2026-10-19T21:00:00Z') + ' · last report 1 min ago', 'feed-state unread']);
  });

  it('ages read like a person says them', () => {
    expect([0, 1, 59, 60, 179, 2879, 2880, 10000, undefined].map(agoWords)).toEqual([
      'just now', '1 min ago', '59 min ago', '1 h ago', '2 h ago', '47 h ago', '2 days ago', '6 days ago', 'at an unknown time',
    ]);
  });

  it('the card line and the unmatched trucks are drawn from the read, and a new read rewrites the line', () => {
    let TRACK: unknown = answerFor('link_cut');
    const deps = () => ({ el, trackWords, truckWords, TRACK });
    const line = pageFn<(u: { id: string }) => N>('fleetTrackLine', deps())({ id: 'u1' });
    expect(line.textContent).toBe('Tracking cut on purpose — Arbo reads no positions until it is reconnected');
    expect(line.className).toBe('feed-state cut fleet-track');
    expect(line.dataset.unit).toBe('u1');
    const list = el('div');
    const card = list.appendChild(el('div', 'card'));
    card.appendChild(line);
    const extra = el('div');
    TRACK = { ...answerFor('ok', truck({ motion: 'driving', ageMinutes: 3 })), unmatched: [truck({ name: null, vin4: null, device4: '4321', motion: 'parked', ageMinutes: 40, positionAgeMinutes: 40 })] };
    pageFn<(l: N, t: N) => void>('fillTrack', deps())(list, extra);
    expect(line.textContent).toBe('Driving · last report 3 min ago');
    expect(line.className).toBe('storm-muted fleet-track');
    expect(extra.text()).toBe('Bouncie trucks not matched to a unit | Give the truck the same name in Bouncie as its unit here, or put its VIN on the unit, and Arbo pairs them. | Unnamed truck | Tracker …4321 | Last seen 40 min ago · parked');
    // With the fleet list unavailable every truck is listed, and it says why.
    TRACK = { state: 'ok', units: null, unitsError: 'link_cut', unmatched: [truck({})] };
    pageFn<(l: N, t: N) => void>('fillTrack', deps())(list, extra);
    expect(extra.text()).toContain('The fleet list isn’t available, so these aren’t matched to units.');
    expect(extra.text()).toContain('VIN …0001');
    expect(extra.text()).not.toMatch(/36\.8|-75\.9/);
  });

  it('Settings never waits on Bouncie either: the card fills its own slot while the sections below draw', () => {
    const src = fnSrc('buildSettings');
    expect(src).not.toContain('await bouncieSettings(');
    expect(src).toContain('bouncieSettings(bouncieSlot, () => gen !== settingsGen)');
    expect(src.indexOf('bouncieSettings(bouncieSlot')).toBeLessThan(src.indexOf("'Data links'"));
  });

  it('the Fleet list never waits on Bouncie, and the lifted list function keeps its one new line', () => {
    const fleet = fnSrc('renderFleet');
    expect(fleet.indexOf('const track = loadTrack();')).toBeLessThan(fleet.indexOf('await renderFleetList(listSlot)'));
    expect(fleet.indexOf('await track;')).toBeGreaterThan(fleet.indexOf('await renderFleetList(listSlot)'));
    expect(fnSrc('renderFleetList')).toContain('c.appendChild(fleetTrackLine(u));');
    expect(fnSrc('loadTrack')).toContain("api('/api/fleet/positions')");
  });
});

describe('Settings → Bouncie (truck tracking) — the sign-in, the link and the live updates, each in its own words', () => {
  const base = {
    signIn: { state: 'connected', stored: true, where: 'disk', savedAt: '2026-10-20T13:00:00Z' },
    link: { envVar: 'ARBO_LINK_BOUNCIE', open: true },
    positions: { state: 'ok', readAt: '2026-10-20T13:59:00Z' },
    trucks: { known: 3, lastReportAt: '2026-10-20T13:58:00Z' },
    webhook: { wired: true, url: BOUNCIE_WEBHOOK_URL, deliveries: 38, received: 40, lastAt: '2026-10-20T13:58:00Z', whileCut: 0, droppedKeysMissing: 0, lastAuthenticAt: '2026-10-20T13:58:00Z', rejected: 0, lastRejectedAt: null, refusedNotWired: 0, unknownTypes: 0, badEvents: 0, badJson: 0, oversized: 0, overCap: 0 },
    redirectUri: BOUNCIE_REDIRECT,
  };
  const rows = (over: Record<string, unknown>) => bouncieRows({ ...base, ...over });
  const chips = (r: Array<[string, string, string]>) => r.map(([c, tone]) => `${c}=${tone}`);

  it('keys missing, not connected, expired, connected on disk and in memory: five sign-in sentences', () => {
    const first = (s: Record<string, unknown>) => rows({ signIn: s })[0]!;
    expect(first({ state: 'keys_missing' })).toEqual(['NOT SET UP', 'watch', 'Bouncie sign-in isn’t set up on the server — add BOUNCIE_CLIENT_ID and BOUNCIE_CLIENT_SECRET on Railway, then deploy. Nothing is disconnected — it was never set up.']);
    expect(first({ state: 'not_connected' })).toEqual(['NOT CONNECTED', 'watch', 'The Bouncie keys are on the server, but Bouncie isn’t connected yet — tap Connect Bouncie and approve.']);
    expect(first({ state: 'expired' })).toEqual(['EXPIRED', 'stop', 'The Bouncie sign-in expired or was removed — tap Reconnect Bouncie. Positions stop until you do.']);
    expect(first({ state: 'connected', where: 'disk', savedAt: null })).toEqual(['CONNECTED', 'good', 'Bouncie connected — saved on Arbo’s storage disk. Survives redeploys.']);
    expect(first({ state: 'connected', where: 'memory' })[2]).toBe('Bouncie connected — but held in memory only (no storage disk). It will need connecting again after the next restart.');
  });

  it('a cut link is named — with what Bouncie sent meanwhile — and an open one says what it read', () => {
    expect(rows({ link: { envVar: 'ARBO_LINK_BOUNCIE', open: false }, webhook: { ...base.webhook, received: 0, whileCut: 2 } })[1]).toEqual(['CUT', 'info',
      'Truck positions are cut on purpose — Arbo reads and keeps none until ARBO_LINK_BOUNCIE is set to live on Railway. Nothing was deleted. Bouncie sent 2 updates since Arbo last restarted; each was answered and dropped unread.']);
    expect(rows({})[1]).toEqual(['OPEN', 'good', 'Positions on — 3 trucks, last report ' + fmtWhen('2026-10-20T13:58:00Z') + '.']);
    expect(rows({ positions: { state: 'no_trucks' } })[1]![2]).toBe('Positions on — Bouncie answered and lists no trucks on this account.');
    expect(rows({ positions: { state: 'unreadable' } })[1]![2]).toBe('Positions on — but Arbo couldn’t read Bouncie just now. ' + RETRY);
    expect(rows({ positions: { state: 'not_connected' } })[1]![2]).toBe('Positions on — waiting on the Bouncie sign-in above.');
  });

  it('live updates: not wired, waiting for the first one, receiving — and a wrong key or skipped updates are said', () => {
    const hookRow = (w: Record<string, unknown>) => rows({ webhook: { ...base.webhook, ...w } }).slice(2);
    expect(chips(hookRow({ wired: false, deliveries: 0, received: 0 }))).toEqual(['NOT WIRED=watch']);
    expect(hookRow({ wired: false, deliveries: 0, received: 0, refusedNotWired: 3 })[0]![2]).toBe('Live updates — BOUNCIE_WEBHOOK_KEY isn’t set on Railway, so Arbo refuses Bouncie’s live updates; this is not zero updates. Something called the webhook 3 times since Arbo last restarted.');
    expect(hookRow({ deliveries: 0, received: 0 })[0]).toEqual(['PENDING', 'watch', 'Live updates — the key is set, but nothing has arrived since Arbo last restarted. Turn the webhook on in the Bouncie portal with the address below.']);
    expect(hookRow({})[0]).toEqual(['WIRED', 'good', 'Live updates — 40 updates kept since Arbo last restarted, last heard from ' + fmtWhen('2026-10-20T13:58:00Z') + '.']);
    // Arrived but none readable is not "nothing has arrived": it is WIRED with 0 kept, and the skip is said.
    expect(chips(hookRow({ deliveries: 2, received: 0, unknownTypes: 2 }))).toEqual(['WIRED=good', 'UNREADABLE=watch']);
    expect(chips(hookRow({ rejected: 2, lastRejectedAt: '2026-10-20T13:00:00Z', badJson: 1, unknownTypes: 1 }))).toEqual(['WIRED=good', 'REFUSED=info', 'UNREADABLE=watch']);
  });

  it('refused calls: a stranger knocking is never a red WRONG KEY while Bouncie’s own updates get through', () => {
    const hookRow = (w: Record<string, unknown>) => rows({ webhook: { ...base.webhook, ...w } }).slice(2);
    // Anyone on the internet can POST to the address. Bouncie's own updates got through after the refusals: nothing to change.
    const after = hookRow({ rejected: 2, lastRejectedAt: '2026-10-20T13:00:00Z' });
    expect(after.map(([c, tone]) => `${c}=${tone}`)).toEqual(['WIRED=good', 'REFUSED=info']);
    expect(after[1]![2]).toBe('Refused 2 calls to the webhook without Arbo’s key since Arbo last restarted. Bouncie’s own updates got through after them (last ' + fmtWhen('2026-10-20T13:58:00Z') + '), so they came from someone else — nothing to change.');
    // A refusal AFTER Bouncie's last update: a watch, not an alarm — a parked truck sends nothing.
    const since = hookRow({ rejected: 1, lastRejectedAt: '2026-10-20T13:59:00Z' });
    expect(since.map(([c, tone]) => `${c}=${tone}`)).toEqual(['WIRED=good', 'REFUSED=watch']);
    expect(since[1]![2]).toBe('Refused 1 call to the webhook without Arbo’s key since Arbo last restarted — the last one after Bouncie’s last update (' + fmtWhen('2026-10-20T13:58:00Z') + '). A parked truck sends nothing, so this is usually someone else knocking; if a truck has driven since then and nothing new arrived, check the key in the Bouncie portal still matches BOUNCIE_WEBHOOK_KEY.');
    // Nothing authentic at all since the restart: only then is it WRONG KEY, and it still only says to check.
    const none = hookRow({ deliveries: 0, received: 0, lastAt: null, lastAuthenticAt: null, rejected: 3, lastRejectedAt: '2026-10-20T13:59:00Z' });
    expect(none.map(([c, tone]) => `${c}=${tone}`)).toEqual(['PENDING=watch', 'WRONG KEY=stop']);
    expect(none[1]![2]).toBe('Refused 3 calls to the webhook without Arbo’s key since Arbo last restarted, and nothing from Bouncie has got through — if the webhook is on in the Bouncie portal, its key must match BOUNCIE_WEBHOOK_KEY exactly.');
    for (const r of [after, since]) expect(r.some(([, tone]) => tone === 'stop')).toBe(false);
  });

  it('updates dropped because the sign-in keys are missing are named — never a green "0 kept" alone', () => {
    const r = rows({
      signIn: { state: 'keys_missing', stored: false, where: null, savedAt: null },
      positions: { state: 'keys_missing', readAt: null },
      webhook: { ...base.webhook, deliveries: 0, received: 0, lastAt: null, droppedKeysMissing: 3, lastAuthenticAt: '2026-10-20T13:58:00Z' },
    });
    expect(chips(r)).toEqual(['NOT SET UP=watch', 'OPEN=good', 'WIRED=good', 'DROPPED=watch']);
    expect(r[3]![2]).toBe('Bouncie sent 3 updates since Arbo last restarted; each was answered and dropped unread because the Bouncie sign-in keys (BOUNCIE_CLIENT_ID and BOUNCIE_CLIENT_SECRET) aren’t on the server.');
  });

  it('the new chip words are in the canonical tone list', () => {
    const words = html.slice(html.indexOf('TONE WORDS (the canonical list)'), html.indexOf('const TONE = {'));
    const line = (tone: string) => words.slice(words.indexOf(`//   ${tone} = `)).split(/\n\/\/ {3}[a-z]+ = /)[0]!;
    expect(line('info')).toContain('REFUSED (someone else knocking)');
    expect(line('watch')).toContain('REFUSED (after Bouncie’s last update)');
    expect(line('watch')).toContain('DROPPED');
    expect(line('stop')).toContain('WRONG KEY');
  });

  async function card(status: unknown, connect: () => Promise<unknown> = async () => ({ authorizeUrl: 'https://auth.example.invalid/x' })) {
    const went: string[] = [];
    const posted: string[] = [];
    const api = async (path: string, opts?: { method?: string }) => {
      if (opts && opts.method === 'POST') { posted.push(path); return connect(); }
      if (status instanceof Error) throw status;
      return status;
    };
    const feedLine = (_e: unknown, what: string) => el('div', 'feed-state', what + ': couldn’t read it.');
    const run = pageFn<(v: N, stale: () => boolean) => Promise<void>>('bouncieSettings', { el, api, chip, feedLine, bouncieRows, location: { assign: (u: string) => went.push(u) } });
    const v = el('div');
    await run(v, () => false);
    return { v, went, posted };
  }

  it('not connected: the redirect to register, a Connect button that goes where the server says, and the webhook address', async () => {
    const { v, went, posted } = await card({ ...base, signIn: { state: 'not_connected', stored: false, where: null, savedAt: null }, webhook: { ...base.webhook, deliveries: 0, received: 0 } });
    // Mike's spec (2026-10-20): the Redirect URI moved to /api/bouncie/callback — the card reads it from the server.
    expect(v.text()).toContain('Redirect URI to register in the Bouncie portal: https://arbor-server-production.up.railway.app/api/bouncie/callback');
    expect(v.text()).toContain('Webhook address for the Bouncie portal: https://arbor-server-production.up.railway.app/webhooks/bouncie');
    const go = v.all().find((n) => n.tag === 'button')!;
    expect(go.textContent).toBe('Connect Bouncie');
    await go.click();
    expect(posted).toEqual(['/api/bouncie/connect']);
    expect(went).toEqual(['https://auth.example.invalid/x']);
  });

  it('expired: the button says Reconnect; a refused start says why under it and opens nothing', async () => {
    const { v, went } = await card({ ...base, signIn: { state: 'expired', stored: true, where: 'disk', savedAt: null } }, async () => { throw Object.assign(new Error('bouncie_keys_missing'), { code: 503 }); });
    const go = v.all().find((n) => n.tag === 'button')!;
    expect(go.textContent).toBe('Reconnect Bouncie');
    await go.click();
    expect(went).toEqual([]);
    expect(go.disabled).toBe(false);
    expect(v.text()).toContain('Not opened — the Bouncie keys aren’t on the server.');
  });

  it('connected and receiving: no button and no setup addresses; a locked route and a dead read are named', async () => {
    const ok = await card(base);
    expect(ok.v.all().some((n) => n.tag === 'button')).toBe(false);
    expect(ok.v.text()).not.toContain('Webhook address');
    expect(ok.v.text()).not.toContain('Redirect URI');
    const locked = await card(Object.assign(new Error('unauthorized'), { code: 401 }));
    expect(locked.v.text()).toContain('Bouncie: locked on the server — connecting needs APP_ACCESS_KEY set on Railway.');
    const dead = await card(Object.assign(new Error('error'), { code: 500 }));
    expect(dead.v.text()).toContain('Bouncie status: couldn’t read it.');
  });

  it('the page names no Bouncie host — the addresses come from the server', () => {
    expect(html).not.toMatch(/bouncie\.(com|dev)|railway\.app/);
    expect(fnSrc('bouncieSettings')).toContain("api('/api/bouncie')");
    expect(fnSrc('bouncieSettings')).not.toContain('fetch(');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Mike's spec, 2026-10-20 — the add-on to R31:
//   Client ID arbo-app · Redirect URI /api/bouncie/callback · the tokens kept
//   server-side in Supabase · a token refresh and a read-only pull of vehicles
//   and trips · location admin-only and only in working hours.
// ═══════════════════════════════════════════════════════════════════════

const SB_URL = 'https://fakeproject0042.supabase.co';
const SB_KEY = 'sb_secret_made_up_for_tests_0042';

/** A fake Supabase REST for the one credential table: a row, or a refusal, or no answer at all. */
function fakeSupabase() {
  const state = { row: null as Record<string, unknown> | null, read: 200 as number | 'throw', write: 201 as number | 'throw' };
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null; redirect: unknown }> = [];
  const http: CredentialHttp = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null, redirect: init.redirect });
    if (init.method === 'GET') {
      if (state.read === 'throw') throw new Error('ECONNRESET');
      if (state.read !== 200) return answer(state.read, { code: 'PGRST205' });
      const r = state.row;
      return answer(200, r ? [{ ciphertext: r.ciphertext, iv: r.iv, tag: r.tag, key_version: r.key_version }] : []);
    }
    if (state.write === 'throw') throw new Error('ECONNRESET');
    if (state.write !== 201) return answer(state.write, {});
    state.row = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
    return answer(201, null);
  };
  /** What the row opens to with a given secret — null when it doesn't open. */
  const plain = (secret = SECRET): Record<string, unknown> | null => {
    const r = state.row;
    if (!r) return null;
    const p = openCredential({ ciphertext: String(r.ciphertext), iv: String(r.iv), tag: String(r.tag), key_version: Number(r.key_version) }, secret, 'bouncie');
    return p === null ? null : (JSON.parse(p) as Record<string, unknown>);
  };
  return { http, calls, state, plain };
}
const sbTokens = (sb: ReturnType<typeof fakeSupabase>, secret = SECRET, oldDir: string | null = null) =>
  supabaseTokenBackend(new CredentialStore({ url: SB_URL, serviceKey: SB_KEY, provider: 'bouncie', secret, http: sb.http }), oldDir);

describe('the callback at /api/bouncie/callback — one Redirect URI, written once', () => {
  it('the path is Mike\'s, and the one constant feeds the authorize URL, the swap, the route and the Settings card', async () => {
    expect(BOUNCIE_CALLBACK_PATH).toBe('/api/bouncie/callback');
    expect(RETIRED_CALLBACK_PATH).toBe('/bouncie/callback');
    const f = fakeBouncie({ grants: [grant(1)] });
    const { b } = make({ http: f.http });
    const { url } = begin(b);
    expect(url.searchParams.get('redirect_uri')).toBe(BOUNCIE_REDIRECT);
    expect(url.searchParams.get('client_id')).toBe('arbo-app');
    await b.finishConnect({ code: 'CODE-FAKE-1', state: url.searchParams.get('state') });
    expect(f.tokenCalls()[0]!.body!.redirect_uri).toBe(BOUNCIE_REDIRECT);
    expect((await b.status()).redirectUri).toBe(BOUNCIE_REDIRECT);
    // Spelled once in the source: the server routes on the constant, the page reads it from the server.
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
    const codeOf = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(codeOf(read('../src/integrations/bouncie.ts')).match(/\/api\/bouncie\/callback/g)).toHaveLength(1);
    const server = codeOf(read('../src/server.ts'));
    expect(server).not.toMatch(/['"`]\/(api\/)?bouncie\/callback/);
    expect(server).toContain('url.pathname === BOUNCIE_CALLBACK_PATH');
    expect(server).toContain('url.pathname === RETIRED_CALLBACK_PATH');
    expect(html).not.toContain('bouncie/callback');
    // The callback is answered BEFORE the /api key gate — Bouncie's redirect carries no key.
    // (Audit M1/L1: the gate is now `if (url.pathname.startsWith('/api/')) { … checkApiDoor(…) }`.)
    // (Wave 1 merge: /health/feeds — not under /api — calls checkApiDoor too, so the pin finds the /api gate itself.)
    const gateAt = server.indexOf("if (url.pathname.startsWith('/api/')) {");
    expect(gateAt).toBeGreaterThan(-1);
    expect(server.indexOf('const door = checkApiDoor(', gateAt) - gateAt).toBeLessThan(600); // the door is the gate's body
    expect(server.indexOf('url.pathname === BOUNCIE_CALLBACK_PATH')).toBeLessThan(gateAt);
    // And the docs Mike follows carry the same address and Client ID.
    const doc = read('../docs/BOUNCIE.md');
    expect(doc).toContain(BOUNCIE_REDIRECT);
    expect(doc).toContain('`arbo-app`');
    expect(doc).not.toMatch(/Client ID\*\*, type `arbo`|BOUNCIE_CLIENT_ID` = `arbo`/);
  });

  it('a bad, reused or expired state is refused by name — and Bouncie is never asked', async () => {
    const f = fakeBouncie({ grants: [grant(1)] });
    const { b, clock } = make({ http: f.http });
    expect((await b.finishConnect({ code: 'C', state: 'not-a-state' })).title).toBe('That sign-in link is not one Arbo is waiting for');
    const old = begin(b).state;
    clock.t += 10 * min + 1;
    expect((await b.finishConnect({ code: 'C', state: old })).title).toBe('That sign-in link is not one Arbo is waiting for');
    const s = begin(b).state;
    expect((await b.finishConnect({ code: 'CODE-FAKE-1', state: s })).ok).toBe(true);
    expect((await b.finishConnect({ code: 'CODE-FAKE-1', state: s })).status).toBe(400);
    expect(f.tokenCalls()).toHaveLength(1);
  });
});

describe('the sign-in kept in Supabase, sealed (Mike: "store the tokens server-side in Supabase")', () => {
  // The credential door's own switch, opened here; cut, it is tested below (§3 holds until Mike rules).
  beforeEach(() => {
    process.env.ARBO_LINK_CREDENTIALS = 'live';
  });

  it('Connect saves the pair sealed: the row carries no token, and only the client secret opens it', async () => {
    const sb = fakeSupabase();
    const f = fakeBouncie({ grants: [grant(1)] });
    const { b } = make({ http: f.http, tokens: sbTokens(sb) });
    const r = await b.finishConnect({ code: 'CODE-FAKE-1', state: begin(b).state });
    expect(r).toMatchObject({ status: 200, ok: true, title: 'Bouncie is connected' });
    expect(r.line).toContain('saved in Supabase, sealed');
    expect(sb.state.row).toMatchObject({ provider: 'bouncie', key_version: 1 });
    expect(JSON.stringify(sb.state.row)).not.toMatch(/ACCESS-FAKE|REFRESH-FAKE|fake-client-secret|arbo-app/);
    expect(sb.plain()).toMatchObject({ accessToken: 'ACCESS-FAKE-1', refreshToken: 'REFRESH-FAKE-1', expiresAt: T0 + 3600_000 });
    expect(sb.plain('some-other-secret')).toBeNull();
    expect((await b.status()).signIn).toMatchObject({ state: 'connected', stored: true, where: 'supabase', problem: null });
    // Every call: the one table, no redirect followed, the service key in apikey only (an sb_secret_ key is never a Bearer).
    expect(sb.calls.length).toBeGreaterThan(0);
    for (const c of sb.calls) {
      expect(c.url.startsWith(`${SB_URL}/rest/v1/integration_credential?`)).toBe(true);
      expect(c.redirect).toBe('error');
      expect(c.headers.apikey).toBe(SB_KEY);
      expect(c.headers.authorization).toBeUndefined();
    }
    // A restart (a redeploy) reads it back.
    const again = make({ http: f.http, tokens: sbTokens(sb) });
    await again.b.ready();
    expect(again.b.signInState()).toBe('connected');
    expect(await again.b.accessToken()).toEqual({ ok: true, token: 'ACCESS-FAKE-1' });
  });

  it('the rotated pair is in Supabase BEFORE the new access token is used', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const sb = fakeSupabase();
    let storedWhenUsed: unknown = null;
    const f = fakeBouncie({
      grants: [grant(1), grant(2)],
      vehicles: (token) => {
        storedWhenUsed = sb.plain()?.accessToken ?? null;
        return token === 'ACCESS-FAKE-2' ? answer(200, []) : answer(401, {});
      },
    });
    const { b, clock } = await connected({ http: f.http, tokens: sbTokens(sb) });
    clock.t = T0 + 3600_000; // due — and still inside working hours (11:00)
    expect((await b.positions(UNITS)).state).toBe('no_trucks');
    expect(storedWhenUsed).toBe('ACCESS-FAKE-2');
    expect(sb.plain()).toMatchObject({ refreshToken: 'REFRESH-FAKE-2' });
  });

  it('Supabase refusing the renewed pair: the old row stays, the new pair is held UNUSED, and saved before anything uses it', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const sb = fakeSupabase();
    const used: string[] = [];
    const f = fakeBouncie({ grants: [grant(1), grant(2)], vehicles: (token) => { used.push(token); return answer(200, []); } });
    const { b, clock } = await connected({ http: f.http, tokens: sbTokens(sb) });
    const before = { ...sb.state.row };
    sb.state.write = 'throw';
    clock.t = T0 + 3600_000;
    expect((await b.positions(UNITS)).state).toBe('sign_in_store');
    expect(b.signInState()).toBe('unsaved');
    expect(sb.state.row).toEqual(before); // the old row is not discarded
    expect(used).toEqual([]); // the new access token is not used unsaved
    expect(f.tokenCalls()).toHaveLength(2); // one refresh — the rotated-out refresh token is never sent again
    // A minute on, Supabase still refusing: still held, still unused, no second refresh.
    clock.t += 61_000;
    expect((await b.positions(UNITS)).state).toBe('sign_in_store');
    expect(used).toEqual([]);
    expect(f.tokenCalls()).toHaveLength(2);
    // Supabase back: saved first, then used.
    sb.state.write = 201;
    clock.t += 61_000;
    expect((await b.positions(UNITS)).state).toBe('no_trucks');
    expect(sb.plain()).toMatchObject({ accessToken: 'ACCESS-FAKE-2', refreshToken: 'REFRESH-FAKE-2' });
    expect(used).toEqual(['ACCESS-FAKE-2']);
    expect(b.signInState()).toBe('connected');
  });

  it('Supabase refusing a NEW sign-in: named on the page, nothing kept, still not connected', async () => {
    const sb = fakeSupabase();
    sb.state.write = 503;
    const { b } = make({ http: fakeBouncie({ grants: [grant(1)] }).http, tokens: sbTokens(sb) });
    const r = await b.finishConnect({ code: 'CODE-FAKE-1', state: begin(b).state });
    expect(r).toMatchObject({ status: 503, ok: false, title: 'Bouncie said yes, but Arbo couldn’t save the sign-in' });
    expect(r.line).toContain('Arbo couldn’t reach Supabase just now.');
    expect(r.line).not.toMatch(/ACCESS-FAKE|CODE-FAKE/);
    expect(b.signInState()).toBe('not_connected');
    expect(sb.state.row).toBeNull();
  });

  it('migration 0021 not applied: named, and Connect refuses before Bouncie is asked anything; applied later, it is picked up', async () => {
    const sb = fakeSupabase();
    sb.state.read = 404;
    sb.state.write = 404;
    const f = fakeBouncie({ grants: [grant(1)] });
    const { b, clock } = make({ http: f.http, tokens: sbTokens(sb) });
    const { state } = begin(b); // a tap from before the store was read
    const r = await b.finishConnect({ code: 'CODE-FAKE-1', state });
    expect(r).toMatchObject({ status: 503, ok: false, title: 'Arbo has nowhere to keep the Bouncie sign-in yet' });
    expect(r.line).toContain('migration 0021 has not been applied');
    expect(f.calls).toEqual([]); // the code was never spent
    expect(b.signInState()).toBe('store_missing');
    expect(b.beginConnect()).toEqual({ ok: false, error: 'bouncie_store_missing' });
    expect((await b.status()).signIn).toMatchObject({ state: 'store_missing', problem: 'missing_table', stored: false });
    process.env.ARBO_LINK_BOUNCIE = 'live';
    expect((await b.positions(UNITS)).state).toBe('sign_in_store');
    // Mike applies it: within a minute Settings says "not connected", not "missing".
    sb.state.read = 200;
    sb.state.write = 201;
    clock.t += 61_000;
    await b.status();
    expect(b.signInState()).toBe('not_connected');
    expect(b.beginConnect().ok).toBe(true);
  });

  it('Supabase not configured: no fallback to the disk — named, and Connect refuses', async () => {
    const none = bouncieTokenBackend({ supabaseUrl: undefined, serviceKey: undefined, clientSecret: SECRET, practice: false, dir: tmp() });
    expect(none.kind).toBe('none');
    const { b } = make({ tokens: none });
    await b.ready();
    expect(b.signInState()).toBe('store_unconfigured');
    expect(b.beginConnect()).toEqual({ ok: false, error: 'bouncie_store_unconfigured' });
    // Practice mode (ARBO_DATA_LINKS=sim) opens no database: the first build's disk file. Anything else: Supabase.
    expect(bouncieTokenBackend({ supabaseUrl: SB_URL, serviceKey: SB_KEY, clientSecret: SECRET, practice: true, dir: tmp() }).kind).toBe('disk');
    expect(bouncieTokenBackend({ supabaseUrl: SB_URL, serviceKey: SB_KEY, clientSecret: SECRET, practice: false, dir: tmp() }).kind).toBe('supabase');
    // With no store given at all, nothing can be kept — by name.
    const bare = new Bouncie({ clientId: CLIENT, clientSecret: SECRET, webhookKey: HOOK_KEY });
    await bare.ready();
    expect(bare.signInState()).toBe('store_unconfigured');
  });

  it('the client secret changed: the saved row does not open — LOCKED, never "not connected"; Reconnect replaces it', async () => {
    const sb = fakeSupabase();
    await connected({ http: fakeBouncie({ grants: [grant(1)] }).http, tokens: sbTokens(sb) });
    const NEW = 'a-new-made-up-secret-0043';
    const f = fakeBouncie({ grants: [grant(2)], vehicles: () => answer(200, [vehicle()]) });
    const { b } = make({ clientSecret: NEW, http: f.http, tokens: sbTokens(sb, NEW) });
    await b.ready();
    expect(b.signInState()).toBe('store_locked');
    process.env.ARBO_LINK_BOUNCIE = 'live';
    expect((await b.positions(UNITS)).state).toBe('sign_in_store');
    expect(f.reads()).toEqual([]);
    expect((await b.finishConnect({ code: 'CODE-FAKE-2', state: begin(b).state })).ok).toBe(true);
    expect(b.signInState()).toBe('connected');
    expect(sb.plain(NEW)).toMatchObject({ accessToken: 'ACCESS-FAKE-2' });
    expect(sb.plain()).toBeNull(); // the old secret no longer opens it
  });

  it('Supabase unreachable or refusing the key: UNREADABLE (not "not connected"), read again at most once a minute', async () => {
    const sb = fakeSupabase();
    await connected({ http: fakeBouncie({ grants: [grant(1)] }).http, tokens: sbTokens(sb) });
    sb.state.read = 'throw';
    const clock = { t: T0 };
    const { b } = make({ clock, http: fakeBouncie().http, tokens: sbTokens(sb) });
    await b.ready();
    expect(b.signInState()).toBe('store_unreadable');
    expect((await b.status()).signIn).toMatchObject({ state: 'store_unreadable', problem: 'unreachable', stored: false });
    sb.state.read = 200;
    const reads = () => sb.calls.filter((c) => c.method === 'GET').length;
    const n = reads();
    clock.t += 30_000;
    await b.status();
    expect(reads()).toBe(n);
    expect(b.signInState()).toBe('store_unreadable');
    clock.t += 31_000;
    await b.status();
    expect(b.signInState()).toBe('connected');
    // A refused key is its own named problem.
    sb.state.read = 401;
    const k = make({ http: fakeBouncie().http, tokens: sbTokens(sb) });
    await k.b.ready();
    expect((await k.b.status()).signIn).toMatchObject({ state: 'store_unreadable', problem: 'refused' });
  });

  it('the first build\'s disk sign-in is moved in once — saved sealed, then removed from the disk; not moved, it stays', async () => {
    const pair = { accessToken: 'ACCESS-FAKE-8', refreshToken: 'REFRESH-FAKE-8', expiresAt: T0 + 3600_000, savedAt: iso(T0) };
    const dir = tmp();
    writeFileSync(join(dir, 'bouncie-token.json'), JSON.stringify(pair));
    const sb = fakeSupabase();
    const { b } = make({ tokens: sbTokens(sb, SECRET, dir) });
    await b.ready();
    expect(b.signInState()).toBe('connected');
    expect((await b.status()).signIn).toMatchObject({ where: 'supabase' });
    expect(sb.plain()).toMatchObject({ accessToken: 'ACCESS-FAKE-8' });
    expect(existsSync(join(dir, 'bouncie-token.json'))).toBe(false);
    // Supabase would not take it (table missing): the disk copy stays, and the state is named.
    const dir2 = tmp();
    writeFileSync(join(dir2, 'bouncie-token.json'), JSON.stringify(pair));
    const sb2 = fakeSupabase();
    sb2.state.write = 404;
    const m = make({ tokens: sbTokens(sb2, SECRET, dir2) });
    await m.b.ready();
    expect(m.b.signInState()).toBe('store_missing');
    expect(existsSync(join(dir2, 'bouncie-token.json'))).toBe(true);
  });

  it('a deploy overlap: the refresh refused because the other Arbo already rotated it takes the newer saved pair', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const sb = fakeSupabase();
    // The running Arbo connects; the new deploy boots and reads the same pair.
    const old = await connected({ http: fakeBouncie({ grants: [grant(1), grant(2)] }).http, tokens: sbTokens(sb) });
    const fresh = fakeBouncie({ grants: [() => answer(400, { error: 'invalid_grant' })], vehicles: (t) => (t === 'ACCESS-FAKE-2' ? answer(200, []) : answer(401, {})) });
    const clock = { t: T0 };
    const next = make({ clock, http: fresh.http, tokens: sbTokens(sb) });
    await next.b.ready();
    // The old one refreshes (Bouncie rotates) and saves, before it stops.
    old.clock.t = T0 + 3600_000;
    expect(await old.b.accessToken()).toEqual({ ok: true, token: 'ACCESS-FAKE-2' });
    // The new one's copy is now dead at Bouncie — it is refused, finds the newer row, and carries on.
    clock.t = T0 + 3600_000;
    expect((await next.b.positions(UNITS)).state).toBe('no_trucks');
    expect(next.b.signInState()).toBe('connected');
    expect(fresh.tokenCalls()).toHaveLength(1);
  });
});

describe('working hours only (brief §4.4: 8am–8pm, Monday to Saturday) — "after hours" is never "no trucks"', () => {
  it('after hours: a named state, Bouncie is not read, and nothing is held; at 8am tracking resumes', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const f = fakeBouncie({ grants: [grant(1), grant(2)], vehicles: () => answer(200, [vehicle()]) });
    const { b, clock } = await connected({ http: f.http });
    expect((await b.positions(UNITS)).state).toBe('ok');
    expect(f.reads()).toHaveLength(1);
    clock.t = AFTER;
    const p = await b.positions(UNITS);
    expect(p).toMatchObject({ state: 'after_hours', message: POSITIONS_SAYS.after_hours, unmatched: [] });
    expect(p.units!.every((u) => u.truck === null)).toBe(true);
    expect(f.reads()).toHaveLength(1);
    expect((await b.status()).trucks.known).toBe(0);
    expect(POSITIONS_SAYS.after_hours).toContain('This is not "no trucks".');
    clock.t = SUNDAY;
    expect((await b.positions(UNITS)).state).toBe('after_hours');
    expect(f.reads()).toHaveLength(1);
    clock.t = Date.parse('2026-10-21T12:00:00Z'); // Wednesday 8:00 AM
    expect((await b.positions(UNITS)).state).toBe('ok');
    expect(f.reads()).toHaveLength(2);
  });

  it('the edge is the one clock\'s: 7:59 PM reads, 8:00 PM does not', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const f = fakeBouncie({ grants: [grant(1, 86_400)], vehicles: () => answer(200, []) });
    const clock = { t: Date.parse('2026-10-20T23:59:00Z') };
    const { b } = await connected({ clock, http: f.http });
    expect((await b.positions(UNITS)).state).toBe('no_trucks');
    clock.t = Date.parse('2026-10-21T00:00:00Z');
    expect((await b.positions(UNITS)).state).toBe('after_hours');
    // No second clock in this file: the hours come from withinWorkingHours alone.
    const src = readFileSync(new URL('../src/integrations/bouncie.ts', import.meta.url), 'utf8');
    expect(src).toContain("import { withinWorkingHours } from '../ops/locationIntel.js';");
    expect(src).not.toMatch(/getHours\(|getUTCHours\(|getDay\(|>= ?8 &&|< ?20\b/);
  });

  it('a webhook update after hours is answered 200, dropped UNREAD, and counted — and what was held is dropped', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const { b, clock } = await connected({ http: fakeBouncie({ grants: [grant(1, 86_400)], vehicles: () => answer(200, []) }).http });
    await hook(b, tripData([[T0 - min, LAT, LON]]));
    expect((await b.status()).trucks.known).toBe(1);
    clock.t = AFTER;
    let drained = 0;
    // Not even parsed: a body that isn't JSON is not counted as bad JSON, because it is never read as anything.
    const r = await b.handleWebhook({ authorization: HOOK_KEY }, async () => { drained++; return '{not json'; });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(drained).toBe(1);
    const s = await b.status();
    expect(s.webhook).toMatchObject({ afterHours: 1, badJson: 0, deliveries: 1, received: 1 });
    // Review fix: the count shows the webhook is wired; the minute of an after-hours update is not kept.
    expect(s.webhook).not.toHaveProperty('lastAfterHoursAt');
    expect(s.trucks.known).toBe(0);
    expect(s.positions.state).toBe('after_hours');
  });

  it('a daytime delivery carrying reports stamped after hours: skipped and counted, and they outdate what was held', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const clock = { t: Date.parse('2026-10-20T23:50:00Z') }; // Tuesday 7:50 PM
    const { b } = await connected({ clock, http: fakeBouncie({ grants: [grant(1, 86_400)], vehicles: () => answer(200, []) }).http });
    await hook(b, tripData([[clock.t - min, LAT, LON]])); // 7:49 PM: kept
    // Wednesday 8:05 AM a burst lands from a signal loss: 7:55 PM (inside) and 8:10 PM (after hours).
    clock.t = Date.parse('2026-10-21T12:05:00Z');
    await hook(b, tripData([[Date.parse('2026-10-20T23:55:00Z'), 36.81, -75.91], [Date.parse('2026-10-21T00:10:00Z'), 36.95, -76.1]]));
    await hook(b, { eventType: 'tripEnd', imei: IMEI, vin: VIN, transactionId: 't', end: { timestamp: '2026-10-21T00:30:00.000Z', timeZone: 'America/New_York', odometer: 1, fuelConsumed: 0.1 } });
    const s = await b.status();
    expect(s.webhook).toMatchObject({ afterHoursReports: 2, received: 2 });
    const t = (await b.positions(UNITS)).units!.find((u) => u.unitId === 'u-bucket')!.truck!;
    // Where it went after 8 PM is not shown — and neither is the 7:55 PM spot it has since left.
    expect(t).toMatchObject({ motion: 'after_hours', lat: null, lon: null, positionAt: null });
    expect(JSON.stringify(t)).not.toMatch(/36\.95|36\.81|-76\.1/);
    // The same burst in the other order ends the same way.
    const o = await connected({ clock: { t: Date.parse('2026-10-21T12:05:00Z') }, http: fakeBouncie({ grants: [grant(1, 86_400)], vehicles: () => answer(200, []) }).http });
    await hook(o.b, tripData([[Date.parse('2026-10-20T23:49:00Z'), LAT, LON]]));
    await hook(o.b, tripData([[Date.parse('2026-10-21T00:10:00Z'), 36.95, -76.1], [Date.parse('2026-10-20T23:55:00Z'), 36.81, -75.91]]));
    expect((await o.b.positions(UNITS)).units!.find((u) => u.unitId === 'u-bucket')!.truck).toMatchObject({ motion: 'after_hours', lat: null });
  });

  it('the vehicles read: a record Bouncie last touched after hours is withheld — never shown, never "no position yet"', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const clock = { t: Date.parse('2026-10-21T12:01:00Z') }; // Wednesday 8:01 AM
    const f = fakeBouncie({ grants: [grant(1, 86_400)], vehicles: () => answer(200, [vehicle({}, { lastUpdated: '2026-10-21T01:15:00Z' })]) }); // Tue 9:15 PM
    const { b } = await connected({ clock, http: f.http });
    const t = (await b.positions(UNITS)).units!.find((u) => u.unitId === 'u-bucket')!.truck!;
    expect(t).toMatchObject({ motion: 'after_hours', lat: null, lon: null, positionAt: null, name: 'Bucket truck' });
    expect(JSON.stringify(t)).not.toContain(String(LAT));
  });
});

describe('GET /api/fleet/trips — read only, owner only, one truck, one day, inside working hours', () => {
  const ET = (s: string) => Date.parse(s);
  const trip = (start: number, end: number, over: Record<string, unknown> = {}) => ({
    transactionId: `${IMEI}-${start}-202610`, hardBrakingCount: 0, hardAccelerationCount: 0, distance: 12.5,
    gps: JSON.stringify({ type: 'LineString', coordinates: [[LON, LAT], [-75.97, 36.853]] }),
    startTime: iso(start), endTime: iso(end), startOdometer: 1, endOdometer: 13, averageSpeed: 30, maxSpeed: 55,
    fuelConsumed: 0.5, timeZone: 'America/New_York', totalIdleDuration: 60, imei: IMEI, ...over,
  });
  async function withTrips(answerTrips: () => ReturnType<typeof answer>, clock = { t: T0 }) {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const f = fakeBouncie({ grants: [grant(1, 86_400)], vehicles: (_t, url) => (url.startsWith(`${API_BASE}trips?`) ? answerTrips() : answer(200, [vehicle()])) });
    const m = await connected({ clock, http: f.http });
    const id = (await m.b.positions(UNITS)).units!.find((u) => u.unitId === 'u-bucket')!.truck!.id;
    return { ...m, f, id, tripCalls: () => f.reads().filter((c) => c.url.startsWith(`${API_BASE}trips?`)) };
  }

  it('asks Bouncie for that day\'s working window only, and keeps only trips wholly inside it', async () => {
    const { b, id, tripCalls } = await withTrips(() => answer(200, [
      trip(ET('2026-10-19T15:00:00Z'), ET('2026-10-19T15:30:00Z'), { gps: { type: 'Feature', geometry: { type: 'LineString', coordinates: [[LON, LAT]] } } }), // 11:00 AM
      trip(ET('2026-10-19T12:30:00Z'), ET('2026-10-19T13:10:00Z')), // 8:30–9:10 AM
      trip(ET('2026-10-19T23:40:00Z'), ET('2026-10-20T00:20:00Z')), // 7:40–8:20 PM: runs past 8 PM
      { startTime: '2026-01-01T010:01:00.000Z', endTime: 'nope' }, // Bouncie's own malformed example
    ]));
    const r = await b.trips({ truck: id, day: '2026-10-19' });
    expect(r.status).toBe(200);
    const body = r.body as { state: string; trips: Array<Record<string, unknown>>; skipped: unknown; truck: unknown; window: unknown };
    expect(body.state).toBe('ok');
    const [call] = tripCalls();
    const u = new URL(call!.url);
    expect(`${u.origin}${u.pathname}`).toBe(`${API_BASE}trips`);
    // Monday 8:00 AM to 8:00 PM in Virginia Beach (EDT): under Bouncie's one-week limit, never past the hours.
    expect(Object.fromEntries(u.searchParams)).toEqual({ imei: IMEI, 'gps-format': 'geojson', 'starts-after': '2026-10-19T12:00:00.000Z', 'ends-before': '2026-10-20T00:00:00.000Z' });
    expect(call!.method).toBe('GET');
    expect(call!.headers.authorization).toBe('ACCESS-FAKE-1');
    expect(call!.redirect).toBe('error');
    expect(body.window).toEqual({ from: '2026-10-19T12:00:00.000Z', to: '2026-10-20T00:00:00.000Z' });
    expect(body.trips.map((t) => t.startedAt)).toEqual(['2026-10-19T12:30:00.000Z', '2026-10-19T15:00:00.000Z']);
    expect(body.trips[0]).toMatchObject({ minutes: 40, miles: 12.5, path: [{ lat: LAT, lon: LON }, { lat: 36.853, lon: -75.97 }], pathPoints: 2, pathThinned: false });
    expect(body.trips[1]).toMatchObject({ path: [{ lat: LAT, lon: LON }], pathPoints: 1 });
    expect(body.skipped).toEqual({ outsideHours: 1, unreadable: 1, overCap: 0 });
    expect(body.truck).toEqual({ id, name: 'Bucket truck', device4: '9876' });
    const json = JSON.stringify(body);
    for (const leak of [IMEI, VIN, '202610']) expect(json).not.toContain(leak);
    // At most one read a minute for the same truck and day.
    await b.trips({ truck: id, day: '2026-10-19' });
    expect(tripCalls()).toHaveLength(1);
  });

  it('today ends at now; a winter day keeps Eastern Standard Time; a path past the cap is thinned, ending where the trip ended', async () => {
    const coords = Array.from({ length: 5_001 }, (_, i) => [-75.9 - i / 100_000, 36.8 + i / 100_000]);
    const { b, id, tripCalls } = await withTrips(() => answer(200, [trip(T0 - 50 * min, T0 - 10 * min, { gps: { type: 'LineString', coordinates: coords } })]));
    const today = (await b.trips({ truck: id, day: '2026-10-20' })).body as { trips: Array<{ path: Array<{ lat: number; lon: number }>; pathThinned: boolean }> };
    expect(new URL(tripCalls()[0]!.url).searchParams.get('ends-before')).toBe(iso(T0));
    expect(today.trips[0]!.pathThinned).toBe(true);
    expect(today.trips[0]!.path.length).toBeLessThanOrEqual(2_001);
    expect(today.trips[0]!.path.at(-1)).toEqual({ lat: 36.8 + 5_000 / 100_000, lon: -75.9 - 5_000 / 100_000 });
    await b.trips({ truck: id, day: '2026-01-13' }); // a Tuesday in January
    const winter = new URL(tripCalls()[1]!.url).searchParams;
    expect([winter.get('starts-after'), winter.get('ends-before')]).toEqual(['2026-01-13T13:00:00.000Z', '2026-01-14T01:00:00.000Z']);
  });

  it('Sunday, after hours, a bad day or truck, an unknown truck: each named — and none of them asks Bouncie', async () => {
    const { b, id, clock, tripCalls } = await withTrips(() => answer(200, []));
    expect((await b.trips({ truck: id, day: '2026-10-18' })).body).toMatchObject({ state: 'not_a_working_day', message: TRIPS_SAYS.not_a_working_day, trips: [] });
    for (const day of ['2026-13-01', '2026-02-30', '2020-05-20', '2026-10-21', '20261019', '', null]) {
      expect((await b.trips({ truck: id, day })).body, String(day)).toMatchObject({ error: 'bad_day' });
    }
    for (const truckId of ['x', null, IMEI, id.toUpperCase()]) {
      expect((await b.trips({ truck: truckId, day: '2026-10-19' })).body, String(truckId)).toMatchObject({ error: 'bad_truck' });
    }
    expect(await b.trips({ truck: 'abcdefabcdef', day: '2026-10-19' })).toMatchObject({ status: 404, body: { error: 'unknown_truck' } });
    clock.t = AFTER;
    expect((await b.trips({ truck: id, day: '2026-10-19' })).body).toMatchObject({ state: 'after_hours', message: TRIPS_SAYS.after_hours, trips: [] });
    expect(tripCalls()).toEqual([]);
    expect(new Set(Object.values(TRIPS_SAYS)).size).toBe(Object.keys(TRIPS_SAYS).length);
    for (const [k, v] of Object.entries(TRIPS_SAYS)) if (k !== 'ok' && k !== 'no_trips') expect(v, k).toContain('This is not "no trips".');
  });

  it('Bouncie down is "couldn\'t read"; an empty answer is "no trips"; never the one for the other', async () => {
    const down = await withTrips(() => answer(503, {}));
    expect((await down.b.trips({ truck: down.id, day: '2026-10-19' })).body).toMatchObject({ state: 'unreadable', message: TRIPS_SAYS.unreadable, trips: [] });
    const odd = await withTrips(() => answer(200, { not: 'a list' }));
    expect((await odd.b.trips({ truck: odd.id, day: '2026-10-19' })).body).toMatchObject({ state: 'unreadable' });
    const none = await withTrips(() => answer(200, []));
    expect((await none.b.trips({ truck: none.id, day: '2026-10-19' })).body).toMatchObject({ state: 'no_trips', message: TRIPS_SAYS.no_trips, skipped: { outsideHours: 0, unreadable: 0, overCap: 0 } });
    // A path that can't be read is null — never an empty path standing in for one.
    const noPath = await withTrips(() => answer(200, [trip(ET('2026-10-19T15:00:00Z'), ET('2026-10-19T15:30:00Z'), { gps: 'garbled' })]));
    expect(((await noPath.b.trips({ truck: noPath.id, day: '2026-10-19' })).body as { trips: unknown[] }).trips[0]).toMatchObject({ path: null, pathPoints: 0 });
  });

  it('over the wire: the owner key reads it, the crew key never does, and the device number never travels', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    stubBouncieHosts(() => Date.now());
    const { base, srv } = await serve({ ...KEYS, ARBO_SECRET_DIR: tmp(), ARBO_LINK_BOUNCIE: 'live' });
    const owner = { 'x-arbor-key': 'admin-k' };
    try {
      const c = await (await realFetch(base + '/api/bouncie/connect', { method: 'POST', headers: owner })).json() as { authorizeUrl: string };
      expect((await realFetch(`${base}${BOUNCIE_CALLBACK_PATH}?code=CODE-FAKE-1&state=${new URL(c.authorizeUrl).searchParams.get('state')}`)).status).toBe(200);
      const pos = await (await realFetch(base + '/api/fleet/positions', { headers: owner })).json() as { units: Array<{ unitId: string; truck: { id: string } | null }> };
      const id = pos.units.find((u) => u.unitId === 'sim-unit-1')!.truck!.id;
      const path = `/api/fleet/trips?truck=${id}&day=2026-10-19`;
      expect((await realFetch(base + path, { headers: { 'x-arbor-key': 'crew-k' } })).status).toBe(401);
      expect((await realFetch(base + path)).status).toBe(401);
      const r = await realFetch(base + path, { headers: owner });
      expect(r.status).toBe(200);
      const text = await r.text();
      expect(JSON.parse(text)).toMatchObject({ day: '2026-10-19', truck: { id, device4: '9876' } });
      expect(text).not.toContain(IMEI);
    } finally {
      srv.close();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  // ---- review fixes ----
  const BAD_TRIP = { startTime: '2026-01-01T010:01:00.000Z', endTime: 'nope' }; // Bouncie's own malformed example
  const MON = '2026-10-19';
  const inMon = () => trip(ET('2026-10-19T15:00:00Z'), ET('2026-10-19T15:30:00Z')); // Monday 11:00 AM
  const tripsOf = async (b: Bouncie, id: string) => (await b.trips({ truck: id, day: MON })).body as { state: string; message: string; trips: Array<Record<string, unknown>>; skipped: Record<string, number> };

  it('trips Bouncie sent that can\'t be read are never "no trips": all unreadable is "couldn\'t read"; some unreadable is said beside the good ones', async () => {
    const all = await withTrips(() => answer(200, [BAD_TRIP]));
    const a = await tripsOf(all.b, all.id);
    expect(a).toMatchObject({ state: 'unreadable', trips: [], skipped: { unreadable: 1 } });
    expect(a.message).not.toBe(TRIPS_SAYS.no_trips);
    expect(a.message).toContain('This is not "no trips".');
    const some = await withTrips(() => answer(200, [inMon(), BAD_TRIP, BAD_TRIP]));
    const s = await tripsOf(some.b, some.id);
    expect(s).toMatchObject({ state: 'ok', skipped: { unreadable: 2 } });
    expect(s.trips).toHaveLength(1);
    expect(s.message).toContain(TRIPS_SAYS.ok);
    expect(s.message).toContain('2 trips Bouncie sent couldn’t be read and aren’t shown.');
    // All outside the hours is still "no trips inside working hours" — that one is Bouncie's answer, read.
    const late = await withTrips(() => answer(200, [trip(ET('2026-10-19T23:40:00Z'), ET('2026-10-20T00:20:00Z'))]));
    expect(await tripsOf(late.b, late.id)).toMatchObject({ state: 'no_trips', message: TRIPS_SAYS.no_trips, skipped: { outsideHours: 1, unreadable: 0 } });
  });

  it('a path whose points can\'t be read is null — never an empty path; a point that can\'t be read is counted', async () => {
    const pathOf = async (gps: unknown) => {
      const m = await withTrips(() => answer(200, [{ ...inMon(), gps }]));
      return (await tripsOf(m.b, m.id)).trips[0]!;
    };
    expect(await pathOf({ type: 'MultiLineString', coordinates: [[[LON, LAT], [-75.97, 36.853]]] })).toMatchObject({ path: null, pathPoints: 0, pathUnreadablePoints: null });
    expect(await pathOf({ type: 'Point', coordinates: [LON, LAT] })).toMatchObject({ path: null, pathPoints: 0 });
    expect(await pathOf({ type: 'LineString', coordinates: [[LON, LAT], ['x', 'y'], [-75.97, 36.853]] })).toMatchObject({ path: [{ lat: LAT, lon: LON }, { lat: 36.853, lon: -75.97 }], pathPoints: 2, pathUnreadablePoints: 1 });
    // Bouncie's own empty path is an empty path — nothing was dropped.
    expect(await pathOf({ type: 'LineString', coordinates: [] })).toMatchObject({ path: [], pathPoints: 0, pathUnreadablePoints: 0 });
  });

  it('the morning after an overnight clear, yesterday\'s truck id is looked up again — never "unknown" for a truck Bouncie still lists', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    let vehiclesUp = true;
    const f = fakeBouncie({ grants: [grant(1, 86_400)], vehicles: (_t, url) => (url.startsWith(`${API_BASE}trips?`) ? answer(200, [trip(ET('2026-10-20T15:00:00Z'), ET('2026-10-20T15:30:00Z'))]) : vehiclesUp ? answer(200, [vehicle()]) : answer(503, {})) });
    const { b, clock } = await connected({ http: f.http });
    const id = (await b.positions(UNITS)).units!.find((u) => u.unitId === 'u-bucket')!.truck!.id;
    clock.t = AFTER;
    expect((await b.positions(UNITS)).state).toBe('after_hours'); // everything held is dropped overnight
    clock.t = Date.parse('2026-10-21T12:05:00Z'); // Wednesday 8:05 AM, no positions read yet today
    // Bouncie down for the look: "couldn't read" — not "unknown truck", and not "Arbo restarted".
    vehiclesUp = false;
    expect(await b.trips({ truck: id, day: '2026-10-20' })).toMatchObject({ status: 200, body: { state: 'unreadable', message: TRIPS_SAYS.unreadable, trips: [] } });
    vehiclesUp = true;
    clock.t += 61_000;
    const r = await b.trips({ truck: id, day: '2026-10-20' });
    expect(r).toMatchObject({ status: 200, body: { state: 'ok', truck: { id } } });
    // A truck Bouncie doesn't list now: 404 — and the words don't blame a restart that never happened.
    const gone = await b.trips({ truck: 'abcdefabcdef', day: '2026-10-20' });
    expect(gone).toMatchObject({ status: 404, body: { error: 'unknown_truck' } });
    expect(String(gone.body.message)).toContain('isn’t in Bouncie’s list');
  });
});

describe('the page — after hours and the sign-in store, each in its own words', () => {
  it('the Fleet line: after hours and an unreadable saved sign-in are their own lines, never "no trucks" or "couldn\'t read"', () => {
    const after = trackWords(answerFor('after_hours'), 'u1');
    const store = trackWords(answerFor('sign_in_store'), 'u1');
    const none = trackWords(answerFor('no_trucks'), 'u1');
    const unread = trackWords(answerFor('unreadable'), 'u1');
    expect(after).toEqual(['After hours — not tracking (8am–8pm, Mon–Sat)', 'feed-state cut']);
    expect(store).toEqual(['Tracking stopped — Arbo can’t open the saved Bouncie sign-in; Settings says why', 'feed-state unread']);
    expect(new Set([after[0], store[0], none[0], unread[0]]).size).toBe(4);
    expect(after[1]).not.toBe(none[1]);
    // Every state the server can name has its own line (an unknown one would read as "couldn't read").
    expect(Object.keys(TRACK_SAYS).sort()).toEqual(Object.keys(POSITIONS_SAYS).filter((k) => k !== 'ok').sort());
    // One truck whose newest report was after hours.
    expect(truckWords(truck({ motion: 'after_hours', lat: null, lon: null, positionAt: null, positionAgeMinutes: null }))).toEqual(['Last report was after hours — not shown until it reports in working hours', 'feed-state cut']);
  });

  const base = {
    keys: { clientId: true, clientSecret: true, webhookKey: true, apiKey: false },
    signIn: { state: 'connected', stored: true, where: 'supabase', savedAt: '2026-10-20T13:00:00Z', problem: null },
    link: { envVar: 'ARBO_LINK_BOUNCIE', open: true },
    positions: { state: 'ok', readAt: '2026-10-20T13:59:00Z' },
    trucks: { known: 3, lastReportAt: '2026-10-20T13:58:00Z' },
    webhook: { wired: true, url: BOUNCIE_WEBHOOK_URL, deliveries: 38, received: 40, lastAt: '2026-10-20T13:58:00Z', whileCut: 0, droppedKeysMissing: 0, afterHours: 0, afterHoursReports: 0, lastAuthenticAt: '2026-10-20T13:58:00Z', rejected: 0, lastRejectedAt: null, refusedNotWired: 0, unknownTypes: 0, badEvents: 0, badJson: 0, oversized: 0, overCap: 0 },
    redirectUri: BOUNCIE_REDIRECT,
  };
  const rows = (over: Record<string, unknown>) => bouncieRows({ ...base, ...over });

  it('Settings: each place the sign-in can be stuck is its own sentence, and none of them is "not connected"', () => {
    const first = (s: Record<string, unknown>) => rows({ signIn: s })[0]!;
    expect(first({ state: 'connected', where: 'supabase', savedAt: null })).toEqual(['CONNECTED', 'good', 'Bouncie connected — saved in Supabase, sealed. Survives redeploys.']);
    const stuck = [
      first({ state: 'store_unconfigured', problem: 'unconfigured' }),
      first({ state: 'store_missing', problem: 'missing_table' }),
      first({ state: 'store_unreadable', problem: 'unreachable' }),
      first({ state: 'store_unreadable', problem: 'refused' }),
      first({ state: 'store_unreadable', problem: 'mismatch' }),
      first({ state: 'store_locked', problem: 'locked' }),
      first({ state: 'unsaved' }),
      first({ state: 'store_cut', problem: 'cut' }),
    ];
    expect(stuck.map(([c, tone]) => `${c}=${tone}`)).toEqual(['NOT SET UP=watch', 'NOT SET UP=watch', 'UNREADABLE=watch', 'UNREADABLE=watch', 'UNREADABLE=watch', 'LOCKED=stop', 'NOT SAVED=watch', 'CUT=info']);
    // The store cut on purpose (§3, until Mike rules) names its switch — and is not "not connected".
    expect(stuck[7]![2]).toContain('ARBO_LINK_CREDENTIALS');
    // NOT SAVED is retried every minute, whatever the hour (the server's minute tick).
    expect(stuck[6]![2]).toContain('tries again every minute');
    expect(new Set(stuck.map(([, , t]) => t)).size).toBe(stuck.length);
    expect(stuck[1]![2]).toContain('migration 0021 not applied');
    expect(stuck[3]![2]).toContain('Supabase refused Arbo’s key');
    expect(stuck[5]![2]).toContain('BOUNCIE_CLIENT_SECRET changed');
    for (const [, , t] of stuck) expect(t).not.toMatch(/isn’t connected yet/);
  });

  it('Settings: after hours on the positions row, after-hours updates counted, and BOUNCIE_API_KEY named as not needed', () => {
    expect(rows({ positions: { state: 'after_hours', readAt: null } })[1]).toEqual(['AFTER HOURS', 'info', 'Positions on, but it is after hours — Arbo tracks trucks only 8am–8pm, Monday to Saturday. Nothing is read or kept now; tracking resumes at 8am on the next working day.']);
    const hookRows = rows({ webhook: { ...base.webhook, afterHours: 3, afterHoursReports: 1 } });
    expect(hookRows.find(([c]) => c === 'AFTER HOURS')![2]).toBe('Bouncie sent 3 updates after hours since Arbo last restarted; each was answered and dropped unread. 1 report stamped after hours inside daytime updates was skipped too. Arbo tracks trucks only 8am–8pm, Monday to Saturday.');
    // Only after-hours updates since the restart is still WIRED — not "nothing has arrived".
    expect(rows({ webhook: { ...base.webhook, deliveries: 0, received: 0, lastAt: null, afterHours: 2 } }).map(([c]) => c)).toContain('WIRED');
    expect(rows({}).some(([c]) => c === 'NOT NEEDED')).toBe(false);
    // Mike, 2026-10-20: it is the portal's per-user Authorization Code — Connect Bouncie gets its own.
    const k = rows({ keys: { ...base.keys, apiKey: true } }).find(([c]) => c === 'NOT NEEDED')!;
    expect(k).toEqual(['NOT NEEDED', 'info', 'Not needed — Connect Bouncie gets its own code. You can delete BOUNCIE_API_KEY from Railway.']);
  });

  it('Settings: a locked sign-in offers Reconnect; a missing table shows the redirect and no button; its refusal is worded', async () => {
    const run = async (status: unknown, connect: () => Promise<unknown> = async () => ({ authorizeUrl: 'https://auth.example.invalid/x' })) => {
      const api = async (_p: string, opts?: { method?: string }) => (opts && opts.method === 'POST' ? connect() : status);
      const feedLine = (_e: unknown, what: string) => el('div', 'feed-state', what);
      const f = pageFn<(v: N, stale: () => boolean) => Promise<void>>('bouncieSettings', { el, api, chip, feedLine, bouncieRows, location: { assign: () => undefined } });
      const v = el('div');
      await f(v, () => false);
      return v;
    };
    const locked = await run({ ...base, signIn: { state: 'store_locked', stored: false, where: null, savedAt: null, problem: 'locked' } });
    expect(locked.all().find((n) => n.tag === 'button')!.textContent).toBe('Reconnect Bouncie');
    const missing = await run({ ...base, signIn: { state: 'store_missing', stored: false, where: null, savedAt: null, problem: 'missing_table' } });
    expect(missing.all().some((n) => n.tag === 'button')).toBe(false);
    expect(missing.text()).toContain('Redirect URI to register in the Bouncie portal: ' + BOUNCIE_REDIRECT);
    const refused = await run({ ...base, signIn: { state: 'not_connected', stored: false, where: null, savedAt: null, problem: null } }, async () => { throw Object.assign(new Error('bouncie_store_missing'), { code: 503 }); });
    await refused.all().find((n) => n.tag === 'button')!.click();
    expect(refused.text()).toContain('Not opened — the sign-in table isn’t in Supabase yet (migration 0021).');
    const cutStore = await run({ ...base, signIn: { state: 'store_cut', stored: false, where: null, savedAt: null, problem: 'cut' } });
    expect(cutStore.all().some((n) => n.tag === 'button')).toBe(false);
    expect(cutStore.text()).toContain('Redirect URI to register in the Bouncie portal: ' + BOUNCIE_REDIRECT);
    const refusedCut = await run({ ...base, signIn: { state: 'not_connected', stored: false, where: null, savedAt: null, problem: null } }, async () => { throw Object.assign(new Error('bouncie_store_cut'), { code: 503 }); });
    await refusedCut.all().find((n) => n.tag === 'button')!.click();
    expect(refusedCut.text()).toContain('Not opened — the sign-in store in Supabase is cut on purpose (ARBO_LINK_CREDENTIALS isn’t live).');
  });

  it('the new chip words are in the canonical tone list', () => {
    const words = html.slice(html.indexOf('TONE WORDS (the canonical list)'), html.indexOf('const TONE = {'));
    const line = (tone: string) => words.slice(words.indexOf(`//   ${tone} = `)).split(/\n\/\/ {3}[a-z]+ = /)[0]!;
    expect(line('info')).toContain('AFTER HOURS');
    expect(line('info')).toContain('NOT NEEDED');
    expect(line('info')).not.toContain('NOT USED');
    expect(line('stop')).toContain('LOCKED');
    expect(line('watch')).toContain('NOT SAVED');
    expect(line('watch')).toContain('NOT RENEWED');
  });
});

describe('the amendment is filed in Mike\'s words, and the steps match what was built', () => {
  it('R31 carries "Amended by Mike\'s spec 2026-10-20" with his tasks; BOUNCIE.md names the new steps', () => {
    const rulings = readFileSync(new URL('../docs/OWNER_RULINGS.md', import.meta.url), 'utf8');
    const r31 = rulings.slice(rulings.indexOf('## R31 — '));
    expect(r31).toContain('**Amended by Mike\'s spec 2026-10-20.**');
    expect(r31).toContain('*"store the tokens server-side in Supabase"*');
    expect(r31).toContain('*"Location data is admin-only and tracked only during working hours, per the spec."*');
    const doc = readFileSync(new URL('../docs/BOUNCIE.md', import.meta.url), 'utf8');
    for (const s of ['0021_integration_credential.sql', 'BOUNCIE_API_KEY', '8am–8pm', 'Monday to Saturday', '/api/fleet/trips']) expect(doc, s).toContain(s);
    expect(doc).not.toContain('nothing goes into the database');
    // Review fixes: the credential switch is a step of its own, and the weekend gap in the sign-in's use is named.
    expect(doc).toContain('ARBO_LINK_CREDENTIALS');
    expect(doc).toContain('36 hours');
    expect(r31).toContain('ARBO_LINK_CREDENTIALS');
  });
});

describe('the server wires the Supabase store — and reaches nothing else there while the data links stay cut', () => {
  // Review fix (§3 vs Mike's "store the tokens server-side in Supabase"): the conflict goes to Mike, so
  // until he sets ARBO_LINK_CREDENTIALS=live the server touches Supabase for NOTHING — not even the sign-in.
  async function boot(credLink: string | undefined) {
    const supabaseCalls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith(SB_URL)) {
        supabaseCalls.push({ url: u, method: init?.method ?? 'GET' });
        return new Response(JSON.stringify({ code: 'PGRST205', message: 'not found' }), { status: 404 }); // migration 0021 not applied
      }
      return realFetch(url, init);
    });
    const s = await serve({ ...KEYS, ARBO_DATA_LINKS: undefined, SUPABASE_URL: SB_URL, SUPABASE_SERVICE_ROLE_KEY: SB_KEY, ARBO_SECRET_DIR: tmp(), ARBO_LINK_BOUNCIE: undefined, ARBO_LINK_CREDENTIALS: credLink });
    return { ...s, supabaseCalls };
  }
  const owner = { 'x-arbor-key': 'admin-k' };

  it('links cut and ARBO_LINK_CREDENTIALS not "live": no Supabase call at all — the sign-in store is CUT by name, and Connect refuses', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const { base, srv, supabaseCalls } = await boot(undefined);
    try {
      const s = await (await realFetch(base + '/api/bouncie', { headers: owner })).json() as { signIn: Record<string, unknown> };
      expect(s.signIn).toMatchObject({ state: 'store_cut', problem: 'cut', stored: false });
      const c = await realFetch(base + '/api/bouncie/connect', { method: 'POST', headers: owner });
      expect(c.status).toBe(503);
      const body = await c.json() as { error: string; message: string };
      expect(body.error).toBe('bouncie_store_cut');
      expect(body.message).toContain('ARBO_LINK_CREDENTIALS');
      expect(supabaseCalls).toEqual([]);
    } finally {
      srv.close();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('with ARBO_LINK_CREDENTIALS=live (Mike\'s go): the store is Supabase, the missing table is named, and the only address used is the credential table', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const { base, srv, supabaseCalls } = await boot('live');
    try {
      const s = await (await realFetch(base + '/api/bouncie', { headers: owner })).json() as { signIn: Record<string, unknown> };
      expect(s.signIn).toMatchObject({ state: 'store_missing', problem: 'missing_table', stored: false });
      const c = await realFetch(base + '/api/bouncie/connect', { method: 'POST', headers: owner });
      expect(c.status).toBe(503);
      expect(await c.json()).toMatchObject({ error: 'bouncie_store_missing' });
      expect(supabaseCalls.length).toBeGreaterThan(0);
      for (const call of supabaseCalls) expect(call.url.startsWith(`${SB_URL}/rest/v1/integration_credential?`), call.url).toBe(true);
    } finally {
      srv.close();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

describe('the Supabase store never puts a value in a log', () => {
  it('connect, a refresh Supabase refuses, its retry, a locked row and a deploy-overlap adoption: the logs carry states only', async () => {
    process.env.ARBO_LINK_CREDENTIALS = 'live';
    const lines: string[] = [];
    const spies = (['log', 'error', 'warn', 'info'] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); }));
    try {
      process.env.ARBO_LINK_BOUNCIE = 'live';
      const sb = fakeSupabase();
      const f = fakeBouncie({ grants: [grant(1), grant(2), grant(3)], vehicles: () => answer(200, [vehicle()]) });
      const { b, clock } = await connected({ http: f.http, tokens: sbTokens(sb) });
      sb.state.write = 503;
      clock.t = T0 + 3600_000;
      await b.positions(UNITS);
      sb.state.write = 201;
      clock.t += 61_000;
      await b.positions(UNITS);
      const locked = make({ clientSecret: 'another-made-up-secret', tokens: sbTokens(sb, 'another-made-up-secret') });
      await locked.b.ready();
      expect(locked.b.bootLine()).toContain('sign-in store_locked (sign-in store: locked)');
      const stale = make({ http: fakeBouncie({ grants: [() => answer(400, {})] }).http, tokens: sbTokens(sb) });
      await stale.b.ready();
      await b.accessToken('ACCESS-FAKE-2'); // the running one rotates again
      stale.clock.t = T0 + 3 * 3600_000;
      await stale.b.accessToken();
    } finally {
      for (const s of spies) s.mockRestore();
    }
    const logs = lines.join('\n');
    expect(logs).toContain('could not be saved (unreachable)');
    expect(logs).toContain('the renewed sign-in is saved now');
    expect(logs).toContain('a newer saved sign-in was found in Supabase');
    for (const secret of ['ACCESS-FAKE', 'REFRESH-FAKE', SECRET, 'another-made-up-secret', SB_KEY, HOOK_KEY, 'CODE-FAKE', IMEI, VIN, String(LAT), String(LON)]) {
      expect(logs, `a log line carried ${secret}`).not.toContain(secret);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Review fixes (security + rules review of the add-on, 2026-10-20).
// ═══════════════════════════════════════════════════════════════════════

describe('§3 holds until Mike rules: the sign-in store in Supabase has its own switch, cut unless exactly "live"', () => {
  it('cut: named, Supabase never called, and Connect refuses — a tap already minted is refused before Bouncie is asked', async () => {
    for (const v of [undefined, '', 'off', 'true', 'LIVE', 'live ']) {
      if (v === undefined) delete process.env.ARBO_LINK_CREDENTIALS;
      else process.env.ARBO_LINK_CREDENTIALS = v;
      const sb = fakeSupabase();
      const f = fakeBouncie({ grants: [grant(1)] });
      const { b } = make({ http: f.http, tokens: sbTokens(sb) });
      const { state } = begin(b); // a tap from before the store was read
      const r = await b.finishConnect({ code: 'CODE-FAKE-1', state });
      expect(r, String(v)).toMatchObject({ status: 503, ok: false, title: 'Arbo has nowhere to keep the Bouncie sign-in yet' });
      expect(r.line).toContain('ARBO_LINK_CREDENTIALS');
      expect(f.calls).toEqual([]); // the code was never spent
      expect(sb.calls).toEqual([]); // and Supabase was never touched
      expect(b.signInState()).toBe('store_cut');
      expect(b.beginConnect()).toEqual({ ok: false, error: 'bouncie_store_cut' });
      expect(b.bootLine()).toContain('sign-in store_cut (sign-in store: cut)');
      process.env.ARBO_LINK_BOUNCIE = 'live';
      // Its own state (§11 audit tone note): a store cut on purpose is not "can't open the sign-in".
      expect((await b.positions(UNITS)).state).toBe('sign_in_cut');
      expect(sb.calls).toEqual([]);
    }
  });
});

describe('a refused refresh is "expired" only when Supabase was read and holds nothing newer — and it is looked at again', () => {
  beforeEach(() => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    process.env.ARBO_LINK_CREDENTIALS = 'live';
  });
  const newerPair = (at: number) => ({ accessToken: 'ACCESS-FAKE-2', refreshToken: 'REFRESH-FAKE-2', expiresAt: at + 3600_000, savedAt: iso(at) });
  /** One Arbo connects (pair 1); a second boots on the same row with a Bouncie that refuses pair 1's refresh. */
  async function overlap() {
    const sb = fakeSupabase();
    await connected({ http: fakeBouncie({ grants: [grant(1)] }).http, tokens: sbTokens(sb) });
    const f = fakeBouncie({ grants: [() => answer(400, { error: 'invalid_grant' })], vehicles: (t) => (t === 'ACCESS-FAKE-2' ? answer(200, []) : answer(401, {})) });
    const clock = { t: T0 };
    const { b } = make({ clock, http: f.http, tokens: sbTokens(sb) });
    await b.ready();
    return { sb, f, clock, b, gets: () => sb.calls.filter((c) => c.method === 'GET').length };
  }

  it('the look at Supabase fails: the store, by name — never "expired"; a minute later the newer saved pair is taken', async () => {
    const { sb, f, clock, b } = await overlap();
    await sbTokens(sb).save(newerPair(T0 + 3600_000)); // the other Arbo rotated pair 1 and saved pair 2
    sb.state.read = 'throw';
    clock.t = T0 + 3600_000;
    expect((await b.positions(UNITS)).state).toBe('sign_in_store');
    expect(b.signInState()).toBe('store_unreadable');
    sb.state.read = 200;
    clock.t += 61_000;
    expect((await b.positions(UNITS)).state).toBe('no_trucks');
    expect(b.signInState()).toBe('connected');
    expect(f.tokenCalls()).toHaveLength(1);
  });

  it('expired, then a newer pair is saved (the other Arbo, or a Reconnect there): taken within a minute — EXPIRED never sits over a good sign-in', async () => {
    const { sb, f, clock, b, gets } = await overlap();
    clock.t = T0 + 3600_000;
    expect((await b.positions(UNITS)).state).toBe('token_expired'); // Supabase was read: it still holds the refused pair
    expect(b.signInState()).toBe('expired');
    await sbTokens(sb).save(newerPair(clock.t));
    const n = gets();
    clock.t += 30_000;
    expect((await b.positions(UNITS)).state).toBe('token_expired');
    expect(gets()).toBe(n); // looked at most once a minute
    clock.t += 31_000;
    expect((await b.positions(UNITS)).state).toBe('no_trucks');
    expect(b.signInState()).toBe('connected');
    expect(f.tokenCalls()).toHaveLength(1); // the refused refresh token was never sent again
  });

  it('expired, and nothing newer is saved: it stays EXPIRED, and the refused refresh token is never sent again', async () => {
    const { f, clock, b, gets } = await overlap();
    clock.t = T0 + 3600_000;
    expect((await b.positions(UNITS)).state).toBe('token_expired');
    const n = gets();
    for (let i = 0; i < 3; i++) {
      clock.t += 61_000;
      expect((await b.positions(UNITS)).state).toBe('token_expired');
    }
    expect(gets()).toBe(n + 3);
    expect(f.tokenCalls()).toHaveLength(1);
    expect(b.signInState()).toBe('expired');
  });
});

describe('the minute tick: after 8pm nothing is held even with nobody asking, and a renewed sign-in is saved whatever the hour', () => {
  it('positions held at 7:58 PM are gone after the 8:01 PM tick, with no request; inside the hours the tick keeps them', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const clock = { t: Date.parse('2026-10-20T23:58:00Z') }; // Tuesday 7:58 PM
    let list: unknown[] = [vehicle({}, { lastUpdated: iso(clock.t - min) })];
    const f = fakeBouncie({ grants: [grant(1, 86_400)], vehicles: () => answer(200, list) });
    const { b } = await connected({ clock, http: f.http });
    expect((await b.positions(UNITS)).state).toBe('ok');
    await b.tick();
    expect((await b.positions(UNITS)).units!.find((u) => u.unitId === 'u-bucket')!.truck).not.toBeNull(); // in hours: kept
    clock.t = Date.parse('2026-10-21T00:01:00Z'); // 8:01 PM — nobody opens the app all night
    await b.tick();
    // Wednesday 8:00 AM Bouncie lists no trucks. Had last night's truck still been held, it would show.
    list = [];
    clock.t = Date.parse('2026-10-21T12:00:00Z');
    expect((await b.positions(UNITS)).state).toBe('no_trucks');
  });

  it('a renewed sign-in Supabase refused at 7:59 PM is saved by the tick after hours — without reading Bouncie', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    process.env.ARBO_LINK_CREDENTIALS = 'live';
    const sb = fakeSupabase();
    const f = fakeBouncie({ grants: [grant(1), grant(2)], vehicles: () => answer(200, []) });
    const { b, clock } = await connected({ http: f.http, tokens: sbTokens(sb) });
    sb.state.write = 'throw';
    clock.t = Date.parse('2026-10-20T23:59:00Z'); // 7:59 PM: due, renewed by Bouncie, not saved
    expect((await b.positions(UNITS)).state).toBe('sign_in_store');
    expect(b.signInState()).toBe('unsaved');
    const reads = f.reads().length;
    sb.state.write = 201;
    clock.t = AFTER; // 9:30 PM
    await b.tick();
    expect(b.signInState()).toBe('connected');
    expect(sb.plain()).toMatchObject({ accessToken: 'ACCESS-FAKE-2', refreshToken: 'REFRESH-FAKE-2' });
    expect(f.reads()).toHaveLength(reads); // nothing read from Bouncie after hours
    expect(f.tokenCalls()).toHaveLength(2); // and no second refresh
  });

  it('the tick never throws, and the server runs it once a minute (unref\'d, beside the other timers)', async () => {
    const { b } = make({ tokens: { kind: 'supabase', load: async () => { throw new Error('boom'); }, save: async () => { throw new Error('boom'); } } as TokenBackend });
    await expect(b.tick()).resolves.toBeUndefined();
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(server).toContain('currentBouncie = bouncie;');
    expect(server).toMatch(/setInterval\(\(\) => \{ void bouncieNow\.tick\(\); \}, 60_000\)\.unref\(\);/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Mike's three answers, 2026-10-20 (after the §11 audit):
//   1. "Yes, allow the sign-in row" — migration 0021 applied live; ARBO_LINK_CREDENTIALS=live at deploy.
//   2. BOUNCIE_API_KEY is the portal's per-user Authorization Code (Users & Devices → Authorize My
//      Devices). Not needed: Connect Bouncie gets its own code. Presence only.
//   3. "Keep the sign-in alive" — once a day, whatever the hour, the refresh token is swapped and
//      saved; nothing about a truck is read.
// ═══════════════════════════════════════════════════════════════════════

const H = 3600_000;
/** Nothing but token swaps went to Bouncie: no vehicles, no trips, no position. */
function onlyTokenSwaps(f: ReturnType<typeof fakeBouncie>): void {
  expect(f.calls.filter((c) => c.url.includes('/v1/vehicles') || c.url.includes('/v1/trips'))).toEqual([]);
  expect(f.reads()).toEqual([]);
  for (const c of f.calls) expect([c.method, c.url]).toEqual(['POST', TOKEN_URL]);
}

describe('keep the sign-in alive (Mike, 2026-10-20: "Keep the sign-in alive") — a daily renewal that reads nothing else', () => {
  beforeEach(() => {
    process.env.ARBO_LINK_CREDENTIALS = 'live';
  });

  it('20 hours after the last renewal the minute tick swaps the refresh token — before 8am, with positions on — and reads no truck', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live'; // positions on: even so, the keep-alive never reads a truck
    const sb = fakeSupabase();
    const f = fakeBouncie({ grants: [grant(1), grant(2), grant(3)], vehicles: () => answer(200, [vehicle()]) });
    const { b, clock } = await connected({ http: f.http, tokens: sbTokens(sb) }); // Tuesday 10:00 AM
    clock.t = T0 + 20 * H - min; // Wednesday 5:59 AM: 19 h 59 min since the sign-in — not yet
    await b.tick();
    expect(f.tokenCalls()).toHaveLength(1);
    clock.t = T0 + 20 * H; // Wednesday 6:00 AM — before working hours
    await b.tick();
    expect(f.tokenCalls()).toHaveLength(2);
    expect(f.tokenCalls()[1]!.body).toEqual({ client_id: CLIENT, client_secret: SECRET, grant_type: 'refresh_token', refresh_token: 'REFRESH-FAKE-1' });
    // Stored through the credential store: the rotated pair, sealed, with when it was renewed.
    expect(sb.plain()).toMatchObject({ accessToken: 'ACCESS-FAKE-2', refreshToken: 'REFRESH-FAKE-2', savedAt: iso(T0 + 20 * H) });
    expect(b.signInState()).toBe('connected');
    // Renewed: nothing more for another 20 hours, however often the tick runs.
    for (let i = 1; i <= 5; i++) {
      clock.t = T0 + 20 * H + i * H;
      await b.tick();
    }
    expect(f.tokenCalls()).toHaveLength(2);
    onlyTokenSwaps(f); // positions on and 11:00 AM by the last tick — and still no vehicles or trips read
  });

  it('on a Sunday — no working hours at all — the sign-in is renewed all the same, and nothing else is asked', async () => {
    const sb = fakeSupabase();
    const f = fakeBouncie({ grants: [grant(1), grant(2)], vehicles: () => answer(200, [vehicle()]) });
    const { b, clock } = await connected({ clock: { t: SUNDAY - 20 * H }, http: f.http, tokens: sbTokens(sb) }); // Saturday 4:00 PM
    clock.t = SUNDAY; // Sunday noon
    await b.tick();
    expect(f.tokenCalls()).toHaveLength(2);
    expect(sb.plain()).toMatchObject({ refreshToken: 'REFRESH-FAKE-2' });
    expect(b.signInState()).toBe('connected');
    onlyTokenSwaps(f);
  });

  it('never while ARBO_LINK_CREDENTIALS is cut — the switch is read at every tick — and never without a good sign-in', async () => {
    // A sign-in read while the switch was open, then the switch cut: nothing goes to Bouncie or Supabase.
    const sb = fakeSupabase();
    const f = fakeBouncie({ grants: [grant(1), grant(2)] });
    const { b, clock } = await connected({ http: f.http, tokens: sbTokens(sb) });
    const sbCalls = sb.calls.length;
    for (const v of [undefined, '', 'off', 'true', 'LIVE', 'live ']) {
      if (v === undefined) delete process.env.ARBO_LINK_CREDENTIALS;
      else process.env.ARBO_LINK_CREDENTIALS = v;
      clock.t += 21 * H;
      await b.tick();
    }
    expect(f.tokenCalls()).toHaveLength(1);
    expect(sb.calls).toHaveLength(sbCalls);
    // Cut from boot: Supabase is never read, so there is no sign-in, and no call anywhere.
    delete process.env.ARBO_LINK_CREDENTIALS;
    const sb2 = fakeSupabase();
    const f2 = fakeBouncie({ grants: [grant(1)] });
    const cut = make({ http: f2.http, tokens: sbTokens(sb2) });
    await cut.b.ready();
    cut.clock.t += 48 * H;
    await cut.b.tick();
    expect(f2.calls).toEqual([]);
    expect(sb2.calls).toEqual([]);
    // Open, but not connected: nothing to renew.
    process.env.ARBO_LINK_CREDENTIALS = 'live';
    const f3 = fakeBouncie({ grants: [grant(1)] });
    const none = make({ http: f3.http, tokens: sbTokens(fakeSupabase()) });
    await none.b.ready();
    expect(none.b.signInState()).toBe('not_connected');
    none.clock.t += 48 * H;
    await none.b.tick();
    expect(f3.calls).toEqual([]);
    // Keys gone from the server: not even a look.
    const f4 = fakeBouncie({ grants: [grant(1)] });
    const bare = make({ clientId: null, clientSecret: null, http: f4.http, tokens: sbTokens(fakeSupabase()) });
    bare.clock.t += 48 * H;
    await bare.b.tick();
    expect(f4.calls).toEqual([]);
  });

  it('a renewal Bouncie refuses is EXPIRED once Supabase holds nothing newer — and the refused token is never sent again', async () => {
    const sb = fakeSupabase();
    const f = fakeBouncie({ grants: [grant(1), () => answer(400, { error: 'invalid_grant' })] });
    const { b, clock } = await connected({ http: f.http, tokens: sbTokens(sb) });
    clock.t = T0 + 20 * H;
    await b.tick();
    expect(b.signInState()).toBe('expired');
    for (let i = 1; i <= 3; i++) {
      clock.t = T0 + 20 * H + i * H;
      await b.tick();
    }
    expect(f.tokenCalls()).toHaveLength(2);
    // EXPIRED says it (with Reconnect); the keep-alive line is not stacked on top of it.
    const rows = bouncieRows(await b.status());
    expect(rows[0]![0]).toBe('EXPIRED');
    expect(rows.some(([c]) => c === 'NOT RENEWED')).toBe(false);
    onlyTokenSwaps(f);
  });

  it('the rotated pair is saved before anything uses it: Supabase refusing it keeps the old row, holds the new pair unused, and the tick saves it — one swap', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const sb = fakeSupabase();
    const used: Array<[string, unknown]> = [];
    const f = fakeBouncie({ grants: [grant(1), grant(2, 86_400)], vehicles: (t) => { used.push([t, sb.plain()?.accessToken ?? null]); return answer(200, []); } });
    const { b, clock } = await connected({ http: f.http, tokens: sbTokens(sb) });
    const before = { ...sb.state.row };
    sb.state.write = 503;
    clock.t = T0 + 20 * H; // Wednesday 6:00 AM
    await b.tick();
    expect(f.tokenCalls()).toHaveLength(2);
    expect(sb.state.row).toEqual(before); // the old row is not discarded
    expect(sb.plain()).toMatchObject({ refreshToken: 'REFRESH-FAKE-1' });
    expect(b.signInState()).toBe('unsaved');
    // Renewed at Bouncie, not saved yet: NOT SAVED says that — it is not a failed renewal.
    const s = await b.status();
    expect(s.keepAlive).toEqual({ failedAt: null });
    expect(bouncieRows(s)[0]![0]).toBe('NOT SAVED');
    clock.t += min;
    await b.tick(); // Supabase still refusing: held, and no second swap
    expect(f.tokenCalls()).toHaveLength(2);
    sb.state.write = 201;
    clock.t += min;
    await b.tick();
    expect(sb.plain()).toMatchObject({ accessToken: 'ACCESS-FAKE-2', refreshToken: 'REFRESH-FAKE-2' });
    expect(b.signInState()).toBe('connected');
    expect(f.tokenCalls()).toHaveLength(2);
    expect(used).toEqual([]); // nothing read while renewing
    // At 8:30 the first read uses the renewed token — and Supabase already held it.
    clock.t = Date.parse('2026-10-21T12:30:00Z');
    expect((await b.positions(UNITS)).state).toBe('no_trucks');
    expect(used).toEqual([['ACCESS-FAKE-2', 'ACCESS-FAKE-2']]);
  });

  it('one swap at a time: a keep-alive and a read that both want a renewal share one refresh', async () => {
    const sb = fakeSupabase();
    let release!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    const f = fakeBouncie({ grants: [grant(1), async () => { await hold; return grant(2)(); }] });
    const { b, clock } = await connected({ http: f.http, tokens: sbTokens(sb) });
    clock.t = T0 + 22 * H; // Wednesday 8:00 AM — due
    const tick = b.tick();
    const read = b.accessToken('ACCESS-FAKE-1'); // a read that got a 401 at the same moment
    release();
    await tick;
    expect(await read).toEqual({ ok: true, token: 'ACCESS-FAKE-2' });
    expect(f.tokenCalls()).toHaveLength(2);
    expect(sb.plain()).toMatchObject({ refreshToken: 'REFRESH-FAKE-2' });
  });

  it('a renewal that fails is named in Settings with its time, offers Reconnect, and is tried again no more than once an hour; the log carries states only', async () => {
    const lines: string[] = [];
    const spies = (['log', 'error', 'warn', 'info'] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); }));
    try {
      const sb = fakeSupabase();
      const f = fakeBouncie({ grants: [grant(1), () => answer(503, {}), () => answer(502, {}), grant(4)] });
      const { b, clock } = await connected({ http: f.http, tokens: sbTokens(sb) });
      const first = T0 + 20 * H; // Wednesday 6:00 AM
      clock.t = first;
      await b.tick();
      expect(f.tokenCalls()).toHaveLength(2);
      expect(b.signInState()).toBe('connected'); // Bouncie didn't answer: that is not "expired"
      expect(sb.plain()).toMatchObject({ refreshToken: 'REFRESH-FAKE-1' }); // the good pair is kept
      const s = await b.status();
      expect(s.keepAlive).toEqual({ failedAt: iso(first) });
      expect(bouncieRows(s)[1]).toEqual(['NOT RENEWED', 'watch', 'The daily keep-alive: Arbo couldn’t renew the sign-in at ' + fmtWhen(iso(first)) + ' — tap Reconnect if it keeps failing. It tries again within the hour.']);
      // Not again inside the hour, however often the tick runs.
      for (const m of [1, 2, 30, 59]) {
        clock.t = first + m * min;
        await b.tick();
      }
      expect(f.tokenCalls()).toHaveLength(2);
      clock.t = first + H;
      await b.tick();
      expect(f.tokenCalls()).toHaveLength(3);
      expect((await b.status()).keepAlive).toEqual({ failedAt: iso(first + H) });
      clock.t = first + H + 59 * min;
      await b.tick();
      expect(f.tokenCalls()).toHaveLength(3);
      clock.t = first + 2 * H;
      await b.tick();
      expect(f.tokenCalls()).toHaveLength(4);
      expect(sb.plain()).toMatchObject({ accessToken: 'ACCESS-FAKE-4', refreshToken: 'REFRESH-FAKE-4' });
      const ok = await b.status();
      expect(ok.keepAlive).toEqual({ failedAt: null });
      expect(bouncieRows(ok).some(([c]) => c === 'NOT RENEWED')).toBe(false);
      onlyTokenSwaps(f);
    } finally {
      for (const s of spies) s.mockRestore();
    }
    const logs = lines.join('\n');
    expect(logs).toContain('[bouncie] keep-alive: the sign-in was not renewed (unreadable)');
    expect(logs).toContain('[bouncie] keep-alive: the sign-in is renewed');
    for (const secret of ['ACCESS-FAKE', 'REFRESH-FAKE', SECRET, SB_KEY, 'CODE-FAKE']) expect(logs, `a log line carried ${secret}`).not.toContain(secret);
  });

  it('a renewal that a newer one already covers is not a failure: a regular refresh since then clears the line', async () => {
    const sb = fakeSupabase();
    const f = fakeBouncie({ grants: [grant(1), () => answer(503, {}), grant(3, 3600)] });
    const { b, clock } = await connected({ http: f.http, tokens: sbTokens(sb) });
    clock.t = T0 + 20 * H;
    await b.tick();
    expect((await b.status()).keepAlive.failedAt).toBe(iso(T0 + 20 * H));
    // A read renews the sign-in (the access token ran out) before the keep-alive tries again.
    clock.t += 10 * min;
    expect(await b.accessToken()).toEqual({ ok: true, token: 'ACCESS-FAKE-3' });
    expect((await b.status()).keepAlive).toEqual({ failedAt: null });
  });

  it('a sign-in store that failed its one read at boot is read again by the tick, no more than hourly — a Sunday with nobody opening Settings is still renewed (review)', async () => {
    delete process.env.ARBO_LINK_BOUNCIE; // positions cut, as at go-live: the Fleet card never reloads the sign-in then
    const sb = fakeSupabase();
    await connected({ clock: { t: SUNDAY - 21 * H }, http: fakeBouncie({ grants: [grant(1)] }).http, tokens: sbTokens(sb) }); // saved Saturday 3:00 PM by the Arbo before this one
    const gets = () => sb.calls.filter((c) => c.method === 'GET').length;
    sb.state.read = 'throw'; // a redeploy Sunday noon: Supabase fails this Arbo's one read at boot
    const f = fakeBouncie({ grants: [grant(2)] });
    const boot = SUNDAY;
    const { b, clock } = make({ clock: { t: boot }, http: f.http, tokens: sbTokens(sb) });
    await b.ready();
    sb.state.read = 200; // and is fine from then on
    expect(b.signInState()).toBe('store_unreadable');
    const booted = gets();
    // Inside the hour: neither the tick nor the Fleet card's poll reads Supabase again, and nothing is renewed.
    for (const m of [1, 10, 30, 59]) {
      clock.t = boot + m * min;
      await b.tick();
      expect((await b.positions(UNITS)).state).toBe('link_cut');
    }
    expect(gets()).toBe(booted);
    // An hour on, read again — still failing: named, and not read again for another hour.
    sb.state.read = 503;
    clock.t = boot + H;
    await b.tick();
    expect(gets()).toBe(booted + 1);
    expect(b.signInState()).toBe('store_unreadable');
    sb.state.read = 200;
    clock.t = boot + H + 59 * min;
    await b.tick();
    expect(gets()).toBe(booted + 1);
    expect(f.calls).toEqual([]);
    // With the switch cut the tick touches Supabase not at all, however long it has been.
    delete process.env.ARBO_LINK_CREDENTIALS;
    const sbCalls = sb.calls.length;
    for (let h = 2; h <= 5; h++) {
      clock.t = boot + h * H;
      await b.tick();
    }
    expect(sb.calls).toHaveLength(sbCalls);
    expect(f.calls).toEqual([]);
    // Open, Supabase answering: one read, and the 21-hour-old sign-in is renewed — one swap, saved sealed.
    process.env.ARBO_LINK_CREDENTIALS = 'live';
    const renewed = boot + 5 * H + min; // Sunday 5:01 PM
    clock.t = renewed;
    await b.tick();
    expect(gets()).toBe(booted + 2);
    expect(f.tokenCalls()).toHaveLength(1);
    expect(f.tokenCalls()[0]!.body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'REFRESH-FAKE-1' });
    expect(sb.plain()).toMatchObject({ accessToken: 'ACCESS-FAKE-2', refreshToken: 'REFRESH-FAKE-2', savedAt: iso(renewed) });
    expect(b.signInState()).toBe('connected');
    // Connected: nothing more read from Supabase or asked of Bouncie for the rest of the day.
    for (let h = 1; h <= 6; h++) {
      clock.t = renewed + h * H;
      await b.tick();
    }
    expect(gets()).toBe(booted + 2);
    expect(f.tokenCalls()).toHaveLength(1);
    onlyTokenSwaps(f);
  });

  it('a refused renewal whose look in Supabase failed is not UNREADABLE for good: the tick reads the store again within the hour, and the same refusal is then EXPIRED (review)', async () => {
    const sb = fakeSupabase();
    const refused = () => answer(400, { error: 'invalid_grant' });
    const f = fakeBouncie({ grants: [grant(1), refused, refused] });
    const { b, clock } = await connected({ http: f.http, tokens: sbTokens(sb) });
    const gets = () => sb.calls.filter((c) => c.method === 'GET').length;
    const first = T0 + 20 * H; // Wednesday 6:00 AM
    clock.t = first;
    sb.state.read = 503; // Bouncie refuses, and Supabase can't be read to look for a newer pair
    await b.tick();
    expect(f.tokenCalls()).toHaveLength(2);
    expect(b.signInState()).toBe('store_unreadable'); // a look that failed is never "expired"
    sb.state.read = 200;
    const looked = gets();
    for (const m of [1, 30, 59]) {
      clock.t = first + m * min;
      await b.tick();
    }
    expect(gets()).toBe(looked);
    expect(f.tokenCalls()).toHaveLength(2);
    clock.t = first + H;
    await b.tick();
    // Read again: the same pair, so the renewal is tried once more, Supabase holds nothing newer — EXPIRED, by name.
    expect(f.tokenCalls()).toHaveLength(3);
    expect(b.signInState()).toBe('expired');
    for (let h = 2; h <= 4; h++) {
      clock.t = first + h * H;
      await b.tick();
    }
    expect(f.tokenCalls()).toHaveLength(3); // the refused token is never sent again
    expect(bouncieRows(await b.status())[0]![0]).toBe('EXPIRED');
    onlyTokenSwaps(f);
  });

  it('the Settings card: a failed renewal offers Reconnect on a connected sign-in; without one there is no button', async () => {
    const run = async (status: unknown) => {
      const api = async () => status;
      const feedLine = (_e: unknown, what: string) => el('div', 'feed-state', what);
      const f = pageFn<(v: N, stale: () => boolean) => Promise<void>>('bouncieSettings', { el, api, chip, feedLine, bouncieRows, location: { assign: () => undefined } });
      const v = el('div');
      await f(v, () => false);
      return v;
    };
    const connectedStatus = { signIn: { state: 'connected', stored: true, where: 'supabase', savedAt: '2026-10-20T13:00:00Z', problem: null }, link: { envVar: 'ARBO_LINK_BOUNCIE', open: false }, webhook: { wired: false }, keepAlive: { failedAt: null } };
    expect((await run(connectedStatus)).all().some((n) => n.tag === 'button')).toBe(false);
    const failed = await run({ ...connectedStatus, keepAlive: { failedAt: '2026-10-21T10:00:00Z' } });
    expect(failed.all().find((n) => n.tag === 'button')!.textContent).toBe('Reconnect Bouncie');
    expect(failed.text()).toContain('couldn’t renew the sign-in at');
  });
});

describe('BOUNCIE_API_KEY (Mike, 2026-10-20: the portal\'s per-user Authorization Code) — not needed, held as a yes/no only', () => {
  it('Settings says plainly it is not needed and can be deleted; the server keeps whether it is set, never its value', async () => {
    const status = { signIn: { state: 'connected', stored: true, where: 'supabase', savedAt: null, problem: null }, keys: { clientId: true, clientSecret: true, webhookKey: true, apiKey: true }, link: { open: false }, webhook: { wired: false } };
    expect(bouncieRows(status).find(([c]) => c === 'NOT NEEDED')).toEqual(['NOT NEEDED', 'info', 'Not needed — Connect Bouncie gets its own code. You can delete BOUNCIE_API_KEY from Railway.']);
    expect(bouncieRows({ ...status, keys: { ...status.keys, apiKey: false } }).some(([c]) => c === 'NOT NEEDED')).toBe(false);
    // The env view holds a yes/no — the value is never kept, so it can never be sent, shown or logged.
    process.env.BOUNCIE_API_KEY = 'made-up-portal-code-0042';
    vi.resetModules();
    const { env } = await import('../src/env.js');
    expect(env.bouncie.apiKeySet).toBe(true);
    expect(JSON.stringify(env)).not.toContain('made-up-portal-code-0042');
    expect(Object.keys(env.bouncie)).not.toContain('apiKey');
    // Over the wire: Settings' route says "set", never the value.
    const lines: string[] = [];
    const spies = (['log', 'error', 'warn', 'info'] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); }));
    const { base, srv } = await serve({ ...KEYS, ARBO_SECRET_DIR: tmp(), BOUNCIE_API_KEY: 'made-up-portal-code-0042' });
    try {
      const r = await realFetch(base + '/api/bouncie', { headers: { 'x-arbor-key': 'admin-k' } });
      const text = await r.text();
      expect(JSON.parse(text).keys).toMatchObject({ apiKey: true });
      expect(text).not.toContain('made-up-portal-code-0042');
    } finally {
      srv.close();
      for (const s of spies) s.mockRestore();
    }
    expect(lines.join('\n')).not.toContain('made-up-portal-code-0042');
  });
});

describe('a store cut on purpose is grey, never amber (the §11 audit\'s tone note)', () => {
  it('the sign-in store cut: its own state and words, grey on the Fleet line, CUT=info in Settings — and no Supabase call', async () => {
    delete process.env.ARBO_LINK_CREDENTIALS;
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const sb = fakeSupabase();
    const f = fakeBouncie();
    const { b } = make({ http: f.http, tokens: sbTokens(sb) });
    await b.ready();
    const p = await b.positions(UNITS);
    expect(p).toMatchObject({ state: 'sign_in_cut', message: POSITIONS_SAYS.sign_in_cut });
    expect(POSITIONS_SAYS.sign_in_cut).toContain('ARBO_LINK_CREDENTIALS');
    expect(POSITIONS_SAYS.sign_in_cut).toContain('This is not "no trucks".');
    expect(POSITIONS_SAYS.sign_in_cut).not.toBe(POSITIONS_SAYS.sign_in_store);
    expect(new Set(Object.values(POSITIONS_SAYS)).size).toBe(Object.keys(POSITIONS_SAYS).length);
    const t = await b.trips({ truck: 'abcdefabcdef', day: '2026-10-19' });
    expect(t.body).toMatchObject({ state: 'sign_in_cut', message: TRIPS_SAYS.sign_in_cut, trips: [] });
    expect(TRIPS_SAYS.sign_in_cut).toContain('This is not "no trips".');
    expect(sb.calls).toEqual([]);
    expect(f.calls).toEqual([]);
    // The Fleet line: the grey of a gap on purpose — a real "can't open it" stays amber.
    expect(trackWords(answerFor('sign_in_cut'), 'u1')).toEqual(['Tracking off — the saved Bouncie sign-in is cut on purpose (ARBO_LINK_CREDENTIALS)', 'feed-state cut']);
    expect(trackWords(answerFor('sign_in_store'), 'u1')[1]).toBe('feed-state unread');
    // Settings: CUT is info (grey); the positions row waits on it, and nothing on the card is amber for the cut.
    const rows = bouncieRows(await b.status());
    expect(rows[0]!.slice(0, 2)).toEqual(['CUT', 'info']);
    expect(rows[1]).toEqual(['OPEN', 'good', 'Positions on — waiting on the Bouncie sign-in above.']);
  });
});

describe('Mike\'s three answers are filed in his words, and the docs say what is live', () => {
  // Markdown wraps lines anywhere: the checks read each doc with its whitespace folded to single spaces.
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\s+/g, ' ');

  it('R31\'s amendment carries the answers; BOUNCIE.md moves them out of "Waiting on Mike"', () => {
    const rulings = read('../docs/OWNER_RULINGS.md');
    const r31 = rulings.slice(rulings.indexOf('## R31 — '));
    expect(r31).toContain('**Answered by Mike, 2026-10-20 (after the §11 audit).**');
    expect(r31).toContain('*"Yes, allow the sign-in row"*');
    expect(r31).toContain('*"Keep the sign-in alive"*');
    expect(r31).toContain('Users & Devices → Authorize My Devices');
    const doc = read('../docs/BOUNCIE.md');
    expect(doc).toContain('Users & Devices → Authorize My Devices');
    expect(doc).toContain('You can delete `BOUNCIE_API_KEY` from Railway');
    expect(doc).toContain('20 hours');
    expect(doc).toContain('applied live 2026-10-20');
    expect(doc).not.toContain('It is **not applied yet**');
  });

  it('the count and the claims are exact (review): three of four answered, the renewal named as the one call after hours, a failed store read retried by the tick', () => {
    const rulings = read('../docs/OWNER_RULINGS.md');
    const r31 = rulings.slice(rulings.indexOf('## R31 — '));
    expect(r31).not.toContain('(four of these are answered below)');
    expect(r31).toContain('(three of these four are answered below; trips after 8pm is still open)');
    const doc = read('../docs/BOUNCIE.md');
    expect(doc).toContain('Outside them Arbo reads nothing from Bouncie — the once-a-day sign-in renewal (*Good to know*) is the only call then, and it reads no truck —');
    expect(doc).toContain('read again within the hour');
    const decisions = read('../DECISIONS.md');
    const d95 = decisions.slice(decisions.indexOf('| D95 |'));
    expect(d95).not.toContain('once a request reloads it');
    expect(d95).toContain('reads it again itself, at most hourly');
  });

  it('0021 says applied live; DATA_LINKS names the credential door; GO_LIVE has the Bouncie steps; CLAUDE.md §3 names the one exception', () => {
    const sql = read('../supabase/migrations/0021_integration_credential.sql');
    expect(sql).toContain('APPLIED LIVE 2026-10-20');
    const links = read('../docs/DATA_LINKS.md');
    const door = links.slice(links.indexOf('## The credential door'));
    for (const s of ['`integration_credential`', 'Sealed rows', '`ARBO_LINK_CREDENTIALS`', 'exactly `live`', '`src/db/credentialStore.ts`', 'outside the business links by Mike\'s 2026-10-20 ruling']) expect(door, s).toContain(s);
    const golive = readFileSync(new URL('../docs/GO_LIVE.md', import.meta.url), 'utf8');
    const line = golive.split('\n').find((l) => l.includes('**Bouncie truck tracking**'))!;
    for (const s of ['0021', '`ARBO_LINK_CREDENTIALS=live`', '/api/bouncie/callback', '`arbo-app`']) expect(line, s).toContain(s);
    const claude = read('../CLAUDE.md');
    const s3 = claude.slice(claude.indexOf('## §3 — The data links are CUT'), claude.indexOf('## Guardrails that live in code'));
    expect(s3).toContain('`src/db/credentialStore.ts`');
    expect(s3).toContain('`ARBO_LINK_CREDENTIALS`');
    expect(s3).toContain('Mike 2026-10-20');
  });
});
