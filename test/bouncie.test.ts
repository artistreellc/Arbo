// R31 draft — Bouncie truck tracking (Mike, 2026-10-20: "why dont you build
// and then i add later"). Built dormant: these tests run the whole path with
// a fake Bouncie — the sign-in, the rotating refresh token, the webhook, the
// positions states, the owner-only routes, and the two page pieces Mike sees.
// Every value below is made up: no real token, VIN, device or place.
import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  Bouncie,
  BouncieTokenStore,
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
  BOUNCIE_WEBHOOK_URL,
  type BouncieHttp,
} from '../src/integrations/bouncie.js';
import { inspectMessage } from '../src/binder/policyEngine.js';
import { loadAllConfig } from '../src/config/loadConfig.js';
import { loadAppHtml, loadCrewHtml } from '../src/server/appPage.js';

// ---------- made-up values ----------
const CLIENT = 'arbo';
const SECRET = 'fake-client-secret-0042';
const HOOK_KEY = 'fake-hook-key-made-up-77';
const IMEI = '864000000009876';
const VIN = '1FAKEVIN000000001';
const LAT = 36.85291;
const LON = -75.97802;
const T0 = Date.parse('2026-10-20T14:00:00Z');
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
function fakeBouncie(over: { grants?: Array<() => ReturnType<typeof answer> | Promise<ReturnType<typeof answer>>>; vehicles?: (token: string) => ReturnType<typeof answer> } = {}) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: Record<string, string> | null }> = [];
  let g = 0;
  const http: BouncieHttp = async (url: string, init: Init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    if (url === TOKEN_URL) {
      const next = over.grants?.[g++];
      return next ? next() : answer(400, { error: 'invalid_grant' });
    }
    return over.vehicles ? over.vehicles(init.headers.authorization ?? '') : answer(200, []);
  };
  return { http, calls, tokenCalls: () => calls.filter((c) => c.url === TOKEN_URL), reads: () => calls.filter((c) => c.url.startsWith(API_BASE)) };
}
const grant = (n: number, expiresIn = 3600) => () => answer(200, { access_token: `ACCESS-FAKE-${n}`, refresh_token: `REFRESH-FAKE-${n}`, expires_in: expiresIn, token_type: 'Bearer' });

