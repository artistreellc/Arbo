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
// "Is he available Wednesday after 4?" → a concrete ET slot for the calendar
// hold (R18). Deliberately narrow: it parses the shapes callers actually say
// (a weekday, plus after-N / morning / afternoon / evening) and returns null
// for everything else — a null becomes a time-TBD hold, never a guessed slot.
// The hold is 20 minutes (the estimate slot length the route planner uses)
// and it is ALWAYS unconfirmed: Mike confirms, never Arbo (golden rule 3).

import { etOffsetMs, etToday } from '../lib/etDay.js';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const HOLD_MINUTES = 20;

export interface RequestedWindow {
  startIso: string;
  endIso: string;
  /** What the parser understood, for the event description — with the ET date it resolved to. */
  label: string;
}

/**
 * Today in Hampton Roads, read ONCE from the shared ET-day helper — the day
 * and the weekday both come from that one reading, never a second clock.
 * The weekday is UTC arithmetic on the ET date label, which carries no zone.
 */
function etTodayParts(now: Date): { y: number; m: number; d: number; weekdayIdx: number } {
  const [y, m, d] = etToday(now).split('-').map(Number) as [number, number, number];
  return { y, m, d, weekdayIdx: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/**
 * The ET wall-clock slot `hour:00` on the ET calendar day `daysAhead` after
 * today, as a UTC instant. The day is calendar-label arithmetic on ET's own
 * date (H3, 2026-10-20: the UTC date of now + N×24h put every call after
 * 8pm EDT / 7pm EST a day late). The hour is pinned with ET's offset AT the
 * slot (two reads, so a DST change between midnight and the slot lands right).
 */
function etSlot(now: Date, daysAhead: number, hour: number): Date {
  const { y, m, d } = etTodayParts(now);
  const wall = Date.UTC(y, m - 1, d + daysAhead, hour, 0, 0); // the slot's ET wall clock, written as if UTC
  const guess = wall - etOffsetMs(new Date(wall));
  return new Date(wall - etOffsetMs(new Date(guess)));
}

/** "Tue Oct 20" — the ET calendar day `daysAhead` after today, for the hold label. */
function etDateLabel(now: Date, daysAhead: number): string {
  const { y, m, d } = etTodayParts(now);
  const day = new Date(Date.UTC(y, m - 1, d + daysAhead));
  return `${DAY_SHORT[day.getUTCDay()]} ${MONTH_SHORT[day.getUTCMonth()]} ${day.getUTCDate()}`;
}

/**
 * Parse a caller's requested time out of one utterance. Returns null unless
 * BOTH a day and a rough time-of-day are recognisable — half a guess is
 * worse than an honest TBD.
 */
export function parseRequestedWindow(text: string, now: Date = new Date()): RequestedWindow | null {
  const t = text.toLowerCase();

  let daysAhead: number | null = null;
  let dayLabel = '';
  if (/\btomorrow\b/.test(t)) {
    daysAhead = 1;
    dayLabel = 'tomorrow';
  } else if (/\btoday\b/.test(t)) {
    daysAhead = 0;
    dayLabel = 'today';
  } else {
    for (let i = 0; i < WEEKDAYS.length; i++) {
      if (t.includes(WEEKDAYS[i]!)) {
        const { weekdayIdx } = etTodayParts(now);
        let ahead = (i - weekdayIdx + 7) % 7;
        if (ahead === 0) ahead = 7; // "Wednesday" said ON a Wednesday means next week
        daysAhead = ahead;
        dayLabel = WEEKDAYS[i]!;
        break;
      }
    }
  }
  if (daysAhead === null) return null;

  let hour: number | null = null;
  let timeLabel = '';
  const after = t.match(/\bafter\s+(\d{1,2})(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?/);
  const at = t.match(/\b(?:at|around)\s+(\d{1,2})(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?/);
  const m = after ?? at;
  if (m) {
    let h = Number(m[1]);
    if (h >= 1 && h <= 12) {
      const pm = m[2]?.startsWith('p');
      const am = m[2]?.startsWith('a');
      // Unqualified 1–7 on a phone call about an evening estimate means PM.
      if (pm || (!am && h <= 7)) h += 12;
      hour = h % 24;
      timeLabel = `${after ? 'after ' : ''}${m[1]}${m[2] ? ' ' + m[2] : ''}`;
    } else if (h >= 13 && h <= 20) {
      hour = h;
      timeLabel = `${after ? 'after ' : ''}${m[1]}`;
    }
  } else if (/\bmorning\b/.test(t)) {
    hour = 9;
    timeLabel = 'morning';
  } else if (/\bafternoon\b/.test(t)) {
    hour = 14;
    timeLabel = 'afternoon';
  } else if (/\bevening\b|\bafter work\b/.test(t)) {
    hour = 17;
    timeLabel = 'evening';
  }
  if (hour === null) return null;

  const start = etSlot(now, daysAhead, hour);
  return {
    startIso: start.toISOString(),
    endIso: new Date(start.getTime() + HOLD_MINUTES * 60 * 1000).toISOString(),
    // The absolute date rides the label, so the hold says which day "tomorrow" was.
    label: `${`${dayLabel} ${timeLabel}`.trim()} (${etDateLabel(now, daysAhead)})`,
  };
}
