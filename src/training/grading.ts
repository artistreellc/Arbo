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
