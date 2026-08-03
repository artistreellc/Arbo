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
import { findOpenLoops, defaultLoopConfig, type LoopSnapshot } from '../src/ops/loopCloser.js';

const NOW = '2026-08-10T12:00:00Z';

function snapshot(partial: Partial<LoopSnapshot>): LoopSnapshot {
  return { nowIso: NOW, estimates: [], jobs: [], leads: [], ...partial };
}

describe('Loop-Closer (§1E) — silence is never success', () => {
  it('flags an estimate visited days ago with no outcome', () => {
    const open = findOpenLoops(snapshot({
      estimates: [{
        id: 'e1', propertyId: 'p1', scheduledIso: null,
        visitedAtIso: '2026-08-05T15:00:00Z', outcome: 'pending', outcomeAtIso: null,
        hasJobForProperty: false,
      }],
    }));
    expect(open).toHaveLength(1);
    expect(open[0]!.kind).toBe('estimate_went_quiet');
  });

  it('stays quiet about a fresh visit still inside the window', () => {
    const open = findOpenLoops(snapshot({
      estimates: [{
        id: 'e1', propertyId: 'p1', scheduledIso: null,
        visitedAtIso: '2026-08-10T09:00:00Z', outcome: 'pending', outcomeAtIso: null,
        hasJobForProperty: false,
      }],
    }));
    expect(open).toHaveLength(0);
  });

  it('a WON estimate with no job is urgent — the win is dying quietly', () => {
    const open = findOpenLoops(snapshot({
      estimates: [{
        id: 'e2', propertyId: 'p2', scheduledIso: null,
        visitedAtIso: '2026-08-01T15:00:00Z', outcome: 'won',
        outcomeAtIso: '2026-08-06T15:00:00Z', hasJobForProperty: false,
      }],
    }));
    expect(open).toHaveLength(1);
    expect(open[0]!.kind).toBe('won_but_never_booked');
    expect(open[0]!.severity).toBe('urgent');
  });

  it('a won estimate WITH a booked job closes the loop — no flag', () => {
    const open = findOpenLoops(snapshot({
      estimates: [{
        id: 'e2', propertyId: 'p2', scheduledIso: null,
        visitedAtIso: '2026-08-01T15:00:00Z', outcome: 'won',
        outcomeAtIso: '2026-08-06T15:00:00Z', hasJobForProperty: true,
      }],
    }));
    expect(open).toHaveLength(0);
  });

  it('flags a job whose scheduled day passed while status stayed booked', () => {
    const open = findOpenLoops(snapshot({
      jobs: [{ id: 'j1', scheduledIso: '2026-08-08T13:00:00Z', status: 'booked' }],
    }));
    expect(open).toHaveLength(1);
    expect(open[0]!.kind).toBe('job_never_closed');
  });

  it('completed and in-progress jobs are not open loops', () => {
    const open = findOpenLoops(snapshot({
      jobs: [
        { id: 'j2', scheduledIso: '2026-08-01T13:00:00Z', status: 'completed' },
        { id: 'j3', scheduledIso: '2026-08-09T13:00:00Z', status: 'in_progress' },
      ],
    }));
    expect(open).toHaveLength(0);
  });

  it('an uncalled voicemail lead escalates to urgent after a day', () => {
    const open = findOpenLoops(snapshot({
      leads: [
        { id: 'l1', createdAtIso: '2026-08-10T06:00:00Z', status: 'new', needsCallback: true },
        { id: 'l2', createdAtIso: '2026-08-08T06:00:00Z', status: 'new', needsCallback: true },
      ],
    }));
    expect(open).toHaveLength(2);
    const byId = new Map(open.map((o) => [o.refId, o]));
    expect(byId.get('l1')!.severity).toBe('attention');
    expect(byId.get('l2')!.severity).toBe('urgent');
  });

  it('a lead already qualified or without callback need stays quiet', () => {
    const open = findOpenLoops(snapshot({
      leads: [
        { id: 'l3', createdAtIso: '2026-08-01T06:00:00Z', status: 'qualified', needsCallback: true },
        { id: 'l4', createdAtIso: '2026-08-01T06:00:00Z', status: 'new', needsCallback: false },
      ],
    }));
    expect(open).toHaveLength(0);
  });

  it('orders worst-first: urgent above attention, older above newer', () => {
    const open = findOpenLoops(snapshot({
      estimates: [{
        id: 'e9', propertyId: 'p9', scheduledIso: null,
        visitedAtIso: '2026-08-05T15:00:00Z', outcome: 'pending', outcomeAtIso: null,
        hasJobForProperty: false,
      }],
      leads: [{ id: 'l9', createdAtIso: '2026-08-07T06:00:00Z', status: 'new', needsCallback: true }],
    }));
    expect(open[0]!.severity).toBe('urgent');
  });

  it('never invents a flag from missing timestamps', () => {
    const open = findOpenLoops(snapshot({
      estimates: [{
        id: 'e5', propertyId: null, scheduledIso: null, visitedAtIso: null,
        outcome: 'pending', outcomeAtIso: null, hasJobForProperty: false,
      }],
      jobs: [{ id: 'j5', scheduledIso: null, status: 'booked' }],
    }));
    expect(open).toHaveLength(0);
  });

  it('no dollar figures ever appear in a needs-decision line', () => {
    const open = findOpenLoops(snapshot({
      estimates: [{
        id: 'e2', propertyId: 'p2', scheduledIso: null,
        visitedAtIso: '2026-08-01T15:00:00Z', outcome: 'won',
        outcomeAtIso: '2026-08-06T15:00:00Z', hasJobForProperty: false,
      }],
    }), defaultLoopConfig);
    for (const item of open) expect(item.line).not.toMatch(/\$\s?\d/);
  });
});
