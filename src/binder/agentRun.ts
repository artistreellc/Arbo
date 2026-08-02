// Agent run audit log (brief §7 #26, §8A.6g) — every agent decision is a row.
// Degrades gracefully (§1B): with no DB the recorder is a no-op and the agent
// still runs; the absence of audit rows is itself visible in the admin surface.

import { getDb, hasDb } from '../db/client.js';
import type { PolicyBlock } from './policyEngine.js';
import type { ToolCallRecord } from './toolRegistry.js';

export interface AgentRunHandle {
  id: string | null;
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
      await getDb()
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
    },
  };
}
