/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  ═══════════════════════════════════════════════════════════════════════
*/
// THE THIRD DOOR'S DATA ACCESS (task #35, cycle 11).
//
// Every function here goes through getDb(), which REFUSES when
// ARBO_DATA_LINKS is not exactly `live` (§3). That is the second door: the
// route layer checks hasDb() first, and this layer cannot reach a real table
// even if a caller forgets. Neither check is redundant — the whole point of
// §3 is that one forgotten guard is not enough.
//
// It reads. It records a sign-in timestamp. It writes nothing else, ever.

import { getDb } from './client.js';
import type { PortalAccountRow } from '../portal/routes.js';
import type { OverlayHit } from '../permitting/screening.js';
import {
  buildPortalView,
  type PortalJob,
  type PortalProperty,
  type PortalTree,
  type PortalView,
} from '../portal/customerView.js';
import type { RecordedScreen, ReservoirRecord } from '../portal/propertyFlags.js';

/**
 * One account by email. The caller has already lowercased and trimmed; this
 * does NOT normalise again, because a second, subtly different normalisation
 * is how a lookup starts missing rows that exist.
 */
export async function findPortalAccountByEmail(email: string): Promise<PortalAccountRow | null> {
  const db = getDb();
  const res = await db
    .from('portal_account')
    .select('email, password_hash, property_id')
    .eq('email', email)
    .maybeSingle();
  if (res.error) throw res.error;
  if (!res.data) return null;
  const row = res.data as { email: string; password_hash: string | null; property_id: string };
  return { email: row.email, passwordHash: row.password_hash, propertyId: row.property_id };
}

/**
 * Stamp the sign-in. Best-effort by design: a customer who authenticated
 * correctly must not be bounced out because a bookkeeping UPDATE failed.
 * The throw is swallowed HERE, deliberately and visibly, rather than left to
 * an unhandled rejection somewhere up the stack.
 */
