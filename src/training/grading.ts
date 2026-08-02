// Server-side grading (brief §6M, §4.6). The answer key never leaves the
// server, and a score is never taken on the client's word.
//
// Why this exists: an earlier cut of the quiz API accepted `correct`,
// `answered`, and `topicScores` straight from the request body. That let any
// client assert a perfect score — and since the weak-topic weighting reads
// those scores back, a man could quiz himself out of ever being asked about
// the thing he is weakest at. The training loop is only worth running if the
// scores are real.

export interface GradableItem {
  id: string;
  topic: string;
  type: string;
  /** Raw jsonb. Quiz questions carry prompt/options/answer. */
  body: Record<string, unknown>;
}

/** What a phone is allowed to see: the question, never the key. */
export interface CrewFacingItem {
  id: string;
  topic: string;
  type: string;
  prompt: string;
  options: string[];
  /** True when this item has no gradable answer (a lesson, not a question). */
  readOnly: boolean;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function optionsOf(body: Record<string, unknown>): string[] {
  const raw = body.options;
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => (typeof o === 'string' ? o : String((o as { text?: unknown })?.text ?? ''))).filter(Boolean);
}

/** The answer index, or null when the item carries no usable key. */
export function answerIndex(item: GradableItem): number | null {
  const a = item.body.answer;
  const options = optionsOf(item.body);
  if (typeof a === 'number' && Number.isInteger(a) && a >= 0 && a < options.length) return a;
  // Some items store the answer as the option TEXT rather than an index.
  if (typeof a === 'string') {
    const i = options.findIndex((o) => o.toLowerCase() === a.trim().toLowerCase());
    return i >= 0 ? i : null;
  }
  return null;
}

/** Strip every item down to what a crew phone may receive. */
export function toCrewFacing(items: GradableItem[]): CrewFacingItem[] {
  return items.map((i) => {
    const options = optionsOf(i.body);
    const prompt = str(i.body.prompt) ?? str(i.body.question) ?? str(i.body.headline) ?? i.topic;
    return {
      id: i.id,
      topic: i.topic,
      type: i.type,
      prompt,
      options,
      // A lesson, or a question with no usable key, cannot be graded — so it
      // is served as read-only rather than silently scored as wrong.
      readOnly: options.length === 0 || answerIndex(i) === null,
    };
  });
}

export interface GradeResult {
  answered: number;
  correct: number;
  /** 0–1 across gradable items, or null when nothing was gradable. */
  score: number | null;
  /** Per-topic 0–1, ready for the rolling profile. Only topics actually asked. */
  topicScores: Record<string, number>;
  /** Items the crew answered that Arbo could not grade — named, not ignored. */
  ungradable: string[];
}

/**
 * Grade a submission against the real key. Unanswered items are NOT counted
 * as wrong — an unanswered question is missing data, and marking it wrong
 * would quietly manufacture a weakness that was never measured (§1B).
 */
export function gradeSubmission(
  items: GradableItem[],
  answers: Record<string, number>,
): GradeResult {
  let answered = 0;
  let correct = 0;
  const ungradable: string[] = [];
  const byTopic = new Map<string, { asked: number; right: number }>();

  for (const item of items) {
    const given = answers[item.id];
    if (given === undefined || given === null) continue; // not answered — not wrong
    const key = answerIndex(item);
    if (key === null) { ungradable.push(item.id); continue; }

    answered++;
    const isRight = Number(given) === key;
    if (isRight) correct++;
    const t = byTopic.get(item.topic) ?? { asked: 0, right: 0 };
    t.asked++;
    if (isRight) t.right++;
    byTopic.set(item.topic, t);
  }

  const topicScores: Record<string, number> = {};
  for (const [topic, t] of byTopic) {
    topicScores[topic] = Math.round((t.right / t.asked) * 100) / 100;
  }

  return {
    answered,
    correct,
    score: answered > 0 ? Math.round((correct / answered) * 100) / 100 : null,
    topicScores,
    ungradable,
  };
}
