// R27 (D112) — the exact safety-class lines whose blind review is RECORDED in
// src/i18n/reviewed.json (pass "reviewed": a blind second translation agreed and
// a blind back-translation found no drift), and the ones HELD as drafts. Only a
// recorded line is served in Spanish; a held one shows in English under the
// Spanish pointer. test/esGlossaryTwinLedger.test.ts pins this list against the
// committed ledger, so a change to the ledger is a change here first. No line is
// at pass "person" — the phone read-through (Rudy, Marco or Temo; R27 #5) is
// still owed before crews rely on any of it.

/**
 * Recorded (17 — every ledger line), in ledger order: the seven glossary labels L0–L6 (HELD, L4,
 * with new Spanish since D112's held-five round); the stop-work orders L7–L9; the work-order lines
 * L10–L16 — the four that say "protected work" (L12, L14, L15, L16) since D112's protected-work
 * round, their Spanish unchanged.
 */
export const RECORDED_EN: readonly string[] = [
  'PERMIT LIKELY',
  'PERMIT: REVIEW NEEDED',
  'NO OVERLAY — VERIFY W/ CITY',
  'PERMIT SCREEN PENDING',
  'HELD',
  'NO AERIAL WORK',
  'NO EXPIRY DATE',
  'Do not start work — call the office.',
  'Your work orders stay locked — do not start work; call the office to log your briefing.',
  'This is not an empty day — do not start work; call the office.',
  'POWER LINES — utility coordination required before work near conductors',
  'STRUCTURES nearby — plan drop zone accordingly',
  'PERMIT LIKELY — do not start protected work until the permit is confirmed.',
  'PERMIT: REVIEW NEEDED — check with the office before cutting.',
  'NO OVERLAY — VERIFY W/ CITY before protected work.',
  'PERMIT STATUS UNKNOWN — Arbo could not read the permit screen. Check with the office before protected work.',
  'PERMIT SCREEN PENDING — status UNKNOWN, no screen on file. Check with the office before protected work.',
];

/**
 * The exact pairs the blind review passed, by fingerprint (pairSha(en, es)), in the
 * same order as RECORDED_EN. Pinning the English alone would let a recorded line's
 * Spanish be edited and re-marked "reviewed" with a fresh sha unnoticed; a Spanish
 * change here means a new blind review first (D112 verify). HELD's is the pair
 * "HELD" → "NO LO MANEJE NI LO USE — FUERA DE SERVICIO (FRENOS O DIRECCIÓN)" (D112,
 * held-five round); the plan's "NO SE MANEJA — FRENOS/DIRECCIÓN" was never recorded.
 * The four "protected work" lines are recorded with the very Spanish D111 wrote (their
 * fingerprints are the ones they carried as drafts).
 */
export const RECORDED_SHA: readonly string[] = [
  '599563718f51c47c2f40d7ed9184af4eb6d3980a955cae8c3de86f6a4bdfee42',
  'f9fcaf3eba494eab26db1adbeff595ec33db818dc7858498027487ce2e4d8542',
  '991333dcd2506c390e75680e446a7305f008b9ce8a4a7441c1ee293bad6d9eee',
  'f3e9021d3831b55c1b098dbc6f389397537c0b833cc229ba7ef3d211cd05e690',
  'a872f7f76a1ed475ad901efb7150e82d33e59a29683bf9782abd301dbed4a37f',
  'fe1f7608cb6d608f6d8c05c41d159aac60a35d487c12770451a83cf8285ffd77',
  '9e612bc3515e39644a2ca3f708baed6e157608fc60dcc431fc5f82a5d9290611',
  '7ca16938e280e50114a481cb1812e7c05f8315b8f4a116654533f500adcf80fa',
  'd3fc6fafdd2551a3b2228469013138ae6b45afdd0ec64c23061b2fce866716a3',
  '68e0b4a1ec07f35c0d27f7afe40a66afc277f4bd62bbd7e6ba7940389666262f',
  '4ec33bb7c504849038dc707f3e40a46a0c66e8cf72d43b0e814676861a198918',
  '171fbc2d32348c86b353f4ed56dd164fa14ca965e18af5d75300fdf51a5464ac',
  'e6d1da2f58ad48d9aa007ad1ebb50e0ceb04c06a94026949c291f27398e79e29',
  'c5f1df09bd20355da679161f4d4c1cafdbc822ffa6cff86ea3e8b0bc1df94d0a',
  'ee88f3090d525ad66636d9119803bcbf658dc57f8e3a446793b764c701bbb332',
  'cbe406dfa33f79b31563346fe201fbd40fc1b23e7d22ffb63bc968c14b04f4d7',
  'd0f2fd745d884f377ee02b9c01f6a456f4ab7dc94d0fbb585d4159f101a91820',
];

/**
 * Held (none since D112's protected-work round). The four permit lines that say "protected work"
 * (L12, L14, L15, L16) were held twice: D111's blind second translation wrote "en zona protegida",
 * the held-five round's "el trabajo protegido". The protected-work round's blind second translation,
 * made from the English and the binding glossary (its trade term given, as D112 named owed), agreed
 * with all four. A line added to the ledger as a draft goes here.
 */
export const HELD_EN: readonly string[] = [];

/** One character changed, at the end: the same Spanish with its last letter's case flipped (or a period added). */
export function oneCharEdit(es: string): string {
  const last = es.slice(-1);
  const flipped = last === last.toUpperCase() ? last.toLowerCase() : last.toUpperCase();
  return flipped !== last ? es.slice(0, -1) + flipped : es + '.';
}
