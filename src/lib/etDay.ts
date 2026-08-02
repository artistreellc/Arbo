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
