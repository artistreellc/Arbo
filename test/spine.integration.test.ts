/*
  ═══════════════════════════════════════════════════════════════════════
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
*/
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
