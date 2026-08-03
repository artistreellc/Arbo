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
import { buildLessonDraft, redactObviousPii } from '../src/training/fromNearMiss.js';
import {
  selectQuestionnaire, buildGateCompletion, updateProfile, GateRejected,
  MAX_GATE_MINUTES, defaultQuestionnaireConfig, type TrainingItemRef,
} from '../src/training/questionnaire.js';

describe('near miss → lesson (§6V/§4.7) — Arbo drafts, a human publishes', () => {
  const nm = {
    id: 'nm1',
    description: 'Bucket drifted toward the service drop on the back lot',
    hazardCategory: 'electrical' as const,
    occurredOn: '2026-08-01',
  };

  it('produces a DRAFT — there is no path here that publishes', () => {
    const d = buildLessonDraft(nm);
    expect(d.published).toBe(false);
    expect(d.source).toBe('event_generated');
    expect(d.originNearMissId).toBe('nm1');
  });

  it('hangs the lesson on the right topic and clause', () => {
    const d = buildLessonDraft(nm);
    expect(d.topic).toBe('Electrical hazards');
    expect(d.body.standardRefs).toContain('Z133 §4.1');
    expect(d.body.whatToDoDifferently.length).toBeGreaterThan(0);
  });

  it('keeps what actually happened — a sanitised abstraction teaches nothing', () => {
    expect(buildLessonDraft(nm).body.whatHappened).toMatch(/Bucket drifted/);
  });

  it('strips obvious contact PII from the crew-facing text (§4.3)', () => {
    const d = buildLessonDraft({
      ...nm,
      description: 'Call 757-408-1124 or a@b.com about 2620 Meckley Court before the next one',
    });
    const text = d.body.whatHappened;
    expect(text).not.toMatch(/757-408-1124/);
    expect(text).not.toMatch(/a@b\.com/);
    expect(text).not.toMatch(/2620 Meckley Court/);
    expect(text).toMatch(/\[phone removed\]/);
  });

  it('does NOT pretend to have handled names — it tells the vetter to check', () => {
    const d = buildLessonDraft(nm);
    expect(d.vetterNotes.join(' ')).toMatch(/name/i);
    expect(d.vetterNotes.join(' ')).toMatch(/cannot detect names reliably/i);
  });

  it('an uncategorised near miss says so instead of picking a topic', () => {
    const d = buildLessonDraft({ ...nm, hazardCategory: 'uncategorised' });
    expect(d.topic).toBe('General safety');
    expect(d.vetterNotes.join(' ')).toMatch(/matched no known hazard pattern/i);
  });

  it('ranks electrical and fall lessons above the rest', () => {
    expect(buildLessonDraft(nm).difficulty).toBe(3);
    expect(buildLessonDraft({ ...nm, hazardCategory: 'vehicle' }).difficulty).toBe(2);
  });

  it('the redactor reports what it removed rather than doing it silently', () => {
    const r = redactObviousPii('reach me at 757-408-1124');
    expect(r.removed).toContain('phone');
  });
});

const item = (id: string, topic: string, difficulty = 1, over: Partial<TrainingItemRef> = {}): TrainingItemRef => ({
  id, topic, difficulty, published: true, excludeFromScoring: false, ...over,
});

const pool: TrainingItemRef[] = [
  item('e1', 'Electrical hazards', 3), item('e2', 'Electrical hazards', 2),
  item('f1', 'Fall protection', 3), item('f2', 'Fall protection', 1),
  item('r1', 'Rigging', 2), item('r2', 'Rigging', 1),
  item('s1', 'Saw handling', 2), item('s2', 'Saw handling', 1),
];

