// Micro-lessons and the Friday questionnaire (brief §6M, §4.6).
//
// §4.6 is the rule that shapes everything here: quiz and briefing time is
// COMPENSABLE. Every gate in this module produces a payable time entry, always,
// with no path that records a completion without one. That is wage law, not a
// preference — so it is structural, not a policy note.
//
// The question count is PARAMETERISED. Mike has not ruled on 10 vs 15 for the
// Friday questionnaire; building it as a constant would make his answer a
// rewrite instead of a config change.

export interface TrainingItemRef {
  id: string;
  topic: string;
  /** 1 (easiest) upward. Weak topics pull harder items. */
  difficulty: number;
  published: boolean;
  /** Items generated from a near miss are never scored against the crew. */
  excludeFromScoring: boolean;
}

/** Per-man weak/strong topics, from crew_member.training_profile (§6M.5). */
export interface TrainingProfile {
  /** topic → rolling score 0–1. Absent topic = never tested = UNKNOWN. */
  scores?: Record<string, number>;
}

export interface QuestionnaireConfig {
  /** Mike's open ruling: 10 or 15. Config, never a code change. */
  questionCount: number;
  /** A topic at or below this rolling score is "weak" and gets weighted up. */
  weakThreshold: number;
  /** How many of the set are drawn from weak topics first. */
  weakShare: number;
}

export const defaultQuestionnaireConfig: QuestionnaireConfig = {
  questionCount: 10,
  weakThreshold: 0.7,
  weakShare: 0.6,
};

export interface SelectedQuestionnaire {
  itemIds: string[];
  /** Topics chosen because the man is weak on them. */
  targetedTopics: string[];
  /** Topics Arbo has NEVER tested this person on — not "strong" (§1B). */
  untestedTopics: string[];
  /** Fewer questions than asked for, because the pool was too small. */
  shortfall: number;
}

/**
 * Pick the questionnaire. Deterministic: same pool, same profile, same set —
 * so a man cannot reroll into an easier quiz, and a failure is reproducible.
 */
export function selectQuestionnaire(
  pool: TrainingItemRef[],
  profile: TrainingProfile,
  cfg: QuestionnaireConfig = defaultQuestionnaireConfig,
): SelectedQuestionnaire {
  // Only vetted, published items can be asked. An unpublished draft has not
  // been through a human (§4.7) and must never reach a crew member.
  const eligible = pool.filter((i) => i.published && !i.excludeFromScoring);
  const scores = profile.scores ?? {};

  const topics = [...new Set(eligible.map((i) => i.topic))];
  const untestedTopics = topics.filter((t) => !(t in scores)).sort();
  const weakTopics = topics
    .filter((t) => t in scores && scores[t]! <= cfg.weakThreshold)
    .sort((a, b) => scores[a]! - scores[b]! || a.localeCompare(b));

  // An UNTESTED topic is not a strong topic. It ranks with the weak ones,
  // because "we have never checked" is a gap, not a pass (§1B).
  const priority = [...weakTopics, ...untestedTopics];

  const want = Math.max(0, Math.floor(cfg.questionCount));
  const wantWeak = Math.min(want, Math.round(want * cfg.weakShare));

  const byTopic = (t: string) =>
    eligible.filter((i) => i.topic === t).sort((a, b) => b.difficulty - a.difficulty || a.id.localeCompare(b.id));

  const picked: string[] = [];
  const seen = new Set<string>();
  const take = (item: TrainingItemRef | undefined) => {
    if (!item || seen.has(item.id) || picked.length >= want) return;
    seen.add(item.id);
    picked.push(item.id);
  };

  // Round-robin across the priority topics so one weak area cannot eat the
  // whole quiz and hide a second one.
  for (let depth = 0; picked.length < wantWeak && depth < 20; depth++) {
    let progressed = false;
    for (const t of priority) {
      const item = byTopic(t)[depth];
      if (item) { take(item); progressed = true; }
      if (picked.length >= wantWeak) break;
    }
    if (!progressed) break;
  }

  // Fill the remainder from everything else, easiest first, deterministically.
  const rest = eligible
    .filter((i) => !seen.has(i.id))
    .sort((a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id));
  for (const item of rest) take(item);

  return {
    itemIds: picked,
    targetedTopics: weakTopics,
    untestedTopics,
    // Say it out loud when the pool could not fill the quiz — a 4-question
    // "10-question quiz" must not be reported as a 10-question quiz.
    shortfall: Math.max(0, want - picked.length),
  };
}

