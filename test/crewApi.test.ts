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
import { describe, it, expect, vi } from 'vitest';
import { createApi, type DataSource, type CrewJobSource } from '../src/server/api.js';
import { createSimSource } from '../src/dev/simSource.js';

const job = (over: Partial<CrewJobSource> = {}): CrewJobSource => ({
  jobId: 'j1', scheduledFor: '2026-08-05T13:00:00Z', address: '123 Oak St',
  city: 'Virginia Beach', scope: 'Remove leaning pine',
  hazardPowerLines: false, hazardStructures: false, permitStatus: null,
  propertyId: 'p1', ...over,
});

/**
 * R9: every job here has a filed contract unless a test says otherwise.
 * Under Mike's ruling (2026-08-04) a job IS a proposal that became a filed
 * contract, so a fixture without one is not a work order — which is exactly
 * what the boundary tests below check.
 */
function crewSource(
  jobs: CrewJobSource[],
  onAck?: (i: unknown) => void,
  contracted: 'all' | 'none' | string[] = 'all',
): DataSource {
  return {
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [],
    crewJobs: async () => jobs,
    jobsWithFiledContract: async (ids) =>
      contracted === 'all' ? new Set(ids)
      : contracted === 'none' ? new Set<string>()
      : new Set(contracted),
    recordBriefingAck: async (input) => {
      onAck?.(input);
      return { trainingEventId: 'te1', timeEntryId: 'time1' };
    },
    // Deliberately added (CREW_PLAN C3, D109): the sign-off is paid time, and
    // Q7 refuses it unless the roster says the code is on it (fail closed with
    // no lookup). These fixtures are about the gate, so the code is on it.
    crewMember: async () => ({ name: 'SIM-Alder, Test', active: true }),
    // Deliberately added (CREW_PLAN C4, D109): the server checks the sign-off
    // against ITS briefing for today; these fixtures sign that same briefing.
    todaysBriefing: async () => ({ id: '33333333-3333-3333-3333-333333333333', body: 'Watch the drop zone. Call every cut.', standardRefs: ['Z133 §8.1'] }),
  };
}

