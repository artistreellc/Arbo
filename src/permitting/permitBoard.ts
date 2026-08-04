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
// THE PERMITTING BOARD — the surface that was missing (§6B, §9).
//
// Until now permits existed in this codebase as a BADGE. The screen ran, the
// record persisted, the crew gate worked — but there was nowhere Mike could
// stand and see "here is every property with a permit question open, worst
// first, and here is the next move on each one". A badge on a lead row is not
// a work board.
//
// This file is that board, as a pure function over rows. No I/O, no fetch, no
// clock of its own — the caller passes `todayEt`. That is the same shape as
// screening.ts and certifications.ts, and it is why this is testable offline.
//
// ─────────────────────────────────────────────────────────────────────────
// THE RULES IT INHERITS, NONE OF WHICH IT MAY SOFTEN
// ─────────────────────────────────────────────────────────────────────────
//   * §6B.3 — nothing here ever says "clear". The board reports what is open,
//     what is blocked, and what a human still has to verify. Every headline
//     goes through assertNeverClear-style checking before it can be rendered.
//   * A MISSING SCREEN IS NOT A PASS. `crewMayStartForProperty(null)` already
//     encodes this: no record means the screen never ran, and that is the
//     LOUDEST row on the board, not an absent one. This is §1B — a property
//     nobody screened must not look like a property with nothing to do.
//   * The lifecycle only moves by a human. This file sorts and describes; it
//     never advances a status, and there is no function here that could.
//   * A stale city ruleset is surfaced, not hidden. Cities change their rules
//     and a screen run against a two-year-old ruleset is a weaker fact than a
//     fresh one — so the age rides on the row.

import type { ServiceCity } from '../lib/address.js';
import { rulesetFor } from './cities.js';
import type { PermitLifecycle } from './permitRecord.js';
import { requiresClearance, crewMayStartForProperty } from './permitRecord.js';
import { FORBIDDEN_CLEAR, type OverlayHit, type ScreenStatus } from './screening.js';

/**
 * One property's permit track as stored. Mirrors the `permit` table (0003)
 * plus the property's address for display — nothing derived, nothing invented.
 *
 * `screen` is NULL when no screen has ever run on the property. That is a real
 * and common state (GIS down at intake, a property that predates the engine)
 * and it is the single most important case this board handles correctly.
 */
export interface PermitTrackRow {
  permitId: string | null;
  propertyId: string;
  /** Display only. Never logged — §4.3. */
  addressLabel: string;
  city: ServiceCity;
  jobId: string | null;
  /** Null when the screen never ran on this property. */
  screen: {
    status: ScreenStatus;
    inRpa: boolean;
    overlays: OverlayHit[];
    ranAt: string;
    /** The city ruleset date at screen time — how current the rules were. */
    rulesetLastVerified: string | null;
  } | null;
  status: PermitLifecycle;
  formRef: string | null;
  /** When work is on the book for this property, if it is. */
  scheduledFor: string | null;
}

/**
 * Board buckets, in the order they matter. The ordering IS the product: a
 * tree service owner opening this at 6am should read down and stop at the
 * first thing that can bite him today.
 */
export type PermitBucket =
  | 'blocked_scheduled'   // work is booked and the crew cannot legally start
  | 'never_screened'      // nobody ran the screen — unknown, not fine
  | 'permit_likely'       // screen says a permit is probably required
  | 'review_needed'       // an overlay applies; a human has to look
  | 'applied_waiting'     // filed with the city, waiting on them
  | 'resolved'            // approved, or verified not-required by a human
  | 'no_overlay_verify';  // screen found nothing — STILL not a clearance

const BUCKET_ORDER: PermitBucket[] = [
  'blocked_scheduled', 'never_screened', 'permit_likely', 'review_needed',
  'applied_waiting', 'no_overlay_verify', 'resolved',
];

export const BUCKET_LABEL: Record<PermitBucket, string> = {
  blocked_scheduled: 'Booked but BLOCKED',
  never_screened: 'Never screened',
  permit_likely: 'Permit likely',
  review_needed: 'Review needed',
  applied_waiting: 'Filed — waiting on the city',
  no_overlay_verify: 'No overlay found — still verify',
  resolved: 'Resolved by a human',
};

/** How stale a city ruleset is allowed to get before the board says so. */
export const RULESET_STALE_DAYS = 180;

