/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  Owner instruction from Mike, 2026-08-03. This is not decoration and it
  is not optional. It is here because this is the point in a build where
  things get broken by moving fast, and that already happened to him once
  on the website. It does not happen here.
  ═══════════════════════════════════════════════════════════════════════

  SLOW DOWN. DRASTICALLY. Then:

  1. READ EVERY LINE BEFORE YOU EDIT ONE. Every line, every letter,
     slowly. You are not skimming to find the spot to change — you are
     building a model of what this file already does. If you cannot say
     what the code above and below your edit does, you have not read it.

  2. AN AUDIT IS READ-ONLY. If you were asked to audit, you do not edit.
     You do not "fix it while you are in there." You do not refactor, or
     tidy, or rename. You READ, and you REPORT. Editing during an audit
     is disobeying the instruction, full stop.

  3. THINK BEFORE YOU TYPE. What does this already handle? What depends
     on it? What breaks downstream? Recognise the PATTERN before you call
     something a bug — most things in here that look wrong are a
     deliberate correction. Check docs/OWNER_RULINGS.md first. Use what
     you already know about this codebase instead of re-deciding it.

  4. BRING IT TO MIKE — DO NOT DECIDE IT. Anything that looks wrong,
     ambiguous, or outside what was asked: say it and WAIT. Flagging
     costs one sentence. Deciding on his behalf has cost real work and
     real money more than once.

  5. DO EXACTLY WHAT WAS ASKED. Not the adjacent thing. Not the bigger
     thing you thought of on the way. Not the cleanup. Exactly what was
     asked, and nothing else.

  If you are moving fast right now, you are already off the rails.

  Remember the marker: SLOW::ARBO
*/
// Emergency detection (brief §3.4). A tree on a house/car/structure/power line,
// or anyone in danger, must NOT be slotted as a normal estimate — it fast-tracks
// an alert to Mike. Deterministic so it can't be missed. Biased toward catching:
// a false ping to Mike is acceptable; a missed emergency is not.

import { foldAccents } from './language.js';

export interface EmergencyResult {
  isEmergency: boolean;
  reason: string | null;
}

const STRUCTURE = '(roof|car|house|home|garage|shed|vehicle|truck|deck|fence|structure|building|porch)';

