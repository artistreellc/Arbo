/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  ═══════════════════════════════════════════════════════════════════════
*/
// SIGN-IN THROTTLING FOR THE CUSTOMER DOOR (task #35, cycle 12).
//
// Cycle 11 wired a login a stranger can reach. scrypt at N=16384 costs about
// 100ms per guess, which is a floor on throughput but not a lock — left alone
// it is roughly 800 guesses a minute against a customer's password.
//
// ═══ WHY IT COUNTS EMAILS AND NOT IP ADDRESSES ═══
// The obvious second key is the client IP, and it is deliberately NOT used.
// Behind Railway's proxy the socket address is the PROXY, so an IP bucket
// would put every customer in the world into one counter: eight wrong
// guesses by anybody and the portal locks for everyone. The alternative,
// trusting `x-forwarded-for`, is a header the client can simply write, so it
// throttles only the attackers who choose to be throttled.
//
// A self-inflicted global lockout is a worse bug than the one being fixed.
// So: one counter per email address. An attacker spraying many addresses gets
// MAX_FAILURES tries at each, at ~100ms of scrypt apiece, against a customer
// list of a few dozen. That is the honest trade, written down rather than
// discovered later.
//
// ═══ IT IS IN MEMORY, AND THAT IS A REAL LIMIT ═══
// One process, one Map. A restart forgets every counter, and a second server
// instance would keep its own. For one Railway service that is correct and
// needs no table, no cleanup job and no second place for state to live. If
// Arbo ever runs two instances this becomes per-instance and needs revisiting
// — flagged here rather than pretended away.

/** Failures allowed inside the window before the address is locked. */
export const MAX_FAILURES = 8;

/** How long failures are remembered, and how long a lockout lasts. */
export const WINDOW_MS = 15 * 60 * 1000;

/** Prune no more than once a minute — it is a housekeeping sweep, not a hot path. */
const PRUNE_INTERVAL_MS = 60 * 1000;

interface Bucket {
  count: number;
  /** When the most recent failure landed. The window is measured from here. */
  lastFailureMs: number;
}

export type ThrottleCheck =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number };

export interface SignInThrottle {
  /** May this address try right now? */
  check(key: string, nowMs: number): ThrottleCheck;
  recordFailure(key: string, nowMs: number): void;
  /** A correct password wipes the slate. */
  recordSuccess(key: string): void;
  /** Entries currently held. Exposed so a test can prove pruning happens. */
  size(): number;
}

export function createSignInThrottle(): SignInThrottle {
  const buckets = new Map<string, Bucket>();
  let lastPruneMs = 0;

  /**
   * Drop every bucket whose window has passed. Without this, one spray of
   * made-up addresses is a permanent leak on a server that runs for weeks.
   * Only entries that are already expired are removed, so pruning can never
   * unlock somebody who is still inside their window.
   */
  function prune(nowMs: number): void {
    if (nowMs - lastPruneMs < PRUNE_INTERVAL_MS) return;
    lastPruneMs = nowMs;
    for (const [key, b] of buckets) {
      if (nowMs - b.lastFailureMs >= WINDOW_MS) buckets.delete(key);
    }
  }

  return {
    check(key, nowMs) {
      const b = buckets.get(key);
      if (!b) return { allowed: true };
      const elapsed = nowMs - b.lastFailureMs;
      if (elapsed >= WINDOW_MS) return { allowed: true };
      if (b.count < MAX_FAILURES) return { allowed: true };
      // Ceil so "0 seconds" is never reported to somebody who is still locked.
      return { allowed: false, retryAfterSec: Math.ceil((WINDOW_MS - elapsed) / 1000) };
    },

    recordFailure(key, nowMs) {
      prune(nowMs);
      const b = buckets.get(key);
      // A failure after the window has lapsed starts a fresh count rather than
      // resuming an old one — otherwise a single stale failure from an hour
      // ago would sit there making the next seven feel like eight.
      if (!b || nowMs - b.lastFailureMs >= WINDOW_MS) {
        buckets.set(key, { count: 1, lastFailureMs: nowMs });
        return;
      }
      b.count += 1;
      b.lastFailureMs = nowMs;
    },

    recordSuccess(key) {
      buckets.delete(key);
    },

    size() {
      return buckets.size;
    },
  };
}
