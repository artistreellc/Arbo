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
import { detectEmergency } from '../src/reception/emergency.js';

describe('emergency detection (§3.4)', () => {
  const emergencies = [
    'A tree just fell on my house!',
    "There's a tree on my car in the driveway",
    'A big limb came down on the garage',
    'a branch is tangled in the power line',
    'the power line is down across my yard',
    'someone is trapped under a fallen branch',
    'a tree is blocking my driveway completely',
    'This is an emergency, can someone come now?',
  ];
  for (const t of emergencies) {
    it(`flags: "${t}"`, () => {
      expect(detectEmergency(t).isEmergency).toBe(true);
    });
  }

  const routine = [
    "I'd like a quote to trim the oak near my house",
    'I want to remove a big tree in the backyard',
    'Can I get an estimate for stump grinding?',
    'The tree is leaning a bit, want it looked at',
    'Just some cleanup after a storm last month',
  ];
  for (const t of routine) {
    it(`does not flag: "${t}"`, () => {
      expect(detectEmergency(t).isEmergency).toBe(false);
    });
  }
});
