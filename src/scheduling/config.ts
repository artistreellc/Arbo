// Scheduling config (brief §3 Phase 3, §5A #9–11). Working-day + color
// conventions live here so they're set in one place.

import type { ServiceCity } from '../lib/address.js';

// Google Calendar colorId → human name (for readability / confirmation).
export const GOOGLE_COLOR_NAMES: Record<string, string> = {
  '1': 'Lavender', '2': 'Sage', '3': 'Grape', '4': 'Flamingo', '5': 'Banana',
  '6': 'Tangerine', '7': 'Peacock', '8': 'Graphite', '9': 'Blueberry',
  '10': 'Basil', '11': 'Tomato',
};

export type EventKind = 'estimate' | 'job' | 'emergency' | 'follow_up';

// THE LEARNED COLOR MAP (resolves O4; see D34). Read off Mike's live calendar
// (250 events, Apr–Jul 2026): colorId encodes the CITY of a scheduled visit —
// near-perfect separation in the data (93/93 VB=4, 16/16 Norfolk=10,
// 6/6 Chesapeake=5, Portsmouth=6). '11' (Tomato) is strictly payments (14/14)
// — ARBOR never writes it. Booked jobs/admin ride the calendar DEFAULT color
// (no colorId). Sage '2' is a cross-city category the data alone can't decode
// (REPEAT-heavy) — open question O5; ARBOR doesn't write '2' until Mike says
// what it means.
export const CITY_CALENDAR_COLORS: Record<ServiceCity, string> = {
  'Virginia Beach': '4', // Flamingo
  Norfolk: '10', // Basil
  Chesapeake: '5', // Banana
  Portsmouth: '6', // Tangerine
};

/**
 * The colorId ARBOR writes for an event, per Mike's real scheme: location-bound
 * visits (estimates; emergencies are urgent visits too) get the CITY color;
 * jobs and follow-ups ride the calendar default (undefined), exactly as
 * observed. Never '11' (payments) and never '2' (meaning unconfirmed, O5).
 */
export function colorFor(kind: EventKind, city?: ServiceCity): string | undefined {
  if ((kind === 'estimate' || kind === 'emergency') && city) return CITY_CALENDAR_COLORS[city];
  return undefined;
}

export interface HourWindow {
  startHour: number; // local, inclusive
  endHour: number; // local, exclusive
}

export interface SchedulingConfig {
  timezone: string;
  workingDays: number[]; // 0=Sun … 6=Sat
  workingStartHour: number; // local (broad working day)
  workingEndHour: number;
  // Estimates run AFTERNOONS (~12–5pm); mornings are protected for crew jobs
  // (§3.11 — Mike's real rhythm). Adjustable in Settings, never hard-coded.
  estimateWindow: HourWindow;
  slotMinutes: number;
  durationsMin: Record<EventKind, number>;
  // Realistic capacity: ~260 workdays/yr, but rain/breakdowns/no-shows cut it to
  // ~200 productive days. Used for capacity math, not hard booking (§2).
  productiveDayFactor: number;
}

export const DEFAULT_SCHEDULING: SchedulingConfig = {
  timezone: 'America/New_York',
  workingDays: [1, 2, 3, 4, 5], // Mon–Fri (~260/yr)
  workingStartHour: 8,
  workingEndHour: 17,
  estimateWindow: { startHour: 12, endHour: 17 }, // afternoons only (§3.11)
  slotMinutes: 30,
  durationsMin: { estimate: 30, job: 180, emergency: 60, follow_up: 30 },
  productiveDayFactor: 200 / 260,
};

/**
 * The hour window a given event kind may be booked in. Estimates are afternoon-
 * only (§3.11); other kinds use the broad working day.
 */
export function windowForKind(kind: EventKind, cfg: SchedulingConfig = DEFAULT_SCHEDULING): HourWindow {
  if (kind === 'estimate') return cfg.estimateWindow;
  return { startHour: cfg.workingStartHour, endHour: cfg.workingEndHour };
}

/** Productive days available in a window of `calendarWorkdays` working days. */
export function productiveDays(calendarWorkdays: number, cfg = DEFAULT_SCHEDULING): number {
  return Math.round(calendarWorkdays * cfg.productiveDayFactor);
}
