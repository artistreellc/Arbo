/*
  SLOW::ARBO — tests a write switch. The note at the top of
  test/dataLinks.test.ts applies here in full.
*/
// R33 — Google and Quo connected READ-ONLY. Mike, 2026-10-20, verbatim:
// "Connect Google as a read only and connect quo as read only".
// Pins: Arbo asks Google for exactly three read permissions; every Google
// write refuses IN CODE whatever the token can do (the R18 hold, the D36
// recolor, a Drive folder); outreach never treats a hold that did not happen
// as a booking; every Quo write (a text from any path, creating, replacing
// or deleting a webhook) refuses by name unless ARBO_QUO_SEND is exactly
// 'live'; reads keep working; the app and the boot say which mode it is in.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import {
  GOOGLE_READ_ONLY, GOOGLE_HOLDS_OFF_LINE, GoogleReadOnlyError, QUO_READ_ONLY_LINE, QUO_HOOK_MISSING_LINE, QUO_HOOK_NO_KEY_LINE,
  QuoReadOnlyError, quoWritesLive, readOnlyBootLines,
} from '../src/integrations/readOnly.js';
import { consentUrl, GOOGLE_SCOPES, GOOGLE_PERMISSIONS, extraScopes } from '../src/integrations/googleTokenStore.js';
import { createGoogleCalendarApi } from '../src/integrations/calendar.js';
import { createGoogleDriveApi, ensurePropertyFolders } from '../src/integrations/drive.js';
import { createDriveFolderReader } from '../src/integrations/driveRead.js';
import { markEstimateWonOnCalendar } from '../src/scheduling/scheduler.js';
import { QuoIntake, bookedFromHolds } from '../src/ops/quoIntake.js';
import { createQuoApi, ensureQuoWebhooks, registrationFrom, type QuoApi, type QuoWebhook } from '../src/integrations/quo.js';
import { createQuoSender } from '../src/integrations/quoSend.js';
import { OutreachEngine } from '../src/ops/outreach.js';
import { CallMemory, CallRecordStore } from '../src/reception/callMemory.js';
import { createElevenLabsBridge, type CallHold } from '../src/voice/elevenlabsBridge.js';
import { loadAllConfig } from '../src/config/loadConfig.js';
import type { SonaCallFacts } from '../src/ops/quoExtract.js';
import type { Alerter, ChatMessage, LlmClient } from '../src/reception/receptionist.js';
import { loadAppHtml } from '../src/server/appPage.js';
import { createTalkTools, talkReadsFrom } from '../src/voice/ownerTalk.js';
import { createApi } from '../src/server/api.js';
import { createSimSource } from '../src/dev/simSource.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const NOW = Date.parse('2026-10-20T15:00:00Z'); // Tuesday 11:00 EDT — inside 8am–9pm
const KEY = Buffer.from('arbo-test-signing-key-32-bytes!!').toString('base64');
const LINE = '+17576069432';
const CALLER = '+17575550142';
const HOOK_URL = 'https://arbo.test/webhooks/quo';
const { guardrails, legal } = loadAllConfig();

const FACTS: SonaCallFacts = {
  wantsEstimate: true, name: 'SIM-Dana', address: '4500 Simulated Ct', city: 'Virginia Beach', jobType: 'removal',
  treeDetails: 'big oak in the back yard', powerLines: 'no', emergency: false, requestedTime: 'Wednesday after 4',
  agentSlips: [], callerType: 'customer',
};

function sign(body: string): Record<string, string> {
  const sig = createHmac('sha256', Buffer.from(KEY, 'base64')).update(`${NOW}.${body}`).digest('base64');
  return { 'openphone-signature': `hmac;1;${NOW};${sig}` };
}

/** The intake exactly as the server builds it — no googleWrites passed — with a writer that records any call. */
function sonaIntake() {
  const holds: CallHold[] = [];
  const records = new CallRecordStore();
  const intake = new QuoIntake({
    guardrails, extractor: { extract: async () => FACTS }, callMemory: new CallMemory(), callRecords: records,
    calendarHold: async (h) => { holds.push(h); }, onText: () => {}, now: () => NOW,
  });
  intake.setRegistration('ok', 'test', [KEY], [LINE]);
  const post = (event: unknown) => { const body = JSON.stringify(event); return intake.handle(sign(body), body); };
  return { intake, holds, records, post };
}

