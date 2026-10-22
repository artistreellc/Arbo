// CREW_PLAN C4 (D109) — the server owns the day. A briefing's day rides in
// body.forDay (no migration) and only today's is served; the sign-off is
// checked against the SERVER's briefing (its id, its body, its read floor);
// "already signed today" is read from the server's training_event, never the
// phone's start time, and never written twice; the work orders open on a
// crew phone only after today's sign-off (M11, Q5) — only the owner key is
// exempt, and the x-arbo-preview header alone exempts nothing. Talk keeps
// calling crewWorkOrders directly. Paid-time correctness: C4 never blocks a
// first sign-off — a duplicate check that cannot be read writes and names it.
import { describe, it, expect, vi, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createApi, type DataSource } from '../src/server/api.js';
import { etToday, etDayWindow } from '../src/lib/etDay.js';

const C1 = '00000000-0000-4000-8000-0000000000c1';
const TODAY = { id: '33333333-3333-4333-8333-333333333333', body: 'Watch the drop zone. Call every cut.', standardRefs: ['Z133 §8.1'] };
const PASSING = { scrolledToBottom: true, checkboxTicked: true, secondsOnScreen: 20 };
const ack = (over: Record<string, unknown> = {}) => ({
  crewMemberId: C1, content: TODAY, state: PASSING,
  startedAtIso: '2026-10-21T10:00:00.000Z', completedAtIso: '2026-10-21T10:00:20.000Z', ...over,
});

/** A source that behaves like the tables: time_entry unique on (crew, source, started_at), events with created_at. */
function daySource(over: Partial<DataSource> = {}) {
  const time: Array<{ crew: string; startedAt: string }> = [];
  const events: Array<{ crew: string; createdAt: string }> = [];
  const days: string[] = [];
  const src: DataSource = {
    ready: () => true, stopsBetween: async () => [], newLeads: async () => [],
    crewMember: async () => ({ name: 'SIM-Alder, Test', active: true }),
    todaysBriefing: async (day: string) => { days.push(day); return TODAY; },
    briefingSignedAt: async (crew: string, fromIso: string, toIso: string) => {
      const hit = events.filter((e) => e.crew === crew && e.createdAt >= fromIso && e.createdAt < toIso).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
      return hit ? hit.createdAt : null;
    },
    recordBriefingAck: async (i) => {
      await new Promise((r) => setTimeout(r, 5)); // the network: a parallel ack is checked before this one lands
      if (time.some((t) => t.crew === i.crewMemberId && t.startedAt === i.startedAtIso)) {
        throw { code: '23505', message: 'duplicate key value violates unique constraint "time_entry_ack_once"' };
      }
      time.push({ crew: i.crewMemberId, startedAt: i.startedAtIso });
      events.push({ crew: i.crewMemberId, createdAt: new Date().toISOString() });
      return { trainingEventId: `te${events.length}`, timeEntryId: `t${time.length}` };
    },
    ...over,
  };
  return { src, time, events, days };
}

// The repository over a stand-in for the Supabase client that applies the
// filters the way PostgREST would (body->>forDay included), so a missing
// filter lets yesterday's briefing, or a row with no day, back in.
type Row = Record<string, unknown>;
const field = (r: Row, col: string): unknown => {
  if (!col.includes('->>')) return r[col];
  const [a, b] = col.split('->>');
  const o = r[a!];
  return o && typeof o === 'object' ? ((o as Row)[b!] ?? null) : null;
};
function mockDb(tables: Record<string, Row[]>) {
  return {
    from(t: string) {
      const keep: Array<(r: Row) => boolean> = [];
      let ord: [string, boolean] | null = null;
      let lim = Infinity;
      const rows = () => {
        let out = (tables[t] ?? []).filter((r) => keep.every((k) => k(r)));
        if (ord) { const [c, asc] = ord; out = [...out].sort((x, y) => (String(field(x, c)) < String(field(y, c)) ? -1 : 1) * (asc ? 1 : -1)); }
        return out.slice(0, lim);
      };
      const b = {
        select() { return b; },
        eq(c: string, v: unknown) { keep.push((r) => field(r, c) === v); return b; },
        gte(c: string, v: unknown) { keep.push((r) => String(field(r, c)) >= String(v)); return b; },
        lt(c: string, v: unknown) { keep.push((r) => String(field(r, c)) < String(v)); return b; },
        order(c: string, o?: { ascending?: boolean }) { ord = [c, o?.ascending !== false]; return b; },
        limit(n: number) { lim = n; return b; },
        maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
      };
      return b;
    },
  };
}
async function repoOver(tables: Record<string, Row[]>) {
  vi.resetModules();
  vi.doMock('../src/db/client.js', () => ({ getDb: () => mockDb(tables) }));
  return import('../src/db/repositories.js');
}
const unmock = () => { vi.doUnmock('../src/db/client.js'); vi.resetModules(); };

