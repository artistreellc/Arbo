// Old rows must not pose as new work (§1B, §3's lesson). Mike's database holds
// leads from July still marked 'new' — read-only mode (R32) makes them
// readable, and a lead that old is not an emergency to answer now, not a call
// back owed today, and not new work. It shows with its date as an OLDER lead.
// Whether anyone is contacted is Mike's call, never Arbo's (R4, R22).
//
// One rule, one number, used by every surface that could light an alarm or a
// call-back count: the leads API, the Loop-Closer, and through them Today, the
// Leads tab badge and Talk.

/** A lead older than this many days is an older lead: no alarm, no call-back count, never "new". */
export const OLDER_LEAD_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * True when the lead was created more than OLDER_LEAD_DAYS before `nowMs`.
 * A date Arbo cannot read is NOT treated as older: an unreadable date must not
 * quietly switch an alarm off. (It keeps whatever the row says, as before.)
 */
export function isOlderLead(createdAtIso: string | null | undefined, nowMs: number): boolean {
  const t = createdAtIso ? Date.parse(createdAtIso) : NaN;
  if (Number.isNaN(t)) return false;
  return nowMs - t > OLDER_LEAD_DAYS * DAY_MS;
}

/** Whole days since the lead came in (0 for today or a date Arbo cannot read). */
export function leadAgeDays(createdAtIso: string | null | undefined, nowMs: number): number {
  const t = createdAtIso ? Date.parse(createdAtIso) : NaN;
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / DAY_MS));
}
