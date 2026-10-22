// R27 (D110) — the one glossary that binds every Spanish unit
// (docs/R27_SPANISH_PLAN.md, "How quality is checked" 1). Every translator
// and every reviewer works from this file; tests hold every dictionary entry
// and every server twin to it.
//
// Mike's answers (R29 #3): address the crew as USTED; the crew door first, the
// office app next, the long owner-only text last; a Spanish-reading crew member
// ("rudy or marco or temo") reads the briefing, quiz and work orders on a phone
// before crews rely on them. R27 #4: legal and safety labels keep the English
// beside the Spanish, because the city, the utility and the inspector work in
// English.
//
// What is NOT here on purpose: a word for "clear" or "exempt". There is none
// (src/i18n/banList.ts bans "libre", "exento", "no necesita permiso"…).

/** Mike, R29 #3: usted, the register of safety training. */
export const REGISTER = 'usted' as const;
/** One variety for every unit: no regional slang, nothing a crew member from anywhere would trip on. */
export const VARIANT = 'neutral Latin-American Spanish' as const;
/** Display dates and numbers in Spanish: es-US keeps $1,234.50 and 14.5 (a decimal comma on a DBH would be dangerous). */
export const DISPLAY_LOCALE = 'es-US' as const;
/** Times a machine compares (quiet hours, the Friday check, the ET day) stay en-US forever. */
export const MACHINE_LOCALE = 'en-US' as const;
/** The carrier keyword. Never translated, in any string, ever. */
export const CARRIER_KEYWORD = 'STOP' as const;

export interface GlossaryPair { en: string; es: string; note?: string }

/** Trade terms the crews use, with the English kept beside the Spanish. */
export const TRADE_TERMS: readonly GlossaryPair[] = [
  { en: 'groundie', es: 'ayudante de tierra (groundie)' },
  { en: 'drop zone', es: 'zona de caída (drop zone)' },
  { en: 'chipper', es: 'astilladora (chipper)' },
  { en: 'climber', es: 'trepador (climber)' },
  { en: 'rigging', es: 'aparejo (rigging)' },
  { en: 'chainsaw', es: 'motosierra (chainsaw)' },
  { en: 'stump grinder', es: 'trituradora de tocones (stump grinder)' },
  { en: 'bucket truck', es: 'camión canasta (bucket truck)' },
  { en: 'crane', es: 'grúa (crane)' },
  { en: 'hard hat', es: 'casco (hard hat)' },
  { en: 'PPE', es: 'equipo de protección personal (PPE)' },
  { en: 'limb', es: 'rama (limb)' },
  { en: 'notch', es: 'muesca (notch)' },
  { en: 'hinge', es: 'bisagra (hinge)' },
  { en: 'back cut', es: 'corte trasero (back cut)' },
  { en: 'tailgate briefing', es: 'charla de seguridad (tailgate briefing)' },
  { en: 'work order', es: 'orden de trabajo (work order)' },
  { en: 'near miss', es: 'casi accidente (near miss)' },
  { en: 'power line', es: 'línea eléctrica (power line)' },
  { en: 'permit', es: 'permiso (permit)' },
  { en: 'overlay', es: 'zona protegida del mapa (overlay)', note: 'Never "zona marcada": an overlay is a map layer the city verifies.' },
  { en: 'city inspector', es: 'inspector de la ciudad (city inspector)' },
];

/** The known false friends, pinned: the Spanish to use, and the words that read as something else. */
export const FALSE_FRIENDS: ReadonlyArray<GlossaryPair & { never: string[]; why: string }> = [
  { en: 'conductor (electrical)', es: 'cable / línea eléctrica', never: ['conductor'], why: '"conductor" reads as "driver".' },
  { en: 'utility', es: 'la compañía de luz', never: ['utilidad'], why: '"utilidad" means usefulness or profit.' },
  { en: 'applied', es: 'SOLICITADO', never: ['aplicado'], why: 'A permit that was applied for is SOLICITADO; "aplicado" means put into effect.' },
  { en: 'licensed', es: 'con licencia (licensed)', never: ['licenciado'], why: '"licenciado" means someone with a degree.' },
  { en: 'accredited', es: 'quoted in English: "accredited"', never: ['acreditado'], why: 'Never claim a credential the company does not hold (R14, R26).' },
  { en: 'exempt', es: 'none — say what to verify instead', never: ['exento'], why: 'Banned as "exempt" is in English (R27 #4).' },
  { en: 'clear', es: 'none — say what to verify instead', never: ['libre', 'despejado'], why: 'Banned as "clear" is in English (§6B.3, R27 #4).' },
  { en: 'aerial rescue', es: 'rescate en altura (aerial rescue)', never: ['rescate aéreo'], why: 'Banned in the plan; "aéreo" reads as an aircraft.' },
  { en: 'no expiry date', es: 'FALTA LA FECHA DE VENCIMIENTO', never: ['sin fecha de vencimiento'], why: '"Sin fecha de vencimiento" reads as "never expires".' },
  { en: 'qualified / authorized to climb', es: 'aprobado por la oficina (signed off)', never: ['está calificado', 'autorizado para trepar'], why: 'The board records who the office signed off; it never certifies a person.' },
];

/**
 * The safety and legal labels, word for word from the plan's table (R27 #4):
 * the Spanish leads with what to do, so a clipped label still shows the
 * obligation. On screen each shows the Spanish first and the FULL English line
 * beneath it, smaller and marked as English (the runtime's esPair).
 *
 * These are a DRAFT: decided in the plan, critiqued twice, but not yet through
 * the blind second pass and the back-translation. The ledger
 * (src/i18n/reviewed.json) says so, and nothing safety-class is served in
 * Spanish until it records that review.
 */
export const SAFETY_PAIRS: readonly GlossaryPair[] = [
  { en: 'PERMIT LIKELY', es: 'PROBABLEMENTE SE NECESITA PERMISO' },
  { en: 'PERMIT: REVIEW NEEDED', es: 'PERMISO: HAY QUE REVISAR' },
  { en: 'NO OVERLAY — VERIFY W/ CITY', es: 'VERIFIQUE CON LA CIUDAD — EL MAPA NO MOSTRÓ ZONA PROTEGIDA' },
  { en: 'PERMIT SCREEN PENDING', es: 'CHEQUEO DE PERMISO SIN HACER' },
  { en: 'HELD', es: 'NO SE MANEJA — FRENOS/DIRECCIÓN', note: 'The brake or steering hold (R26, R29 #5).' },
  { en: 'NO AERIAL WORK', es: 'NO PUEDE TRABAJAR EN ALTURA' },
  { en: 'NO EXPIRY DATE', es: 'FALTA LA FECHA DE VENCIMIENTO' },
];

/** Credential wording is quoted in English with a Spanish gloss — never "licenciado", never "acreditado". */
export const CREDENTIAL_GLOSS: GlossaryPair = { en: 'licensed and insured', es: '"licensed and insured" (con licencia y seguro)' };

/** Every Spanish line the glossary itself puts forward to be used (not the "never" words), for the gates. */
export function glossaryPairs(): Array<GlossaryPair & { where: string }> {
  return [
    ...TRADE_TERMS.map((p) => ({ ...p, where: 'glossary:trade' })),
    ...FALSE_FRIENDS.filter((f) => !f.es.startsWith('none') && !f.es.startsWith('quoted')).map(({ en, es }) => ({ en, es, where: 'glossary:false-friend' })),
    ...SAFETY_PAIRS.map((p) => ({ ...p, where: 'glossary:safety' })),
    { ...CREDENTIAL_GLOSS, where: 'glossary:credential' },
  ];
}