describe('C4 — todaysBriefing(day): only the briefing for that day, by body.forDay', () => {
  const brief = (id: string, forDay: string | undefined, createdAt: string, published = true): Row => ({
    id, type: 'tailgate_brief', published, topic: 'Morning briefing', created_at: createdAt,
    body: { text: `SIM ${id}`, standardRefs: ['Z133 §5.1'], ...(forDay ? { forDay } : {}) },
  });

  it('yesterday’s briefing is not served today, even when it is the newest row; a row with no day is never served', async () => {
    try {
      const repo = await repoOver({ training_item: [
        brief('today', '2026-10-21', '2026-10-20T23:00:00Z'),
        brief('yesterday', '2026-10-20', '2026-10-21T09:00:00Z'),
        brief('noday', undefined, '2026-10-21T10:00:00Z'),
        { ...brief('lesson', '2026-10-21', '2026-10-21T11:00:00Z'), type: 'lesson' },
      ] });
      expect(await repo.todaysBriefing('2026-10-21')).toEqual({ id: 'today', body: 'SIM today', standardRefs: ['Z133 §5.1'] });
      expect(await repo.todaysBriefing('2026-10-22')).toBeNull();
    } finally { unmock(); }
  });

  it('an unpublished one is not served', async () => {
    try {
      const repo = await repoOver({ training_item: [brief('draft', '2026-10-21', '2026-10-21T05:00:00Z', false)] });
      expect(await repo.todaysBriefing('2026-10-21')).toBeNull();
    } finally { unmock(); }
  });
});

describe('C4 — briefingSignedAt: the server’s own record of a sign-off in the window', () => {
  it('the first tailgate_ack event of this crew member in the window — not another context, person or day', async () => {
    try {
      const repo = await repoOver({ training_event: [
        { crew_member_id: C1, context: 'clock_in_gate', created_at: '2026-10-21T10:30:00Z' },
        { crew_member_id: C1, context: 'tailgate_ack', created_at: '2026-10-21T10:42:00Z' },
        { crew_member_id: C1, context: 'tailgate_ack', created_at: '2026-10-21T11:00:00Z' },
        { crew_member_id: 'someone-else', context: 'tailgate_ack', created_at: '2026-10-21T10:01:00Z' },
        { crew_member_id: C1, context: 'tailgate_ack', created_at: '2026-10-20T10:00:00Z' },
      ] });
      expect(await repo.briefingSignedAt(C1, '2026-10-21T04:00:00Z', '2026-10-22T04:00:00Z')).toBe('2026-10-21T10:42:00Z');
      expect(await repo.briefingSignedAt(C1, '2026-10-22T04:00:00Z', '2026-10-23T04:00:00Z')).toBeNull();
    } finally { unmock(); }
  });
});

describe('C4 — the briefing is today’s, by the server’s day', () => {
  it('GET asks the source for today’s briefing by the Hampton Roads day', async () => {
    const d = daySource();
    const res = await createApi(d.src).crewBriefing('');
    expect(res.status).toBe(200);
    expect(d.days).toEqual([etToday()]);
  });

  it('no briefing for today is the plain 404 — never yesterday’s', async () => {
    const res = await createApi(daySource({ todaysBriefing: async () => null }).src).crewBriefing('');
    expect(res).toEqual({ status: 404, body: { error: 'no_briefing_published' } });
  });
});

describe('C4 — the sign-off is checked against the server’s own briefing', () => {
  it('a different briefing id is 409 not_todays_briefing, and nothing is written', async () => {
    const d = daySource();
    const res = await createApi(d.src).ackBriefing(ack({ content: { ...TODAY, id: '44444444-4444-4444-8444-444444444444' } }));
    expect(res).toEqual({ status: 409, body: { error: 'not_todays_briefing' } });
    expect(d.time).toEqual([]);
  });

  it('no briefing on the server today: the phone’s is not today’s (409), nothing written', async () => {
    const d = daySource({ todaysBriefing: async () => null });
    expect(await createApi(d.src).ackBriefing(ack())).toEqual({ status: 409, body: { error: 'not_todays_briefing' } });
    expect(d.time).toEqual([]);
  });

  it('an edited body cannot shorten the read floor — the gate runs on the server’s text', async () => {
    const long = { ...TODAY, body: Array.from({ length: 60 }, (_, i) => 'word' + i).join(' ') }; // a 15 s floor
    const d = daySource({ todaysBriefing: async () => long });
    const res = await createApi(d.src).ackBriefing(ack({ content: { id: TODAY.id, body: 'short', standardRefs: [] }, state: { ...PASSING, secondsOnScreen: 11 } }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ unlocked: false, missing: ['read_time'], requiredSeconds: 15 });
    expect(d.time).toEqual([]);
  });

  it('the acknowledgment carries the server’s briefing id', async () => {
    const seen: string[][] = [];
    const d = daySource();
    const rec = d.src.recordBriefingAck!;
    d.src.recordBriefingAck = async (i) => { seen.push(i.itemIds); return rec(i); };
    await createApi(d.src).ackBriefing(ack({ content: { ...TODAY, body: 'whatever the phone says' } }));
    expect(seen).toEqual([[TODAY.id]]);
  });
});

