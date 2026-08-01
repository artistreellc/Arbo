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

/** True only for the four served cities — Suffolk (etc.) is false. */
export function isServiceCity(city: string | undefined | null): boolean {
  return resolveServiceCity(city) !== null;
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
  return {
    raw,
    normalized: normalizeAddress(raw),
    city,
    zip: extractZip(raw),
    inServiceArea: city !== null,
  };
}
