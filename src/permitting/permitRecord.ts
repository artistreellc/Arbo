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
// Bridge from a screen result to a persistable Permit record, plus the crew
// clearance gate (brief §6B.3, §7). Pure and offline-testable: the screening
// engine decides IF a permit is likely; this decides what gets stored and
// whether a crew may start.
//
// THE GATE (§6B.3): "surface it on the job so no crew starts protected work
// without clearance." A flagged job (PERMIT_LIKELY / REVIEW_NEEDED, or anything
// in the RPA) is BLOCKED until a human moves the permit lifecycle to 'approved'
// or 'not_required_verified' — the latter reachable only after a real check with
// the city, never inferred from the screen (mirrors the never-say-clear rule).

import type { ScreenResult, ScreenStatus } from './screening.js';

export type PermitLifecycle = 'needed' | 'applied' | 'approved' | 'not_required_verified';

export interface PermitRecordInput {
  propertyId: string;
  jobId?: string;
  city: ScreenResult['ruleset']['city'];
  screenStatus: ScreenStatus;
  inRpa: boolean;
  overlaySource: ScreenResult['overlays'];
  rulesetLastVerified: string; // the per-city config date at screen time
  status: PermitLifecycle;
  cityContact: ScreenResult['ruleset']['contacts'][number] | null;
}

/**
 * Turn a screen result into the record to persist. Its lifecycle starts at
 * 'needed' whenever the screen flagged anything, else 'needed' still — a screen
 * NEVER auto-resolves to "not required"; only a human verifying with the city
 * can set that. `inRpa` is derived from a CBPA/RPA overlay hit.
 */
export function screenToPermitRecord(
  screen: ScreenResult,
  ids: { propertyId: string; jobId?: string },
): PermitRecordInput {
  return {
    propertyId: ids.propertyId,
    jobId: ids.jobId,
    city: screen.ruleset.city,
    screenStatus: screen.status,
    inRpa: screen.overlays.some((o) => o.kind === 'CBPA_RPA'),
    overlaySource: screen.overlays,
    rulesetLastVerified: screen.ruleset.lastVerified,
    status: 'needed', // never starts resolved — clearance is a human step
    cityContact: screen.ruleset.contacts[0] ?? null,
  };
}

/** A job is "protected work" (needs clearance before a crew starts) when the */
/** screen flagged a permit/overlay or the parcel is in the RPA. */
export function requiresClearance(p: { screenStatus: ScreenStatus; inRpa: boolean }): boolean {
  return p.inRpa || p.screenStatus === 'PERMIT_LIKELY' || p.screenStatus === 'REVIEW_NEEDED';
}

export interface ClearanceDecision {
  mayStart: boolean;
  reason: string;
}

/**
 * The crew gate. Blocks protected work until the permit lifecycle is resolved by
 * a human ('approved' or the human-verified 'not_required_verified'). A job the
 * screen never flagged isn't gated here — but the screen's advisory "verify with
 * city" still rides on the record.
 */
export function crewMayStart(p: { screenStatus: ScreenStatus; inRpa: boolean; status: PermitLifecycle }): ClearanceDecision {
  if (!requiresClearance(p)) {
    return { mayStart: true, reason: 'No overlay/permit flag on this job (screen advisory still applies).' };
  }
  if (p.status === 'approved') {
    return { mayStart: true, reason: 'Permit approved by the city.' };
  }
  if (p.status === 'not_required_verified') {
    return { mayStart: true, reason: 'Confirmed not required — verified with the city.' };
  }
  return {
    mayStart: false,
    reason: `Protected work: permit status is "${p.status}". Crew is BLOCKED until it is approved or verified not-required with the city (§6B.3).`,
  };
}

/**
 * The gate when all you have is the property's latest permit track — or none.
 * NO SCREEN ON FILE IS NOT CLEARANCE: intake auto-screens every property
 * (§6B.1), so a missing record means the screen never ran (GIS down, pre-ARBOR
 * property, …). The honest floor is BLOCKED until the screen runs — assuming
 * "no record = fine" is exactly the false clear §6B.3 forbids.
 */
export function crewMayStartForProperty(
  latest: { screenStatus: ScreenStatus; inRpa: boolean; status: PermitLifecycle } | null,
): ClearanceDecision {
  if (latest === null) {
    return {
      mayStart: false,
      reason: 'No CBPA/RPA screen on file for this property — run the screen before any crew starts (§6B.1/§6B.3).',
    };
  }
  return crewMayStart(latest);
}
