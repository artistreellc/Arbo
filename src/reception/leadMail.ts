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

import { resolveServiceCity, serviceCityForZip, extractZip, parseAddress, type ServiceCity } from '../lib/address.js';

export type LeadMailProvider = 'google_ads_lead_form' | 'callrail_call' | 'callrail_web_form' | 'lsa_call' | 'home_advisor' | 'yelp' | 'form_submit';

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
  /** Web-form ZIP — sometimes the ONLY location signal the form carries. */
  zip?: string;
  email?: string;
  /** The marketplace's own reference, so Mike can find it in their app. */
  externalRef?: string;
  /** What the customer asked for, as the marketplace worded it. */
  serviceRequested?: string;
  /**
   * True when the requested service is clearly NOT tree work (lawn mowing,
   * snow, gutters...). Flagged for review, never auto-dropped (§3.7) and never
   * auto-booked as a tree job.
   */
  serviceOffScope?: boolean;
  /** The form's own urgency answer, verbatim ("Within a week", "Emergency"). */
  urgency?: string;
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

/**
 * CallRail WEB FORM alert — a different animal from the call alert and a
 * different subject line, which is why it was invisible until 2026-08-02.
 * Real observed shape (plaintext), note the DOUBLE colons:
 *   Source: Tree Service Pros / Campaign: <name> / Form URL: <url>
 *   Name:: <name> / Email:: <email> / Phone Number:: <phone>
 *   Zip Code:: <zip> / Service Requested:: <scope> [/ Address: <street>]
 * The form gives a ZIP and often a street, but NO city — so the city is
 * resolved from the ZIP, and an unrecognized ZIP stays UNKNOWN for review
 * rather than being called out-of-area.
 */
function parseCallRailWebForm(input: LeadMailInput): LeadMailResult {
  const field = (label: string): string | undefined => {
    const m = input.body.match(new RegExp(`^${label}::?\\s*(.+)$`, 'im'));
    const v = m?.[1]?.trim();
    return v && v !== 'N/A' ? v : undefined;
  };
  const name = field('Name');
  const email = field('Email');
  const phone = field('Phone Number');
  const zip = field('Zip Code') ?? undefined;
  const requested = field('Service Requested');
  // The form crams the street address into the free-text service field:
  // "<scope> / Address: <street>". Split it rather than losing the address.
  const addrMatch = requested?.match(/\/\s*Address:\s*(.+)$/i);
  const address = addrMatch?.[1]?.trim();
  const details = addrMatch ? requested!.slice(0, addrMatch.index).replace(/\s*\/\s*$/, '').trim() : requested;
  const source = field('Source') ?? field('Campaign');
  const serviceCity = serviceCityForZip(zip) ?? undefined;
  return {
    isLeadNotification: true,
    provider: 'callrail_web_form',
    lead: {
      name, email, phone, zip, address, details, source,
      city: serviceCity, serviceCity,
    },
    // A ZIP we do not recognize is UNKNOWN, not out-of-area: national lead-gen
    // forms send from everywhere, and §3.7 says flag for review, never drop.
    inServiceArea: zip ? (serviceCity !== undefined ? true : false) : null,
  };
}

/**
 * Google Local Services (LSA) customer request. The REAL sender is a per-lead
 * address `customer-request-<digits>@awexpress.google.com` — NOT the
 * `localservices-noreply@` address the original rule expected, which is why
 * every LSA lead was invisible until 2026-08-02. The customer's own words sit
 * between the headline and "To connect with this customer", and they routinely
 * contain the name, street, and phone typed by hand.
 */
