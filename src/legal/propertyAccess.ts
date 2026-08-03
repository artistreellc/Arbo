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
// THE PRIVATE PROPERTY ACCESS LETTER — the neighbour's permission to cross
// their land, and the record that they gave it.
//
// Mike, 2026-08-03: "there will be a bo[tt]on that leads to a pre written
// private property acces letter that all the neiighbor has to do is gve email
// and press accept this can be sent out with a simple approval page or it can
// be completely in app if its done on a crew members phone".
//
// ─────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE DOES AND DOES NOT DO — READ BEFORE ADDING TO IT
// ─────────────────────────────────────────────────────────────────────────
// Mike named three delivery routes: email it, an approval page, or straight
// through on a crew member's phone. This file builds the LETTER and records
// the ACCEPTANCE. It does not send anything, and it has no email client.
//
//   * "Never send email. Ever." is a hard boundary in CLAUDE.md, and R7 puts
//     Resend and the website out of scope entirely.
//   * So the crew-phone route works completely, today: the crew member shows
//     the letter on the screen, the neighbour types their email and taps
//     accept, and the acceptance is recorded on the spot.
//   * The approval-page route works the moment a link reaches the neighbour —
//     the page and the token are here. WHAT CARRIES THAT LINK IS MIKE'S CALL,
//     not something to solve by quietly wiring a mailer. `deliveryOptions()`
//     below returns emailSend: false, typed as the literal `false`, so no
//     caller can flip it without changing this file on purpose.
//
// THE OTHER THING THIS FILE IS CAREFUL ABOUT. A consent record that says
// "they accepted" without saying WHAT they accepted is worth nothing the day
// it matters. Every acceptance stores a hash of the exact letter text on the
// screen at the time, so editing the template later cannot retroactively put
// different words in the neighbour's mouth.

import { createHash } from 'node:crypto';

import type { Guardrails } from '../config/guardrails.schema.js';
import { guardReply, type GuardViolation } from '../reception/outputGuard.js';

export interface AccessLetterInput {
  /** The work site — the customer's address, not the neighbour's. */
  jobAddress: string;
  /** The neighbour's address, when the crew knows it. */
  neighborAddress: string | null;
  /**
   * Why access is needed, in the crew's own words ("the rear limb overhangs
   * your side and the drop zone is your lawn"). A human writes this. Arbo
   * never generates it — that would be Arbo describing a tree.
   */
  reason: string;
  /** Plain-words window, e.g. "the week of the 12th". Never a promised date. */
  requestedWindow: string | null;
  /** Callback number printed on the letter. */
  contactPhone: string;
}

export const COMPANY_NAME = 'Art-is-Tree LLC';

/**
 * The pre-written letter. Fixed words, human-supplied slots.
 *
 * Deliberately absent, and each for a rule already in code:
 *   * no figure of any kind        — §3, Arbo never prices
 *   * no statement about the tree's condition — never diagnose
 *   * no date, only a window in the customer's words — never promise a date
 *   * no certification or licence claim — never claim a credential
 *   * no indemnity or liability language — that is a lawyer's text, not mine,
 *     and inventing it would be the worst kind of confident guess. If Mike
 *     wants a hold-harmless clause it comes from his attorney and gets pasted
 *     in here verbatim.
 */
export function composeAccessLetter(input: AccessLetterInput): string {
  const lines: string[] = [];
  lines.push('PERMISSION TO ENTER — NEIGHBOURING PROPERTY');
  lines.push('');
  lines.push(`${COMPANY_NAME} has been hired to carry out tree work at ${input.jobAddress}.`);
  if (input.neighborAddress) {
    lines.push(`To do that work safely we are asking permission to enter ${input.neighborAddress}.`);
  } else {
    lines.push('To do that work safely we are asking your permission to enter your property.');
  }
  lines.push('');
  lines.push('WHY WE NEED TO CROSS YOUR PROPERTY');
  lines.push(input.reason.trim());
  lines.push('');
  lines.push('WHEN');
  lines.push(
    input.requestedWindow?.trim()
      ? `We are asking for access around ${input.requestedWindow.trim()}. We will confirm with you before anyone steps on your property.`
      : 'We do not have the timing fixed yet. We will confirm with you before anyone steps on your property.',
  );
  lines.push('');
  lines.push('WHAT YOU ARE AGREEING TO');
  lines.push('You are giving the crew permission to be on your property to do this work, and nothing else.');
  lines.push('You can withdraw this permission at any time by telling the crew or calling the number below.');
  lines.push('Accepting this does not make you responsible for the work or for paying for any of it.');
  lines.push('');
  lines.push(`Questions, or to withdraw permission: ${input.contactPhone}`);
  return lines.join('\n');
}

