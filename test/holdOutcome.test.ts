// H1 + M16 + M13 (audit 2026-10-20).
//   H1: a calendar hold that FAILED never reads "filed" — not on the Calls
//       card, not in the counts, not in Talk — and outreach never treats that
//       caller as booked. (Eleven failed holds read "filed" for a week.)
//   M16: a Sona call the model could not read is read again on the next pass
//       of Quo's record, a few times; outreach never marks it booked meanwhile.
//   M13: the "already called back" check names that it sees the Quo line only.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { QuoIntake, EXTRACT_MAX_ATTEMPTS, bookedFromHolds } from '../src/ops/quoIntake.js';
import { OutreachEngine } from '../src/ops/outreach.js';
import { CallMemory, CallRecordStore } from '../src/reception/callMemory.js';
import { holdErrorCode, type CallHold } from '../src/reception/estimateHold.js';
import { createElevenLabsBridge, type BridgeRequestBody } from '../src/voice/elevenlabsBridge.js';
import { createTalkTools } from '../src/voice/ownerTalk.js';
import { loadAllConfig, loadGuardrails, loadLegal } from '../src/config/loadConfig.js';
import type { QuoApi, QuoTranscript } from '../src/integrations/quo.js';
import type { SonaCallFacts } from '../src/ops/quoExtract.js';
import type { LlmClient } from '../src/reception/receptionist.js';

const NOW = Date.parse('2026-10-20T15:00:00Z'); // Tue 11:00 EDT
const MIN = 60_000;
const KEY = Buffer.from('arbo-test-signing-key-32-bytes!!').toString('base64');
const LINE = '+17576069432';
const CALLER = '+17575550142';
// The page mixes \\u escapes and literal characters; compare on the decoded text.
const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8').replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

const FACTS: SonaCallFacts = {
  wantsEstimate: true, name: 'SIM-Dana', address: '4500 Simulated Ct', city: 'Virginia Beach', jobType: 'removal',
  treeDetails: 'big oak', powerLines: 'no', emergency: false, requestedTime: 'Wednesday after 4', agentSlips: [], callerType: 'customer',
};
const TALK: QuoTranscript = {
  status: 'completed',
  dialogue: [
    { identifier: LINE, content: "Hi, you've reached Art-is-Tree.", userId: null },
    { identifier: CALLER, content: 'I need a big oak taken down, can someone come give me an estimate Wednesday after 4?', userId: null },
  ],
};

function sign(body: string, ts = NOW): Record<string, string> {
  const sig = createHmac('sha256', Buffer.from(KEY, 'base64')).update(`${ts}.${body}`).digest('base64');
  return { 'openphone-signature': `hmac;1;${ts};${sig}` };
}

/** A fake Quo with one caller, one Sona call — enough for QuoIntake.reconcile and OutreachEngine alike. */
function fakeQuo(callAt: number, transcriptReads?: { n: number }): QuoApi {
  return {
    listPhoneNumbers: async () => [LINE],
    phoneNumbers: async () => [{ id: 'PN1', number: LINE }],
    listConversations: async () => [{ id: 'CN1', phoneNumberId: 'PN1', participants: [CALLER], lastActivityAt: new Date(callAt).toISOString(), updatedAt: new Date(callAt).toISOString() }],
    listCalls: async () => [{ id: 'AC1', direction: 'incoming', status: 'completed', aiHandled: 'ai-agent', createdAt: new Date(callAt).toISOString(), answeredAt: null, completedAt: null }],
    listMessages: async () => [],
    getCallTranscript: async () => { if (transcriptReads) transcriptReads.n += 1; return TALK; },
    listWebhooks: async () => [], getWebhook: async () => null,
    createWebhook: async () => { throw new Error('not in this test'); }, deleteWebhook: async () => {},
  };
}