describe('crew work orders (§6F) — the API cannot leak admin data', () => {
  it('returns the day in route order, renumbered', async () => {
    const api = createApi(crewSource([
      job({ jobId: 'late', scheduledFor: '2026-08-05T20:00:00Z' }),
      job({ jobId: 'early', scheduledFor: '2026-08-05T12:00:00Z' }),
    ]));
    const res = await api.crewWorkOrders('2026-08-05');
    expect(res.status).toBe(200);
    const wos = (res.body as { workOrders: Array<{ jobId: string; routeOrder: number }> }).workOrders;
    expect(wos.map((w) => w.jobId)).toEqual(['early', 'late']);
    expect(wos.map((w) => w.routeOrder)).toEqual([1, 2]);
  });

  it('never emits price, tracking, or customer contact — at the API boundary', async () => {
    const api = createApi(crewSource([job({ hazardPowerLines: true, permitStatus: 'PERMIT_LIKELY' })]));
    const res = await api.crewWorkOrders('2026-08-05');
    const json = JSON.stringify(res.body).toLowerCase();
    for (const forbidden of ['price', 'quote', 'margin', 'phone', 'email', 'quality', 'tracking', 'bouncie', 'leakage']) {
      expect(json, `crew payload leaked "${forbidden}"`).not.toContain(forbidden);
    }
    expect(json).not.toMatch(/\$\s?\d/);
  });

  it('carries a permit WARNING but never a clear (§6B.3)', async () => {
    const api = createApi(crewSource([job({ permitStatus: 'NO_OVERLAY_VERIFY' })]));
    const res = await api.crewWorkOrders('2026-08-05');
    const note = (res.body as { workOrders: Array<{ permitNote: string | null }> }).workOrders[0]!.permitNote!;
    expect(note).toMatch(/verify/i);
    expect(note.toLowerCase()).not.toMatch(/you'?re clear|all clear|good to cut/);
  });

  it('ignores a garbage permit status rather than inventing a note', async () => {
    const api = createApi(crewSource([job({ permitStatus: 'TOTALLY_FINE' })]));
    const res = await api.crewWorkOrders('2026-08-05');
    expect((res.body as { workOrders: Array<{ permitNote: string | null }> }).workOrders[0]!.permitNote).toBeNull();
  });

  it('503s honestly when the database is not configured', async () => {
    const api = createApi({ ready: () => false, stopsBetween: async () => [], newLeads: async () => [] });
    expect((await api.crewWorkOrders('2026-08-05')).status).toBe(503);
  });

  // ── R9, the lead/job boundary. Mike, 2026-08-04: "Booked jobs are those
  // contracts that you're putting in the signed contract file... Everything
  // else is a potential lead." This is the last gate before a row becomes a
  // work order on a crew phone, so these are the tests that matter most.
  it('a scheduled job with NO filed contract is not a work order', async () => {
    const api = createApi(crewSource([job({ jobId: 'nocontract' })], undefined, 'none'));
    const res = await api.crewWorkOrders('2026-08-05');
    const body = res.body as { workOrders: unknown[]; notWorkOrders: number; boundaryNote: string };
    expect(body.workOrders).toHaveLength(0);
    // NAMED, not silently dropped — a short day Mike cannot explain is its
    // own §1B failure.
    expect(body.notWorkOrders).toBe(1);
    expect(body.boundaryNote).toMatch(/no signed contract/i);
  });

  it('dispatches only the jobs that have one, and counts the rest', async () => {
    const api = createApi(crewSource(
      [job({ jobId: 'signed' }), job({ jobId: 'unsigned' })],
      undefined,
      ['signed'],
    ));
    const body = (await api.crewWorkOrders('2026-08-05')).body as
      { workOrders: Array<{ jobId: string }>; notWorkOrders: number };
    expect(body.workOrders.map((w) => w.jobId)).toEqual(['signed']);
    expect(body.notWorkOrders).toBe(1);
  });

  it('FAILS CLOSED when the contract table cannot be read', async () => {
    // An unreadable contract table is not evidence of a contract. The
    // expensive failure is a crew cutting a tree with nothing behind it.
    const api = createApi({
      ready: () => true,
      stopsBetween: async () => [],
      newLeads: async () => [],
      crewJobs: async () => [job({ jobId: 'x' })],
      jobsWithFiledContract: async () => {
        throw new Error('contract table unreadable');
      },
    });
    const body = (await api.crewWorkOrders('2026-08-05')).body as
      { workOrders: unknown[]; boundaryNote: string };
    expect(body.workOrders).toHaveLength(0);
    // And it says WHICH failure this is — not an empty day, an unreadable one.
    expect(body.boundaryNote).toMatch(/could not read/i);
    expect(body.boundaryNote).toMatch(/not an empty day/i);
  });

  it('a source with no contract lookup at all dispatches nothing', async () => {
    // The 11 rows already in production have zero contracts behind them. A
    // source that cannot answer the question must not be read as a yes.
    const api = createApi({
      ready: () => true,
      stopsBetween: async () => [],
      newLeads: async () => [],
      crewJobs: async () => [job({ jobId: 'x' })],
    });
    const body = (await api.crewWorkOrders('2026-08-05')).body as { workOrders: unknown[] };
    expect(body.workOrders).toHaveLength(0);
  });

  // §1B on the crew phone: "could not read the contract list" and "every job
  // is held back" are different days. The page reads a FLAG for the first,
  // never the sentence written for Mike.
  it('flags an unreadable contract list so the page cannot draw it as an empty day', async () => {
    const api = createApi({
      ready: () => true,
      stopsBetween: async () => [],
      newLeads: async () => [],
      crewJobs: async () => [job({ jobId: 'x' })],
      jobsWithFiledContract: async () => { throw new Error('contract table unreadable'); },
    });
    const body = (await api.crewWorkOrders('2026-08-05')).body as { workOrders: unknown[]; contractLookupFailed: boolean };
    expect(body.contractLookupFailed).toBe(true);
    expect(body.workOrders).toHaveLength(0);
  });

  it('a readable list with jobs held back is NOT flagged as unreadable', async () => {
    const api = createApi(crewSource([job({ jobId: 'nocontract' })], undefined, 'none'));
    const body = (await api.crewWorkOrders('2026-08-05')).body as { contractLookupFailed: boolean; notWorkOrders: number };
    expect(body.contractLookupFailed).toBe(false);
    expect(body.notWorkOrders).toBe(1);
  });

  // Deliberately rewritten (CREW_PLAN C2, D107): the practice data now files a
  // contract for one SIM job and not the other, so the practice crew day draws
  // one work-order card AND the named held line. Its meaning is kept: R9 still
  // decides per job, and an unreadable contract list still dispatches nothing —
  // that case moved to a stub source over the same practice day.
  it('the practice data files one SIM job and holds the other: one work order, one held, read — not unreadable', async () => {
    const res = await createApi(createSimSource(), { dataLinksSim: true }).crewWorkOrders('');
    expect(res.status).toBe(200);
    const body = res.body as { workOrders: Array<{ jobId: string }>; contractLookupFailed: boolean; notWorkOrders: number };
    expect(body.contractLookupFailed).toBe(false);
    expect(body.workOrders.map((w) => w.jobId)).toEqual(['sim-job-1']);
    expect(body.notWorkOrders).toBe(1);
  });

  it('the same practice day with an unreadable contract list is flagged unreadable and dispatches nothing', async () => {
    const unreadable: DataSource = {
      ...createSimSource(),
      jobsWithFiledContract: async () => { throw new Error('SIMULATED contract list unreadable'); },
    };
    const res = await createApi(unreadable, { dataLinksSim: true }).crewWorkOrders('');
    expect(res.status).toBe(200);
    const body = res.body as { workOrders: unknown[]; contractLookupFailed: boolean; notWorkOrders: number };
    expect(body.contractLookupFailed).toBe(true);
    expect(body.workOrders).toEqual([]);
    expect(body.notWorkOrders).toBeGreaterThan(0);
  });
});

describe('gated briefing over the API (§6V.4 / §4.6)', () => {
  const content = { id: '33333333-3333-3333-3333-333333333333', body: 'Watch the drop zone. Call every cut.', standardRefs: ['Z133 §8.1'] };
  // A crew code is a uuid: a mistyped one is now a 400 bad_crew_id (QA round 2),
  // so these fixtures carry a well-formed one.
  const c1 = '44444444-4444-4444-8444-444444444444';

  it('a half-completed gate does NOT unlock and names what is missing', async () => {
    const api = createApi(crewSource([]));
    const res = await api.ackBriefing({
      crewMemberId: c1, content,
      state: { scrolledToBottom: true, checkboxTicked: false, secondsOnScreen: 40 },
      startedAtIso: '2026-08-05T10:00:00Z', completedAtIso: '2026-08-05T10:00:40Z',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ unlocked: false, missing: ['checkbox'] });
  });

  it('a passing gate unlocks AND writes payable time', async () => {
    let recorded: unknown = null;
    const api = createApi(crewSource([], (i) => { recorded = i; }));
    const res = await api.ackBriefing({
      crewMemberId: c1, content,
      state: { scrolledToBottom: true, checkboxTicked: true, secondsOnScreen: 12 },
      startedAtIso: '2026-08-05T10:00:00Z', completedAtIso: '2026-08-05T10:00:12Z',
    });
    expect(res.body).toMatchObject({ unlocked: true, trainingEventId: 'te1', timeEntryId: 'time1' });
    expect((recorded as { payableMinutes: number }).payableMinutes).toBeGreaterThanOrEqual(1);
  });

  it('rejects a malformed request instead of guessing', async () => {
    const api = createApi(crewSource([]));
    expect((await api.ackBriefing({ crewMemberId: '', content, state: {} })).status).toBe(400);
    expect((await api.ackBriefing({
      crewMemberId: c1, content, state: {},
      startedAtIso: 'not-a-time', completedAtIso: 'nope',
    })).status).toBe(400);
  });

  it('rejects a reversed span — a client clock cannot mint negative time', async () => {
    const api = createApi(crewSource([]));
    const res = await api.ackBriefing({
      crewMemberId: c1, content,
      state: { scrolledToBottom: true, checkboxTicked: true, secondsOnScreen: 20 },
      startedAtIso: '2026-08-05T10:05:00Z', completedAtIso: '2026-08-05T10:00:00Z',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a non-UUID briefing id (uuid[] would commit PAID time then fail)', async () => {
    const api = createApi(crewSource([]));
    const res = await api.ackBriefing({
      crewMemberId: c1, content: { id: 'b1', body: 'x', standardRefs: [] },
      state: { scrolledToBottom: true, checkboxTicked: true, secondsOnScreen: 20 },
      startedAtIso: '2026-08-05T10:00:00Z', completedAtIso: '2026-08-05T10:00:20Z',
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'bad_item_id' });
  });

  it('clamps payable minutes — a year-long span cannot become a payroll row', async () => {
    let recorded: { payableMinutes: number } | null = null;
    const api = createApi(crewSource([], (i) => { recorded = i as { payableMinutes: number }; }));
    await api.ackBriefing({
      crewMemberId: c1, content,
      state: { scrolledToBottom: true, checkboxTicked: true, secondsOnScreen: 9999 },
      startedAtIso: '2025-08-05T00:00:00Z', completedAtIso: '2026-08-05T00:00:00Z',
    });
    expect(recorded!.payableMinutes).toBeLessThanOrEqual(15);
  });
});

describe('GET /api/crew/reference (§6U) — the handler cannot overstate itself', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    id: 'e1', techniqueName: 'Natural crotch rigging', skillLevel: 5,
    howTo: 'Run the line over a strong union.', pros: ['No hardware'], cons: ['Friction'],
    wontWorkWhen: 'Included bark in the union.', sourceLink: null,
    standardRefs: ['Z133 §8.1'], published: true, ...over,
  });
  const libSource = (over: Partial<DataSource> = {}): DataSource => ({
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [],
    referenceEntries: async () => [entry()],
    ...over,
  });
  const UUID = '11111111-1111-4111-8111-111111111111';

  it('returns published entries with their clause citations', async () => {
    const res = await createApi(libSource()).crewReference('rigging', '');
    expect(res.status).toBe(200);
    const body = res.body as { entries: Array<{ standardRefs: string[] }> };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.standardRefs).toEqual(['Z133 §8.1']);
  });

  it('holds an unvetted draft back and COUNTS it (§4.7/§1B)', async () => {
    const api = createApi(libSource({
      referenceEntries: async () => [entry(), entry({ id: 'e2', published: false })],
    }));
    const body = (await api.crewReference('rigging', '')).body as
      { entries: unknown[]; unpublishedHeld: number };
    expect(body.entries).toHaveLength(1);
    expect(body.unpublishedHeld).toBe(1);
  });

  it('reports skillKnown=false when the level could not be resolved', async () => {
    // No crew id at all, a non-UUID crew code, a member with no level on file,
    // and a failed read are all the SAME fact: nothing was checked. Claiming
    // otherwise turns "unchecked" into "nothing is above your level".
    const api = createApi(libSource({ crewSkillLevel: async () => 3 }));
    for (const id of ['', 'CREW-7']) {
      expect((await api.crewReference('', id)).body).toMatchObject({ skillKnown: false });
    }
    const noLevel = createApi(libSource({ crewSkillLevel: async () => null }));
    expect((await noLevel.crewReference('', UUID)).body).toMatchObject({ skillKnown: false });
    const broken = createApi(libSource({ crewSkillLevel: async () => { throw new Error('down'); } }));
    expect((await broken.crewReference('', UUID)).body).toMatchObject({ skillKnown: false });
  });

  it('an unresolved level never HIDES an entry — it only drops the flag', async () => {
    const broken = createApi(libSource({ crewSkillLevel: async () => { throw new Error('down'); } }));
    const body = (await broken.crewReference('rigging', UUID)).body as
      { entries: Array<{ aboveSkillLevel: boolean }>; skillKnown: boolean };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.aboveSkillLevel).toBe(false);
    expect(body.skillKnown).toBe(false);
  });

  it('flags an entry above a KNOWN level', async () => {
    const api = createApi(libSource({ crewSkillLevel: async () => 2 }));
    const body = (await api.crewReference('rigging', UUID)).body as
      { entries: Array<{ aboveSkillLevel: boolean }>; skillKnown: boolean };
    expect(body.skillKnown).toBe(true);
    expect(body.entries[0]!.aboveSkillLevel).toBe(true);
  });

  it('says 503 rather than an empty library when the DB is not configured (§1B)', async () => {
    const res = await createApi({ ready: () => false, stopsBetween: async () => [], newLeads: async () => [] })
      .crewReference('rigging', '');
    expect(res.status).toBe(503);
  });

  it('never emits money or customer contact on the crew surface (§8C)', async () => {
    const res = await createApi(libSource()).crewReference('rigging', '');
    const json = JSON.stringify(res.body).toLowerCase();
    for (const term of ['price', 'amount', 'invoice', 'phone', 'email']) {
      expect(json, `crew reference payload leaked "${term}"`).not.toContain(term);
    }
  });
});

