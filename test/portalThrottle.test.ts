// Sign-in throttling for the third door (task #35, cycle 12).
//
// Cycle 11 shipped a login a stranger can reach with nothing in front of it
// but scrypt's ~100ms. That is a real floor, but it is not a lock. These
// tests specify the lock — and, just as importantly, they specify the ways it
// is NOT allowed to misfire, because a throttle that locks the wrong people
// out is a denial of service you built yourself.

import { describe, it, expect } from 'vitest';
import { createSignInThrottle, MAX_FAILURES, WINDOW_MS } from '../src/portal/throttle.js';

const T0 = Date.UTC(2026, 7, 10, 12, 0, 0);
const KEY = 'someone@example.com';

describe('sign-in throttle', () => {
  it('lets a normal person in', () => {
    const t = createSignInThrottle();
    expect(t.check(KEY, T0).allowed).toBe(true);
  });

  it('tolerates a few fat-fingered attempts', () => {
    const t = createSignInThrottle();
    for (let i = 0; i < MAX_FAILURES - 1; i++) t.recordFailure(KEY, T0 + i * 1000);
    expect(t.check(KEY, T0 + 10_000).allowed).toBe(true);
  });

  it('locks after the limit and says how long to wait', () => {
    const t = createSignInThrottle();
    for (let i = 0; i < MAX_FAILURES; i++) t.recordFailure(KEY, T0 + i * 1000);
    const res = t.check(KEY, T0 + 10_000);
    expect(res.allowed).toBe(false);
    if (!res.allowed) {
      expect(res.retryAfterSec).toBeGreaterThan(0);
      expect(res.retryAfterSec).toBeLessThanOrEqual(WINDOW_MS / 1000);
    }
  });

  it('forgets old failures once the window has passed', () => {
    const t = createSignInThrottle();
    for (let i = 0; i < MAX_FAILURES; i++) t.recordFailure(KEY, T0 + i * 1000);
    expect(t.check(KEY, T0 + 10_000).allowed).toBe(false);
    expect(t.check(KEY, T0 + WINDOW_MS + 60_000).allowed).toBe(true);
  });

  it('clears the count the moment somebody actually signs in', () => {
    const t = createSignInThrottle();
    for (let i = 0; i < MAX_FAILURES - 1; i++) t.recordFailure(KEY, T0 + i * 1000);
    t.recordSuccess(KEY);
    // A customer who mistyped four times and then got it right must not be
    // one slip away from a lockout for the rest of the window.
    for (let i = 0; i < MAX_FAILURES - 1; i++) t.recordFailure(KEY, T0 + 20_000 + i * 1000);
    expect(t.check(KEY, T0 + 40_000).allowed).toBe(true);
  });

  it('locks one address without touching anybody else', () => {
    // The failure mode that matters: one customer under attack must not lock
    // out every other customer.
    const t = createSignInThrottle();
    for (let i = 0; i < MAX_FAILURES * 3; i++) t.recordFailure('victim@example.com', T0 + i * 1000);
    expect(t.check('victim@example.com', T0).allowed).toBe(false);
    expect(t.check('someone.else@example.com', T0).allowed).toBe(true);
  });

  it('does not grow without bound', () => {
    // Every failed attempt at a made-up address would otherwise be a
    // permanent entry in a Map on a long-lived server.
    const t = createSignInThrottle();
    for (let i = 0; i < 5000; i++) t.recordFailure(`spray-${i}@example.com`, T0 + i);
    // One late attempt is enough to trigger the sweep of expired entries.
    t.recordFailure('last@example.com', T0 + WINDOW_MS * 2);
    expect(t.size()).toBeLessThan(100);
    // And pruning must not have unlocked anyone who is still inside a window.
    for (let i = 0; i < MAX_FAILURES; i++) t.recordFailure(KEY, T0 + WINDOW_MS * 2 + i);
    expect(t.check(KEY, T0 + WINDOW_MS * 2 + 1000).allowed).toBe(false);
  });
});
