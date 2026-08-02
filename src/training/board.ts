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
