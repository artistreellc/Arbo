// The door's parts, one at a time (audit 2026-10-20, Lane A). The same door
// over the wire is test/accessDoor.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { secretEqual } from '../src/lib/secretEqual.js';
import { KeyAttemptGuard, checkApiDoor, keyFromHeader, clientAddress, accessBootLine } from '../src/server/accessDoor.js';

describe('L2 — secretEqual compares in constant time and never says yes to a non-key', () => {
  it('same, different (same length), different length, empty, missing and non-string', () => {
    expect(secretEqual('admin-key-1', 'admin-key-1')).toBe(true);
    expect(secretEqual('admin-key-2', 'admin-key-1')).toBe(false);
    expect(secretEqual('admin', 'admin-key-1')).toBe(false);
    expect(secretEqual('admin-key-1-and-more', 'admin-key-1')).toBe(false);
    expect(secretEqual('', 'admin-key-1')).toBe(false);
    expect(secretEqual('', '')).toBe(false); // no key configured never matches an empty header
    expect(secretEqual('admin-key-1', undefined)).toBe(false);
    expect(secretEqual('admin-key-1', null)).toBe(false);
    expect(secretEqual(undefined, 'admin-key-1')).toBe(false);
    expect(secretEqual(['admin-key-1'], 'admin-key-1')).toBe(false); // a repeated header arrives as an array
    expect(secretEqual(12345, '12345')).toBe(false);
    expect(secretEqual('café-ключ', 'café-ключ')).toBe(true);
  });

  it('the owner and crew keys and the ElevenLabs bearer all go through it — no plain === on a secret', () => {
    const door = readFileSync(new URL('../src/server/accessDoor.ts', import.meta.url), 'utf8');
    expect(door).toContain('secretEqual(i.given, i.appKey)');
    expect(door).toContain('secretEqual(i.given, i.crewKey)');
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(server).not.toMatch(/given === env\.(appAccessKey|crewAccessKey)/);
    expect(server).not.toContain('const apiAuthorized');
    const bridge = readFileSync(new URL('../src/voice/elevenlabsBridge.ts', import.meta.url), 'utf8');
    expect(bridge).toContain('if (!secretEqual(authorization, `Bearer ${deps.bridgeSecret}`)) {');
    expect(bridge).not.toContain('authorization !== `Bearer');
  });
});

describe('L1 — the key comes from the x-arbor-key header only', () => {
  it('a string header is the key; empty, missing or repeated is none', () => {
    expect(keyFromHeader({ 'x-arbor-key': 'k' })).toBe('k');
    expect(keyFromHeader({ 'x-arbor-key': '' })).toBeUndefined();
    expect(keyFromHeader({})).toBeUndefined();
    expect(keyFromHeader({ 'x-arbor-key': ['k', 'k'] as unknown as string })).toBeUndefined();
  });

  it('server.ts never reads ?key= for the /api door (the two webhook doors keep their own ?key= secrets)', () => {
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(server).not.toContain("req.headers['x-arbor-key'] ?? url.searchParams.get('key')");
    // The only ?key= reads left are the Railway and Twilio webhook routes, each with its own key.
    const reads = [...server.matchAll(/url\.searchParams\.get\('key'\)/g)].length;
    expect(reads).toBe(2);
    expect(server).toContain("webhooks.handleRailway(url.searchParams.get('key'), raw)");
    expect(server).toContain("webhooks.handleTwilioSms(url.searchParams.get('key'), raw)");
  });
});

describe('which connection a request came from', () => {
  const req = (h: Record<string, string | string[]>, remote?: string) => ({ headers: h, socket: { remoteAddress: remote } });
  it('Railway’s X-Real-IP, trimmed and capped; else the socket off Railway; on Railway without it, not counted', () => {
    expect(clientAddress(req({ 'x-real-ip': ' 203.0.113.7 ' }, '10.0.0.1'), true)).toBe('203.0.113.7');
    expect(clientAddress(req({ 'x-real-ip': 'x'.repeat(200) }), true)).toHaveLength(64);
    expect(clientAddress(req({}, '127.0.0.1'), false)).toBe('127.0.0.1');
    expect(clientAddress(req({}, '10.0.0.1'), true)).toBeNull(); // never pool every caller into the proxy's address
    expect(clientAddress(req({ 'x-real-ip': ['a', 'b'] }, '127.0.0.1'), false)).toBe('127.0.0.1');
    // The leftmost X-Forwarded-For is the client's to write — it is never read.
    expect(clientAddress(req({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }, '127.0.0.1'), false)).toBe('127.0.0.1');
  });

  it('two X-Real-IP headers (Node joins them "a, b"): the LAST one counts — the first is the client’s to write', () => {
    // Verify-pass finding 4: if Railway's edge adds its own X-Real-IP after one
    // the client sent, the whole joined value changed with every guess, so a
    // guesser could be a new connection each time. The edge's is the last one.
    expect(clientAddress(req({ 'x-real-ip': '10.9.8.7, 203.0.113.7' }), true)).toBe('203.0.113.7');
    expect(clientAddress(req({ 'x-real-ip': '10.9.8.1,203.0.113.7' }), true)).toBe('203.0.113.7');
    // Nothing after the last comma: not a usable address — on Railway, not counted (never pooled).
    expect(clientAddress(req({ 'x-real-ip': '203.0.113.7, ' }, '10.0.0.1'), true)).toBeNull();
    expect(clientAddress(req({ 'x-real-ip': '203.0.113.7,' }, '127.0.0.1'), false)).toBe('127.0.0.1');
  });
});

