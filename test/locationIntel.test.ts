/*
  ═══════════════════════════════════════════════════════════════════════
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
*/
import { describe, it, expect } from 'vitest';
import {
  assessRunningLate,
  detectVisits,
  distanceMeters,
  withinWorkingHours,
  GEOFENCE_RADIUS_M,
  type GeoStop,
  type LocationPing,
} from '../src/ops/locationIntel.js';
import { createApi, type DataSource, type ApiGeoStop } from '../src/server/api.js';
import { loadGuardrails, loadLegal } from '../src/config/loadConfig.js';
import { guardReply } from '../src/reception/outputGuard.js';
import { createElevenLabsBridge } from '../src/voice/elevenlabsBridge.js';
import type { Alerter, ChatMessage, LlmClient } from '../src/reception/receptionist.js';

// Norfolk-ish anchor point; +0.1° lat ≈ 11.1 km.
const HOME = { lat: 36.85, lng: -76.28 };
const FAR = { lat: 36.95, lng: -76.28 };

const ping = (over: Partial<LocationPing> = {}): LocationPing => ({ ...HOME, atIso: '2026-07-29T18:58:00Z', ...over });
const stop = (over: Partial<GeoStop> = {}): GeoStop => ({ id: 's1', kind: 'estimate', ...HOME, timeIso: null, ...over });

describe('§24 working-hours gate (the law is in code)', () => {
  it('weekday afternoon ET is inside; nights and weekends are not', () => {
    expect(withinWorkingHours(new Date('2026-07-29T19:00:00Z'))).toBe(true); // Wed 3 PM EDT
    expect(withinWorkingHours(new Date('2026-07-29T10:00:00Z'))).toBe(false); // Wed 6 AM EDT
    expect(withinWorkingHours(new Date('2026-07-29T23:30:00Z'))).toBe(false); // Wed 7:30 PM EDT
    expect(withinWorkingHours(new Date('2026-08-01T16:00:00Z'))).toBe(false); // Saturday
  });
});

describe('geofence visit detection (§5A #21/#22)', () => {
  it('two pings inside the fence = a visit; one blip is not; no pings = no_data', () => {
    const s = stop();
    expect(distanceMeters(HOME, FAR)).toBeGreaterThan(GEOFENCE_RADIUS_M);
    const two = detectVisits([ping({ atIso: '2026-07-29T18:00:00Z' }), ping({ atIso: '2026-07-29T18:05:00Z' })], [s]);
    expect(two[0]).toMatchObject({ stopId: 's1', visited: true, firstSeenIso: '2026-07-29T18:00:00Z' });
    expect(detectVisits([ping()], [s])[0]!.visited).toBe(false);
    // mixed pings match per stop: two at FAR confirm the FAR stop even with HOME noise in between
    expect(detectVisits([ping(), ping({ ...FAR }), ping({ ...FAR, atIso: '2026-07-29T19:02:00Z' })], [stop({ id: 's2', ...FAR })])[0]!.visited).toBe(true);
    expect(detectVisits([], [s])[0]!.visited).toBe('no_data');
  });
});

describe('running-late assessment (§5A #23 — recommend-only, honest degradation)', () => {
  const NOW = new Date('2026-07-29T18:00:00Z');
  const fresh = ping({ atIso: '2026-07-29T17:58:00Z' });

  it('a stale or missing ping is no_data — never a guess', () => {
    expect(assessRunningLate(null, stop(), NOW).state).toBe('no_data');
    expect(assessRunningLate(ping({ atIso: '2026-07-29T17:00:00Z' }), stop(), NOW).state).toBe('no_data');
  });

  it('far away with the appointment due now → late, with the SOFT draft (no hard ETA)', () => {
    const due = stop({ ...FAR, timeIso: '2026-07-29T18:05:00Z', name: 'Pat Henderson' });
    const out = assessRunningLate(fresh, due, NOW);
    expect(out.state).toBe('late');
    expect(out.recommendOnly).toBe(true);
    expect(out.minutesBehind!).toBeGreaterThan(10);
    expect(out.draftMessage).toContain('running a little behind');
    expect(out.draftMessage).toContain('Pat');
    expect(out.draftMessage).not.toMatch(/\d{1,2}:\d{2}/); // no invented clock-time ETA
  });

  it('the draft passes the output guard and the forbidden-strings law', () => {
    const out = assessRunningLate(fresh, stop({ ...FAR, timeIso: '2026-07-29T18:05:00Z' }), NOW);
    expect(guardReply(out.draftMessage!, loadGuardrails()).safe).toBe(true);
  });

  it('slightly behind → tight; plenty of margin → on_track', () => {
    expect(assessRunningLate(fresh, stop({ ...FAR, timeIso: '2026-07-29T18:15:00Z' }), NOW).state).toBe('tight');
    expect(assessRunningLate(fresh, stop({ ...FAR, timeIso: '2026-07-29T19:00:00Z' }), NOW).state).toBe('on_track');
  });
});

