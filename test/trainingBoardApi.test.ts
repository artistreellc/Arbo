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

function src(over: Partial<DataSource> = {}): DataSource {
  return {
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [],
    crewProfiles: async () => [
      { id: 'c1', name: 'A', role: 'climber', scores: { Rigging: 0.3 } as Record<string, number> },
      { id: 'c2', name: 'B', role: 'groundie', scores: {} as Record<string, number> },
    ],
    trainingPool: async () => [
      { id: 'i1', topic: 'Rigging', difficulty: 1, published: true, excludeFromScoring: false },
      { id: 'i2', topic: 'Fall protection', difficulty: 1, published: true, excludeFromScoring: false },
    ],
    gateCompletionsSince: async () => [
      { crewMemberId: 'c1', context: 'friday_questionnaire', completedAtIso: '2026-08-03T12:00:00Z' },
    ],
    ...over,
  };
}

describe('GET /api/training/board', () => {
  it('reports who owes the week and who has never been asked', async () => {
    const res = await createApi(src()).trainingBoard();
    expect(res.status).toBe(200);
    const b = res.body as { owingThisWeek: string[]; rows: Array<{ crewMemberId: string; untestedTopics: string[] }> };
    expect(b.owingThisWeek).toEqual(['c2']);
    expect(b.rows.find((r) => r.crewMemberId === 'c1')!.untestedTopics).toEqual(['Fall protection']);
  });

  it('an unreadable pool NARROWS nothing silently — it is a named blind spot', async () => {
    const res = await createApi(src({
      trainingPool: async () => { throw new Error('db down'); },
    })).trainingBoard();
    const b = res.body as { blindSpots: string[] };
    expect(b.blindSpots.join(' ')).toMatch(/untested list is incomplete, not empty/i);
  });

  it('names a completions source that is not wired, distinct from one that failed', async () => {
    const res = await createApi(src({ gateCompletionsSince: undefined })).trainingBoard();
    const b = res.body as { blindSpots: string[]; rows: Array<{ completedThisWeek: boolean | null }> };
    expect(b.blindSpots.join(' ')).toMatch(/no source wired/i);
    expect(b.rows[0]!.completedThisWeek).toBeNull();
  });

  it('the week window matches the completions actually queried', async () => {
    let asked = '';
    const res = await createApi(src({
      gateCompletionsSince: async (iso) => { asked = iso; return []; },
    })).trainingBoard();
    expect((res.body as { weekStartIso: string }).weekStartIso).toBe(asked);
  });

  it('503s honestly with no database', async () => {
    const dead = createApi({ ready: () => false, stopsBetween: async () => [], newLeads: async () => [] });
    expect((await dead.trainingBoard()).status).toBe(503);
  });
});

describe('safety board — the unlessoned-incident count (§6M)', () => {
  const safetySrc = (over: Partial<DataSource> = {}): DataSource => ({
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [],
    activeCrew: async () => [],
    certifications: async () => [],
    recentNearMisses: async () => [
      { id: 'n1', occurredOn: '2026-08-01', hazardCategory: 'fall', description: 'x', hasTrainingItem: false },
      { id: 'n2', occurredOn: '2026-08-01', hazardCategory: 'fall', description: 'y', hasTrainingItem: true },
    ],
    ...over,
  });

  it('counts the incidents that have not become a lesson yet', async () => {
    const res = await createApi(safetySrc()).safety();
    expect((res.body as { nearMissesWithoutLesson: number | null }).nearMissesWithoutLesson).toBe(1);
  });

  it('§1B — a dead incident log reports UNKNOWN, never a closed loop', async () => {
    const res = await createApi(safetySrc({
      recentNearMisses: async () => { throw new Error('db down'); },
    })).safety();
    const b = res.body as { nearMissesWithoutLesson: number | null; blindSpots: string[] };
    // A 0 here would read as "every incident has a lesson" — the opposite.
    expect(b.nearMissesWithoutLesson).toBeNull();
    expect(b.blindSpots.join(' ')).toMatch(/could not read the incident log/i);
  });
});
