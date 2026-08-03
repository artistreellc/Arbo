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
