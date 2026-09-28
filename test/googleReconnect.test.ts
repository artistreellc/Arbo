// Reconnect Google (Mike, 2026-09-28: option 2 — "Arbo does the swap itself").
// Pins: the one-time code is traded on the server; the token lands on the
// storage disk (0600) and is NEVER returned by a route or written to a log;
// a new grant takes effect on the next refresh; no disk is named, not hidden.
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { GoogleTokenStore, googleCreds, consentUrl, codeFrom, exchangeCode, GOOGLE_SCOPES } from '../src/integrations/googleTokenStore.js';
import { createArborRequestHandler } from '../src/server.js';

const FAKE = 'SIM-refresh-token-not-real';

describe('the one-time code', () => {
  it('is read from the whole localhost address or a bare code; junk is refused', () => {
    expect(codeFrom('http://localhost/?iss=https://accounts.google.com&code=4/0ABC-def_ghi&scope=x')).toBe('4/0ABC-def_ghi');
    expect(codeFrom('  4/0ABC-def_ghi_long  ')).toBe('4/0ABC-def_ghi_long');
    expect(codeFrom('http://localhost/')).toBeNull();
    expect(codeFrom('hello there')).toBeNull();
    expect(codeFrom('')).toBeNull();
  });

  it('the consent link asks for read Gmail, calendar holds, read Drive — offline, with consent, back to localhost', () => {
    const u = new URL(consentUrl('CLIENT'));
    expect(u.searchParams.get('scope')!.split(' ')).toEqual(GOOGLE_SCOPES);
    expect(GOOGLE_SCOPES.join(' ')).not.toMatch(/gmail\.send|gmail\.modify|auth\/drive(?!\.readonly)|mail\.google\.com/);
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
  });

  it('is traded on the server; every refusal is named', async () => {
    const ok = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ refresh_token: FAKE, scope: GOOGLE_SCOPES.join(' ') }) }));
    expect(await exchangeCode('C', 'S', 'CODE', ok)).toEqual({ ok: true, refreshToken: FAKE, scopes: GOOGLE_SCOPES });
    expect(ok.mock.calls[0]).toEqual(['https://oauth2.googleapis.com/token', { client_id: 'C', client_secret: 'S', grant_type: 'authorization_code', redirect_uri: 'http://localhost', code: 'CODE' }]);
    expect(await exchangeCode('C', 'S', 'X', async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }))).toMatchObject({ ok: false, reason: 'code_expired_or_used' });
    expect(await exchangeCode('C', 'S', 'X', async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid_client' }) }))).toMatchObject({ ok: false, reason: 'rejected' });
    expect(await exchangeCode('C', 'S', 'X', async () => ({ ok: true, status: 200, json: async () => ({}) }))).toMatchObject({ ok: false, reason: 'no_refresh_token' });
    expect(await exchangeCode('C', 'S', 'X', async () => { throw new Error('down'); })).toMatchObject({ ok: false, reason: 'network' });
  });
});

describe('the token store', () => {
  it('saves to the disk owner-only, survives a restart, and status never carries the token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbo-secret-'));
    const s = new GoogleTokenStore(dir);
    expect(s.status()).toMatchObject({ stored: false, where: null });
    expect(s.save(FAKE, '2026-09-28T12:00:00Z')).toBe('disk');
    const file = join(dir, 'google-refresh-token');
    expect(readFileSync(file, 'utf8')).toBe(FAKE);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const again = new GoogleTokenStore(dir); // a redeploy
    expect(again.current()).toBe(FAKE);
    expect(JSON.stringify(again.status())).not.toContain(FAKE);
    expect(again.status()).toMatchObject({ stored: true, where: 'disk' });
  });

  it('with no usable disk it holds the token in memory and SAYS so', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbo-secret-'));
    const blocker = join(dir, 'not-a-dir');
    writeFileSync(blocker, 'x');
    const s = new GoogleTokenStore(join(blocker, 'sub'));
    expect(s.save(FAKE, '2026-09-28T12:00:00Z')).toBe('memory');
    expect(s.status()).toMatchObject({ stored: true, where: 'memory' });
  });

  it('the stored grant wins over the Railway variable, and a new grant is picked up without a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbo-secret-'));
    const s = new GoogleTokenStore(dir);
    expect(googleCreds(s, { clientId: 'C', clientSecret: 'S' })).toBeNull();
    const creds = googleCreds(s, { clientId: 'C', clientSecret: 'S', refreshToken: 'OLD-VAR' })!;
    expect(creds.refreshToken).toBe('OLD-VAR');
    s.save(FAKE, '2026-09-28T12:00:00Z');
    expect(creds.refreshToken).toBe(FAKE); // same object, read at refresh time
    expect(googleCreds(s, { clientSecret: 'S', refreshToken: 'X' })).toBeNull();
  });
});

describe('the route', () => {
  it('is locked with no app key, and the server never sends or logs the token', async () => {
    const srv = createServer(createArborRequestHandler());
    await new Promise<void>((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const res = await fetch(`${base}/api/google/connect`);
    expect([401]).toContain(res.status);
    srv.close();
    const src = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    const route = src.slice(src.indexOf("if (url.pathname === '/api/google/connect')"), src.indexOf("if (req.method === 'GET' && url.pathname === '/api/quo/study')"));
    expect(route).toContain('googleTokenStore.save(r.refreshToken');
    expect(route.match(/refreshToken/g)).toHaveLength(1); // only ever handed to the store
    expect(route).not.toMatch(/console\.(log|error)\([^)]*(refreshToken|code\b)/);
    const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
    expect(html).toContain('Reconnect Google (Mike, 2026-09-28)');
    expect(html).not.toMatch(/refresh_token|refreshToken/);
  });
});
