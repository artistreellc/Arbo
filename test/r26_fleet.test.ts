// R26 (Mike, 2026-10-20) — the brake/steering hold, package fleet.
// "A brake or steering defect keeps a unit off the schedule until signed back
// on." Default: Mike signs it back on, with the owner key (no designate).
// Pins: the state machine (a hold whatever the severity, held outranks down,
// one way out), schedulability, the API (named reason, owner-only sign-back,
// state read from the database, compare-and-set write), the route behind the
// admin key gate with the crew key refused, and the Fleet card's hold line and
// two-tap "Sign it back on" button, run against stand-ins.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import {
  buildActionPlan, isSchedulable, escalateStatus, afterSignBack, isBrakeOrSteering,
  HOLD_REASON, OWNER_SIGNER, type BreakdownReport, type KnownPart, type UnitStatus,
} from '../src/fleet/breakdown.js';
import { createApi, type DataSource } from '../src/server/api.js';
import { createSimSource } from '../src/dev/simSource.js';
import { loadAppHtml } from '../src/server/appPage.js';

const report = (over: Partial<BreakdownReport> = {}): BreakdownReport => ({
  unitId: 'u1', reportedBy: 'c1', description: 'Brakes are soft on the chip truck',
  mediaRefs: ['photo-1.jpg'], immobilized: false, atIso: '2026-10-20T14:00:00Z', ...over,
});

const PAD: KnownPart = { partNumber: 'BP-77', description: 'Front brake pad set', supplier: 'FleetPride', lastPrice: 60 };
const TIE_ROD: KnownPart = { partNumber: 'TR-12', description: 'Outer tie rod end', supplier: 'FleetPride', lastPrice: 45 };
const HOSE: KnownPart = { partNumber: 'H-3/8-24', description: '3/8 hydraulic hose, 24in', supplier: 'Bailey', lastPrice: 42 };

/** Every word a screen or a plan line may show for a hold, checked against the law. */
function assertLawfulCopy(text: string): void {
  expect(text).not.toMatch(/\bclear(ed)?\b|\bexempt\b|\bsuffolk\b|\btcia\b/i);
  // The same order words fleet.test.ts bans (§6E2.3); "does not place orders" is the disclaimer, not an offer.
  expect(text.toLowerCase()).not.toMatch(/checkout|add to cart|purchase_order|placeorder|cvv/);
}

