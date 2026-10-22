// R27 (D110) — the screen-copy dictionaries (docs/R27_SPANISH_PLAN.md, "Three
// kinds of text" 1). One file per build unit, src/app/i18n/<door>-<unit>.es.json:
// the English exactly as the page writes it is the key, the Spanish the value.
// The server inlines a door's units into that door's page at serve time
// (src/server/appPage.ts), the sprite's way — so the page works offline and
// the crew page carries only crew strings.
//
// What is inlined is what may be shown. An entry is held back (and the
// English shows) when its Spanish carries a banned word, fails a serving
// gate, or is safety-class without a reviewed ledger entry. A unit file that
// is not a flat object of strings is BROKEN: the page then stays in English
// and says so in both languages (§1B) — never a blank screen.
import { readdirSync, readFileSync } from 'node:fs';
import { glossaryPairs } from './glossary.js';
import { twinFor, enSha } from './twin.js';
import { isSafetyClass, type CurrentPair } from './ledger.js';
import { currentTwinPairs } from './serverTwins.js';

export type Door = 'app' | 'crew';
export const DOORS: readonly Door[] = ['app', 'crew'];

const DIR = new URL('../app/i18n/', import.meta.url);
const UNIT_FILE = /^(app|crew)-([a-z0-9]+(?:-[a-z0-9]+)*)\.es\.json$/;

export interface DoorDictionary {
  door: Door;
  /** unit name ('crew-switch') → its entries that may be shown. */
  units: Record<string, Record<string, string>>;
  /** Units whose file could not be read as a flat object of strings. */
  broken: string[];
  /** Entries held back, by unit and English key — never their text in a log. */
  held: Array<{ unit: string; key: string; why: string }>;
}

/**
 * Every unit file on disk, as { door, unit, file }. THROWS when the directory
 * cannot be read: "couldn't read it" is never "no units" (§1B, review round D110).
 */
export function unitFiles(dir: URL = DIR): Array<{ door: Door; unit: string; file: string }> {
  return readdirSync(dir)
    .map((file) => ({ file, m: UNIT_FILE.exec(file) }))
    .filter((x): x is { file: string; m: RegExpExecArray } => x.m !== null)
    .map(({ file, m }) => ({ door: m[1] as Door, unit: `${m[1]}-${m[2]}`, file }))
    .sort((a, b) => a.unit.localeCompare(b.unit));
}

/** A unit's entries, or null when the file is not a flat object of non-empty strings. */
export function readUnit(file: string, dir: URL = DIR): Record<string, string> | null {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(new URL(file, dir), 'utf8')); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'string' || !k.trim() || !v.trim()) return null;
    out[k] = v;
  }
  return out;
}

/** The door's dictionary as it may be inlined: units, the broken ones named, held entries counted. */
export function loadDoorDictionary(door: Door, dir: URL = DIR): DoorDictionary {
  const dict: DoorDictionary = { door, units: {}, broken: [], held: [] };
  let files: ReturnType<typeof unitFiles>;
  // A directory that cannot be read breaks the whole door, by name — the page then stays English and says so.
  try { files = unitFiles(dir).filter((f) => f.door === door); } catch { dict.broken.push(`${door}-*`); return dict; }
  for (const u of files) {
    const entries = readUnit(u.file, dir);
    if (!entries) { dict.broken.push(u.unit); continue; }
    const kept: Record<string, string> = {};
    for (const [en, es] of Object.entries(entries)) {
      // The same serving rule as a server twin: banned, unservable or an unreviewed safety line is held back.
      if (twinFor(en, { es, enSha: enSha(en) }) === null) { dict.held.push({ unit: u.unit, key: en, why: 'not servable' }); continue; }
      kept[en] = es;
    }
    dict.units[u.unit] = kept;
  }
  return dict;
}

/**
 * Every safety-class English/Spanish pair in the repo — what the review ledger must name: the
 * glossary, the door dictionaries and (D111) the server twin tables (src/i18n/serverTwins.ts).
 */
export function currentSafetyPairs(dir: URL = DIR, twinDir?: URL): CurrentPair[] {
  const pairs: CurrentPair[] = glossaryPairs().filter((p) => isSafetyClass(p.en)).map(({ en, es, where }) => ({ en, es, where }));
  for (const u of unitFiles(dir)) {
    const entries = readUnit(u.file, dir) ?? {};
    for (const [en, es] of Object.entries(entries)) if (isSafetyClass(en)) pairs.push({ en, es, where: `dict:${u.unit}` });
  }
  for (const p of currentTwinPairs(twinDir)) if (isSafetyClass(p.en)) pairs.push(p);
  return pairs;
}
