// R27 Phase A (es-owner-a) — the safety-class lines this unit put in the dictionaries for the first time
// (Today, Leads, Calls & texts, Calendar, the shell and the map). Each is a ledger DRAFT in
// src/i18n/reviewed.json: a first translation pass only, no blind second translation and no blind
// back-translation, so each is held back at serve time and the English shows, marked, until both are
// recorded (D112's rule). The ledger test pins the committed drafts against this list; HELD, used on Today's
// Before you roll, is D112's own draft and is not repeated here.
export const OWNER_A_DRAFTS: readonly string[] = [
  'EMERGENCY',
  'POWER LINES',
  'DOWN',
  'STOP honored',
];
