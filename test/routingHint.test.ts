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
import { describe, it, expect, afterEach } from 'vitest';
import { extractVaZip, proximityHint, hintContextLine, setTodayWorkZip, getTodayWorkZip, setLocationEnabled, setLivePingZip, getLiveWorkZip, LIVE_ZIP_FRESH_MS } from '../src/reception/routingHint.js';

// R15. The two laws under test: the model only ever sees a conclusion, and
// not knowing where Mike is never renders as "he is nearby" (§1B).

afterEach(() => setTodayWorkZip(null));

describe('extractVaZip', () => {
  it('finds a Virginia ZIP in caller speech', () => {
    expect(extractVaZip('555 Main Street, Virginia Beach, Virginia 23451.')).toBe('23451');
    expect(extractVaZip('im at 23320 chesapeake')).toBe('23320');
  });
  it('does not invent one from phone numbers or nothing', () => {
    expect(extractVaZip('call me at 757-555-0142')).toBeNull();
    expect(extractVaZip('no zip here')).toBeNull();
  });
});

describe('proximityHint', () => {
  it('same ZIP as the work anchor is near_work; same prefix is nearby too', () => {
    expect(proximityHint('23452', { workZip: '23452', homeZip: null })).toBe('near_work');
    expect(proximityHint('23455', { workZip: '23452', homeZip: null })).toBe('near_work');
  });
  it('near home wins only when not near work', () => {
    expect(proximityHint('23451', { workZip: '23320', homeZip: '23451' })).toBe('near_home');
  });
  it('NO anchors → NO hint — unknown is never nearby (§1B)', () => {
    expect(proximityHint('23451', { workZip: null, homeZip: null })).toBeNull();
    expect(proximityHint('23666', { workZip: '23452', homeZip: '23451' })).toBeNull();
  });
});

describe('hintContextLine — the model sees a conclusion, never a location', () => {
  it('carries the offer and the never-say instruction, and NO zip', () => {
    for (const h of ['near_work', 'near_home'] as const) {
      const line = hintContextLine(h)!;
      expect(line).toContain('offer it with confidence');
      expect(line).toContain('NEVER tell the caller where Mike is');
      expect(line).not.toMatch(/23\d{3}/);
    }
  });
  it('null hint → null line', () => {
    expect(hintContextLine(null)).toBeNull();
  });
});

describe('today work ZIP store', () => {
  it('sets, reads, clears', () => {
    expect(getTodayWorkZip()).toBeNull();
    setTodayWorkZip('23452');
    expect(getTodayWorkZip()).toBe('23452');
    setTodayWorkZip(null);
    expect(getTodayWorkZip()).toBeNull();
  });
});

describe('live ping store — fresh, toggleable, never stale (R15/R16)', () => {
  it('a fresh ping is the anchor; a stale one says nothing about NOW', () => {
    setLocationEnabled(true);
    setLivePingZip('23452', 1_000_000);
    expect(getLiveWorkZip(1_000_000 + 10 * 60 * 1000)).toBe('23452');
    expect(getLiveWorkZip(1_000_000 + LIVE_ZIP_FRESH_MS + 1)).toBeNull();
  });
  it('toggle OFF drops the stored ping and refuses new ones', () => {
    setLocationEnabled(true);
    setLivePingZip('23452', 5_000_000);
    setLocationEnabled(false);
    expect(getLiveWorkZip(5_000_001)).toBeNull();
    setLivePingZip('23455', 5_000_002); // refused while off
    setLocationEnabled(true);
    expect(getLiveWorkZip(5_000_003)).toBeNull();
  });
});
