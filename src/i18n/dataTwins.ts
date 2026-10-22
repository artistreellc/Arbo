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
//     back-translation for every briefing and every safety-class question;
//   - a question has the same number of options as the English (answers are
//     keyed by position) and names who re-checked that the keyed answer is
//     still the only correct one (keyCheckedBy); a lesson (nothing graded)
//     needs no key check;
//   - every Spanish line passes the ban list and the serving gates (no lost
//     number, phone, § cite, "ft", value slot or STOP) — servableEs.
// Anything else: null, and the phone shows the English, marked "en inglés".
// Grading never sees a twin: src/training/grading.ts grades the English key
// by position.
import { enSha, servableEs } from './twin.js';
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

/** The Spanish of the day's briefing to serve beside its English, or null (the English shows, marked). */
export function briefingTwin(enText: string, raw: unknown): string | null {
  if (!isObj(raw) || typeof enText !== 'string' || !said(raw.text)) return null;
  if (raw.enSha !== enSha(enText)) return null; // the office changed the English since
  // A briefing is safety text whatever its words: it is always back-translated.
  if (!reviewRecorded(raw, true)) return null;
  return servableEs(enText, raw.text as string) ? (raw.text as string) : null;
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
  const safety = isSafetyClass(item.prompt) || item.options.some((o) => isSafetyClass(o));
  if (!reviewRecorded(raw, safety)) return null;
  const prompt = raw.prompt as string;
  const es = options as string[];
  if (!servableEs(item.prompt, prompt) || item.options.some((o, i) => !servableEs(o, es[i]!))) return null;
  return { prompt, options: [...es] };
}