export interface PermitBoardRow {
  permitId: string | null;
  propertyId: string;
  addressLabel: string;
  city: ServiceCity;
  bucket: PermitBucket;
  status: PermitLifecycle;
  /** What the screen said, or null when it never ran. */
  screenStatus: ScreenStatus | null;
  /** Plain-English "what this is". Never a clearance. */
  headline: string;
  /** The single next move, in the imperative. */
  nextStep: string;
  /** Overlay names that produced the flag. Empty is meaningful only with a screen. */
  overlays: string[];
  /** True when a crew is booked and the gate says they may not start. */
  blocksScheduledWork: boolean;
  scheduledFor: string | null;
  /** Set when the ruleset behind this screen has gone stale. */
  staleRulesetNote: string | null;
  /**
   * Where to call. Null when the city config carries no contact. This is a
   * CITY OFFICE, not a customer — safe to display, unlike anything in the
   * customer context (§4.3).
   */
  cityContact: { name: string; role: string; email: string; phone?: string } | null;
}

function bucketFor(row: PermitTrackRow): PermitBucket {
  // Resolved first: a human already answered this one, and nothing below
  // should drag it back onto the board.
  if (row.status === 'approved' || row.status === 'not_required_verified') return 'resolved';

  if (row.screen === null) return 'never_screened';

  const gated = requiresClearance({ screenStatus: row.screen.status, inRpa: row.screen.inRpa });
  // The loudest bucket on the board: someone put it on the schedule and the
  // permit question is still open. That is a crew turning up to a job they
  // are not allowed to start.
  if (gated && row.scheduledFor) return 'blocked_scheduled';

  if (row.status === 'applied') return 'applied_waiting';
  if (row.screen.status === 'PERMIT_LIKELY') return 'permit_likely';
  if (row.screen.status === 'REVIEW_NEEDED') return 'review_needed';
  return 'no_overlay_verify';
}

function daysSince(iso: string, todayEt: string): number | null {
  const a = Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  const b = Date.parse(`${todayEt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function headlineFor(bucket: PermitBucket, row: PermitTrackRow): string {
  switch (bucket) {
    case 'blocked_scheduled':
      return `Work is on the book${row.scheduledFor ? ` for ${row.scheduledFor}` : ''} and the permit question is still open — the crew is BLOCKED from starting (§6B.3).`;
    case 'never_screened':
      // §1B in one sentence. This is the row that must never read as quiet.
      return 'No CBPA/RPA screen has ever run on this address. That is not "nothing applies" — it means nobody has looked.';
    case 'permit_likely':
      return `PERMIT LIKELY REQUIRED — verify with the City of ${row.city} before quoting or cutting.`;
    case 'review_needed':
      return `REVIEW NEEDED — an overlay may apply; verify with the City of ${row.city} before the job.`;
    case 'applied_waiting':
      return `Filed with the City of ${row.city}${row.formRef ? ` as ${row.formRef}` : ''} — waiting on them.`;
    case 'no_overlay_verify':
      return `NO OVERLAY FOUND — still VERIFY WITH CITY (${row.city}); GIS can miss parcel edges.`;
    case 'resolved':
      return row.status === 'approved'
        ? `Approved by the City of ${row.city}.`
        : `Confirmed not required — a human verified that with the City of ${row.city}.`;
  }
}

function nextStepFor(bucket: PermitBucket, row: PermitTrackRow): string {
  switch (bucket) {
    case 'blocked_scheduled':
      return 'Resolve the permit or move the job. Do not send a crew.';
    case 'never_screened':
      return 'Run the screen on this address.';
    case 'permit_likely':
      return `Call ${row.city} and start the application.`;
    case 'review_needed':
      return `Call ${row.city} and get a human answer on the overlay.`;
    case 'applied_waiting':
      return `Chase ${row.city} for a decision.`;
    case 'no_overlay_verify':
      return `Confirm with ${row.city} before the crew goes — the screen is an aid, not the city's answer.`;
    case 'resolved':
      return 'Nothing outstanding.';
  }
}

