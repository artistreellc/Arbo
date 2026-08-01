// The output guard — guardrails enforced as LAW in code, not just in the prompt
// (brief §3, §12). Every candidate reply the AI wants to speak is scanned here
// FIRST. If it would quote a price, diagnose a tree, or mention a forbidden term
// (Suffolk / TCIA), the guard blocks it and substitutes the approved pivot line.
// The LLM can be imperfect; this layer cannot be talked out of the rules.

import type { Guardrails } from '../config/guardrails.schema.js';
import { scanForbidden } from '../lint/forbiddenStrings.js';

export interface GuardViolation {
  rule: string; // golden-rule id or 'forbidden-term'
  matched: string; // the offending substring
}

export interface GuardResult {
  safe: boolean;
  violations: GuardViolation[];
  reply: string; // the reply to actually speak (original if safe, else a pivot)
}

function rulePatterns(g: Guardrails, id: string): RegExp[] {
  const rule = g.goldenRules.find((r) => r.id === id);
  return (rule?.forbiddenPatterns ?? []).map((p) => new RegExp(p, 'i'));
}

function approvedLine(g: Guardrails, id: string): string {
  return g.goldenRules.find((r) => r.id === id)?.approvedLine ?? '';
}

/**
 * Scan a candidate reply. Returns the safe reply to speak. Pivot priority:
 * price → diagnosis → forbidden term. A safe reply passes through untouched.
 */
export function guardReply(candidate: string, g: Guardrails): GuardResult {
  const violations: GuardViolation[] = [];

  const priceHit = firstMatch(candidate, rulePatterns(g, 'no-price'));
  if (priceHit) violations.push({ rule: 'no-price', matched: priceHit });

  const dxHit = firstMatch(candidate, rulePatterns(g, 'no-diagnosis'));
  if (dxHit) violations.push({ rule: 'no-diagnosis', matched: dxHit });

  for (const hit of scanForbidden(candidate, 'reply')) {
    violations.push({ rule: 'forbidden-term', matched: hit.term });
  }

  if (violations.length === 0) return { safe: true, violations, reply: candidate };

  // Choose the safe replacement by priority.
  let reply: string;
  if (violations.some((v) => v.rule === 'no-price')) reply = approvedLine(g, 'no-price');
  else if (violations.some((v) => v.rule === 'no-diagnosis')) reply = approvedLine(g, 'no-diagnosis');
  else reply = approvedLine(g, 'on-topic') || "Let's keep it to your trees — I can get you set up with a free estimate.";

  return { safe: false, violations, reply };
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}
