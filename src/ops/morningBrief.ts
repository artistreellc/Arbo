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
// The Morning Brief (brief §5A #25, §9 "Home screen = the Morning Brief").
// One glance and Mike knows his day: the stops in route order, first-timers vs
// repeats flagged, red flags (power lines, emergencies) called out.
//
// Route ordering follows Mike's real rhythm (§3.11): crew JOBS hold the morning
// in time order; ESTIMATES run the afternoon ZIP-by-ZIP — one ZIP worked dry
// before rolling to the next — never scattered stops that force backtracking.
//
// Pulled forward at Mike's direction (see DECISIONS): the app surface needs it,
// and it reads purely from data the spine already captures.

export interface StopInput {
  id: string;
  kind: 'estimate' | 'job';
  timeIso?: string; // scheduled slot (ISO)
  name?: string;
  phone?: string;
  address: string;
  city: string;
  zip?: string;
  source?: string; // Mike's source tag (WEB, GG, LSA, TT, REFERAL, …)
  isFirstTimer?: boolean;
  nearPowerLines?: boolean;
  isEmergency?: boolean;
  scope?: string; // short description from intake
}

export interface BriefStop extends StopInput {
  order: number; // 1-based position in the day's route
  tags: string[]; // FIRST-TIMER / REPEAT / source tag
  redFlags: string[]; // POWER LINES / EMERGENCY
}

export interface MorningBrief {
  stops: BriefStop[];
  summary: {
    totalStops: number;
    jobs: number;
    estimates: number;
    firstTimers: number;
    redFlagCount: number;
    emergencies: number;
    zipRun: string[]; // the afternoon's ZIP sequence, in route order
  };
}

const time = (s: StopInput): number => (s.timeIso ? Date.parse(s.timeIso) : Number.MAX_SAFE_INTEGER);

/**
 * Assemble the day's brief from its stops. Pure and deterministic — the same
 * inputs always produce the same route, so the brief is testable and auditable.
 */
export function buildMorningBrief(stops: StopInput[]): MorningBrief {
  // Emergencies lead the day, whatever else was planned (§3.4).
  const emergencies = stops.filter((s) => s.isEmergency);
  const jobs = stops.filter((s) => !s.isEmergency && s.kind === 'job').sort((a, b) => time(a) - time(b));
  const estimates = stops.filter((s) => !s.isEmergency && s.kind === 'estimate');

  // Afternoon estimates: group by ZIP, order groups by their earliest slot,
  // finish each ZIP before moving on (§3.11 "work one ZIP dry").
  const byZip = new Map<string, StopInput[]>();
  for (const e of estimates) {
    const key = e.zip ?? 'no-zip';
    const arr = byZip.get(key) ?? [];
    arr.push(e);
    byZip.set(key, arr);
  }
  const zipGroups = [...byZip.entries()]
    .map(([zip, group]) => ({ zip, group: group.sort((a, b) => time(a) - time(b)) }))
    .sort((a, b) => time(a.group[0]!) - time(b.group[0]!));

  const routed: StopInput[] = [...emergencies, ...jobs, ...zipGroups.flatMap((g) => g.group)];

  const briefStops: BriefStop[] = routed.map((s, i) => {
    const tags: string[] = [];
    if (s.isFirstTimer === true) tags.push('FIRST-TIMER');
    if (s.isFirstTimer === false) tags.push('REPEAT');
    if (s.source) tags.push(s.source.toUpperCase());

    const redFlags: string[] = [];
    if (s.isEmergency) redFlags.push('EMERGENCY');
    if (s.nearPowerLines) redFlags.push('POWER LINES');

    return { ...s, order: i + 1, tags, redFlags };
  });

  return {
    stops: briefStops,
    summary: {
      totalStops: briefStops.length,
      jobs: jobs.length + emergencies.filter((e) => e.kind === 'job').length,
      estimates: estimates.length + emergencies.filter((e) => e.kind === 'estimate').length,
      firstTimers: briefStops.filter((s) => s.isFirstTimer === true).length,
      redFlagCount: briefStops.filter((s) => s.redFlags.length > 0).length,
      emergencies: emergencies.length,
      zipRun: zipGroups.map((g) => g.zip).filter((z) => z !== 'no-zip'),
    },
  };
}

/**
 * The brief as SPEECH (§3.17): what Mike hears on the drive, not a data dump.
 * Short sentences, worst news first, no PII beyond what he needs to drive.
 */
export function briefToSpeech(brief: MorningBrief): string {
  const s = brief.summary;
  const parts: string[] = [];
  parts.push(`Good morning. ${s.totalStops === 0 ? 'Nothing on the books today.' : `${s.totalStops} stop${s.totalStops === 1 ? '' : 's'} today: ${s.jobs} job${s.jobs === 1 ? '' : 's'} and ${s.estimates} estimate${s.estimates === 1 ? '' : 's'}.`}`);
  if (s.emergencies > 0) parts.push(`Heads up: ${s.emergencies} emergency stop${s.emergencies === 1 ? '' : 's'} lead${s.emergencies === 1 ? 's' : ''} the day.`);
  if (s.redFlagCount > 0) parts.push(`${s.redFlagCount} stop${s.redFlagCount === 1 ? ' has' : 's have'} red flags — check power lines before you cut.`);
  if (s.firstTimers > 0) parts.push(`${s.firstTimers} first-timer${s.firstTimers === 1 ? '' : 's'} — extra hand-holding.`);
  if (s.zipRun.length > 0) parts.push(`Afternoon ZIP run: ${s.zipRun.join(', then ')}.`);
  for (const stop of brief.stops.slice(0, 8)) {
    const t = stop.timeIso
      ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(stop.timeIso))
      : 'unscheduled';
    parts.push(`Stop ${stop.order}, ${t}: ${stop.name ?? 'unnamed'}, ${stop.kind}, ${stop.city}${stop.redFlags.length ? ` — ${stop.redFlags.join(' and ')}` : ''}.`);
  }
  if (brief.stops.length > 8) parts.push(`Plus ${brief.stops.length - 8} more — they're in the app.`);
  return parts.join(' ');
}
