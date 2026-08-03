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
import tokens from '../src/design/tokens.js';

describe('design tokens (§9)', () => {
  it('meets the glove-friendly minimum touch target (48px)', () => {
    expect(tokens.touchTarget.min).toBeGreaterThanOrEqual(48);
  });

  it('exposes a coherent type scale', () => {
    expect(tokens.typography.size.base).toBeGreaterThanOrEqual(16); // readable outdoors
    expect(tokens.typography.size['4xl']).toBeGreaterThan(tokens.typography.size.base);
  });

  it('uses valid hex colors including an emergency status color', () => {
    const hex = /^#[0-9A-Fa-f]{6}$/;
    expect(tokens.color.brand.forest).toMatch(hex);
    expect(tokens.color.status.emergency).toMatch(hex);
  });

  it('provides a 4px-based spacing scale and radii', () => {
    expect(tokens.spacing[4]).toBe(16);
    expect(tokens.radius.pill).toBeGreaterThan(tokens.radius.lg);
  });
});
