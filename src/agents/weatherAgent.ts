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
// Agent #9 — Weather & Conditions (brief §8A.5). Watches the NWS feed and
// raises work-stopping alerts onto the event bus so scheduling, the safety
// chain, and the owner brief all see the SAME weather truth. Deterministic;
// a dead feed is reported as unavailable, never as clear skies (§12).

import type { AlertsProvider } from '../ops/stormWatch.js';
import { isWorkStopping } from '../ops/stormWatch.js';
import { startAgentRun } from '../binder/agentRun.js';
import { emitSafe } from '../binder/eventBus.js';
import { getDb, hasDb } from '../db/client.js';
import { env } from '../env.js';

export interface WeatherAgentResult {
  agent: 'weather';
  feed: 'ok' | 'unavailable';
  activeAlerts: number;
  workStopping: number;
  newlyRaised: number;
  llm: 'not_configured' | 'available';
  status: 'ok' | 'error';
}

/** Alert ids already raised onto the bus in the trailing window (dedupe). */
async function alreadyRaised(now: Date): Promise<Set<string>> {
  if (!hasDb()) return new Set();
  const since = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const res = await getDb()
    .from('event')
    .select('payload')
    .eq('type', 'weather.alert.raised')
    .gte('emitted_at', since);
  if (res.error) return new Set(); // dedupe read failing must not block raising
  const out = new Set<string>();
  for (const r of res.data ?? []) {
    const id = (r.payload as { alertId?: string }).alertId;
    if (id) out.add(id);
  }
  return out;
}

export async function runWeatherAgent(alerts: AlertsProvider, now = new Date()): Promise<WeatherAgentResult> {
  const run = await startAgentRun({ agent: 'weather', modelUsed: env.anthropic.apiKey ? 'claude-opus-5' : undefined });
  const llm = env.anthropic.apiKey ? 'available' as const : 'not_configured' as const;
  try {
    let active;
    try {
      active = await alerts.activeAlerts();
    } catch {
      // Feed down: NAMED. Absence of data is never absence of storm.
      await run.finish({ status: 'ok', outputSummary: `feed=unavailable llm=${llm}` });
      return { agent: 'weather', feed: 'unavailable', activeAlerts: 0, workStopping: 0, newlyRaised: 0, llm, status: 'ok' };
    }
    const stopping = active.filter(isWorkStopping);
    const seen = await alreadyRaised(now);
    let raised = 0;
    for (const a of stopping) {
      if (seen.has(a.id)) continue;
      const ok = await emitSafe('weather.alert.raised', {
        alertId: a.id, event: a.event, severity: a.severity, cities: a.cities,
        onset: a.onset, ends: a.ends,
      }, 'weather-agent');
      if (ok) raised++;
    }
    await run.finish({
      status: 'ok',
      outputSummary: `feed=ok active=${active.length} work_stopping=${stopping.length} newly_raised=${raised} llm=${llm}`,
    });
    return { agent: 'weather', feed: 'ok', activeAlerts: active.length, workStopping: stopping.length, newlyRaised: raised, llm, status: 'ok' };
  } catch (err) {
    await run.finish({ status: 'error', outputSummary: err instanceof Error ? err.message : 'error' });
    return { agent: 'weather', feed: 'unavailable', activeAlerts: 0, workStopping: 0, newlyRaised: 0, llm, status: 'error' };
  }
}
