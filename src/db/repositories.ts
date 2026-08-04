/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
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

  Remember the marker: SLOW::ARBO
*/
// Repository layer (brief §7, Phase 1). Thin, typed functions over the data
// spine. Business invariants live here: service-area enforcement and
// address-based deduping of the property twin.

import { getDb } from './client.js';
import { parseAddress, type ServiceCity, type OffFocusCity } from '../lib/address.js';
import type { PermitRecordInput, PermitLifecycle } from '../permitting/permitRecord.js';
import type { PermitTrackRow } from '../permitting/permitBoard.js';
import type { OverlayHit, ScreenStatus } from '../permitting/screening.js';

/**
 * Thrown when an address is in no city Art-is-Tree works — NOT merely outside
 * the current marketing focus. Suffolk is workable and off-focus; it is
 * accepted and flagged, never thrown (owner ruling 2026-08-02).
 */
export class OutOfServiceAreaError extends Error {
  constructor(public readonly address: string) {
    super(`Address is outside the service area (VB / Norfolk / Chesapeake / Portsmouth): ${address}`);
    this.name = 'OutOfServiceAreaError';
  }
}

export interface UpsertPropertyInput {
  address: string;
  city?: string;
  zip?: string;
  lotNotes?: string;
  hazardPowerLines?: boolean;
  hazardStructures?: boolean;
}

export interface PropertyRow {
  id: string;
  address: string;
  normalized_address: string;
  city: ServiceCity | OffFocusCity;
  zip: string | null;
  drive_folder_id: string | null;
}

/**
 * Create or fetch the property twin for an address. Enforces the service area
 * and dedupes on the normalized address so the same lot never becomes two
 * twins (§12). Idempotent: calling twice with equivalent addresses returns the
 * same row.
 */
export async function upsertProperty(input: UpsertPropertyInput): Promise<PropertyRow> {
  const parsed = parseAddress(input.address, input.city);
  // OWNER RULING R1 (docs/OWNER_RULINGS.md): a city we can work is accepted
  // even when we are not advertising there. Rejecting it here silently binned
  // a lead Mike would have taken. Do not restore the hard reject.
  const city = parsed.city ?? parsed.offFocusCity;
  if (!city) throw new OutOfServiceAreaError(input.address);

  const db = getDb();

  // Try existing twin first (dedupe by normalized address).
  const existing = await db
    .from('property')
    .select('id, address, normalized_address, city, zip, drive_folder_id')
    .eq('normalized_address', parsed.normalized)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as PropertyRow;

  const insert = await db
    .from('property')
    .insert({
      address: input.address,
      normalized_address: parsed.normalized,
      city,
      zip: input.zip ?? parsed.zip,
      lot_notes: input.lotNotes ?? null,
      hazard_power_lines: input.hazardPowerLines ?? false,
      hazard_structures: input.hazardStructures ?? false,
    })
    .select('id, address, normalized_address, city, zip, drive_folder_id')
    .single();
  if (insert.error) throw insert.error;
  return insert.data as PropertyRow;
}

export interface CreateContactInput {
  name?: string;
  phones?: string[];
  emails?: string[];
  isFirstTimer?: boolean;
  consentSource?: string; // capturing consent at creation (§4.1)
}