describe('reference library authoring (§4.7) — nothing reaches a phone unsigned', () => {
  const drafted: Array<Record<string, unknown>> = [];
  const authoringSource = (over: Partial<DataSource> = {}): DataSource => ({
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [],
    createReferenceEntry: async (input) => { drafted.push(input as Record<string, unknown>); return 'new-id'; },
    publishReferenceEntry: async () => true,
    draftReferenceEntries: async () => [],
    ...over,
  });
  const UUID = '11111111-1111-4111-8111-111111111111';

  it('a new entry is a DRAFT, and the response says it is still invisible', async () => {
    drafted.length = 0;
    const res = await createApi(authoringSource()).createReferenceEntry({
      techniqueName: 'Speed line', howTo: 'Tension a line to a remote anchor.',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ published: false });
    expect((res.body as { line: string }).line).toContain('until somebody signs it off');
    // published is never a field a caller can set.
    expect(drafted[0]).not.toHaveProperty('published');
  });

  it('drops prose masquerading as a citation at the WRITE boundary (§6U.3)', async () => {
    drafted.length = 0;
    const res = await createApi(authoringSource()).createReferenceEntry({
      techniqueName: 'Speed line', howTo: 'x',
      standardRefs: ['Z133 §8.1', 'Employers shall ensure that each employee is trained in the hazards'],
    });
    expect(res.body).toMatchObject({ refsDropped: 1 });
    expect(drafted[0]!.standardRefs).toEqual(['Z133 §8.1']);
  });

  it('says when an entry went in with no limits recorded (§1B)', async () => {
    const api = createApi(authoringSource());
    expect((await api.createReferenceEntry({ techniqueName: 'a', howTo: 'b' })).body)
      .toMatchObject({ limitsMissing: true });
    expect((await api.createReferenceEntry({ techniqueName: 'a', howTo: 'b', wontWorkWhen: 'Included bark.' })).body)
      .toMatchObject({ limitsMissing: false });
  });

  it('refuses a source link that is not http(s)', async () => {
    const res = await createApi(authoringSource()).createReferenceEntry({
      techniqueName: 'a', howTo: 'b', sourceLink: 'javascript:alert(1)',
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'bad_source_link' });
  });

  it('clamps the skill level instead of storing nonsense', async () => {
    drafted.length = 0;
    const api = createApi(authoringSource());
    await api.createReferenceEntry({ techniqueName: 'a', howTo: 'b', skillLevel: 99 });
    await api.createReferenceEntry({ techniqueName: 'a', howTo: 'b', skillLevel: -4 });
    await api.createReferenceEntry({ techniqueName: 'a', howTo: 'b', skillLevel: 'banana' });
    expect(drafted.map((d) => d.skillLevel)).toEqual([10, 1, 1]);
  });

  it('will not publish without a named human (§4.7)', async () => {
    const res = await createApi(authoringSource()).publishReferenceEntry(UUID, {});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'vetter_required' });
  });

  it('does not report a fresh publish over an already-published entry', async () => {
    const res = await createApi(authoringSource({ publishReferenceEntry: async () => false }))
      .publishReferenceEntry(UUID, { vettedBy: 'Mike' });
    expect(res.status).toBe(409);
  });

  it('the vetting queue names what is MISSING before anyone signs off (§1B)', async () => {
    const api = createApi(authoringSource({
      draftReferenceEntries: async () => [{
        id: 'd1', techniqueName: 'Speed line', skillLevel: 6, howTo: 'x',
        pros: [], cons: [], wontWorkWhen: null, sourceLink: null,
        standardRefs: ['not a clause, just some prose about it'], createdAt: '2026-08-01T00:00:00Z',
      }],
    }));
    const body = (await api.referenceDrafts()).body as
      { drafts: Array<{ gaps: string[]; standardRefs: string[]; refsDropped: number }> };
    const d = body.drafts[0]!;
    expect(d.gaps.some((g) => g.includes('No limits recorded'))).toBe(true);
    expect(d.gaps.some((g) => g.includes('No clause citation'))).toBe(true);
    expect(d.gaps.some((g) => g.includes('not clause citations'))).toBe(true);
    expect(d.standardRefs).toEqual([]);
    expect(d.refsDropped).toBe(1);
  });

  it('says 503 rather than an empty queue when the DB is not configured (§1B)', async () => {
    const dead = createApi({ ready: () => false, stopsBetween: async () => [], newLeads: async () => [] });
    expect((await dead.referenceDrafts()).status).toBe(503);
    expect((await dead.createReferenceEntry({ techniqueName: 'a', howTo: 'b' })).status).toBe(503);
  });
});