function parseLsaRequest(input: LeadMailInput): LeadMailResult {
  const block = input.body.match(
    /(?:sent you a message|new request|You received this)\s*\n+([\s\S]*?)\n\s*To connect with this customer/i,
  )?.[1];
  const lines = (block ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^</.test(l));
  const joined = lines.join('\n');
  // "Name is Dave" is the observed hand-typed shape; fall back to nothing
  // rather than guessing which line is a name.
  const name = joined.match(/\bName is\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*)?)/i)?.[1]?.trim();
  const phone = joined.match(/\b(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/)?.[0]?.trim();
  // A street line must actually look like a street. "1000 works if possible"
  // starts with a number too — guessing there would put a budget note in the
  // address field and route a crew to nowhere (§1B: no address beats a wrong
  // one). Requires a house number AND a real street suffix.
  const STREET_SUFFIX = /\b(ave|avenue|st|street|rd|road|dr|drive|ln|lane|ct|court|blvd|boulevard|way|cir|circle|pl|place|ter|terrace|trl|trail|pkwy|parkway|hwy|highway|loop|run|walk|pt|point|cres|crescent)\b\.?$/i;
  const address = lines.find((l) => /^\d+\s+[A-Za-z]/.test(l) && STREET_SUFFIX.test(l));
  const zip = extractZip(joined) ?? undefined;
  const serviceCity = serviceCityForZip(zip) ?? undefined;
  return {
    isLeadNotification: true,
    provider: 'lsa_call',
    lead: {
      source: 'LSA',
      name, phone, address, zip,
      city: serviceCity,
      serviceCity,
      // The customer's own words are the most valuable thing in the mail —
      // they often carry the budget and the scope. Never discard them.
      details: joined || undefined,
    },
    // LSA is geo-targeted by Google, but Arbo has no city on the wire, so it
    // must not CLAIM in-area. Unknown stays unknown (§1B).
    inServiceArea: serviceCity !== undefined ? true : null,
  };
}

/** Services that are plainly not tree care. Conservative on purpose. */
const OFF_SCOPE = /\b(lawn ?(mowing|care)?|mow(ing)?|landscap(e|ing)|snow|gutter|pressure ?wash|fence|deck|roof|pest control|handyman|plumb|hvac|junk removal)\b/i;
/** Tree words that override an off-scope hit — "tree and lawn" is still ours. */
const TREE_WORK = /\b(tree|stump|limb|branch|prun(e|ing)|trim(ming)?|canopy|arborist|removal)\b/i;

function offScope(service: string | undefined): boolean {
  if (!service) return false;
  return OFF_SCOPE.test(service) && !TREE_WORK.test(service);
}

/**
 * HomeAdvisor "New Opportunity" notification. Carries the service, the city,
 * and HomeAdvisor's own lead number — but NO customer name or phone: those
 * live behind "View all details" in their app. So the lead Arbo files points
 * Mike there rather than pretending it has contact details it does not.
 */
