// Public works & permits knowledge base — pure queries (R25, Mike 2026-09-28).
//
// No I/O, no clock reads: `stale()` takes today as an argument. The job
// checklist speaks only the five statuses below; there is deliberately no
// "clear" / "none" value, and an 'unknown' input always becomes a REVIEW
// NEEDED line that names what is unknown (§1B — unknown is never fine).

import type { ServiceCity } from '../../lib/address.js';
import { rulesetFor } from '../cities.js';
import { FACTS } from './facts.js';
import { TOPICS, type Confidence, type Fact, type FactScope, type Topic } from './types.js';

export type ChecklistStatus = 'PERMIT LIKELY' | 'REVIEW NEEDED' | 'NO OVERLAY–VERIFY' | 'CALL FIRST' | 'TICKET REQUIRED';

export const CHECKLIST_STATUSES: readonly ChecklistStatus[] = [
  'PERMIT LIKELY',
  'REVIEW NEEDED',
  'NO OVERLAY–VERIFY',
  'CALL FIRST',
  'TICKET REQUIRED',
];

export interface ChecklistItem {
  step: string;
  why: string;
  factIds: string[];
  status: ChecklistStatus;
}

export type Maybe = boolean | 'unknown';

export interface JobInput {
  city: ServiceCity;
  inRpa: Maybe;
  nearPowerLines: Maybe;
  inRightOfWay: Maybe;
  stumpGrinding: boolean;
  historicDistrict: Maybe;
  haulingDebris: boolean;
  burning: boolean;
}

/** Facts filed under exactly this scope (a city, 'Regional' or 'Virginia'). */
export function factsFor(city: FactScope): Fact[] {
  return FACTS.filter((f) => f.city === city);
}

/** One topic for a city: the city's facts, then Regional, then Virginia. */
export function factsByTopic(city: ServiceCity, topic: Topic): Fact[] {
  return [...factsFor(city), ...factsFor('Regional'), ...factsFor('Virginia')].filter((f) => f.topic === topic);
}

export function factById(id: string): Fact | undefined {
  return FACTS.find((f) => f.id === id);
}

const STALE_AFTER_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Facts last verified more than 90 days before `today` — the re-verify list. */
export function stale(facts: readonly Fact[], today: Date | string): Fact[] {
  const now = typeof today === 'string' ? Date.parse(today) : today.getTime();
  return facts.filter((f) => (now - Date.parse(f.verifiedOn)) / DAY_MS > STALE_AFTER_DAYS);
}

export interface FactSummary {
  total: number;
  byCity: Record<FactScope, number>;
  byTopic: Record<Topic, number>;
  byConfidence: Record<Confidence, number>;
}

export function summary(): FactSummary {
  const byCity: Record<FactScope, number> = { 'Virginia Beach': 0, Norfolk: 0, Chesapeake: 0, Portsmouth: 0, Regional: 0, Virginia: 0 };
  const byTopic = Object.fromEntries(TOPICS.map((t) => [t, 0])) as Record<Topic, number>;
  const byConfidence: Record<Confidence, number> = { SOURCED: 0, UNCONFIRMED: 0 };
  for (const f of FACTS) {
    byCity[f.city] += 1;
    byTopic[f.topic] += 1;
    byConfidence[f.confidence] += 1;
  }
  return { total: FACTS.length, byCity, byTopic, byConfidence };
}

// ── Job checklist ───────────────────────────────────────────────────────────

