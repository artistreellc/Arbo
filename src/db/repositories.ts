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
  jobs: Array<{ id: string; property_id: string | null; scheduled_for: string | null; status: string }>;
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
  const [estimates, jobs, leads] = await Promise.all([
    db.from('estimate')
      .select('id, property_id, scheduled_slot, visited_at, outcome, updated_at')
      .in('outcome', ['pending', 'won'])
      .gte('updated_at', wide),
    db.from('job')
      .select('id, property_id, scheduled_for, status')
      .in('status', ['booked', 'in_progress'])
      .gte('scheduled_for', jobHorizon),
    db.from('lead')
      .select('id, created_at, status, qualification')
      .eq('status', 'new')
      .gte('created_at', leadSince),
  ]);
  for (const r of [estimates, jobs, leads]) if (r.error) throw r.error;
  return {
    estimates: (estimates.data ?? []) as LoopSnapshotRows['estimates'],
    jobs: (jobs.data ?? []) as LoopSnapshotRows['jobs'],
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
  try {
    const p = await latestPermitsForProperties(propertyIds);
    permits = new Map([...p].map(([k, v]) => [k, { screen_status: v.screen_status }]));
  } catch {
    permits = new Map(); // no flag on file → no note; never a false "clear"
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
