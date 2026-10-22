// R27 (D110) — server twins (docs/R27_SPANISH_PLAN.md, "Three kinds of text" 2).
// A line a server module writes keeps its English field byte-identical; its
// Spanish goes under `es`, with the same field names. Each twin is stored with
// enSha — the fingerprint of the exact English it was translated from — so
// when the English later changes, the twin is simply not served: the page
// shows the English with a small "en inglés" mark until someone re-translates
// it. A corrected safety line can never keep an old Spanish meaning.
//
// A twin is also refused when its Spanish carries a banned word, drops a
// number, phone, § cite or "ft", or is safety-class without a reviewed ledger
// entry. A refusal is never a blank: the English is always there.
//
// Data is never translated (R27 #2): names, addresses, notes, anything typed,
// transcripts, model-written text and weather headlines are never twinned.
import { createHash } from 'node:crypto';
import { hasBannedEs } from './banList.js';
import { esGateProblems } from './gates.js';
import { safetyCleared, type LedgerEntry } from './ledger.js';

/** The fingerprint of the exact English a twin was translated from. */
export function enSha(en: string): string {
  return createHash('sha256').update(en, 'utf8').digest('hex');
}

/** A stored translation: the Spanish, and the fingerprint of the English it was made from. */
export interface EsTwin { es: string; enSha: string }

// The gate problems that make a twin unsafe to serve at all (the full gate set runs in tests).
const UNSERVABLE = /^(?:empty|banned|placeholders|phone|section|number|"ft"|STOP)/;

/**
 * May this Spanish stand for this English at all — no banned word, no lost number, phone, § cite,
 * "ft", value slot or STOP? The serving check every twin passes (R27 Phase A, D111: the database's
 * reviewed twins pass it too — src/i18n/dataTwins.ts).
 */
export function servableEs(en: string, es: string): boolean {
  if (typeof en !== 'string' || typeof es !== 'string') return false;
  if (!es.trim() || hasBannedEs(es)) return false;
  return !esGateProblems(en, es).some((p) => UNSERVABLE.test(p));
}

/**
 * The Spanish to serve for this English line, or null — and then the English shows. `ledger` is the
 * committed review ledger unless a test hands one in (D111: so a recorded review can be proven
 * without editing reviewed.json).
 */
export function twinFor(en: string, twin: EsTwin | null | undefined, ledger?: LedgerEntry[]): string | null {
  if (!twin || typeof twin.es !== 'string' || typeof twin.enSha !== 'string') return null;
  if (typeof en !== 'string' || twin.enSha !== enSha(en)) return null; // the English moved on
  if (!servableEs(en, twin.es)) return null;
  if (!safetyCleared(en, twin.es, ledger)) return null;
  return twin.es;
}

/**
 * The English object, untouched, plus `es` holding each field whose twin may
 * be served. With none servable it returns the very same object — so English
 * output stays byte-identical whatever twins exist.
 */
export function withEs<T extends object>(en: T, twins: { [K in keyof T]?: EsTwin | null }): T | (T & { es: Partial<Record<keyof T, string>> }) {
  const es: Partial<Record<keyof T, string>> = {};
  let any = false;
  for (const key of Object.keys(twins) as Array<keyof T>) {
    const value = en[key];
    if (typeof value !== 'string') continue;
    const s = twinFor(value, twins[key]);
    if (s !== null) { es[key] = s; any = true; }
  }
  return any ? { ...en, es } : en;
}
