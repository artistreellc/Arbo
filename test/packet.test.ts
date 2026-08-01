import { describe, it, expect } from 'vitest';
import { assemblePacket, CONTRACTOR, type PacketInput } from '../src/permitting/packet.js';

const base: PacketInput = {
  city: 'Virginia Beach',
  permit: { id: 'perm-1', screenStatus: 'PERMIT_LIKELY', inRpa: true, labeledMapFile: 'drive-map-1' },
  property: { address: '77 Bayside Rd', zip: '23451' },
  owner: { name: 'Dana Homeowner', phone: '7575550142' },
  photos: [{ driveFileId: 'drive-photo-1', label: 'Oak #1' }],
  preparedForms: ['PPR Standard Submittal Form', 'PPR Tree Removal Form'],
  treeCount: 2,
};

describe('permit packet assembly (§6B.1 step 6 — prepare and hand off, never file)', () => {
  it('a complete VB packet is READY_FOR_MIKE with both PPR forms checked', () => {
    const p = assemblePacket(base);
    expect(p.status).toBe('READY_FOR_MIKE');
    expect(p.missing).toEqual([]);
    expect(p.items.filter((i) => i.key.startsWith('form:'))).toHaveLength(2);
    expect(p.handoff.method).toBe('Accela');
    expect(p.neverAutoFiled).toBe(true);
  });

  it('missing map + photos → INCOMPLETE, each named', () => {
    const p = assemblePacket({
      ...base,
      permit: { ...base.permit, labeledMapFile: null },
      photos: [],
    });
    expect(p.status).toBe('INCOMPLETE');
    expect(p.missing.join(' ')).toMatch(/site map/i);
    expect(p.missing.join(' ')).toMatch(/photos/i);
    expect(p.coverSummary).toMatch(/INCOMPLETE — still needs/);
  });

  it('an unprepared city form is flagged missing', () => {
    const p = assemblePacket({ ...base, preparedForms: ['PPR Standard Submittal Form'] });
    expect(p.status).toBe('INCOMPLETE');
    expect(p.missing).toContain('PPR Tree Removal Form');
  });

  it('surfaces the mitigation rule up front on PERMIT_LIKELY removals (§6B.4)', () => {
    const p = assemblePacket(base);
    expect(p.mitigationNote).toMatch(/3 replacement/i);
    expect(p.mitigationNote).toMatch(/~6 replacement trees/); // 2 removed × 3:1
  });

  it('no mitigation note when the screen was not PERMIT_LIKELY', () => {
    const p = assemblePacket({ ...base, permit: { ...base.permit, screenStatus: 'NO_OVERLAY_VERIFY', inRpa: false } });
    expect(p.mitigationNote).toBeUndefined();
    expect(p.coverSummary).toMatch(/verify with city/i);
  });

  it('carries only the approved credentials — and there is no submit anywhere', () => {
    expect(CONTRACTOR.credentials).toBe('Licensed & insured · BBB A+');
    const p = assemblePacket(base);
    expect(JSON.stringify(p)).not.toMatch(/\bTCIA\b/i);
    expect(JSON.stringify(p)).not.toMatch(/\bSuffolk\b/i);
    // the packet's contract: hand-off info for MIKE, never a send/submit action
    expect(p.handoff.contact?.email).toContain('@');
    expect(Object.keys(p)).not.toContain('submit');
  });

  it('cover summary always tells Mike where it goes', () => {
    const norfolk = assemblePacket({ ...base, city: 'Norfolk' });
    expect(norfolk.handoff.method).toMatch(/Norfolk Environmental Services/i);
    expect(norfolk.coverSummary).toContain('Norfolk');
  });
});