// ---------------------------------------------------------------------------
// API layer: the §24 gate order and the honest day review.
// ---------------------------------------------------------------------------

function makeSource(over: Partial<DataSource> = {}): DataSource & { pings: unknown[]; visited: string[] } {
  const pings: unknown[] = [];
  const visited: string[] = [];
  return {
    pings,
    visited,
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [],
    recordPing: async (p) => void pings.push(p),
    pingsSince: async () => [],
    getTracking: async () => true,
    setTracking: async () => {},
    geoStops: async () => [],
    markVisited: async (id) => void visited.push(id),
    ...over,
  };
}

const WORK_HOURS = new Date('2026-07-29T19:00:00Z'); // Wed 3 PM EDT
const AFTER_HOURS = new Date('2026-07-29T23:30:00Z');

describe('POST /api/location/ping — §24 named refusals, in order', () => {
  it('tracking OFF refuses before anything is stored', async () => {
    const src = makeSource({ getTracking: async () => false });
    const out = await createApi(src).locationPing({ lat: 36.85, lng: -76.28 }, WORK_HOURS);
    expect(out).toMatchObject({ status: 403, body: { error: 'tracking_off' } });
    expect(src.pings).toHaveLength(0);
  });

  it('after-hours pings are refused even with tracking ON', async () => {
    const src = makeSource();
    const out = await createApi(src).locationPing({ lat: 36.85, lng: -76.28 }, AFTER_HOURS);
    expect(out).toMatchObject({ status: 403, body: { error: 'after_hours' } });
    expect(src.pings).toHaveLength(0);
  });

  it('garbage coordinates are a 400; a clean working-hours ping stores', async () => {
    const src = makeSource();
    const api = createApi(src);
    expect((await api.locationPing({ lat: 'x', lng: 0 }, WORK_HOURS)).status).toBe(400);
    expect((await api.locationPing({ lat: 91, lng: 0 }, WORK_HOURS)).status).toBe(400);
    expect((await api.locationPing({ lat: 36.85, lng: -76.28, accuracyM: 12 }, WORK_HOURS)).status).toBe(200);
    expect(src.pings).toEqual([{ lat: 36.85, lng: -76.28, accuracyM: 12 }]);
  });

  it('the toggle validates and flips', async () => {
    const api = createApi(makeSource());
    expect((await api.locationTracking('yes')).status).toBe(400);
    expect((await api.locationTracking(true)).body).toEqual({ tracking: true });
  });
});

