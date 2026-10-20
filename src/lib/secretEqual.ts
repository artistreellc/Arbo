// Constant-time secret comparison (audit 2026-10-20, L2).
//
// Arbo's door keys (APP_ACCESS_KEY, CREW_ACCESS_KEY) and the ElevenLabs bridge
// bearer were compared with === / !==, which stops at the first different
// character — the time it takes can leak how much of a guess was right. Both
// sides are SHA-256 hashed first, so timingSafeEqual always compares 32 bytes:
// neither the content nor the LENGTH of the real secret shows in the timing.
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * True only when `given` is a non-empty string equal to a non-empty `expected`.
 * Anything else — a missing header, a repeated header Node handed over as an
 * array, a number, an empty string, or no secret configured — is never equal.
 */
export function secretEqual(given: unknown, expected: string | null | undefined): boolean {
  if (typeof given !== 'string' || given === '') return false;
  if (typeof expected !== 'string' || expected === '') return false;
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
