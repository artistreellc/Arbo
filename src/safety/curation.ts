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
// THE CURATION GATE — nothing reaches a crew member that Mike has not passed.
//
// MIKE, 2026-08-04: "these are supposed to be training programs for basic
// operations of tree work and a knowledge center from recommended
// professionals, people i approve of. i want every single piece gone through
// and flagged for approval. if it doesnt meet my safety or knowledge
// standards [it doesn't get in]."
//
// ═══ WHAT CHANGED FROM MY FIRST PASS, AND WHY IT MATTERED ═══
// I first built this as "a named human watched it". That is not the same
// rule. Watched means somebody pressed play. APPROVED means Mike judged it
// against his safety and knowledge standards and said yes. A clip can be
// watched and still be wrong for this crew — that is exactly the case he is
// describing, and my version would have served it.
//
// ═══ TWO GATES, NOT ONE ═══
// A piece of material must clear BOTH:
//   1. its source is a professional Mike has approved, and
//   2. the piece itself has been reviewed and approved.
// Approving a channel does not bless everything on it. A good instructor can
// publish a clip that shows a shortcut this crew should not copy, and that
// clip must still be caught.
//
// ═══ REJECTION IS RECORDED, NOT ERASED (§1B) ═══
// A rejected piece keeps its row and its reason. "We looked at this and said
// no because the climber is tied in once" is worth more than the piece never
// having existed — it stops the same link being queued again next quarter,
// and it is the clearest statement of the standard there is.

/** Three states. Nothing defaults to approved, and there is no fourth. */
export type ApprovalState = 'queued' | 'approved' | 'rejected';

/**
 * Which of Mike's two bars a review was judged against. He named both, and
 * they fail differently: a technically-correct clip can still teach a habit
 * he does not want, and a safe clip can still be a poor explanation.
 */
export type StandardApplied = 'safety' | 'knowledge' | 'both';

export interface ApprovalRecord {
  state: ApprovalState;
  /** WHO said yes or no. A name, never "the office". Null while queued. */
  decidedBy: string | null;
  decidedOnIso: string | null;
  standard: StandardApplied | null;
  /**
   * Required on a rejection. "Does not meet the standard" is not a reason —
   * the next person queuing material needs to know WHICH thing was wrong.
   */
  reason: string | null;
}

export const QUEUED: ApprovalRecord = {
  state: 'queued', decidedBy: null, decidedOnIso: null, standard: null, reason: null,
};

/**
 * A professional whose material may even be CONSIDERED. Gate one.
 *
 * Approving somebody here does not approve their back catalogue — it only
 * makes their work eligible for review.
 */
export interface ApprovedProfessional {
  id: string;
  /** Person or organisation, as they publish. */
  name: string;
  /** Why Mike rates them — his words, kept so the standard stays legible. */
  whyTrusted: string;
  /** Credentials as claimed by them. ARBO never asserts a credential itself. */
  credentialsClaimed: string | null;
  approval: ApprovalRecord;
}

/**
 * One piece of material — a clip, a document, a written drill.
 * `sourceId` must name an APPROVED professional; see `servable`.
 */
export interface CuratedPiece {
  id: string;
  sourceId: string;
  title: string;
  url: string;
  /** What it teaches, in the reviewer's words after watching or reading it. */
  teaches: string;
  approval: ApprovalRecord;
  /**
   * Set when the piece is kept deliberately as a COUNTER-example. Approved,
   * but approved as "this is what not to do" — serving it without this line
   * showing would teach the hazard.
   */
  counterExample?: string;
}

export function approve(
  by: string,
  onIso: string,
  standard: StandardApplied,
): ApprovalRecord {
  if (!by.trim()) throw new Error('curation: an approval with no name behind it is not an approval.');
  return { state: 'approved', decidedBy: by, decidedOnIso: onIso, standard, reason: null };
}

export function reject(
  by: string,
  onIso: string,
  standard: StandardApplied,
  reason: string,
): ApprovalRecord {
  if (!by.trim()) throw new Error('curation: a rejection with no name behind it is not a rejection.');
  if (!reason.trim()) {
    throw new Error(
      'curation: a rejection needs a reason. "Does not meet the standard" tells the next person nothing.',
    );
  }
  return { state: 'rejected', decidedBy: by, decidedOnIso: onIso, standard, reason };
}

/**
 * BOTH GATES. A piece is servable only when it is approved AND its source is
 * an approved professional. Anything else — queued, rejected, or from a
 * source that was never approved or was later withdrawn — is not served.
 */
export function servable(pieces: CuratedPiece[], sources: ApprovedProfessional[]): CuratedPiece[] {
  const ok = new Set(sources.filter((s) => s.approval.state === 'approved').map((s) => s.id));
  return pieces.filter((p) => p.approval.state === 'approved' && ok.has(p.sourceId));
}

