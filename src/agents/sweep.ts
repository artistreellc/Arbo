// The wave-1 agent sweep (brief §8A.6f: cron + durable queue, deliberately
// boring). One entry point runs every server-side agent once, audit-logged,
// deduped against the bus. Called by the in-process hourly scheduler and by
// POST /api/agents/sweep (Mike's manual trigger). The Loop-Closer's urgent
// findings are raised HERE (deduped) — never from the read-only GET.

import type { createApi } from '../server/api.js';
import type { AlertsProvider } from '../ops/stormWatch.js';
import { runPermittingAgent } from './permittingAgent.js';
import { runOwnerBriefingAgent } from './ownerBriefingAgent.js';
import { runWeatherAgent } from './weatherAgent.js';
import { runBookingAgent } from './bookingAgent.js';
import { runCollectionsAgent } from './collectionsAgent.js';
import type { NeedsDecision } from '../ops/loopCloser.js';
import { emitSafe } from '../binder/eventBus.js';
import { getDb, hasDb } from '../db/client.js';

type Api = ReturnType<typeof createApi>;

async function raisedDecisionKeys(now: Date): Promise<Set<string>> {
  if (!hasDb()) return new Set();
  const since = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const res = await getDb()
    .from('event')
    .select('payload')
    .eq('type', 'needs_decision.raised')
    .gte('emitted_at', since);
  if (res.error) return new Set();
  const out = new Set<string>();
  for (const r of res.data ?? []) {
    const k = (r.payload as { key?: string }).key;
    if (k) out.add(k);
  }
  return out;
}

async function raiseUrgentLoops(api: Api, now: Date): Promise<number | 'unavailable'> {
  let raised = 0;
  try {
    const q = await api.queue();
    // A queue we could not READ is not a queue with nothing in it (§1B).
    if (q.status !== 200) return 'unavailable';
    const open = (q.body as { open: NeedsDecision[] }).open;
    const seen = await raisedDecisionKeys(now);
    for (const item of open.filter((i) => i.severity === 'urgent')) {
      if (seen.has(item.key)) continue;
      const ok = await emitSafe('needs_decision.raised', {
        key: item.key, kind: item.kind, refTable: item.refTable, refId: item.refId,
      }, 'loop-closer');
      if (ok) raised++;
    }
  } catch {
    // The sweep never dies on one section — but the section reports its own
    // blindness rather than contributing a confident zero.
    return 'unavailable';
  }
  return raised;
}

export interface SweepSummary {
  ranAtIso: string;
  permitting: Awaited<ReturnType<typeof runPermittingAgent>> | { status: 'error' };
  briefing: Awaited<ReturnType<typeof runOwnerBriefingAgent>> | { status: 'error' };
  weather: Awaited<ReturnType<typeof runWeatherAgent>> | { status: 'error' };
  booking: Awaited<ReturnType<typeof runBookingAgent>> | { status: 'error' };
  collections: Awaited<ReturnType<typeof runCollectionsAgent>> | { status: 'error' };
  urgentLoopsRaised: number | 'unavailable';
}

export async function runAgentSweep(api: Api, alerts: AlertsProvider, now = new Date()): Promise<SweepSummary> {
  const settle = async <T>(p: Promise<T>): Promise<T | { status: 'error' }> => {
    try { return await p; } catch { return { status: 'error' as const }; }
  };
  const [permitting, briefing, weather, booking, collections, urgentLoopsRaised] = await Promise.all([
    settle(runPermittingAgent(now)),
    settle(runOwnerBriefingAgent(api, now)),
    settle(runWeatherAgent(alerts, now)),
    settle(runBookingAgent(now)),
    settle(runCollectionsAgent(now)),
    raiseUrgentLoops(api, now),
  ]);
  return { ranAtIso: now.toISOString(), permitting, briefing, weather, booking, collections, urgentLoopsRaised };
}

/**
 * In-process hourly scheduler (§8A.6f). Fires once shortly after boot (so a
 * fresh deploy proves the agents live), then hourly. Never overlaps itself.
 */
export function startAgentScheduler(api: Api, alerts: AlertsProvider): NodeJS.Timeout {
  let running = false;
  const tick = async () => {
    if (running || !hasDb()) return;
    running = true;
    try {
      const s = await runAgentSweep(api, alerts);
      // The scheduled path has no HTTP response — this line is the ONLY
      // operator signal, so it must never say "ok" over a degraded sweep.
      const degraded = ([
        ['permitting', s.permitting], ['briefing', s.briefing],
        ['weather', s.weather], ['booking', s.booking],
        ['collections', s.collections],
      ] as const).filter(([, a]) => a.status !== 'ok').map(([name]) => name);
      const loops = s.urgentLoopsRaised;
      if (degraded.length > 0 || loops === 'unavailable') {
        console.error(`[agents] sweep DEGRADED — failed=[${degraded.join(',')}] urgent_loops=${loops}`);
      } else {
        console.log(`[agents] sweep ok — urgent_loops_raised=${loops}`);
      }
    } catch (err) {
      console.error('[agents] sweep failed:', err instanceof Error ? err.message : 'error');
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 90_000); // boot proof-of-life
  const handle = setInterval(tick, 60 * 60_000);
  handle.unref?.(); // never keep a dying process alive just to sweep
  return handle;
}
