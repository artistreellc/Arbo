// Agent #13 — Owner Briefing (brief §8A.5, §3.17, §6G). Writes the brief; the
// failure mode is OMISSION, so the deterministic core gathers every signal the
// day owes Mike — route, open loops, storm risk, coming-due — and the summary
// records exactly what was and wasn't reachable (§1B: a dead feed is named,
// never skipped silently). Summarizes, never acts.
//
// The Opus narrative layer (the spoken-style digest) reports not-configured
// until the ANTHROPIC_API_KEY lands.

import { startAgentRun } from '../binder/agentRun.js';
import { emitSafe } from '../binder/eventBus.js';
import { env } from '../env.js';
import type { createApi } from '../server/api.js';

export interface OwnerBriefingResult {
  agent: 'owner-briefing';
  sections: {
    brief: 'ok' | 'unavailable';
    openLoops: number | 'unavailable';
    storm: 'clear' | 'alerts' | 'unavailable';
    comingDue: number | 'unavailable';
  };
  llm: 'not_configured' | 'available';
  status: 'ok' | 'error';
}

type Api = ReturnType<typeof createApi>;

/**
 * One briefing run over the SAME api handlers the app uses (one law, one
 * data path). Each section degrades independently and honestly.
 */
export async function runOwnerBriefingAgent(api: Api, now = new Date()): Promise<OwnerBriefingResult> {
  const run = await startAgentRun({ agent: 'owner-briefing', modelUsed: env.anthropic.apiKey ? 'claude-opus-5' : undefined });
  const llm = env.anthropic.apiKey ? 'available' as const : 'not_configured' as const;

  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86400_000);

  const sections: OwnerBriefingResult['sections'] = {
    brief: 'unavailable', openLoops: 'unavailable', storm: 'unavailable', comingDue: 'unavailable',
  };

  try {
    try {
      const r = await api.brief(dayStart.toISOString(), dayEnd.toISOString());
      sections.brief = r.status === 200 ? 'ok' : 'unavailable';
    } catch { /* named below by staying 'unavailable' */ }

    try {
      const q = await api.queue();
      if (q.status === 200) sections.openLoops = (q.body as { open: unknown[] }).open.length;
    } catch { /* stays 'unavailable' */ }

    try {
      const s = await api.storm();
      if (s.status === 200) {
        sections.storm = (s.body as { alerts: unknown[] }).alerts.length > 0 ? 'alerts' : 'clear';
      }
    } catch { /* stays 'unavailable' */ }

    try {
      const f = await api.forecast(now);
      if (f.status === 200) sections.comingDue = (f.body as { due: unknown[] }).due.length;
    } catch { /* stays 'unavailable' */ }

    const summary =
      `brief=${sections.brief} loops=${sections.openLoops} storm=${sections.storm} due=${sections.comingDue} llm=${llm}`;
    await emitSafe('owner_briefing.written', { summary }, 'owner-briefing-agent');
    await run.finish({ status: 'ok', outputSummary: summary });
    return { agent: 'owner-briefing', sections, llm, status: 'ok' };
  } catch (err) {
    await run.finish({ status: 'error', outputSummary: err instanceof Error ? err.message : 'error' });
    return { agent: 'owner-briefing', sections, llm, status: 'error' };
  }
}
