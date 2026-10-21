// Quo photos, VIEW-ONLY (Mike, 2026-10-20: "Needs to be able to view photos
// on quo"). Pins: the browser never receives a Quo photo's address or the Quo
// key — only an opaque id Arbo minted from what it read itself; the photo
// route is owner-only and fetches only https on Quo's media host (no key sent,
// no redirect off the list, a size cap, a photo-type check, a deadline);
// nothing is logged but reasons, counts and a refused host; a photo that
// cannot load is NAMED on the page (§1B); practice mode shows the SIM
// placeholder, never a customer's photo. All data here is simulated.
import { describe, it, expect, vi, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { QuoMediaStore, QUO_MEDIA_HOSTS, quoMediaUrlAllowed, mediaKind, type MediaHttp } from '../src/integrations/quoMedia.js';
import { createQuoApi, type QuoApi, type QuoMessage } from '../src/integrations/quo.js';
import { QuoStudy, type StudyFacts } from '../src/ops/quoStudy.js';
import { QuoIntake } from '../src/ops/quoIntake.js';
import { WebhookIntake } from '../src/ops/webhooks.js';
import { CallMemory, CallRecordStore } from '../src/reception/callMemory.js';
import { loadAllConfig } from '../src/config/loadConfig.js';
import { loadAppHtml } from '../src/server/appPage.js';

const NOW = Date.parse('2026-10-20T15:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const CALLER = '+17575550142';
const SIG = 'SIMSIGNATURE0123';
const quoUrl = (key: string) => `https://share.quo.com/v1/resource/message-media/${key}?sig=${SIG}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const SIM_PNG = readFileSync(new URL('../src/app/sim-quo-photo.png', import.meta.url));

type Call = { url: string; init: Parameters<MediaHttp>[1] };
/** A fake Quo media host: answers per URL, records every call. */
function fakeHttp(answer: (url: string, init: Parameters<MediaHttp>[1]) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const http: MediaHttp = async (url, init) => {
    calls.push({ url, init });
    return answer(url, init);
  };
  return { http, calls };
}
const photo = (body: ConstructorParameters<typeof Response>[0] = JPEG, type = 'image/jpeg', extra: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': type, ...extra } });

function quietLogs() {
  const spies = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];
  return {
    text: () => spies.flatMap((s) => s.mock.calls.flat()).map(String).join('\n'),
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
describe('minting: an opaque id only for a photo on Quo’s own host', () => {
  it('a photo on share.quo.com gets a random id; the same text and slot keep it, another slot gets its own', () => {
    const logs = quietLogs();
    const store = new QuoMediaStore({ now: () => NOW });
    const a = store.mint('MSG1', 0, { url: quoUrl('K1'), contentType: 'image/jpeg' });
    expect(a).toEqual({ mediaId: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), contentType: 'image/jpeg', kind: 'photo' });
    expect(store.mint('MSG1', 0, { url: quoUrl('K1-fresh'), contentType: 'image/jpeg' }).mediaId).toBe(a.mediaId);
    const b = store.mint('MSG1', 1, { url: quoUrl('K2'), contentType: 'image/png' });
    expect(b.mediaId).not.toBe(a.mediaId);
    expect(JSON.stringify([a, b])).not.toContain('quo.com');
    logs.restore();
  });

  it('refuses every address that is not https on the exact listed host — named, never fetched', () => {
    const logs = quietLogs();
    expect([...QUO_MEDIA_HOSTS]).toEqual(['share.quo.com']);
    const store = new QuoMediaStore({ now: () => NOW });
    for (const url of [
      'http://share.quo.com/x?sig=1', 'https://share.quo.com:8443/x', 'https://user:pw@share.quo.com/x', 'https://share.quo.com.evil.test/x',
      'https://evil.test/share.quo.com/x', 'https://files.quo.test/1.jpg', 'javascript:alert(1)', 'not a url', null,
    ]) {
      expect(store.mint('M', 0, { url, contentType: 'image/jpeg' }), String(url)).toEqual({ mediaId: null, contentType: 'image/jpeg', kind: 'photo' });
    }
    expect(store.size()).toBe(0);
    expect(quoMediaUrlAllowed('https://SHARE.quo.com/x')).toBe(true); // hostnames are case-blind
    expect(quoMediaUrlAllowed('https://share.quo.com:443/x')).toBe(true); // the default port, spelled out
    logs.restore();
  });

  it('only photos are viewable: a video, a contact card, a PDF, an SVG and any other file are named, not minted', () => {
    const store = new QuoMediaStore({ now: () => NOW });
    const of = (t: string | null) => store.mint('M', 0, { url: quoUrl('K'), contentType: t });
    expect(of('video/mp4')).toEqual({ mediaId: null, contentType: 'video/mp4', kind: 'video' });
    expect(of('text/vcard')).toEqual({ mediaId: null, contentType: 'text/vcard', kind: 'contact' });
    expect(of('application/pdf')).toEqual({ mediaId: null, contentType: 'application/pdf', kind: 'pdf' });
    expect(of('audio/amr')).toMatchObject({ mediaId: null, kind: 'audio' });
    expect(of('image/svg+xml')).toEqual({ mediaId: null, contentType: 'image/svg+xml', kind: 'file' }); // SVG can carry script
    expect(of('IMAGE/JPEG; name=oak.jpg')).toMatchObject({ contentType: 'image/jpeg', kind: 'photo', mediaId: expect.any(String) });
    expect(of(null)).toMatchObject({ kind: 'photo', mediaId: expect.any(String) }); // untyped: tried, and the fetch checks
    expect(mediaKind('image/heic')).toBe('photo');
  });

  it('at most 10 per text; the store is capped and lets the oldest go; an id unseen for 8 days is let go', async () => {
    let now = NOW;
    const { http } = fakeHttp(() => photo());
    const store = new QuoMediaStore({ http, now: () => now });
    expect(store.refs('M', Array.from({ length: 14 }, (_, i) => ({ url: quoUrl(`K${i}`), contentType: 'image/jpeg' })))).toHaveLength(10);
    const first = store.mint('OLD', 0, { url: quoUrl('OLD'), contentType: 'image/jpeg' }).mediaId!;
    for (let i = 0; i < 3_000; i += 1) store.mint(`N${i}`, 0, { url: quoUrl(`N${i}`), contentType: 'image/jpeg' });
    expect(store.size()).toBe(3_000);
    expect(await store.load(first)).toEqual({ ok: false, status: 404, error: 'unknown_media' });
    const fresh = store.mint('FRESH', 0, { url: quoUrl('F'), contentType: 'image/jpeg' }).mediaId!;
    now += 8 * DAY + 1;
    expect(await store.load(fresh)).toEqual({ ok: false, status: 404, error: 'unknown_media' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('loading: Quo’s host only, no key, no redirect off the list, capped, typed, on a deadline', () => {
  it('an id Arbo never minted is unknown — nothing is fetched', async () => {
    const { http, calls } = fakeHttp(() => photo());
    const store = new QuoMediaStore({ http, now: () => NOW });
    expect(await store.load('AAAAAAAAAAAAAAAAAAAAAA')).toEqual({ ok: false, status: 404, error: 'unknown_media' });
    expect(calls).toHaveLength(0);
  });

  it('fetches the address it holds, with no Authorization header, no automatic redirects and a deadline — and the freshest address wins', async () => {
    const logs = quietLogs();
    const { http, calls } = fakeHttp(() => photo());
    const store = new QuoMediaStore({ http, now: () => NOW });
    const id = store.mint('MSG1', 0, { url: quoUrl('OLD'), contentType: 'image/jpeg' }).mediaId!;
    store.mint('MSG1', 0, { url: quoUrl('NEW'), contentType: 'image/jpeg' }); // the study's next read
    const out = await store.load(id);
    expect(out).toEqual({ ok: true, contentType: 'image/jpeg', bytes: JPEG });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(quoUrl('NEW'));
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.init.redirect).toBe('manual');
    expect(calls[0]!.init.signal).toBeInstanceOf(globalThis.AbortSignal);
    expect(Object.keys(calls[0]!.init.headers).map((k) => k.toLowerCase())).not.toContain('authorization');
    logs.restore();
  });

  it('a redirect to another host is refused without being followed; one on the list is followed; three are too many', async () => {
    const logs = quietLogs();
    const off = fakeHttp(() => new Response(null, { status: 302, headers: { location: 'https://evil.test/steal' } }));
    const s1 = new QuoMediaStore({ http: off.http, now: () => NOW });
    const id1 = s1.mint('M', 0, { url: quoUrl('K'), contentType: 'image/jpeg' }).mediaId!;
    expect(await s1.load(id1)).toEqual({ ok: false, status: 502, error: 'host_not_allowed' });
    expect(off.calls.map((c) => c.url)).toEqual([quoUrl('K')]); // evil.test was never asked

    const plain = fakeHttp(() => new Response(null, { status: 301, headers: { location: 'http://share.quo.com/x' } }));
    const s2 = new QuoMediaStore({ http: plain.http, now: () => NOW });
    expect(await s2.load(s2.mint('M', 0, { url: quoUrl('K'), contentType: null }).mediaId!)).toMatchObject({ ok: false, error: 'host_not_allowed' });
    expect(plain.calls).toHaveLength(1);

    const same = fakeHttp((url) => (url.includes('/moved') ? photo() : new Response(null, { status: 307, headers: { location: '/moved?sig=2' } })));
    const s3 = new QuoMediaStore({ http: same.http, now: () => NOW });
    expect(await s3.load(s3.mint('M', 0, { url: quoUrl('K'), contentType: 'image/jpeg' }).mediaId!)).toMatchObject({ ok: true });
    expect(same.calls.map((c) => c.url)).toEqual([quoUrl('K'), 'https://share.quo.com/moved?sig=2']);

    const loop = fakeHttp(() => new Response(null, { status: 302, headers: { location: '/again' } }));
    const s4 = new QuoMediaStore({ http: loop.http, now: () => NOW });
    expect(await s4.load(s4.mint('M', 0, { url: quoUrl('K'), contentType: 'image/jpeg' }).mediaId!)).toEqual({ ok: false, status: 502, error: 'too_many_redirects' });
    expect(loop.calls).toHaveLength(3);

    const nowhere = fakeHttp(() => new Response(null, { status: 302 }));
    const s5 = new QuoMediaStore({ http: nowhere.http, now: () => NOW });
    expect(await s5.load(s5.mint('M', 0, { url: quoUrl('K'), contentType: 'image/jpeg' }).mediaId!)).toMatchObject({ ok: false, error: 'bad_redirect' });
    logs.restore();
  });

  it('only a photo type passes — never HTML, never SVG, never an untyped answer', async () => {
    const logs = quietLogs();
    for (const [type, ok] of [['image/jpeg', true], ['image/png', true], ['image/webp', true], ['image/heic', true], ['image/jpg', true], ['text/html', false], ['image/svg+xml', false], ['application/octet-stream', false], ['', false]] as const) {
      const { http } = fakeHttp(() => new Response(JPEG, { status: 200, headers: type ? { 'content-type': type } : {} }));
      const store = new QuoMediaStore({ http, now: () => NOW });
      const out = await store.load(store.mint('M', 0, { url: quoUrl('K'), contentType: null }).mediaId!);
      expect(out.ok, type).toBe(ok);
      if (ok && out.ok) expect(out.contentType).toBe(type === 'image/jpg' ? 'image/jpeg' : type);
      if (!ok) expect(out).toMatchObject({ status: 502, error: 'not_a_photo' });
    }
    logs.restore();
  });

  it('the size cap holds whether or not Quo says the size up front', async () => {
    const logs = quietLogs();
    const declared = fakeHttp(() => photo(Buffer.alloc(10), 'image/jpeg', { 'content-length': '5000' }));
    const s1 = new QuoMediaStore({ http: declared.http, now: () => NOW, maxBytes: 1_000 });
    expect(await s1.load(s1.mint('M', 0, { url: quoUrl('K'), contentType: 'image/jpeg' }).mediaId!)).toEqual({ ok: false, status: 502, error: 'too_large' });
    let pulled = 0;
    const streamed = fakeHttp(() => photo(new globalThis.ReadableStream<Uint8Array>({
      pull(c) { pulled += 1; if (pulled > 20) c.close(); else c.enqueue(new Uint8Array(600)); },
    })));
    const s2 = new QuoMediaStore({ http: streamed.http, now: () => NOW, maxBytes: 1_000 });
    expect(await s2.load(s2.mint('M', 0, { url: quoUrl('K'), contentType: 'image/jpeg' }).mediaId!)).toEqual({ ok: false, status: 502, error: 'too_large' });
    expect(pulled).toBeLessThan(6); // stopped reading at the cap, not at the end
    const empty = fakeHttp(() => photo(new Uint8Array(0)));
    const s3 = new QuoMediaStore({ http: empty.http, now: () => NOW });
    expect(await s3.load(s3.mint('M', 0, { url: quoUrl('K'), contentType: 'image/jpeg' }).mediaId!)).toMatchObject({ ok: false, error: 'empty' });
    logs.restore();
  });

  it('Quo refusing (an expired signature), a dead network and a slow host are each named', async () => {
    const logs = quietLogs();
    const refused = fakeHttp(() => new Response('nope', { status: 403 }));
    const s1 = new QuoMediaStore({ http: refused.http, now: () => NOW });
    expect(await s1.load(s1.mint('M', 0, { url: quoUrl('K'), contentType: 'image/jpeg' }).mediaId!)).toEqual({ ok: false, status: 502, error: 'quo_refused' });
    const down = fakeHttp(() => { throw new TypeError('fetch failed'); });
    const s2 = new QuoMediaStore({ http: down.http, now: () => NOW });
    expect(await s2.load(s2.mint('M', 0, { url: quoUrl('K'), contentType: 'image/jpeg' }).mediaId!)).toEqual({ ok: false, status: 502, error: 'unreachable' });
    const slow = fakeHttp((_u, init) => new Promise<Response>((_r, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))));
    const s3 = new QuoMediaStore({ http: slow.http, now: () => NOW, deadlineMs: 30 });
    expect(await s3.load(s3.mint('M', 0, { url: quoUrl('K'), contentType: 'image/jpeg' }).mediaId!)).toEqual({ ok: false, status: 504, error: 'timeout' });
    logs.restore();
  });

  it('practice mode: the SIM placeholder from the repo, never fetched from anywhere', async () => {
    const { http, calls } = fakeHttp(() => photo());
    const store = new QuoMediaStore({ http, now: () => NOW });
    const ref = store.mintSim('oak-1');
    expect(ref).toEqual({ mediaId: expect.any(String), contentType: 'image/png', kind: 'photo' });
    expect(store.mintSim('oak-1').mediaId).toBe(ref.mediaId);
    expect(await store.load(ref.mediaId!)).toEqual({ ok: true, contentType: 'image/png', bytes: SIM_PNG });
    expect(calls).toHaveLength(0);
    expect(SIM_PNG.subarray(1, 4).toString()).toBe('PNG');
  });

  it('§4.3: no address, signature, id or number in any log line — a refused HOST is named so the real one can be learned', async () => {
    const logs = quietLogs();
    const ok = fakeHttp(() => photo());
    const store = new QuoMediaStore({ http: ok.http, now: () => NOW });
    const id = store.mint('MSG-SIM-7', 0, { url: quoUrl('PATHKEY77'), contentType: 'image/jpeg' }).mediaId!;
    await store.load(id);
    store.mint('MSG-SIM-8', 0, { url: `https://media.unlisted.test/PATHKEY88?sig=${SIG}&to=${encodeURIComponent(CALLER)}`, contentType: 'image/jpeg' });
    const bad = fakeHttp(() => new Response(null, { status: 302, headers: { location: `https://bucket.unlisted.test/PATHKEY99?sig=${SIG}` } }));
    const s2 = new QuoMediaStore({ http: bad.http, now: () => NOW });
    await s2.load(s2.mint('MSG-SIM-9', 0, { url: quoUrl('PATHKEY99'), contentType: 'image/jpeg' }).mediaId!);
    const text = logs.text();
    logs.restore();
    for (const secret of [SIG, 'PATHKEY', 'sig=', 'message-media', id, 'MSG-SIM', '5550142', 'https://']) expect(text, secret).not.toContain(secret);
    expect(text).toContain('media.unlisted.test');
    expect(text).toContain('bucket.unlisted.test');
    expect(text).toContain('first one shown since boot');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('where the ids come from: Quo’s own read and its signed webhook', () => {
  it('listMessages keeps each https attachment’s address and type, server side', async () => {
    const api = createQuoApi('k', async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'M1', direction: 'incoming', text: '', createdAt: 't', media: [{ url: quoUrl('A'), type: 'image/jpeg' }, { url: 'http://share.quo.com/x', type: 'image/png' }, null, { type: 'image/png' }] }] }) }));
    const [m] = await api.listMessages({ phoneNumberId: 'PN1', participant: CALLER, createdAfterIso: null });
    expect(m!.media).toEqual([{ url: quoUrl('A'), contentType: 'image/jpeg' }]);
  });

  const FACTS: StudyFacts = { customerName: 'SIM-Dana', wants: 'oak over the fence', stage: 'waiting_on_us', nextStep: null, toldThem: [], sourcesDisagree: null };
  const msg = (id: string, at: number, direction: 'incoming' | 'outgoing', text: string, media: QuoMessage['media'] = []): QuoMessage => ({ id, direction, text, status: 'delivered', createdAt: new Date(at).toISOString(), media });
  function studyWith(msgs: QuoMessage[], media: QuoMediaStore | null, read: (thread: string) => Promise<StudyFacts> = async () => FACTS) {
    const quo: QuoApi = {
      listPhoneNumbers: async () => [], phoneNumbers: async () => [],
      listConversations: async () => [{ id: 'CN1', phoneNumberId: 'PN1', participants: [CALLER], lastActivityAt: null, updatedAt: null }],
      listCalls: async () => [], listMessages: async () => msgs, getCallTranscript: async () => null,
      listWebhooks: async () => [], getWebhook: async () => null,
      createWebhook: async () => { throw new Error('never'); }, deleteWebhook: async () => { throw new Error('never'); },
    };
    return new QuoStudy({ quo, reader: { read }, drive: null, media, now: () => NOW, sleep: async () => {} });
  }

  it('the R24 study lists what the customer texted, newest first, as ids — and a re-read refreshes the address without a model call', async () => {
    const { http, calls } = fakeHttp(() => photo());
    const store = new QuoMediaStore({ http, now: () => NOW });
    const msgs = [
      msg('M1', NOW - 60_000, 'incoming', '', [{ url: quoUrl('A1'), contentType: 'image/jpeg' }, { url: quoUrl('A2'), contentType: 'video/mp4' }]),
      msg('M2', NOW - 30_000, 'incoming', 'SIM- and the stump', [{ url: quoUrl('B1'), contentType: 'image/png' }]),
      msg('M3', NOW - 10_000, 'outgoing', 'SIM- thanks', [{ url: quoUrl('OURS'), contentType: 'image/jpeg' }]),
    ];
    const study = studyWith(msgs, store);
    await study.run('PN1', 7 * DAY);
    const [n] = study.notes();
    expect(n!.media.map((m) => [m.kind, m.contentType, m.mediaId === null])).toEqual([['photo', 'image/png', false], ['photo', 'image/jpeg', false], ['video', 'video/mp4', true]]);
    expect(n!.mediaNotShown).toBe(0);
    const json = JSON.stringify(study.notes());
    for (const s of ['quo.com', 'sig=', '"url"', 'OURS']) expect(json, s).not.toContain(s);
    // Quo re-signs the address; the next pass (same messages: no model call) keeps the id and refreshes it.
    const before = n!.media[0]!.mediaId!;
    msgs[1] = { ...msgs[1]!, media: [{ url: quoUrl('B1-RESIGNED'), contentType: 'image/png' }] };
    expect(await study.run('PN1', 7 * DAY)).toEqual({ read: 0, unchanged: 1, failed: 0 });
    expect(study.notes()[0]!.media[0]!.mediaId).toBe(before);
    await store.load(before);
    expect(calls.at(-1)!.url).toBe(quoUrl('B1-RESIGNED'));
  });

  it('more than 12 are counted and named; with no id store every one is counted, never silently dropped', async () => {
    const many = Array.from({ length: 15 }, (_, i) => msg(`M${i}`, NOW - i * 1000, 'incoming', '', [{ url: quoUrl(`K${i}`), contentType: 'image/jpeg' }]));
    const s1 = studyWith(many, new QuoMediaStore({ now: () => NOW }));
    await s1.run('PN1', 7 * DAY);
    expect(s1.notes()[0]).toMatchObject({ mediaNotShown: 3 });
    expect(s1.notes()[0]!.media).toHaveLength(12);
    const s2 = studyWith(many.slice(0, 2), null);
    await s2.run('PN1', 7 * DAY);
    expect(s2.notes()[0]).toMatchObject({ media: [], mediaNotShown: 2 });
  });

  it('the study mints ids only for the photos a card shows — one customer’s flood never pushes another customer’s photo out', async () => {
    const logs = quietLogs();
    const { http, calls } = fakeHttp(() => photo());
    const store = new QuoMediaStore({ http, now: () => NOW });
    // Customer A's photo, minted the way the signed webhook mints it.
    const earlier = store.mint('MSGW-A', 0, { url: quoUrl('A'), contentType: 'image/jpeg' }).mediaId!;
    // One thread past the store's cap: 350 texts × 10 photos = 3,500.
    const flood = Array.from({ length: 350 }, (_, i) => msg(`F${i}`, NOW - (i + 1) * 1000, 'incoming', '', Array.from({ length: 10 }, (_, j) => ({ url: quoUrl(`F${i}-${j}`), contentType: 'image/jpeg' }))));
    const study = studyWith(flood, store);
    try {
      await study.run('PN1', 7 * DAY);
      const [n] = study.notes();
      expect(n!.media).toHaveLength(12);
      expect(n!.mediaNotShown).toBe(3_488); // counted and named, never minted
      expect(store.size()).toBeLessThanOrEqual(13);
      // The shown twelve are the newest, in order: F0's ten, then F1's first two.
      await store.load(n!.media[11]!.mediaId!);
      expect(calls.at(-1)!.url).toBe(quoUrl('F1-1'));
      // A second pass (nothing new: no model call) refreshes the same twelve and mints nothing more.
      expect(await study.run('PN1', 7 * DAY)).toEqual({ read: 0, unchanged: 1, failed: 0 });
      expect(store.size()).toBeLessThanOrEqual(13);
      expect(await store.load(earlier)).toMatchObject({ ok: true });
      expect(calls.at(-1)!.url).toBe(quoUrl('A'));
    } finally { logs.restore(); }
  });

  it('a new photo reaches the card even when the model re-read fails — photos need no model', async () => {
    const store = new QuoMediaStore({ now: () => NOW });
    const msgs = [msg('M1', NOW - 60_000, 'incoming', 'SIM- the oak by the fence', [{ url: quoUrl('P1'), contentType: 'image/jpeg' }])];
    let down = false;
    const study = studyWith(msgs, store, async () => { if (down) throw new Error('model overloaded'); return FACTS; });
    expect(await study.run('PN1', 7 * DAY)).toEqual({ read: 1, unchanged: 0, failed: 0 });
    expect(study.notes()[0]!.media).toHaveLength(1);
    // The customer texts a second photo; the thread changed, so the model re-reads — and fails.
    msgs.push(msg('M2', NOW - 10_000, 'incoming', '', [{ url: quoUrl('P2'), contentType: 'image/png' }]));
    down = true;
    expect(await study.run('PN1', 7 * DAY)).toEqual({ read: 0, unchanged: 0, failed: 1 });
    const [n] = study.notes();
    expect(n!.media.map((m) => m.contentType)).toEqual(['image/png', 'image/jpeg']); // the new one first
    expect(n!.media.every((m) => m.mediaId)).toBe(true);
    expect(study.status().failed).toBe(1); // the failed read is still named for the panel
    // The words on the card stay from the last good read until the next one lands.
    down = false;
    expect(await study.run('PN1', 7 * DAY)).toEqual({ read: 1, unchanged: 0, failed: 0 });
    expect(study.notes()[0]!.media).toHaveLength(2);
  });

  it('a signed Quo text reaches the Texts list with ids, never an address — wired exactly as the server wires it', async () => {
    const KEY = Buffer.from('arbo-test-signing-key-32-bytes!!').toString('base64');
    const store = new QuoMediaStore({ now: () => NOW });
    const webhooks = new WebhookIntake({ now: () => NOW });
    const intake = new QuoIntake({
      guardrails: loadAllConfig().guardrails, extractor: null, callMemory: new CallMemory(), callRecords: new CallRecordStore(), calendarHold: null,
      onText: (t) => webhooks.addQuoText({ ...t, media: store.refs(t.messageSid, t.media) }),
      now: () => NOW,
    });
    intake.setRegistration('ok', 'test', [KEY], []);
    const body = JSON.stringify({ type: 'message.received', data: { object: { id: 'MSGW1', from: CALLER, direction: 'incoming', body: 'SIM- the oak', media: [{ url: quoUrl('W1'), type: 'image/jpeg' }, { url: quoUrl('W2'), type: 'text/vcard' }] } } });
    const sig = createHmac('sha256', Buffer.from(KEY, 'base64')).update(`${NOW}.${body}`).digest('base64');
    expect(intake.handle({ 'openphone-signature': `hmac;1;${NOW};${sig}` }, body).status).toBe(200);
    await intake.settled();
    const [t] = webhooks.texts();
    expect(t!.media).toEqual([{ mediaId: expect.any(String), contentType: 'image/jpeg', kind: 'photo' }, { mediaId: null, contentType: 'text/vcard', kind: 'contact' }]);
    expect(JSON.stringify(webhooks.texts())).not.toMatch(/quo\.com|sig=|"url"/);
    // The server wires the intake and the study to the same store, this way.
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(server).toContain('webhooks.addQuoText({ ...t, media: quoMedia.refs(t.messageSid, t.media) });');
    expect(server).toContain('media: quoMedia,');
    // The study holds no fetcher of its own and still reads only (R24 pins in quoStudy.test.ts).
    expect(readFileSync(new URL('../src/ops/quoStudy.ts', import.meta.url), 'utf8')).not.toMatch(/fetch\(|createWebhook|deleteWebhook|quoSend|sender|\.send\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The route over the wire.
const saved = { ...process.env };
afterAll(() => { process.env = { ...saved }; vi.resetModules(); });
async function serve(envOverrides: Record<string, string | undefined>, quoMedia: QuoMediaStore): Promise<{ base: string; srv: Server }> {
  vi.resetModules();
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { createArborRequestHandler } = await import('../src/server.js');
  const srv = createServer(createArborRequestHandler({ quoMedia }));
  await new Promise<void>((r) => srv.listen(0, r));
  const addr = srv.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, srv };
}
const get = (base: string, p: string, h: Record<string, string> = {}) => fetch(base + p, { headers: h });

describe('GET /api/quo/media/<id> — owner only, an id Arbo minted, the bytes and nothing kept', () => {
  it('the owner key gets the photo with no-store and a locked-down type; crew key, no key, a wrong key and the crew preview do not', async () => {
    const logs = quietLogs();
    const { http } = fakeHttp(() => photo());
    const store = new QuoMediaStore({ http, now: () => Date.now() });
    const id = store.mint('MSG1', 0, { url: quoUrl('K'), contentType: 'image/jpeg' }).mediaId!;
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', ARBO_DATA_LINKS: 'sim' }, store);
    try {
      const r = await get(base, `/api/quo/media/${id}`, { 'x-arbor-key': 'admin-k' });
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('image/jpeg');
      expect(r.headers.get('cache-control')).toBe('private, no-store');
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
      expect(Buffer.from(await r.arrayBuffer())).toEqual(JPEG);
      for (const h of [{ 'x-arbor-key': 'crew-k' }, {}, { 'x-arbor-key': 'wrong' }] as Array<Record<string, string>>) {
        const no = await get(base, `/api/quo/media/${id}`, h);
        expect(no.status, JSON.stringify(h)).toBe(401);
        expect(no.headers.get('content-type')).toBe('application/json');
      }
      const preview = await get(base, `/api/quo/media/${id}`, { 'x-arbor-key': 'admin-k', 'x-arbo-preview': '1' });
      expect(preview.status).toBe(403);
      expect(await preview.json()).toEqual({ error: 'preview_refused' });
      const unknown = await get(base, '/api/quo/media/AAAAAAAAAAAAAAAAAAAAAA', { 'x-arbor-key': 'admin-k' });
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({ error: 'unknown_media' });
      expect((await get(base, '/api/quo/media/..%2F..%2Fetc', { 'x-arbor-key': 'admin-k' })).status).toBe(404);
      expect((await get(base, '/api/crew/quo/media/' + id, { 'x-arbor-key': 'crew-k' })).status).toBe(404); // no crew twin
    } finally { srv.close(); logs.restore(); }
  });

  it('a photo Quo will not hand over is a named refusal, never an empty 200', async () => {
    const logs = quietLogs();
    const { http } = fakeHttp(() => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const store = new QuoMediaStore({ http, now: () => Date.now() });
    const id = store.mint('MSG1', 0, { url: quoUrl('K'), contentType: 'image/jpeg' }).mediaId!;
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', ARBO_DATA_LINKS: 'sim' }, store);
    try {
      const r = await get(base, `/api/quo/media/${id}`, { 'x-arbor-key': 'admin-k' });
      expect(r.status).toBe(502);
      expect(await r.json()).toEqual({ error: 'not_a_photo' });
    } finally { srv.close(); logs.restore(); }
  });

  it('with no APP_ACCESS_KEY the door stays locked — even while the database is cut (and, since audit M1, so is the rest of /api)', async () => {
    const logs = quietLogs();
    const store = new QuoMediaStore({ now: () => Date.now() });
    const id = store.mintSim('oak-1').mediaId!;
    const { base, srv } = await serve({ APP_ACCESS_KEY: undefined, CREW_ACCESS_KEY: undefined, ARBO_DATA_LINKS: undefined }, store);
    try {
      const r = await get(base, `/api/quo/media/${id}`);
      expect(r.status).toBe(401);
      expect(await r.json()).toMatchObject({ error: 'no_app_key' });
    } finally { srv.close(); logs.restore(); }
  });

  it('with no APP_ACCESS_KEY the Texts list is locked too — customer numbers and words held in memory never open because the database is cut', async () => {
    const logs = quietLogs();
    const store = new QuoMediaStore({ now: () => Date.now() });
    const { base, srv } = await serve({ APP_ACCESS_KEY: undefined, CREW_ACCESS_KEY: undefined, ARBO_DATA_LINKS: undefined, TWILIO_SMS_WEBHOOK_KEY: 'tw-k', ARBO_LINK_TWILIO: 'live' }, store);
    try {
      // Audit M1: with no APP_ACCESS_KEY the business-cell relay is locked too — every /api route is.
      const relay = await fetch(`${base}/api/relay/text`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: CALLER, text: 'SIM- private words' }) });
      expect(relay.status).toBe(401);
      expect(await relay.json()).toMatchObject({ error: 'no_app_key' });
      // A text still lands in memory through the Twilio webhook's own door (its own secret, outside /api).
      const hook = await fetch(`${base}/webhooks/twilio/sms?key=tw-k`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ MessageSid: 'SMSIM1', From: CALLER, Body: 'SIM- private words', NumMedia: '0' }).toString() });
      expect(hook.status).toBe(200);
      const r = await get(base, '/api/webhooks/texts');
      expect(r.status).toBe(401);
      const raw = await r.text();
      expect(JSON.parse(raw)).toMatchObject({ error: 'no_app_key' });
      expect(raw).not.toContain('5550142');
      expect(raw).not.toContain('private words');
    } finally { srv.close(); logs.restore(); }
  });

  it('practice mode: one SIM text whose photo is the repo placeholder; the JSON carries ids, never an address', async () => {
    const logs = quietLogs();
    const store = new QuoMediaStore({ now: () => Date.now() });
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', ARBO_DATA_LINKS: 'sim' }, store);
    try {
      const r = await get(base, '/api/webhooks/texts', { 'x-arbor-key': 'admin-k' });
      const raw = await r.text();
      expect(raw).not.toMatch(/https?:\/\/|"url"/);
      const body = JSON.parse(raw) as { texts: Array<{ practice?: boolean; from: string; body: string; media: Array<{ mediaId: string | null; kind: string; contentType: string | null }> }> };
      const sim = body.texts.find((t) => t.practice);
      expect(sim).toMatchObject({ from: '+17575550142', body: expect.stringMatching(/^SIM- /) });
      expect(sim!.media).toEqual([{ mediaId: expect.any(String), contentType: 'image/png', kind: 'photo' }, { mediaId: null, contentType: 'video/mp4', kind: 'video' }]);
      const img = await get(base, `/api/quo/media/${sim!.media[0]!.mediaId}`, { 'x-arbor-key': 'admin-k' });
      expect(img.status).toBe(200);
      expect(img.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await img.arrayBuffer())).toEqual(SIM_PNG);
    } finally { srv.close(); logs.restore(); }
    const live = await serve({ APP_ACCESS_KEY: 'admin-k', ARBO_DATA_LINKS: undefined }, new QuoMediaStore());
    try {
      const body = (await (await get(live.base, '/api/webhooks/texts', { 'x-arbor-key': 'admin-k' })).json()) as { texts: unknown[] };
      expect(body.texts).toEqual([]); // outside practice mode, no SIM text is ever mixed in
    } finally { live.srv.close(); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE PAGE — the photo functions lifted out of index.html, run on a fake DOM.
const html = loadAppHtml();
function fnSrc(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
function pageFn<T>(name: string, deps: Record<string, unknown> = {}): T {
  return new Function(...Object.keys(deps), `${fnSrc(name)}\nreturn ${name};`)(...Object.values(deps)) as T;
}
function pageConst<T>(name: string): T {
  const m = new RegExp(`^const ${name} = ([\\s\\S]*?);$`, 'm').exec(html);
  if (!m) throw new Error(`no const ${name} in the page`);
  return new Function(`return ${m[1]}`)() as T;
}
class N {
  className = '';
  textContent = '';
  hidden = false;
  type = '';
  src = '';
  alt = '';
  children: N[] = [];
  attrs: Record<string, string> = {};
  handlers: Record<string, Array<() => unknown>> = {};
  constructor(readonly tag: string) {}
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  appendChild(n: N): N { this.children.push(n); return n; }
  replaceChildren(...ns: N[]): void { this.children = [...ns]; }
  addEventListener(t: string, f: () => unknown): void { (this.handlers[t] ??= []).push(f); }
  fire(t: string): void { for (const f of this.handlers[t] ?? []) f(); }
  all(): N[] { return [this, ...this.children.flatMap((c) => c.all())]; }
  find(cls: string): N[] { return this.all().filter((n) => n.className.split(' ').includes(cls)); }
  lines(): string[] { return this.children.filter((c) => c.tag === 'div' && c.textContent).map((c) => `${c.className} | ${c.textContent}`); }
}
const el = (tag: string, cls?: string, text?: string): N => {
  const n = new N(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const PHOTO_FAILED = pageConst<string>('PHOTO_FAILED');
const MEDIA_WORD = pageConst<Record<string, string>>('MEDIA_WORD');
const mediaLine = pageFn<(m: unknown, line: string) => [string, string]>('mediaLine', { MEDIA_WORD, PHOTO_FAILED });
const flush = () => new Promise((r) => setTimeout(r, 0));

function strip(load: (id: string) => Promise<string>) {
  const opened: Array<[string, string]> = [];
  const photoThumb = pageFn<(...a: unknown[]) => N>('photoThumb', {
    el, PHOTO_FAILED, fmtTime: (at: string) => (at ? 'Oct 20' : ''), openPhoto: (id: string, cap: string) => opened.push([id, cap]),
    photoWhenNear: (_n: N, go: () => void) => go(), photoLoad: load, PHOTOS: new Map(),
  });
  const photoStrip = pageFn<(media: unknown[], line: string, who: string, at?: string) => N>('photoStrip', { el, photoThumb, mediaLine });
  return { photoStrip, opened };
}

describe('the page: a thumbnail per photo, a named line for everything else', () => {
  it('the failure words are Mike’s ask, and every non-photo names its type', () => {
    expect(PHOTO_FAILED).toBe('Photo from Quo — couldn’t load it, open Quo to see it.');
    expect(mediaLine({ kind: 'video', contentType: 'video/mp4', mediaId: null }, 'quo')).toEqual(['Video (video/mp4) from Quo — Arbo shows photos only; open Quo to see it.', 'storm-muted']);
    expect(mediaLine({ kind: 'photo', contentType: 'image/jpeg', mediaId: null }, 'quo')).toEqual([PHOTO_FAILED, 'feed-state unread']);
    expect(mediaLine({ kind: 'photo', contentType: 'image/jpeg', mediaId: null }, 'arbo')).toEqual(['Photo (image/jpeg) sent to the Arbo line — Arbo can’t show it here.', 'storm-muted']);
    expect(mediaLine({ kind: 'file', contentType: null, mediaId: null }, 'quo')[0]).toBe('File from Quo — Arbo shows photos only; open Quo to see it.');
  });

  it('two photos are two thumbnails; a photo with no id, a video and a PDF are each a named line', async () => {
    const { photoStrip, opened } = strip(async (id) => `blob:${id}`);
    const box = photoStrip([
      { mediaId: 'ID1', contentType: 'image/jpeg', kind: 'photo' },
      { mediaId: 'ID2', contentType: 'image/png', kind: 'photo' },
      { mediaId: null, contentType: 'image/jpeg', kind: 'photo' },
      { mediaId: null, contentType: 'video/mp4', kind: 'video' },
      { mediaId: null, contentType: 'application/pdf', kind: 'pdf' },
    ], 'quo', 'SIM-Dana', '2026-10-20T14:00:00Z');
    await flush();
    const thumbs = box.find('qphoto');
    expect(thumbs).toHaveLength(2);
    expect(thumbs.map((t) => t.attrs['aria-label'])).toEqual(['Photo 1 — tap to see it full screen', 'Photo 2 — tap to see it full screen']);
    expect(thumbs.map((t) => t.children[0]!.tag + ':' + t.children[0]!.src)).toEqual(['img:blob:ID1', 'img:blob:ID2']);
    expect(box.lines()).toEqual([
      `feed-state unread | ${PHOTO_FAILED}`,
      'storm-muted | Video (video/mp4) from Quo — Arbo shows photos only; open Quo to see it.',
      'storm-muted | PDF (application/pdf) from Quo — Arbo shows photos only; open Quo to see it.',
    ]);
    thumbs[1]!.fire('click');
    expect(opened).toEqual([['ID2', 'SIM-Dana · Oct 20']]);
  });

  it('a photo that will not load leaves its square and says so in words, once — a fetch failure and a bad picture alike', async () => {
    const { photoStrip } = strip(async (id) => { if (id === 'BAD') throw new Error('photo 502'); return `blob:${id}`; });
    const box = photoStrip([{ mediaId: 'BAD', contentType: 'image/jpeg', kind: 'photo' }, { mediaId: 'UNDECODABLE', contentType: 'image/heic', kind: 'photo' }], 'quo', 'SIM-Dana');
    await flush();
    const [bad, heic] = box.find('qphoto');
    expect(bad!.hidden).toBe(true);
    heic!.children[0]!.fire('error'); // the browser could not draw it
    heic!.children[0]!.fire('error');
    expect(heic!.hidden).toBe(true);
    expect(box.lines()).toEqual([`feed-state unread | ${PHOTO_FAILED}`, `feed-state unread | ${PHOTO_FAILED}`]);
  });

  it('the Arbo line (cut, R21) shows no thumbnail — it names each attachment', async () => {
    const { photoStrip } = strip(async () => { throw new Error('never asked'); });
    const box = photoStrip([{ mediaId: null, contentType: 'image/jpeg', kind: 'photo' }], 'arbo', '+17575550199');
    expect(box.find('qphoto')).toHaveLength(0);
    expect(box.lines()).toEqual(['storm-muted | Photo (image/jpeg) sent to the Arbo line — Arbo can’t show it here.']);
  });

  it('photoLoad: the key rides the header, never the address; one fetch per photo; held in memory and let go past the cap', async () => {
    let now = 1_000_000;
    const fetches: Array<[string, unknown]> = [];
    const revoked: string[] = [];
    let n = 0;
    const PHOTOS = new Map();
    const load = pageFn<(id: string) => Promise<string>>('photoLoad', {
      PHOTOS, PHOTO_KEEP: 2, KEY: 'admin-k', Date: { now: () => now }, setTimeout: () => 0,
      URL: { createObjectURL: () => `blob:${(n += 1)}`, revokeObjectURL: (u: string) => revoked.push(u) },
      fetch: async (url: string, init: unknown) => {
        fetches.push([url, init]);
        if (url.endsWith('/BAD')) return { ok: false, status: 502 };
        if (url.endsWith('/HTML')) return { ok: true, blob: async () => ({ type: 'text/html' }) };
        return { ok: true, blob: async () => ({ type: 'image/jpeg' }) };
      },
    });
    expect(await load('A')).toBe('blob:1');
    expect(await load('A')).toBe('blob:1'); // cached: the minute redraw does not fetch again
    expect(fetches).toEqual([['/api/quo/media/A', { headers: { 'x-arbor-key': 'admin-k' } }]]);
    await expect(load('HTML')).rejects.toThrow('not a photo');
    await expect(load('BAD')).rejects.toThrow('photo 502');
    await expect(load('BAD')).rejects.toThrow(); // within two minutes: not asked again
    expect(fetches.filter(([u]) => u.endsWith('/BAD'))).toHaveLength(1);
    now += 121_000;
    await expect(load('BAD')).rejects.toThrow();
    expect(fetches.filter(([u]) => u.endsWith('/BAD'))).toHaveLength(2); // tried again after two minutes
    await load('C');
    expect(PHOTOS.size).toBe(2);
    expect(revoked).toEqual(['blob:1']); // the oldest let go, its memory handed back
    const body = fnSrc('photoLoad');
    expect(body).not.toMatch(/key=|\?k=/);
  });

  it('the viewer opens as a sheet, shows the photo, names a failure, and lets the picture go on close', async () => {
    const nodes = new Map<string, N & { classList: { add(c: string): void; contains(c: string): boolean } }>();
    const $ = (id: string) => {
      if (!nodes.has(id)) {
        const n = Object.assign(el('div'), { shown: false, removed: [] as string[] });
        const node = Object.assign(n, {
          classList: { add: (c: string) => { if (c === 'show') n.shown = true; }, contains: (c: string) => c === 'show' && n.shown },
          removeAttribute: (k: string) => { if (k === 'src') n.src = ''; },
        });
        nodes.set(id, node);
      }
      return nodes.get(id)!;
    };
    const steps: string[] = [];
    let answer: (id: string) => Promise<string> = async (id) => `blob:${id}`;
    const fns = new Function('$', 'sheetOpened', 'photoLoad', 'PHOTO_FAILED',
      `let PHOTO_OPEN = null;\n${fnSrc('openPhoto')}\n${fnSrc('photoViewFailed')}\n${fnSrc('photoLetGo')}\nreturn { openPhoto, photoLetGo, open: () => PHOTO_OPEN };`,
    )($, (id: string) => steps.push('step:' + id), (id: string) => answer(id), PHOTO_FAILED) as { openPhoto(id: string, cap: string): void; photoLetGo(): void; open(): string | null };
    fns.openPhoto('ID1', 'SIM-Dana · Oct 20');
    expect(steps).toEqual(['step:photo']);
    expect($('photo').classList.contains('show')).toBe(true);
    expect($('photo-cap').textContent).toBe('SIM-Dana · Oct 20');
    await flush();
    expect($('photo-img').src).toBe('blob:ID1');
    expect($('photo-img').hidden).toBe(false);
    expect($('photo-state').hidden).toBe(true);
    fns.photoLetGo();
    expect($('photo-img').src).toBe('');
    expect(fns.open()).toBeNull();
    answer = async () => { throw new Error('photo 502'); };
    fns.openPhoto('ID2', 'SIM-Dana');
    await flush();
    expect($('photo-state').textContent).toBe(PHOTO_FAILED);
    expect($('photo-state').className).toBe('feed-state unread');
    expect($('photo-img').hidden).toBe(true);
    // A slow failure from a photo closed since never lands on the one open now.
    let failA: (e: Error) => void = () => {};
    let passB: (u: string) => void = () => {};
    answer = (id) => new Promise<string>((ok, no) => { if (id === 'A') failA = no; else passB = ok; });
    fns.openPhoto('A', 'SIM-Dana');
    fns.photoLetGo();
    fns.openPhoto('B', 'SIM-Dana');
    failA(new Error('photo 502'));
    await flush();
    expect($('photo-state').textContent).toBe('Loading the photo…');
    passB('blob:B');
    await flush();
    expect($('photo-img').src).toBe('blob:B');
    expect($('photo-state').hidden).toBe(true);
  });

  it('a photo already in memory is drawn at once — the minute redraw does not wait for the screen to scroll', async () => {
    const waited: string[] = [];
    const PHOTOS = new Map([['HELD', { p: Promise.resolve('blob:HELD'), url: 'blob:HELD', failedAt: 0 }]]);
    const photoThumb = pageFn<(...a: unknown[]) => N>('photoThumb', {
      el, PHOTO_FAILED, fmtTime: () => '', openPhoto: () => {}, PHOTOS,
      photoWhenNear: (n: N) => waited.push(n.attrs['aria-label']!), photoLoad: (id: string) => PHOTOS.get(id)?.p ?? Promise.resolve('blob:new'),
    });
    const held = photoThumb({ mediaId: 'HELD', kind: 'photo' }, el('div'), 1, 'SIM-Dana', '');
    photoThumb({ mediaId: 'NEW', kind: 'photo' }, el('div'), 2, 'SIM-Dana', '');
    await flush();
    expect(held.children[0]!.src).toBe('blob:HELD');
    expect(waited).toEqual(['Photo 2 — tap to see it full screen']); // only the one not yet in memory waits to come near
  });

  it('is a sheet in the SHEETS walk: X, Back, the phone’s back and the edge swipe all close it', () => {
    expect(html).toContain("const SHEETS = ['twin', 'yard', 'bd', 'talk', 'approval', 'photo', 'maps'];"); // R28's approval sheet and R35's maps sheet sit beside it (merged)
    expect(html).toContain("$('photo').classList.add('show'); sheetOpened('photo');");
    expect(html).toContain("$('photo-close').addEventListener('click', () => closeSheet('photo'));");
    expect(html).toContain('<div id="photo" class="sheet">');
    const close = fnSrc('closeSheet');
    expect(close).toContain("if (id === 'photo') photoLetGo();");
    const pop = html.slice(html.indexOf("window.addEventListener('popstate'"), html.indexOf("$('back-btn').addEventListener"));
    expect(pop.indexOf("if (PHOTO_OPEN && !$('photo').classList.contains('show')) photoLetGo();")).toBeGreaterThan(pop.indexOf("for (const id of SHEETS) if (st.sheet !== id) $(id).classList.remove('show');"));
    // navBack closes whichever SHEETS member is open first — the photo is one.
    expect(fnSrc('navBack')).toContain("const open = SHEETS.find((id) => $(id).classList.contains('show'));");
  });

  it('every place a customer’s texts show draws the photos: Calls › Texts, and the study cards on Today and Calls', () => {
    const calls = fnSrc('renderCalls');
    expect(calls).toContain("if (m.media && m.media.length) c.appendChild(photoStrip(m.media, m.line, m.from || 'Unknown number', m.at));");
    expect(calls).toContain("if (m.practice) lb.appendChild(chip('PRACTICE', 'info'));");
    expect(calls).not.toMatch(/\.url\b|target = '_blank'/); // no address, no outside link
    const study = fnSrc('studyPanel');
    expect(study).toContain("const strip = photoStrip(n.media, 'quo', n.customerName || n.number, n.lastActivityAt);");
    expect(study).toContain("plural(n.mediaNotShown, 'more attachment') + ' on record — open Quo to see them.'");
    // Today and Calls both render the study panel.
    expect(html).toContain('fillQuoSlots([studyPanel(5), outreachPanel(false), sonaPanel(3, false)]');
    expect(html).toContain('fillQuoSlots([studyPanel(60), outreachPanel(true), sonaPanel(20, true)]');
  });

  it('the study card: a strip for a customer who sent photos, none for one who did not, and the overflow named', async () => {
    const drawn: unknown[] = [];
    const studyPanel = pageFn<(limit: number) => Promise<N>>('studyPanel', {
      api: async () => ({ status: { reading: true, lastAt: '2026-10-20T14:00:00Z', quoError: null, driveError: null, driveFiles: 0 }, notes: [
        { customerName: 'SIM-Dana', number: '+17575550142', stage: 'waiting_on_us', toldThem: [], media: [{ mediaId: 'ID1', contentType: 'image/jpeg', kind: 'photo', at: 'x' }], mediaNotShown: 2, lastActivityAt: 'x' },
        { customerName: 'SIM-Lee', number: '+17575550143', stage: 'new_inquiry', toldThem: [], media: [], mediaNotShown: 0, lastActivityAt: 'x' },
      ] }),
      el, chip: (t: string) => el('span', 'badge', t), plural: (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`, fmtTime: () => '', feedLine: () => el('div'),
      STUDY_STAGE: { waiting_on_us: ['WAITING ON YOU', 'watch'], new_inquiry: ['NEW', 'info'] },
      photoStrip: (media: unknown[], line: string, who: string) => { drawn.push([media.length, line, who]); return el('div', 'qphotos'); },
    });
    const w = await studyPanel(5);
    expect(drawn).toEqual([[1, 'quo', 'SIM-Dana']]);
    const strips = w.find('qphotos');
    expect(strips).toHaveLength(1);
    expect(strips[0]!.lines()).toEqual(['storm-muted | 2 more attachments on record — open Quo to see them.']);
  });

  it('a customer thread the study could not read this pass is named on the panel, never a quietly stale card (§1B)', async () => {
    const panelFor = (failed: number) => pageFn<(limit: number) => Promise<N>>('studyPanel', {
      api: async () => ({ status: { reading: true, lastAt: '2026-10-20T14:00:00Z', quoError: null, driveError: null, driveFiles: 0, failed }, notes: [] }),
      el, chip: (t: string) => el('span', 'badge', t), plural: (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`, fmtTime: () => '', feedLine: () => el('div'),
      STUDY_STAGE: {}, photoStrip: () => el('div', 'qphotos'),
    });
    expect((await panelFor(2)(5)).lines()).toContain('feed-state unread | 2 customer threads could not be read this pass — those cards may be out of date until the next read.');
    expect((await panelFor(0)(5)).lines().join('\n')).not.toContain('could not be read this pass');
  });

  it('Calls › Texts: a 401 is named, not a missing panel — the server locks the list with no APP_ACCESS_KEY (§1B)', () => {
    const calls = fnSrc('renderCalls');
    expect(calls).not.toContain("if (e.code !== 401) { txSlot.appendChild(el('div', 'panel-title', 'Texts'));");
    expect(calls).toContain("'Texts: locked — either this phone’s key was not accepted, or APP_ACCESS_KEY isn’t set on the server. That doesn’t mean there are no texts.'");
  });

  it('the page names no media host and never builds a photo address with the key in it', () => {
    expect(html).not.toMatch(/quo\.com|quo\.test/);
    expect(html).not.toMatch(/\/api\/quo\/media\/[^'"]*\?/);
    expect(html).toContain("fetch('/api/quo/media/' + encodeURIComponent(id), { headers: KEY ? { 'x-arbor-key': KEY } : {} })");
  });
});
