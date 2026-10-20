// Storm-law awareness flag (R26, Mike 2026-10-20) — OWNER-ONLY, read-only.
//
// Virginia's Post-Disaster Anti-Price Gouging Act applies during a "time of
// disaster" (Va. Code § 59.1-526, as amended by 2024 c. 549): the LONGER of
// (i) the period a state of emergency declared by the Governor or the
// President is in effect, or (ii) 30 days after the occurrence of the disaster
// that resulted in the declaration. Its necessary goods and services include
// tree removal and emergency cleanup. § 59.1-527 measures a price against the
// 10 days before. Arbo never computes, compares or shows a price. When a
// federal declaration covers one of the four cities it says exactly one
// sentence, STORM_LAW_FLAG, and the legal reading is counsel's.
//
// Arbo can read only the federal half: OpenFEMA's disaster declarations
// (public, keyless). A declaration counts while its incident is open and for
// STORM_LAW_TAIL_DAYS after FEMA's incident end date — prong (ii), counted
// from the end of the incident, never earlier than its occurrence. The
// Governor's half is in no feed Arbo can read, so GOVERNOR_NOTE rides every
// answer — 'none' here means "no FEMA declaration for the four cities whose
// incident is open or ended within the last 30 days", never "no emergency".
//
// §1B: a read that failed is 'unreadable', never 'none'. The check never
// throws upward; every failure comes back as a named state with its reason.

import type { ServiceCity } from '../lib/address.js';

export const STORM_LAW_FLAG = 'Virginia post-disaster price law in effect — check with counsel';
export const GOVERNOR_NOTE = 'Governor declarations are not in any feed Arbo can read — check governor.virginia.gov.';

/** § 59.1-526 (ii): the law runs at least this long after the disaster. */
export const STORM_LAW_TAIL_DAYS = 30;
const TAIL_MS = STORM_LAW_TAIL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Virginia declarations whose incident is still open or ended within the last
 * STORM_LAW_TAIL_DAYS, one row per designated area. Built per read from the
 * injected clock, never once at load. $top is explicit so a full page can be
 * recognised as possibly cut short instead of read as the whole list.
 */
export const OPENFEMA_PAGE = 1000;
export function openFemaUrl(now: Date): string {
  const since = new Date(now.getTime() - TAIL_MS).toISOString();
  const filter = `state eq 'VA' and (incidentEndDate eq null or incidentEndDate ge '${since}')`;
  return 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries' +
    `?$filter=${encodeURIComponent(filter)}&$top=${OPENFEMA_PAGE}`;
}

/**
 * FIPS county codes for the four cities (OpenFEMA's fipsCountyCode). A
 * statewide designation carries '000' and covers all four.
 */
export const CITY_FIPS: Record<ServiceCity, string> = {
  'Virginia Beach': '810',
  Norfolk: '710',
  Chesapeake: '550',
  Portsmouth: '740',
};
const STATEWIDE_FIPS = '000';

/** A successful read is kept for an hour; a failed one is asked again next time. */
export const STORM_LAW_CACHE_MS = 60 * 60 * 1000;
/** How long Arbo waits on FEMA before naming the read unreadable. */
export const STORM_LAW_TIMEOUT_MS = 15_000;

export type StormLawState = 'active' | 'none' | 'unreadable';

export interface StormDeclaration {
  /** FEMA's disaster number (3631 for EM-3631-VA). */
  number: number;
  title: string;
  /** When FEMA declared it, as FEMA gives it (ISO). */
  declared: string;
}

export interface StormLawStatus {
  state: StormLawState;
  /** One entry per declaration covering a service city — empty unless active. */
  declarations: StormDeclaration[];
  /** STORM_LAW_FLAG when active, otherwise null. Never a price. */
  flag: string | null;
  governorNote: string;
  /** When Arbo asked FEMA (ISO) — a cached answer keeps its own time. */
  checkedAt: string;
  /** Unreadable only: why, in plain words. Never a guess at the answer. */
  reason: string | null;
}

export type StormLawFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface StormLawCheck {
  status(): Promise<StormLawStatus>;
}

type Verdict = Pick<StormLawStatus, 'state' | 'declarations' | 'reason'>;

const unreadable = (reason: string): Verdict => ({ state: 'unreadable', declarations: [], reason });

const AREA_NAMES = Object.keys(CITY_FIPS).map((c) => c.toLowerCase());
const CITY_CODES = new Set(Object.values(CITY_FIPS));

interface FemaRow {
  state?: unknown;
  incidentEndDate?: unknown;
  declarationType?: unknown;
  disasterNumber?: unknown;
  declarationTitle?: unknown;
  declarationDate?: unknown;
  designatedArea?: unknown;
  fipsCountyCode?: unknown;
}

/** Does this row's designated area take in one of the four cities (or all of Virginia)? */
function covers(row: FemaRow): boolean {
  const area = typeof row.designatedArea === 'string' ? row.designatedArea.trim().toLowerCase() : null;
  // FEMA names a city "Virginia Beach (Independent City)".
  if (area !== null && (area === 'statewide' || AREA_NAMES.some((c) => area === c || area.startsWith(`${c} (`)))) return true;
  if (typeof row.fipsCountyCode !== 'string') return false;
  if (CITY_CODES.has(row.fipsCountyCode)) return true;
  // '000' (no county) counts as statewide only when the row names no other
  // area — "Statewide" itself is matched by name above.
  return row.fipsCountyCode === STATEWIDE_FIPS && area === null;
}

