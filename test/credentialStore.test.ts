// The credential door (R31 amended — Mike, 2026-10-20: "store the tokens
// server-side in Supabase"). One table, sealed values, one fixed address,
// and walled off from the business data links in both directions.
// Every value here is made up: no real key, token or project.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  CredentialStore,
  CREDENTIAL_TABLE,
  CREDENTIAL_KEY_VERSION,
  CREDENTIAL_LINK_ENV,
  credentialLinkOpen,
  sealCredential,
  openCredential,
  type CredentialHttp,
} from '../src/db/credentialStore.js';
import { DATA_LINKS, linkForTable } from '../src/db/links.js';

const URL_ = 'https://fakeproject0042.supabase.co';
const SB_SECRET_KEY = 'sb_secret_made_up_for_tests_0042';
const SECRET = 'fake-client-secret-0042';
const PLAIN = JSON.stringify({ accessToken: 'ACCESS-FAKE-1', refreshToken: 'REFRESH-FAKE-1', expiresAt: 1, savedAt: 'x' });

const answer = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function fake(over: { read?: () => ReturnType<typeof answer>; write?: () => ReturnType<typeof answer>; throws?: boolean } = {}) {
  let row: Record<string, unknown> | null = null;
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string | undefined; redirect: unknown; signal: unknown }> = [];
  const http: CredentialHttp = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body, redirect: init.redirect, signal: init.signal });
    if (over.throws) throw new Error('ECONNRESET');
    if (init.method === 'GET') return over.read ? over.read() : answer(200, row ? [row] : []);
    if (over.write) return over.write();
    row = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
    return answer(201, null);
  };
  return { http, calls, row: () => row };
}
const store = (f: ReturnType<typeof fake>, o: Partial<ConstructorParameters<typeof CredentialStore>[0]> = {}) =>
  new CredentialStore({ url: URL_, serviceKey: SB_SECRET_KEY, provider: 'bouncie', secret: SECRET, http: f.http, now: () => Date.parse('2026-10-20T14:00:00Z'), ...o });

// The door's own switch is open for the tests below; cut, it is tested on its own (§3 holds until Mike rules).
const savedLink = process.env.ARBO_LINK_CREDENTIALS;
beforeEach(() => {
  process.env.ARBO_LINK_CREDENTIALS = 'live';
});
afterEach(() => {
  if (savedLink === undefined) delete process.env.ARBO_LINK_CREDENTIALS;
  else process.env.ARBO_LINK_CREDENTIALS = savedLink;
});

describe('the door has its own switch — cut unless ARBO_LINK_CREDENTIALS is exactly "live" (§3 vs Mike\'s spec: his call)', () => {
  it('cut: read and write refuse by name, before "not configured", and nothing leaves the process', async () => {
    expect(CREDENTIAL_LINK_ENV).toBe('ARBO_LINK_CREDENTIALS');
    for (const v of [undefined, '', 'off', 'true', 'LIVE', 'live ', ' live']) {
      if (v === undefined) delete process.env.ARBO_LINK_CREDENTIALS;
      else process.env.ARBO_LINK_CREDENTIALS = v;
      expect(credentialLinkOpen(), String(v)).toBe(false);
      const f = fake();
      expect(await store(f).read()).toEqual({ ok: false, problem: 'cut' });
      expect(await store(f).write(PLAIN)).toEqual({ ok: false, problem: 'cut' });
      expect(await store(f, { url: undefined }).read()).toEqual({ ok: false, problem: 'cut' });
      expect(f.calls).toEqual([]);
    }
    // Read at call time: opened, the same store reaches the table.
    const f = fake();
    const s = store(f);
    process.env.ARBO_LINK_CREDENTIALS = 'live';
    expect(credentialLinkOpen()).toBe(true);
    expect(await s.read()).toEqual({ ok: true, plain: null });
    expect(f.calls).toHaveLength(1);
  });
});

