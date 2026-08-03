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