async function sonaCallWantingAnEstimate(h: ReturnType<typeof sonaIntake>) {
  h.post({ type: 'call.completed', data: { object: { id: 'AC1', from: CALLER, to: LINE, direction: 'incoming', status: 'completed', aiHandled: 'ai-agent' } } });
  h.post({ type: 'call.transcript.completed', data: { object: { callId: 'AC1', dialogue: [
    { identifier: LINE, content: "Hi, you've reached Art-is-Tree." },
    { identifier: CALLER, content: 'I need a big oak taken down in the back yard, can someone come Wednesday after 4?' },
  ] } } });
  await h.intake.settled();
}

function fakeQuo(over: Partial<QuoApi> = {}): QuoApi {
  return {
    listPhoneNumbers: async () => [LINE],
    phoneNumbers: async () => [{ id: 'PN1', number: LINE }],
    listConversations: async () => [{ id: 'CN1', phoneNumberId: 'PN1', participants: [CALLER], lastActivityAt: null, updatedAt: null }],
    listCalls: async () => [{ id: 'AC1', direction: 'incoming', status: 'completed', aiHandled: 'ai-agent', createdAt: new Date(NOW - 3 * 86_400_000).toISOString(), answeredAt: null, completedAt: null }],
    listMessages: async () => [],
    getCallTranscript: async () => ({ status: 'completed', dialogue: [
      { identifier: LINE, content: 'Hi, Art-is-Tree.', userId: null },
      { identifier: CALLER, content: 'I need an oak looked at in my back yard for an estimate.', userId: null },
    ] }),
    listWebhooks: async () => [],
    getWebhook: async () => null,
    createWebhook: vi.fn(async () => { throw new Error('createWebhook must not be called while read-only'); }),
    deleteWebhook: vi.fn(async () => { throw new Error('deleteWebhook must not be called while read-only'); }),
    ...over,
  };
}

function engineWith(over: { sender?: ReturnType<typeof vi.fn>; quo?: QuoApi; bookedCallers?: () => Set<string>; sonaFilesHolds?: boolean; enabled?: boolean } = {}) {
  const send = over.sender ?? vi.fn(async () => ({ ok: true as const, id: 'AC-out', status: 'queued', conversationId: null }));
  const engine = new OutreachEngine({
    quo: over.quo ?? fakeQuo(), sender: { send }, guardrails, legal,
    extractor: { extract: async () => ({ ...FACTS, requestedTime: null }) },
    bookedCallers: over.bookedCallers ?? (() => new Set()), sonaFilesHolds: over.sonaFilesHolds ?? false,
    enabled: () => over.enabled ?? true, now: () => NOW, sleep: async () => {}, spacingMs: 0,
  });
  engine.setLine({ phoneNumberId: 'PN1', number: LINE, ownNumbers: [LINE] });
  return { engine, send };
}

// ═══ Google ════════════════════════════════════════════════════════════════
describe('Google is asked for read permissions only', () => {
  it('the consent link carries exactly the three read-only scopes — nothing that sends, edits or deletes', () => {
    const asked = new URL(consentUrl('CLIENT')).searchParams.get('scope')!.split(' ');
    expect([...asked].sort()).toEqual([
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
    ]);
    expect(asked).toEqual(GOOGLE_SCOPES);
    expect(asked.join(' ')).not.toMatch(/calendar\.events|auth\/calendar(\s|$)|gmail\.(send|modify|compose)|auth\/drive(\s|$)|drive\.file|mail\.google\.com/);
  });

  it('Settings lists the same three, in the words Google’s own screen uses', () => {
    expect(GOOGLE_PERMISSIONS.map((p) => p.scope)).toEqual(GOOGLE_SCOPES);
    expect(GOOGLE_PERMISSIONS.map((p) => p.googleSays)).toEqual([
      'View your email messages and settings',
      'See and download any calendar you can access using your Google Calendar',
      'See and download all your Google Drive files',
    ]);
  });

  it('a grant carrying more than Arbo asked for (an older calendar.events) is named — and still used read-only', () => {
    expect(extraScopes([...GOOGLE_SCOPES, 'https://www.googleapis.com/auth/calendar.events'])).toEqual(['https://www.googleapis.com/auth/calendar.events']);
    expect(extraScopes(GOOGLE_SCOPES)).toEqual([]);
    expect(GOOGLE_READ_ONLY).toBe(true);
  });
});