function parseHomeAdvisor(input: LeadMailInput): LeadMailResult {
  const service = input.subject.match(/New Opportunity:\s*(.+)$/i)?.[1]?.trim();
  const cityRaw =
    input.body.match(/A homeowner in\s+([A-Za-z .'-]+?)\s+needs a pro/i)?.[1]?.trim()
    ?? input.body.match(/^([A-Za-z .'-]+),\s*VA\b/m)?.[1]?.trim();
  const ref = input.body.match(/Lead\s*#:?\s*(\d+)/i)?.[1];
  const serviceCity = cityRaw ? resolveServiceCity(cityRaw) ?? undefined : undefined;
  return {
    isLeadNotification: true,
    provider: 'home_advisor',
    lead: {
      source: 'HomeAdvisor',
      city: cityRaw || undefined,
      serviceCity,
      serviceRequested: service,
      serviceOffScope: offScope(service),
      externalRef: ref,
      details: [service, ref ? `HomeAdvisor lead #${ref}` : null, 'Contact details are in the HomeAdvisor app.']
        .filter(Boolean).join(' — '),
    },
    inServiceArea: cityRaw ? serviceCity !== undefined : null,
  };
}

/**
 * Yelp message. Sender is a per-thread reply address, so the domain is the
 * only stable part. Carries "Job Requested" and "Postal Code" plus the
 * customer's own words — and routinely arrives for services Art-is-Tree does
 * not do, which is why the off-scope flag matters here most.
 */
function parseYelp(input: LeadMailInput): LeadMailResult {
  const name = input.subject.match(/^Message from\s+(.+?)\s+for\s+Art.?is.?Tree/i)?.[1]?.trim();
  const service = input.body.match(/Job Requested\s*\n?\s*(.+)/i)?.[1]?.trim();
  const zip = input.body.match(/Postal Code\s*\n?\s*(\d{5})/i)?.[1];
  const serviceCity = serviceCityForZip(zip) ?? undefined;
  return {
    isLeadNotification: true,
    provider: 'yelp',
    lead: {
      source: 'Yelp',
      name,
      zip,
      city: serviceCity,
      serviceCity,
      serviceRequested: service,
      serviceOffScope: offScope(service),
      // Yelp gives no phone: replying happens inside Yelp.
      details: [service, 'Reply inside Yelp — no phone number is provided.'].filter(Boolean).join(' — '),
    },
    inServiceArea: zip ? serviceCity !== undefined : null,
  };
}

/**
 * FormSubmit — the website contact page (artistreevabeach.com). Observed
 * fields: name, phone, email, address, serviceNeeded, urgency, message.
 *
 * It gives a street address but NO city and NO zip, so the city is whatever
 * parseAddress can find inside the address string — often nothing. That is
 * left UNKNOWN and flagged for review rather than assumed local (§1B): the
 * form is on a public website and anyone can fill it in.
 */
function parseFormSubmit(input: LeadMailInput): LeadMailResult {
  // FormSubmit renders a two-column table; flattened to text the label and
  // value sit either on one line or on consecutive lines. Accept both.
  const field = (label: string): string | undefined => {
    const m = input.body.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*[:\\n]?\\s*(.+)`, 'i'));
    const v = m?.[1]?.trim();
    return v && v.toLowerCase() !== 'value' ? v : undefined;
  };
  const name = field('name') ?? input.subject.match(/New estimate request from\s+(.+?)(?:\s+[—-]|$)/i)?.[1]?.trim();
  const phone = field('phone');
  const email = field('email');
  const address = field('address');
  const service = field('serviceNeeded') ?? input.subject.match(/[—-]\s*(.+)$/)?.[1]?.trim();
  const urgency = field('urgency');
  const message = field('message');

  // The address line rarely names a city; parseAddress finds one only when it
  // is actually written there.
  const parsed = address ? parseAddress(address) : null;
  const serviceCity = parsed?.city ?? undefined;
  const zip = parsed?.zip ?? undefined;

  return {
    isLeadNotification: true,
    provider: 'form_submit',
    lead: {
      name, phone, email, address, zip,
      city: serviceCity,
      serviceCity,
      source: 'Website form',
      serviceRequested: service,
      serviceOffScope: offScope(service),
      urgency,
      details: [service, urgency ? `Urgency: ${urgency}` : null, message].filter(Boolean).join(' — '),
    },
    // No city on the wire: UNKNOWN, not local. A public form takes submissions
    // from anywhere, which is exactly how the out-of-area spam arrived before.
    inServiceArea: serviceCity ? true : null,
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
  // CallRail web-form alert. Distinct subject from the call alert; the monthly
  // summary ("Monthly Summary for …") must NOT match, so anchor on the shape.
  if (from.includes('no-reply@callrail.com') && /^Form Submission Alert for Art.?is.?Tree/i.test(input.subject)) {
    return parseCallRailWebForm(input);
  }
  // LSA sends from a per-lead address; the old localservices-noreply@ rule
  // matched nothing in the real inbox. Both senders are accepted now.
  const isLsaSender = /customer-request-\d+@awexpress\.google\.com/.test(from)
    || from.includes('localservices-noreply@google.com');
  if (isLsaSender && /potential customer/i.test(input.subject)) {
    return parseLsaRequest(input);
  }
  if (from.includes('submissions@formsubmit.co') && /New estimate request from/i.test(input.subject)) {
    return parseFormSubmit(input);
  }
  // HomeAdvisor: marketing mail also comes from homeadvisor.com, so anchor on
  // the lead sender AND the Opportunity subject shape.
  if (from.includes('@homeadvisor.com') && /^New Opportunity/i.test(input.subject)) {
    return parseHomeAdvisor(input);
  }
  // Yelp uses a per-thread reply+<token>@messaging.yelp.com sender.
  if (/@messaging\.yelp\.com/.test(from) && /^Message from .+ for Art.?is.?Tree/i.test(input.subject)) {
    return parseYelp(input);
  }
  return NOT_A_LEAD;
}
