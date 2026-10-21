// Maps wave A (docs/MAPS_PLAN.md "One data shape" → "ZIP centroids"). Where a
// ZIP sits on the map when Arbo has no exact spot for a stop: one point per ZIP
// area, from the Census 2020 ZCTA Gazetteer (public domain) — only for a ZIP
// serviceCityForZip accepts AND that appears there as a ZCTA. An accepted ZIP
// with no ZCTA (a PO box or business ZIP) is NAMED — "ZIP has no map area" —
// never given a made-up point.
//
// §1B — NOT CHECKED YET, SO EMPTY. The build sandbox could not reach the
// Census host (2026-10-21: the egress proxy refused www2.census.gov with a
// policy 403, and that refusal is reported, not routed around). A point typed
// from memory would be a guess drawn as a fact, so the table ships EMPTY and
// every accepted ZIP reads "not loaded" until someone fills it from the file
// below and dates it. To fill it: download ZCTA_SOURCE.url, take the rows whose
// GEOID is in ACCEPTED_ZIPS, copy INTPTLAT/INTPTLONG rounded to 5 decimals
// into ZIP_CENTROIDS, list every accepted ZIP with no row in ZIP_NO_AREA, and
// set ZCTA_SOURCE.checked to that day (test/zipCentroids.test.ts holds it to
// all three). Check at least 23450, 23466, 23467, 23471, 23479, 23501, 23506,
// 23541, 23551, 23326–23328 and 23705 by hand.
//
// Points are { lat, lon } — the map's one shape (Bouncie and TomTom use lon).

import { serviceCityForZip } from './address.js';

export interface ZipCentroid {
  lat: number;
  lon: number;
}

export const ZCTA_SOURCE: { url: string; name: string; checked: string | null; notChecked: string | null } = {
  url: 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip',
  name: 'U.S. Census Bureau, 2020 ZCTA Gazetteer file (public domain)',
  checked: null,
  notChecked: 'The build sandbox could not reach www2.census.gov (refused by its network policy, 2026-10-21), so no ZIP point was loaded. Nothing was filled from memory.',
};

/** ZIP → its ZCTA's internal point, rounded to 5 decimals. Empty until checked against ZCTA_SOURCE. */
export const ZIP_CENTROIDS: Readonly<Record<string, ZipCentroid>> = Object.freeze({});

/** Accepted ZIPs that have no ZCTA in the source (PO box, unique or business ZIPs). Empty until checked. */
export const ZIP_NO_AREA: readonly string[] = Object.freeze([]);

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
