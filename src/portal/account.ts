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
// CUSTOMER PORTAL ACCOUNTS (§8C, third door). Mike, 2026-08-03: "the virtual
// receptionist logs their data when they sign the contract and then emails
// them the customer portal where all they have to do is enter their email and
// password."
//
// This file is the account half. It is deliberately BOUNDED at the send:
//
//   ARBO DOES NOT SEND THE EMAIL FROM HERE. "Never send email. Ever." is a
//   standing hard boundary, and ruling R7 puts Resend — the only mail path
//   this business has — out of scope. So provisioning produces an INVITE
//   RECORD that is ready to go out, and something with Mike's authority sends
//   it. If Mike lifts that boundary, the sender plugs in here and nothing
//   else in this file changes.
//
// SECURITY, and this is the part that gets read slowly:
//   - scrypt, from node:crypto. No new dependency, no hand-rolled hashing.
//   - A per-account random salt, so two customers with the same password do
//     not share a hash.
//   - timingSafeEqual on verify, so a wrong password cannot be found one byte
//     at a time by watching how long the answer takes.
//   - The plaintext password is never stored, never logged, never returned.
//   - An invite token is 32 random bytes. It is single-use and it EXPIRES —
//     a link that works forever is a password that never changes.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** scrypt cost. N=16384 is the widely-used interactive default. */
const SCRYPT_N = 16_384;
const KEY_LEN = 64;
const SALT_BYTES = 16;

/** Invite links expire. Seven days is long enough to find the email. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The floor. Not a policy essay — a length nobody can brute force casually. */
export const MIN_PASSWORD_LENGTH = 10;

export interface StoredCredential {
  /** salt:hash, both hex. The plaintext never exists after this call. */
  passwordHash: string;
}

/**
 * Hash a password for storage. Throws on a password below the floor rather
 * than storing a weak one — refusing is the only safe direction here.
 */
export function hashPassword(plaintext: string): StoredCredential {
  if (plaintext.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password_too_short: minimum ${MIN_PASSWORD_LENGTH} characters`);
  }
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plaintext, salt, KEY_LEN, { N: SCRYPT_N });
  return { passwordHash: `${salt.toString('hex')}:${hash.toString('hex')}` };
}

/**
 * Verify a password. Constant-time, and false on ANY malformed stored value —
 * a corrupt row must never be a way in.
 */
export function verifyPassword(plaintext: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEY_LEN) return false;
  const actual = scryptSync(plaintext, Buffer.from(saltHex, 'hex'), KEY_LEN, { N: SCRYPT_N });
  // Lengths already match, so timingSafeEqual cannot throw here.
  return timingSafeEqual(actual, expected);
}

export interface PortalInvite {
  /** 32 random bytes, hex. Single-use. */
  token: string;
  propertyId: string;
  email: string;
  issuedAtIso: string;
  expiresAtIso: string;
  /** Set when the customer has used it. A used invite is dead. */
  usedAtIso: string | null;
}

export interface ProvisionResult {
  invite: PortalInvite;
  /**
   * ALWAYS false. Arbo prepared the invite; it did not send it. Anything
   * reading this field is being told plainly that the customer has not been
   * contacted yet (§1B — a prepared invite is not a delivered one).
   */
  emailSent: false;
  line: string;
}

/**
 * Called when a contract is signed: the receptionist has the customer's data,
 * so the portal account gets provisioned and an invite prepared.
 *
 * It does NOT email. See the note at the top of this file.
 */
export function provisionPortalInvite(input: {
  propertyId: string;
  email: string;
  nowIso: string;
}): ProvisionResult {
  const email = input.email.trim().toLowerCase();
  // A malformed address is caught here rather than becoming an invite that
  // can never arrive and a customer who is never told why.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new Error('bad_email');
  }
  const issued = new Date(input.nowIso);
  if (Number.isNaN(issued.getTime())) throw new Error('bad_timestamp');

  return {
    invite: {
      token: randomBytes(32).toString('hex'),
      propertyId: input.propertyId,
      email,
      issuedAtIso: issued.toISOString(),
      expiresAtIso: new Date(issued.getTime() + INVITE_TTL_MS).toISOString(),
      usedAtIso: null,
    },
    emailSent: false,
    line: 'Portal invite prepared. Arbo has NOT sent it — sending is yours (CLAUDE.md: never send email; ruling R7 keeps Resend out of scope).',
  };
}

export type InviteCheck =
  | { ok: true; propertyId: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'already_used'; line: string };

/**
 * Is this invite still good? Every rejection says WHICH — "expired" and
 * "never existed" are different facts, and a customer staring at a dead link
 * deserves to know which one they are looking at (§1B).
 */
export function checkInvite(invite: PortalInvite | null, nowIso: string): InviteCheck {
  if (!invite) {
    return { ok: false, reason: 'unknown', line: 'That link is not one of ours. Ask Mike to send a new one.' };
  }
  if (invite.usedAtIso) {
    return { ok: false, reason: 'already_used', line: 'That link has already been used. Sign in with your email and password instead.' };
  }
  if (Date.parse(invite.expiresAtIso) <= Date.parse(nowIso)) {
    return { ok: false, reason: 'expired', line: 'That link has expired. Ask Mike for a new one.' };
  }
  return { ok: true, propertyId: invite.propertyId };
}

export type SignInResult =
  | { ok: true; propertyId: string }
  | { ok: false; line: string };

/**
 * Sign in. The failure message is IDENTICAL for a wrong password and an
 * unknown email — telling them apart would let anyone check which of their
 * customers' addresses are on file.
 */
export function signIn(
  account: { email: string; passwordHash: string; propertyId: string } | null,
  password: string,
): SignInResult {
  const SAME_FOR_BOTH = { ok: false as const, line: 'That email and password do not match an account.' };
  if (!account) {
    // Still spend the time. Returning instantly on an unknown email tells an
    // attacker the address is not on file, without needing the password.
    verifyPassword(password, `${'0'.repeat(SALT_BYTES * 2)}:${'0'.repeat(KEY_LEN * 2)}`);
    return SAME_FOR_BOTH;
  }
  if (!verifyPassword(password, account.passwordHash)) return SAME_FOR_BOTH;
  return { ok: true, propertyId: account.propertyId };
}
