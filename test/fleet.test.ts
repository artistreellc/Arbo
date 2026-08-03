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
import { buildActionPlan, isSchedulable, escalateStatus, type BreakdownReport, type KnownPart } from '../src/fleet/breakdown.js';
import { createApi, type DataSource } from '../src/server/api.js';

const report = (over: Partial<BreakdownReport> = {}): BreakdownReport => ({
  unitId: 'u1', reportedBy: 'c1', description: 'Hydraulic hose blew on the chipper',
  mediaRefs: ['photo-1.jpg'], immobilized: false, atIso: '2026-08-05T14:00:00Z', ...over,
});

const HOSE: KnownPart = { partNumber: 'H-3/8-24', description: '3/8 hydraulic hose, 24in', supplier: 'Bailey', lastPrice: 42 };
const BELT: KnownPart = { partNumber: 'B-4L360', description: 'Drive belt 4L360', supplier: 'Grainger', lastPrice: 18 };

describe('breakdown action plan (§6E) — status is not a suggestion', () => {
  it('an immobilized unit goes DOWN, full stop', () => {
    const plan = buildActionPlan(report({ immobilized: true }), [HOSE]);
    expect(plan.newStatus).toBe('down');
    expect(isSchedulable(plan.newStatus)).toBe(false);
    expect(plan.steps[0]).toMatch(/DOWN/);
  });

  it('a unit that still runs is flagged for maintenance, not falsely grounded', () => {
    const plan = buildActionPlan(report({ immobilized: false }), [HOSE]);
    expect(plan.newStatus).toBe('maintenance');
    expect(isSchedulable(plan.newStatus)).toBe(true);
  });

  it('warns when the broken unit is known to be assigned to work', () => {
    const plan = buildActionPlan(report({ immobilized: true }), [HOSE], { assignment: 'assigned' });
    expect(plan.steps.join(' ')).toMatch(/reassign or move those jobs/i);
  });

  it('names the schedule as UNKNOWN on a grounded unit — never implies it is free (§1B)', () => {
    const plan = buildActionPlan(report({ immobilized: true }), [HOSE]);
    expect(plan.unknowns.join(' ')).toMatch(/cannot see which jobs this unit is assigned to/i);
    expect(plan.steps.join(' ')).not.toMatch(/reassign or move those jobs/i);
  });

  it('does not claim an unknown schedule on a unit that still runs', () => {
    const plan = buildActionPlan(report({ immobilized: false }), [HOSE]);
    expect(plan.unknowns.join(' ')).not.toMatch(/assigned to/i);
  });

  it('says out loud when a unit already has open tasks', () => {
    const plan = buildActionPlan(report(), [HOSE], { openTasks: 3 });
    expect(plan.steps.join(' ')).toMatch(/3 maintenance task\(s\) already open/i);
  });

  it('a "still drivable" report can NEVER un-ground a unit that is already DOWN', () => {
    const plan = buildActionPlan(report({ immobilized: false }), [HOSE], { currentStatus: 'down' });
    expect(plan.newStatus).toBe('down');
    expect(plan.steps[0]).toMatch(/stays DOWN/i);
    expect(plan.steps.join(' ')).not.toMatch(/still usable/i);
  });

  it('escalates in one direction only', () => {
    expect(escalateStatus('up', 'down')).toBe('down');
    expect(escalateStatus('maintenance', 'down')).toBe('down');
    expect(escalateStatus('down', 'maintenance')).toBe('down');
    expect(escalateStatus('maintenance', 'maintenance')).toBe('maintenance');
    expect(escalateStatus('retired', 'down')).toBe('retired');
  });

  it('a retired unit can never be scheduled', () => {
    expect(isSchedulable('retired')).toBe(false);
    expect(isSchedulable('up')).toBe(true);
  });
});

describe('parts suggestions — from this unit’s own log, never invented (§1B)', () => {
  it('matches the symptom to parts already in the log', () => {
    const plan = buildActionPlan(report(), [HOSE, BELT]);
    expect(plan.candidateParts).toEqual([HOSE]);
    expect(plan.unknowns).toEqual([]);
  });

  it('names the gap when the symptom is recognised but no part is on file', () => {
    const plan = buildActionPlan(report(), [BELT]);
    expect(plan.candidateParts).toEqual([]);
    expect(plan.unknowns.join(' ')).toMatch(/part number unknown/i);
    expect(plan.unknowns.join(' ')).toMatch(/hydraulic/i);
  });

  it('names the gap when the symptom matches nothing at all — never guesses a part', () => {
    const plan = buildActionPlan(report({ description: 'It is making a weird noise' }), [HOSE, BELT]);
    expect(plan.candidateParts).toEqual([]);
    expect(plan.unknowns.join(' ')).toMatch(/did not match a known failure pattern/i);
  });

  it('asks for a photo when the report came in without one', () => {
    const plan = buildActionPlan(report({ mediaRefs: [] }), [HOSE]);
    expect(plan.unknowns.join(' ')).toMatch(/no photo/i);
  });

  it('is deterministic — same report, same log, same plan', () => {
    const a = buildActionPlan(report(), [HOSE, BELT], { assignment: 'assigned', openTasks: 2 });
    const b = buildActionPlan(report(), [HOSE, BELT], { assignment: 'assigned', openTasks: 2 });
    expect(a).toEqual(b);
  });
});

