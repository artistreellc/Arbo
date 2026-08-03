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
import { buildSeasonalOutreach, type PastCustomer } from '../src/ops/followUps.js';
import { briefToSpeech, buildMorningBrief } from '../src/ops/morningBrief.js';
import { createApi, type DataSource } from '../src/server/api.js';
import { loadLegal } from '../src/config/loadConfig.js';

const legal = loadLegal();
const NOW = new Date('2026-07-29T19:00:00Z'); // 3 PM EDT — inside quiet hours

const customer = (over: Partial<PastCustomer> = {}): PastCustomer => ({
  contactId: 'c1',
  name: 'Repeat Customer',
  city: 'Chesapeake',
  lastJobAt: '2025-09-01T12:00:00Z',
  consentOnFile: true,
  ...over,
});

describe('seasonal / pre-storm outreach (§5A #19)', () => {
  const storm = { citiesUnderAlert: ['Chesapeake'], event: 'Tropical Storm Warning' };

  it('nudges past customers only in cities actually under a work-stopping alert', () => {
    const q = buildSeasonalOutreach(legal, storm, [customer(), customer({ contactId: 'c2', city: 'Norfolk' })], NOW);
    expect(q.due).toHaveLength(1);
    expect(q.due[0]!.targetId).toBe('c1');
    expect(q.due[0]!.type).toBe('seasonal_outreach');
    expect(q.due[0]!.recommendOnly).toBe(true);
    expect(q.due[0]!.note).toContain('Tropical Storm Warning');
  });

  it('no storm → no nudges, ever (this is not a drip campaign)', () => {
    expect(buildSeasonalOutreach(legal, { citiesUnderAlert: [], event: 'x' }, [customer()], NOW).due).toHaveLength(0);
  });

  it('the §4 gates hold: no consent or STOP → suppressed with named reason', () => {
    const q = buildSeasonalOutreach(
      legal,
      storm,
      [customer({ consentOnFile: false }), customer({ contactId: 'c3', suppressed: true })],
      NOW,
    );
    expect(q.due).toHaveLength(0);
    expect(q.suppressed.map((s) => s.reason).sort()).toEqual(['no_consent', 'stop_suppressed']);
  });
});

describe('repeat-customer memory line (§5A #27) via /api/leads', () => {
  const lead = {
    id: 'l1',
    source: 'call',
    details: null,
    qualification: null,
    isEmergency: false,
    status: 'new',
    createdAt: '2026-07-29T12:00:00Z',
    phone: null,
    name: 'Testy',
    propertyId: 'p1',
    city: 'Norfolk',
    zip: '23503',
    isFirstTimer: false,
    permit: null,
  };
  const sourceWith = (history: (typeof lead & { history: unknown })['history']): DataSource => ({
    ready: () => true,
    stopsBetween: async () => [],
    newLeads: async () => [{ ...lead, history } as never],
  });

  it('renders a warm one-liner from a completed job', async () => {
    const api = createApi(sourceWith({ kind: 'job', when: '2025-03-10T12:00:00Z', scope: 'oak removal', status: 'paid' }));
    const body = (await api.leads()).body as { leads: Array<{ history: string | null }> };
    expect(body.leads[0]!.history).toBe('Job done & paid Mar 2025 — oak removal');
  });

  it('falls back to the latest decided estimate, and to null when no history', async () => {
    const est = createApi(sourceWith({ kind: 'estimate', when: '2026-04-01T12:00:00Z', scope: null, status: 'lost' }));
    expect(((await est.leads()).body as { leads: Array<{ history: string | null }> }).leads[0]!.history).toBe('Estimate lost Apr 2026');
    const none = createApi(sourceWith(null));
    expect(((await none.leads()).body as { leads: Array<{ history: string | null }> }).leads[0]!.history).toBeNull();
  });
});

describe('spoken brief (§3.17)', () => {
  it('turns the brief into short drive-time speech, worst news first', () => {
    const brief = buildMorningBrief([
      { id: '1', kind: 'job', address: 'x', city: 'Norfolk', timeIso: '2026-07-29T13:00:00Z', name: 'A', isEmergency: true },
      { id: '2', kind: 'estimate', address: 'y', city: 'Chesapeake', zip: '23320', timeIso: '2026-07-29T18:00:00Z', name: 'B', nearPowerLines: true, isFirstTimer: true },
    ]);
    const speech = briefToSpeech(brief);
    expect(speech).toMatch(/^Good morning\. 2 stops today/);
    expect(speech).toContain('1 emergency stop');
    expect(speech).toContain('power lines');
    expect(speech).toContain('first-timer');
    expect(speech).not.toContain('undefined');
  });

  it('briefAudio: 503 without a TTS key; MP3 bytes with one', async () => {
    const source: DataSource = { ready: () => true, stopsBetween: async () => [], newLeads: async () => [] };
    expect((await createApi(source).briefAudio('2026-07-29T00:00:00Z', '2026-07-30T00:00:00Z')).status).toBe(503);
    const api = createApi(source, { tts: { synthesize: async () => new Uint8Array([73, 68, 51]) } });
    const out = await api.briefAudio('2026-07-29T00:00:00Z', '2026-07-30T00:00:00Z');
    expect(out.status).toBe(200);
    expect(out.audio).toEqual(new Uint8Array([73, 68, 51]));
  });
});
