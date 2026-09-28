// Where Arbo keeps the Google refresh token Mike grants from the app's
// "Reconnect Google" card (Mike, 2026-09-28: option 2 — Arbo does the swap
// itself so the token never passes through chat or a screen).
//
// The token lives in ONE file on the Railway storage disk (default /data,
// override ARBO_SECRET_DIR), mode 0600, written atomically. It is never
// returned by any route, never logged, never rendered. With no disk the
// token is held in memory and the app SAYS it lasts only until the next
// restart (§1B) — never a quiet "connected".
//
// `googleCreds()` hands the existing token provider a creds object whose
// `refreshToken` is read at every refresh: the stored token wins, the
// Railway variable GMAIL_OAUTH_REFRESH_TOKEN is the fallback. A new grant
// takes effect on the next refresh — no restart, and no edit to the
// SLOW::ARBO googleOAuth.ts.

import { mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { GmailOAuthCreds } from './googleOAuth.js';

const FILE = 'google-refresh-token';

export class GoogleTokenStore {
  private memory: string | null = null;
  private savedAt: string | null = null;
  private where: 'disk' | 'memory' | null = null;

  constructor(private readonly dir: string = process.env.ARBO_SECRET_DIR ?? '/data') {
    try {
      const t = readFileSync(join(this.dir, FILE), 'utf8').trim();
      if (t) {
        this.memory = t;
        this.where = 'disk';
        this.savedAt = statSync(join(this.dir, FILE)).mtime.toISOString();
      }
    } catch {
      /* nothing stored yet, or no disk — status says which */
    }
  }

  current(): string | null {
    return this.memory;
  }

  /** Persist a newly granted token. Returns where it landed; never throws for a missing disk. */
  save(token: string, nowIso: string): 'disk' | 'memory' {
    this.memory = token;
    this.savedAt = nowIso;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const tmp = join(this.dir, `${FILE}.tmp`);
      writeFileSync(tmp, token, { mode: 0o600 });
      renameSync(tmp, join(this.dir, FILE));
      this.where = 'disk';
    } catch {
      this.where = 'memory';
    }
    return this.where;
  }

  status(): { stored: boolean; where: 'disk' | 'memory' | null; savedAt: string | null; diskPath: string } {
    return { stored: this.memory !== null, where: this.where, savedAt: this.savedAt, diskPath: this.dir };
  }
}

/** Creds for the token provider — the stored grant first, the Railway variable second. Null when no client is configured. */
export function googleCreds(
  store: GoogleTokenStore,
  env: { clientId?: string | undefined; clientSecret?: string | undefined; refreshToken?: string | undefined },
): GmailOAuthCreds | null {
  if (!env.clientId || !env.clientSecret) return null;
  if (!store.current() && !env.refreshToken) return null;
  const { clientId, clientSecret } = env;
  return {
    clientId,
    clientSecret,
    get refreshToken() {
      return store.current() ?? env.refreshToken ?? '';
    },
  };
}

/** The scopes Arbo asks for — read Gmail, create calendar holds (R18), read Drive (R24). Nothing that sends or deletes. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly',
];

/** Mike's OAuth client is a Desktop client: Google sends him to http://localhost with the code. */
export const GOOGLE_REDIRECT = 'http://localhost';

export function consentUrl(clientId: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: GOOGLE_REDIRECT,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

/** Pull the one-time code out of whatever Mike pasted: the whole localhost address, or just the code. */
export function codeFrom(pasted: string): string | null {
  const s = pasted.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.searchParams.get('code');
  } catch {
    return /^[\w/.-]{10,}$/.test(s) ? s : null;
  }
}

type PostForm = (url: string, form: Record<string, string>) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultPost: PostForm = async (url, form) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  return { ok: res.ok, status: res.status, json: () => res.json() };
};

export type ExchangeResult =
  | { ok: true; refreshToken: string; scopes: string[] }
  | { ok: false; reason: 'code_expired_or_used' | 'no_refresh_token' | 'rejected' | 'network'; status: number | null };

/** Trade the one-time code for the refresh token, server-side. The token goes to the store — never back to the caller of the route. */
export async function exchangeCode(clientId: string, clientSecret: string, code: string, post: PostForm = defaultPost): Promise<ExchangeResult> {
  let res;
  try {
    res = await post('https://oauth2.googleapis.com/token', {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: GOOGLE_REDIRECT,
      code,
    });
  } catch {
    return { ok: false, reason: 'network', status: null };
  }
  const body = (await res.json().catch(() => ({}))) as { refresh_token?: unknown; scope?: unknown; error?: unknown };
  if (!res.ok) return { ok: false, reason: body.error === 'invalid_grant' ? 'code_expired_or_used' : 'rejected', status: res.status };
  if (typeof body.refresh_token !== 'string' || !body.refresh_token) return { ok: false, reason: 'no_refresh_token', status: res.status };
  return { ok: true, refreshToken: body.refresh_token, scopes: typeof body.scope === 'string' ? body.scope.split(' ') : [] };
}