describe('R26 state machine — a brake or steering defect HOLDS the unit, whatever its severity', () => {
  it('a brake report that still drives is HELD, not maintenance, and is not schedulable', () => {
    const plan = buildActionPlan(report({ immobilized: false }), [PAD]);
    expect(plan.newStatus).toBe('held');
    expect(isSchedulable(plan.newStatus)).toBe(false);
    expect(plan.holdReason).toBe(HOLD_REASON);
    expect(plan.steps[0]).toBe("Unit HELD — brake/steering defect — needs Mike's sign-off. Scheduling will not assign it until Mike signs it back on; nothing returns it on its own.");
    assertLawfulCopy(plan.steps.join(' '));
  });

  it('steering is a symptom family of its own: held, and its parts come from the unit log', () => {
    const plan = buildActionPlan(report({ description: 'Steering wheel has a lot of play' }), [TIE_ROD, HOSE]);
    expect(plan.newStatus).toBe('held');
    expect(plan.candidateParts).toEqual([TIE_ROD]);
    expect(plan.steps.join(' ')).toMatch(/Likely steering: 1 matching part/);
    // Recognised but not on file: named as unknown, never guessed (§1B).
    const none = buildActionPlan(report({ description: 'tie rod is bent' }), [HOSE]);
    expect(none.newStatus).toBe('held');
    expect(none.unknowns.join(' ')).toMatch(/steering issue, but this unit's parts log has no matching entry/);
  });

  it('reads every way a crew says it — and a hydraulic hint for parts never hides the hold', () => {
    for (const d of ['brakes are soft', 'braking pulls left', 'Brake light stays on', 'ABS light came on',
      'e-brake will not hold', 'power steering pump whining', 'steers hard', 'tierod looks bent',
      'brake line leaking fluid', 'power steering hose leaking',
      // The same defects written as one word must hold too — a hold that
      // depends on a space is a hold a crew can miss by typing fast.
      'handbrake will not hold', 'airbrake leaking', 'brakeline cut', 'powersteering failing', 'footbrake soft']) {
      expect(isBrakeOrSteering(d), d).toBe(true);
      expect(buildActionPlan(report({ description: d }), []).newStatus, d).toBe('held');
    }
    // "power steering hose leaking" files its PARTS under hydraulic (the first hint) — and is still held.
    const mixed = buildActionPlan(report({ description: 'power steering hose leaking' }), [HOSE]);
    expect(mixed.candidateParts).toEqual([HOSE]);
    expect(mixed.newStatus).toBe('held');
  });

  it('does not hold a report that names neither — the old ladder is unchanged there', () => {
    for (const d of ['Hydraulic hose blew', 'belt squeals', 'blade is dull', 'brakeman', 'steerage', 'flat tire']) {
      expect(isBrakeOrSteering(d), d).toBe(false);
    }
    expect(buildActionPlan(report({ description: 'Hydraulic hose blew' }), []).newStatus).toBe('maintenance');
    expect(buildActionPlan(report({ description: 'Hydraulic hose blew', immobilized: true }), []).newStatus).toBe('down');
    expect(buildActionPlan(report({ description: 'Hydraulic hose blew' }), []).holdReason).toBeNull();
  });

  it('an immobilized brake failure is HELD (Mike signs it back on) and says it cannot be driven', () => {
    const plan = buildActionPlan(report({ immobilized: true }), [PAD]);
    expect(plan.newStatus).toBe('held');
    expect(plan.steps).toContain('Also reported as unable to be driven or run at all.');
  });

  it('held outranks down: a brake report on a DOWN unit holds it, so the sign-off is the one way back', () => {
    expect(buildActionPlan(report(), [], { currentStatus: 'down' }).newStatus).toBe('held');
    expect(escalateStatus('down', 'held')).toBe('held');
    expect(escalateStatus('maintenance', 'held')).toBe('held');
    expect(escalateStatus('up', 'held')).toBe('held');
  });

  it('nothing un-holds a unit on its own: a later report of any kind keeps it HELD', () => {
    for (const next of ['up', 'maintenance', 'down'] as UnitStatus[]) expect(escalateStatus('held', next)).toBe('held');
    const plan = buildActionPlan(report({ description: 'belt squeals', immobilized: true }), [], { currentStatus: 'held' });
    expect(plan.newStatus).toBe('held');
    expect(plan.steps[0]).toMatch(/^Unit stays HELD — brake\/steering defect/);
    // A retired unit stays retired; the API refuses a report against it anyway.
    expect(escalateStatus('retired', 'held')).toBe('retired');
  });

  it('a held unit with no unit-to-job link names the schedule as UNKNOWN (§1B)', () => {
    const plan = buildActionPlan(report(), [PAD]);
    expect(plan.unknowns.join(' ')).toMatch(/cannot see which jobs this unit is assigned to/);
  });

  it('the one way out: only a HELD unit can be signed back on, and it goes back to service', () => {
    expect(afterSignBack('held')).toBe('up');
    for (const s of ['up', 'maintenance', 'down', 'retired'] as UnitStatus[]) expect(afterSignBack(s), s).toBeNull();
    expect(isSchedulable(afterSignBack('held')!)).toBe(true);
  });

  it('schedulability is an allow-list: held, down and retired never schedule', () => {
    expect(isSchedulable('held')).toBe(false);
    expect(isSchedulable('down')).toBe(false);
    expect(isSchedulable('retired')).toBe(false);
    expect(isSchedulable('up')).toBe(true);
    expect(isSchedulable('maintenance')).toBe(true);
  });

  it('never orders a part and never prices one — the hold changes none of §6E2.3', () => {
    const plan = buildActionPlan(report(), [PAD]);
    expect(plan.ordersPlaced).toBe(false);
    expect(plan.supplierLinks.every((l) => /^https:\/\/www\.google\.com\/search\?q=/.test(l.url))).toBe(true);
    expect(JSON.stringify(plan)).not.toMatch(/\$\d/);
  });
});

// ── API ────────────────────────────────────────────────────────────────────
const UNIT = '11111111-2222-4333-8444-555555555555';

function fleetSource(over: Partial<DataSource> = {}): DataSource {
  return {
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [],
    units: async () => [
      { id: 'u1', name: 'Chip truck', status: 'up' },
      { id: 'u2', name: 'Chipper', status: 'down' },
      { id: 'u3', name: 'Bucket truck', status: 'held' },
    ],
    unitParts: async () => [PAD],
    unitOpenTaskCount: async () => 0,
    unitStatus: async () => 'held',
    recordBreakdown: async () => ({ taskId: 'task-1' }),
    closeMaintenanceTask: async () => {},
    signBackOn: async () => true,
    ...over,
  };
}

describe('R26 API — the hold is named, and only the owner signs it back on', () => {
  it('the fleet read names a held unit, counts it apart from DOWN, and never calls it schedulable', async () => {
    const res = await createApi(fleetSource()).fleetUnits();
    expect(res.status).toBe(200);
    const body = res.body as { units: Array<{ id: string; schedulable: boolean; holdReason: string | null }>; down: number; held: number };
    expect(body.down).toBe(1);
    expect(body.held).toBe(1);
    const held = body.units.find((u) => u.id === 'u3')!;
    expect(held.schedulable).toBe(false);
    expect(held.holdReason).toBe("brake/steering defect — needs Mike's sign-off");
    expect(body.units.find((u) => u.id === 'u1')!.holdReason).toBeNull();
  });

  it('a brake report that still drives writes HELD and returns the named reason', async () => {
    let written: { newStatus: string } | null = null;
    const api = createApi(fleetSource({
      unitStatus: async () => 'up',
      recordBreakdown: async (i) => { written = i; return { taskId: 'task-9' }; },
    }));
    const res = await api.reportBreakdown({ unitId: 'u1', description: 'brakes are soft', immobilized: false });
    expect(res.status).toBe(200);
    expect(written!.newStatus).toBe('held');
    expect(res.body).toMatchObject({ newStatus: 'held', holdReason: HOLD_REASON, ordersPlaced: false, taskId: 'task-9' });
  });

  it('signs a HELD unit back on as the owner key, with when, and puts it back in service', async () => {
    const writes: Array<{ unitId: string; status: string; signedBackBy: string; atIso: string }> = [];
    const events: Array<[string, Record<string, unknown>]> = [];
    const api = createApi(fleetSource({
      signBackOn: async (i) => { writes.push(i); return true; },
      emit: async (t, p) => { events.push([t, p]); return true; },
    }));
    const before = Date.now();
    const res = await api.signBackOn(UNIT);
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ unitId: UNIT, status: 'up', signedBackBy: OWNER_SIGNER });
    expect(OWNER_SIGNER).toBe('Mike (owner key)');
    expect(Date.parse(writes[0]!.atIso)).toBeGreaterThanOrEqual(before);
    expect(res.body).toMatchObject({ ok: true, unitId: UNIT, status: 'up', signedBackBy: OWNER_SIGNER, signedBackAt: writes[0]!.atIso });
    assertLawfulCopy((res.body as { line: string }).line);
    // On the binder: ids and the signer only — no customer data (§4.3).
    expect(events).toEqual([['equipment.unit.signed_back_on', { unitId: UNIT, signedBackBy: OWNER_SIGNER, atIso: writes[0]!.atIso }]]);
  });

  it('refuses a unit that is not held, by name, and writes nothing', async () => {
    for (const status of ['up', 'maintenance', 'down', 'retired'] as UnitStatus[]) {
      let wrote = false;
      const api = createApi(fleetSource({ unitStatus: async () => status, signBackOn: async () => { wrote = true; return true; } }));
      const res = await api.signBackOn(UNIT);
      expect(res.status, status).toBe(409);
      expect(res.body, status).toMatchObject({ error: 'not_held' });
      expect(wrote, `${status}: a sign-back wrote over a unit that was not held`).toBe(false);
    }
  });

  it('a unit that left the hold before the write is refused, never reported as signed', async () => {
    let emitted = false;
    const api = createApi(fleetSource({ signBackOn: async () => false, emit: async () => { emitted = true; return true; } }));
    const res = await api.signBackOn(UNIT);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'not_held' });
    expect(emitted).toBe(false);
  });

  it('an unknown unit is 404 and a malformed id is 400 — before anything is read or written', async () => {
    let wrote = false;
    const api = createApi(fleetSource({ unitStatus: async () => null, signBackOn: async () => { wrote = true; return true; } }));
    expect((await api.signBackOn(UNIT)).status).toBe(404);
    let read = false;
    const api2 = createApi(fleetSource({ unitStatus: async () => { read = true; return 'held'; }, signBackOn: async () => { wrote = true; return true; } }));
    expect((await api2.signBackOn('not-a-uuid')).status).toBe(400);
    expect(read).toBe(false);
    expect(wrote).toBe(false);
  });

  it('a dead feed is named three ways — cut, not built, not in the practice data (§1B)', async () => {
    const why = (r: { body: unknown }) => (r.body as { error: string }).error;
    const cut = createApi({ ready: () => false, stopsBetween: async () => [], newLeads: async () => [] });
    expect(why(await cut.signBackOn(UNIT))).toBe('db_not_configured');
    const notBuilt = createApi(fleetSource({ signBackOn: undefined }));
    expect(why(await notBuilt.signBackOn(UNIT))).toBe('not_built');
    const sim = createApi(createSimSource(), { dataLinksSim: true });
    const r = await sim.signBackOn('sim-unit-3');
    expect(r.status).toBe(503);
    expect(why(r)).toBe('not_simulated');
  });

  it('the practice data carries a held unit, so the honest state renders in simulation', async () => {
    const res = await createApi(createSimSource(), { dataLinksSim: true }).fleetUnits();
    const body = res.body as { units: Array<{ id: string; name: string; schedulable: boolean; holdReason: string | null }>; held: number; down: number };
    expect(body.held).toBe(1);
    expect(body.down).toBe(1);
    const held = body.units.find((u) => u.id === 'sim-unit-3')!;
    expect(held.name).toMatch(/^SIM /);
    expect(held.schedulable).toBe(false);
    expect(held.holdReason).toBe(HOLD_REASON);
  });
});

