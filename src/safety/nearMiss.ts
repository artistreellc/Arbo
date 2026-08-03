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
// Blameless near-miss filing (brief §6V, §4). The whole value of a near-miss
// programme is that reporting one costs the reporter nothing — so the payload
// type has NO slot for fault, discipline, or who-messed-up, and there is no
// code path that can attach one.
//
// §1B: a report Arbo cannot categorise is filed as 'uncategorised', never
// silently dropped and never guessed into the wrong bucket.

export type HazardCategory =
  | 'struck_by'          // falling limb, dropped tool, swinging load
  | 'electrical'         // conductors, service drops
  | 'fall'               // climbing, aerial lift, ladder
  | 'cutting'            // chainsaw, chipper, pole saw
  | 'vehicle'            // truck, trailer, backing, traffic
  | 'rigging'            // ropes, blocks, slings
  | 'environmental'      // heat, wasps, footing, weather
  | 'uncategorised';     // Arbo could not tell — NEVER a guess

export interface NearMissReport {
  /** Who filed it — for the OSHA record, never for blame. */
  reportedBy: string;
  jobId?: string;
  /** What happened, in the reporter's own words. */
  description: string;
  occurredOn: string; // ISO date (YYYY-MM-DD)
}

export interface FiledNearMiss {
  reportedBy: string;
  jobId: string | null;
  description: string;
  occurredOn: string;
  hazardCategory: HazardCategory;
  /** ALWAYS true. There is no code path that sets this false. */
  blameless: true;
}

/** Keyword → category. First match wins, so order encodes severity priority. */
const CATEGORY_HINTS: Array<{ match: RegExp; category: HazardCategory }> = [
  { match: /\b(power ?line|conductor|service drop|energized|electric|voltage|transformer)\b/i, category: 'electrical' },
  { match: /\b(fell|fall|falling off|slipped off|lanyard|harness|climb(ing)?|ladder|bucket|aerial lift)\b/i, category: 'fall' },
  { match: /\b(struck|hit by|dropped|came down|swung|limb fell|widow ?maker|barber ?chair)\b/i, category: 'struck_by' },
  { match: /\b(rope|rigging|sling|block|friction|pulley|winch|highline)\b/i, category: 'rigging' },
  { match: /\b(saw|chainsaw|chipper|pole ?saw|blade|kickback|cut)\b/i, category: 'cutting' },
  { match: /\b(truck|trailer|backing|traffic|driver|road|vehicle|cone)\b/i, category: 'vehicle' },
  { match: /\b(wasp|bee|hornet|snake|heat|dehydrat|footing|mud|ice|lightning|wind)\b/i, category: 'environmental' },
];

export function categoriseHazard(description: string): HazardCategory {
  return CATEGORY_HINTS.find((h) => h.match.test(description))?.category ?? 'uncategorised';
}

export class NearMissRejected extends Error {
  constructor(public readonly reason: 'no_reporter' | 'no_description' | 'bad_date' | 'future_date') {
    super(reason);
    this.name = 'NearMissRejected';
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turn a field report into the row. Deliberately permissive about detail — a
 * near-miss filed in ten words is worth infinitely more than one never filed —
 * but strict about the two facts the record is useless without.
 */
export function fileNearMiss(report: NearMissReport, todayEt: string): FiledNearMiss {
  const description = report.description.trim();
  if (!report.reportedBy) throw new NearMissRejected('no_reporter');
  if (!description) throw new NearMissRejected('no_description');
  if (!DATE_RE.test(report.occurredOn)) throw new NearMissRejected('bad_date');
  // A near miss cannot have happened tomorrow. Compared in ET, because the
  // crew's "today" is Hampton Roads' today, not the server's UTC day.
  if (report.occurredOn > todayEt) throw new NearMissRejected('future_date');

  return {
    reportedBy: report.reportedBy,
    jobId: report.jobId ?? null,
    description,
    occurredOn: report.occurredOn,
    hazardCategory: categoriseHazard(description),
    blameless: true,
  };
}