describe('the roster (§4) — the safety board needs people to check', () => {
  const person = (over = {}) => ({ id: 'p1', name: 'Dee', role: 'climber', competencyLevel: 5, active: true, ...over });
  const rosterSource = (over: Partial<DataSource> = {}): DataSource => ({
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [],
    fullRoster: async () => [person()],
    certifications: async () => [{ id: 'c1', crewMemberId: 'p1', type: 'first_aid', expiresOn: '2027-01-01' }],
    createCrewMember: async () => 'new-id',
    deactivateCrewMember: async () => true,
    recordCertification: async () => 'cert-id',
    ...over,
  });
  const UUID = '11111111-1111-4111-8111-111111111111';

  it('counts cards on file per person', async () => {
    const body = (await createApi(rosterSource()).roster()).body as
      { people: Array<{ certCount: number | null }>; certsKnown: boolean; activeCount: number };
    expect(body.certsKnown).toBe(true);
    expect(body.people[0]!.certCount).toBe(1);
    expect(body.activeCount).toBe(1);
  });

  it('unreadable cards are UNKNOWN, never zero (§1B)', async () => {
    const api = createApi(rosterSource({ certifications: async () => { throw new Error('down'); } }));
    const body = (await api.roster()).body as
      { people: Array<{ certCount: number | null }>; certsKnown: boolean };
    expect(body.certsKnown).toBe(false);
    expect(body.people[0]!.certCount).toBeNull();
  });

  it('an unrecognised role is accepted and FLAGGED, not silently normalised', async () => {
    // certifications.ts gives an unknown role the STRICTEST requirements. That
    // is right, and surprising, so the caller is told it happened.
    const res = await createApi(rosterSource()).createCrewMember({ name: 'Sam', role: 'Bucket Op' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ role: 'bucket op', roleRecognised: false });
    expect((res.body as { line: string }).line).toContain('STRICTEST');
  });

  it('needs a name, and clamps the skill level', async () => {
    const created: Array<{ competencyLevel: number }> = [];
    const api = createApi(rosterSource({
      createCrewMember: async (i) => { created.push(i); return 'x'; },
    }));
    expect((await api.createCrewMember({ name: '  ' })).status).toBe(400);
    await api.createCrewMember({ name: 'A', competencyLevel: 44 });
    await api.createCrewMember({ name: 'B', competencyLevel: 0 });
    expect(created.map((c) => c.competencyLevel)).toEqual([10, 1]);
  });

  it('a card with no expiry is recorded and reported as UNKNOWN, not current', async () => {
    const res = await createApi(rosterSource()).recordCertification(UUID, { type: 'cpr' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ expiryKnown: false, expiresOn: null });
    expect((res.body as { line: string }).line).toContain('UNKNOWN');
  });

  it('an unparseable expiry is REJECTED rather than becoming "no expiry"', async () => {
    // Silently dropping it would turn a tracked card into an invisible one.
    const res = await createApi(rosterSource()).recordCertification(UUID, { type: 'cpr', expiresOn: 'next spring' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'bad_expiry_date' });
  });

  it('refuses a cert type the safety module cannot reason about', async () => {
    const res = await createApi(rosterSource()).recordCertification(UUID, { type: 'chainsaw_vibes' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'bad_cert_type' });
  });

  it('taking somebody off the roster twice is a 409, not a second success', async () => {
    const res = await createApi(rosterSource({ deactivateCrewMember: async () => false })).deactivateCrewMember(UUID);
    expect(res.status).toBe(409);
  });

  it('says 503 rather than an empty roster when the DB is not configured (§1B)', async () => {
    const dead = createApi({ ready: () => false, stopsBetween: async () => [], newLeads: async () => [] });
    expect((await dead.roster()).status).toBe(503);
    expect((await dead.createCrewMember({ name: 'A' })).status).toBe(503);
    expect((await dead.recordCertification(UUID, { type: 'cpr' })).status).toBe(503);
  });
});