describe('every Google write refuses in code, whatever the token can do', () => {
  it('a calendar hold and the D36 won-estimate recolor never leave Arbo — not even to mint a token', async () => {
    // Answers anything that slips past with a refusal of its own — no real request ever leaves the test.
    const net = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
    const token = vi.fn(async () => 'SIM-token-granted-with-calendar.events');
    const cal = createGoogleCalendarApi(token);
    const hold = { calendarId: 'primary', summary: 'SIM-Dana - 7575550142', startIso: '2026-10-21T20:00:00Z', endIso: '2026-10-21T21:00:00Z' };
    await expect(cal.createEvent(hold)).rejects.toMatchObject({ name: 'GoogleReadOnlyError', write: 'calendar.create' });
    await expect(cal.updateEventColor('primary', 'SIM-evt', '2')).rejects.toMatchObject({ name: 'GoogleReadOnlyError', write: 'calendar.recolor' });
    await expect(markEstimateWonOnCalendar(cal, 'primary', 'SIM-evt')).rejects.toBeInstanceOf(GoogleReadOnlyError);
    expect(net).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
  });

  it('a Drive folder is never created (POST /drive/v3/files is a write); finding one still reads', async () => {
    const seen: Array<{ url: string; method: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      seen.push({ url: String(url), method: init?.method ?? 'GET' });
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    });
    const drive = createGoogleDriveApi(async () => 'SIM-token');
    expect(await drive.findFolder('Estimates', 'SIM-root')).toBeNull();
    await expect(drive.createFolder('SIM-Folder', 'SIM-root')).rejects.toMatchObject({ name: 'GoogleReadOnlyError', write: 'drive.createFolder' });
    await expect(ensurePropertyFolders(drive, 'SIM-root', '1 Simulated Way', 'Norfolk')).rejects.toBeInstanceOf(GoogleReadOnlyError);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r.method === 'GET')).toBe(true);
  });

  it('reading the calendar still works — a GET', async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      seen.push(init?.method ?? 'GET');
      return new Response(JSON.stringify({ items: [{ id: 'SIM-e1', summary: 'SIM', start: { dateTime: '2026-10-21T13:00:00Z' }, end: { dateTime: '2026-10-21T14:00:00Z' } }] }), { status: 200 });
    });
    const events = await createGoogleCalendarApi(async () => 'SIM-token').listEvents('primary', '2026-10-21T00:00:00Z', '2026-10-22T00:00:00Z');
    expect(events.map((e) => e.id)).toEqual(['SIM-e1']);
    expect(seen).toEqual(['GET']);
  });
});

describe('a hold attempt never calls Google and says it is off (§1B)', () => {
  it('a Sona caller who wants an estimate: the writer is never called; the call, its record and the status say read-only', async () => {
    const h = sonaIntake();
    await sonaCallWantingAnEstimate(h);
    expect(h.holds).toEqual([]);
    const [call] = h.intake.list();
    expect(call!.hold).toBe('read_only');
    expect(call!.facts!.requestedTime).toBe('Wednesday after 4'); // shown on the card for Mike to book
    expect(h.records.list()[0]!.calendarHold).toBe('read_only');
    // H1 merge: holdsAttempted is gone — filed, failed and waiting are three numbers, all 0 while holds are off.
    expect(h.intake.status()).toMatchObject({ holds: 'read_only', holdsFiled: 0, holdsFailed: 0, holdsWaiting: 0 });
    expect(h.intake.status()).not.toHaveProperty('holdsAttempted');
    expect(h.intake.bookingState(call!.callId)).toBe('read_only'); // its own answer — never 'unknown', never 'not_filed'
    expect(h.intake.holdsLive()).toBe(false);
  });

  it('Arbo’s own voice line (cut under R21) files no hold either — its record says read-only', async () => {
    const holds: CallHold[] = [];
    const records = new CallRecordStore();
    const llm: LlmClient = { complete: async (_s: string, _m: ChatMessage[]) => 'Bye now — have a good one! [[END_CALL]]' };
    const alerter: Alerter = { emergency: async () => {} };
    const bridge = createElevenLabsBridge({
      guardrails, legal, llm, alerter, bridgeSecret: 's', callRecords: records, now: () => NOW,
      calendarHold: async (x: CallHold) => { holds.push(x); },
    });
    await bridge.handle('Bearer s', { user: CALLER, elevenlabs_extra_body: { conversation_id: 'c1' }, messages: [{ role: 'user', content: 'bye' }], tools: [{ type: 'function', function: { name: 'end_call' } }] });
    await new Promise((r) => setTimeout(r, 0));
    expect(holds).toEqual([]);
    expect(records.list()[0]!.calendarHold).toBe('read_only');
  });
});