describe('§6E2.3 — Arbo builds the list, a human buys', () => {
  it('never places an order and says so on the plan', () => {
    const plan = buildActionPlan(report(), [HOSE]);
    expect(plan.ordersPlaced).toBe(false);
    expect(plan.steps.join(' ')).toMatch(/does not place orders/i);
  });

  it('emits supplier deep links only — no card, no checkout, no order endpoint', () => {
    const plan = buildActionPlan(report(), [HOSE]);
    expect(plan.supplierLinks).toHaveLength(1);
    expect(plan.supplierLinks[0]!.url).toMatch(/^https:\/\//);
    const json = JSON.stringify(plan).toLowerCase();
    for (const forbidden of ['checkout', 'purchase_order', 'placeorder', 'cvv', 'add to cart']) {
      expect(json, `plan referenced "${forbidden}"`).not.toContain(forbidden);
    }
    // "card" may appear only inside the disclaimer that Arbo holds none.
    expect(json.replace(/holds no card/g, '')).not.toContain('card');
  });

  it('skips links for parts with no supplier on file rather than inventing one', () => {
    const plan = buildActionPlan(report(), [{ ...HOSE, supplier: null }]);
    expect(plan.candidateParts).toHaveLength(1);
    expect(plan.supplierLinks).toEqual([]);
  });
});

function fleetSource(over: Partial<DataSource> = {}): DataSource {
  return {
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [],
    units: async () => [
      { id: 'u1', name: 'Chipper 1', status: 'up' },
      { id: 'u2', name: 'Bucket truck', status: 'down' },
    ],
    unitParts: async () => [HOSE],
    unitOpenTaskCount: async () => 0,
    unitStatus: async () => 'up',
    recordBreakdown: async () => ({ taskId: 'task-1' }),
    closeMaintenanceTask: async () => {},
    ...over,
  };
}

describe('fleet API', () => {
  it('marks each unit schedulable or not, and counts the DOWN ones', async () => {
    const res = await createApi(fleetSource()).fleetUnits();
    expect(res.status).toBe(200);
    const body = res.body as { units: Array<{ id: string; schedulable: boolean }>; down: number };
    expect(body.down).toBe(1);
    expect(body.units.find((u) => u.id === 'u2')!.schedulable).toBe(false);
  });

  it('a breakdown report writes the new status and returns the plan', async () => {
    let written: { newStatus: string } | null = null;
    const api = createApi(fleetSource({
      recordBreakdown: async (i) => { written = i; return { taskId: 'task-9' }; },
    }));
    const res = await api.reportBreakdown({ unitId: 'u1', description: 'hydraulic hose blew', reportedBy: 'c1', immobilized: true });
    expect(res.status).toBe(200);
    expect(written!.newStatus).toBe('down');
    expect(res.body).toMatchObject({ taskId: 'task-9', ordersPlaced: false });
  });

  it('an unreadable parts log yields "unknown", never a confident empty plan (§1B)', async () => {
    const api = createApi(fleetSource({
      unitParts: async () => { throw new Error('db down'); },
    }));
    const res = await api.reportBreakdown({ unitId: 'u1', description: 'hydraulic hose blew' });
    const body = res.body as { unknowns: string[]; candidateParts: unknown[] };
    expect(body.candidateParts).toEqual([]);
    expect(body.unknowns.join(' ')).toMatch(/unknown/i);
  });

  it('404s on an unknown unit instead of writing a task that dies on the FK', async () => {
    let wrote = false;
    const api = createApi(fleetSource({
      unitStatus: async () => null,
      recordBreakdown: async () => { wrote = true; return { taskId: 't' }; },
    }));
    const res = await api.reportBreakdown({ unitId: 'nope', description: 'hose blew' });
    expect(res.status).toBe(404);
    expect(wrote).toBe(false);
  });

  it('refuses a report against a retired unit', async () => {
    const api = createApi(fleetSource({ unitStatus: async () => 'retired' }));
    expect((await api.reportBreakdown({ unitId: 'u1', description: 'hose blew' })).status).toBe(409);
  });

  it('a minor report on a DOWN unit writes DOWN, never maintenance', async () => {
    let written: { newStatus: string } | null = null;
    const api = createApi(fleetSource({
      unitStatus: async () => 'down',
      recordBreakdown: async (i) => { written = i; return { taskId: 't' }; },
    }));
    const res = await api.reportBreakdown({ unitId: 'u1', description: 'belt squeals', immobilized: false });
    expect(written!.newStatus).toBe('down');
    expect((res.body as { newStatus: string }).newStatus).toBe('down');
  });

  it('rejects a report with no unit or no description instead of filing a blank', async () => {
    const api = createApi(fleetSource());
    expect((await api.reportBreakdown({ description: 'x' })).status).toBe(400);
    expect((await api.reportBreakdown({ unitId: 'u1', description: '   ' })).status).toBe(400);
  });

  it('§6E2.4 — a maintenance task cannot close without a photo of the part', async () => {
    let closed = false;
    const api = createApi(fleetSource({ closeMaintenanceTask: async () => { closed = true; } }));
    const bad = await api.closeMaintenance('task-1', { completedBy: 'c1' });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: 'photo_proof_required' });
    expect(closed, 'a checkbox closed a maintenance task').toBe(false);

    const ok = await api.closeMaintenance('task-1', { proofPhotoFile: 'file-abc', completedBy: 'c1' });
    expect(ok.status).toBe(200);
    expect(closed).toBe(true);
  });

  it('503s honestly when the database is not configured', async () => {
    const dead = createApi({ ready: () => false, stopsBetween: async () => [], newLeads: async () => [] });
    expect((await dead.fleetUnits()).status).toBe(503);
    expect((await dead.reportBreakdown({ unitId: 'u1', description: 'x' })).status).toBe(503);
    expect((await dead.closeMaintenance('t1', { proofPhotoFile: 'f' })).status).toBe(503);
  });
});