describe('GET /api/location/status + /day', () => {
  it('tracking off → no pings read, late is no_data', async () => {
    const src = makeSource({ getTracking: async () => false });
    const body = (await createApi(src).locationStatus(WORK_HOURS)).body as { tracking: boolean; late: { state: string } };
    expect(body.tracking).toBe(false);
    expect(body.late.state).toBe('no_data');
  });

  it('fresh ping + a far next stop due soon → late with the draft', async () => {
    const src = makeSource({
      pingsSince: async () => [{ ...HOME, atIso: '2026-07-29T18:58:00Z' }],
      geoStops: async (): Promise<ApiGeoStop[]> => [
        { id: 'n1', kind: 'estimate', timeIso: '2026-07-29T19:05:00Z', name: 'Sam', ...FAR },
      ],
    });
    const body = (await createApi(src).locationStatus(WORK_HOURS)).body as { late: { state: string; draftMessage?: string } };
    expect(body.late.state).toBe('late');
    expect(body.late.draftMessage).toContain('Sam');
  });

  it('day review persists visits for ESTIMATE stops only, and reports unlocatable stops as no_data', async () => {
    const src = makeSource({
      pingsSince: async () => [
        { ...HOME, atIso: '2026-07-29T15:00:00Z' },
        { ...HOME, atIso: '2026-07-29T15:06:00Z' },
      ],
      geoStops: async (): Promise<ApiGeoStop[]> => [
        { id: 'est1', kind: 'estimate', timeIso: null, name: null, ...HOME },
        { id: 'job1', kind: 'job', timeIso: null, name: null, ...HOME },
        { id: 'lost', kind: 'estimate', timeIso: null, name: null, lat: null, lng: null },
      ],
    });
    const out = await createApi(src).locationDay('2026-07-29T04:00:00Z', '2026-07-30T04:00:00Z');
    const body = out.body as { checks: Array<{ stopId: string; visited: boolean | string }>; pingCount: number };
    expect(body.pingCount).toBe(2);
    expect(body.checks.find((c) => c.stopId === 'est1')!.visited).toBe(true);
    expect(body.checks.find((c) => c.stopId === 'lost')!.visited).toBe('no_data');
    expect(src.visited).toEqual(['est1']); // the job visit is real but only estimates carry visited_at
    expect((await createApi(src).locationDay('nope', '')).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// §29 review loop: the bridge logs every turn, and logging can never cost a
// caller their reply.
// ---------------------------------------------------------------------------

class OneLineLlm implements LlmClient {
  async complete(_s: string, _m: ChatMessage[]): Promise<string> {
    return "Happy to help — what's the address?";
  }
}
const quietAlerter: Alerter = { emergency: async () => {} };

describe('§29 conversation logging via the bridge', () => {
  const deps = { guardrails: loadGuardrails(), legal: loadLegal(), llm: new OneLineLlm(), alerter: quietAlerter, bridgeSecret: 's' };

  it('each turn lands in the log with intent flags', async () => {
    const logged: Array<{ key: string; turn: { caller: string; reply: string; flags: string[] } }> = [];
    const bridge = createElevenLabsBridge({ ...deps, logTurn: async (key, turn) => void logged.push({ key, turn }) });
    const out = await bridge.handle('Bearer s', { conversation_id: 'c1', messages: [{ role: 'user', content: 'Hi, I need an estimate' }] });
    expect(out.status).toBe(200);
    expect(logged).toHaveLength(1);
    expect(logged[0]!.key).toBe('id:c1');
    expect(logged[0]!.turn.caller).toBe('Hi, I need an estimate');
    expect(logged[0]!.turn.flags).toContain('intent:normal');
  });

  it('a failing log sink never drops the reply', async () => {
    const bridge = createElevenLabsBridge({ ...deps, logTurn: async () => { throw new Error('db down'); } });
    const out = await bridge.handle('Bearer s', { conversation_id: 'c2', messages: [{ role: 'user', content: 'Hello there' }] });
    expect(out.status).toBe(200);
    expect((out.json as { choices: Array<{ message: { content: string } }> }).choices[0]!.message.content.length).toBeGreaterThan(0);
  });

  it('review backlog + mark-reviewed round-trip through the API', async () => {
    const rows = [{ id: 'r1', reviewed: false }];
    const src = makeSource({
      conversations: async (_l, unreviewedOnly) => (unreviewedOnly ? rows.filter((r) => !r.reviewed) : rows),
      markReviewed: async (id) => void (rows.find((r) => r.id === id)!.reviewed = true),
    });
    const api = createApi(src);
    expect(((await api.reviewBacklog()).body as { conversations: unknown[] }).conversations).toHaveLength(1);
    expect((await api.markReviewed('r1')).status).toBe(200);
    expect(((await api.reviewBacklog()).body as { conversations: unknown[] }).conversations).toHaveLength(0);
    expect((await api.markReviewed('')).status).toBe(400);
  });
});
