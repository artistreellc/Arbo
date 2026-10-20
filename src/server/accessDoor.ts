// The /api door (audit 2026-10-20, Lane A: M1, M2, L1, L2). One place decides
// whether a request may pass, so server.ts carries a single call.
//
// M1  No APP_ACCESS_KEY on the server = every /api route is LOCKED (401
//     no_app_key), in every data mode. The old door opened keyless whenever
//     the data links were cut, on the idea that there was nothing to leak —
//     but Sona's calls, transcripts, relayed texts and inbox cards never lived
//     in the database. There is no keyless carve-out, not even the practice
//     data (sim): Quo, Gmail and the relays are real in every mode.
// L1  The key is read from the x-arbor-key header ONLY. ?key= in a web
//     address ends up in history, screenshots and the edge's request logs, so
//     it is never even compared — the 401 says to use the header instead. (The
//     webhook routes /webhooks/railway and /webhooks/twilio/sms carry their OWN
//     ?key= secrets for services that cannot send headers; they are separate
//     doors with separate keys and are not touched here.)
// L2  Keys are compared in constant time (src/lib/secretEqual.ts).
// M2  Wrong keys are limited per connection: 10 DIFFERENT wrong keys inside
//     10 minutes, and that connection gets one key check a minute for the next
//     15 minutes (429 too_many_attempts + Retry-After). Each wrong key on a
//     check starts the 15 minutes again.
//       - A missing key never counts (Mike's phone fires ~30 keyless calls per
//         page load before the key is entered).
//       - The SAME wrong key sent again counts once: a phone still holding
//         the old key after a key change fires the same stale key at every
//         call, and that must never throttle Mike.
//       - A real key at the wrong door (the crew key on Mike's routes) is not
//         a guess and never counts.
//       - The owner door and the crew door count apart, so crew typos on the
//         yard Wi-Fi never slow Mike's side.
//       - Per connection, never global: a guesser anywhere else can never
//         slow Mike down. Across all connections Arbo only logs a loud line.
//       - The right key opens on the next check (at most a minute) and lifts
//         the throttle, so Mike's app works at once. It does NOT wipe the
//         count of different wrong keys: the app sends the right key every
//         minute, so wiping it let a guesser on Mike's own connection take 9
//         guesses a minute forever. Now a NEW wrong key from that connection
//         inside the ten minutes throttles it again at once; a key already
//         counted (a tab still holding a typo) never does. A guesser on the
//         SAME connection as Mike could still take the one-a-minute checks —
//         said by name in the 429 ("switch networks"), because the right key
//         cannot both always pass and stop a guesser who shares its address.
//     In memory, capped, counted in /health — never an address, never a key.
//
// The connection is the X-Real-IP header Railway's edge sets ("for
// identifying client's remote IP", docs.railway.com specs-and-limits), else
// the socket's own address off Railway. On Railway with no X-Real-IP the
// request is NOT counted, rather than pool every client into one address
// (that would be a global lockout).
import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { secretEqual } from '../lib/secretEqual.js';

export type Door = 'owner' | 'crew';

/** The key a request carries: the x-arbor-key header, and nothing else (L1). */
export function keyFromHeader(headers: IncomingHttpHeaders): string | undefined {
  const h = headers['x-arbor-key'];
  return typeof h === 'string' && h !== '' ? h : undefined;
}

/**
 * Which connection a request came from, for counting wrong keys only — never
 * logged, never returned. null = do not count this request.
 */
export function clientAddress(
  req: { headers: IncomingHttpHeaders; socket?: { remoteAddress?: string | undefined } | null },
  behindRailway: boolean,
): string | null {
  const real = req.headers['x-real-ip'];
  // Node joins two X-Real-IP headers into "a, b". The first can be the
  // client's own; one the edge adds comes last, so the last is the one read.
  // (If the edge overwrites the client's, there is only one and nothing changes.)
  const last = typeof real === 'string' ? (real.split(',').pop() ?? '').trim() : '';
  if (last !== '') return last.slice(0, 64);
  if (behindRailway) return null;
  return req.socket?.remoteAddress ?? null;
}