describe('Talk says holds are off — never "Calendar holds filed: 0"', () => {
  it('the Sona detail names holds off on purpose; a missing webhook is named, not a failure', async () => {
    const h = sonaIntake();
    await sonaCallWantingAnEstimate(h);
    const api = createApi(createSimSource(), { dataLinksSim: true, alerts: { activeAlerts: async () => [] } });
    const stormLaw = async () => ({ state: 'none' as const, declarations: [], flag: null, governorNote: '', checkedAt: new Date().toISOString(), reason: null });
    const talk = (reg?: [string, string]) => {
      if (reg) h.intake.setRegistration(reg[0] as 'read_only', reg[1]);
      return createTalkTools(talkReadsFrom({ api, quo: () => ({ status: h.intake.status(), calls: h.intake.list() }), stormLaw, mode: () => 'sim' })).run('arbo_sona_calls');
    };
    const text = (await talk()).text;
    expect(text).toContain('Calendar holds: off — Google is connected read-only');
    expect(text).not.toContain('Calendar holds filed');
    const ro = (await talk(['read_only', QUO_HOOK_MISSING_LINE])).text;
    expect(ro).toContain("Quo is read-only, so Arbo won't add a webhook Quo is missing");
    expect(ro).not.toMatch(/connection to Quo failed/);
  });
});

describe('outreach never treats a hold that did not happen as a booking', () => {
  it('the caller Sona “booked” is still a customer who has not heard from us — not estimate_booked', async () => {
    const h = sonaIntake();
    await sonaCallWantingAnEstimate(h);
    expect(bookedFromHolds(h.intake.list())).toEqual(new Set());
    vi.stubEnv('ARBO_QUO_SEND', 'live'); // so the candidate list is the only thing under test
    const { engine } = engineWith({ bookedCallers: () => bookedFromHolds(h.intake.list()), sonaFilesHolds: h.intake.holdsLive() });
    const [c] = await engine.buildCandidates();
    expect(c).toMatchObject({ number: CALLER, classification: 'customer', skip: null });
  });

  it('the server asks the intake — never a writer being present — whether Sona booked anyone', () => {
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(server).toContain('bookedCallers: () => bookedFromHolds(quoIntake.list())');
    expect(server).toContain('sonaFilesHolds: quoIntake.holdsLive()');
    expect(server).not.toContain('sonaFilesHolds: Boolean(calendarHold)');
  });
});

// ═══ Quo ═══════════════════════════════════════════════════════════════════
describe('a Quo send never leaves Arbo while Quo is read-only', () => {
  it('the sender refuses by name and never POSTs', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ data: { id: 'AC-out' } }) }));
    const r = await createQuoSender('SIM-quo-key', f).send({ from: LINE, to: CALLER, content: 'This is Art-is-Tree. Reply STOP to opt out.' });
    expect(r).toEqual({ ok: false, reason: 'read_only', code: null });
    expect(f).not.toHaveBeenCalled();
  });

  it('outreach: Mike’s catch-up tap, the boot catch-up and the 48-hour follow-ups queue nothing and send nothing', async () => {
    const { engine, send } = engineWith({ enabled: true });
    expect(await engine.runCatchup('mike')).toEqual({ ran: false, queued: 0, skipped: {}, reason: 'quo_read_only' });
    expect(await engine.runCatchup('auto')).toEqual({ ran: false, queued: 0, skipped: {}, reason: 'quo_read_only' });
    expect(await engine.followUpTick()).toBe(0);
    await engine.tick();
    await engine.drain();
    expect(send).not.toHaveBeenCalled();
    expect(engine.sends()).toEqual([]);
    expect(engine.status()).toMatchObject({ readOnly: true, queued: 0, sent: 0 });
  });

  it('the send route refuses by name with the app’s line; nothing reaches Quo', async () => {
    vi.resetModules();
    vi.stubEnv('QUO_API_KEY', 'SIM-quo-key');
    vi.stubEnv('APP_ACCESS_KEY', 'SIM-app-key');
    vi.stubEnv('ARBO_DATA_LINKS', 'sim');
    vi.stubEnv('ARBO_SECRET_DIR', mkdtempSync(join(tmpdir(), 'arbo-r33-')));
    const quoCalls: Array<{ url: string; method: string }> = [];
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
      const url = String(u);
      if (url.startsWith('https://api.quo.com')) {
        quoCalls.push({ url, method: init?.method ?? 'GET' });
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return realFetch(u, init);
    });
    const { createArborRequestHandler } = await import('../src/server.js');
    const srv = createServer(createArborRequestHandler());
    await new Promise<void>((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    try {
      const res = await realFetch(`${base}/api/outreach/catchup`, { method: 'POST', headers: { 'x-arbor-key': 'SIM-app-key' } });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ ran: false, error: 'quo_read_only', line: QUO_READ_ONLY_LINE });
      const st = (await (await realFetch(`${base}/api/outreach`, { headers: { 'x-arbor-key': 'SIM-app-key' } })).json()) as { status: { readOnly: boolean } };
      expect(st.status.readOnly).toBe(true);
      const quo = (await (await realFetch(`${base}/api/quo`, { headers: { 'x-arbor-key': 'SIM-app-key' } })).json()) as { status: { quoWrites: string; holds: string } };
      expect(quo.status).toMatchObject({ quoWrites: 'read_only', holds: 'read_only' });
      const rec = (await (await realFetch(`${base}/api/calls/records`, { headers: { 'x-arbor-key': 'SIM-app-key' } })).json()) as { calendarHolds: string };
      expect(rec.calendarHolds).toBe(GOOGLE_HOLDS_OFF_LINE);
    } finally {
      srv.close();
    }
    expect(quoCalls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
});