function intakeWith(opts: { writer?: ((h: CallHold) => Promise<unknown>) | null; extract?: () => Promise<SonaCallFacts>; extractor?: null } = {}) {
  let now = NOW;
  const records = new CallRecordStore();
  const extract = vi.fn(opts.extract ?? (async () => FACTS));
  const intake = new QuoIntake({
    guardrails: loadAllConfig().guardrails,
    extractor: opts.extractor === null ? null : { extract },
    callMemory: new CallMemory(),
    callRecords: records,
    calendarHold: opts.writer === undefined ? async () => ({ eventId: 'ev1' }) : opts.writer,
    // R33: Google is connected read-only, so the hold writer is dormant; these
    // tests pin that dormant path (as the R33 suites do) — test/wave1R33.test.ts
    // pins what the same calls say while holds are off.
    googleWrites: true,
    onText: () => {},
    now: () => now,
    sleep: async () => {},
  });
  intake.setRegistration('ok', 'test', [KEY], [LINE]);
  const post = (event: unknown) => { const body = JSON.stringify(event); return intake.handle(sign(body, now), body); };
  const sonaCall = (callId = 'AC1') => {
    post({ type: 'call.completed', data: { object: { id: callId, from: CALLER, direction: 'incoming', status: 'completed', aiHandled: 'ai-agent' } } });
    post({ type: 'call.transcript.completed', data: { object: { callId, dialogue: TALK.dialogue } } });
  };
  return { intake, records, extract, post, sonaCall, setNow: (ms: number) => { now = ms; } };
}

