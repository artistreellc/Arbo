// The scheduler (brief §5A #9–11). It RECOMMENDS slots — ranked so same-ZIP work
// clusters — and books ONLY the slot Mike explicitly approves. It never
// auto-commits. Booking writes a color-coded Google Calendar event and re-checks
// for double-booking first.

import { freeSlots, isFree, type Interval } from './availability.js';
import { clusterScore, type ZipEvent } from './clustering.js';
import { colorFor, WON_ESTIMATE_COLOR, DEFAULT_SCHEDULING, windowForKind, type EventKind, type SchedulingConfig } from './config.js';
import type { CalendarApi, CalendarEvent } from '../integrations/calendar.js';
import type { ServiceCity } from '../lib/address.js';

export interface ScheduleRequest {
  kind: EventKind;
  city?: ServiceCity; // drives Mike's city color scheme (D34)
  zip?: string;
  fromIso: string;
  toIso: string;
  durationMin?: number;
}

export interface Suggestion {
  startIso: string;
  endIso: string;
  colorId?: string; // city color for visits; undefined = calendar default (jobs)
  kind: EventKind;
  clusterScore: number;
  reason: string;
  requiresApproval: true; // ALWAYS — a suggestion is never a booking (§5A #11)
}

/**
 * Recommend up to `limit` slots, best first. "Best" = clusters with same-ZIP
 * work, then earliest. These are suggestions only; nothing is written.
 */
export function recommendSlots(
  req: ScheduleRequest,
  existing: ZipEvent[],
  cfg: SchedulingConfig = DEFAULT_SCHEDULING,
  limit = 3,
): Suggestion[] {
  const duration = req.durationMin ?? cfg.durationsMin[req.kind];
  // Estimates are constrained to the afternoon window; other kinds to the
  // broad working day (§3.11).
  const slots = freeSlots(req.fromIso, req.toIso, existing, duration, cfg, windowForKind(req.kind, cfg));

  const ranked = slots
    .map((s) => {
      const score = clusterScore(s, req.zip, existing);
      return {
        startIso: s.startIso,
        endIso: s.endIso,
        colorId: colorFor(req.kind, req.city),
        kind: req.kind,
        clusterScore: score,
        reason: reasonFor(score, req.zip),
        requiresApproval: true as const,
      };
    })
    .sort((a, b) => b.clusterScore - a.clusterScore || Date.parse(a.startIso) - Date.parse(b.startIso));

  return ranked.slice(0, limit);
}

function reasonFor(score: number, zip?: string): string {
  if (score >= 10 && zip) return `Clusters with same-ZIP (${zip}) work already booked that day`;
  if (score < 0) return 'Open, but would be a detour from other work that day';
  return 'Earliest open slot in working hours';
}

export class ApprovalRequiredError extends Error {
  constructor() {
    super("Scheduling recommends only — Mike must approve before booking (§5A #11).");
    this.name = 'ApprovalRequiredError';
  }
}
export class DoubleBookingError extends Error {
  constructor() {
    super('That slot is no longer free — refusing to double-book.');
    this.name = 'DoubleBookingError';
  }
}

export interface BookParams {
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  city?: ServiceCity; // drives the city color (D34)
  zip?: string;
  propertyId?: string;
  slot: Interval;
  kind: EventKind;
  approved: boolean; // MUST be true — Mike's explicit go-ahead
  existingBusy: Interval[]; // re-checked to prevent double-booking
}

/** Book an APPROVED slot into the calendar. Throws unless explicitly approved. */
export async function bookApproved(api: CalendarApi, p: BookParams): Promise<CalendarEvent> {
  if (!p.approved) throw new ApprovalRequiredError();
  if (!isFree(p.slot, p.existingBusy)) throw new DoubleBookingError();

  return api.createEvent({
    calendarId: p.calendarId,
    summary: p.summary,
    description: p.description,
    location: p.location,
    startIso: p.slot.startIso,
    endIso: p.slot.endIso,
    colorId: colorFor(p.kind, p.city),
    zip: p.zip,
    propertyId: p.propertyId,
  });
}

/**
 * Recolor a won estimate's calendar event Sage (D36, §5A #14) — Mike's real
 * "job was won" convention. Called when a signed contract converts the
 * estimate to a booked job. The ONLY path that writes colorId 2.
 */
export async function markEstimateWonOnCalendar(
  api: CalendarApi,
  calendarId: string,
  estimateEventId: string,
): Promise<void> {
  await api.updateEventColor(calendarId, estimateEventId, WON_ESTIMATE_COLOR);
}
