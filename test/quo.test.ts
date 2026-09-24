// Sona via Quo (Mike, 2026-09-24: "let sona handle it for a while while arbo
// learns from it" → "auto do it"). Pins: every delivery is verified; Arbo
// registers only its OWN webhooks and never sends; Sona's calls go through
// the same code guard as Arbo's voice; the calendar hold is filed Mike's
// way; hang-ups, unreadable calls, and calls Mike answered file nothing;
// no customer number or words reach the logs (§4.3); unwired is NAMED (§1B).
import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { verifyQuoSignature, QuoIntake } from '../src/ops/quoIntake.js';
import { createQuoApi, ensureQuoWebhooks, QuoHttpError, QuoTruncatedError, type QuoApi, type QuoWebhook } from '../src/integrations/quo.js';
import { CallMemory, CallRecordStore } from '../src/reception/callMemory.js';
import { loadAllConfig } from '../src/config/loadConfig.js';
import type { CallHold } from '../src/reception/estimateHold.js';
import type { SonaCallFacts } from '../src/ops/quoExtract.js';
import { createArborRequestHandler } from '../src/server.js';

const NOW = Date.parse('2026-09-24T15:00:00Z');
const KEY = Buffer.from('arbo-test-signing-key-32-bytes!!').toString('base64');
const QUO_NUMBER = '+17576069432';
const CALLER = '+17575550142';

function sign(body: string, key = KEY, ts = NOW): Record<string, string> {
  const sig = createHmac('sha256', Buffer.from(key, 'base64')).update(`${ts}.${body}`).digest('base64');
  return { 'openphone-signature': `hmac;1;${ts};${sig}` };
}

const FACTS: SonaCallFacts = {
  wantsEstimate: true,
  name: 'SIM-Dana',
  address: '4500 Simulated Ct',
  city: 'Virginia Beach',
  jobType: 'removal',
  treeDetails: 'big oak in the back yard',
  powerLines: 'no',
  emergency: false,
  requestedTime: 'Wednesday after 4',
  agentSlips: [],
  callerType: 'customer',
};

function harness(opts: { facts?: SonaCallFacts | Error; withHold?: boolean } = {}) {
  const holds: CallHold[] = [];
  const texts: unknown[] = [];
  const extract = vi.fn(async () => {
    if (opts.facts instanceof Error) throw opts.facts;
    return opts.facts ?? FACTS;
  });
  const memory = new CallMemory();
  const records = new CallRecordStore();
  const intake = new QuoIntake({
    guardrails: loadAllConfig().guardrails,
    extractor: { extract },
    callMemory: memory,
    callRecords: records,
    calendarHold: opts.withHold === false ? null : async (h) => { holds.push(h); },
    onText: (t) => texts.push(t),
    now: () => NOW,
  });
  intake.setRegistration('ok', 'test', [KEY], [QUO_NUMBER]);
  const post = (event: unknown) => {
    const body = JSON.stringify(event);
    return intake.handle(sign(body), body);
  };
  return { intake, holds, texts, extract, memory, records, post };
}

const transcript = (callId: string, lines: Array<[string, string, string?]>) => ({
  type: 'call.transcript.completed',
  data: { object: { object: 'callTranscript', callId, dialogue: lines.map(([identifier, content, userId]) => ({ identifier, content, ...(userId ? { userId } : {}) })) } },
});

describe('verifyQuoSignature', () => {
  it('accepts the OpenPhone-era signature and rejects tampering, staleness, and no keys', () => {
    const body = '{"type":"call.completed"}';
    expect(verifyQuoSignature([KEY], sign(body), body, NOW).ok).toBe(true);
    expect(verifyQuoSignature([KEY], sign(body), body.replace('completed', 'ringing'), NOW).ok).toBe(false);
    expect(verifyQuoSignature([KEY], sign(body), body, NOW + 6 * 60_000).reason).toBe('stale_timestamp');
    expect(verifyQuoSignature([], sign(body), body, NOW).reason).toBe('not_wired');
    expect(verifyQuoSignature([KEY], {}, body, NOW).reason).toBe('missing_headers');
  });

  it('accepts a signature over the compact payload, and any of several keys', () => {
    const pretty = '{ "type": "call.completed" }';
    const compact = JSON.stringify(JSON.parse(pretty));
    const other = Buffer.from('another-key-another-key-another!!').toString('base64');
    expect(verifyQuoSignature([other, KEY], sign(compact), pretty, NOW).ok).toBe(true);
  });
});

