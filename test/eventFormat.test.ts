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
import { buildEventTitle, buildEventDescription, normalizeSourceTag, tenDigitPhone, SOURCE_TAGS } from '../src/scheduling/eventFormat.js';

describe('calendar event formatting (§3.22 — looks exactly like Mike types)', () => {
  it('builds the observed title format: Name SOURCE 10-digit-phone (space-separated, D34)', () => {
    // Matches the live calendar ("Peter Simmons TT 7578193493"), not the
    // brief's hyphenated draft.
    expect(buildEventTitle({ name: 'Kathy Arnett', source: 'WEB', phone: '757-427-3361' })).toBe(
      'Kathy Arnett WEB 7574273361',
    );
  });

  it('normalizes channels to Mike’s real source tags', () => {
    expect(normalizeSourceTag('website')).toBe('WEB');
    expect(normalizeSourceTag('Google Ads')).toBe('GG');
    expect(normalizeSourceTag('local services')).toBe('LSA');
    expect(normalizeSourceTag('referral')).toBe('REFERAL');
    expect(normalizeSourceTag('LSA')).toBe('LSA');
    expect(SOURCE_TAGS).toContain(normalizeSourceTag('anything unknown'));
  });

  it('extracts a clean 10-digit phone', () => {
    expect(tenDigitPhone('+1 (757) 427-3361')).toBe('7574273361');
    expect(tenDigitPhone('757.427.3361')).toBe('7574273361');
    expect(tenDigitPhone('12345')).toBeNull();
  });

  it('puts scope/access detail in the description, never the title', () => {
    const desc = buildEventDescription({
      serviceType: 'removal',
      treeInfo: 'two oaks in the back near the fence',
      access: 'can a truck get to the back?',
      urgency: 'before I sell',
    });
    expect(desc).toContain('Service: removal');
    expect(desc).toContain('Access: can a truck get to the back?');
    // title stays clean
    expect(buildEventTitle({ name: 'Joe', source: 'WEB', phone: '7574273361' })).not.toContain('removal');
  });
});
