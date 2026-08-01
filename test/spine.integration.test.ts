import { describe, it, expect } from 'vitest';
import { hasDb, getDb } from '../src/db/client.js';
import {
  upsertProperty,
  createContact,
  linkContactToProperty,
  createLead,
  createEstimate,
  convertEstimateToJob,
  createPhoto,
  OutOfServiceAreaError,
} from '../src/db/repositories.js';

// Live integration test for the data spine (Phase 1 acceptance). Runs only when
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (i.e. `.env` filled in) so CI
// without secrets stays green. Mike/CI-with-secrets runs the real end-to-end.
const d = hasDb() ? describe : describe.skip;

d('data spine end-to-end (live Supabase)', () => {
  const createdPropertyIds: string[] = [];

  it('creates Property → Contact → Lead → Estimate → Job (via signed contract) → Photo', async () => {
    const property = await upsertProperty({
      address: '742 Evergreen Terrace',
      city: 'Virginia Beach',
      zip: '23451',
      hazardPowerLines: true,
    });
    createdPropertyIds.push(property.id);
    expect(property.id).toBeTruthy();
    expect(property.city).toBe('Virginia Beach');

    const contact = await createContact({
      name: 'Test Homeowner',
      phones: ['+17575550100'],
      isFirstTimer: true,
      consentSource: 'inbound_call',
    });
    await linkContactToProperty(contact.id, property.id);

    const lead = await createLead({
      propertyId: property.id,
      contactId: contact.id,
      source: 'call',
      qualification: { treeType: 'oak', size: 'large', nearPowerLines: true },
    });
    expect(lead.id).toBeTruthy();

    const estimate = await createEstimate({
      propertyId: property.id,
      contactId: contact.id,
      leadId: lead.id,
      zipCluster: '23451',
    });

    const { jobId, contractId } = await convertEstimateToJob({
      estimateId: estimate.id,
      propertyId: property.id,
      contactId: contact.id,
      contractDriveFileId: 'drive-file-abc',
    });
    expect(jobId).toBeTruthy();
    expect(contractId).toBeTruthy();

    const photo = await createPhoto({ propertyId: property.id, jobId, source: 'mike' });
    expect(photo.id).toBeTruthy();
  });

  it('dedupes the property twin across equivalent address spellings', async () => {
    const a = await upsertProperty({ address: '10 Birch Lane', city: 'Norfolk' });
    const b = await upsertProperty({ address: '10 birch ln.', city: 'Norfolk' });
    createdPropertyIds.push(a.id);
    expect(b.id).toBe(a.id); // same twin, not a second one
  });

  it('refuses to create a property outside the service area (Suffolk)', async () => {
    await expect(upsertProperty({ address: '9 Elm St', city: 'Suffolk' })).rejects.toBeInstanceOf(
      OutOfServiceAreaError,
    );
  });

  // Clean up test rows (cascades remove children).
  it('cleanup', async () => {
    const db = getDb();
    for (const id of createdPropertyIds) {
      await db.from('property').delete().eq('id', id);
    }
    expect(true).toBe(true);
  });
});
