// Follow-up & outreach engine (brief §5A #16–20). Pure and deterministic:
// given the current pipeline state and "now", it returns what's DUE — it never
// sends anything. Every action is a recommendation for Mike (never-autonomous,
// §5B #1); the app surfaces the queue and sending happens only on approval.
//
// The legal gates are enforced HERE in code, not in prose (§4):
//   - consent: no consent on file → the action is suppressed, with the reason
//     named so it shows in review instead of silently vanishing.
//   - suppression list (STOP): suppressed number → suppressed action.
//   - quiet hours (8:00–21:00 America/New_York): actions arising outside the
//     window are scheduled for the next window opening, never "now".
//
// Cadence (§16–20):
//   - estimate_follow_up: every 2 days after an estimate visit until resolved
//     (won, lost, or Mike closes it). The FIRST follow-up carries the proof of
//     insurance (#17 rides along).
//   - review_request: 1 day after a job is completed AND paid, once (#18).
//   - no_show_saver: customer missed the estimate window → same-day save (#20).
//   - Seasonal/storm outreach (#19) keys off the storm flag Phase 7 adds; the
//     action type is reserved here so the queue shape is stable.

import type { LegalConfig } from '../config/legal.schema.js';

export interface EstimateState {
  id: string;
  name?: string;
  phone?: string;
  /** When the estimate visit happened (ISO). Unvisited estimates aren't followed up. */
  visitedAt?: string;
  /** Scheduled window end (ISO) — used for the no-show saver. */
  windowEndsAt?: string;
  /** Customer never showed / wasn't home. */
  noShow?: boolean;
  /** Won (signed), lost, or closed by Mike — stops the cadence. */
  resolved?: boolean;
  /** Last follow-up actually SENT (ISO), if any. */
  lastFollowUpAt?: string;
  /** How many follow-ups have gone out so far. */
  followUpCount?: number;
  consentOnFile?: boolean;
  suppressed?: boolean; // STOP list
}

export interface JobState {
  id: string;
  name?: string;
  phone?: string;
  completedAt?: string;
  paidAt?: string;
  reviewRequestedAt?: string;
  consentOnFile?: boolean;
  suppressed?: boolean;
}

export type FollowUpType = 'estimate_follow_up' | 'review_request' | 'no_show_saver' | 'seasonal_outreach';

export interface FollowUpAction {
  type: FollowUpType;
  targetId: string;
  name?: string;
  /** What to say/do — for Mike's queue, not an auto-send body. */
  note: string;
  /** Earliest legal send time (ISO) — already clamped into quiet hours. */
  scheduledFor: string;
  /** #17: proof of insurance rides the first estimate follow-up. */
  includeProofOfInsurance?: boolean;
  /** ALWAYS true — ARBOR recommends, Mike approves (§5B #1). */
  recommendOnly: true;
}

export interface SuppressedAction {
  type: FollowUpType;
  targetId: string;
  reason: 'no_consent' | 'stop_suppressed';
}

export interface FollowUpQueue {
  due: FollowUpAction[];
  suppressed: SuppressedAction[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const ESTIMATE_FOLLOW_UP_INTERVAL_DAYS = 2;
export const REVIEW_REQUEST_DELAY_DAYS = 1;

/** Hour of day (0–23) in the legal config's timezone. */
function hourIn(tz: string, at: Date): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(at));
}

/**
 * Clamp a moment into the quiet-hours window: inside → unchanged; before the
 * window → same day at opening; after → next day at opening. Approximation is
 * whole-hour steps, which is exact for the 8–21 policy.
 */
export function clampToQuietHours(legal: LegalConfig, at: Date): Date {
  const { timezone, earliestHour, latestHour } = legal.tcpa.quietHours;
  let t = new Date(at);
  for (let i = 0; i < 30; i++) {
    const h = hourIn(timezone, t);
    if (h >= earliestHour && h < latestHour) return t;
    t = new Date(t.getTime() + 60 * 60 * 1000);
    t.setMinutes(0, 0, 0);
  }
  return t; // unreachable with sane config; schema pins 8/21
}

function gate(
  x: { consentOnFile?: boolean; suppressed?: boolean },
  type: FollowUpType,
  targetId: string,
): SuppressedAction | null {
  if (x.suppressed) return { type, targetId, reason: 'stop_suppressed' };
  if (x.consentOnFile === false) return { type, targetId, reason: 'no_consent' };
  return null;
}

