// R27 (D110) — the mechanical gates every Spanish string passes before it can
// ship (docs/R27_SPANISH_PLAN.md, "How quality is checked" 3). They run in
// tests over every dictionary entry, every glossary line and every server twin
// table; twinFor (src/i18n/twin.ts) runs the token check again at serve time.
//
// Each gate catches one way a translation changes the meaning while still
// reading well: a number dropped, a NO dropped, "may apply" turned into
// "applies", a value slot renamed, STOP translated, tú instead of usted, a
// pinned false friend, a qualifier lost. A gate returns a problem in words;
// [] means the pair passed.
import { findBannedEs, normalizeEs } from './banList.js';

const PLACEHOLDER = /\{(\w+)\}/g;
// A phone number is one token; it is taken out before the bare numbers are read.
const PHONE = /\b(?:1[-.\s])?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
const SECTION = /§\s?[\dA-Za-z][\w.-]*/g;
const NUMBER = /\d+(?:[.,:]\d+)*/g;
const FT = /\bft\b\.?/;

const EN_NEGATION = /\b(?:no|not|never|none|nothing|nobody|without|cannot|n't|don't|doesn't|isn't|aren't|won't|didn't|can't)\b|n't\b/i;
const ES_NEGATION = /\b(?:no|nunca|jamas|ni|nada|nadie|ningun|ninguna|ninguno|sin|falta|faltan|tampoco)\b/;

// "could" only as a hedge: "couldn't read it" / "could not" say what happened, they do not hedge.
const EN_HEDGE = /\b(?:may|might|likely|possibly|probably|verify)\b|\bcould\b(?!\s*n(?:o|')t)/i;
const ES_HEDGE = /\b(?:puede|pueden|podria|podrian|probable|probablemente|posible|posiblemente|quizas|quiza|tal vez|verifique|verifiquen|verificar|a lo mejor)\b/;

// The carrier keyword — never "STOP WORK", which is a safety label with its own Spanish.
const CARRIER_STOP = /\bSTOP\b(?!\s+WORK)/;

// usted, never tú (R29 #3). The common tú markers; "tu" covers tú and tu once accents fold.
// Only forms that are tú and nothing else: "llama" or "espera" are also usted's
// third person ("la oficina llama"), so they are not here.
const TU_FORM = /\b(?:tu|tus|ti|contigo|eres|tienes|puedes|quieres|necesitas|debes|sabes|vas|haces)\b/;

const QUALIFIERS: Array<{ en: RegExp; es: RegExp; name: string }> = [
  { en: /\bat least\b/i, es: /\b(?:al menos|por lo menos|como minimo)\b/, name: 'at least' },
  { en: /\b(?:at most|no more than)\b/i, es: /\b(?:como maximo|no mas de|a lo mucho)\b/, name: 'at most' },
  { en: /\b(?:working|business) days?\b/i, es: /\bdias? habil(?:es)?\b/, name: 'working days' },
  { en: /\bcalendar days?\b/i, es: /\bdias? (?:naturales|calendario|corridos)\b/, name: 'calendar days' },
];

// The pinned false friends (src/i18n/glossary.ts FALSE_FRIENDS): when the English
// names the thing, the Spanish must not use the word that means something else.
const FALSE_FRIEND_GATES: Array<{ en: RegExp; es: RegExp; name: string }> = [
  { en: /\bconductors?\b/i, es: /\bconductor(?:es)?\b/, name: 'conductor (electrical) is "cable / línea eléctrica", never "conductor" (a driver)' },
  { en: /\butilit(?:y|ies)\b/i, es: /\butilidad(?:es)?\b/, name: 'utility is "la compañía de luz", never "utilidad" (a profit)' },
  { en: /\bapplied\b/i, es: /\baplicad[oa]s?\b/, name: 'applied (a permit) is "SOLICITADO", never "APLICADO"' },
];

// Review round (D110, UI 5): utility lines and 811 markings are every buried line, not the power company's.
const EN_UTILITY_LINES = /\butility (?:lines?|markings?|marks?|locates?)\b|\b811\b|\bMiss Utility\b/i;
const ES_POWER_ONLY = /\b(?:compania|companias|lineas?|cables?) de (?:la )?luz\b/;

const tokens = (s: string, re: RegExp) => [...s.matchAll(re)].map((m) => m[0]);

/** What is wrong with this Spanish for this English — [] when it passes every gate. */
export function esGateProblems(en: string, es: string): string[] {
  const problems: string[] = [];
  if (!String(es || '').trim()) return ['empty: the Spanish line is blank'];
  const n = normalizeEs(es);

  for (const hit of findBannedEs(es)) problems.push(`banned in Spanish: "${hit.matched}" (${hit.id})`);

  const enSlots = new Set(tokens(en, PLACEHOLDER));
  const esSlots = new Set(tokens(es, PLACEHOLDER));
  if (enSlots.size !== esSlots.size || [...enSlots].some((p) => !esSlots.has(p))) {
    problems.push(`placeholders differ: English ${[...enSlots].join(' ') || 'none'} · Spanish ${[...esSlots].join(' ') || 'none'}`);
  }

  // Tokens: phones, § cites, numbers (outside the value slots), ft.
  const strip = (s: string) => s.replace(PLACEHOLDER, ' ');
  const enPhones = tokens(strip(en), PHONE);
  for (const p of enPhones) if (!es.includes(p)) problems.push(`phone number dropped or changed: ${p}`);
  const enRest = strip(en).replace(PHONE, ' ');
  const esRest = strip(es).replace(PHONE, ' ');
  for (const c of tokens(enRest, SECTION)) if (!esRest.replace(/\s/g, '').includes(c.replace(/\s/g, ''))) problems.push(`section cite dropped or changed: ${c}`);
  const esNumbers = tokens(esRest, NUMBER);
  for (const num of tokens(enRest, NUMBER)) {
    if (!esNumbers.includes(num)) problems.push(`number dropped or changed: ${num}`);
  }
  if (FT.test(en) && !FT.test(es)) problems.push('"ft" dropped — feet and inches stay as written');

  if (EN_NEGATION.test(en) && !ES_NEGATION.test(n)) problems.push('negation dropped: the English says no/not/never and the Spanish does not');
  if (EN_HEDGE.test(en) && !ES_HEDGE.test(n)) problems.push('hedge lost: the English hedges (may, likely, verify) and the Spanish states it as fact');
  if (CARRIER_STOP.test(en) && !/\bSTOP\b/.test(es)) problems.push('STOP translated: the carrier keyword stays STOP');
  const tu = n.match(TU_FORM);
  if (tu) problems.push(`register: "${tu[0]}" is a tú form — address the crew as usted`);
  for (const q of QUALIFIERS) if (q.en.test(en) && !q.es.test(n)) problems.push(`qualifier lost: "${q.name}"`);
  for (const f of FALSE_FRIEND_GATES) if (f.en.test(en) && f.es.test(n)) problems.push(`false friend: ${f.name}`);
  if (EN_UTILITY_LINES.test(en) && ES_POWER_ONLY.test(n) && !/\bservicios publicos\b/.test(n)) {
    problems.push('utility lines narrowed to the power company: 811 marks gas, water, power and phone — "servicios públicos"');
  }
  return problems;
}
