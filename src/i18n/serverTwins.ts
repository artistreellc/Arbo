// R27 Phase A unit 1 (D111) — the server twin tables (docs/R27_SPANISH_PLAN.md,
// "Three kinds of text" 2). A fixed line a server module writes keeps its
// English byte-identical in the code; its Spanish lives here, one table per
// module, src/i18n/twins/<table>.es.json:
//
//   { "<id>": { "en": "<the English it was translated from>", "es": "…", "enSha": "<sha256 of en>" } }
//
// The module looks a twin up by id and hands it to withEs/twinFor with the
// English it writes TODAY: if that English has changed, enSha no longer
// matches and the twin is simply not served (the page shows the English with
// "en inglés") — and test/esCrewTwins.test.ts fails the build until the row is
// re-translated, so a corrected safety line can never keep an old meaning.
// A safety-class row is also held back until the review ledger
// (src/i18n/reviewed.json) records its review; currentTwinPairs feeds the
// ledger's build check.
//
// A table that cannot be read serves nothing: the English shows, named in the
// log by table only (§1B) — never a blank, never a crash.
import { readdirSync, readFileSync } from 'node:fs';
import type { EsTwin } from './twin.js';
import type { CurrentPair } from './ledger.js';

export interface TwinRow { en: string; es: string; enSha: string }
export type TwinTable = Record<string, TwinRow>;

const DIR = new URL('./twins/', import.meta.url);
const FILE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.es\.json$/;

/** The tables on disk, by name. Throws when the directory cannot be read ("couldn't read it" is never "none"). */
export function twinTableNames(dir: URL = DIR): string[] {
  return readdirSync(dir).map((f) => FILE.exec(f)?.[1]).filter((n): n is string => Boolean(n)).sort();
}

/** One table, or null when it cannot be read as { id: { en, es, enSha } } with non-empty strings. */
export function readTwinTable(name: string, dir: URL = DIR): TwinTable | null {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(new URL(`${name}.es.json`, dir), 'utf8')); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: TwinTable = {};
  for (const [id, row] of Object.entries(raw as Record<string, unknown>)) {
    const r = row as Partial<TwinRow> | null;
    if (!r || typeof r !== 'object' || [r.en, r.es, r.enSha].some((v) => typeof v !== 'string' || !v.trim())) return null;
    out[id] = { en: r.en!, es: r.es!, enSha: r.enSha! };
  }
  return out;
}

const cache = new Map<string, TwinTable | null>();
const named = new Set<string>();
/** The twin for one line of one table — { es, enSha } — or null (then the English shows). Read once per table. */
export function twinOf(table: string, id: string): EsTwin | null {
  if (!cache.has(table)) cache.set(table, readTwinTable(table));
  const t = cache.get(table);
  if (!t) {
    if (!named.has(table)) { named.add(table); console.error(`[i18n] twin table unreadable: ${table} — its lines show in English`); }
    return null;
  }
  const r = t[id];
  return r ? { es: r.es, enSha: r.enSha } : null;
}

/** Every twin row in the repo as an English/Spanish pair — for the gates and the review ledger's build check. */
export function currentTwinPairs(dir: URL = DIR): CurrentPair[] {
  const pairs: CurrentPair[] = [];
  for (const name of twinTableNames(dir)) {
    const t = readTwinTable(name, dir) ?? {};
    for (const r of Object.values(t)) pairs.push({ en: r.en, es: r.es, where: `twin:${name}` });
  }
  return pairs;
}