function outreachOver(intake: QuoIntake, callAt: number, extract: () => Promise<SonaCallFacts> = async () => FACTS) {
  const { guardrails, legal } = loadAllConfig();
  const engine = new OutreachEngine({
    quo: fakeQuo(callAt),
    sender: { send: async () => ({ ok: true, id: 'out', status: 'queued', conversationId: null }) },
    guardrails, legal,
    extractor: { extract },
    // The server's wiring (src/server.ts), verbatim in shape (H1 + R33).
    bookedCallers: () => bookedFromHolds(intake.list()),
    holdFor: (id) => intake.bookingState(id),
    sonaFilesHolds: intake.holdsLive(),
    enabled: () => false,
    now: () => callAt + 2 * 24 * 60 * MIN,
    sleep: async () => {}, spacingMs: 0,
  });
  engine.setLine({ phoneNumberId: 'PN1', number: LINE, ownNumbers: [LINE] });
  return engine;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('H1 — a calendar hold is "filed" only when Google says so', () => {
  it('a refused hold is FAILED on the call, the record and the counts — and that caller is not "booked"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = intakeWith({ writer: async () => { throw new Error('token refresh failed: HTTP 400'); } });
    h.sonaCall();
    await h.intake.settled();
    const [call] = h.intake.list();
    expect(call).toMatchObject({ hold: 'failed', holdError: 'google_signin' });
    expect(h.records.list()[0]).toMatchObject({ calendarHold: 'failed', calendarHoldError: 'google_signin' });
    expect(h.intake.status()).toMatchObject({ holdsFiled: 0, holdsFailed: 1, holdsWaiting: 0 });
    expect(h.intake.status()).not.toHaveProperty('holdsAttempted');
    expect(h.intake.bookingState('AC1')).toBe('not_filed');
    expect(h.intake.filedCallers().size).toBe(0);
  });

  it('a hold Google accepted is FILED, and only then is the caller booked', async () => {
    const h = intakeWith();
    h.sonaCall();
    await h.intake.settled();
    expect(h.intake.list()[0]!.hold).toBe('filed');
    expect(h.records.list()[0]!.calendarHold).toBe('filed');
    expect(h.intake.status()).toMatchObject({ holdsFiled: 1, holdsFailed: 0 });
    expect(h.intake.bookingState('AC1')).toBe('filed');
    expect([...h.intake.filedCallers()]).toEqual([CALLER]);
  });

  it('a slow Google never stalls the queue: the call reads "no answer yet" (unknown, not booked) until the answer lands', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let answer!: (v: unknown) => void;
    const h = intakeWith({ writer: () => new Promise((r) => { answer = r; }) });
    h.sonaCall();
    const settled = h.intake.settled();
    await vi.advanceTimersByTimeAsync(15_000);
    await settled;
    expect(h.intake.list()[0]!.hold).toBe('attempted');
    expect(h.intake.status().holdsWaiting).toBe(1);
    expect(h.intake.bookingState('AC1')).toBe('unknown');
    answer({ eventId: 'late' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.intake.list()[0]!.hold).toBe('filed');
    expect(h.records.list()[0]!.calendarHold).toBe('filed');
  });

  it('the short codes say why, never the error text', () => {
    expect(holdErrorCode(new Error('token refresh failed: HTTP 400'))).toBe('google_signin');
    expect(holdErrorCode(new Error('Calendar createEvent failed: 403'))).toBe('calendar_refused');
    expect(holdErrorCode(new Error('fetch failed'))).toBe('error');
    expect(holdErrorCode('nope')).toBe('error');
  });

  it('outreach: a FAILED hold leaves a customer to follow up; a FILED one is booked; neither comes from the transcript alone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const callAt = NOW;
    const failed = intakeWith({ writer: async () => { throw new Error('token refresh failed: HTTP 400'); } });
    failed.sonaCall();
    await failed.intake.settled();
    expect((await outreachOver(failed.intake, callAt).buildCandidates())[0]).toMatchObject({ classification: 'customer', skip: null });

    const filed = intakeWith();
    filed.sonaCall();
    await filed.intake.settled();
    expect((await outreachOver(filed.intake, callAt).buildCandidates())[0]).toMatchObject({ skip: 'estimate_booked' });
  });

  it('the Arbo voice bridge (cut, R21) records the same: Google’s answer lands back in the record', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const llm: LlmClient = { complete: async () => 'Bye — have a good one! [[END_CALL]]' };
    const body = (conv: string): BridgeRequestBody => ({ user: CALLER, elevenlabs_extra_body: { conversation_id: conv }, messages: [{ role: 'user', content: 'bye' }], tools: [{ type: 'function', function: { name: 'end_call' } }] });
    const make = (writer: (h: CallHold) => Promise<unknown>) => {
      const records = new CallRecordStore();
      const bridge = createElevenLabsBridge({ guardrails: loadGuardrails(), legal: loadLegal(), llm, alerter: { emergency: async () => {} }, bridgeSecret: 's', callRecords: records, calendarHold: writer, googleWrites: true, now: () => NOW });
      return { bridge, records };
    };
    const bad = make(async () => { throw new Error('token refresh failed: HTTP 400'); });
    await bad.bridge.handle('Bearer s', body('c-bad'));
    await new Promise((r) => setTimeout(r, 0));
    expect(bad.records.list()[0]).toMatchObject({ calendarHold: 'failed', calendarHoldError: 'google_signin' });
    const good = make(async () => ({ eventId: 'e' }));
    await good.bridge.handle('Bearer s', body('c-good'));
    await new Promise((r) => setTimeout(r, 0));
    expect(good.records.list()[0]!.calendarHold).toBe('filed');
  });

  it('the app never calls an unanswered or failed hold "filed", and shows a failure in red on Today and Calls', () => {
    const p = html.slice(html.indexOf('async function sonaPanel('), html.indexOf('// ---------- Text outreach via Quo'));
    expect(p).not.toContain('holdsAttempted');
    expect(p).not.toMatch(/attempted: 'Calendar hold filed/);
    expect(p).toContain("filed: 'Calendar hold filed (unconfirmed");
    expect(p).toContain("attempted: 'Calendar hold sent to Google — no answer yet.");
    expect(p).toContain("if (c.hold === 'failed') return ['storm', 'NOT on your calendar — '");
    expect(p).toContain("plural(st.holdsFailed, 'calendar hold') + ' did NOT reach your calendar");
    expect(p).toContain("' FAILED (not on your calendar)'");
    // A failed hold is a red card, first on Today.
    expect(p).toContain("|| c.hold === 'failed';");
  });

  it('Talk says a failed hold out loud and never counts it as filed', async () => {
    const st = {
      registration: { state: 'ok', detail: 'wired' }, reading: true, received: 0, rejected: 0, lastAt: null, lastError: null,
      sonaCalls: 1, slips: 0, callsWithSlips: 0, holdsFiled: 0, holdsFailed: 1, holdsWaiting: 0, readsRetrying: 0, readRetryMax: EXTRACT_MAX_ATTEMPTS,
      hangups: 0, learnedFromRecord: 0, notUsed: {}, quoRecord: { lastAt: new Date(NOW).toISOString(), learned: 0, pending: 0, error: null, unreadable: null },
    };
    const call = { callId: 'AC1', at: new Date(NOW).toISOString(), from: CALLER, handledBy: 'sona', status: 'completed', durationSec: 60, dialogue: [], summary: [], nextSteps: [], slips: [], facts: { ...FACTS }, hold: 'failed', holdError: 'google_signin', extractAttempts: 0, processed: true, aiHandled: 'ai-agent', source: 'webhook' };
    const reads = { quo: () => ({ status: st, calls: [call] }), mode: () => 'live' } as unknown as Parameters<typeof createTalkTools>[0];
    const text = (await createTalkTools(reads).run('arbo_sona_calls')).text;
    expect(text).toContain('1 calendar hold did NOT reach your calendar');
    expect(text).not.toMatch(/holds filed: 1/i);
  });
});

