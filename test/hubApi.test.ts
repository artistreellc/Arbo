/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  ═══════════════════════════════════════════════════════════════════════

  These tests are the door to the knowledge hub. The rules they hold:

  1. A DEAD FEED IS NAMED, NEVER RENDERED AS A CONFIDENT ZERO (§1B). The
     failure that matters here is subtle: an unreadable library and an empty
     library both produce zero rows, and if the handler returns `[]` for both
     then a crew member opening the hub during an outage is told the company
     has no training material.
  2. NOTHING REACHES A CREW MEMBER THAT MIKE HAS NOT PASSED. Both gates —
     the piece and its source.
  3. A REJECTION NAMES WHICH BAR IT FAILED. safe / smart / fast, and a
     reason. The rejection reasons are the only written record of the
     standard, because he said the standard is learned as this is built.
*/
import { describe, it, expect } from 'vitest';
import { createApi, type DataSource } from '../src/server/api.js';
import {
  approve, reject, QUEUED,
  type ApprovedProfessional, type CuratedPiece, type TrainingProgram,
} from '../src/safety/curation.js';

const SRC_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const SRC_ID2 = 'aaaaaaaa-2222-2222-3333-444444444444';
const PIECE_ID = 'bbbbbbbb-1111-2222-3333-444444444444';
const PROG_ID = 'cccccccc-1111-2222-3333-444444444444';

const DEMO = {
  evidenceUrl: 'https://example.test/reel',
  whatItShows: 'Two full removals over a roof, tied in twice on every cut.',
  reviewedBy: 'Mike Campbell',
  reviewedOnIso: '2026-08-04T12:00:00Z',
};

function pro(over: Partial<ApprovedProfessional> = {}): ApprovedProfessional {
  return {
    id: SRC_ID,
    name: 'A Climber',
    discipline: 'climber',
    whyTrusted: 'Clean production work, twenty years, no shortcuts on camera.',
    credentialsClaimed: null,
    demonstrated: DEMO,
    approval: approve('Mike Campbell', '2026-08-04T12:00:00Z'),
    ...over,
  };
}

function piece(over: Partial<CuratedPiece> = {}): CuratedPiece {
  return {
    id: PIECE_ID,
    sourceId: SRC_ID,
    area: 'safety',
    format: 'clip',
    title: 'Tying in twice before the cut',
    url: 'https://example.test/clip-1',
    teaches: 'Setting the second point before the saw comes off the belt.',
    approval: approve('Mike Campbell', '2026-08-04T12:00:00Z'),
    ...over,
  };
}

function src(over: Partial<DataSource> = {}): DataSource {
  return {
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [],
    knowledgeSources: async () => [pro()],
    knowledgePieces: async () => [piece()],
    trainingPrograms: async () => [],
    queueKnowledgeSource: async () => SRC_ID,
    queueKnowledgePiece: async () => PIECE_ID,
    decideKnowledgeSource: async () => true,
    decideKnowledgePiece: async () => true,
    ...over,
  };
}

type HubBody = {
  headline: string;
  areas: Record<string, CuratedPiece[]> | null;
  gaps: { area: string; count: number }[] | null;
  programs: unknown[] | null;
  blockedPrograms: { id: string; operation: string; refusals: string[] }[] | null;
  counts: { servable: number; queued: number | null; approvedSources: number } | null;
  blindSpots: string[];
};