// ── The breakdown write is a compare-and-set ────────────────────────────────
// Only Mike lifts a hold, so the breakdown writer must never LOWER one. The
// plan is built from the status read before it; the write only lands on a
// unit still at that status, and a unit that moved in between is refused by
// name with nothing saved — no status, no task, no event.
describe('R26 breakdown write — a report that read a stale status is refused, never written over a hold', () => {
  const CHANGED_LINE = 'This unit changed while the report was being filed. Nothing was saved. File it again.';

  it('a write the store refused comes back 409 in plain words, with no task and no event', async () => {
    const events: string[] = [];
    const api = createApi(fleetSource({
      unitStatus: async () => 'up',
      recordBreakdown: async () => ({ conflict: true }),
      emit: async (t) => { events.push(t); return true; },
    }));
    const res = await api.reportBreakdown({ unitId: UNIT, description: 'belt squeals', immobilized: false });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'unit_changed', line: CHANGED_LINE });
    expect(events).toEqual([]);
    assertLawfulCopy(CHANGED_LINE);
  });

  it('hands the writer the status the plan was built from', async () => {
    for (const read of ['up', 'maintenance', 'down', 'held'] as UnitStatus[]) {
      let written: { expectedStatus: UnitStatus | null; newStatus: string } | null = null;
      const api = createApi(fleetSource({
        unitStatus: async () => read,
        recordBreakdown: async (i) => { written = i; return { taskId: 't' }; },
      }));
      await api.reportBreakdown({ unitId: UNIT, description: 'belt squeals', immobilized: false });
      expect(written!.expectedStatus, read).toBe(read);
    }
  });

  // A store that does what the repository now does: move the unit only if it
  // is still at the status the plan was built from. With no expected status
  // it writes unconditionally — the old repository — so this reproduces the
  // race against the old handler.
  function racedStore(storedAtWrite: UnitStatus, reads: UnitStatus[]) {
    let stored = storedAtWrite;
    const tasks: string[] = [];
    const events: string[] = [];
    const api = createApi(fleetSource({
      unitStatus: async () => reads.shift() ?? stored,
      recordBreakdown: async (i) => {
        const expected = (i as { expectedStatus?: UnitStatus | null }).expectedStatus ?? null;
        if (expected !== null && stored !== expected) return { conflict: true };
        stored = i.newStatus as UnitStatus;
        tasks.push(i.description);
        return { taskId: 'task-' + tasks.length };
      },
      units: async () => [{ id: UNIT, name: 'Bucket truck', status: stored }],
      emit: async (t) => { events.push(t); return true; },
    }));
    return { api, tasks, events, stored: () => stored };
  }

  it('two overlapping reports on an UP unit: the brake HOLD stands, the stale minor report is refused', async () => {
    // Both reports read 'up' before either wrote.
    const s = racedStore('up', ['up', 'up']);
    const a = await s.api.reportBreakdown({ unitId: UNIT, description: 'brakes are soft', immobilized: false });
    const b = await s.api.reportBreakdown({ unitId: UNIT, description: 'belt squeals', immobilized: false });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ newStatus: 'held', holdReason: HOLD_REASON, taskId: 'task-1' });
    expect(b.status).toBe(409);
    expect(b.body).toEqual({ error: 'unit_changed', line: CHANGED_LINE });
    expect(s.stored(), 'a minor report lowered a hold only Mike can lift').toBe('held');
    expect(s.tasks).toEqual(['brakes are soft']);
    expect(s.events).toEqual(['equipment.failed']);
    const fleet = (await s.api.fleetUnits()).body as { held: number; units: Array<{ schedulable: boolean; holdReason: string | null }> };
    expect(fleet.held).toBe(1);
    expect(fleet.units[0]).toMatchObject({ schedulable: false, holdReason: HOLD_REASON });
  });

  it('a stale read cannot re-hold a unit Mike just signed back on, un-retire one, or lower a fresh hold to DOWN', async () => {
    for (const [read, now] of [['held', 'up'], ['up', 'retired'], ['down', 'held']] as Array<[UnitStatus, UnitStatus]>) {
      const s = racedStore(now, [read]);
      const res = await s.api.reportBreakdown({ unitId: UNIT, description: 'belt squeals', immobilized: false });
      expect(res.status, `${read} → ${now}`).toBe(409);
      expect(s.stored(), `${read} → ${now}`).toBe(now);
      expect(s.tasks, `${read} → ${now}`).toEqual([]);
      expect(s.events, `${read} → ${now}`).toEqual([]);
    }
  });
});