describe('M2 — the wrong-key limiter', () => {
  const clock = () => {
    const c = { t: Date.parse('2026-10-20T12:00:00Z'), lines: [] as string[] };
    return c;
  };
  const make = (c: { t: number; lines: string[] }, o: Record<string, number> = {}) =>
    new KeyAttemptGuard({ now: () => c.t, log: (l) => c.lines.push(l), ...o });

  it('9 different wrong keys pass as plain wrong; the 10th throttles with a one-minute Retry-After', () => {
    const c = clock();
    const g = make(c);
    for (let i = 1; i <= 9; i++) expect(g.wrong('owner', 'a', `k${i}`)).toEqual({ throttled: false });
    expect(g.wrong('owner', 'a', 'k10')).toEqual({ throttled: true, retryAfterSec: 60 });
    expect(g.admit('owner', 'a')).toEqual({ ok: false, retryAfterSec: 60 });
    c.t += 30_000;
    expect(g.admit('owner', 'a')).toEqual({ ok: false, retryAfterSec: 30 });
  });

  it('the same stale key, sent fifty times, counts once', () => {
    const c = clock();
    const g = make(c);
    for (let i = 0; i < 50; i++) expect(g.wrong('owner', 'a', 'old-key')).toEqual({ throttled: false });
    expect(g.counts().wrongKeysSinceBoot).toBe(50);
    expect(g.counts().throttledNow).toBe(0);
  });

  it('the count runs for ten minutes, then starts fresh', () => {
    const c = clock();
    const g = make(c);
    for (let i = 1; i <= 9; i++) g.wrong('owner', 'a', `k${i}`);
    c.t += 10 * 60_000;
    for (let i = 10; i <= 18; i++) expect(g.wrong('owner', 'a', `k${i}`)).toEqual({ throttled: false });
  });

  it('throttled: one check a minute; a wrong check restarts the 15 minutes; the right key on a check forgives', () => {
    const c = clock();
    const g = make(c);
    for (let i = 1; i <= 10; i++) g.wrong('owner', 'a', `k${i}`);
    c.t += 60_000;
    expect(g.admit('owner', 'a')).toEqual({ ok: true }); // the minute's check
    expect(g.admit('owner', 'a')).toEqual({ ok: false, retryAfterSec: 60 }); // only one
    expect(g.wrong('owner', 'a', 'k11')).toEqual({ throttled: true, retryAfterSec: 60 });
    // 15 minutes after the LOCK the wrong check has pushed it on: still throttled.
    c.t += 14 * 60_000;
    expect(g.counts().throttledNow).toBe(1);
    expect(g.admit('owner', 'a')).toEqual({ ok: true }); // a check
    g.right('owner', 'a');
    expect(g.admit('owner', 'a')).toEqual({ ok: true });
    expect(g.counts().throttledNow).toBe(0);
    expect(g.wrong('owner', 'a', 'k1')).toEqual({ throttled: false }); // over ten minutes since the first: a fresh count
  });

  it('the right key lifts a throttle but never wipes the count: a guesser on Mike’s own connection is still slowed', () => {
    // Verify-pass finding 1: right() used to forget the connection outright, and
    // the app sends the right key every minute — so 9 guesses, Mike's ping, 9
    // more… was never slowed (180 of 180 guesses checked in the probe).
    const c = clock();
    const g = make(c);
    let checked = 0;
    for (let round = 0; round < 20; round++) {
      for (let i = 1; i <= 9; i++) {
        if (!g.admit('owner', 'a').ok) continue;
        checked++;
        g.wrong('owner', 'a', `r${round}-k${i}`);
      }
      if (g.admit('owner', 'a').ok) g.right('owner', 'a'); // Mike's app, once a minute
      c.t += 60_000;
    }
    // The first 9, then about one a minute — never 9 a minute.
    expect(checked).toBeLessThanOrEqual(9 + 20);
  });

  it('let back in by the right key: a stale key already counted does not throttle again; a NEW wrong key does', () => {
    const c = clock();
    const g = make(c);
    for (let i = 1; i <= 10; i++) g.wrong('owner', 'a', `k${i}`);
    c.t += 60_000;
    expect(g.admit('owner', 'a')).toEqual({ ok: true }); // the minute's check
    g.right('owner', 'a');
    expect(g.counts().throttledNow).toBe(0);
    expect(g.admit('owner', 'a')).toEqual({ ok: true }); // Mike's app works at once
    expect(g.admit('owner', 'a')).toEqual({ ok: true });
    // A tab still holding one of the typos: already counted, so it never re-throttles Mike.
    expect(g.wrong('owner', 'a', 'k3')).toEqual({ throttled: false });
    expect(g.admit('owner', 'a')).toEqual({ ok: true });
    // A different wrong key inside the same ten minutes: the count still stands — throttled again.
    expect(g.wrong('owner', 'a', 'k11')).toEqual({ throttled: true, retryAfterSec: 60 });
    expect(g.admit('owner', 'a').ok).toBe(false);
  });

  it('a few typos, then the right key: the typos stay counted for the window (they do not reset to zero)', () => {
    const c = clock();
    const g = make(c);
    for (let i = 1; i <= 9; i++) g.wrong('owner', 'a', `k${i}`);
    g.right('owner', 'a');
    expect(g.wrong('owner', 'a', 'k10')).toEqual({ throttled: true, retryAfterSec: 60 });
  });

  it('left alone, a throttle ends after 15 minutes', () => {
    const c = clock();
    const g = make(c);
    for (let i = 1; i <= 10; i++) g.wrong('owner', 'a', `k${i}`);
    c.t += 15 * 60_000;
    expect(g.admit('owner', 'a')).toEqual({ ok: true });
    expect(g.admit('owner', 'a')).toEqual({ ok: true });
    expect(g.wrong('owner', 'a', 'k1')).toEqual({ throttled: false });
  });

  it('per connection and per door — never global; an uncountable request is never throttled', () => {
    const c = clock();
    const g = make(c);
    for (let i = 1; i <= 10; i++) g.wrong('owner', 'a', `k${i}`);
    expect(g.admit('owner', 'b')).toEqual({ ok: true });
    expect(g.admit('crew', 'a')).toEqual({ ok: true });
    for (let i = 1; i <= 30; i++) expect(g.wrong('owner', null, `k${i}`)).toEqual({ throttled: false });
    expect(g.admit('owner', null)).toEqual({ ok: true });
  });

  it('memory is capped; the connection still guessing is the one remembered', () => {
    const c = clock();
    const g = make(c, { maxTracked: 3 });
    for (let i = 1; i <= 10; i++) g.wrong('owner', 'guesser', `k${i}`);
    for (const a of ['b', 'c', 'd', 'e']) {
      g.wrong('owner', a, 'x');
      expect(g.admit('owner', 'guesser').ok).toBe(false); // touching it keeps it newest
    }
    expect(g.tracked).toBe(3);
  });

  it('logs say counts, never an address or a key, and at most one line a minute', () => {
    const c = clock();
    const g = make(c);
    for (const a of ['203.0.113.1', '203.0.113.2']) for (let i = 1; i <= 10; i++) g.wrong('owner', a, `secret-guess-${i}`);
    expect(c.lines).toHaveLength(1);
    c.t += 60_000;
    for (let i = 1; i <= 10; i++) g.wrong('crew', '203.0.113.3', `secret-guess-${i}`);
    expect(c.lines).toHaveLength(2);
    expect(c.lines[1]).toContain('(+1 more since the last line)');
    expect(c.lines[1]).toContain('crew door');
    for (const l of c.lines) {
      expect(l).not.toContain('203.0.113');
      expect(l).not.toContain('secret-guess');
    }
    const counts = JSON.stringify(g.counts());
    expect(counts).not.toContain('203.0.113');
    expect(g.counts()).toEqual({ wrongKeysSinceBoot: 30, throttlesSinceBoot: 3, throttledNow: 3, refusedWhileThrottledSinceBoot: 0 });
  });

  it('across all connections: one loud line when guessing is spread thin — and nobody is locked out by it', () => {
    const c = clock();
    const g = make(c, { alarmAt: 5 });
    for (let i = 1; i <= 7; i++) g.wrong('owner', `203.0.113.${i}`, 'k');
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0]).toContain('5 wrong keys across all connections');
    expect(c.lines[0]).toContain('Nobody is locked out by this');
    expect(g.counts().throttledNow).toBe(0);
  });
});

