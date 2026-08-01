import { describe, it, expect } from 'vitest';
import { loadGuardrails } from '../src/config/loadConfig.js';

describe('guardrails policy (§3)', () => {
  const g = loadGuardrails();

  it('loads and validates against the schema', () => {
    expect(g.version).toBeTruthy();
    expect(g.business.name).toBe('Art-is-Tree');
  });

  it('serves exactly the four cities and excludes Suffolk', () => {
    expect(g.serviceArea.cities.sort()).toEqual(
      ['Chesapeake', 'Norfolk', 'Portsmouth', 'Virginia Beach'].sort(),
    );
    expect(g.serviceArea.cities).toHaveLength(4);
    expect(g.serviceArea.excludedCities).toContain('Suffolk');
  });

  it('only allows real credentials and forbids TCIA', () => {
    expect(g.credentials.allowedClaims).toContain('licensed and insured');
    expect(g.credentials.allowedClaims).toContain('BBB A+');
    expect(g.credentials.forbiddenClaims.some((c) => c.includes('TCIA'))).toBe(true);
  });

  it('has all five golden rules with approved pivot lines', () => {
    const ids = g.goldenRules.map((r) => r.id);
    for (const id of ['no-price', 'no-diagnosis', 'no-date-guarantee', 'credential-accuracy', 'on-topic']) {
      expect(ids).toContain(id);
    }
    for (const r of g.goldenRules) expect(r.approvedLine.length).toBeGreaterThan(0);
  });

  it("no-price rule's approved line quotes no dollar amount", () => {
    const noPrice = g.goldenRules.find((r) => r.id === 'no-price')!;
    expect(noPrice.approvedLine).not.toMatch(/\$\s?\d/);
    expect(noPrice.approvedLine.toLowerCase()).toContain('free estimate');
  });

  it("no-price forbiddenPatterns actually catch price-shaped text", () => {
    const noPrice = g.goldenRules.find((r) => r.id === 'no-price')!;
    const patterns = (noPrice.forbiddenPatterns ?? []).map((p) => new RegExp(p, 'i'));
    const priceyLines = ['it will be $500', 'roughly 800 dollars', 'a ballpark of two grand', 'the price range is wide'];
    for (const line of priceyLines) {
      expect(patterns.some((re) => re.test(line))).toBe(true);
    }
  });

  it('flags power lines as a red flag and confirms service area', () => {
    expect(g.leadQualification.powerLineIsRedFlag).toBe(true);
    expect(g.leadQualification.confirmInServiceArea).toBe(true);
  });

  it('never quotes emergency pricing', () => {
    expect(g.emergency.neverQuoteEmergencyPricing).toBe(true);
    expect(g.emergency.triggers.length).toBeGreaterThan(0);
  });
});
