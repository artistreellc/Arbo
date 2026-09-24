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
// The ESTIMATE PREP PACK (Mike, 2026-09-24: "Do all 3 now") — know things
// about the property BEFORE driving there. Glues together what already
// exists: the CBPA/RPA permit screen, the work-ZIP drive heuristic, and the
// caller's own words about access — into one sheet per estimate.
//
// What this is NOT, on purpose: it never measures a tree, never prices
// anything, and never books anything. It prepares Mike; it decides nothing.
//
// §1B throughout: every section it cannot fill is NAMED — a screen that
// did not run says so, an unknown drive time says why. And the permit
// vocabulary is the law's: PERMIT LIKELY / REVIEW NEEDED / NO OVERLAY —
// VERIFY. `assertNeverClear` runs on the live path, same as intake.

import {
  screenProperty,
  assertNeverClear,
  type GisProvider,
  type ScreenResult,
} from '../permitting/screening.js';
import { resolveServiceCity, type ServiceCity } from '../lib/address.js';
import { getLiveWorkZip, getTodayWorkZip } from '../reception/routingHint.js';

export type PrepJobType = 'removal' | 'pruning' | 'stump' | 'land_clearing' | 'other';

export interface EstimatePrepInput {
  address: string;
  city: string;
  zip?: string;
  jobType?: PrepJobType;
  treeCount?: number;
  nearPowerLines?: boolean;
  /** The caller's own words about access — echoed verbatim, never judged. */
  accessNotes?: string;
}

/** Same heuristic family as the route planner: honest, coarse, and labeled. */
const DRIVE_SAME_ZIP_MIN = 10;
const DRIVE_SAME_PREFIX_MIN = 15;
const DRIVE_CROSS_PREFIX_MIN = 25;

export const MISS_UTILITY_LINE =
  'Ask: has the property been marked? If not, they should schedule Miss Utility (811) before any grinding or digging.';

export interface EstimatePrepSheet {
  address: string;
  city: ServiceCity | null;
  /** Set when the city did not resolve — flagged, never silently binned. */
  cityNote?: string;
  jobType: PrepJobType;
  permit:
    | {
        ran: true;
        status: ScreenResult['status'];
        headline: string;
        overlays: { kind: string; meaning: string }[];
        mitigation?: string;
        scaleEscalation?: string;
        powerLine?: string;
      }
    | { ran: false; reason: string };
  drive:
    | { fromZip: string; minutes: number; mode: 'zip_estimate'; note: string }
    | { fromZip: null; reason: string };
  missUtility: { flagged: boolean; note: string };
  access: { notes: string | null; note: string };
  preparedAtIso: string;
}

function driveEstimate(workZip: string | null, propertyZip: string | undefined) {
  if (!workZip) {
    return {
      fromZip: null as null,
      reason: "No work ZIP set today — set today's work ZIP in Settings for a drive estimate.",
    };
  }
  if (!propertyZip) {
    return { fromZip: null as null, reason: 'No ZIP for the property — drive time unknown, not zero.' };
  }
  const minutes =
    workZip === propertyZip
      ? DRIVE_SAME_ZIP_MIN
      : workZip.slice(0, 3) === propertyZip.slice(0, 3)
        ? DRIVE_SAME_PREFIX_MIN
        : DRIVE_CROSS_PREFIX_MIN;
  return {
    fromZip: workZip,
    minutes,
    mode: 'zip_estimate' as const,
    note: 'ZIP-based estimate — the route planner on the Calendar tab gives live-traffic numbers.',
  };
}

/**
 * Build the sheet. GIS is injected (null = screen honestly not run), the
 * clock is injected for the live-ZIP freshness window — same testability
 * discipline as everything else here.
 */
export async function buildEstimatePrep(
  input: EstimatePrepInput,
  gis: GisProvider | null,
  now: Date = new Date(),
): Promise<EstimatePrepSheet> {
  const jobType: PrepJobType = input.jobType ?? 'other';
  const city = resolveServiceCity(input.city);

  // ── Permit screen — reusing the intake screen's exact honesty contract ──
  let permit: EstimatePrepSheet['permit'];
  if (city === null) {
    permit = {
      ran: false,
      reason: `City "${input.city}" is not one of the four service cities — no screening ruleset applies. Flagged for Mike, not silently dropped.`,
    };
  } else if (!gis) {
    permit = {
      ran: false,
      reason: 'GIS provider not configured — CBPA/RPA screen has NOT run; run it before quoting or scheduling.',
    };
  } else {
    try {
      const screen = await screenProperty(
        {
          city,
          address: input.address,
          // Land clearing disturbs like a removal; the screen's removal
          // question is "does vegetation come out", and there it does.
          isRemoval: jobType === 'removal' || jobType === 'land_clearing',
          ...(input.treeCount !== undefined ? { treeCount: input.treeCount } : {}),
          ...(input.nearPowerLines !== undefined ? { nearPowerLines: input.nearPowerLines } : {}),
        },
        gis,
      );
      assertNeverClear(screen);
      permit = {
        ran: true,
        status: screen.status,
        headline: screen.headline,
        overlays: screen.overlays.map((o) => ({ kind: o.kind, meaning: o.meaning })),
        ...(screen.mitigation
          ? {
              mitigation:
                screen.mitigation.note +
                (screen.mitigation.estimatedReplacements !== undefined
                  ? ` (~${screen.mitigation.estimatedReplacements} replacements for this job)`
                  : ''),
            }
          : {}),
        ...(screen.scaleEscalation ? { scaleEscalation: screen.scaleEscalation } : {}),
        ...(screen.powerLine ? { powerLine: screen.powerLine.instruction } : {}),
      };
    } catch (err) {
      // GIS down ≠ "no overlay" (§1B). Same wording family as intakeScreen.
      permit = {
        ran: false,
        reason: `GIS screen failed (${err instanceof Error ? err.message : 'error'}) — screen has NOT run; retry before quoting or scheduling.`,
      };
    }
  }

  const workZip = getLiveWorkZip(now.getTime()) ?? getTodayWorkZip();

  const missFlagged = jobType === 'removal' || jobType === 'stump' || jobType === 'land_clearing';

  return {
    address: input.address,
    city,
    ...(city === null ? { cityNote: `Caller said "${input.city}" — outside the focus cities.` } : {}),
    jobType,
    permit,
    drive: driveEstimate(workZip, input.zip),
    missUtility: missFlagged
      ? { flagged: true, note: MISS_UTILITY_LINE }
      : { flagged: false, note: 'Marking not typically needed for this job type — flag it if the plan changes.' },
    access: {
      notes: input.accessNotes?.trim() ? input.accessNotes.trim() : null,
      note: input.accessNotes?.trim()
        ? "The caller's own words — verify on site."
        : 'No access notes captured on the call. Worth asking before the drive.',
    },
    preparedAtIso: now.toISOString(),
  };
}
