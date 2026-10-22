// R27 Phase A, owner app (builder c) — the screens this unit carries, and the NEW safety-class lines
// it wrote. Every one of these is a ledger DRAFT (src/i18n/reviewed.json): a first translation only,
// so the page shows the English under the Spanish pointer until a blind second translation and a
// blind back-translation are recorded (R27 #5, D112). Nothing here is reviewed.
//
// test/esOwnerC.test.ts pins this list against the dictionaries and the committed ledger, and
// test/esGlossaryTwinLedger.test.ts counts these drafts beside D112's HELD_EN.

/** The units this builder owns — one per screen (ES_PLACES already names each). */
export const OWNER_C_UNITS = ['app-office', 'app-numbers', 'app-settings', 'app-agents', 'app-measure', 'app-learn', 'app-assistant'] as const;

/** The new safety-class pairs (English as the page writes it → the first-pass Spanish), by unit. */
export const OWNER_C_DRAFTS: ReadonlyArray<{ en: string; es: string; unit: (typeof OWNER_C_UNITS)[number] }> = [
  // Settings → Bouncie: the sign-in's state chip. "EXPIRED" is a safety badge word wherever it stands (the
  // ledger decides from the English), so it waits for its review like every other one.
  { unit: 'app-settings', en: 'EXPIRED', es: 'VENCIDO' },
  // The assistant's first rule for texts: the carrier keyword STOP, kept as written, and the quiet hours.
  {
    unit: 'app-assistant',
    en: 'Every text, before it goes out. Texts to customers also need their consent, stop for good on STOP, and only go 8am–9pm ET.',
    es: 'Cada mensaje de texto, antes de que salga. Los mensajes a clientes además necesitan el consentimiento del cliente, se detienen para siempre con STOP y solo salen de 8am–9pm ET.',
  },
];
