// R27 (D110) — banned in Spanish, as in English (Mike, R27 #4: "The Spanish
// never says 'clear' or 'exempt' either — 'libre', 'exento', 'no necesita
// permiso' are banned the same way"). docs/R27_SPANISH_PLAN.md, "Banned in
// Spanish, as in English".
//
// Where this runs:
//   - in tests, over every Spanish string (dictionaries, the glossary, twins);
//   - at serve time, when a page's dictionary is inlined and when a server
//     twin is attached (src/i18n/dictionaries.ts, src/i18n/twin.ts);
//   - inside every English never-say-clear guard that runs today: screening,
//     the permit board, utility markings, the portal's flags, the sim judge,
//     the agents' brain and owner Talk. A model that answers in Spanish, or a
//     line that carries Spanish, is held to the same words.
//
// Text is normalized before it is matched (normalizeEs): accents folded,
// lower case, invisible marks dropped, and non-breaking, thin and other
// spaces collapsed to one plain space — so no spelling slips past.
//
// Phrases, not lone words, where a lone word has an honest use: "precio" alone
// is how a crew line says "never give the customer a price"; "cuesta" alone is
// a slope. A negated dig line ("No se puede excavar…") is the honest one and
// passes; the claim ("Ya puede excavar") does not.

export type EsBanCategory = 'clear' | 'credential' | 'safety_board' | 'price' | 'money' | 'dig';

export interface EsBan {
  id: string;
  category: EsBanCategory;
  /** Matched against normalizeEs(text): lower case, no accents, single spaces. */
  re: RegExp;
  /** A line it catches — tests prove each entry bites on its own example. */
  example: string;
}

/**
 * Accents folded, lower case, invisible marks dropped, every kind of space
 * collapsed to one. NFKD also folds full-width and other look-alike letters
 * ("ｌｉｂｒｅ" → "libre"); every Unicode hyphen, dash and minus folds to a
 * plain hyphen, so "luz‑verde" (U+2011) is "luz-verde" (review round, D110).
 */
export function normalizeEs(text: string): string {
  return String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g, ' ')
    .toLowerCase()
    .trim();
}

// Words in a phrase may be joined by spaces or hyphens ("luz-verde").
const S = '[\\s-]+';
const phrase = (words: string) => words.trim().split(/\s+/).join(S);
const re = (src: string) => new RegExp(src, 'i');
// The verbs of "need" a permit line uses, in the forms a reply would: present, future, "va a".
const NEED = [
  'necesita', 'necesitan', 'necesitara', 'necesitaran', 'requiere', 'requieren', 'requerira',
  `hace${S}falta`, `hacen${S}falta`, `hara${S}falta`, 'ocupa', 'ocupan',
  `va${S}a${S}necesitar`, `van${S}a${S}necesitar`, `va${S}a${S}hacer${S}falta`, `va${S}a${S}requerir`,
].join('|');
// dig, both words.
const DIG = '(?:excavar|cavar)';
// The call before digging, by number or by name.
const CALL_811 = `(?:al${S}811|a${S}miss${S}utility)\\b`;
// A figure after a price verb: digits, a dollar sign, a number word, "dólares".
const FIGURE = '(?:\\$|\\d|\\b(?:cien|ciento|doscient|trescient|cuatrocient|quinient|seiscient|setecient|ochocient|novecient|mil\\b|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|dolares))';