// Unambiguous emergencies. Tested on accent-folded text (language.ts), which
// leaves English as it was and lets the Spanish lines below use plain \b.
const HARD: Array<{ re: RegExp; reason: string }> = [
  { re: new RegExp(`\\b(fell|fallen|falling|came down|crashed|collapsed|landed|toppled|smashed)\\b[^.]{0,40}\\b${STRUCTURE}\\b`, 'i'), reason: 'tree down on a structure/vehicle' },
  // Plural line nouns too ("into the power lines"), and a line on the ground.
  { re: /\b(power ?lines?|powerlines?|electrical wires?)\b[^.]{0,30}\b(down|touching|on it|tangled|arcing|sparking|on the ground|lying|laying)\b/i, reason: 'power line involved' },
  { re: /\b(down|touching|tangled|arcing|sparking|on|onto|into|fell|took out|knocked)\b[^.]{0,30}\b(power ?lines?|powerlines?|electrical wires?)\b/i, reason: 'power line involved' },
  { re: /\b(someone|somebody|person|kid|child|anyone|neighbor)\b[^.]{0,30}\b(hurt|injured|trapped|stuck|pinned|in danger)\b/i, reason: 'person in danger' },
  // A person named the way callers name them ("my husband is hurt", "he's
  // trapped", "it fell on him"). Named relatives, not "my <anything>", and no
  // "stuck" — "my truck is stuck in the yard" is not an emergency.
  { re: /\b(he|she|they|my (husband|wife|son|daughter|kids?|child(ren)?|mom|mother|dad|father|brother|sister|grand\w+|boy|girl|baby|neighbor|friend))\b[^.]{0,30}\b(hurt|injured|trapped|pinned)\b|\b(trapped|pinned) (under|beneath)\b|\b(fell|landed|came down) on (him|her|them|my (husband|wife|son|daughter|kids?|child|mom|mother|dad|father|brother|sister|boy|girl|baby|neighbor|friend))\b/i, reason: 'person in danger' },
  // R25 sim: callers say "a line down" / "wires down" without the word power.
  // Plural "the lines / the wires" only after the tree verb, so phone talk
  // ("on the line") is not a power line.
  { re: /\b(lines?|wires?)\b[^.]{0,15}\b(down|arcing|sparking|on fire|on the ground)\b|\bdowned (lines?|wires?)\b|\b(fell|fallen|landed|came down|is|resting|leaning|sitting)\b (on|onto|into|in) the (lines|wires)\b/i, reason: 'power line involved' },
  // R25 sim: "one of your guys fell out of the tree… he's not moving".
  { re: /\b(not moving|not breathing|unconscious|passed out|bleeding bad(ly)?)\b|\bfell (out of|from) (the|a) tree\b/i, reason: 'person in danger' },
  { re: /\bblock(ing|ed)?\b[^.]{0,20}\b(driveway|road|street|exit|door)\b/i, reason: 'access blocked' },
  { re: /\bemergency\b/i, reason: 'caller said emergency' },
  // R26: Spanish-speaking callers ("un árbol se cayó sobre mi casa", "hay
  // cables en el suelo", "alguien está herido"). Recognised only — Arbo
  // still answers in English (Mike's call, language.ts).
  { re: /\b(cayo|caido|caida|cayeron|tumbo)\b[^.]{0,40}\b(casa|techo|carro|coche|auto|camioneta|camion|garaje|cochera|edificio|porche)\b/i, reason: 'tree down on a structure/vehicle' },
  { re: /\b(cables?|lineas?|alambres?)\b[^.]{0,30}\b(caidos?|caidas?|en el suelo|en el piso|chispas|chispea\w*|tocando|colgando|sueltos?|sueltas?|quemando)\b|\b(cables?|lineas?|alambres?) (electric[oa]s?|de luz|de la luz|de electricidad|de alta tension)\b/i, reason: 'power line involved' },
  { re: /\b(herid[oa]s?|lastimad[oa]s?|atrapad[oa]s?|sangrando|inconsciente|no se mueve|no respira)\b/i, reason: 'person in danger' },
  // A fence, as in English ("tumbó la cerca", "la cerca de mi vecino"). The
  // article is what makes "cerca" the fence: "una rama cerca de la calle" is
  // "near".
  { re: /\b(cayo|caido|caida|cayeron|tumbo)\b[^.]{0,40}\b(?:la|mi|una|nuestra|el|un) (?:cerca|cerco|valla)\b/i, reason: 'tree down on a structure/vehicle' },
  // Fallen cables in either word order, or a tree touching / on them. Not
  // "línea": "se cayó la línea" is the call dropping, "en línea" is online.
  { re: /\b(cables?|alambres?)\b[^.]{0,20}\b(?:se )?(?:cayeron|cayo)\b|\b(?:se )?(?:cayeron|cayo)\b[^.]{0,20}\b(cables?|alambres?)\b|\b(tocando|toca|encima de|sobre)\b[^.]{0,20}\b(cables?|alambres?)\b/i, reason: 'power line involved' },
  // Someone hurt, said the everyday way ("necesito una ambulancia", "se
  // lastimó", "se cayó del árbol").
  { re: /\b(ambulancia|se (?:lastimo|hirio|lastimaron|hirieron))\b|\bse cayo (?:del|de un|de una|de la) (?:arbol|escalera)\b/i, reason: 'person in danger' },
  { re: /\bemergencia\b/i, reason: 'caller said emergency' },
];

// A tree resting on a structure — emergency unless the call is clearly routine.
const REST_ON = new RegExp(`\\btree\\b[^.]{0,20}\\bon (my|the|a|top of)\\b[^.]{0,20}${STRUCTURE}`, 'i');
const ROUTINE = /\b(trim|prune|trimmed|pruned|cut back|hedge|quote|estimate|schedule|appointment)\b/i;
// The same in Spanish: a tree ON the house or car, never a bare "en mi casa"
// ("un árbol grande en mi casa" is where the tree is, not where it fell).
const REST_ON_ES = /\barbol(?:es)?\b[^.]{0,25}\b(?:(?:encima de|sobre|arriba de)\b[^.]{0,15}\b(?:casa|techo|carro|coche|auto|camioneta|camion|garaje|cochera|edificio|porche)|en el (?:techo|carro|coche|auto|camion|camioneta))\b/i;
const ROUTINE_ES = /\b(podar|poda|recortar|presupuesto|estimado|cotizacion|cita)\b/i;