export type LetterResult =
  | { ok: true; letter: string; hash: string }
  | { ok: false; violations: GuardViolation[]; message: string };

/**
 * Compose and then CHECK. The template is safe by construction; `reason` and
 * `requestedWindow` are free text a crew member typed on a phone, and free
 * text is where a price or a diagnosis gets into a document that a neighbour
 * then keeps.
 *
 * Note this uses guardReply as a DETECTOR, not as a rewriter. Its pivot line
 * is the right answer on a phone call and the wrong one in a letter — you do
 * not silently swap a paragraph of a legal document for "let's keep it to
 * your trees". A violation refuses the letter and names what to fix.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * KNOWN FALSE POSITIVE — FLAGGED FOR MIKE, NOT FIXED HERE.
 * The money screen in judgment.ts matches `(knock|take|cut) … off` as an
 * offer of a discount. In a tree crew's own words that is also a completely
 * ordinary sentence: "we need to cut the limb off over your fence". Written
 * in the reason box, that refuses the letter and cites "a discount", which
 * reads as broken to whoever is standing in the front yard.
 *
 * I am NOT loosening that pattern from here. It lives on the phone line,
 * Mike's own proof run caught real money leaks with it, and weakening a
 * money guard as a side effect of building a letter is exactly the kind of
 * adjacent decision that has cost him before. So: it fails CLOSED (a refused
 * letter is the cheap failure), the message below tells the crew how to
 * reword in one sentence, and the underlying pattern is Mike's call.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function buildAccessLetter(input: AccessLetterInput, g: Guardrails): LetterResult {
  const letter = composeAccessLetter(input);
  const guard = guardReply(letter, g);
  if (!guard.safe) {
    return { ok: false, violations: guard.violations, message: refusalMessage(guard.violations) };
  }
  return { ok: true, letter, hash: letterHash(letter) };
}

/** Plain instruction, per rule, for somebody holding a phone in a front yard. */
function refusalMessage(violations: GuardViolation[]): string {
  const advice: Record<string, string> = {
    'no-price': 'take the figure out — no letter of ours carries a price',
    'no-diagnosis': "say what access you need, not what is wrong with the tree",
    'no-financial-authority':
      'reword to describe the ACCESS rather than the cut — "the limb overhangs your side" instead of "cut the limb off" (the money screen reads "cut … off" as an offer of a discount)',
    'forbidden-term': 'that term cannot appear in anything we hand out',
  };
  const seen = [...new Set(violations.map((v) => v.rule))];
  return (
    'This letter cannot go out as written. ' +
    seen.map((r) => advice[r] ?? `fix: ${r}`).join('; ') +
    '.'
  );
}

/** Identifies the exact words accepted. Stored with every consent record. */
export function letterHash(letter: string): string {
  return createHash('sha256').update(letter, 'utf8').digest('hex');
}

/**
 * How this letter can actually reach the neighbour. `emailSend` is typed as
 * the literal `false`, not `boolean` — a caller cannot even write code that
 * expects it to be true without a type error. That is on purpose.
 */
