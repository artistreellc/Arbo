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

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const HOLD_MINUTES = 20;

export interface RequestedWindow {
  startIso: string;
  endIso: string;
  /** What the parser understood, for the event description. */
  label: string;
}

const ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: 'numeric',
  hour12: false,
});

function etNow(now: Date): { weekdayIdx: number; hour: number } {
  const parts = ET_PARTS.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const idx = WEEKDAYS.findIndex((d) => d.startsWith(get('weekday').toLowerCase()));
  return { weekdayIdx: idx, hour: Number(get('hour')) % 24 };
}

/**
 * The ET wall-clock slot, expressed as a UTC instant. Built by taking the
 * current UTC time, adding whole days, then pinning the ET hour via the
 * fixed-offset trick: format the target day in ET, rebuild at the hour.
 */
function etSlot(now: Date, daysAhead: number, hour: number): Date {
  const day = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  // Find the UTC timestamp at which ET shows `hour:00` on `day`'s ET date.
  // Probe: take day at 12:00 UTC, read its ET hour, and shift.
  const probe = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12, 0, 0));
  const probeEtHour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })
      .formatToParts(probe)
      .find((p) => p.type === 'hour')?.value ?? '12',
  ) % 24;
  return new Date(probe.getTime() + (hour - probeEtHour) * 60 * 60 * 1000);
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
        const { weekdayIdx } = etNow(now);
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
    label: `${dayLabel} ${timeLabel}`.trim(),
  };
}