/** Every emergency reason in the text, in HARD order, then a resting tree. */
function emergencyReasons(text: string): string[] {
  const t = foldAccents(text);
  const reasons = HARD.filter(({ re }) => re.test(t)).map(({ reason }) => reason);
  if (REST_ON.test(t) && !ROUTINE.test(t)) reasons.push('tree on a structure/vehicle');
  if (REST_ON_ES.test(t) && !ROUTINE.test(t) && !ROUTINE_ES.test(t)) reasons.push('tree on a structure/vehicle');
  return reasons;
}

export function detectEmergency(text: string): EmergencyResult {
  const [reason] = emergencyReasons(text);
  return reason ? { isEmergency: true, reason } : { isEmergency: false, reason: null };
}

/**
 * R26 (Mike, 2026-10-20) — which of his safety lines the caller hears
 * (guardrails.emergency.safetyLines). The 911 line when a person is or may
 * be in danger: someone hurt, trapped or not moving — and, by default, a
 * tree down on a house or vehicle, where someone may be inside (the line
 * itself says "if anyone is hurt"). The Dominion line when a power line is
 * involved. Both when both. A blocked drive alone, or the bare word
 * "emergency", gets neither — Mike is still alerted.
 */
export interface SafetyCalls {
  call911: boolean;
  callDominion: boolean;
}

const MAY_HURT_SOMEONE = new Set(['person in danger', 'tree down on a structure/vehicle', 'tree on a structure/vehicle']);

export function emergencySafetyCalls(text: string): SafetyCalls {
  const reasons = emergencyReasons(text);
  // R29 #4: a hurt word the caller DENIED ("nadie está herido") is not a hurt
  // person — the 911 line is decided on the rest of what they said. A tree on
  // a house or car still says 911 (someone may be inside); nothing else moves.
  const hurtReasons = injuryDenied(text) ? emergencyReasons(withoutDenials(text)) : reasons;
  return {
    call911: hurtReasons.some((r) => MAY_HURT_SOMEONE.has(r)),
    callDominion: reasons.includes('power line involved'),
  };
}

/*
 * R29 #4 (Mike, 2026-10-20): a downed power line with nobody hurt keeps the
 * Dominion line only — NOT 911 ("call dominion"). The word "injured" is an
 * injury trigger (guardrails.json, left as it is), so "the line is down,
 * nobody was injured" was read as an injury and heard the 911 line.
 *
 * Only an explicit, WHOLE denial counts: "nobody hurt", "no one is injured",
 * "nobody was injured", "no injuries"; in Spanish "nadie está herido", "nadie
 * salió lastimado", "nadie se lastimó", "no hay heridos", "sin heridos". The
 * 911 line is conditional ("If anyone is hurt…"), so a needless one costs a
 * sentence; a missing one when someone IS hurt is the failure that matters.
 * So anything that leaves a person possibly hurt keeps it (review, D1):
 *   · a softened or scoped denial: "nobody was SERIOUSLY injured", "…too
 *     badly", "no hay heridos GRAVES", "…injured IN THE HOUSE";
 *   · a hurt, medical or body word anywhere else ("…my son got electrocuted",
 *     "she can't breathe", "I hit my head", "se desmayó", "me duele");
 *   · any other person named anywhere ("except for my wife, nobody…",
 *     "nobody was injured, my son was", "menos mi hijo", "mi esposo sí"),
 *     or by name after the denial ("…John fell"), or an exception at all
 *     ("except John", "nobody hurt but John"), or a clause ending on its
 *     verb after it ("…, John was");
 *   · the caller (I, me, we, yo) or an unnamed someone after the denial or
 *     after an exception ("nobody but me", "apart from me", "excepto yo");
 *   · a correction after it ("…well actually", "wait", "I mean", "bueno");
 *   · a hedge or hearsay anywhere ("we think", "as far as we know",
 *     "supposedly", "they said", "creemos", "al parecer", "que yo sepa");
 *   · a negated or supposed denial ("I can't say nobody was injured",
 *     "if nobody's hurt…", "si nadie está herido…");
 *   · a question: a "?" after the denial in its sentence, or a tag with no
 *     "?" ("…nobody was injured right", "…nadie está herido verdad").
 * "Nobody else" / "nadie más" is never a denial (someone IS hurt), and a bare
 * first-person "I'm not hurt" denies nothing about anyone else.
 * The alert to Mike and the notify tier never read this: they stay on the intent.
 */
