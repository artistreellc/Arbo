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
            createdAt: at(9), name: 'Marcus', propertyId: 'p1', city: 'Chesapeake', zip: '23322',
            phone: null,
            isFirstTimer: true, permit: null,
          history: null,
          },
          {
            id: 'l2', source: 'call', details: null, qualification: null, isEmergency: false,
            status: 'new', createdAt: at(8), name: null, propertyId: null, city: null, zip: null,
            isFirstTimer: null, permit: null,
          phone: null,
          history: null,
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

  it('the §6B permit flag rides the lead — and a missing screen is surfaced, never assumed fine', async () => {
    const api = createApi(
      fakeSource({
        leads: [
          {
            id: 'flagged', source: 'call', details: 'Big oak removal near the water', qualification: {},
            isEmergency: false, status: 'new', createdAt: at(9), name: 'Dana', propertyId: 'p-rpa',
            city: 'Norfolk', zip: '23503', isFirstTimer: true,
            permit: { screenStatus: 'PERMIT_LIKELY', inRpa: true, status: 'needed' },
          phone: null,
          history: null,
          },
          {
            id: 'unscreened', source: 'call', details: 'Trim job', qualification: {},
            isEmergency: false, status: 'new', createdAt: at(8), name: 'Lee', propertyId: 'p-new',
            city: 'Chesapeake', zip: '23320', isFirstTimer: false, permit: null,
          phone: null,
          history: null,
          },
          {
            id: 'no-property', source: 'call', details: null, qualification: null,
            isEmergency: false, status: 'new', createdAt: at(7), name: null, propertyId: null,
            city: null, zip: null, isFirstTimer: null, permit: null,
          phone: null,
          history: null,
          },
        ],
      }),
    );
    const r = await api.leads();
    const { leads } = r.body as {
      leads: Array<{ id: string; permit: { screenStatus: string; inRpa: boolean } | null; screenPending: boolean }>;
    };
    const flagged = leads.find((l) => l.id === 'flagged')!;
    expect(flagged.permit?.screenStatus).toBe('PERMIT_LIKELY');
    expect(flagged.permit?.inRpa).toBe(true);
    expect(flagged.screenPending).toBe(false);

    // Property exists but no screen on file → pending, surfaced.
    expect(leads.find((l) => l.id === 'unscreened')!.screenPending).toBe(true);
    // No property captured yet → nothing to screen (address comes first).
    expect(leads.find((l) => l.id === 'no-property')!.screenPending).toBe(false);
  });
});
