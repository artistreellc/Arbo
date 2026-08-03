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
import { buildTrainingBoard, WEAK_AT_OR_BELOW, type CrewProfileRow } from '../src/training/board.js';
import { etWeekStart, isEtFriday } from '../src/lib/etDay.js';

const POOL = ['Electrical hazards', 'Fall protection', 'Rigging', 'Saw handling'];

const man = (over: Partial<CrewProfileRow> = {}): CrewProfileRow => ({
  id: 'c1', name: 'A', role: 'climber', scores: {}, ...over,
});

describe('training board (§6M.5) — weak, untested, and strong are three states', () => {
  it('separates weak from strong at the threshold', () => {
    const b = buildTrainingBoard({
      crew: [man({ scores: { Rigging: 0.3, 'Saw handling': 0.95 } })],
      poolTopics: POOL, completions: [],
    });
    const row = b.rows[0]!;
    expect(row.weakTopics.map((w) => w.topic)).toEqual(['Rigging']);
    expect(row.strongTopics).toEqual(['Saw handling']);
  });

  it('§1B — an UNTESTED topic is a gap in our record, never a pass', () => {
    const b = buildTrainingBoard({
      crew: [man({ scores: { Rigging: 0.9 } })],
      poolTopics: POOL, completions: [],
    });
    const row = b.rows[0]!;
    expect(row.untestedTopics).toEqual(['Electrical hazards', 'Fall protection', 'Saw handling']);
    expect(row.strongTopics).toEqual(['Rigging']);
    // The untested ones must not have leaked into strong.
    for (const t of row.untestedTopics) expect(row.strongTopics).not.toContain(t);
  });

  it('the pool defines what untested can mean — no pool is a named blind spot', () => {
    const b = buildTrainingBoard({ crew: [man()], poolTopics: [], completions: [] });
    expect(b.blindSpots.join(' ')).toMatch(/cannot tell what anyone has or has not been asked/i);
  });

  it('flags a man with no record at all rather than showing him clean', () => {
    const b = buildTrainingBoard({ crew: [man()], poolTopics: POOL, completions: [] });
    expect(b.rows[0]!.neverTested).toBe(true);
    expect(b.rows[0]!.untestedTopics).toEqual([...POOL].sort());
  });

  it('sorts worst first: never tested, then most weak topics', () => {
    const b = buildTrainingBoard({
      crew: [
        man({ id: 'ok', name: 'Ok', scores: { Rigging: 0.9, 'Saw handling': 0.9 } }),
        man({ id: 'weak', name: 'Weak', scores: { Rigging: 0.2, 'Saw handling': 0.3 } }),
        man({ id: 'new', name: 'New', scores: {} }),
      ],
      poolTopics: POOL, completions: [],
    });
    expect(b.rows.map((r) => r.crewMemberId)).toEqual(['new', 'weak', 'ok']);
  });

  it('the weak threshold is inclusive at the boundary', () => {
    const b = buildTrainingBoard({
      crew: [man({ scores: { Rigging: WEAK_AT_OR_BELOW } })],
      poolTopics: POOL, completions: [],
    });
    expect(b.rows[0]!.weakTopics).toHaveLength(1);
  });
});

describe("who owes this week's questionnaire", () => {
  it('marks the man who completed it and the one who did not', () => {
    const b = buildTrainingBoard({
      crew: [man({ id: 'did', name: 'Did' }), man({ id: 'didnt', name: 'Didnt' })],
      poolTopics: POOL,
      completions: [{ crewMemberId: 'did', context: 'friday_questionnaire', completedAtIso: '2026-08-01T12:00:00Z' }],
    });
    expect(b.owingThisWeek).toEqual(['didnt']);
  });

  it('a STARTED but never completed questionnaire does not count as done', () => {
    const b = buildTrainingBoard({
      crew: [man({ id: 'c1' })],
      poolTopics: POOL,
      completions: [{ crewMemberId: 'c1', context: 'friday_questionnaire', completedAtIso: null }],
    });
    expect(b.owingThisWeek).toEqual(['c1']);
  });

  it('a clock-in gate is not the weekly questionnaire', () => {
    const b = buildTrainingBoard({
      crew: [man({ id: 'c1' })],
      poolTopics: POOL,
      completions: [{ crewMemberId: 'c1', context: 'clock_in_gate', completedAtIso: '2026-08-01T12:00:00Z' }],
    });
    expect(b.owingThisWeek).toEqual(['c1']);
  });

  it('§1B — an unreadable completions feed is UNKNOWN, not "nobody owes anything"', () => {
    const b = buildTrainingBoard({ crew: [man({ id: 'c1' })], poolTopics: POOL, completions: null });
    expect(b.rows[0]!.completedThisWeek).toBeNull();
    expect(b.owingThisWeek).toEqual([]); // not asserted either way
    expect(b.blindSpots.join(' ')).toMatch(/UNKNOWN, not nobody/i);
  });
});

describe('ET week math — the business week, not the UTC week', () => {
  it('a Monday-morning ET instant starts the week that same Monday', () => {
    // 2026-08-03 is a Monday. 09:00 ET = 13:00 UTC.
    const start = etWeekStart(new Date('2026-08-03T13:00:00Z'));
    expect(start.toISOString().slice(0, 10)).toBe('2026-08-03');
  });

  it('Sunday 9pm ET still belongs to the week that began the PREVIOUS Monday', () => {
    // 2026-08-09 is a Sunday. 21:00 ET = 2026-08-10T01:00Z — a UTC week
    // boundary would have already rolled this into the next week.
    const start = etWeekStart(new Date('2026-08-10T01:00:00Z'));
    expect(start.toISOString().slice(0, 10)).toBe('2026-08-03');
  });

  it('mid-week lands on the same Monday', () => {
    const start = etWeekStart(new Date('2026-08-06T16:00:00Z')); // Thursday
    expect(start.toISOString().slice(0, 10)).toBe('2026-08-03');
  });

  it('knows Friday in Hampton Roads, not in UTC', () => {
    expect(isEtFriday(new Date('2026-08-07T16:00:00Z'))).toBe(true);  // Fri noon ET
    // Saturday 00:30 UTC is still Friday 8:30pm ET — the crew's Friday.
    expect(isEtFriday(new Date('2026-08-08T00:30:00Z'))).toBe(true);
    expect(isEtFriday(new Date('2026-08-06T16:00:00Z'))).toBe(false); // Thursday
  });
});
