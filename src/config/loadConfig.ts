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
