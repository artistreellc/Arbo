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
  deadAirStep, DEAD_AIR_MAX_GREETINGS, DEAD_AIR_TIMEOUT_MS,
  checkCaptureFloor, missOnCallEnd, notifyTier,
  screenFinancialCommitment, FINANCIAL_DEFERRAL,
} from '../src/reception/judgment.js';

// docs/VA_TRAINING_BRIEF.md. The cases below are the ones the brief says cost
// Art-is-Tree money when they go wrong, not the happy paths.

describe('the dead-air test (§2.2) — filter AFTER answering, never before', () => {
  it('greets up to three times before considering a hang-up', () => {
    expect(deadAirStep({ greetings: 0, elapsedMs: 0, heardVoice: false }))
      .toEqual({ action: 'greet', greetingNumber: 1 });
    expect(deadAirStep({ greetings: 2, elapsedMs: 5000, heardVoice: false }))
      .toEqual({ action: 'greet', greetingNumber: 3 });
  });

  it('hangs up ONLY after three greetings AND the full ten seconds', () => {
    const r = deadAirStep({ greetings: 3, elapsedMs: DEAD_AIR_TIMEOUT_MS, heardVoice: false });
    expect(r).toMatchObject({ action: 'hang_up', logAs: 'dead_air' });
  });

  it('waits rather than hanging up when three greetings land inside four seconds', () => {
    // The brief's margin is TIME, not greeting count. An auto-dialer needs the
    // window; a hesitant caller needs the seconds. Hanging up here would drop
    // a real person who simply had not spoken yet.
    expect(deadAirStep({ greetings: 3, elapsedMs: 4000, heardVoice: false }))
      .toEqual({ action: 'wait' });
  });

  it('a caller who speaks AT ANY POINT is live — the timer can never cut them off', () => {
    // "including a slow, elderly, or hesitant caller — those are customers."
    const past = deadAirStep({ greetings: 9, elapsedMs: 60_000, heardVoice: true });
    expect(past).toEqual({ action: 'handle_as_live' });
  });

  it('never returns an action that refuses a call before answering it', () => {
    const actions = new Set<string>();
    for (const g of [0, 1, 2, 3, 4]) {
      for (const ms of [0, 5000, 9999, 10_000, 30_000]) {
        for (const heard of [true, false]) {
          actions.add(deadAirStep({ greetings: g, elapsedMs: ms, heardVoice: heard }).action);
        }
      }
    }
    // 'decline', 'voicemail', 'screen' must not exist as outcomes at all.
    expect([...actions].sort()).toEqual(['greet', 'handle_as_live', 'hang_up', 'wait']);
  });

  it('exposes the brief\'s exact thresholds', () => {
    expect(DEAD_AIR_MAX_GREETINGS).toBe(3);
    expect(DEAD_AIR_TIMEOUT_MS).toBe(10_000);
  });
});

describe('the capture floor (Part 4) — a miss is logged, never silent', () => {
  const full = { name: 'Test Caller', phone: '757-555-0101', address: '1 Test St', city: 'Norfolk' };

  it('is met with name, callable number and a bookable address', () => {
    expect(checkCaptureFloor(full).met).toBe(true);
    expect(missOnCallEnd(full)).toBeNull();
  });

  it('a street with NO city is not bookable — "never dispatch Mike to a street name"', () => {
    const r = checkCaptureFloor({ ...full, city: undefined });
    expect(r.met).toBe(false);
    expect(r.addressNotBookable).toBe(true);
    expect(missOnCallEnd({ ...full, city: undefined })!.line).toContain('not bookable');
  });

  it('rejects a number nobody could ring back', () => {
    expect(checkCaptureFloor({ ...full, phone: '555' }).met).toBe(false);
    expect(checkCaptureFloor({ ...full, phone: '17575550101' }).met).toBe(true);
  });

  it('names every missing part, so the log says what actually went wrong', () => {
    const r = missOnCallEnd({});
    expect(r!.missing).toEqual(['name', 'a callable number', 'a service address']);
  });

  it('a screened solicitation is NOT a miss (§3.2)', () => {
    // Counting it would corrupt the lead data §6O uses to judge marketing.
    expect(missOnCallEnd({}, { screenedAsSolicitation: true })).toBeNull();
  });
});

