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
import { describe, it, expect } from 'vitest';
import { createApi, type DataSource } from '../src/server/api.js';
import type { TrainingItemRef } from '../src/training/questionnaire.js';

const CREW = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ITEM_A = '11111111-1111-1111-1111-111111111111';
const ITEM_B = '22222222-2222-2222-2222-222222222222';

const pool: TrainingItemRef[] = [
  { id: ITEM_A, topic: 'Electrical hazards', difficulty: 3, published: true, excludeFromScoring: false },
  { id: ITEM_B, topic: 'Rigging', difficulty: 2, published: true, excludeFromScoring: false },
];

function src(over: Partial<DataSource> = {}): DataSource {
  return {
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [],
    fileNearMiss: async () => ({ id: '33333333-3333-3333-3333-333333333333' }),
    createLessonDraft: async () => ({ id: 'draft-1' }),
    trainingPool: async () => pool,
    trainingItems: async (ids) => [
      { id: ITEM_A, topic: 'Electrical hazards', type: 'quiz_question',
        body: { prompt: 'Minimum approach distance?', options: ['10 ft', '3 ft'], answer: 0 } },
      { id: ITEM_B, topic: 'Rigging', type: 'quiz_question',
        body: { prompt: 'Who stands in line with a loaded rope?', options: ['Nobody', 'The groundie'], answer: 0 } },
    ].filter((i) => ids.includes(i.id)),
    trainingProfile: async () => ({ scores: { Rigging: 0.4 } }),
    saveTrainingProfile: async () => {},
    recordGate: async () => ({ trainingEventId: 'te1', timeEntryId: 't1' }),
    ...over,
  };
}

describe('near miss → lesson draft, wired end to end (§6V → §6M)', () => {
  it('filing a near miss drafts the lesson and returns its id', async () => {
    const res = await createApi(src()).reportNearMiss({
      reportedBy: CREW, description: 'Bucket drifted toward the service drop',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ lessonDraftId: 'draft-1' });
  });

  it('a failed draft NEVER loses the near miss itself', async () => {
    const res = await createApi(src({
      createLessonDraft: async () => { throw new Error('db down'); },
    })).reportNearMiss({ reportedBy: CREW, description: 'Limb came down early' });
    expect(res.status).toBe(200);
    // Honest: no lesson id, so the safety board keeps counting it as
    // "no lesson yet" — which is exactly what is true.
    expect((res.body as { lessonDraftId: string | null }).lessonDraftId).toBeNull();
  });
});

describe('GET /api/crew/quiz', () => {
  it('returns one item for a clock-in gate', async () => {
    const res = await createApi(src()).crewQuiz(CREW, 'clock_in_gate');
    expect(res.status).toBe(200);
    expect((res.body as { itemIds: string[] }).itemIds).toHaveLength(1);
  });

  it('weights toward the weak topic', async () => {
    const res = await createApi(src()).crewQuiz(CREW, 'clock_in_gate');
    expect((res.body as { itemIds: string[] }).itemIds[0]).toBe(ITEM_B); // Rigging = 0.4
  });

  it('an unreadable profile is NAMED, not treated as a clean slate', async () => {
    const res = await createApi(src({
      trainingProfile: async () => { throw new Error('db down'); },
    })).crewQuiz(CREW, 'friday_questionnaire');
    expect((res.body as { profileKnown: boolean }).profileKnown).toBe(false);
  });

  it('reports a shortfall rather than pretending the quiz was full length', async () => {
    const res = await createApi(src()).crewQuiz(CREW, 'friday_questionnaire');
    const b = res.body as { itemIds: string[]; shortfall: number };
    expect(b.itemIds).toHaveLength(2);
    expect(b.shortfall).toBe(8); // asked for 10, pool has 2
  });

  it('serves the question but NEVER the answer key', async () => {
    const res = await createApi(src()).crewQuiz(CREW, 'clock_in_gate');
    const b = res.body as { items: Array<Record<string, unknown>>; itemsLoaded: boolean };
    expect(b.itemsLoaded).toBe(true);
    expect(b.items[0]!.prompt).toBeTruthy();
    expect(b.items[0]!.options).toHaveLength(2);
    expect(JSON.stringify(b.items)).not.toMatch(/"answer"/);
  });

  it('a quiz whose questions could not load is NOT an empty quiz', async () => {
    const res = await createApi(src({
      trainingItems: async () => { throw new Error('db down'); },
    })).crewQuiz(CREW, 'clock_in_gate');
    expect((res.body as { itemsLoaded: boolean }).itemsLoaded).toBe(false);
  });

  it('rejects a bad crew id or context instead of guessing', async () => {
    const api = createApi(src());
    expect((await api.crewQuiz('dave', 'clock_in_gate')).status).toBe(400);
    expect((await api.crewQuiz(CREW, 'whatever')).status).toBe(400);
  });
});

