/*
  SLOW::ARBO — tests a write switch. The note at the top of
  test/dataLinks.test.ts applies here in full.
*/
// Audit wave 1 (H1) merged under R33 (Mike, 2026-10-20: "Connect Google as a
// read only and connect quo as read only").
//
// H1 says a hold is "filed" only when Google confirms it, "failed" with a
// reason when it does not, "unknown" while Arbo cannot tell — and outreach
// books a caller only from a confirmed hold. R33 says no hold is attempted at
// all while Google is read-only. Together: 'read_only' is its OWN outcome on
// every surface H1 touched — never "filed", never "failed" in red, never
// "unknown" — and nobody is booked from a hold while holds are off (§1B).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { QuoIntake, bookedFromHolds, type QuoCallEntry } from '../src/ops/quoIntake.js';
import { OutreachEngine } from '../src/ops/outreach.js';
import { CallMemory, CallRecordStore } from '../src/reception/callMemory.js';
import { loadAllConfig } from '../src/config/loadConfig.js';
import { GOOGLE_HOLDS_OFF_LINE, GOOGLE_HOLDS_OFF_OUTREACH_LINE } from '../src/integrations/readOnly.js';
import type { QuoApi } from '../src/integrations/quo.js';
import type { SonaCallFacts } from '../src/ops/quoExtract.js';
import { loadAppHtml } from '../src/server/appPage.js';
import { createTalkTools, talkReadsFrom } from '../src/voice/ownerTalk.js';
import { createApi } from '../src/server/api.js';
import { createSimSource } from '../src/dev/simSource.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const NOW = Date.parse('2026-10-20T15:00:00Z'); // Tuesday 11:00 EDT
const DAY = 86_400_000;
const KEY = Buffer.from('arbo-test-signing-key-32-bytes!!').toString('base64');
const LINE = '+17576069432';
const CALLER = '+17575550142';
const { guardrails, legal } = loadAllConfig();

const FACTS: SonaCallFacts = {
  wantsEstimate: true, name: 'SIM-Dana', address: '4500 Simulated Ct', city: 'Virginia Beach', jobType: 'removal',
  treeDetails: 'big oak in the back yard', powerLines: 'no', emergency: false, requestedTime: 'Wednesday after 4',
  agentSlips: [], callerType: 'customer',
};
const DIALOGUE = [
  { identifier: LINE, content: 'Hi, Art-is-Tree.', userId: null },
  { identifier: CALLER, content: 'I need a big oak taken down — can someone come give me an estimate Wednesday after 4?', userId: null },
];

function sign(body: string): Record<string, string> {
  const sig = createHmac('sha256', Buffer.from(KEY, 'base64')).update(`${NOW}.${body}`).digest('base64');
  return { 'openphone-signature': `hmac;1;${NOW};${sig}` };
}

/** The intake exactly as the server builds it (no googleWrites), with a writer that must never be called. */
function serverIntake(now = NOW) {
  const records = new CallRecordStore();
  const writer = vi.fn(async () => { throw new Error('the hold writer must never be called while Google is read-only'); });
  const intake = new QuoIntake({
    guardrails, extractor: { extract: async () => FACTS }, callMemory: new CallMemory(), callRecords: records,
    calendarHold: writer, onText: () => {}, now: () => now, sleep: async () => {},
  });
  intake.setRegistration('ok', 'test', [KEY], [LINE]);
  return { intake, records, writer };
}

function fakeQuo(callAt: number): QuoApi {
  return {
    listPhoneNumbers: async () => [LINE],
    phoneNumbers: async () => [{ id: 'PN1', number: LINE }],
    listConversations: async () => [{ id: 'CN1', phoneNumberId: 'PN1', participants: [CALLER], lastActivityAt: new Date(callAt).toISOString(), updatedAt: new Date(callAt).toISOString() }],
    listCalls: async () => [{ id: 'AC1', direction: 'incoming', status: 'completed', aiHandled: 'ai-agent', createdAt: new Date(callAt).toISOString(), answeredAt: null, completedAt: null }],
    listMessages: async () => [],
    getCallTranscript: async () => ({ status: 'completed', dialogue: DIALOGUE }),
    listWebhooks: async () => [], getWebhook: async () => null,
    createWebhook: async () => { throw new Error('not in this test'); }, deleteWebhook: async () => {},
  };
}

