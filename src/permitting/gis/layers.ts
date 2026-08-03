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
// GIS layer registry for the §6B screen — per-city, dated, and honest about
// verification state (D30/D32 pattern: config, not literals; never claim a
// check that wasn't validated).
//
// STATUS MEANS:
//   'live'      — endpoint verified against the real service AND sanity-checked
//                 with a known address (see VERIFICATION PROCEDURE below).
//                 The provider queries these in production.
//   'candidate' — discovered from a credible source but NOT yet verified from
//                 a network that can reach it (this build env's egress blocks
//                 *.virginia.gov / city GIS hosts). The provider IGNORES these
//                 unless explicitly told to (deploy-time verification runs).
//
// VERIFICATION PROCEDURE (per endpoint, ~5 min at deploy where egress is open):
//   1. GET  <url>?f=json  — confirm it's the expected layer (name, polygon
//      geometry, supportsQuery).
//   2. Query a KNOWN-RPA point (e.g. 8562 Circle Drive, Norfolk — the real
//      CBPA violation case) → expect count > 0 on that city's RPA layer.
//   3. Query a clearly inland point → expect count = 0.
//   4. Flip status to 'live', set lastVerified, commit. (Review loop §13
//      re-checks these dates like the city rulesets.)

import type { ServiceCity } from '../../lib/address.js';
import type { OverlayKind } from '../screening.js';

export interface GisLayer {
  kind: OverlayKind;
  name: string;
  /** ArcGIS REST layer URL (…/MapServer/<n> or …/FeatureServer/<n>). */
  url: string;
  status: 'live' | 'candidate';
  /** Where this endpoint was found / how it was verified. */
  source: string;
  /** Plain-English "what it means for the job" (§6B.4c), shown on a hit. */
  meaning: string;
  lastVerified: string; // ISO date of last verification (or discovery, for candidates)
}

/**
 * Proximity probe radius for CBPA/RPA layers (D37). Geocoders return
 * street-centerline points; the RPA buffer hugs the water at the REAR of a
 * waterfront lot. Verified on the real 8562 Circle Drive violation case
 * (2026-08-01): direct intersects = 0 hits at the street point, and 0 at 75 m
 * and 150 m — but 1 hit at 300 m. A bare point test would have MISSED the
 * exact violation this engine exists to prevent. A direct hit screens
 * PERMIT_LIKELY; a probe-only hit screens the softer CBPA_RPA_PROXIMITY
 * (→ REVIEW_NEEDED). Inland control (-76.208, 36.846): 0 hits at 300 m.
 */
export const RPA_PROXIMITY_PROBE_METERS = 300;

// Statewide DEQ RPA layer — the authoritative baseline covering all four
// cities (DEQ administers the Bay Act; localities submit their data).
// VERIFIED LIVE 2026-08-01 via connector fetch (build-env egress is blocked;
// requests ran on Zapier webhook infrastructure):
//   1. Metadata: layer 33 = "Resource Protection Area (RPA)", polygon Feature
//      Layer, capabilities Map,Query,Data, esriSpatialRelIntersects supported.
//      (NOTE: layer 32 is the parent GROUP layer — not queryable; the original
//      candidate URL pointed there and was corrected during verification.)
//   2. Coverage: distinct LOCALITY values include "Virginia Beach city",
//      "Norfolk city", "Chesapeake city", "Portsmouth city".
//   3. Known-RPA case: 8562 Circle Dr, Norfolk (Census-geocoded to
//      -76.26096, 36.93165) — 1 hit at the 300 m probe (see
//      RPA_PROXIMITY_PROBE_METERS for the tiering evidence).
//   4. Inland control: 0 hits at 300 m.
const DEQ_CBPA: Omit<GisLayer, 'meaning'> = {
  kind: 'CBPA_RPA',
  name: 'DEQ — Resource Protection Area (RPA), statewide (EDMA layer 33)',
  url: 'https://gisdata.deq.virginia.gov/arcgis/rest/services/public/EDMA/MapServer/33',
  status: 'live',
  source: 'Virginia DEQ EDMA public MapServer, layer 33. Verified 2026-08-01: metadata + 4-city coverage + known-RPA (Circle Dr, 300 m probe) + inland control — evidence in this file and DECISIONS D37.',
  lastVerified: '2026-08-01',
};

