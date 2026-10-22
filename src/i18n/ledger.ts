// R27 (D110) — the review ledger (docs/R27_SPANISH_PLAN.md, "How quality is
// checked" 4). src/i18n/reviewed.json records a fingerprint for each
// safety-class Spanish string: the exact English, the exact Spanish, and how
// far its review has got. A later edit to either side that is not re-reviewed
// fails the build (test/esGlossaryTwinLedger.test.ts runs ledgerProblems over
// every safety-class pair in the repo).
//
// Review passes, in order (R27 #5, the plan's "Two independent passes"):
//   draft    — written (the plan's table, or a first translation); not served
//   reviewed — a second, blind translation pass agreed, and a third pass
//              back-translated it to English without seeing the original
//   person   — a Spanish-reading crew member read it on a phone (R29 #3:
//              "rudy or marco or temo")
// A safety-class Spanish string is SERVED only at 'reviewed' or 'person'.
//
// Safety-class is decided from the English itself, so nobody can skip the
// ledger by leaving a flag off.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type ReviewPass = 'draft' | 'reviewed' | 'person';

export interface LedgerEntry {
  en: string;
  es: string;
  /** pairSha(en, es) — the fingerprint of this exact pair. */
  sha: string;
  /** Where the pair lives: 'glossary:safety', 'dict:crew-gate', 'twin:workOrder'… */
  where: string;
  pass: ReviewPass;
  translatedBy: string;
  reviewedBy?: string;
  backTranslation?: string;
  readBy?: string;
  on: string;
  /** Where the review stands, in words (review round, D111) — never a substitute for `pass`. */
  note?: string;
}

export interface CurrentPair { en: string; es: string; where: string }

/** The fingerprint of one exact English line with one exact Spanish line. */
export function pairSha(en: string, es: string): string {
  return createHash('sha256').update(`${en}\u0000${es}`, 'utf8').digest('hex');
}

// The badges as they are written on screen — upper case, matched as written.
const SAFETY_BADGES = /\b(?:PERMIT LIKELY|REVIEW NEEDED|NO OVERLAY|PERMIT SCREEN|PERMIT STATUS|HELD|NO AERIAL WORK|NO EXPIRY DATE|EMERGENCY|POWER LINES|STRUCTURES|CALL FIRST|TICKET REQUIRED|STOP WORK|DOWN|EXPIRED|NO RECORD|UNCONFIRMED|STOP)\b/;
// The safety lines, however they are cased.
const SAFETY_LINES = /\b(?:911|811|Dominion|Miss Utility|stop work|do not start work|don['’]t start work)\b/i;

/** True when the English is a safety or legal label or line — its Spanish needs the ledger. */
export function isSafetyClass(en: string): boolean {
  return SAFETY_BADGES.test(en) || SAFETY_LINES.test(en);
}

const LEDGER = new URL('./reviewed.json', import.meta.url);

/**
 * The ledger at `url`, never a throw (review round, D110). A file that cannot
 * be read or parsed, or has no entries list, is NO entries plus the reason:
 * for serving that fails closed (every safety-class Spanish line is held back
 * and the English shows — a door page never goes blank over it), and the
 * build check names the reason first.
 */
export function readLedger(url: URL = LEDGER): { entries: LedgerEntry[]; error: string | null } {
  try {
    const raw = JSON.parse(readFileSync(url, 'utf8')) as { entries?: unknown };
    if (!raw || !Array.isArray(raw.entries)) return { entries: [], error: 'the review ledger could not be read: it has no entries list' };
    return { entries: raw.entries as LedgerEntry[], error: null };
  } catch (e) {
    return { entries: [], error: `the review ledger could not be read: ${(e as Error).message}` };
  }
}

let cached: { entries: LedgerEntry[]; error: string | null } | null = null;
/** The ledger as committed (read once). Unreadable = no entries — see readLedger. */
export function loadLedger(): LedgerEntry[] {
  if (!cached) cached = readLedger();
  return cached.entries;
}
/** Why the committed ledger could not be read, or null. */
export function ledgerReadError(): string | null {
  loadLedger();
  return cached ? cached.error : null;
}

/**
 * May this Spanish be served for this English? Anything not safety-class: yes.
 * Safety-class: only with a ledger entry for this exact pair, reviewed or read.
 */
export function safetyCleared(en: string, es: string, ledger: LedgerEntry[] = loadLedger()): boolean {
  if (!isSafetyClass(en)) return true;
  const sha = pairSha(en, es);
  return ledger.some((e) => e.sha === sha && e.en === en && e.es === es && (e.pass === 'reviewed' || e.pass === 'person'));
}

/**
 * THE BUILD CHECK. Every safety-class pair in the repo has a ledger entry for
 * exactly that English and that Spanish; every ledger entry still names a pair
 * that exists; every fingerprint is the pair's own. [] means it passes.
 */
export function ledgerProblems(current: CurrentPair[], ledger: LedgerEntry[] = loadLedger(), readError: string | null = ledgerReadError()): string[] {
  const problems: string[] = [];
  if (readError) problems.push(readError);
  for (const e of ledger) {
    if (e.sha !== pairSha(e.en, e.es)) problems.push(`ledger fingerprint does not match its own pair: ${e.en}`);
    if (!['draft', 'reviewed', 'person'].includes(e.pass)) problems.push(`ledger pass "${e.pass}" is not draft, reviewed or person: ${e.en}`);
  }
  const safety = current.filter((p) => isSafetyClass(p.en));
  for (const p of safety) {
    const sha = pairSha(p.en, p.es);
    if (ledger.some((e) => e.sha === sha && e.en === p.en && e.es === p.es)) continue;
    problems.push(ledger.some((e) => e.en === p.en)
      ? `edited and not re-reviewed (${p.where}): ${p.en} → ${p.es}`
      : `no ledger entry (${p.where}): ${p.en} → ${p.es}`);
  }
  for (const e of ledger) {
    if (!safety.some((p) => p.en === e.en && p.es === e.es)) problems.push(`stale ledger entry — no such pair in the repo any more: ${e.en} → ${e.es}`);
  }
  return problems;
}
