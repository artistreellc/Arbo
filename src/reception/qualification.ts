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
// Lead qualification state (brief §3.3). Tracks what we've captured and what to
// ask next, so every inbound job leaves with a clean, complete lead.

import { resolveServiceCity, type ServiceCity } from '../lib/address.js';

export type QualField =
  | 'name'
  | 'address'
  | 'city'
  | 'phone'
  | 'treeInfo'
  | 'proximityStructure'
  | 'proximityPowerLines'
  | 'jobType'
  | 'hadWorkBefore';

export interface QualState {
  name?: string;
  address?: string;
  city?: ServiceCity;
  phone?: string;
  treeInfo?: string; // type / rough size
  proximityStructure?: string; // how close to house/structures
  proximityPowerLines?: string; // how close to power lines (red flag)
  jobType?: string; // removal | trim | stump | cleanup | not sure
  hadWorkBefore?: boolean;
}

// Ordered so the conversation flows naturally. `required` fields must all be
// captured before the lead is complete.
export const QUAL_FIELDS: Array<{ key: QualField; question: string; required: boolean }> = [
  { key: 'name', question: 'Can I get your name?', required: true },
  { key: 'address', question: "What's the property address?", required: true },
  { key: 'phone', question: "What's the best phone number to reach you?", required: true },
  { key: 'jobType', question: 'Is this a removal, a trim, stump grinding, cleanup, or are you not sure yet?', required: true },
  { key: 'treeInfo', question: 'What kind of tree is it, and roughly how big?', required: true },
  { key: 'proximityStructure', question: 'How close is it to the house or any other structures?', required: true },
  { key: 'proximityPowerLines', question: 'And how close is it to any power lines?', required: true },
  { key: 'hadWorkBefore', question: 'Have you had tree work done before?', required: false },
];

/** Apply a captured answer. `address` also resolves the served city. */
export function capture(state: QualState, key: QualField, value: string | boolean): QualState {
  const next = { ...state };
  if (key === 'hadWorkBefore') {
    next.hadWorkBefore = typeof value === 'boolean' ? value : /\b(yes|yeah|yep|before|have)\b/i.test(String(value));
  } else if (key === 'address') {
    next.address = String(value);
    const c = resolveServiceCity(extractCity(String(value)));
    if (c) next.city = c;
  } else if (key === 'city') {
    const c = resolveServiceCity(String(value));
    if (c) next.city = c;
  } else {
    (next as Record<string, unknown>)[key] = String(value);
  }
  return next;
}

/** The next required question to ask, or null when qualification is complete. */
export function nextQuestion(state: QualState): string | null {
  for (const f of QUAL_FIELDS) {
    if (!f.required) continue;
    if (state[f.key] === undefined || state[f.key] === '') return f.question;
  }
  return null;
}

export function isComplete(state: QualState): boolean {
  return nextQuestion(state) === null;
}

/** True if the caller's answer flags a power line — the §3.3 red flag. */
export function powerLineRedFlag(state: QualState): boolean {
  return Boolean(state.proximityPowerLines && !/\b(no|none|not|nowhere|far)\b/i.test(state.proximityPowerLines));
}

/** Build the qualification JSON stored on the lead. */
export function toQualificationJson(state: QualState): Record<string, unknown> {
  return {
    treeInfo: state.treeInfo ?? null,
    jobType: state.jobType ?? null,
    proximityStructure: state.proximityStructure ?? null,
    proximityPowerLines: state.proximityPowerLines ?? null,
    powerLineRedFlag: powerLineRedFlag(state),
    hadWorkBefore: state.hadWorkBefore ?? null,
  };
}

function extractCity(address: string): string | undefined {
  const parts = address.split(',').map((s) => s.trim());
  // Common "street, City, VA zip" — city is usually the 2nd-to-last or middle part.
  for (const p of parts) if (resolveServiceCity(p)) return p;
  return parts.length >= 2 ? parts[1] : undefined;
}