describe('GET /api/hub — §1B: an unread library and an empty one are different facts', () => {
  it('serves the approved material with a headline that counts it', async () => {
    const res = await createApi(src()).hub();
    expect(res.status).toBe(200);
    const b = res.body as HubBody;
    expect(b.blindSpots).toEqual([]);
    expect(b.counts).toMatchObject({ servable: 1, approvedSources: 1 });
    expect(b.areas!.safety).toHaveLength(1);
    expect(b.headline).toMatch(/1 piece\(s\) approved/);
  });

  it('A DEAD READ IS NAMED, and every countable field goes null rather than zero', async () => {
    const res = await createApi(src({
      knowledgePieces: async () => { throw new Error('supabase down'); },
    })).hub();
    const b = res.body as HubBody;
    expect(b.blindSpots.join(' ')).toMatch(/could not read/i);
    expect(b.counts).toBeNull();
    expect(b.areas).toBeNull();
    expect(b.headline).toMatch(/not an empty library/i);
    // The whole point: it must NOT read as "we have no training material".
    expect(b.headline).not.toMatch(/^The hub is empty/);
  });

  it('THE GAPS TRAP: an unread library must not report all seven pillars as empty', async () => {
    // hubGaps() on zero rows returns every pillar. Rendered during an outage
    // that is seven confident lies — "we have nothing on rigging, nothing on
    // felling…" — so gaps is null unless the read actually succeeded.
    const res = await createApi(src({
      knowledgeSources: async () => { throw new Error('down'); },
    })).hub();
    expect((res.body as HubBody).gaps).toBeNull();
  });

  it('a library that reads fine and is genuinely empty says so, and counts the queue', async () => {
    const res = await createApi(src({
      knowledgePieces: async () => [piece({ approval: QUEUED })],
    })).hub();
    const b = res.body as HubBody;
    expect(b.blindSpots).toEqual([]);
    expect(b.counts).toMatchObject({ servable: 0, queued: 1 });
    expect(b.headline).toMatch(/Nothing is approved into the hub yet\. 1 piece/);
  });

  it('names the empty pillars, because "nothing on rigging" is worth knowing', async () => {
    const b = (await createApi(src()).hub()).body as HubBody;
    const empty = b.gaps!.map((g) => g.area);
    expect(empty).toContain('rigging_mechanics');
    expect(empty).not.toContain('safety');
  });

  it('the programs read is a SEPARATE blind spot from the library read', async () => {
    const b = (await createApi(src({
      trainingPrograms: async () => { throw new Error('down'); },
    })).hub()).body as HubBody;
    // The library still read, so its counts are real.
    expect(b.counts).toMatchObject({ servable: 1 });
    expect(b.blindSpots.join(' ')).toMatch(/programs/);
    expect(b.programs).toBeNull();
  });
});

describe('GET /api/hub — both gates, on the serving path', () => {
  it('a piece whose SOURCE was never approved is not served, however good the piece is', async () => {
    const b = (await createApi(src({
      knowledgeSources: async () => [pro({ approval: QUEUED })],
    })).hub()).body as HubBody;
    expect(b.counts).toMatchObject({ servable: 0, approvedSources: 0 });
    expect(b.areas!.safety).toEqual([]);
  });

  it('an approved source with no demonstration on file is still not a gate-one pass', async () => {
    // The inversion: the certificate is optional, the proof is not. A row
    // approved before that rule existed does not get grandfathered in.
    const b = (await createApi(src({
      knowledgeSources: async () => [pro({ demonstrated: null, credentialsClaimed: 'ISA Certified Arborist' })],
    })).hub()).body as HubBody;
    expect(b.counts).toMatchObject({ servable: 0 });
  });

  it('a queued piece is never served', async () => {
    const b = (await createApi(src({
      knowledgePieces: async () => [piece({ approval: QUEUED })],
    })).hub()).body as HubBody;
    expect(b.areas!.safety).toEqual([]);
  });

  it('a rejected piece is never served', async () => {
    const b = (await createApi(src({
      knowledgePieces: async () => [piece({
        approval: reject('Mike Campbell', '2026-08-04T12:00:00Z', ['safe'], 'Single-tied at 2:40.'),
      })],
    })).hub()).body as HubBody;
    expect(b.areas!.safety).toEqual([]);
  });
});

describe('GET /api/hub — curricula', () => {
  const prog = (over: Partial<TrainingProgram> = {}): TrainingProgram => ({
    id: PROG_ID,
    operation: 'First day on a rope',
    summary: 'What a new climber does before they leave the ground.',
    pieceIds: [PIECE_ID],
    approval: approve('Mike Campbell', '2026-08-04T12:00:00Z'),
    ...over,
  });

  it('offers a program only when every step in it cleared both gates', async () => {
    const b = (await createApi(src({ trainingPrograms: async () => [prog()] })).hub()).body as HubBody;
    expect(b.programs).toHaveLength(1);
    expect(b.blockedPrograms).toEqual([]);
  });

  it('ONE unreviewed step blocks the whole curriculum, and says which step', async () => {
    const b = (await createApi(src({
      trainingPrograms: async () => [prog()],
      knowledgePieces: async () => [piece({ approval: QUEUED })],
    })).hub()).body as HubBody;
    expect(b.programs).toEqual([]);
    expect(b.blockedPrograms![0]!.refusals.join(' ')).toMatch(/Step 1 .* has not been reviewed/);
  });

  it('a blocked program is SHOWN, not silently absent', async () => {
    // A half-built curriculum that simply does not appear sits unnoticed for
    // a month. Naming what it is waiting on is how it gets finished.
    const b = (await createApi(src({
      trainingPrograms: async () => [prog({ approval: QUEUED })],
    })).hub()).body as HubBody;
    expect(b.blockedPrograms).toHaveLength(1);
    expect(b.blockedPrograms![0]!.operation).toBe('First day on a rope');
  });
});

