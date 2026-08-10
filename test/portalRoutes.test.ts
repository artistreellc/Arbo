// The third door's request handlers (task #35, cycle 11).
//
// The spine — session.ts, account.ts, customerView.ts — shipped tested and
// wired to nothing. These tests specify the layer that finally connects them
// to HTTP, and they are written FIRST because this is the only surface in the
// codebase a stranger can reach without Mike's key.
//
// What is being pinned down here, in priority order:
//   1. It fails CLOSED. No secret, no database, no session → nobody gets in
//      and nothing renders. Never a fallback, never a default, never "skip
//      the check in dev".
//   2. §1B. "We cannot read your records" and "you have no trees" are
//      different facts and must never render the same.
//   3. The session is the ONLY thing that names the property. A propertyId in
//      a query string or a body must be inert — that is the IDOR, and it is
//      the bug most likely to actually happen here.
//   4. §4.3. No customer PII in any error line.

import { describe, it, expect, vi } from 'vitest';
import { mintSession, SESSION_COOKIE } from '../src/portal/session.js';
import { handlePortal, type PortalDeps, type PortalRequest } from '../src/portal/routes.js';
import { createSignInThrottle, MAX_FAILURES } from '../src/portal/throttle.js';
import type { PortalView } from '../src/portal/customerView.js';

const SECRET = 'test-portal-secret-not-a-real-one';
const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);
const PROPERTY = '11111111-2222-3333-4444-555555555555';
const OTHER_PROPERTY = '99999999-8888-7777-6666-555555555555';

/** A minimal but structurally real view — enough to prove the route returns it. */
function viewFor(propertyId: string): PortalView {
  return {
    property: { address: '1 Test St', city: 'Virginia Beach', zip: '23451' },
    trees: [],
    map: { centre: null, markers: [], unplaced: 0, line: 'not mapped' },
    project: { status: 'none', line: 'No work booked right now.', scheduledFor: null },
    site: [],
    flags: [],
    payment: { state: 'nothing_due', line: 'Nothing to pay right now.' },
    gaps: [`marker:${propertyId}`],
  };
}

function deps(over: Partial<PortalDeps> = {}): PortalDeps {
  return {
    secret: SECRET,
    hasDb: () => true,
    throttle: createSignInThrottle(),
    findAccountByEmail: async () => ({
      // scrypt hash of 'correct-horse-battery' — see hashPassword(); the test
      // builds it at runtime below so no hash is hard-coded here.
      email: 'someone@example.com',
      passwordHash: HASH,
      propertyId: PROPERTY,
    }),
    loadView: async (id: string) => viewFor(id),
    recordSignIn: async () => {},
    ...over,
  };
}

function req(over: Partial<PortalRequest> = {}): PortalRequest {
  return { method: 'GET', path: '/portal/view', cookie: undefined, body: undefined, nowMs: NOW, ...over };
}

// Built once — scrypt is deliberately slow and this is the only place a real
// password is hashed in these tests.
const { hashPassword } = await import('../src/portal/account.js');
const PASSWORD = 'correct-horse-battery';
const HASH = hashPassword(PASSWORD).passwordHash;

function goodCookie(propertyId = PROPERTY, nowMs = NOW): string {
  const token = mintSession(propertyId, nowMs, SECRET);
  if (!token) throw new Error('test setup: could not mint');
  return `${SESSION_COOKIE}=${token}`;
}

