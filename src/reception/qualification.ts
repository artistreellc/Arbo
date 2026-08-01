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
