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
