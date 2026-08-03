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
// MISS UTILITY MARKINGS — remembered, drawn dotted, and NEVER a live locate.
//
// LIVES IN src/permitting/ ON MIKE'S INSTRUCTION, 2026-08-03: "i want this to
// be a the permitting part". It belongs here on the merits too — permitting is
// the "what has to happen before anyone touches this property" domain, and the
// 811 call is the underground half of the question the CBPA screen answers
// above ground. digPermit.ts joins the two into one answer.
//
// MIKE'S INSTRUCTION, 2026-08-03, verbatim:
//   "addionally all that miss utitly marking would be store and though dtted
//    its not to be treated as the same thing but itll let ya know if you
//    really got to waste the time and call them gain casue tyou dont remember
//    and the homeowner its a duts"
//
// Read plainly: keep every locate marking we have ever seen on a property.
// Draw it DOTTED. It is NOT the same thing as a current locate. What it buys
// you is knowing whether you actually have to burn the time calling 811
// again — because you cannot remember, and the homeowner is not a reliable
// witness.
//
// ─────────────────────────────────────────────────────────────────────────
// THE ONE RULE THIS FILE CANNOT BEND
// ─────────────────────────────────────────────────────────────────────────
// A remembered marking is a MEMORY. It is not permission to put steel in the
// ground. Utilities get moved, added, and re-routed, paint fades, and a
// homeowner's "oh they marked it last year" is worth nothing.
//
// So this module is built the same way the permit screen is built (§6B.3):
// it is STRUCTURALLY INCAPABLE of clearing anyone to dig.
//
//   * `MarkingRender` has exactly ONE value — 'historical_dotted'. There is
//     no 'current' and no 'solid'. A stored marking cannot be rendered as a
//     live locate because no such state exists to render.
//   * `digStanding()` returns 'call_811' or 'ticket_on_file_verify'. There is
//     no 'clear' member, exactly like ScreenStatus has no 'clear' member.
//   * `assertNeverClearToDig()` throws on any line that implies otherwise,
//     and reuses the permit engine's FORBIDDEN_CLEAR so both surfaces answer
//     to one definition.
//
// Mike's own words are the design brief here: "its not to be treated as the
// same thing". This file is that sentence in code.

import { FORBIDDEN_CLEAR } from '../permitting/screening.js';

/**
 * APWA uniform colour code. Kept as the vocabulary because it is what is
 * actually sprayed on the ground, and a crew reading "orange" needs the same
 * word the locator used.
 */
export type UtilityKind =
  | 'electric'            // red
  | 'gas_oil_steam'       // yellow
  | 'communications'      // orange
  | 'potable_water'       // blue
  | 'reclaimed_water'     // purple
  | 'sewer_drain'         // green
  | 'survey'              // pink
  | 'proposed_excavation' // white
  | 'unknown';

export const UTILITY_COLOR: Record<UtilityKind, string> = {
  electric: 'red',
  gas_oil_steam: 'yellow',
  communications: 'orange',
  potable_water: 'blue',
  reclaimed_water: 'purple',
  sewer_drain: 'green',
  survey: 'pink',
  proposed_excavation: 'white',
  unknown: 'unrecorded',
};

export const UTILITY_LABEL: Record<UtilityKind, string> = {
  electric: 'Electric',
  gas_oil_steam: 'Gas / oil / steam',
  communications: 'Communications',
  potable_water: 'Potable water',
  reclaimed_water: 'Reclaimed water',
  sewer_drain: 'Sewer / drain',
  survey: 'Survey',
  proposed_excavation: 'Proposed excavation',
  unknown: 'Unidentified marking',
};

/**
 * The ONLY way a stored marking can be drawn. One member, on purpose.
 *
 * If a future change wants a "current" style, that is not a style change —
 * it is a decision that Arbo now tells people a locate is live, and it needs
 * Mike and a much harder look than a rendering tweak.
 */
export type MarkingRender = 'historical_dotted';
export const MARKING_RENDER: MarkingRender = 'historical_dotted';

export interface UtilityMarking {
  id: string;
  kind: UtilityKind;
  /** Where the paint / flags ran, in plain words. */
  where: string;
  /** When it was marked. Null = we kept the marking but not the date. */
  markedOn: string | null;
  /** The 811 ticket it came off, when we know it. */
  ticketNumber: string | null;
  /** Who wrote this down on our side. Null = unattributed record. */
  recordedBy: string | null;
  photoRefs: string[];
  lat: number | null;
  lng: number | null;
  /** Depth if the locator gave one. Locates are horizontal — depth is a bonus. */
  approxDepthInches: number | null;
  notes: string | null;
}

/**
 * An 811 ticket as we recorded it.
 *
 * `validThrough` is NULLABLE and nothing computes it. Ticket life is set by
 * the one-call centre and the state's damage-prevention rules, and guessing
 * an expiry date is the kind of confident wrong answer that ends with a crew
 * hitting a gas line. If nobody typed the date off the ticket, we do not know
 * it, and `digStanding()` treats not-knowing as "call again".
 */
export interface LocateTicket {
  id: string;
  ticketNumber: string;
  requestedOn: string;
  /** Read off the ticket by a person. Never derived. */
  validThrough: string | null;
  /** Who requested it. */
  requestedBy: string | null;
  notes: string | null;
}

export interface RenderedMarking {
  id: string;
  label: string;
  color: string;
  render: MarkingRender;
  /** Age in days, or null when the marking carries no date. */
  ageDays: number | null;
  line: string;
}

const DAY = 86_400_000;