/** Outreach wired the way src/server.ts wires it (H1 + R33), over a Quo with one Sona caller who asked for an estimate. */
function serverOutreach(intake: QuoIntake, callAt: number) {
  const engine = new OutreachEngine({
    quo: fakeQuo(callAt),
    sender: { send: async () => ({ ok: true, id: 'out', status: 'queued', conversationId: null }) },
    guardrails, legal,
    extractor: { extract: async () => FACTS },
    bookedCallers: () => bookedFromHolds(intake.list()),
    holdFor: (callId) => intake.bookingState(callId),
    sonaFilesHolds: intake.holdsLive(),
    enabled: () => false,
    now: () => callAt + 2 * DAY,
    sleep: async () => {}, spacingMs: 0,
  });
  engine.setLine({ phoneNumberId: 'PN1', number: LINE, ownNumbers: [LINE] });
  return engine;
}

describe('H1 × R33 — holds off is its own outcome, and nobody is booked from a hold', () => {
  it('a webhook Sona call that asks for an estimate: read_only on the call, the record, the booking state and the counts', async () => {
    const h = serverIntake();
    const post = (event: unknown) => { const body = JSON.stringify(event); return h.intake.handle(sign(body), body); };
    post({ type: 'call.completed', data: { object: { id: 'AC1', from: CALLER, to: LINE, direction: 'incoming', status: 'completed', aiHandled: 'ai-agent' } } });
    post({ type: 'call.transcript.completed', data: { object: { callId: 'AC1', dialogue: DIALOGUE } } });
    await h.intake.settled();
    expect(h.writer).not.toHaveBeenCalled();
    const [call] = h.intake.list();
    expect(call).toMatchObject({ hold: 'read_only', holdError: null });
    expect(h.records.list()[0]).toMatchObject({ calendarHold: 'read_only' });
    expect(h.records.list()[0]).not.toHaveProperty('calendarHoldError');
    // Its own answer to "is this caller booked?" — never 'unknown' (held back) and never 'filed'.
    expect(h.intake.bookingState('AC1')).toBe('read_only');
    expect(h.intake.filedCallers().size).toBe(0);
    expect(bookedFromHolds(h.intake.list()).size).toBe(0);
    expect(h.intake.status()).toMatchObject({ holds: 'read_only', holdsFiled: 0, holdsFailed: 0, holdsWaiting: 0 });
    expect(h.intake.holdsLive()).toBe(false);
  });

  it('outreach: that caller is a customer to follow up — never estimate_booked, never hold_unknown', async () => {
    vi.stubEnv('ARBO_QUO_SEND', 'live'); // so the candidate list is the only thing under test
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const callAt = NOW - 3 * DAY;
    const h = serverIntake(callAt + 1);
    await h.intake.reconcile(fakeQuo(callAt), 'PN1', 7 * DAY);
    await h.intake.settled();
    // Learned after this process started → read_only, not learned_only (R33 checks first).
    expect(h.intake.list()[0]).toMatchObject({ callId: 'AC1', source: 'quo_record', hold: 'read_only' });
    expect(h.intake.bookingState('AC1')).toBe('read_only');
    const [c] = await serverOutreach(h.intake, callAt).buildCandidates();
    expect(c).toMatchObject({ number: CALLER, classification: 'customer', skip: null });
  });

  it('a call from before this process started is read_only too — not learned_only, so it is never held back as hold_unknown', async () => {
    vi.stubEnv('ARBO_QUO_SEND', 'live');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const callAt = NOW - 3 * DAY;
    const h = serverIntake(NOW); // booted after the call
    await h.intake.reconcile(fakeQuo(callAt), 'PN1', 7 * DAY);
    await h.intake.settled();
    expect(h.intake.list()[0]).toMatchObject({ hold: 'read_only' });
    const [c] = await serverOutreach(h.intake, callAt).buildCandidates();
    expect(c!.skip).not.toBe('hold_unknown');
    expect(c!.skip).not.toBe('estimate_booked');
  });

  it('bookedFromHolds counts only a hold Google CONFIRMED (H1) — attempted, failed and read_only are never bookings', () => {
    const entry = (callId: string, from: string, hold: QuoCallEntry['hold']) => ({ callId, from, hold }) as unknown as QuoCallEntry;
    const booked = bookedFromHolds([
      entry('A', '+17575550101', 'filed'),
      entry('B', '+17575550102', 'attempted'),
      entry('C', '+17575550103', 'failed'),
      entry('D', '+17575550104', 'read_only'),
      entry('E', '+17575550105', 'learned_only'),
    ]);
    expect([...booked]).toEqual(['+17575550101']);
  });

  it('the outreach status names holds-off on the list (the server wiring); with holds made it says nothing', async () => {
    const off = serverOutreach(serverIntake().intake, NOW).status();
    expect(off.holdsOff).toBe(GOOGLE_HOLDS_OFF_OUTREACH_LINE);
    // The dormant path: Google writes on and a writer — holds are made, so no line.
    const records = new CallRecordStore();
    const live = new QuoIntake({
      guardrails, extractor: { extract: async () => FACTS }, callMemory: new CallMemory(), callRecords: records,
      calendarHold: async () => ({ eventId: 'ev1' }), googleWrites: true, onText: () => {}, now: () => NOW, sleep: async () => {},
    });
    expect(live.holdsLive()).toBe(true);
    expect(serverOutreach(live, NOW).status().holdsOff).toBeNull();
  });

  it('M15 × R33: the wiring retry speaks R33’s registration, names a missing line as failed, and never retries a hook Arbo won’t create', () => {
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    const wire = server.slice(server.indexOf('async function wireQuo('), server.indexOf('export function startServer('));
    expect(wire).toContain('const reg = registrationFrom(hooks);');
    expect(wire).toContain("intake.setRegistration(noLine ? 'failed' : reg.state, `${reg.detail}${noLine}`, hooks.keys, numbers);");
    expect(wire).toContain('intake.setTextsHookMissing(textsHookMissing(hooks));');
    // Retried: a Quo refusal or a missing line. Never the read-only `missing` list (off on purpose).
    expect(wire).toContain('retry: hooks.failed.length > 0 || !first');
    expect(wire).not.toMatch(/retry:[^\n]*missing/);
    // The work that starts once the line is learned still stops at R33's door before any send.
    const onLine = server.slice(server.indexOf('onLine: (line) => {'), server.indexOf('} else if (!currentQuoIntake)'));
    expect(onLine).toContain('if (!quoWritesLive()) {');
    expect(onLine.indexOf('if (!quoWritesLive())')).toBeLessThan(onLine.indexOf("outreach.runCatchup('auto')"));
    // R31 and R33 boot lines survive the M15 restructure.
    expect(server).toContain('for (const line of readOnlyBootLines()) console.log(line);');
    expect(server).toContain('if (bouncieNow) setInterval(() => { void bouncieNow.tick(); }, 60_000).unref();');
  });

  it('the server asks the intake — confirmed holds, its booking state, and whether holds are made at all', () => {
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(server).toContain('bookedCallers: () => bookedFromHolds(quoIntake.list()),');
    expect(server).toContain('holdFor: (callId) => quoIntake.bookingState(callId),');
    expect(server).toContain('sonaFilesHolds: quoIntake.holdsLive(),');
    expect(server).not.toContain('sonaFilesHolds: Boolean(calendarHold)');
  });
});

