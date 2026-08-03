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
// Lead-quality read (brief §3.14). A QUIET, behind-the-scenes priority hint
// (hot / warm / cool) so Mike's limited afternoon estimate slots go to the leads
// most likely to book. It is only a hint — Mike always decides, ARBOR never says
// anything dismissive to a customer or refuses service based on it. Weighting is
// adjustable and learns from real outcomes later (ties to the §7A loop).

export type LeadPriority = 'hot' | 'warm' | 'cool';

export interface LeadSignals {
  inServiceArea?: boolean;
  tightZipCluster?: boolean; // fits an existing ZIP cluster
  scopeClarity?: 'specific' | 'vague' | 'unknown'; // "two oaks over the house" vs "just curious"
  urgency?: 'emergency' | 'storm' | 'soon' | 'flexible' | 'unknown';
  respondedToCallback?: boolean;
  gaveAddress?: boolean;
  agreedToTime?: boolean;
  priceOnlyPressure?: boolean; // repeatedly pushing for a phone number, refusing a look
  // NEUTRAL-to-positive per §3.14 — a responsible buyer gets 3–4 quotes.
  mentionedOtherQuotes?: boolean;
}

export interface LeadQualityResult {
  priority: LeadPriority;
  score: number;
  reasons: string[];
}

// Tunable weights (Settings / white-label; defaults here).
export const LEAD_WEIGHTS = {
  emergencyOrStorm: 5,
  specificScope: 2,
  vagueScope: -2,
  inArea: 1,
  tightZip: 2,
  responded: 1,
  gaveAddress: 1,
  agreedToTime: 1,
  priceOnlyPressure: -2,
  hotThreshold: 5,
  warmThreshold: 1,
} as const;

export function scoreLead(s: LeadSignals): LeadQualityResult {
  const reasons: string[] = [];
  let score = 0;
  const add = (pts: number, why: string) => { score += pts; reasons.push(`${pts >= 0 ? '+' : ''}${pts} ${why}`); };

  if (s.urgency === 'emergency' || s.urgency === 'storm') add(LEAD_WEIGHTS.emergencyOrStorm, 'urgent/storm — high intent');
  if (s.scopeClarity === 'specific') add(LEAD_WEIGHTS.specificScope, 'specific, real scope');
  if (s.scopeClarity === 'vague') add(LEAD_WEIGHTS.vagueScope, 'vague / just-curious scope');
  if (s.inServiceArea) add(LEAD_WEIGHTS.inArea, 'in service area');
  if (s.tightZipCluster) add(LEAD_WEIGHTS.tightZip, 'fits an existing ZIP cluster');
  if (s.respondedToCallback) add(LEAD_WEIGHTS.responded, 'responsive');
  if (s.gaveAddress) add(LEAD_WEIGHTS.gaveAddress, 'gave an address');
  if (s.agreedToTime) add(LEAD_WEIGHTS.agreedToTime, 'agreed to a time');
  // Only *repeated* price pressure while refusing a look is a soft cool signal —
  // and ARBOR still never quotes by phone (hard guardrail elsewhere).
  if (s.priceOnlyPressure) add(LEAD_WEIGHTS.priceOnlyPressure, 'price-only pressure, refusing a look');

  // §3.14: "shopping around / multiple quotes" is explicitly NEUTRAL. It does
  // NOT change the score — recorded as context only, never a down-rank.
  if (s.mentionedOtherQuotes) reasons.push('note: getting multiple quotes — normal serious-buyer behavior (neutral)');

  const priority: LeadPriority =
    score >= LEAD_WEIGHTS.hotThreshold ? 'hot' : score >= LEAD_WEIGHTS.warmThreshold ? 'warm' : 'cool';
  return { priority, score, reasons };
}
