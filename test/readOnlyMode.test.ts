/*
  SLOW::ARBO — these tests pin the read-only data mode at the one door
  (src/db/client.ts). The note at the top of src/db/client.ts applies.
*/
// R32 — Mike, 2026-10-20, verbatim: "give arbo and its agents read only
// data access and run systems checks every couple hours while you contuin to
// build". ARBO_DATA_LINKS=readonly: Arbo READS the named links through the one
// door and every WRITE is refused there, by name, before anything leaves.
//
// Everything below runs the REAL getDb() door against a FAKE Supabase (a stub
// fetch that records every request and answers reads with fake rows), so no
// test can reach a network — and "no request leaves" is checked, not assumed.
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';

const SUPA = 'https://sim-readonly.supabase.co';
const saved = { ...process.env };
const realFetch = globalThis.fetch;

type Req = { method: string; table: string };
const net = { reqs: [] as Req[], rows: {} as Record<string, unknown[]>, counts: {} as Record<string, number> };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The fake Supabase. Reads answer; a write that ever reached it would be recorded and fail the "no request leaves" checks. */
async function fakeFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const raw = typeof input === 'string' ? input : 'href' in input ? input.href : input.url;
  const url = new URL(raw);
  if (url.origin !== SUPA) return realFetch(input, init); // the test's own HTTP calls to the local server
  const method = String(init?.method ?? 'GET').toUpperCase();
  const table = url.pathname.replace(/^\/rest\/v1\//, '');
  net.reqs.push({ method, table });
  if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': `*/${net.counts[table] ?? 0}` } });
  if (method === 'GET') return json(net.rows[table] ?? []);
  return json({ message: 'SIMULATED: a write reached the fake Supabase' }, 500);
}
const writesThatLeft = () => net.reqs.filter((r) => r.method !== 'GET' && r.method !== 'HEAD');