describe('Quo API client — registers only Arbo’s own webhooks, and cannot send', () => {
  function fakeApi(existing: QuoWebhook[]) {
    const deleted: string[] = [];
    const created: string[] = [];
    let n = 0;
    const api: QuoApi = {
      listPhoneNumbers: async () => [QUO_NUMBER],
      phoneNumbers: async () => [{ id: 'PN1', number: QUO_NUMBER }],
      listConversations: async () => [],
      listCalls: async () => [],
      listMessages: async () => [],
      getCallTranscript: async () => null,
      listWebhooks: async () => existing,
      getWebhook: async () => null,
      createWebhook: async (family, url) => { created.push(family); n += 1; return { id: `WH${n}`, url, events: [], key: `key${n}` }; },
      deleteWebhook: async (id) => { deleted.push(id); },
    };
    return { api, deleted, created };
  }

  it('creates all four on a fresh account', async () => {
    const f = fakeApi([]);
    const r = await ensureQuoWebhooks(f.api, 'https://arbo.test/webhooks/quo');
    expect(f.created).toEqual(['messages', 'calls', 'call-summaries', 'call-transcripts']);
    expect(r.keys).toHaveLength(4);
  });

  it('reuses its own hooks when the key is listed, and never deletes anyone else’s', async () => {
    const url = 'https://arbo.test/webhooks/quo';
    const f = fakeApi([
      { id: 'MINE', url, events: ['message.received', 'message.delivered'], key: 'k1' },
      { id: 'MINE_NOKEY', url, events: ['call.completed'] },
      { id: 'ZAPIER', url: 'https://hooks.zapier.test/x', events: ['call.completed', 'message.received'], key: 'z' },
    ]);
    const r = await ensureQuoWebhooks(f.api, url);
    expect(r.reused).toContain('messages');
    expect(f.deleted).toEqual(['MINE_NOKEY']);
    expect(f.deleted).not.toContain('ZAPIER');
    expect(r.keys).toContain('k1');
  });

  it('retires its OWN older hook that lacks a newly wanted event (pre-R22 texts hook), never anyone else’s', async () => {
    const url = 'https://arbo.test/webhooks/quo';
    const f = fakeApi([
      { id: 'OLD_TEXTS', url, events: ['message.received'], key: 'old' },
      { id: 'ZAPIER', url: 'https://hooks.zapier.test/x', events: ['message.received'], key: 'z' },
    ]);
    const r = await ensureQuoWebhooks(f.api, url);
    expect(f.deleted).toEqual(['OLD_TEXTS']);
    expect(f.created).toContain('messages');
    expect(r.keys).not.toContain('old');
  });

  it('a refused read carries Quo’s code; a message history past the page cap is refused, never a silent prefix', async () => {
    const refused = createQuoApi('k', async () => ({ ok: false, status: 400, json: async () => ({ code: '0206400', message: 'to +17575550142' }) }));
    const err = await refused.listMessages({ phoneNumberId: 'PN1', participant: '+17575550142', createdAfterIso: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuoHttpError);
    expect((err as QuoHttpError).code).toBe('0206400');
    expect((err as Error).message).not.toContain('5550142');
    const endless = createQuoApi('k', async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'M', direction: 'incoming', text: 'hi' }], nextPageToken: 'more' }) }));
    await expect(endless.listMessages({ phoneNumberId: 'PN1', participant: '+17575550142', createdAfterIso: 'x' })).rejects.toBeInstanceOf(QuoTruncatedError);
    // Calls are not a STOP source — they stay capped at five pages, as before.
    expect(await endless.listCalls({ phoneNumberId: 'PN1', participant: '+17575550142', createdAfterIso: 'x' })).toHaveLength(5);
  });

  it('one refused family does not take the others down, and is named', async () => {
    const f = fakeApi([]);
    const api: QuoApi = {
      ...f.api,
      createWebhook: async (family, url) => {
        if (family === 'call-transcripts') throw new Error('Quo POST /webhooks/call-transcripts -> 403');
        return f.api.createWebhook(family, url);
      },
    };
    const r = await ensureQuoWebhooks(api, 'https://arbo.test/webhooks/quo');
    expect(r.keys).toHaveLength(3);
    expect(r.failed).toEqual([{ family: 'call-transcripts', why: 'Quo POST /webhooks/call-transcripts -> 403' }]);
  });

  it('a key missing on create is fetched by id; none at all is a named failure', async () => {
    const f = fakeApi([]);
    const keyless: QuoApi = { ...f.api, createWebhook: async (fam, url) => ({ id: `W-${fam}`, url, events: [] }), getWebhook: async (id) => ({ id, url: 'u', events: [], key: `k-${id}` }) };
    expect((await ensureQuoWebhooks(keyless, 'u')).keys).toContain('k-W-messages');
    const hopeless: QuoApi = { ...keyless, getWebhook: async () => null };
    await expect(ensureQuoWebhooks(hopeless, 'u')).rejects.toThrow(/no webhook registered/);
  });

  it('sends the key raw in Authorization, to the documented base', async () => {
    const seen: Array<{ url: string; auth: string }> = [];
    const api = createQuoApi('QUO_TEST_KEY', async (url, init) => {
      seen.push({ url, auth: init.headers.Authorization! });
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    });
    await api.listWebhooks();
    // Quo's own spec names api.quo.com; the old host redirects, and a
    // redirect can turn a POST into a GET, so the documented host is used.
    expect(seen[0]).toEqual({ url: 'https://api.quo.com/v1/webhooks', auth: 'QUO_TEST_KEY' });
  });

  it('reads calls, messages and transcripts with the spec\u2019s required params, and pages by cursor', async () => {
    const seen: string[] = [];
    let page = 0;
    const api = createQuoApi('k', async (url) => {
      seen.push(url);
      if (url.includes('/conversations')) {
        page += 1;
        return { ok: true, status: 200, json: async () => ({ data: [{ id: `CN${page}`, participants: [page === 1 ? CALLER : 'Anonymous'], lastActivityAt: 'x' }], nextPageToken: page < 2 ? 'tok' : null }) };
      }
      if (url.includes('/call-transcripts/')) return { ok: true, status: 200, json: async () => ({ data: { status: 'completed', dialogue: [{ identifier: CALLER, content: 'hi', userId: null }, { content: '' }] } }) };
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'AC1', direction: 'incoming', status: 'completed', aiHandled: 'ai-agent', createdAt: 't', text: 'hello' }] }) };
    });
    const convs = await api.listConversations({ phoneNumberId: 'PN1', updatedAfterIso: '2026-09-17T00:00:00Z' });
    expect(convs.map((c) => c.participants)).toEqual([[CALLER], []]); // non-E.164 caller ids are dropped
    expect(seen[1]).toContain('pageToken=tok');
    const calls = await api.listCalls({ phoneNumberId: 'PN1', participant: CALLER, createdAfterIso: 't0' });
    expect(calls[0]).toMatchObject({ id: 'AC1', direction: 'incoming', aiHandled: 'ai-agent' });
    expect(seen.at(-1)).toContain(`participants=${encodeURIComponent(CALLER)}`);
    expect(seen.at(-1)).toContain('phoneNumberId=PN1');
    const msgs = await api.listMessages({ phoneNumberId: 'PN1', participant: CALLER, createdAfterIso: 't0' });
    expect(msgs[0]!.text).toBe('hello');
    expect(seen.at(-1)).toContain('createdAfter=t0');
    // The whole history (how STOP is read): no date filter at all.
    await api.listMessages({ phoneNumberId: 'PN1', participant: CALLER, createdAfterIso: null });
    expect(seen.at(-1)).not.toContain('createdAfter');
    expect(seen.at(-1)).toContain('maxResults=100');
    const tr = await api.getCallTranscript('AC1');
    expect(tr!.dialogue).toEqual([{ identifier: CALLER, content: 'hi', userId: null }]);
  });

  it('this client only ever POSTs or DELETEs webhooks — the one send path lives in quoSend.ts (R22)', () => {
    const src = readFileSync(new URL('../src/integrations/quo.ts', import.meta.url), 'utf8');
    for (const m of src.matchAll(/call\('(POST|DELETE|PUT|PATCH)',\s*`([^`]*)`/g)) {
      expect(m[2], m[0]).toMatch(/^\/webhooks/);
    }
    expect(src).not.toMatch(/call\('POST',\s*`\/messages/);
  });
});

