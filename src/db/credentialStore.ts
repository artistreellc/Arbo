/*
  SLOW::ARBO — this file is a door to Supabase, beside the data-link switch.
  The note at the top of src/db/client.ts applies here in full. Read it
  before editing.
*/

/**
 * THE CREDENTIAL DOOR — Mike, 2026-10-20 (R31, amended): "store the tokens
 * server-side in Supabase".
 *
 * One table, `integration_credential` (migration 0021), holding Arbo's OWN
 * sign-in to an outside service — today only Bouncie's. It holds no company
 * data: no customer, lead, job, call, or truck position, only a sealed token
 * pair. That is why it is not one of the business data links in
 * src/db/links.ts.
 *
 * ITS OWN SWITCH, CUT BY DEFAULT. §3 cuts every Supabase link until Mike
 * says the app is built; his spec asks for the tokens in Supabase now. Two
 * of his rules meet here, and that is his call, not the code's (CLAUDE.md:
 * conflicts stop and ask). So the door is CUT unless ARBO_LINK_CREDENTIALS
 * is exactly 'live' — read at call time, same opt-in shape as every other
 * link — and while cut it sends nothing at all: no read, no write. Mike
 * setting that variable is his ruling. It is not ARBO_DATA_LINKS: opening
 * this one table must not start the agent sweeps the master switch starts.
 *
 * What keeps it narrow — each one structural, each one pinned by a test:
 *   - ONE ADDRESS. It reads and writes `<SUPABASE_URL>/rest/v1/integration_credential`
 *     and nothing else. No other table, no rpc, no storage, no realtime. Any
 *     other request is refused before it leaves the process.
 *   - The business door cannot reach it, and it cannot reach the business:
 *     the table is in no DATA_LINKS list, so getDb() refuses it by name, and
 *     this file never imports getDb().
 *   - SEALED. A value is encrypted (AES-256-GCM, fresh 12-byte IV per write)
 *     before it leaves the process. The key is derived (HKDF-SHA256) from the
 *     provider's client secret, which lives only on Railway — so a leaked
 *     database or service-role key does not open the tokens. A row that does
 *     not open (the secret changed) is a NAMED state, never "not connected".
 *   - It logs nothing. Callers log the named problem only, never a value.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export const CREDENTIAL_TABLE = 'integration_credential';

/** A new provider needs a migration too: the table's CHECK allows only these. */
export type CredentialProvider = 'bouncie';

/** Bumped only with a migration plan for the rows already sealed under the old one. */
export const CREDENTIAL_KEY_VERSION = 1;

const HKDF_SALT = 'arbo:integration_credential';
const DEADLINE_MS = 8_000;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Why the door could not do what was asked — each its own sentence on the
 * screen (§1B). 'locked' is a row that is there but does not open; 'cut' is
 * the door's own switch, off on purpose.
 */
export type CredentialProblem = 'cut' | 'unconfigured' | 'missing_table' | 'refused' | 'mismatch' | 'unreachable' | 'locked';

/** The door's own switch (see the top of this file). */
export const CREDENTIAL_LINK_ENV = 'ARBO_LINK_CREDENTIALS';

/** Open ONLY when exactly 'live'. Read at call time, never cached — a restart or a test sees the truth. */
export function credentialLinkOpen(): boolean {
  return process.env[CREDENTIAL_LINK_ENV] === 'live';
}

export interface SealedCredential {
  ciphertext: string;
  iv: string;
  tag: string;
  key_version: number;
}

function keyFor(secret: string, provider: CredentialProvider, keyVersion: number): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, HKDF_SALT, `arbo:${provider}-token-store:v${keyVersion}`, 32));
}

/** Bound into the tag: a row cannot be moved to another provider or key version and still open. */
function aadFor(provider: CredentialProvider, keyVersion: number): Buffer {
  return Buffer.from(`${provider}|v${keyVersion}`, 'utf8');
}

/** Seal a value for one provider. Never logs; the plaintext never leaves this function. */
export function sealCredential(plain: string, secret: string, provider: CredentialProvider): SealedCredential {
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv('aes-256-gcm', keyFor(secret, provider, CREDENTIAL_KEY_VERSION), iv, { authTagLength: TAG_BYTES });
  c.setAAD(aadFor(provider, CREDENTIAL_KEY_VERSION));
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return {
    ciphertext: body.toString('base64'),
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    key_version: CREDENTIAL_KEY_VERSION,
  };
}

