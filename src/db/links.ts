/*
  SLOW::ARBO — this file is part of the data-link switch. The note at the top
  of src/db/client.ts applies here in full. Read it before editing.
*/

/**
 * PER-LINK DATA SWITCHES — owner instruction, 2026-09-24 (R19). Mike:
 * "contecting the links for the data it needs one by one after a multiple
 * step verification process."
 *
 * The single master switch (ARBO_DATA_LINKS, §3) stays and still rules:
 * while it is not exactly 'live', EVERY link is cut, whatever the per-link
 * variables say. On top of it, each named link below opens only when its own
 * variable — ARBO_LINK_<NAME> — is also exactly 'live'. Same opt-in shape as
 * the master, for the same reason: a missing, misspelled, or miscased value
 * leaves that link CUT, because the expensive failure is quiet access to
 * live customer data, not a screen saying it cannot see.
 *
 * A link opens only AFTER its verification steps pass (docs/DATA_LINKS.md):
 * migrations parity, RLS + advisors, a row-count/content review of its
 * tables with anything unexpected flagged to Mike, tests green — then the
 * variable is set on Railway, deployed, and the open link is verified live.
 *
 * Enforcement is at the ONE door (getDb() wraps `from`), so a repository —
 * present or future — cannot reach a table whose link is cut, even if its
 * author never heard of this file.
 */

/** Every table the code touches, grouped into the links Mike opens one by one. */
export const DATA_LINKS = {
  contacts: ['contact', 'contact_property'],
  properties: ['property', 'tree'],
  leads: ['lead', 'campaign'],
  estimates: ['estimate'],
  jobs: ['job', 'contract', 'work_order', 'change_order', 'invoice', 'time_entry'],
  permits: ['permit', 'permit_correspondence'],
  photos: ['photo'],
  calls: ['conversation_log', 'call_log'],
  location: ['location_ping'],
  crew: ['crew_member', 'certification', 'training_item', 'training_event'],
  equipment: ['equipment_unit', 'equipment_part', 'maintenance_task', 'tool'],
  safety: ['near_miss', 'site_condition_record', 'leakage_event'],
  ops: ['event', 'event_cursor', 'agent_run', 'ops_setting', 'reference_entry'],
} as const;

export type DataLink = keyof typeof DATA_LINKS;

export const LINK_NAMES = Object.keys(DATA_LINKS) as DataLink[];

const TABLE_TO_LINK: ReadonlyMap<string, DataLink> = new Map(
  LINK_NAMES.flatMap((link) => DATA_LINKS[link].map((t) => [t, link] as const)),
);

/** Which link governs a table, or null for a table no link covers (always cut). */
export function linkForTable(table: string): DataLink | null {
  return TABLE_TO_LINK.get(table) ?? null;
}

/**
 * True when this one link is open: master live AND the link's own variable
 * live. Both checks read process.env directly (not a cached snapshot) so a
 * test or a restart sees the truth at call time — same as dataLinksLive().
 */
export function linkOpen(link: DataLink): boolean {
  if (process.env.ARBO_DATA_LINKS !== 'live') return false;
  return process.env[linkEnvVar(link)] === 'live';
}

/** The exact environment variable that opens a link, for docs and screens. */
export function linkEnvVar(link: DataLink): string {
  return `ARBO_LINK_${link.toUpperCase()}`;
}

/** The links currently open, for the boot line and /api/links. */
export function openLinks(): DataLink[] {
  return LINK_NAMES.filter((l) => linkOpen(l));
}

/**
 * The refusal a cut link raises at the door. Carries which link and table so
 * the server can answer 503 { error: 'link_cut', link } — a named state,
 * never a vague 500 (§1B: "we couldn't read it" is a different fact from
 * "there's nothing there").
 */
export class LinkCutError extends Error {
  readonly link: DataLink | null;
  readonly table: string;
  constructor(table: string, link: DataLink | null) {
    super(
      link
        ? `Data link '${link}' is CUT (set ${linkEnvVar(link)}=live after its verification passes — R19). Table '${table}' was not touched.`
        : `Table '${table}' belongs to no data link — access refused. Add it to DATA_LINKS in src/db/links.ts (fails closed on purpose).`,
    );
    this.name = 'LinkCutError';
    this.link = link;
    this.table = table;
  }
}