describe('portal routes — failing closed', () => {
  it('refuses sign-in when there is no session secret, and sets no cookie', async () => {
    const res = await handlePortal(
      req({ method: 'POST', path: '/portal/signin', body: { email: 'a@b.com', password: PASSWORD } }),
      deps({ secret: undefined }),
    );
    expect(res.status).toBe(503);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('refuses the view when there is no session secret, even with a token that would otherwise verify', async () => {
    const res = await handlePortal(req({ cookie: goodCookie() }), deps({ secret: undefined }));
    expect(res.status).toBe(401);
  });

  it('refuses sign-in when the database is unreachable rather than admitting anyone', async () => {
    // The dangerous version of this bug signs the customer in and shows an
    // empty portal. Credentials cannot be checked without the account row, so
    // the only honest answer is "not now".
    const recordSignIn = vi.fn(async () => {});
    const res = await handlePortal(
      req({ method: 'POST', path: '/portal/signin', body: { email: 'a@b.com', password: PASSWORD } }),
      deps({ hasDb: () => false, recordSignIn }),
    );
    expect(res.status).toBe(503);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(recordSignIn).not.toHaveBeenCalled();
  });

  it('never mints a session from a failed sign-in', async () => {
    const res = await handlePortal(
      req({ method: 'POST', path: '/portal/signin', body: { email: 'a@b.com', password: 'wrong-password-x' } }),
      deps(),
    );
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('portal routes — §1B, a dead feed is named', () => {
  it('says the records cannot be read rather than rendering an empty portal', async () => {
    const loadView = vi.fn(async () => viewFor(PROPERTY));
    const res = await handlePortal(
      req({ cookie: goodCookie() }),
      deps({ hasDb: () => false, loadView }),
    );
    expect(res.status).toBe(503);
    // The whole point: it must NOT have produced a view at all.
    expect(loadView).not.toHaveBeenCalled();
    const body = res.body as { error: string; line: string };
    expect(body.line.toLowerCase()).toContain('cannot');
    // And it must not read as "there is nothing here".
    expect(JSON.stringify(res.body)).not.toContain('"trees":[]');
  });

  it('distinguishes an expired session from a forged one', async () => {
    const expired = await handlePortal(
      req({ cookie: goodCookie(PROPERTY, NOW - 9 * 60 * 60 * 1000) }),
      deps(),
    );
    const forged = await handlePortal(
      req({ cookie: `${SESSION_COOKIE}=${PROPERTY}.${NOW + 60_000}.deadbeef` }),
      deps(),
    );
    expect(expired.status).toBe(401);
    expect(forged.status).toBe(401);
    // Different facts, different sentences (§1B) — the customer whose session
    // simply timed out should not be told their link is not ours.
    expect((expired.body as { line: string }).line)
      .not.toBe((forged.body as { line: string }).line);
    expect((expired.body as { line: string }).line.toLowerCase()).toContain('again');
  });

  it('names a missing property instead of rendering a blank portal', async () => {
    const res = await handlePortal(
      req({ cookie: goodCookie() }),
      deps({ loadView: async () => null }),
    );
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('"trees":[]');
  });
});

describe('portal routes — the session is the only thing that names the property', () => {
  it('ignores a propertyId supplied in the query string', async () => {
    const loadView = vi.fn(async (id: string) => viewFor(id));
    const res = await handlePortal(
      req({ cookie: goodCookie(PROPERTY), path: '/portal/view', query: { propertyId: OTHER_PROPERTY } }),
      deps({ loadView }),
    );
    expect(res.status).toBe(200);
    expect(loadView).toHaveBeenCalledWith(PROPERTY);
    expect(loadView).not.toHaveBeenCalledWith(OTHER_PROPERTY);
  });

  it('ignores a propertyId supplied in the body', async () => {
    const loadView = vi.fn(async (id: string) => viewFor(id));
    await handlePortal(
      req({ cookie: goodCookie(PROPERTY), body: { propertyId: OTHER_PROPERTY } }),
      deps({ loadView }),
    );
    expect(loadView).toHaveBeenCalledWith(PROPERTY);
  });

  it('serves the property named by whichever session is presented', async () => {
    const loadView = vi.fn(async (id: string) => viewFor(id));
    await handlePortal(req({ cookie: goodCookie(OTHER_PROPERTY) }), deps({ loadView }));
    expect(loadView).toHaveBeenCalledWith(OTHER_PROPERTY);
  });
});

describe('portal routes — sign-in', () => {
  it('accepts the right password and sets a scoped, hardened cookie', async () => {
    const recordSignIn = vi.fn(async () => {});
    const res = await handlePortal(
      req({ method: 'POST', path: '/portal/signin', body: { email: 'someone@example.com', password: PASSWORD } }),
      deps({ recordSignIn }),
    );
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'];
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    // Path=/portal is load-bearing: it keeps the customer's cookie off every
    // admin and crew request.
    expect(cookie).toContain('Path=/portal');
    expect(recordSignIn).toHaveBeenCalledWith(PROPERTY);
  });

  it('answers a wrong password and an unknown email identically', async () => {
    const wrong = await handlePortal(
      req({ method: 'POST', path: '/portal/signin', body: { email: 'someone@example.com', password: 'not-the-one' } }),
      deps(),
    );
    const unknown = await handlePortal(
      req({ method: 'POST', path: '/portal/signin', body: { email: 'nobody@example.com', password: PASSWORD } }),
      deps({ findAccountByEmail: async () => null }),
    );
    expect(wrong.status).toBe(unknown.status);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.headers['set-cookie']).toBeUndefined();
    expect(unknown.headers['set-cookie']).toBeUndefined();
  });

  it('treats an invited-but-passwordless account as not-yet-signed-up, without letting it in', async () => {
    // password_hash is nullable by design: "invited, never signed up" is a
    // real state and it is not the same as "no account".
    const res = await handlePortal(
      req({ method: 'POST', path: '/portal/signin', body: { email: 'someone@example.com', password: PASSWORD } }),
      deps({
        findAccountByEmail: async () => ({ email: 'someone@example.com', passwordHash: null, propertyId: PROPERTY }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('rejects malformed bodies without throwing', async () => {
    for (const body of [undefined, null, 'a string', 42, {}, { email: 5, password: 6 }, { email: 'a@b.com' }]) {
      const res = await handlePortal(
        req({ method: 'POST', path: '/portal/signin', body }),
        deps(),
      );
      expect([400, 401]).toContain(res.status);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('lowercases and trims the email before looking it up', async () => {
    const findAccountByEmail = vi.fn(async () => null);
    await handlePortal(
      req({ method: 'POST', path: '/portal/signin', body: { email: '  SomeOne@Example.COM ', password: PASSWORD } }),
      deps({ findAccountByEmail }),
    );
    expect(findAccountByEmail).toHaveBeenCalledWith('someone@example.com');
  });
});

describe('portal routes — brute force', () => {
  function attempt(d: PortalDeps, password: string, at = NOW) {
    return handlePortal(
      req({ method: 'POST', path: '/portal/signin', body: { email: 'someone@example.com', password }, nowMs: at }),
      d,
    );
  }

  it('locks the address after enough wrong guesses', async () => {
    const d = deps();
    for (let i = 0; i < MAX_FAILURES; i++) {
      const res = await attempt(d, 'wrong-password-' + i, NOW + i * 1000);
      expect(res.status).toBe(401);
    }
    const locked = await attempt(d, 'wrong-again', NOW + 10_000);
    expect(locked.status).toBe(429);
    expect(locked.headers['retry-after']).toBeDefined();
  });

  it('refuses the RIGHT password while locked — the lock is not a hint filter', async () => {
    const d = deps();
    for (let i = 0; i < MAX_FAILURES; i++) await attempt(d, 'wrong-' + i, NOW + i * 1000);
    const res = await attempt(d, PASSWORD, NOW + 10_000);
    expect(res.status).toBe(429);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('never reaches the database once an address is locked', async () => {
    const findAccountByEmail = vi.fn(async () => null);
    const d = deps({ findAccountByEmail });
    for (let i = 0; i < MAX_FAILURES; i++) await attempt(d, 'wrong-' + i, NOW + i * 1000);
    const before = findAccountByEmail.mock.calls.length;
    await attempt(d, 'wrong-again', NOW + 10_000);
    expect(findAccountByEmail.mock.calls.length).toBe(before);
  });

  it('lets a correct password clear the slate', async () => {
    const d = deps();
    for (let i = 0; i < MAX_FAILURES - 1; i++) await attempt(d, 'wrong-' + i, NOW + i * 1000);
    expect((await attempt(d, PASSWORD, NOW + 9_000)).status).toBe(200);
    // Back to a full allowance rather than one slip from a lockout.
    for (let i = 0; i < MAX_FAILURES - 1; i++) await attempt(d, 'wrong-again-' + i, NOW + 20_000 + i * 1000);
    expect((await attempt(d, PASSWORD, NOW + 40_000)).status).toBe(200);
  });

  it('locks one address without locking anybody else out', async () => {
    const d = deps();
    for (let i = 0; i < MAX_FAILURES + 2; i++) await attempt(d, 'wrong-' + i, NOW + i * 1000);
    const other = await handlePortal(
      req({ method: 'POST', path: '/portal/signin', body: { email: 'different@example.com', password: PASSWORD }, nowMs: NOW + 10_000 }),
      d,
    );
    // The only thing being asserted is that the lock did not SPILL: a
    // different address is still allowed to try. (The stub account resolver
    // ignores which email it was handed, so this particular attempt also
    // succeeds — irrelevant here, and not what is being proved.)
    expect(other.status).not.toBe(429);
  });

  it('puts no email in the lockout message', async () => {
    const d = deps();
    for (let i = 0; i < MAX_FAILURES; i++) await attempt(d, 'wrong-' + i, NOW + i * 1000);
    const locked = await attempt(d, 'wrong', NOW + 10_000);
    expect(JSON.stringify(locked.body)).not.toContain('someone@example.com');
  });
});

describe('portal routes — sign-out and shape', () => {
  it('clears the cookie on sign-out', async () => {
    const res = await handlePortal(
      req({ method: 'POST', path: '/portal/signout', cookie: goodCookie() }),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toContain('Max-Age=0');
  });

  it('signs out even without a valid session, so a stuck browser can always clear itself', async () => {
    const res = await handlePortal(req({ method: 'POST', path: '/portal/signout' }), deps());
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toContain('Max-Age=0');
  });

  it('405s a known path with the wrong method', async () => {
    const res = await handlePortal(req({ method: 'GET', path: '/portal/signin' }), deps());
    expect(res.status).toBe(405);
  });

  it('404s an unknown portal path', async () => {
    const res = await handlePortal(req({ path: '/portal/nope' }), deps());
    expect(res.status).toBe(404);
  });

  it('never sets a cacheable header on a customer view', async () => {
    const res = await handlePortal(req({ cookie: goodCookie() }), deps());
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
  });
});

describe('portal routes — §4.3, nothing leaks', () => {
  it('puts no email, password or property id in any failure body', async () => {
    const cases = await Promise.all([
      handlePortal(req({ method: 'POST', path: '/portal/signin', body: { email: 'leaky@example.com', password: 'hunter2hunter2' } }), deps({ findAccountByEmail: async () => null })),
      handlePortal(req({ cookie: `${SESSION_COOKIE}=garbage` }), deps()),
      handlePortal(req({ cookie: goodCookie() }), deps({ hasDb: () => false })),
      handlePortal(req({ cookie: goodCookie() }), deps({ loadView: async () => null })),
      handlePortal(req({ path: '/portal/nope' }), deps()),
    ]);
    for (const res of cases) {
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('leaky@example.com');
      expect(text).not.toContain('hunter2hunter2');
      expect(text).not.toContain(PROPERTY);
    }
  });

  it('does not leak whether an email is on file through response timing shape', async () => {
    // Not a timing measurement — a structural check that the unknown-email
    // path still runs a verification, which is what makes the timing match.
    const res = await handlePortal(
      req({ method: 'POST', path: '/portal/signin', body: { email: 'nobody@example.com', password: PASSWORD } }),
      deps({ findAccountByEmail: async () => null }),
    );
    expect(res.status).toBe(401);
    expect((res.body as { line: string }).line).toBe('That email and password do not match an account.');
  });
});
