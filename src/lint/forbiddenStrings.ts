// Forbidden-string guard (brief §12). Two mistakes must be structurally
// impossible to ship in CUSTOMER-FACING text:
//   - "Suffolk" — a city Art-is-Tree does NOT serve and must never mention.
//   - "TCIA"    — a lapsed credential; claiming it is a false credential.
//
// Precision matters: internal policy descriptions legitimately NAME these terms
// as the thing to avoid ("Never claim TCIA", "Suffolk is excluded"). Those are
// instructions to the system, not words spoken to a customer. So this guard
// scans an EXPLICIT allow-list of the strings the AI actually says / sends —
// not the whole config. (See DECISIONS D7.)

import type { Guardrails } from '../config/guardrails.schema.js';
import type { LegalConfig } from '../config/legal.schema.js';

export const FORBIDDEN = [
  { term: 'Suffolk', reason: 'Suffolk is not in the service area (§2) and must never be mentioned.' },
  { term: 'TCIA', reason: 'TCIA lapsed (~July 2026); claiming it is a false credential (§2, §3.1).' },
] as const;

export interface ForbiddenHit {
  term: string;
  reason: string;
  where: string;
  excerpt: string;
}

/** Scan an arbitrary string for forbidden terms (word-bounded, case-insensitive). */
export function scanForbidden(text: string, label = 'text'): ForbiddenHit[] {
  const hits: ForbiddenHit[] = [];
  for (const { term, reason } of FORBIDDEN) {
    const re = new RegExp(`\\b${term}\\b`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = Math.max(0, m.index - 30);
      const end = Math.min(text.length, m.index + term.length + 30);
      hits.push({ term, reason, where: label, excerpt: `…${text.slice(start, end)}…` });
    }
  }
  return hits;
}

/** The exact set of guardrail strings the AI SAYS to a customer. */
export function guardrailsCustomerFacingStrings(g: Guardrails): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = [];
  out.push({ label: 'serviceArea.outOfAreaPivot', text: g.serviceArea.outOfAreaPivot });
  for (const r of g.goldenRules) out.push({ label: `goldenRules.${r.id}.approvedLine`, text: r.approvedLine });
  out.push({ label: 'personality.askedHadWorkBefore.question', text: g.personality.askedHadWorkBefore.question });
  g.leadQualification.questions.forEach((q, i) => out.push({ label: `leadQualification.questions[${i}]`, text: q }));
  return out;
}

/** The exact set of legal/compliance strings sent or spoken to a customer. */
export function legalCustomerFacingStrings(l: LegalConfig): Array<{ label: string; text: string }> {
  return [
    { label: 'callRecordingAndAiDisclosure.disclosureLine', text: l.callRecordingAndAiDisclosure.disclosureLine },
    { label: 'tcpa.optOut.instructionText', text: l.tcpa.optOut.instructionText },
    { label: 'tcpa.businessIdentityInFirstMessage', text: l.tcpa.businessIdentityInFirstMessage },
  ];
}

export function scanGuardrailsCustomerFacing(g: Guardrails): ForbiddenHit[] {
  return guardrailsCustomerFacingStrings(g).flatMap(({ label, text }) => scanForbidden(text, label));
}

export function scanLegalCustomerFacing(l: LegalConfig): ForbiddenHit[] {
  return legalCustomerFacingStrings(l).flatMap(({ label, text }) => scanForbidden(text, label));
}