beforeAll(() => { vi.stubGlobal('fetch', fakeFetch); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
afterAll(() => {
  vi.unstubAllGlobals();
  process.env = { ...saved };
  vi.resetModules();
});

/** A fresh module graph under this master switch. Fake, shape-valid credentials only. */
async function boot(mode: string, extra: Record<string, string> = {}) {
  vi.resetModules();
  process.env = { ...saved };
  for (const k of Object.keys(process.env)) if (k.startsWith('ARBO_LINK_') || k === 'APP_ACCESS_KEY' || k === 'CREW_ACCESS_KEY') delete process.env[k];
  process.env.ARBO_DATA_LINKS = mode;
  process.env.SUPABASE_URL = SUPA;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_SIMULATEDTESTONLY';
  Object.assign(process.env, extra);
  net.reqs = [];
  net.rows = {};
  net.counts = {};
  const client = await import('../src/db/client.js');
  const links = await import('../src/db/links.js');
  const notSaved = await import('../src/db/notSaved.js');
  return { client, links, notSaved };
}

/** What a thrown refusal is, without letting a non-throw pass. */
function refusal(fn: () => unknown): Error {
  try { fn(); } catch (e) { return e as Error; }
  throw new Error('expected a refusal, got none');
}

// ═══ 1. The door ════════════════════════════════════════════════════════════
describe('read-only: the door reads the named links and refuses every write by name', () => {
  it('a read of an open link goes out as a GET and comes back', async () => {
    const { client } = await boot('readonly');
    net.rows.lead = [{ id: 'SIM-lead-1' }];
    const r = await client.getDb().from('lead').select('id');
    expect(r.error).toBeNull();
    expect(r.data).toEqual([{ id: 'SIM-lead-1' }]);
    expect(net.reqs).toEqual([{ method: 'GET', table: 'lead' }]);
  });

  it.each(['insert', 'upsert', 'update', 'delete'] as const)('%s on the query builder is refused BY NAME — and no request leaves', async (verb) => {
    const { client, links } = await boot('readonly');
    const builder = client.getDb().from('lead') as unknown as Record<string, (...a: unknown[]) => unknown>;
    const err = refusal(() => builder[verb]!({ status: 'qualified' }));
    expect(err).toBeInstanceOf(links.ReadOnlyError);
    // It IS a LinkCutError too, so a handler that only knows the link refusal still answers a named 503.
    expect(err).toBeInstanceOf(links.LinkCutError);
    expect(err.name).toBe('ReadOnlyError');
    expect((err as InstanceType<typeof links.ReadOnlyError>).op).toBe(verb);
    expect(err.message).toContain(`'${verb}'`);
    expect(err.message).toContain(links.READ_ONLY_LINE);
    expect(net.reqs).toEqual([]);
  });

  it.each(['rpc', 'schema', 'storage', 'functions', 'channel', 'channels', 'realtime', 'removeAllChannels', 'auth', 'rest'])(
    'client.%s is refused at the door — only `from` is handed out',
    async (surface) => {
      const { client, links } = await boot('readonly');
      const db = client.getDb() as unknown as Record<string, unknown>;
      const err = refusal(() => db[surface]);
      expect(err).toBeInstanceOf(links.ReadOnlyError);
      expect(err.message).toContain(`'${surface}'`);
      expect(net.reqs).toEqual([]);
    },
  );

  it('`constructor` is refused too — nobody builds a fresh, unguarded client from the read-only one', async () => {
    const { client, links } = await boot('readonly');
    const db = client.getDb() as unknown as Record<string, unknown>;
    expect(() => db.constructor).toThrow(links.ReadOnlyError);
    const builder = client.getDb().from('lead') as unknown as Record<string, unknown>;
    expect(() => builder.constructor).toThrow(links.ReadOnlyError);
    // Not doors: await's `then` and symbols answer undefined, so neither poses as a promise.
    expect(db.then).toBeUndefined();
    expect(builder.then).toBeUndefined();
  });

  it('schema().from().insert, rpc() and storage uploads never get far enough to send anything', async () => {
    const { client, links } = await boot('readonly');
    const db = client.getDb();
    expect(() => db.schema('public').from('lead').insert({})).toThrow(links.ReadOnlyError);
    expect(() => db.rpc('arbo_anything')).toThrow(links.ReadOnlyError);
    expect(() => db.storage.from('photos').upload('x', Buffer.from('x'))).toThrow(links.ReadOnlyError);
    expect(net.reqs).toEqual([]);
  });

  it('the wire is the third layer: a builder forced to POST is refused before it leaves', async () => {
    const { client } = await boot('readonly');
    // A path nobody thought of: a read builder with its method changed by hand.
    const q = client.getDb().from('lead').select('id') as unknown as { method: string } & PromiseLike<{ error: { message: string } | null }>;
    q.method = 'POST';
    const r = await q;
    expect(r.error?.message).toMatch(/ReadOnlyError/);
    expect(net.reqs).toEqual([]);
  });

  it('a HEAD count (the /api/links probe) is a read and goes through', async () => {
    const { client } = await boot('readonly');
    net.counts.lead = 37;
    const r = await client.getDb().from('lead').select('*', { count: 'exact', head: true });
    expect(r.count).toBe(37);
    expect(net.reqs).toEqual([{ method: 'HEAD', table: 'lead' }]);
  });

  it.each(['lead', 'campaign', 'contact', 'contact_property', 'property', 'tree', 'estimate', 'location_ping', 'crew_member', 'certification', 'training_item', 'training_event', 'equipment_unit', 'equipment_part', 'maintenance_task', 'tool', 'near_miss', 'site_condition_record', 'leakage_event', 'event', 'event_cursor', 'agent_run', 'ops_setting', 'reference_entry'])(
    'readable in read-only: %s',
    async (table) => {
      const { client } = await boot('readonly');
      const r = await client.getDb().from(table).select('id');
      expect(r.error).toBeNull();
      expect(net.reqs).toEqual([{ method: 'GET', table }]);
    },
  );

  it.each([
    ['conversation_log', 'calls'], ['call_log', 'calls'], ['photo', 'photos'],
    ['job', 'jobs'], ['invoice', 'jobs'], ['work_order', 'jobs'], ['permit', 'permits'], ['permit_correspondence', 'permits'],
  ])('kept CUT in read-only: %s (%s) — refused as a cut link with its reason, never a read', async (table, link) => {
    const { client, links } = await boot('readonly');
    const err = refusal(() => client.getDb().from(table));
    expect(err).toBeInstanceOf(links.LinkCutError);
    expect(err).not.toBeInstanceOf(links.ReadOnlyError);
    expect(err.message).toContain(`Data link '${link}' stays CUT in read-only mode`);
    expect(err.message).toContain(links.READ_ONLY_KEPT_CUT[link as keyof typeof links.READ_ONLY_KEPT_CUT]!);
    expect(err.message).not.toMatch(/ARBO_LINK_/); // nobody "fixes" this with a variable
    expect(net.reqs).toEqual([]);
  });

  it('a per-link variable cannot open a kept-cut link in read-only (the list rules)', async () => {
    const { links } = await boot('readonly', { ARBO_LINK_CALLS: 'live', ARBO_LINK_JOBS: 'live', ARBO_LINK_PERMITS: 'live', ARBO_LINK_PHOTOS: 'live' });
    for (const l of ['calls', 'jobs', 'permits', 'photos'] as const) expect(links.linkOpen(l), l).toBe(false);
    expect(links.linkOpen('leads')).toBe(true);
  });

  it('an EMBEDDED table passes the link check too: a kept-cut link stays cut inside another link’s read', async () => {
    const { client, links } = await boot('readonly');
    const db = client.getDb();
    // The Book's property list embeds jobs:job(count) — jobs is kept cut.
    expect(() => db.from('property').select('id, trees:tree(count), jobs:job(count)')).toThrow(links.LinkCutError);
    // A foreign-key column names the table it points at: job_id → job.
    expect(() => db.from('estimate').select('id, job:job_id(id)')).toThrow(/Data link 'jobs' stays CUT/);
    // Something the door cannot map fails closed, like an unmapped root table.
    expect(() => db.from('lead').select('id, x:mystery_thing(id)')).toThrow(/belongs to no data link/);
    expect(net.reqs).toEqual([]);
    // The inbox's own embeds (contact, property) are open links: the read goes out.
    const r = await db.from('lead').select('id, contact:contact_id(name, phones), property:property_id (id, city)');
    expect(r.error).toBeNull();
    expect(net.reqs).toEqual([{ method: 'GET', table: 'lead' }]);
  });

  it('an unmapped root table still fails closed in read-only', async () => {
    const { client, links } = await boot('readonly');
    expect(() => client.getDb().from('prune_plan')).toThrow(links.LinkCutError);
    expect(() => client.getDb().from('prune_plan')).toThrow(/belongs to no data link/);
  });

  it('"live" keeps working exactly as today: an open link WRITES, and the client surfaces are its own', async () => {
    const { client } = await boot('live', { ARBO_LINK_LEADS: 'live' });
    const db = client.getDb();
    expect(typeof db.rpc).toBe('function'); // live never wore the read-only door
    await db.from('lead').update({ status: 'qualified' }).eq('id', 'SIM-lead-1');
    expect(net.reqs).toEqual([{ method: 'PATCH', table: 'lead' }]);
  });

  it('switching the master between calls never hands the read-only door a writable client, or live a read-only one', async () => {
    const { client, links } = await boot('readonly');
    const ro = client.getDb();
    process.env.ARBO_DATA_LINKS = 'live';
    process.env.ARBO_LINK_LEADS = 'live';
    const live = client.getDb();
    // Identity is compared outside expect(): the read-only client refuses even
    // `constructor` (see the test below), which a matcher's formatter would ask for.
    expect(Object.is(live, ro)).toBe(false);
    process.env.ARBO_DATA_LINKS = 'readonly';
    expect(Object.is(client.getDb(), ro)).toBe(true);
    expect(() => client.getDb().from('lead').insert({})).toThrow(links.ReadOnlyError);
  });

  // Door review, finding 1: a live handle kept across a switch must not outlive 'live'.
  it('a handle taken while "live" cannot write once the master is "readonly" — it answers to the door in force NOW', async () => {
    const { client, links } = await boot('live', { ARBO_LINK_LEADS: 'live' });
    const stale = client.getDb();
    process.env.ARBO_DATA_LINKS = 'readonly';
    expect(() => stale.from('lead').insert({ status: 'qualified' })).toThrow(links.ReadOnlyError);
    expect(() => stale.from('contact').delete()).toThrow(links.ReadOnlyError); // contacts was never opened in live
    expect(() => stale.rpc('anything')).toThrow(links.ReadOnlyError);
    // A read through the stale handle still goes out — through the read-only door.
    net.rows.lead = [{ id: 'SIM-lead-1' }];
    expect((await stale.from('lead').select('id')).data).toEqual([{ id: 'SIM-lead-1' }]);
    // Cut (any other value) refuses the stale handle outright.
    process.env.ARBO_DATA_LINKS = 'off';
    expect(() => stale.from('lead')).toThrow(/CUT/);
    expect(() => stale.rpc('anything')).toThrow(/CUT/);
    expect(writesThatLeft()).toEqual([]);
    expect(net.reqs).toEqual([{ method: 'GET', table: 'lead' }]);
  });

  // Door review, finding 2: the wire itself is an allow-list — only a select of a
  // readable table, with every embed readable, leaves. A refused read answers a
  // 403 at once (a rejected GET would be retried three times by postgrest-js).
  // Loose on purpose: the client's own types parse select strings at the type level.
  type Read = PromiseLike<{ error: { message: string } | null; data: unknown }>;
  type Builder = Read & { select: (columns: string) => Builder; url: URL };
  type Db = { from: (table: string) => Builder };
  it('a quoted embed is refused at the door by name, the same as an unquoted one', async () => {
    const { client } = await boot('readonly');
    expect(() => client.getDb().from('lead').select('id, "job"(id)')).toThrow(/Data link 'jobs' stays CUT/);
    expect(net.reqs).toEqual([]);
  });

  it.each<[string, (db: Db) => unknown]>([
    ['a second select chained on, embedding a kept-cut table', (db) => db.from('lead').select('id').select('id, job(id)')],
    ['a second select chained on, with a quoted embed', (db) => db.from('lead').select('id').select('id, "job"(id)')],
    ['a column list that is not a plain string', (db) => db.from('lead').select(new String('id, job(id)') as unknown as string)],
    ['a read builder pointed at an rpc', (db) => Object.assign(db.from('lead').select('id'), { url: new URL(`${SUPA}/rest/v1/rpc/fn`) })],
    ['a read builder pointed at an edge function', (db) => Object.assign(db.from('lead').select('id'), { url: new URL(`${SUPA}/functions/v1/f`) })],
    ['a read builder pointed at a kept-cut table', (db) => Object.assign(db.from('lead').select('id'), { url: new URL(`${SUPA}/rest/v1/permit_correspondence?select=id`) })],
    ['a read builder pointed off the Supabase host', (db) => Object.assign(db.from('lead').select('id'), { url: new URL('https://elsewhere.example/rest/v1/lead?select=id') })],
  ])('the wire refuses %s — nothing is sent, and the refusal is immediate', async (_what, build) => {
    const { client } = await boot('readonly');
    const t0 = Date.now();
    const r = await (build(client.getDb() as unknown as Db) as Read);
    expect(r.error?.message).toMatch(/CUT|belongs to no data link/);
    expect(r.data).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(net.reqs).toEqual([]);
  });

  it('the wire allow-list still lets every real read through: a select, its readable embeds, a HEAD count', async () => {
    const { client } = await boot('readonly');
    const db = client.getDb();
    expect((await db.from('lead').select('id, contact:contact_id(name, phones), property:property_id (id, city)')).error).toBeNull();
    expect((await db.from('property').select('id, trees:tree(count)')).error).toBeNull();
    expect((await db.from('lead').select('*', { count: 'exact', head: true })).error).toBeNull();
    expect(net.reqs).toEqual([{ method: 'GET', table: 'lead' }, { method: 'GET', table: 'property' }, { method: 'HEAD', table: 'lead' }]);
  });
});

// ═══ 2. Background writers degrade to a named "not saved" state ═════════════
describe('read-only: every background writer degrades by name — no crash, no loop, no unhandled rejection', () => {
  it('the agent run log is not written; the run is kept in memory and counted', async () => {
    const { notSaved } = await boot('readonly');
    const { startAgentRun, unsavedAgentRuns } = await import('../src/binder/agentRun.js');
    const run = await startAgentRun({ agent: 'weather' });
    expect(run).toMatchObject({ id: null, saved: false });
    await run.finish({ status: 'ok', outputSummary: 'feed=ok active=0' });
    expect(unsavedAgentRuns(5)).toEqual([expect.objectContaining({ agent: 'weather', status: 'ok', saved: false, id: null })]);
    expect(notSaved.notSavedReport().byKind.agent_run).toBe(1);
    expect(net.reqs).toEqual([]);
  });

  it('emitSafe raises nothing and says so in the count — never a silent false', async () => {
    const { notSaved } = await boot('readonly');
    const { emitSafe } = await import('../src/binder/eventBus.js');
    expect(await emitSafe('weather.alert.raised', { alertId: 'SIM-1' }, 'test')).toBe(false);
    expect(notSaved.notSavedReport().byKind.event).toBe(1);
    expect(net.reqs).toEqual([]);
  });

  it('consumeNew still reads and handles the events, but never writes the cursor', async () => {
    await boot('readonly');
    net.rows.event = [{ seq: 1, id: 'e1', type: 'lead.created', payload: {}, source: 'sim', emitted_at: '2026-10-20T00:00:00Z' }];
    const { consumeNew } = await import('../src/binder/eventBus.js');
    const seen: number[] = [];
    const out = await consumeNew('permitting-agent', async (e) => { seen.push(e.seq); });
    expect(out).toEqual({ processed: 1, cursorSaved: false });
    expect(seen).toEqual([1]);
    expect(net.reqs.map((r) => r.table)).toEqual(['event_cursor', 'event']);
    expect(writesThatLeft()).toEqual([]);
  });

  it('one scheduler tick: every agent runs read-only, the line names it, nothing is written, nothing rejects unhandled', async () => {
    await boot('readonly');
    const { startAgentScheduler } = await import('../src/agents/sweep.js');
    const { unsavedAgentRuns } = await import('../src/binder/agentRun.js');
    const unhandled: unknown[] = [];
    const onUnhandled = (r: unknown) => { unhandled.push(r); };
    process.on('unhandledRejection', onUnhandled);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a503 = async () => ({ status: 503, body: { error: 'link_cut' } });
    const api = { brief: a503, queue: a503, forecast: a503, storm: async () => ({ status: 200, body: { alerts: [] } }) };
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    const handle = startAgentScheduler(api as never, { activeAlerts: async () => [] });
    try {
      await vi.advanceTimersByTimeAsync(90_000);
      await vi.waitFor(() => {
        const lines = [...log.mock.calls, ...err.mock.calls].map((c) => String(c[0]));
        expect(lines.some((l) => l.startsWith('[agents] sweep'))).toBe(true);
      });
    } finally {
      clearInterval(handle);
      process.off('unhandledRejection', onUnhandled);
    }
    const line = [...log.mock.calls, ...err.mock.calls].map((c) => String(c[0])).find((l) => l.startsWith('[agents] sweep'))!;
    expect(line).toContain('READ-ONLY — run log and events NOT saved');
    expect(unhandled).toEqual([]);
    expect(writesThatLeft()).toEqual([]);
    // All six agents ran and are on the in-memory log, each marked not saved.
    const runs = unsavedAgentRuns(20);
    expect(runs.map((r) => r.agent).sort()).toEqual(['booking', 'collections', 'owner-briefing', 'permitting', 'safety', 'weather']);
    expect(runs.every((r) => r.saved === false)).toBe(true);
    // The two that need the held jobs link say WHY they could not read, in the link's own words.
    for (const a of ['booking', 'collections']) {
      const r = runs.find((x) => x.agent === a)!;
      expect(r.status, a).toBe('error');
      expect(r.output_summary, a).toContain("Data link 'jobs' stays CUT in read-only mode");
    }
    // The permitting agent read the bus and said its cursor was not saved.
    expect(runs.find((x) => x.agent === 'permitting')!.output_summary).toContain('cursor=not_saved_read_only');
  });

  // Behaviour review, finding 2: read-only opens the (empty) crew link — the
  // hourly safety agent must not read an empty roster as an all-clear.
  it('the hourly safety agent over the real, empty roster names it — empty blindSpots is the only all-clear', async () => {
    await boot('readonly');
    const { runSafetyAgent } = await import('../src/agents/safetyAgent.js');
    const r = await runSafetyAgent({ activeAlerts: async () => [] }, new Date('2026-10-20T15:00:00Z'));
    expect(r.status).toBe('ok');
    expect(r.certs.feed).toBe('ok');
    expect(r.blindSpots).toEqual(['certifications: crew roster is empty — no one to check, not an all-clear']);
    expect(writesThatLeft()).toEqual([]);
  });

  it('the safety agent with someone on the roster does not say the roster is empty', async () => {
    await boot('readonly');
    net.rows.crew_member = [{ id: 'SIM-crew-1', name: 'SIM-Climber', role: 'climber', active: true }];
    const { runSafetyAgent } = await import('../src/agents/safetyAgent.js');
    const r = await runSafetyAgent({ activeAlerts: async () => [] }, new Date('2026-10-20T15:00:00Z'));
    expect(r.blindSpots.join('|')).not.toContain('roster is empty');
    expect(writesThatLeft()).toEqual([]);
  });

  // Behaviour review, finding 3: permits is kept cut, so the permitting agent
  // cannot check screens — it must say so every run, not "0 missing" whenever
  // no recent lead happens to make it look.
  it('the permitting agent with no recent leads still names permits as cut — never "ok, 0 screens missing"', async () => {
    await boot('readonly');
    const { runPermittingAgent } = await import('../src/agents/permittingAgent.js');
    const { unsavedAgentRuns } = await import('../src/binder/agentRun.js');
    const r = await runPermittingAgent(new Date('2026-10-20T15:00:00Z'));
    expect(r.status).toBe('error');
    const run = unsavedAgentRuns(5).find((x) => x.agent === 'permitting')!;
    expect(run.status).toBe('error');
    expect(run.output_summary).toContain("Data link 'permits' stays CUT in read-only mode");
    expect(run.output_summary).not.toContain('screens_missing=0');
    // It still says the bus cursor was not saved (the same batch is read again next run).
    expect(run.output_summary).toContain('cursor=not_saved_read_only');
    expect(net.reqs.some((q) => q.table === 'permit')).toBe(false);
    expect(writesThatLeft()).toEqual([]);
  });

  it('a Quo (Sona) call goes through the intake untouched — the database is never asked', async () => {
    await boot('readonly');
    const { QuoIntake } = await import('../src/ops/quoIntake.js');
    const { CallMemory, CallRecordStore } = await import('../src/reception/callMemory.js');
    const { loadAllConfig } = await import('../src/config/loadConfig.js');
    const NOW = Date.parse('2026-10-20T15:00:00Z');
    const KEY = Buffer.from('arbo-test-signing-key-32-bytes!!').toString('base64');
    const intake = new QuoIntake({
      guardrails: loadAllConfig().guardrails, extractor: null, callMemory: new CallMemory(),
      callRecords: new CallRecordStore(), calendarHold: null, onText: () => {}, now: () => NOW,
    });
    intake.setRegistration('ok', 'test', [KEY], ['+17576069432']);
    const body = JSON.stringify({ type: 'call.completed', data: { object: { id: 'SIM-AC1', from: '+17575550142', to: '+17576069432', direction: 'incoming', status: 'completed' } } });
    const sig = createHmac('sha256', Buffer.from(KEY, 'base64')).update(`${NOW}.${body}`).digest('base64');
    expect(intake.handle({ 'openphone-signature': `hmac;1;${NOW};${sig}` }, body).status).toBe(200);
    await intake.settled();
    expect(intake.list()).toHaveLength(1);
    expect(net.reqs).toEqual([]);
  });

  it('a webhook (Railway deploy notice) is kept in memory — the database is never asked', async () => {
    await boot('readonly');
    const { WebhookIntake } = await import('../src/ops/webhooks.js');
    const hooks = new WebhookIntake({ railwayKey: 'rw-key' });
    expect(hooks.handleRailway('rw-key', JSON.stringify({ type: 'DEPLOY', status: 'SUCCESS', deployment: { id: 'd1' } })).status).toBe(200);
    expect(net.reqs).toEqual([]);
  });

  it('the phone’s location ping is refused BY NAME with the plain line, counted, and never written', async () => {
    const { notSaved, links } = await boot('readonly');
    net.rows.ops_setting = [{ value: { on: true } }]; // Mike's tracking switch is ON
    const { createLiveSource } = await import('../src/server.js');
    const { createApi } = await import('../src/server/api.js');
    const api = createApi(createLiveSource());
    // Tuesday 11:00 ET — inside working hours, so only read-only can refuse it.
    const r = await api.locationPing({ lat: 36.85, lng: -76.28 }, new Date('2026-10-20T15:00:00Z'));
    expect(r).toEqual({ status: 503, body: { error: 'read_only', line: links.READ_ONLY_LINE } });
    expect(notSaved.notSavedReport().byKind.location_ping).toBe(1);
    expect(net.reqs).toEqual([{ method: 'GET', table: 'ops_setting' }]);
  });

  it('GET /api/location/day never fails on the write door: visits are shown, the stamp is skipped and said', async () => {
    const { notSaved, links } = await boot('readonly');
    const { createApi } = await import('../src/server/api.js');
    const markVisited = vi.fn(async () => {});
    const api = createApi({
      ready: () => true, canWrite: () => false, stopsBetween: async () => [], newLeads: async () => [],
      pingsSince: async () => [{ lat: 36.85, lng: -76.28, atIso: '2026-10-20T15:00:00Z' }, { lat: 36.85, lng: -76.28, atIso: '2026-10-20T15:20:00Z' }],
      geoStops: async () => [{ id: 'SIM-est-1', kind: 'estimate', timeIso: '2026-10-20T15:00:00Z', name: null, lat: 36.85, lng: -76.28 }],
      markVisited,
    });
    const r = await api.locationDay('2026-10-20T00:00:00Z', '2026-10-21T00:00:00Z');
    expect(r.status).toBe(200);
    expect(markVisited).not.toHaveBeenCalled();
    expect(r.body).toMatchObject({ saved: false, line: links.READ_ONLY_LINE });
    // The visit is still READ and shown — only its stamp was skipped, and counted.
    expect((r.body as { checks: Array<{ stopId: string; visited: unknown }> }).checks).toContainEqual(expect.objectContaining({ stopId: 'SIM-est-1', visited: true }));
    expect(notSaved.notSavedReport().byKind['estimate.visited_at']).toBe(1);
  });

  it('GET /api/forecast answers, and skips its write-through by name', async () => {
    const { notSaved, links } = await boot('readonly');
    const { createApi } = await import('../src/server/api.js');
    const saveTreeForecast = vi.fn(async () => {});
    const api = createApi({
      ready: () => true, canWrite: () => false, stopsBetween: async () => [], newLeads: async () => [],
      growthTargets: async () => [{
        propertyId: 'SIM-p1', address: '1 SIM Way', city: 'Norfolk', contactId: 'SIM-c1', consentOnFile: true, suppressed: false,
        trees: [{ id: 'SIM-t1', species: 'crape myrtle', size: 'medium', lastServiceIso: '2020-01-01' }],
      }],
      saveTreeForecast,
    });
    const r = await api.forecast(new Date('2026-10-20T15:00:00Z'));
    expect(r.status).toBe(200);
    expect(saveTreeForecast).not.toHaveBeenCalled();
    expect(r.body).toMatchObject({ saved: false, line: links.READ_ONLY_LINE });
    const due = (r.body as { due: Array<{ forecasts: unknown[] }> }).due.reduce((n, p) => n + p.forecasts.length, 0);
    expect(due).toBeGreaterThan(0);
    expect(notSaved.notSavedReport().byKind['tree.next_due_forecast']).toBe(due);
  });

  it('the seed refuses a read-only database before it reads a single count', async () => {
    await boot('readonly');
    const { seedSimulation } = await import('../src/dev/seed.js');
    expect(await seedSimulation()).toEqual({ wrote: false, reason: 'read_only', counts: {} });
    expect(net.reqs).toEqual([]);
  });
});

// ═══ 3. Old rows never pose as new work ═════════════════════════════════════
describe('read-only: a lead older than 14 days never lights an alarm or a call-back count', () => {
  const NOW = new Date('2026-10-20T15:00:00Z');
  const lead = (id: string, createdAt: string, o: Record<string, unknown> = {}) => ({
    id, source: 'call', details: 'SIMULATED tree on the house', qualification: { kind: 'voicemail' }, isEmergency: true,
    status: 'new', createdAt, name: `SIM-${id}`, phone: '+17575550101', propertyId: null, city: 'Norfolk', zip: '23503',
    isFirstTimer: null, permit: null, history: null, ...o,
  });

  it('the leads API: the July lead keeps its date and history, and loses the alarm and the call-back flag', async () => {
    const { createApi } = await import('../src/server/api.js');
    const api = createApi({
      ready: () => true, stopsBetween: async () => [],
      newLeads: async () => [lead('July', '2026-07-12T14:00:00Z'), lead('Fresh', '2026-10-20T13:00:00Z'), lead('Edge', '2026-10-06T16:00:00Z')],
    });
    const leads = ((await api.leads(50, NOW)).body as { leads: Array<Record<string, unknown>> }).leads;
    const by = (id: string) => leads.find((l) => l.id === id)!;
    expect(by('July')).toMatchObject({ older: true, isEmergency: false, needsCallback: false, filedAsEmergency: true, createdAt: '2026-07-12T14:00:00Z', ageDays: 100 });
    expect(by('Fresh')).toMatchObject({ older: false, isEmergency: true, needsCallback: true, ageDays: 0 });
    // 13 days 23 hours: not older yet.
    expect(by('Edge')).toMatchObject({ older: false, isEmergency: true });
    expect(by('Fresh').filedAsEmergency).toBeUndefined();
    // Today's alarm strip and the Leads tab badge count with exactly this filter (index.html emergencyLeads/renderLeads).
    expect(leads.filter((l) => l.isEmergency && l.status !== 'qualified').map((l) => l.id).sort()).toEqual(['Edge', 'Fresh']);
    // And the call-back label counts only what is owed now.
    expect(leads.filter((l) => l.needsCallback).map((l) => l.id).sort()).toEqual(['Edge', 'Fresh']);
  });

  it('a real lead read in read-only: permits and past work are "cut on purpose" (kept cut), not "couldn\'t read it" — and nothing is logged per poll', async () => {
    await boot('readonly');
    net.rows.lead = [{
      id: 'SIM-l1', source: 'call', details: null, qualification: null, is_emergency: false, status: 'new',
      created_at: '2026-10-20T13:00:00Z', contact: { name: 'SIM-Oak', phones: ['+17575550101'], is_first_timer: true },
      property: { id: 'SIM-p1', address: '1 SIM Way', city: 'Norfolk', zip: '23503' },
    }];
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { createLiveSource } = await import('../src/server.js');
    const { createApi } = await import('../src/server/api.js');
    const api = createApi(createLiveSource());
    const r = await api.leads(50, new Date('2026-10-20T15:00:00Z'));
    expect(r.status).toBe(200);
    const [l] = (r.body as { leads: Array<Record<string, unknown>> }).leads;
    expect(l).toMatchObject({ older: false, permitUnreadable: true, permitCut: true, historyUnreadable: true, historyCut: true, screenPending: false });
    expect(err).not.toHaveBeenCalled();
    expect(net.reqs).toEqual([{ method: 'GET', table: 'lead' }]); // permit and job were refused at the door, never asked
  });

  it('the safety board over the real, empty roster names it — nobody to check is never an all-clear', async () => {
    const { createApi } = await import('../src/server/api.js');
    const api = createApi({
      ready: () => true, canWrite: () => false, stopsBetween: async () => [], newLeads: async () => [],
      activeCrew: async () => [], certifications: async () => [], recentNearMisses: async () => [],
    });
    const b = (await api.safety()).body as { blindSpots: string[]; certProblems: unknown[] };
    expect(b.certProblems).toEqual([]);
    expect(b.blindSpots).toEqual(['Crew roster — nobody is on it yet, so there is no one to check. This is not an all-clear.']);
  });

  it('the Loop-Closer: an old uncalled voicemail is not an open loop; a fresh one still is', async () => {
    const { findOpenLoops } = await import('../src/ops/loopCloser.js');
    const open = findOpenLoops({
      nowIso: NOW.toISOString(), estimates: [], jobs: [],
      leads: [
        { id: 'July', createdAtIso: '2026-07-12T14:00:00Z', status: 'new', needsCallback: true },
        { id: 'Recent', createdAtIso: '2026-10-01T14:00:00Z', status: 'new', needsCallback: true },
        { id: 'Today', createdAtIso: '2026-10-20T09:00:00Z', status: 'new', needsCallback: true },
      ],
    });
    expect(open.map((o) => o.refId)).toEqual(['Today']);
  });

  it('Talk names read-only and never proposes calling the July lead back', async () => {
    const { createApi } = await import('../src/server/api.js');
    const { createTalkTools, talkReadsFrom } = await import('../src/voice/ownerTalk.js');
    const { QuoIntake } = await import('../src/ops/quoIntake.js');
    const { CallMemory, CallRecordStore } = await import('../src/reception/callMemory.js');
    const { loadAllConfig } = await import('../src/config/loadConfig.js');
    const now = Date.now();
    const quo = new QuoIntake({ guardrails: loadAllConfig().guardrails, extractor: null, callMemory: new CallMemory(), callRecords: new CallRecordStore(), calendarHold: null, onText: () => {} });
    const api = createApi({
      ready: () => true, canWrite: () => false, stopsBetween: async () => [],
      newLeads: async () => [
        lead('Julyoak', new Date(now - 100 * 86_400_000).toISOString()),
        lead('Freshelm', new Date(now - 3_600_000).toISOString()),
      ],
    }, { dataLinksReadOnly: true, alerts: { activeAlerts: async () => [] } });
    const reads = talkReadsFrom({
      api, quo: () => ({ status: quo.status(), calls: quo.list() }), mode: () => 'readonly',
      stormLaw: async () => ({ state: 'none', declarations: [], flag: null, governorNote: '', checkedAt: new Date().toISOString(), reason: null }),
    });
    const text = (await createTalkTools(reads).run('arbo_update')).text;
    expect(text).toContain("READ-ONLY: Arbo is reading Mike's real records and saving nothing.");
    expect(text).toContain('Emergency leads open: 1.');
    expect(text).toContain('SIM-Freshelm');
    expect(text).not.toContain('SIM-Julyoak');
    expect(text).not.toContain('DATA LINKS CUT');
  });
});

// ═══ 4. The server: boot line, /health, /api/links, a refused tap, the crew door ═══
describe('read-only: what the operator and Mike are told', () => {
  it('the boot line names the mode in plain words', async () => {
    await boot('readonly');
    const { dbStateLine } = await import('../src/server.js');
    const line = dbStateLine();
    expect(line).toContain('READ-ONLY (ARBO_DATA_LINKS=readonly) — reading real data, writing nothing');
    expect(line).toContain('Kept cut: jobs, permits, photos, calls');
    expect(line).toMatch(/Readable: contacts, properties, leads, estimates, location, crew, equipment, safety, ops/);
    expect(line).not.toMatch(/^connected/);
  });

  it('live and cut keep their own boot lines', async () => {
    await boot('live', { ARBO_LINK_LEADS: 'live' });
    expect((await import('../src/server.js')).dbStateLine()).toBe('connected — links open: leads');
    await boot('off');
    expect((await import('../src/server.js')).dbStateLine()).toMatch(/^CONFIGURED BUT LINKS CUT/);
  });

  async function serve(extra: Record<string, string>): Promise<{ base: string; srv: Server }> {
    await boot('readonly', extra);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { createArborRequestHandler } = await import('../src/server.js');
    const srv = createServer(createArborRequestHandler());
    await new Promise<void>((r) => srv.listen(0, r));
    const addr = srv.address();
    return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, srv };
  }
  const call = (base: string, path: string, init: RequestInit = {}) => realFetch(base + path, init);

  it('/health says "readonly"; /api/links names the mode, each readable link, and why each cut one is cut', async () => {
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k' });
    try {
      expect(((await (await call(base, '/health')).json()) as { dataLinks: string }).dataLinks).toBe('readonly');
      net.counts.lead = 37;
      const r = await call(base, '/api/links', { headers: { 'x-arbor-key': 'admin-k' } });
      expect(r.status).toBe(200);
      const b = await r.json() as { master: string; mode: string; line: string; links: Array<{ link: string; state: string; reason?: string; rowCounts?: Record<string, number> }> };
      expect(b.master).toBe('readonly');
      expect(b.mode).toBe('READ-ONLY (ARBO_DATA_LINKS=readonly) — reading real data, writing nothing');
      expect(b.line).toBe('Read-only: Arbo can look but not save. Nothing was written.');
      const by = (l: string) => b.links.find((x) => x.link === l)!;
      expect(by('leads')).toMatchObject({ state: 'read-only', rowCounts: { lead: 37, campaign: 0 } });
      for (const l of ['calls', 'photos', 'jobs', 'permits']) {
        expect(by(l).state, l).toBe('cut');
        expect(by(l).reason, l).toBeTruthy();
        expect(by(l).rowCounts, l).toBeUndefined(); // a cut link is not even counted
      }
      // Counts only: the probe never read a row.
      expect(net.reqs.every((q) => q.method === 'HEAD')).toBe(true);
    } finally { srv.close(); }
  });

  it('a tap that would save answers 503 read_only with the plain line — and no write leaves', async () => {
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k' });
    try {
      const r = await call(base, '/api/leads/11111111-1111-4111-8111-111111111111/status', {
        method: 'POST', headers: { 'x-arbor-key': 'admin-k', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'qualified' }),
      });
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ error: 'read_only', op: 'update', table: 'lead', line: 'Read-only: Arbo can look but not save. Nothing was written.' });
      expect(writesThatLeft()).toEqual([]);
    } finally { srv.close(); }
  });

  it('with no APP_ACCESS_KEY, read-only real data stays LOCKED — keyless never opens real rows', async () => {
    const { base, srv } = await serve({});
    try {
      for (const p of ['/api/leads', '/api/links', '/api/properties', '/api/crew/workorders']) {
        expect((await call(base, p)).status, p).toBe(401);
      }
      expect(net.reqs).toEqual([]);
    } finally { srv.close(); }
  });

  it('the crew door stays shut without the crew key, and the owner preview never reaches real work orders', async () => {
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k' });
    try {
      // No CREW_ACCESS_KEY: a crew phone is told so by name.
      for (const p of ['/api/crew/workorders', '/api/crew/briefing']) {
        const r = await call(base, p);
        expect(r.status, p).toBe(401);
        expect(await r.json(), p).toEqual({ error: 'crew_key_not_set', message: 'No crew door key has been set up on the server yet. Ask Mike to set one.' });
      }
      // Mike's look-only preview: the jobs link is kept cut, so work orders are a named cut — never real rows.
      const r = await call(base, '/api/crew/workorders', { headers: { 'x-arbor-key': 'admin-k', 'x-arbo-preview': '1' } });
      expect(r.status).toBe(503);
      expect(await r.json()).toMatchObject({ error: 'link_cut', link: 'jobs' });
      // And a preview write is still the preview's own 403, before read-only is even asked.
      const w = await call(base, '/api/crew/near-miss', { method: 'POST', headers: { 'x-arbor-key': 'admin-k', 'x-arbo-preview': '1' }, body: '{}' });
      expect(w.status).toBe(403);
      expect(net.reqs.some((q) => q.table === 'job')).toBe(false);
    } finally { srv.close(); }
  });
});