// The repository itself, against a stand-in for the Supabase client: the
// status filter is on the write, and zero rows touched opens no task.
describe('R26 recordBreakdown — the status write carries the compare, and a miss writes no task', () => {
  type Call = { table: string; op: string; patch?: unknown; filters: Array<[string, unknown]> };

  async function repoWith(rowsTouched: number) {
    const calls: Call[] = [];
    const db = {
      from(table: string) {
        const c: Call = { table, op: 'select', filters: [] };
        calls.push(c);
        const answer = () => (c.op === 'update'
          ? { data: Array.from({ length: rowsTouched }, () => ({ id: UNIT })), error: null }
          : { data: { id: 'task-new' }, error: null });
        const b = {
          update(p: unknown) { c.op = 'update'; c.patch = p; return b; },
          insert(p: unknown) { c.op = 'insert'; c.patch = p; return b; },
          eq(col: string, v: unknown) { c.filters.push([col, v]); return b; },
          select() { return b; },
          single() { return Promise.resolve(answer()); },
          then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) { return Promise.resolve(answer()).then(ok, bad); },
        };
        return b;
      },
    };
    vi.resetModules();
    vi.doMock('../src/db/client.js', () => ({ getDb: () => db }));
    const repo = await import('../src/db/repositories.js');
    return { repo, calls };
  }
  const unmock = () => { vi.doUnmock('../src/db/client.js'); vi.resetModules(); };
  const input = (expectedStatus: UnitStatus | null) => ({
    unitId: UNIT, newStatus: 'maintenance', expectedStatus, description: 'belt squeals', reportedBy: 'owner', mediaRefs: [],
  });

  it('a unit no longer at the expected status touches zero rows: conflict, and no task row', async () => {
    try {
      const { repo, calls } = await repoWith(0);
      expect(await repo.recordBreakdown(input('up'))).toEqual({ conflict: true });
      const upd = calls.find((c) => c.op === 'update')!;
      expect(upd.table).toBe('equipment_unit');
      expect(upd.filters).toEqual([['id', UNIT], ['status', 'up']]);
      expect(calls.some((c) => c.op === 'insert'), 'a task was opened for a report that was not saved').toBe(false);
    } finally { unmock(); }
  });

  it('a unit still at the expected status moves, and then its task is opened', async () => {
    try {
      const { repo, calls } = await repoWith(1);
      expect(await repo.recordBreakdown(input('up'))).toEqual({ taskId: 'task-new' });
      expect(calls.map((c) => [c.table, c.op])).toEqual([['equipment_unit', 'update'], ['maintenance_task', 'insert']]);
      expect(calls[0]!.filters).toEqual([['id', UNIT], ['status', 'up']]);
    } finally { unmock(); }
  });
});

