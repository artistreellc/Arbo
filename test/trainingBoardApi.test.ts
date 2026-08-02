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