export const ES_BANNED: readonly EsBan[] = [
  // ── "clear", "exempt", "no permit needed" — the permit words' ban (§6B.3, R26 #4, R27 #4)
  { id: 'libre', category: 'clear', re: re('\\blibres?\\b'), example: 'Zona libre.' },
  { id: 'exento', category: 'clear', re: re('\\bexent[oa]s?\\b'), example: 'Exento de permiso.' },
  { id: 'exencion', category: 'clear', re: re('\\bexencion(?:es)?\\b'), example: 'Exención de permiso.' },
  {
    // "No (se) (le/les) necesita / hace falta / va a necesitar / necesitará (usted) (sacar) (un) permiso".
    id: 'no_permit_needed', category: 'clear',
    re: re(`\\bno${S}(?:se${S})?(?:(?:le|les)${S})?(?:${NEED})(?:${S}(?:usted|ustedes))?(?:${S}(?:sacar|tramitar|pedir))?(?:${S}de)?(?:${S}(?:un|el|los|ningun|ninguno|algun))?${S}permisos?\\b`),
    example: 'No necesita permiso.',
  },
  {
    id: 'permit_not_needed', category: 'clear',
    re: re(`\\b(?:(?:el${S}|un${S}|los${S})?permisos?:?${S}no${S}(?:(?:le|les)${S})?(?:(?:es|son|sera|seran)${S})?(?:necesari[oa]s?|requerid[oa]s?|hace${S}falta|hacen${S}falta|hara${S}falta|se${S}necesita)|no${S}(?:es|son|sera|seran)${S}necesari[oa]s?${S}(?:(?:sacar|tramitar|pedir)${S})?(?:el${S}|un${S}|los${S}|ningun${S})?permisos?|no${S}hay${S}que${S}(?:sacar|tramitar|pedir)${S}(?:el${S}|un${S}|ningun${S})?permisos?|sin${S}necesidad${S}de${S}permisos?)\\b`),
    example: 'No es necesario un permiso.',
  },
  { id: 'despejado', category: 'clear', re: re('\\bdespejad[oa]s?\\b'), example: 'El área está despejada.' },
  { id: 'luz_verde', category: 'clear', re: re(`\\b${phrase('luz verde')}\\b`), example: 'Tiene luz verde.' },
  { id: 'listo_para_cortar', category: 'clear', re: re(`\\blist[oa]s?${S}para${S}cortar\\b`), example: 'Listo para cortar.' },
  // "good to cut" (FORBIDDEN_CLEAR): "Ya puede cortar". A plain "puede cortar la rama" is a rigging step and passes.
  { id: 'ya_puede_cortar', category: 'clear', re: re(`\\bya${S}(?:se${S})?pueden?${S}(?:(?:empezar|comenzar)${S}a${S})?cortar\\b`), example: 'Ya puede cortar.' },
  // It reads as "never expires" — the label is FALTA LA FECHA DE VENCIMIENTO.
  { id: 'sin_fecha_de_vencimiento', category: 'clear', re: re(`\\b${phrase('sin fecha de vencimiento')}\\b`), example: 'Sin fecha de vencimiento.' },
  { id: 'rescate_aereo', category: 'clear', re: re(`\\b${phrase('rescate aereo')}\\b`), example: 'Rescate aéreo.' },
  // An overlay is never a "marked zone" — the map's word is ZONA PROTEGIDA, and the city verifies it.
  { id: 'zona_marcada', category: 'clear', re: re(`\\b${phrase('zona marcada')}s?\\b`), example: 'Zona marcada.' },

  // ── credentials: "licenciado" means a degree; "acreditado" claims an accreditation (R14, R26)
  { id: 'licenciado', category: 'credential', re: re('\\blicenciad[oa]s?\\b'), example: 'Somos licenciados.' },
  { id: 'acreditado', category: 'credential', re: re('\\bacreditad[oa]s?\\b'), example: 'Acreditado.' },

  // ── the safety board never says a person is qualified or authorized — only who the office signed off
  { id: 'esta_calificado', category: 'safety_board', re: re(`\\bestan?${S}calificad[oa]s?\\b`), example: 'Está calificado.' },
  { id: 'autorizado_para_trepar', category: 'safety_board', re: re(`\\bautorizad[oa]s?${S}para${S}(?:trepar|escalar|subir)\\b`), example: 'Autorizado para trepar.' },

  // ── never price (§3, R3/R14): quoting a figure, as phrases
  { id: 'el_precio_es', category: 'price', re: re(`\\b(?:el|su|un)${S}precio${S}(?:es|seria|sera|queda|sale)\\b`), example: 'El precio es de 400.' },
  { id: 'precio_aproximado', category: 'price', re: re(`\\bprecio${S}(?:aproximado|estimado|exacto)\\b`), example: 'Precio aproximado.' },
  // Only with a figure after it, and never after "cuánto": "¿cuánto le cuesta?" is the question a refusal names, not a price (review round, D110).
  { id: 'le_cuesta', category: 'price', re: re(`(?<!\\bcuanto${S})\\b(?:le|les)${S}(?:cuesta|costaria|costara|va${S}a${S}costar|sale${S}en|saldria${S}en|sale${S}por|saldria${S}por|cobramos|cobrariamos|vamos${S}a${S}cobrar)\\b[^.!?;]{0,25}?${FIGURE}`), example: 'Le cuesta unos 500.' },
  { id: 'cuesta_unos', category: 'price', re: re(`\\b(?:cuesta|costaria|cobramos|cobra)${S}(?:unos|unas|como|alrededor|aproximadamente|mas${S}o${S}menos|\\$)`), example: 'Cuesta unos quinientos.' },
  { id: 'mas_o_menos_figure', category: 'price', re: re(`\\b(?:mas${S}o${S}menos|alrededor${S}de|aproximadamente|como${S}unos?)${S}\\$?\\s?\\d`), example: 'Más o menos $300.' },

  // ── zero financial authority (VA brief §1.3): giving money away, as phrases
  { id: 'descuento', category: 'money', re: re(`\\b(?:le|les)${S}(?:hacemos|damos|hago|doy|podemos${S}hacer|podemos${S}dar)${S}(?:un${S})?descuento\\b`), example: 'Le hacemos un descuento.' },
  { id: 'rebaja', category: 'money', re: re(`\\b(?:le|les)${S}(?:rebajamos|bajamos|quitamos|descontamos)\\b`), example: 'Le rebajamos cien.' },
  { id: 'sin_cargo', category: 'money', re: re(`\\bsin${S}(?:cargo|costo)\\b`), example: 'Sin cargo.' },
  { id: 'no_le_cobramos', category: 'money', re: re(`\\bno${S}(?:le|les)${S}(?:cobramos|vamos${S}a${S}cobrar|cobraremos|cobro)\\b`), example: 'No le cobramos el tocón.' },
  { id: 'regalamos', category: 'money', re: re(`\\b(?:se${S})?(?:lo|la|los|las)${S}regalamos\\b`), example: 'Se lo regalamos.' },
  { id: 'gratis_commitment', category: 'money', re: re(`\\b(?:hacemos|incluimos|ponemos|regalamos|damos|quitamos|cortamos|sacamos)\\b[^.!?]{0,30}\\bgratis\\b`), example: 'Lo incluimos gratis.' },
  { id: 'igualamos_precio', category: 'money', re: re(`\\bigual(?:amos|ar)${S}(?:el|ese|su)${S}precio\\b`), example: 'Igualamos el precio.' },

  // ── never permission to dig (utility markings): the Spanish of "safe to dig", "no need to call"
  // "cavar" is the everyday word for dig, "excavar" the formal one: both. A negated line ("No es
  // seguro cavar", "No puede cavar", "Nadie puede cavar") is the honest warning and passes.
  { id: 'seguro_excavar', category: 'dig', re: re(`(?<!\\bno${S}(?:(?:es|esta|sera)${S})?)\\bseguro${S}(?:para${S})?${DIG}\\b`), example: 'Es seguro excavar.' },
  { id: 'listo_para_excavar', category: 'dig', re: re(`\\blist[oa]s?${S}para${S}${DIG}\\b`), example: 'Listo para excavar.' },
  { id: 'puede_excavar', category: 'dig', re: re(`(?<!\\b(?:no|nadie)${S}(?:se${S})?)\\b(?:se${S})?pueden?${S}(?:(?:empezar|comenzar)${S}a${S})?${DIG}\\b`), example: 'Ya puede excavar.' },
  {
    // "No (le) hace falta / es necesario / necesita llamar al 811 / a Miss Utility", and "Llamar al 811 no hace falta".
    id: 'no_hace_falta_llamar', category: 'dig',
    re: re(`\\bno${S}(?:(?:le|les)${S})?(?:hace${S}falta|hara${S}falta|necesita|necesitan|necesitara|tiene${S}que|tienen${S}que|hay${S}que|es${S}necesario|sera${S}necesario|se${S}necesita)${S}llamar${S}${CALL_811}|\\bllamar${S}${CALL_811}${S}no${S}(?:hace${S}falta|es${S}necesario|se${S}necesita)`),
    example: 'No hace falta llamar al 811.',
  },
  { id: 'ya_localizado', category: 'dig', re: re(`\\bya${S}(?:esta|estan|fue|fueron)${S}(?:localizad|ubicad)[oa]s?\\b`), example: 'Ya están localizadas.' },
];