describe('a missing webhook is named, never created; nothing is replaced or deleted', () => {
  it('none exist: all four named as missing, createWebhook never called, no throw — Arbo still reads Quo’s record', async () => {
    const api = fakeQuo();
    const r = await ensureQuoWebhooks(api, HOOK_URL);
    expect(api.createWebhook).not.toHaveBeenCalled();
    expect(api.deleteWebhook).not.toHaveBeenCalled();
    expect(r).toMatchObject({ readOnly: true, keys: [], created: [], reused: [], failed: [] });
    expect(r.missing).toEqual(['messages', 'calls', 'call-summaries', 'call-transcripts'].map((family) => ({ family, why: QUO_HOOK_MISSING_LINE })));
    const reg = registrationFrom(r);
    expect(reg.state).toBe('read_only');
    expect(reg.detail).toContain(QUO_HOOK_MISSING_LINE);
    expect(reg.detail).toContain('messages, calls, call-summaries, call-transcripts');
  });

  it('hooks that exist are used as they are — a listed key, a key read by id, an older partial hook — never replaced', async () => {
    const existing: QuoWebhook[] = [
      { id: 'MINE-TEXTS-OLD', url: HOOK_URL, events: ['message.received'], key: 'k-texts' }, // pre-R22: no message.delivered
      { id: 'MINE-CALLS', url: HOOK_URL, events: ['call.completed'] }, // key withheld on list
      { id: 'MINE-SUMMARIES', url: HOOK_URL, events: ['call.summary.completed'] }, // key withheld everywhere
      { id: 'ZAPIER', url: 'https://hooks.zapier.test/x', events: ['call.transcript.completed'], key: 'z' },
    ];
    const api = fakeQuo({ listWebhooks: async () => existing, getWebhook: async (id) => (id === 'MINE-CALLS' ? { id, url: HOOK_URL, events: ['call.completed'], key: 'k-calls' } : null) });
    const r = await ensureQuoWebhooks(api, HOOK_URL);
    expect(api.createWebhook).not.toHaveBeenCalled();
    expect(api.deleteWebhook).not.toHaveBeenCalled();
    expect(r.keys.sort()).toEqual(['k-calls', 'k-texts']);
    expect(r.reused).toEqual(['messages', 'calls']);
    expect(r.missing).toEqual([
      { family: 'call-summaries', why: QUO_HOOK_NO_KEY_LINE },
      { family: 'call-transcripts', why: QUO_HOOK_MISSING_LINE },
    ]);
    expect(r.keys).not.toContain('z');
    expect(registrationFrom(r).state).toBe('read_only');
  });

  it('every hook in place: plain "ok", and the line says read-only, none created', async () => {
    const events = { messages: ['message.received', 'message.delivered'], calls: ['call.completed'], 'call-summaries': ['call.summary.completed'], 'call-transcripts': ['call.transcript.completed'] };
    const existing = Object.entries(events).map(([f, ev]) => ({ id: `MINE-${f}`, url: HOOK_URL, events: ev, key: `k-${f}` }));
    const r = await ensureQuoWebhooks(fakeQuo({ listWebhooks: async () => existing }), HOOK_URL);
    expect(r.missing).toEqual([]);
    expect(registrationFrom(r)).toEqual({ state: 'ok', detail: 'Wired to Quo, read-only — 4 webhooks in place, none created.' });
  });

  it('the Quo client itself refuses to create or delete a webhook — nothing leaves', async () => {
    const methods: string[] = [];
    const api = createQuoApi('SIM-quo-key', async (_u, init) => { methods.push(init.method); return { ok: true, status: 200, json: async () => ({ data: { id: 'W', url: HOOK_URL, events: [], key: 'k' } }) }; });
    await expect(api.createWebhook('calls', HOOK_URL)).rejects.toMatchObject({ name: 'QuoReadOnlyError', write: 'webhook.create' });
    await expect(api.deleteWebhook('W')).rejects.toBeInstanceOf(QuoReadOnlyError);
    expect(methods).toEqual([]);
  });
});