describe('fleet + campaign registries (§6E/§6D) — the last read-only tables', () => {
  const regSource = (over: Partial<DataSource> = {}): DataSource => ({
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [],
    createEquipmentUnit: async () => 'unit-id',
    retireEquipmentUnit: async () => true,
    addEquipmentPart: async () => 'part-id',
    createCampaign: async () => 'camp-id',
    ...over,
  });
  const UUID = '11111111-1111-4111-8111-111111111111';

  it('a unit with no measurements is accepted and told it routes as UNKNOWN', async () => {
    // §6M2.4 trusts a number and stays conservative on a null, so an absent
    // measurement is safer than a guess — but the caller has to KNOW which.
    const res = await createApi(regSource()).createEquipmentUnit({
      name: 'Chip truck 1', kind: 'chip truck', vinOrSerial: 'VIN1',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ heightInches: null, weightLbsLoaded: null, dimensionsKnown: false });
    expect((res.body as { line: string }).line).toContain('UNKNOWN');
  });

  it('measurements that are given are kept and reported as known', async () => {
    const res = await createApi(regSource()).createEquipmentUnit({
      name: 'A', kind: 'chipper', vinOrSerial: 'VIN2', heightInches: '138', weightLbsLoaded: 26000,
    });
    expect(res.body).toMatchObject({ heightInches: 138, weightLbsLoaded: 26000, dimensionsKnown: true });
  });

  it('a junk measurement becomes UNKNOWN rather than a bogus clearance', async () => {
    const res = await createApi(regSource()).createEquipmentUnit({
      name: 'A', kind: 'chipper', vinOrSerial: 'VIN3', heightInches: 'tall-ish', weightLbsLoaded: -5,
    });
    expect(res.body).toMatchObject({ heightInches: null, weightLbsLoaded: null });
  });

  it('a duplicate VIN is a 409, not a 500 — as Supabase ACTUALLY rejects it', async () => {
    // The first version of this test threw `new Error(...)` and the handler
    // matched on the message. Supabase rejects with a PostgrestError — a plain
    // object, NOT an Error — so the check never fired in production and every
    // duplicate came back a 500. Throw the real shape, match on the SQLSTATE.
    const api = createApi(regSource({
      createEquipmentUnit: async () => {
        throw { code: '23505', message: 'duplicate key value violates unique constraint', details: null, hint: null };
      },
    }));
    const res = await api.createEquipmentUnit({ name: 'A', kind: 'b', vinOrSerial: 'VIN1' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'vin_already_registered' });
  });

  it('an EMPTY spend is unknown, never recorded as a free campaign (§1B)', async () => {
    // The form always sends '' for a blank field, and Number('') is 0. Testing
    // only `undefined` and junk text missed the one value the UI actually
    // sends, and a blank cost was being stamped as a campaign that cost
    // nothing — which would render as a confident $0 per booked job.
    const written: Array<{ cost: number | null }> = [];
    const api = createApi(regSource({ createCampaign: async (i) => { written.push(i); return 'x'; } }));
    const res = await api.createCampaign({ type: 'flyer', cost: '', trackingNumber: '', sentAtIso: '' });
    expect(written[0]!.cost).toBeNull();
    expect(res.body).toMatchObject({ cost: null, costKnown: false });
    expect((res.body as { line: string }).line).toContain('not the same as it being free');
    // A real zero is still a real zero — somebody typed it.
    await api.createCampaign({ type: 'flyer', cost: '0' });
    expect(written[1]!.cost).toBe(0);
  });

  it('a part against an unknown or retired unit is named, not a 500', async () => {
    // reportBreakdown already guards this and says why; addEquipmentPart did
    // not, so a well-formed but unknown id died on the foreign key.
    const gone = createApi(regSource({ unitStatus: async () => null }));
    expect((await gone.addEquipmentPart(UUID, { partNumber: 'x' })).status).toBe(404);
    const dead = createApi(regSource({ unitStatus: async () => 'retired' }));
    expect((await dead.addEquipmentPart(UUID, { partNumber: 'x' })).status).toBe(409);
    const live = createApi(regSource({ unitStatus: async () => 'up' }));
    expect((await live.addEquipmentPart(UUID, { partNumber: 'x' })).status).toBe(201);
  });

  it('retiring a unit reports the open work that leaves the board with it', async () => {
    const api = createApi(regSource({ unitOpenTaskCount: async () => 2 }));
    const res = await api.retireEquipmentUnit(UUID);
    expect(res.body).toMatchObject({ ok: true, openTasksAtRetirement: 2 });
    expect((res.body as { line: string }).line).toContain('leave the board');
  });

  it('needs a name, a kind and a VIN', async () => {
    expect((await createApi(regSource()).createEquipmentUnit({ name: 'A', kind: 'b' })).status).toBe(400);
  });

  it('retiring twice is a 409, not a second success', async () => {
    const res = await createApi(regSource({ retireEquipmentUnit: async () => false })).retireEquipmentUnit(UUID);
    expect(res.status).toBe(409);
  });

  it('a part needs a number and lands against the unit', async () => {
    const saved: Array<{ unitId: string; partNumber: string }> = [];
    const api = createApi(regSource({ addEquipmentPart: async (i) => { saved.push(i); return 'p'; } }));
    expect((await api.addEquipmentPart(UUID, {})).status).toBe(400);
    await api.addEquipmentPart(UUID, { partNumber: ' 42-X ' });
    expect(saved[0]).toMatchObject({ unitId: UUID, partNumber: '42-X' });
  });

  it('an untracked campaign is registered and reported as UNKNOWN, never zero', async () => {
    const res = await createApi(regSource()).createCampaign({ type: 'flyer', cost: 250 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ attributionWired: false, trackingNumber: null, cost: 250 });
    expect((res.body as { line: string }).line).toContain('UNKNOWN');
  });

  it('refuses a campaign type §6D cannot reason about', async () => {
    const res = await createApi(regSource()).createCampaign({ type: 'skywriting' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'bad_campaign_type' });
  });

  it('an unparseable cost or date is REJECTED, never silently dropped to null', async () => {
    const api = createApi(regSource());
    expect((await api.createCampaign({ type: 'ads', cost: 'a few hundred' })).status).toBe(400);
    expect((await api.createCampaign({ type: 'ads', sentAtIso: 'last spring' })).status).toBe(400);
    // Omitted entirely is fine — that is "not recorded", not "unparseable".
    expect((await api.createCampaign({ type: 'ads' })).status).toBe(201);
  });

  it('says 503 rather than pretending to write when the DB is not configured', async () => {
    const dead = createApi({ ready: () => false, stopsBetween: async () => [], newLeads: async () => [] });
    expect((await dead.createEquipmentUnit({ name: 'A', kind: 'b', vinOrSerial: 'c' })).status).toBe(503);
    expect((await dead.addEquipmentPart(UUID, { partNumber: 'x' })).status).toBe(503);
    expect((await dead.createCampaign({ type: 'flyer' })).status).toBe(503);
  });
});

