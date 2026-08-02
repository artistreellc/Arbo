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