// ═══ 5. The screens say it in one plain line ════════════════════════════════
describe('read-only: the app and the crew page say it plainly', () => {
  const app = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
  const crew = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');
  const fnSrc = (html: string, name: string): string => {
    const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
    if (!m) throw new Error(`no function ${name}`);
    return m[0];
  };
  const LINE = 'Read-only: Arbo can look but not save. Nothing was written.';

  // Behaviour review, finding 5: R22 also texts with no tap (ARBO_OUTREACH /
  // ARBO_OUTREACH_CATCHUP), and read-only does not switch it — the ruling says so.
  it('the draft ruling words R22 truthfully: automatic only on its own switches, and read-only does not switch it', () => {
    const rulings = readFileSync(new URL('../docs/OWNER_RULINGS.md', import.meta.url), 'utf8');
    const ro = rulings.slice(rulings.indexOf('## R32')).replace(/\s+/g, ' ');
    expect(ro).not.toContain("texting only via R22 behind `inspectMessage` and Mike's tap;");
    expect(ro).toContain("texting only via R22 behind `inspectMessage` (Mike's tap, or automatically only while `ARBO_OUTREACH=live` or `ARBO_OUTREACH_CATCHUP=live`) — read-only mode does not switch it;");
  });

  it('the app and the server carry the same plain line', async () => {
    const { READ_ONLY_LINE } = await import('../src/db/links.js');
    expect(READ_ONLY_LINE).toBe(LINE);
    expect(app).toContain(`const READ_ONLY_LINE = '${LINE}';`);
  });

  it('a refused tap reads the plain line — never "the server did not accept it"', () => {
    const saveFailText = new Function('feedKind', 'showKeywall', 'READ_ONLY_LINE', `${fnSrc(app, 'saveFailText')}\nreturn saveFailText;`)(
      () => 'unread', () => {}, LINE,
    ) as (e: unknown) => string;
    expect(saveFailText({ message: 'read_only', code: 503, line: LINE })).toBe(LINE);
    expect(saveFailText({ message: 'read_only', code: 503, line: null })).toBe(LINE);
    expect(saveFailText({ message: 'server_error', code: 500 })).toBe('Not saved — the server did not accept it. Nothing was written.');
  });

  it('every refused write anywhere in the app also shows the line once (a card that words its own failure included)', () => {
    expect(fnSrc(app, 'api')).toContain("if (!res.ok && body.error === 'read_only') readOnlyToast(typeof body.line === 'string' ? body.line : READ_ONLY_LINE);");
    expect(fnSrc(app, 'readOnlyToast')).toContain("t.setAttribute('aria-live', 'polite');");
  });

  it('Today shows one plain line, only while the master is exactly readonly', () => {
    const today = fnSrc(app, 'renderToday');
    expect(today).toContain("LINKS_READY.then(() => { if (LINKS === 'readonly') roSlot.appendChild(el('div', 'storm-muted', 'Read-only: Arbo is reading your real records and saving nothing. Anything that would save says so.')); });");
    // Under the system chips, above the storm alert.
    expect(today.indexOf('v.appendChild(roSlot);')).toBeGreaterThan(today.indexOf('v.appendChild(buildSystems());'));
    expect(today.indexOf('v.appendChild(roSlot);')).toBeLessThan(today.indexOf('v.appendChild(stormSlot);'));
  });

  it('the agent runs tile says its runs were not saved', () => {
    expect(fnSrc(app, 'renderToday')).toContain("if (r.runLog === 'not_saved_read_only') tileWhy(agentTile, 'not saved — read-only');");
  });

  it('the crew page names read-only on every screen, the owner preview included, and words a refused save', () => {
    expect(crew).toContain("LINKS_READY.then(() => { if (LINKS === 'readonly') $('dateline').textContent = 'READ-ONLY · ' + $('dateline').textContent; });");
    expect(crew).toContain("bannerLine.textContent = PREVIEW_BANNER + ' Arbo is read-only: it reads real records and saves nothing.';");
    const crewWhy = new Function('LINKS', `${fnSrc(crew, 'crewWhy')}\nreturn crewWhy;`)('readonly') as (e: unknown) => string;
    expect(crewWhy({ code: 503, message: 'read_only' })).toBe('Arbo is read-only right now — it can look but not save, so nothing was written');
    expect(crewWhy({ code: 503, message: 'link_cut' })).toBe('the office data link is cut on purpose');
    expect(crewWhy({ code: 503, message: 'db_not_configured' })).toBe('not set up on the server yet');
  });
});