describe('reads keep working while read-only', () => {
  it('Quo: numbers, conversations, calls, texts, transcripts and webhooks are read with GET', async () => {
    const methods: string[] = [];
    const api = createQuoApi('SIM-quo-key', async (url, init) => {
      methods.push(init.method);
      if (url.includes('/call-transcripts/')) return { ok: true, status: 200, json: async () => ({ data: { status: 'completed', dialogue: [{ identifier: CALLER, content: 'hi', userId: null }] } }) };
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'X1', number: LINE, direction: 'incoming', text: 'hi', participants: [CALLER], url: HOOK_URL, events: [] }] }) };
    });
    expect(await api.phoneNumbers()).toEqual([{ id: 'X1', number: LINE }]);
    expect(await api.listConversations({ phoneNumberId: 'PN1', updatedAfterIso: 'x' })).toHaveLength(1);
    expect(await api.listCalls({ phoneNumberId: 'PN1', participant: CALLER, createdAfterIso: 'x' })).toHaveLength(1);
    expect((await api.listMessages({ phoneNumberId: 'PN1', participant: CALLER, createdAfterIso: null }))[0]!.text).toBe('hi');
    expect((await api.getCallTranscript('AC1'))!.dialogue).toHaveLength(1);
    expect(await api.listWebhooks()).toHaveLength(1);
    expect(new Set(methods)).toEqual(new Set(['GET']));
  });

  it('Drive lead logs are still read', async () => {
    const reader = createDriveFolderReader(async () => 'SIM-token', 'SIM-folder', async (url) => ({
      ok: true, status: 200,
      json: async () => ({ files: [{ id: 'F1', name: 'SIM Lead Log', mimeType: 'application/vnd.google-apps.document', modifiedTime: null }] }),
      text: async () => (url.includes('/export') ? 'SIM notes' : ''),
    }));
    expect((await reader.recent(5))[0]!.text).toBe('SIM notes');
  });

  it('the webhook intake still takes a verified Quo delivery', async () => {
    const h = sonaIntake();
    expect(h.post({ type: 'message.received', data: { object: { id: 'SIM-M1', from: CALLER, direction: 'incoming', body: 'hello' } } }).status).toBe(200);
  });
});

