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
// Agent #4 — Permitting & Site Intelligence (brief §8A.5). An event consumer
// on the binder: it watches lead.created events and makes sure no property
// slips through without a §6B screen on file. Deterministic core; the Opus
// judgment layer (packet drafting, correspondence triage) reports honestly as
// not-configured until the ANTHROPIC_API_KEY lands (§1B — never bluff).
//
// Hard boundary (§8A.5 #4): vocabulary is PERMIT LIKELY / REVIEW NEEDED /
// NO OVERLAY — VERIFY. This agent can never say "you're clear" (§6B.3, §12) —
// structurally: it only ever REPORTS missing screens; it never writes one.

import { consumeNew, emitSafe, type BusEvent } from '../binder/eventBus.js';
import { startAgentRun } from '../binder/agentRun.js';
import { getDb } from '../db/client.js';
import { env } from '../env.js';

export interface PermittingSweepResult {
  agent: 'permitting';
  eventsProcessed: number;
  screensMissing: number; // properties with leads but no permit row — flagged, never cleared
  flaggedPropertyIds: string[];
  llm: 'not_configured' | 'available';
  status: 'ok' | 'error';
}

/** Properties referenced by recent leads that have NO permit screen on file. */
async function propertiesMissingScreens(sinceIso: string): Promise<string[]> {
  const db = getDb();
  const leads = await db
    .from('lead')
    .select('property_id')
    .not('property_id', 'is', null)
    .gte('created_at', sinceIso);
  if (leads.error) throw leads.error;
  const ids = [...new Set((leads.data ?? []).map((r) => r.property_id as string))];
  if (ids.length === 0) return [];
  const screened = await db.from('permit').select('property_id').in('property_id', ids);
  if (screened.error) throw screened.error;
  const has = new Set((screened.data ?? []).map((r) => r.property_id as string));
  return ids.filter((id) => !has.has(id));
}

/**
 * One sweep: consume new lead.created events (cursor 'permitting-agent'),
 * then check the whole recent window for screen gaps — the event stream
 * triggers the run, but the CHECK is absence-based (§1E posture): a lead
 * whose event was lost still gets caught by the window scan.
 */
export async function runPermittingAgent(now = new Date()): Promise<PermittingSweepResult> {
  const run = await startAgentRun({ agent: 'permitting', modelUsed: env.anthropic.apiKey ? 'claude-opus-5' : undefined });
  const llm = env.anthropic.apiKey ? 'available' as const : 'not_configured' as const;
  try {
    let processed = 0;
    await consumeNew('permitting-agent', async (_e: BusEvent) => {
      processed++;
    });

    const since = new Date(now.getTime() - 14 * 86400_000).toISOString();
    const missing = await propertiesMissingScreens(since);
    // Dedupe against the bus: a property already flagged (and still missing a
    // screen) is not re-flagged every sweep — consumers act once per gap.
    const already = new Set<string>();
    if (missing.length > 0) {
      const prior = await getDb()
        .from('event')
        .select('payload')
        .eq('type', 'permit.flagged')
        .gte('emitted_at', new Date(now.getTime() - 30 * 86400_000).toISOString());
      if (!prior.error) {
        for (const r of prior.data ?? []) {
          const pid = (r.payload as { propertyId?: string }).propertyId;
          if (pid) already.add(pid);
        }
      }
    }
    const fresh = missing.filter((id) => !already.has(id));
    for (const propertyId of fresh) {
      await emitSafe('permit.flagged', { propertyId, reason: 'no_screen_on_file' }, 'permitting-agent');
    }

    await run.finish({
      status: 'ok',
      outputSummary: `events=${processed} screens_missing=${missing.length} newly_flagged=${fresh.length} llm=${llm}`,
    });
    return {
      agent: 'permitting', eventsProcessed: processed, screensMissing: missing.length,
      flaggedPropertyIds: missing, llm, status: 'ok',
    };
  } catch (err) {
    await run.finish({ status: 'error', outputSummary: err instanceof Error ? err.message : 'error' });
    return { agent: 'permitting', eventsProcessed: 0, screensMissing: 0, flaggedPropertyIds: [], llm, status: 'error' };
  }
}
