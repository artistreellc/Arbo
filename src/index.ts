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
