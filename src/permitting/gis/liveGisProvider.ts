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
import { createGoogleGeocoder } from './geocode.js';
import { usableLayers } from './layers.js';
import { env } from '../../env.js';

export interface LiveGisOptions {
  geocoder: Geocoder;
  fetchFn: FetchFn;
  /** Query 'candidate' layers too — deploy-time verification only. */
  allowCandidates?: boolean;
}

export function createLiveGisProvider(options: LiveGisOptions): GisProvider {
  const allowCandidates = options.allowCandidates ?? false;
  return {
    async overlaysFor(input: ScreenInput): Promise<OverlayHit[]> {
      const layers = usableLayers(input.city as ServiceCity, allowCandidates);
      if (layers.length === 0) {
        throw new Error(`No verified GIS layers registered for ${input.city} — screen cannot run (see layers.ts verification procedure)`);
      }

      const point = await options.geocoder.geocode(input.address, input.city);

      const hits: OverlayHit[] = [];
      for (const layer of layers) {
        // Sequential on purpose: these are small public servers (§4.1 throttle
        // spirit), and any failure aborts the whole screen anyway.
        const intersects = await pointIntersectsLayer(options.fetchFn, layer.url, point);
        if (intersects) hits.push({ kind: layer.kind, layer: layer.name, meaning: layer.meaning });
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
 * Deploy wiring: the provider the live LeadSink should use, or null when the
 * pieces aren't in place (no Maps key) — null keeps intake screens honestly
 * PENDING rather than half-screened.
 */
export function createDefaultGisProvider(): GisProvider | null {
  const key = env.google.mapsApiKey;
  if (!key) return null;
  return createLiveGisProvider({ geocoder: createGoogleGeocoder(key, nodeFetch), fetchFn: nodeFetch });
}
