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
// The admin training board (brief §6M.5). Who is weak on what, and who has
// not done this week's gate.
//
// §1B, applied to competence: this board distinguishes three states that are
// easy to blur into one another and expensive to confuse —
//   WEAK      we tested him and he struggled
//   UNTESTED  we have never asked him, which is a gap in OUR record
//   STRONG    we tested him and he did well
// An untested topic is never shown as strong. "We don't know" is a finding.

export interface CrewProfileRow {
  id: string;
  name: string;
  role: string;
  scores: Record<string, number>;
}

export interface GateCompletionRow {
  crewMemberId: string;
  context: string;
  completedAtIso: string | null;
}

export interface CrewTrainingRow {
  crewMemberId: string;
  name: string;
  role: string;
  /** Topics scored at or below the weak threshold, worst first. */
  weakTopics: Array<{ topic: string; score: number }>;
  strongTopics: string[];
  /** In the pool but never asked of this man. A gap, not a pass. */
  untestedTopics: string[];
  /** Did they complete the week's questionnaire? null = the check could not run. */
  completedThisWeek: boolean | null;
  /** Nothing on record at all — new hire, or a record nobody has kept. */
  neverTested: boolean;
}

export interface TrainingBoard {
  rows: CrewTrainingRow[];
  /** Crew who owe this week's questionnaire. Empty only when the check ran. */
  owingThisWeek: string[];
  /** Named gaps in the board itself — never rendered as an all-clear. */
  blindSpots: string[];
}

export const WEAK_AT_OR_BELOW = 0.7;

/**
 * Build the board. `poolTopics` is every topic the published pool can ask —
 * without it, "untested" would silently mean "untested among topics he has
 * already seen", which is the reassuring version of the wrong answer.
 */
export function buildTrainingBoard(input: {
  crew: CrewProfileRow[];
  poolTopics: string[];
  completions: GateCompletionRow[] | null;
  weakAtOrBelow?: number;
}): TrainingBoard {
  const threshold = input.weakAtOrBelow ?? WEAK_AT_OR_BELOW;
  const blindSpots: string[] = [];
  const topics = [...new Set(input.poolTopics)].sort();

  if (topics.length === 0) {
    blindSpots.push('No published training items — Arbo cannot tell what anyone has or has not been asked.');
  }

  // A completions read that FAILED is not "nobody completed anything".
  const completedBy = input.completions === null ? null : new Set(
    input.completions
      .filter((c) => c.context === 'friday_questionnaire' && c.completedAtIso)
      .map((c) => c.crewMemberId),
  );
  if (completedBy === null) {
    blindSpots.push('Weekly completions could not be read — who owes this week is UNKNOWN, not nobody.');
  }

  const rows: CrewTrainingRow[] = input.crew.map((m) => {
    const scored = Object.entries(m.scores);
    const weakTopics = scored
      .filter(([, s]) => s <= threshold)
      .map(([topic, score]) => ({ topic, score }))
      .sort((a, b) => a.score - b.score || a.topic.localeCompare(b.topic));
    const strongTopics = scored
      .filter(([, s]) => s > threshold)
      .map(([topic]) => topic)
      .sort();
    const untestedTopics = topics.filter((t) => !(t in m.scores));

    return {
      crewMemberId: m.id,
      name: m.name,
      role: m.role,
      weakTopics,
      strongTopics,
      untestedTopics,
      completedThisWeek: completedBy === null ? null : completedBy.has(m.id),
      neverTested: scored.length === 0,
    };
  });

  // Worst first: never tested, then most weak topics, then most untested.
  rows.sort((a, b) =>
    Number(b.neverTested) - Number(a.neverTested)
    || b.weakTopics.length - a.weakTopics.length
    || b.untestedTopics.length - a.untestedTopics.length
    || a.name.localeCompare(b.name));

  return {
    rows,
    owingThisWeek: completedBy === null ? [] : rows.filter((r) => r.completedThisWeek === false).map((r) => r.crewMemberId),
    blindSpots,
  };
}
