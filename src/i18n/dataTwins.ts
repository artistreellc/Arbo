// R27 Phase A unit 1 (D111) — Spanish twins of the text the OFFICE writes into
// the database and the crew door shows: the day's briefing and the quiz
// (docs/R27_SPANISH_PLAN.md, "Quiz and briefing stay correct"; R27 #2, #5).
//
// That text is data: Arbo never translates it. A twin is something a person
// wrote and had reviewed, kept on the row's own body JSON beside the English,
// as `es` — no migration:
//   briefing  body.es = { text, enSha, pass, translatedBy, reviewedBy, backTranslation, readBy?, on }
//   question  body.es = { prompt, options[], enSha, keyCheckedBy, pass, translatedBy, reviewedBy, backTranslation?, readBy?, on }
// It cannot sit in the committed review ledger (a briefing is written per day),
// so the row carries its own review record, and a twin is served ONLY when:
//   - it was made from this exact English — enSha over the briefing text, or
//     over the question's prompt and options IN ORDER (quizEnSha);
//   - its review is recorded: pass 'reviewed' or 'person' (a person pass names
//     who read it, readBy), translatedBy, reviewedBy and the date — and a
//     back-translation for every briefing;
//   - a question has the same number of options as the English (answers are
//     keyed by position) and names who re-checked that the keyed answer is
//     still the only correct one (keyCheckedBy); a lesson (nothing graded)
//     needs no key check;
//   - every Spanish line passes the ban list and EVERY gate (review round, D111,
//     code D1): no lost number, phone, § cite, "ft", value slot or STOP, and no
//     dropped negation, lost hedge or lost "at least" / "working days". This is
//     the only check a database copy ever gets (a dictionary or a twin table is
//     gated in the tests too), so it is the full set: servableEs plus
//     esGateProblems. A briefing is checked paragraph by paragraph, and its copy
//     must have the same number of paragraphs (the page draws them one for one);
//   - the English holds no safety-class line (review round, D111): a safety line
//     (911, 811, Dominion, stop work, a badge) is served in Spanish only once the
//     committed review ledger records it, with the full English beneath — and
//     neither can be done for the office's per-day text yet. Until Mike rules how,
//     a briefing or question holding one shows in English, marked.
// Anything else: null, and the phone shows the English, marked "en inglés".
// Grading never sees a twin: src/training/grading.ts grades the English key
// by position.
import { enSha, servableEs } from './twin.js';
import { esGateProblems } from './gates.js';
import { isSafetyClass } from './ledger.js';

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const said = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;

/** The review recorded on a database twin: reviewed (or read by a named person), by whom, when. */
function reviewRecorded(raw: Raw, needsBackTranslation: boolean): boolean {
  if (raw.pass !== 'reviewed' && raw.pass !== 'person') return false;
  if (!said(raw.translatedBy) || !said(raw.reviewedBy) || !said(raw.on)) return false;
  if (raw.pass === 'person' && !said(raw.readBy)) return false;
  if (needsBackTranslation && !said(raw.backTranslation)) return false;
  return true;
}

/** May this Spanish line stand for this English one: the serving check and every gate (code D1). */
function cleanPair(en: string, es: string): boolean {
  return servableEs(en, es) && esGateProblems(en, es).length === 0;
}
/** A text's paragraphs, as the crew page draws them (one per line; blank lines are not paragraphs). */
const paragraphs = (s: string): string[] => s.split('\n').filter((p) => p.trim());

/** The Spanish of the day's briefing to serve beside its English, or null (the English shows, marked). */
export function briefingTwin(enText: string, raw: unknown): string | null {
  if (!isObj(raw) || typeof enText !== 'string' || !said(raw.text)) return null;
  if (raw.enSha !== enSha(enText)) return null; // the office changed the English since
  // A briefing is safety text whatever its words: it is always back-translated.
  if (!reviewRecorded(raw, true)) return null;
  const en = paragraphs(enText);
  const es = paragraphs(raw.text as string);
  if (en.some(isSafetyClass)) return null; // a safety line needs the ledger and the English beneath
  if (es.length !== en.length) return null; // one Spanish paragraph for each English one
  return en.every((p, i) => cleanPair(p, es[i]!)) ? (raw.text as string) : null;
}

/** The fingerprint of a question exactly as the crew sees it: the prompt and its options, in order. */
export function quizEnSha(prompt: string, options: string[]): string {
  return enSha(JSON.stringify([prompt, ...options]));
}

/**
 * The Spanish of one question (or lesson) to serve, or null. `graded` is true when the item has a key
 * — then the twin must name who re-checked it.
 */
export function quizTwin(item: { prompt: string; options: string[] }, raw: unknown, graded: boolean): { prompt: string; options: string[] } | null {
  if (!isObj(raw) || !said(raw.prompt) || !Array.isArray(raw.options)) return null;
  const options = raw.options as unknown[];
  if (options.length !== item.options.length || !options.every(said)) return null; // same count, none blank
  if (raw.enSha !== quizEnSha(item.prompt, item.options)) return null; // same English, same order
  if (graded && !said(raw.keyCheckedBy)) return null;
  // A safety-class question is never served from its row (review round, D111): see the head of this file.
  if (isSafetyClass(item.prompt) || item.options.some((o) => isSafetyClass(o))) return null;
  if (!reviewRecorded(raw, false)) return null;
  const prompt = raw.prompt as string;
  const es = options as string[];
  if (!cleanPair(item.prompt, prompt) || item.options.some((o, i) => !cleanPair(o, es[i]!))) return null;
  return { prompt, options: [...es] };
}
