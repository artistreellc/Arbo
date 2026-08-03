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
// THE CUSTOMER PORTAL VIEW (§8C, extended). Mike, 2026-08-03: a payment link,
// their property data and tree assessments, the pruning schedule, real-time
// project updates once contracted, and a site map with their trees on it.
//
// THIS IS THE THIRD DOOR. §8C.1 said one app, two doors — Mike's cockpit and
// the crew door. This is the first surface a person who does NOT work here
// ever sees, and that changes what the rules have to do:
//
//   1. ONE PROPERTY, NOTHING ELSE. A customer reaches exactly their own
//      property. No list, no search, no id to increment. The shaping below
//      takes ONE property and cannot express more than one.
//   2. NOTHING INTERNAL. No crew names, no other addresses, no lead source,
//      no margin, no what-Mike-thinks.
//   3. §3 — the payment figure is the one a HUMAN agreed on the estimate. No
//      agreed figure means NO payment link, and the portal says why rather
//      than showing a button that cannot work.
//   4. §1B, and this is the one that matters most here — "we have not looked
//      at this tree yet" and "this tree is fine" are completely different
//      facts. A customer reading a blank as reassurance is the failure this
//      whole file is arranged to prevent. Every unknown is NAMED.
//   5. Arbo never assesses a tree. The portal shows what MIKE recorded. An
//      empty assessment stays empty; nothing is inferred from silence.

export interface PortalTree {
  id: string;
  species: string | null;
  size: string | null;
  locationOnLot: string | null;
  /** Mike's recorded notes. Never generated. */
  conditionNotes: string | null;
  lastServiceDate: string | null;
  nextDueForecast: string | null;
}

export interface PortalProperty {
  id: string;
  address: string;
  city: string;
  zip: string | null;
  geoLat: number | null;
  geoLng: number | null;
  /** Mike, 2026-08-03: power lines, the water meter cap, how to find its run. */
  hazardPowerLines: boolean;
  /**
   * When somebody ACTUALLY checked for power lines. Null means the boolean
   * above is still its default, not an observation — see below.
   */
  powerLinesCheckedAt: string | null;
  waterMeterLocation: string | null;
  waterMeterPathNote: string | null;
  siteFeaturesNote: string | null;
}

/** One line of site information: a fact, or a named absence. Never a blank. */
export interface SiteFeature {
  label: string;
  value: string;
  /** False when this is an absence being named rather than a fact. */
  known: boolean;
}

/**
 * The site information Mike asked for. The interesting case is power lines.
 *
 * property.hazard_power_lines is a boolean that DEFAULTS to false, so on its
 * own it cannot tell "there are none" apart from "nobody looked" — and on a
 * field about power lines that distinction is the whole point. So a false
 * with no checked-at date renders as NOT CHECKED, not as "clear". Migration
 * 0016 adds the date for exactly this.
 */
export function siteFeatures(p: PortalProperty): SiteFeature[] {
  const out: SiteFeature[] = [];

  if (p.hazardPowerLines) {
    out.push({ label: 'Power lines', value: 'Power lines noted on this property — the crew plans around them.', known: true });
  } else if (p.powerLinesCheckedAt) {
    out.push({ label: 'Power lines', value: 'Checked — none noted over the work area.', known: true });
  } else {
    // The honest third state. "No" and "unchecked" must not read the same.
    out.push({ label: 'Power lines', value: 'Not checked yet. This is not the same as none — it gets looked at on the visit.', known: false });
  }

  out.push(p.waterMeterLocation?.trim()
    ? { label: 'Water meter cap', value: p.waterMeterLocation.trim(), known: true }
    : { label: 'Water meter cap', value: 'Location not recorded yet.', known: false });

  out.push(p.waterMeterPathNote?.trim()
    ? { label: 'Finding the meter run', value: p.waterMeterPathNote.trim(), known: true }
    : { label: 'Finding the meter run', value: 'No note on the run yet.', known: false });

  if (p.siteFeaturesNote?.trim()) {
    out.push({ label: 'Other site notes', value: p.siteFeaturesNote.trim(), known: true });
  }
  return out;
}

export interface PortalJob {
  id: string;
  status: string;
  scheduledFor: string | null;
  completedAt: string | null;
  scope: string | null;
  /** The figure a human agreed. Null means no payment link (§3). */
  agreedAmount: number | null;
  amountPaid: number | null;
}

/** A tree card. Every field is either a fact or a NAMED absence. */
export interface TreeCard {
  id: string;
  species: string;
  speciesKnown: boolean;
  size: string | null;
  locationOnLot: string | null;
  assessment: string;
  assessed: boolean;
  scheduleLine: string;
  scheduleKnown: boolean;
  lastServiceDate: string | null;
  nextDueForecast: string | null;
}

export const NOT_ASSESSED =
  'Not assessed yet. That is not a clean bill of health — it means nobody has looked at this one and written it down.';
export const NO_SCHEDULE =
  'No pruning scheduled yet. Mike sets the schedule once he has assessed the tree.';

