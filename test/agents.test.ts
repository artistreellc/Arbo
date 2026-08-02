import { describe, it, expect } from 'vitest';
import { runOwnerBriefingAgent } from '../src/agents/ownerBriefingAgent.js';
import type { createApi } from '../src/server/api.js';

type Api = ReturnType<typeof createApi>;

// A fake api: each section either answers or throws, so the agent's honesty
// rules are testable without a database.
function fakeApi(overrides: Partial<Record<'brief' | 'queue' | 'storm' | 'forecast', () => Promise<{ status: number; body: unknown }>>>): Api {
  const dead = async () => { throw new Error('down'); };
  return {
    brief: overrides.brief ?? dead,
    queue: overrides.queue ?? dead,
    storm: overrides.storm ?? dead,
    forecast: overrides.forecast ?? dead,
  } as unknown as Api;
}

describe('Owner Briefing agent (#13, §3.17) — omission is the failure mode', () => {
  it('reports every reachable section and names every dead one', async () => {
    const api = fakeApi({
      brief: async () => ({ status: 200, body: {} }),
      queue: async () => ({ status: 200, body: { open: [1, 2, 3] } }),
      // storm + forecast left dead on purpose
    });
    const r = await runOwnerBriefingAgent(api);
    expect(r.status).toBe('ok');
    expect(r.sections.brief).toBe('ok');
    expect(r.sections.openLoops).toBe(3);
    expect(r.sections.storm).toBe('unavailable');   // named, never invented
    expect(r.sections.comingDue).toBe('unavailable');
  });

  it('a clear storm feed reads clear; alerts read alerts', async () => {
    const clear = await runOwnerBriefingAgent(fakeApi({
      storm: async () => ({ status: 200, body: { alerts: [] } }),
    }));
    expect(clear.sections.storm).toBe('clear');
    const alerts = await runOwnerBriefingAgent(fakeApi({
      storm: async () => ({ status: 200, body: { alerts: [{}] } }),
    }));
    expect(alerts.sections.storm).toBe('alerts');
  });

  it('is honest about the missing LLM key — never claims Opus ran', async () => {
    const r = await runOwnerBriefingAgent(fakeApi({}));
    // In the test environment no ANTHROPIC_API_KEY is set.
    expect(r.llm).toBe('not_configured');
  });

  it('an all-dead day still returns ok with every section named unavailable', async () => {
    const r = await runOwnerBriefingAgent(fakeApi({}));
    expect(r.status).toBe('ok');
    expect(Object.values(r.sections)).toEqual(['unavailable', 'unavailable', 'unavailable', 'unavailable']);
  });
});
