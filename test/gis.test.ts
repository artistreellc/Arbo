/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  Owner instruction from Mike, 2026-08-03. This is not decoration and it
  is not optional. It is here because this is the point in a build where
  things get broken by moving fast, and that already happened to him once
  on the website. It does not happen here.
  ═══════════════════════════════════════════════════════════════════════

  SLOW DOWN. DRASTICALLY. Then:

  1. READ EVERY LINE BEFORE YOU EDIT ONE. Every line, every letter,
     slowly. You are not skimming to find the spot to change — you are
     building a model of what this file already does. If you cannot say
     what the code above and below your edit does, you have not read it.

  2. AN AUDIT IS READ-ONLY. If you were asked to audit, you do not edit.
     You do not "fix it while you are in there." You do not refactor, or
     tidy, or rename. You READ, and you REPORT. Editing during an audit
     is disobeying the instruction, full stop.

  3. THINK BEFORE YOU TYPE. What does this already handle? What depends
     on it? What breaks downstream? Recognise the PATTERN before you call
     something a bug — most things in here that look wrong are a
     deliberate correction. Check docs/OWNER_RULINGS.md first. Use what
     you already know about this codebase instead of re-deciding it.

  4. BRING IT TO MIKE — DO NOT DECIDE IT. Anything that looks wrong,
     ambiguous, or outside what was asked: say it and WAIT. Flagging
     costs one sentence. Deciding on his behalf has cost real work and
     real money more than once.

  5. DO EXACTLY WHAT WAS ASKED. Not the adjacent thing. Not the bigger
     thing you thought of on the way. Not the cleanup. Exactly what was
     asked, and nothing else.

  If you are moving fast right now, you are already off the rails.

  Remember the marker: SLOW::ARBO
*/
import { describe, it, expect } from 'vitest';
import { pointIntersectsLayer, type FetchFn } from '../src/permitting/gis/arcgis.js';
import { createCensusGeocoder, createGoogleGeocoder, type Geocoder } from '../src/permitting/gis/geocode.js';
import { CITY_GIS_LAYERS, usableLayers } from '../src/permitting/gis/layers.js';
import { createLiveGisProvider } from '../src/permitting/gis/liveGisProvider.js';
import { runIntakeScreen } from '../src/permitting/intakeScreen.js';
import { screenProperty } from '../src/permitting/screening.js';
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

  it('every city has a verified-LIVE RPA layer (DEQ statewide, verified 2026-08-01)', () => {
    for (const city of SERVICE_CITIES) {
      const live = usableLayers(city, false);
      expect(live.length).toBeGreaterThanOrEqual(1);
      expect(live.some((l) => l.kind === 'CBPA_RPA')).toBe(true);
    }
  });

  it('tripwire: every LIVE layer must carry verification evidence in its source', () => {
    // Flipping a layer to 'live' without recording the verification is exactly
    // the unvalidated-endpoint risk D33 exists to prevent.
    for (const city of SERVICE_CITIES) {
      for (const l of usableLayers(city, false)) {
        expect(l.source).toMatch(/verified/i);
        expect(l.url).toMatch(/\/(MapServer|FeatureServer)\/\d+$/);
      }
    }
  });

  it('candidates are only usable when explicitly allowed', () => {
    expect(usableLayers('Chesapeake', true).length).toBeGreaterThan(usableLayers('Chesapeake', false).length);
  });
});

// --- live provider ---------------------------------------------------------