describe('POST /api/crew/quiz/complete — §4.6, the time is always paid', () => {
  const good = {
    crewMemberId: CREW, context: 'clock_in_gate', itemIds: [ITEM_A],
    startedAtIso: '2026-08-03T11:00:00Z', completedAtIso: '2026-08-03T11:00:45Z',
  };

  it('records the gate WITH payable minutes', async () => {
    let written: { payableMinutes: number } | null = null;
    const api = createApi(src({
      recordGate: async (i) => { written = i; return { trainingEventId: 'te1', timeEntryId: 't1' }; },
    }));
    const res = await api.completeQuiz(good);
    expect(res.status).toBe(200);
    expect(written!.payableMinutes).toBeGreaterThanOrEqual(1);
    expect(res.body).toMatchObject({ timeEntryId: 't1' });
  });

  it('rejects a non-UUID item id BEFORE the paid write (the cycle-4 lesson)', async () => {
    let wrote = false;
    const api = createApi(src({
      recordGate: async () => { wrote = true; return { trainingEventId: 'x', timeEntryId: 'y' }; },
    }));
    const res = await api.completeQuiz({ ...good, itemIds: ['item-1'] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'bad_item_id' });
    expect(wrote, 'paid time was committed against an id that would fail').toBe(false);
  });

  it('rejects a reversed span rather than writing negative time', async () => {
    const res = await createApi(src()).completeQuiz({
      ...good, startedAtIso: '2026-08-03T11:05:00Z', completedAtIso: '2026-08-03T11:00:00Z',
    });
    expect(res.status).toBe(400);
  });

  it('a failed profile update NEVER rolls back the paid completion', async () => {
    const api = createApi(src({
      saveTrainingProfile: async () => { throw new Error('db down'); },
    }));
    const res = await api.completeQuiz({ ...good, answers: { [ITEM_A]: 0 } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ timeEntryId: 't1', profileUpdated: false });
  });

  it('reports profileUpdated honestly when it did work', async () => {
    const res = await createApi(src()).completeQuiz({ ...good, answers: { [ITEM_A]: 0 } });
    expect(res.body).toMatchObject({ profileUpdated: true });
  });

  it('a retry is a no-op success, not a 500 and not a duplicate paid row', async () => {
    const api = createApi(src({
      recordGate: async () => { throw Object.assign(new Error('dup'), { code: '23505' }); },
    }));
    const res = await api.completeQuiz(good);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ duplicate: true });
  });

  it('a client-asserted score is IGNORED — the server grades against the key', async () => {
    let savedProfile: unknown = null;
    const api = createApi(src({
      saveTrainingProfile: async (_id, p) => { savedProfile = p; },
    }));
    // The client claims a perfect Rigging score it was never quizzed on, and
    // claims it got the Electrical question right while answering it WRONG.
    const res = await api.completeQuiz({
      ...good, itemIds: [ITEM_A],
      answers: { [ITEM_A]: 1 },            // wrong: the key is 0
      topicScores: { Rigging: 1, 'Electrical hazards': 1 },
      correct: 99, answered: 99,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ correct: 0, answered: 1, score: 0 });
    const scores = (savedProfile as { scores: Record<string, number> }).scores;
    expect(scores.Rigging).toBe(0.4);      // untouched prior value
    expect(scores['Electrical hazards']).toBe(0); // the real result
  });

  it('an unanswered question is missing data, not a wrong answer', async () => {
    const res = await createApi(src()).completeQuiz({
      ...good, itemIds: [ITEM_A, ITEM_B], answers: { [ITEM_A]: 0 },
    });
    expect(res.body).toMatchObject({ answered: 1, correct: 1, score: 1 });
  });

  it('a failed grading pass still PAYS and reports the score as unknown', async () => {
    const api = createApi(src({
      trainingItems: async () => { throw new Error('db down'); },
    }));
    const res = await api.completeQuiz({ ...good, answers: { [ITEM_A]: 0 } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ gradedOk: false, score: null });
    expect((res.body as { payableMinutes: number }).payableMinutes).toBeGreaterThanOrEqual(1);
  });

  it('503s honestly with no database', async () => {
    const dead = createApi({ ready: () => false, stopsBetween: async () => [], newLeads: async () => [] });
    expect((await dead.crewQuiz(CREW, 'clock_in_gate')).status).toBe(503);
    expect((await dead.completeQuiz(good)).status).toBe(503);
  });
});