// ═══ CREW_PLAN C1 (D107), fact 17 — the quiz pool holds questions and lessons only ═══
// training_item also holds tailgate_brief and reference_entry rows. Unfiltered,
// a published briefing would join the clock-in pool (a crew member "asked" the
// briefing as a question) and the training board's topics. The repository is
// run against a stand-in for the Supabase client that applies the filters the
// way PostgREST would, so a missing filter lets the briefing back in.
describe('C1 — a tailgate_brief row never enters the quiz pool or the graded items', () => {
  type Row = { id: string; type: string; topic: string; difficulty: number; published: boolean; exclude_from_scoring: boolean; body: unknown };
  const ROWS: Row[] = [
    { id: 'q1', type: 'quiz_question', topic: 'Rigging', difficulty: 2, published: true, exclude_from_scoring: false, body: { prompt: 'SIM?', options: ['a', 'b'], answer: 0 } },
    { id: 'l1', type: 'lesson', topic: 'Drop zones', difficulty: 1, published: true, exclude_from_scoring: true, body: { text: 'SIM lesson' } },
    { id: 'b1', type: 'tailgate_brief', topic: 'Morning briefing', difficulty: 1, published: true, exclude_from_scoring: false, body: { text: 'SIM briefing' } },
    { id: 'r1', type: 'reference_entry', topic: 'Speed line', difficulty: 3, published: true, exclude_from_scoring: false, body: {} },
    { id: 'q2', type: 'quiz_question', topic: 'Chipper', difficulty: 1, published: false, exclude_from_scoring: false, body: {} },
  ];

  async function repoOver(rows: Row[]) {
    const db = {
      from(table: string) {
        expect(table).toBe('training_item');
        const keep: Array<(r: Row) => boolean> = [];
        const answer = () => ({ data: rows.filter((r) => keep.every((k) => k(r))), error: null });
        const b = {
          select() { return b; },
          eq(col: keyof Row, v: unknown) { keep.push((r) => r[col] === v); return b; },
          in(col: keyof Row, vs: unknown[]) { keep.push((r) => vs.includes(r[col])); return b; },
          then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) { return Promise.resolve(answer()).then(ok, bad); },
        };
        return b;
      },
    };
    vi.resetModules();
    vi.doMock('../src/db/client.js', () => ({ getDb: () => db }));
    return import('../src/db/repositories.js');
  }
  const unmock = () => { vi.doUnmock('../src/db/client.js'); vi.resetModules(); };

  it('publishedTrainingItems: published quiz questions and lessons — never a briefing or a reference entry', async () => {
    try {
      const repo = await repoOver(ROWS);
      expect((await repo.publishedTrainingItems()).map((i) => i.id).sort()).toEqual(['l1', 'q1']);
    } finally { unmock(); }
  });

  it('trainingItemsByIds: a briefing id sent back by a phone is not graded', async () => {
    try {
      const repo = await repoOver(ROWS);
      expect((await repo.trainingItemsByIds(['q1', 'b1', 'r1'])).map((i) => i.id)).toEqual(['q1']);
    } finally { unmock(); }
  });

  it('so the training board counts topics from questions and lessons only', async () => {
    try {
      const repo = await repoOver(ROWS);
      const api = createApi({
        ready: () => true, stopsBetween: async () => [], newLeads: async () => [],
        // One crew member never asked anything: every pool topic is untested for him.
        crewProfiles: async () => [{ id: 'SIM-crew', name: 'SIM-Alder, Test', role: 'climber', scores: {} }],
        trainingPool: () => repo.publishedTrainingItems(),
      });
      const body = JSON.stringify((await api.trainingBoard()).body);
      expect(body).toContain('Rigging');
      expect(body).toContain('Drop zones');
      expect(body).not.toContain('Morning briefing');
      expect(body).not.toContain('Speed line');
    } finally { unmock(); }
  });
});