describe('the door decision', () => {
  const door = (over: Partial<Parameters<typeof checkApiDoor>[0]> = {}) => {
    const guard = over.guard ?? new KeyAttemptGuard({ log: () => {} });
    return {
      guard,
      out: checkApiDoor({ pathname: '/api/leads', given: undefined, keyInUrl: false, addr: '203.0.113.7', appKey: 'admin-k', crewKey: 'crew-k', guard, ...over }),
    };
  };

  it('M1: no app key on the server refuses everything by name, whatever is sent, on both doors', () => {
    for (const given of [undefined, 'admin-k', 'crew-k', 'x']) {
      for (const pathname of ['/api/leads', '/api/crew/briefing']) {
        const { out } = door({ appKey: undefined, given, pathname });
        expect(out).toMatchObject({ ok: false, status: 401, body: { error: 'no_app_key' } });
      }
    }
  });

  it('keyless: the words fit the door, and a ?key= is named but never compared', () => {
    expect(door().out).toMatchObject({ status: 401, body: { error: 'unauthorized', message: expect.stringContaining('Enter it on the app’s key screen') } });
    expect(door({ keyInUrl: true }).out).toMatchObject({ status: 401, body: { message: expect.stringContaining('A key in the web address is not accepted') } });
    expect(door({ pathname: '/api/crew/briefing' }).out).toMatchObject({ body: { error: 'unauthorized', message: expect.stringContaining('crew door key from the office') } });
    expect(door({ pathname: '/api/crew/briefing', crewKey: undefined }).out).toMatchObject({ body: { error: 'crew_key_not_set' } });
  });

  it('the right keys open their doors and forgive the connection; the crew key at Mike’s door is refused but is not a guess', () => {
    // Deliberately updated (CREW_PLAN C4, D109): an open door now says which key
    // matched — only the owner key is exempt from the crew sign-off lock (M11).
    expect(door({ given: 'admin-k' }).out).toEqual({ ok: true, matched: 'owner' });
    expect(door({ given: 'admin-k', pathname: '/api/crew/workorders' }).out).toEqual({ ok: true, matched: 'owner' });
    expect(door({ given: 'crew-k', pathname: '/api/crew/workorders' }).out).toEqual({ ok: true, matched: 'crew' });
    const atOwner = door({ given: 'crew-k' });
    expect(atOwner.out).toMatchObject({ status: 401, body: { message: 'The crew door key opens the crew door only. This needs the app key.' } });
    expect(atOwner.guard.counts().wrongKeysSinceBoot).toBe(0);
  });

  it('a wrong key is counted; the tenth different one answers 429 with the wait and what to do', () => {
    const guard = new KeyAttemptGuard({ log: () => {} });
    for (let i = 1; i <= 9; i++) expect(door({ guard, given: `g${i}` }).out).toMatchObject({ status: 401, body: { error: 'unauthorized' } });
    const tenth = door({ guard, given: 'g10' }).out;
    expect(tenth).toMatchObject({ ok: false, status: 429, retryAfterSec: 60, body: { error: 'too_many_attempts', retryAfterSec: 60 } });
    expect((tenth as { body: { message: string } }).body.message).toBe('Too many different wrong keys from this connection. Arbo now checks one key a minute from it: wait 60 seconds, then enter the right key — or switch networks (Wi-Fi or cellular).');
    // Keyless from the throttled connection is still the plain 401 — nothing to check.
    expect(door({ guard }).out).toMatchObject({ status: 401, body: { error: 'unauthorized' } });
    // Another connection opens at once with the right key.
    expect(door({ guard, given: 'admin-k', addr: '198.51.100.2' }).out).toEqual({ ok: true, matched: 'owner' });
  });
});

describe('the boot line names each key’s state, never a value', () => {
  it('set and not set', () => {
    expect(accessBootLine(false, false)).toEqual({ ok: false, line: expect.stringContaining('APP_ACCESS_KEY is NOT SET — every /api route answers 401 no_app_key') });
    const set = accessBootLine(true, false);
    expect(set.ok).toBe(true);
    expect(set.line).toContain('x-arbor-key header only, never ?key=');
    expect(set.line).toContain('crew door key NOT set');
    expect(accessBootLine(true, true).line).toContain('crew door key set;');
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(server).toContain('const door = accessBootLine(Boolean(env.appAccessKey), Boolean(env.crewAccessKey));');
  });
});
