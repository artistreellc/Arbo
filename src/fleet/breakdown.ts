// Breakdown flow (brief §6E / §6E2.2, FLEET_MANAGEMENT_SPEC §1). A crew member
// reports a failure from the field; the unit goes DOWN so scheduling stops
// assigning it; the admin gets an action plan. Pure logic, so every rule is
// testable and identical wherever it runs.
//
// Two laws this module carries:
//  - §6E2.3 (the later, explicit decision on the flagged 6E conflict): Arbo
//    NEVER places an order and NEVER stores a vendor card. It builds the list
//    and deep-links; a human buys.
//  - §1B: a part Arbo cannot identify is named as unknown, never guessed.

export type UnitStatus = 'up' | 'down' | 'maintenance' | 'retired';

/**
 * Whether this unit is on the books. 'unknown' is the honest default: nothing
 * in the schema links a unit to a job, so Arbo must not imply either answer.
 */
export type ScheduleAssignment = 'assigned' | 'unassigned' | 'unknown';

export interface BreakdownReport {
  unitId: string;
  reportedBy: string;
  /** What the crew member said or typed, verbatim. */
  description: string;
  /** Photo/voice refs captured in the field (never required to report). */
  mediaRefs: string[];
  /** True when the unit cannot be driven or run at all. */
  immobilized: boolean;
  atIso: string;
}

export interface KnownPart {
  partNumber: string;
  description: string;
  supplier: string | null;
  lastPrice: number | null;
}

export interface ActionPlan {
  unitId: string;
  /** The status the unit must move to — DOWN is not optional when immobilized. */
  newStatus: UnitStatus;
  /** Ranked, human-readable next steps for Mike. */
  steps: string[];
  /** Parts to CONSIDER, from this unit's own history. Never ordered. */
  candidateParts: KnownPart[];
  /** Supplier deep links — a human clicks and buys (§6E2.3). */
  supplierLinks: Array<{ label: string; url: string }>;
  /** True always: this plan proposes, a human decides. */
  ordersPlaced: false;
  /** Named when Arbo could not match the symptom to a known part. */
  unknowns: string[];
}

/** Symptom keywords → the part families this unit's log might hold. */
const SYMPTOM_HINTS: Array<{ match: RegExp; family: RegExp; label: string }> = [
  { match: /\bhydraulic|hose|leak(ing)?\b/i, family: /hose|seal|fitting|hydraulic/i, label: 'hydraulic' },
  { match: /\bbelt\b/i, family: /belt/i, label: 'belt' },
  { match: /\bknife|knives|blade\b/i, family: /knife|knive|blade/i, label: 'chipper knives' },
  { match: /\bbatter(y|ies)|won'?t start|no crank\b/i, family: /batter|starter|alternator/i, label: 'starting system' },
  { match: /\bfilter|clogg(ed|ing)\b/i, family: /filter/i, label: 'filter' },
  { match: /\btire|flat\b/i, family: /tire|wheel/i, label: 'tire' },
  { match: /\bbrake\b/i, family: /brake|pad|rotor/i, label: 'brakes' },
];

/**
 * Turn a field report into an action plan. Deterministic: the same report and
 * the same parts log always produce the same plan.
 */
export function buildActionPlan(
  report: BreakdownReport,
  partsLog: KnownPart[],
  opts: { assignment?: ScheduleAssignment; openTasks?: number; currentStatus?: UnitStatus } = {},
): ActionPlan {
  const steps: string[] = [];
  const unknowns: string[] = [];

  // Status first — an immobilized unit is DOWN, full stop. A unit that still
  // runs goes to 'maintenance' so it is visible without falsely grounding it.
  // A report can only ever ground a unit further, never put it back in service.
  const proposed: UnitStatus = report.immobilized ? 'down' : 'maintenance';
  const newStatus = escalateStatus(opts.currentStatus ?? 'up', proposed);
  steps.push(newStatus === 'down'
    ? (proposed === 'down'
      ? 'Unit marked DOWN — scheduling will stop assigning it until it is cleared.'
      : 'Unit stays DOWN — it was already grounded, and a field report does not put it back in service.')
    : 'Unit flagged for maintenance — still usable, but it needs attention.');

  // §1B: Arbo says what it actually knows. There is no unit→job assignment in
  // the schema yet, so "is this unit on today's schedule?" is genuinely
  // unknown — and an unknown on a grounded unit is named, never implied clear.
  const assignment: ScheduleAssignment = opts.assignment ?? 'unknown';
  if (assignment === 'assigned') {
    steps.push('This unit is assigned to work on the books — reassign or move those jobs before the crew rolls.');
  } else if (assignment === 'unknown' && newStatus === 'down') {
    unknowns.push('Arbo cannot see which jobs this unit is assigned to — no unit-to-job link exists yet. Check today\'s schedule yourself before the crew rolls.');
  }

  if (opts.openTasks && opts.openTasks > 0) {
    steps.push(`${opts.openTasks} maintenance task(s) already open on this unit — this is not the first thing wrong with it.`);
  }

  // Parts the unit's OWN history suggests. Never invented: only rows that
  // already exist in this unit's log can appear.
  const hint = SYMPTOM_HINTS.find((h) => h.match.test(report.description));
  const candidateParts = hint
    ? partsLog.filter((p) => hint.family.test(p.description) || hint.family.test(p.partNumber))
    : [];

  if (!hint) {
    unknowns.push('Symptom did not match a known failure pattern — no part suggested.');
  } else if (candidateParts.length === 0) {
    unknowns.push(`Looks like a ${hint.label} issue, but this unit's parts log has no matching entry — part number unknown.`);
  } else {
    steps.push(`Likely ${hint.label}: ${candidateParts.length} matching part(s) already in this unit's log.`);
  }

  if (report.mediaRefs.length === 0) {
    unknowns.push('No photo on the report — ask for one before ordering anything.');
  }

  // §6E2.3: deep links only. Arbo builds the list; a human buys.
  const supplierLinks = candidateParts
    .filter((p) => p.supplier)
    .map((p) => ({
      label: `${p.supplier}: ${p.partNumber}`,
      url: `https://www.google.com/search?q=${encodeURIComponent(`${p.supplier} ${p.partNumber}`)}`,
    }));
  if (candidateParts.length > 0) {
    steps.push('Open a supplier link to buy — Arbo does not place orders and holds no card (§6E2.3).');
  }

  steps.push('Log the repair invoice against this unit when it comes back, so the parts log and the leakage line stay honest.');

  return {
    unitId: report.unitId,
    newStatus,
    steps,
    candidateParts,
    supplierLinks,
    ordersPlaced: false,
    unknowns,
  };
}

/** Can this unit be scheduled? A DOWN unit cannot — that is the whole point. */
export function isSchedulable(status: UnitStatus): boolean {
  return status === 'up' || status === 'maintenance';
}

/** How grounded each status is. A field report may only move a unit DOWN this
 * ladder, never back up it. */
const SEVERITY: Record<UnitStatus, number> = { up: 0, maintenance: 1, down: 2, retired: 3 };

/**
 * A second field report can never quietly un-ground a unit. If the truck is
 * already DOWN and someone reports a rattle ("still drivable"), the truck
 * stays DOWN — only an explicit clearance puts it back in service.
 */
export function escalateStatus(current: UnitStatus, proposed: UnitStatus): UnitStatus {
  return SEVERITY[proposed] > SEVERITY[current] ? proposed : current;
}
