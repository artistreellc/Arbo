// The live GisProvider (§6B.1 step 1): geocode the address, test the point
// against the city's registered GIS layers, return the overlay hits. This is
// what turns intake screens from PENDING into real results.
//
// HONESTY RULES (D32, enforced structurally):
//   - No usable layers for the city → THROW (→ intake PENDING). Running a
//     "screen" that checks nothing would fabricate NO_OVERLAY_VERIFY.
//   - Geocode failure → THROW. Testing layers at a wrong point is worse than
//     no answer.
//   - ANY layer query failure → THROW the whole screen. A completed screen
//     asserts every registered layer was actually checked; partial results
//     recorded as a full screen would be a quiet false-negative.
//   - Candidates are excluded by default; `allowCandidates` exists for the
//     deploy-time verification runs documented in layers.ts.

import type { ServiceCity } from '../../lib/address.js';
import type { GisProvider, OverlayHit, ScreenInput } from '../screening.js';
import type { FetchFn } from './arcgis.js';
import { pointIntersectsLayer } from './arcgis.js';
import type { Geocoder } from './geocode.js';
import { createCensusGeocoder, createGoogleGeocoder } from './geocode.js';
import { usableLayers, RPA_PROXIMITY_PROBE_METERS } from './layers.js';
import { env } from '../../env.js';

export interface LiveGisOptions {
  geocoder: Geocoder;
  fetchFn: FetchFn;
  /** Query 'candidate' layers too — deploy-time verification only. */
  allowCandidates?: boolean;
  /** Layer lookup override (tests). Defaults to the registry's usableLayers. */
  layersFor?: typeof usableLayers;
}

export function createLiveGisProvider(options: LiveGisOptions): GisProvider {
  const allowCandidates = options.allowCandidates ?? false;
  const layersFor = options.layersFor ?? usableLayers;
  return {
    async overlaysFor(input: ScreenInput): Promise<OverlayHit[]> {
      const layers = layersFor(input.city as ServiceCity, allowCandidates);
      if (layers.length === 0) {
        throw new Error(`No verified GIS layers registered for ${input.city} — screen cannot run (see layers.ts verification procedure)`);
      }

      const point = await options.geocoder.geocode(input.address, input.city);

      const hits: OverlayHit[] = [];
      for (const layer of layers) {
        // Sequential on purpose: these are small public servers (§4.1 throttle
        // spirit), and any failure aborts the whole screen anyway.
        const direct = await pointIntersectsLayer(options.fetchFn, layer.url, point);
        if (direct) {
          hits.push({ kind: layer.kind, layer: layer.name, meaning: layer.meaning });
          continue;
        }
        // Proximity tier for RPA layers (D37): the geocoded street point can
        // sit 150–300 m from a rear-lot buffer (proven on the Circle Drive
        // case). A probe-only hit is the softer PROXIMITY overlay → the
        // screen reads REVIEW_NEEDED, not PERMIT_LIKELY.
        if (layer.kind === 'CBPA_RPA') {
          const nearby = await pointIntersectsLayer(options.fetchFn, layer.url, point, RPA_PROXIMITY_PROBE_METERS);
          if (nearby) {
            hits.push({
              kind: 'CBPA_RPA_PROXIMITY',
              layer: layer.name,
              meaning: `An RPA buffer sits within ~${RPA_PROXIMITY_PROBE_METERS} m of this address — the parcel may reach it. Check the parcel against the city map before quoting a removal.`,
            });
          }
        }
      }
      return hits;
    },
  };
}

/** Node 20+ fetch adapted to the client's minimal shape. */
export const nodeFetch: FetchFn = async (url) => {
  const res = await fetch(url);
  return { ok: res.ok, status: res.status, json: () => res.json() };
};

/**
 * Deploy wiring: the provider the live LeadSink uses. Google geocoding when a
 * Maps key is configured (brief §8), otherwise the free keyless Census
 * geocoder — so the §6B screen runs live with zero paid credentials. Cities
 * whose layers aren't verified-live still screen honestly PENDING via the
 * provider's no-usable-layers throw.
 */
export function createDefaultGisProvider(): GisProvider {
  const key = env.google.mapsApiKey;
  const geocoder = key ? createGoogleGeocoder(key, nodeFetch) : createCensusGeocoder(nodeFetch);
  return createLiveGisProvider({ geocoder, fetchFn: nodeFetch });
}
