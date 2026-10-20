// R26 review fix (crewpermit): the crew work order keeps two permit facts
// apart. A permit lookup that FAILED is named as a failed read — "PERMIT
// STATUS UNKNOWN — Arbo could not read the permit screen" — and never as
// PERMIT SCREEN PENDING / "no screen on file", which is the X6 badge word for
// a lookup that ANSWERED and found nothing (§1B: "we couldn't read it" and
// "there's nothing there" never render the same). Both stay on the safety
// surface as UNKNOWN warnings: neither is ever silence (§6B.3), and neither
// ever says clear.
//
// The repository half runs the REAL listCrewJobs through the REAL getDb()
// door, with a fake fetch, so nothing here can reach a network. The failure
// it reproduces is the R19 one: Mike opens links one by one, so the jobs link
// can be open while the permits link is still cut.
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { buildCrewPayload, type WorkOrderSource } from '../src/crew/workOrder.js';
import { createApi, type DataSource, type CrewJobSource } from '../src/server/api.js';

const UNREADABLE_NOTE = 'PERMIT STATUS UNKNOWN — Arbo could not read the permit screen. Check with the office before protected work.';
const PENDING_NOTE = 'PERMIT SCREEN PENDING — status UNKNOWN, no screen on file. Check with the office before protected work.';

const src = (over: Partial<WorkOrderSource> = {}): WorkOrderSource => ({
  jobId: 'SIM-job-1', routeOrder: 1, address: '1 SIM Way', city: 'Norfolk',
  timeIso: '2026-10-21T13:00:00Z', scope: 'SIMULATED removal',
  hazardPowerLines: false, hazardStructures: false, permitStatus: null,
  photoRefs: [], briefingId: null, ...over,
});

describe('buildCrewPayload — a failed permit read is named, never "no screen on file"', () => {
  it('a FAILED lookup reads PERMIT STATUS UNKNOWN — could not read the permit screen', () => {
    const note = buildCrewPayload(src({ permitUnreadable: true })).permitNote;
    expect(note).toBe(UNREADABLE_NOTE);
    expect(note).not.toMatch(/SCREEN PENDING|no screen on file/i);
  });

  it('a lookup that answered with no screen on file keeps PERMIT SCREEN PENDING', () => {
    expect(buildCrewPayload(src({ permitScreenPending: true })).permitNote).toBe(PENDING_NOTE);
  });

  it('if both flags ever arrive, the failed read wins: Arbo never claims a fact it could not read', () => {
    expect(buildCrewPayload(src({ permitUnreadable: true, permitScreenPending: true })).permitNote).toBe(UNREADABLE_NOTE);
  });

  it('a real screen result still outranks the unreadable note', () => {
    expect(buildCrewPayload(src({ permitStatus: 'PERMIT_LIKELY', permitUnreadable: true })).permitNote)
      .toMatch(/^PERMIT LIKELY/);
  });

  it('neither UNKNOWN note is silent, and neither says clear or exempt', () => {
    for (const note of [UNREADABLE_NOTE, PENDING_NOTE]) {
      expect(note).toMatch(/UNKNOWN/);
      expect(note).toMatch(/check with the office before protected work/i);
      expect(note.toLowerCase()).not.toMatch(/clear|exempt|good to cut/);
    }
  });
});

describe('crewWorkOrders — the unreadable flag rides from the source to the crew note', () => {
  const job = (over: Partial<CrewJobSource> = {}): CrewJobSource => ({
    jobId: 'SIM-job-1', scheduledFor: '2026-10-21T13:00:00Z', address: '1 SIM Way',
    city: 'Norfolk', scope: 'SIMULATED removal', hazardPowerLines: false,
    hazardStructures: false, permitStatus: null, propertyId: 'SIM-prop-1', ...over,
  });
  const api = (jobs: CrewJobSource[]) => createApi({
    ready: () => true, stopsBetween: async () => [], newLeads: async () => [],
    crewJobs: async () => jobs, jobsWithFiledContract: async (ids) => new Set(ids),
  } satisfies DataSource);
  const notes = async (jobs: CrewJobSource[]) =>
    ((await api(jobs).crewWorkOrders('2026-10-21')).body as { workOrders: Array<{ permitNote: string | null }> })
      .workOrders.map((w) => w.permitNote);

  it('permitUnreadable → the failed-read note; permitScreenPending → the pending note', async () => {
    expect(await notes([job({ permitUnreadable: true })])).toEqual([UNREADABLE_NOTE]);
    expect(await notes([job({ permitScreenPending: true })])).toEqual([PENDING_NOTE]);
  });
});

