// Permit-history mining (brief §6B / §5A #35): classify city-permit
// correspondence so recurring contacts and cases attach to properties, prior
// filings get reused, and ARBOR learns each city's formats. Pure classifier —
// the Gmail feed is injected/external (Phase 5 wires the live inbox monitor);
// this is the brain that reads a message and says what it is.
//
// Patterns are grounded in Art-is-Tree's REAL correspondence (mined
// 2026-08-01): VB PPR review letters ("Tree Removal Request, <Name> Residence,
// <address>, Accela Record: YYYY-DSC-######"), VB intake requests (PBurns),
// duplicate-PPR VOID warnings, Norfolk CBPA violation/inspection threads
// (seamus.mccarthy / Jack.Erwin), Accela payment notices.

import type { ServiceCity } from '../lib/address.js';

const CITY_DOMAINS: Array<{ domain: string; city: ServiceCity }> = [
  { domain: 'vbgov.com', city: 'Virginia Beach' },
  { domain: 'norfolk.gov', city: 'Norfolk' },
  { domain: 'cityofchesapeake.net', city: 'Chesapeake' },
  { domain: 'portsmouthva.gov', city: 'Portsmouth' },
];

// Case-reference formats seen in the real mail:
//   2025-DSC-021566   VB Accela PPR record (§6B.4)
//   2025-UTIL-10415   VB Accela utility permit
//   J04-021654-RPA    VB internal RPA reference
const CASE_REF_RE = /\b(20\d{2}-[A-Z]{3,5}-\d{4,7}|J\d{2}-\d{5,7}-RPA)\b/g;

export type PermitMailKind =
  | 'ppr_review' // a PPR review letter / decision (VB pattern)
  | 'cbpa_case' // CBPA violation/inspection correspondence (Norfolk pattern)
  | 'intake_request' // city asking for forms/photos/maps to process a filing
  | 'duplicate_warning' // duplicate record created / VOID notice (§6B.4 friction)
  | 'payment' // permit fee / payment notice
  | 'other_city_mail'; // from a city, but none of the above

export interface PermitMailInput {
  from: string;
  to?: string[];
  cc?: string[];
  subject: string;
  body: string; // snippet or full text
}

export interface PermitMailResult {
  /** True when any party is on a service-city government domain. */
  isCityCorrespondence: boolean;
  city: ServiceCity | null;
  kind: PermitMailKind | null;
  /** Every Accela/RPA case reference found, deduped, order preserved. */
  caseRefs: string[];
  /** Street address extracted from the subject, when present. */
  address: string | null;
  /** City-government addresses involved (the contacts worth remembering). */
  cityContacts: string[];
}

function cityForEmail(email: string): ServiceCity | null {
  const lower = email.toLowerCase();
  for (const { domain, city } of CITY_DOMAINS) {
    if (lower.endsWith(`@${domain}`) || lower.endsWith(`.${domain}`)) return city;
  }
  return null;
}

/** Extract deduped case refs from any text. */
export function extractCaseRefs(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(CASE_REF_RE)) {
    if (!seen.has(m[1]!)) seen.add(m[1]!);
  }
  return [...seen];
}

/**
 * Address from the VB review-letter subject pattern
 * ("…, <Name> Residence, 1220 Americus Avenue, Accela Record: …") or a plain
 * street-address subject ("8562 Circle drive", "1211 South Fairwater Dr").
 */
export function extractSubjectAddress(subject: string): string | null {
  const residence = subject.match(/Residence,\s*([^,]+?),\s*Accela Record/i);
  if (residence) return residence[1]!.trim();
  // Street-type must be a standalone word (a leading \s guard) — otherwise
  // "Ter" matches inside "Fairwater" and truncates the capture.
  const plain = subject.match(/\b(\d{1,6}\s+[A-Za-z][A-Za-z.' ]*?\s(?:Ave(?:nue)?|St(?:reet)?|Dr(?:ive)?|Rd|Road|Ln|Lane|Ct|Court|Blvd|Cir(?:cle)?|Arch|Way|Pl(?:ace)?|Ter(?:race)?))\b/i);
  return plain ? plain[1]!.trim() : null;
}

export function classifyPermitMail(input: PermitMailInput): PermitMailResult {
  const parties = [input.from, ...(input.to ?? []), ...(input.cc ?? [])];
  const cityContacts = parties.filter((p) => cityForEmail(p) !== null);
  const city = cityContacts.map(cityForEmail).find((c) => c !== null) ?? null;
  const isCityCorrespondence = city !== null;

  const text = `${input.subject}\n${input.body}`;
  const caseRefs = extractCaseRefs(text);
  const address = extractSubjectAddress(input.subject);

  let kind: PermitMailKind | null = null;
  if (isCityCorrespondence) {
    if (/\bVOID\b|another PPR has been created|two records for the same location/i.test(text)) {
      kind = 'duplicate_warning';
    } else if (/CBPA.{0,40}violation|violation.{0,40}CBPA|set up a meeting onsite|inspect the tree/i.test(text)) {
      kind = 'cbpa_case';
    } else if (/Preliminary Project Request|Tree Removal Request.*Accela Record/is.test(text)) {
      kind = 'ppr_review';
    } else if (/complete the attached (submittal )?form|provide.{0,30}(photos|survey|map)|upload to your Accela record/i.test(text)) {
      kind = 'intake_request';
    } else if (/payment|fees? to be paid|receipt/i.test(text)) {
      kind = 'payment';
    } else {
      kind = 'other_city_mail';
    }
  }

  return { isCityCorrespondence, city, kind, caseRefs, address, cityContacts };
}