function make(over: Partial<ConstructorParameters<typeof Bouncie>[0]> & { clock?: { t: number } } = {}) {
  const clock = over.clock ?? { t: T0 };
  const dir = over.dir ?? tmp();
  const b = new Bouncie({ clientId: CLIENT, clientSecret: SECRET, webhookKey: HOOK_KEY, dir, now: () => clock.t, ...over });
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
      client_id: 'arbo',
      response_type: 'code',
      redirect_uri: 'https://arbor-server-production.up.railway.app/bouncie/callback',
      state: 'S'.repeat(32),
      code_challenge: createHash('sha256').update('v'.repeat(64)).digest('base64url'),
      code_challenge_method: 'S256',
    });
    expect(BOUNCIE_REDIRECT).toBe('https://arbor-server-production.up.railway.app/bouncie/callback');
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
    expect(await refused.b.finishConnect({ code: 'C', state: begin(refused.b).state })).toMatchObject({ status: 400, title: 'Bouncie refused the sign-in' });
    const down = make({ http: async () => { throw new Error('ENOTFOUND'); } });
    expect(await down.b.finishConnect({ code: 'C', state: begin(down.b).state })).toMatchObject({ status: 502, title: 'Arbo couldn’t reach Bouncie' });
    const noRefresh = make({ http: fakeBouncie({ grants: [() => answer(200, { access_token: 'ACCESS-ONLY', expires_in: 3600 })] }).http });
    expect((await noRefresh.b.finishConnect({ code: 'C', state: begin(noRefresh.b).state })).ok).toBe(false);
    for (const m of [none, refused, down, noRefresh]) {
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

// ---------- the token on the disk ----------
describe('the Bouncie token store', () => {
  it('survives a restart, and its status never carries a token', () => {
    const dir = tmp();
    const s = new BouncieTokenStore(dir);
    expect(s.status()).toEqual({ stored: false, where: null, savedAt: null });
    expect(s.save({ accessToken: 'ACCESS-FAKE-9', refreshToken: 'REFRESH-FAKE-9', expiresAt: T0, savedAt: iso(T0) })).toBe('disk');
    const again = new BouncieTokenStore(dir);
    expect(again.current()).toMatchObject({ accessToken: 'ACCESS-FAKE-9', refreshToken: 'REFRESH-FAKE-9' });
    expect(again.status()).toEqual({ stored: true, where: 'disk', savedAt: iso(T0) });
    expect(JSON.stringify(again.status())).not.toContain('FAKE-9');
  });

  it('with no usable disk it holds the pair in memory and says so', () => {
    const dir = tmp();
    const blocker = join(dir, 'not-a-dir');
    writeFileSync(blocker, 'x');
    const s = new BouncieTokenStore(join(blocker, 'sub'));
    expect(s.save({ accessToken: 'A', refreshToken: 'R', expiresAt: T0, savedAt: iso(T0) })).toBe('memory');
    expect(s.status()).toMatchObject({ stored: true, where: 'memory' });
  });

  it('a damaged file is not a sign-in', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'bouncie-token.json'), '{"accessToken":"A"}');
    expect(new BouncieTokenStore(dir).status().stored).toBe(false);
    writeFileSync(join(dir, 'bouncie-token.json'), 'not json');
    expect(new BouncieTokenStore(dir).current()).toBeNull();
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

  it('the source has no write path: one POST (the token swap), no webhook setup, geo-zones, locations or schedules', () => {
    const src = readFileSync(new URL('../src/integrations/bouncie.ts', import.meta.url), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/'(PUT|PATCH|DELETE)'/);
    expect(code).not.toMatch(/geozones|\/locations|\/schedules|v1\/webhooks|\/user\b/);
    // One door out (call → http), one POST through it (the token swap), one GET (the vehicles read).
    expect(code.match(/this\.http\(/g)).toHaveLength(1);
    expect(code.match(/this\.call\('POST'/g)).toEqual(["this.call('POST'"]);
    expect(code).toContain("this.call('POST', TOKEN_URL,");
    expect(code.match(/this\.call\('GET'/g)).toHaveLength(1);
    expect(code).toContain("return method === 'POST' ? url === TOKEN_URL : url.startsWith(`${API_BASE}vehicles?`);");
    // Nothing here touches the database.
    expect(code).not.toMatch(/getDb|supabase|repositories/);
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

  it('with the sign-in keys missing an authentic call is answered 200 and dropped too', async () => {
    process.env.ARBO_LINK_BOUNCIE = 'live';
    const { b } = make({ clientId: null, clientSecret: null });
    expect(await hook(b, tripData([[T0, LAT, LON]]))).toEqual({ status: 200, body: { ok: true } });
    expect((await b.status()).webhook).toMatchObject({ whileCut: 1, received: 0 });
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
  it('the seven sentences are seven different sentences', () => {
    const says = Object.values(POSITIONS_SAYS);
    expect(new Set(says).size).toBe(7);
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
      vehicle({ imei: '864000000001111', vin: 'STALEVIN000000002', nickName: 'Chip truck' }, { lastUpdated: iso(T0 - 30 * 60 * min) }),
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
  it('owner only: the crew key and no key are refused on every Bouncie route; with no APP_ACCESS_KEY they stay locked', async () => {
    const { base, srv } = await serve({ ...KEYS, ARBO_SECRET_DIR: tmp() });
    try {
      for (const [method, path] of [['GET', '/api/bouncie'], ['POST', '/api/bouncie/connect'], ['GET', '/api/fleet/positions']] as const) {
        for (const key of ['crew-k', 'wrong', undefined]) {
          const r = await realFetch(base + path, { method, headers: key ? { 'x-arbor-key': key } : {} });
          expect(r.status, `${method} ${path} with ${key}`).toBe(401);
        }
        expect((await realFetch(base + path, { method, headers: { 'x-arbor-key': 'admin-k' } })).status).toBe(200);
      }
      // No crew twin of any of them.
      expect((await realFetch(base + '/api/crew/fleet/positions', { headers: { 'x-arbor-key': 'crew-k' } })).status).toBe(404);
    } finally { srv.close(); }
    const open = await serve({ ...KEYS, APP_ACCESS_KEY: undefined, CREW_ACCESS_KEY: undefined, ARBO_DATA_LINKS: undefined, ARBO_SECRET_DIR: tmp() });
    try {
      for (const p of ['/api/bouncie', '/api/fleet/positions']) {
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
      // A forged state is refused, and the page repeats neither value.
      const forged = await realFetch(`${base}/bouncie/callback?code=CODE-FAKE-1&state=${'z'.repeat(32)}`);
      expect(forged.status).toBe(400);
      expect(forged.headers.get('cache-control')).toBe('no-store');
      expect(forged.headers.get('referrer-policy')).toBe('no-referrer');
      const forgedPage = await forged.text();
      expect(forgedPage).toContain('That sign-in link is not one Arbo is waiting for');
      expect(forgedPage).not.toContain('CODE-FAKE-1');
      // The real one connects, once.
      const cb = await realFetch(`${base}/bouncie/callback?code=CODE-FAKE-1&state=${state}`);
      expect(cb.status).toBe(200);
      const page = await cb.text();
      expect(page).toContain('Bouncie is connected');
      expect(page).toContain('Back to the app');
      expect(page).not.toContain('CODE-FAKE-1');
      expect(page).not.toContain(state);
      expect(statSync(join(dir, 'bouncie-token.json')).mode & 0o777).toBe(0o600);
      expect((await realFetch(`${base}/bouncie/callback?code=CODE-FAKE-1&state=${state}`)).status).toBe(400);
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
      const today = new Date().toISOString().slice(0, 10);
      for (const path of [`/api/crew/workorders?date=${today}`, '/api/crew/briefing']) {
        const r = await realFetch(base + path, { headers: { 'x-arbor-key': 'crew-k' } });
        const text = (await r.text()).toLowerCase();
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

const truck = (over: Record<string, unknown>) => ({ id: 'x', name: 'Bucket truck', vin4: '0001', device4: '9876', lat: LAT, lon: LON, heading: 0, reportedAt: iso(Date.now() - 12 * min), ageMinutes: 12, motion: 'parked', lastTrip: null, ...over });
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
      trackWords(answerFor('ok', truck({ motion: 'stale', reportedAt: '2026-10-17T21:05:00Z', ageMinutes: 4000 })), 'u1'),
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

  it('a failed read is named in the shared words; no answer yet and a locked route draw nothing rather than guess', () => {
    expect(trackWords({ failed: { code: 500 } }, 'u1')).toEqual(['Tracking: couldn’t read it', 'feed-state unread']);
    expect(trackWords({ failed: { code: 401 } }, 'u1')[0]).toBe('');
    expect(trackWords(null, 'u1')[0]).toBe('');
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
    TRACK = { ...answerFor('ok', truck({ motion: 'driving', ageMinutes: 3 })), unmatched: [truck({ name: null, vin4: null, device4: '4321', motion: 'parked', ageMinutes: 40 })] };
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
    webhook: { wired: true, url: BOUNCIE_WEBHOOK_URL, deliveries: 38, received: 40, lastAt: '2026-10-20T13:58:00Z', whileCut: 0, rejected: 0, refusedNotWired: 0, unknownTypes: 0, badEvents: 0, badJson: 0, oversized: 0, overCap: 0 },
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
    expect(chips(hookRow({ rejected: 2, badJson: 1, unknownTypes: 1 }))).toEqual(['WIRED=good', 'WRONG KEY=stop', 'UNREADABLE=watch']);
    expect(hookRow({ rejected: 2 })[1]![2]).toBe('2 calls to the webhook came with the wrong key since Arbo last restarted — the key in the Bouncie portal must match BOUNCIE_WEBHOOK_KEY exactly.');
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
    expect(v.text()).toContain('Redirect URI to register in the Bouncie portal: https://arbor-server-production.up.railway.app/bouncie/callback');
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
