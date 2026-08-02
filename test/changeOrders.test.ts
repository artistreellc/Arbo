import { describe, it, expect } from 'vitest';
import {
  assessArrival, draftChangeOrder, splitChangeOrders, ChangeOrderRejected,
  type SiteConditionRecord, type ChangeOrderRow,
} from '../src/ops/changeOrders.js';

const NOW = '2026-08-03T18:00:00Z';

const arrival = (over: Partial<SiteConditionRecord> = {}): SiteConditionRecord => ({
  jobId: 'j1', arrivalIso: '2026-08-03T12:00:00Z',
  photoFiles: ['a.jpg', 'b.jpg'], preexistingNotes: 'Fence already leaning on the north side',
  documentedBy: 'c1', ...over,
});

describe('arrival documentation (§6) — evidence strength, never "the site was fine"', () => {
  it('a full record is defensible with no gaps', () => {
    const a = assessArrival(arrival());
    expect(a.gaps).toEqual([]);
    expect(a.defensible).toBe(true);
  });

  it('NO record at all is UNDOCUMENTED, not clear', () => {
    const a = assessArrival(null);
    expect(a.defensible).toBe(false);
    expect(a.lines.join(' ')).toMatch(/UNDOCUMENTED/);
  });

  it('names the exposure when there are no arrival photos', () => {
    const a = assessArrival(arrival({ photoFiles: [] }));
    expect(a.gaps).toContain('no_photos');
    expect(a.defensible).toBe(false);
    expect(a.lines.join(' ')).toMatch(/pre-existing damage was ours/i);
  });

  it('flags photos with no written observation, and an unsigned record', () => {
    expect(assessArrival(arrival({ preexistingNotes: '  ' })).gaps).toContain('no_notes');
    expect(assessArrival(arrival({ documentedBy: '' })).gaps).toContain('no_documenter');
  });

  it('never uses clearing language anywhere in its output', () => {
    for (const rec of [arrival(), arrival({ photoFiles: [] }), null]) {
      const text = assessArrival(rec).lines.join(' ').toLowerCase();
      expect(text).not.toMatch(/no damage|site was clear|all clear|nothing wrong/);
    }
  });
});

describe('change orders (§3/§4.5) — a human prices it, a human agrees to it', () => {
  const good = {
    jobId: 'j1', description: 'Second tree at the fence line',
    amount: 850, agreedBy: 'Homeowner (Dave)', agreedAtIso: '2026-08-03T17:00:00Z',
  };

  it('records what was agreed', () => {
    const co = draftChangeOrder(good, NOW);
    expect(co.amount).toBe(850);
    expect(co.agreedBy).toBe('Homeowner (Dave)');
  });

  it('is NEVER approved or invoiced on creation — those are separate human acts', () => {
    const co = draftChangeOrder(good, NOW);
    expect(co.approved).toBe(false);
    expect(co.invoiced).toBe(false);
  });

  it('§3 — refuses to invent a missing amount', () => {
    expect(() => draftChangeOrder({ ...good, amount: null }, NOW)).toThrow(/no_amount/);
    expect(() => draftChangeOrder({ ...good, amount: NaN }, NOW)).toThrow(/no_amount/);
  });

  it('rejects a zero or negative amount', () => {
    expect(() => draftChangeOrder({ ...good, amount: 0 }, NOW)).toThrow(/negative_amount/);
    expect(() => draftChangeOrder({ ...good, amount: -50 }, NOW)).toThrow(/negative_amount/);
  });

  it('will not record an agreement with nobody named (§4.5)', () => {
    expect(() => draftChangeOrder({ ...good, agreedBy: '  ' }, NOW)).toThrow(/no_agreed_by/);
  });

  it('rejects a blank job or description instead of filing an empty change', () => {
    expect(() => draftChangeOrder({ ...good, jobId: '' }, NOW)).toThrow(ChangeOrderRejected);
    expect(() => draftChangeOrder({ ...good, description: '   ' }, NOW)).toThrow(/no_description/);
  });

  it('rejects an agreement dated in the future but tolerates clock skew', () => {
    expect(() => draftChangeOrder({ ...good, agreedAtIso: '2026-08-04T18:00:00Z' }, NOW))
      .toThrow(/future_agreement/);
    expect(() => draftChangeOrder({ ...good, agreedAtIso: '2026-08-03T18:00:30Z' }, NOW))
      .not.toThrow();
    expect(() => draftChangeOrder({ ...good, agreedAtIso: 'nope' }, NOW)).toThrow(/bad_time/);
  });
});

const row = (over: Partial<ChangeOrderRow> = {}): ChangeOrderRow => ({
  id: 'co1', jobId: 'j1', description: 'x', amount: 500,
  approved: true, invoiced: false, agreedAtIso: '2026-08-03T17:00:00Z', ...over,
});

describe('billing split — nothing bills twice, nothing goes quietly unpaid', () => {
  it('bills only approved, priced, uninvoiced changes', () => {
    const s = splitChangeOrders([
      row({ id: 'ok' }),
      row({ id: 'done', invoiced: true }),
      row({ id: 'waiting', approved: false }),
      row({ id: 'unpriced', amount: null }),
    ]);
    expect(s.billable.map((r) => r.id)).toEqual(['ok']);
    expect(s.billableTotal).toBe(500);
  });

  it('an already-invoiced change is not an open loop', () => {
    const s = splitChangeOrders([row({ invoiced: true })]);
    expect(s.billable).toEqual([]);
    expect(s.awaitingApproval).toEqual([]);
    expect(s.unpriced).toEqual([]);
  });

  it('an approved change with NO amount is surfaced, never silently dropped', () => {
    const s = splitChangeOrders([row({ id: 'u', amount: null })]);
    expect(s.unpriced.map((r) => r.id)).toEqual(['u']);
    expect(s.billableTotal).toBeNull();
  });

  it('unapproved work stays visible so it cannot go unpaid', () => {
    const s = splitChangeOrders([row({ id: 'w', approved: false })]);
    expect(s.awaitingApproval.map((r) => r.id)).toEqual(['w']);
  });

  it('a zero-amount approved change counts as unpriced, not as free work', () => {
    const s = splitChangeOrders([row({ id: 'z', amount: 0 })]);
    expect(s.unpriced.map((r) => r.id)).toEqual(['z']);
  });

  it('total is null — never 0 — when nothing is billable', () => {
    expect(splitChangeOrders([]).billableTotal).toBeNull();
  });
});
