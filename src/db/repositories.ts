// Repository layer (brief §7, Phase 1). Thin, typed functions over the data
// spine. Business invariants live here: service-area enforcement and
// address-based deduping of the property twin.

import { getDb } from './client.js';
import { parseAddress, type ServiceCity } from '../lib/address.js';
import type { PermitRecordInput, PermitLifecycle } from '../permitting/permitRecord.js';

/** Thrown when an address is outside the four served cities (§2). */
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
  city: ServiceCity;
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
  if (!parsed.inServiceArea || !parsed.city) throw new OutOfServiceAreaError(input.address);

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
      city: parsed.city,
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
