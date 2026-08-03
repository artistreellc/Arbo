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
// THE PRUNE ESTIMATE — part of the RA, and NOT a prune plan.
//
// MIKE'S RULING, 2026-08-03, verbatim:
//   "the pruning plan it going to be apart of the RA as is an estimate tool
//    and a rough guess of the limbs coming off of a nieghbors over hangeing
//    tree the actual prune plan needs to be made be the foreman or onwer or
//    isa certified arborist on site"
//
// This resolves the collision that blocked the camera feature. Pointing a
// phone at a tree does NOT produce a prune plan. It produces a ROUGH GUESS at
// which limbs come off a neighbour's overhanging tree, for ESTIMATING. The
// actual plan is authored by a named human — foreman, owner, or ISA certified
// arborist — standing on the site.
//
// ─────────────────────────────────────────────────────────────────────────
// TWO ARTIFACTS. KEEPING THEM APART IS THE ENTIRE JOB OF THIS FILE.
// ─────────────────────────────────────────────────────────────────────────
//
//   PruneEstimate  — tool output. Rough. For pricing the work. Carries a
//                    disclaimer it cannot be separated from, and there is no
//                    function anywhere that turns one into a plan.
//   PrunePlan      — a person's decision, authored on site, with their name
//                    and role on it. The ONLY thing the crew cuts to.
//
// The dangerous version of this feature is the one where a confident line
// gets drawn over a tree the tool misread and somebody cuts to it. So:
//
//   * The two are separate TYPES. A PruneEstimate has no cut list and no
//     field that could hold one, so it cannot be handed to a crew as a plan
//     by mistake — that is a type error, not a code review catch.
//   * `authorPrunePlan()` is the only way to get a PrunePlan, and it REFUSES
//     without a named author, an allowed role, and on-site presence.
//   * An unreadable capture says it is unreadable (§1B). "The tool could not
//     tell" and "nothing comes off" are different facts and never render the
//     same — that distinction is `limbs: null` versus `limbs: []` below.
//   * Nothing here holds a price. The estimate is limbs, not dollars; the
//     figure still originates with a human on the estimate (§3).
//   * Nothing here describes a tree's health. Which limbs overhang a fence is
//     geometry. Whether a tree is sick is a diagnosis, and this file has no
//     vocabulary for it.

import type { UtilityMarking, LocateTicket } from './utilityMarkings.js';

export type EstimateScope = 'neighbor_overhang';

export type SizeBand = 'small' | 'medium' | 'large' | 'unknown';

/** Where the capture came from. R6 makes the AR path iOS-native; the manual
 *  path is a person typing what they see, and both produce the same rough
 *  artifact so nothing downstream has to care which it was. */
export type CaptureSource = 'camera_ar' | 'manual';

export interface LimbGuess {
  id: string;
  /** Rough position in plain words — "over the fence, north side, mid-canopy". */
  where: string;
  sizeBand: SizeBand;
  overNeighborProperty: boolean;
  // ── Mike, 2026-08-03: "the whole point of this is logging has much tree
  //    care data as possible." Everything below is nullable, and null means
  //    NOT RECORDED — never "none", never zero. A rich record with honest
  //    holes in it is worth something; a record that quietly reports absent
  //    data as absent conditions is worth less than nothing.
  /** Rough limb diameter at the attachment, inches. Never a measurement claim. */
  diameterInchesGuess: number | null;
  /** Rough length out from the trunk, feet. */
  lengthFeetGuess: number | null;
  /** Compass-ish bearing in plain words — "north", "over the driveway side". */
  bearing: string | null;
  /** Height off the ground at the attachment, feet. */
  attachmentHeightFeetGuess: number | null;
  /** What sits underneath it — shed, fence, play set, parked cars. */
  targetsBeneath: string | null;
  /** Anything the observer wrote down that has no field of its own. */
  notes: string | null;
}

/**
 * THE TREE CARE LOG (Mike, 2026-08-03).
 *
 * This is the accumulating record — the thing D48 calls the moat: public
 * agronomy is anyone's, but Mike's own observations across his own properties
 * over years are not. So the shape here errs toward capturing MORE, and every
 * single field is nullable.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHERE THE LINE IS, BECAUSE IT IS FINE AND IT MATTERS
 * ─────────────────────────────────────────────────────────────────────────
 * "Deadwood visible in the upper north canopy, noted by <name> on <date>" is
 * an OBSERVATION. Somebody saw a thing and wrote it down, and their name is
 * on it.
 *
 * "This tree is hazardous" is a DIAGNOSIS, and neither Arbo nor this file
 * produces one. That is why there is NO scoring function here, no risk
 * rating, no health index, and no function that reads these fields and
 * returns a conclusion. The fields are storage. The conclusion is a person's,
 * on site, with their name on it — exactly the same rule the prune plan
 * follows below.
 *
 * If someone later adds `overallRisk()` to this file, that is the rule being
 * broken, no matter how good the heuristic looks.
 */
