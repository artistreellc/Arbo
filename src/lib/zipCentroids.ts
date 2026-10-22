// Maps wave A (docs/MAPS_PLAN.md "One data shape" → "ZIP centroids"). Where a
// ZIP sits on the map when Arbo has no exact spot for a stop or a lead: one
// point per ZIP area, the Census 2020 ZCTA internal point (public domain) —
// only for a ZIP serviceCityForZip accepts AND that the Census has as a ZCTA.
// An accepted ZIP with no ZCTA (a PO box or business ZIP) is NAMED — "ZIP has
// no map area" — never given a made-up point.
//
// FILLED 2026-10-22 (Maps wave B, D108). Wave A shipped this table empty: the
// Gazetteer's host (www2.census.gov) was refused from the build machine, and
// no point is ever typed from memory. The same Census 2020 points — the
// TIGER/Line 2020 ZCTA internal points the 2020 Gazetteer publishes — were
// read from the Census TIGERweb "Census 2020 → ZIP Code Tabulation Areas"
// layer (ZCTA_SOURCE: its public query for the 69 ACCEPTED_ZIPS) on
// 2026-10-22, then read again the same day before filling: both answers
// matched value for value. 39 accepted ZIPs have a ZCTA (ZIP_CENTROIDS,
// INTPTLAT/INTPTLON rounded to 5 decimals); the other 30 returned none
// (ZIP_NO_AREA). The plan's hand-check list came out: 23450, 23466, 23467,
// 23471, 23479, 23501, 23506, 23541, 23326–23328 and 23705 have no area;
// 23551 is placed. test/zipCentroids.test.ts holds all of it.
//
// To check it again: run ZCTA_SOURCE.query against ZCTA_SOURCE.url and compare
// every value; a change is a dated edit here, never a guess.
//
// Points are { lat, lon } — the map's one shape (Bouncie and TomTom use lon).

import { serviceCityForZip } from './address.js';

export interface ZipCentroid {
  lat: number;
  lon: number;
}

export const ZCTA_SOURCE: { url: string; name: string; query: string; checked: string | null; notChecked: string | null } = {
  url: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/11',
  name: 'U.S. Census Bureau, Census 2020 ZIP Code Tabulation Areas (ZCTA) internal points, TIGERweb layer 11 — the same TIGER/Line 2020 points the 2020 ZCTA Gazetteer publishes (public domain)',
  query: "query?where=ZCTA5 IN ('23320', … every ZIP in ACCEPTED_ZIPS)&outFields=ZCTA5,INTPTLAT,INTPTLON&returnGeometry=false&f=json",
  checked: '2026-10-22',
  notChecked: null,
};

/** ZIP → its ZCTA's internal point (INTPTLAT, INTPTLON), rounded to 5 decimals. Checked against ZCTA_SOURCE. */
export const ZIP_CENTROIDS: Readonly<Record<string, ZipCentroid>> = Object.freeze({
  '23320': { lat: 36.75173, lon: -76.21764 },
  '23321': { lat: 36.8004, lon: -76.42115 },
  '23322': { lat: 36.62599, lon: -76.26777 },
  '23323': { lat: 36.697, lon: -76.37992 },
  '23324': { lat: 36.79986, lon: -76.27356 },
  '23325': { lat: 36.81362, lon: -76.23986 },
  '23451': { lat: 36.87236, lon: -76.00432 },
  '23452': { lat: 36.84581, lon: -76.09196 },
  '23453': { lat: 36.78349, lon: -76.07121 },
  '23454': { lat: 36.8646, lon: -76.05512 },
  '23455': { lat: 36.88605, lon: -76.14728 },
  '23456': { lat: 36.73705, lon: -76.0359 },
  '23457': { lat: 36.61738, lon: -76.01534 },
  '23459': { lat: 36.91681, lon: -76.17175 },
  '23460': { lat: 36.81849, lon: -76.0316 },
  '23461': { lat: 36.7706, lon: -75.96377 },
  '23462': { lat: 36.83624, lon: -76.14595 },
  '23464': { lat: 36.79692, lon: -76.18763 },
  '23502': { lat: 36.86059, lon: -76.20488 },
  '23503': { lat: 36.94879, lon: -76.26646 },
  '23504': { lat: 36.8573, lon: -76.26561 },
  '23505': { lat: 36.91288, lon: -76.2996 },
  '23507': { lat: 36.86456, lon: -76.30322 },
  '23508': { lat: 36.88528, lon: -76.31034 },
  '23509': { lat: 36.88247, lon: -76.26394 },
  '23510': { lat: 36.85241, lon: -76.29148 },
  '23511': { lat: 36.9374, lon: -76.30903 },
  '23513': { lat: 36.88928, lon: -76.23694 },
  '23517': { lat: 36.86924, lon: -76.29205 },
  '23518': { lat: 36.91612, lon: -76.21538 },
  '23523': { lat: 36.83086, lon: -76.27226 },
  '23551': { lat: 36.92354, lon: -76.29255 },
  '23701': { lat: 36.81197, lon: -76.36938 },
  '23702': { lat: 36.80327, lon: -76.32672 },
  '23703': { lat: 36.89334, lon: -76.37329 },
  '23704': { lat: 36.8267, lon: -76.31203 },
  '23707': { lat: 36.84179, lon: -76.34033 },
  '23708': { lat: 36.84768, lon: -76.30408 },
  '23709': { lat: 36.81721, lon: -76.29885 },
});

/** Accepted ZIPs the source has no ZCTA for (PO box, unique, business or unassigned ZIPs) — named, never placed. */
export const ZIP_NO_AREA: readonly string[] = Object.freeze([
  '23326', '23327', '23328', '23450', '23458', '23463', '23465', '23466', '23467', '23471',
  '23479', '23501', '23506', '23512', '23514', '23515', '23516', '23519', '23520', '23521',
  '23522', '23524', '23525', '23526', '23527', '23528', '23529', '23541', '23705', '23706',
]);

/**
 * The four cities' extent, padded — a VIEW box (where the map opens, and the
 * least it lets you pan to), never a placed point.
 */
export const FOUR_CITY_BOX = Object.freeze({ south: 36.53, west: -76.58, north: 36.99, east: -75.84 });

/** Every 23xxx ZIP serviceCityForZip accepts, in order — ranges include PO-box and unassigned ZIPs. */
export const ACCEPTED_ZIPS: readonly string[] = Object.freeze(
  Array.from({ length: 1000 }, (_, i) => String(23000 + i)).filter((z) => serviceCityForZip(z) !== null),
);

export type ZipMiss = 'no_area' | 'not_loaded' | 'outside';
export type ZipPlace = { ok: true; lat: number; lon: number } | { ok: false; why: ZipMiss };

/** Why a ZIP area is not on the map, in Mike's words. */
export const ZIP_WHY: Record<ZipMiss, string> = {
  no_area: 'ZIP has no map area (PO box or business ZIP)',
  outside: 'ZIP outside the four cities',
  not_loaded: 'ZIP areas are not loaded on the map yet — not placed',
};

/** A ZIP's map point, or why it has none. Never a guess. */
export function zipPoint(zip: string | null | undefined): ZipPlace {
  const z = typeof zip === 'string' ? zip.trim() : '';
  if (!/^\d{5}$/.test(z) || serviceCityForZip(z) === null) return { ok: false, why: 'outside' };
  const p = ZIP_CENTROIDS[z];
  if (p) return { ok: true, lat: p.lat, lon: p.lon };
  if (ZIP_NO_AREA.includes(z)) return { ok: false, why: 'no_area' };
  return { ok: false, why: 'not_loaded' };
}
