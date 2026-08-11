/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  ═══════════════════════════════════════════════════════════════════════
*/
// STORAGE FOR THE NEIGHBOUR'S PERMISSION (task #42, cycle 14).
//
// `src/legal/propertyAccess.ts` has been complete and tested for weeks and was
// imported by NOTHING — the letter could be built and an acceptance validated,
// and neither could be saved or shown to anyone. Table `property_access_consent`
// (migration 0017) has been sitting there empty for the same reason. This is
// the join between them, and nothing more: it validates nothing itself and
// composes no text, because both of those already have one owner.
//
// §3: getDb() refuses while the links are CUT, so nothing here can reach a real
// table until Mike says the rough build is done.
//
// §4.3: `neighbor_email` is PII and the neighbour is not even a customer —
// they are a bystander who did the business a favour. It is stored because the
// consent record is worthless without knowing who granted it, and it is never
// logged, never counted into a report, and never returned to any surface that
// does not already hold the job.

import { getDb } from './client.js';
import type { AccessConsent } from '../legal/propertyAccess.js';

/** A stored consent, plus the withdrawal the letter promises is possible. */
export type StoredConsent = AccessConsent & { withdrawnAt: string | null };

/**
 * Save an acceptance that `recordAcceptance()` has already validated.
 *
 * This function deliberately takes the VALIDATED `AccessConsent`, not raw
 * fields: making the type the gate means a caller cannot skip the rules in
 * propertyAccess.ts and still reach the table. The database CHECK on
 * crew_device witnesses is the third door behind that.
 */
export async function saveAccessConsent(consent: AccessConsent): Promise<void> {
  const db = getDb();
  const res = await db.from('property_access_consent').insert({
    job_id: consent.jobId,
    neighbor_email: consent.neighborEmail,
    letter_sha256: consent.letterHash,
    channel: consent.channel,
    crew_member_id: consent.crewMemberId,
    accepted_at: consent.acceptedAt,
  });
  if (res.error) throw res.error;
}

/**
 * The current consent for a job, or null.
 *
 * Newest first, and a WITHDRAWN row is still returned rather than filtered
 * out. That is the whole point: `consentStanding()` renders "permission was
 * given and then pulled" differently from "nobody ever asked", and dropping
 * withdrawn rows here would collapse those two into the same silence — the
 * §1B failure, on the one record a crew needs to be right about before they
 * cross somebody else's land.
 */
export async function latestConsentForJob(jobId: string): Promise<StoredConsent | null> {
  const db = getDb();
  const res = await db
    .from('property_access_consent')
    .select('job_id, neighbor_email, letter_sha256, channel, crew_member_id, accepted_at, withdrawn_at')
    .eq('job_id', jobId)
    .order('accepted_at', { ascending: false })
    .limit(1);
  if (res.error) throw res.error;
  const row = (res.data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    jobId: row.job_id as string,
    neighborEmail: row.neighbor_email as string,
    letterHash: row.letter_sha256 as string,
    channel: row.channel as AccessConsent['channel'],
    crewMemberId: (row.crew_member_id as string | null) ?? null,
    acceptedAt: row.accepted_at as string,
    withdrawnAt: (row.withdrawn_at as string | null) ?? null,
  };
}

/**
 * The work-site address for a job, for the letter's "the work is at" line.
 *
 * Returns null when the job or its property is missing, which the caller must
 * render as "we cannot build the letter" — never as a letter with a blank
 * address, because a permission slip that does not name the site is not a
 * permission slip.
 */
export async function jobSiteAddress(jobId: string): Promise<string | null> {
  const db = getDb();
  const res = await db
    .from('job')
    .select('id, property:property_id(address, city)')
    .eq('id', jobId)
    .maybeSingle();
  if (res.error) throw res.error;
  const row = res.data as { property?: { address?: string | null; city?: string | null } | null } | null;
  const prop = row?.property;
  if (!prop?.address) return null;
  return prop.city ? `${prop.address}, ${prop.city}` : prop.address;
}