function daysBetween(fromIsoDate: string, toIsoDate: string): number | null {
  const a = Date.parse(`${fromIsoDate}T00:00:00Z`);
  const b = Date.parse(`${toIsoDate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY);
}

/**
 * Shape a stored marking for a screen. Always dotted, always described as a
 * remembered marking, always carrying its age so nobody reads a three-year-old
 * paint line as last week's.
 */
export function renderMarking(m: UtilityMarking, todayEt: string): RenderedMarking {
  const ageDays = m.markedOn ? daysBetween(m.markedOn, todayEt) : null;
  const label = UTILITY_LABEL[m.kind];
  const color = UTILITY_COLOR[m.kind];
  const age = ageDays === null
    // No date is worse than an old date, and must not look better than one.
    ? 'date not recorded'
    : ageDays < 0
      ? `dated ${m.markedOn} (in the future — check that date)`
      : `${ageDays} day(s) old`;
  return {
    id: m.id,
    label,
    color,
    render: MARKING_RENDER,
    ageDays,
    line: `${label} (${color}) — ${m.where}. Remembered marking, ${age}. Not a live locate.`,
  };
}

/**
 * The two answers. There is deliberately no third one meaning "you're fine".
 *
 * 'call_811'               — the honest default, and where every uncertain
 *                            case lands.
 * 'ticket_on_file_verify'  — a person typed a validity date off a real ticket
 *                            and it has not passed. Even this one says VERIFY,
 *                            because the app is not the one-call centre.
 */
export type DigStatus = 'call_811' | 'ticket_on_file_verify';

export interface DigStanding {
  status: DigStatus;
  /** ALWAYS true. Nothing here ever authorises breaking ground. */
  verifyBeforeDigging: true;
  line: string;
  /** The remembered markings, dotted, worst-informed first. */
  markings: RenderedMarking[];
  /** Why we are saying what we are saying. */
  reason: string;
}

/**
 * "Do I really have to call them again?" — Mike's actual question, answered.
 *
 * The answer is YES unless a person recorded a ticket with a validity date
 * that has not passed. Even then it is "there is a ticket, confirm it", never
 * "go ahead". Remembered markings never move this answer; they are context
 * for the call, which is exactly what Mike asked them to be.
 */
export function digStanding(input: {
  markings: UtilityMarking[];
  tickets: LocateTicket[];
  todayEt: string;
}): DigStanding {
  const markings = input.markings
    .map((m) => renderMarking(m, input.todayEt))
    // Undated markings first: they are the least trustworthy and the easiest
    // to over-read, so they go where they will actually be seen.
    .sort((a, b) => {
      if (a.ageDays === null && b.ageDays !== null) return -1;
      if (b.ageDays === null && a.ageDays !== null) return 1;
      return (b.ageDays ?? 0) - (a.ageDays ?? 0);
    });

  const live = input.tickets.filter((t) => {
    if (!t.validThrough) return false;
    const d = daysBetween(input.todayEt, t.validThrough);
    return d !== null && d >= 0;
  });

  if (live.length > 0) {
    const t = live[0]!;
    return {
      status: 'ticket_on_file_verify',
      verifyBeforeDigging: true,
      line: `Ticket ${t.ticketNumber} is on file and recorded as good through ${t.validThrough}. Confirm it is still live with Miss Utility before anything goes in the ground — this app is not the one-call centre.`,
      markings,
      reason: 'a person recorded a ticket validity date that has not passed',
    };
  }

  const expired = input.tickets.filter((t) => t.validThrough).length;
  const undated = input.tickets.length - expired;

  let reason: string;
  if (input.tickets.length === 0) {
    reason = markings.length > 0
      ? 'we remember markings here but have no ticket on file'
      : 'nothing on file for this property';
  } else if (expired > 0 && undated === 0) {
    reason = 'every ticket on file has run out';
  } else if (undated > 0 && expired === 0) {
    reason = 'the ticket(s) on file have no validity date recorded, so we cannot say they are live';
  } else {
    reason = 'the tickets on file are either expired or have no validity date recorded';
  }

  return {
    status: 'call_811',
    verifyBeforeDigging: true,
    line: markings.length > 0
      // This is the sentence Mike actually asked for: the memory saves the
      // guesswork, not the phone call.
      ? `Call Miss Utility. We remember ${markings.length} marking(s) here from before — useful for knowing what is down there, but they are not a locate and they do not stand in for one.`
      : 'Call Miss Utility. Nothing remembered on this property, so there is nothing to go on but the call.',
    markings,
    reason,
  };
}

/**
 * Structural assertion — the sibling of assertNeverClear() in screening.ts
 * and assertFlagsNeverClear() in propertyFlags.ts.
 *
 * Proves nothing this module produces can read as permission to dig. Call it
 * before rendering. It throws; a thrown error is a cheaper failure than a
 * crew trusting a three-year-old paint line.
 */
const FORBIDDEN_DIG = /\b(safe to dig|clear to dig|ok to dig|no need to call|don'?t need to call|skip the call|already located|good to dig)\b/i;

export function assertNeverClearToDig(s: DigStanding): void {
  if (s.verifyBeforeDigging !== true) {
    throw new Error('a dig standing must always require verification');
  }
  const lines = [s.line, ...s.markings.map((m) => m.line)];
  for (const line of lines) {
    if (FORBIDDEN_DIG.test(line)) {
      throw new Error(`dig standing implied permission to excavate — forbidden: ${line}`);
    }
    if (FORBIDDEN_CLEAR.test(line)) {
      throw new Error(`dig standing implied a "clear" — forbidden (§6B.3): ${line}`);
    }
  }
  for (const m of s.markings) {
    // Belt and braces on the one thing Mike named explicitly. If a marking
    // ever renders as anything but dotted, that is the rule broken.
    if (m.render !== 'historical_dotted') {
      throw new Error(`a remembered marking must render dotted, never as a live locate: ${m.id}`);
    }
  }
}
