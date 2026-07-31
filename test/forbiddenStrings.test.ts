import { describe, it, expect } from 'vitest';
import { scanForbidden, scanGuardrailsCustomerFacing } from '../src/lint/forbiddenStrings.js';
import { loadGuardrails } from '../src/config/loadConfig.js';

describe('forbidden-string guard (§12)', () => {
  it('catches Suffolk in customer-facing copy', () => {
    const hits = scanForbidden('We proudly serve Suffolk and beyond!');
    expect(hits.map((h) => h.term)).toContain('Suffolk');
  });

  it('catches a TCIA credential claim', () => {
    const hits = scanForbidden('We are TCIA accredited and licensed.');
    expect(hits.map((h) => h.term)).toContain('TCIA');
  });

  it('is case-insensitive and word-bounded', () => {
    expect(scanForbidden('suffolk')).toHaveLength(1);
    // "Norfolk" contains "folk" but not the word "Suffolk" — must not match.
    expect(scanForbidden('Norfolk')).toHaveLength(0);
  });

  it('passes the real guardrails config (internal policy mentions are exempt)', () => {
    // Internal rule text legitimately names TCIA/Suffolk as things to avoid;
    // only the strings the AI actually says are scanned.
    expect(scanGuardrailsCustomerFacing(loadGuardrails())).toEqual([]);
  });

  it('still catches a violation smuggled into customer-facing copy', () => {
    const bad = loadGuardrails();
    // Simulate a mistake: an approved line (spoken to the customer) mentions Suffolk.
    bad.serviceArea.outOfAreaPivot = 'We also cover Suffolk!';
    const hits = scanGuardrailsCustomerFacing(bad);
    expect(hits.map((h) => h.term)).toContain('Suffolk');
  });
});
