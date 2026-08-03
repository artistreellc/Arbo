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
import { capture, nextQuestion, isComplete, powerLineRedFlag, toQualificationJson, type QualState } from '../src/reception/qualification.js';

describe('lead qualification (§3.3)', () => {
  it('asks for the next missing required field in order', () => {
    let s: QualState = {};
    expect(nextQuestion(s)).toMatch(/name/i);
    s = capture(s, 'name', 'Jane Homeowner');
    expect(nextQuestion(s)).toMatch(/address/i);
  });

  it('resolves the served city from the address', () => {
    const s = capture({}, 'address', '742 Evergreen Terrace, Virginia Beach, VA 23451');
    expect(s.city).toBe('Virginia Beach');
  });

  it('is complete only when all required fields are captured', () => {
    let s: QualState = {};
    for (const [k, v] of [
      ['name', 'Jane'],
      ['address', '10 Birch Ln, Norfolk, VA 23505'],
      ['phone', '757-555-0100'],
      ['jobType', 'removal'],
      ['treeInfo', 'large oak'],
      ['proximityStructure', 'about 15 feet from the house'],
      ['proximityPowerLines', 'right next to the power line'],
    ] as const) {
      expect(isComplete(s)).toBe(false);
      s = capture(s, k, v);
    }
    expect(isComplete(s)).toBe(true);
  });

  it('flags the power-line red flag', () => {
    const near = capture({}, 'proximityPowerLines', 'it is right under the power line');
    expect(powerLineRedFlag(near)).toBe(true);
    const far = capture({}, 'proximityPowerLines', 'no power lines anywhere near it');
    expect(powerLineRedFlag(far)).toBe(false);
  });

  it('builds a clean qualification payload', () => {
    let s: QualState = {};
    s = capture(s, 'treeInfo', 'tall pine');
    s = capture(s, 'jobType', 'removal');
    s = capture(s, 'proximityPowerLines', 'close to the lines');
    s = capture(s, 'hadWorkBefore', 'yes we have');
    const json = toQualificationJson(s);
    expect(json.treeInfo).toBe('tall pine');
    expect(json.powerLineRedFlag).toBe(true);
    expect(json.hadWorkBefore).toBe(true);
  });
});