// ═══ CREW_PLAN C3 (D109) — who a crew code is, and off-roster codes (Q7) ═══
// Q7 default: an off-roster code is refused on the PAID routes (the sign-off,
// the clock-in questions and their answers) with 403 off_roster, and refused
// if the roster cannot be read — fail closed, named. The near miss and the
// library are never refused over the roster; they file or answer and name
// where the code stands. GET /api/crew/me is a read on the crew link.
describe('C3 — GET /api/crew/me names the person on this phone, and nothing more', () => {
  const ON = '00000000-0000-4000-8000-0000000000c1';
  const OFF = '00000000-0000-4000-8000-0000000000c9';
  const people: Record<string, { name: string; active: boolean }> = {
    [ON]: { name: 'Martinez, Rudy', active: true },
    [OFF]: { name: 'Gone Person', active: false },
  };
  const meSource = (over: Partial<DataSource> = {}): DataSource => ({
    ready: () => true, stopsBetween: async () => [], newLeads: async () => [],
    crewMember: async (id) => people[id] ?? null,
    ...over,
  });

  it('on the roster: 200 with the first name only — no surname, no phone, no role', async () => {
    const res = await createApi(meSource()).crewMe(ON);
    expect(res).toEqual({ status: 200, body: { firstName: 'Rudy', active: true } });
    expect(JSON.stringify(res.body)).not.toContain('Martinez');
  });

  it('a "First Last" name gives the first word', async () => {
    const res = await createApi(meSource({ crewMember: async () => ({ name: '  Temo   Lopez ', active: true }) })).crewMe(ON);
    expect(res.body).toEqual({ firstName: 'Temo', active: true });
  });

  it('off the roster: 403 off_roster; unknown: 400 unknown_crew; not a code: 400 bad_crew_id', async () => {
    const api = createApi(meSource());
    expect(await api.crewMe(OFF)).toEqual({ status: 403, body: { error: 'off_roster' } });
    expect(await api.crewMe('11111111-1111-4111-8111-111111111111')).toEqual({ status: 400, body: { error: 'unknown_crew' } });
    expect(await api.crewMe('Rudy')).toEqual({ status: 400, body: { error: 'bad_crew_id' } });
  });

  it('a roster that cannot be read is a named 503 — never a pass', async () => {
    const res = await createApi(meSource({ crewMember: async () => { throw new Error('down'); } })).crewMe(ON);
    expect(res).toEqual({ status: 503, body: { error: 'roster_unreadable' } });
  });

  it('a source with no roster lookup says which gap, and a cut database says db_not_configured', async () => {
    const noLookup = meSource();
    delete noLookup.crewMember;
    expect((await createApi(noLookup).crewMe(ON)).body).toEqual({ error: 'not_built' });
    expect((await createApi(noLookup, { dataLinksSim: true }).crewMe(ON)).body).toEqual({ error: 'not_simulated' });
    expect((await createApi({ ...meSource(), ready: () => false }).crewMe(ON)).body).toEqual({ error: 'db_not_configured' });
  });

  it('the practice crew codes are UUID-shaped and obviously fake, and the practice roster answers', async () => {
    const sim = createSimSource();
    const roster = await sim.fullRoster!();
    expect(roster.map((p) => p.id)).toEqual([
      '00000000-0000-4000-8000-0000000000c1',
      '00000000-0000-4000-8000-0000000000c2',
      '00000000-0000-4000-8000-0000000000c3',
    ]);
    const res = await createApi(sim, { dataLinksSim: true }).crewMe('00000000-0000-4000-8000-0000000000c1');
    expect(res).toEqual({ status: 200, body: { firstName: 'Test', active: true } });
    expect((await sim.certifications!()).every((c) => roster.some((p) => p.id === c.crewMemberId))).toBe(true);
  });
});