describe('live GisProvider — honest end to end', () => {
  const input = { city: 'Chesapeake' as const, address: '9 Creek Rd', isRemoval: true };

  it('throws when a city has no usable layers → intake PENDING (honesty floor)', async () => {
    const provider = createLiveGisProvider({ geocoder: pointGeocoder(), fetchFn: routedFetch([]), layersFor: () => [] });
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

describe('the proximity tier (D37 — the Circle Drive lesson)', () => {
  // Street-centerline geocodes sit 150–300 m from a rear-lot RPA buffer
  // (verified on the real violation case). Direct miss + probe hit must
  // surface as the softer PROXIMITY overlay → REVIEW_NEEDED, never silence.
  const probeAwareFetch: FetchFn = async (url) => {
    if (url.includes('distance=300')) return jsonResponse({ count: 1 }); // probe hits
    return jsonResponse({ count: 0 }); // direct misses
  };

  it('direct miss + 300 m probe hit → CBPA_RPA_PROXIMITY overlay', async () => {
    const provider = createLiveGisProvider({ geocoder: pointGeocoder(), fetchFn: probeAwareFetch });
    const overlays = await provider.overlaysFor({ city: 'Norfolk', address: '8562 Circle Drive', isRemoval: true });
    expect(overlays).toHaveLength(1);
    expect(overlays[0]!.kind).toBe('CBPA_RPA_PROXIMITY');
    expect(overlays[0]!.meaning).toMatch(/300 m/);
  });

  it('a proximity-only hit screens REVIEW_NEEDED — flagged, not PERMIT_LIKELY, never clear', async () => {
    const provider = createLiveGisProvider({ geocoder: pointGeocoder(), fetchFn: probeAwareFetch });
    const overlays = await provider.overlaysFor({ city: 'Norfolk', address: '8562 Circle Drive', isRemoval: true });
    const screen = await screenProperty(
      { city: 'Norfolk', address: '8562 Circle Drive', isRemoval: true },
      { overlaysFor: async () => overlays },
    );
    expect(screen.status).toBe('REVIEW_NEEDED');
    expect(screen.headline).toMatch(/verify/i);
  });

  it('a DIRECT hit skips the probe and stays PERMIT_LIKELY on removals', async () => {
    const provider = createLiveGisProvider({ geocoder: pointGeocoder(), fetchFn: routedFetch([['query', { count: 1 }]]) });
    const overlays = await provider.overlaysFor({ city: 'Norfolk', address: '1 Shore Dr', isRemoval: true });
    expect(overlays.some((o) => o.kind === 'CBPA_RPA')).toBe(true);
    const screen = await screenProperty(
      { city: 'Norfolk', address: '1 Shore Dr', isRemoval: true },
      { overlaysFor: async () => overlays },
    );
    expect(screen.status).toBe('PERMIT_LIKELY');
  });

  it('the probe request carries the distance + meter units', async () => {
    const urls: string[] = [];
    const spy: FetchFn = async (url) => {
      urls.push(url);
      return jsonResponse({ count: 0 });
    };
    const provider = createLiveGisProvider({ geocoder: pointGeocoder(), fetchFn: spy });
    await provider.overlaysFor({ city: 'Portsmouth', address: '2 River Rd', isRemoval: true });
    const probe = urls.find((u) => u.includes('distance='));
    expect(probe).toBeDefined();
    expect(probe).toContain('distance=300');
    expect(probe).toContain('units=esriSRUnit_Meter');
  });
});

describe('Census geocoder — keyless fallback (verified live 2026-08-01)', () => {
  const MATCH = { result: { addressMatches: [{ coordinates: { x: -76.260956646037, y: 36.931651997559 } }] } };

  it('resolves a confident match to lat/lng', async () => {
    const g = createCensusGeocoder(routedFetch([['geocoding.geo.census.gov', MATCH]]));
    expect(await g.geocode('8562 Circle Drive', 'Norfolk')).toEqual({ lat: 36.931651997559, lng: -76.260956646037 });
  });

  it('no match / HTTP error → throw (screen goes pending, never wrong-point)', async () => {
    await expect(
      createCensusGeocoder(routedFetch([['census', { result: { addressMatches: [] } }]])).geocode('x', 'Norfolk'),
    ).rejects.toThrow(/no confident match/);
    await expect(
      createCensusGeocoder(routedFetch([['census', {}, false, 500]])).geocode('x', 'Norfolk'),
    ).rejects.toThrow(/HTTP 500/);
  });
});
