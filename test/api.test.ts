import { describe, it, expect } from 'vitest';
import { createApi, type DataSource, type ApiLeadInput } from '../src/server/api.js';
import type { StopInput } from '../src/ops/morningBrief.js';

const D = '2026-08-03';
const at = (h: number) => `${D}T${String(h).padStart(2, '0')}:00:00-04:00`;

function fakeSource(opts: { ready?: boolean; stops?: StopInput[]; leads?: ApiLeadInput[] } = {}): DataSource {
  return {
    ready: () => opts.ready ?? true,
    async stopsBetween() {
      return opts.stops ?? [];
    },
    async newLeads() {
      return opts.leads ?? [];
    },
  };
}

describe('backend API (server handlers)', () => {
  it('health reports config versions + boolean integrations, never secret values', async () => {
    const api = createApi(fakeSource());
    const r = await api.health();
    expect(r.status).toBe(200);
    const b = r.body as Record<string, unknown>;
    expect(b.ok).toBe(true);
    expect(typeof b.guardrailsVersion).toBe('string');
    for (const v of Object.values(b.integrations as Record<string, unknown>)) expect(typeof v).toBe('boolean');
    expect(JSON.stringify(b)).not.toMatch(/eyJ|sk-ant|AC[0-9a-f]{32}/); // no key shapes
  });

  it('brief returns the route-ordered day', async () => {
    const api = createApi(
      fakeSource({
        stops: [
          { id: 'e1', kind: 'estimate', timeIso: at(13), name: 'Kathy', address: '12 Holly Rd', city: 'Virginia Beach', zip: '23464' },
          { id: 'j1', kind: 'job', timeIso: at(8), name: 'Henderson', address: '3 Oakcrest Dr', city: 'Chesapeake', zip: '23320' },
        ],
      }),
    );
    const r = await api.brief(at(0), at(23));
    expect(r.status).toBe(200);
    const brief = r.body as { stops: Array<{ id: string }> };
    expect(brief.stops[0]!.id).toBe('j1'); // job holds the morning
  });

  it('brief validates the window', async () => {
    const api = createApi(fakeSource());
    expect((await api.brief('junk', 'also-junk')).status).toBe(400);
  });

  it('returns 503 (not a crash) when the DB is not configured', async () => {
    const api = createApi(fakeSource({ ready: false }));
    expect((await api.brief(at(0), at(23))).status).toBe(503);
    expect((await api.leads()).status).toBe(503);
  });

  it('leads carry the quiet hot/warm/cool read', async () => {
    const api = createApi(
      fakeSource({
        leads: [
          {
            id: 'l1', source: 'call', details: 'Half an oak down across the back fence after the storm',
            qualification: { urgency: 'storm' }, isEmergency: false, status: 'new',
            createdAt: at(9), name: 'Marcus', city: 'Chesapeake', zip: '23322', isFirstTimer: true,
          },
          {
            id: 'l2', source: 'call', details: null, qualification: null, isEmergency: false,
            status: 'new', createdAt: at(8), name: null, city: null, zip: null, isFirstTimer: null,
          },
        ],
      }),
    );
    const r = await api.leads();
    expect(r.status).toBe(200);
    const { leads } = r.body as { leads: Array<{ id: string; quality: { priority: string } }> };
    expect(leads.find((l) => l.id === 'l1')!.quality.priority).toBe('hot');
    expect(leads.find((l) => l.id === 'l2')!.quality.priority).toBe('cool');
  });
});