describe('QuoIntake — Sona calls', () => {
  it('files the hold Mike’s way, keeps the record, remembers the caller, and catches a price slip', async () => {
    const h = harness();
    expect(h.post({ type: 'call.completed', data: { object: { id: 'AC1', from: CALLER, to: QUO_NUMBER, direction: 'incoming', status: 'completed' } } }).status).toBe(200);
    h.post(transcript('AC1', [
      [QUO_NUMBER, "Hi, you've reached Art-is-Tree."],
      [CALLER, 'I need a big oak taken down in the back yard, can someone come Wednesday after 4?'],
      [QUO_NUMBER, 'Sure, that usually runs about $800.'],
    ]));
    await h.intake.settled();
    const [call] = h.intake.list();
    expect(call!.handledBy).toBe('sona');
    expect(call!.slips.some((s) => s.rule === 'no-price')).toBe(true);
    expect(call!.hold).toBe('attempted');
    expect(h.holds).toHaveLength(1);
    expect(h.holds[0]!.summary).toBe('SIM-Dana - 7575550142');
    expect(h.holds[0]!.colorId).toBe('4');
    expect(h.holds[0]!.location).toBe('4500 Simulated Ct, Virginia Beach, VA');
    expect(h.holds[0]!.description).toMatch(/^Estimate - booked by Sona \(Quo\) on the call\. UNCONFIRMED/);
    expect(h.records.list()[0]!.intent).toBe('sona_call');
    expect(h.memory.recall(CALLER)!.name).toBe('SIM-Dana');
    expect(h.intake.status().callsWithSlips).toBe(1);
  });

  it('a caller who hung up files nothing and costs no model call', async () => {
    const h = harness();
    h.post(transcript('AC2', [[QUO_NUMBER, "Hi, you've reached Art-is-Tree. What can I do for you?"]]));
    await h.intake.settled();
    expect(h.intake.list()[0]!.hold).toBe('hangup');
    expect(h.extract).not.toHaveBeenCalled();
    expect(h.holds).toHaveLength(0);
  });

  it('a call Mike answered in Quo is kept as notes, never auto-filed', async () => {
    const h = harness();
    h.post(transcript('AC3', [[QUO_NUMBER, 'Art-is-Tree, this is Mike.', 'USmike'], [CALLER, 'Hey Mike, it is about the pine out front.']]));
    await h.intake.settled();
    const [c] = h.intake.list();
    expect(c!.handledBy).toBe('mike');
    expect(c!.dialogue).toHaveLength(2);
    expect(h.holds).toHaveLength(0);
  });

  it('an unreadable call files nothing and says so (§1B)', async () => {
    const h = harness({ facts: new Error('model down') });
    h.post(transcript('AC4', [[QUO_NUMBER, 'Hi there.'], [CALLER, 'I need a stump ground out please.']]));
    await h.intake.settled();
    expect(h.intake.list()[0]!.hold).toBe('extraction_unavailable');
    expect(h.holds).toHaveLength(0);
  });

  it('Opus-read slips (dates, credentials) are recorded alongside the code guard', async () => {
    const h = harness({ facts: { ...FACTS, agentSlips: ['We can definitely be there Tuesday at 9.'] } });
    h.post(transcript('AC5', [[QUO_NUMBER, 'Hi there.'], [CALLER, 'Can you come look at my maple tree?']]));
    await h.intake.settled();
    expect(h.intake.list()[0]!.slips).toEqual([{ rule: 'opus-read', said: 'We can definitely be there Tuesday at 9.' }]);
  });

  it('a retried transcript is processed once', async () => {
    const h = harness();
    const ev = transcript('AC6', [[QUO_NUMBER, 'Hi.'], [CALLER, 'I need two trees trimmed please.']]);
    h.post(ev);
    h.post(ev);
    await h.intake.settled();
    expect(h.extract).toHaveBeenCalledTimes(1);
    expect(h.holds).toHaveLength(1);
  });

  it('a delivery receipt for an outgoing text reaches onDelivery — and only outgoing', async () => {
    const got: Array<[string | null, string | null]> = [];
    const intake = new QuoIntake({
      guardrails: loadAllConfig().guardrails,
      extractor: { extract: async () => FACTS },
      callMemory: new CallMemory(),
      callRecords: new CallRecordStore(),
      calendarHold: null,
      onText: () => {},
      onDelivery: (id, status) => got.push([id, status]),
      now: () => NOW,
    });
    intake.setRegistration('ok', 'test', [KEY], [QUO_NUMBER]);
    const post = (event: unknown) => { const body = JSON.stringify(event); return intake.handle(sign(body), body); };
    post({ type: 'message.delivered', data: { object: { id: 'AC9', direction: 'outgoing', status: 'delivered' } } });
    post({ type: 'message.delivered', data: { object: { id: 'AC10', direction: 'incoming', status: 'delivered' } } });
    post({ type: 'message.delivered', data: { object: { id: 'AC11', status: 'delivered' } } }); // no direction: still ours
    await intake.settled();
    expect(got).toEqual([['AC9', 'delivered'], ['AC11', 'delivered']]);
  });

  it('a text to the Quo number reaches the Texts list with its photos', async () => {
    const h = harness();
    h.post({ type: 'message.received', data: { object: { id: 'AC7', from: CALLER, direction: 'incoming', body: 'photo of the oak', media: [{ url: 'https://files.quo.test/1.jpg', type: 'image/jpeg' }, { url: 'http://insecure.test/x' }] } } });
    await h.intake.settled();
    expect(h.texts).toEqual([{ at: expect.any(String), messageSid: 'AC7', from: CALLER, body: 'photo of the oak', media: [{ url: 'https://files.quo.test/1.jpg', contentType: 'image/jpeg' }] }]);
  });

  it('refuses bad signatures and logs no customer number or words (§4.3)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness();
    const body = JSON.stringify(transcript('AC8', [[QUO_NUMBER, 'Hi.'], [CALLER, 'secret words about my oak tree']]));
    expect(h.intake.handle({ 'openphone-signature': `hmac;1;${NOW};AAAA` }, body).status).toBe(401);
    h.intake.handle(sign(body), body);
    await h.intake.settled();
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('5550142');
    expect(logged).not.toContain('secret words');
    expect(logged).not.toContain('SIM-Dana');
    spy.mockRestore();
  });
});

describe('Quo HTTP surface and screens', () => {
  it('unwired: the webhook refuses by name and /api/quo says so', async () => {
    const srv = createServer(createArborRequestHandler());
    await new Promise<void>((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const hook = await fetch(`${base}/webhooks/quo`, { method: 'POST', body: '{}' });
    expect(hook.status).toBe(503);
    const q = (await (await fetch(`${base}/api/quo`)).json()) as { status: { registration: { state: string; detail: string } } };
    expect(q.status.registration.state).toBe('not_configured');
    expect(q.status.registration.detail).toContain('This is not zero calls');
    srv.close();
  });

  it('the Sona panel sits above the brief fetch and names rule slips', () => {
    const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
    const panel = html.indexOf('sonaPanel(3, false).then');
    expect(panel).toBeGreaterThan(-1);
    expect(panel).toBeLessThan(html.indexOf("api('/api/brief?from="));
    expect(html).toContain('SONA BROKE A RULE');
    expect(html).toContain('Arbo could not read this call');
  });
});