describe('sealing: AES-256-GCM under a key derived from the client secret', () => {
  it('round-trips, with a fresh IV every time, and the sealed form carries nothing readable', () => {
    const a = sealCredential(PLAIN, SECRET, 'bouncie');
    const b = sealCredential(PLAIN, SECRET, 'bouncie');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(Buffer.from(a.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(a.tag, 'base64')).toHaveLength(16);
    expect(a.key_version).toBe(CREDENTIAL_KEY_VERSION);
    expect(JSON.stringify(a)).not.toMatch(/ACCESS-FAKE|REFRESH-FAKE|fake-client-secret/);
    expect(Buffer.from(a.ciphertext, 'base64').toString('utf8')).not.toContain('ACCESS-FAKE');
    expect(openCredential(a, SECRET, 'bouncie')).toBe(PLAIN);
  });

  it('a wrong secret, a tampered byte, a moved row or an unknown key version does not open — it never throws', () => {
    const a = sealCredential(PLAIN, SECRET, 'bouncie');
    expect(openCredential(a, 'another-secret', 'bouncie')).toBeNull();
    const ct = Buffer.from(a.ciphertext, 'base64');
    ct[0] = ct[0]! ^ 1;
    expect(openCredential({ ...a, ciphertext: ct.toString('base64') }, SECRET, 'bouncie')).toBeNull();
    expect(openCredential({ ...a, tag: Buffer.alloc(16).toString('base64') }, SECRET, 'bouncie')).toBeNull();
    expect(openCredential({ ...a, tag: 'short' }, SECRET, 'bouncie')).toBeNull();
    expect(openCredential({ ...a, key_version: 2 }, SECRET, 'bouncie')).toBeNull();
    expect(openCredential({ ...a, iv: 'not base64 at all' }, SECRET, 'bouncie')).toBeNull();
  });
});

describe('the door: one table, two fixed addresses, every failure named', () => {
  it('writes one sealed row (insert or replace) and reads it back; the row on the wire holds no token', async () => {
    const f = fake();
    const s = store(f);
    expect(s.configured()).toBe(true);
    expect(await s.read()).toEqual({ ok: true, plain: null });
    expect(await s.write(PLAIN)).toEqual({ ok: true });
    expect(await s.read()).toEqual({ ok: true, plain: PLAIN });
    const [read, write] = f.calls;
    expect(read!.method).toBe('GET');
    expect(read!.url).toBe(`${URL_}/rest/v1/integration_credential?provider=eq.bouncie&select=ciphertext,iv,tag,key_version`);
    expect(write!.method).toBe('POST');
    expect(write!.url).toBe(`${URL_}/rest/v1/integration_credential?on_conflict=provider`);
    expect(write!.headers.prefer).toBe('resolution=merge-duplicates,return=minimal');
    expect(JSON.parse(write!.body!)).toMatchObject({ provider: 'bouncie', key_version: 1, updated_at: '2026-10-20T14:00:00.000Z' });
    expect(write!.body).not.toMatch(/ACCESS-FAKE|REFRESH-FAKE|fake-client-secret/);
    for (const c of f.calls) {
      expect(c.redirect).toBe('error'); // a 3xx never carries the service key elsewhere
      expect(c.signal).toBeTruthy(); // every call has a deadline
      expect(c.headers.apikey).toBe(SB_SECRET_KEY);
      expect(c.headers.authorization).toBeUndefined(); // an sb_secret_ key is never sent as a Bearer
    }
  });

  it('a legacy JWT service key also goes as a Bearer, like supabase-js sends it', async () => {
    const f = fake();
    const jwtish = 'eyJmade.up.key';
    await store(f, { serviceKey: jwtish }).read();
    expect(f.calls[0]!.headers).toEqual({ apikey: jwtish, authorization: `Bearer ${jwtish}`, accept: 'application/json' });
  });

  it('names why: unconfigured, table missing (404), key refused (401/403), mismatch (400 or a bad row), unreachable, locked', async () => {
    expect(await store(fake(), { url: undefined }).read()).toEqual({ ok: false, problem: 'unconfigured' });
    expect(await store(fake(), { serviceKey: null }).write(PLAIN)).toEqual({ ok: false, problem: 'unconfigured' });
    expect(await store(fake(), { secret: undefined }).read()).toEqual({ ok: false, problem: 'unconfigured' });
    expect(await store(fake({ read: () => answer(404, { code: 'PGRST205' }) })).read()).toEqual({ ok: false, problem: 'missing_table' });
    expect(await store(fake({ write: () => answer(404, {}) })).write(PLAIN)).toEqual({ ok: false, problem: 'missing_table' });
    expect(await store(fake({ read: () => answer(401, {}) })).read()).toEqual({ ok: false, problem: 'refused' });
    expect(await store(fake({ write: () => answer(403, {}) })).write(PLAIN)).toEqual({ ok: false, problem: 'refused' });
    expect(await store(fake({ write: () => answer(400, {}) })).write(PLAIN)).toEqual({ ok: false, problem: 'mismatch' });
    expect(await store(fake({ read: () => answer(200, { not: 'rows' }) })).read()).toEqual({ ok: false, problem: 'mismatch' });
    expect(await store(fake({ read: () => answer(200, [{ ciphertext: 1 }]) })).read()).toEqual({ ok: false, problem: 'mismatch' });
    expect(await store(fake({ read: () => answer(503, {}) })).read()).toEqual({ ok: false, problem: 'unreachable' });
    expect(await store(fake({ throws: true })).read()).toEqual({ ok: false, problem: 'unreachable' });
    expect(await store(fake({ throws: true })).write(PLAIN)).toEqual({ ok: false, problem: 'unreachable' });
    // A row sealed under another secret is there but does not open: locked, never "nothing saved".
    const f = fake();
    await store(f).write(PLAIN);
    expect(await store(fake({ read: () => answer(200, [f.row()]) }), { secret: 'changed-secret' }).read()).toEqual({ ok: false, problem: 'locked' });
  });

  it('the source: no business door, no other table, no rpc / storage / realtime, and it logs nothing', () => {
    const src = readFileSync(new URL('../src/db/credentialStore.ts', import.meta.url), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/getDb|from '\.\/client|repositories|createClient|\.rpc\(|\.storage|\.channel\(|console\./);
    expect(code.match(/\/rest\/v1\//g)).toHaveLength(1);
    expect(code).toContain("export const CREDENTIAL_TABLE = 'integration_credential';");
    expect(code.match(/this\.http\(/g)).toHaveLength(1);
    expect(src).toMatch(/SLOW::ARBO/);
  });
});

describe('walled off from the business data links, in both directions', () => {
  it('the table is in no data link, so getDb() refuses it by name — and nothing else in src reaches it', () => {
    expect(linkForTable(CREDENTIAL_TABLE)).toBeNull();
    expect(Object.values(DATA_LINKS).flat()).not.toContain(CREDENTIAL_TABLE);
    // Only the door names the table; only the Bouncie integration imports the door.
    const walk = (dir: URL): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : /\.(ts|html)$/.test(e.name) ? [new URL(e.name, dir).pathname] : []);
    const files = walk(new URL('../src/', import.meta.url));
    const naming = files.filter((p) => readFileSync(p, 'utf8').includes('integration_credential')).map((p) => p.slice(p.indexOf('/src/') + 1));
    expect(naming).toEqual(['src/db/credentialStore.ts']);
    const importing = files.filter((p) => /from '[./]+(db\/)?credentialStore\.js'/.test(readFileSync(p, 'utf8'))).map((p) => p.slice(p.indexOf('/src/') + 1));
    expect(importing).toEqual(['src/integrations/bouncie.ts']);
  });

  it('migration 0021: RLS on, no policy, every grant revoked from anon and authenticated, one provider allowed', () => {
    const dir = new URL('../supabase/migrations/', import.meta.url);
    const name = readdirSync(dir).find((f) => f.startsWith('0021_'));
    expect(name).toBe('0021_integration_credential.sql');
    const sql = readFileSync(new URL(name!, dir), 'utf8');
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).toMatch(/create table if not exists public\.integration_credential \(/);
    expect(code).toMatch(/provider\s+text primary key check \(provider in \('bouncie'\)\)/);
    for (const col of ['ciphertext  text not null', 'iv          text not null', 'tag         text not null', 'key_version smallint not null default 1', 'updated_at  timestamptz not null default now()']) {
      expect(code, col).toContain(col);
    }
    expect(code).toContain('alter table public.integration_credential enable row level security;');
    expect(code).toContain('revoke all on table public.integration_credential from anon, authenticated;');
    expect(code).not.toMatch(/create\s+policy/i);
    expect(code).not.toMatch(/grant\s/i);
    // Committed, not applied: the header says so until Mike says go.
    expect(sql).toContain('NOT APPLIED LIVE');
  });
});