export interface TreeObservation {
  /** Who wrote it down. Null means the record is unattributed — say so. */
  observedBy: string | null;
  observedAt: string | null;

  speciesGuess: string | null;
  dbhInchesGuess: number | null;
  heightFeetGuess: number | null;
  canopySpreadFeetGuess: number | null;

  // Structure the observer could SEE. Booleans are nullable on purpose: false
  // means "looked, did not see it", null means "did not look / not recorded",
  // and on a tree those are not the same statement.
  deadwoodNoted: boolean | null;
  cavityOrDecayNoted: boolean | null;
  leanNoted: boolean | null;
  includedBarkNoted: boolean | null;
  priorToppingNoted: boolean | null;
  rootPlateDisturbanceNoted: boolean | null;

  /** What is under the canopy — the strike zone in plain words. */
  targetsBeneath: string | null;
  /** Wires, service drops, transformers — routing info, not a clearance call. */
  utilityProximity: string | null;
  /** How you get equipment to it. */
  accessNotes: string | null;
  /** Drive file ids or storage refs. Never image bytes in the row. */
  photoRefs: string[];
  /** Anything with no field of its own. Always keep it. */
  freeNotes: string | null;
}

/**
 * CUSTOMER CONTEXT (Mike, 2026-08-03: "as much custmer data as possible").
 *
 * §3 already settled why this is worth keeping, in his own words: his rows
 * are "the AI assistant's context — contact instructions ('CALL FIRST',
 * 'gets home at 3'), who owns the property versus who called, prior history",
 * and VA brief §5.9 makes those binding on every future contact. So capture
 * generously.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * STORED YES. ECHOED NEVER. THESE ARE DIFFERENT RULES AND BOTH ARE ON.
 * ─────────────────────────────────────────────────────────────────────────
 * §4.3 bans customer PII from CHAT OUTPUT AND LOGS — counts and ids only. It
 * does NOT ban storing it in the RLS-locked database; storing it is the whole
 * point. So: this struct is rich, and nothing in this file ever prints it.
 * See `contextLogLine()` at the bottom — the only sanctioned way to mention
 * one of these in a log line, and it emits counts and ids alone.
 */
export interface CustomerContext {
  /** Who to ring, and how they want to be reached. Free text on purpose. */
  contactInstructions: string | null;
  /** "Gets home at 3", "call first", "don't ring the bell — baby asleep". */
  accessWindowNotes: string | null;
  /** Owner vs the person who called — the brief treats these as distinct. */
  callerIsOwner: boolean | null;
  ownerNameOnFile: boolean | null;
  /** Gate codes, dogs, where to park. The stuff a crew loses a morning to. */
  siteEntryNotes: string | null;
  petsOnSite: string | null;
  /** What they told us they want, in their words, not ours. */
  statedConcern: string | null;
  /** Prior work with us, if any — a pointer, not a copy of the history. */
  priorJobIds: string[];
  /** Anything they said that a person should read before knocking. */
  freeNotes: string | null;
}

export function emptyCustomerContext(): CustomerContext {
  return {
    contactInstructions: null, accessWindowNotes: null,
    callerIsOwner: null, ownerNameOnFile: null,
    siteEntryNotes: null, petsOnSite: null, statedConcern: null,
    priorJobIds: [], freeNotes: null,
  };
}

/**
 * GEO (Mike, 2026-08-03: "as much geo data as possible").
 *
 * Two rules shape this one.
 *
 * 1. ACCURACY IS PART OF THE READING. A lat/lng with no accuracy figure is a
 *    pin somebody will trust to the metre. `accuracyMeters` is therefore its
 *    own field and null means "we do not know how good this is" — which is a
 *    different fact from a good fix, and D37 is the proof: the geocoder put
 *    8562 Circle Drive on the street centreline, the RPA hugged the rear of
 *    the lot, and only a 300 m probe found the overlay. A confident-looking
 *    point was the thing that nearly missed a real violation.
 * 2. NO OVERLAY FINDINGS LIVE HERE. Whether the property is in the CBPA is
 *    the permit row's answer, surfaced through src/portal/propertyFlags.ts.
 *    Copying it in here would be the second-source-of-truth mistake D62 just
 *    finished avoiding. Geo records WHERE. It does not record WHAT APPLIES.
 */
