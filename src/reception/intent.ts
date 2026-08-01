// Caller-intent classification (brief §3.7 spam, §3.8 wants-human, §3.9
// incident/upset, §3.26 spam defense). Deterministic and driven by the
// guardrail policy (single source of truth). Precedence is safety-first:
// injury and tree-emergencies outrank everything; spam is last and is biased
// HARD toward never dropping a real customer.

import type { Guardrails } from '../config/guardrails.schema.js';
import { detectEmergency } from './emergency.js';

export type CallIntent = 'emergency' | 'incident' | 'wants_human' | 'spam' | 'normal';
export type IncidentType = 'injury' | 'damage' | 'angry';

export interface IntentResult {
  intent: CallIntent;
  reason: string;
  incidentType?: IncidentType;
  /** True when this must NOT become a normal lead (spam) or must fast-track (incident/emergency). */
  highPriority: boolean;
}

const hasAny = (text: string, phrases: string[]): string | null => {
  const t = text.toLowerCase();
  for (const p of phrases) if (t.includes(p.toLowerCase())) return p;
  return null;
};

// Signals that this is a real tree-service customer — used to VETO a spam
// classification (§3.7/§3.26: never treat a real customer as spam).
const CUSTOMER_SIGNALS = [
  'tree', 'trees', 'oak', 'pine', 'limb', 'branch', 'stump', 'trim', 'prune',
  'removal', 'remove', 'cut down', 'estimate', 'quote', 'yard', 'backyard',
  'front yard', 'property', 'storm', 'leaning', 'fell', 'fallen', 'hazard', 'brush',
];

export function detectIntent(text: string, g: Guardrails): IntentResult {
  const routing = g.callRouting;

  // 1. Injury — highest priority. Incident AND emergency-speed (§3.9).
  const injury = hasAny(text, routing.incident.triggers.injury);
  if (injury) {
    return { intent: 'incident', incidentType: 'injury', reason: `injury mentioned ("${injury}")`, highPriority: true };
  }

  // 2. Tree emergency (on a house/car/line, etc.).
  const em = detectEmergency(text);
  if (em.isEmergency) {
    return { intent: 'emergency', reason: em.reason ?? 'emergency', highPriority: true };
  }

  // 3. Property damage caused by the crew.
  const damage = hasAny(text, routing.incident.triggers.damage);
  if (damage) {
    return { intent: 'incident', incidentType: 'damage', reason: `property damage ("${damage}")`, highPriority: true };
  }

  // 4. Genuinely angry/upset caller.
  const angry = hasAny(text, routing.incident.triggers.angry);
  if (angry) {
    return { intent: 'incident', incidentType: 'angry', reason: `upset caller ("${angry}")`, highPriority: true };
  }

  // 5. Wants a human / Mike directly.
  const human = hasAny(text, routing.wantsHuman.triggers);
  if (human) {
    return { intent: 'wants_human', reason: `asked for a person ("${human}")`, highPriority: true };
  }

  // 6. Spam / solicitation — ONLY if a solicitor phrase is present AND there's
  // no sign this is a real customer. Bias: ambiguous → treat as a customer.
  const solicitor = hasAny(text, routing.spam.solicitorTriggers);
  if (solicitor && !hasAny(text, CUSTOMER_SIGNALS)) {
    return { intent: 'spam', reason: `solicitation ("${solicitor}")`, highPriority: false };
  }

  // 7. Normal lead.
  return { intent: 'normal', reason: 'normal inquiry', highPriority: false };
}
