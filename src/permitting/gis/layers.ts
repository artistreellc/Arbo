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

// Statewide DEQ CBPA layer — one authoritative baseline candidate that covers
// all four cities (DEQ administers the Bay Act). City layers refine it.
const DEQ_CBPA: Omit<GisLayer, 'meaning'> = {
  kind: 'CBPA_RPA',
  name: 'DEQ — Chesapeake Bay Preservation Act Areas (statewide)',
  url: 'https://gisdata.deq.virginia.gov/arcgis/rest/services/public/EDMA/MapServer/32',
  status: 'candidate',
  source: 'Virginia DEQ EDMA public MapServer (found via search 2026-08-01; egress-blocked from build env — verify at deploy)',
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
