// Scheduling config (brief §3 Phase 3, §5A #9–11). Working-day + color
// conventions live here so they're set in one place. Mike confirms the color
// mapping (he already uses Tomato/11 for payment reminders, so ARBOR avoids it).

// Google Calendar colorId → human name (for readability / confirmation).
export const GOOGLE_COLOR_NAMES: Record<string, string> = {
  '1': 'Lavender', '2': 'Sage', '3': 'Grape', '4': 'Flamingo', '5': 'Banana',
  '6': 'Tangerine', '7': 'Peacock', '8': 'Graphite', '9': 'Blueberry',
  '10': 'Basil', '11': 'Tomato',
};

export type EventKind = 'estimate' | 'job' | 'emergency' | 'follow_up';

// Default color mapping — DELIBERATELY avoids '11' (Tomato), which Mike uses for
// payment reminders. Confirm/adjust with Mike (DECISIONS O4).
export const CALENDAR_COLORS: Record<EventKind, string> = {
  estimate: '9', // Blueberry (blue)
  job: '10', // Basil (green) — "go / work"
  emergency: '6', // Tangerine (orange) — attention, but not the payment red
  follow_up: '5', // Banana (yellow)
};

export interface SchedulingConfig {
  timezone: string;
  workingDays: number[]; // 0=Sun … 6=Sat
  workingStartHour: number; // local
  workingEndHour: number;
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
  slotMinutes: 30,
  durationsMin: { estimate: 30, job: 180, emergency: 60, follow_up: 30 },
  productiveDayFactor: 200 / 260,
};

/** Productive days available in a window of `calendarWorkdays` working days. */
export function productiveDays(calendarWorkdays: number, cfg = DEFAULT_SCHEDULING): number {
  return Math.round(calendarWorkdays * cfg.productiveDayFactor);
}
