import { describe, it, expect } from 'vitest';
import { runWeatherAgent } from '../src/agents/weatherAgent.js';
import type { AlertsProvider, StormAlert } from '../src/ops/stormWatch.js';

const alert = (over: Partial<StormAlert> = {}): StormAlert => ({
  id: 'urn:oid:test.1',
  event: 'Severe Thunderstorm Warning',
  severity: 'Severe',
  headline: 'Damaging winds',
  onset: '2026-08-05T18:00:00Z',
  ends: '2026-08-05T22:00:00Z',
  cities: ['Virginia Beach'],
  ...over,
});

const provider = (impl: () => Promise<StormAlert[]>): AlertsProvider => ({ activeAlerts: impl });

describe('Weather agent (#9) — a dead feed is never clear skies', () => {
  it('reports feed=unavailable when the NWS feed throws', async () => {
    const r = await runWeatherAgent(provider(async () => { throw new Error('down'); }));
    expect(r.feed).toBe('unavailable');
    expect(r.status).toBe('ok');       // the agent itself did its job
    expect(r.workStopping).toBe(0);
    expect(r.activeAlerts).toBe(0);
  });

  it('counts work-stopping alerts separately from all alerts', async () => {
    const r = await runWeatherAgent(provider(async () => [
      alert(),
      alert({ id: 'x2', event: 'Air Quality Alert', severity: 'Minor' }),
    ]));
    expect(r.feed).toBe('ok');
    expect(r.activeAlerts).toBe(2);
    expect(r.workStopping).toBe(1);
  });

  it('an empty feed is honestly quiet — zero alerts, feed ok', async () => {
    const r = await runWeatherAgent(provider(async () => []));
    expect(r.feed).toBe('ok');
    expect(r.activeAlerts).toBe(0);
    expect(r.workStopping).toBe(0);
  });

  it('reports the LLM layer honestly (no key in test env)', async () => {
    const r = await runWeatherAgent(provider(async () => []));
    expect(r.llm).toBe('not_configured');
  });
});
