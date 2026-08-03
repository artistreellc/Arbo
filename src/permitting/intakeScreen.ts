/*
  ═══════════════════════════════════════════════════════════════════════
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
*/
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
