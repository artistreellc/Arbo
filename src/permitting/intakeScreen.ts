// Intake-time permit screening (brief §6B.1 step 1: "Screen EVERY property at
// intake/estimate"). The moment an address is captured — by the receptionist,
// a web form, any channel — the CBPA/RPA + overlay screen runs and the result
// rides the lead from first contact, so nothing gets quoted or scheduled on a
// protected parcel without the flag already on file.
//
// TWO HONESTY RULES (the §1B graceful-degradation rule, same as the fake-ETA ban):
//   1. NO_OVERLAY_VERIFY means "we checked the GIS layers and found nothing."
//      If the GIS provider is missing or fails, the screen did NOT run — the
//      outcome is PENDING, never a fabricated no-overlay result. ARBOR never
//      bluffs (§3.18); a fake "no overlay" is a quiet Circle Drive.
//   2. The screen is auxiliary to lead capture: a screening or persistence
//      failure must NEVER lose the lead (§3.21 — the unanswered call is the
//      biggest leak; a lead lost to a GIS hiccup is the same leak). Failures
//      degrade to PENDING with the reason named, and capture continues.
//
// Customer-facing rule: nothing here is spoken to the caller. The screen is
// Mike's flag. Any customer mention of permits stays within the guardrails
// (no legal determinations over the phone — §3.1 philosophy).

import type { ServiceCity } from '../lib/address.js';
import { screenProperty, assertNeverClear, type GisProvider, type ScreenInput, type ScreenResult } from './screening.js';
import { screenToPermitRecord, type PermitRecordInput } from './permitRecord.js';

export interface IntakeScreenParams {
  propertyId: string;
  city: ServiceCity;
  address: string;
  /** The lead's qualification JSON (shape from toQualificationJson()). */
  qualification: Record<string, unknown>;
}

/**
 * The screen either RAN (result + persistable record) or is PENDING (with the
 * reason). There is deliberately no "skipped/clear" arm — a property with a
 * pending screen still needs one before quote or cut.
 */
export type IntakeScreenOutcome =
  | { kind: 'screened'; screen: ScreenResult; record: PermitRecordInput; permitId?: string }
  | { kind: 'pending'; reason: string };

/** Compact summary that rides the lead capture result / alert to Mike. */
export interface PermitScreenSummary {
  screened: boolean;
  status?: ScreenResult['status'];
  inRpa?: boolean;
  headline?: string;
  pendingReason?: string;
}

/**
 * Derive the screen input from what qualification captured. Conservative where
 * the answer is fuzzy: an unknown / "not sure" job type is treated as a
 * potential removal, so a CBPA hit screens as the louder PERMIT_LIKELY rather
 * than the softer REVIEW_NEEDED. (An explicit trim/prune/stump/cleanup is not.)
 */
export function deriveScreenInput(params: IntakeScreenParams): ScreenInput {
  const q = params.qualification;
  const jobType = typeof q['jobType'] === 'string' ? (q['jobType'] as string) : '';

  let isRemoval: boolean;
  if (/\b(remov|take[ -]?down|takedown|cut[ -]?down|fell)\w*/i.test(jobType)) {
    isRemoval = true;
  } else if (/\b(trim|prun|stump|grind|clean|cleanup|haul)\w*/i.test(jobType)) {
    isRemoval = false;
  } else {
    isRemoval = true; // unknown / "not sure" → screen at removal strictness
  }

  return {
    city: params.city,
    address: params.address,
    isRemoval,
    nearPowerLines: q['powerLineRedFlag'] === true,
  };
}

/**
 * Run the intake screen and persist the permit record. `persist` is injected
 * (createPermit in prod) so the orchestration is fully testable offline.
 * Every failure path returns PENDING — this function never throws, because the
 * caller is mid-lead-capture and the lead always survives.
 */
export async function runIntakeScreen(
  params: IntakeScreenParams,
  gis: GisProvider | null | undefined,
  persist: (record: PermitRecordInput) => Promise<{ id: string }>,
): Promise<IntakeScreenOutcome> {
  if (!gis) {
    return {
      kind: 'pending',
      reason: 'GIS provider not configured — CBPA/RPA screen has NOT run; run it before quoting or scheduling.',
    };
  }

  let screen: ScreenResult;
  try {
    screen = await screenProperty(deriveScreenInput(params), gis);
    assertNeverClear(screen); // structural invariant, checked on every live path
  } catch (err) {
    // GIS down ≠ "no overlay". Degrade honestly (§1B), keep the lead.
    return {
      kind: 'pending',
      reason: `GIS screen failed (${err instanceof Error ? err.message : 'error'}) — screen has NOT run; retry before quoting or scheduling.`,
    };
  }

  const record = screenToPermitRecord(screen, { propertyId: params.propertyId });
  try {
    const { id } = await persist(record);
    return { kind: 'screened', screen, record, permitId: id };
  } catch (err) {
    // Screen ran but didn't persist — surface that truthfully so it gets re-run.
    return {
      kind: 'pending',
      reason: `Screen ran (${screen.status}) but could not be saved (${err instanceof Error ? err.message : 'error'}) — re-run before quoting or scheduling.`,
    };
  }
}

/** Flatten an outcome into the summary that rides the lead. */
export function summarize(outcome: IntakeScreenOutcome): PermitScreenSummary {
  if (outcome.kind === 'screened') {
    return {
      screened: true,
      status: outcome.screen.status,
      inRpa: outcome.record.inRpa,
      headline: outcome.screen.headline,
    };
  }
  return { screened: false, pendingReason: outcome.reason };
}
