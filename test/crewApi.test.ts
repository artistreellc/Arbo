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
  const content = { id: 'b1', body: 'Watch the drop zone. Call every cut.', standardRefs: ['Z133 §8.1'] };

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
});