// After a denial, a word that softens it ("…injured too badly", "heridos graves").
// Or scopes it ("…injured in the house": someone outside may be). Then it is no whole denial.
const SOFTENED = String.raw`(?!\s+(?:seriously|serious|badly|bad|severely|critically|too|that|much|really|real|in|inside|at(?!\s+all\b)|on|here|there|graves?|gravemente|de gravedad|de cuidado|seri[oa]s?|mucho|en|dentro|aqui|alli))`;
const DENIALS: RegExp[] = [
  // No word may sit between the denial and "hurt/injured": "nobody was seriously injured" is not one.
  new RegExp(String.raw`\b(?:no one|no-one|noone|nobody)(?!\s+else\b)(?:'s|\s+(?:is|was|got|gets|were|are|has been|had been|has gotten))?\s+(?:hurt|injured)(?:\s+or\s+(?:hurt|injured))?\b` + SOFTENED, 'g'),
  new RegExp(String.raw`\bno injur(?:y|ies)\b` + SOFTENED, 'g'),
  new RegExp(String.raw`\bnadie(?!\s+mas\b)(?:\s+(?:esta|estaba|salio|resulto|quedo|fue|se))?\s+(?:herid|lastimad|lesionad)[oa]s?\b` + SOFTENED, 'g'),
  new RegExp(String.raw`\bnadie(?!\s+mas\b)\s+se\s+(?:lastimo|hirio|lesiono)\b` + SOFTENED, 'g'),
  new RegExp(String.raw`\b(?:no hay|sin|ningun|ninguna)\s+(?:herid|lastimad|lesionad)[oa]s?\b` + SOFTENED, 'g'),
];
// A person may be hurt: a hurt, medical or body word left once the denials are taken out.
// Tree words are kept out ("dead tree", "broken limb", "knocked the line down", "touching the line").
const HURT_WORD = new RegExp(String.raw`\b(?:` + [
  String.raw`hurt\w*|injur\w*|bleed\w*|blood\w*|ambulance|hospital|emergency room|paramedics?|911`,
  String.raw`trapped|pinned|stuck|crushed|unconscious|unresponsive|not (?:moving|breathing|responding|awake)|can'?t (?:breathe|move|feel|get up|stand)`,
  String.raw`passed out|fainted|collaps\w*|seizures?|heart attack|stroke|died|dying|killed|(?:is|was|are|were|'s) dead`,
  String.raw`electrocut\w*|shock\w*|zapp?\w*|jolt\w*|burn(?:ed|t|s)|touched|grabbed`,
  String.raw`fell (?:off|from|out of) (?:the|a|his|her|my|our|their) (?:ladder|roof|truck|bucket|lift|tree|deck|porch|chair)|(?:i|we|he|she|they|someone|somebody) (?:fell|slipped|tripped)|got hit|was hit|were hit|hit by|hit (?:him|her|me|us|them)|struck by|got struck|was struck`,
  String.raw`fractur\w*|concussion|sprain\w*|bruis\w*|scratch\w*|scrape\w*|gash\w*|wound\w*|bones?|minor|serious\w*|critical\w*|badly`,
  String.raw`head|neck|chest|arms?|legs?|hands?|face|eyes?|skull|spine|ribs?|wrists?|ankles?|knees?|shoulders?`,
  // Spanish (accent-folded).
  String.raw`herid\w*|lastim\w*|lesion\w*|sangr\w*|ambulancia|atrapad\w*|inconsciente|no se mueve|no respira|no responde|no puede (?:respirar|moverse)`,
  String.raw`desmay\w*|electrocut\w*|corriente|descargas?|quem\w*|golpe\w*|duele|dolor|muert\w*|murio|infarto|convulsion\w*|grave\w*|gravedad|leve\w*`,
  String.raw`cabeza|cuello|pecho|brazos?|piernas?|manos?|cara|ojos?|espalda|me (?:lastime|heri|cai|queme|golpee|electrocute)`,
].join('|') + String.raw`)\b`);
// Anyone else, named anywhere — before the denial ("except for my wife, nobody…") or after ("…my son was").
// Not the Spanish "el": folded, the article and "él" are one word ("pero el cable…").
const PERSON_WORD = new RegExp(String.raw`\b(?:` + [
  String.raw`he|she|him|her|his|hers|they|them|their|everyone|everybody|people|persons?|man|men|woman|women|lady|ladies|gentleman|guys?|kids?|child|children|boys?|girls?|bab(?:y|ies)|toddlers?|infants?|teen\w*`,
  String.raw`workers?|crew|lineman|linemen|drivers?|tenants?|roommates?|neighbou?rs?|husband|wife|sons?|daughters?|mom|mommy|mother|dad|daddy|father|brothers?|sisters?|grand\w+|uncles?|aunts?|cousins?|nephews?|nieces?|boyfriend|girlfriend|fianc\w*|partner|friends?|family|folks|spouse|victims?|patients?`,
  String.raw`ella|ellas|ellos|nin[oa]s?|bebes?|hombres?|mujer(?:es)?|senor(?:a|es|as)?|trabajador\w*|vecin[oa]s?|espos[oa]s?|marido|hij[oa]s?|madre|padre|mama|papa|herman[oa]s?|abuel[oa]s?|amig[oa]s?|ti[oa]s?|prim[oa]s?|novi[oa]s?|familia|gente|inquilin[oa]s?|muchach[oa]s?|chic[oa]s?`,
].join('|') + String.raw`)\b`);
// The caller, or an unnamed someone: hurt only when named after the denial or after an exception
// ("nobody but me", "except for me, nobody…", "excepto yo", "aparte de mí") — "I've got a line down,
// nobody's hurt" and "can you send someone? …nobody's hurt" before it are not.
const SELF_WORD = /\b(?:i|me|myself|we|us|ourselves|someone|somebody|anyone|anybody|yo|conmigo|nosotr[oa]s|nos|alguien|mi(?=\s*(?:[,.!?;]|$)))\b/;
const EXCEPT_WORD = /\b(?:but|except|excepting|other than|besides|apart from|aside from|save for|only|although|though|however|pero|excepto|menos|salvo|aparte|ademas|aunque|solo|sino|fuera de)\b/;
// "Nobody… except X" anywhere: X, whoever X is (a name too), may be hurt.
const EXCEPTION = /\b(?:except|excepting|besides|other than|apart from|aside from|save for|but for|excepto|(?<!\b(?:al|lo)\s)menos|salvo|aparte|fuera de)\b/;
// Straight after a denial: "nobody hurt but John", "nadie herido sino…".
const BUT_RIGHT_AFTER = /^\s+(?:but|only|pero|solo|sino)\b/;
// After a denial, a clause that ends on its verb names who WAS: "…John was", "…my son is too".
const ELLIPSIS = /\b(?:was|is|were|are|got|did|does|do|has|had)\s*(?:though|too|also|tambien)?\s*(?:[,.!;?]|$)/;
// After the denial, the caller taking it back.
const CORRECTION = /\b(?:actually|wait|i mean|well|correction|scratch that|sorry|hold on|yes|yeah|yep|bueno|digo|o sea|perdon|espera|en realidad|mejor dicho|si)\b/;
// Anywhere: the caller is not sure, or is passing on what someone else said.
const HEDGE = new RegExp(String.raw`\b(?:` + [
  String.raw`think|thought|guess|believe|suppose|supposedly|assum\w*|presum\w*|apparently|probably|possibly|maybe|perhaps|hopefully|hope|sure|unsure|certain`,
  String.raw`don'?t know|dunno|no idea|far as|from what|can'?t (?:tell|see|say)|cannot (?:tell|see|say)|couldn'?t (?:tell|see|say)`,
  String.raw`seems?|seemed|appears?|appeared|looks? like|looked like|sounds like|said|says|told|heard|so far|yet|at first|initially|at the time|for now|as of|last time|this time|pray\w*|check\w*`,
  String.raw`creo|creemos|creen|cree|creia|pienso|pensamos|piensa|parece|parecia|al parecer|aparentemente|supuestamente|probablemente|posiblemente|tal vez|quizas?|a lo mejor`,
  String.raw`no se|no sabemos|no estoy segur[oa]|no estamos segur[oa]s|espero|esperamos|ojala|que yo sepa|que sepamos|hasta donde|hasta ahora|por ahora|todavia|aun|dijo|dijeron|dicen|al principio|la ultima vez|esta vez`,
].join('|') + String.raw`)\b`);
// Just before a denial: it is denied or supposed, not said ("I can't say nobody…", "not true
// that nobody…", "if nobody's hurt…", "si nadie está herido…").
const NOT_SAID = /(?:\bnot|n't|\bnever|\bcannot|\bno es|\bno fue|\bnunca|\bif|\bunless|\bwhether|\bin case|\bsi|\ben caso de que)\b[^.!?,;]{0,25}$/;
// Just after a denial, in its sentence: asked, not told ("…nobody injured?", "…right", "…verdad").
const QUESTION = /^[^.!]*\?|^[^.!?]*?\b(?:right|correct|true|is that so|isn'?t it|verdad|cierto|o no)\s*(?:[,.!;]|$)/;

/** Folded, lower-case, plain apostrophes: the form every pattern above is written for. */
function denialText(text: string): string {
  return foldAccents(text).toLowerCase().replace(/[\u2018\u2019]/g, "'");
}
function denialSpans(t: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const re of DENIALS) for (const m of t.matchAll(re)) spans.push([m.index!, m.index! + m[0].length]);
  return spans.sort((a, b) => a[0] - b[0]);
}
/** What the caller said with every denial taken out (a comma in each place). */
function withoutDenials(text: string): string {
  const t = denialText(text);
  let out = '';
  let at = 0;
  for (const [s, e] of denialSpans(t)) { if (s >= at) { out += t.slice(at, s) + ','; at = e; } }
  return out + t.slice(at);
}

/** The folded text with each denial blanked (a comma, then spaces): the same length, so an index holds in both. */
function blanked(t: string, spans: Array<[number, number]>): string {
  let out = t;
  for (const [s, e] of spans) out = out.slice(0, s) + ','.padEnd(e - s, ' ') + out.slice(e);
  return out;
}

/** True only when the caller explicitly said nobody is hurt, and nothing they said leaves someone possibly hurt. */
export function injuryDenied(text: string): boolean {
  const said = foldAccents(text).replace(/[\u2018\u2019]/g, "'"); // case kept: a name is a capital
  const t = denialText(text);
  if (said.length !== t.length) return false; // an index must hold in both; if not, keep the 911 line
  const spans = denialSpans(t);
  if (!spans.length) return false;
  if (HEDGE.test(t)) return false;
  if (spans.some(([s]) => NOT_SAID.test(t.slice(0, s)))) return false;
  if (spans.some(([, e]) => QUESTION.test(t.slice(e)) || BUT_RIGHT_AFTER.test(t.slice(e)))) return false;
  const rest = blanked(t, spans);
  if (HURT_WORD.test(rest) || PERSON_WORD.test(rest) || EXCEPTION.test(rest)) return false;
  const first = spans[0]![0];
  const after = rest.slice(first);
  if (CORRECTION.test(after) || ELLIPSIS.test(after)) return false;
  const ex = EXCEPT_WORD.exec(rest);
  if (SELF_WORD.test(rest.slice(Math.min(first, ex ? ex.index : first)))) return false;
  // A name after the denial ("…nobody was injured, John fell"): a capital that does not start a sentence.
  if (/[^.!?\s]\s+(?!I\b|I'|God\b|Dios\b)[A-Z]/.test(blanked(said, spans).slice(first))) return false;
  return true;
}
