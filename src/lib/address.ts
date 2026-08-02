// Address normalization (brief §7, §12). One property must never become two
// twins because of "123 Oak St" vs "123 oak street." Everything keys off the
// normalized form; the DB has a UNIQUE constraint on it.

/** The four — and only — served cities (brief §2). */
export const SERVICE_CITIES = ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Portsmouth'] as const;
export type ServiceCity = (typeof SERVICE_CITIES)[number];

const CITY_LOOKUP = new Map<string, ServiceCity>(SERVICE_CITIES.map((c) => [c.toLowerCase(), c]));

// Common street-type abbreviations → canonical short form.
const STREET_TYPES: Record<string, string> = {
  street: 'st', st: 'st',
  avenue: 'ave', ave: 'ave', av: 'ave',
  road: 'rd', rd: 'rd',
  drive: 'dr', dr: 'dr',
  lane: 'ln', ln: 'ln',
  court: 'ct', ct: 'ct',
  boulevard: 'blvd', blvd: 'blvd',
  place: 'pl', pl: 'pl',
  terrace: 'ter', ter: 'ter',
  circle: 'cir', cir: 'cir',
  trail: 'trl', trl: 'trl',
  parkway: 'pkwy', pkwy: 'pkwy',
  highway: 'hwy', hwy: 'hwy',
  way: 'way',
  crescent: 'cres', cres: 'cres',
};

// Directional abbreviations → canonical.
const DIRECTIONS: Record<string, string> = {
  north: 'n', n: 'n', south: 's', s: 's', east: 'e', e: 'e', west: 'w', w: 'w',
  northeast: 'ne', ne: 'ne', northwest: 'nw', nw: 'nw',
  southeast: 'se', se: 'se', southwest: 'sw', sw: 'sw',
};

// Unit designators → canonical "unit".
const UNIT_WORDS = new Set(['apt', 'apartment', 'unit', 'ste', 'suite', '#']);

/**
 * Canonicalize an address into a stable dedupe key: lowercased, punctuation
 * stripped, whitespace collapsed, street-types/directions/units standardized.
 */
