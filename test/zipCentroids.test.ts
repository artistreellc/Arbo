// Maps wave A (docs/MAPS_PLAN.md "One data shape", "ZIP centroids"): a ZIP is
// placed on the map only at a point the Census 2020 ZCTA Gazetteer gives it,
// and only for a ZIP serviceCityForZip accepts. An accepted ZIP with no ZCTA
// (a PO box or business ZIP) is NAMED, never given a made-up point. No point is
// ever shipped without the date it was checked against the source (§1B): a
// table that could not be checked stays empty and says why.
import { describe, it, expect } from 'vitest';
import { ZIP_CENTROIDS, ZIP_NO_AREA, ZCTA_SOURCE, FOUR_CITY_BOX, ACCEPTED_ZIPS, zipPoint, ZIP_WHY } from '../src/lib/zipCentroids.js';
import { serviceCityForZip } from '../src/lib/address.js';

describe('the ZIP centroid table', () => {
  it('names its source; a point is never shipped without the date it was checked', () => {
    // Maps wave B (D108): the source is the Census 2020 ZCTA layer on TIGERweb — the same TIGER/Line 2020
    // internal points the 2020 ZCTA Gazetteer publishes — read through its public query (the Gazetteer's own
    // host was refused from the build machine). The pin's meaning holds: the table names its source and is dated.
    expect(ZCTA_SOURCE.url).toBe('https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/11');
    expect(ZCTA_SOURCE.query).toContain('outFields=ZCTA5,INTPTLAT,INTPTLON');
    expect(ZCTA_SOURCE.query).toContain('ACCEPTED_ZIPS');
    expect(ZCTA_SOURCE.name).toMatch(/2020.*ZCTA.*Gazetteer/);
    if (Object.keys(ZIP_CENTROIDS).length > 0 || ZIP_NO_AREA.length > 0) {
      expect(ZCTA_SOURCE.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } else {
      // Not checked: the table is empty and says why — never a point from memory.
      expect(ZCTA_SOURCE.checked).toBeNull();
      expect(ZCTA_SOURCE.notChecked).toMatch(/\S/);
    }
  });

  it('ACCEPTED_ZIPS is exactly what serviceCityForZip accepts in 23xxx', () => {
    const all = Array.from({ length: 1000 }, (_, i) => String(23000 + i)).filter((z) => serviceCityForZip(z) !== null);
    expect([...ACCEPTED_ZIPS]).toEqual(all);
    expect(ACCEPTED_ZIPS.length).toBe(69);
  });

  it('every point sits inside the four-city box, at 5 decimals or fewer', () => {
    for (const [zip, p] of Object.entries(ZIP_CENTROIDS)) {
      expect(serviceCityForZip(zip), zip).not.toBeNull();
      expect(p.lat).toBeGreaterThanOrEqual(FOUR_CITY_BOX.south);
      expect(p.lat).toBeLessThanOrEqual(FOUR_CITY_BOX.north);
      expect(p.lon).toBeGreaterThanOrEqual(FOUR_CITY_BOX.west);
      expect(p.lon).toBeLessThanOrEqual(FOUR_CITY_BOX.east);
      expect(Math.round(p.lat * 1e5) / 1e5).toBe(p.lat);
      expect(Math.round(p.lon * 1e5) / 1e5).toBe(p.lon);
    }
  });

  it('every accepted ZIP is in the table, on the no-area list, or named as not checked — never a guess', () => {
    for (const z of ACCEPTED_ZIPS) {
      const p = zipPoint(z);
      if (z in ZIP_CENTROIDS) expect(p).toEqual({ ok: true, lat: ZIP_CENTROIDS[z]!.lat, lon: ZIP_CENTROIDS[z]!.lon });
      else if (ZIP_NO_AREA.includes(z)) expect(p).toEqual({ ok: false, why: 'no_area' });
      else expect(p).toEqual({ ok: false, why: 'not_loaded' });
    }
    // The table and the no-area list never overlap, and hold only accepted ZIPs.
    for (const z of ZIP_NO_AREA) {
      expect(z in ZIP_CENTROIDS, z).toBe(false);
      expect(serviceCityForZip(z), z).not.toBeNull();
    }
  });

  it('the plan\'s check list (PO box and business ZIPs among them) is never placed without a checked source', () => {
    for (const z of ['23450', '23466', '23467', '23471', '23479', '23501', '23506', '23541', '23551', '23326', '23327', '23328', '23705']) {
      const p = zipPoint(z);
      if (p.ok) expect(ZCTA_SOURCE.checked, z).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      else expect(['no_area', 'not_loaded']).toContain(p.why);
    }
  });

  // Maps wave B (D108): the table is filled from the Census 2020 ZCTA internal points, read 2026-10-22.
  it('is filled and dated: 39 ZIP areas placed, the other 30 accepted ZIPs named "no map area" — every accepted ZIP in exactly one', () => {
    expect(ZCTA_SOURCE.checked).toBe('2026-10-22');
    expect(ZCTA_SOURCE.notChecked).toBeNull();
    expect(Object.keys(ZIP_CENTROIDS)).toHaveLength(39);
    expect(ZIP_NO_AREA).toHaveLength(30);
    for (const z of ACCEPTED_ZIPS) expect(Number(z in ZIP_CENTROIDS) + Number(ZIP_NO_AREA.includes(z)), z).toBe(1);
    for (const z of ACCEPTED_ZIPS) expect(zipPoint(z).ok || (zipPoint(z) as { why: string }).why === 'no_area', z).toBe(true);
  });

  it('the plan\'s hand-check list comes out as the Census says: PO box and business ZIPs have no area; 23551 is placed', () => {
    for (const z of ['23450', '23466', '23467', '23471', '23479', '23501', '23506', '23541', '23326', '23327', '23328', '23705']) {
      expect(zipPoint(z), z).toEqual({ ok: false, why: 'no_area' });
    }
    expect(zipPoint('23551')).toEqual({ ok: true, lat: 36.92354, lon: -76.29255 });
  });

  it('points are the Census 2020 internal points to 5 decimals (spot checks across the four cities)', () => {
    expect(ZIP_CENTROIDS['23508']).toEqual({ lat: 36.88528, lon: -76.31034 }); // Norfolk
    expect(ZIP_CENTROIDS['23451']).toEqual({ lat: 36.87236, lon: -76.00432 }); // Virginia Beach
    expect(ZIP_CENTROIDS['23461']).toEqual({ lat: 36.7706, lon: -75.96377 }); // Virginia Beach, the east-most
    expect(ZIP_CENTROIDS['23320']).toEqual({ lat: 36.75173, lon: -76.21764 }); // Chesapeake
    expect(ZIP_CENTROIDS['23321']).toEqual({ lat: 36.8004, lon: -76.42115 }); // Chesapeake, the west-most
    expect(ZIP_CENTROIDS['23707']).toEqual({ lat: 36.84179, lon: -76.34033 }); // Portsmouth
  });

  it('a ZIP outside the four cities is "outside", never placed; junk is outside too', () => {
    expect(zipPoint('23434')).toEqual({ ok: false, why: 'outside' }); // Suffolk (R1): accepted as work, never placed by ZIP
    expect(zipPoint('90210')).toEqual({ ok: false, why: 'outside' });
    expect(zipPoint('')).toEqual({ ok: false, why: 'outside' });
    expect(zipPoint(null)).toEqual({ ok: false, why: 'outside' });
  });

  it('each reason has its words, and none of them says "clear"', () => {
    expect(ZIP_WHY.no_area).toBe('ZIP has no map area (PO box or business ZIP)');
    expect(ZIP_WHY.outside).toBe('ZIP outside the four cities');
    expect(ZIP_WHY.not_loaded).toMatch(/not loaded/);
    for (const w of Object.values(ZIP_WHY)) expect(w).not.toMatch(/\bclear(ed)?\b/i);
  });

  it('the four-city box is a view box, wider than it is tall, on the Virginia coast', () => {
    expect(FOUR_CITY_BOX.south).toBeLessThan(FOUR_CITY_BOX.north);
    expect(FOUR_CITY_BOX.west).toBeLessThan(FOUR_CITY_BOX.east);
    expect(FOUR_CITY_BOX.south).toBeGreaterThan(36.4);
    expect(FOUR_CITY_BOX.north).toBeLessThan(37.1);
    expect(FOUR_CITY_BOX.west).toBeGreaterThan(-76.7);
    expect(FOUR_CITY_BOX.east).toBeLessThan(-75.7);
  });
});