describe('GET /api/hub/queue — what is waiting on Mike', () => {
  it('a read failure is NOT an empty queue', async () => {
    const res = await createApi(src({
      knowledgePieces: async () => { throw new Error('down'); },
    })).hubQueue();
    const b = res.body as { unreadable: boolean; line: string };
    expect(b.unreadable).toBe(true);
    expect(b.line).toMatch(/could not be read/i);
    // If this said "nothing waiting on you", he would stop checking.
    expect(b.line).not.toMatch(/nothing waiting/i);
  });

  it('puts the pieces carrying a specific doubt in front of the rest', async () => {
    const plain = piece({ id: PIECE_ID, approval: QUEUED, title: 'Plain' });
    const flagged = piece({
      id: SRC_ID2, approval: QUEUED, title: 'Flagged',
      url: 'https://example.test/clip-2',
      queuedNote: 'Clean climb but single-tied at 2:40 — no, or fine for that species?',
    });
    const b = (await createApi(src({
      knowledgePieces: async () => [plain, flagged],
    })).hubQueue()).body as { pieces: { title: string }[]; counts: { flagged: number } };
    expect(b.pieces[0]!.title).toBe('Flagged');
    expect(b.counts.flagged).toBe(1);
  });

  it('says when a queued piece comes from a source that has not cleared gate one', async () => {
    const b = (await createApi(src({
      knowledgeSources: async () => [pro({ approval: QUEUED })],
      knowledgePieces: async () => [piece({ approval: QUEUED })],
    })).hubQueue()).body as { pieces: { sourceApproved: boolean }[] };
    // Approving this piece would change nothing — servable() still drops it.
    expect(b.pieces[0]!.sourceApproved).toBe(false);
  });

  it('shows what is BLOCKING a queued source from being approvable at all', async () => {
    const b = (await createApi(src({
      knowledgeSources: async () => [pro({
        approval: QUEUED, demonstrated: null, credentialsClaimed: 'ISA Certified Arborist',
      })],
    })).hubQueue()).body as { sources: { blockers: string[] }[] };
    expect(b.sources[0]!.blockers.join(' ')).toMatch(/SHOW safe production work/);
  });

  it('KEEPS the rejections, with the bar and the reason — they are the standard', async () => {
    const b = (await createApi(src({
      knowledgePieces: async () => [piece({
        approval: reject('Mike Campbell', '2026-08-04T12:00:00Z', ['safe', 'smart'], 'Single-tied at 2:40.'),
      })],
    })).hubQueue()).body as {
      turnedDown: { failed: string[]; reason: string; decidedBy: string }[];
    };
    expect(b.turnedDown[0]).toMatchObject({
      failed: ['safe', 'smart'], reason: 'Single-tied at 2:40.', decidedBy: 'Mike Campbell',
    });
  });
});