describe('C4 — one paid row per crew member per day', () => {
  it('two acks sent at once with the same start write ONE paid row; both unlock', async () => {
    const d = daySource();
    const api = createApi(d.src);
    const [a, b] = await Promise.all([api.ackBriefing(ack()), api.ackBriefing(ack())]);
    expect(d.time).toHaveLength(1);
    expect(d.events).toHaveLength(1);
    expect([a!.body, b!.body]).toEqual(expect.arrayContaining([expect.objectContaining({ unlocked: true }), expect.objectContaining({ unlocked: true, duplicate: true })]));
  });

  it('a reload (the kept start) and a phone that lost its start both meet the server’s record: no second row, the time it was signed', async () => {
    const d = daySource();
    const api = createApi(d.src);
    await api.ackBriefing(ack());
    const again = await api.ackBriefing(ack());
    const fresh = await api.ackBriefing(ack({ startedAtIso: '2026-10-21T10:05:00.000Z', completedAtIso: '2026-10-21T10:05:20.000Z' }));
    expect(d.time).toHaveLength(1);
    for (const r of [again, fresh]) {
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ unlocked: true, duplicate: true, signedAt: d.events[0]!.createdAt });
    }
  });

  it('the unique index refusing the time row is a duplicate — not a 500 — and no event is written', async () => {
    const wrote: string[] = [];
    const d = daySource({
      briefingSignedAt: async () => null,
      recordBriefingAck: async () => { wrote.push('time'); throw { code: '23505', message: 'duplicate key' }; },
    });
    const res = await createApi(d.src).ackBriefing(ack());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ unlocked: true, duplicate: true });
    expect((res.body as { signedAt?: string }).signedAt).toBeUndefined(); // "Signed at" only from a read that found it
    expect(wrote).toEqual(['time']);
  });

  it('a duplicate check that cannot be read never blocks a first sign-off: it writes, and names the gap', async () => {
    const d = daySource({ briefingSignedAt: async () => { throw new Error('down'); } });
    const res = await createApi(d.src).ackBriefing(ack());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ unlocked: true, signedCheck: 'signoff_unreadable' });
    expect(d.time).toHaveLength(1);
  });

  it('a source with no sign-off lookup writes too, and names which gap', async () => {
    const d = daySource();
    delete d.src.briefingSignedAt;
    const res = await createApi(d.src).ackBriefing(ack());
    expect(res.body).toMatchObject({ unlocked: true, signedCheck: 'not_built' });
    expect(d.time).toHaveLength(1);
  });

  it('the check reads the server’s record in today’s ET window, not the phone’s start time', async () => {
    const asked: Array<[string, string, string]> = [];
    const d = daySource({ briefingSignedAt: async (c, f, t) => { asked.push([c, f, t]); return null; } });
    await createApi(d.src).ackBriefing(ack({ startedAtIso: '2020-01-01T00:00:00.000Z', completedAtIso: '2020-01-01T00:00:20.000Z' }));
    const { startUtc, endUtc } = etDayWindow(etToday());
    expect(asked[0]).toEqual([C1, startUtc.toISOString(), endUtc.toISOString()]);
  });
});

describe('C4 — GET /api/crew/briefing says whether this crew member already signed today', () => {
  it('signed: signedAt from the server’s record, and signedCheck read', async () => {
    const d = daySource();
    const api = createApi(d.src);
    await api.ackBriefing(ack());
    const res = await api.crewBriefing(C1);
    expect(res.body).toMatchObject({ id: TODAY.id, signedAt: d.events[0]!.createdAt, signedCheck: 'read' });
  });

  it('not signed: signedAt null over a read that succeeded', async () => {
    expect((await createApi(daySource().src).crewBriefing(C1)).body).toMatchObject({ signedAt: null, signedCheck: 'read' });
  });

  it('a check that failed is named — never "not signed", never "Signed at"', async () => {
    const d = daySource({ briefingSignedAt: async () => { throw new Error('down'); } });
    const res = await createApi(d.src).crewBriefing(C1);
    expect(res.status).toBe(200); // the briefing itself still reads
    expect(res.body).toMatchObject({ signedAt: null, signedCheck: 'signoff_unreadable' });
  });

  it('the practice data keeps no sign-offs, and says so; the preview (no crew code) gets no sign-off fields', async () => {
    const d = daySource();
    delete d.src.briefingSignedAt;
    expect((await createApi(d.src, { dataLinksSim: true }).crewBriefing(C1)).body).toMatchObject({ signedAt: null, signedCheck: 'not_simulated' });
    const bare = (await createApi(daySource().src).crewBriefing('')).body as Record<string, unknown>;
    expect(bare).not.toHaveProperty('signedAt');
    expect(bare).not.toHaveProperty('signedCheck');
  });
});