/** The plaintext, or null when this secret (or this provider) is not the one it was sealed with. Never throws. */
export function openCredential(s: SealedCredential, secret: string, provider: CredentialProvider): string | null {
  try {
    if (s.key_version !== CREDENTIAL_KEY_VERSION) return null;
    const iv = Buffer.from(s.iv, 'base64');
    const tag = Buffer.from(s.tag, 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const d = createDecipheriv('aes-256-gcm', keyFor(secret, provider, s.key_version), iv, { authTagLength: TAG_BYTES });
    d.setAAD(aadFor(provider, s.key_version));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(Buffer.from(s.ciphertext, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null; // a wrong key, a moved row, or a damaged one: GCM refuses all three the same way
  }
}

export type CredentialHttp = (
  url: string,
  // redirect 'error': a 3xx would carry the service-role key to wherever it points.
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; redirect: 'error'; signal?: RequestInit['signal'] },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultHttp: CredentialHttp = (url, init) => fetch(url, init);

export interface CredentialStoreOptions {
  /** SUPABASE_URL */
  url: string | null | undefined;
  /** SUPABASE_SERVICE_ROLE_KEY */
  serviceKey: string | null | undefined;
  provider: CredentialProvider;
  /** The provider's client secret — the only source of the sealing key. */
  secret: string | null | undefined;
  http?: CredentialHttp;
  now?: () => number;
}

export type CredentialRead = { ok: true; plain: string | null } | { ok: false; problem: CredentialProblem };
export type CredentialWrite = { ok: true } | { ok: false; problem: CredentialProblem };

/** A Supabase status, in the door's own words. 404 is PostgREST saying the table is not there. */
function problemFor(status: number): CredentialProblem {
  if (status === 404) return 'missing_table';
  if (status === 401 || status === 403) return 'refused';
  if (status === 400 || status === 409 || status === 422) return 'mismatch';
  return 'unreachable';
}

/** One provider's row, sealed. Reads and writes through exactly two fixed addresses. */
export class CredentialStore {
  private readonly readUrl: string | null;
  private readonly writeUrl: string | null;
  private readonly http: CredentialHttp;
  private readonly now: () => number;

  constructor(private readonly o: CredentialStoreOptions) {
    const base = o.url ? `${o.url.replace(/\/+$/, '')}/rest/v1/${CREDENTIAL_TABLE}` : null;
    this.readUrl = base ? `${base}?provider=eq.${o.provider}&select=ciphertext,iv,tag,key_version` : null;
    this.writeUrl = base ? `${base}?on_conflict=provider` : null;
    this.http = o.http ?? defaultHttp;
    this.now = o.now ?? Date.now;
  }

  /** Supabase and the sealing secret are both on the server. */
  configured(): boolean {
    return Boolean(this.readUrl && this.o.serviceKey && this.o.secret);
  }

  private headers(): Record<string, string> {
    const key = this.o.serviceKey ?? '';
    // A legacy service-role key is a JWT and goes as a Bearer too; the newer
    // sb_secret_ keys belong in apikey only (supabase-js says the same).
    return key.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key };
  }

  /** The door: only the two fixed addresses, never a redirect, always a deadline. */
  private call(method: 'GET' | 'POST', url: string | null, headers: Record<string, string>, body?: string) {
    if (url === null || !((method === 'GET' && url === this.readUrl) || (method === 'POST' && url === this.writeUrl))) {
      return Promise.reject(new Error('credential_call_refused'));
    }
    return this.http(url, { method, headers, redirect: 'error', ...(body === undefined ? {} : { body }), signal: globalThis.AbortSignal.timeout(DEADLINE_MS) });
  }

  /** The provider's value, null when none is saved, or the named reason it could not be read. */
  async read(): Promise<CredentialRead> {
    if (!credentialLinkOpen()) return { ok: false, problem: 'cut' }; // first: the switch rules before the config, as at the business door
    if (!this.configured()) return { ok: false, problem: 'unconfigured' };
    let res;
    try {
      res = await this.call('GET', this.readUrl, { ...this.headers(), accept: 'application/json' });
    } catch {
      return { ok: false, problem: 'unreachable' };
    }
    if (!res.ok) return { ok: false, problem: problemFor(res.status) };
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows)) return { ok: false, problem: 'mismatch' };
    if (rows.length === 0) return { ok: true, plain: null };
    const r = rows[0] as Record<string, unknown> | null;
    if (rows.length !== 1 || !r || typeof r.ciphertext !== 'string' || typeof r.iv !== 'string' || typeof r.tag !== 'string' || typeof r.key_version !== 'number') {
      return { ok: false, problem: 'mismatch' };
    }
    const plain = openCredential({ ciphertext: r.ciphertext, iv: r.iv, tag: r.tag, key_version: r.key_version }, this.o.secret as string, this.o.provider);
    return plain === null ? { ok: false, problem: 'locked' } : { ok: true, plain };
  }

  /** Seal and save (insert or replace the one row). Nothing is kept here; the caller holds what it saved. */
  async write(plain: string): Promise<CredentialWrite> {
    if (!credentialLinkOpen()) return { ok: false, problem: 'cut' };
    if (!this.configured()) return { ok: false, problem: 'unconfigured' };
    const sealed = sealCredential(plain, this.o.secret as string, this.o.provider);
    const row = { provider: this.o.provider, ...sealed, updated_at: new Date(this.now()).toISOString() };
    let res;
    try {
      res = await this.call('POST', this.writeUrl, {
        ...this.headers(),
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      }, JSON.stringify(row));
    } catch {
      return { ok: false, problem: 'unreachable' };
    }
    return res.ok ? { ok: true } : { ok: false, problem: problemFor(res.status) };
  }
}