describe('R26 migration — the held status and the sign-back record, nothing more', () => {
  const sql = readFileSync(new URL('../supabase/migrations/0020_fleet_brake_steering_hold.sql', import.meta.url), 'utf8');
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it('allows exactly the five statuses the code knows, and adds who and when', () => {
    expect(code).toContain("check (status in ('up','down','maintenance','held','retired'))");
    expect(code).toContain('add column if not exists signed_back_by text;');
    expect(code).toContain('add column if not exists signed_back_at timestamptz;');
  });

  it('grants no policy, moves no row, and deletes nothing', () => {
    expect(code).not.toMatch(/create\s+policy|grant\s|update\s|delete\s|drop\s+table|truncate/i);
  });
});

// ── Route: behind the admin key gate; the crew key never reaches it ─────────
const saved = { ...process.env };
afterAll(() => { process.env = { ...saved }; vi.resetModules(); });

async function serve(envOverrides: Record<string, string | undefined>): Promise<{ base: string; srv: Server }> {
  vi.resetModules();
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { createArborRequestHandler } = await import('../src/server.js');
  const srv = createServer(createArborRequestHandler());
  await new Promise<void>((r) => srv.listen(0, r));
  const addr = srv.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, srv };
}

describe('R26 route — POST /api/fleet/units/:id/sign-back', () => {
  it('the owner key reaches it; the crew key and no key are refused at the gate', async () => {
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', ARBO_DATA_LINKS: 'sim' });
    try {
      const post = (p: string, k?: string) => fetch(base + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(k ? { 'x-arbor-key': k } : {}) },
        body: JSON.stringify({ signedBackBy: 'somebody on the crew' }),
      });
      const crew = await post('/api/fleet/units/sim-unit-3/sign-back', 'crew-k');
      expect(crew.status).toBe(401);
      expect(await crew.json()).toEqual({ error: 'unauthorized', message: 'The crew door key opens the crew door only. This needs the app key.' });
      expect((await post('/api/fleet/units/sim-unit-3/sign-back')).status).toBe(401);
      expect((await post('/api/fleet/units/sim-unit-3/sign-back', 'wrong')).status).toBe(401);
      // The owner key is past the gate and in the handler: practice data has no
      // writer, so it answers that by name — nothing was signed.
      const owner = await post('/api/fleet/units/sim-unit-3/sign-back', 'admin-k');
      expect(owner.status).toBe(503);
      expect(await owner.json()).toEqual({ error: 'not_simulated' });
      // There is no crew-door twin of it.
      expect((await post('/api/crew/fleet/units/sim-unit-3/sign-back', 'crew-k')).status).toBe(404);
      // And a GET does not sign anything.
      const get = await fetch(base + '/api/fleet/units/sim-unit-3/sign-back', { headers: { 'x-arbor-key': 'admin-k' } });
      expect(get.status).toBe(404);
    } finally { srv.close(); }
  });

  it('the fleet read over the wire carries the hold to the app (owner key only)', async () => {
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', ARBO_DATA_LINKS: 'sim' });
    try {
      expect((await fetch(base + '/api/fleet/units', { headers: { 'x-arbor-key': 'crew-k' } })).status).toBe(401);
      const r = await fetch(base + '/api/fleet/units', { headers: { 'x-arbor-key': 'admin-k' } });
      expect(r.status).toBe(200);
      const body = await r.json() as { held: number; units: Array<{ id: string; holdReason: string | null }> };
      expect(body.held).toBe(1);
      expect(body.units.find((u) => u.id === 'sim-unit-3')!.holdReason).toBe(HOLD_REASON);
    } finally { srv.close(); }
  });
});