describe('C4 (M11, Q5) — work orders open on a crew phone only after today’s sign-off', () => {
  const lock = (over: Partial<DataSource> = {}) => createApi({ ...daySource().src, ...over });

  it('no crew code, or one never signed today: 403 briefing_not_signed', async () => {
    expect(await lock().crewSignOffLock('')).toEqual({ status: 403, body: { error: 'briefing_not_signed' } });
    expect(await lock().crewSignOffLock(C1)).toEqual({ status: 403, body: { error: 'briefing_not_signed' } });
  });

  it('signed today: the lock opens', async () => {
    expect(await lock({ briefingSignedAt: async () => '2026-10-21T10:42:00.000Z' }).crewSignOffLock(C1)).toBeNull();
  });

  it('not a crew code: 400 bad_crew_id', async () => {
    expect(await lock().crewSignOffLock('Rudy')).toEqual({ status: 400, body: { error: 'bad_crew_id' } });
  });

  it('a sign-off that cannot be read: 503 named — "Arbo couldn’t check your sign-off — call the office"', async () => {
    const res = await lock({ briefingSignedAt: async () => { throw new Error('down'); } }).crewSignOffLock(C1);
    expect(res).toEqual({ status: 503, body: { error: 'signoff_unreadable', message: 'Arbo couldn’t check your sign-off — call the office.' } });
  });

  it('no lookup, or no database: a named 503, never an open door', async () => {
    const noLookup = daySource().src;
    delete noLookup.briefingSignedAt;
    expect((await createApi(noLookup, { dataLinksSim: true }).crewSignOffLock(C1))!.body).toEqual({ error: 'not_simulated' });
    expect((await lock({ ready: () => false }).crewSignOffLock(C1))!.body).toEqual({ error: 'db_not_configured' });
  });

  it('crewWorkOrders itself has no briefing parameter, and Talk keeps calling it directly', () => {
    const api = readFileSync(new URL('../src/server/api.ts', import.meta.url), 'utf8');
    expect(api).toContain('async crewWorkOrders(dateIso: string): Promise<ApiResult> {');
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(server).not.toContain("searchParams.get('briefingId')");
    const talk = readFileSync(new URL('../src/voice/ownerTalk.ts', import.meta.url), 'utf8');
    expect(talk).toContain('workOrders: () => src.api.crewWorkOrders(etToday()),');
  });
});

// ── The route, through the real handler ───────────────────────────────────
const savedEnv = { ...process.env };
afterAll(() => { process.env = { ...savedEnv }; vi.resetModules(); });
async function serve(env: Record<string, string | undefined>): Promise<{ base: string; srv: Server }> {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { createArborRequestHandler } = await import('../src/server.js');
  const srv = createServer(createArborRequestHandler());
  await new Promise<void>((r) => srv.listen(0, r));
  const addr = srv.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, srv };
}

describe('C4 — the lock lives in the route: only the owner key is exempt, the preview header exempts nothing', () => {
  const get = (base: string, path: string, headers: Record<string, string>) => fetch(base + path, { headers });

  it('practice data: the owner key reads the day; the crew key is held at the sign-off; the header alone opens nothing', async () => {
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', ARBO_DATA_LINKS: 'sim' });
    try {
      const owner = await get(base, '/api/crew/workorders', { 'x-arbor-key': 'admin-k' });
      expect(owner.status).toBe(200);
      expect(((await owner.json()) as { workOrders: unknown[] }).workOrders.length).toBeGreaterThan(0);
      const preview = await get(base, '/api/crew/workorders', { 'x-arbor-key': 'admin-k', 'x-arbo-preview': '1' });
      expect(preview.status).toBe(200);
      for (const h of [{ 'x-arbor-key': 'crew-k' }, { 'x-arbor-key': 'crew-k', 'x-arbo-preview': '1' }] as Array<Record<string, string>>) {
        const r = await get(base, '/api/crew/workorders', h);
        expect(r.status, JSON.stringify(h)).toBe(403);
        expect(await r.json()).toEqual({ error: 'briefing_not_signed' });
      }
      // A crew code on the practice data: the practice data keeps no sign-offs — named, never an open door.
      const coded = await get(base, `/api/crew/workorders?crewMemberId=${C1}`, { 'x-arbor-key': 'crew-k', 'x-arbo-preview': '1' });
      expect(coded.status).toBe(503);
      expect(await coded.json()).toEqual({ error: 'not_simulated' });
    } finally { srv.close(); }
  });

  it('the door says which key matched; the crew key never matches as the owner', async () => {
    const { checkApiDoor, KeyAttemptGuard } = await import('../src/server/accessDoor.js');
    const door = (given: string) => checkApiDoor({ pathname: '/api/crew/workorders', given, keyInUrl: false, addr: null, appKey: 'admin-k', crewKey: 'crew-k', guard: new KeyAttemptGuard({ log: () => {} }) });
    expect(door('admin-k')).toEqual({ ok: true, matched: 'owner' });
    expect(door('crew-k')).toEqual({ ok: true, matched: 'crew' });
  });
});

