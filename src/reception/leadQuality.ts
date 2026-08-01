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
