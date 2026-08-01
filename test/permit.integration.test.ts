import { describe, it, expect } from 'vitest';
import { hasDb, getDb } from '../src/db/client.js';
import {
  upsertProperty,
  createPermit,
  getLatestPermitForProperty,
  latestPermitsForProperties,
  updatePermitStatus,
} from '../src/db/repositories.js';
import { screenProperty, type GisProvider, type OverlayHit } from '../src/permitting/screening.js';
import { screenToPermitRecord } from '../src/permitting/permitRecord.js';
import { createLiveLeadSink } from '../src/reception/leadSink.js';

// Live integration for the Permit track (Phase 4). Runs only with real Supabase
// creds; CI without secrets stays green (same pattern as spine.integration).
const d = hasDb() ? describe : describe.skip;

const CBPA: OverlayHit = { kind: 'CBPA_RPA', layer: 'RPA buffer', meaning: 'In the Bay-protected buffer.' };
const gisWith = (o: OverlayHit[]): GisProvider => ({ overlaysFor: async () => o });

d('permit track end-to-end (live Supabase)', () => {
  const cleanup: string[] = [];

  it('screens → persists a permit → advances the lifecycle', async () => {
    const property = await upsertProperty({ address: '8562 Circle Drive', city: 'Norfolk', zip: '23503' });
    cleanup.push(property.id);

    const screen = await screenProperty(
      { city: 'Norfolk', address: property.address, isRemoval: true, treeCount: 2 },
      gisWith([CBPA]),
    );
    const rec = screenToPermitRecord(screen, { propertyId: property.id });
    const permit = await createPermit(rec);
    expect(permit.id).toBeTruthy();

    const latest = await getLatestPermitForProperty(property.id);
    expect(latest?.screen_status).toBe('PERMIT_LIKELY');
    expect(latest?.in_rpa).toBe(true);
    expect(latest?.status).toBe('needed');

    await updatePermitStatus(permit.id, 'applied', { formRef: '2025-DSC-021160' });
    const applied = await getLatestPermitForProperty(property.id);
    expect(applied?.status).toBe('applied');
    expect(applied?.form_ref).toBe('2025-DSC-021160');
  });

  it('the DB rejects a bare "clear" screen status (CHECK mirrors the type)', async () => {
    const property = await upsertProperty({ address: '9 Cedar Ln', city: 'Chesapeake', zip: '23320' });
    cleanup.push(property.id);
    const bad = getDb().from('permit').insert({
      property_id: property.id,
      city: 'Chesapeake',
      screen_status: 'CLEAR', // not a valid status — must be rejected
      in_rpa: false,
    });
    const res = await bad;
    expect(res.error).toBeTruthy();
  });

  it('intake auto-screen: a captured call lead lands with a permit row on its property (§6B.1)', async () => {
    const sink = createLiveLeadSink({ gis: gisWith([CBPA]) });
    const result = await sink.capture({
      name: 'Intake Test Caller',
      phone: '+17575550142',
      address: '77 Bayside Rd',
      city: 'Virginia Beach',
      qualification: { jobType: 'removal', powerLineRedFlag: false },
      isEmergency: false,
    });
    expect(result.leadId).toBeTruthy();
    expect(result.permitScreen?.screened).toBe(true);
    expect(result.permitScreen?.status).toBe('PERMIT_LIKELY');

    const property = await upsertProperty({ address: '77 Bayside Rd', city: 'Virginia Beach' });
    cleanup.push(property.id);
    const latest = await getLatestPermitForProperty(property.id);
    expect(latest?.screen_status).toBe('PERMIT_LIKELY');
    expect(latest?.in_rpa).toBe(true);

    const batch = await latestPermitsForProperties([property.id]);
    expect(batch.get(property.id)?.id).toBe(latest?.id);
  });

  it('intake with no GIS wired: lead survives, screen honestly pending, no permit row', async () => {
    const sink = createLiveLeadSink(); // no gis — the pre-deploy reality
    const result = await sink.capture({
      name: 'Pending Screen Caller',
      phone: '+17575550143',
      address: '12 Creekview Ct',
      city: 'Portsmouth',
      qualification: { jobType: 'not sure' },
      isEmergency: false,
    });
    expect(result.leadId).toBeTruthy();
    expect(result.permitScreen?.screened).toBe(false);
    expect(result.permitScreen?.pendingReason).toMatch(/NOT run/i);

    const property = await upsertProperty({ address: '12 Creekview Ct', city: 'Portsmouth' });
    cleanup.push(property.id);
    expect(await getLatestPermitForProperty(property.id)).toBeNull();
  });

  it('cleanup', async () => {
    const db = getDb();
    for (const id of cleanup) await db.from('property').delete().eq('id', id);
  });
});
