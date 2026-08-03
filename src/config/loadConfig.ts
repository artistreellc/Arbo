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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { GuardrailsSchema, type Guardrails } from './guardrails.schema.js';
import { LegalSchema, type LegalConfig } from './legal.schema.js';

const here = dirname(fileURLToPath(import.meta.url));

function loadJson(relPathFromSrc: string): unknown {
  const abs = resolve(here, '..', relPathFromSrc);
  return JSON.parse(readFileSync(abs, 'utf8'));
}

/**
 * Load and validate the guardrail policy (§3). Throws with a readable message
 * if the config drifts from the spec — the single source of truth must be valid
 * before anything else runs.
 */
export function loadGuardrails(): Guardrails {
  const parsed = GuardrailsSchema.safeParse(loadJson('policy/guardrails.json'));
  if (!parsed.success) {
    throw new Error(`Invalid guardrails.json:\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

/** Load and validate the legal/compliance config (§4). */
export function loadLegal(): LegalConfig {
  const parsed = LegalSchema.safeParse(loadJson('legal/compliance.json'));
  if (!parsed.success) {
    throw new Error(`Invalid compliance.json:\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

function formatIssues(err: import('zod').ZodError): string {
  return err.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}

/** Load both configs together — used at boot. */
export function loadAllConfig(): { guardrails: Guardrails; legal: LegalConfig } {
  return { guardrails: loadGuardrails(), legal: loadLegal() };
}
