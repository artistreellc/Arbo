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
//
// And one R26 (Mike, 2026-10-20) adds: a brake or steering defect HOLDS the
// unit off the schedule, whatever its severity, until Mike signs it back on
// with the owner key. Nothing returns a held unit on its own.

export type UnitStatus = 'up' | 'down' | 'maintenance' | 'held' | 'retired';

/** R26: why a held unit is off the schedule, in the words the screens show. */
export const HOLD_REASON = "brake/steering defect — needs Mike's sign-off";

/**
 * R26: who a sign-back is recorded as. The owner key is the only door to it
 * (no designate), so this is what Arbo actually knows — never a name a caller
 * typed into the request.
 */
export const OWNER_SIGNER = 'Mike (owner key)';

/** R26: the words that mean a brake or steering defect. */
const BRAKE = /\bbrak(e|es|ed|ing)\b|\babs\b/i;
const STEERING = /\bsteer(s|ed|ing)?\b|\btie ?rods?\b/i;

/**
 * Does this field report name a brake or steering defect? Matched on its own
 * words, never through the parts hint below: "brake line leaking" must hold
 * the unit even though the parts hint files it under hydraulic.
 */
export function isBrakeOrSteering(description: string): boolean {
  return BRAKE.test(description) || STEERING.test(description);
}

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
  /** R26: set when a brake or steering defect holds the unit; null otherwise. */
  holdReason: string | null;
}

/** Symptom keywords → the part families this unit's log might hold. */
const SYMPTOM_HINTS: Array<{ match: RegExp; family: RegExp; label: string }> = [
  { match: /\bhydraulic|hose|leak(ing)?\b/i, family: /hose|seal|fitting|hydraulic/i, label: 'hydraulic' },
  { match: /\bbelt\b/i, family: /belt/i, label: 'belt' },
  { match: /\bknife|knives|blade\b/i, family: /knife|knive|blade/i, label: 'chipper knives' },
  { match: /\bbatter(y|ies)|won'?t start|no crank\b/i, family: /batter|starter|alternator/i, label: 'starting system' },
  { match: /\bfilter|clogg(ed|ing)\b/i, family: /filter/i, label: 'filter' },
  { match: /\btire|flat\b/i, family: /tire|wheel/i, label: 'tire' },
  { match: BRAKE, family: /brake|pad|rotor/i, label: 'brakes' },
  { match: STEERING, family: /steer|tie ?rod/i, label: 'steering' },
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

  // Status first — a brake or steering defect is HELD whatever its severity
  // (R26), an immobilized unit is DOWN, full stop, and a unit that still runs
  // goes to 'maintenance' so it is visible without falsely grounding it.
  // A report can only ever ground a unit further, never put it back in service.
  const hold = isBrakeOrSteering(report.description);
  const proposed: UnitStatus = hold ? 'held' : report.immobilized ? 'down' : 'maintenance';
  const newStatus = escalateStatus(opts.currentStatus ?? 'up', proposed);
  if (newStatus === 'held') {
    steps.push((opts.currentStatus === 'held' ? 'Unit stays HELD' : 'Unit HELD') + ' — ' + HOLD_REASON
      + '. Scheduling will not assign it until Mike signs it back on; nothing returns it on its own.');
    if (report.immobilized) steps.push('Also reported as unable to be driven or run at all.');
  } else {
    steps.push(newStatus === 'down'
      ? (proposed === 'down'
        ? 'Unit marked DOWN — scheduling will stop assigning it until it is cleared.'
        : 'Unit stays DOWN — it was already grounded, and a field report does not put it back in service.')
      : 'Unit flagged for maintenance — still usable, but it needs attention.');
  }

  // §1B: Arbo says what it actually knows. There is no unit→job assignment in
  // the schema yet, so "is this unit on today's schedule?" is genuinely
  // unknown — and an unknown on a grounded unit is named, never implied clear.
  const assignment: ScheduleAssignment = opts.assignment ?? 'unknown';
  if (assignment === 'assigned') {
    steps.push('This unit is assigned to work on the books — reassign or move those jobs before the crew rolls.');
  } else if (assignment === 'unknown' && (newStatus === 'down' || newStatus === 'held')) {
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
    holdReason: newStatus === 'held' ? HOLD_REASON : null,
  };
}

/**
 * Can this unit be scheduled? A DOWN unit cannot — that is the whole point.
 * Neither can a HELD one (R26), however minor the brake or steering report
 * was. An allow-list: any status it does not name is not schedulable.
 */
export function isSchedulable(status: UnitStatus): boolean {
  return status === 'up' || status === 'maintenance';
}

/**
 * How grounded each status is. A field report may only move a unit DOWN this
 * ladder, never back up it. HELD sits above DOWN on purpose: a brake or
 * steering report on a unit that is already down must still hold it, so that
 * Mike's sign-off is the one way back however the unit got there.
 */
const SEVERITY: Record<UnitStatus, number> = { up: 0, maintenance: 1, down: 2, held: 3, retired: 4 };

/**
 * R26 — the one way OUT of a hold. Only a HELD unit can be signed back on,
 * and it goes back to service ('up'). Anything else answers null: there is
 * nothing to sign back on, and this never lifts a DOWN or retired unit.
 */
export function afterSignBack(current: UnitStatus): UnitStatus | null {
  return current === 'held' ? 'up' : null;
}

/**
 * A second field report can never quietly un-ground a unit. If the truck is
 * already DOWN and someone reports a rattle ("still drivable"), the truck
 * stays DOWN — only an explicit clearance puts it back in service.
 */
export function escalateStatus(current: UnitStatus, proposed: UnitStatus): UnitStatus {
  return SEVERITY[proposed] > SEVERITY[current] ? proposed : current;
}
