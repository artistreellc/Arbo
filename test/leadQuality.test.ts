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
import { scoreLead } from '../src/reception/leadQuality.js';

describe('lead-quality read (§3.14) — a quiet hint, never dismissive', () => {
  it('rates a specific, in-area, storm/hazard lead as hot', () => {
    const r = scoreLead({
      urgency: 'storm',
      scopeClarity: 'specific',
      inServiceArea: true,
      tightZipCluster: true,
      gaveAddress: true,
      agreedToTime: true,
    });
    expect(r.priority).toBe('hot');
  });

  it('rates a vague, price-only, isolated lead as cool', () => {
    const r = scoreLead({ scopeClarity: 'vague', priceOnlyPressure: true, inServiceArea: false });
    expect(r.priority).toBe('cool');
  });

  it('NEVER down-ranks a lead for getting multiple quotes (§3.14)', () => {
    const base = { scopeClarity: 'specific' as const, inServiceArea: true, gaveAddress: true };
    const without = scoreLead(base);
    const withQuotes = scoreLead({ ...base, mentionedOtherQuotes: true });
    // shopping around must NOT change the score
    expect(withQuotes.score).toBe(without.score);
    expect(withQuotes.priority).toBe(without.priority);
    expect(withQuotes.reasons.join(' ')).toMatch(/neutral/i);
  });

  it('is only a hint — a warm middle exists between hot and cool', () => {
    const r = scoreLead({ inServiceArea: true, scopeClarity: 'specific' });
    expect(['hot', 'warm', 'cool']).toContain(r.priority);
    expect(r.priority).toBe('warm');
  });
});
