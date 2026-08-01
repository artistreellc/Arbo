// Per-city permitting ruleset (brief §6B.4 / §6B.4b). Forms, portals, contacts,
// mitigation ratios, and screening thresholds live here — configurable and
// DATED ("last verified"), never buried as literals in the screening logic
// (§6B.3: "Per-city rules are configurable and dated"). The review loop (§13)
// re-checks these dates.
//
// These are CITY GOVERNMENT public contacts (planning/environmental offices),
// not customer PII — safe to keep in config. Virginia Beach is the reference
// implementation (§6B.4); the other three follow the same shape.

import { SERVICE_CITIES, type ServiceCity } from '../lib/address.js';

export interface CityContact {
  name: string;
  role: string;
  email: string;
  phone?: string;
  note?: string;
}

export interface PermitForm {
  name: string;
  /** Where the current PDF/portal lives. Re-verify against `lastVerified`. */
  url?: string;
  note?: string;
}

export interface MitigationRule {
  /** Replacement trees planted per tree removed (e.g. 3 = "3-to-1"). */
  ratioPerRemoval: number;
  /** Minimum replacements regardless of count removed. */
  minReplacements: number;
  /** Minimum caliper at planting, inches DBH. */
  minCaliperInches: number;
  note: string;
}

export interface CityRuleset {
  city: ServiceCity;
  /** Permitting system / portal the city runs (Accela, eBUILD, …). */
  portalSystem: string;
  portalUrl?: string;
  /** How to check the parcel against the CBPA/RPA layer for this city. */
  mapViewer?: string;
  forms: PermitForm[];
  /** CBPA/RPA mitigation, surfaced the moment a removal screens PERMIT_LIKELY. */
  mitigation?: MitigationRule;
  contacts: CityContact[];
  /**
   * Scale thresholds that escalate the review path (e.g. Chesapeake's site-visit
   * and Board-hearing tiers). Empty when the city has no published tiering.
   */
  scaleTiers?: Array<{ minTrees: number; escalation: string }>;
  /** ISO date this ruleset was last verified against the city's live rules. */
  lastVerified: string;
}

// Virginia Beach — the known, real flow (§6B.4). Build this city first.
const VIRGINIA_BEACH: CityRuleset = {
  city: 'Virginia Beach',
  portalSystem: 'Accela',
  mapViewer: 'VB Online Map Portal (flood + CBPA/RPA overlay layers)',
  forms: [
    { name: 'PPR Standard Submittal Form', note: 'Filed as a Preliminary Project Request (PPR); record # format YYYY-DSC-######.' },
    { name: 'PPR Tree Removal Form', note: 'a.k.a. "Removal of Vegetation in a Resource Protection Area Application Form".' },
  ],
  mitigation: {
    ratioPerRemoval: 3,
    minReplacements: 3,
    minCaliperInches: 3.5,
    note: 'Removals in the protected area typically require 3 replacements per tree removed (min 3), each ≥3.5" DBH at planting.',
  },
  contacts: [
    { name: 'Shannon Heederik', role: 'Planning & Community Dev / Environmental Engineering', email: 'SHeederi@vbgov.com', phone: '757-385-8025', note: 'Issues the current PPR review letters (confirmed active in 2026 correspondence).' },
    { name: 'Cole S. Fisher', role: 'Environmental Planner II (CBPA)', email: 'CSFisher@vbgov.com', phone: '757-385-6661', note: 'CBPA contact 2023–2025.' },
    { name: 'Patricia Burns', role: 'Intake', email: 'PBurns@vbgov.com', phone: '757-385-4902', note: 'Issues duplicate-PPR VOID warnings — one record per location.' },
    { name: 'L. A. Gordon', role: 'Accela / records help', email: 'lagordon@vbgov.com', note: 'Helped reopen/attach documents to Accela records (mined correspondence).' },
  ],
  // Learned from mined correspondence (§5A #35, 2026-08-01):
  // - Denied/edge PPRs can proceed via a CBPA ADMINISTRATIVE VARIANCE
  //   ($150 fee, posted signs, conditions letter) — a real prior filing path.
  // - Trees near an eagle's nest require DWR coordination (dwr.virginia.gov)
  //   BEFORE the city issues CBPA approval.
  // - Simple single-tree cases have been approved directly by the CBPA
  //   planner over email, with conditions — ask before assuming a full PPR.
  lastVerified: '2026-08-01',
};

