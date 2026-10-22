// R27 Phase A, owner app (builder b) — the screens this unit carries, and the NEW safety-class
// lines it wrote. Every one of these is a ledger DRAFT (src/i18n/reviewed.json): a first
// translation only, so the page shows the English under the Spanish pointer until a blind second
// translation and a blind back-translation are recorded (R27 #5, D112). Nothing here is reviewed.
//
// test/esOwnerB.test.ts pins this list against the dictionaries and the committed ledger, and
// test/esGlossaryTwinLedger.test.ts counts these drafts beside D112's HELD_EN.

/** The new safety-class pairs (English as the page writes it → the first-pass Spanish). */
export const OWNER_B_DRAFTS: ReadonlyArray<{ en: string; es: string; unit: string }> = [
  { unit: 'app-estimate', en: 'Start with the address: permit, drive time, 811 and access.', es: 'Empiece por la dirección: permiso, tiempo de viaje, 811 y acceso.' },
  { unit: 'app-permits', en: 'CALL FIRST', es: 'LLAME PRIMERO' },
  { unit: 'app-permits', en: 'TICKET REQUIRED', es: 'SE REQUIERE TICKET DE LOCALIZACIÓN' },
  { unit: 'app-permits', en: 'UNCONFIRMED', es: 'SIN CONFIRMAR' },
  {
    unit: 'app-permits',
    en: 'Anything a source didn’t state plainly is marked UNCONFIRMED — check it with the city before you tell a customer (the office to call is on the rule where we have one).',
    es: 'Lo que una fuente no dijo con claridad está marcado UNCONFIRMED (sin confirmar) — verifíquelo con la ciudad antes de decírselo a un cliente (la oficina a la que hay que llamar aparece en la regla cuando la tenemos).',
  },
  { unit: 'app-book', en: 'POWER LINES', es: 'LÍNEAS ELÉCTRICAS' },
  { unit: 'app-book', en: 'STRUCTURES', es: 'ESTRUCTURAS' },
  { unit: 'app-safety', en: 'EXPIRED', es: 'VENCIDO' },
  { unit: 'app-safety', en: 'NO RECORD', es: 'SIN REGISTRO' },
  { unit: 'app-fleet', en: 'DOWN', es: 'FUERA DE SERVICIO' },
  { unit: 'app-fleet', en: 'Unit is now DOWN', es: 'La unidad ahora está FUERA DE SERVICIO' },
  { unit: 'app-fleet', en: 'Unit is now HELD', es: 'La unidad ahora está RETENIDA (HELD)' },
  { unit: 'app-followups', en: 'No consent on file or STOP on record — these never send.', es: 'No hay consentimiento registrado o hay un STOP registrado — estos nunca se envían.' },
  { unit: 'app-money', en: 'No consent on file or STOP on record — Arbo will not nudge these.', es: 'No hay consentimiento registrado o hay un STOP registrado — Arbo no les enviará recordatorios.' },
];

/**
 * Safety-class labels this unit draws with the Spanish the ledger already holds — the six glossary labels
 * D112 recorded (served: Spanish over the full English) and HELD, still a draft (held: the pointer, then
 * the English). Reused as written, so no new ledger entry; their 17 entries are untouched.
 */
export const OWNER_B_REUSED: readonly string[] = [
  'PERMIT LIKELY', 'PERMIT: REVIEW NEEDED', 'NO OVERLAY — VERIFY W/ CITY', 'PERMIT SCREEN PENDING', 'NO AERIAL WORK', 'NO EXPIRY DATE', 'HELD',
];