// ── The page ──────────────────────────────────────────────────────────────
const crew = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');
const fnSrc = (name: string): string => {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(crew);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
};
const lift = <T,>(names: string[], deps: Record<string, unknown>): T =>
  new Function(...Object.keys(deps), `${names.map(fnSrc).join('\n')}\nreturn { ${names.join(', ')} };`)(...Object.values(deps)) as T;

describe('C4 — the page keeps one start time per crew member, briefing and day', () => {
  const store = (blocked = false) => {
    const m = new Map<string, string>();
    return {
      m,
      load: (k: string) => m.get(k) ?? '',
      localStorage: { setItem: (k: string, v: string) => { if (blocked) throw new Error('blocked'); m.set(k, v); } },
    };
  };
  const kept = (s: ReturnType<typeof store>, crewId: string) =>
    lift<{ keptGateStart: (id: string) => string }>(['keptGateStart'], { CREW_ID: crewId, BRIEF_DAY: '2026-10-21', load: s.load, localStorage: s.localStorage }).keptGateStart;

  it('the first time it is now, and it is kept; a reload gets the same start back', () => {
    const s = store();
    const first = kept(s, C1)(TODAY.id);
    expect(Date.parse(first)).not.toBeNaN();
    expect([...s.m.entries()]).toEqual([[`arboGateStart:${C1}:${TODAY.id}:2026-10-21`, first]]);
    expect(kept(s, C1)(TODAY.id)).toBe(first);
  });

  // Review round (D109): two calls in one millisecond get the same "now" whether
  // or not the start was kept, so the test above can pass with the reuse line
  // gone. A start minutes old comes back unchanged only if it was kept — the one
  // guarantee migration 0011's unique index leans on (one paid row a reload).
  it('a reload minutes later gets the kept start back, unchanged and not overwritten', () => {
    const s = store();
    const key = `arboGateStart:${C1}:${TODAY.id}:2026-10-21`;
    const earlier = new Date(Date.now() - 7 * 60_000).toISOString();
    s.m.set(key, earlier);
    expect(kept(s, C1)(TODAY.id)).toBe(earlier);
    expect(s.m.get(key)).toBe(earlier);
  });

  it('a kept start later than now (the phone’s clock moved back) is never reused — a fresh one replaces it', () => {
    const s = store();
    const key = `arboGateStart:${C1}:${TODAY.id}:2026-10-21`;
    const later = new Date(Date.now() + 60 * 60_000).toISOString();
    s.m.set(key, later);
    const got = kept(s, C1)(TODAY.id);
    expect(got).not.toBe(later);
    expect(Date.parse(got)).toBeLessThanOrEqual(Date.now());
    expect(s.m.get(key)).toBe(got);
  });

  it('another briefing, another crew member or another day is a fresh start', () => {
    const s = store();
    s.m.set(`arboGateStart:${C1}:${TODAY.id}:2026-10-20`, '2026-10-20T10:00:00.000Z');
    expect(kept(s, C1)(TODAY.id)).not.toBe('2026-10-20T10:00:00.000Z');
    kept(s, '00000000-0000-4000-8000-0000000000c2')(TODAY.id);
    expect(s.m.has(`arboGateStart:00000000-0000-4000-8000-0000000000c2:${TODAY.id}:2026-10-21`)).toBe(true);
    kept(s, C1)('55555555-5555-4555-8555-555555555555');
    expect(s.m.has(`arboGateStart:${C1}:55555555-5555-4555-8555-555555555555:2026-10-21`)).toBe(true);
  });

  it('storage refused, or no crew code (the preview): a fresh start, nothing kept, the page goes on', () => {
    const blocked = store(true);
    expect(Date.parse(kept(blocked, C1)(TODAY.id))).not.toBeNaN();
    expect(blocked.m.size).toBe(0);
    const s = store();
    expect(Date.parse(kept(s, '')(TODAY.id))).not.toBeNaN();
    expect(s.m.size).toBe(0);
  });

  it('renderGate takes its start from it', () => {
    expect(fnSrc('renderGate')).toContain('GATE.startedAt = keptGateStart(brief.id);');
  });
});

// A stand-in DOM for the gate.
type N = { tag: string; className: string; textContent: string; id: string; kids: N[]; disabled: boolean; checked: boolean; on: Record<string, () => void> } & Record<string, unknown>;
const make = (tag: string, className = '', textContent = ''): N => {
  const n = {
    tag, className, textContent, id: '', kids: [] as N[], disabled: false, checked: false, scrollHeight: 0, clientHeight: 0, scrollTop: 0,
    on: {} as Record<string, () => void>,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(k: N) { n.kids.push(k); return k; },
    prepend(k: N) { n.kids.unshift(k); },
    insertBefore(k: N, ref: N) { const at = n.kids.indexOf(ref); n.kids.splice(at < 0 ? n.kids.length : at, 0, k); return k; },
    remove() { /* detached */ },
    replaceChildren() { n.kids = []; },
    addEventListener(type: string, fn: () => void) { n.on[type] = fn; },
    setAttribute(k: string, v: string) { if (k === 'id') n.id = v; },
  } as unknown as N;
  return n;
};
const all = (n: N): N[] => n.kids.flatMap((k) => [k, ...all(k)]);

