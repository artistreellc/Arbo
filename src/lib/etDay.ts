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
// Hampton Roads day math. The server runs UTC; the business runs
// America/New_York. Every "what day is it" decision goes through here so the
// UTC-day bug (found twice in review) cannot come back in a third place.

const ET = 'America/New_York';
const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit',
});
export const ET_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: ET, hour: 'numeric', minute: '2-digit',
});

/** UTC offset (ms) that America/New_York is running at a given instant. */
export function etOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return asUtc - at.getTime();
}

/** Today's calendar date in ET, as YYYY-MM-DD. */
export function etToday(now = new Date()): string {
  return ET_DATE.format(now);
}

/** The ET calendar date N days from now, as YYYY-MM-DD. */
export function etDateOffset(now: Date, days: number): string {
  return ET_DATE.format(new Date(now.getTime() + days * 86400_000));
}

/**
 * The UTC instants bounding one ET calendar day (DST-correct: the offset is
 * sampled at the target day, not at "now").
 */
export function etDayWindow(dayLabel: string): { startUtc: Date; endUtc: Date; dayLabel: string } {
  const [y, m, d] = dayLabel.split('-').map(Number);
  const naiveMidnightUtc = Date.UTC(y!, m! - 1, d!, 0, 0, 0);
  const offset = etOffsetMs(new Date(naiveMidnightUtc));
  const startUtc = new Date(naiveMidnightUtc - offset);
  return { startUtc, endUtc: new Date(startUtc.getTime() + 86400_000), dayLabel };
}

/** Tomorrow in Hampton Roads, as a UTC window. */
export function etTomorrowWindow(now: Date): { startUtc: Date; endUtc: Date; dayLabel: string } {
  return etDayWindow(etDateOffset(now, 1));
}

/**
 * The Monday 00:00 ET that starts the CURRENT week, as UTC. The training board
 * asks "who owes this week's questionnaire", and a UTC week boundary would
 * roll over at 8pm Sunday ET — marking Monday-morning crew as already owing.
 */
export function etWeekStart(now = new Date()): Date {
  const label = etToday(now);
  // Weekday in ET, not in the server's zone.
  const dow = new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short' })
    .format(now);
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const idx = order.indexOf(dow);
  const back = idx < 0 ? 0 : idx;
  const monday = etDateOffset(new Date(Date.parse(`${label}T12:00:00Z`)), -back);
  return etDayWindow(monday).startUtc;
}

/** True when it is Friday in Hampton Roads — the questionnaire's day. */
export function isEtFriday(now = new Date()): boolean {
  return new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short' })
    .format(now) === 'Fri';
}
