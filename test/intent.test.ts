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
import { detectIntent } from '../src/reception/intent.js';
import { loadGuardrails } from '../src/config/loadConfig.js';

const g = loadGuardrails();
const intentOf = (t: string) => detectIntent(t, g).intent;

describe('caller-intent classification (§3.7–3.9, §3.26)', () => {
  it('flags an injury as a high-priority incident', () => {
    const r = detectIntent('your crew left and now someone got hurt in my yard', g);
    expect(r.intent).toBe('incident');
    expect(r.incidentType).toBe('injury');
    expect(r.highPriority).toBe(true);
  });

  it('flags crew property damage as an incident', () => {
    const r = detectIntent('your guys ran over my sprinkler heads and broke my fence', g);
    expect(r.intent).toBe('incident');
    expect(r.incidentType).toBe('damage');
  });

  it('flags a genuinely angry caller as an incident', () => {
    expect(detectIntent('this is unacceptable, I am furious with how this went', g).incidentType).toBe('angry');
  });

  it('recognizes a caller who wants a human/Mike', () => {
    expect(intentOf("I don't want to talk to a robot, is Mike there?")).toBe('wants_human');
    expect(intentOf('can I talk to a person please')).toBe('wants_human');
  });

  it('screens an obvious solicitation as spam', () => {
    expect(intentOf('Hi, I can get you on the first page of Google with our SEO services')).toBe('spam');
    expect(intentOf('this is a courtesy call about your extended warranty')).toBe('spam');
  });

  it('NEVER treats a real customer as spam, even with a marketing-ish word', () => {
    // Mentions "marketing" but is clearly a tree job → must NOT be spam (§3.26 bias).
    expect(intentOf('I saw your marketing and I need an estimate to remove two trees in my yard')).toBe('normal');
    expect(intentOf('a tree fell and I need help')).not.toBe('spam');
  });

  it('still catches a tree emergency through the same classifier', () => {
    expect(intentOf('a tree just fell on my house')).toBe('emergency');
  });

  it('treats an ordinary inquiry as a normal lead', () => {
    expect(intentOf('I would like a quote to trim my oak tree')).toBe('normal');
  });
});