export async function recordPortalSignIn(propertyId: string): Promise<void> {
  try {
    const db = getDb();
    const res = await db
      .from('portal_account')
      .update({ last_sign_in_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('property_id', propertyId);
    if (res.error) throw res.error;
  } catch {
    // Intentionally ignored — see above. Nothing the customer can act on.
  }
}

/**
 * WHICH JOB THE PORTAL SHOWS.
 *
 * customerView renders exactly ONE job, so this has to choose, and choosing
 * badly hides something the customer needs. The order is by what would go
 * wrong if it were missed:
 *
 *   1. Finished and not marked paid — the customer may be trying to pay it.
 *      Burying this behind a newer booking means they cannot.
 *   2. The soonest booking still ahead — what they plan their day around.
 *   3. Otherwise the most recent thing that happened.
 *
 * LIMITATION, STATED NOT HIDDEN: a customer with an unpaid finished job AND
 * an upcoming booking sees the unpaid one. That is the safer of the two
 * wrong answers, but it is still one job on a page that should probably show
 * both. Widening it means widening PortalView, which is Mike's call, so it is
 * flagged rather than quietly redesigned.
 */
export function chooseJob(rows: JobRow[], nowMs: number): JobRow | null {
  if (rows.length === 0) return null;
  const unpaidFinished = rows
    .filter((j) => j.completed_at && !j.paid)
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
  if (unpaidFinished[0]) return unpaidFinished[0];

  // Compared as INSTANTS, not as strings. Postgres hands back
  // `...+00:00` and Date#toISOString produces `...Z`; those two sort against
  // each other by accident of formatting, not by time, and the day they
  // disagree is the day a customer's booking silently vanishes off this page.
  const upcoming = rows
    .filter((j) => !j.completed_at && j.scheduled_for && Date.parse(j.scheduled_for) >= nowMs)
    .sort((a, b) => Date.parse(a.scheduled_for!) - Date.parse(b.scheduled_for!));
  if (upcoming[0]) return upcoming[0];

  return [...rows].sort((a, b) =>
    String(b.completed_at ?? b.scheduled_for ?? '').localeCompare(String(a.completed_at ?? a.scheduled_for ?? '')),
  )[0] ?? null;
}

export interface JobRow {
  id: string;
  status: string;
  scheduled_for: string | null;
  completed_at: string | null;
  materials: string | null;
  estimate_id: string | null;
  agreedAmount: number | null;
  paid: boolean;
  paidAmount: number | null;
}

/**
 * Everything the customer's page needs, in one call.
 *
 * Returns null ONLY when the property genuinely is not there. An outage
 * throws, and the route turns a throw into "we cannot read your records" —
 * the two must not collapse into the same answer (§1B).
 */
export async function loadPortalView(propertyId: string): Promise<PortalView | null> {
  const db = getDb();

  const prop = await db
    .from('property')
    // One string literal, not a joined array: the Supabase client derives the
    // row type from this text, and a computed string collapses it to an error
    // type. Keep it literal.
    .select('id, address, city, zip, geo_lat, geo_lng, hazard_power_lines, power_lines_checked_at, water_meter_location, water_meter_path_note, site_features_note, near_reservoir, near_reservoir_checked_at')
    .eq('id', propertyId)
    .maybeSingle();
  if (prop.error) throw prop.error;
  if (!prop.data) return null;
  const p = prop.data as Record<string, unknown>;

  const [treesRes, jobsRes, permitRes] = await Promise.all([
    db.from('tree')
      .select('id, species, size, location_on_lot, condition_notes, last_service_date, next_due_forecast, on_city_property, city_property_checked_at')
      .eq('property_id', propertyId),
    db.from('job')
      .select('id, status, scheduled_for, completed_at, materials, estimate_id')
      .eq('property_id', propertyId)
      .order('scheduled_for', { ascending: false })
      .limit(50),
    // Newest recorded screen for this address. `permit.overlay_source` is the
    // OverlayHit[] that produced the status — the same shape propertyFlags
    // reads, so nothing is re-derived here.
    db.from('permit')
      .select('overlay_source, created_at')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  if (treesRes.error) throw treesRes.error;
  if (jobsRes.error) throw jobsRes.error;
  if (permitRes.error) throw permitRes.error;

  const jobRowsRaw = (jobsRes.data ?? []) as Array<Record<string, unknown>>;

  // The agreed figure lives on the ESTIMATE (migration 0012) and job.estimate_id
  // is the link. Arbo copies that figure; it never computes one (§3).
  const estimateIds = jobRowsRaw
    .map((j) => j.estimate_id as string | null)
    .filter((x): x is string => Boolean(x));
  const jobIds = jobRowsRaw.map((j) => j.id as string);

  const [estRes, invRes] = await Promise.all([
    estimateIds.length
      ? db.from('estimate').select('id, agreed_amount').in('id', estimateIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    jobIds.length
      ? db.from('invoice').select('job_id, amount, status').in('job_id', jobIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);
  if (estRes.error) throw estRes.error;
  if (invRes.error) throw invRes.error;

  const agreedByEstimate = new Map<string, number | null>();
  for (const e of (estRes.data ?? []) as Array<Record<string, unknown>>) {
    const v = e.agreed_amount;
    agreedByEstimate.set(e.id as string, v == null ? null : Number(v));
  }
  // PAID MEANS THE INVOICE SAYS PAID. Not "an invoice exists", not "the job is
  // finished". Claiming a customer has paid when they have not is the worst
  // sentence this page could print.
  const paidByJob = new Map<string, number>();
  for (const i of (invRes.data ?? []) as Array<Record<string, unknown>>) {
    if (i.status !== 'paid') continue;
    paidByJob.set(i.job_id as string, Number(i.amount ?? 0));
  }

  const jobRows: JobRow[] = jobRowsRaw.map((j) => {
    const estId = j.estimate_id as string | null;
    const id = j.id as string;
    const paidAmount = paidByJob.has(id) ? paidByJob.get(id)! : null;
    return {
      id,
      status: (j.status as string) ?? 'unknown',
      scheduled_for: (j.scheduled_for as string | null) ?? null,
      completed_at: (j.completed_at as string | null) ?? null,
      materials: (j.materials as string | null) ?? null,
      estimate_id: estId,
      agreedAmount: estId ? agreedByEstimate.get(estId) ?? null : null,
      paid: paidAmount != null,
      paidAmount,
    };
  });

  const chosen = chooseJob(jobRows, Date.now());
  const job: PortalJob | null = chosen
    ? {
      id: chosen.id,
      status: chosen.status,
      scheduledFor: chosen.scheduled_for,
      completedAt: chosen.completed_at,
      scope: chosen.materials,
      agreedAmount: chosen.agreedAmount,
      amountPaid: chosen.paidAmount,
    }
    : null;

  const trees: PortalTree[] = ((treesRes.data ?? []) as Array<Record<string, unknown>>).map((t) => ({
    id: t.id as string,
    species: (t.species as string | null) ?? null,
    size: (t.size as string | null) ?? null,
    locationOnLot: (t.location_on_lot as string | null) ?? null,
    conditionNotes: (t.condition_notes as string | null) ?? null,
    lastServiceDate: (t.last_service_date as string | null) ?? null,
    nextDueForecast: (t.next_due_forecast as string | null) ?? null,
    onCityProperty: (t.on_city_property as boolean | null) ?? null,
    cityPropertyCheckedAt: (t.city_property_checked_at as string | null) ?? null,
  }));

  const property: PortalProperty = {
    id: p.id as string,
    address: (p.address as string) ?? '',
    city: (p.city as string) ?? '',
    zip: (p.zip as string | null) ?? null,
    geoLat: p.geo_lat == null ? null : Number(p.geo_lat),
    geoLng: p.geo_lng == null ? null : Number(p.geo_lng),
    hazardPowerLines: p.hazard_power_lines === true,
    powerLinesCheckedAt: (p.power_lines_checked_at as string | null) ?? null,
    waterMeterLocation: (p.water_meter_location as string | null) ?? null,
    waterMeterPathNote: (p.water_meter_path_note as string | null) ?? null,
    siteFeaturesNote: (p.site_features_note as string | null) ?? null,
  };

  const permitRow = ((permitRes.data ?? []) as Array<Record<string, unknown>>)[0];
  // No permit row = never screened = `unknown`, which renders as "not checked".
  // It must NEVER become an empty screen, because an empty screen renders as
  // "screened, found nothing" — the §1B failure this whole flag system exists
  // to prevent.
  const screen: RecordedScreen | null = permitRow
    ? {
      ranAt: String(permitRow.created_at ?? ''),
      overlays: (permitRow.overlay_source as OverlayHit[] | null) ?? [],
    }
    : null;

  const reservoir: ReservoirRecord = {
    nearReservoir: (p.near_reservoir as boolean | null) ?? null,
    checkedAt: (p.near_reservoir_checked_at as string | null) ?? null,
  };

  return buildPortalView({
    property,
    trees,
    job,
    // NO PAYMENT PROVIDER IS WIRED. Returning null is the honest answer: the
    // page then shows the agreed figure and tells the customer to arrange
    // payment with Mike, instead of rendering a button that goes nowhere.
    // When Mike picks a provider, it plugs in HERE and nothing else changes.
    linkFor: () => null,
    screen,
    reservoir,
  });
}