const NORFOLK: CityRuleset = {
  city: 'Norfolk',
  portalSystem: 'City of Norfolk Environmental Services',
  mapViewer: 'air.norfolk.gov — zoning/CBPA layer (red checker = IDA, green checker = RPA); also shows the Coastal Resilience Overlay (CRO).',
  forms: [
    { name: 'CBPA Tree and Shrub Information / CBPA Tree Permit', note: 'Required to remove in the RPA.' },
    { name: 'Tree Permit Application (right-of-way / street trees)', note: 'Separate from the CBPA path — keep distinct.' },
  ],
  mitigation: {
    ratioPerRemoval: 3,
    minReplacements: 3,
    minCaliperInches: 3.5,
    note: 'RPA removals expect ~3-to-1 replacement; confirm current ratio with Environmental Services.',
  },
  contacts: [
    { name: 'Seamus McCarthy', role: 'Environmental Service Manager', email: 'seamus.mccarthy@norfolk.gov', phone: '757-664-4363', note: 'Office handling the 8562 Circle Drive CBPA case.' },
    { name: 'Jack Erwin', role: 'City Arborist (CBPA)', email: 'Jack.Erwin@norfolk.gov', note: 'Route Norfolk CBPA tree questions here.' },
    { name: 'Environmental Services', role: 'Office', email: '', phone: '757-664-4752' },
  ],
  lastVerified: '2026-08-01',
};

const CHESAPEAKE: CityRuleset = {
  city: 'Chesapeake',
  portalSystem: 'eBUILD online application portal',
  forms: [
    { name: 'CBPA/RPA submittal', note: 'Needs street address or tax parcel #, a site plan showing the RPA buffer, and photos of trees to be removed.' },
    { name: 'CBPA Exception (10+ mature trees)', note: 'Full exception with mitigation + CBPA Board public hearing (applicant-paid advertising fees).' },
  ],
  mitigation: {
    ratioPerRemoval: 3,
    minReplacements: 3,
    minCaliperInches: 3.5,
    note: 'Expect ~3-to-1 replacement/mitigation; scale drives the review path.',
  },
  scaleTiers: [
    { minTrees: 3, escalation: 'Roughly 3–9 trees may trigger a staff site visit.' },
    { minTrees: 10, escalation: '10+ mature trees requires a full CBPA Exception with mitigation and a CBPA Board public hearing.' },
  ],
  contacts: [
    { name: 'City Planning Dept', role: 'CBPA Review Committee → CBPA Board', email: '' },
  ],
  lastVerified: '2026-08-01',
};

const PORTSMOUTH: CityRuleset = {
  city: 'Portsmouth',
  portalSystem: 'Portsmouth Chesapeake Bay Program office',
  forms: [
    { name: 'Water Quality Impact Assessment (WQIA)', note: 'Used for RPA work. Plan must show the 100-ft RPA buffer (50-ft seaward + landward lines), structures/development, limits of land disturbance, and per-tree location/species/caliper.' },
    { name: 'Chesapeake Bay Exception Application', note: 'Where required.' },
  ],
  mitigation: {
    ratioPerRemoval: 3,
    minReplacements: 3,
    minCaliperInches: 3.5,
    note: 'Staff evaluate required replacement vegetation during WQIA review.',
  },
  contacts: [
    { name: 'Chesapeake Bay Program office', role: 'WQIA review', email: '' },
  ],
  lastVerified: '2026-08-01',
};

export const CITY_RULESETS: Record<ServiceCity, CityRuleset> = {
  'Virginia Beach': VIRGINIA_BEACH,
  Norfolk: NORFOLK,
  Chesapeake: CHESAPEAKE,
  Portsmouth: PORTSMOUTH,
};

export function rulesetFor(city: ServiceCity): CityRuleset {
  return CITY_RULESETS[city];
}

// Compile-time assurance every service city has a ruleset (§2: exactly four).
const _coverage: Record<ServiceCity, true> = {
  'Virginia Beach': true,
  Norfolk: true,
  Chesapeake: true,
  Portsmouth: true,
};
void _coverage;
void SERVICE_CITIES;