export interface GuardCounts {
  wrongKeysSinceBoot: number;
  throttlesSinceBoot: number;
  throttledNow: number;
  refusedWhileThrottledSinceBoot: number;
}

interface Rec {
  /** Short fingerprints of the different wrong keys seen in this window. */
  seen: Set<string>;
  firstAt: number;
  throttledUntil: number;
  nextCheckAt: number;
}

export interface KeyGuardOptions {
  now?: () => number;
  log?: (line: string) => void;
  /** Different wrong keys that throttle a connection. Default 10. */
  maxDistinct?: number;
  /** The window those are counted in. Default 10 minutes. */
  windowMs?: number;
  /** How long a connection stays throttled after its last wrong key. Default 15 minutes. */
  throttleMs?: number;
  /** One key check per this long while throttled. Default 1 minute. */
  checkEveryMs?: number;
  /** Connections remembered at most (least recently touched forgotten first). Default 5000. */
  maxTracked?: number;
  /** Wrong keys across ALL connections in one window before the loud line. Default 100. */
  alarmAt?: number;
}

const secs = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));

export class KeyAttemptGuard {
  private readonly recs = new Map<string, Rec>();
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly maxDistinct: number;
  private readonly windowMs: number;
  private readonly throttleMs: number;
  private readonly checkEveryMs: number;
  private readonly maxTracked: number;
  private readonly alarmAt: number;
  private wrongTotal = 0;
  private throttles = 0;
  private refused = 0;
  private lastLoudAt = -Infinity;
  private quiet = 0;
  private allWindowStart = -Infinity;
  private allWindowWrong = 0;

  constructor(o: KeyGuardOptions = {}) {
    this.now = o.now ?? Date.now;
    this.log = o.log ?? ((line) => console.error(line));
    this.maxDistinct = o.maxDistinct ?? 10;
    this.windowMs = o.windowMs ?? 10 * 60_000;
    this.throttleMs = o.throttleMs ?? 15 * 60_000;
    this.checkEveryMs = o.checkEveryMs ?? 60_000;
    this.maxTracked = o.maxTracked ?? 5000;
    this.alarmAt = o.alarmAt ?? 100;
  }

  /**
   * Before a key is compared: may it be checked at all? Not throttled, yes.
   * Throttled, only the first keyed request each minute (the check).
   */
  admit(door: Door, addr: string | null): { ok: true } | { ok: false; retryAfterSec: number } {
    if (!addr) return { ok: true };
    const k = `${door}|${addr}`;
    const r = this.recs.get(k);
    const now = this.now();
    if (!r || r.throttledUntil <= now) return { ok: true };
    this.touch(k, r);
    if (now >= r.nextCheckAt) {
      r.nextCheckAt = now + this.checkEveryMs;
      return { ok: true };
    }
    this.refused++;
    return { ok: false, retryAfterSec: secs(r.nextCheckAt - now) };
  }

  /**
   * The right key: the throttle is lifted at once. The count of different
   * wrong keys stays until its window runs out — never wiped by the right key.
   */
  right(door: Door, addr: string | null): void {
    if (!addr) return;
    const r = this.recs.get(`${door}|${addr}`);
    if (r) { r.throttledUntil = 0; r.nextCheckAt = 0; }
  }