// ═══ The switch ════════════════════════════════════════════════════════════
describe("only ARBO_QUO_SEND exactly 'live' turns Quo writes back on — Mike's word only", () => {
  it('every other value, or none, is read-only', async () => {
    for (const v of [undefined, '', 'LIVE', 'Live', 'true', '1', 'on', 'yes', ' live', 'live ', 'live\n', 'readonly']) {
      vi.stubEnv('ARBO_QUO_SEND', v);
      expect(quoWritesLive(), JSON.stringify(v)).toBe(false);
      const f = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ data: { id: 'AC-out' } }) }));
      expect((await createQuoSender('k', f).send({ from: LINE, to: CALLER, content: 'Art-is-Tree. Reply STOP to opt out.' })).ok).toBe(false);
      expect(f).not.toHaveBeenCalled();
    }
  });

  it("exactly 'live': the sender POSTs again, and a missing webhook is created as before", async () => {
    vi.stubEnv('ARBO_QUO_SEND', 'live');
    expect(quoWritesLive()).toBe(true);
    const f = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ data: { id: 'AC-out', status: 'queued', conversationId: null } }) }));
    expect((await createQuoSender('k', f).send({ from: LINE, to: CALLER, content: 'Art-is-Tree. Reply STOP to opt out.' })).ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    const create = vi.fn(async (family: string, url: string) => ({ id: `W-${family}`, url, events: [], key: `k-${family}` }));
    const r = await ensureQuoWebhooks(fakeQuo({ createWebhook: create as QuoApi['createWebhook'] }), HOOK_URL);
    expect(create).toHaveBeenCalledTimes(4);
    expect(r).toMatchObject({ readOnly: false, missing: [] });
  });

  it('the ruling names the switch, its exact value, and that only Mike sets it', () => {
    const rulings = readFileSync(new URL('../docs/OWNER_RULINGS.md', import.meta.url), 'utf8');
    const r33 = rulings.slice(rulings.indexOf('## R33 — Google and Quo connected read-only (Mike, 2026-10-20)'));
    expect(r33.length).toBeGreaterThan(100);
    expect(r33).toContain('"Connect Google as a read only and connect quo as read only"');
    expect(r33).toContain('`ARBO_QUO_SEND`');
    expect(r33).toContain('exactly `live`');
    expect(r33).toContain('Only Mike sets it');
    for (const paused of ['R18', 'R22', 'D36']) expect(r33).toContain(paused);
    const phone = readFileSync(new URL('../docs/PHONE_SETUP.md', import.meta.url), 'utf8');
    expect(phone).toContain('ARBO_QUO_SEND');
    expect(phone).toContain('always_ask');
    const golive = readFileSync(new URL('../docs/GO_LIVE.md', import.meta.url), 'utf8');
    expect(golive).toContain('See and download any calendar you can access using your Google Calendar');
  });
});

// ═══ The boot and the app ══════════════════════════════════════════════════
describe('the boot names both modes', () => {
  it('Google read-only, and Quo read-only or writes on — by the switch', () => {
    vi.stubEnv('ARBO_QUO_SEND', 'nope');
    const [g, q] = readOnlyBootLines();
    expect(g).toMatch(/^\[google\] READ-ONLY \(R33\)/);
    expect(q).toMatch(/^\[quo\] READ-ONLY \(R33\)/);
    vi.stubEnv('ARBO_QUO_SEND', 'live');
    expect(readOnlyBootLines()[1]).toMatch(/^\[quo\] WRITES ON/);
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(server).toContain('for (const line of readOnlyBootLines()) console.log(line);');
    expect(server).not.toContain('holds DISABLED — no Google token (R18 waits on the consent step)');
  });
});

