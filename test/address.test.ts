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
import { normalizeAddress, resolveServiceCity, isServiceCity, extractZip, parseAddress, isWorkableCity, serviceCityForZip } from '../src/lib/address.js';

describe('address normalization (§7, §12 — no double twins)', () => {
  it('collapses equivalent spellings to the same key', () => {
    const a = normalizeAddress('123 Oak Street');
    const b = normalizeAddress('123 oak st.');
    const c = normalizeAddress('  123   Oak   ST  ');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('standardizes directions and unit designators', () => {
    expect(normalizeAddress('45 North Main Avenue Apt 2')).toBe('45 n main ave unit 2');
    expect(normalizeAddress('45 N Main Ave #2')).toBe('45 n main ave unit 2');
  });

  it('distinguishes genuinely different addresses', () => {
    expect(normalizeAddress('123 Oak St')).not.toBe(normalizeAddress('125 Oak St'));
  });
});

describe('service area (§2 — four cities, Suffolk excluded)', () => {
  it('resolves the four served cities case-insensitively', () => {
    expect(resolveServiceCity('virginia beach')).toBe('Virginia Beach');
    expect(resolveServiceCity('NORFOLK')).toBe('Norfolk');
    expect(resolveServiceCity('Chesapeake')).toBe('Chesapeake');
    expect(resolveServiceCity('portsmouth')).toBe('Portsmouth');
  });

  it('rejects Suffolk and anywhere else', () => {
    expect(isServiceCity('Suffolk')).toBe(false);
    expect(resolveServiceCity('Suffolk')).toBeNull();
    expect(isServiceCity('Richmond')).toBe(false);
  });
});

describe('zip + parse', () => {
  it('extracts a 5-digit zip', () => {
    expect(extractZip('123 Oak St, Norfolk, VA 23508')).toBe('23508');
    expect(extractZip('123 Oak St, Norfolk VA 23508-1234')).toBe('23508');
    expect(extractZip('no zip here')).toBeNull();
  });

  it('parses city from the string when no hint is given', () => {
    const p = parseAddress('123 Oak St, Chesapeake, VA 23320');
    expect(p.city).toBe('Chesapeake');
    expect(p.zip).toBe('23320');
    expect(p.inServiceArea).toBe(true);
  });

  it('flags an out-of-area address', () => {
    const p = parseAddress('9 Elm St, Suffolk, VA 23434');
    expect(p.inServiceArea).toBe(false);
    expect(p.city).toBeNull();
  });
});

describe('off-focus cities (owner ruling 2026-08-02) — workable, not advertised', () => {
  it('Suffolk parses as off-focus, not as nowhere', () => {
    const p = parseAddress('123 Main St, Suffolk, VA 23434');
    expect(p.offFocusCity).toBe('Suffolk');
    // Still not a CORE service city: it has no permit ruleset behind it.
    expect(p.inServiceArea).toBe(false);
    expect(p.city).toBeNull();
  });

  it('is workable even though it is not a service city', () => {
    expect(isWorkableCity('Suffolk')).toBe(true);
    expect(isServiceCity('Suffolk')).toBe(false);
    expect(isWorkableCity('Richmond')).toBe(false);
  });

  it('a core city is unaffected and still carries its ruleset', () => {
    const p = parseAddress('123 Main St, Norfolk, VA 23501');
    expect(p.city).toBe('Norfolk');
    expect(p.inServiceArea).toBe(true);
    expect(p.offFocusCity).toBeNull();
  });

  it('a genuinely unserved city is still neither', () => {
    const p = parseAddress('1 Broad St, Richmond, VA 23219');
    expect(p.city).toBeNull();
    expect(p.offFocusCity).toBeNull();
  });

  it('a Suffolk ZIP still does not resolve to a core city', () => {
    // serviceCityForZip drives permit-bearing decisions; Suffolk must never
    // resolve there or it would inherit another city's rules.
    expect(serviceCityForZip('23434')).toBeNull();
  });
});
