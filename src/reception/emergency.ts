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
  return {
    call911: reasons.some((r) => MAY_HURT_SOMEONE.has(r)),
    callDominion: reasons.includes('power line involved'),
  };
}
