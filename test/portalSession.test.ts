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
// The customer portal session. Security-critical: this is the only thing
// standing between a URL and someone else's tree report.

import { describe, it, expect } from 'vitest';
import {
  mintSession,
  readSession,
  sessionCookie,
  clearedCookie,
  cookieFrom,
  SESSION_TTL_MS,
  SESSION_COOKIE,
} from '../src/portal/session.js';

const SECRET = 'a-long-enough-test-secret-value';
const NOW = Date.parse('2026-08-04T04:00:00Z');
const PROP = '11111111-2222-4333-8444-555555555555';

describe('portal session — the happy path', () => {
  it('mints a token that reads back as the same property', () => {
    const t = mintSession(PROP, NOW, SECRET)!;
    expect(t).toBeTruthy();
    const r = readSession(t, NOW + 1000, SECRET);
    expect(r).toEqual({ ok: true, propertyId: PROP });
  });

  it('carries nothing about the customer — a leaked token is a uuid and a date', () => {
    const t = mintSession(PROP, NOW, SECRET)!;
    expect(t.toLowerCase()).not.toMatch(/@|mike|campbell|street|lane/);
  });
});

describe('portal session — FAILS CLOSED with no secret', () => {
  it('cannot mint', () => {
    expect(mintSession(PROP, NOW, undefined)).toBeNull();
  });

  it('rejects every token, including one that was validly signed', () => {
    const t = mintSession(PROP, NOW, SECRET)!;
    // The attack this prevents: portal deployed without the secret, and the
    // verifier "skips the check" because it has nothing to check with.
    expect(readSession(t, NOW, undefined)).toEqual({ ok: false, reason: 'no_secret' });
    expect(readSession('anything', NOW, undefined).ok).toBe(false);
    expect(readSession(undefined, NOW, undefined).ok).toBe(false);
  });
});

describe('portal session — forgery and tampering', () => {
  it('rejects a token signed with a different secret', () => {
    const t = mintSession(PROP, NOW, 'some-other-secret')!;
    expect(readSession(t, NOW, SECRET)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a swapped property id — the whole point', () => {
    // Someone else's property, re-signed with nothing. If this passed, any
    // customer could read any customer's report by editing a cookie.
    const t = mintSession(PROP, NOW, SECRET)!;
    const parts = t.split('.');
    const forged = `99999999-9999-4999-8999-999999999999.${parts[1]}.${parts[2]}`;
    expect(readSession(forged, NOW, SECRET)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects an extended expiry', () => {
    const t = mintSession(PROP, NOW, SECRET)!;
    const parts = t.split('.');
    const forged = `${parts[0]}.${NOW + 10 * SESSION_TTL_MS}.${parts[2]}`;
    expect(readSession(forged, NOW, SECRET)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects malformed shapes without throwing', () => {
    for (const bad of ['', 'x', 'a.b', '...', 'a..c', `${PROP}.notanumber.abc`]) {
      const r = readSession(bad, NOW, SECRET);
      expect(r.ok, `"${bad}" must not authenticate`).toBe(false);
    }
  });

  it('refuses to mint for a property id containing the delimiter', () => {
    expect(mintSession('has.a.dot', NOW, SECRET)).toBeNull();
  });
});

describe('portal session — expiry', () => {
  it('accepts up to the last moment and rejects after', () => {
    const t = mintSession(PROP, NOW, SECRET)!;
    expect(readSession(t, NOW + SESSION_TTL_MS - 1, SECRET).ok).toBe(true);
    expect(readSession(t, NOW + SESSION_TTL_MS, SECRET)).toEqual({ ok: false, reason: 'expired' });
  });

  it('says EXPIRED, not bad_signature — different facts, different sentences', () => {
    const t = mintSession(PROP, NOW, SECRET)!;
    const r = readSession(t, NOW + SESSION_TTL_MS + 1, SECRET);
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('portal session — the cookie', () => {
  it('is HttpOnly, Secure, SameSite and scoped to /portal', () => {
    const c = sessionCookie('tok');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Lax');
    // Scoped so a customer's cookie is never attached to an admin or crew
    // request, even from the same browser.
    expect(c).toContain('Path=/portal');
  });

  it('clears with Max-Age=0', () => {
    expect(clearedCookie()).toContain('Max-Age=0');
  });

  it('reads our cookie out of a crowded header', () => {
    expect(cookieFrom(`other=1; ${SESSION_COOKIE}=abc; another=2`)).toBe('abc');
  });

  it('returns undefined rather than a blank when absent or empty', () => {
    expect(cookieFrom(undefined)).toBeUndefined();
    expect(cookieFrom('other=1')).toBeUndefined();
    expect(cookieFrom(`${SESSION_COOKIE}=`)).toBeUndefined();
  });

  it('is not fooled by a cookie whose name merely ends with ours', () => {
    expect(cookieFrom(`not_${SESSION_COOKIE}=evil`)).toBeUndefined();
  });
});
