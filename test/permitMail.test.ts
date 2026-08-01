import { describe, it, expect } from 'vitest';
import { classifyPermitMail, extractCaseRefs, extractSubjectAddress } from '../src/permitting/permitMail.js';

// Fixtures mirror the REAL formats observed in the live inbox (2026-08-01)
// with synthetic homeowner names/addresses — customer PII stays out of the
// repo (§4.3); city-government contacts are public.

describe('case-ref extraction (real Accela formats)', () => {
  it('finds DSC, UTIL, and RPA reference formats, deduped', () => {
    const text =
      'PPR received … Accela Record: 2025-DSC-021566. See also 2025-DSC-021566, ' +
      'utility permit 2025-UTIL-10415 and internal ref J04-021654-RPA.';
    expect(extractCaseRefs(text)).toEqual(['2025-DSC-021566', '2025-UTIL-10415', 'J04-021654-RPA']);
  });
});

describe('subject address extraction', () => {
  it('parses the VB review-letter subject pattern', () => {
    expect(
      extractSubjectAddress('Tree Removal Request, Doe Residence, 1220 Sample Avenue, Accela Record: 2025-DSC-021566'),
    ).toBe('1220 Sample Avenue');
  });

  it('parses plain street-address subjects (Norfolk case style)', () => {
    expect(extractSubjectAddress('RE: 8562 Circle drive')).toBe('8562 Circle drive');
    expect(extractSubjectAddress('1211 South Fairwater Dr')).toBe('1211 South Fairwater Dr');
  });

  it('returns null when no address is present', () => {
    expect(extractSubjectAddress('PPR')).toBeNull();
  });
});

describe('classifyPermitMail — the real correspondence shapes', () => {
  it('VB PPR review letter → ppr_review, Virginia Beach, case ref + address', () => {
    const r = classifyPermitMail({
      from: 'sheederi@vbgov.com',
      to: ['owner@example.com', 'artistreeofvirginia@gmail.com'],
      subject: 'Tree Removal Request, Doe Residence, 1220 Sample Avenue, Accela Record: 2025-DSC-021566',
      body: 'The Virginia Beach Department of Planning and Community Development staff has reviewed the Preliminary Project Request (PPR) received…',
    });
    expect(r.isCityCorrespondence).toBe(true);
    expect(r.city).toBe('Virginia Beach');
    expect(r.kind).toBe('ppr_review');
    expect(r.caseRefs).toEqual(['2025-DSC-021566']);
    expect(r.address).toBe('1220 Sample Avenue');
    expect(r.cityContacts).toContain('sheederi@vbgov.com');
  });

  it('Norfolk CBPA violation thread → cbpa_case, Norfolk', () => {
    const r = classifyPermitMail({
      from: 'seamus.mccarthy@norfolk.gov',
      cc: ['Jack.Erwin@norfolk.gov'],
      subject: 'RE: 8562 Circle drive',
      body: 'As discussed, this is a CBPA tree violation. Please send me the contractor and owners information and we will set up a meeting onsite.',
    });
    expect(r.city).toBe('Norfolk');
    expect(r.kind).toBe('cbpa_case');
    expect(r.address).toBe('8562 Circle drive');
    expect(r.cityContacts).toEqual(['seamus.mccarthy@norfolk.gov', 'Jack.Erwin@norfolk.gov']);
  });

  it('duplicate-PPR VOID warning → duplicate_warning (the §6B.4 friction)', () => {
    const r = classifyPermitMail({
      from: 'PBurns@vbgov.com',
      subject: 'RE: 101 Sample St',
      body: 'Since there are two records for the same location … I am going to VOID Accela record 2025-DSC-022094.',
    });
    expect(r.kind).toBe('duplicate_warning');
    expect(r.caseRefs).toEqual(['2025-DSC-022094']);
  });

  it('intake request (forms/photos/map needed) → intake_request', () => {
    const r = classifyPermitMail({
      from: 'CSFisher@vbgov.com',
      subject: '3055 Sample Road',
      body: 'Please provide the PPR information and provide clear organized photos and a map of these trees to be removed.',
    });
    expect(r.kind).toBe('intake_request');
  });

  it('payment notices → payment; non-city mail → not city correspondence', () => {
    expect(
      classifyPermitMail({
        from: 'Please_Read@vbgov.com',
        subject: 'Payment Receipt',
        body: 'Thank you for entering a payment to the City of Virginia Beach.',
      }).kind,
    ).toBe('payment');

    const r = classifyPermitMail({
      from: 'homeowner@example.com',
      subject: 'my oak tree',
      body: 'can you come look at my tree',
    });
    expect(r.isCityCorrespondence).toBe(false);
    expect(r.kind).toBeNull();
  });
});