export interface GeoRecord {
  /** Where the capture was taken from — the phone's own fix. */
  capturedLat: number | null;
  capturedLng: number | null;
  accuracyMeters: number | null;
  /** Where the TREE is, if it was placed separately from the phone. */
  treeLat: number | null;
  treeLng: number | null;
  /** How the position was arrived at. Null = not recorded. */
  fixSource: 'gps' | 'ar_placement' | 'manual_pin' | 'geocoded_address' | null;
  elevationMeters: number | null;
  headingDegrees: number | null;
  /** Rough position on the lot in words — survives when coordinates do not. */
  positionOnLot: string | null;
  /** Feet from the structure, the line, the street. Rough, and labelled rough. */
  distanceToStructureFeet: number | null;
  distanceToPropertyLineFeet: number | null;
  distanceToRoadFeet: number | null;
  /** Parcel / GPIN identifier when the city's record was looked up. */
  parcelId: string | null;
  /** Municipality as recorded at capture — not re-derived later. */
  cityAtCapture: string | null;
  freeNotes: string | null;
}

export function emptyGeoRecord(): GeoRecord {
  return {
    capturedLat: null, capturedLng: null, accuracyMeters: null,
    treeLat: null, treeLng: null, fixSource: null,
    elevationMeters: null, headingDegrees: null, positionOnLot: null,
    distanceToStructureFeet: null, distanceToPropertyLineFeet: null, distanceToRoadFeet: null,
    parcelId: null, cityAtCapture: null, freeNotes: null,
  };
}

/**
 * How much to trust the pin. Deliberately NOT a boolean.
 *
 * `unknown` is the one that matters: coordinates with no accuracy figure look
 * exactly as authoritative on a map as coordinates with a 3 m fix, and they
 * are not. Anything reading this to place a marker should say which it has.
 */
export type GeoQuality = 'good' | 'rough' | 'unknown' | 'none';

export function geoQuality(g: GeoRecord): { quality: GeoQuality; line: string } {
  const hasPoint = (g.treeLat != null && g.treeLng != null) || (g.capturedLat != null && g.capturedLng != null);
  if (!hasPoint) {
    return { quality: 'none', line: 'No coordinates recorded for this one — position is whatever somebody wrote in words.' };
  }
  if (g.accuracyMeters == null) {
    return {
      quality: 'unknown',
      line: 'Coordinates recorded, but with no accuracy figure — treat the pin as approximate, not as a survey point.',
    };
  }
  if (g.accuracyMeters <= 10) {
    return { quality: 'good', line: `Position good to about ${g.accuracyMeters} m.` };
  }
  return { quality: 'rough', line: `Position only good to about ${g.accuracyMeters} m — close enough to find it, not to draw a line with.` };
}

export function emptyObservation(): TreeObservation {
  return {
    observedBy: null, observedAt: null,
    speciesGuess: null, dbhInchesGuess: null, heightFeetGuess: null, canopySpreadFeetGuess: null,
    deadwoodNoted: null, cavityOrDecayNoted: null, leanNoted: null,
    includedBarkNoted: null, priorToppingNoted: null, rootPlateDisturbanceNoted: null,
    targetsBeneath: null, utilityProximity: null, accessNotes: null,
    photoRefs: [], freeNotes: null,
  };
}

/** Fields that count toward "how much did we actually log on this one". */
const LOGGED_FIELDS: Array<keyof TreeObservation> = [
  'speciesGuess', 'dbhInchesGuess', 'heightFeetGuess', 'canopySpreadFeetGuess',
  'deadwoodNoted', 'cavityOrDecayNoted', 'leanNoted', 'includedBarkNoted',
  'priorToppingNoted', 'rootPlateDisturbanceNoted',
  'targetsBeneath', 'utilityProximity', 'accessNotes', 'freeNotes',
];

export interface LogCompleteness {
  recorded: number;
  total: number;
  /** The field names still empty — this is the prompt list for the next visit. */
  missing: string[];
  attributed: boolean;
  line: string;
}

/**
 * How much of the tree care log is actually filled in.
 *
 * This exists because Mike's point is the LOGGING. A capture form that never
 * shows what is still blank collects whatever is convenient and stops. Naming
 * the holes is what turns this from a form into a record that gets fuller
 * every visit — and it is the same §1B instinct pointed inward: we are honest
 * with ourselves about what we have not written down.
 */
