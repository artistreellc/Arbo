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