describe('POST /api/hub/pieces — queueing', () => {
  it('refuses a cold link: what it teaches is required', async () => {
    const res = await createApi(src()).queueHubPiece({
      sourceId: SRC_ID, area: 'safety', format: 'clip',
      title: 'Something', url: 'https://example.test/x', teaches: '',
    });
    expect(res).toMatchObject({ status: 400, body: { error: 'teaches_required' } });
  });

  it('refuses a pillar that is not one of the seven — there is no "other"', async () => {
    const res = await createApi(src()).queueHubPiece({
      sourceId: SRC_ID, area: 'crypto', format: 'clip',
      title: 'x', url: 'https://example.test/x', teaches: 'y',
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('bad_area');
  });

  it('anything queued starts QUEUED — approved is not a state a caller can ask for', async () => {
    const res = await createApi(src()).queueHubPiece({
      sourceId: SRC_ID, area: 'safety', format: 'clip',
      title: 'x', url: 'https://example.test/x', teaches: 'y',
      approval: { state: 'approved' },
    });
    expect(res.body).toMatchObject({ state: 'queued' });
  });
});

describe('POST /api/hub/sources — queueing a professional', () => {
  it('a half-filled demonstration is refused — that is not a proof', async () => {
    const res = await createApi(src()).queueHubSource({
      name: 'Someone', discipline: 'climber', whyTrusted: 'because',
      demonstrated: { evidenceUrl: 'https://example.test/x', whatItShows: '', reviewedBy: 'Mike' },
    });
    expect(res).toMatchObject({ status: 400, body: { error: 'incomplete_demonstration' } });
  });

  it('accepts a professional with no certificate at all', async () => {
    // The inversion, stated by Mike: not being ISA certified does not stop us
    // learning from somebody who can show they are a safe production climber.
    const res = await createApi(src()).queueHubSource({
      name: 'Someone', discipline: 'logger', whyTrusted: 'Best faller I have watched.',
      credentialsClaimed: null, demonstrated: DEMO,
    });
    expect(res.status).toBe(200);
  });

  it('refuses a trade outside the three', async () => {
    const res = await createApi(src()).queueHubSource({
      name: 'Someone', discipline: 'influencer', whyTrusted: 'lots of views',
    });
    expect(res).toMatchObject({ status: 400, body: { error: 'bad_discipline' } });
  });
});

describe('POST /api/hub/:kind/:id/decision — the judgement', () => {
  it('a rejection that names no failed bar is refused — that is a shrug, not a judgement', async () => {
    const res = await createApi(src()).decideHubItem('piece', PIECE_ID, {
      decidedBy: 'Mike Campbell', verdict: 'reject', failed: [], reason: 'no',
    });
    expect(res).toMatchObject({ status: 400, body: { error: 'failed_bar_required' } });
  });

  it('a rejection with no reason is refused — the next queuer needs to know which thing was wrong', async () => {
    const res = await createApi(src()).decideHubItem('piece', PIECE_ID, {
      decidedBy: 'Mike Campbell', verdict: 'reject', failed: ['fast'], reason: '  ',
    });
    expect(res).toMatchObject({ status: 400, body: { error: 'reason_required' } });
  });

  it('a decision with nobody behind it is not a decision', async () => {
    const res = await createApi(src()).decideHubItem('piece', PIECE_ID, {
      decidedBy: '', verdict: 'approve',
    });
    expect(res).toMatchObject({ status: 400, body: { error: 'decided_by_required' } });
  });

  it('only safe / smart / fast may be named as a failed bar', async () => {
    const res = await createApi(src()).decideHubItem('piece', PIECE_ID, {
      decidedBy: 'Mike Campbell', verdict: 'reject', failed: ['boring'], reason: 'no',
    });
    expect(res).toMatchObject({ status: 400, body: { error: 'bad_standard' } });
  });

  it('records an approval with the name and the state', async () => {
    const res = await createApi(src()).decideHubItem('piece', PIECE_ID, {
      decidedBy: 'Mike Campbell', verdict: 'approve',
    });
    expect(res).toMatchObject({ status: 200, body: { state: 'approved' } });
  });

  it('REFUSES to approve a source nobody has watched work, before the write', async () => {
    // Otherwise the row goes in, servable() ignores it anyway, and the
    // decision looks taken while changing nothing.
    const res = await createApi(src({
      knowledgeSources: async () => [pro({ approval: QUEUED, demonstrated: null })],
    })).decideHubItem('source', SRC_ID, { decidedBy: 'Mike Campbell', verdict: 'approve' });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('cannot_approve');
  });

  it('a second decision on an already-decided row is a 409, never a silent success', async () => {
    const res = await createApi(src({
      decideKnowledgePiece: async () => false,
    })).decideHubItem('piece', PIECE_ID, { decidedBy: 'Mike Campbell', verdict: 'approve' });
    expect(res.status).toBe(409);
  });
});

describe('the three holes the adversarial review of this diff found', () => {
  it('FAILS CLOSED: an unrunnable gate-one check refuses the approval, never skips it', async () => {
    // First version read `&& source.knowledgeSources`, so an unwired read
    // silently bypassed the demonstration gate. Not being able to check is a
    // reason to refuse.
    const api = createApi(src({ knowledgeSources: undefined }));
    const res = await api.decideHubItem('source', SRC_ID, {
      decidedBy: 'Mike Campbell', verdict: 'approve',
    });
    expect(res.status).toBe(503);
  });

  it('a duplicate link is a sentence about what already happened to it, not a 500', async () => {
    const dup = Object.assign(new Error('duplicate key'), { code: '23505' });
    const res = await createApi(src({
      queueKnowledgePiece: async () => { throw dup; },
    })).queueHubPiece({
      sourceId: SRC_ID, area: 'safety', format: 'clip',
      title: 'x', url: 'https://example.test/clip-1', teaches: 'y',
    });
    expect(res).toMatchObject({ status: 409, body: { error: 'already_on_file' } });
  });

  it('a real database fault still surfaces as a fault — 23505 is not a catch-all', async () => {
    await expect(createApi(src({
      queueKnowledgePiece: async () => { throw new Error('connection reset'); },
    })).queueHubPiece({
      sourceId: SRC_ID, area: 'safety', format: 'clip',
      title: 'x', url: 'https://example.test/x', teaches: 'y',
    })).rejects.toThrow(/connection reset/);
  });
});