// ── The Fleet card, run against stand-ins (vitest has no DOM) ───────────────
const html = loadAppHtml();

function pageFn<T>(name: string, deps: Record<string, unknown> = {}): T {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return new Function(...Object.keys(deps), `${m[0]}\nreturn ${name};`)(...Object.values(deps)) as T;
}
function pageTable(name: string): Record<string, [string, string]> {
  const m = new RegExp(`^const ${name} = (\\{[\\s\\S]*?^\\});`, 'm').exec(html);
  if (!m) throw new Error(`no table ${name} in the page`);
  return new Function(`return ${m[1]};`)() as Record<string, [string, string]>;
}

interface FakeNode {
  tag: string; className: string; textContent: string; disabled: boolean; kids: FakeNode[];
  style: Record<string, string>;
  dataset: Record<string, string>;
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean };
  appendChild(n: FakeNode): FakeNode;
  replaceChildren(...n: FakeNode[]): void;
  addEventListener(type: string, fn: () => unknown): void;
  click(): void;
}
function node(tag: string, cls = '', text?: string): FakeNode {
  const listeners: Array<() => unknown> = [];
  const n: FakeNode = {
    tag, className: cls, textContent: text ?? '', disabled: false, kids: [], style: {}, dataset: {}, // dataset: Direction B P11 — a unit card carries data-unit
    classList: {
      add: (c) => { if (!n.className.split(' ').includes(c)) n.className = `${n.className} ${c}`.trim(); },
      remove: (c) => { n.className = n.className.split(' ').filter((x) => x !== c).join(' '); },
      contains: (c) => n.className.split(' ').includes(c),
    },
    appendChild(k) { n.kids.push(k); return k; },
    replaceChildren(...k) { n.kids = [...k]; },
    addEventListener(type, fn) { if (type === 'click') listeners.push(fn); },
    click() { for (const fn of listeners) fn(); },
  };
  return n;
}
const all = (n: FakeNode): FakeNode[] => [n, ...n.kids.flatMap(all)];
const textOf = (n: FakeNode): string => all(n).map((x) => x.textContent).filter(Boolean).join(' | ');
const settle = () => new Promise((r) => setTimeout(r, 0));

