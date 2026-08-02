import { describe, it, expect } from 'vitest';
import { findOpenLoops, defaultLoopConfig, type LoopSnapshot } from '../src/ops/loopCloser.js';

const NOW = '2026-08-10T12:00:00Z';

function snapshot(partial: Partial<LoopSnapshot>): LoopSnapshot {
  return { nowIso: NOW, estimates: [], jobs: [], leads: [], ...partial };
}

describe('Loop-Closer (§1E) — silence is never success', () => {
  it('flags an estimate visited days ago with no outcome', () => {
    const open = findOpenLoops(snapshot({
      estimates: [{
        id: 'e1', propertyId: 'p1', scheduledIso: null,
        visitedAtIso: '2026-08-05T15:00:00Z', outcome: 'pending', outcomeAtIso: null,
        hasJobForProperty: false,
      }],
    }));
    expect(open).toHaveLength(1);
    expect(open[0]!.kind).toBe('estimate_went_quiet');
  });

  it('stays quiet about a fresh visit still inside the window', () => {
    const open = findOpenLoops(snapshot({
      estimates: [{
        id: 'e1', propertyId: 'p1', scheduledIso: null,
        visitedAtIso: '2026-08-10T09:00:00Z', outcome: 'pending', outcomeAtIso: null,
        hasJobForProperty: false,
      }],
    }));
    expect(open).toHaveLength(0);
  });

  it('a WON estimate with no job is urgent — the win is dying quietly', () => {
    const open = findOpenLoops(snapshot({
      estimates: [{
        id: 'e2', propertyId: 'p2', scheduledIso: null,
        visitedAtIso: '2026-08-01T15:00:00Z', outcome: 'won',
        outcomeAtIso: '2026-08-06T15:00:00Z', hasJobForProperty: false,
      }],
    }));
    expect(open).toHaveLength(1);
    expect(open[0]!.kind).toBe('won_but_never_booked');
    expect(open[0]!.severity).toBe('urgent');
  });

  it('a won estimate WITH a booked job closes the loop — no flag', () => {
    const open = findOpenLoops(snapshot({
      estimates: [{
        id: 'e2', propertyId: 'p2', scheduledIso: null,
        visitedAtIso: '2026-08-01T15:00:00Z', outcome: 'won',
        outcomeAtIso: '2026-08-06T15:00:00Z', hasJobForProperty: true,
      }],
    }));
    expect(open).toHaveLength(0);
  });

  it('flags a job whose scheduled day passed while status stayed booked', () => {
    const open = findOpenLoops(snapshot({
      jobs: [{ id: 'j1', scheduledIso: '2026-08-08T13:00:00Z', status: 'booked' }],
    }));
    expect(open).toHaveLength(1);
    expect(open[0]!.kind).toBe('job_never_closed');
  });

  it('completed and in-progress jobs are not open loops', () => {
    const open = findOpenLoops(snapshot({
      jobs: [
        { id: 'j2', scheduledIso: '2026-08-01T13:00:00Z', status: 'completed' },
        { id: 'j3', scheduledIso: '2026-08-09T13:00:00Z', status: 'in_progress' },
      ],
    }));
    expect(open).toHaveLength(0);
  });

  it('an uncalled voicemail lead escalates to urgent after a day', () => {
    const open = findOpenLoops(snapshot({
      leads: [
        { id: 'l1', createdAtIso: '2026-08-10T06:00:00Z', status: 'new', needsCallback: true },
        { id: 'l2', createdAtIso: '2026-08-08T06:00:00Z', status: 'new', needsCallback: true },
      ],
    }));
    expect(open).toHaveLength(2);
    const byId = new Map(open.map((o) => [o.refId, o]));
    expect(byId.get('l1')!.severity).toBe('attention');
    expect(byId.get('l2')!.severity).toBe('urgent');
  });

  it('a lead already qualified or without callback need stays quiet', () => {
    const open = findOpenLoops(snapshot({
      leads: [
        { id: 'l3', createdAtIso: '2026-08-01T06:00:00Z', status: 'qualified', needsCallback: true },
        { id: 'l4', createdAtIso: '2026-08-01T06:00:00Z', status: 'new', needsCallback: false },
      ],
    }));
    expect(open).toHaveLength(0);
  });

  it('orders worst-first: urgent above attention, older above newer', () => {
    const open = findOpenLoops(snapshot({
      estimates: [{
        id: 'e9', propertyId: 'p9', scheduledIso: null,
        visitedAtIso: '2026-08-05T15:00:00Z', outcome: 'pending', outcomeAtIso: null,
        hasJobForProperty: false,
      }],
      leads: [{ id: 'l9', createdAtIso: '2026-08-07T06:00:00Z', status: 'new', needsCallback: true }],
    }));
    expect(open[0]!.severity).toBe('urgent');
  });

  it('never invents a flag from missing timestamps', () => {
    const open = findOpenLoops(snapshot({
      estimates: [{
        id: 'e5', propertyId: null, scheduledIso: null, visitedAtIso: null,
        outcome: 'pending', outcomeAtIso: null, hasJobForProperty: false,
      }],
      jobs: [{ id: 'j5', scheduledIso: null, status: 'booked' }],
    }));
    expect(open).toHaveLength(0);
  });

  it('no dollar figures ever appear in a needs-decision line', () => {
    const open = findOpenLoops(snapshot({
      estimates: [{
        id: 'e2', propertyId: 'p2', scheduledIso: null,
        visitedAtIso: '2026-08-01T15:00:00Z', outcome: 'won',
        outcomeAtIso: '2026-08-06T15:00:00Z', hasJobForProperty: false,
      }],
    }), defaultLoopConfig);
    for (const item of open) expect(item.line).not.toMatch(/\$\s?\d/);
  });
});
