// Availability (brief §5A Phase 3). Generates open slots within working
// days/hours and never overlaps existing bookings (no double-booking). Working
// hours are evaluated in the configured timezone via Intl (no ad-hoc offset
// math — §12 avoids the timezone rabbit hole).

import { DEFAULT_SCHEDULING, type SchedulingConfig } from './config.js';

export interface Interval {
  startIso: string;
  endIso: string;
}

function localParts(date: Date, tz: string): { weekday: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const wk = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const minStr = parts.find((p) => p.type === 'minute')?.value ?? '0';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: weekdayMap[wk] ?? 0, hour: Number(hourStr) % 24, minute: Number(minStr) };
}

export function overlaps(a: Interval, b: Interval): boolean {
  const as = Date.parse(a.startIso), ae = Date.parse(a.endIso);
  const bs = Date.parse(b.startIso), be = Date.parse(b.endIso);
  return as < be && bs < ae;
}

/** True if `slot` doesn't collide with any busy interval. */
export function isFree(slot: Interval, busy: Interval[]): boolean {
  return !busy.some((b) => overlaps(slot, b));
}

function withinWorkingWindow(startMs: number, durationMs: number, cfg: SchedulingConfig): boolean {
  const start = localParts(new Date(startMs), cfg.timezone);
  const end = localParts(new Date(startMs + durationMs - 1), cfg.timezone);
  if (!cfg.workingDays.includes(start.weekday)) return false;
  if (end.weekday !== start.weekday) return false; // must not cross midnight
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute + 1;
  return startMinutes >= cfg.workingStartHour * 60 && endMinutes <= cfg.workingEndHour * 60;
}

/**
 * Free slots of `durationMin` between `fromIso` and `toIso`, honoring working
 * days/hours and avoiding `busy`. Returns slot start/end ISO strings.
 */
export function freeSlots(
  fromIso: string,
  toIso: string,
  busy: Interval[],
  durationMin: number,
  cfg: SchedulingConfig = DEFAULT_SCHEDULING,
): Interval[] {
  const stepMs = cfg.slotMinutes * 60_000;
  const durMs = durationMin * 60_000;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const out: Interval[] = [];
  for (let s = alignUp(from, stepMs); s + durMs <= to; s += stepMs) {
    if (!withinWorkingWindow(s, durMs, cfg)) continue;
    const slot = { startIso: new Date(s).toISOString(), endIso: new Date(s + durMs).toISOString() };
    if (isFree(slot, busy)) out.push(slot);
  }
  return out;
}

function alignUp(ms: number, stepMs: number): number {
  return Math.ceil(ms / stepMs) * stepMs;
}