describe('C3 (Q7) — an off-roster code is refused on the paid routes; an unreadable roster fails closed', () => {
  const ON = '00000000-0000-4000-8000-0000000000c1';
  const OFF = '00000000-0000-4000-8000-0000000000c9';
  const ITEM = '11111111-1111-4111-8111-111111111111';
  const content = { id: '33333333-3333-3333-3333-333333333333', body: 'Watch the drop zone. Call every cut.', standardRefs: ['Z133 §8.1'] };
  const passing = { scrolledToBottom: true, checkboxTicked: true, secondsOnScreen: 20 };
  const times = { startedAtIso: '2026-10-21T10:00:00Z', completedAtIso: '2026-10-21T10:00:20Z' };
  const paidSource = (crewMember: DataSource['crewMember'], writes: string[]): DataSource => ({
    ready: () => true, stopsBetween: async () => [], newLeads: async () => [],
    crewMember,
    todaysBriefing: async () => content,
    recordBriefingAck: async () => { writes.push('ack'); return { trainingEventId: 'te1', timeEntryId: 't1' }; },
    trainingPool: async () => [{ id: ITEM, topic: 'Rigging', difficulty: 1, published: true, excludeFromScoring: false }],
    trainingItems: async () => [{ id: ITEM, topic: 'Rigging', type: 'quiz_question', body: { prompt: 'SIM?', options: ['a', 'b'], answer: 0 } }],
    recordGate: async () => { writes.push('gate'); return { trainingEventId: 'te2', timeEntryId: 't2' }; },
  });
  const roster = (id: string) => (id === ON ? { name: 'SIM-Alder, Test', active: true } : id === OFF ? { name: 'SIM-Gone, Test', active: false } : null);
  const calls = (api: ReturnType<typeof createApi>, id: string) => [
    api.ackBriefing({ crewMemberId: id, content, state: passing, ...times }),
    api.crewQuiz(id, 'clock_in_gate'),
    api.completeQuiz({ crewMemberId: id, context: 'clock_in_gate', itemIds: [ITEM], answers: { [ITEM]: 0 }, ...times }),
  ];

  it('off the roster: 403 off_roster on the sign-off, the questions and the answers — and nothing paid is written', async () => {
    const writes: string[] = [];
    const api = createApi(paidSource(async (id) => roster(id), writes));
    for (const res of await Promise.all(calls(api, OFF))) expect(res).toEqual({ status: 403, body: { error: 'off_roster' } });
    expect(writes).toEqual([]);
  });

  it('a code that matches nobody: 400 unknown_crew before anything is written', async () => {
    const writes: string[] = [];
    const api = createApi(paidSource(async (id) => roster(id), writes));
    for (const res of await Promise.all(calls(api, '22222222-2222-4222-8222-222222222222'))) expect(res).toEqual({ status: 400, body: { error: 'unknown_crew' } });
    expect(writes).toEqual([]);
  });

  it('a roster that cannot be read: 503 roster_unreadable — fail closed, never a pass, nothing written', async () => {
    const writes: string[] = [];
    const api = createApi(paidSource(async () => { throw new Error('down'); }, writes));
    for (const res of await Promise.all(calls(api, ON))) expect(res).toEqual({ status: 503, body: { error: 'roster_unreadable' } });
    expect(writes).toEqual([]);
  });

  it('a source with no roster lookup cannot check the roster, so it fails closed too', async () => {
    const writes: string[] = [];
    const src = paidSource(undefined, writes);
    delete src.crewMember;
    for (const res of await Promise.all(calls(createApi(src), ON))) expect(res).toEqual({ status: 503, body: { error: 'not_built' } });
    expect(writes).toEqual([]);
  });

  it('on the roster: the paid routes run as before', async () => {
    const writes: string[] = [];
    const [ack, quiz, done] = await Promise.all(calls(createApi(paidSource(async (id) => roster(id), writes)), ON));
    expect(ack).toMatchObject({ status: 200, body: { unlocked: true } });
    expect(quiz!.status).toBe(200);
    expect(done!.status).toBe(200);
    expect(writes.sort()).toEqual(['ack', 'gate']);
  });
});

describe('C3 (Q7) — the near miss and the library are never refused over the roster; they name it', () => {
  const ON = '00000000-0000-4000-8000-0000000000c1';
  const OFF = '00000000-0000-4000-8000-0000000000c9';
  const roster = async (id: string) => (id === ON ? { name: 'SIM-Alder, Test', active: true } : id === OFF ? { name: 'SIM-Gone, Test', active: false } : null);
  const src = (crewMember: DataSource['crewMember'], filed: string[]): DataSource => ({
    ready: () => true, stopsBetween: async () => [], newLeads: async () => [],
    crewMember,
    fileNearMiss: async (i) => { filed.push(i.reportedBy); return { id: '44444444-4444-4444-8444-444444444444' }; },
    referenceEntries: async () => [{
      id: 'e1', techniqueName: 'SIM natural crotch rigging', skillLevel: 3, howTo: 'SIMULATED.', pros: [], cons: [],
      wontWorkWhen: 'Included bark.', sourceLink: null, standardRefs: ['Z133 §8.1'], published: true,
    }],
  });

  it('an off-roster code still files its near miss — and the answer says it is off the roster', async () => {
    const filed: string[] = [];
    const res = await createApi(src(roster, filed)).reportNearMiss({ reportedBy: OFF, description: 'Limb swung toward the chipper' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ roster: 'off' });
    expect(filed).toEqual([OFF]);
    expect((await createApi(src(roster, [])).reportNearMiss({ reportedBy: ON, description: 'Limb swung' })).body).toMatchObject({ roster: 'on' });
  });

  it('a roster that cannot be read never stops a near miss — it files and says the roster was not checked', async () => {
    const filed: string[] = [];
    const res = await createApi(src(async () => { throw new Error('down'); }, filed)).reportNearMiss({ reportedBy: ON, description: 'Limb swung' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ roster: 'unchecked' });
    expect(filed).toEqual([ON]);
  });

  it('the library answers an off-roster code, and an unreadable roster, and names each', async () => {
    const off = await createApi(src(roster, [])).crewReference('rigging', OFF);
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ roster: 'off' });
    expect((off.body as { entries: unknown[] }).entries).toHaveLength(1);
    const down = await createApi(src(async () => { throw new Error('down'); }, [])).crewReference('rigging', ON);
    expect(down.status).toBe(200);
    expect(down.body).toMatchObject({ roster: 'unchecked' });
    expect((await createApi(src(roster, [])).crewReference('rigging', ON)).body).toMatchObject({ roster: 'on' });
    expect((await createApi(src(roster, [])).crewReference('rigging', '22222222-2222-4222-8222-222222222222')).body).toMatchObject({ roster: 'unknown' });
  });
});