describe('M16 — a call the model could not read is read again; never "booked" meanwhile', () => {
  it('the extractor throws once, then the next pass of Quo’s record reads it and files exactly one hold', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const holds: CallHold[] = [];
    const h = intakeWith({
      extract: async () => { if (fail) { fail = false; throw new Error('529 overloaded'); } return FACTS; },
      writer: async (hold) => { holds.push(hold); return { eventId: 'e' }; },
    });
    const api = fakeQuo(NOW + 5 * MIN);
    h.setNow(NOW + 20 * MIN);
    await h.intake.reconcile(api, 'PN1', 24 * 60 * MIN);
    expect(h.intake.list()[0]).toMatchObject({ hold: 'extraction_unavailable', extractAttempts: 1 });
    expect(h.intake.status().readsRetrying).toBe(1);
    expect(h.intake.bookingState('AC1')).toBe('unknown');
    await h.intake.reconcile(api, 'PN1', 24 * 60 * MIN);
    expect(h.extract).toHaveBeenCalledTimes(2);
    expect(h.intake.list()[0]!.hold).toBe('filed'); // D80: decided by call time — after boot, so a hold is due
    expect(holds).toHaveLength(1);
    await h.intake.reconcile(api, 'PN1', 24 * 60 * MIN);
    expect(h.extract).toHaveBeenCalledTimes(2); // read once it worked — never again
    expect(holds).toHaveLength(1);
    expect(h.intake.status().readsRetrying).toBe(0);
  });

  it('a webhook-delivered call the model could not read is picked up by the next pass too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const h = intakeWith({ extract: async () => { if (fail) { fail = false; throw new Error('overloaded'); } return FACTS; } });
    h.sonaCall();
    await h.intake.settled();
    expect(h.intake.list()[0]!.hold).toBe('extraction_unavailable');
    await h.intake.reconcile(fakeQuo(NOW), 'PN1', 24 * 60 * MIN);
    expect(h.intake.list()[0]!.hold).toBe('filed');
  });

  it('a model that stays down is tried EXTRACT_MAX_ATTEMPTS times, then the card says it gave up', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = intakeWith({ extract: async () => { throw new Error('down'); } });
    const api = fakeQuo(NOW + 5 * MIN);
    h.setNow(NOW + 20 * MIN);
    for (let i = 0; i < EXTRACT_MAX_ATTEMPTS + 3; i += 1) await h.intake.reconcile(api, 'PN1', 24 * 60 * MIN);
    expect(h.extract).toHaveBeenCalledTimes(EXTRACT_MAX_ATTEMPTS);
    expect(h.intake.list()[0]).toMatchObject({ hold: 'extraction_unavailable', extractAttempts: EXTRACT_MAX_ATTEMPTS });
    expect(h.intake.status().readsRetrying).toBe(0);
    expect(h.intake.bookingState('AC1')).toBe('not_filed');
  });

  it('no model key, or a transcript Quo failed to write, is not retried (nothing would change)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reads = { n: 0 };
    const h = intakeWith({ extractor: null });
    const api = fakeQuo(NOW + 5 * MIN, reads);
    h.setNow(NOW + 20 * MIN);
    await h.intake.reconcile(api, 'PN1', 24 * 60 * MIN);
    await h.intake.reconcile(api, 'PN1', 24 * 60 * MIN);
    expect(reads.n).toBe(1);
    expect(h.intake.list()[0]).toMatchObject({ hold: 'extraction_unavailable', extractAttempts: 0 });
  });

  it('while Arbo still cannot read the call, outreach (whose own read worked) never marks it booked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = intakeWith({ extract: async () => { throw new Error('overloaded'); } });
    h.sonaCall();
    await h.intake.settled();
    const c = (await outreachOver(h.intake, NOW).buildCandidates())[0]!;
    expect(c.skip).not.toBe('estimate_booked');
    expect(c).toMatchObject({ classification: 'customer', skip: 'hold_unknown' });
  });

  // Wave-1 verify: the model failed during the BOOT week read on a call days old; the
  // week read still finished whole, so the timed passes narrowed to a day and never
  // listed that call again — while every screen said "trying again". A call due a
  // retry is read again by its id, whatever the window (both Google modes).
  for (const googleWrites of [false, true]) {
    it(`a call the model missed during the boot week read is read again by id once the passes narrow to a day (googleWrites ${googleWrites})`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const DAY = 24 * 60 * MIN;
      let now = NOW;
      let modelUp = false;
      const extract = vi.fn(async () => { if (!modelUp) throw new Error('overloaded'); return FACTS; });
      const intake = new QuoIntake({
        guardrails: loadAllConfig().guardrails, extractor: { extract }, callMemory: new CallMemory(), callRecords: new CallRecordStore(),
        calendarHold: async () => ({ eventId: 'ev1' }), googleWrites, onText: () => {}, now: () => now, sleep: async () => {},
      });
      // A Quo that honours its time filters, like the real API: the call is 3 days before boot.
      const at = new Date(NOW - 3 * DAY).toISOString();
      const reads = { n: 0 };
      const api: QuoApi = {
        ...fakeQuo(NOW - 3 * DAY, reads),
        listConversations: async ({ updatedAfterIso }) => (at >= updatedAfterIso ? [{ id: 'CN1', phoneNumberId: 'PN1', participants: [CALLER], lastActivityAt: at, updatedAt: at }] : []),
        listCalls: async ({ createdAfterIso }) => (at >= (createdAfterIso ?? '') ? [{ id: 'AC1', direction: 'incoming', status: 'completed', aiHandled: 'ai-agent', createdAt: at, answeredAt: null, completedAt: null }] : []),
      };
      await intake.reconcile(api, 'PN1', 7 * DAY); // the boot read (QUO_LEARN_BACKFILL_MS)
      expect(intake.list()[0]).toMatchObject({ hold: 'extraction_unavailable', extractAttempts: 1 });
      expect(intake.nextWindowMs(DAY)).toBe(DAY); // the week read finished whole → the timed passes look back a day
      modelUp = true;
      now += 10 * MIN;
      await intake.reconcile(api, 'PN1', intake.nextWindowMs(DAY));
      expect(extract).toHaveBeenCalledTimes(2);
      // Learned from before boot: no hold either way — read-only says so by name (R33).
      expect(intake.list()[0]).toMatchObject({ hold: googleWrites ? 'learned_only' : 'read_only', extractAttempts: 1 });
      expect(intake.status().readsRetrying).toBe(0);
      expect(reads.n).toBe(2); // once at boot, once by id — never twice in one pass
      now += 10 * MIN;
      await intake.reconcile(api, 'PN1', intake.nextWindowMs(DAY));
      expect(extract).toHaveBeenCalledTimes(2); // read once it worked — never again
      expect(reads.n).toBe(2);
    });
  }

  it('a call due a retry that has aged past the week is still read again by id, and a pass over the window never reads it twice', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const reads = { n: 0 };
    const h = intakeWith({ extract: async () => { if (fail) { fail = false; throw new Error('overloaded'); } return FACTS; } });
    const api = fakeQuo(NOW + 5 * MIN, reads);
    h.setNow(NOW + 20 * MIN);
    await h.intake.reconcile(api, 'PN1', 24 * 60 * MIN);
    expect(reads.n).toBe(1);
    // Inside the window: the listing reads it again, and the by-id pass skips it.
    await h.intake.reconcile(api, 'PN1', 24 * 60 * MIN);
    expect(reads.n).toBe(2);
    expect(h.intake.list()[0]!.hold).toBe('filed');
    // Aged out: Quo lists nothing for the window, yet a retry-due call is still read by id.
    let failAgain = true;
    const h2 = intakeWith({ extract: async () => { if (failAgain) { failAgain = false; throw new Error('overloaded'); } return FACTS; } });
    h2.sonaCall('AC2');
    await h2.intake.settled();
    expect(h2.intake.list()[0]).toMatchObject({ hold: 'extraction_unavailable', extractAttempts: 1 });
    const empty: QuoApi = { ...fakeQuo(NOW), listConversations: async () => [], listCalls: async () => [], getCallTranscript: async (id) => { expect(id).toBe('AC2'); return TALK; } };
    h2.setNow(NOW + 8 * 24 * 60 * MIN);
    await h2.intake.reconcile(empty, 'PN1', 24 * 60 * MIN);
    expect(h2.intake.list()[0]!.hold).toBe('filed');
    expect(h2.intake.status().readsRetrying).toBe(0);
  });

  it('the Calls card says which try it is on, then that it gave up', () => {
    // R33 merge: the "no hold filed (yet)" clause is said only while holds are on — while Google is
    // read-only no hold is ever filed, so the card does not promise one later.
    expect(html).toContain("'Arbo could not read this call yet — trying again (' + c.extractAttempts + ' of ' + st.readRetryMax + ' tries).' + (st.holds === 'read_only' ? '' : ' No hold filed yet.')");
    expect(html).toContain("'Arbo could not read this call after ' + st.readRetryMax + ' tries' + (st.holds === 'read_only' ? '' : ' — no hold filed') + '. If they want an estimate, book it yourself.'");
    expect(html).toContain("'Arbo could not read ' + plural(st.readsRetrying, 'Sona call') + ' yet (the AI model was unavailable)");
  });
});

describe('M13 — "already called back" sees the Quo line only, and says so', () => {
  it('status names the blind spot; the labels and every card carry it', async () => {
    const h = intakeWith();
    const engine = outreachOver(h.intake, NOW);
    expect(engine.status().blindSpot).toMatch(/only calls and texts on the Quo line/);
    expect(engine.status().blindSpot).toMatch(/iPhone/);
    expect(engine.status().note).not.toMatch(/Sona bookings are re-read from Quo/);
    expect(html).toContain("called_back: 'you called them back from the Quo line'");
    expect(html).toContain("already_texted: 'already heard from us on the Quo line'");
    expect(html).toContain("if (st.blindSpot) wrap.appendChild(el('div', 'feed-state unset', st.blindSpot));");
    expect(html).toContain('Reached them from your iPhone? Arbo can’t see that');
    expect(html).not.toContain("called_back: 'you already called them back'");
  });

  it('PHONE_SETUP says the check reads Quo only', () => {
    const doc = readFileSync(new URL('../docs/PHONE_SETUP.md', import.meta.url), 'utf8');
    expect(doc).toContain('anyone Mike already called back **from the\n  Quo line**');
    expect(doc).toMatch(/Blind spot \(audit M13/);
  });
});
