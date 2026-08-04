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
// The customer portal's session (task #35). The smallest thing that can
// safely say "this browser is the person who signed in".
//
// STATELESS, ON PURPOSE. A session table would need writes on every sign-in,
// a cleanup job, and a second place for a customer's identity to live. An
// HMAC-signed token needs none of that: the server can verify it without
// storing anything, because it signed it. Simplicity over cleverness — the
// same reason the calendar is an iframe.
//
// WHAT A TOKEN SAYS, AND NOTHING MORE: this property id, until this instant.
// No email, no name, no role. If a token leaked it would reveal a UUID and an
// expiry — nothing about the customer (§4.3).
//
// ═══ IT FAILS CLOSED WITH NO SECRET ═══
// No `PORTAL_SESSION_SECRET` means `mint` refuses and `read` rejects
// everything. A portal that cannot sign a session must not fall back to
// trusting an unsigned one — that is the whole attack. There is no dev
// bypass, no default secret, no "if undefined, skip the check".

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Eight hours. Long enough for a customer to read their tree report and pay. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export const SESSION_COOKIE = 'arbo_portal';

export type SessionRead =
  | { ok: true; propertyId: string }
  | { ok: false; reason: 'no_secret' | 'malformed' | 'bad_signature' | 'expired' };

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Mint a session token. Returns null when there is no secret — the caller
 * MUST treat that as "cannot sign anyone in", never as "signed in".
 */
export function mintSession(
  propertyId: string,
  nowMs: number,
  secret: string | undefined,
): string | null {
  if (!secret) return null;
  if (!propertyId || propertyId.includes('.')) return null; // '.' is the delimiter
  const expiresAt = nowMs + SESSION_TTL_MS;
  const payload = `${propertyId}.${expiresAt}`;
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verify a token. Every rejection says WHICH — an expired session and a
 * forged one are different facts, and the portal shows the customer a
 * different sentence for each (§1B).
 */
export function readSession(
  token: string | undefined,
  nowMs: number,
  secret: string | undefined,
): SessionRead {
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (!token) return { ok: false, reason: 'malformed' };

  // Exactly three parts. `lastIndexOf` rather than split-and-count so a
  // property id containing a dot cannot smuggle in extra segments — though
  // mint refuses those anyway, this file does not rely on the other function
  // having been careful.
  const lastDot = token.lastIndexOf('.');
  if (lastDot <= 0) return { ok: false, reason: 'malformed' };
  const payload = token.slice(0, lastDot);
  const given = token.slice(lastDot + 1);

  const midDot = payload.lastIndexOf('.');
  if (midDot <= 0) return { ok: false, reason: 'malformed' };
  const propertyId = payload.slice(0, midDot);
  const expiresAt = Number(payload.slice(midDot + 1));
  if (!propertyId || !Number.isFinite(expiresAt)) return { ok: false, reason: 'malformed' };

  // SIGNATURE BEFORE EXPIRY, deliberately. Checking expiry first would let an
  // attacker learn whether a forged token's timestamp was in range before the
  // signature was ever tested — a small oracle, but free to avoid.
  const expected = sign(payload, secret);
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    timingSafeEqual(b, b); // spend the same time on a wrong-length guess
    return { ok: false, reason: 'bad_signature' };
  }
  if (!timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };

  if (expiresAt <= nowMs) return { ok: false, reason: 'expired' };
  return { ok: true, propertyId };
}

/**
 * The Set-Cookie value. HttpOnly so no script can read it, Secure so it never
 * crosses plain HTTP, SameSite=Lax so another site cannot ride the session,
 * and Path=/portal so it is never attached to an admin or crew request.
 */
export function sessionCookie(token: string, maxAgeSec = SESSION_TTL_MS / 1000): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/portal; Max-Age=${maxAgeSec}`;
}

/** Sign-out: the same cookie, expired immediately. */
export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/portal; Max-Age=0`;
}

/** Pull our cookie out of a Cookie header without trusting its shape. */
export function cookieFrom(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const v = part.slice(eq + 1).trim();
    return v === '' ? undefined : v;
  }
  return undefined;
}