// ── The repository: the real listCrewJobs behind the real getDb() door ─────
const saved = { ...process.env };
const net = { permitStatus: 200, permitRows: [] as unknown[], tablesFetched: [] as string[] };
const JOB_ROWS = [{
  id: 'SIM-job-1', scheduled_for: '2026-10-21T13:00:00Z', materials: 'SIMULATED removal', property_id: 'SIM-prop-1',
  property: { address: '1 SIM Way', city: 'Norfolk', hazard_power_lines: false, hazard_structures: false },
}];

beforeAll(() => {
  // postgrest-js hands fetch the URL as a string; anything else fails loudly here.
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = new URL(String(input));
    const table = url.pathname.replace(/^\/rest\/v1\//, '');
    net.tablesFetched.push(table);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (table === 'job') return json(JOB_ROWS);
    if (table === 'permit') {
      return net.permitStatus === 200
        ? json(net.permitRows)
        : json({ message: 'SIMULATED permit read failure', code: 'XX000' }, net.permitStatus);
    }
    return json({ message: 'unexpected table in test' }, 404);
  });
});

afterEach(() => { vi.restoreAllMocks(); });

afterAll(() => {
  vi.unstubAllGlobals();
  process.env = { ...saved };
  vi.resetModules();
});

/** Fresh repository module under the given link settings. Fake, shape-valid credentials only. */
async function loadRepo(permitsLink: 'live' | 'cut') {
  vi.resetModules();
  process.env = { ...saved };
  for (const k of Object.keys(process.env)) if (k.startsWith('ARBO_LINK_')) delete process.env[k];
  process.env.ARBO_DATA_LINKS = 'live';
  process.env.ARBO_LINK_JOBS = 'live';
  if (permitsLink === 'live') process.env.ARBO_LINK_PERMITS = 'live';
  process.env.SUPABASE_URL = 'https://sim-crewpermit.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_SIMULATEDTESTONLY';
  net.tablesFetched = [];
  return import('../src/db/repositories.js');
}

describe('listCrewJobs — a failed permit read is unreadable, not "no screen on file"', () => {
  it('permits link CUT (jobs open): the row is permitUnreadable, NOT permitScreenPending', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const repo = await loadRepo('cut');
    const rows = await repo.listCrewJobs('2026-10-21T00:00:00Z', '2026-10-22T00:00:00Z');
    expect(net.tablesFetched).toEqual(['job']); // the cut door refused before any permit request
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ permitStatus: null, permitUnreadable: true, permitScreenPending: false });
    // Ops still sees why — and the log line carries no customer data (§4.3).
    expect(err).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/SIM Way|Norfolk/);
  });

  it('a plain Supabase error on the permit read is the same failed read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    net.permitStatus = 500;
    const repo = await loadRepo('live');
    const rows = await repo.listCrewJobs('2026-10-21T00:00:00Z', '2026-10-22T00:00:00Z');
    net.permitStatus = 200;
    expect(net.tablesFetched).toEqual(['job', 'permit']);
    expect(rows[0]).toMatchObject({ permitStatus: null, permitUnreadable: true, permitScreenPending: false });
  });

  it('a lookup that ANSWERED with no row is screen pending, not unreadable', async () => {
    net.permitRows = [];
    const repo = await loadRepo('live');
    const rows = await repo.listCrewJobs('2026-10-21T00:00:00Z', '2026-10-22T00:00:00Z');
    expect(rows[0]).toMatchObject({ permitStatus: null, permitUnreadable: false, permitScreenPending: true });
  });

  it('a screen on file carries its status and raises neither UNKNOWN flag', async () => {
    net.permitRows = [{ id: 'SIM-permit-1', property_id: 'SIM-prop-1', job_id: null, city: 'Norfolk', screen_status: 'PERMIT_LIKELY',
      in_rpa: true, status: 'needed', form_ref: null, ruleset_last_verified: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }];
    const repo = await loadRepo('live');
    const rows = await repo.listCrewJobs('2026-10-21T00:00:00Z', '2026-10-22T00:00:00Z');
    net.permitRows = [];
    expect(rows[0]).toMatchObject({ permitStatus: 'PERMIT_LIKELY', permitUnreadable: false, permitScreenPending: false });
  });

  it('end to end: permits link cut → the crew reads "could not read", never "no screen on file"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const repo = await loadRepo('cut');
    const rows = await repo.listCrewJobs('2026-10-21T00:00:00Z', '2026-10-22T00:00:00Z');
    const res = await createApi({
      ready: () => true, stopsBetween: async () => [], newLeads: async () => [],
      crewJobs: async () => rows, jobsWithFiledContract: async (ids) => new Set(ids),
    }).crewWorkOrders('2026-10-21');
    const note = (res.body as { workOrders: Array<{ permitNote: string | null }> }).workOrders[0]!.permitNote;
    expect(note).toBe(UNREADABLE_NOTE);
    expect(note).not.toMatch(/SCREEN PENDING|no screen on file/i);
  });
});