describe('the app says it', () => {
  const html = loadAppHtml();
  const src = (name: string): string => {
    const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
    if (!m) throw new Error(`no function ${name} in the page`);
    return m[0];
  };
  const pageFn = <T,>(name: string, deps: Record<string, unknown>): T =>
    new Function(...Object.keys(deps), `${src(name)}\nreturn ${name};`)(...Object.values(deps)) as T;
  class FakeEl {
    className = ''; children: FakeEl[] = []; dataset: Record<string, string> = {}; attrs: Record<string, string> = {};
    disabled = false; href = ''; target = ''; rel = ''; onclick: null | (() => unknown) = null; style: Record<string, string> = {};
    private text = '';
    constructor(readonly tag: string) {}
    get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(' '); }
    set textContent(t: string) { this.text = t; this.children = []; }
    appendChild(n: FakeEl) { this.children.push(n); return n; }
    all(): FakeEl[] { return [this, ...this.children.flatMap((c) => c.all())]; }
  }
  const el = (tag: string, cls?: string, text?: string) => { const n = new FakeEl(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const deps = {
    el, chip: (t: string, tone: string) => el('span', 'badge ' + tone, t), feedLine: () => el('div', 'feed-state unread', 'x'),
    plural: (n: number, one: string, many?: string) => n + ' ' + (n === 1 ? one : many || one + 's'), fmtTime: () => '',
    renderCalls: () => {}, renderToday: () => {}, slipRuleLabel: (r: string) => r, openSonaCall: () => {},
    document: { createElement: (t: string) => el(t) },
    // M15 merge: the Sona panel words a registration through the page's own quoRegLine — the real one, lifted from the page.
    quoRegLine: (reg: unknown) => pageFn<(r: unknown) => string>('quoRegLine', { fmtTime: () => '' })(reg),
  };
  const outreachStatus = {
    wired: true, fromNumber: LINE, autoFollowUps: false, readOnly: true, template: { ok: true, text: 'Art-is-Tree. Reply STOP to opt out.', problems: [] },
    paused: null, deferredUntil: null, queued: 0, lastRunAt: 'x', candidates: { total: 2, eligible: 2, skipped: {} }, sent: 0,
  };

  it('the catch-up button is disabled with the read-only line, and a tap sends nothing', async () => {
    const posts: string[] = [];
    const api = async (path: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST') { posts.push(path); return {}; }
      return { status: outreachStatus, candidates: [], sends: [] };
    };
    const panel = await pageFn<(full: boolean) => Promise<FakeEl>>('outreachPanel', { ...deps, api })(true);
    // R33 review: the disabled button says the read-only line itself, never "Send catch-up to N now".
    const buttons = panel.all().filter((n) => n.tag === 'button' && n.className === 'actbtn');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe(QUO_READ_ONLY_LINE);
    expect(buttons[0]!.disabled).toBe(true);
    expect(buttons[0]!.onclick).toBeNull();
    expect(panel.textContent).toContain(QUO_READ_ONLY_LINE);
    expect(panel.textContent).not.toContain('OFF — not turned on yet');
    expect(posts).toEqual([]);
    // Off on purpose is not a failure and not "nothing to send": its own words and tone.
    expect(panel.all().some((n) => n.className.includes('storm') && n.className !== 'storm-muted' && n.textContent.includes(QUO_READ_ONLY_LINE))).toBe(false);
    expect(html).toContain(`'${QUO_READ_ONLY_LINE}'`);
  });

  it('with sends on (Mike’s word), the catch-up button works as before', async () => {
    const api = async () => ({ status: { ...outreachStatus, readOnly: false }, candidates: [], sends: [] });
    const panel = await pageFn<(full: boolean) => Promise<FakeEl>>('outreachPanel', { ...deps, api })(false);
    const go = panel.all().find((n) => n.tag === 'button' && /catch-up/i.test(n.textContent))!;
    expect(go.disabled).toBe(false);
    expect(typeof go.onclick).toBe('function');
    expect(panel.textContent).not.toContain(QUO_READ_ONLY_LINE);
  });

  it('a Sona call card says holds are off, with the time the caller asked for; the count says off, not zero', async () => {
    const status = {
      registration: { state: 'ok', detail: '' }, reading: true, callsWithSlips: 0, sonaCalls: 1, learnedFromRecord: 1, holdsAttempted: 0, holds: 'read_only',
      hangups: 0, quoRecord: { lastAt: 'x' }, notUsed: {},
    };
    const call = { callId: 'AC1', at: 'x', from: CALLER, handledBy: 'sona', slips: [], summary: [], dialogue: [], facts: { name: 'SIM-Dana', requestedTime: 'Wednesday after 4' }, hold: 'read_only' };
    const panel = await pageFn<(n: number, t: boolean) => Promise<FakeEl>>('sonaPanel', { ...deps, api: async () => ({ status, calls: [call] }) })(20, true);
    expect(panel.textContent).toContain(GOOGLE_HOLDS_OFF_LINE);
    expect(panel.textContent).toContain('Asked for: Wednesday after 4');
    expect(panel.textContent).toContain('calendar holds off (Google is read-only)');
    expect(panel.textContent).not.toContain('0 calendar holds filed');
  });

  it('a Quo hook Arbo won’t create is named in its own muted tone, not as a failure', async () => {
    const status = { registration: { state: 'read_only', detail: QUO_HOOK_MISSING_LINE }, reading: true, callsWithSlips: 0, sonaCalls: 0, holds: 'read_only', quoRecord: { lastAt: 'x' }, notUsed: {} };
    const panel = await pageFn<(n: number, t: boolean) => Promise<FakeEl>>('sonaPanel', { ...deps, api: async () => ({ status, calls: [] }) })(3, false);
    const line = panel.all().find((n) => n.textContent === QUO_HOOK_MISSING_LINE)!;
    expect(line.className).toBe('storm-muted');
    expect(panel.textContent).toContain('No Sona calls in the last 7 days');
  });

  it('Settings → Google shows READ-ONLY, lists the three read permissions, and the steps say what Google will show', () => {
    const settings = src('buildSettings');
    expect(settings).toContain("chip('READ-ONLY', t.stored ? 'good' : 'info')"); // green only once a sign-in is saved (R33 review)
    expect(settings).toContain('gs.permissions');
    expect(settings).toContain('Google’s screen will list exactly these three');
    expect(settings).toContain("chip(q.quoWrites === 'live' ? 'SENDS ON' : 'READ-ONLY'");
  });
});
