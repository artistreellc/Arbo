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
