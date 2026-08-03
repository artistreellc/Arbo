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
import { describe, it, expect } from 'vitest';
import { createApi, type DataSource, type CrewJobSource } from '../src/server/api.js';

const job = (over: Partial<CrewJobSource> = {}): CrewJobSource => ({
  jobId: 'j1', scheduledFor: '2026-08-05T13:00:00Z', address: '123 Oak St',
  city: 'Virginia Beach', scope: 'Remove leaning pine',
  hazardPowerLines: false, hazardStructures: false, permitStatus: null,
  propertyId: 'p1', ...over,
});

function crewSource(jobs: CrewJobSource[], onAck?: (i: unknown) => void): DataSource {
  return {
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [],
    crewJobs: async () => jobs,
    recordBriefingAck: async (input) => {
      onAck?.(input);
      return { trainingEventId: 'te1', timeEntryId: 'time1' };
    },
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
});

describe('gated briefing over the API (§6V.4 / §4.6)', () => {
  const content = { id: '33333333-3333-3333-3333-333333333333', body: 'Watch the drop zone. Call every cut.', standardRefs: ['Z133 §8.1'] };

  it('a half-completed gate does NOT unlock and names what is missing', async () => {
    const api = createApi(crewSource([]));
    const res = await api.ackBriefing({
      crewMemberId: 'c1', content,
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
      crewMemberId: 'c1', content,
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
      crewMemberId: 'c1', content, state: {},
      startedAtIso: 'not-a-time', completedAtIso: 'nope',
    })).status).toBe(400);
  });

  it('rejects a reversed span — a client clock cannot mint negative time', async () => {
    const api = createApi(crewSource([]));
    const res = await api.ackBriefing({
      crewMemberId: 'c1', content,
      state: { scrolledToBottom: true, checkboxTicked: true, secondsOnScreen: 20 },
      startedAtIso: '2026-08-05T10:05:00Z', completedAtIso: '2026-08-05T10:00:00Z',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a non-UUID briefing id (uuid[] would commit PAID time then fail)', async () => {
    const api = createApi(crewSource([]));
    const res = await api.ackBriefing({
      crewMemberId: 'c1', content: { id: 'b1', body: 'x', standardRefs: [] },
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
      crewMemberId: 'c1', content,
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
