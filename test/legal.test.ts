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
import { loadLegal } from '../src/config/loadConfig.js';

describe('legal / compliance config (§4)', () => {
  const l = loadLegal();

  it('requires consent for automated outbound', () => {
    expect(l.tcpa.consentRequired).toBe(true);
    expect(l.tcpa.businessIdentityInFirstMessage).toBe('Art-is-Tree');
  });

  it('enforces STOP opt-out honored permanently and system-wide', () => {
    expect(l.tcpa.optOut.keyword).toBe('STOP');
    expect(l.tcpa.optOut.suppressionListRespectedSystemWide).toBe(true);
    expect(l.tcpa.optOut.honor.toLowerCase()).toContain('permanent');
  });

  it('sets quiet hours to 8:00 AM – 9:00 PM local', () => {
    expect(l.tcpa.quietHours.earliestHour).toBe(8);
    expect(l.tcpa.quietHours.latestHour).toBe(21);
    expect(l.tcpa.quietHours.timezone).toBe('America/New_York');
  });

  it('requires an AI/recording disclosure at call start', () => {
    expect(l.callRecordingAndAiDisclosure.disclosureRequiredAtCallStart).toBe(true);
    expect(l.callRecordingAndAiDisclosure.disclosureLine.length).toBeGreaterThan(0);
  });

  it('mandates PII encryption and no customer data in logs', () => {
    expect(l.dataPrivacy.encryptAtRest).toBe(true);
    expect(l.dataPrivacy.encryptInTransit).toBe(true);
    expect(l.dataPrivacy.noCustomerDataInLogs).toBe(true);
  });

  it('outbound gate includes consent, quiet-hours, and suppression checks', () => {
    for (const check of ['consent', 'quietHours', 'notSuppressed']) {
      expect(l.outboundGate.checks).toContain(check);
    }
  });
});