// The fact each city's step is explained by. Every other fact on the same
// topic is still listed in factIds so the UI can show the full set.
const LEAD: Record<'rpa' | 'row' | 'historic' | 'disposal' | 'burning', Record<ServiceCity, string[]>> = {
  rpa: {
    'Virginia Beach': ['vb-rpa-buffer', 'vb-ppr-tree-removal-form'],
    Norfolk: ['nor-cbpa-prune-too', 'nor-cbpa-phone-conflict'],
    Chesapeake: ['ches-rpa-canopy', 'ches-dead-tree-discretion'],
    Portsmouth: ['pts-cbpa-overlay', 'pts-wqia'],
  },
  row: {
    'Virginia Beach': ['vb-row-permit', 'vb-row-resort-closure-ban', 'vb-street-tree-private-work'],
    Norfolk: ['nor-row-closure-permit', 'nor-street-tree-permit'],
    Chesapeake: ['ches-row-permits', 'ches-city-tree-policy'],
    Portsmouth: ['pts-row-use-permit', 'pts-street-trees'],
  },
  historic: {
    'Virginia Beach': ['vb-historic'],
    Norfolk: ['nor-historic-coa'],
    Chesapeake: ['ches-historic'],
    Portsmouth: ['pts-historic-coa'],
  },
  disposal: {
    'Virginia Beach': ['vb-landfill-no-commercial-yard-waste', 'vb-yard-debris-containers', 'reg-spsa-yard-waste'],
    Norfolk: ['nor-yard-waste', 'reg-spsa-yard-waste'],
    Chesapeake: ['ches-yard-waste', 'reg-spsa-yard-waste'],
    Portsmouth: ['pts-yard-waste', 'reg-spsa-yard-waste'],
  },
  burning: {
    'Virginia Beach': ['vb-no-yard-debris-burning', 'va-4pm-burn-law'],
    Norfolk: ['nor-burning', 'va-4pm-burn-law'],
    Chesapeake: ['ches-burn-permit', 'va-4pm-burn-law'],
    Portsmouth: ['pts-burning', 'va-4pm-burn-law'],
  },
};

// Burning differs by city: VB bans yard-debris burning, Chesapeake permits it,
// Norfolk and Portsmouth rules were not found.
const BURN_STEP: Record<ServiceCity, { step: string; status: ChecklistStatus }> = {
  'Virginia Beach': { step: 'Virginia Beach: open burning of yard debris is not approved — plan to haul it instead.', status: 'REVIEW NEEDED' },
  Norfolk: { step: 'Norfolk: confirm the open-burning rules with the Fire Marshal before any burning.', status: 'REVIEW NEEDED' },
  Chesapeake: { step: 'Chesapeake: get a Fire Marshal operational permit before land-clearing or commercial burning.', status: 'PERMIT LIKELY' },
  Portsmouth: { step: 'Portsmouth: confirm the open-burning rules with the Fire Marshal before any burning.', status: 'REVIEW NEEDED' },
};

/** Rule text of the given facts, each UNCONFIRMED one marked as such. */
function explain(ids: string[]): string {
  return ids
    .map((id) => {
      const f = factById(id);
      if (!f) throw new Error(`publicWorks: unknown fact id "${id}"`);
      return f.confidence === 'UNCONFIRMED' ? `${f.rule} (UNCONFIRMED)` : f.rule;
    })
    .join(' ');
}

/** Lead ids first, then every other fact on those topics for this city. */
function idsFor(city: ServiceCity, lead: string[], topics: Topic[]): string[] {
  const rest = topics.flatMap((t) => factsByTopic(city, t).map((f) => f.id));
  return [...new Set([...lead, ...rest])];
}

function unknownItem(what: string, question: string, factIds: string[]): ChecklistItem {
  return {
    step: `UNKNOWN: ${what} — ${question}`,
    why: `Nobody has checked ${what} for this job. Unknown is not the same as "no" — find out before quoting or cutting. ${explain(factIds.slice(0, 1))}`,
    factIds,
    status: 'REVIEW NEEDED',
  };
}

/**
 * Ordered checklist for one job: power lines, VA811, RPA, right-of-way,
 * historic, disposal, burning. RPA always yields a line (the overlay
 * vocabulary never goes silent); the others appear when true or unknown.
 */
