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
// Agent run audit log (brief §7 #26, §8A.6g) — every agent decision is a row.
// Degrades gracefully (§1B): with no DB the recorder is a no-op and the agent
// still runs; the absence of audit rows is itself visible in the admin surface.

import { canWrite, getDb, hasDb } from '../db/client.js';
import { noteNotSaved } from '../db/notSaved.js';
import type { PolicyBlock } from './policyEngine.js';
import type { ToolCallRecord } from './toolRegistry.js';

export interface AgentRunHandle {
  id: string | null;
  /** False when the run was NOT written to agent_run because Arbo is read-only (R-READONLY). */
  saved?: boolean;
  finish(params: {
    status: 'ok' | 'error' | 'blocked';
    outputSummary?: string;
    toolsCalled?: ToolCallRecord[];
    policyBlocks?: PolicyBlock[];
    costUsd?: number;
  }): Promise<void>;
}

export async function startAgentRun(params: {
  agent: string;
  triggerEventId?: string;
  modelUsed?: string;
  promptVersion?: string;
}): Promise<AgentRunHandle> {
  const startedMs = Date.now();
  if (!hasDb()) {
    return { id: null, finish: async () => {} };
  }
  // R-READONLY: the agent still runs its sweep (R4 — sweeps are read-only by
  // rule); only its run log is not written. It is NAMED, never silent: each
  // skipped row is counted, and the finished run is kept in memory so the
  // app shows what ran (marked "not saved") instead of freezing on old rows.
  if (!canWrite()) {
    noteNotSaved('agent_run');
    return {
      id: null,
      saved: false,
      async finish(p) {
        rememberUnsavedRun({
          agent: params.agent,
          status: p.status,
          output_summary: p.outputSummary ?? null,
          duration_ms: Date.now() - startedMs,
          started_at: new Date(startedMs).toISOString(),
          finished_at: new Date().toISOString(),
        });
      },
    };
  }
  const { data, error } = await getDb()
    .from('agent_run')
    .insert({
      agent: params.agent,
      trigger_event: params.triggerEventId ?? null,
      model_used: params.modelUsed ?? null,
      prompt_version: params.promptVersion ?? null,
    })
    .select('id')
    .single();
  const id = error ? null : (data?.id as string);

  return {
    id,
    async finish(p) {
      if (!id) return;
      const res = await getDb()
        .from('agent_run')
        .update({
          status: p.status,
          output_summary: p.outputSummary ?? null,
          tools_called: p.toolsCalled ?? [],
          policy_blocks: p.policyBlocks ?? [],
          cost_usd: p.costUsd ?? null,
          duration_ms: Date.now() - startedMs,
          finished_at: new Date().toISOString(),
        })
        .eq('id', id);
      // A dropped finish leaves the row stuck 'running' forever and the admin
      // surface shows a phantom hung agent — say so (no PII in the message).
      if (res.error) console.error(`[agents] agent_run finish failed for ${params.agent}: ${res.error.message}`);
    },
  };
}

/**
 * A run Arbo did not save (read-only), shaped like an agent_run row so the
 * same screens read it — plus `saved: false`, which they show. Memory only:
 * capped, newest first, gone on a redeploy (and the app says so).
 */
export interface UnsavedAgentRun {
  id: null;
  agent: string;
  status: 'ok' | 'error' | 'blocked';
  output_summary: string | null;
  duration_ms: number;
  started_at: string;
  finished_at: string;
  saved: false;
}

const UNSAVED_CAP = 50;
const unsaved: UnsavedAgentRun[] = [];

function rememberUnsavedRun(r: Omit<UnsavedAgentRun, 'id' | 'saved'>): void {
  unsaved.unshift({ id: null, ...r, saved: false });
  if (unsaved.length > UNSAVED_CAP) unsaved.length = UNSAVED_CAP;
}

/** The newest runs that were not saved (read-only), newest first. */
export function unsavedAgentRuns(limit = 20): UnsavedAgentRun[] {
  return unsaved.slice(0, Math.max(0, limit));
}

/** Tests only. */
export function resetUnsavedAgentRuns(): void {
  unsaved.length = 0;
}
