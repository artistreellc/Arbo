/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  Owner instruction from Mike, 2026-08-03. This is not decoration and it
  is not optional. It is here because this is the point in a build where
  things get broken by moving fast, and that already happened to him once
  on the website. It does not happen here.
  ═══════════════════════════════════════════════════════════════════════

  SLOW DOWN. DRASTICALLY. Then:

  1. READ EVERY LINE BEFORE YOU EDIT ONE. Every line, every letter,
     slowly. You are not skimming to find the spot to change — you are
     building a model of what this file already does. If you cannot say
     what the code above and below your edit does, you have not read it.

  2. AN AUDIT IS READ-ONLY. If you were asked to audit, you do not edit.
     You do not "fix it while you are in there." You do not refactor, or
     tidy, or rename. You READ, and you REPORT. Editing during an audit
     is disobeying the instruction, full stop.

  3. THINK BEFORE YOU TYPE. What does this already handle? What depends
     on it? What breaks downstream? Recognise the PATTERN before you call
     something a bug — most things in here that look wrong are a
     deliberate correction. Check docs/OWNER_RULINGS.md first. Use what
     you already know about this codebase instead of re-deciding it.

  4. BRING IT TO MIKE — DO NOT DECIDE IT. Anything that looks wrong,
     ambiguous, or outside what was asked: say it and WAIT. Flagging
     costs one sentence. Deciding on his behalf has cost real work and
     real money more than once.

  5. DO EXACTLY WHAT WAS ASKED. Not the adjacent thing. Not the bigger
     thing you thought of on the way. Not the cleanup. Exactly what was
     asked, and nothing else.

  If you are moving fast right now, you are already off the rails.

  Remember the marker: SLOW::ARBO
*/

// Refresh-token → access-token provider for the Gmail reader (closing
// backlog #36). The refresh token is minted ONCE by Mike's consent to the
// `gmail.readonly` scope and lives in Railway env; this module trades it for
// short-lived access tokens and caches them. The scope is the law: nothing
// this token can reach is able to send, label, or delete mail — "Never send
// email. Ever." holds at the credential, not just in prose (see gmail.ts).

export interface GmailOAuthCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

type PostFormFn = (url: string, form: Record<string, string>) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const defaultPost: PostFormFn = async (url, form) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  return { ok: res.ok, status: res.status, json: () => res.json() };
};

/** Refresh a minute early: an access token that dies mid-sweep fails the sweep. */
const EXPIRY_MARGIN_MS = 60 * 1000;

export function createRefreshTokenProvider(
  creds: GmailOAuthCreds,
  postFn: PostFormFn = defaultPost,
  now: () => number = Date.now,
): () => Promise<string> {
  let cached: { token: string; expiresAtMs: number } | null = null;

  return async () => {
    if (cached && now() < cached.expiresAtMs - EXPIRY_MARGIN_MS) return cached.token;
    // Not cached until proven: a failed mint leaves `cached` alone so the
    // next call tries again instead of replaying a failure from memory.
    const res = await postFn('https://oauth2.googleapis.com/token', {
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    });
    if (!res.ok) throw new Error(`token refresh failed: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('token refresh failed: no access_token in response');
    cached = { token: body.access_token, expiresAtMs: now() + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  };
}