/** Waiting on Mike. Surfaced so the queue is visible, never served. */
export function awaitingReview(pieces: CuratedPiece[]): CuratedPiece[] {
  return pieces.filter((p) => p.approval.state === 'queued');
}

/**
 * Turned down, with the reason. Kept on file so the same link is not queued
 * again next quarter, and so the standard stays readable.
 */
export function rejected(pieces: CuratedPiece[]): CuratedPiece[] {
  return pieces.filter((p) => p.approval.state === 'rejected');
}

/**
 * A TRAINING PROGRAM for one basic operation of tree work — the thing Mike
 * actually asked for. An ordered curriculum, not a pile of links.
 */
export interface TrainingProgram {
  id: string;
  /** e.g. "Running the chipper", "Ground crew basics", "First day on a rope" */
  operation: string;
  summary: string;
  /** Ordered. Position matters — this is a sequence, not a set. */
  pieceIds: string[];
  approval: ApprovalRecord;
}

export type ProgramCheck =
  | { publishable: true; program: TrainingProgram; pieces: CuratedPiece[] }
  | { publishable: false; refusals: string[] };

/**
 * A PROGRAM IS ONLY PUBLISHABLE WHEN EVERY PIECE IN IT IS APPROVED.
 *
 * This is "every single piece gone through and flagged for approval", made
 * mechanical. One unreviewed clip in a ten-step curriculum blocks the whole
 * program — because a crew member working through it in order will hit that
 * step and be taught by something nobody vetted.
 */
export function checkProgram(
  program: TrainingProgram,
  pieces: CuratedPiece[],
  sources: ApprovedProfessional[],
): ProgramCheck {
  const refusals: string[] = [];
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const okSources = new Set(sources.filter((s) => s.approval.state === 'approved').map((s) => s.id));

  if (program.pieceIds.length === 0) {
    refusals.push('This program has no material in it.');
  }
  if (program.approval.state !== 'approved') {
    refusals.push(`The program itself is "${program.approval.state}" — it has not been approved as a curriculum.`);
  }

  const ordered: CuratedPiece[] = [];
  for (const [i, id] of program.pieceIds.entries()) {
    const piece = byId.get(id);
    if (!piece) {
      refusals.push(`Step ${i + 1} points at material that is not on file (${id}).`);
      continue;
    }
    ordered.push(piece);
    if (piece.approval.state === 'queued') {
      refusals.push(`Step ${i + 1} ("${piece.title}") has not been reviewed yet.`);
    } else if (piece.approval.state === 'rejected') {
      refusals.push(`Step ${i + 1} ("${piece.title}") was rejected: ${piece.approval.reason}`);
    } else if (!okSources.has(piece.sourceId)) {
      refusals.push(`Step ${i + 1} ("${piece.title}") comes from a source that is not an approved professional.`);
    }
  }

  if (refusals.length > 0) return { publishable: false, refusals };
  return { publishable: true, program, pieces: ordered };
}

/**
 * STRUCTURAL CHECK ON THE REAL PATH. If a serving surface is ever handed
 * material that did not clear both gates, this throws rather than teaching a
 * crew member from something Mike never passed.
 */
export function assertAllApproved(
  pieces: CuratedPiece[],
  sources: ApprovedProfessional[],
): void {
  const okSources = new Set(sources.filter((s) => s.approval.state === 'approved').map((s) => s.id));
  for (const p of pieces) {
    if (p.approval.state !== 'approved') {
      throw new Error(
        `curation: "${p.title}" is ${p.approval.state}, not approved. Nothing reaches a crew member ` +
        'that Mike has not passed against his safety and knowledge standards.',
      );
    }
    if (!okSources.has(p.sourceId)) {
      throw new Error(
        `curation: "${p.title}" comes from source ${p.sourceId}, which is not an approved professional.`,
      );
    }
  }
}

/** What the review queue looks like to Mike. Counts, so it is scannable. */
export function reviewQueueSummary(
  pieces: CuratedPiece[],
  sources: ApprovedProfessional[],
): { approved: number; queued: number; rejected: number; sourcesQueued: number; line: string } {
  const approved = pieces.filter((p) => p.approval.state === 'approved').length;
  const queued = pieces.filter((p) => p.approval.state === 'queued').length;
  const rej = pieces.filter((p) => p.approval.state === 'rejected').length;
  const sourcesQueued = sources.filter((s) => s.approval.state === 'queued').length;
  const line = queued === 0 && sourcesQueued === 0
    ? `Nothing waiting. ${approved} approved, ${rej} turned down.`
    : `${queued} piece(s) and ${sourcesQueued} source(s) waiting on you. ${approved} approved, ${rej} turned down.`;
  return { approved, queued, rejected: rej, sourcesQueued, line };
}
