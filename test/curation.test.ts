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
// The curation gate. Mike, 2026-08-04: "i want every single piece gone
// through and flagged for approval." These tests are that sentence.

import { describe, it, expect } from 'vitest';
import {
  approve, reject, servable, awaitingReview, rejected,
  checkProgram, assertAllApproved, reviewQueueSummary, QUEUED,
  type CuratedPiece, type ApprovedProfessional, type TrainingProgram,
} from '../src/safety/curation.js';

const ON = '2026-08-04';
const pro = (over: Partial<ApprovedProfessional> = {}): ApprovedProfessional => ({
  id: 'pro1', name: 'A Rated Instructor', whyTrusted: 'Mike has watched them work.',
  credentialsClaimed: 'ISA Certified Arborist', approval: approve('Mike Campbell', ON, 'both'), ...over,
});
const piece = (over: Partial<CuratedPiece> = {}): CuratedPiece => ({
  id: 'p1', sourceId: 'pro1', title: 'Chipper feed basics',
  url: 'https://example.test/x', teaches: 'Where to stand and where not to reach.',
  approval: approve('Mike Campbell', ON, 'safety'), ...over,
});

describe('curation — nothing defaults to approved', () => {
  it('QUEUED is the starting state and carries no decision', () => {
    expect(QUEUED.state).toBe('queued');
    expect(QUEUED.decidedBy).toBeNull();
  });

  it('an approval must have a name behind it', () => {
    expect(() => approve('   ', ON, 'both')).toThrow(/no name/i);
  });

  it('a rejection must have a REASON — "does not meet the standard" is not one', () => {
    expect(() => reject('Mike', ON, 'safety', '  ')).toThrow(/needs a reason/i);
  });

  it('records which standard was applied — safety and knowledge fail differently', () => {
    expect(approve('Mike', ON, 'knowledge').standard).toBe('knowledge');
    expect(reject('Mike', ON, 'safety', 'Climber is tied in once.').standard).toBe('safety');
  });
});

describe('curation — TWO gates, not one', () => {
  it('serves a piece only when the piece AND its source are approved', () => {
    expect(servable([piece()], [pro()]).map((p) => p.id)).toEqual(['p1']);
  });

  it('an approved piece from an UNAPPROVED source is not served', () => {
    // Approving a channel does not bless its back catalogue, and a source
    // that was never passed cannot launder a piece through.
    const unapproved = pro({ approval: QUEUED });
    expect(servable([piece()], [unapproved])).toEqual([]);
  });

  it('a queued piece from an approved source is not served', () => {
    expect(servable([piece({ approval: QUEUED })], [pro()])).toEqual([]);
  });

  it('a rejected piece is never served', () => {
    const r = piece({ approval: reject('Mike', ON, 'safety', 'Shows a one-point tie-in.') });
    expect(servable([r], [pro()])).toEqual([]);
  });

  it('withdrawing a source pulls its already-approved material', () => {
    // A professional Mike later stops rating takes their catalogue with them.
    const withdrawn = pro({ approval: reject('Mike', ON, 'knowledge', 'No longer rate their teaching.') });
    expect(servable([piece()], [withdrawn])).toEqual([]);
  });
});

describe('curation — a rejection is recorded, not erased (§1B)', () => {
  it('keeps the piece and the reason on file', () => {
    const r = piece({ approval: reject('Mike', ON, 'safety', 'Climber is tied in once during the cut.') });
    const out = rejected([r, piece()]);
    expect(out).toHaveLength(1);
    expect(out[0]!.approval.reason).toMatch(/tied in once/);
  });

  it('surfaces the queue rather than hiding it', () => {
    expect(awaitingReview([piece({ approval: QUEUED }), piece({ id: 'p2' })]).map((p) => p.id)).toEqual(['p1']);
  });
});

describe('curation — a program is blocked by ONE unreviewed step', () => {
  const program = (ids: string[], over: Partial<TrainingProgram> = {}): TrainingProgram => ({
    id: 'prog1', operation: 'Running the chipper', summary: 'Day one on the feed table.',
    pieceIds: ids, approval: approve('Mike Campbell', ON, 'both'), ...over,
  });

  it('publishes when every step is approved', () => {
    const r = checkProgram(program(['p1', 'p2']), [piece(), piece({ id: 'p2' })], [pro()]);
    expect(r.publishable).toBe(true);
    if (!r.publishable) return;
    // Order is preserved — this is a sequence, not a set.
    expect(r.pieces.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('ONE unreviewed step blocks the whole curriculum, and says which', () => {
    const r = checkProgram(
      program(['p1', 'p2', 'p3']),
      [piece(), piece({ id: 'p2', approval: QUEUED, title: 'Bar and chain' }), piece({ id: 'p3' })],
      [pro()],
    );
    expect(r.publishable).toBe(false);
    if (r.publishable) return;
    expect(r.refusals.join(' ')).toMatch(/Step 2 \("Bar and chain"\) has not been reviewed/);
  });

  it('names the rejection reason inline so Mike does not have to go looking', () => {
    const r = checkProgram(
      program(['p1']),
      [piece({ approval: reject('Mike', ON, 'safety', 'No helmet on the groundie.') })],
      [pro()],
    );
    expect(r.publishable).toBe(false);
    if (r.publishable) return;
    expect(r.refusals.join(' ')).toMatch(/No helmet on the groundie/);
  });

  it('catches a step pointing at material that is not on file', () => {
    const r = checkProgram(program(['p1', 'ghost']), [piece()], [pro()]);
    expect(r.publishable).toBe(false);
    if (r.publishable) return;
    expect(r.refusals.join(' ')).toMatch(/not on file/);
  });

  it('refuses an unapproved curriculum even when every piece passed', () => {
    const r = checkProgram(program(['p1'], { approval: QUEUED }), [piece()], [pro()]);
    expect(r.publishable).toBe(false);
    if (r.publishable) return;
    expect(r.refusals.join(' ')).toMatch(/program itself is "queued"/);
  });

  it('refuses an empty program', () => {
    const r = checkProgram(program([]), [], [pro()]);
    expect(r.publishable).toBe(false);
  });
});

describe('curation — the structural check on the serving path', () => {
  it('throws rather than teach from something unapproved', () => {
    expect(() => assertAllApproved([piece({ approval: QUEUED })], [pro()]))
      .toThrow(/not approved/i);
  });

  it('throws on an approved piece from an unapproved source', () => {
    expect(() => assertAllApproved([piece()], [pro({ approval: QUEUED })]))
      .toThrow(/not an approved professional/i);
  });

  it('passes clean material', () => {
    expect(() => assertAllApproved([piece()], [pro()])).not.toThrow();
  });
});

describe('curation — the queue Mike actually reads', () => {
  it('says what is waiting on him', () => {
    const s = reviewQueueSummary(
      [piece(), piece({ id: 'p2', approval: QUEUED }), piece({ id: 'p3', approval: reject('Mike', ON, 'safety', 'x') })],
      [pro(), pro({ id: 'pro2', approval: QUEUED })],
    );
    expect(s).toMatchObject({ approved: 1, queued: 1, rejected: 1, sourcesQueued: 1 });
    expect(s.line).toMatch(/waiting on you/);
  });

  it('says so plainly when nothing is waiting', () => {
    expect(reviewQueueSummary([piece()], [pro()]).line).toMatch(/nothing waiting/i);
  });
});
