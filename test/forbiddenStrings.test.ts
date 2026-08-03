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