/** The page's gate block (GATE … refreshGate, submitGate) over stand-ins. */
function gatePage(o: { links?: string; api?: (p: string, b?: unknown) => Promise<unknown>; crewWhy?: (e: unknown) => string } = {}) {
  const slot = make('div');
  const start = crew.indexOf('const GATE = {');
  const end = crew.indexOf('// ---- Clock-in question');
  const block = crew.slice(start, end);
  const calls = { quiz: 0, work: 0, load: 0 };
  const find = (id: string) => (id === 'gate-slot' ? slot : all(slot).find((n) => n.id === id) ?? null);
  const ready = Promise.resolve();
  const page = new Function(
    'PREVIEW', 'PREVIEW_WHY', 'document', '$', 'el', 'setInterval', 'LINKS_READY', 'LINKS', 'api', 'crewWhy', 'fmtTime',
    'renderQuiz', 'renderWork', 'loadBriefing', 'CREW_ID', 'BRIEF_DAY', 'load', 'localStorage',
    `${block}\nreturn { GATE, renderGate, refreshGate, submitGate };`,
  )(false, '', { querySelector: (s: string) => (s === '.gate-head' ? all(slot).find((n) => n.className === 'gate-head') ?? null : s === '#gate .ro-note' ? all(slot).find((n) => n.className === 'ro-note') ?? null : make('main')), createElement: (t: string) => make(t) },
    find, make, () => 1, ready, o.links ?? 'live', o.api ?? (async () => ({})), o.crewWhy ?? (() => 'why'), () => 'FMT',
    () => { calls.quiz += 1; }, () => { calls.work += 1; }, () => { calls.load += 1; }, C1, '2026-10-21', () => '', { setItem() {} },
  ) as { GATE: Record<string, unknown>; renderGate: (b: unknown) => void; refreshGate: () => void; submitGate: () => Promise<void> };
  return { ...page, slot, find, calls, ready };
}
const readyToPress = (p: ReturnType<typeof gatePage>) => {
  const box = p.find('ackbox')!;
  box.checked = true;
  box.on.change!();
  p.GATE.openedMs = Date.now() - 60_000;
  p.refreshGate();
};

