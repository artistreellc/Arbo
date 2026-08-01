// Lead-notification mail classifier (brief §5A #12–13): recognizes an incoming
// lead in the company inbox and extracts a clean record. Grounded in
// Art-is-Tree's REAL notification formats (mined 2026-08-01):
//   - Google Ads lead form: ads-account-noreply@google.com,
//     "Lead form response received", labeled fields in plaintext
//     (First name / Last name / Phone number / City / Street address / Response).
//   - CallRail call alert: no-reply@callrail.com,
//     "Call from <who> via <TRACKER> for Art-is-Tree LLC (VA)" — Name/Number/
//     Duration/"Number Name" (the tracker = Mike's source tag, e.g. TSP, TLT),
//     "Tagged as <label>", "New Caller"/"2nd call" repeat signal.
//   - Google LSA: localservices-noreply@google.com, "New call from a potential
//     customer".
// Pure classifier — Phase 5 wires the live inbox monitor around it. Out-of-area
// submissions (lead-form spam arrives from anywhere) are flagged, never
// silently dropped: §3.7 bias — anything ambiguous stays visible for review.

import { resolveServiceCity, type ServiceCity } from '../lib/address.js';

export type LeadMailProvider = 'google_ads_lead_form' | 'callrail_call' | 'lsa_call';

export interface LeadMailInput {
  from: string;
  subject: string;
  body: string; // plaintext body (or snippet)
}

export interface ExtractedLead {
  name?: string;
  phone?: string;
  city?: string;
  /** City when it maps to one of the 4 service cities. */
  serviceCity?: ServiceCity;
  address?: string;
  details?: string;
  /** Mike's source tag: CallRail tracker (TSP/TLT/…) or campaign name. */
  source?: string;
  callDurationSec?: number;
  /** From CallRail's "New Caller" / "2nd call" counters. */
  isRepeatCaller?: boolean;
  /** CallRail "Tagged as <label>" (e.g. "Schedule booked"). */
  taggedAs?: string;
}

export interface LeadMailResult {
  isLeadNotification: boolean;
  provider: LeadMailProvider | null;
  lead: ExtractedLead;
  /** False when a captured city is clearly outside the 4 cities — review, don't auto-lead. */
  inServiceArea: boolean | null;
}

const NOT_A_LEAD: LeadMailResult = { isLeadNotification: false, provider: null, lead: {}, inServiceArea: null };

/** Grab the line following a labeled line in Google's plaintext field layout. */
function fieldAfter(body: string, label: string): string | undefined {
  const re = new RegExp(`^${label}\\s*\\n(.+)$`, 'im');
  const m = body.match(re);
  const v = m?.[1]?.trim();
  return v && v !== 'N/A' ? v : undefined;
}

function parseGoogleAdsLeadForm(input: LeadMailInput): LeadMailResult {
  const first = fieldAfter(input.body, 'First name');
  const last = fieldAfter(input.body, 'Last name');
  const name = [first, last].filter(Boolean).join(' ') || undefined;
  const phone = fieldAfter(input.body, 'Phone number');
  const city = fieldAfter(input.body, 'City');
  const address = fieldAfter(input.body, 'Street address');
  const details = fieldAfter(input.body, 'Brief description of tree works required \\(Optional\\)');
  const campaign = input.body.match(/^Campaign\s*\n\s*\n?(.+)$/im)?.[1]?.replace(/<[^>]*>/g, '').trim();
  const serviceCity = city ? resolveServiceCity(city) ?? undefined : undefined;
  return {
    isLeadNotification: true,
    provider: 'google_ads_lead_form',
    lead: { name, phone, city, serviceCity, address, details, source: campaign },
    // Lead-form spam comes from anywhere on earth; a city that doesn't
    // normalize to a service city is a review flag, not a silent drop.
    inServiceArea: city ? serviceCity !== undefined : null,
  };
}

function parseCallRail(input: LeadMailInput): LeadMailResult {
  const name = input.body.match(/^Name:\s*(.+)$/m)?.[1]?.trim();
  const phone = input.body.match(/^Number:\s*(.+)$/m)?.[1]?.trim();
  const cityRaw = input.body.match(/^City:\s*(.+)$/m)?.[1]?.trim();
  const tracker =
    input.body.match(/^Number Name:\s*(.+)$/m)?.[1]?.trim() ??
    input.subject.match(/\bvia\s+([A-Z0-9-]{2,12})\b/)?.[1];
  const taggedAs = input.body.match(/^Tagged as\s+(.+)$/m)?.[1]?.trim();
  const dur = input.body.match(/^Duration:\s*(?:(\d+)\s*min)?\s*(?:(\d+)\s*sec)?/m);
  const callDurationSec = dur ? Number(dur[1] ?? 0) * 60 + Number(dur[2] ?? 0) : undefined;
  const isRepeatCaller = /\b(\d+)(?:st|nd|rd|th) call\b/i.test(`${input.subject}\n${input.body}`)
    ? true
    : /\bNew Caller\b/i.test(input.body)
      ? false
      : undefined;
  const serviceCity = cityRaw ? resolveServiceCity(cityRaw) ?? undefined : undefined;
  return {
    isLeadNotification: true,
    provider: 'callrail_call',
    lead: {
      name: name && !/^\d[\d ()-]+$/.test(name) ? name : undefined,
      phone,
      city: cityRaw || undefined,
      serviceCity,
      source: tracker,
      callDurationSec: callDurationSec || undefined,
      isRepeatCaller,
      taggedAs,
    },
    inServiceArea: cityRaw ? serviceCity !== undefined : null,
  };
}

export function classifyLeadMail(input: LeadMailInput): LeadMailResult {
  const from = input.from.toLowerCase();

  if (from.includes('ads-account-noreply@google.com') && /lead form response/i.test(input.subject)) {
    return parseGoogleAdsLeadForm(input);
  }
  // Strict sender + subject shape: learn@callrail.com marketing mail must not
  // become a phantom lead.
  if (from.includes('no-reply@callrail.com') && /^Call from .+ for Art.?is.?Tree/i.test(input.subject)) {
    return parseCallRail(input);
  }
  if (from.includes('localservices-noreply@google.com') && /new (call|message|lead) from a potential customer/i.test(input.subject)) {
    return { isLeadNotification: true, provider: 'lsa_call', lead: { source: 'LSA' }, inServiceArea: null };
  }
  return NOT_A_LEAD;
}