export function logCompleteness(o: TreeObservation): LogCompleteness {
  const missing = LOGGED_FIELDS.filter((k) => {
    const v = o[k];
    return v === null || (typeof v === 'string' && v.trim() === '');
  }).map(String);
  const recorded = LOGGED_FIELDS.length - missing.length;
  const attributed = Boolean(o.observedBy?.trim());
  return {
    recorded,
    total: LOGGED_FIELDS.length,
    missing,
    attributed,
    line: attributed
      ? `${recorded} of ${LOGGED_FIELDS.length} logged${missing.length ? `, ${missing.length} still blank` : ' — complete'}.`
      // An unattributed observation is a weaker record and should look like
      // one. We do not know who to ask about it later.
      : `${recorded} of ${LOGGED_FIELDS.length} logged, but nobody's name is on this record.`,
  };
}

export interface PruneEstimate {
  /** Discriminant. Present so no surface can confuse this with a plan. */
  kind: 'rough_estimate';
  id: string;
  treeId: string;
  scope: EstimateScope;
  source: CaptureSource;
  /** The AR run this came off, when it came off one. Provenance for the guess. */
  arSessionId: string | null;
  capturedAt: string;
  /**
   * THE §1B FIELD. `null` means the capture could not read the tree.
   * `[]` means it read the tree and found no overhanging limbs. A caller
   * that treats these the same is telling somebody "nothing comes off" when
   * the honest answer was "we could not tell".
   */
  limbs: LimbGuess[] | null;
  /** Why it could not be read. Required whenever `limbs` is null. */
  notReadable: string | null;
}

export const ESTIMATE_DISCLAIMER =
  'Rough estimate only — this is for working out the size of the job. It is NOT a prune plan. ' +
  'The cuts are decided on site by the foreman, the owner, or an ISA certified arborist.';

export const UNREADABLE_LINE =
  'The camera could not make out the limbs well enough to guess. That is not "nothing comes off" — it means this one gets eyes on it.';

export const NO_OVERHANG_LINE =
  'No limbs read as crossing the neighbour\'s line. Still a rough read, and still confirmed on site.';

/**
 * Build an estimate. Note what is NOT a parameter: any confidence score, any
 * price, any condition. The tool guesses at geometry and says so.
 *
 * An unreadable capture MUST give a reason. Passing `limbs: null` with no
 * reason throws rather than producing a silent blank, because a blank is
 * exactly what a reader fills in with "nothing to do".
 */
export function buildPruneEstimate(input: {
  id: string;
  treeId: string;
  source: CaptureSource;
  capturedAt: string;
  limbs: LimbGuess[] | null;
  notReadable?: string | null;
  arSessionId?: string | null;
}): PruneEstimate {
  const reason = input.notReadable?.trim() || null;
  if (input.limbs === null && !reason) {
    throw new Error('an unreadable prune estimate must say why it could not be read (§1B)');
  }
  if (input.limbs !== null && reason) {
    throw new Error('an estimate cannot both list limbs and claim it was unreadable');
  }
  return {
    kind: 'rough_estimate',
    id: input.id,
    treeId: input.treeId,
    scope: 'neighbor_overhang',
    source: input.source,
    arSessionId: input.arSessionId ?? null,
    capturedAt: input.capturedAt,
    limbs: input.limbs,
    notReadable: reason,
  };
}

export interface EstimateSummary {
  /** Null when unreadable — NOT zero. Zero is a count; null is an absence. */
  limbCount: number | null;
  overhangCount: number | null;
  headline: string;
  /** Always present, always the same words, never optional. */
  disclaimer: string;
  readable: boolean;
}

