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
import { loadAllConfig } from './config/loadConfig.js';
import { scanGuardrailsCustomerFacing, scanLegalCustomerFacing } from './lint/forbiddenStrings.js';
import { integrationStatus, env } from './env.js';

/**
 * ARBOR boot. Phase 0 responsibility: prove the app starts, load and validate
 * the single-source-of-truth policy + legal configs, run the forbidden-string
 * guard, and report which integrations are configured (booleans only — never
 * print secret values, §4.3).
 *
 * Returns a summary so tests can assert on it without spawning a process.
 */
export function boot(): {
  ok: boolean;
  appName: string;
  guardrailsVersion: string;
  legalVersion: string;
  integrations: Record<string, boolean>;
} {
  const { guardrails, legal } = loadAllConfig();

  // Customer-facing copy must never contain forbidden terms (Suffolk / TCIA).
  const hits = [...scanGuardrailsCustomerFacing(guardrails), ...scanLegalCustomerFacing(legal)];
  if (hits.length > 0) {
    throw new Error(
      `Forbidden term(s) in customer-facing copy: ${hits.map((h) => `${h.term} @ ${h.where}`).join(', ')}`,
    );
  }

  return {
    ok: true,
    appName: env.appName,
    guardrailsVersion: guardrails.version,
    legalVersion: legal.version,
    integrations: integrationStatus(),
  };
}

// Run when invoked directly (npm run boot).
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const summary = boot();
    console.log(`✅ ${summary.appName} booted.`);
    console.log(`   guardrails v${summary.guardrailsVersion} · legal v${summary.legalVersion}`);
    console.log('   integrations configured:');
    for (const [name, ready] of Object.entries(summary.integrations)) {
      console.log(`     ${ready ? '●' : '○'} ${name}`);
    }
    const anyMissing = Object.values(summary.integrations).some((v) => !v);
    if (anyMissing) console.log('   (○ = not yet configured — expected in early phases)');
  } catch (err) {
    console.error('❌ Boot failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
