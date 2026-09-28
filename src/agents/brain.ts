/*
  SLOW::ARBO — see src/agents/sweep.ts for the full marker.
*/
// The "Opus brain" for the eight section agents — R25 (Mike, 2026-09-28:
// "Make the 8 agents ... and the opus brain"). R5: Opus is the brain
// (claude-opus-5; never downgraded for cost).
//
// It does ONE thing: turn an AgentReport into a short plain-English summary
// for Mike. It reads and writes text; it acts on nothing and calls no agent.
//
// What the model sees is states, counts and our OWN finding lines — never an
// input's raw detail (that can carry an outside error string) and never a
// customer (§4.3: counts and ids only). What it says passes guardReply() and
// the permit-vocabulary check before anyone sees it; a blocked line falls
// back to the deterministic summary with the reason named.
//
// No key → no model: the deterministic summary, labelled "brain offline —
// deterministic summary". Tests never hand it a real client.

import Anthropic from '@anthropic-ai/sdk';
import type { Guardrails } from '../config/guardrails.schema.js';
import { loadGuardrails } from '../config/loadConfig.js';
import { guardReply } from '../reception/outputGuard.js';
import { FORBIDDEN_CLEAR } from '../permitting/screening.js';
import { redact } from '../ops/inboxWatch.js';
import { env } from '../env.js';
import type { AgentReport } from './sections.js';

export const BRAIN_MODEL = 'claude-opus-5';
export const BRAIN_OFFLINE = 'brain offline — deterministic summary';
const MAX_CHARS = 800;

/** The one call the brain makes. The SDK sits behind this so tests can fake it. */
export interface BrainTextClient {
  complete(system: string, user: string): Promise<string>;
}

export interface BrainSummary {
  agentId: string;
  text: string;
  source: 'opus' | 'deterministic';
  /** Why the deterministic text was used, when it was. */
  note?: string;
}

export interface Brain {
  online: boolean;
  summarize(report: AgentReport): Promise<BrainSummary>;
}

const SYSTEM = [
  "You write a two-to-three sentence status summary of one section of a tree-service company's operations app, for the owner.",
  'Use only the facts given. If an input is "cut" or "unreadable", say so plainly — never treat it as zero or as "nothing there".',
  'No prices or dollar amounts, no tree diagnoses, no promised dates, no names.',
  'Never say a property is clear of permits; permit words are PERMIT LIKELY, REVIEW NEEDED, NO OVERLAY–VERIFY.',
  'Proposals wait for the owner; never suggest that the app send, buy, or change anything itself. Plain text, no markdown.',
].join(' ');

const count = <T>(xs: T[], pred: (x: T) => boolean) => xs.filter(pred).length;

/** The summary with no model: states and counts, built from the report alone. */
export function deterministicSummary(r: AgentReport): string {
  const notRead = r.inputs.filter((i) => i.state !== 'read').map((i) => `${i.name} (${i.state})`);
  const parts = [
    `${r.name} (${r.section}) — ${r.status}.`,
    `Inputs: ${count(r.inputs, (i) => i.state === 'read')} read, ${count(r.inputs, (i) => i.state === 'cut')} cut, ${count(r.inputs, (i) => i.state === 'unreadable')} unreadable${notRead.length ? ` — ${notRead.join('; ')}` : ''}.`,
    `Findings: ${count(r.findings, (f) => f.severity === 'act')} to act on, ${count(r.findings, (f) => f.severity === 'watch')} to watch.`,
    `${r.proposals.length} proposal(s) waiting for Mike.`,
  ];
  if (r.error) parts.push(`Blocked: ${r.error}`);
  return parts.join(' ');
}

/** What the model is shown: no input detail, no refs, scrubbed once more. */
function brainFacts(r: AgentReport): string {
  return redact(JSON.stringify({
    agent: r.name,
    section: r.section,
    status: r.status,
    inputs: r.inputs.map((i) => ({ name: i.name, state: i.state })),
    findings: r.findings.map((f) => ({ severity: f.severity, text: f.text })),
    proposals: r.proposals.map((p) => p.text),
    blocked: Boolean(r.error),
  }));
}

/**
 * Build the brain. With a client it asks Opus; without one it is offline and
 * says so. `guardrails` is injectable for tests; it defaults to the shipped file.
 */
export function createBrain(client?: BrainTextClient | null, guardrails: () => Guardrails = loadGuardrails): Brain {
  const fallback = (r: AgentReport, why: string): BrainSummary =>
    ({ agentId: r.agentId, text: `${why}: ${deterministicSummary(r)}`, source: 'deterministic', note: why });

  return {
    online: Boolean(client),
    async summarize(r) {
      if (!client) return fallback(r, BRAIN_OFFLINE);
      let raw: string;
      try {
        raw = (await client.complete(SYSTEM, brainFacts(r))).trim();
      } catch (err) {
        // Error class only — never the message, which could echo input (§4.3).
        return fallback(r, `brain call failed (${err instanceof Error ? err.name : 'error'}) — deterministic summary`);
      }
      if (!raw) return fallback(r, 'brain returned nothing — deterministic summary');
      const guard = guardReply(raw, guardrails());
      if (!guard.safe) {
        return fallback(r, `brain line blocked by guard (${guard.violations.map((v) => v.rule).join(',')}) — deterministic summary`);
      }
      if (FORBIDDEN_CLEAR.test(raw)) return fallback(r, 'brain line used clearance language — deterministic summary');
      if (redact(raw) !== raw) return fallback(r, 'brain line carried a customer-shaped string — deterministic summary');
      return { agentId: r.agentId, text: raw.slice(0, MAX_CHARS), source: 'opus' };
    },
  };
}

/** The SDK behind BrainTextClient — same call shape as the intent classifier. */
export function anthropicBrainClient(apiKey: string): BrainTextClient {
  const client = new Anthropic({ apiKey });
  return {
    async complete(system, user) {
      const response = await client.messages.create({
        model: BRAIN_MODEL,
        max_tokens: 300,
        system,
        messages: [{ role: 'user', content: user }],
      });
      return response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
    },
  };
}

/** The live brain: Opus when ANTHROPIC_API_KEY is set, offline otherwise. */
export function createLiveBrain(apiKey: string | undefined = env.anthropic.apiKey): Brain {
  return createBrain(apiKey ? anthropicBrainClient(apiKey) : null);
}