export function jobChecklist(input: JobInput): ChecklistItem[] {
  const { city } = input;
  const items: ChecklistItem[] = [];

  // 1. Power lines — safety first.
  const powerIds = idsFor(city, ['va-dominion-10ft', 'va-high-voltage-act'], ['power_lines']);
  if (input.nearPowerLines === true) {
    items.push({
      step: 'Call Dominion Energy at 1-866-366-4357 before any work within 10 ft of a power line.',
      why: explain(['va-dominion-10ft', 'va-high-voltage-act']) + ' The utility has 5 working days to start arrangements.',
      factIds: powerIds,
      status: 'CALL FIRST',
    });
  } else if (input.nearPowerLines === 'unknown') {
    items.push(unknownItem('power lines', 'is any line within 10 ft of the tree or its branches?', powerIds));
  }

  // 2. Stump grinding — always a VA811 ticket.
  if (input.stumpGrinding) {
    items.push({
      step: 'Call VA811 (dial 811) for a locate ticket at least 2 working days before grinding the stump.',
      why: explain(['va-811-stump', 'va-811-notice']),
      factIds: idsFor(city, ['va-811-stump', 'va-811-notice'], ['utility_811']),
      status: 'TICKET REQUIRED',
    });
  }

  // 3. Resource Protection Area (CBPA overlay).
  const rpaLead = LEAD.rpa[city];
  const rpaIds = idsFor(city, rpaLead, ['private_tree_cbpa']);
  if (input.inRpa === true) {
    items.push({
      step: `${city}: work in the Resource Protection Area — file with the city before any cutting or pruning.`,
      why: explain(rpaLead),
      factIds: rpaIds,
      status: 'PERMIT LIKELY',
    });
  } else if (input.inRpa === 'unknown') {
    const map = rulesetFor(city).mapViewer;
    const how = map ? `check the parcel on ${map}.` : 'check the parcel with the city CBPA office.';
    items.push(unknownItem('Resource Protection Area (RPA)', how, rpaIds));
  } else {
    items.push({
      step: `${city}: no RPA overlay reported — still verify with the city; GIS can miss parcel edges.`,
      why: explain(rpaLead.slice(0, 1)),
      factIds: rpaIds,
      status: 'NO OVERLAY–VERIFY',
    });
  }

  // 4. Right-of-way (street work and city trees).
  const rowLead = LEAD.row[city];
  const rowIds = idsFor(city, rowLead, ['row_work_mot', 'street_tree_row']);
  if (input.inRightOfWay === true) {
    items.push({
      step: `${city}: right-of-way permit before working in the street or on a city tree.`,
      why: explain(rowLead),
      factIds: rowIds,
      status: 'PERMIT LIKELY',
    });
  } else if (input.inRightOfWay === 'unknown') {
    items.push(unknownItem('right-of-way', 'is any work in the street, on the sidewalk strip, or on a city tree?', rowIds));
  }

  // 5. Historic district.
  const histLead = LEAD.historic[city];
  const histIds = idsFor(city, histLead, ['historic']);
  if (input.historicDistrict === true) {
    items.push({
      step: `${city}: historic district — confirm with the city whether the tree work needs review before starting.`,
      why: explain(histLead),
      factIds: histIds,
      status: 'REVIEW NEEDED',
    });
  } else if (input.historicDistrict === 'unknown') {
    items.push(unknownItem('historic district', 'is the property in a local historic district?', histIds));
  }

  // 6. Hauling debris.
  if (input.haulingDebris) {
    const lead = LEAD.disposal[city];
    items.push({
      step: `${city}: confirm the drop-off site takes commercial yard waste before loading — call ahead.`,
      why: explain(lead),
      factIds: idsFor(city, lead, ['disposal']),
      status: 'CALL FIRST',
    });
  }

  // 7. Burning.
  if (input.burning) {
    const lead = LEAD.burning[city];
    items.push({ ...BURN_STEP[city], why: explain(lead), factIds: idsFor(city, lead, ['burning']) });
  }

  return items;
}
