/*
  ═══════════════════════════════════════════════════════════════════════
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
*/
import { describe, it, expect } from 'vitest';
import { inspectMessage, inspectToolCall, withinQuietHoursSafe } from '../src/binder/policyEngine.js';
import { ToolRegistry } from '../src/binder/toolRegistry.js';
import { loadAllConfig } from '../src/config/loadConfig.js';

const { guardrails } = loadAllConfig();

const consented = { consented: true, optedOut: false };
const noon = '2026-08-03T16:00:00Z'; // 12:00 ET in August (EDT)
const twoAm = '2026-08-03T06:00:00Z'; // 2:00 ET

describe('policy engine (§8A.6d) — the ONE deterministic wall', () => {
  it('passes a clean customer message through untouched', () => {
    const v = inspectMessage({
      audience: 'customer', channel: 'sms', guardrails,
      text: 'Happy to get you on the schedule for a free estimate.',
      contact: consented, atIso: noon,
    });
    expect(v.allowed).toBe(true);
    expect(v.safeText).toContain('free estimate');
  });

  it('blocks a dollar amount and substitutes the approved pivot', () => {
    const v = inspectMessage({
      audience: 'customer', channel: 'sms', guardrails,
      text: 'That job usually runs about $1,200.',
      contact: consented, atIso: noon,
    });
    expect(v.allowed).toBe(false);
    expect(v.blocks.some((b) => b.rule === 'no-price')).toBe(true);
    expect(v.safeText).not.toMatch(/\$\s?\d/);
  });

  it('blocks a diagnosis claim', () => {
    const v = inspectMessage({
      audience: 'customer', channel: 'sms', guardrails,
      text: 'Your tree is dead and needs to come down.',
      contact: consented, atIso: noon,
    });
    expect(v.allowed).toBe(false);
    expect(v.blocks.some((b) => b.rule === 'no-diagnosis')).toBe(true);
  });

  it('blocks a hard date promise — and the pivot NEVER echoes the promise', () => {
    const v = inspectMessage({
      audience: 'customer', channel: 'sms', guardrails,
      text: "I've booked you in for Friday morning.",
      contact: consented, atIso: noon,
    });
    expect(v.allowed).toBe(false);
    expect(v.blocks.some((b) => b.rule === 'no-date-promise')).toBe(true);
    // The review-caught bypass: safeText must be a pivot, not the violation.
    expect(v.safeText).toBeDefined();
    expect(v.safeText).not.toContain('Friday');
    expect(v.safeText).not.toMatch(/booked you in/i);
  });

  it('TCPA: no consent = nothing goes out, not even a pivot line', () => {
    const v = inspectMessage({
      audience: 'customer', channel: 'sms', guardrails,
      text: 'Just checking in about your trees!',
      contact: { consented: false, optedOut: false }, atIso: noon,
    });
    expect(v.allowed).toBe(false);
    expect(v.blocks.some((b) => b.rule === 'tcpa-consent')).toBe(true);
    expect(v.safeText).toBeUndefined();
  });

  it('TCPA: STOP is permanent', () => {
    const v = inspectMessage({
      audience: 'customer', channel: 'sms', guardrails,
      text: 'One more thing about the estimate…',
      contact: { consented: true, optedOut: true }, atIso: noon,
    });
    expect(v.allowed).toBe(false);
    expect(v.blocks.some((b) => b.rule === 'tcpa-stop')).toBe(true);
  });

  it('quiet hours: a 2am outbound is blocked outright', () => {
    const v = inspectMessage({
      audience: 'customer', channel: 'sms', guardrails,
      text: 'Free estimate this week?',
      contact: consented, atIso: twoAm,
    });
    expect(v.allowed).toBe(false);
    expect(v.blocks.some((b) => b.rule === 'quiet-hours')).toBe(true);
  });

  it('inbound replies are exempt from TCPA gates but not content rules', () => {
    const ok = inspectMessage({
      audience: 'customer', channel: 'sms', guardrails,
      text: 'Thanks for reaching out — happy to help with the oak.',
      inboundReply: true, atIso: twoAm,
    });
    expect(ok.allowed).toBe(true);
    const bad = inspectMessage({
      audience: 'customer', channel: 'sms', guardrails,
      text: 'Roughly $800 for that.',
      inboundReply: true, atIso: twoAm,
    });
    expect(bad.allowed).toBe(false);
  });

  it('admin-data wall: pricing internals never reach crew or customer text', () => {
    for (const audience of ['customer', 'crew'] as const) {
      const v = inspectMessage({
        audience, channel: 'app', guardrails,
        text: 'FYI the margin on this one is thin.',
        contact: consented, atIso: noon,
      });
      expect(v.allowed).toBe(false);
      expect(v.blocks.some((b) => b.rule === 'admin-data-wall')).toBe(true);
    }
  });

  it('admin/internal audiences pass untouched — Mike sees everything', () => {
    const v = inspectMessage({
      audience: 'admin', channel: 'app', guardrails,
      text: 'Margin $340, effective rate $612/hr, leakage load applied.',
    });
    expect(v.allowed).toBe(true);
  });

  it('quiet-hours boundary math holds at the edges', () => {
    expect(withinQuietHoursSafe('2026-08-03T12:00:00Z')).toBe(true);  // 8:00 ET
    expect(withinQuietHoursSafe('2026-08-03T11:59:00Z')).toBe(false); // 7:59 ET
    expect(withinQuietHoursSafe('2026-08-04T00:59:00Z')).toBe(true);  // 8:59pm ET
    expect(withinQuietHoursSafe('2026-08-04T01:00:00Z')).toBe(false); // 9:00pm ET
  });
});

describe('tool registry (§8A.6c/§8A.7/§8A.8)', () => {
  it('agents can read and write, but money/legal tiers are human-only law', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'list_leads', description: 'read leads', permission: 'read', handler: async () => [1, 2] });
    reg.register({ name: 'send_invoice', description: 'money', permission: 'money', handler: async () => 'sent' });

    await expect(reg.invoke('list_leads', {}, 'agent')).resolves.toEqual([1, 2]);
    await expect(reg.invoke('send_invoice', {}, 'agent')).rejects.toThrow(/policy blocked/);
    await expect(reg.invoke('send_invoice', {}, 'human')).resolves.toBe('sent');
    expect(reg.policyBlocks.some((b) => b.rule === 'agent-cannot-commit')).toBe(true);
  });

  it('unknown tools are hard errors, never fallbacks', async () => {
    const reg = new ToolRegistry();
    await expect(reg.invoke('made_up_tool', {}, 'agent')).rejects.toThrow(/unknown tool/);
  });

  it('every call is recorded for the agent_run audit trail', async () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'ok', description: '', permission: 'read', handler: async () => 1 });
    reg.register({ name: 'boom', description: '', permission: 'read', handler: async () => { throw new Error('x'); } });
    await reg.invoke('ok', {}, 'agent');
    await expect(reg.invoke('boom', {}, 'agent')).rejects.toThrow();
    expect(reg.calls).toHaveLength(2);
    expect(reg.calls[0]!.ok).toBe(true);
    expect(reg.calls[1]!.ok).toBe(false);
  });

  it('structural gate holds for every agent regardless of tool name', () => {
    const gate = inspectToolCall({ tool: 'sign_contract', permission: 'legal', actor: 'agent' });
    expect(gate.allowed).toBe(false);
  });
});
