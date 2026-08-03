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
import {
  answerBasicQuestion, lookupTerm, isDiagnosisQuestion, isArboristLevelQuestion,
  TREE_TERMS, KNOWLEDGE_BASE, DIAGNOSIS_PIVOT, ARBORIST_DEFLECTION,
} from '../src/reception/knowledgeBase.js';

// Mike drew this scope in three passes: basic, NOT certified-arborist
// questions, and it must know basic tree-care terms. The cases below are the
// pairs that sit one word apart — those are the only hard part.

describe('basic tree-care terms — vocabulary, not advice', () => {
  it('defines a term when asked what it means', () => {
    for (const q of ['What is crown reduction?', 'What does deadwooding mean?', "What's a hanger?"]) {
      expect(answerBasicQuestion(q).source).toBe('term_definition');
    }
  });

  it('defines an arborist term but never RECOMMENDS it', () => {
    // Defining "cabling" is vocabulary. Advising it on their tree is not.
    expect(answerBasicQuestion('What is cabling?').source).toBe('term_definition');
    expect(answerBasicQuestion('Should I cable my tree?').answered).toBe(false);
  });

  it('prefers the longer term — "crown reduction" beats a bare "crown"', () => {
    expect(lookupTerm('tell me about crown reduction')!.term).toBe('crown reduction');
  });
});

describe('the two boundaries', () => {
  it('answers general education but never diagnoses THEIR tree', () => {
    expect(answerBasicQuestion('Is topping bad for a tree?').answered).toBe(true);
    for (const q of ['Is my tree dead?', 'Do you think that oak is going to fall?', 'Is it safe?']) {
      const r = answerBasicQuestion(q);
      expect(r.source).toBe('diagnosis_pivot');
      expect(r.answer).toBe(DIAGNOSIS_PIVOT);
      expect(r.answered).toBe(false);
    }
  });

  it('deflects certified-arborist territory (Mike: not arborist questions)', () => {
    for (const q of [
      'What kind of fungus is on the trunk?',
      'What species is it?',
      'Can you treat it for borers?',
      'Do you do a risk assessment?',
    ]) {
      const r = answerBasicQuestion(q);
      expect(r.answered).toBe(false);
      expect([ARBORIST_DEFLECTION, DIAGNOSIS_PIVOT]).toContain(r.answer);
    }
  });

  it('a diagnosis beats everything, even when it names a known term', () => {
    // "Should I top my dying tree" contains a sanctioned topic AND is a
    // diagnosis. The diagnosis check runs first and wins.
    expect(answerBasicQuestion('Should I top my dying tree?').source).toBe('diagnosis_pivot');
  });

  it.each([
    'Should I top my dying tree?',
    'Is that dead pine going to fall?',
    'Is my big oak safe?',
    'Do you do a risk assessment?',
    'Is there decay in the trunk?',
  ])('catches what the FIRST version leaked on: %o', (q) => {
    // Two real bugs, both found by running it rather than by the tests:
    // an adjective ("my DYING tree") walked straight past the possessive
    // check, and "risk assess" with a trailing word-boundary never matched
    // "risk assessMENT". Regression-locked.
    expect(answerBasicQuestion(q).answered).toBe(false);
  });

  it('never guesses when it has no vetted answer (§1B/§1.4)', () => {
    const r = answerBasicQuestion('What is the airspeed velocity of a swallow?');
    expect(r.source).toBe('no_match');
    expect(r.answered).toBe(false);
    expect(r.answer).toContain('Mike');
  });
});

describe('the content stays basic', () => {
  it('carries no price and no dollar figure anywhere', () => {
    const all = [...Object.values(TREE_TERMS), ...KNOWLEDGE_BASE.map((e) => e.answer)].join(' ');
    expect(all).not.toMatch(/\$|\bcost(s)? (?:about|around)\b|\bprice\b/i);
  });

  it('stays small enough to read in one sitting — Mike said basic', () => {
    expect(KNOWLEDGE_BASE.length).toBeLessThanOrEqual(12);
    expect(Object.keys(TREE_TERMS).length).toBeLessThanOrEqual(30);
  });

  it('every answer is short enough to say out loud', () => {
    for (const e of KNOWLEDGE_BASE) {
      expect(e.answer.split(/[.!?]+\s/).filter(Boolean).length, e.answer).toBeLessThanOrEqual(3);
    }
  });

  it('exposes the detectors so the receptionist can route before answering', () => {
    expect(isDiagnosisQuestion('is my tree dying')).toBe(true);
    expect(isDiagnosisQuestion('why is topping bad')).toBe(false);
    expect(isArboristLevelQuestion('what species is this')).toBe(true);
    expect(isArboristLevelQuestion('when should I prune')).toBe(false);
  });
});
