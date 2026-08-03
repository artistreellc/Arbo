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
import {
  searchLibrary, toCrewFacing, isClauseCitation, sanitiseRefs, NO_LIMITS_WARNING,
  type ReferenceEntry,
} from '../src/reference/library.js';

const entry = (over: Partial<ReferenceEntry> = {}): ReferenceEntry => ({
  id: 'r1', techniqueName: 'Natural crotch rigging', skillLevel: 3,
  howTo: 'Run the line through a natural union and load it gradually.',
  pros: ['No hardware needed'], cons: ['Friction cooks the rope'],
  wontWorkWhen: 'The union is included bark, or the limb is dead.',
  sourceLink: null, standardRefs: ['Z133 §8.5'], published: true, ...over,
});

describe('§6U.3 — clause citations only, never standard text', () => {
  it('accepts a clause reference', () => {
    expect(isClauseCitation('Z133 §8.5')).toBe(true);
    expect(isClauseCitation('ANSI A300 §5.1')).toBe(true);
  });

  it('rejects reproduced standard prose', () => {
    expect(isClauseCitation('Z133 §8.5 states that all rigging shall be inspected before each use and removed from service when damaged')).toBe(false);
    expect(isClauseCitation('see the standard')).toBe(false);
  });

  it('strips non-citations and counts what it dropped', () => {
    const r = sanitiseRefs(['Z133 §8.5', 'The standard says you must always inspect rigging before each and every use']);
    expect(r.refs).toEqual(['Z133 §8.5']);
    expect(r.dropped).toBe(1);
  });

  it('a crew-facing entry never carries a stripped ref', () => {
    const c = toCrewFacing(entry({ standardRefs: ['Z133 §8.5', 'long reproduced paragraph of the actual standard text here'] }));
    expect(c.standardRefs).toEqual(['Z133 §8.5']);
  });
});

describe('§1B — a technique with no stated limits is INCOMPLETE, not universal', () => {
  it('warns loudly when no limits are recorded', () => {
    const c = toCrewFacing(entry({ wontWorkWhen: null }));
    expect(c.limitsWarning).toBe(NO_LIMITS_WARNING);
    expect(c.limitsWarning).toMatch(/does not mean it always works/i);
  });

  it('a blank-string limit counts as no limit', () => {
    expect(toCrewFacing(entry({ wontWorkWhen: '   ' })).limitsWarning).toBe(NO_LIMITS_WARNING);
  });

  it('stays quiet when the limits ARE recorded', () => {
    const c = toCrewFacing(entry());
    expect(c.limitsWarning).toBeNull();
    expect(c.wontWorkWhen).toMatch(/included bark/);
  });
});

describe('§4.7 — unpublished entries never reach a crew phone', () => {
  it('holds them back and counts them', () => {
    const r = searchLibrary([entry({ id: 'pub' }), entry({ id: 'draft', published: false })]);
    expect(r.entries.map((e) => e.id)).toEqual(['pub']);
    expect(r.unpublishedHeld).toBe(1);
  });
});

describe('search', () => {
  const all = [
    entry({ id: 'rig', techniqueName: 'Natural crotch rigging', skillLevel: 3 }),
    entry({ id: 'notch', techniqueName: 'Open face notch', skillLevel: 1, howTo: 'Two cuts meeting at 70 degrees.' }),
    entry({ id: 'block', techniqueName: 'Block and tackle lowering', skillLevel: 4, howTo: 'Rigging block at the base of the spar.' }),
  ];

  it('a name hit outranks a body mention', () => {
    const r = searchLibrary(all, { text: 'rigging' });
    expect(r.entries[0]!.id).toBe('rig'); // name match beats 'block' body match
  });

  it('is deterministic — two crew get the same answer', () => {
    expect(searchLibrary(all, { text: 'rigging' }).entries.map((e) => e.id))
      .toEqual(searchLibrary(all, { text: 'rigging' }).entries.map((e) => e.id));
  });

  it('easiest first when everything ties', () => {
    expect(searchLibrary(all).entries[0]!.skillLevel).toBe(1);
  });

  it('distinguishes "nothing matched" from "the library is empty" (§1B)', () => {
    expect(searchLibrary(all, { text: 'helicopter' }).noMatch).toBe(true);
    expect(searchLibrary([], { text: 'helicopter' }).noMatch).toBe(false);
  });

  it('says so when every word was too short to search on (§1B)', () => {
    // 2-letter tokens are dropped, so "an" leaves nothing to search with. The
    // result is the WHOLE library — and it has to be labelled as such, or the
    // crew reads "everything" as "everything that matched what I asked".
    const r = searchLibrary(all, { text: 'an' });
    expect(r.entries).toHaveLength(3);
    expect(r.queryTooShort).toBe(true);
    // A real search and a deliberate browse are both honest.
    expect(searchLibrary(all, { text: 'rigging' }).queryTooShort).toBe(false);
    expect(searchLibrary(all).queryTooShort).toBe(false);
    expect(searchLibrary(all, { text: '   ' }).queryTooShort).toBe(false);
  });

  it('flags an entry above the reader skill level without hiding it', () => {
    const r = searchLibrary(all, { text: 'block', readerSkillLevel: 2 });
    expect(r.entries[0]!.aboveSkillLevel).toBe(true);
    // Still readable — a groundie may need to understand what the climber is doing.
    expect(r.entries[0]!.howTo).toBeTruthy();
  });
});
