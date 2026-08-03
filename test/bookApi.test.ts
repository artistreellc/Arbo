/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
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

  Remember the marker: SLOW::ARBO
*/
import { describe, it, expect } from 'vitest';
import { createApi, type DataSource } from '../src/server/api.js';
import type { GrowthTarget } from '../src/ops/growthForecast.js';

const NOW = new Date('2026-08-01T19:00:00Z');

const base: DataSource = { ready: () => true, stopsBetween: async () => [], newLeads: async () => [] };

const dueTarget: GrowthTarget = {
  propertyId: 'p1',
  address: '742 Evergreen Terrace',
  city: 'Virginia Beach',
  contactId: 'c1',
  consentOnFile: true,
  trees: [{ id: 't1', species: 'Leyland cypress', size: null, lastServiceIso: '2025-02-01' }],
};

describe('the Book (§6/#36): /api/properties + twin', () => {
  it('merges the coming-due read onto the property list', async () => {
    const api = createApi({
      ...base,
      properties: async () => [{ id: 'p1', address: '742 Evergreen Terrace' }, { id: 'p2', address: '1 Elm St' }],
      growthTargets: async () => [dueTarget],
    });
    const body = (await api.properties(NOW)).body as {
      properties: Array<{ id: string; due: { state: string } | null }>;
      comingDue: Array<{ propertyId: string }>;
    };
    expect(body.comingDue.map((d) => d.propertyId)).toEqual(['p1']);
    expect(body.properties.find((p) => p.id === 'p1')!.due!.state).toBe('due');
    expect(body.properties.find((p) => p.id === 'p2')!.due).toBeNull();
  });

  it('a dead forecast read never hides the Book itself', async () => {
    const api = createApi({
      ...base,
      properties: async () => [{ id: 'p1' }],
      growthTargets: async () => { throw new Error('twin offline'); },
    });
    const out = await api.properties(NOW);
    expect(out.status).toBe(200);
    expect((out.body as { properties: unknown[] }).properties).toHaveLength(1);
  });

  it('twin: 404 for unknown ids, 200 with the twin otherwise', async () => {
    const api = createApi({
      ...base,
      propertyTwin: async (id) => (id === 'p1' ? { property: { id: 'p1' }, trees: [], jobs: [], estimates: [], permits: [], correspondence: [] } : null),
    });
    expect((await api.propertyTwin('nope')).status).toBe(404);
    expect((await api.propertyTwin('p1')).status).toBe(200);
    expect((await api.propertyTwin('')).status).toBe(400);
  });
});

describe('lead actions: status taps + call-back surfacing', () => {
  it('setLeadStatus validates against the schema statuses', async () => {
    const set: string[] = [];
    const api = createApi({ ...base, setLeadStatus: async (id, s) => void set.push(`${id}:${s}`) });
    expect((await api.setLeadStatus('l1', 'qualified')).status).toBe(200);
    expect((await api.setLeadStatus('l1', 'spam')).status).toBe(200);
    expect((await api.setLeadStatus('l1', 'banana')).status).toBe(400);
    expect(set).toEqual(['l1:qualified', 'l1:spam']);
  });

  it('missed/abandoned/voicemail leads carry needsCallback + phone for tap-to-call', async () => {
    const lead = (id: string, kind?: string) => ({
      id, source: 'call', details: null, qualification: kind ? { kind } : {}, isEmergency: false,
      status: 'new', createdAt: '2026-08-01T12:00:00Z', name: null, phone: '+17575550100',
      propertyId: null, city: null, zip: null, isFirstTimer: null, permit: null, history: null,
    });
    const api = createApi({ ...base, newLeads: async () => [lead('a', 'voicemail'), lead('b')] });
    const body = (await api.leads()).body as { leads: Array<{ id: string; needsCallback: boolean; phone: string | null }> };
    expect(body.leads.find((l) => l.id === 'a')!.needsCallback).toBe(true);
    expect(body.leads.find((l) => l.id === 'b')!.needsCallback).toBe(false);
    expect(body.leads[0]!.phone).toBe('+17575550100');
  });
});
