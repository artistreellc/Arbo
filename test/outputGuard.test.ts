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
import { guardReply } from '../src/reception/outputGuard.js';
import { loadGuardrails } from '../src/config/loadConfig.js';

const g = loadGuardrails();
const noPriceLine = g.goldenRules.find((r) => r.id === 'no-price')!.approvedLine;
const noDxLine = g.goldenRules.find((r) => r.id === 'no-diagnosis')!.approvedLine;

describe('output guard — never quotes a price (§3.1)', () => {
  const priceyReplies = [
    "It'll run about $500 for that removal.",
    'Probably around 800 for a tree that size.',
    'Roughly 1200 dollars, give or take.',
    "That's a 2k job at least.",
    'I can give you a ballpark of two grand.',
    'Our price range for removals is wide.',
    "It's 300 bucks.",
  ];
  for (const reply of priceyReplies) {
    it(`blocks: "${reply}"`, () => {
      const r = guardReply(reply, g);
      expect(r.safe).toBe(false);
      expect(r.violations.some((v) => v.rule === 'no-price')).toBe(true);
      expect(r.reply).toBe(noPriceLine); // substituted with the approved pivot
    });
  }

  it('the approved no-price line itself passes the guard (no pivot loop)', () => {
    expect(guardReply(noPriceLine, g).safe).toBe(true);
  });
});

describe('output guard — never diagnoses (§3.1)', () => {
  const dxReplies = [
    'Your tree is definitely dead and needs to come down.',
    "That tree is dangerous, it's going to fall.",
    'It sounds like your tree is diseased.',
    'That one has to be removed for sure.',
  ];
  for (const reply of dxReplies) {
    it(`blocks: "${reply}"`, () => {
      const r = guardReply(reply, g);
      expect(r.safe).toBe(false);
      expect(r.reply).toBe(noDxLine);
    });
  }
});

describe('output guard — never leaks Suffolk / TCIA (§2, §12)', () => {
  it('blocks a Suffolk mention', () => {
    const r = guardReply('Yes, we serve Suffolk too!', g);
    expect(r.safe).toBe(false);
    expect(r.violations.some((v) => v.rule === 'forbidden-term')).toBe(true);
  });
  it('blocks a TCIA claim', () => {
    const r = guardReply('We are TCIA certified.', g);
    expect(r.safe).toBe(false);
  });
});

describe('output guard — lets safe replies through untouched', () => {
  const safe = [
    'Thanks for calling Art-is-Tree, this is the front desk. How can I help with your trees?',
    'I can get you on the schedule for a free estimate.',
    'What kind of tree is it, and roughly how big?',
    'How close is it to the house or any power lines?',
    'You can reach us at (757) 319-5131 any time.',
    "We're fully licensed and insured, and BBB A+ rated.",
  ];
  for (const reply of safe) {
    it(`passes: "${reply.slice(0, 40)}…"`, () => {
      const r = guardReply(reply, g);
      expect(r.safe).toBe(true);
      expect(r.reply).toBe(reply);
    });
  }
});
