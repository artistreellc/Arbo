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
// §6B.3 — THE CLEARANCE STEP. The one place a permit's lifecycle can move,
// and the only thing in this codebase that can unblock a crew on protected
// work.
//
// WHY IT EXISTS. The board (permitBoard.ts) shows what is blocked. The gate
// (crewMayStart) refuses to start protected work unless the permit is
// 'approved' or 'not_required_verified'. Screening deliberately never sets
// either — `screenToPermitRecord` starts every track at 'needed' because "a
// screen NEVER auto-resolves to not required". Which left the loop open at
// both ends: nothing could ever move a track, so protected work was blocked
// forever and the two unblocking states were unreachable. This closes it.
//
// ═══ THE MOVE IS A HUMAN'S, STRUCTURALLY ═══
// `ClearanceAuthor.kind` has exactly ONE member: 'human'. There is no agent
// branch to guard, because there is no agent branch. §6B.3 says only a human
// verifying with the city can clear protected work, and an enum with one
// member says it in a way a refactor cannot talk its way out of. The same
// shape as `MarkingRender` and `DigStatus`.
//
// ═══ AND IT STILL NEVER SAYS "YOU'RE CLEAR" ═══
// 'not_required_verified' is the closest thing this system has to a clear,
// so it is the hardest to reach: it needs the city person's NAME, the day
// they said it, and either a reference number or an explicit statement that
// none was issued. That is not bureaucracy for its own sake — it is the
// difference between "the city told Mike on Tuesday" and "somebody clicked a
// button", and the crew's safety case rests on which one it was.
//
// WHAT THIS DELIBERATELY DOES NOT DO: restrict WHO may record it. Three rules
// inferred from the brief have already turned out narrower than how Mike
// actually runs the business, so this asks for a name and does not police the
// job title behind it. Flagging is cheap; binning real work is not.

import type { PermitLifecycle } from './permitRecord.js';

/**
 * Who recorded the move. One kind, on purpose — see the header. Adding
 * 'agent' here would make the §6B.3 promise a matter of code review instead
 * of a matter of types.
 */
export interface ClearanceAuthor {
  kind: 'human';
  /** The person recording it. Not a role, not "office" — a name. */
  name: string;
}

/** What the city actually said, and who said it. */
export interface CityWord {
  /** The person at the city. A department is not a person. */
  contactName: string;
  /** The day they said it (ISO date). Not the day it was typed in. */
  saidOnIso: string;
  /**
   * The city's reference — a VB PPR record number, a case ref. Null is
   * allowed ONLY with `noReferenceIssued: true` and an explanation: some
   * cities genuinely issue nothing over the phone, and forcing a made-up
   * number would be worse than recording the truth.
   */
  reference: string | null;
  noReferenceIssued?: boolean;
  /** Their words, as close as the recorder can get them. */
  note: string;
}

export interface ClearanceRequest {
  permitId: string;
  from: PermitLifecycle;
  to: PermitLifecycle;
  author: ClearanceAuthor;
  /** Required for any move that unblocks a crew, and for 'applied'. */
  cityWord?: CityWord;
}

export type ClearanceOutcome =
  | { ok: true; move: { permitId: string; to: PermitLifecycle; patch: { formRef?: string; notes: string } } }
  | { ok: false; refusals: string[] };

/**
 * The two states that let a crew start protected work. Derived here rather
 * than restated: `crewMayStart` in permitRecord.ts is the authority, and if
 * someone adds a third unblocking state there this list must be revisited —
 * which is why `assertUnblockingSetMatchesGate` below exists.
 */
export const UNBLOCKING: PermitLifecycle[] = ['approved', 'not_required_verified'];

const ALL_STATES: PermitLifecycle[] = ['needed', 'applied', 'approved', 'not_required_verified'];

function isBlank(s: string | undefined | null): boolean {
  return !s || s.trim().length === 0;
}

