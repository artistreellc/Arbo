// R27 (D112) — the exact safety-class lines whose blind review is RECORDED in
// src/i18n/reviewed.json (pass "reviewed": a blind second translation agreed and
// a blind back-translation found no drift), and the ones HELD as drafts. Only a
// recorded line is served in Spanish; a held one shows in English under the
// Spanish pointer. test/esGlossaryTwinLedger.test.ts pins this list against the
// committed ledger, so a change to the ledger is a change here first. No line is
// at pass "person" — the phone read-through (Rudy, Marco or Temo; R27 #5) is
// still owed before crews rely on any of it.

/** Recorded (12): the glossary labels L0–L3, L5, L6; the stop-work orders L7–L9; the work-order lines L10, L11, L13. */
export const RECORDED_EN: readonly string[] = [
  'PERMIT LIKELY',
  'PERMIT: REVIEW NEEDED',
  'NO OVERLAY — VERIFY W/ CITY',
  'PERMIT SCREEN PENDING',
  'NO AERIAL WORK',
  'NO EXPIRY DATE',
  'Do not start work — call the office.',
  'Your work orders stay locked — do not start work; call the office to log your briefing.',
  'This is not an empty day — do not start work; call the office.',
  'POWER LINES — utility coordination required before work near conductors',
  'STRUCTURES nearby — plan drop zone accordingly',
  'PERMIT: REVIEW NEEDED — check with the office before cutting.',
];

/**
 * Held (5): L4 HELD (drift — the blind second translation says "do not drive —
 * out of service", the ledger "not driven — brakes/steering"), and the four
 * permit lines that say "protected work" (L12, L14, L15, L16 — no blind second
 * translation has agreed with "el trabajo que requiere permiso" yet).
 */
export const HELD_EN: readonly string[] = [
  'HELD',
  'PERMIT LIKELY — do not start protected work until the permit is confirmed.',
  'NO OVERLAY — VERIFY W/ CITY before protected work.',
  'PERMIT STATUS UNKNOWN — Arbo could not read the permit screen. Check with the office before protected work.',
  'PERMIT SCREEN PENDING — status UNKNOWN, no screen on file. Check with the office before protected work.',
];

/** One character changed, at the end: the same Spanish with its last letter's case flipped (or a period added). */
export function oneCharEdit(es: string): string {
  const last = es.slice(-1);
  const flipped = last === last.toUpperCase() ? last.toLowerCase() : last.toUpperCase();
  return flipped !== last ? es.slice(0, -1) + flipped : es + '.';
}