export function buildFollowUpQueue(
  legal: LegalConfig,
  estimates: EstimateState[],
  jobs: JobState[],
  now: Date,
): FollowUpQueue {
  const due: FollowUpAction[] = [];
  const suppressed: SuppressedAction[] = [];
  const schedule = (from: Date) => clampToQuietHours(legal, from < now ? now : from).toISOString();

  for (const e of estimates) {
    if (e.resolved) continue;

    // #20 — no-show saver: window passed, nobody home, nothing sent since.
    if (e.noShow && e.windowEndsAt && Date.parse(e.windowEndsAt) <= now.getTime() && !e.lastFollowUpAt) {
      const g = gate(e, 'no_show_saver', e.id);
      if (g) suppressed.push(g);
      else {
        due.push({
          type: 'no_show_saver',
          targetId: e.id,
          name: e.name,
          note: 'Missed estimate window — reach out today to re-book before the lead goes cold.',
          scheduledFor: schedule(now),
          recommendOnly: true,
        });
      }
      continue;
    }

    // #16/#17 — 2-day cadence after the visit until resolved.
    if (e.visitedAt) {
      const anchor = e.lastFollowUpAt ?? e.visitedAt;
      const nextDue = Date.parse(anchor) + ESTIMATE_FOLLOW_UP_INTERVAL_DAYS * DAY_MS;
      if (nextDue <= now.getTime()) {
        const g = gate(e, 'estimate_follow_up', e.id);
        if (g) suppressed.push(g);
        else {
          const first = (e.followUpCount ?? 0) === 0;
          due.push({
            type: 'estimate_follow_up',
            targetId: e.id,
            name: e.name,
            note: first
              ? 'First follow-up since the estimate — attach the proof of insurance.'
              : `Follow-up #${(e.followUpCount ?? 0) + 1} — still open, keep it warm.`,
            scheduledFor: schedule(new Date(nextDue)),
            includeProofOfInsurance: first,
            recommendOnly: true,
          });
        }
      }
    }
  }

  // #18 — review request 1 day after completed AND paid, once.
  for (const j of jobs) {
    if (!j.completedAt || !j.paidAt || j.reviewRequestedAt) continue;
    const dueAt = Date.parse(j.paidAt) + REVIEW_REQUEST_DELAY_DAYS * DAY_MS;
    if (dueAt > now.getTime()) continue;
    const g = gate(j, 'review_request', j.id);
    if (g) suppressed.push(g);
    else {
      due.push({
        type: 'review_request',
        targetId: j.id,
        name: j.name,
        note: 'Job done and paid — send the Google review link with a thank-you.',
        scheduledFor: schedule(new Date(dueAt)),
        recommendOnly: true,
      });
    }
  }

  // Emergency-adjacent ordering isn't a concern here; oldest due first so
  // nothing rots at the bottom of the queue.
  due.sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
  return { due, suppressed };
}

// ---------------------------------------------------------------------------
// §19 — seasonal / pre-storm outreach. Fires ONLY when real weather is coming
// (the §26 storm feed says so), targets ONLY past customers in the affected
// cities, and passes the same §4 gates. Recommend-only, throttled to one nudge
// per contact per queue build — "reads as a small company, not a spam cannon".
// ---------------------------------------------------------------------------

export interface PastCustomer {
  contactId: string;
  name?: string;
  city?: string;
  lastJobAt?: string;
  consentOnFile?: boolean;
  suppressed?: boolean;
}

export interface StormContext {
  /** Cities currently under a work-stopping alert (from stormWatch). */
  citiesUnderAlert: string[];
  /** The headline event, for the queue note. */
  event: string;
}

export function buildSeasonalOutreach(
  legal: LegalConfig,
  storm: StormContext,
  pastCustomers: PastCustomer[],
  now: Date,
): FollowUpQueue {
  const due: FollowUpAction[] = [];
  const suppressed: SuppressedAction[] = [];
  if (storm.citiesUnderAlert.length === 0) return { due, suppressed };
  const scheduledFor = clampToQuietHours(legal, now).toISOString();
  for (const c of pastCustomers) {
    if (!c.city || !storm.citiesUnderAlert.includes(c.city)) continue;
    const g = gate(c, 'seasonal_outreach', c.contactId);
    if (g) {
      suppressed.push(g);
      continue;
    }
    due.push({
      type: 'seasonal_outreach',
      targetId: c.contactId,
      name: c.name,
      note: `${storm.event} headed for ${c.city} — past customer; offer a pre-storm tree check.`,
      scheduledFor,
      recommendOnly: true,
    });
  }
  return { due, suppressed };
}