export function deliveryOptions(): {
  crewDevice: true;
  approvalPage: true;
  emailSend: false;
  emailNote: string;
} {
  return {
    crewDevice: true,
    approvalPage: true,
    emailSend: false,
    emailNote:
      'Arbo does not send email (CLAUDE.md hard boundary; R7 keeps Resend and the site out of scope). Show the letter on the crew phone, or hand over the approval link — Mike decides what carries it.',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// ACCEPTANCE
// ─────────────────────────────────────────────────────────────────────────

export type AcceptanceChannel = 'crew_device' | 'approval_page';

export interface AcceptanceInput {
  jobId: string;
  neighborEmail: string;
  /** The hash returned by buildAccessLetter for the text actually displayed. */
  letterHash: string;
  channel: AcceptanceChannel;
  /** Who was holding the phone. Required on crew_device — see below. */
  crewMemberId: string | null;
  /** Caller-supplied so this stays pure and testable. */
  now: string;
}

export interface AccessConsent {
  jobId: string;
  neighborEmail: string;
  letterHash: string;
  channel: AcceptanceChannel;
  crewMemberId: string | null;
  acceptedAt: string;
}

export type AcceptanceResult =
  | { ok: true; consent: AccessConsent }
  | { ok: false; problem: string };

// Deliberately loose. This is a neighbour typing on someone else's phone in a
// front yard, not an account signup — a strict pattern here rejects real
// people and gains nothing, since nothing is ever sent to this address.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Record an acceptance. Refuses rather than storing something half-true —
 * a consent record that is wrong is worse than one that does not exist.
 */
export function recordAcceptance(input: AcceptanceInput): AcceptanceResult {
  const email = input.neighborEmail.trim().toLowerCase();
  if (!EMAIL.test(email)) {
    return { ok: false, problem: 'That email address does not look right — check it with them before accepting.' };
  }
  if (!input.letterHash || input.letterHash.length !== 64) {
    // No hash means we cannot say which words they agreed to, which is the
    // entire value of the record. Refuse.
    return { ok: false, problem: 'The letter that was shown was not identified, so this acceptance cannot be recorded.' };
  }
  if (input.channel === 'crew_device' && !input.crewMemberId) {
    // On the phone route there is no independent trace of the neighbour — the
    // crew member IS the witness, so the record has to name them.
    return { ok: false, problem: 'A crew-phone acceptance has to record which crew member witnessed it.' };
  }
  return {
    ok: true,
    consent: {
      jobId: input.jobId,
      neighborEmail: email,
      letterHash: input.letterHash,
      channel: input.channel,
      crewMemberId: input.crewMemberId,
      acceptedAt: input.now,
    },
  };
}

/**
 * §4.3 — no customer PII in chat output or logs. The neighbour's email is
 * exactly that, so anything that logs a consent goes through here: ids,
 * channel, and a truncated hash, and never the address itself.
 */
export function consentLogLine(c: AccessConsent): string {
  return `access-consent job=${c.jobId} channel=${c.channel} letter=${c.letterHash.slice(0, 12)} at=${c.acceptedAt}`;
}

/**
 * What the crew door shows when there is no consent on file. §1B: "nobody has
 * asked the neighbour" and "the neighbour said no" are different facts, and a
 * crew reading a blank as permission is how somebody ends up trespassing.
 */
export const NO_CONSENT_ON_FILE =
  'No neighbour permission on file for this job. That is not a no — it means nobody has asked yet. Do not cross the line until it is recorded.';

export type ConsentStanding =
  | { granted: true; line: string; acceptedAt: string }
  | { granted: false; line: string };

/**
 * The one question the crew actually needs answered before they step over the
 * line, with the three states kept apart.
 *
 * Withdrawal is not deletion. The letter promises the neighbour they can pull
 * permission at any time, so a withdrawn consent stays on file and reads as a
 * HARD no — louder than never having asked, because somebody who has already
 * said no once is somebody a crew must not walk past.
 */
export function consentStanding(c: (AccessConsent & { withdrawnAt?: string | null }) | null): ConsentStanding {
  if (!c) return { granted: false, line: NO_CONSENT_ON_FILE };
  if (c.withdrawnAt) {
    return {
      granted: false,
      line: `Permission was given and then WITHDRAWN on ${c.withdrawnAt}. Do not enter. Talk to Mike before anyone goes near that line.`,
    };
  }
  return {
    granted: true,
    line: `Neighbour permission recorded ${c.acceptedAt} (${c.channel === 'crew_device' ? 'on a crew phone' : 'via the approval page'}).`,
    acceptedAt: c.acceptedAt,
  };
}