  /** A wrong key (never a missing one). Says whether this connection is now throttled. */
  wrong(door: Door, addr: string | null, given: string): { throttled: false } | { throttled: true; retryAfterSec: number } {
    const now = this.now();
    this.wrongTotal++;
    this.alarmAcrossAll(now);
    if (!addr) return { throttled: false };
    const k = `${door}|${addr}`;
    let r = this.recs.get(k);
    if (r && r.throttledUntil > now) {
      // A wrong key on the minute's check: the 15 minutes start again.
      r.throttledUntil = now + this.throttleMs;
      this.touch(k, r);
      return { throttled: true, retryAfterSec: secs(r.nextCheckAt - now) };
    }
    if (!r || now - r.firstAt >= this.windowMs) r = { seen: new Set(), firstAt: now, throttledUntil: 0, nextCheckAt: 0 };
    this.touch(k, r);
    // A fingerprint, never the key: the set only has to tell keys apart.
    const fp = createHash('sha256').update(given, 'utf8').digest('hex').slice(0, 16);
    // A key already counted is not a new guess: after the right key lifts a
    // throttle, a stale typo still in a tab must not throttle Mike again.
    if (r.seen.has(fp)) return { throttled: false };
    r.seen.add(fp);
    if (r.seen.size < this.maxDistinct) return { throttled: false };
    r.throttledUntil = now + this.throttleMs;
    r.nextCheckAt = now + this.checkEveryMs;
    this.throttles++;
    this.loud(now, door);
    return { throttled: true, retryAfterSec: secs(this.checkEveryMs) };
  }

  /** For /health: counts only — never an address, never a key. */
  counts(): GuardCounts {
    const now = this.now();
    let throttledNow = 0;
    for (const [k, r] of this.recs) {
      if (r.throttledUntil > now) throttledNow++;
      else if (now - r.firstAt >= this.windowMs) this.recs.delete(k); // spent: forget it
    }
    return {
      wrongKeysSinceBoot: this.wrongTotal,
      throttlesSinceBoot: this.throttles,
      throttledNow,
      refusedWhileThrottledSinceBoot: this.refused,
    };
  }

  /** Remembered connections (tests: the cap holds). */
  get tracked(): number {
    return this.recs.size;
  }

  private touch(k: string, r: Rec): void {
    this.recs.delete(k);
    this.recs.set(k, r);
    while (this.recs.size > this.maxTracked) {
      const oldest = this.recs.keys().next().value;
      if (oldest === undefined) break;
      this.recs.delete(oldest);
    }
  }

  private throttledNow(now: number): number {
    let n = 0;
    for (const r of this.recs.values()) if (r.throttledUntil > now) n++;
    return n;
  }

  /** One loud line per minute at most, so a guesser cannot flood the log. */
  private loud(now: number, door: Door): void {
    if (now - this.lastLoudAt < 60_000) { this.quiet++; return; }
    const more = this.quiet ? ` (+${this.quiet} more since the last line)` : '';
    this.quiet = 0;
    this.lastLoudAt = now;
    this.log(`[access] a connection sent ${this.maxDistinct} different wrong keys to the ${door} door — it now gets one key check a minute for ${Math.round(this.throttleMs / 60_000)} minutes${more}. Throttled now: ${this.throttledNow(now)}; wrong keys since boot: ${this.wrongTotal}. No address or key is logged.`);
  }

  /** Never a global lockout — across all connections, only a loud line, once per window. */
  private alarmAcrossAll(now: number): void {
    if (now - this.allWindowStart >= this.windowMs) {
      this.allWindowStart = now;
      this.allWindowWrong = 0;
    }
    this.allWindowWrong++;
    if (this.allWindowWrong === this.alarmAt) {
      this.log(`[access] ${this.alarmAt} wrong keys across all connections in ${Math.round(this.windowMs / 60_000)} minutes — someone may be guessing Arbo's keys. Nobody is locked out by this; each connection is limited on its own.`);
    }
  }
}

// ─── The door ───────────────────────────────────────────────────────────────

