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
import { describe, it, expect } from 'vitest';
import { createRefreshTokenProvider } from '../src/integrations/googleOAuth.js';

// The refresh-token → access-token provider for the Gmail reader (backlog
// #36 closing). gmail.readonly is the only scope ever consented to — the
// reader's own header note is the law; this module just mints short-lived
// tokens and stays honest when it cannot.

function fakePost(script: Array<{ ok: boolean; status: number; body: unknown }>) {
  const calls: Array<{ url: string; form: Record<string, string> }> = [];
  const fn = async (url: string, form: Record<string, string>) => {
    calls.push({ url, form });
    const next = script.shift() ?? { ok: false, status: 599, body: {} };
    return { ok: next.ok, status: next.status, json: async () => next.body };
  };
  return { fn, calls };
}

const CREDS = { clientId: 'id-1', clientSecret: 'secret-1', refreshToken: 'refresh-1' };

describe('createRefreshTokenProvider', () => {
  it('mints a token with the refresh grant and caches it until near expiry', async () => {
    let t = 1_000_000;
    const { fn, calls } = fakePost([{ ok: true, status: 200, body: { access_token: 'tok-a', expires_in: 3600 } }]);
    const get = createRefreshTokenProvider(CREDS, fn, () => t);
    expect(await get()).toBe('tok-a');
    t += 30 * 60 * 1000; // half the lifetime later — still cached
    expect(await get()).toBe('tok-a');
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0]!.form).toEqual({
      client_id: 'id-1', client_secret: 'secret-1', refresh_token: 'refresh-1', grant_type: 'refresh_token',
    });
  });

  it('refreshes a minute BEFORE expiry — an expired token mid-sweep is a failed sweep', async () => {
    let t = 0;
    const { fn, calls } = fakePost([
      { ok: true, status: 200, body: { access_token: 'tok-a', expires_in: 3600 } },
      { ok: true, status: 200, body: { access_token: 'tok-b', expires_in: 3600 } },
    ]);
    const get = createRefreshTokenProvider(CREDS, fn, () => t);
    expect(await get()).toBe('tok-a');
    t = 3600 * 1000 - 30 * 1000; // 30s before expiry — inside the safety margin
    expect(await get()).toBe('tok-b');
    expect(calls.length).toBe(2);
  });

  it('throws on an HTTP error — the reader turns this into ok:false, never an empty inbox', async () => {
    const { fn } = fakePost([{ ok: false, status: 400, body: { error: 'invalid_grant' } }]);
    const get = createRefreshTokenProvider(CREDS, fn, () => 0);
    await expect(get()).rejects.toThrow(/HTTP 400/);
  });

  it('throws when the response carries no access_token — a 200 with nothing in it is not a token', async () => {
    const { fn } = fakePost([{ ok: true, status: 200, body: { scope: 'gmail.readonly' } }]);
    const get = createRefreshTokenProvider(CREDS, fn, () => 0);
    await expect(get()).rejects.toThrow(/no access_token/);
  });

  it('a failed mint is not cached — the next call tries again', async () => {
    const { fn, calls } = fakePost([
      { ok: false, status: 500, body: {} },
      { ok: true, status: 200, body: { access_token: 'tok-c', expires_in: 3600 } },
    ]);
    const get = createRefreshTokenProvider(CREDS, fn, () => 0);
    await expect(get()).rejects.toThrow();
    expect(await get()).toBe('tok-c');
    expect(calls.length).toBe(2);
  });
});