/** Where a micro-lesson gate fires. */
export type GateContext = 'clock_in_gate' | 'clock_out_gate' | 'friday_questionnaire' | 'micro_lesson';

export interface GateCompletion {
  crewMemberId: string;
  context: GateContext;
  itemIds: string[];
  startedAtIso: string;
  completedAtIso: string;
  /** 0–1, or null when the gate was a lesson with nothing to score. */
  score: number | null;
  /** ALWAYS ≥ 1. §4.6: this time is paid, and rounding to zero is wage theft. */
  payableMinutes: number;
}

/** Ceiling on one gate's payable time — a client clock cannot mint a shift. */
export const MAX_GATE_MINUTES = 20;

export class GateRejected extends Error {
  constructor(public readonly reason: 'no_crew_member' | 'no_items' | 'bad_times' | 'reversed_times') {
    super(reason);
    this.name = 'GateRejected';
  }
}

/**
 * Turn a completed gate into the record + its payable time. Mirrors
 * buildAcknowledgment (§6V.4) deliberately: one shape for every compensable
 * training event, so a new gate cannot forget the pay.
 */
export function buildGateCompletion(input: {
  crewMemberId: string;
  context: GateContext;
  itemIds: string[];
  startedAtIso: string;
  completedAtIso: string;
  correct?: number;
  answered?: number;
}): GateCompletion {
  if (!input.crewMemberId) throw new GateRejected('no_crew_member');
  if (!input.itemIds.length) throw new GateRejected('no_items');
  const started = Date.parse(input.startedAtIso);
  const completed = Date.parse(input.completedAtIso);
  if (!Number.isFinite(started) || !Number.isFinite(completed)) throw new GateRejected('bad_times');
  // A reversed span would write ended_at < started_at and a negative wage row.
  if (completed <= started) throw new GateRejected('reversed_times');

  const rawMinutes = (completed - started) / 60_000;
  const payableMinutes = Math.min(MAX_GATE_MINUTES, Math.max(1, Math.ceil(rawMinutes)));

  const score = input.answered && input.answered > 0
    ? Math.round(((input.correct ?? 0) / input.answered) * 100) / 100
    : null;

  return {
    crewMemberId: input.crewMemberId,
    context: input.context,
    itemIds: input.itemIds,
    startedAtIso: input.startedAtIso,
    completedAtIso: input.completedAtIso,
    score,
    payableMinutes,
  };
}

/**
 * Fold a completed quiz into the man's rolling profile. Exponential moving
 * average so one bad Friday does not brand someone, and one good one does not
 * erase a pattern.
 */
export const PROFILE_ALPHA = 0.4;

export function updateProfile(
  profile: TrainingProfile,
  topicScores: Record<string, number>,
): TrainingProfile {
  const next: Record<string, number> = { ...(profile.scores ?? {}) };
  for (const [topic, score] of Object.entries(topicScores)) {
    if (!Number.isFinite(score) || score < 0 || score > 1) continue; // ignore garbage, never store it
    const prior = next[topic];
    next[topic] = prior === undefined
      ? Math.round(score * 100) / 100
      : Math.round((prior * (1 - PROFILE_ALPHA) + score * PROFILE_ALPHA) * 100) / 100;
  }
  return { scores: next };
}