const NO_APP_KEY = 'APP_ACCESS_KEY is not set on the server, so Arbo is locked and no key can open it. Set it on Railway and deploy again.';
const OWNER_NEEDS_KEY = 'Arbo needs the app key. Enter it on the app’s key screen — an iPhone Shortcut sends it in the x-arbor-key header.';
const OWNER_WRONG_KEY = 'That is not the app key. Check it and enter it again on the app’s key screen.';
const KEY_IN_URL = 'A key in the web address is not accepted — it would end up in history and logs. Send it in the x-arbor-key header (the app does this once the key is entered on its key screen).';
const CREW_NEEDS_KEY = 'The crew door needs its key. Enter the crew door key from the office.';
const CREW_WRONG_KEY = 'That is not the crew door key. Check it with the office.';
const CREW_KEY_AT_OWNER = 'The crew door key opens the crew door only. This needs the app key.';
const CREW_NOT_SET = 'No crew door key has been set up on the server yet. Ask Mike to set one.';
const throttledLine = (s: number) =>
  `Too many different wrong keys from this connection. Arbo now checks one key a minute from it: wait ${s} seconds, then enter the right key — or switch networks (Wi-Fi or cellular).`;

export type DoorAnswer =
  | { ok: true }
  | { ok: false; status: 401 | 429; body: { error: string; message: string; retryAfterSec?: number }; retryAfterSec?: number };

const refuse = (error: string, message: string): DoorAnswer => ({ ok: false, status: 401, body: { error, message } });
const throttled = (retryAfterSec: number): DoorAnswer => ({
  ok: false,
  status: 429,
  body: { error: 'too_many_attempts', message: throttledLine(retryAfterSec), retryAfterSec },
  retryAfterSec,
});

/**
 * May this /api request pass? `given` is keyFromHeader()'s answer; `keyInUrl`
 * only changes the words of a 401 — a ?key= is never compared (L1).
 */
export function checkApiDoor(i: {
  pathname: string;
  given: string | undefined;
  keyInUrl: boolean;
  addr: string | null;
  appKey: string | undefined;
  crewKey: string | undefined;
  guard: KeyAttemptGuard;
}): DoorAnswer {
  const crewDoor = i.pathname.startsWith('/api/crew/');
  // M1: no app key on the server — locked, in every data mode, whatever was sent.
  if (!i.appKey) return refuse('no_app_key', NO_APP_KEY);
  // D89: with no CREW_ACCESS_KEY there is no crew key to ask for — said by name.
  const crewNotSet = crewDoor && !i.crewKey;
  if (i.given === undefined) {
    if (crewNotSet) return refuse('crew_key_not_set', CREW_NOT_SET);
    return refuse('unauthorized', i.keyInUrl ? KEY_IN_URL : crewDoor ? CREW_NEEDS_KEY : OWNER_NEEDS_KEY);
  }
  const door: Door = crewDoor ? 'crew' : 'owner';
  const admit = i.guard.admit(door, i.addr);
  if (!admit.ok) return throttled(admit.retryAfterSec);
  const isApp = secretEqual(i.given, i.appKey);
  const isCrew = secretEqual(i.given, i.crewKey);
  // R25: the crew key opens the crew door's own routes and nothing else.
  if (isApp || (crewDoor && isCrew)) {
    i.guard.right(door, i.addr);
    return { ok: true };
  }
  if (isCrew) return refuse('unauthorized', CREW_KEY_AT_OWNER); // a real key at the wrong door is not a guess
  const w = i.guard.wrong(door, i.addr, i.given);
  if (w.throttled) return throttled(w.retryAfterSec);
  if (crewNotSet) return refuse('crew_key_not_set', CREW_NOT_SET);
  return refuse('unauthorized', crewDoor ? CREW_WRONG_KEY : OWNER_WRONG_KEY);
}

/** The boot line: whether each key is set — never a value (M1). */
export function accessBootLine(appKeySet: boolean, crewKeySet: boolean): { ok: boolean; line: string } {
  if (!appKeySet) {
    return {
      ok: false,
      line: '[access] APP_ACCESS_KEY is NOT SET — every /api route answers 401 no_app_key and the app shows its key screen. Set it on Railway and deploy again.',
    };
  }
  return {
    ok: true,
    line: `[access] /api needs the app key (x-arbor-key header only, never ?key=); crew door key ${crewKeySet ? 'set' : 'NOT set (the crew door says so by name)'}; 10 different wrong keys from one connection in 10 minutes slow it to one check a minute.`,
  };
}