const cbpaMeaning = (city: string): string =>
  `This address sits in a Chesapeake Bay preservation layer — tree removal here likely needs the City of ${city} sign-off BEFORE the quote or the cut.`;

export const CITY_GIS_LAYERS: Record<ServiceCity, GisLayer[]> = {
  'Virginia Beach': [
    { ...DEQ_CBPA, meaning: cbpaMeaning('Virginia Beach') },
    {
      kind: 'CBPA_RPA',
      name: 'Virginia Beach — Chesapeake Bay RPA',
      // Hub dataset: gis.data.vbgov.com/datasets/bdc17701617e480eb4b62867969516d0_1
      // The underlying REST URL must be read off that page at deploy (egress-blocked here).
      url: 'https://gis.data.vbgov.com/datasets/bdc17701617e480eb4b62867969516d0_1',
      status: 'candidate',
      source: 'VB Open Data hub "Chesapeake Bay RPA" (REST URL to be extracted from the hub page at deploy)',
      meaning: cbpaMeaning('Virginia Beach'),
      lastVerified: '2026-08-01',
    },
  ],
  Norfolk: [
    { ...DEQ_CBPA, meaning: cbpaMeaning('Norfolk') },
    {
      kind: 'CBPA_RPA',
      name: 'Norfolk — CBPA (Open GIS Data)',
      // Hub dataset: norfolkgisdata-orf.opendata.arcgis.com/datasets/712ae93509fb4bb6947bab945d30bd77_0
      url: 'https://norfolkgisdata-orf.opendata.arcgis.com/datasets/712ae93509fb4bb6947bab945d30bd77_0',
      status: 'candidate',
      source: 'Norfolk Open GIS Data hub "CBPA" (REST URL to be extracted from the hub page at deploy; cross-check air.norfolk.gov per §6B.4b)',
      meaning: cbpaMeaning('Norfolk'),
      lastVerified: '2026-08-01',
    },
  ],
  Chesapeake: [
    { ...DEQ_CBPA, meaning: cbpaMeaning('Chesapeake') },
    {
      kind: 'CBPA_RPA',
      name: 'Chesapeake — Chesapeake Bay Preservation Area (OpenData)',
      url: 'https://gis.cityofchesapeake.net/mapping/rest/services/OpenData/OpenData/MapServer/6',
      status: 'candidate',
      source: 'City of Chesapeake public MapServer, OpenData layer 6 (found via search 2026-08-01)',
      meaning: cbpaMeaning('Chesapeake'),
      lastVerified: '2026-08-01',
    },
    {
      kind: 'CBPA_RPA',
      name: 'Chesapeake — RPA Buffer (Accela special districts)',
      url: 'https://gis.cityofchesapeake.net/mapping/rest/services/Accela/Accela_special_districts_arcmap/MapServer/25',
      status: 'candidate',
      source: 'City of Chesapeake Accela special-districts MapServer layer 25 "RPA Buffer" (found via search 2026-08-01)',
      meaning: cbpaMeaning('Chesapeake'),
      lastVerified: '2026-08-01',
    },
  ],
  Portsmouth: [
    { ...DEQ_CBPA, meaning: cbpaMeaning('Portsmouth') },
    // Portsmouth city-specific RPA layer: none found yet — the statewide DEQ
    // layer is the baseline; ask the Chesapeake Bay Program office (§6B.4b)
    // for their authoritative layer at deploy.
  ],
};

/** Layers the provider may query for a city. Candidates only when opted in. */
export function usableLayers(city: ServiceCity, allowCandidates: boolean): GisLayer[] {
  return CITY_GIS_LAYERS[city].filter((l) => l.status === 'live' || allowCandidates);
}