describe('C4 — the page: signed after a reload, GO off in flight, a 409 reads the briefing again', () => {
  it('a briefing the server says is signed opens the day: "Signed at … — logged. Not counted twice."', async () => {
    const p = gatePage({ links: 'readonly' });
    p.renderGate({ ...TODAY, requiredSeconds: 10, signedAt: '2026-10-21T10:42:00.000Z', signedCheck: 'read' });
    await p.ready.then(() => {});
    expect(p.GATE.unlocked).toBe(true);
    expect(p.find('gate-status')!.textContent).toBe('Signed at FMT — logged. Not counted twice.');
    expect(p.find('gobtn')!.className).toBe('done');
    expect(p.find('gobtn')!.disabled).toBe(true);
    expect(p.find('ackbox')!.disabled).toBe(true);
    expect(p.calls).toMatchObject({ quiz: 1, work: 1 });
    // Read-only cannot save a NEW sign-off; this one is already saved — no "can’t be saved" note over it.
    expect(all(p.slot).some((n) => n.className === 'ro-note')).toBe(false);
  });

  it('not signed: the gate as before; "Signed at" is never drawn without the server’s time', () => {
    const p = gatePage();
    p.renderGate({ ...TODAY, requiredSeconds: 10, signedAt: null, signedCheck: 'read' });
    expect(p.GATE.unlocked).toBe(false);
    expect(all(p.slot).some((n) => /Signed at/.test(n.textContent))).toBe(false);
  });

  it('a sign-off check that could not be read is named on the gate — never a pass, never "not signed"', () => {
    const p = gatePage({ crewWhy: (e) => ((e as { message: string }).message === 'not_simulated' ? 'not part of the practice data' : 'why') });
    p.renderGate({ ...TODAY, requiredSeconds: 10, signedAt: null, signedCheck: 'not_simulated' });
    expect(all(p.slot).map((n) => n.textContent)).toContain('Arbo couldn’t check for an earlier sign-off today (not part of the practice data).');
    const q = gatePage();
    q.renderGate({ ...TODAY, requiredSeconds: 10, signedAt: null, signedCheck: 'signoff_unreadable' });
    expect(all(q.slot).map((n) => n.textContent)).toContain('Arbo couldn’t check for an earlier sign-off today.');
    expect(q.GATE.unlocked).toBe(false);
  });

  it('GO stays off while a sign-off is in flight — a second press cannot send a second one', async () => {
    let release: (v: unknown) => void = () => {};
    let sent = 0;
    const p = gatePage({ api: () => { sent += 1; return new Promise((r) => { release = r; }); } });
    p.renderGate({ ...TODAY, requiredSeconds: 10 });
    readyToPress(p);
    const go = p.find('gobtn')!;
    expect(go.className).toBe('ready');
    const pending = p.submitGate();
    p.refreshGate(); // the 1-second tick while the answer is on its way
    expect(go.disabled).toBe(true);
    expect(go.className).toBe('');
    expect(p.GATE.sending).toBe(true);
    release({ unlocked: true, trainingEventId: 'x', timeEntryId: 'y' });
    await pending;
    expect(p.GATE.sending).toBe(false);
    expect(sent).toBe(1);
    expect(p.GATE.unlocked).toBe(true);
  });

  it('the start sent is the kept one', async () => {
    const bodies: unknown[] = [];
    const p = gatePage({ api: async (_path, opts) => { bodies.push((opts as { body: unknown }).body); return { unlocked: true }; } });
    p.renderGate({ ...TODAY, requiredSeconds: 10 });
    readyToPress(p);
    await p.submitGate();
    expect((bodies[0] as { startedAtIso: string }).startedAtIso).toBe(p.GATE.startedAt);
  });

  it('a duplicate the server read back: "Signed at … — logged. Not counted twice."; one it could not: "Already logged earlier"', async () => {
    for (const [answer, line] of [
      [{ unlocked: true, duplicate: true, signedAt: '2026-10-21T10:42:00.000Z' }, 'Signed at FMT — logged. Not counted twice.'],
      [{ unlocked: true, duplicate: true }, 'Already logged earlier — not counted twice.'],
      [{ unlocked: true, trainingEventId: 'x', timeEntryId: 'y', signedCheck: 'signoff_unreadable' }, 'Logged — Arbo couldn’t check for an earlier sign-off today, so tell the office if you already signed.'],
      [{ unlocked: true, trainingEventId: 'x', timeEntryId: 'y' }, ''],
    ] as const) {
      const p = gatePage({ api: async () => answer });
      p.renderGate({ ...TODAY, requiredSeconds: 10 });
      readyToPress(p);
      await p.submitGate();
      expect(p.find('gate-status')!.textContent, JSON.stringify(answer)).toBe(line);
      expect(p.GATE.unlocked).toBe(true);
    }
  });

  it('a 409 (not today’s briefing) holds GO, names it, and reads the briefing again', async () => {
    const crewWhy = new Function('LINKS', `${fnSrc('crewWhy')}\nreturn crewWhy;`)('live') as (e: unknown) => string;
    const p = gatePage({ api: async () => { throw Object.assign(new Error('not_todays_briefing'), { code: 409 }); }, crewWhy });
    p.renderGate({ ...TODAY, requiredSeconds: 10 });
    readyToPress(p);
    await p.submitGate();
    expect(p.GATE.serverHold).toBe(true);
    // Neutral on purpose: a 409 is also "no briefing on the server today", so it never claims a newer one.
    expect(p.GATE.serverMsg).toBe('Your sign-off could not be recorded (that was not today’s briefing). Read today’s briefing below and sign again.');
    expect(p.GATE.content).toBeNull();
    expect(p.calls.load).toBe(1);
    expect(p.find('gobtn')!.className).not.toBe('ready');
  });

  // Review round (D109): the 409 emptied GATE.content and the catch handed GO
  // back, so a second tap before the re-read landed sent content: null — a 400
  // that then said "check your crew code". GO is off from the 409 until the
  // re-read briefing is drawn; a tap in between sends nothing.
  it('after a 409 GO stays off until the re-read briefing is drawn — a tap in between sends nothing', async () => {
    const crewWhy = new Function('LINKS', `${fnSrc('crewWhy')}\nreturn crewWhy;`)('live') as (e: unknown) => string;
    let sent = 0;
    const p = gatePage({ api: async () => { sent += 1; throw Object.assign(new Error('not_todays_briefing'), { code: 409 }); }, crewWhy });
    p.renderGate({ ...TODAY, requiredSeconds: 10 });
    readyToPress(p);
    await p.submitGate();
    const go = p.find('gobtn')!;
    expect(go.disabled).toBe(true);
    p.refreshGate(); // the 1-second tick while the re-read is on its way
    expect(go.disabled).toBe(true);
    expect(go.className).toBe('');
    await p.submitGate(); // a tap anyway
    expect(sent).toBe(1);
    // The re-read lands: the new gate holds the 409 line until its own box is ticked, then arms.
    p.renderGate({ ...TODAY, id: '44444444-4444-4444-8444-444444444444', requiredSeconds: 10 });
    expect(p.find('gate-status')!.textContent).toMatch(/^Your sign-off could not be recorded \(that was not today’s briefing\)\./);
    readyToPress(p);
    expect(p.find('gobtn')!.disabled).toBe(false);
    expect(p.find('gobtn')!.className).toBe('ready');
  });
});

