import { describe, it, expect } from 'vitest';
import { pointIntersectsLayer, type FetchFn } from '../src/permitting/gis/arcgis.js';
import { createGoogleGeocoder, type Geocoder } from '../src/permitting/gis/geocode.js';
import { CITY_GIS_LAYERS, usableLayers } from '../src/permitting/gis/layers.js';
import { createLiveGisProvider } from '../src/permitting/gis/liveGisProvider.js';
import { runIntakeScreen } from '../src/permitting/intakeScreen.js';
import { SERVICE_CITIES } from '../src/lib/address.js';

// --- fakes -------------------------------------------------------------

const jsonResponse = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

/** FetchFn that routes by URL substring; unmatched URLs throw. */
const routedFetch = (routes: Array<[match: string, body: unknown, ok?: boolean, status?: number]>): FetchFn => {
  return async (url) => {
    for (const [match, body, ok, status] of routes) {
      if (url.includes(match)) return jsonResponse(body, ok ?? true, status ?? 200);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
};

const pointGeocoder = (lat = 36.9, lng = -76.2): Geocoder => ({ geocode: async () => ({ lat, lng }) });

// --- arcgis client ------------------------------------------------------

describe('ArcGIS point-in-layer client — strict or throw (D32)', () => {
  const LAYER = 'https://example.test/arcgis/rest/services/X/MapServer/6';

  it('count > 0 → true; count = 0 → false', async () => {
    expect(await pointIntersectsLayer(routedFetch([['MapServer/6/query', { count: 3 }]]), LAYER, { lat: 36.9, lng: -76.2 })).toBe(true);
    expect(await pointIntersectsLayer(routedFetch([['MapServer/6/query', { count: 0 }]]), LAYER, { lat: 36.9, lng: -76.2 })).toBe(false);
  });

  it('sends a WGS84 point intersects query with returnCountOnly', async () => {
    let captured = '';
    const spy: FetchFn = async (url) => {
      captured = url;
      return jsonResponse({ count: 0 });
    };
    await pointIntersectsLayer(spy, LAYER, { lat: 36.9, lng: -76.2 });
    expect(captured).toContain('/query?');
    expect(captured).toContain('returnCountOnly=true');
    expect(captured).toContain('esriGeometryPoint');
    expect(decodeURIComponent(captured)).toContain('"wkid":4326');
  });

  it('HTTP error, esri error body, and malformed body all THROW (never a silent false)', async () => {
    const p = { lat: 36.9, lng: -76.2 };
    await expect(pointIntersectsLayer(routedFetch([['query', {}, false, 500]]), LAYER, p)).rejects.toThrow(/HTTP 500/);
    await expect(
      pointIntersectsLayer(routedFetch([['query', { error: { message: 'Invalid token' } }]]), LAYER, p),
    ).rejects.toThrow(/Invalid token/);
    await expect(pointIntersectsLayer(routedFetch([['query', { rows: [] }]]), LAYER, p)).rejects.toThrow(/malformed/);
  });
});

// --- geocoder ------------------------------------------------------------

describe('Google geocoder — confident hit or throw', () => {
  const OK = { status: 'OK', results: [{ geometry: { location: { lat: 36.8508, lng: -76.2859 } } }] };

  it('resolves coordinates on OK', async () => {
    const g = createGoogleGeocoder('k', routedFetch([['maps.googleapis.com', OK]]));
    expect(await g.geocode('8562 Circle Drive', 'Norfolk')).toEqual({ lat: 36.8508, lng: -76.2859 });
  });

  it('constrains the query to Virginia', async () => {
    let captured = '';
    const spy: FetchFn = async (url) => {
      captured = url;
      return jsonResponse(OK);
    };
    await createGoogleGeocoder('k', spy).geocode('1 Main St', 'Chesapeake');
    expect(decodeURIComponent(captured)).toContain('administrative_area:VA');
  });

  it('ZERO_RESULTS, HTTP errors, and missing coordinates all throw', async () => {
    await expect(
      createGoogleGeocoder('k', routedFetch([['maps.googleapis.com', { status: 'ZERO_RESULTS', results: [] }]])).geocode('x', 'Norfolk'),
    ).rejects.toThrow(/ZERO_RESULTS/);
    await expect(
      createGoogleGeocoder('k', routedFetch([['maps.googleapis.com', {}, false, 403]])).geocode('x', 'Norfolk'),
    ).rejects.toThrow(/HTTP 403/);
    await expect(
      createGoogleGeocoder('k', routedFetch([['maps.googleapis.com', { status: 'OK', results: [{}] }]])).geocode('x', 'Norfolk'),
    ).rejects.toThrow(/no coordinates/);
  });
});

// --- layer registry -------------------------------------------------------

describe('GIS layer registry', () => {
  it('every service city has at least a CBPA/RPA candidate, all dated', () => {
    for (const city of SERVICE_CITIES) {
      const layers = CITY_GIS_LAYERS[city];
      expect(layers.some((l) => l.kind === 'CBPA_RPA')).toBe(true);
      for (const l of layers) {
        expect(l.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(l.source.length).toBeGreaterThan(0);
        expect(['live', 'candidate']).toContain(l.status);
      }
    }
  });

  it('no layer is marked live yet — endpoints are egress-blocked from this env', () => {
    // This test EXISTS to fail when someone flips a layer to 'live': doing so
    // must come with real verification per the procedure in layers.ts — update
    // this test in the same commit as the verification evidence.
    for (const city of SERVICE_CITIES) {
      expect(usableLayers(city, false)).toHaveLength(0);
    }
  });

  it('candidates are only usable when explicitly allowed', () => {
    expect(usableLayers('Chesapeake', true).length).toBeGreaterThan(usableLayers('Chesapeake', false).length);
  });
});

// --- live provider ---------------------------------------------------------

describe('live GisProvider — honest end to end', () => {
  const input = { city: 'Chesapeake' as const, address: '9 Creek Rd', isRemoval: true };

  it('throws when the city has no usable layers (default: candidates excluded) → intake PENDING', async () => {
    const provider = createLiveGisProvider({ geocoder: pointGeocoder(), fetchFn: routedFetch([]) });
    await expect(provider.overlaysFor(input)).rejects.toThrow(/No verified GIS layers/);

    const outcome = await runIntakeScreen(
      { propertyId: 'p1', city: 'Chesapeake', address: '9 Creek Rd', qualification: { jobType: 'removal' } },
      provider,
      async () => ({ id: 'x' }),
    );
    expect(outcome.kind).toBe('pending');
  });

  it('with candidates allowed: an RPA hit maps to a CBPA_RPA overlay with plain-English meaning', async () => {
    const provider = createLiveGisProvider({
      geocoder: pointGeocoder(),
      fetchFn: routedFetch([
        ['gisdata.deq.virginia.gov', { count: 1 }],
        ['gis.cityofchesapeake.net', { count: 1 }],
      ]),
      allowCandidates: true,
    });
    const overlays = await provider.overlaysFor(input);
    expect(overlays.length).toBeGreaterThan(0);
    for (const o of overlays) {
      expect(o.kind).toBe('CBPA_RPA');
      expect(o.meaning).toMatch(/before the quote or the cut/i);
    }
  });

  it('all layers miss → [] (a REAL no-overlay result — every layer was checked)', async () => {
    const provider = createLiveGisProvider({
      geocoder: pointGeocoder(),
      fetchFn: routedFetch([
        ['gisdata.deq.virginia.gov', { count: 0 }],
        ['gis.cityofchesapeake.net', { count: 0 }],
      ]),
      allowCandidates: true,
    });
    expect(await provider.overlaysFor(input)).toEqual([]);
  });

  it('ONE layer failing aborts the whole screen (no partial screens recorded)', async () => {
    const provider = createLiveGisProvider({
      geocoder: pointGeocoder(),
      fetchFn: routedFetch([
        ['gisdata.deq.virginia.gov', { count: 0 }],
        ['gis.cityofchesapeake.net', {}, false, 503], // city server down
      ]),
      allowCandidates: true,
    });
    await expect(provider.overlaysFor(input)).rejects.toThrow(/HTTP 503/);
  });

  it('geocode failure aborts the screen — never tests layers at a wrong point', async () => {
    const provider = createLiveGisProvider({
      geocoder: { geocode: async () => { throw new Error('ZERO_RESULTS'); } },
      fetchFn: routedFetch([['', { count: 1 }]]),
      allowCandidates: true,
    });
    await expect(provider.overlaysFor(input)).rejects.toThrow(/ZERO_RESULTS/);
  });
});
