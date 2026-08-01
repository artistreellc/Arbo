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
