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
import {
  createNwsAlertsProvider,
  flagStopsAtRisk,
  isWorkStopping,
  CITY_POINTS,
  type StormAlert,
  type FetchFn,
} from '../src/ops/stormWatch.js';
import { createApi, type DataSource } from '../src/server/api.js';

const NOW = new Date('2026-08-01T15:00:00Z');

const alert = (over: Partial<StormAlert> = {}): StormAlert => ({
  id: 'a1',
  event: 'Severe Thunderstorm Warning',
  severity: 'Severe',
  headline: 'Severe thunderstorms until 5 PM',
  onset: '2026-08-01T14:00:00Z',
  ends: '2026-08-01T21:00:00Z',
  cities: ['Virginia Beach'],
  ...over,
});

describe('storm watch (§5A #26)', () => {
  it('classifies work-stopping weather inclusively (severity OR event kind)', () => {
    expect(isWorkStopping(alert())).toBe(true);
    expect(isWorkStopping(alert({ severity: 'Minor', event: 'High Wind Watch' }))).toBe(true);
    expect(isWorkStopping(alert({ severity: 'Minor', event: 'Coastal Flood Advisory' }))).toBe(true);
    expect(isWorkStopping(alert({ severity: 'Minor', event: 'Air Quality Alert' }))).toBe(false);
  });

  it('flags stops inside the alert window for the alert cities only', () => {
    const stops = [
      { id: 's1', city: 'Virginia Beach', timeIso: '2026-08-01T16:00:00Z' }, // inside
      { id: 's2', city: 'Virginia Beach', timeIso: '2026-08-01T22:30:00Z' }, // after ends
      { id: 's3', city: 'Norfolk', timeIso: '2026-08-01T16:00:00Z' }, // other city
    ];
    const flagged = flagStopsAtRisk([alert()], stops, NOW);
    expect(flagged.map((f) => f.stopId)).toEqual(['s1']);
    expect(flagged[0]!.recommendOnly).toBe(true);
  });

  it('a stop with no time still flags when its city is under an active alert', () => {
    const flagged = flagStopsAtRisk([alert()], [{ id: 's4', city: 'Virginia Beach', timeIso: null }], NOW);
    expect(flagged).toHaveLength(1);
  });

  it('non-work-stopping alerts flag nothing', () => {
    const quiet = alert({ severity: 'Minor', event: 'Special Weather Statement about pollen' });
    expect(flagStopsAtRisk([quiet], [{ id: 's1', city: 'Virginia Beach', timeIso: '2026-08-01T16:00:00Z' }], NOW)).toHaveLength(0);
  });
});

describe('NWS alerts provider', () => {
  const feature = (id: string) => ({
    properties: {
      id,
      event: 'Severe Thunderstorm Warning',
      severity: 'Severe',
      headline: 'h',
      onset: '2026-08-01T14:00:00Z',
      expires: '2026-08-01T21:00:00Z',
    },
  });

  it('queries all four city points and dedupes shared alerts by id', async () => {
    const urls: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ features: [feature('shared-1')] }) };
    };
    const alerts = await createNwsAlertsProvider(fetchFn).activeAlerts();
    expect(urls).toHaveLength(4);
    for (const city of Object.keys(CITY_POINTS)) expect(city.length).toBeGreaterThan(0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.cities).toHaveLength(4); // covers every city point
    expect(alerts[0]!.ends).toBe('2026-08-01T21:00:00Z'); // expires fallback
  });

  it('throws on HTTP failure and on malformed bodies — a dead feed is never clear skies', async () => {
    const bad: FetchFn = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await expect(createNwsAlertsProvider(bad).activeAlerts()).rejects.toThrow(/HTTP 503/);
    const malformed: FetchFn = async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) });
    await expect(createNwsAlertsProvider(malformed).activeAlerts()).rejects.toThrow(/malformed/);
  });
});

describe('API write side — outcomes and sent-bookkeeping', () => {
  function fakeSource() {
    const calls: Record<string, unknown[]> = { outcome: [], sent: [], review: [] };
    const source: DataSource = {
      ready: () => true,
      stopsBetween: async () => [],
      newLeads: async () => [],
      recordOutcome: async (id, outcome) => void calls.outcome!.push([id, outcome]),
      recordFollowUpSent: async (id) => void calls.sent!.push(id),
      recordReviewRequested: async (id) => void calls.review!.push(id),
    };
    return { source, calls };
  }

  it('records a valid outcome and rejects garbage', async () => {
    const { source, calls } = fakeSource();
    const api = createApi(source);
    expect((await api.setOutcome('e1', 'won')).status).toBe(200);
    expect(calls.outcome).toEqual([['e1', 'won']]);
    expect((await api.setOutcome('e1', 'paid_in_hugs')).status).toBe(400);
    expect((await api.setOutcome('', 'won')).status).toBe(400);
  });

  it('advances the cadence only through the sent endpoints', async () => {
    const { source, calls } = fakeSource();
    const api = createApi(source);
    expect((await api.markFollowUpSent('estimate', 'e1')).status).toBe(200);
    expect((await api.markFollowUpSent('review', 'j1')).status).toBe(200);
    expect((await api.markFollowUpSent('carrier_pigeon', 'x')).status).toBe(400);
    expect(calls.sent).toEqual(['e1']);
    expect(calls.review).toEqual(['j1']);
  });

  it('storm endpoint: 503 without a feed, 503 on feed failure, alerts+flags on success', async () => {
    const { source } = fakeSource();
    expect((await createApi(source).storm()).status).toBe(503);
    const failing = createApi(source, { alerts: { activeAlerts: async () => { throw new Error('down'); } } });
    expect((await failing.storm()).status).toBe(503);
    const src = fakeSource().source;
    src.stopsBetween = async () => [
      { id: 's1', kind: 'job', city: 'Virginia Beach', address: 'x', timeIso: '2026-08-01T16:00:00Z' },
    ];
    const ok = createApi(src, { alerts: { activeAlerts: async () => [alert()] } });
    const res = await ok.storm();
    expect(res.status).toBe(200);
    const body = res.body as { alerts: unknown[]; atRisk: Array<{ stopId: string }> };
    expect(body.alerts).toHaveLength(1);
    expect(body.atRisk.map((f) => f.stopId)).toEqual(['s1']);
  });
});