export function toTreeCard(t: PortalTree): TreeCard {
  const speciesKnown = Boolean(t.species?.trim());
  const assessed = Boolean(t.conditionNotes?.trim());
  const scheduleKnown = Boolean(t.nextDueForecast);
  return {
    id: t.id,
    species: speciesKnown ? t.species!.trim() : 'Species not recorded',
    speciesKnown,
    size: t.size?.trim() || null,
    locationOnLot: t.locationOnLot?.trim() || null,
    // The §1B line of this file. A blank assessment renders as a stated
    // absence, never as silence a reader fills in with "fine".
    assessment: assessed ? t.conditionNotes!.trim() : NOT_ASSESSED,
    assessed,
    scheduleLine: scheduleKnown ? `Next pruning due ${t.nextDueForecast}` : NO_SCHEDULE,
    scheduleKnown,
    lastServiceDate: t.lastServiceDate,
    nextDueForecast: t.nextDueForecast,
  };
}

export interface MapMarker {
  treeId: string;
  locationOnLot: string | null;
  species: string;
  placeable: boolean;
}

export type PaymentState =
  | { state: 'payable'; amount: number; link: string | null; line: string }
  | { state: 'no_agreed_figure'; line: string }
  | { state: 'already_paid'; line: string }
  | { state: 'nothing_due'; line: string };

/**
 * What the pay button does. §3 in one function: Arbo copies a figure a human
 * agreed to, or shows no button at all. It never computes what to charge.
 *
 * `linkFor` is INJECTED — this module knows nothing about Square and cannot
 * take a payment even if something tried to make it.
 */
export function paymentState(
  job: PortalJob | null,
  linkFor: (jobId: string, amount: number) => string | null,
): PaymentState {
  if (!job || !job.completedAt) {
    return { state: 'nothing_due', line: 'Nothing to pay right now.' };
  }
  if (job.amountPaid != null && job.agreedAmount != null && job.amountPaid >= job.agreedAmount) {
    return { state: 'already_paid', line: 'Paid in full — thank you.' };
  }
  if (job.agreedAmount == null || !(job.agreedAmount > 0)) {
    // No agreed figure → no button. One that cannot work is worse than none,
    // and inventing the figure is forbidden outright.
    return {
      state: 'no_agreed_figure',
      line: 'Your invoice is not ready yet — Mike still has to put the agreed figure on this job.',
    };
  }
  return {
    state: 'payable',
    amount: job.agreedAmount,
    link: linkFor(job.id, job.agreedAmount),
    line: 'This is the figure you agreed with Mike.',
  };
}

export interface PortalView {
  property: { address: string; city: string; zip: string | null };
  trees: TreeCard[];
  map: {
    centre: { lat: number; lng: number } | null;
    markers: MapMarker[];
    unplaced: number;
    line: string | null;
  };
  project: { status: string; line: string; scheduledFor: string | null };
  /** Power lines, the water meter cap and its run — Mike's list. */
  site: SiteFeature[];
  payment: PaymentState;
  /** What is NOT known, stated plainly to the customer. */
  gaps: string[];
}

export function buildPortalView(input: {
  property: PortalProperty;
  trees: PortalTree[];
  job: PortalJob | null;
  linkFor: (jobId: string, amount: number) => string | null;
}): PortalView {
  const cards = input.trees
    .map(toTreeCard)
    .sort((a, b) => a.species.localeCompare(b.species) || a.id.localeCompare(b.id));

  const placeable = cards.filter((c) => c.locationOnLot !== null);
  const hasCentre = input.property.geoLat != null && input.property.geoLng != null;
  const unplaced = cards.length - placeable.length;

  const gaps: string[] = [];
  const unassessed = cards.filter((c) => !c.assessed).length;
  if (unassessed > 0) gaps.push(`${unassessed} of your ${cards.length} tree(s) have not been assessed yet.`);
  const unscheduled = cards.filter((c) => !c.scheduleKnown).length;
  if (unscheduled > 0) gaps.push(`${unscheduled} have no pruning date set.`);
  const unnamed = cards.filter((c) => !c.speciesKnown).length;
  if (unnamed > 0) gaps.push(`${unnamed} have no species recorded.`);
  const siteUnknown = siteFeatures(input.property).filter((f) => !f.known).length;
  if (siteUnknown > 0) gaps.push(`${siteUnknown} piece(s) of site information are not recorded yet.`);

  const job = input.job;
  const project = job
    ? {
      status: job.status,
      scheduledFor: job.scheduledFor,
      line: job.completedAt
        ? 'Work complete.'
        : job.scheduledFor
          ? 'Booked. Mike confirms the exact time — the window is what to plan around.'
          : 'Booked. Not scheduled to a day yet.',
    }
    : { status: 'none', scheduledFor: null, line: 'No work booked right now.' };

  return {
    property: { address: input.property.address, city: input.property.city, zip: input.property.zip },
    trees: cards,
    map: {
      centre: hasCentre ? { lat: input.property.geoLat!, lng: input.property.geoLng! } : null,
      markers: placeable.map((c) => ({
        treeId: c.id, locationOnLot: c.locationOnLot, species: c.species, placeable: true,
      })),
      unplaced,
      // An unmappable property says so. Drawing an empty map over a real
      // address would read as "you have no trees".
      line: hasCentre
        ? (unplaced > 0 ? 'Some trees are not on the map yet — they are listed below.' : null)
        : 'We do not have this property mapped yet, so the trees are listed rather than placed.',
    },
    project,
    site: siteFeatures(input.property),
    payment: paymentState(job, input.linkFor),
    gaps,
  };
}
