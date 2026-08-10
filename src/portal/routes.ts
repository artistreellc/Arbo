/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  ═══════════════════════════════════════════════════════════════════════

  This is the only surface in Arbo a stranger can reach without Mike's key.
  The admin API is behind `x-arbor-key`; the crew door is behind the same
  server; this one is behind a password a customer chose. Read every line
  before you change one, and if something here looks redundant, assume it is
  load-bearing until you have proved otherwise.
*/
// THE THIRD DOOR'S HANDLERS (task #35, cycle 11).
//
// The portal spine shipped a while ago and was wired to NOTHING: session.ts
// could mint and verify, account.ts could hash and check, customerView.ts
// could shape a whole page, migration 0019 made the tables — and no route
// ever called any of it. This file is the connection, and nothing more. It
// contains no policy of its own: every decision it makes is delegated to a
// module that was already reviewed.
//
// FOUR RULES THIS FILE EXISTS TO ENFORCE
//
// 1. IT FAILS CLOSED. No secret → nobody in. No database → nobody in, and
//    nothing rendered. There is no dev bypass and no default. The expensive
//    failure is a stranger reading a customer's property, not a customer
//    seeing "not right now".
//
// 2. §1B — A DEAD FEED IS NAMED. "We cannot read your records" and "you have
//    no trees" are different facts. When the database is down this returns a
//    503 that says so and NEVER calls loadView, because a half-built view is
//    indistinguishable from an empty property.
//
// 3. THE SESSION IS THE ONLY THING THAT NAMES THE PROPERTY. Not the query
//    string, not the body, not a header. `readSession` returns a property id
//    and that id is the only one this file will ever pass to `loadView`. Any
//    other source is an IDOR waiting to happen, so there is exactly one line
//    in this file that decides which property is loaded.
//
// 4. §4.3 — NOTHING LEAKS. Failure bodies carry a sentence and an error code.
//    No email, no property id, no name, no address, ever.

import type { PortalView } from './customerView.js';
import { signIn } from './account.js';
import {
  clearedCookie,
  cookieFrom,
  mintSession,
  readSession,
  sessionCookie,
} from './session.js';

/** One portal account as the database hands it over. */
export interface PortalAccountRow {
  email: string;
  /**
   * Null means "invited, never signed up" — a real state (migration 0019
   * makes the column nullable on purpose) and NOT the same as "no account".
   * It still cannot sign in; it just is not a lie to say the row exists.
   */
  passwordHash: string | null;
  propertyId: string;
}

/**
 * Everything this file cannot do for itself. Injected rather than imported so
 * the handlers can be tested without a socket or a database — and so this
 * module physically cannot reach a table on its own.
 */
export interface PortalDeps {
  secret: string | undefined;
  hasDb: () => boolean;
  findAccountByEmail(email: string): Promise<PortalAccountRow | null>;
  /** Null means the property is gone. Distinct from a throw, which is an outage. */
  loadView(propertyId: string): Promise<PortalView | null>;
  recordSignIn(propertyId: string): Promise<void>;
}

export interface PortalRequest {
  method: string;
  /** Path only — the caller strips the query before handing it over. */
  path: string;
  cookie: string | undefined;
  body: unknown;
  /**
   * Present so the tests can prove it is IGNORED. Nothing in this file reads
   * it, and nothing in this file ever should.
   */
  query?: Record<string, string>;
  nowMs: number;
}

export interface PortalResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** Never cached. A customer's property is not a static asset. */
const BASE_HEADERS: Record<string, string> = { 'cache-control': 'no-store' };

function fail(status: number, error: string, line: string): PortalResponse {
  return { status, headers: { ...BASE_HEADERS }, body: { error, line } };
}

/**
 * The one sentence a failed sign-in ever produces. It is identical for a wrong
 * password and an unknown email — telling them apart would let anyone test
 * which of Mike's customers have accounts. account.ts already returns exactly
 * this string; it is repeated in the test, not here, so there is one source.
 */
function signInRejected(line: string): PortalResponse {
  return fail(401, 'sign_in_failed', line);
}