/**
 * Validate a lifecycle move. Pure — returns the write to make, and makes no
 * write itself, so the rules are testable without a database.
 *
 * Every refusal is a sentence a person can act on. "bad_request" tells Mike
 * nothing at 7am with a crew in the truck.
 */
export function authorizeClearance(req: ClearanceRequest): ClearanceOutcome {
  const refusals: string[] = [];

  if (!ALL_STATES.includes(req.to)) {
    refusals.push(`"${req.to}" is not a permit state.`);
  }
  if (isBlank(req.permitId)) {
    refusals.push('No permit was named.');
  }
  if (isBlank(req.author.name)) {
    refusals.push('Nobody is named as recording this. A permit move needs a person behind it.');
  }
  if (req.to === req.from) {
    refusals.push(`This permit is already "${req.from}".`);
  }

  const unblocking = UNBLOCKING.includes(req.to);
  const needsCityWord = unblocking || req.to === 'applied';

  if (needsCityWord) {
    const w = req.cityWord;
    if (!w) {
      refusals.push(
        `Moving to "${req.to}" means the city told somebody something. Record who said it, when, and what.`,
      );
    } else {
      if (isBlank(w.contactName)) {
        refusals.push('Name the person at the city. A department is not a person.');
      }
      if (isBlank(w.note)) {
        refusals.push('Write down what the city actually said.');
      }
      const said = Date.parse(w.saidOnIso);
      if (Number.isNaN(said)) {
        refusals.push('Record the date the city said it.');
      }
      if (isBlank(w.reference) && w.noReferenceIssued !== true) {
        refusals.push(
          'No city reference number. If they genuinely issued none, say so explicitly — a blank is not the same as "none given".',
        );
      }
    }
  }

  // Walking BACK from an unblocking state is allowed — permits do get pulled,
  // and a system that cannot record that forces the truth out of the app. But
  // it is never silent: the crew may have been cleared on the old state.
  if (UNBLOCKING.includes(req.from) && !UNBLOCKING.includes(req.to)) {
    if (isBlank(req.cityWord?.note)) {
      refusals.push(
        `This permit currently clears the crew to work ("${req.from}"). Taking that away needs a note saying why.`,
      );
    }
  }

  if (refusals.length > 0) return { ok: false, refusals };

  const w = req.cityWord;
  // The stored note carries the whole chain of custody, because six months
  // later "approved" on its own is not evidence of anything.
  const notes = w
    ? `${req.to} — recorded by ${req.author.name}. City: ${w.contactName} on ${w.saidOnIso}. ` +
      `Ref: ${w.reference ?? 'none issued'}. "${w.note}"`
    : `${req.to} — recorded by ${req.author.name}.`;

  return {
    ok: true,
    move: {
      permitId: req.permitId,
      to: req.to,
      patch: { ...(w?.reference ? { formRef: w.reference } : {}), notes },
    },
  };
}

/**
 * A structural check on the real path, not a comment asking someone to
 * remember: if `crewMayStart` ever gains a third state that lets work begin,
 * `UNBLOCKING` here would quietly stop matching it and the hardest evidence
 * bar in the system would apply to two of three doors.
 *
 * Injected rather than imported so this module stays pure; the API handler
 * passes the real gate.
 */
export function assertUnblockingSetMatchesGate(
  gate: (p: { screenStatus: 'PERMIT_LIKELY'; inRpa: boolean; status: PermitLifecycle }) => { mayStart: boolean },
): void {
  for (const status of ALL_STATES) {
    const opens = gate({ screenStatus: 'PERMIT_LIKELY', inRpa: true, status }).mayStart;
    if (opens !== UNBLOCKING.includes(status)) {
      throw new Error(
        `clearance: "${status}" ${opens ? 'opens' : 'blocks'} the crew gate but UNBLOCKING says otherwise — ` +
        'the evidence bar and the gate have drifted (§6B.3)',
      );
    }
  }
}
