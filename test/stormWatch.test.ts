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
