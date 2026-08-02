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
