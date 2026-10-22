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
// No key → no model: the deterministic summary. The Agents page says once,
// above the desks, that AI summaries are off, so the offline line carries no
// label of its own; a failed or blocked AI line keeps its label ("AI read
// failed — plain count") so it never passes for the AI's read (D87). Tests
// never hand it a real client.

import Anthropic from '@anthropic-ai/sdk';
import type { Guardrails } from '../config/guardrails.schema.js';
import { loadGuardrails } from '../config/loadConfig.js';
import { guardReply } from '../reception/outputGuard.js';
import { FORBIDDEN_CLEAR } from '../permitting/screening.js';
import { findBannedEs } from '../i18n/banList.js';
import { redact } from '../ops/inboxWatch.js';
import { env } from '../env.js';
import { RULEBOOK_INPUTS, type AgentReport } from './sections.js';

export const BRAIN_MODEL = 'claude-opus-5';
export const BRAIN_OFFLINE = 'AI off — plain count';
const BRAIN_FAILED = 'AI read failed — plain count';
const BRAIN_BLOCKED = 'AI line blocked — plain count';
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
  'Use only the facts given. If an input is "cut", "sim", "notrun", "notbuilt" or "unreadable", say so plainly — never treat it as zero or as "nothing there".',
  'No prices or dollar amounts, no tree diagnoses, no promised dates, no names.',
  'Never say a property is clear of permits; permit words are PERMIT LIKELY, REVIEW NEEDED, NO OVERLAY–VERIFY.',
  'Proposals wait for the owner; never suggest that the app send, buy, or change anything itself. Plain text, no markdown.',
].join(' ');

const count = <T>(xs: T[], pred: (x: T) => boolean) => xs.filter(pred).length;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The summary with no model, in plain words for Mike. The card already shows
 * the desk's name and status, and each input row below it names what it
 * could not see and why — so this counts them and does not repeat them.
 * §1B: what it could not see comes first, and a desk that read no business
 * data (a rulebook loading is not a look at the business) never prints a
 * count of zero as if it had looked.
 */
export function deterministicSummary(r: AgentReport): string {
  const missing = r.inputs.filter((i) => i.state !== 'read');
  const readN = r.inputs.filter((i) => i.state === 'read' && !RULEBOOK_INPUTS.has(i.name)).length;
  const act = count(r.findings, (f) => f.severity === 'act');
  const watch = count(r.findings, (f) => f.severity === 'watch');
  const parts: string[] = [];
  if (missing.length) parts.push(`Could not see ${missing.length} of ${plural(r.inputs.length, 'input')} (named below).`);
  if (readN === 0 && r.findings.length === 0) parts.push('No business data could be read, so zero findings here does not mean nothing is wrong.');
  else if (missing.length) parts.push(`From what it could see: ${act} to act on, ${watch} to watch — not the whole picture.`);
  else parts.push(`Read everything it needs: ${act} to act on, ${watch} to watch.`);
  // "from this run" keeps these apart from the Learn desk's lessons.
  parts.push(`${plural(r.proposals.length, 'proposal')} from this run for you to decide.`);
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
  // `label` is what Mike reads in front of the plain count (null = none: the
  // page already says AI is off); `why` is the exact reason, kept on `note`
  // for whoever has to debug it.
  const fallback = (r: AgentReport, label: string | null, why: string): BrainSummary => {
    const summary = deterministicSummary(r);
    return { agentId: r.agentId, text: label ? `${label}. ${summary}` : summary, source: 'deterministic', note: why };
  };

  return {
    online: Boolean(client),
    async summarize(r) {
      if (!client) return fallback(r, null, BRAIN_OFFLINE);
      let raw: string;
      try {
        raw = (await client.complete(SYSTEM, brainFacts(r))).trim();
      } catch (err) {
        // Error class only — never the message, which could echo input (§4.3).
        return fallback(r, BRAIN_FAILED, `brain call failed (${err instanceof Error ? err.name : 'error'}) — deterministic summary`);
      }
      if (!raw) return fallback(r, BRAIN_FAILED, 'brain returned nothing — deterministic summary');
      const guard = guardReply(raw, guardrails());
      if (!guard.safe) {
        return fallback(r, BRAIN_BLOCKED, `brain line blocked by guard (${guard.violations.map((v) => v.rule).join(',')}) — deterministic summary`);
      }
      if (FORBIDDEN_CLEAR.test(raw)) return fallback(r, BRAIN_BLOCKED, 'brain line used clearance language — deterministic summary');
      // R27 (D110): banned in Spanish as in English (src/i18n/banList.ts). The note names the category, never the line.
      const es = findBannedEs(raw)[0];
      if (es) return fallback(r, BRAIN_BLOCKED, `brain line used a phrase banned in Spanish (${es.category}) — deterministic summary`);
      if (redact(raw) !== raw) return fallback(r, BRAIN_BLOCKED, 'brain line carried a customer-shaped string — deterministic summary');
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