// ═══ 6. CREW_PLAN C1 (D107) — the crew door says read-only before anyone acts ═══
// Read-only refuses every crew write (sign-off, near miss). The page knows the
// mode from /health, so it says so up front: a near miss is not typed into a
// form that cannot file it, and the gate tells the crew their sign-off cannot
// be saved — with the stop-work order on its own bold line.
describe('read-only on the crew door (C1): warned before anyone types or signs', () => {
  const crew = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');

  type N = { tag: string; className: string; textContent: string; kids: N[]; id: string };
  const make = (tag: string, className = '', textContent = ''): N & Record<string, unknown> => {
    const n = {
      tag, className, textContent, kids: [] as N[], id: '', disabled: false, scrollHeight: 0, clientHeight: 0, scrollTop: 0,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      appendChild(k: N) { n.kids.push(k); return k; },
      prepend(k: N) { n.kids.unshift(k); },
      insertBefore(k: N, ref: N) { const at = n.kids.indexOf(ref); if (at < 0) throw new Error('insertBefore: ref is not a child'); n.kids.splice(at, 0, k); return k; },
      replaceChildren() { n.kids = []; },
      addEventListener() {},
      setAttribute(k: string, v: string) { if (k === 'id') n.id = v; },
    };
    return n;
  };
  const all = (n: N): N[] => n.kids.flatMap((k) => [k, ...all(k)]);

  it('the near-miss card warns under readonly, above the box, in the plan’s words', async () => {
    const box = make('div');
    const ready = Promise.resolve();
    const fn = /^function renderNearMiss\([\s\S]*?^\}$/m.exec(crew)![0];
    new Function('$', 'el', 'document', 'LINKS_READY', 'LINKS', 'CREW_ID', 'api', `${fn}\nreturn renderNearMiss;`)(
      () => box, make, { createElement: (t: string) => make(t) }, ready, 'readonly', 'x', () => {},
    )();
    await ready.then(() => {}); // the page's own .then was queued first, so it has run
    const card = box.kids[1]!;
    expect(card.kids.map((k) => k.className || k.tag)).toEqual(['why', 'lib-warn', 'textarea', 'button', 'div']);
    expect(card.kids[1]!.textContent).toBe('Filing is off while Arbo is read-only — tell the office directly.');
  });

  // The gate's own block, run over stand-ins (as test/crewGateTimer.test.ts does).
  const gate = async (links: string | null) => {
    const slot = make('div');
    const block = crew.slice(crew.indexOf('const GATE = {'), crew.indexOf('async function submitGate('));
    const ready = Promise.resolve();
    const page = new Function(
      'PREVIEW', 'PREVIEW_WHY', 'document', '$', 'el', 'setInterval', 'submitGate', 'LINKS_READY', 'LINKS',
      `${block}\nreturn { renderGate };`,
    )(false, '', { querySelector: () => make('main'), createElement: (t: string) => make(t) },
      (id: string) => (id === 'gate-slot' ? slot : all(slot).find((n) => n.id === id) ?? null), make, () => 1, () => {}, ready, links) as { renderGate: (b: unknown) => void };
    page.renderGate({ id: 'SIM-brief', body: 'SIM briefing.\nHard hats on.', standardRefs: [], requiredSeconds: 10 });
    await ready.then(() => {});
    return slot.kids[0]!;
  };
  const RO_LINE = 'Arbo is read-only today — your sign-off can’t be saved on this phone.';
  const ORDER = 'Do not start work — call the office.';

  it('under readonly: one line directly above GO, then the stop-work order on its own bold line — and the briefing stays readable', async () => {
    const box = await gate('readonly');
    const go = box.kids.findIndex((k) => k.tag === 'button' && k.textContent === 'GO');
    const note = box.kids.findIndex((k) => k.className === 'ro-note');
    expect(note, box.kids.map((k) => k.className || k.tag).join(',')).toBeGreaterThan(-1);
    expect(note).toBe(go - 1);
    expect(box.kids[note]!.kids.map((k) => [k.tag, k.textContent])).toEqual([['div', RO_LINE], ['b', ORDER]]);
    // The briefing is still on screen to read.
    const body = all(box).find((n) => n.kids.some((k) => k.tag === 'p'))!;
    expect(body.kids.map((k) => k.textContent)).toEqual(['SIM briefing.', 'Hard hats on.']);
  });

  it('live, simulation, cut and an unanswered /health: no read-only lines', async () => {
    for (const links of ['live', 'simulation', 'cut', 'unknown', null]) {
      const box = await gate(links);
      expect(all(box).some((n) => n.className === 'ro-note'), String(links)).toBe(false);
      expect(all(box).some((n) => n.textContent === ORDER), String(links)).toBe(false);
    }
  });

  it('the bold line is styled as a line of its own', () => {
    expect(crew).toMatch(/\.ro-note b\{[^}]*display:block/);
  });
});

