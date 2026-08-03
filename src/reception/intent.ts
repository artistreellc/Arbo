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
