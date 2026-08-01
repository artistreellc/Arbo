// Repository layer (brief §7, Phase 1). Thin, typed functions over the data
// spine. Business invariants live here: service-area enforcement and
// address-based deduping of the property twin.

import { getDb } from './client.js';
import { parseAddress, type ServiceCity } from '../lib/address.js';

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
 * marks the estimate won, and books the job. Returns both new ids.
 */
export async function convertEstimateToJob(params: {
  estimateId: string;
  propertyId: string;
  contactId?: string;
  contractDriveFileId?: string;
}): Promise<{ jobId: string; contractId: string }> {
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

  const upd = await db.from('estimate').update({ outcome: 'won' }).eq('id', params.estimateId);
  if (upd.error) throw upd.error;

  return { jobId: job.id, contractId: (contract.data as { id: string }).id };
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
  property: { address: string; city: string; zip: string | null } | null;
}

/** Newest leads for the inbox (default: everything not yet converted/lost). */
export async function listLeads(limit = 25): Promise<LeadListRow[]> {
  const db = getDb();
  const res = await db
    .from('lead')
    .select(
      'id, source, details, qualification, is_emergency, status, created_at, contact:contact_id(name, phones, is_first_timer), property:property_id(address, city, zip)',
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
