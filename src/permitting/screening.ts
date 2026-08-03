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
// CBPA/RPA + overlay screening engine (brief §6B, §5A #30, Phase 4).
//
// THE HARD GUARDRAIL (§6B.3, §12): ARBOR is a screening AID, not the city's
// determination. GIS can be wrong at parcel edges and overlays change, so the
// engine is STRUCTURALLY INCAPABLE of telling Mike "you're clear, no permit
// needed." Its three outputs are the ONLY outputs — and the lowest of them,
// NO_OVERLAY_VERIFY, still says "verify with the city." A false "clear" is
// exactly what produced the real 8562 Circle Drive violation this engine exists
// to prevent.
//
// Mirrors the receptionist output guard: the classification lives in code, over
// an INJECTED GIS provider, so it is fully testable offline. Live city GIS
// wiring lands at deploy (see DECISIONS) — the same pattern as Vapi/Twilio and
// the Drive API.

import type { ServiceCity } from '../lib/address.js';
import { rulesetFor, type CityRuleset, type MitigationRule } from './cities.js';

// The ONLY three statuses. There is deliberately no CLEAR / NONE / OK value —
// the type itself makes a bare "clear" unrepresentable.
export type ScreenStatus = 'PERMIT_LIKELY' | 'REVIEW_NEEDED' | 'NO_OVERLAY_VERIFY';

export type OverlayKind =
  | 'CBPA_RPA' // Chesapeake Bay Preservation Area / Resource Protection Area — direct hit
  | 'CBPA_RPA_PROXIMITY' // RPA within the proximity probe (D37) — parcel may reach the buffer
  | 'FEMA_FLOOD' // Special Flood Hazard Area (zones A*/V*)
  | 'LOCAL_FLOODPLAIN' // city floodplain ordinance / land-disturbance trigger
  | 'NORFOLK_CRO' // Norfolk Coastal Resilience Overlay (+ URO)
  | 'CITY_TREE_ORDINANCE' // e.g. Norfolk Ch.45 protected/street trees
  | 'OTHER_OVERLAY';

export interface OverlayHit {
  kind: OverlayKind;
  /** The GIS layer / source that produced the hit. */
  layer: string;
  /** Plain-English "what it means for your job" (§6B.4c: tree-guy language). */
  meaning: string;
}

/** What the GIS layer(s) return for an address. Injected → testable offline. */
export interface GisProvider {
  overlaysFor(input: ScreenInput): Promise<OverlayHit[]>;
}

export interface ScreenInput {
  city: ServiceCity;
  /** Normalized address (feeds geocode + GIS). */
  address: string;
  /** Is the job a tree removal? Removals in the RPA are what trigger permits. */
  isRemoval: boolean;
  /** Trees to be removed, if known — drives Chesapeake-style scale tiers. */
  treeCount?: number;
  /** Set at intake (§3.3): tree on/near power lines. Utility, not city, problem. */
  nearPowerLines?: boolean;
}

export interface MitigationNote extends MitigationRule {
  /** Estimated replacements for this job, if treeCount is known. */
  estimatedReplacements?: number;
}

export interface ScreenResult {
  status: ScreenStatus;
  /** ALWAYS true. No screen result is ever a final "clear". */
  verifyWithCity: true;
  /** Human headline — provably contains "verify", never "clear"/"no permit needed". */
  headline: string;
  overlays: OverlayHit[];
  /** Present when a removal screens PERMIT_LIKELY inside CBPA/RPA. */
  mitigation?: MitigationNote;
  /** Utility routing when the job is power-line involved (§6B.4d). */
  powerLine?: { flagged: true; instruction: string };
  /** City escalation tier note (e.g. Chesapeake site-visit / Board hearing). */
  scaleEscalation?: string;
  ruleset: CityRuleset;
}

const POWER_LINE_INSTRUCTION =
  'POWER-LINE INVOLVED — do NOT promise the cut. Virginia High Voltage Safety Act: ' +
  'contact the utility first; only OSHA-qualified line-clearance crews may work within 10 ft of an energized line.';

