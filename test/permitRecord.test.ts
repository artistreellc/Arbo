import { describe, it, expect } from 'vitest';
import { screenProperty, type GisProvider, type OverlayHit } from '../src/permitting/screening.js';
import {
  screenToPermitRecord,
  requiresClearance,
  crewMayStart,
  type PermitLifecycle,
} from '../src/permitting/permitRecord.js';

const gisWith = (o: OverlayHit[]): GisProvider => ({ overlaysFor: async () => o });
const CBPA: OverlayHit = { kind: 'CBPA_RPA', layer: 'RPA buffer', meaning: 'In the Bay-protected buffer.' };

describe('screenToPermitRecord — persistable bridge', () => {
  it('maps a PERMIT_LIKELY CBPA removal, in_rpa true, lifecycle starts at "needed"', async () => {
    const screen = await screenProperty({ city: 'Virginia Beach', address: '1 Oak', isRemoval: true }, gisWith([CBPA]));
    const rec = screenToPermitRecord(screen, { propertyId: 'p1', jobId: 'j1' });
    expect(rec.screenStatus).toBe('PERMIT_LIKELY');
    expect(rec.inRpa).toBe(true);
    expect(rec.status).toBe('needed'); // never auto-resolves
    expect(rec.propertyId).toBe('p1');
    expect(rec.rulesetLastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rec.cityContact?.email).toContain('@');
  });

  it('a no-overlay screen still stores NO_OVERLAY_VERIFY at "needed", never resolved', async () => {
    const screen = await screenProperty({ city: 'Norfolk', address: '2 Pine', isRemoval: true }, gisWith([]));
    const rec = screenToPermitRecord(screen, { propertyId: 'p2' });
    expect(rec.screenStatus).toBe('NO_OVERLAY_VERIFY');
    expect(rec.inRpa).toBe(false);
    expect(rec.status).toBe('needed');
  });
});

describe('the crew clearance gate (§6B.3) — no protected work without clearance', () => {
  it('PERMIT_LIKELY blocks the crew until approved / verified-not-required', () => {
    const base = { screenStatus: 'PERMIT_LIKELY' as const, inRpa: true };
    expect(requiresClearance(base)).toBe(true);
    expect(crewMayStart({ ...base, status: 'needed' }).mayStart).toBe(false);
    expect(crewMayStart({ ...base, status: 'applied' }).mayStart).toBe(false);
    expect(crewMayStart({ ...base, status: 'approved' }).mayStart).toBe(true);
    expect(crewMayStart({ ...base, status: 'not_required_verified' }).mayStart).toBe(true);
  });

  it('REVIEW_NEEDED is also gated until a human resolves it', () => {
    const p = { screenStatus: 'REVIEW_NEEDED' as const, inRpa: false, status: 'needed' as PermitLifecycle };
    expect(requiresClearance(p)).toBe(true);
    expect(crewMayStart(p).mayStart).toBe(false);
  });

  it('anything in the RPA is gated even if the status somehow reads no-overlay', () => {
    const p = { screenStatus: 'NO_OVERLAY_VERIFY' as const, inRpa: true, status: 'needed' as PermitLifecycle };
    expect(requiresClearance(p)).toBe(true);
    expect(crewMayStart(p).mayStart).toBe(false);
  });

  it('a truly unflagged job is not blocked by the permit gate (advisory only)', () => {
    const p = { screenStatus: 'NO_OVERLAY_VERIFY' as const, inRpa: false, status: 'needed' as PermitLifecycle };
    expect(requiresClearance(p)).toBe(false);
    const d = crewMayStart(p);
    expect(d.mayStart).toBe(true);
    expect(d.reason).toMatch(/advisory/i);
  });

  it('a blocked decision explains why (surfaces on the job)', () => {
    const d = crewMayStart({ screenStatus: 'PERMIT_LIKELY', inRpa: true, status: 'needed' });
    expect(d.reason).toMatch(/BLOCKED/);
    expect(d.reason).toMatch(/6B\.3/);
  });
});
