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
// Calendar-write formatting (brief §3.11, §3.20, §3.22). Every event ARBOR
// creates must be indistinguishable from one Mike typed himself:
//   Title:       "Client Name SOURCE 10-digit-phone"  (space-separated)
//   Description: all scope / site / access detail from intake
// e.g. "Kathy Arnett WEB 7574273361". Mike calls straight from the title.
//
// FORMAT LEARNED FROM THE LIVE CALENDAR (D34): the brief documented a
// hyphenated "Name - SOURCE - phone" but 250 real events (Apr–Jul 2026) are
// space-separated ("Peter Simmons TT 7578193493", "April Herrod GG
// 7574690321"). §3.11's own rule — model how Mike ACTUALLY books — wins.

// The real source-tag set observed on Mike's calendar (§3.11 / §3.22 / §3.29).
export const SOURCE_TAGS = ['TT', 'WEB', 'YELP', 'REFERAL', 'REC', 'GG', 'LSA', 'TLT', 'TSP', 'WL'] as const;
export type SourceTag = (typeof SOURCE_TAGS)[number];

// Map an inbound channel to Mike's source tag. WEB/WL = website form,
// GG = Google Ads, LSA = Local Services, TLT/TSP = CallRail flyer numbers,
// REFERAL/REC = word of mouth, TT = Tree Leads Today, YELP = Yelp.
export function normalizeSourceTag(raw: string | undefined | null): SourceTag {
  if (!raw) return 'WEB';
  const s = raw.trim().toUpperCase();
  const direct = SOURCE_TAGS.find((t) => t === s);
  if (direct) return direct;
  const alias: Record<string, SourceTag> = {
    WEBSITE: 'WEB', 'WEB-FORM': 'WEB', WEBFORM: 'WEB', FORMSUBMIT: 'WEB',
    'GOOGLE ADS': 'GG', GOOGLEADS: 'GG', GOOGLE: 'GG', PMAX: 'GG',
    'LOCAL SERVICES': 'LSA', LOCALSERVICES: 'LSA',
    REFERRAL: 'REFERAL', REFERR: 'REFERAL', RECOMMEND: 'REC', RECOMMENDATION: 'REC',
    'TREE LEADS TODAY': 'TT', TREELEADSTODAY: 'TT',
    CALLRAIL: 'TLT', PHONE: 'WEB',
  };
  return alias[s] ?? 'WEB';
}

/** Keep only digits; return the last 10 (US number), or null if not 10. */
export function tenDigitPhone(raw: string | undefined | null): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return ten.length === 10 ? ten : null;
}

export interface EventTitleParts {
  name: string;
  source: string; // raw channel or tag; normalized here
  phone: string;
}

/**
 * Build the calendar title EXACTLY as Mike formats it (space-separated, per the
 * live calendar — D34). Falls back gracefully if the phone isn't a clean 10
 * digits (keeps whatever was given rather than lose the booking), but always
 * uses a valid source tag.
 */
export function buildEventTitle(p: EventTitleParts): string {
  const name = (p.name || 'New Lead').trim();
  const source = normalizeSourceTag(p.source);
  const phone = tenDigitPhone(p.phone) ?? (p.phone || '').replace(/\D/g, '');
  return `${name} ${source} ${phone}`.trim().replace(/\s+/g, ' ');
}

export interface IntakeDetail {
  serviceType?: string; // removal, trim, stump, cleanup
  treeInfo?: string; // "two oaks in the back near the fence"
  proximity?: string; // over the house / wires, leaning
  access?: string; // gate codes, dogs, tight lot, can a truck get to the back
  urgency?: string; // storm, hazard, before I sell, flexible
  bestContact?: string;
  notes?: string;
}

/** Scope/site/access detail — goes in the DESCRIPTION, never the title. */
export function buildEventDescription(d: IntakeDetail): string {
  const rows: Array<[string, string | undefined]> = [
    ['Service', d.serviceType],
    ['Tree(s)', d.treeInfo],
    ['Proximity', d.proximity],
    ['Access', d.access],
    ['Urgency', d.urgency],
    ['Best contact', d.bestContact],
    ['Notes', d.notes],
  ];
  return rows
    .filter(([, v]) => v && v.trim() !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}