/**
 * Screen a property. The result is never a bare "clear": with zero overlays the
 * status is NO_OVERLAY_VERIFY ("verify with city"), and any CBPA/RPA removal is
 * PERMIT_LIKELY. Pure over the injected GIS provider.
 */
export async function screenProperty(input: ScreenInput, gis: GisProvider): Promise<ScreenResult> {
  const ruleset = rulesetFor(input.city);
  const overlays = await gis.overlaysFor(input);

  const hasCbpaRpa = overlays.some((o) => o.kind === 'CBPA_RPA');
  const hasAnyOverlay = overlays.length > 0;

  // Power-line involvement is always at least a review-level flag (§6B.4d).
  const powerLine = input.nearPowerLines ? ({ flagged: true, instruction: POWER_LINE_INSTRUCTION } as const) : undefined;

  let status: ScreenStatus;
  if (hasCbpaRpa && input.isRemoval) {
    status = 'PERMIT_LIKELY';
  } else if (hasAnyOverlay || powerLine) {
    // An overlay is present (or a utility flag) but it isn't a CBPA/RPA removal:
    // still needs a human look before the quote or the cut.
    status = 'REVIEW_NEEDED';
  } else {
    // Nothing found — the SAFE floor, never a clear.
    status = 'NO_OVERLAY_VERIFY';
  }

  const result: ScreenResult = {
    status,
    verifyWithCity: true,
    headline: headlineFor(status, input.city),
    overlays,
    ruleset,
    ...(powerLine ? { powerLine } : {}),
  };

  if (status === 'PERMIT_LIKELY' && ruleset.mitigation) {
    const m = ruleset.mitigation;
    result.mitigation = {
      ...m,
      ...(input.treeCount != null
        ? { estimatedReplacements: Math.max(m.minReplacements, input.treeCount * m.ratioPerRemoval) }
        : {}),
    };
  }

  const tier = scaleTierFor(ruleset, input.treeCount);
  if (tier) result.scaleEscalation = tier;

  return result;
}

function headlineFor(status: ScreenStatus, city: ServiceCity): string {
  switch (status) {
    case 'PERMIT_LIKELY':
      return `PERMIT LIKELY REQUIRED — verify with the City of ${city} before quoting or cutting.`;
    case 'REVIEW_NEEDED':
      return `REVIEW NEEDED — an overlay may apply; verify with the City of ${city} before the job.`;
    case 'NO_OVERLAY_VERIFY':
      return `NO OVERLAY FOUND — still VERIFY WITH CITY (${city}); GIS can miss parcel edges.`;
  }
}

function scaleTierFor(ruleset: CityRuleset, treeCount?: number): string | undefined {
  if (treeCount == null || !ruleset.scaleTiers?.length) return undefined;
  // Highest tier whose threshold the job meets.
  const matched = ruleset.scaleTiers
    .filter((t) => treeCount >= t.minTrees)
    .sort((a, b) => b.minTrees - a.minTrees)[0];
  return matched?.escalation;
}

/**
 * Structural assertion — the analogue of the receptionist output guard. Proves a
 * result can never leak a bare "clear". Throws if the invariant is ever violated;
 * safe to call before surfacing any screen result to Mike or the crew.
 */
const FORBIDDEN_CLEAR = /\b(you'?re clear|no permit needed|all clear|cleared|good to (?:go|cut)|no permit required)\b/i;

export function assertNeverClear(result: ScreenResult): void {
  if (result.verifyWithCity !== true) {
    throw new Error('screen result must always require city verification');
  }
  if (FORBIDDEN_CLEAR.test(result.headline)) {
    throw new Error(`screen headline implied a "clear" — forbidden (§6B.3): ${result.headline}`);
  }
  if (!/verify/i.test(result.headline)) {
    throw new Error(`screen headline must direct the user to verify: ${result.headline}`);
  }
}