// Review round (D109): every refusal is named through crewWhy — a 400 too.
// Only a crew code the office does not know keeps the crew-code line; any
// other 400 (bad_times, bad_request) is said for what it is, GO held.
describe('C4 review — a 400 sign-off is named for what it is', () => {
  const crewWhy = new Function('LINKS', `${fnSrc('crewWhy')}\nreturn crewWhy;`)('live') as (e: unknown) => string;
  const refusedWith = async (message: string) => {
    const p = gatePage({ api: async () => { throw Object.assign(new Error(message), { code: 400 }); }, crewWhy });
    p.renderGate({ ...TODAY, requiredSeconds: 10 });
    readyToPress(p);
    await p.submitGate();
    return p;
  };

  it('crewWhy names a clock the server cannot use, and any other 400 as turned down — never "didn’t answer"', () => {
    expect(crewWhy({ code: 400, message: 'bad_times' })).toBe('this phone’s clock gave times the office can’t use — check the phone’s date and time');
    for (const m of ['bad_request', 'bad_item_id', 'error']) {
      expect(crewWhy({ code: 400, message: m }), m).toBe('the office couldn’t use what this phone sent');
    }
    // The crew-code names keep their own words on every status.
    expect(crewWhy({ code: 400, message: 'unknown_crew' })).toBe('the office doesn’t know this crew code — check it with the office');
  });

  it('bad_times and bad_request go through crewWhy, GO held — never "check your crew code"', async () => {
    for (const [message, reason] of [
      ['bad_times', 'this phone’s clock gave times the office can’t use — check the phone’s date and time'],
      ['bad_request', 'the office couldn’t use what this phone sent'],
    ] as const) {
      const p = await refusedWith(message);
      expect(p.GATE.serverMsg, message).toBe(`Your sign-off could not be recorded (${reason}). Your work orders stay locked — do not start work; call the office to log your briefing.`);
      expect(p.GATE.serverHold, message).toBe(true);
      expect(p.find('gobtn')!.className, message).toBe('');
    }
  });

  it('a crew code the office does not know keeps the crew-code line, GO held', async () => {
    for (const message of ['unknown_crew', 'bad_crew_id']) {
      const p = await refusedWith(message);
      expect(p.GATE.serverMsg, message).toBe('That sign-off was rejected — check your crew code with the office.');
      expect(p.GATE.serverHold, message).toBe(true);
    }
  });
});

describe('C4 — crewWhy names the day’s refusals', () => {
  const why = new Function('LINKS', `${fnSrc('crewWhy')}\nreturn crewWhy;`)('live') as (e: unknown) => string;
  it('briefing_not_signed, not_todays_briefing, signoff_unreadable', () => {
    expect(why({ code: 403, message: 'briefing_not_signed' })).toBe('today’s briefing isn’t signed on this phone yet');
    expect(why({ code: 409, message: 'not_todays_briefing' })).toBe('that was not today’s briefing');
    expect(why({ code: 503, message: 'signoff_unreadable' })).toBe('Arbo couldn’t check your sign-off');
  });
});

describe('C4 — the crew phone’s reads carry its code; the preview’s stay bare', () => {
  it('the briefing read carries the crew code when there is one', () => {
    expect(crew).toContain("api('/api/crew/briefing' + (CREW_ID ? '?crewMemberId=' + encodeURIComponent(CREW_ID) : '')).then(renderGate)");
  });

  it('the work-order read carries the crew code on a crew phone, and nothing in the preview', () => {
    expect(fnSrc('renderWork')).toContain("api('/api/crew/workorders' + (PREVIEW ? '' : '?crewMemberId=' + encodeURIComponent(CREW_ID)))");
  });

  it('a 403 briefing_not_signed on the work orders is named, and is not an empty day', async () => {
    class W { kids: W[] = []; constructor(public tag: string, public className = '', public textContent = '') {} appendChild(k: W) { this.kids.push(k); return k; } replaceChildren() { this.kids = []; } text(): string { return [this.textContent, ...this.kids.map((k) => k.text())].filter(Boolean).join(' '); } }
    const v = new W('div');
    const crewWhy = new Function('LINKS', `${fnSrc('crewWhy')}\nreturn crewWhy;`)('readonly') as (e: unknown) => string;
    await (new Function('$', 'el', 'document', 'api', 'GATE', 'PREVIEW', 'PREVIEW_WHY', 'CREW_ID', 'LINKS_READY', 'crewWhy', 'fmtTime', 'arrivalButton', 'changeOrderButton', 'crewMapsUrl',
      `${fnSrc('renderWork')}\nreturn renderWork;`)(
      () => v, (t: string, c?: string, x?: string) => new W(t, c, x), { createTextNode: (t: string) => new W('#text', '', t) },
      async () => { throw Object.assign(new Error('briefing_not_signed'), { code: 403 }); }, { unlocked: true }, false, '', C1, Promise.resolve(), crewWhy,
      () => '', () => new W('div'), () => new W('div'), () => '',
    ) as () => Promise<void>)();
    expect(v.text()).toContain('Could not load your work orders');
    expect(v.text()).toContain('Today’s briefing isn’t signed on this phone yet.');
    expect(v.text()).toContain('That is not an empty day — call the office.');
    expect(v.text()).not.toContain('Nothing scheduled');
  });
});