function fleetPage(payload: () => unknown, signBack: (path: string) => Promise<unknown>) {
  const calls: Array<{ path: string; method: string }> = [];
  const timers: Array<() => void> = [];
  const api = async (path: string, opts?: { method?: string }) => {
    calls.push({ path, method: (opts && opts.method) || 'GET' });
    if (path === '/api/fleet/units') return payload();
    return signBack(path);
  };
  const armTwice = pageFn('armTwice', { setTimeout: (fn: () => void) => timers.push(fn), clearTimeout: () => {} });
  const plural = pageFn('plural');
  const render = pageFn<(slot: FakeNode) => Promise<boolean>>('renderFleetList', {
    api, armTwice, plural,
    el: node,
    chip: (text: string, tone: string) => node('span', `badge ${tone}`, text),
    state: (title: string, msg: string) => node('div', 'state', `${title} ${msg}`),
    partAdder: () => node('details', 'agent-law', 'part adder'),
    // R31: the Bouncie line is its own function (test/bouncie.test.ts); here it is an empty stand-in.
    fleetTrackLine: () => node('div', 'storm-muted fleet-track', ''),
    openBreakdown: () => {},
    saveFailText: (e: { code?: number }) => `Not saved — refused (${e.code}). Nothing was written.`,
    // D113: a refusal in the server's own words is marked "en inglés" in Spanish (saveFailMark) — English draws nothing more.
    saveFailMark: (n: FakeNode) => n,
    UNIT_STATUS: pageTable('UNIT_STATUS'),
    LINKS_READY: Promise.resolve('simulation'), FEED_WORD: {}, feedKind: () => 'unread', feedSays: () => '',
    window: { alert: () => {} },
  });
  return { render, calls };
}

const FLEET = {
  units: [
    { id: 'u1', name: 'Chip truck', kind: 'chip truck', status: 'up', schedulable: true, holdReason: null, openTasks: 0, heightInches: 138, weightLbsLoaded: 26000 },
    { id: 'u2', name: 'Chipper', kind: 'chipper', status: 'down', schedulable: false, holdReason: null, openTasks: 2, heightInches: 100, weightLbsLoaded: 9000 },
    { id: 'u3', name: 'Bucket truck', kind: 'bucket truck', status: 'held', schedulable: false, holdReason: HOLD_REASON, openTasks: 1, heightInches: 132, weightLbsLoaded: 24000 },
  ],
  down: 1, held: 1,
};