export async function handlePortal(req: PortalRequest, deps: PortalDeps): Promise<PortalResponse> {
  if (req.path === '/portal/signin') {
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST to sign in.');
    return signInRoute(req, deps);
  }
  if (req.path === '/portal/signout') {
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST to sign out.');
    // Deliberately unconditional. A browser holding a token this server will
    // never accept must always be able to throw it away — requiring a valid
    // session to sign out would strand exactly the people trying to recover.
    return {
      status: 200,
      headers: { ...BASE_HEADERS, 'set-cookie': clearedCookie() },
      body: { ok: true, line: 'Signed out.' },
    };
  }
  if (req.path === '/portal/view') {
    if (req.method !== 'GET') return fail(405, 'method_not_allowed', 'Use GET to read your property.');
    return viewRoute(req, deps);
  }
  return fail(404, 'not_found', 'That is not a page on this portal.');
}

async function signInRoute(req: PortalRequest, deps: PortalDeps): Promise<PortalResponse> {
  // Order matters. The two "cannot possibly work" cases are answered before
  // any credential is touched, so a misconfigured portal never half-runs a
  // login. Both are 503: the customer did nothing wrong.
  if (!deps.secret) {
    return fail(503, 'portal_unconfigured', 'The portal is not switched on yet. Mike can turn it on.');
  }
  if (!deps.hasDb()) {
    // The dangerous version of this branch signs them in anyway and shows an
    // empty page. Credentials cannot be checked without the account row, so
    // "not now" is the only honest answer — and the only safe one.
    return fail(503, 'records_unavailable', 'We cannot reach your records right now, so we cannot sign you in. Please try again shortly.');
  }

  const body = req.body;
  if (typeof body !== 'object' || body === null) {
    return fail(400, 'bad_request', 'Send an email and a password.');
  }
  const { email, password } = body as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || typeof password !== 'string') {
    return fail(400, 'bad_request', 'Send an email and a password.');
  }

  // Normalised the same way provisionPortalInvite() stored it, or the row
  // would never be found and every correct password would look wrong.
  const normalised = email.trim().toLowerCase();

  const account = await deps.findAccountByEmail(normalised);

  // A passwordless row is passed through as `null`. signIn() spends the same
  // scrypt time on null as on a real hash, so "invited but never signed up"
  // takes exactly as long as "no such account" — the timing tells a stranger
  // nothing about which addresses are on file.
  const result = signIn(
    account && account.passwordHash
      ? { email: account.email, passwordHash: account.passwordHash, propertyId: account.propertyId }
      : null,
    password,
  );
  if (!result.ok) return signInRejected(result.line);

  const token = mintSession(result.propertyId, req.nowMs, deps.secret);
  if (!token) {
    // mint refuses a property id containing the delimiter. Unreachable with
    // UUIDs, handled anyway: a null token must never become a signed-in state.
    return fail(500, 'session_failed', 'We could not start your session. Please try again.');
  }

  await deps.recordSignIn(result.propertyId);

  return {
    status: 200,
    headers: { ...BASE_HEADERS, 'set-cookie': sessionCookie(token) },
    body: { ok: true },
  };
}

async function viewRoute(req: PortalRequest, deps: PortalDeps): Promise<PortalResponse> {
  const session = readSession(cookieFrom(req.cookie), req.nowMs, deps.secret);
  if (!session.ok) {
    // Each rejection gets its own sentence (§1B). A customer whose session
    // simply timed out must not be told their link was never ours — that
    // reads as an accusation and sends them to the phone instead of the
    // sign-in box.
    switch (session.reason) {
      case 'expired':
        return fail(401, 'session_expired', 'Your session has timed out. Please sign in again.');
      case 'no_secret':
        return fail(401, 'portal_unconfigured', 'The portal is not switched on yet. Mike can turn it on.');
      default:
        return fail(401, 'not_signed_in', 'Please sign in to see your property.');
    }
  }

  // §1B, and the reason loadView is not called: a view built while the links
  // are cut would render as a property with no trees, no work and nothing
  // owing — which is exactly what a real customer with nothing owing sees.
  // Those two must never be the same page.
  if (!deps.hasDb()) {
    return fail(503, 'records_unavailable', 'We cannot read your records right now. Nothing is wrong with your account — please try again shortly.');
  }

  // THE ONLY LINE THAT DECIDES WHICH PROPERTY IS LOADED. It reads from the
  // verified session and from nowhere else. req.query and req.body are not
  // consulted here or anywhere below.
  const view = await deps.loadView(session.propertyId);

  if (!view) {
    return fail(404, 'property_not_found', 'We could not find your property. Please call Mike so he can look at it.');
  }

  return { status: 200, headers: { ...BASE_HEADERS }, body: view };
}