// ═══ 7. CREW_PLAN C1 review round (D107) — under read-only GO never arms ═══
// Review D1 / UI 1: the read-only note said "Do not start work — call the
// office." directly above a GREEN GO reading "Ready — press GO.", and after
// the read_only refusal, ticking the box again armed GO once more (the box
// clears serverHold). Under read-only the sign-off cannot be saved, so GO is
// held for good — a hold the box cannot clear — and nothing says "Ready".
describe('read-only on the crew door (C1 review): GO is never armed under the read-only note', () => {
  const crew = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');

  type N = { tag: string; className: string; textContent: string; kids: N[]; id: string; disabled: boolean; checked?: boolean; on: Record<string, () => void> };
  const make = (tag: string, className = '', textContent = ''): N & Record<string, unknown> => {
    const n = {
      tag, className, textContent, kids: [] as N[], id: '', disabled: false, scrollHeight: 0, clientHeight: 0, scrollTop: 0,
      on: {} as Record<string, () => void>,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      appendChild(k: N) { n.kids.push(k); return k; },
      prepend(k: N) { n.kids.unshift(k); },
      insertBefore(k: N, ref: N) { const at = n.kids.indexOf(ref); if (at < 0) throw new Error('insertBefore: ref is not a child'); n.kids.splice(at, 0, k); return k; },
      replaceChildren() { n.kids = []; },
      addEventListener(type: string, fn: () => void) { n.on[type] = fn; },
      setAttribute(k: string, v: string) { if (k === 'id') n.id = v; },
    };
    return n;
  };
  const all = (n: N): N[] => n.kids.flatMap((k) => [k, ...all(k)]);

  /** The gate's own block over stand-ins, read to the end: scrolled (a short body), ticked, past the read floor. */
  const readAndTick = async (links: string | null) => {
    const slot = make('div');
    const block = crew.slice(crew.indexOf('const GATE = {'), crew.indexOf('async function submitGate('));
    const ready = Promise.resolve();
    const find = (id: string) => (id === 'gate-slot' ? slot : all(slot).find((n) => n.id === id) ?? null);
    const page = new Function(
      'PREVIEW', 'PREVIEW_WHY', 'document', '$', 'el', 'setInterval', 'submitGate', 'LINKS_READY', 'LINKS',
      `${block}\nreturn { GATE, renderGate, refreshGate };`,
    )(false, '', { querySelector: () => make('main'), createElement: (t: string) => make(t) },
      find, make, () => 1, () => {}, ready, links) as { GATE: Record<string, unknown>; renderGate: (b: unknown) => void; refreshGate: () => void };
    page.renderGate({ id: 'SIM-brief', body: 'SIM briefing.\nHard hats on.', standardRefs: [], requiredSeconds: 10 });
    await ready.then(() => {});
    const box = find('ackbox')!;
    const tick = (on: boolean) => { box.checked = on; box.on.change!(); };
    tick(true);
    page.GATE.openedMs = Date.now() - 60_000; // the read floor is long past
    page.refreshGate();
    const go = find('gobtn')!;
    const status = find('gate-status')!;
    return { page, tick, go, status };
  };

  it('control — off read-only, a briefing read to the end and ticked arms GO and says Ready', async () => {
    const { go, status } = await readAndTick('live');
    expect(go.disabled).toBe(false);
    expect(go.className).toBe('ready');
    expect(status.textContent).toBe('Ready — press GO.');
  });

  it('under readonly, read to the end and ticked: GO stays off, never green, and nothing says "Ready — press GO."', async () => {
    const { go, status } = await readAndTick('readonly');
    expect(go.className).not.toBe('ready');
    expect(go.disabled).toBe(true);
    expect(status.textContent).not.toContain('Ready');
  });

  it('under readonly, after a refusal, unticking and ticking the box again cannot arm GO', async () => {
    const { page, tick, go, status } = await readAndTick('readonly');
    // The read_only refusal as submitGate leaves it: the server's word, held.
    Object.assign(page.GATE, { serverMsg: 'Your sign-off could not be recorded (Arbo is read-only right now — it can look but not save, so nothing was written).', serverErr: true, serverHold: true });
    page.refreshGate();
    expect(go.className).not.toBe('ready');
    tick(false);
    tick(true); // the box clears serverHold — the read-only hold must survive it
    page.refreshGate();
    expect(page.GATE.serverHold).toBe(false);
    expect(go.className).not.toBe('ready');
    expect(go.disabled).toBe(true);
    expect(status.textContent).not.toContain('Ready');
  });
});
