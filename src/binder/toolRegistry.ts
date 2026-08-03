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
// The tool registry (brief §8A.6c) — typed, permissioned functions agents may
// call. Every invocation is policy-gated and recorded; an unregistered tool is
// a hard error, not a fallback. Agents never touch repositories directly —
// this registry IS their hands.

import { inspectToolCall, type PolicyBlock, type ToolPermission } from './policyEngine.js';

export interface ToolSpec<In, Out> {
  name: string;
  description: string;
  permission: ToolPermission;
  handler: (input: In) => Promise<Out>;
}

export interface ToolCallRecord {
  tool: string;
  permission: ToolPermission;
  ok: boolean;
  blocked: boolean;
  durationMs: number;
  atIso: string;
}

export class ToolRegistry {
  private tools = new Map<string, ToolSpec<unknown, unknown>>();
  /** Every call made through this registry instance, for agent_run audit. */
  readonly calls: ToolCallRecord[] = [];
  readonly policyBlocks: PolicyBlock[] = [];

  register<In, Out>(spec: ToolSpec<In, Out>): void {
    if (this.tools.has(spec.name)) {
      throw new Error(`tool already registered: ${spec.name}`);
    }
    this.tools.set(spec.name, spec as ToolSpec<unknown, unknown>);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Invoke a tool as a given actor. Money/legal tiers are structurally
   * human-only (§8A.8). Throws on unknown tools and policy blocks — an agent
   * that wants a forbidden tool escalates to Mike, it does not improvise.
   */
  async invoke<Out = unknown>(name: string, input: unknown, actor: 'agent' | 'human'): Promise<Out> {
    const spec = this.tools.get(name);
    if (!spec) throw new Error(`unknown tool: ${name}`);

    const gate = inspectToolCall({ tool: name, permission: spec.permission, actor });
    const startedAt = Date.now();
    if (!gate.allowed) {
      this.policyBlocks.push(...gate.blocks);
      this.calls.push({
        tool: name, permission: spec.permission, ok: false, blocked: true,
        durationMs: 0, atIso: new Date().toISOString(),
      });
      throw new Error(`policy blocked tool ${name}: ${gate.blocks.map((b) => b.rule).join(',')}`);
    }

    try {
      const out = (await spec.handler(input)) as Out;
      this.calls.push({
        tool: name, permission: spec.permission, ok: true, blocked: false,
        durationMs: Date.now() - startedAt, atIso: new Date().toISOString(),
      });
      return out;
    } catch (err) {
      this.calls.push({
        tool: name, permission: spec.permission, ok: false, blocked: false,
        durationMs: Date.now() - startedAt, atIso: new Date().toISOString(),
      });
      throw err;
    }
  }
}
