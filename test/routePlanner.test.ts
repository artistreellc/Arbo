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
import { planRoute } from '../src/ops/routePlanner.js';

// R16. The laws under test: 20-minute slots, the Saturday city split, the
// weekday after-4 start, nearest-neighbor actually reduces zig-zag, and the
// plan names its own limits instead of posing as a mapped route (§1B).

const S = (label: string, zip: string, city?: string) => ({ label, zip, ...(city ? { city } : {}) });

describe('planRoute — Saturday', () => {
  it('splits VB to the afternoon and the rest to the morning, in order', () => {
    const plan = planRoute({
      day: 'saturday',
      stops: [S('vb-1', '23451', 'Virginia Beach'), S('norf', '23503', 'Norfolk'), S('ches', '23320', 'Chesapeake'), S('vb-2', '23455', 'Virginia Beach')],
      startZip: '23320',
    });
    expect(plan.totalStops).toBe(4);
    const windows = plan.visits.map((v) => v.window);
    expect(windows.slice(0, 2)).toEqual(['morning', 'morning']);
    expect(windows.slice(2)).toEqual(['afternoon', 'afternoon']);
    expect(plan.visits[0]!.startTime).toBe('08:00');
    expect(plan.visits[2]!.startTime).toBe('12:00'); // VB never before noon
  });

  it('gives every stop its 20 minutes and honest drive gaps', () => {
    const plan = planRoute({ day: 'saturday', stops: [S('a', '23503', 'Norfolk'), S('b', '23505', 'Norfolk')], startZip: null });
    expect(plan.visits[0]!.endTime).toBe('08:20');
    expect(plan.visits[1]!.startTime).toBe('08:35'); // 15-min same-prefix gap
    expect(plan.visits[1]!.endTime).toBe('08:55');
  });

  it('nearest-neighbor keeps same-ZIP stops together', () => {
    const plan = planRoute({
      day: 'saturday',
      stops: [S('far', '23503', 'Norfolk'), S('near-1', '23320', 'Chesapeake'), S('near-2', '23320', 'Chesapeake')],
      startZip: '23320',
    });
    expect(plan.visits.map((v) => v.label)).toEqual(['near-1', 'near-2', 'far']);
  });

  it('warns when the morning spills past noon instead of pretending it fits', () => {
    const stops = Array.from({ length: 9 }, (_, i) => S(`n-${i}`, '23503', 'Norfolk'));
    const plan = planRoute({ day: 'saturday', stops, startZip: null });
    expect(plan.warnings.some((w) => w.includes('past noon'))).toBe(true);
  });
});

describe('planRoute — weekday', () => {
  it('starts after 4 and warns past 8pm', () => {
    const plan = planRoute({ day: 'weekday', stops: [S('a', '23451', 'Virginia Beach')], startZip: '23452' });
    expect(plan.visits[0]!.startTime).toBe('16:00');
    expect(plan.visits[0]!.window).toBe('after_work');
    const big = planRoute({ day: 'weekday', stops: Array.from({ length: 9 }, (_, i) => S(`s${i}`, '23451')), startZip: null });
    expect(big.warnings.some((w) => w.includes('past 8pm'))).toBe(true);
  });
});

describe('planRoute — honesty', () => {
  it('the plan names its own limits, and an empty plan says so', () => {
    const plan = planRoute({ day: 'weekday', stops: [] });
    expect(plan.visits).toEqual([]);
    expect(plan.warnings).toContain('No stops to plan.');
    expect(plan.note).toContain('Not a mapped route');
  });
});