describe('Friday questionnaire (§6M/§4.6) — parameterised, weak-topic weighted', () => {
  it('the question count is CONFIG, not a constant — 10 or 15 costs nothing', () => {
    const ten = selectQuestionnaire(pool, {}, { ...defaultQuestionnaireConfig, questionCount: 4 });
    const fifteen = selectQuestionnaire(pool, {}, { ...defaultQuestionnaireConfig, questionCount: 8 });
    expect(ten.itemIds).toHaveLength(4);
    expect(fifteen.itemIds).toHaveLength(8);
  });

  it('is deterministic — a man cannot reroll into an easier quiz', () => {
    const profile = { scores: { 'Rigging': 0.4, 'Saw handling': 0.9 } };
    const a = selectQuestionnaire(pool, profile);
    const b = selectQuestionnaire(pool, profile);
    expect(a.itemIds).toEqual(b.itemIds);
  });

  it('weights the quiz toward the topics the man is weak on', () => {
    const s = selectQuestionnaire(pool, {
      scores: { 'Rigging': 0.3, 'Electrical hazards': 0.95, 'Fall protection': 0.95, 'Saw handling': 0.95 },
    }, { ...defaultQuestionnaireConfig, questionCount: 4 });
    expect(s.targetedTopics).toEqual(['Rigging']);
    expect(s.itemIds.slice(0, 2).every((id) => id.startsWith('r'))).toBe(true);
  });

  it('§1B — an UNTESTED topic is a gap, not a pass', () => {
    const s = selectQuestionnaire(pool, { scores: { 'Rigging': 0.95, 'Saw handling': 0.95 } });
    expect(s.untestedTopics).toEqual(['Electrical hazards', 'Fall protection']);
    // Untested topics rank with the weak ones, so they get asked.
    expect(s.itemIds.some((id) => id.startsWith('e') || id.startsWith('f'))).toBe(true);
  });

  it('round-robins weak topics so one gap cannot hide a second', () => {
    const s = selectQuestionnaire(pool, {
      scores: { 'Rigging': 0.2, 'Saw handling': 0.3, 'Electrical hazards': 0.95, 'Fall protection': 0.95 },
    }, { ...defaultQuestionnaireConfig, questionCount: 4, weakShare: 1 });
    const topics = new Set(s.itemIds.map((id) => id[0]));
    expect(topics.has('r')).toBe(true);
    expect(topics.has('s')).toBe(true);
  });

  it('never asks an UNPUBLISHED item — it has not been through a human (§4.7)', () => {
    const withDraft = [...pool, item('draft', 'Electrical hazards', 3, { published: false })];
    const s = selectQuestionnaire(withDraft, {}, { ...defaultQuestionnaireConfig, questionCount: 20 });
    expect(s.itemIds).not.toContain('draft');
  });

  it('never scores a man on an item marked exclude_from_scoring', () => {
    const withExcluded = [...pool, item('nm-gen', 'Rigging', 3, { excludeFromScoring: true })];
    const s = selectQuestionnaire(withExcluded, {}, { ...defaultQuestionnaireConfig, questionCount: 20 });
    expect(s.itemIds).not.toContain('nm-gen');
  });

  it('says out loud when the pool could not fill the quiz', () => {
    const s = selectQuestionnaire([item('only', 'Rigging')], {}, { ...defaultQuestionnaireConfig, questionCount: 10 });
    expect(s.itemIds).toHaveLength(1);
    expect(s.shortfall).toBe(9);
  });
});

describe('gate completion (§4.6) — the time is ALWAYS paid', () => {
  const base = {
    crewMemberId: 'c1', context: 'clock_in_gate' as const, itemIds: ['i1'],
    startedAtIso: '2026-08-03T11:00:00Z', completedAtIso: '2026-08-03T11:00:40Z',
  };

  it('a 40-second gate still earns a payable minute — rounding to zero is wage theft', () => {
    expect(buildGateCompletion(base).payableMinutes).toBe(1);
  });

  it('clamps a client clock that would mint a shift', () => {
    const c = buildGateCompletion({ ...base, completedAtIso: '2026-08-04T11:00:00Z' });
    expect(c.payableMinutes).toBe(MAX_GATE_MINUTES);
  });

  it('rejects a reversed span rather than writing a negative wage row', () => {
    expect(() => buildGateCompletion({
      ...base, startedAtIso: '2026-08-03T11:05:00Z', completedAtIso: '2026-08-03T11:00:00Z',
    })).toThrow(/reversed_times/);
  });

  it('rejects a completion with no crew member and no items', () => {
    expect(() => buildGateCompletion({ ...base, crewMemberId: '' })).toThrow(GateRejected);
    expect(() => buildGateCompletion({ ...base, itemIds: [] })).toThrow(GateRejected);
    expect(() => buildGateCompletion({ ...base, startedAtIso: 'nope' })).toThrow(/bad_times/);
  });

  it('scores only when something was actually answered', () => {
    expect(buildGateCompletion(base).score).toBeNull();
    expect(buildGateCompletion({ ...base, correct: 7, answered: 10 }).score).toBe(0.7);
  });
});

describe('training profile (§6M.5) — a moving average, not a brand', () => {
  it('records a first score straight', () => {
    expect(updateProfile({}, { Rigging: 0.6 }).scores!.Rigging).toBe(0.6);
  });

  it('one bad Friday does not brand a man, and one good one does not erase a pattern', () => {
    const after = updateProfile({ scores: { Rigging: 0.9 } }, { Rigging: 0.2 });
    expect(after.scores!.Rigging).toBeGreaterThan(0.5);
    expect(after.scores!.Rigging).toBeLessThan(0.9);
  });

  it('ignores garbage rather than storing it', () => {
    const after = updateProfile({ scores: { Rigging: 0.8 } }, { Rigging: 5, Saw: NaN });
    expect(after.scores!.Rigging).toBe(0.8);
    expect(after.scores!.Saw).toBeUndefined();
  });
});
