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
import {
  hashPassword, verifyPassword, provisionPortalInvite, checkInvite, signIn,
  MIN_PASSWORD_LENGTH, INVITE_TTL_MS, type PortalInvite,
} from '../src/portal/account.js';

// The third door's front lock. These are the cases that would actually let
// somebody in, or tell them something about Mike's customers they should not
// learn.

describe('passwords', () => {
  it('never stores the plaintext', () => {
    const c = hashPassword('correct horse battery');
    expect(c.passwordHash).not.toContain('correct horse battery');
    expect(c.passwordHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it('salts per account — the same password gives different hashes', () => {
    expect(hashPassword('correct horse battery').passwordHash)
      .not.toBe(hashPassword('correct horse battery').passwordHash);
  });

  it('round-trips, and rejects the wrong password', () => {
    const { passwordHash } = hashPassword('correct horse battery');
    expect(verifyPassword('correct horse battery', passwordHash)).toBe(true);
    expect(verifyPassword('Correct horse battery', passwordHash)).toBe(false);
    expect(verifyPassword('', passwordHash)).toBe(false);
  });

  it('refuses to store a password below the floor rather than storing it weak', () => {
    expect(() => hashPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toThrow(/too_short/);
    expect(() => hashPassword('a'.repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
  });

  it('a corrupt stored value is never a way in', () => {
    for (const bad of ['', 'nonsense', 'nosalt:', ':nohash', 'aa:bb', 'zz:zz']) {
      expect(verifyPassword('anything', bad), bad).toBe(false);
    }
  });
});

describe('sign-in tells an attacker nothing', () => {
  const account = { email: 'x@example.com', propertyId: 'p1', ...hashPassword('correct horse battery') };

  it('lets the right password in', () => {
    expect(signIn(account, 'correct horse battery')).toEqual({ ok: true, propertyId: 'p1' });
  });

  it('gives the SAME message for a wrong password and an unknown email', () => {
    // Different messages would let anyone check which addresses are on file.
    const wrongPassword = signIn(account, 'nope nope nope');
    const unknownEmail = signIn(null, 'correct horse battery');
    expect(wrongPassword).toEqual(unknownEmail);
    expect(wrongPassword.ok).toBe(false);
  });
});

describe('the invite', () => {
  const now = '2026-08-03T12:00:00.000Z';

  it('is prepared but NOT sent — Arbo does not send email', () => {
    const r = provisionPortalInvite({ propertyId: 'p1', email: 'Someone@Example.COM ', nowIso: now });
    expect(r.emailSent).toBe(false);
    expect(r.line).toMatch(/has NOT sent it/);
    // Normalised, so the same person cannot end up with two accounts.
    expect(r.invite.email).toBe('someone@example.com');
  });

  it('is unguessable and expires', () => {
    const r = provisionPortalInvite({ propertyId: 'p1', email: 'a@b.co', nowIso: now });
    expect(r.invite.token).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(r.invite.expiresAtIso) - Date.parse(now)).toBe(INVITE_TTL_MS);
  });

  it('refuses a malformed address instead of creating an invite that can never arrive', () => {
    for (const bad of ['', 'nope', 'a@b', 'a b@c.com']) {
      expect(() => provisionPortalInvite({ propertyId: 'p1', email: bad, nowIso: now })).toThrow(/bad_email/);
    }
  });

  it('says WHICH kind of dead link it is (§1B)', () => {
    const live: PortalInvite = {
      token: 'aa', propertyId: 'p1', email: 'a@b.co',
      issuedAtIso: now, expiresAtIso: '2026-08-10T12:00:00.000Z', usedAtIso: null,
    };
    expect(checkInvite(live, now)).toEqual({ ok: true, propertyId: 'p1' });
    expect(checkInvite(null, now)).toMatchObject({ reason: 'unknown' });
    expect(checkInvite({ ...live, usedAtIso: now }, now)).toMatchObject({ reason: 'already_used' });
    expect(checkInvite(live, '2026-08-11T12:00:00.000Z')).toMatchObject({ reason: 'expired' });
  });

  it('a single-use link is dead the second time', () => {
    const used: PortalInvite = {
      token: 'aa', propertyId: 'p1', email: 'a@b.co',
      issuedAtIso: now, expiresAtIso: '2026-08-10T12:00:00.000Z', usedAtIso: now,
    };
    expect(checkInvite(used, now).ok).toBe(false);
  });
});
