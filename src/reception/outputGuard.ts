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
