import { describe, it, expect } from 'vitest';
import { createApi, type DataSource } from '../src/server/api.js';
import type { ChangeOrderRow } from '../src/ops/changeOrders.js';

const JOB = 'aaaaaaaa-1111-2222-3333-444444444444';
const CO = 'bbbbbbbb-1111-2222-3333-444444444444';

const row = (over: Partial<ChangeOrderRow> = {}): ChangeOrderRow => ({
  id: CO, jobId: JOB, description: 'Second tree', amount: 850,
  approved: true, invoiced: false, agreedAtIso: '2026-08-03T17:00:00Z', ...over,
});

function src(over: Partial<DataSource> = {}): DataSource {
  return {
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [],
    billableJobs: async () => [],
    openInvoices: async () => [],
    recordSiteCondition: async () => ({ id: 'sc1' }),
    createChangeOrder: async () => ({ id: CO }),
    openChangeOrders: async () => [row()],
    approveChangeOrder: async () => true,
    billableChangesForJob: async () => [{ id: CO, amount: 850 }],
    markChangesInvoiced: async () => {},
    ...over,
  };
}

describe('POST /api/jobs/:id/arrival — the record that wins a damage dispute', () => {
  it('files the record and hands back the gaps while the crew is still on site', async () => {
    const res = await createApi(src()).recordArrival(JOB, { photoFiles: [], documentedBy: '' });
    expect(res.status).toBe(200);
    const b = res.body as { defensible: boolean; gaps: string[]; lines: string[] };
    expect(b.defensible).toBe(false);
    expect(b.gaps).toContain('no_photos');
    expect(b.lines.join(' ')).toMatch(/pre-existing damage was ours/i);
  });

  it('a complete record is defensible with no gaps', async () => {
    const res = await createApi(src()).recordArrival(JOB, {
      photoFiles: ['a.jpg'], documentedBy: 'c1', preexistingNotes: 'fence leaning',
    });
    expect(res.body).toMatchObject({ defensible: true, gaps: [] });
  });

  it('rejects a bad job id or a bad timestamp instead of filing junk', async () => {
    const api = createApi(src());
    expect((await api.recordArrival('nope', {})).status).toBe(400);
    expect((await api.recordArrival(JOB, { arrivalIso: 'whenever' })).status).toBe(400);
  });
});

describe('POST /api/jobs/:id/change-order — §3 still holds in the field', () => {
  const good = { description: 'Second tree at the fence line', amount: 850, agreedBy: 'Homeowner' };

  it('records the agreed amount, unapproved and unbilled', async () => {
    const res = await createApi(src()).addChangeOrder(JOB, good);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ approved: false, invoiced: false });
  });

  it('refuses to invent a missing amount', async () => {
    let wrote = false;
    const api = createApi(src({ createChangeOrder: async () => { wrote = true; return { id: CO }; } }));
    const res = await api.addChangeOrder(JOB, { ...good, amount: null });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'no_amount' });
    expect(wrote, 'Arbo priced a change order').toBe(false);
  });

  it('refuses an agreement with nobody named (§4.5)', async () => {
    const res = await createApi(src()).addChangeOrder(JOB, { ...good, agreedBy: '' });
    expect(res.body).toMatchObject({ error: 'no_agreed_by' });
  });

  it('an empty-string amount is missing, not zero', async () => {
    const res = await createApi(src()).addChangeOrder(JOB, { ...good, amount: '' });
    expect(res.body).toMatchObject({ error: 'no_amount' });
  });
});

describe('POST /api/change-orders/:id/approve', () => {
  it('approves a real one', async () => {
    expect((await createApi(src()).approveChangeOrder(CO)).status).toBe(200);
  });

  it('409s rather than reporting an approval that did not happen', async () => {
    const api = createApi(src({ approveChangeOrder: async () => false }));
    const res = await api.approveChangeOrder(CO);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'not_approvable' });
  });

  it('rejects a non-UUID id', async () => {
    expect((await createApi(src()).approveChangeOrder('co-1')).status).toBe(400);
  });
});

describe('change orders reach the money read, or the work goes unpaid', () => {
  it('approved and priced work shows as billable with a total', async () => {
    const res = await createApi(src()).money();
    const b = res.body as { changeOrders: { billable: unknown[]; billableTotal: number | null }; changeOrdersKnown: boolean };
    expect(b.changeOrders.billable).toHaveLength(1);
    expect(b.changeOrders.billableTotal).toBe(850);
    expect(b.changeOrdersKnown).toBe(true);
  });

  it('§1B — an unreadable change-order feed is UNKNOWN, not "nothing extra to bill"', async () => {
    const res = await createApi(src({
      openChangeOrders: async () => { throw new Error('db down'); },
    })).money();
    const b = res.body as { changeOrdersKnown: boolean; changeOrders: { billableTotal: number | null } };
    expect(b.changeOrdersKnown).toBe(false);
    expect(b.changeOrders.billableTotal).toBeNull();
  });

  it('unapproved and unpriced work stays visible in the money read', async () => {
    const res = await createApi(src({
      openChangeOrders: async () => [
        row({ id: 'w', approved: false }),
        row({ id: 'u', amount: null }),
      ],
    })).money();
    const b = res.body as { changeOrders: { awaitingApproval: Array<{ id: string }>; unpriced: Array<{ id: string }> } };
    expect(b.changeOrders.awaitingApproval.map((r) => r.id)).toEqual(['w']);
    expect(b.changeOrders.unpriced.map((r) => r.id)).toEqual(['u']);
  });
});

