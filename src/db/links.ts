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
 * while it is not exactly 'live' (or exactly 'readonly' — see
 * READ_ONLY_KEPT_CUT below), EVERY link is cut, whatever the per-link
 * variables say. On top of 'live', each named link below opens only when its own
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
 * READ-ONLY MODE (R-READONLY, Mike 2026-10-20: "give arbo and its agents read
 * only data access"). With ARBO_DATA_LINKS exactly 'readonly', every link
 * below is READABLE without its own ARBO_LINK_* variable — EXCEPT these,
 * which stay CUT because reading them would put a false or misleading state
 * on a screen. Each carries its reason, in words, for the boot line,
 * /api/links and Settings. Writes are refused at the door in every link
 * (client.ts). Opening one of these in read-only is a code change after
 * Mike rules on it — never a variable flipped on the way past.
 */
export const READ_ONLY_KEPT_CUT: Readonly<Partial<Record<DataLink, string>>> = {
  calls: "Sona's calls live in Quo, not in these tables — an empty call log would read as \"no calls yet\" (R21, §1B).",
  photos: 'Nothing in the app files a photo yet, so an empty photo table would read as "no photos" instead of "not built".',
  jobs: 'Held: the 11 mistaken job rows (§3, R29). Mike chose to delete them; until a count check shows they are gone they would render as booked work orders and open loops.',
  permits: 'Held: permit_correspondence holds rows no Arbo code writes (it was 0 at the 2026-09-24 check). DATA_LINKS step 3 — shut until Mike says where they came from.',
};

/** Why this link stays cut in read-only mode, or null when read-only may read it. */
export function readOnlyKeptCut(link: DataLink): string | null {
  return READ_ONLY_KEPT_CUT[link] ?? null;
}

/**
 * True when this one link may be READ right now:
 *   - master exactly 'live'     → the link's own variable must be exactly 'live' (R19);
 *   - master exactly 'readonly' → every link except READ_ONLY_KEPT_CUT (reads only —
 *                                 the door in client.ts refuses every write);
 *   - anything else             → cut (fails closed: 'READONLY', ' readonly', 'read-only' are cut).
 * Reads process.env directly (not a cached snapshot) so a test or a restart
 * sees the truth at call time — same as dataLinksLive().
 */
export function linkOpen(link: DataLink): boolean {
  const master = process.env.ARBO_DATA_LINKS;
  if (master === 'live') return process.env[linkEnvVar(link)] === 'live';
  if (master === 'readonly') return readOnlyKeptCut(link) === null;
  return false;
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
    // In read-only mode a link is cut for its own stated reason, not for a
    // missing variable — say that one, so nobody "fixes" it with ARBO_LINK_*.
    const keptCut = link && process.env.ARBO_DATA_LINKS === 'readonly' ? readOnlyKeptCut(link) : null;
    super(
      keptCut
        ? `Data link '${link}' stays CUT in read-only mode: ${keptCut} Table '${table}' was not touched.`
        : link
          ? `Data link '${link}' is CUT (set ${linkEnvVar(link)}=live after its verification passes — R19). Table '${table}' was not touched.`
          : `Table '${table}' belongs to no data link — access refused. Add it to DATA_LINKS in src/db/links.ts (fails closed on purpose).`,
    );
    this.name = 'LinkCutError';
    this.link = link;
    this.table = table;
  }
}

/** The one plain line a refused write says, on every screen and in every 503 (R-READONLY). */
export const READ_ONLY_LINE = 'Read-only: Arbo can look but not save. Nothing was written.';

/**
 * The refusal a WRITE raises at the door while ARBO_DATA_LINKS is exactly
 * 'readonly'. It extends LinkCutError on purpose: a handler that only knows
 * the link refusal still answers a named 503, never a vague 500 — and the
 * server checks for this class FIRST, so it answers 503 { error: 'read_only' }.
 * `op` names what was refused (insert, rpc, storage, HTTP POST …) — never a
 * value, so no customer data can ride the message (§4.3).
 */
export class ReadOnlyError extends LinkCutError {
  readonly op: string;
  constructor(op: string, table: string | null = null, link: DataLink | null = null) {
    super(table ?? '', link);
    this.name = 'ReadOnlyError';
    this.op = op;
    this.message = `Read-only (ARBO_DATA_LINKS=readonly): '${op}'${table ? ` on table '${table}'` : ''} was refused at the door. ${READ_ONLY_LINE}`;
  }
}
