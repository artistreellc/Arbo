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
    expect(ZCTA_SOURCE.url).toBe('https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip');
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
