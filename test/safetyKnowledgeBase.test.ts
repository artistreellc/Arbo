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
// The safety trainer. The tests that matter here are the refusals — this is
// the one surface where being confidently wrong puts someone on the ground.

import { describe, it, expect } from 'vitest';
import {
  coachOn,
  usableClips,
  unverifiedClips,
  assertNeverCertifiesSafe,
  SAFETY_TOPICS,
  CHECKS_BY_TOPIC,
  FORBIDDEN_SAFETY_VERDICTS,
  type TrainingClip,
  type SafetySource,
  type CoachingPointer,
} from '../src/safety/knowledgeBase.js';

const WATCHED: TrainingClip = {
  id: 'c1', topic: 'rigging', publisher: 'A Reputable Training Org',
  url: 'https://example.test/clip', demonstrates: 'Negative rigging on a spar, load path called out.',
  startSec: 120, endSec: 260, verifiedBy: 'Mike Campbell', verifiedOnIso: '2026-08-04',
};
const QUEUED: TrainingClip = { ...WATCHED, id: 'c2', verifiedBy: null, verifiedOnIso: null };

const SOURCE: SafetySource = {
  id: 's1', topic: 'rigging', citation: 'ANSI Z133-2017 §8.2', publisher: 'ANSI/TCIA',
  year: 2017, url: null, plainWords: 'Rigging gear is selected against the load it will actually see.',
};

describe('safety trainer — it never certifies anyone as safe', () => {
  it('refuses every forbidden verdict', () => {
    for (const verdict of FORBIDDEN_SAFETY_VERDICTS) {
      const bad: CoachingPointer = {
        topic: 'rigging', checks: ['a real check'], sources: [], clips: [],
        confidence: 'topic_is_clear', decidedBy: 'Mike',
        line: `Your position ${verdict}.`,
      };
      expect(() => assertNeverCertifiesSafe(bad), `must refuse "${verdict}"`).toThrow(/never certifies/i);
    }
  });

  it('catches a verdict hidden in the CHECKS, not just the headline', () => {
    const bad: CoachingPointer = {
      topic: 'felling', checks: ['Hinge looks correctly tied in, carry on.'], sources: [], clips: [],
      confidence: 'topic_is_clear', decidedBy: 'Mike', line: 'Felling.',
    };
    expect(() => assertNeverCertifiesSafe(bad)).toThrow();
  });

  it('refuses a pointer with no checks — an empty reassurance is the worst answer', () => {
    const bad: CoachingPointer = {
      topic: 'ppe', checks: [], sources: [], clips: [],
      confidence: 'topic_is_clear', decidedBy: 'Mike', line: 'PPE.',
    };
    expect(() => assertNeverCertifiesSafe(bad)).toThrow(/empty reassurance/i);
  });

  it('runs the assertion on the REAL path — coachOn output is always checked', () => {
    for (const topic of SAFETY_TOPICS) {
      const p = coachOn({ topic, confidence: 'topic_is_clear', sources: [], clips: [], decidedBy: 'Mike' });
      expect(() => assertNeverCertifiesSafe(p)).not.toThrow();
      expect(p.checks.length).toBeGreaterThan(0);
    }
  });

  it('every stock check is a question, never a judgement about a person', () => {
    // A statement here would be diagnosing a photo. Questions put the call
    // back on the crew member, which is where it belongs.
    for (const topic of SAFETY_TOPICS) {
      for (const check of CHECKS_BY_TOPIC[topic]) {
        expect(check.trim().endsWith('?'), `${topic}: "${check}" must be a question`).toBe(true);
      }
    }
  });

  it('names a human as the decider on every single pointer', () => {
    const p = coachOn({ topic: 'felling', confidence: 'topic_is_clear', sources: [], clips: [], decidedBy: 'Mike Campbell' });
    expect(p.decidedBy).toBe('Mike Campbell');
    expect(p.line).toContain('Mike Campbell');
  });
});

describe('safety trainer — a photo is one frame (§1B)', () => {
  it('says plainly when it cannot tell what it is looking at', () => {
    const p = coachOn({ topic: null, confidence: 'cannot_tell', sources: [], clips: [], decidedBy: 'Mike' });
    expect(p.confidence).toBe('cannot_tell');
    expect(p.line).toMatch(/cannot tell/i);
    // And still returns the standing checks rather than nothing.
    expect(p.checks.length).toBeGreaterThan(0);
  });

  it('admits when the topic is only a guess', () => {
    const p = coachOn({ topic: 'rigging', confidence: 'topic_is_a_guess', sources: [], clips: [], decidedBy: 'Mike' });
    expect(p.line).toMatch(/may have it wrong/i);
  });
});

describe('safety trainer — clips are links, and only ones a human watched', () => {
  it('serves a watched clip', () => {
    expect(usableClips([WATCHED, QUEUED]).map((c) => c.id)).toEqual(['c1']);
  });

  it('NEVER serves an unwatched clip as training', () => {
    // ARBO cannot watch a video. Recommending one it has not seen is pointing
    // a climber at footage that might show the opposite of the lesson.
    const p = coachOn({ topic: 'rigging', confidence: 'topic_is_clear', sources: [], clips: [QUEUED], decidedBy: 'Mike' });
    expect(p.clips).toEqual([]);
  });

  it('surfaces unwatched clips for review rather than dropping them', () => {
    expect(unverifiedClips([WATCHED, QUEUED]).map((c) => c.id)).toEqual(['c2']);
  });

  it('only serves clips matching the topic', () => {
    const offTopic: TrainingClip = { ...WATCHED, id: 'c3', topic: 'chipper' };
    const p = coachOn({ topic: 'rigging', confidence: 'topic_is_clear', sources: [SOURCE], clips: [WATCHED, offTopic], decidedBy: 'Mike' });
    expect(p.clips.map((c) => c.id)).toEqual(['c1']);
    expect(p.sources.map((s) => s.id)).toEqual(['s1']);
  });

  it('holds a link and attribution, never the footage', () => {
    // No field on a clip can carry video data — the publisher keeps their
    // view, their attribution and their control.
    expect(Object.keys(WATCHED)).not.toContain('data');
    expect(WATCHED.publisher).toBeTruthy();
    expect(WATCHED.url.startsWith('https://')).toBe(true);
  });
});

describe('safety trainer — scope is narrow on purpose', () => {
  it('has no catch-all topic', () => {
    // "only related materials" — a piece of material that does not belong to
    // a named job-site safety subject does not enter the library.
    expect(SAFETY_TOPICS).not.toContain('general');
    expect(SAFETY_TOPICS).not.toContain('other');
    expect(SAFETY_TOPICS).not.toContain('misc');
  });

  it('every topic has checks — no member is decorative', () => {
    for (const t of SAFETY_TOPICS) expect(CHECKS_BY_TOPIC[t].length).toBeGreaterThan(0);
  });
});