describe('billing actually collects the change orders (the leak this closes)', () => {
  const withJob = (over: Partial<DataSource> = {}): DataSource => src({
    billableJobs: async () => [
      { jobId: JOB, name: 'A', completedAtIso: '2026-08-01T18:00:00Z', agreedAmount: 4000, hasInvoice: false },
    ],
    createInvoice: async () => ({ id: 'inv1' }),
    ...over,
  });

  it('adds approved change orders to the invoice amount', async () => {
    let written: { amount: number } | null = null;
    const api = createApi(withJob({
      createInvoice: async (i) => { written = i; return { id: 'inv1' }; },
    }));
    const res = await api.createInvoice({ jobId: JOB });
    expect(res.status).toBe(200);
    expect(written!.amount).toBe(4850); // 4000 base + 850 agreed change
    expect(res.body).toMatchObject({ baseAmount: 4000, changeOrderTotal: 850, changesBilled: 1 });
  });

  it('marks them invoiced ONLY after the invoice row exists', async () => {
    const order: string[] = [];
    const api = createApi(withJob({
      createInvoice: async () => { order.push('invoice'); return { id: 'inv1' }; },
      markChangesInvoiced: async () => { order.push('mark'); },
    }));
    await api.createInvoice({ jobId: JOB });
    expect(order).toEqual(['invoice', 'mark']);
  });

  it('still bills the base job when the change-order read fails', async () => {
    let written: { amount: number } | null = null;
    const api = createApi(withJob({
      billableChangesForJob: async () => { throw new Error('db down'); },
      createInvoice: async (i) => { written = i; return { id: 'inv1' }; },
    }));
    const res = await api.createInvoice({ jobId: JOB });
    expect(res.status).toBe(200);
    expect(written!.amount).toBe(4000);
    // The unbilled changes stay visible in /api/money rather than vanishing.
    expect(res.body).toMatchObject({ changeOrderTotal: 0 });
  });

  it('reports changesBilled=0 when the flags did not stick, so nothing rides twice', async () => {
    const api = createApi(withJob({
      markChangesInvoiced: async () => { throw new Error('db down'); },
    }));
    const res = await api.createInvoice({ jobId: JOB });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changesBilled: 0, changeOrderTotal: 850 });
  });
});

describe('crew-door versions — §8C keeps money off the crew surface', () => {
  it('a crew change order is recorded with NO figure at all', async () => {
    let written: { amount: number | null } | null = null;
    const api = createApi(src({
      createChangeOrder: async (i) => { written = i; return { id: CO }; },
    }));
    const res = await api.crewChangeOrder({
      jobId: JOB, description: 'Second tree', agreedBy: 'Homeowner',
      // Even if a client tried to send one, the crew path ignores it.
      amount: 5000,
    });
    expect(res.status).toBe(200);
    expect(written!.amount).toBeNull();
    // Nothing money-shaped comes back either.
    expect(JSON.stringify(res.body)).not.toMatch(/amount|price|total/i);
  });

  it('still refuses an agreement with nobody named', async () => {
    const res = await createApi(src()).crewChangeOrder({ jobId: JOB, description: 'x', agreedBy: '' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'no_agreed_by' });
  });

  it('an unpriced crew order lands in the office queue, never on a bill', async () => {
    const res = await createApi(src({
      openChangeOrders: async () => [row({ id: 'crew1', amount: null, approved: true })],
    })).money();
    const b = res.body as { changeOrders: { unpriced: Array<{ id: string }>; billable: unknown[] } };
    expect(b.changeOrders.unpriced.map((r) => r.id)).toEqual(['crew1']);
    expect(b.changeOrders.billable).toEqual([]);
  });

  it('the ADMIN path still requires the agreed figure (§3 is not relaxed)', async () => {
    const res = await createApi(src()).addChangeOrder(JOB, { description: 'x', agreedBy: 'y', amount: null });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'no_amount' });
  });

  it('crew arrival routes through the same assessment', async () => {
    const res = await createApi(src()).crewArrival({ jobId: JOB, photoFiles: [], documentedBy: 'c1' });
    expect(res.status).toBe(200);
    expect((res.body as { gaps: string[] }).gaps).toContain('no_photos');
  });
});