describe('the notify tier (Part 6) — what reaches Mike, and when', () => {
  it('interrupts him for a hazard to a person', () => {
    expect(notifyTier({ intent: 'normal', hazardToPerson: true }).tier).toBe('now');
  });

  it('interrupts him for an emergency, an injury, or damage', () => {
    expect(notifyTier({ intent: 'emergency' }).tier).toBe('now');
    expect(notifyTier({ intent: 'incident', incidentType: 'injury' }).tier).toBe('now');
    expect(notifyTier({ intent: 'incident', incidentType: 'damage' }).tier).toBe('now');
  });

  it('interrupts him when a caller is angry or asking for the owner (§3.9/§1.2)', () => {
    expect(notifyTier({ intent: 'incident', incidentType: 'angry' }).tier).toBe('now');
    expect(notifyTier({ intent: 'wants_human' }).tier).toBe('now');
  });

  it('batches money questions rather than interrupting', () => {
    const d = notifyTier({ intent: 'normal', needsMikesDecision: true });
    expect(d.tier).toBe('when_the_truck_stops');
    expect(d.borderline).toBe(false);
  });

  it('a solicitation is handled, logged, and never surfaced (§3.2)', () => {
    expect(notifyTier({ intent: 'spam' }).tier).toBe('never');
  });

  it('when unsure it defaults to the BATCH and marks it borderline — never silence', () => {
    // "Never the third tier — an unlogged judgment call is invisible, and
    // invisible is how leads die."
    const d = notifyTier({ intent: 'normal' });
    expect(d.tier).toBe('when_the_truck_stops');
    expect(d.borderline).toBe(true);
  });

  it('only a solicitation or an explicitly routine call can ever reach "never"', () => {
    const reachable = [
      notifyTier({ intent: 'normal' }),
      notifyTier({ intent: 'normal', needsMikesDecision: true }),
      notifyTier({ intent: 'emergency' }),
      notifyTier({ intent: 'incident', incidentType: 'angry' }),
    ];
    expect(reachable.every((d) => d.tier !== 'never')).toBe(true);
  });
});

describe('zero financial authority (§1.3) — the leak §3 does not cover', () => {
  it.each([
    ['I can knock some off for you', 'a discount'],
    ["we'll work with you on the number", 'matching or negotiating a figure'],
    ["we won't charge you for the haul", 'waiving a charge'],
    ["we'll throw that in", 'waiving a charge'],
    ["while we're out there we'll take the stump too", 'a scope add-on at the quoted figure'],
    ['yes, that was included', "accepting the customer's version of what was included"],
  ])('blocks %o', (line, what) => {
    const r = screenFinancialCommitment(line);
    expect(r.blocked).toBe(true);
    expect(r.what).toBe(what);
    expect(r.sayInstead).toBe(FINANCIAL_DEFERRAL);
  });

  it('the replacement line commits nothing and refuses nothing', () => {
    expect(FINANCIAL_DEFERRAL).toContain("Mike's call");
    expect(FINANCIAL_DEFERRAL).not.toMatch(/\$|\bno\b|cannot|can't/i);
  });

  it.each([
    'I can knock a hundred off if you book today.',
    "We'll throw the stump in for free.",
    "We'll take fifty off the removal.",
    'I can throw it in.',
  ])('catches the wording the FIRST version leaked on: %o', (line) => {
    // A live proof walked straight through v1 with these. The patterns only
    // matched the phrasings their own tests used. Regression-locked.
    expect(screenFinancialCommitment(line).blocked).toBe(true);
  });

  it.each([
    'Mike will be out between 3 and 4 to take a look.',
    'The crew will take the brush with them when they go.',
    'I can get you on the schedule for a free estimate.',
    'The estimate is free — Mike comes out and looks at no cost to you.',
    // OWNER RULING R8: payment plans are a real thing Art-is-Tree offers.
    // The VA brief forbids them; Mike overruled it. ARBO may say a plan is
    // possible — it still may not state the terms, which no-price blocks.
    'We can set you up on a payment plan — Mike will go over the details.',
    'We do offer payment plans.',
  ])('does not block ordinary speech: %o', (line) => {
    // "Free estimate" is a line the golden rules REQUIRE ARBO to say. A money
    // guard that blocks it would break the one pivot every price question uses.
    expect(screenFinancialCommitment(line).blocked).toBe(false);
  });

  it('lets an ordinary line through untouched', () => {
    const r = screenFinancialCommitment('Mike will be out between 3 and 4.');
    expect(r.blocked).toBe(false);
    expect(r.sayInstead).toBe('Mike will be out between 3 and 4.');
  });

  it('screens the ASSISTANT, not the caller — asking for a discount is normal', () => {
    // Only the assistant AGREEING is the failure. This function runs on the
    // outbound line, so a caller's question never trips it.
    expect(screenFinancialCommitment('Mike will take a look and price it up.').blocked).toBe(false);
  });
});