export function normalizeAddress(raw: string): string {
  if (!raw) return '';
  let s = raw.toLowerCase().trim();
  s = s.replace(/[.,]/g, ' '); // drop periods/commas
  s = s.replace(/#/g, ' unit '); // "#4" -> "unit 4"
  s = s.replace(/\s+/g, ' ').trim();

  const tokens = s.split(' ').filter(Boolean);
  const out = tokens.map((t) => {
    if (STREET_TYPES[t]) return STREET_TYPES[t];
    if (DIRECTIONS[t]) return DIRECTIONS[t];
    if (UNIT_WORDS.has(t)) return 'unit';
    return t;
  });

  // Collapse any accidental repeated "unit unit".
  const deduped: string[] = [];
  for (const t of out) {
    if (t === 'unit' && deduped[deduped.length - 1] === 'unit') continue;
    deduped.push(t);
  }
  return deduped.join(' ').replace(/\s+/g, ' ').trim();
}

/** Resolve a free-text city to a served city, or null if not served (§2). */
export function resolveServiceCity(city: string | undefined | null): ServiceCity | null {
  if (!city) return null;
  return CITY_LOOKUP.get(city.trim().toLowerCase()) ?? null;
}

/** True only for the four CORE cities — the ones with a permit ruleset. */
export function isServiceCity(city: string | undefined | null): boolean {
  return resolveServiceCity(city) !== null;
}

/**
 * Cities Art-is-Tree CAN work but is not currently marketing in (owner, Mike,
 * 2026-08-02: "we're just not advertising there for the season, too much work
 * closer to home"). This is a MARKETING boundary, not a licensing one — the
 * distinction matters because Arbo used to hard-REJECT these addresses at
 * intake, which threw away a real lead for a job Mike would happily take.
 *
 * OWNER RULING R1 — see docs/OWNER_RULINGS.md. DO NOT "fix" this by adding
 * Suffolk to SERVICE_CITIES or by making serviceCityForZip resolve a Suffolk
 * ZIP: both would let Suffolk inherit another city's permit rules.
 *
 * They are deliberately NOT ServiceCity: the four core cities each have a
 * permit ruleset behind them, and screening a Suffolk property against
 * Virginia Beach rules would produce a confident, wrong answer. Off-focus
 * cities are accepted, flagged, and screened as NO RULESET (§1B).
 */
export const OFF_FOCUS_CITIES = ['Suffolk'] as const;
export type OffFocusCity = (typeof OFF_FOCUS_CITIES)[number];

const OFF_FOCUS_LOOKUP = new Map<string, OffFocusCity>(
  OFF_FOCUS_CITIES.map((c) => [c.toLowerCase(), c]),
);

export function resolveOffFocusCity(city: string | undefined | null): OffFocusCity | null {
  if (!city) return null;
  return OFF_FOCUS_LOOKUP.get(city.trim().toLowerCase()) ?? null;
}

/** Core service city OR a city we can work but are not advertising in. */
export function isWorkableCity(city: string | undefined | null): boolean {
  return isServiceCity(city) || resolveOffFocusCity(city) !== null;
}

/**
 * ZIP → served city, for lead sources that give a ZIP and no city (the CallRail
 * web form is one). Ranges are the USPS assignments for the four served cities;
 * anything outside them resolves to null, which the caller must treat as
 * UNKNOWN and flag for review — never as "not our area" and never as a guess
 * (§1B, §3.7). Suffolk (234xx-adjacent 23432-23439, 23315…) is deliberately
 * absent: Arbo holds no Suffolk license and must never imply it does.
 */
const ZIP_RANGES: Array<{ city: ServiceCity; from: number; to: number }> = [
  { city: 'Virginia Beach', from: 23450, to: 23467 },
  { city: 'Virginia Beach', from: 23471, to: 23471 },
  { city: 'Virginia Beach', from: 23479, to: 23479 },
  { city: 'Norfolk', from: 23501, to: 23529 },
  { city: 'Norfolk', from: 23541, to: 23541 },
  { city: 'Norfolk', from: 23551, to: 23551 },
  { city: 'Chesapeake', from: 23320, to: 23328 },
  { city: 'Portsmouth', from: 23701, to: 23709 },
];

export function serviceCityForZip(zip: string | undefined | null): ServiceCity | null {
  if (!zip) return null;
  const n = Number(zip.trim().slice(0, 5));
  if (!Number.isInteger(n)) return null;
  return ZIP_RANGES.find((r) => n >= r.from && n <= r.to)?.city ?? null;
}

/** Best-effort 5-digit ZIP extraction (drives route clustering, §5 #10). */
export function extractZip(raw: string): string | null {
  const m = raw.match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? (m[1] ?? null) : null;
}

export interface ParsedAddress {
  raw: string;
  normalized: string;
  city: ServiceCity | null;
  zip: string | null;
  inServiceArea: boolean;
  /**
   * Set when the address is in a city we CAN work but are not marketing in.
   * The caller must accept the lead and flag it — never reject it.
   */
  offFocusCity: OffFocusCity | null;
}

/**
 * Parse a raw address string. `cityHint` (e.g. captured separately on a call)
 * takes precedence; otherwise we try to detect a served city inside the string.
 */
export function parseAddress(raw: string, cityHint?: string): ParsedAddress {
  let city = resolveServiceCity(cityHint);
  if (!city) {
    // Strip punctuation so "..., Chesapeake, VA ..." matches on word boundaries.
    const lower = ` ${raw.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim()} `;
    for (const c of SERVICE_CITIES) {
      if (lower.includes(` ${c.toLowerCase()} `)) { city = c; break; }
    }
  }
  // Off-focus detection runs whether or not a core city matched, so a Suffolk
  // address is identified rather than falling through as simply "not ours".
  let offFocus = resolveOffFocusCity(cityHint);
  if (!city && !offFocus) {
    const lower = ` ${raw.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `;
    for (const c of OFF_FOCUS_CITIES) {
      if (lower.includes(` ${c.toLowerCase()} `)) { offFocus = c; break; }
    }
  }
  return {
    raw,
    normalized: normalizeAddress(raw),
    city,
    zip: extractZip(raw),
    inServiceArea: city !== null,
    offFocusCity: offFocus,
  };
}