describe('R26 Fleet card — the hold is on screen, and signing it back on asks twice', () => {
  const cards = (slot: FakeNode) => slot.kids.filter((k) => k.className.startsWith('card'));
  const button = (card: FakeNode, text: string) => all(card).find((n) => n.tag === 'button' && n.textContent === text);

  it('the heading never says "all units schedulable" while a unit is held', async () => {
    const { render } = fleetPage(() => FLEET, async () => ({}));
    const slot = node('div');
    expect(await render(slot)).toBe(true);
    expect(slot.kids[0]!.textContent).toBe('Fleet — 1 unit down, 1 unit held');
    const onlyHeld = fleetPage(() => ({ ...FLEET, units: [FLEET.units[0], FLEET.units[2]], down: 0, held: 1 }), async () => ({}));
    const s2 = node('div');
    await onlyHeld.render(s2);
    expect(s2.kids[0]!.textContent).toBe('Fleet — 1 unit held');
  });

  it('off-schedule units lead, and a held card wears the stop edge, HELD, the named reason and its button', async () => {
    const { render } = fleetPage(() => FLEET, async () => ({}));
    const slot = node('div');
    await render(slot);
    const [first, second, third] = cards(slot);
    expect([first!, second!, third!].map((c) => textOf(c).split(' | ')[0])).toEqual(['Chipper', 'Bucket truck', 'Chip truck']);
    expect(second!.className).toBe('card emergency');
    const t = textOf(second!);
    expect(t).toContain('HELD');
    expect(t).toContain('NOT SCHEDULABLE');
    expect(t).toContain("On hold: brake/steering defect — needs Mike's sign-off. It stays off the schedule until you sign it back on.");
    expect(all(second!).find((n) => n.textContent === 'HELD')!.className).toBe('badge stop');
    expect(button(second!, 'Sign it back on')).toBeTruthy();
    assertLawfulCopy(t);
    // Only the held unit carries the button — never a DOWN one, never an UP one.
    expect(button(first!, 'Sign it back on')).toBeUndefined();
    expect(button(third!, 'Sign it back on')).toBeUndefined();
  });

  it('the first tap only arms and says what it will do; the second posts, then the list redraws', async () => {
    let held = true;
    const { render, calls } = fleetPage(
      () => (held ? FLEET : { ...FLEET, units: FLEET.units.map((u) => (u.id === 'u3' ? { ...u, status: 'up', schedulable: true, holdReason: null } : u)), held: 0 }),
      async () => { held = false; return { ok: true }; },
    );
    const slot = node('div');
    await render(slot);
    const sign = button(cards(slot)[1]!, 'Sign it back on')!;
    sign.click();
    await settle();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(sign.textContent).toBe('Tap again to sign Bucket truck back on with 1 open task still on it — it goes back on the schedule');
    sign.click();
    await settle(); await settle();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([{ path: '/api/fleet/units/u3/sign-back', method: 'POST' }]);
    // Redrawn from the server's answer: the unit is up and the heading follows.
    expect(slot.kids[0]!.textContent).toBe('Fleet — 1 unit down');
    expect(all(slot).some((n) => n.tag === 'button' && n.textContent === 'Sign it back on')).toBe(false);
  });

  it('a refused sign-back says so under the button and leaves the hold on screen', async () => {
    const { render } = fleetPage(() => FLEET, async () => { throw Object.assign(new Error('not_held'), { code: 409 }); });
    const slot = node('div');
    await render(slot);
    const card = cards(slot)[1]!;
    const sign = button(card, 'Sign it back on')!;
    sign.click(); sign.click();
    await settle(); await settle();
    expect(sign.disabled).toBe(false);
    expect(textOf(card)).toContain('Not on hold any more — nothing to sign back on. Tap ↻ to see where it stands.');
    expect(textOf(card)).toContain('HELD');

    const failing = fleetPage(() => FLEET, async () => { throw Object.assign(new Error('link_cut'), { code: 503 }); });
    const s2 = node('div');
    await failing.render(s2);
    const card2 = cards(s2)[1]!;
    const sign2 = button(card2, 'Sign it back on')!;
    sign2.click(); sign2.click();
    await settle(); await settle();
    expect(textOf(card2)).toContain('Not saved — refused (503). Nothing was written.');
  });

  it('the page reaches the route through the shared helpers, never a second fetch', () => {
    const f = html.slice(html.indexOf('async function renderFleetList('), html.indexOf('// A part that fits this unit'));
    expect(f).toContain("api('/api/fleet/units/' + u.id + '/sign-back', { method: 'POST', body: {} })");
    // Pin moved (R27 Phase A, owner app b), meaning kept: the same armed line (with or without its open tasks), the name its value.
    expect(f).toContain("armTwice(sign, u.openTasks > 0");
    expect(f).toContain("tf('Tap again to sign {name} back on — it goes back on the schedule', { name: u.name })");
    expect(f).toContain('saveFailText(ex)');
    expect(f).not.toContain('fetch(');
    expect(f).not.toMatch(/\bbadge\(/);
  });
});
