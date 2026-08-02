import { describe, it, expect } from 'vitest';
import { createApi, type DataSource } from '../src/server/api.js';
import type { InvoiceableJob, OpenInvoice } from '../src/ops/invoicing.js';

const billable: InvoiceableJob[] = [
  { jobId: 'j-ok', name: 'A. Customer', completedAtIso: '2026-07-01T18:00:00Z', agreedAmount: 4500, hasInvoice: false },
  { jobId: 'j-noprice', name: 'B. Customer', completedAtIso: '2026-07-02T18:00:00Z', agreedAmount: null, hasInvoice: false },
  { jobId: 'j-billed', name: 'C. Customer', completedAtIso: '2026-06-01T18:00:00Z', agreedAmount: 900, hasInvoice: true },
];

const invoices: OpenInvoice[] = [
  { id: 'i-late', jobId: 'j-billed', name: 'C. Customer', amount: 900, lateFeePct: 20, status: 'sent', sentAtIso: '2026-06-05T12:00:00Z', paidAtIso: null, netDays: 14 },
  { id: 'i-blind', jobId: 'j-x', amount: 100, lateFeePct: 5, status: 'sent', sentAtIso: null, paidAtIso: null, netDays: 14 },
];

function moneySource(over: Partial<DataSource> = {}): DataSource {
  return {
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [],
    billableJobs: async () => billable,
    openInvoices: async () => invoices,
    createInvoice: async () => ({ id: 'new-invoice' }),
    setInvoiceStatus: async () => true,
    ...over,
  };
}

describe('GET /api/money — the whole money loop in one honest read', () => {
  it('drafts what can be billed and NAMES what cannot', async () => {
    const res = await createApi(moneySource()).money();
    expect(res.status).toBe(200);
    const b = res.body as {
      drafts: Array<{ jobId: string; amount: number }>;
      blocked: Array<{ jobId: string; reason: string }>;
    };
    expect(b.drafts.map((d) => d.jobId)).toEqual(['j-ok']);
    expect(b.blocked.map((x) => x.reason)).toEqual(['no_agreed_amount']);
  });

  it('charges the late fee at the 5% cap even when the row says 20%', async () => {
    const res = await createApi(moneySource()).money();
    const row = (res.body as { invoices: Array<{ id: string; lateFeePct: number; lateFeeOwed: number }> })
      .invoices.find((i) => i.id === 'i-late')!;
    expect(row.lateFeePct).toBe(5);
    expect(row.lateFeeOwed).toBe(45); // 5% of 900, never 180
  });

  it('reports an uncomputable invoice as unknown, not as current', async () => {
    const res = await createApi(moneySource()).money();
    const b = res.body as {
      invoices: Array<{ id: string; status: string }>;
      unknown: Array<{ invoiceId: string }>;
    };
    expect(b.invoices.find((i) => i.id === 'i-blind')!.status).toBe('unknown');
    expect(b.unknown.map((u) => u.invoiceId)).toContain('i-blind');
  });

  it('503s honestly with no database', async () => {
    const dead = createApi({ ready: () => false, stopsBetween: async () => [], newLeads: async () => [] });
    expect((await dead.money()).status).toBe(503);
  });
});

describe('POST /api/invoices — the amount cannot come from the request (§3)', () => {
  it('ignores a client-supplied amount and uses the agreed figure', async () => {
    let written: { amount: number; lateFeePct: number } | null = null;
    const api = createApi(moneySource({
      createInvoice: async (i) => { written = i; return { id: 'inv-1' }; },
    }));
    const res = await api.createInvoice({ jobId: 'j-ok', amount: 999999, lateFeePct: 20 });
    expect(res.status).toBe(200);
    expect(written!.amount).toBe(4500);
    expect(written!.lateFeePct).toBe(5);
  });

  it('refuses a job with no agreed figure and says why', async () => {
    let wrote = false;
    const api = createApi(moneySource({
      createInvoice: async () => { wrote = true; return { id: 'x' }; },
    }));
    const res = await api.createInvoice({ jobId: 'j-noprice' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'no_agreed_amount' });
    expect(wrote, 'Arbo invented a price').toBe(false);
  });

  it('404s on a job it cannot see rather than creating a floating invoice', async () => {
    const res = await createApi(moneySource()).createInvoice({ jobId: 'nope' });
    expect(res.status).toBe(404);
  });

  it('a double submit loses at the DB constraint, not at the customer mailbox', async () => {
    const api = createApi(moneySource({ createInvoice: async () => 'already_invoiced' }));
    const res = await api.createInvoice({ jobId: 'j-ok' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'already_invoiced' });
  });

  it('rejects a request with no job', async () => {
    expect((await createApi(moneySource()).createInvoice({})).status).toBe(400);
  });
});

const UUID = '11111111-2222-3333-4444-555555555555';

describe('POST /api/invoices/:id/status — Mike moves the money, nothing else does', () => {
  it('accepts only the three human transitions', async () => {
    const api = createApi(moneySource());
    for (const status of ['sent', 'paid', 'void']) {
      expect((await api.setInvoiceStatus(UUID, { status })).status).toBe(200);
    }
    for (const bad of ['overdue', 'draft', 'refunded', '']) {
      expect((await api.setInvoiceStatus(UUID, { status: bad })).status).toBe(400);
    }
  });

  it('rejects a blank or non-UUID id instead of updating everything', async () => {
    const api = createApi(moneySource());
    expect((await api.setInvoiceStatus('', { status: 'paid' })).status).toBe(400);
    expect((await api.setInvoiceStatus('i1', { status: 'paid' })).status).toBe(400);
  });

  it('404s rather than reporting success for an invoice that does not exist', async () => {
    const api = createApi(moneySource({ setInvoiceStatus: async () => false }));
    const res = await api.setInvoiceStatus(UUID, { status: 'paid' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'unknown_invoice' });
  });
});
