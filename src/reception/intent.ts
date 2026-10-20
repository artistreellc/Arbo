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
import { detectCallerLanguage, type CallerLanguage } from './language.js';

export type CallIntent = 'emergency' | 'incident' | 'wants_human' | 'spam' | 'normal';
export type IncidentType = 'injury' | 'damage' | 'angry';

export interface IntentResult {
  intent: CallIntent;
  reason: string;
  incidentType?: IncidentType;
  /** True when this must NOT become a normal lead (spam) or must fast-track (incident/emergency). */
  highPriority: boolean;
  /**
   * R26: 'es' when the caller's words are Spanish (language.ts), so the owner
   * sees "Spanish speaker". Absent otherwise. Flag only — it changes no
   * routing and no reply.
   */
  language?: CallerLanguage;
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
  const result = classifyIntent(text, g);
  const language = detectCallerLanguage(text);
  return language ? { ...result, language } : result;
}

/**
 * R26 — the CALLER asking what Art-is-Tree holds: "are you TCIA?", "is Mike
 * ISA certified?", "you guys licensed and insured?", "do you carry
 * insurance?". The receptionist answers with Mike's credential line rather
 * than letting the model's reply — which may name TCIA and trip the guard
 * into the off-topic line, or agree to a credential not held — be spoken.
 * Their OWN insurance ("will my insurance pay?", "thank you, my house is
 * insured", "do you work with insurance companies?") is a different
 * question and is not matched — the credential word must describe US.
 */
const CREDENTIAL = '(?:certified|accredited|licensed|insured|bonded)';
const CREDENTIAL_ASK: RegExp[] = [
  /\bT\.?C\.?I\.?A\b/i,
  /\bISA\b/, // case-sensitive: "Isa" is a first name
  /\bI\.S\.A\b/, // the dotted spelling, case-sensitive for the same reason
  new RegExp(`\\bare (?:you|y'?all|your (?:guys|crews?|workers|climbers|people))(?: guys)?\\b[^.!?]{0,30}\\b${CREDENTIAL}\\b`, 'i'),
  new RegExp(`\\bis (?:mike|he|your (?:company|crew|business)|the (?:company|crew|business))\\b[^.!?]{0,30}\\b${CREDENTIAL}\\b`, 'i'),
  new RegExp(`\\b(?:you|y'?all)(?: guys)?(?:'re| are)\\b[^.!?]{0,20}\\b${CREDENTIAL}\\b`, 'i'),
  new RegExp(`\\byou (?:guys )?${CREDENTIAL}\\b`, 'i'),
  // What WE hold: only words that describe our own coverage may sit between
  // "have" and the noun, and a claim / company / adjuster after it is the
  // caller's own insurance ("do you have experience with insurance claims?").
  /\b(?:do|does) (?:you|y'?all|mike|the company|your company)(?: guys)? (?:have|carry) (?:(?:a|an|any|your own|valid|current|general|liability|commercial|business|contractor'?s?|workers'? comp(?:ensation)?|proof of|certificates? of|(?:kind|type)s? of) )*(?:insurance|licen[cs]es?|certifications?|credentials?|accreditations?)\b(?!\s+(?:claims?|compan(?:y|ies)|adjusters?|agents?|polic(?:y|ies)))/i,
  /\bwhat (?:certifications?|credentials?|accreditations?)\b/i,
  // A certified arborist on OUR side ("do you have a certified arborist?",
  // "is your arborist certified?") — not one the caller needs ("my HOA says
  // I need a certified arborist letter", "do you have to use a certified
  // arborist?", "is the city going to require a certified arborist report?").
  /\b(?:do|does) (?:you|y'?all|mike|the company|your company)(?: guys)? (?:have|employ|use|send)\b(?! to\b)[^.!?]{0,25}\b(?:certified|ISA|I\.S\.A\.?)\s*arborists?\b(?!\s+(?:reports?|letters?|requirements?))/i,
  /\bis (?:there|your)\b[^.!?]{0,30}\b(?:certified|ISA)\s+arborists?\b(?!\s+(?:reports?|letters?|requirements?))/i,
  /\b(?:is|are) (?:your|the) (?:arborists?|guys?|person|estimator)\b[^.!?]{0,30}\b(?:certified|ISA)\b/i,
];

export function isCredentialQuestion(text: string): boolean {
  return CREDENTIAL_ASK.some((re) => re.test(text));
}

function classifyIntent(text: string, g: Guardrails): IntentResult {
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