export function summarizeEstimate(e: PruneEstimate): EstimateSummary {
  if (e.limbs === null) {
    return {
      limbCount: null,
      overhangCount: null,
      // Never a zero here. "0 limbs" from a failed read is the confident zero
      // §1B exists to prevent.
      headline: UNREADABLE_LINE,
      disclaimer: ESTIMATE_DISCLAIMER,
      readable: false,
    };
  }
  const over = e.limbs.filter((l) => l.overNeighborProperty).length;
  return {
    limbCount: e.limbs.length,
    overhangCount: over,
    headline: e.limbs.length === 0
      ? NO_OVERHANG_LINE
      : `Rough read: ${e.limbs.length} limb(s), ${over} of them over the neighbour's line.`,
    disclaimer: ESTIMATE_DISCLAIMER,
    readable: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE PLAN — a person's decision, not the tool's
// ─────────────────────────────────────────────────────────────────────────

/** Mike's list, exactly: "the foreman or onwer or isa certified arborist". */
export type PlanAuthorRole = 'foreman' | 'owner' | 'isa_certified_arborist';

export const ALLOWED_PLAN_AUTHOR_ROLES: PlanAuthorRole[] = ['foreman', 'owner', 'isa_certified_arborist'];

export interface PlanAuthor {
  id: string;
  name: string;
  role: PlanAuthorRole;
  /**
   * Required when the role is isa_certified_arborist, and refused otherwise.
   *
   * "Never claim a credential the company doesn't hold" is a golden rule. A
   * plan stamped "authored by an ISA certified arborist" with no certificate
   * number behind it is that rule broken in the most consequential place we
   * could break it — on the document the crew cuts to.
   */
  isaCertificationNumber: string | null;
}

/** One cut, in the author's own words. Arbo never writes into this. */
export interface PlannedCut {
  limbRef: string;
  instruction: string;
}

export interface PrunePlan {
  kind: 'prune_plan';
  id: string;
  treeId: string;
  /** The estimate this was worked up from, when there was one. Never required. */
  fromEstimateId: string | null;
  author: PlanAuthor;
  authoredAt: string;
  authoredOnSite: true;
  /** Empty ONLY when noCutsNeeded is true — see authorPrunePlan. */
  cuts: PlannedCut[];
  noCutsNeeded: boolean;
}

export type PlanResult = { ok: true; plan: PrunePlan } | { ok: false; problem: string };

/**
 * The only way to make a PrunePlan. Every refusal below is a rule Mike or the
 * brief already set, made unskippable.
 *
 * There is deliberately NO function that promotes a PruneEstimate into a plan.
 * The estimate can be passed as `fromEstimateId` for provenance, and that is
 * all it can ever contribute — a person still writes every cut.
 */
export function authorPrunePlan(input: {
  id: string;
  treeId: string;
  fromEstimateId?: string | null;
  author: PlanAuthor;
  onSite: boolean;
  authoredAt: string;
  cuts: PlannedCut[];
  noCutsNeeded?: boolean;
}): PlanResult {
  const name = input.author.name.trim();
  if (!name) {
    return { ok: false, problem: 'A prune plan has to carry the name of the person who made it.' };
  }
  if (!ALLOWED_PLAN_AUTHOR_ROLES.includes(input.author.role)) {
    return {
      ok: false,
      problem: 'Only the foreman, the owner, or an ISA certified arborist can make the prune plan.',
    };
  }
  const isa = input.author.isaCertificationNumber?.trim() || null;
  if (input.author.role === 'isa_certified_arborist' && !isa) {
    return {
      ok: false,
      problem: 'An ISA certified arborist has to be recorded with their certification number — we do not put a credential on a plan we cannot show.',
    };
  }
  if (input.author.role !== 'isa_certified_arborist' && isa) {
    // Not pedantry. A foreman's plan carrying an ISA number reads, later, as
    // an arborist-authored plan. Same golden rule from the other side.
    return {
      ok: false,
      problem: 'An ISA certification number belongs only on a plan an ISA certified arborist actually made.',
    };
  }
  if (!input.onSite) {
    // Mike said "on site" and meant it. A plan written from photos in a truck
    // is the failure mode this whole ruling exists to prevent.
    return { ok: false, problem: 'The prune plan gets made on site. Not from the office, not from photos.' };
  }
  const noCuts = input.noCutsNeeded === true;
  if (!noCuts && input.cuts.length === 0) {
    // "Nothing comes off" must be SAID, not left as an empty list somebody
    // reads as an unfinished form.
    return {
      ok: false,
      problem: 'A plan with no cuts on it has to say so on purpose — tick "nothing comes off" rather than leaving it blank.',
    };
  }
  if (noCuts && input.cuts.length > 0) {
    return { ok: false, problem: 'This plan says nothing comes off but still lists cuts.' };
  }
  return {
    ok: true,
    plan: {
      kind: 'prune_plan',
      id: input.id,
      treeId: input.treeId,
      fromEstimateId: input.fromEstimateId ?? null,
      author: { ...input.author, name, isaCertificationNumber: isa },
      authoredAt: input.authoredAt,
      authoredOnSite: true,
      cuts: noCuts ? [] : input.cuts,
      noCutsNeeded: noCuts,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// WHAT A SCREEN IS ALLOWED TO SAY
// ─────────────────────────────────────────────────────────────────────────

export interface PruneStanding {
  /** True ONLY when a human-authored plan exists. */
  cuttable: boolean;
  line: string;
  /** Shown alongside an estimate. Null when there is no estimate. */
  estimateLine: string | null;
}

/**
 * The single function every crew and customer surface should call. It exists
 * so no screen has to decide for itself whether an estimate counts as a plan
 * — it does not, and the answer is centralised here rather than re-derived in
 * four places that will eventually disagree.
 */
export function pruneStanding(plan: PrunePlan | null, estimate: PruneEstimate | null): PruneStanding {
  const estimateLine = estimate ? `${summarizeEstimate(estimate).headline} ${ESTIMATE_DISCLAIMER}` : null;

  if (plan) {
    const who = plan.author.role === 'isa_certified_arborist'
      ? `${plan.author.name}, ISA certified arborist #${plan.author.isaCertificationNumber}`
      : `${plan.author.name} (${plan.author.role})`;
    return {
      cuttable: true,
      line: plan.noCutsNeeded
        ? `Plan on file from ${who}, ${plan.authoredAt}: nothing comes off this one.`
        : `Plan on file from ${who}, ${plan.authoredAt}: ${plan.cuts.length} cut(s).`,
      estimateLine,
    };
  }
  if (estimate) {
    return {
      cuttable: false,
      // The most important sentence in this file. An estimate on screen with
      // no plan behind it must not read as authorisation to start cutting.
      line: 'No prune plan yet — what you are looking at is a rough estimate for pricing. Nobody cuts to it. The foreman, Mike, or an ISA certified arborist makes the plan on site.',
      estimateLine,
    };
  }
  return {
    cuttable: false,
    line: 'No prune estimate and no plan on file for this tree. That is not "nothing needs doing" — it means nobody has looked yet.',
    estimateLine: null,
  };
}

/**
 * THE AR CAPTURE SESSION (Mike, 2026-08-03: "also the video caoturing that
 * happens during AR").
 *
 * When somebody points the phone at the tree, the run itself is data — the
 * video, the frames, and on a LiDAR device the depth mesh. Per R6 that
 * capture is iOS-native (RealityKit / ARKit, iPhone 12 Pro+); this struct is
 * the record of it and does not care which framework produced it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REFS ONLY. NO BYTES IN THE ROW.
 * ─────────────────────────────────────────────────────────────────────────
 * Every media field is a STORAGE REFERENCE (a Drive file id or equivalent),
 * never encoded media. A video of somebody's back garden is customer data
 * under §4.3 the same as their phone number: stored, never printed, never
 * put in a report. `raLogLine()` reports counts of these and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CONSENT IS A FIELD, AND ITS DEFAULT IS "NOT RECORDED"
 * ─────────────────────────────────────────────────────────────────────────
 * Filming on a customer's property — and especially over a fence onto a
 * NEIGHBOUR's, which is the exact scope of this estimate — is a thing you ask
 * about first. `recordedWithConsent` is nullable: null means nobody wrote it
 * down, which is not the same as yes and must never render as yes. I am not
 * blocking a capture on it; Mike asked for the video and a crew member in a
 * yard should not be fighting a form. But it is captured, it is surfaced, and
 * a session over a neighbour's line with no consent recorded says so out loud.
 */
export interface ArCaptureSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  /** Storage refs for the recorded video. Never bytes. */
  videoRefs: string[];
  /** Stills pulled from the run. */
  keyframeRefs: string[];
  /** LiDAR / depth mesh exports, when the device produced them. */
  depthScanRefs: string[];
  deviceModel: string | null;
  osVersion: string | null;
  arFramework: 'realitykit' | 'arkit' | 'other' | null;
  /** How well tracking held. Null = not recorded, and a bad run should say. */
  trackingQuality: 'good' | 'poor' | 'lost' | null;
  hasLidar: boolean | null;
  /** Did we film over the neighbour's line? Drives the consent line below. */
  coveredNeighborProperty: boolean | null;
  recordedWithConsent: boolean | null;
  consentNote: string | null;
}

export function emptyArSession(input: { id: string; startedAt: string }): ArCaptureSession {
  return {
    id: input.id, startedAt: input.startedAt, endedAt: null, durationSeconds: null,
    videoRefs: [], keyframeRefs: [], depthScanRefs: [],
    deviceModel: null, osVersion: null, arFramework: null,
    trackingQuality: null, hasLidar: null,
    coveredNeighborProperty: null, recordedWithConsent: null, consentNote: null,
  };
}

export interface ArSessionStanding {
  mediaCount: number;
  /** Named loudly when tracking was poor — a bad run's guesses are worse. */
  qualityLine: string;
  consentLine: string;
  consentNeedsAttention: boolean;
}

export function arSessionStanding(s: ArCaptureSession): ArSessionStanding {
  const mediaCount = s.videoRefs.length + s.keyframeRefs.length + s.depthScanRefs.length;

  let qualityLine: string;
  if (s.trackingQuality === 'lost') {
    qualityLine = 'Tracking was lost during this capture — treat anything measured off it as unreliable, not as a reading.';
  } else if (s.trackingQuality === 'poor') {
    qualityLine = 'Tracking was poor during this capture — the guesses off it are rougher than usual.';
  } else if (s.trackingQuality === 'good') {
    qualityLine = 'Tracking held through the capture.';
  } else {
    qualityLine = 'No tracking quality recorded for this capture, so how good the run was is unknown.';
  }

  // The case that actually matters: we filmed over the fence and nobody wrote
  // down whether we asked. Null is not a yes.
  const overNeighbor = s.coveredNeighborProperty === true;
  let consentLine: string;
  let consentNeedsAttention = false;
  if (s.recordedWithConsent === true) {
    consentLine = `Filming consent recorded${s.consentNote?.trim() ? `: ${s.consentNote.trim()}` : '.'}`;
  } else if (s.recordedWithConsent === false) {
    consentLine = 'Recorded WITHOUT consent on file. Do not share this footage outside the company; check with Mike before it is used for anything.';
    consentNeedsAttention = true;
  } else {
    consentLine = overNeighbor
      ? 'This capture covered the neighbour\'s property and no filming consent was recorded. That is not consent — get it written down.'
      : 'No filming consent recorded for this capture. Not recorded is not the same as given.';
    consentNeedsAttention = overNeighbor;
  }

  return { mediaCount, qualityLine, consentLine, consentNeedsAttention };
}

// ─────────────────────────────────────────────────────────────────────────
// THE RA — what all of this hangs off
// ─────────────────────────────────────────────────────────────────────────

/**
 * The risk assessment record. Mike: the pruning estimate is PART OF the RA.
 *
 * This is the container, and it is the thing that accumulates. One tree, one
 * RA, growing every time somebody visits: more observation fields filled,
 * better geo, more customer context, another estimate, and eventually a plan
 * with a person's name on it.
 *
 * Note the order of authority it encodes. `estimate` is the tool's rough
 * guess. `plan` is a human's decision. `observation`, `customer` and `geo`
 * are recorded facts with an observer attached. Nothing in this file reads
 * across them to produce a verdict — that is the job of the person on site.
 */
export interface RiskAssessment {
  id: string;
  treeId: string;
  propertyId: string;
  observation: TreeObservation;
  customer: CustomerContext;
  geo: GeoRecord;
  /** Rough guesses, newest last. Kept, not overwritten — the history is data. */
  estimates: PruneEstimate[];
  /** Every AR run on this tree, kept. A poor early capture is still evidence. */
  arSessions: ArCaptureSession[];
  /**
   * Every Miss Utility marking we have ever recorded here, and the tickets
   * they came off. Kept forever and rendered DOTTED — see utilityMarkings.ts.
   * These are a memory of what is underground, NOT a live locate, and nothing
   * in this file treats them as one.
   */
  utilityMarkings: UtilityMarking[];
  locateTickets: LocateTicket[];
  /** The current human-authored plan, if one exists yet. */
  plan: PrunePlan | null;
  createdAt: string;
  updatedAt: string;
}

export function newRiskAssessment(input: {
  id: string; treeId: string; propertyId: string; now: string;
}): RiskAssessment {
  return {
    id: input.id,
    treeId: input.treeId,
    propertyId: input.propertyId,
    observation: emptyObservation(),
    customer: emptyCustomerContext(),
    geo: emptyGeoRecord(),
    estimates: [],
    arSessions: [],
    utilityMarkings: [],
    locateTickets: [],
    plan: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export interface RaCoverage {
  observation: LogCompleteness;
  geo: { quality: GeoQuality; line: string };
  customerFieldsRecorded: number;
  customerFieldsTotal: number;
  estimateCount: number;
  arSessionCount: number;
  /** Total video / keyframe / depth refs across every session. */
  mediaCount: number;
  /** Sessions filmed over a neighbour's line with no consent written down. */
  consentGaps: number;
  /** Remembered Miss Utility markings. Never a locate — see utilityMarkings.ts. */
  utilityMarkingCount: number;
  locateTicketCount: number;
  hasPlan: boolean;
  /** One line for the admin surface. Counts only — safe to display anywhere. */
  line: string;
}

const CUSTOMER_FIELDS: Array<keyof CustomerContext> = [
  'contactInstructions', 'accessWindowNotes', 'callerIsOwner', 'ownerNameOnFile',
  'siteEntryNotes', 'petsOnSite', 'statedConcern', 'freeNotes',
];

/**
 * How full this record is. The point of surfacing it is to make the gaps
 * naggable — Mike's ask is maximum logging, and the only reliable way to get
 * a form filled in is to show what is still empty every time it opens.
 *
 * Everything returned is a COUNT. This is safe to render, log, or put in a
 * report; nothing in it can leak a customer.
 */
export function raCoverage(ra: RiskAssessment): RaCoverage {
  const obs = logCompleteness(ra.observation);
  const geo = geoQuality(ra.geo);
  const customerRecorded = CUSTOMER_FIELDS.filter((k) => {
    const v = ra.customer[k];
    return v !== null && !(typeof v === 'string' && v.trim() === '');
  }).length;
  const standings = ra.arSessions.map(arSessionStanding);
  const mediaCount = standings.reduce((n, s) => n + s.mediaCount, 0);
  const consentGaps = standings.filter((s) => s.consentNeedsAttention).length;
  return {
    observation: obs,
    geo,
    customerFieldsRecorded: customerRecorded,
    customerFieldsTotal: CUSTOMER_FIELDS.length,
    estimateCount: ra.estimates.length,
    arSessionCount: ra.arSessions.length,
    mediaCount,
    consentGaps,
    utilityMarkingCount: ra.utilityMarkings.length,
    locateTicketCount: ra.locateTickets.length,
    hasPlan: ra.plan !== null,
    line:
      `tree log ${obs.recorded}/${obs.total} · customer ${customerRecorded}/${CUSTOMER_FIELDS.length} · ` +
      `geo ${geo.quality} · AR ${ra.arSessions.length} run(s), ${mediaCount} file(s) · ` +
      `utility marks ${ra.utilityMarkings.length} (remembered, not a locate) · ` +
      `estimates ${ra.estimates.length} · plan ${ra.plan ? 'on file' : 'none'}` +
      (consentGaps > 0 ? ` · ${consentGaps} filming consent gap(s)` : ''),
  };
}

/**
 * §4.3 — the ONLY sanctioned way to mention an RA in a log line or a report.
 *
 * The struct above is deliberately full of customer detail because Mike wants
 * it captured. That makes it exactly the thing that must never be printed.
 * Ids and counts, nothing else, and no branch of this function can reach a
 * name, a phone, an address, or a note.
 */
export function raLogLine(ra: RiskAssessment): string {
  const c = raCoverage(ra);
  return `ra=${ra.id} tree=${ra.treeId} property=${ra.propertyId} ` +
    `obs=${c.observation.recorded}/${c.observation.total} cust=${c.customerFieldsRecorded}/${c.customerFieldsTotal} ` +
    `geo=${c.geo.quality} ar=${c.arSessionCount} media=${c.mediaCount} consentGaps=${c.consentGaps} ` +
    `utilMarks=${c.utilityMarkingCount} tickets=${c.locateTicketCount} ` +
    `est=${c.estimateCount} plan=${c.hasPlan ? 'yes' : 'no'}`;
}

/**
 * Structural assertion, the sibling of assertNeverClear() and
 * assertFlagsNeverClear(). Proves an estimate is never presented as a plan.
 * Call it before rendering anything that carries an estimate.
 */
const PLAN_WORDS = /\b(prune plan|the plan|approved cuts|cut(?:ting)? list|make these cuts|cut to this)\b/i;

export function assertEstimateIsNotAPlan(summary: EstimateSummary): void {
  if (summary.disclaimer !== ESTIMATE_DISCLAIMER) {
    throw new Error('the estimate disclaimer cannot be altered or omitted');
  }
  if (PLAN_WORDS.test(summary.headline)) {
    throw new Error(`a rough estimate headline must not read as a plan: ${summary.headline}`);
  }
  if (!summary.readable && summary.limbCount !== null) {
    throw new Error('an unreadable estimate cannot report a limb count');
  }
}
