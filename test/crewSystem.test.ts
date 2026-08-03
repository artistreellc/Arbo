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
import { evaluateGate, requiredReadSeconds, buildAcknowledgment } from '../src/crew/briefingGate.js';
import { buildCrewPayload, sequenceRoute, type WorkOrderSource } from '../src/crew/workOrder.js';

const shortBrief = { id: 'b1', body: 'Watch the drop zone. Call the cut.', standardRefs: ['Z133 §8.1'] };
const longBrief = {
  id: 'b2',
  body: Array.from({ length: 120 }, () => 'word').join(' '),
  standardRefs: ['Z133 §5.1'],
};

describe('gated morning briefing (§6V.4) — a briefing can never be skipped', () => {
  it('stays locked until all three conditions are met', () => {
    const partial = evaluateGate(shortBrief, { scrolledToBottom: true, checkboxTicked: false, secondsOnScreen: 30 });
    expect(partial.unlocked).toBe(false);
    expect(partial.missing).toEqual(['checkbox']);

    const noScroll = evaluateGate(shortBrief, { scrolledToBottom: false, checkboxTicked: true, secondsOnScreen: 30 });
    expect(noScroll.missing).toEqual(['scroll']);

    const tooFast = evaluateGate(shortBrief, { scrolledToBottom: true, checkboxTicked: true, secondsOnScreen: 2 });
    expect(tooFast.missing).toEqual(['read_time']);
  });

  it('unlocks only when scroll + checkbox + read time all land', () => {
    const v = evaluateGate(shortBrief, { scrolledToBottom: true, checkboxTicked: true, secondsOnScreen: 12 });
    expect(v.unlocked).toBe(true);
    expect(v.missing).toEqual([]);
  });

  it('read time is length-scaled but always inside 10–15 seconds', () => {
    expect(requiredReadSeconds(shortBrief.body)).toBe(10);
    expect(requiredReadSeconds(longBrief.body)).toBe(15);
    expect(requiredReadSeconds('')).toBe(10);
  });

  it('an acknowledgment record cannot exist for a skipped briefing', () => {
    expect(() => buildAcknowledgment({
      content: shortBrief,
      state: { scrolledToBottom: true, checkboxTicked: false, secondsOnScreen: 60 },
      crewMemberId: 'c1',
      startedAtIso: '2026-08-05T10:00:00Z',
      completedAtIso: '2026-08-05T10:01:00Z',
    })).toThrow(/not acknowledged/);
  });

  it('acknowledgment always earns payable time — never rounds to zero (§4.6)', () => {
    const rec = buildAcknowledgment({
      content: shortBrief,
      state: { scrolledToBottom: true, checkboxTicked: true, secondsOnScreen: 11 },
      crewMemberId: 'c1',
      startedAtIso: '2026-08-05T10:00:00Z',
      completedAtIso: '2026-08-05T10:00:11Z',
    });
    expect(rec.payableMinutes).toBeGreaterThanOrEqual(1);
    expect(rec.context).toBe('tailgate_ack');
  });
});

const src = (over: Partial<WorkOrderSource> = {}): WorkOrderSource => ({
  jobId: 'j1', routeOrder: 1, address: '123 Oak St', city: 'Virginia Beach',
  timeIso: '2026-08-05T13:00:00Z', scope: 'Remove leaning pine',
  hazardPowerLines: false, hazardStructures: false, permitStatus: null,
  photoRefs: [], briefingId: 'b1', ...over,
});

describe('crew work order (§6F/§8C) — admin data excluded by construction', () => {
  it('carries what the crew needs to work', () => {
    const p = buildCrewPayload(src());
    expect(p.address).toBe('123 Oak St');
    expect(p.scope).toBe('Remove leaning pine');
    expect(p.requiresBeforeAfterPhotos).toBe(true);
  });

  it('surfaces hazards in plain crew language', () => {
    const p = buildCrewPayload(src({ hazardPowerLines: true, hazardStructures: true }));
    expect(p.hazards).toHaveLength(2);
    expect(p.hazards.join(' ')).toMatch(/POWER LINES/);
  });

  it('never tells a crew a property is CLEAR (§6B.3)', () => {
    for (const status of ['PERMIT_LIKELY', 'REVIEW_NEEDED', 'NO_OVERLAY_VERIFY'] as const) {
      const p = buildCrewPayload(src({ permitStatus: status }));
      expect(p.permitNote).toBeTruthy();
      expect(p.permitNote!.toLowerCase()).not.toMatch(/you'?re clear|all clear|good to cut/);
    }
    expect(buildCrewPayload(src({ permitStatus: null })).permitNote).toBeNull();
  });

  it('the payload has no slot for price, tracking, or customer contact', () => {
    const p = buildCrewPayload(src()) as unknown as Record<string, unknown>;
    for (const forbidden of ['price', 'quote', 'margin', 'phone', 'email', 'quality', 'tracking', 'bouncie']) {
      expect(Object.keys(p).some((k) => k.toLowerCase().includes(forbidden))).toBe(false);
    }
    expect(JSON.stringify(p)).not.toMatch(/\$\s?\d/);
  });

  it('sequences the day by clock time, renumbering the route', () => {
    const ordered = sequenceRoute([
      src({ jobId: 'late', timeIso: '2026-08-05T16:00:00Z', routeOrder: 1 }),
      src({ jobId: 'early', timeIso: '2026-08-05T09:00:00Z', routeOrder: 2 }),
      src({ jobId: 'floating', timeIso: null, routeOrder: 3 }),
    ]);
    expect(ordered.map((o) => o.jobId)).toEqual(['early', 'late', 'floating']);
    expect(ordered.map((o) => o.routeOrder)).toEqual([1, 2, 3]);
  });
});

describe('permit UNKNOWN (§6B.3) — silence on a safety surface is not "fine"', () => {
  it('says UNKNOWN when no screen is on file', () => {
    const p = buildCrewPayload(src({ permitStatus: null, permitScreenPending: true }));
    expect(p.permitNote).toMatch(/UNKNOWN/);
    expect(p.permitNote).toMatch(/check with the office/i);
  });

  it('a real screen result always outranks the unknown note', () => {
    const p = buildCrewPayload(src({ permitStatus: 'PERMIT_LIKELY', permitScreenPending: true }));
    expect(p.permitNote).toMatch(/PERMIT LIKELY/);
  });

  it('stays silent only when a screen exists and found nothing pending', () => {
    expect(buildCrewPayload(src({ permitStatus: null, permitScreenPending: false })).permitNote).toBeNull();
  });
});