export async function createContact(input: CreateContactInput): Promise<{ id: string }> {
  const db = getDb();
  const res = await db
    .from('contact')
    .insert({
      name: input.name ?? null,
      phones: input.phones ?? [],
      emails: input.emails ?? [],
      is_first_timer: input.isFirstTimer ?? true,
      consent_source: input.consentSource ?? null,
      consent_at: input.consentSource ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (res.error) throw res.error;
  return res.data as { id: string };
}

export async function linkContactToProperty(contactId: string, propertyId: string, role = 'owner'): Promise<void> {
  const db = getDb();
  const res = await db
    .from('contact_property')
    .upsert({ contact_id: contactId, property_id: propertyId, role }, { onConflict: 'contact_id,property_id' });
  if (res.error) throw res.error;
}

export interface CreateLeadInput {
  propertyId?: string;
  contactId?: string;
  source?: 'call' | 'text' | 'email' | 'photo' | 'other';
  details?: string;
  qualification?: Record<string, unknown>;
  isEmergency?: boolean;
}

export async function createLead(input: CreateLeadInput): Promise<{ id: string }> {
  const db = getDb();
  const res = await db
    .from('lead')
    .insert({
      property_id: input.propertyId ?? null,
      contact_id: input.contactId ?? null,
      source: input.source ?? 'call',
      details: input.details ?? null,
      qualification: input.qualification ?? null,
      is_emergency: input.isEmergency ?? false,
      status: input.isEmergency ? 'emergency' : 'new',
    })
    .select('id')
    .single();
  if (res.error) throw res.error;
  return res.data as { id: string };
}

export interface CreateEstimateInput {
  propertyId: string;
  contactId?: string;
  leadId?: string;
  scheduledSlot?: string; // ISO
  zipCluster?: string;
  /** The booked calendar event — needed for the Sage won-recolor (D36). */
  calendarEventId?: string;
}

export async function createEstimate(input: CreateEstimateInput): Promise<{ id: string }> {
  const db = getDb();
  const res = await db
    .from('estimate')
    .insert({
      property_id: input.propertyId,
      contact_id: input.contactId ?? null,
      lead_id: input.leadId ?? null,
      scheduled_slot: input.scheduledSlot ?? null,
      zip_cluster: input.zipCluster ?? null,
      calendar_event_id: input.calendarEventId ?? null,
    })
    .select('id')
    .single();
  if (res.error) throw res.error;
  return res.data as { id: string };
}

export interface CreateJobInput {
  propertyId: string;
  contactId?: string;
  estimateId?: string;
  calendarEventId?: string;
  colorCode?: string;
  scheduledFor?: string; // ISO
}

export async function createJob(input: CreateJobInput): Promise<{ id: string }> {
  const db = getDb();
  const res = await db
    .from('job')
    .insert({
      property_id: input.propertyId,
      contact_id: input.contactId ?? null,
      estimate_id: input.estimateId ?? null,
      calendar_event_id: input.calendarEventId ?? null,
      color_code: input.colorCode ?? null,
      scheduled_for: input.scheduledFor ?? null,
    })
    .select('id')
    .single();
  if (res.error) throw res.error;
  return res.data as { id: string };
}

/**
 * A signed-contract photo converts an Estimate into a booked Job (§5 #14).
 * Creates the contract record (a stored image, not an e-signature — §4.5),
 * marks the estimate won, and books the job. Returns both new ids plus the
 * estimate's calendar event id so the caller can recolor it Sage — Mike's
 * "job was won" convention (D36, markEstimateWonOnCalendar).
 */
export async function convertEstimateToJob(params: {
  estimateId: string;
  propertyId: string;
  contactId?: string;
  contractDriveFileId?: string;
}): Promise<{ jobId: string; contractId: string; estimateCalendarEventId: string | null }> {
  const db = getDb();

  const job = await createJob({
    propertyId: params.propertyId,
    contactId: params.contactId,
    estimateId: params.estimateId,
  });

  const contract = await db
    .from('contract')
    .insert({
      property_id: params.propertyId,
      estimate_id: params.estimateId,
      job_id: job.id,
      signed: true,
      drive_file_id: params.contractDriveFileId ?? null,
    })
    .select('id')
    .single();
  if (contract.error) throw contract.error;

  const upd = await db
    .from('estimate')
    .update({ outcome: 'won' })
    .eq('id', params.estimateId)
    .select('calendar_event_id')
    .single();
  if (upd.error) throw upd.error;

  return {
    jobId: job.id,
    contractId: (contract.data as { id: string }).id,
    estimateCalendarEventId: (upd.data as { calendar_event_id: string | null }).calendar_event_id,
  };
}

export interface CreatePhotoInput {
  propertyId?: string;
  jobId?: string;
  source?: 'customer' | 'mike';
  driveFileId?: string;
  takenAt?: string; // ISO
}

export async function createPhoto(input: CreatePhotoInput): Promise<{ id: string }> {
  const db = getDb();
  const res = await db
    .from('photo')
    .insert({
      property_id: input.propertyId ?? null,
      job_id: input.jobId ?? null,
      source: input.source ?? 'customer',
      drive_file_id: input.driveFileId ?? null,
      taken_at: input.takenAt ?? null,
    })
    .select('id')
    .single();
  if (res.error) throw res.error;
  return res.data as { id: string };
}

// ---------------------------------------------------------------------------
// Permit track (§6B, §7). Persists a screen result and its lifecycle so no crew
// starts protected work without clearance (§6B.3). The DB CHECK constraints
// mirror the code types — screen_status can never be a bare "clear".
// ---------------------------------------------------------------------------

export interface PermitRow {
  id: string;
  property_id: string;
  job_id: string | null;
  city: ServiceCity;
  screen_status: 'PERMIT_LIKELY' | 'REVIEW_NEEDED' | 'NO_OVERLAY_VERIFY';
  in_rpa: boolean;
  status: PermitLifecycle;
  form_ref: string | null;
  ruleset_last_verified: string | null;
  created_at: string;
  updated_at: string;
}

/** Persist a screen result as a permit track. Lifecycle starts at 'needed'. */
export async function createPermit(input: PermitRecordInput): Promise<{ id: string }> {
  const db = getDb();
  const res = await db
    .from('permit')
    .insert({
      property_id: input.propertyId,
      job_id: input.jobId ?? null,
      city: input.city,
      screen_status: input.screenStatus,
      in_rpa: input.inRpa,
      overlay_source: input.overlaySource,
      status: input.status,
      city_contact: input.cityContact,
      ruleset_last_verified: input.rulesetLastVerified,
    })
    .select('id')
    .single();
  if (res.error) throw res.error;
  return res.data as { id: string };
}

/**
 * Latest permit track per property, batched (feeds the leads inbox — the §6B
 * flag rides the lead). One query for all ids; newest row per property wins.
 */
export async function latestPermitsForProperties(propertyIds: string[]): Promise<Map<string, PermitRow>> {
  const out = new Map<string, PermitRow>();
  if (propertyIds.length === 0) return out;
  const db = getDb();
  const res = await db
    .from('permit')
    .select('id, property_id, job_id, city, screen_status, in_rpa, status, form_ref, ruleset_last_verified, created_at, updated_at')
    .in('property_id', propertyIds)
    .order('created_at', { ascending: false });
  if (res.error) throw res.error;
  for (const row of res.data as PermitRow[]) {
    if (!out.has(row.property_id)) out.set(row.property_id, row); // newest-first → first seen wins
  }
  return out;
}

/** The newest permit track for a property (the current screen of record). */
export async function getLatestPermitForProperty(propertyId: string): Promise<PermitRow | null> {
  const db = getDb();
  const res = await db
    .from('permit')
    .select('id, property_id, job_id, city, screen_status, in_rpa, status, form_ref, ruleset_last_verified, created_at, updated_at')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) throw res.error;
  return (res.data as PermitRow | null) ?? null;
}

/**
 * The lifecycle state on file for one permit, or null if there is no such
 * permit. Exists so the §6B.3 clearance step validates a move against the
 * DATABASE rather than against whatever the caller's screen was showing —
 * a stale board must not be able to walk a permit backwards off a clearance
 * while claiming it was never cleared.
 */
export async function permitStateById(
  id: string,
): Promise<{ status: PermitLifecycle; notes: string | null } | null> {
  const db = getDb();
  const res = await db.from('permit').select('status, notes').eq('id', id).maybeSingle();
  if (res.error) throw res.error;
  // `notes` rides along because the clearance step APPENDS to it rather than
  // replacing it: `permit` has one notes column, and a second clearance that
  // overwrote the first would erase the evidence behind the state the crew
  // was working under. Read it here so there is only one round trip.
  return (res.data as { status: PermitLifecycle; notes: string | null } | null) ?? null;
}

/**
 * R9 — which of these job ids have a SIGNED CONTRACT FILED behind them.
 *
 * Returns the subset that do. A job id absent from the result is a job with
 * no filed contract, which under Mike's ruling is still a lead and must not
 * reach a crew phone as a work order.
 *
 * `drive_file_id` is required, not just `signed`: the ruling is "those
 * contracts that you're putting in the signed contract file". A contract row
 * flagged signed with nothing filed does not clear the bar.
 */
export async function jobIdsWithFiledContract(jobIds: string[]): Promise<Set<string>> {
  if (jobIds.length === 0) return new Set();
  const db = getDb();
  const res = await db
    .from('contract')
    .select('job_id')
    .in('job_id', jobIds)
    .eq('signed', true)
    .not('drive_file_id', 'is', null);
  if (res.error) throw res.error;
  const rows = (res.data ?? []) as Array<{ job_id: string | null }>;
  return new Set(rows.map((r) => r.job_id).filter((id): id is string => Boolean(id)));
}

/**
 * Everything `assemblePacket` needs about one permit, in one round trip.
 *
 * WHAT IS DELIBERATELY ABSENT: which city forms have actually been filled
 * out. Nothing in the schema records that, so nothing here invents it — the
 * API says so out loud rather than letting an untracked fact render as a
 * finished checklist item.
 *
 * NOR is the number of trees BEING REMOVED. The property's tree rows are not
 * that number — they are every tree on the lot — and the packet multiplies
 * the removal count by the city's replacement ratio. Feeding it the wrong one
 * would overstate what the city requires of Mike, on the document he hands
 * the city. It is left out until something records the real figure.
 *
 * The owner is whoever is linked to the property as 'owner'. If the caller
 * and the owner are different people (§5.9), the CALLER is not who goes on a
 * city form, so this asks for the owner role specifically and returns nothing
 * rather than substituting.
 */
export interface PacketSourceRow {
  permit: {
    id: string;
    city: string;
    screen_status: string;
    in_rpa: boolean;
    form_ref: string | null;
    labeled_map_file: string | null;
    property_id: string;
  };
  property: { address: string; zip: string | null };
  owner: { name: string | null; phones: string[]; emails: string[] } | null;
  photos: Array<{ drive_file_id: string | null }>;
}

export async function packetSource(permitId: string): Promise<PacketSourceRow | null> {
  const db = getDb();
  const p = await db
    .from('permit')
    .select('id, city, screen_status, in_rpa, form_ref, labeled_map_file, property_id')
    .eq('id', permitId)
    .maybeSingle();
  if (p.error) throw p.error;
  const permit = p.data as PacketSourceRow['permit'] | null;
  if (!permit) return null;

  const [prop, link, photos] = await Promise.all([
    db.from('property').select('address, zip').eq('id', permit.property_id).maybeSingle(),
    db.from('contact_property').select('contact_id').eq('property_id', permit.property_id).eq('role', 'owner').maybeSingle(),
    db.from('photo').select('drive_file_id').eq('property_id', permit.property_id),
  ]);
  for (const r of [prop, link, photos]) if (r.error) throw r.error;

  const contactId = (link.data as { contact_id: string } | null)?.contact_id;
  let owner: PacketSourceRow['owner'] = null;
  if (contactId) {
    const c = await db.from('contact').select('name, phones, emails').eq('id', contactId).maybeSingle();
    if (c.error) throw c.error;
    owner = (c.data as PacketSourceRow['owner']) ?? null;
  }

  return {
    permit,
    property: (prop.data as PacketSourceRow['property'] | null) ?? { address: '', zip: null },
    owner,
    photos: (photos.data as Array<{ drive_file_id: string | null }>) ?? [],
  };
}

/**
 * Advance the permit lifecycle (§6B.3). Setting 'not_required_verified' or
 * 'approved' is the human clearance step — an explicit write here, never a side
 * effect of screening. `formRef` records e.g. the VB PPR record number.
 */
export async function updatePermitStatus(
  id: string,
  status: PermitLifecycle,
  patch?: { formRef?: string; notes?: string; labeledMapFile?: string; packetFile?: string },
): Promise<void> {
  const db = getDb();
  const res = await db
    .from('permit')
    .update({
      status,
      ...(patch?.formRef !== undefined ? { form_ref: patch.formRef } : {}),
      ...(patch?.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch?.labeledMapFile !== undefined ? { labeled_map_file: patch.labeledMapFile } : {}),
      ...(patch?.packetFile !== undefined ? { packet_file: patch.packetFile } : {}),
    })
    .eq('id', id);
  if (res.error) throw res.error;
}

// ---------------------------------------------------------------------------
// Read-side queries for the backend API (server.ts). Same service-role-only
// access model as the writes above.
// ---------------------------------------------------------------------------

export interface LeadListRow {
  id: string;
  source: string;
  details: string | null;
  qualification: Record<string, unknown> | null;
  is_emergency: boolean;
  status: string;
  created_at: string;
  contact: { name: string | null; phones: string[]; is_first_timer: boolean } | null;
  property: { id: string; address: string; city: string; zip: string | null } | null;
}

/** Newest leads for the inbox (default: everything not yet converted/lost). */
export async function listLeads(limit = 25): Promise<LeadListRow[]> {
  const db = getDb();
  const res = await db
    .from('lead')
    .select(
      'id, source, details, qualification, is_emergency, status, created_at, contact:contact_id(name, phones, is_first_timer), property:property_id(id, address, city, zip)',
    )
    .in('status', ['new', 'qualified', 'emergency'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (res.error) throw res.error;
  return res.data as unknown as LeadListRow[];
}

export interface DayStopRow {
  id: string;
  kind: 'estimate' | 'job';
  timeIso: string | null;
  name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  isFirstTimer: boolean | null;
  scope: string | null;
}

/** Every estimate + job scheduled inside [fromIso, toIso) — feeds the brief. */
export async function listStopsBetween(fromIso: string, toIso: string): Promise<DayStopRow[]> {
  const db = getDb();
  const [est, jobs] = await Promise.all([
    db
      .from('estimate')
      .select('id, scheduled_slot, zip_cluster, property:property_id(address, city, zip), contact:contact_id(name, phones, is_first_timer)')
      .gte('scheduled_slot', fromIso)
      .lt('scheduled_slot', toIso),
    db
      .from('job')
      .select('id, scheduled_for, materials, property:property_id(address, city, zip), contact:contact_id(name, phones, is_first_timer)')
      .gte('scheduled_for', fromIso)
      .lt('scheduled_for', toIso),
  ]);
  if (est.error) throw est.error;
  if (jobs.error) throw jobs.error;

  type Joined = {
    id: string;
    scheduled_slot?: string;
    scheduled_for?: string;
    materials?: string | null;
    property: { address: string; city: string; zip: string | null } | null;
    contact: { name: string | null; phones: string[]; is_first_timer: boolean } | null;
  };
  const map = (r: Joined, kind: 'estimate' | 'job'): DayStopRow => ({
    id: r.id,
    kind,
    timeIso: r.scheduled_slot ?? r.scheduled_for ?? null,
    name: r.contact?.name ?? null,
    phone: r.contact?.phones?.[0] ?? null,
    address: r.property?.address ?? null,
    city: r.property?.city ?? null,
    zip: r.property?.zip ?? null,
    isFirstTimer: r.contact?.is_first_timer ?? null,
    scope: r.materials ?? null,
  });
  return [
    ...(est.data as unknown as Joined[]).map((r) => map(r, 'estimate')),
    ...(jobs.data as unknown as Joined[]).map((r) => map(r, 'job')),
  ];
}

// ---------------------------------------------------------------------------
// Follow-up queue inputs (§5A #16–20) — read models for src/ops/followUps.ts.
// The engine is pure; these fetch the state it reads. Consent/suppression come
// from the contact row so the §4 gates are evaluated on live data.
// ---------------------------------------------------------------------------

interface FollowUpContactJoin {
  name: string | null;
  phones: string[];
  consent_source: string | null;
  opted_out: boolean;
}

export interface FollowUpEstimateRow {
  id: string;
  scheduled_slot: string | null;
  visited: boolean | null;
  outcome: string;
  last_follow_up_at: string | null;
  follow_up_count: number;
  contact: FollowUpContactJoin | null;
}

/** Open estimates (pending/no-show) with the consent facts riding along. */
export async function listFollowUpEstimates(): Promise<FollowUpEstimateRow[]> {
  const db = getDb();
  const res = await db
    .from('estimate')
    .select(
      'id, scheduled_slot, visited, outcome, last_follow_up_at, follow_up_count, contact:contact_id (name, phones, consent_source, opted_out)',
    )
    .in('outcome', ['pending', 'no_show'])
    .order('scheduled_slot', { ascending: true })
    .limit(200);
  if (res.error) throw res.error;
  return res.data as unknown as FollowUpEstimateRow[];
}

export interface FollowUpJobRow {
  id: string;
  status: string;
  completed_at: string | null;
  paid_at: string | null;
  review_requested_at: string | null;
  contact: FollowUpContactJoin | null;
}

/** Completed/paid jobs that may still owe a §18 review request. */
export async function listFollowUpJobs(): Promise<FollowUpJobRow[]> {
  const db = getDb();
  const res = await db
    .from('job')
    .select('id, status, completed_at, paid_at, review_requested_at, contact:contact_id (name, phones, consent_source, opted_out)')
    .in('status', ['completed', 'paid'])
    .is('review_requested_at', null)
    .limit(200);
  if (res.error) throw res.error;
  return res.data as unknown as FollowUpJobRow[];
}

// ---------------------------------------------------------------------------
// Outcome & outreach bookkeeping (§5A #14, #16–20 write side). These are the
// state changes behind the app's buttons: Mike taps, ARBOR records. The DB
// CHECK on estimate.outcome is the validator — unknown values throw here.
// ---------------------------------------------------------------------------

export type EstimateOutcome = 'pending' | 'won' | 'lost' | 'no_show';

export async function updateEstimateOutcome(estimateId: string, outcome: EstimateOutcome): Promise<void> {
  const db = getDb();
  const res = await db.from('estimate').update({ outcome, updated_at: new Date().toISOString() }).eq('id', estimateId);
  if (res.error) throw res.error;
}

/** Record that a §16 follow-up actually went out (advances the 2-day cadence). */
export async function recordFollowUpSent(estimateId: string, atIso: string): Promise<void> {
  const db = getDb();
  const cur = await db.from('estimate').select('follow_up_count').eq('id', estimateId).single();
  if (cur.error) throw cur.error;
  const res = await db
    .from('estimate')
    .update({
      last_follow_up_at: atIso,
      follow_up_count: ((cur.data as { follow_up_count: number }).follow_up_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', estimateId);
  if (res.error) throw res.error;
}

/** Record the once-ever §18 review request. */
export async function recordReviewRequested(jobId: string, atIso: string): Promise<void> {
  const db = getDb();
  const res = await db.from('job').update({ review_requested_at: atIso, updated_at: new Date().toISOString() }).eq('id', jobId);
  if (res.error) throw res.error;
}

// ---------------------------------------------------------------------------
// Repeat-customer memory (§5A #27): the property's work history, surfaced so
// every call feels personal. Batch read — rides the lead list like permits do.
// ---------------------------------------------------------------------------

export interface PropertyHistoryRow {
  property_id: string;
  kind: 'job' | 'estimate';
  when: string | null;
  scope: string | null;
  status: string | null;
}

/** Latest completed/paid job (fallback: latest estimate) per property. */
export async function latestHistoryForProperties(propertyIds: string[]): Promise<Map<string, PropertyHistoryRow>> {
  const out = new Map<string, PropertyHistoryRow>();
  if (propertyIds.length === 0) return out;
  const db = getDb();
  const jobs = await db
    .from('job')
    .select('property_id, scheduled_for, completed_at, materials, status')
    .in('property_id', propertyIds)
    .in('status', ['completed', 'paid'])
    .order('completed_at', { ascending: false, nullsFirst: false });
  if (jobs.error) throw jobs.error;
  for (const j of jobs.data as Array<{ property_id: string; scheduled_for: string | null; completed_at: string | null; materials: string | null; status: string }>) {
    if (!out.has(j.property_id)) {
      out.set(j.property_id, { property_id: j.property_id, kind: 'job', when: j.completed_at ?? j.scheduled_for, scope: j.materials, status: j.status });
    }
  }
  const remaining = propertyIds.filter((id) => !out.has(id));
  if (remaining.length > 0) {
    const ests = await db
      .from('estimate')
      .select('property_id, scheduled_slot, outcome')
      .in('property_id', remaining)
      .neq('outcome', 'pending')
      .order('scheduled_slot', { ascending: false, nullsFirst: false });
    if (ests.error) throw ests.error;
    for (const e of ests.data as Array<{ property_id: string; scheduled_slot: string | null; outcome: string }>) {
      if (!out.has(e.property_id)) {
        out.set(e.property_id, { property_id: e.property_id, kind: 'estimate', when: e.scheduled_slot, scope: null, status: e.outcome });
      }
    }
  }
  return out;
}

/**
 * Past customers for seasonal outreach (§5A #19): consented, unsuppressed
 * contacts with a completed/paid job on file, with their property city so the
 * nudge only goes where the storm actually is.
 */
export interface PastCustomerRow {
  contact_id: string;
  name: string | null;
  city: string | null;
  last_job_at: string | null;
  consent_source: string | null;
  opted_out: boolean;
}

export async function listPastCustomers(): Promise<PastCustomerRow[]> {
  const db = getDb();
  const res = await db
    .from('job')
    .select('completed_at, contact:contact_id (id, name, consent_source, opted_out), property:property_id (city)')
    .in('status', ['completed', 'paid'])
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(500);
  if (res.error) throw res.error;
  const seen = new Map<string, PastCustomerRow>();
  type Row = {
    completed_at: string | null;
    contact: { id: string; name: string | null; consent_source: string | null; opted_out: boolean } | null;
    property: { city: string | null } | null;
  };
  for (const r of res.data as unknown as Row[]) {
    if (!r.contact || seen.has(r.contact.id)) continue;
    seen.set(r.contact.id, {
      contact_id: r.contact.id,
      name: r.contact.name,
      city: r.property?.city ?? null,
      last_job_at: r.completed_at,
      consent_source: r.contact.consent_source,
      opted_out: r.contact.opted_out,
    });
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Location intelligence (§5A #21–24). Pings are Mike's OWN phone — never
// customer data — accepted only through the §24 gate in the API layer, and
// kept 72 hours max: every insert purges anything older.
// ---------------------------------------------------------------------------

export async function recordLocationPing(input: { lat: number; lng: number; accuracyM?: number }): Promise<void> {
  const db = getDb();
  const ins = await db.from('location_ping').insert({ lat: input.lat, lng: input.lng, accuracy_m: input.accuracyM ?? null });
  if (ins.error) throw ins.error;
  // Retention is part of the §24 promise, so it rides the write path instead
  // of trusting a cron that doesn't exist on serverless.
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  await db.from('location_ping').delete().lt('at', cutoff);
}

export interface LocationPingRow {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  at: string;
}

export async function listPingsSince(sinceIso: string): Promise<LocationPingRow[]> {
  const db = getDb();
  const res = await db.from('location_ping').select('lat, lng, accuracy_m, at').gte('at', sinceIso).order('at', { ascending: true }).limit(2000);
  if (res.error) throw res.error;
  return res.data as LocationPingRow[];
}

/** Tiny ops key-value store (today: the §24 tracking master switch). */
export async function getOpsSetting<T>(key: string): Promise<T | null> {
  const db = getDb();
  const res = await db.from('ops_setting').select('value').eq('key', key).maybeSingle();
  if (res.error) throw res.error;
  return res.data ? ((res.data as { value: T }).value ?? null) : null;
}

export async function setOpsSetting(key: string, value: unknown): Promise<void> {
  const db = getDb();
  const res = await db.from('ops_setting').upsert({ key, value, updated_at: new Date().toISOString() });
  if (res.error) throw res.error;
}

/** Geofence-confirmed arrival at an estimate stop (#21/#22). Idempotent: first arrival wins. */
export async function markEstimateVisited(estimateId: string, atIso: string): Promise<void> {
  const db = getDb();
  const res = await db
    .from('estimate')
    .update({ visited: true, visited_at: atIso, updated_at: new Date().toISOString() })
    .eq('id', estimateId)
    .is('visited_at', null);
  if (res.error) throw res.error;
}

// ---------------------------------------------------------------------------
// Review loop (§5A #29): one conversation_log row per call session. The
// transcript lives ONLY here (RLS-locked) — never in server logs (§4.3).
// ---------------------------------------------------------------------------

export interface ConversationTurn {
  at: string;
  caller: string;
  reply: string;
  /** Routing/guard facts worth reviewing: emergency, guard_blocked, intent. */
  flags: string[];
}

export async function appendConversationTurn(sessionKey: string, channel: 'voice' | 'sms' | 'web', turn: ConversationTurn): Promise<void> {
  const db = getDb();
  const cur = await db.from('conversation_log').select('id, turns').eq('session_key', sessionKey).maybeSingle();
  if (cur.error) throw cur.error;
  if (!cur.data) {
    const ins = await db.from('conversation_log').insert({ session_key: sessionKey, channel, turns: [turn], last_turn_at: turn.at });
    if (ins.error) throw ins.error;
    return;
  }
  const row = cur.data as { id: string; turns: ConversationTurn[] };
  const upd = await db
    .from('conversation_log')
    .update({ turns: [...row.turns, turn], last_turn_at: turn.at })
    .eq('id', row.id);
  if (upd.error) throw upd.error;
}

export interface ConversationLogRow {
  id: string;
  session_key: string;
  channel: string;
  started_at: string;
  last_turn_at: string;
  turns: ConversationTurn[];
  reviewed: boolean;
}

export async function listConversations(limit = 20, unreviewedOnly = false): Promise<ConversationLogRow[]> {
  const db = getDb();
  let q = db
    .from('conversation_log')
    .select('id, session_key, channel, started_at, last_turn_at, turns, reviewed')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (unreviewedOnly) q = q.eq('reviewed', false);
  const res = await q;
  if (res.error) throw res.error;
  return res.data as unknown as ConversationLogRow[];
}

export async function markConversationReviewed(id: string): Promise<void> {
  const db = getDb();
  const res = await db.from('conversation_log').update({ reviewed: true }).eq('id', id);
  if (res.error) throw res.error;
}

// ---------------------------------------------------------------------------
// §6 Predictive Property Intelligence: the twin's trees with real service
// history, plus the property's best contact (from its latest completed job)
// with the §4 consent facts the outreach gate needs.
// ---------------------------------------------------------------------------

export interface GrowthTargetRow {
  propertyId: string;
  address: string;
  city: string | null;
  contactId: string | null;
  name: string | null;
  consentSource: string | null;
  optedOut: boolean | null;
  trees: Array<{ id: string; species: string | null; size: string | null; last_service_date: string | null }>;
}

export async function listGrowthTargets(): Promise<GrowthTargetRow[]> {
  const db = getDb();
  const trees = await db
    .from('tree')
    .select('id, species, size, last_service_date, property:property_id (id, address, city)')
    .not('last_service_date', 'is', null)
    .limit(2000);
  if (trees.error) throw trees.error;
  type TreeRow = {
    id: string;
    species: string | null;
    size: string | null;
    last_service_date: string | null;
    property: { id: string; address: string; city: string | null } | null;
  };
  const byProperty = new Map<string, GrowthTargetRow>();
  for (const t of trees.data as unknown as TreeRow[]) {
    if (!t.property) continue;
    let row = byProperty.get(t.property.id);
    if (!row) {
      row = {
        propertyId: t.property.id,
        address: t.property.address,
        city: t.property.city,
        contactId: null,
        name: null,
        consentSource: null,
        optedOut: null,
        trees: [],
      };
      byProperty.set(t.property.id, row);
    }
    row.trees.push({ id: t.id, species: t.species, size: t.size, last_service_date: t.last_service_date });
  }
  if (byProperty.size === 0) return [];
  // Best contact per property: whoever the latest completed/paid job was for.
  const jobs = await db
    .from('job')
    .select('property_id, completed_at, contact:contact_id (id, name, consent_source, opted_out)')
    .in('property_id', [...byProperty.keys()])
    .in('status', ['completed', 'paid'])
    .order('completed_at', { ascending: false, nullsFirst: false });
  if (jobs.error) throw jobs.error;
  type JobRow = {
    property_id: string;
    contact: { id: string; name: string | null; consent_source: string | null; opted_out: boolean } | null;
  };
  for (const j of jobs.data as unknown as JobRow[]) {
    const row = byProperty.get(j.property_id);
    if (!row || row.contactId || !j.contact) continue;
    row.contactId = j.contact.id;
    row.name = j.contact.name;
    row.consentSource = j.contact.consent_source;
    row.optedOut = j.contact.opted_out;
  }
  return [...byProperty.values()];
}

/** Write-through of the computed forecast into the Phase-1 column (D12 closes here). */
export async function setTreeForecast(treeId: string, dueFromDate: string): Promise<void> {
  const db = getDb();
  const res = await db.from('tree').update({ next_due_forecast: dueFromDate, updated_at: new Date().toISOString() }).eq('id', treeId);
  if (res.error) throw res.error;
}

// ---------------------------------------------------------------------------
// The Book (§6 twin surface, #36): every property ARBOR has ever touched,
// openable to its full twin — history, trees, permits, what's coming due.
// ---------------------------------------------------------------------------

export interface PropertyListRow {
  id: string;
  address: string;
  city: string;
  zip: string | null;
  hazard_power_lines: boolean;
  hazard_structures: boolean;
  trees: Array<{ count: number }>;
  jobs: Array<{ count: number }>;
  estimates: Array<{ count: number }>;
}

export async function listProperties(limit = 200): Promise<PropertyListRow[]> {
  const db = getDb();
  const res = await db
    .from('property')
    .select('id, address, city, zip, hazard_power_lines, hazard_structures, trees:tree(count), jobs:job(count), estimates:estimate(count)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (res.error) throw res.error;
  return res.data as unknown as PropertyListRow[];
}

export interface PropertyTwinRow {
  property: {
    id: string;
    address: string;
    city: string;
    zip: string | null;
    lot_notes: string | null;
    hazard_power_lines: boolean;
    hazard_structures: boolean;
  };
  trees: Array<{ id: string; species: string | null; size: string | null; location_on_lot: string | null; last_service_date: string | null; next_due_forecast: string | null }>;
  jobs: Array<{ id: string; status: string; scheduled_for: string | null; completed_at: string | null; materials: string | null; contact: { name: string | null } | null }>;
  estimates: Array<{ id: string; scheduled_slot: string | null; outcome: string | null; contact: { name: string | null } | null }>;
  permits: Array<{ id: string; city: string; screen_status: string; in_rpa: boolean; status: string; created_at: string }>;
  correspondence: Array<{ id: string; city: string; kind: string; case_ref: string | null; subject: string | null; received_at: string | null }>;
}

export async function getPropertyTwin(propertyId: string): Promise<PropertyTwinRow | null> {
  const db = getDb();
  const prop = await db
    .from('property')
    .select('id, address, city, zip, lot_notes, hazard_power_lines, hazard_structures')
    .eq('id', propertyId)
    .maybeSingle();
  if (prop.error) throw prop.error;
  if (!prop.data) return null;
  const [trees, jobs, estimates, permits, corr] = await Promise.all([
    db.from('tree').select('id, species, size, location_on_lot, last_service_date, next_due_forecast').eq('property_id', propertyId),
    db.from('job').select('id, status, scheduled_for, completed_at, materials, contact:contact_id(name)').eq('property_id', propertyId).order('scheduled_for', { ascending: false }).limit(20),
    db.from('estimate').select('id, scheduled_slot, outcome, contact:contact_id(name)').eq('property_id', propertyId).order('scheduled_slot', { ascending: false }).limit(20),
    db.from('permit').select('id, city, screen_status, in_rpa, status, created_at').eq('property_id', propertyId).order('created_at', { ascending: false }),
    db.from('permit_correspondence').select('id, city, kind, case_ref, subject, received_at').eq('property_id', propertyId).order('received_at', { ascending: false }),
  ]);
  for (const r of [trees, jobs, estimates, permits, corr]) if (r.error) throw r.error;
  return {
    property: prop.data as PropertyTwinRow['property'],
    trees: trees.data as PropertyTwinRow['trees'],
    jobs: jobs.data as unknown as PropertyTwinRow['jobs'],
    estimates: estimates.data as unknown as PropertyTwinRow['estimates'],
    permits: permits.data as PropertyTwinRow['permits'],
    correspondence: corr.data as PropertyTwinRow['correspondence'],
  };
}

/** Mike's tap on a lead: qualified / spam / converted / lost (DB CHECK validates). */
export async function updateLeadStatus(leadId: string, status: 'new' | 'qualified' | 'spam' | 'converted' | 'lost'): Promise<void> {
  const db = getDb();
  const res = await db.from('lead').update({ status, updated_at: new Date().toISOString() }).eq('id', leadId);
  if (res.error) throw res.error;
}

// ============================================================================
// Loop-Closer snapshot (§1E, §8A.5 #3) — everything the silence rules need in
// one round trip. outcome age uses updated_at (last touch) — the honest proxy
// until outcome_at exists.
// ============================================================================
export interface LoopSnapshotRows {
  estimates: Array<{
    id: string; property_id: string | null; scheduled_slot: string | null;
    visited_at: string | null; outcome: string; updated_at: string;
  }>;
  jobs: Array<{
    id: string; property_id: string | null; scheduled_for: string | null; status: string;
    completed_at?: string | null;
    /** undefined = the invoice check could not run (never "no invoice"). */
    has_invoice?: boolean;
  }>;
  leads: Array<{ id: string; created_at: string; status: string; qualification: Record<string, unknown> | null }>;
}

export async function loadLoopSnapshot(): Promise<LoopSnapshotRows> {
  const db = getDb();
  // Windows are shaped so open loops can NEVER age out silently (§1E — the
  // oldest loop is the worst one, not the first to disappear):
  //  - estimates: any still-open state (pending/won), bounded by a wide
  //    updated_at horizon so the table stays scannable
  //  - jobs: open states windowed on scheduled_for (jobs are booked weeks
  //    ahead — created_at would hide both the future and the stale past)
  //  - leads: status 'new' only; 45 days is generous for a callback
  const wide = new Date(Date.now() - 180 * 86400_000).toISOString();
  const jobHorizon = new Date(Date.now() - 90 * 86400_000).toISOString();
  const leadSince = new Date(Date.now() - 45 * 86400_000).toISOString();
  const [estimates, jobs, done, leads] = await Promise.all([
    db.from('estimate')
      .select('id, property_id, scheduled_slot, visited_at, outcome, updated_at')
      .in('outcome', ['pending', 'won'])
      .gte('updated_at', wide),
    db.from('job')
      .select('id, property_id, scheduled_for, status')
      .in('status', ['booked', 'in_progress'])
      .gte('scheduled_for', jobHorizon),
    // Completed work — the money half of the loop. Deliberately on the WIDE
    // horizon, not the 90-day job window: an unbilled job from five months ago
    // is the WORST one, and it must never age quietly out of the queue (§1E).
    db.from('job')
      .select('id, property_id, scheduled_for, status, completed_at')
      .eq('status', 'completed')
      .gte('completed_at', wide),
    db.from('lead')
      .select('id, created_at, status, qualification')
      .eq('status', 'new')
      .gte('created_at', leadSince),
  ]);
  for (const r of [estimates, jobs, done, leads]) if (r.error) throw r.error;

  // Which completed jobs already have an invoice. A FAILED read leaves
  // has_invoice undefined so the rule stays silent (§1B) rather than
  // reporting every finished job as unbilled.
  const doneRows = (done.data ?? []) as Array<Record<string, unknown>>;
  let invoiced: Set<string> | null = null;
  if (doneRows.length > 0) {
    const inv = await db.from('invoice')
      .select('job_id')
      .in('job_id', doneRows.map((j) => j.id as string));
    if (!inv.error) invoiced = new Set((inv.data ?? []).map((r) => r.job_id as string));
  } else {
    invoiced = new Set();
  }

  return {
    estimates: (estimates.data ?? []) as LoopSnapshotRows['estimates'],
    jobs: [
      ...((jobs.data ?? []) as LoopSnapshotRows['jobs']),
      ...doneRows.map((j) => ({
        id: j.id as string,
        property_id: (j.property_id as string | null) ?? null,
        scheduled_for: (j.scheduled_for as string | null) ?? null,
        status: j.status as string,
        completed_at: (j.completed_at as string | null) ?? null,
        has_invoice: invoiced ? invoiced.has(j.id as string) : undefined,
      })),
    ],
    leads: (leads.data ?? []) as LoopSnapshotRows['leads'],
  };
}

/**
 * Latest non-cancelled job creation time per property. The won-but-never-
 * booked rule compares this against the WIN's timestamp — a paid job from
 * last year must not hide a fresh unbooked win (repeat customers are the
 * base of this business).
 */
export async function latestJobCreatedByProperty(propertyIds: string[]): Promise<Map<string, string>> {
  if (propertyIds.length === 0) return new Map();
  const db = getDb();
  const res = await db.from('job')
    .select('property_id, created_at')
    .in('property_id', propertyIds)
    .neq('status', 'cancelled');
  if (res.error) throw res.error;
  const out = new Map<string, string>();
  for (const r of res.data ?? []) {
    const pid = r.property_id as string;
    const at = r.created_at as string;
    if (pid && (!out.has(pid) || out.get(pid)! < at)) out.set(pid, at);
  }
  return out;
}

// ============================================================================
// §6J2.4 leakage line — log events, derive the load from actuals.
// ============================================================================
export async function createLeakageEvent(input: {
  jobId?: string; unitId?: string; kind: 'equipment_repair' | 'property_damage';
  cause?: string; cost: number; notes?: string;
}): Promise<{ id: string }> {
  const db = getDb();
  const res = await db.from('leakage_event').insert({
    job_id: input.jobId ?? null,
    unit_id: input.unitId ?? null,
    kind: input.kind,
    cause: input.cause ?? null,
    cost: input.cost,
    notes: input.notes ?? null,
  }).select('id').single();
  if (res.error) throw res.error;
  return { id: res.data.id as string };
}

/** Trailing-window totals for deriveLeakagePct. Nulls = not enough data (honest). */
export async function leakageWindow(trailingDays = 90): Promise<{ leakageTotal: number | null; revenueTotal: number | null }> {
  const db = getDb();
  const since = new Date(Date.now() - trailingDays * 86400_000).toISOString().slice(0, 10);
  const [leak, rev] = await Promise.all([
    db.from('leakage_event').select('cost').gte('occurred_on', since),
    db.from('invoice').select('amount').eq('status', 'paid').gte('paid_at', since + 'T00:00:00Z'),
  ]);
  if (leak.error) throw leak.error;
  if (rev.error) throw rev.error;
  const leakRows = leak.data ?? [];
  const revRows = rev.data ?? [];
  return {
    leakageTotal: leakRows.length ? leakRows.reduce((s, r) => s + Number(r.cost), 0) : null,
    revenueTotal: revRows.length ? revRows.reduce((s, r) => s + Number(r.amount), 0) : null,
  };
}

/** Recent agent runs for the admin surface (§8A.6g visibility). */
export async function listAgentRuns(limit = 20): Promise<unknown[]> {
  const db = getDb();
  const res = await db.from('agent_run')
    .select('id, agent, status, output_summary, duration_ms, started_at, finished_at')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (res.error) throw res.error;
  return res.data ?? [];
}

// ============================================================================
// Calendar surface (§3.22 / §6M2.3) — the app shows MIKE'S Google Calendar,
// not a schedule of its own. These rows are the mirror the hourly sweep keeps
// in step with Google (his manual moves win, always); each carries its
// calendar_event_id so the app can deep-link straight into the real event.
// ============================================================================
export interface CalendarEventRow {
  id: string;
  kind: 'estimate' | 'job';
  timeIso: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  scope: string | null;
  status: string | null;
  propertyId: string | null;
  calendarEventId: string | null;
}

export async function listCalendarEvents(fromIso: string, toIso: string): Promise<CalendarEventRow[]> {
  const db = getDb();
  const [est, jobs] = await Promise.all([
    db.from('estimate')
      .select('id, scheduled_slot, outcome, property_id, property:property_id(address, city, zip), contact:contact_id(name)')
      .gte('scheduled_slot', fromIso).lt('scheduled_slot', toIso),
    db.from('job')
      .select('id, scheduled_for, status, materials, calendar_event_id, property_id, property:property_id(address, city, zip), contact:contact_id(name)')
      .gte('scheduled_for', fromIso).lt('scheduled_for', toIso),
  ]);
  if (est.error) throw est.error;
  if (jobs.error) throw jobs.error;
  type Joined = {
    id: string; scheduled_slot?: string; scheduled_for?: string;
    outcome?: string; status?: string; materials?: string | null;
    calendar_event_id?: string | null; property_id: string | null;
    property: { address: string; city: string; zip: string | null } | null;
    contact: { name: string | null } | null;
  };
  const map = (r: Joined, kind: 'estimate' | 'job'): CalendarEventRow => ({
    id: r.id,
    kind,
    timeIso: r.scheduled_slot ?? r.scheduled_for ?? null,
    name: r.contact?.name ?? null,
    address: r.property?.address ?? null,
    city: r.property?.city ?? null,
    zip: r.property?.zip ?? null,
    scope: r.materials ?? null,
    status: r.status ?? r.outcome ?? null,
    propertyId: r.property_id,
    calendarEventId: r.calendar_event_id ?? null,
  });
  return [
    ...((est.data ?? []) as unknown as Joined[]).map((r) => map(r, 'estimate')),
    ...((jobs.data ?? []) as unknown as Joined[]).map((r) => map(r, 'job')),
  ].sort((a, b) => String(a.timeIso ?? '').localeCompare(String(b.timeIso ?? '')));
}

// ============================================================================
// Crew surface (§6F) — the work orders a crew member may see, and the gated
// briefing acknowledgment. Reads stay crew-safe: this returns the job facts
// buildCrewPayload() is allowed to expose, nothing more.
// ============================================================================
export interface CrewJobRow {
  jobId: string;
  scheduledFor: string | null;
  address: string;
  city: string;
  scope: string | null;
  hazardPowerLines: boolean;
  hazardStructures: boolean;
  permitStatus: string | null;
  /** True when the permit lookup could not answer — UNKNOWN, not "fine". */
  permitScreenPending: boolean;
  propertyId: string;
}

/** Jobs booked inside a window, with the site facts the crew needs. */
export async function listCrewJobs(fromIso: string, toIso: string): Promise<CrewJobRow[]> {
  const db = getDb();
  const res = await db.from('job')
    .select('id, scheduled_for, materials, property_id, property:property_id(address, city, hazard_power_lines, hazard_structures)')
    .gte('scheduled_for', fromIso).lt('scheduled_for', toIso)
    .in('status', ['booked', 'in_progress'])
    .order('scheduled_for', { ascending: true });
  if (res.error) throw res.error;
  type Row = {
    id: string; scheduled_for: string | null; materials: string | null; property_id: string;
    property: { address: string; city: string; hazard_power_lines: boolean; hazard_structures: boolean } | null;
  };
  const rows = (res.data ?? []) as unknown as Row[];
  const propertyIds = [...new Set(rows.map((r) => r.property_id).filter(Boolean))];
  // Permit posture rides along so the crew note can warn — never clear (§6B.3).
  let permits = new Map<string, { screen_status: string }>();
  let permitLookupFailed = false;
  try {
    const p = await latestPermitsForProperties(propertyIds);
    permits = new Map([...p].map(([k, v]) => [k, { screen_status: v.screen_status }]));
  } catch (err) {
    // A silent catch on a SAFETY surface reads as "no permit concern". It is
    // not: the crew payload says UNKNOWN, and ops sees why (§1B, §4.3 no PII).
    console.error('[crew] permit flag fetch failed:', err instanceof Error ? err.message : 'error');
    permitLookupFailed = true;
  }
  return rows.map((r) => ({
    jobId: r.id,
    scheduledFor: r.scheduled_for,
    address: r.property?.address ?? '',
    city: r.property?.city ?? '',
    scope: r.materials,
    hazardPowerLines: r.property?.hazard_power_lines ?? false,
    hazardStructures: r.property?.hazard_structures ?? false,
    permitStatus: permits.get(r.property_id)?.screen_status ?? null,
    // No screen on file is UNKNOWN — the three screen_status values are all
    // warnings; there is no "screened and fine" value to fall back on.
    permitScreenPending: permitLookupFailed || !permits.has(r.property_id),
    propertyId: r.property_id,
  }));
}

/** Record a gated-briefing acknowledgment + its PAYABLE time entry (§4.6). */
export async function recordBriefingAck(input: {
  crewMemberId: string; itemIds: string[];
  startedAtIso: string; completedAtIso: string; payableMinutes: number;
}): Promise<{ trainingEventId: string; timeEntryId: string }> {
  const db = getDb();
  // Time first: if the event write fails, the crew member is still PAID for
  // the minutes they spent. Wage law is not contingent on our bookkeeping.
  const time = await db.from('time_entry').insert({
    crew_member_id: input.crewMemberId,
    kind: 'briefing',
    started_at: input.startedAtIso,
    ended_at: input.completedAtIso,
    minutes: input.payableMinutes,
    payable: true,
    source: 'tailgate_ack',
  }).select('id').single();
  if (time.error) throw time.error;

  const evt = await db.from('training_event').insert({
    crew_member_id: input.crewMemberId,
    item_ids: input.itemIds,
    context: 'tailgate_ack',
    started_at: input.startedAtIso,
    completed_at: input.completedAtIso,
    time_entry_id: time.data.id,
  }).select('id').single();
  if (evt.error) throw evt.error;
  return { trainingEventId: evt.data.id as string, timeEntryId: time.data.id as string };
}

/** Today's published tailgate briefing (§6M.8). Null when none is published. */
export async function todaysBriefing(): Promise<{ id: string; body: string; standardRefs: string[] } | null> {
  const db = getDb();
  const res = await db.from('training_item')
    .select('id, body, topic')
    .eq('type', 'tailgate_brief')
    .eq('published', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) throw res.error;
  if (!res.data) return null;
  const raw = res.data.body as { text?: string; standardRefs?: string[] } | string;
  const text = typeof raw === 'string' ? raw : raw.text ?? '';
  const refs = typeof raw === 'string' ? [] : raw.standardRefs ?? [];
  return { id: res.data.id as string, body: text, standardRefs: refs };
}

// ============================================================================
// Fleet & equipment (§6E / §6E2). Unit records, parts logs, breakdown flow,
// per-tool preventive maintenance. §6E2.3 governs: Arbo NEVER orders and
// NEVER stores a card — these functions build lists and record facts.
// ============================================================================
export interface UnitRow {
  id: string;
  name: string;
  kind: string;
  vinOrSerial: string;
  status: string;
  heightInches: number | null;
  weightLbsLoaded: number | null;
  openTasks: number;
}

export async function listUnits(): Promise<UnitRow[]> {
  const db = getDb();
  const [units, tasks] = await Promise.all([
    db.from('equipment_unit')
      .select('id, name, kind, vin_or_serial, status, height_inches, weight_lbs_loaded')
      .neq('status', 'retired')
      .order('name', { ascending: true }),
    db.from('maintenance_task').select('unit_id').eq('status', 'open'),
  ]);
  if (units.error) throw units.error;
  if (tasks.error) throw tasks.error;
  const openByUnit = new Map<string, number>();
  for (const t of tasks.data ?? []) {
    const id = t.unit_id as string | null;
    if (id) openByUnit.set(id, (openByUnit.get(id) ?? 0) + 1);
  }
  return (units.data ?? []).map((u) => ({
    id: u.id as string,
    name: u.name as string,
    kind: u.kind as string,
    vinOrSerial: u.vin_or_serial as string,
    status: u.status as string,
    heightInches: u.height_inches as number | null,
    weightLbsLoaded: u.weight_lbs_loaded as number | null,
    openTasks: openByUnit.get(u.id as string) ?? 0,
  }));
}

/** This unit's own parts history — the only source a suggestion may come from. */
export async function listUnitParts(unitId: string): Promise<Array<{ partNumber: string; description: string; supplier: string | null; lastPrice: number | null }>> {
  const db = getDb();
  const res = await db.from('equipment_part')
    .select('part_number, shared_fitment, supplier, last_price')
    .eq('unit_id', unitId);
  if (res.error) throw res.error;
  return (res.data ?? []).map((p) => ({
    partNumber: p.part_number as string,
    description: (p.shared_fitment as string | null) ?? (p.part_number as string),
    supplier: p.supplier as string | null,
    lastPrice: p.last_price as number | null,
  }));
}

/**
 * How many maintenance tasks are already open on this unit. This is NOT a
 * schedule check — nothing links a unit to a job yet, so the action plan
 * reports that as an unknown rather than guessing (§1B).
 */
export async function unitOpenTaskCount(unitId: string): Promise<number> {
  const db = getDb();
  const res = await db.from('maintenance_task')
    .select('id')
    .eq('unit_id', unitId)
    .eq('status', 'open');
  if (res.error) throw res.error;
  return (res.data ?? []).length;
}

/** This unit's current status, or null when there is no such unit. */
export async function unitStatus(unitId: string): Promise<'up' | 'down' | 'maintenance' | 'retired' | null> {
  const db = getDb();
  const res = await db.from('equipment_unit').select('status').eq('id', unitId).maybeSingle();
  if (res.error) throw res.error;
  return (res.data?.status as 'up' | 'down' | 'maintenance' | 'retired' | undefined) ?? null;
}

/** Record the breakdown: set the unit's status and open a maintenance task. */
export async function recordBreakdown(input: {
  unitId: string; newStatus: string; description: string;
  reportedBy: string; mediaRefs: string[];
}): Promise<{ taskId: string }> {
  const db = getDb();
  const upd = await db.from('equipment_unit')
    .update({ status: input.newStatus, updated_at: new Date().toISOString() })
    .eq('id', input.unitId);
  if (upd.error) throw upd.error;
  const task = await db.from('maintenance_task').insert({
    unit_id: input.unitId,
    description: `FIELD REPORT: ${input.description}`,
    status: 'open',
    due_at: new Date().toISOString(),
  }).select('id').single();
  if (task.error) throw task.error;
  return { taskId: task.data.id as string };
}

/**
 * Close a maintenance task. The photo-proof law (§6E2.4) is enforced by a DB
 * CHECK; this rejects earlier so the caller gets a clear reason, not a 500.
 */
export async function closeMaintenanceTask(input: {
  taskId: string; proofPhotoFile: string; completedBy: string;
}): Promise<void> {
  if (!input.proofPhotoFile) throw new Error('photo_proof_required');
  const db = getDb();
  const res = await db.from('maintenance_task').update({
    status: 'done',
    proof_photo_file: input.proofPhotoFile,
    completed_by: input.completedBy,
    completed_at: new Date().toISOString(),
  }).eq('id', input.taskId);
  if (res.error) throw res.error;
}

// ---------------------------------------------------------------------------
// §4.8 money loop. Arbo never sets a price: an invoice's amount comes from the
// agreed figure on the job's estimate, and a job without one produces NO draft.
// ---------------------------------------------------------------------------

/** Completed jobs and whether each already carries an invoice. */
export async function billableJobs(): Promise<Array<{
  jobId: string; name?: string; completedAtIso: string | null;
  agreedAmount: number | null; hasInvoice: boolean;
}>> {
  const db = getDb();
  const horizon = new Date(Date.now() - 180 * 86400_000).toISOString();
  const jobs = await db.from('job')
    .select('id, completed_at, estimate_id, contact:contact_id(name)')
    .eq('status', 'completed')
    .gte('completed_at', horizon)
    .order('completed_at', { ascending: true });
  if (jobs.error) throw jobs.error;
  const rows = (jobs.data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const estimateIds = rows.map((j) => j.estimate_id as string | null).filter((x): x is string => Boolean(x));
  const [ests, invs] = await Promise.all([
    estimateIds.length
      ? db.from('estimate').select('id, agreed_amount').in('id', estimateIds)
      : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null }),
    db.from('invoice').select('job_id').in('job_id', rows.map((j) => j.id as string)),
  ]);
  if (ests.error) throw ests.error;
  if (invs.error) throw invs.error;
  const agreed = new Map<string, number | null>();
  for (const e of (ests.data ?? []) as Array<Record<string, unknown>>) {
    const v = e.agreed_amount;
    agreed.set(e.id as string, v == null ? null : Number(v));
  }
  const invoiced = new Set(((invs.data ?? []) as Array<Record<string, unknown>>).map((r) => r.job_id as string));

  return rows.map((j) => {
    const contact = j.contact as { name?: string | null } | null;
    const estId = j.estimate_id as string | null;
    return {
      jobId: j.id as string,
      name: contact?.name ?? undefined,
      completedAtIso: (j.completed_at as string | null) ?? null,
      agreedAmount: estId ? agreed.get(estId) ?? null : null,
      hasInvoice: invoiced.has(j.id as string),
    };
  });
}

/** Every unsettled invoice, with the contact facts the legal gates need. */
export async function openInvoiceRows(): Promise<Array<{
  id: string; jobId: string; name?: string; amount: number; lateFeePct: number;
  netDays: number; status: 'draft' | 'sent' | 'paid' | 'overdue' | 'void';
  sentAtIso: string | null; paidAtIso: string | null;
  consentOnFile?: boolean; suppressed?: boolean;
}>> {
  const db = getDb();
  const res = await db.from('invoice')
    .select('id, job_id, amount, late_fee_pct, net_days, status, sent_at, paid_at, job:job_id(contact:contact_id(name, consent_at, opted_out_at))')
    .in('status', ['draft', 'sent', 'overdue']);
  if (res.error) throw res.error;
  return ((res.data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const job = r.job as { contact?: { name?: string | null; consent_at?: string | null; opted_out_at?: string | null } | null } | null;
    const c = job?.contact ?? null;
    return {
      id: r.id as string,
      jobId: r.job_id as string,
      name: c?.name ?? undefined,
      amount: Number(r.amount),
      lateFeePct: Number(r.late_fee_pct),
      netDays: Number(r.net_days ?? 14),
      status: r.status as 'draft' | 'sent' | 'paid' | 'overdue' | 'void',
      sentAtIso: (r.sent_at as string | null) ?? null,
      paidAtIso: (r.paid_at as string | null) ?? null,
      consentOnFile: c ? Boolean(c.consent_at) : undefined,
      suppressed: c ? Boolean(c.opted_out_at) : undefined,
    };
  });
}

/**
 * Create the invoice for a job. The amount is passed in from the AGREED figure
 * the caller read off the estimate — this function never derives one — and the
 * late fee is clamped to the VA cap before the DB CHECK ever sees it.
 */
export async function createInvoice(input: {
  jobId: string; amount: number; lateFeePct: number; netDays: number;
}): Promise<{ id: string } | 'already_invoiced'> {
  const db = getDb();
  const res = await db.from('invoice').insert({
    job_id: input.jobId,
    amount: input.amount,
    late_fee_pct: Math.min(input.lateFeePct, 5),
    net_days: input.netDays,
    status: 'draft',
  }).select('id').single();
  if (res.error) {
    // 23505 = the one-live-invoice-per-job index caught a double submit. That
    // is the constraint doing its job, not a server fault: say so plainly.
    if (res.error.code === '23505') return 'already_invoiced';
    throw res.error;
  }
  return { id: res.data.id as string };
}

/** Advance an invoice's status. Timestamps are stamped by the transition. */
export async function setInvoiceStatus(
  invoiceId: string,
  status: 'sent' | 'paid' | 'void',
): Promise<boolean> {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = await db.from('invoice')
    .select('id, sent_at, paid_at')
    .eq('id', invoiceId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) return false; // no such invoice — the caller must not report success

  const patch: Record<string, unknown> = { status, updated_at: now };
  // The FIRST send starts the payment clock. Re-marking an invoice sent must
  // never reset it — that would erase weeks of aging and make an overdue
  // invoice look current.
  if (status === 'sent' && !existing.data.sent_at) patch.sent_at = now;
  if (status === 'paid' && !existing.data.paid_at) patch.paid_at = now;
  const res = await db.from('invoice').update(patch).eq('id', invoiceId);
  if (res.error) throw res.error;
  return true;
}

// ---------------------------------------------------------------------------
// §6V safety spine. Near-miss filing is blameless by construction; cert expiry
// answers BEFORE the day is assigned, and says UNKNOWN when it cannot answer.
// ---------------------------------------------------------------------------

/** File a near-miss. `blameless` is not a parameter — it is always true. */
export async function createNearMiss(input: {
  reportedBy: string; jobId: string | null; description: string;
  occurredOn: string; hazardCategory: string;
}): Promise<{ id: string }> {
  const db = getDb();
  const res = await db.from('near_miss').insert({
    reported_by: input.reportedBy,
    job_id: input.jobId,
    occurred_on: input.occurredOn,
    description: input.description,
    hazard_category: input.hazardCategory,
    blameless: true,
  }).select('id').single();
  if (res.error) throw res.error;
  return { id: res.data.id as string };
}

/** Active crew with the identity facts the cert engine needs. */
export async function listActiveCrew(): Promise<Array<{ id: string; name: string; role: string; active: boolean }>> {
  const db = getDb();
  const res = await db.from('crew_member').select('id, name, role, active').eq('active', true).order('name');
  if (res.error) throw res.error;
  return (res.data ?? []).map((c) => ({
    id: c.id as string, name: c.name as string, role: c.role as string, active: c.active as boolean,
  }));
}

/**
 * Put a person on the roster. Until this existed there was no way to create a
 * crew member at all, which meant no crew codes, an empty safety board, and a
 * crew door nobody could sign into.
 */
export async function createCrewMember(input: {
  name: string; role: string; competencyLevel: number; phone: string | null;
}): Promise<string> {
  const db = getDb();
  const res = await db.from('crew_member')
    .insert({
      name: input.name,
      role: input.role,
      competency_level: input.competencyLevel,
      phone: input.phone,
      active: true,
    })
    .select('id')
    .single();
  if (res.error) throw res.error;
  return (res.data as { id: string }).id;
}

/**
 * Take somebody off the roster. Deactivate, never delete: the certification
 * rows cascade on delete, and a training/safety record that vanishes when
 * somebody leaves is the record you most need afterwards.
 */
export async function deactivateCrewMember(id: string): Promise<boolean> {
  const db = getDb();
  const res = await db.from('crew_member')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('active', true)
    .select('id');
  if (res.error) throw res.error;
  return (res.data ?? []).length > 0;
}

/** The whole roster, active and not — the safety board needs both. */
export async function fullRoster(): Promise<Array<{
  id: string; name: string; role: string; competencyLevel: number; active: boolean;
}>> {
  const db = getDb();
  const res = await db.from('crew_member')
    .select('id, name, role, competency_level, active')
    .order('name', { ascending: true });
  if (res.error) throw res.error;
  return (res.data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    role: r.role as string,
    competencyLevel: Number(r.competency_level),
    active: r.active as boolean,
  }));
}

/**
 * Record or renew a certification. A renewal REPLACES the old row for that
 * person and type rather than stacking a second one — two rows for the same
 * card means the expiry check has to pick, and picking wrong on a safety
 * surface is the failure this whole module exists to prevent.
 */
export async function recordCertification(input: {
  crewMemberId: string; type: string; issuedOn: string | null; expiresOn: string | null;
}): Promise<string> {
  const db = getDb();
  const del = await db.from('certification')
    .delete()
    .eq('crew_member_id', input.crewMemberId)
    .eq('type', input.type);
  if (del.error) throw del.error;
  const res = await db.from('certification')
    .insert({
      crew_member_id: input.crewMemberId,
      type: input.type,
      issued_at: input.issuedOn,
      expires_at: input.expiresOn,
    })
    .select('id')
    .single();
  if (res.error) throw res.error;
  return (res.data as { id: string }).id;
}

/** Every certification row. Expiry may be null — that is UNKNOWN, not valid. */
export async function listCertifications(): Promise<Array<{
  id: string; crewMemberId: string; type: string; expiresOn: string | null;
}>> {
  const db = getDb();
  const res = await db.from('certification').select('id, crew_member_id, type, expires_at');
  if (res.error) throw res.error;
  return (res.data ?? []).map((c) => ({
    id: c.id as string,
    crewMemberId: c.crew_member_id as string,
    type: c.type as string,
    expiresOn: (c.expires_at as string | null) ?? null,
  }));
}

/** Recent near-misses for the admin safety surface. No reporter names leave here. */
export async function recentNearMisses(sinceDate: string): Promise<Array<{
  id: string; occurredOn: string; hazardCategory: string | null;
  description: string; hasTrainingItem: boolean;
}>> {
  const db = getDb();
  const res = await db.from('near_miss')
    .select('id, occurred_on, hazard_category, description, generated_training_item_id')
    .gte('occurred_on', sinceDate)
    .order('occurred_on', { ascending: false });
  if (res.error) throw res.error;
  return (res.data ?? []).map((r) => ({
    id: r.id as string,
    occurredOn: r.occurred_on as string,
    hazardCategory: (r.hazard_category as string | null) ?? null,
    description: r.description as string,
    hasTrainingItem: Boolean(r.generated_training_item_id),
  }));
}

// ---------------------------------------------------------------------------
// §6M training loop. Every item Arbo generates is a DRAFT: the DB CHECK
// (training_item_vetted_before_publish) refuses to publish without a named
// human vetter, and nothing here ever supplies one.
// ---------------------------------------------------------------------------

/** Create the lesson draft generated from a near miss, and link it back. */
export async function createLessonDraftFromNearMiss(input: {
  nearMissId: string; topic: string; body: unknown; difficulty: number; vetterNotes: string[];
}): Promise<{ id: string }> {
  const db = getDb();
  const item = await db.from('training_item').insert({
    type: 'lesson',
    topic: input.topic,
    body: { ...(input.body as Record<string, unknown>), vetterNotes: input.vetterNotes },
    difficulty: input.difficulty,
    source: 'event_generated',
    origin_near_miss_id: input.nearMissId,
    // A lesson born from one crew's incident must never be used to score them.
    exclude_from_scoring: true,
    published: false,
  }).select('id').single();
  if (item.error) throw item.error;
  const id = item.data.id as string;
  // Close the loop the safety board counts: the near miss now HAS a lesson.
  const link = await db.from('near_miss')
    .update({ generated_training_item_id: id })
    .eq('id', input.nearMissId);
  if (link.error) throw link.error;
  return { id };
}

/** Published, vetted items — the only pool a crew member may be asked from. */
export async function publishedTrainingItems(): Promise<Array<{
  id: string; topic: string; difficulty: number; published: boolean; excludeFromScoring: boolean;
}>> {
  const db = getDb();
  const res = await db.from('training_item')
    .select('id, topic, difficulty, published, exclude_from_scoring')
    .eq('published', true);
  if (res.error) throw res.error;
  return (res.data ?? []).map((r) => ({
    id: r.id as string,
    topic: r.topic as string,
    difficulty: Number(r.difficulty),
    published: r.published as boolean,
    excludeFromScoring: r.exclude_from_scoring as boolean,
  }));
}

/** A crew member's rolling weak/strong topic profile (§6M.5). */
export async function trainingProfile(crewMemberId: string): Promise<{ scores?: Record<string, number> }> {
  const db = getDb();
  const res = await db.from('crew_member')
    .select('training_profile')
    .eq('id', crewMemberId)
    .maybeSingle();
  if (res.error) throw res.error;
  const p = res.data?.training_profile as { scores?: Record<string, number> } | null;
  return p ?? {};
}

/**
 * Record a completed gate: the training event AND its payable time entry.
 * The time entry is written FIRST so a failure cannot leave a completion on
 * record with the pay missing (§4.6 — the pay is the point).
 */
export async function recordGateCompletion(input: {
  crewMemberId: string; context: string; itemIds: string[];
  startedAtIso: string; completedAtIso: string; payableMinutes: number;
  score: number | null; topicScores?: Record<string, number>;
}): Promise<{ trainingEventId: string; timeEntryId: string }> {
  const db = getDb();
  const time = await db.from('time_entry').insert({
    crew_member_id: input.crewMemberId,
    kind: 'training',
    started_at: input.startedAtIso,
    ended_at: input.completedAtIso,
    minutes: input.payableMinutes,
    payable: true,
    source: input.context,
  }).select('id').single();
  if (time.error) throw time.error;

  const ev = await db.from('training_event').insert({
    crew_member_id: input.crewMemberId,
    item_ids: input.itemIds,
    context: input.context,
    score: input.score,
    started_at: input.startedAtIso,
    completed_at: input.completedAtIso,
    time_entry_id: time.data.id as string,
  }).select('id').single();
  if (ev.error) throw ev.error;

  return { trainingEventId: ev.data.id as string, timeEntryId: time.data.id as string };
}

/** Persist the updated weak/strong profile after a scored gate. */
export async function saveTrainingProfile(
  crewMemberId: string,
  profile: { scores?: Record<string, number> },
): Promise<void> {
  const db = getDb();
  const res = await db.from('crew_member')
    .update({ training_profile: profile, updated_at: new Date().toISOString() })
    .eq('id', crewMemberId);
  if (res.error) throw res.error;
}

/**
 * Full item rows for a set of ids — INCLUDING the answer key. Server-side only:
 * the crew API strips the key before anything reaches a phone, and grading
 * happens here rather than being taken on trust from the client.
 */
export async function trainingItemsByIds(ids: string[]): Promise<Array<{
  id: string; topic: string; type: string; body: Record<string, unknown>;
}>> {
  if (ids.length === 0) return [];
  const db = getDb();
  const res = await db.from('training_item')
    .select('id, topic, type, body')
    .in('id', ids)
    .eq('published', true);
  if (res.error) throw res.error;
  return (res.data ?? []).map((r) => ({
    id: r.id as string,
    topic: r.topic as string,
    type: r.type as string,
    body: (r.body ?? {}) as Record<string, unknown>,
  }));
}

/** Lesson drafts waiting on a human vetter (§4.7). Never auto-published. */
export async function pendingLessonDrafts(): Promise<Array<{
  id: string; topic: string; body: Record<string, unknown>; createdAt: string; originNearMissId: string | null;
}>> {
  const db = getDb();
  const res = await db.from('training_item')
    .select('id, topic, body, created_at, origin_near_miss_id')
    .eq('published', false)
    .eq('source', 'event_generated')
    .order('created_at', { ascending: true });
  if (res.error) throw res.error;
  return (res.data ?? []).map((r) => ({
    id: r.id as string,
    topic: r.topic as string,
    body: (r.body ?? {}) as Record<string, unknown>,
    createdAt: r.created_at as string,
    originNearMissId: (r.origin_near_miss_id as string | null) ?? null,
  }));
}

/**
 * Publish a vetted lesson. `vettedBy` is REQUIRED and is the whole point of
 * §4.7 — the DB CHECK refuses a publish without it, and this refuses earlier
 * so the caller gets a reason instead of a 500. Nothing automated calls this.
 */
export async function publishLesson(itemId: string, vettedBy: string): Promise<boolean> {
  if (!vettedBy.trim()) throw new Error('vetter_required');
  const db = getDb();
  const res = await db.from('training_item')
    .update({
      published: true,
      vetted_by: vettedBy.trim(),
      vetted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('published', false)
    .select('id');
  if (res.error) throw res.error;
  return (res.data ?? []).length > 0;
}

/** Active crew with their rolling weak/strong topic profiles (§6M.5). */
export async function crewWithProfiles(): Promise<Array<{
  id: string; name: string; role: string; scores: Record<string, number>;
}>> {
  const db = getDb();
  const res = await db.from('crew_member')
    .select('id, name, role, training_profile')
    .eq('active', true)
    .order('name', { ascending: true });
  if (res.error) throw res.error;
  return (res.data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    role: r.role as string,
    scores: ((r.training_profile as { scores?: Record<string, number> } | null)?.scores) ?? {},
  }));
}

/** Completed training gates since an instant — drives "who has not done it". */
export async function gateCompletionsSince(sinceIso: string): Promise<Array<{
  crewMemberId: string; context: string; completedAtIso: string | null;
}>> {
  const db = getDb();
  const res = await db.from('training_event')
    .select('crew_member_id, context, completed_at')
    .gte('started_at', sinceIso);
  if (res.error) throw res.error;
  return (res.data ?? []).map((r) => ({
    crewMemberId: r.crew_member_id as string,
    context: r.context as string,
    completedAtIso: (r.completed_at as string | null) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// §6 site conditions + change orders. Arbo records what a human agreed to; it
// never prices a change and never approves one.
// ---------------------------------------------------------------------------

export async function recordSiteCondition(input: {
  jobId: string; arrivalIso: string; photoFiles: string[];
  preexistingNotes?: string; groundCondition?: string; craneDecision?: string; documentedBy?: string;
}): Promise<{ id: string }> {
  const db = getDb();
  const res = await db.from('site_condition_record').insert({
    job_id: input.jobId,
    arrival_timestamp: input.arrivalIso,
    photo_files: input.photoFiles,
    preexisting_notes: input.preexistingNotes ?? null,
    ground_condition: input.groundCondition ?? null,
    crane_decision: input.craneDecision ?? null,
    documented_by: input.documentedBy ?? null,
  }).select('id').single();
  if (res.error) throw res.error;
  return { id: res.data.id as string };
}

/** The arrival record for a job, or null when nobody documented one. */
export async function siteConditionForJob(jobId: string): Promise<{
  jobId: string; arrivalIso: string; photoFiles: string[];
  preexistingNotes?: string; groundCondition?: string; craneDecision?: string; documentedBy?: string;
} | null> {
  const db = getDb();
  const res = await db.from('site_condition_record')
    .select('job_id, arrival_timestamp, photo_files, preexisting_notes, ground_condition, crane_decision, documented_by')
    .eq('job_id', jobId)
    .order('arrival_timestamp', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (res.error) throw res.error;
  if (!res.data) return null;
  return {
    jobId: res.data.job_id as string,
    arrivalIso: res.data.arrival_timestamp as string,
    photoFiles: (res.data.photo_files as string[] | null) ?? [],
    preexistingNotes: (res.data.preexisting_notes as string | null) ?? undefined,
    groundCondition: (res.data.ground_condition as string | null) ?? undefined,
    craneDecision: (res.data.crane_decision as string | null) ?? undefined,
    documentedBy: (res.data.documented_by as string | null) ?? undefined,
  };
}

export async function createChangeOrder(input: {
  jobId: string; description: string; amount: number | null; agreedBy: string; agreedAtIso: string;
}): Promise<{ id: string }> {
  const db = getDb();
  const res = await db.from('change_order').insert({
    job_id: input.jobId,
    description: input.description,
    amount: input.amount,
    agreed_by: input.agreedBy,
    agreed_at: input.agreedAtIso,
    // Approval and billing are separate human acts — never set here.
    approved: false,
    invoiced: false,
  }).select('id').single();
  if (res.error) throw res.error;
  return { id: res.data.id as string };
}

/** Every change order not yet invoiced, across open jobs. */
export async function openChangeOrders(): Promise<Array<{
  id: string; jobId: string; description: string; amount: number | null;
  approved: boolean; invoiced: boolean; agreedAtIso: string;
}>> {
  const db = getDb();
  const res = await db.from('change_order')
    .select('id, job_id, description, amount, approved, invoiced, agreed_at')
    .eq('invoiced', false)
    .order('agreed_at', { ascending: true });
  if (res.error) throw res.error;
  return (res.data ?? []).map((r) => ({
    id: r.id as string,
    jobId: r.job_id as string,
    description: r.description as string,
    amount: r.amount === null ? null : Number(r.amount),
    approved: r.approved as boolean,
    invoiced: r.invoiced as boolean,
    agreedAtIso: r.agreed_at as string,
  }));
}

/** Mike approves a change order. Returns false when there is no such row. */
export async function approveChangeOrder(id: string): Promise<boolean> {
  const db = getDb();
  const res = await db.from('change_order')
    .update({ approved: true })
    .eq('id', id)
    .eq('invoiced', false)
    .select('id');
  if (res.error) throw res.error;
  return (res.data ?? []).length > 0;
}

/** Approved, priced, uninvoiced change orders for ONE job. */
export async function billableChangeOrdersForJob(jobId: string): Promise<Array<{ id: string; amount: number }>> {
  const db = getDb();
  const res = await db.from('change_order')
    .select('id, amount')
    .eq('job_id', jobId)
    .eq('approved', true)
    .eq('invoiced', false);
  if (res.error) throw res.error;
  return (res.data ?? [])
    .filter((r) => r.amount !== null && Number(r.amount) > 0)
    .map((r) => ({ id: r.id as string, amount: Number(r.amount) }));
}

/** Mark change orders billed. Called only after the invoice row exists. */
export async function markChangeOrdersInvoiced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  const res = await db.from('change_order').update({ invoiced: true }).in('id', ids);
  if (res.error) throw res.error;
}

// ---------------------------------------------------------------------------
// §6D/§6N.3 area + campaign performance. Facts only — every judgement about
// them lives in src/ops/areaPerformance.ts where it can be tested.
// ---------------------------------------------------------------------------

/**
 * Completed, paid work with the factors needed to NORMALIZE a rate. A job
 * missing hours is returned with hours 0 so the caller can exclude and COUNT
 * it, rather than the query silently dropping it from the benchmark.
 */
export async function areaJobFacts(sinceIso: string): Promise<Array<{
  jobId: string; areaKey: string; hours: number; crewSize: number;
  revenue: number; jobType: 'removal' | 'pruning' | 'other';
}>> {
  const db = getDb();
  const res = await db.from('job')
    .select('id, truck_to_truck_hours, crew_size, job_type, completed_at, property:property_id(city, zip), invoice:invoice(amount, status)')
    .eq('status', 'completed')
    .gte('completed_at', sinceIso);
  if (res.error) throw res.error;
  return ((res.data ?? []) as Array<Record<string, unknown>>).map((j) => {
    const prop = j.property as { city?: string | null; zip?: string | null } | null;
    const invoices = (j.invoice as Array<{ amount: unknown; status: string }> | null) ?? [];
    // Paid money only. A sent-but-unpaid invoice is not revenue yet.
    const paid = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.amount ?? 0), 0);
    const type = String(j.job_type ?? 'other');
    return {
      jobId: j.id as string,
      // ZIP is the area key: it is the finest grain Arbo reliably has.
      areaKey: prop?.zip ? `${prop.city ?? '?'} ${prop.zip}` : `${prop?.city ?? 'unknown'} (no zip)`,
      hours: Number(j.truck_to_truck_hours ?? 0),
      crewSize: Number(j.crew_size ?? 1),
      revenue: paid,
      jobType: (type === 'removal' || type === 'pruning' ? type : 'other') as 'removal' | 'pruning' | 'other',
    };
  });
}

/** Campaigns with their attribution wiring made explicit. */
export async function campaignFacts(): Promise<Array<{
  id: string; type: 'flyer' | 'ads' | 'seasonal' | 'neighbor_around_job';
  cost: number | null; bookedJobs: number; attributionWired: boolean;
}>> {
  const db = getDb();
  const res = await db.from('campaign')
    .select('id, type, cost, tracking_number, attributed_lead_ids');
  if (res.error) throw res.error;
  const rows = (res.data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  // Which attributed leads actually became jobs.
  const allLeadIds = [...new Set(rows.flatMap((r) => (r.attributed_lead_ids as string[] | null) ?? []))];
  let bookedByLead = new Set<string>();
  if (allLeadIds.length) {
    const jobs = await db.from('estimate')
      .select('lead_id, outcome')
      .in('lead_id', allLeadIds)
      .eq('outcome', 'won');
    if (!jobs.error) {
      bookedByLead = new Set(((jobs.data ?? []) as Array<{ lead_id: string | null }>)
        .map((e) => e.lead_id).filter((x): x is string => Boolean(x)));
    }
  }

  return rows.map((r) => {
    const leads = (r.attributed_lead_ids as string[] | null) ?? [];
    return {
      id: r.id as string,
      type: r.type as 'flyer' | 'ads' | 'seasonal' | 'neighbor_around_job',
      cost: r.cost === null ? null : Number(r.cost),
      bookedJobs: leads.filter((l) => bookedByLead.has(l)).length,
      // No tracking number AND no attributed leads = nothing was ever wired up.
      attributionWired: Boolean(r.tracking_number) || leads.length > 0,
    };
  });
}

/** §6U reference library. Published state is returned so the caller counts held drafts. */
export async function referenceEntries(): Promise<Array<{
  id: string; techniqueName: string; skillLevel: number; howTo: string;
  pros: string[]; cons: string[]; wontWorkWhen: string | null;
  sourceLink: string | null; standardRefs: string[]; published: boolean;
}>> {
  const db = getDb();
  const res = await db.from('reference_entry')
    .select('id, technique_name, skill_level, how_to, pros, cons, wont_work_when, source_link, standard_refs, published');
  if (res.error) throw res.error;
  return (res.data ?? []).map((r) => ({
    id: r.id as string,
    techniqueName: r.technique_name as string,
    skillLevel: Number(r.skill_level),
    howTo: r.how_to as string,
    pros: (r.pros as string[] | null) ?? [],
    cons: (r.cons as string[] | null) ?? [],
    wontWorkWhen: (r.wont_work_when as string | null) ?? null,
    sourceLink: (r.source_link as string | null) ?? null,
    standardRefs: (r.standard_refs as string[] | null) ?? [],
    published: r.published as boolean,
  }));
}

/**
 * Reference entries waiting on a human vetter (§4.7). The read path holds
 * these back and only COUNTS them; this is the screen that clears them.
 */
export async function draftReferenceEntries(): Promise<Array<{
  id: string; techniqueName: string; skillLevel: number; howTo: string;
  pros: string[]; cons: string[]; wontWorkWhen: string | null;
  sourceLink: string | null; standardRefs: string[]; createdAt: string;
}>> {
  const db = getDb();
  const res = await db.from('reference_entry')
    .select('id, technique_name, skill_level, how_to, pros, cons, wont_work_when, source_link, standard_refs, created_at')
    .eq('published', false)
    .order('created_at', { ascending: true });
  if (res.error) throw res.error;
  return (res.data ?? []).map((r) => ({
    id: r.id as string,
    techniqueName: r.technique_name as string,
    skillLevel: Number(r.skill_level),
    howTo: r.how_to as string,
    pros: (r.pros as string[] | null) ?? [],
    cons: (r.cons as string[] | null) ?? [],
    wontWorkWhen: (r.wont_work_when as string | null) ?? null,
    sourceLink: (r.source_link as string | null) ?? null,
    standardRefs: (r.standard_refs as string[] | null) ?? [],
    createdAt: r.created_at as string,
  }));
}

/**
 * Write a reference entry. ALWAYS as a draft — `published` is never accepted
 * from a caller, because the only way into the crew's hands is through a named
 * human (§4.7). Returns the new id.
 */
export async function createReferenceEntry(input: {
  techniqueName: string; skillLevel: number; howTo: string;
  pros: string[]; cons: string[]; wontWorkWhen: string | null;
  sourceLink: string | null; standardRefs: string[];
}): Promise<string> {
  const db = getDb();
  const res = await db.from('reference_entry')
    .insert({
      technique_name: input.techniqueName,
      skill_level: input.skillLevel,
      how_to: input.howTo,
      pros: input.pros,
      cons: input.cons,
      wont_work_when: input.wontWorkWhen,
      source_link: input.sourceLink,
      standard_refs: input.standardRefs,
      published: false,
    })
    .select('id')
    .single();
  if (res.error) throw res.error;
  return (res.data as { id: string }).id;
}

/**
 * Publish a vetted reference entry. Same shape as publishLesson and for the
 * same reason: the DB CHECK is the floor, not the gate the user meets.
 */
export async function publishReferenceEntry(id: string, vettedBy: string): Promise<boolean> {
  if (!vettedBy.trim()) throw new Error('vetter_required');
  const db = getDb();
  const res = await db.from('reference_entry')
    .update({
      published: true,
      vetted_by: vettedBy.trim(),
      vetted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('published', false)
    .select('id');
  if (res.error) throw res.error;
  return (res.data ?? []).length > 0;
}

/**
 * Put a unit in the registry. Same hole the roster had: everything in §6E
 * reads equipment_unit and nothing could write one, so the fleet board was
 * permanently empty and a breakdown had no unit to report against.
 *
 * The routing dimensions are NULLABLE on purpose. §6M2.4 treats a null height
 * or weight as UNKNOWN and routes conservatively; forcing a number here would
 * mean somebody types a guess, and a guessed clearance is worse than no
 * clearance because the router would trust it.
 */
export async function createEquipmentUnit(input: {
  name: string; kind: string; vinOrSerial: string;
  heightInches: number | null; weightLbsLoaded: number | null;
}): Promise<string> {
  const db = getDb();
  const res = await db.from('equipment_unit')
    .insert({
      name: input.name,
      kind: input.kind,
      vin_or_serial: input.vinOrSerial,
      height_inches: input.heightInches,
      weight_lbs_loaded: input.weightLbsLoaded,
      status: 'up',
    })
    .select('id')
    .single();
  if (res.error) throw res.error;
  return (res.data as { id: string }).id;
}

/** Retire a unit. listUnits already excludes retired, so it leaves the board. */
export async function retireEquipmentUnit(id: string): Promise<boolean> {
  const db = getDb();
  const res = await db.from('equipment_unit')
    .update({ status: 'retired', updated_at: new Date().toISOString() })
    .eq('id', id)
    .neq('status', 'retired')
    .select('id');
  if (res.error) throw res.error;
  return (res.data ?? []).length > 0;
}

/**
 * Record a part that fits a unit. This is what makes a breakdown plan useful:
 * buildActionPlan reads these, and with none on file it says so rather than
 * implying no part is needed.
 */
export async function addEquipmentPart(input: {
  unitId: string; partNumber: string; supplier: string | null; sharedFitment: string | null;
}): Promise<string> {
  const db = getDb();
  const res = await db.from('equipment_part')
    .insert({
      unit_id: input.unitId,
      part_number: input.partNumber,
      supplier: input.supplier,
      shared_fitment: input.sharedFitment,
    })
    .select('id')
    .single();
  if (res.error) throw res.error;
  return (res.data as { id: string }).id;
}

/**
 * Register a campaign. campaignFacts reads this table for the Numbers screen;
 * with no writer the campaign section could only ever render UNKNOWN.
 *
 * `cost` is a figure a human types — the amount actually spent. Arbo still
 * originates nothing (§3); it divides what Mike spent by what came back.
 */
export async function createCampaign(input: {
  type: string; cost: number | null; trackingNumber: string | null; sentAtIso: string | null;
}): Promise<string> {
  const db = getDb();
  const res = await db.from('campaign')
    .insert({
      type: input.type,
      cost: input.cost,
      tracking_number: input.trackingNumber,
      sent_at: input.sentAtIso,
    })
    .select('id')
    .single();
  if (res.error) throw res.error;
  return (res.data as { id: string }).id;
}

/** A crew member's competency level, for the above-your-level flag. */
export async function crewSkillLevel(crewMemberId: string): Promise<number | null> {
  const db = getDb();
  const res = await db.from('crew_member')
    .select('competency_level')
    .eq('id', crewMemberId)
    .maybeSingle();
  if (res.error) throw res.error;
  return res.data ? Number(res.data.competency_level) : null;
}

/**
 * Every property with a permit track, plus the ones that have NO track at all.
 *
 * The second half is the point. A LEFT JOIN from property, not a SELECT from
 * permit: a property nobody ever screened has no permit row, and if this
 * queried `permit` it would return exactly the properties that are already
 * handled and silently omit the ones that are not. That is the §1B failure at
 * the query layer — the board would look calm because the unscreened
 * properties fell out of the FROM clause.
 *
 * Only properties with a service city are returned; the DB CHECK already keeps
 * out-of-area properties out, so this is belt and braces on the city cast.
 */
export async function listPermitTracks(): Promise<PermitTrackRow[]> {
  const db = getDb();
  const [props, permits, jobs] = await Promise.all([
    db.from('property').select('id, address, city').order('address', { ascending: true }),
    db.from('permit')
      .select('id, property_id, job_id, city, screen_status, in_rpa, overlay_source, form_ref, status, ruleset_last_verified, created_at')
      .order('created_at', { ascending: false }),
    db.from('job').select('property_id, scheduled_for').eq('status', 'booked'),
  ]);
  if (props.error) throw props.error;
  if (permits.error) throw permits.error;
  if (jobs.error) throw jobs.error;

  // Newest permit per property. The ordering above is DESC, so the first one
  // seen for a property is the current track.
  const latest = new Map<string, Record<string, unknown>>();
  for (const p of permits.data ?? []) {
    const pid = p.property_id as string;
    if (!latest.has(pid)) latest.set(pid, p as Record<string, unknown>);
  }

  // Soonest booked job per property — what makes a blocked row urgent.
  const soonest = new Map<string, string>();
  for (const j of jobs.data ?? []) {
    const pid = j.property_id as string | null;
    const at = j.scheduled_for as string | null;
    if (!pid || !at) continue;
    const cur = soonest.get(pid);
    if (!cur || at < cur) soonest.set(pid, at);
  }

  return (props.data ?? []).map((prop) => {
    const pid = prop.id as string;
    const pm = latest.get(pid);
    return {
      permitId: (pm?.id as string) ?? null,
      propertyId: pid,
      addressLabel: (prop.address as string) ?? '(no address on file)',
      city: prop.city as PermitTrackRow['city'],
      jobId: (pm?.job_id as string) ?? null,
      screen: pm
        ? {
          status: pm.screen_status as ScreenStatus,
          inRpa: pm.in_rpa === true,
          overlays: (pm.overlay_source as OverlayHit[]) ?? [],
          ranAt: String(pm.created_at ?? ''),
          rulesetLastVerified: (pm.ruleset_last_verified as string) ?? null,
        }
        : null,
      status: (pm?.status as PermitTrackRow['status']) ?? 'needed',
      formRef: (pm?.form_ref as string) ?? null,
      scheduledFor: soonest.get(pid) ?? null,
    };
  });
}