export function toBoardRow(row: PermitTrackRow, todayEt: string): PermitBoardRow {
  const bucket = bucketFor(row);
  const ruleset = rulesetFor(row.city);
  const contact = ruleset.contacts[0] ?? null;

  // Staleness rides on the row rather than being silently ignored. A screen
  // run against rules nobody has re-checked in six months is a weaker fact,
  // and the person calling the city deserves to know that before they lean
  // on it. Only meaningful when a screen actually ran.
  let staleRulesetNote: string | null = null;
  const verifiedOn = row.screen?.rulesetLastVerified ?? null;
  if (row.screen) {
    if (!verifiedOn) {
      staleRulesetNote = 'This screen did not record which version of the city rules it used.';
    } else {
      const age = daysSince(verifiedOn, todayEt);
      if (age !== null && age > RULESET_STALE_DAYS) {
        staleRulesetNote = `The ${row.city} rules behind this screen were last checked ${age} days ago — re-check them before relying on it.`;
      }
    }
  }

  return {
    permitId: row.permitId,
    propertyId: row.propertyId,
    addressLabel: row.addressLabel,
    city: row.city,
    bucket,
    status: row.status,
    screenStatus: row.screen?.status ?? null,
    headline: headlineFor(bucket, row),
    nextStep: nextStepFor(bucket, row),
    overlays: row.screen?.overlays.map((o) => o.layer) ?? [],
    blocksScheduledWork: bucket === 'blocked_scheduled',
    scheduledFor: row.scheduledFor,
    staleRulesetNote,
    cityContact: contact
      ? { name: contact.name, role: contact.role, email: contact.email, ...(contact.phone ? { phone: contact.phone } : {}) }
      : null,
  };
}

export interface PermitBoard {
  rows: PermitBoardRow[];
  counts: Record<PermitBucket, number>;
  /** Jobs booked that a crew may not legally start. The number that matters. */
  blockedCount: number;
  /** Properties with no screen at all — the §1B hole, counted. */
  neverScreenedCount: number;
  /** One line for the top of the tab. Counts only, safe to log. */
  summary: string;
}

/**
 * Build the board. Sorted by bucket, then by whichever date makes that bucket
 * urgent — a blocked job sorts by how soon the crew turns up, everything else
 * by how long it has been sitting.
 */
export function buildPermitBoard(rows: PermitTrackRow[], todayEt: string): PermitBoard {
  const board = rows.map((r) => toBoardRow(r, todayEt));

  board.sort((a, b) => {
    const byBucket = BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket);
    if (byBucket !== 0) return byBucket;
    // Within the blocked bucket, soonest crew arrival first.
    if (a.bucket === 'blocked_scheduled') {
      return String(a.scheduledFor ?? '').localeCompare(String(b.scheduledFor ?? ''));
    }
    return a.addressLabel.localeCompare(b.addressLabel);
  });

  const counts = BUCKET_ORDER.reduce((acc, b) => {
    acc[b] = board.filter((r) => r.bucket === b).length;
    return acc;
  }, {} as Record<PermitBucket, number>);

  const blockedCount = counts.blocked_scheduled;
  const neverScreenedCount = counts.never_screened;

  return {
    rows: board,
    counts,
    blockedCount,
    neverScreenedCount,
    summary:
      `${board.length} propert${board.length === 1 ? 'y' : 'ies'} on the permit board · ` +
      `${blockedCount} booked-but-blocked · ${neverScreenedCount} never screened · ` +
      `${counts.permit_likely} permit likely · ${counts.review_needed} review needed · ` +
      `${counts.applied_waiting} with the city · ${counts.resolved} resolved`,
  };
}

/**
 * The crew-facing answer for one property, reusing the existing gate rather
 * than re-deriving it. Exported so the crew door and this board cannot drift
 * apart — there is one implementation of "may they start", in permitRecord.ts,
 * and both callers go through it.
 */
export function boardClearance(row: PermitTrackRow): { mayStart: boolean; reason: string } {
  return crewMayStartForProperty(
    row.screen ? { screenStatus: row.screen.status, inRpa: row.screen.inRpa, status: row.status } : null,
  );
}

/**
 * Structural assertion — the board's version of assertNeverClear(). No row on
 * a permitting screen may read as permission. Throws; call before rendering.
 */
export function assertBoardNeverClear(board: PermitBoard): void {
  for (const r of board.rows) {
    for (const line of [r.headline, r.nextStep]) {
      if (FORBIDDEN_CLEAR.test(line)) {
        throw new Error(`permit board line implied a "clear" — forbidden (§6B.3): ${r.propertyId}: ${line}`);
      }
    }
    // The two buckets that look quiet are the two that must still point at a
    // human. 'resolved' is exempt: a human already did the verifying, and
    // telling them to verify again would make the board noise.
    if ((r.bucket === 'no_overlay_verify' || r.bucket === 'never_screened') &&
        !/verif|screen|nobody has looked/i.test(`${r.headline} ${r.nextStep}`)) {
      throw new Error(`a quiet-looking permit row must still point at a human: ${r.propertyId}`);
    }
  }
}
