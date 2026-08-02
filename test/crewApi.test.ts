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
