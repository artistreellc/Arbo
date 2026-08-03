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
// Availability (brief §5A Phase 3). Generates open slots within working
// days/hours and never overlaps existing bookings (no double-booking). Working
// hours are evaluated in the configured timezone via Intl (no ad-hoc offset
// math — §12 avoids the timezone rabbit hole).

import { DEFAULT_SCHEDULING, type SchedulingConfig, type HourWindow } from './config.js';

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

function withinWorkingWindow(startMs: number, durationMs: number, cfg: SchedulingConfig, window?: HourWindow): boolean {
  const startHour = window?.startHour ?? cfg.workingStartHour;
  const endHour = window?.endHour ?? cfg.workingEndHour;
  const start = localParts(new Date(startMs), cfg.timezone);
  const end = localParts(new Date(startMs + durationMs - 1), cfg.timezone);
  if (!cfg.workingDays.includes(start.weekday)) return false;
  if (end.weekday !== start.weekday) return false; // must not cross midnight
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute + 1;
  return startMinutes >= startHour * 60 && endMinutes <= endHour * 60;
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
  window?: HourWindow,
): Interval[] {
  const stepMs = cfg.slotMinutes * 60_000;
  const durMs = durationMin * 60_000;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const out: Interval[] = [];
  for (let s = alignUp(from, stepMs); s + durMs <= to; s += stepMs) {
    if (!withinWorkingWindow(s, durMs, cfg, window)) continue;
    const slot = { startIso: new Date(s).toISOString(), endIso: new Date(s + durMs).toISOString() };
    if (isFree(slot, busy)) out.push(slot);
  }
  return out;
}

function alignUp(ms: number, stepMs: number): number {
  return Math.ceil(ms / stepMs) * stepMs;
}
