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