// The company's own offer, said in Spanish: the estimate (the visit to see the tree) is free —
// knowledgeBase.ts DIAGNOSIS_PIVOT, "I can get you on the schedule for a free estimate". It is
// taken out of the line before the money phrases are read, so "Le hacemos la estimación gratis"
// passes and anything else given away in the same line ("…y el tocón gratis") is still caught.
const ESTIMATE = '(?:estimacion|estimado|presupuesto|cotizacion|evaluacion)';
const FREE = `(?:(?:totalmente|completamente)${S})?(?:gratis|gratuit[oa]|sin${S}(?:costo|cargo))`;
const reAll = (src: string) => new RegExp(src, 'gi');
const FREE_ESTIMATE: readonly RegExp[] = [
  reAll(`\\b(?:la${S}|una${S})?visita${S}(?:para${S}|de${S})(?:la${S}|el${S}|una${S}|un${S}|su${S})?${ESTIMATE}${S}(?:(?:es|sera)${S})?${FREE}`),
  reAll(`\\b${ESTIMATE}${S}(?:(?:es|sera)${S})?${FREE}`),
  reAll(`\\b(?:es${S})?${FREE}${S}(?:la${S}|el${S}|su${S})?(?:visita${S}(?:para${S}|de${S})(?:la${S}|el${S})?)?${ESTIMATE}\\b`),
  reAll(`\\bno${S}(?:le|les)${S}(?:cobramos|cobraremos|vamos${S}a${S}cobrar)${S}(?:nada${S})?(?:por${S})?(?:la${S}|el${S}|su${S})?(?:visita${S}(?:para${S}|de${S})(?:la${S}|el${S})?)?${ESTIMATE}\\b`),
];

/** Every banned word or phrase in a Spanish line ([] when it is fine). */
export function findBannedEs(text: string): Array<{ id: string; category: EsBanCategory; matched: string }> {
  let t = normalizeEs(text);
  for (const ok of FREE_ESTIMATE) t = t.replace(ok, ' ');
  const hits: Array<{ id: string; category: EsBanCategory; matched: string }> = [];
  for (const b of ES_BANNED) {
    const m = t.match(b.re);
    if (m) hits.push({ id: b.id, category: b.category, matched: m[0] });
  }
  return hits;
}

export function hasBannedEs(text: string): boolean {
  return findBannedEs(text).length > 0;
}

/** The first banned word or phrase in a line, as '"matched" (category)' — null when the line is fine. For a guard's message. */
export function bannedEsLine(text: string): string | null {
  const hit = findBannedEs(text)[0];
  return hit ? `"${hit.matched}" (${hit.category})` : null;
}