// ─── the screens: a stand-in DOM, just what the Sona panel touches ─────────
class FakeEl {
  className = ''; children: FakeEl[] = []; dataset: Record<string, string> = {};
  disabled = false; href = ''; onclick: null | (() => unknown) = null; style: Record<string, string> = {};
  private text = '';
  constructor(readonly tag: string) {}
  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(' '); }
  set textContent(t: string) { this.text = t; this.children = []; }
  appendChild(n: FakeEl) { this.children.push(n); return n; }
  replaceChildren() { this.children = []; }
  addEventListener() {}
  setAttribute() {}
  all(): FakeEl[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}
const el = (tag: string, cls?: string, text?: string) => { const n = new FakeEl(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const plural = (n: number, one: string, many?: string) => n + ' ' + (n === 1 ? one : many || one + 's');
const html = loadAppHtml();
const src = (name: string): string => {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
};
const pageFn = <T,>(name: string, deps: Record<string, unknown>): T =>
  new Function(...Object.keys(deps), `${src(name)}\nreturn ${name};`)(...Object.values(deps)) as T;
const deps = {
  el, plural, chip: (t: string, tone: string) => el('span', 'badge ' + tone, t), fmtTime: () => '', feedLine: () => el('div', 'feed-state unread', 'x'),
  renderCalls: () => {}, renderToday: () => {}, slipRuleLabel: (r: string) => r, openSonaCall: () => {},
  document: { createElement: (t: string) => el(t) },
};

/** The status the intake really returns (H1 + R33 fields). */
const status = (over: Record<string, unknown> = {}) => ({
  registration: { state: 'ok', detail: '' }, reading: true, callsWithSlips: 0, sonaCalls: 1, learnedFromRecord: 0,
  holdsFiled: 0, holdsFailed: 0, holdsWaiting: 0, holds: 'read_only', quoWrites: 'read_only', readsRetrying: 0, readRetryMax: 5,
  hangups: 0, quoRecord: { lastAt: 'x' }, notUsed: {}, ...over,
});
const card = (over: Record<string, unknown> = {}) => ({
  callId: 'AC1', at: 'x', from: CALLER, handledBy: 'sona', slips: [], summary: [], dialogue: [], holdError: null, extractAttempts: 0,
  facts: { name: 'SIM-Dana', requestedTime: 'Wednesday after 4' }, hold: 'read_only', ...over,
});
const sonaPanel = (st: Record<string, unknown>, calls: unknown[], withTranscripts: boolean) =>
  pageFn<(n: number, t: boolean) => Promise<FakeEl>>('sonaPanel', { ...deps, api: async () => ({ status: st, calls }) })(20, withTranscripts);
const red = (n: FakeEl) => n.className.split(' ').includes('storm') || n.className.split(' ').includes('emergency');

describe('every screen H1 touched shows R33’s line when holds are off — never "failed" in red', () => {
  for (const withTranscripts of [true, false]) {
    it(`${withTranscripts ? 'Calls' : 'Today'}: the card carries Mike’s line, muted; nothing on the panel is red or says FAILED`, async () => {
      const panel = await sonaPanel(status(), [card()], withTranscripts);
      const c = panel.all().find((n) => n.dataset.sonaCall === 'AC1')!;
      expect(c.textContent).toContain(GOOGLE_HOLDS_OFF_LINE);
      expect(c.className.split(' ')).not.toContain('emergency');
      expect(panel.all().some(red)).toBe(false);
      expect(panel.textContent).not.toMatch(/FAILED|did NOT reach|NOT on your calendar|waiting on Google/);
      if (withTranscripts) {
        expect(panel.textContent).toContain('calendar holds off (Google is read-only)');
        expect(panel.textContent).not.toMatch(/\d+ calendar holds? filed/);
      }
    });
  }

  it('the card with no time asked for: "call them to set one", muted', async () => {
    const panel = await sonaPanel(status(), [card({ facts: { name: 'SIM-Dana', requestedTime: null } })], true);
    const line = panel.all().filter((n) => n.textContent.includes('The caller gave no time — call them to set one.')).pop()!; // the innermost node
    expect(line.className).toBe('storm-muted');
  });

  it('a call still being re-read while holds are off promises no hold later (panel and card)', async () => {
    const panel = await sonaPanel(status({ readsRetrying: 1 }), [card({ hold: 'extraction_unavailable', extractAttempts: 1, facts: null })], true);
    expect(panel.textContent).toContain('Arbo could not read 1 Sona call yet');
    expect(panel.textContent).toContain('trying again (1 of 5 tries).');
    expect(panel.textContent).not.toMatch(/No hold (is )?filed (yet|until)/);
  });

  // Wave-1 verify (R33 base): the card for a call Arbo could not read and will not retry
  // (no model key, or a transcript Quo failed to write) still said "no hold filed" while holds are off.
  it('a call Arbo could not read and will not retry promises no hold while holds are off — muted; with holds on it still says none was filed', async () => {
    const unread = card({ hold: 'extraction_unavailable', extractAttempts: 0, facts: null });
    const panel = await sonaPanel(status(), [unread], true);
    const c = panel.all().find((n) => n.dataset.sonaCall === 'AC1')!;
    expect(c.textContent).toContain('Arbo could not read this call. If they want an estimate, book it yourself.');
    expect(c.textContent).not.toMatch(/no hold filed/i);
    expect(panel.all().some(red)).toBe(false);
    const on = await sonaPanel(status({ holds: 'on' }), [unread], true);
    expect(on.all().find((n) => n.dataset.sonaCall === 'AC1')!.textContent).toContain('Arbo could not read this call — no hold filed');
  });

  it('with holds on (the dormant path), H1 is as built: the red count, the red card, the three numbers', async () => {
    const panel = await sonaPanel(status({ holds: 'on', holdsFailed: 1 }), [card({ hold: 'failed', holdError: 'google_signin' })], true);
    expect(panel.textContent).toContain('1 calendar hold did NOT reach your calendar');
    const c = panel.all().find((n) => n.dataset.sonaCall === 'AC1')!;
    expect(c.className.split(' ')).toContain('emergency');
    expect(c.textContent).toContain('NOT on your calendar — Google sign-in isn’t working');
    expect(panel.textContent).toContain('0 calendar holds filed · 1 FAILED (not on your calendar)');
    expect(panel.textContent).not.toContain('calendar holds off');
  });

  it('M10 × R33: with Quo read-only (a hook Arbo won’t create) a week cut short by the cap is named, never "No Sona calls"', async () => {
    const st = status({ registration: { state: 'read_only', detail: 'hook missing' }, sonaCalls: 0, quoRecord: { lastAt: 'x', weekThreadsNotRead: 20, callCap: 100 } });
    const short = await sonaPanel(st, [], true);
    expect(short.textContent).toContain('Arbo read the first 100 calls of the past week from Quo’s record');
    expect(short.textContent).not.toContain('No Sona calls in the last 7 days');
    // The whole week read and nothing there: the read-only state still says so (R33 review)…
    const whole = await sonaPanel(status({ registration: { state: 'read_only', detail: 'hook missing' }, sonaCalls: 0, quoRecord: { lastAt: 'x', weekReadOkAt: 'x', weekThreadsNotRead: 0, callCap: 100 } }), [], true);
    expect(whole.textContent).toContain('No Sona calls in the last 7 days');
    // …but a week read that never finished (M10 follow-up) is not an empty week, read-only or not.
    const unfinished = await sonaPanel(status({ registration: { state: 'read_only', detail: 'hook missing' }, sonaCalls: 0, quoRecord: { lastAt: 'x', weekReadOkAt: null, weekThreadsNotRead: 0, callCap: 100 } }), [], true);
    expect(unfinished.textContent).not.toContain('No Sona calls in the last 7 days');
  });

  it('the outreach list: holds off is said in the muted tone; nobody is listed as "calendar hold filed"; nothing is red', async () => {
    const st = {
      wired: true, readOnly: true, fromNumber: LINE, autoFollowUps: false, template: { text: 'SIM- template', ok: true, problems: [] },
      paused: null, deferredUntil: null, queued: 0, sent: 0, lastRunAt: 'x',
      candidates: { total: 1, eligible: 1, skipped: {} }, blindSpot: 'blind', holdsOff: GOOGLE_HOLDS_OFF_OUTREACH_LINE,
    };
    const panel = await pageFn<(full: boolean) => Promise<FakeEl>>('outreachPanel', { ...deps, api: async () => ({ status: st, candidates: [], sends: [] }) })(true);
    const line = panel.all().find((n) => n.textContent === GOOGLE_HOLDS_OFF_OUTREACH_LINE)!;
    expect(line.className).toBe('storm-muted');
    expect(panel.textContent).not.toContain('calendar hold filed');
    expect(panel.all().some((n) => n.className.split(' ').includes('storm'))).toBe(false);
    // With holds made (holdsOff null) the line is absent.
    const on = await pageFn<(full: boolean) => Promise<FakeEl>>('outreachPanel', { ...deps, api: async () => ({ status: { ...st, holdsOff: null }, candidates: [], sends: [] }) })(true);
    expect(on.textContent).not.toContain('Calendar holds are off');
  });

  it('Talk: holds off is said as off — no "did NOT reach", no "Failed:", no hold promised for a call being re-read', async () => {
    const api = createApi(createSimSource(), { dataLinksSim: true, alerts: { activeAlerts: async () => [] } });
    const stormLaw = async () => ({ state: 'none' as const, declarations: [], flag: null, governorNote: '', checkedAt: new Date().toISOString(), reason: null });
    const talk = async (st: Record<string, unknown>, calls: unknown[]) =>
      (await createTalkTools(talkReadsFrom({ api, quo: () => ({ status: st, calls }) as never, stormLaw, mode: () => 'sim' })).run('arbo_sona_calls')).text;
    const off = await talk(status({ readsRetrying: 1 }), [card()]);
    expect(off).toContain('Calendar holds: off — Google is connected read-only');
    expect(off).toContain('it is trying again.');
    expect(off).not.toMatch(/did NOT reach|Failed:|Still waiting on Google|on your calendar: |no hold is filed until/);
    const on = await talk(status({ holds: 'on', holdsFailed: 1, readsRetrying: 1 }), [card({ hold: 'failed' })]);
    expect(on).toContain('1 calendar hold did NOT reach your calendar');
    expect(on).toContain('Calendar holds on your calendar: 0. Failed: 1. Still waiting on Google: 0.');
    expect(on).toContain('no hold is filed until it can');
  });
});
