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
// Spanish-speaking callers (R26, Mike 2026-10-20). Default he approved:
// DETECT AND FLAG ONLY. Arbo still answers in English — what a Spanish
// caller hears is Mike's call, not this file's. All this does is let the
// owner see "Spanish speaker" on the call and the lead.
//
// Deterministic and deliberately small: a short list of words a Spanish
// speaker says when calling a tree service, and at least TWO different ones
// before the flag goes up, so one loanword ("hola", a "Casa Linda" street
// name) never marks an English caller.

export type CallerLanguage = 'es';

/**
 * Accents off ("árbol" → "arbol", "cayó" → "cayo"). JS word boundaries are
 * ASCII-only, so \bárbol can never match; folding first lets plain \b work,
 * and catches a speech-to-text that drops the accents anyway.
 */
export function foldAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Folded and lower-case. No word here is also an everyday English word.
const SPANISH_WORDS = [
  'hola', 'arbol', 'arboles', 'rama', 'ramas', 'techo', 'casa', 'necesito', 'ayuda', 'ayudar',
  'cayo', 'cortar', 'corten', 'emergencia', 'por favor', 'cuanto', 'cuesta', 'gracias',
  'tengo', 'quiero', 'usted', 'miedo', 'senor', 'senora', 'buenos dias', 'buenas tardes',
];
const WORD_RES = SPANISH_WORDS.map((w) => new RegExp(`\\b${w}\\b`, 'i'));

/** 'es' when the caller's words carry two or more different Spanish words, else null. */
export function detectCallerLanguage(text: string): CallerLanguage | null {
  const folded = foldAccents(text);
  let hits = 0;
  for (const re of WORD_RES) {
    if (re.test(folded)) hits++;
    if (hits >= 2) return 'es';
  }
  return null;
}