/** FEMA's incident end in epoch ms: null while the incident is open, NaN when Arbo cannot read it. */
function incidentEnd(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  return typeof v === 'string' ? Date.parse(v) : NaN;
}

/**
 * Pure: FEMA's answer → a verdict, judged at `now` (the check's injected
 * clock). Anything Arbo cannot read is 'unreadable' by name — a list that is
 * missing, a full page, a row that does not say where it applies, or a
 * covering row without its number, title, date or a readable incident end.
 */
export function judgeDeclarations(body: unknown, now: Date = new Date()): Verdict {
  const rows = (body as { DisasterDeclarationsSummaries?: unknown } | null)?.DisasterDeclarationsSummaries;
  if (!Array.isArray(rows)) return unreadable('FEMA’s answer did not carry a declarations list.');
  if (rows.length >= OPENFEMA_PAGE) return unreadable('FEMA returned a full page — the list may be cut short.');
  const since = now.getTime() - TAIL_MS;
  const byNumber = new Map<number, StormDeclaration>();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') return unreadable('FEMA’s list held an entry Arbo could not read.');
    const row = raw as FemaRow;
    // The URL already asks for Virginia incidents open or ended within the
    // tail; a row that is neither is FEMA not applying the filter, and it
    // never counts. An open incident counts; one that ended counts for
    // STORM_LAW_TAIL_DAYS after (§ 59.1-526 (ii)). An end Arbo cannot read
    // (NaN) is not past the tail — it is judged below, if the row covers.
    if (row.state !== undefined && row.state !== 'VA') continue;
    const ended = incidentEnd(row.incidentEndDate);
    if (ended !== null && ended < since) continue;
    // A fire management (FM) grant is FEMA's, not a President's declaration;
    // emergencies (EM) and major disasters (DR) are the President's.
    if (row.declarationType === 'FM') continue;
    if (typeof row.designatedArea !== 'string' && typeof row.fipsCountyCode !== 'string') {
      return unreadable('FEMA listed a declaration without saying where it applies.');
    }
    if (!covers(row)) continue;
    // Never guessed open, never guessed past the tail (§1B).
    if (Number.isNaN(ended)) return unreadable('FEMA listed a declaration for the service cities whose incident end Arbo could not read.');
    const { disasterNumber: n, declarationTitle: title, declarationDate: declared } = row;
    if (typeof n !== 'number' || typeof title !== 'string' || typeof declared !== 'string') {
      return unreadable('FEMA listed a declaration for the service cities that Arbo could not read.');
    }
    if (!byNumber.has(n)) byNumber.set(n, { number: n, title, declared });
  }
  const declarations = [...byNumber.values()];
  return { state: declarations.length > 0 ? 'active' : 'none', declarations, reason: null };
}

/** Resolves to null after `ms`: a FEMA that never answers is a named failure, not a page left hanging. */
const giveUpAfter = (ms: number) =>
  new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), ms).unref();
  });

/**
 * One read of OpenFEMA, asked and judged at `now`. Never throws: every failure
 * is a named verdict. The one deadline covers the whole read — the answer AND
 * its body — so a body that stalls is named, never a page left hanging.
 */
async function readFema(fetchFn: StormLawFetch, now: Date): Promise<Verdict> {
  const once = async (): Promise<Verdict> => {
    let res: Awaited<ReturnType<StormLawFetch>>;
    try {
      res = await fetchFn(openFemaUrl(now), { headers: { accept: 'application/json' } });
    } catch {
      return unreadable('Arbo could not reach FEMA.');
    }
    if (!res.ok) return unreadable(`FEMA answered HTTP ${res.status}.`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return unreadable('FEMA’s answer was not readable.');
    }
    return judgeDeclarations(body, now);
  };
  let verdict: Verdict | null;
  try {
    verdict = await Promise.race([once(), giveUpAfter(STORM_LAW_TIMEOUT_MS)]);
  } catch {
    return unreadable('Arbo could not reach FEMA.');
  }
  return verdict ?? unreadable('FEMA did not answer in time.');
}

/**
 * The owner-only check behind GET /api/storm/law. Injected fetch and clock;
 * one FEMA read at a time, a good answer kept for an hour.
 */
export function createStormLawCheck(fetchFn: StormLawFetch, now: () => Date = () => new Date()): StormLawCheck {
  let cached: { at: number; value: StormLawStatus } | null = null;
  let inflight: Promise<StormLawStatus> | null = null;

  const read = async (): Promise<StormLawStatus> => {
    const at = now();
    let verdict: Verdict;
    try {
      verdict = await readFema(fetchFn, at);
    } catch {
      verdict = unreadable('Arbo could not reach FEMA.');
    }
    const value: StormLawStatus = {
      state: verdict.state,
      declarations: verdict.declarations,
      flag: verdict.state === 'active' ? STORM_LAW_FLAG : null,
      governorNote: GOVERNOR_NOTE,
      checkedAt: at.toISOString(),
      reason: verdict.reason,
    };
    if (value.state !== 'unreadable') cached = { at: at.getTime(), value };
    return value;
  };

  return {
    status(): Promise<StormLawStatus> {
      if (cached && now().getTime() - cached.at < STORM_LAW_CACHE_MS) return Promise.resolve(cached.value);
      inflight ??= read().finally(() => {
        inflight = null;
      });
      return inflight;
    },
  };
}
