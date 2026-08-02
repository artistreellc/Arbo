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
