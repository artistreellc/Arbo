/*
  SLOW::ARBO — tests the one outbound path. The note at the top of
  test/dataLinks.test.ts applies here in full.
*/
// R22 (Mike, 2026-09-24): "set up the ability to send texts via quo to have
// people reach back out to 7573195131 if they are still intrested in a
// quote for the past week only and after that use the same templet for
// follow ups". Every law in src/ops/outreach.ts's header is pinned here.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { OutreachEngine, isStopText, type Candidate } from '../src/ops/outreach.js';
import type { QuoApi, QuoCall, QuoConversation, QuoMessage, QuoTranscript } from '../src/integrations/quo.js';
import type { QuoSender, SendResult } from '../src/integrations/quoSend.js';
import type { SonaCallFacts } from '../src/ops/quoExtract.js';
import { loadAllConfig } from '../src/config/loadConfig.js';
import { createArborRequestHandler } from '../src/server.js';

const DAY = 24 * 60 * 60 * 1000;
/** A Thursday, 11:00 EDT — inside quiet hours. */
const NOON = Date.parse('2026-09-24T15:00:00Z');
const LINE = '+17576069432';
const PN = 'PN1';
const A = '+17575550142';
const B = '+17575550188';
const C = '+17575550199';

interface State {
  conversations: QuoConversation[];
  calls: Record<string, QuoCall[]>;
  messages: Record<string, QuoMessage[]>;
  transcripts: Record<string, QuoTranscript | null>;
}

const inCall = (id: string, at: number, ai = true): QuoCall => ({ id, direction: 'incoming', status: 'completed', aiHandled: ai ? 'ai-agent' : null, createdAt: new Date(at).toISOString(), answeredAt: null, completedAt: null });
const outCall = (id: string, at: number): QuoCall => ({ ...inCall(id, at), direction: 'outgoing' });
const conv = (id: string, p: string, at: number): QuoConversation => ({ id, phoneNumberId: PN, participants: [p], lastActivityAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString() });
const talk = (caller: string, lines: Array<[string, string]>): QuoTranscript => ({ status: 'completed', dialogue: lines.map(([who, content]) => ({ identifier: who === 'caller' ? caller : LINE, content, userId: null })) });

function fakeQuo(state: State): QuoApi {
  return {
    listPhoneNumbers: async () => [LINE],
    phoneNumbers: async () => [{ id: PN, number: LINE }],
    listConversations: async () => state.conversations,
    listCalls: async ({ participant }) => state.calls[participant] ?? [],
    listMessages: async ({ participant }) => state.messages[participant] ?? [],
    getCallTranscript: async (id) => state.transcripts[id] ?? null,
    listWebhooks: async () => [],
    getWebhook: async () => null,
    createWebhook: async () => { throw new Error('not in this test'); },
    deleteWebhook: async () => {},
  };
}

const facts = (over: Partial<SonaCallFacts>): SonaCallFacts => ({
  wantsEstimate: false, name: null, address: null, city: null, jobType: null, treeDetails: null, powerLines: null,
  emergency: false, requestedTime: null, agentSlips: [], callerType: 'customer', ...over,
});

function harness(state: State, opts: { enabled?: boolean; sendResult?: SendResult; nowMs?: number; booked?: string[]; extractor?: boolean } = {}) {
  const sent: Array<{ from: string; to: string; content: string }> = [];
  let now = opts.nowMs ?? NOON;
  const sender: QuoSender = {
    send: async (i) => { sent.push(i); return opts.sendResult ?? { ok: true, id: `AC-out-${sent.length}`, status: 'queued', conversationId: null }; },
  };
  const { guardrails, legal } = loadAllConfig();
  const engine = new OutreachEngine({
    quo: fakeQuo(state),
    sender,
    guardrails,
    legal,
    extractor: opts.extractor === false ? null : {
      extract: async (t) => facts(/seo|page one of google/i.test(t) ? { callerType: 'solicitor' } : /looking for lashawn/i.test(t) ? { callerType: 'wrong_number' } : { callerType: 'customer', wantsEstimate: true }),
    },
    bookedCallers: () => new Set(opts.booked ?? []),
    enabled: () => opts.enabled ?? false,
    now: () => now,
    sleep: async () => {},
    spacingMs: 0,
  });
  engine.setLine({ phoneNumberId: PN, number: LINE, ownNumbers: [LINE] });
  return { engine, sent, setNow: (ms: number) => { now = ms; }, state };
}

function base(): State {
  return {
    conversations: [conv('CN-A', A, NOON - 2 * DAY)],
    calls: { [A]: [inCall('AC-A1', NOON - 2 * DAY)] },
    messages: {},
    transcripts: { 'AC-A1': talk(A, [['sona', 'Hi, Art-is-Tree.'], ['caller', 'I need an oak looked at in my back yard for an estimate.']]) },
  };
}

describe('the template itself', () => {
  it('carries the business name and the opt-out line and passes every content rule', () => {
    const { engine } = harness(base());
    expect(engine.verifyTemplate()).toEqual({ ok: true, problems: [] });
    expect(engine.template()).toContain('Art-is-Tree');
    expect(engine.template()).toContain('757-319-5131');
    expect(engine.template().toLowerCase()).toContain('reply stop to opt out');
    expect(engine.template().length).toBeLessThanOrEqual(160);
  });

  it('a template that breaks a rule sends NOTHING, by name', async () => {
    const { guardrails, legal } = loadAllConfig();
    const bad = { ...guardrails, afterHoursAndOverflow: { ...guardrails.afterHoursAndOverflow, quoteFollowUpText: 'Art-is-Tree here, tree removal is about $500. Reply STOP to opt out.' } };
    const sent: unknown[] = [];
    const engine = new OutreachEngine({
      quo: fakeQuo(base()), sender: { send: async (i) => { sent.push(i); return { ok: true, id: null, status: null, conversationId: null }; } },
      guardrails: bad, legal, extractor: null, bookedCallers: () => new Set(), enabled: () => true, now: () => NOON, sleep: async () => {}, spacingMs: 0,
    });
    engine.setLine({ phoneNumberId: PN, number: LINE, ownNumbers: [] });
    const tv = engine.verifyTemplate();
    expect(tv.ok).toBe(false);
    expect(tv.problems.join(' ')).toMatch(/no-price/);
    const r = await engine.runCatchup('mike');
    expect(r.ran).toBe(false);
    expect(r.reason).toMatch(/template/);
    expect(sent).toHaveLength(0);
  });
});

describe('who qualifies', () => {
  it('a caller who asked about tree work is texted once, from the Quo line, with the template', async () => {
    const h = harness(base());
    const r = await h.engine.runCatchup('mike');
    await h.engine.drain();
    expect(r).toMatchObject({ ran: true, queued: 1 });
    expect(h.sent).toEqual([{ from: LINE, to: A, content: h.engine.template() }]);
    expect(h.engine.sends()[0]).toMatchObject({ outcome: 'sent', kind: 'catchup', number: A, messageId: 'AC-out-1', status: 'queued' });
  });

  it('a hang-up stays a possible client (spam likely calls could be clients) — texted', async () => {
    const s = base();
    s.transcripts['AC-A1'] = talk(A, [['sona', 'Hi, you have reached Art-is-Tree, how may I help you today?']]);
    const h = harness(s);
    const [c] = await h.engine.buildCandidates();
    expect(c).toMatchObject({ classification: 'unclear', skip: null });
  });

  it('a solicitor and a wrong number are decided by their WORDS, never a label — not texted', async () => {
    const s = base();
    s.conversations.push(conv('CN-B', B, NOON - DAY), conv('CN-C', C, NOON - DAY));
    s.calls[B] = [inCall('AC-B1', NOON - DAY)];
    s.calls[C] = [inCall('AC-C1', NOON - DAY)];
    s.transcripts['AC-B1'] = talk(B, [['sona', 'Hi.'], ['caller', 'We can get you on page one of google with our SEO package today.']]);
    s.transcripts['AC-C1'] = talk(C, [['sona', 'Hi.'], ['caller', 'Yeah I am looking for Lashawn Harper please.']]);
    const h = harness(s);
    const cs = await h.engine.buildCandidates();
    expect(cs.find((c) => c.number === B)).toMatchObject({ classification: 'solicitor', skip: 'not_customer' });
    expect(cs.find((c) => c.number === C)).toMatchObject({ classification: 'wrong_number', skip: 'not_customer' });
    expect(cs.find((c) => c.number === A)!.skip).toBeNull();
  });

  it('STOP in Quo’s own history is permanent — skipped even after a redeploy would have forgotten it', async () => {
    const s = base();
    s.messages[A] = [{ id: 'M1', direction: 'incoming', text: 'STOP', status: 'received', createdAt: new Date(NOON - 20 * DAY).toISOString() }];
    const h = harness(s);
    const [c] = await h.engine.buildCandidates();
    expect(c!.skip).toBe('opted_out');
    expect(isStopText('Stop texting me')).toBe(true);
    expect(isStopText('Can you stop by Tuesday?')).toBe(false);
  });

  it('anyone who already heard from us — Arbo or Mike — in 30 days is not texted again', async () => {
    const s = base();
    s.messages[A] = [{ id: 'M2', direction: 'outgoing', text: 'Hey it is Mike, on my way', status: 'delivered', createdAt: new Date(NOON - 5 * DAY).toISOString() }];
    const h = harness(s);
    expect((await h.engine.buildCandidates())[0]!.skip).toBe('already_texted');
  });

  it('a number we only dialed, a booked estimate, our own line, a group thread, an exclusion — none are texted', async () => {
    const s = base();
    s.conversations.push(conv('CN-B', B, NOON - DAY), conv('CN-C', C, NOON - DAY), { id: 'CN-G', phoneNumberId: PN, participants: [A, B], lastActivityAt: null, updatedAt: null }, conv('CN-L', LINE, NOON));
    s.calls[B] = [outCall('AC-B1', NOON - DAY)];
    s.calls[C] = [inCall('AC-C1', NOON - DAY, false)];
    const h = harness(s, { booked: ['+17575550199'] });
    h.engine.exclude('CN-A');
    const cs = await h.engine.buildCandidates();
    expect(cs.map((c) => [c.number, c.skip])).toEqual([[A, 'excluded'], [B, 'no_inbound'], [C, 'estimate_booked'], [LINE, 'own_number']]);
    expect(cs.some((c) => c.conversationId === 'CN-G')).toBe(false);
  });

  it('a call Arbo cannot read (no model) is held and NAMED, not guessed', async () => {
    const h = harness(base(), { extractor: false });
    expect((await h.engine.buildCandidates())[0]).toMatchObject({ classification: 'unreadable', skip: 'unreadable' });
  });
});

describe('sending', () => {
  it('outside 8am–9pm ET the text is HELD, not dropped, and goes out when the window opens', async () => {
    const twoAm = Date.parse('2026-09-24T06:00:00Z');
    const h = harness(base(), { nowMs: twoAm });
    await h.engine.runCatchup('mike');
    await h.engine.drain();
    expect(h.sent).toHaveLength(0);
    expect(h.engine.status().queued).toBe(1);
    expect(h.engine.status().deferredUntil).not.toBeNull();
    h.setNow(NOON);
    await h.engine.tick();
    expect(h.sent).toHaveLength(1);
    expect(h.engine.status().queued).toBe(0);
  });

  it('re-checks Quo right before sending — a text from Mike in the meantime cancels it', async () => {
    const h = harness(base());
    await h.engine.buildCandidates();
    h.state.messages[A] = [{ id: 'M3', direction: 'outgoing', text: 'Mike here', status: 'sent', createdAt: new Date(NOON).toISOString() }];
    // Queue directly off the already-built list, as the tap would.
    (h.engine as unknown as { enqueue(kind: 'catchup', c: Candidate): void }).enqueue('catchup', h.engine.candidates()[0]!);
    await h.engine.drain();
    expect(h.sent).toHaveLength(0);
    expect(h.engine.sends()[0]).toMatchObject({ outcome: 'blocked', detail: 'already_texted' });
  });

  it('a STOP that arrives on the wire is honored instantly — the queued text dies', async () => {
    const twoAm = Date.parse('2026-09-24T06:00:00Z');
    const h = harness(base(), { nowMs: twoAm });
    await h.engine.runCatchup('mike');
    await h.engine.drain();
    expect(h.engine.status().queued).toBe(1);
    h.engine.noteInbound({ from: A, body: 'STOP' });
    expect(h.engine.status().queued).toBe(0);
    h.setNow(NOON);
    await h.engine.tick();
    expect(h.sent).toHaveLength(0);
  });

  it('Quo refusing the line (texting not registered) pauses everything and is named', async () => {
    const h = harness(base(), { sendResult: { ok: false, reason: 'not_registered', code: '0206400' } });
    await h.engine.runCatchup('mike');
    await h.engine.drain();
    const st = h.engine.status();
    expect(st.paused).toMatchObject({ reason: 'not_registered' });
    expect(st.queued).toBe(1);
    expect(h.engine.sends()[0]).toMatchObject({ outcome: 'refused', detail: 'not_registered' });
  });

  it('follow-ups run only while enabled, only 48h after the inquiry, and use the same template', async () => {
    const s = base();
    s.conversations.push(conv('CN-B', B, NOON - 60 * 60 * 1000));
    s.calls[B] = [inCall('AC-B1', NOON - 60 * 60 * 1000)];
    s.transcripts['AC-B1'] = talk(B, [['sona', 'Hi.'], ['caller', 'I need a stump ground out at my house.']]);
    const off = harness(s);
    expect(await off.engine.followUpTick()).toBe(0);
    expect(off.sent).toHaveLength(0);
    const on = harness(s, { enabled: true });
    expect(await on.engine.followUpTick()).toBe(1);
    await on.engine.drain();
    expect(on.sent.map((x) => x.to)).toEqual([A]); // B called an hour ago — not yet
    expect(on.engine.sends()[0]).toMatchObject({ kind: 'followup', number: A });
  });

  it('delivery receipts update the record; logs carry counts and reasons only (§4.3)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness(base());
    await h.engine.runCatchup('mike');
    await h.engine.drain();
    h.engine.noteDelivery('AC-out-1', 'delivered');
    expect(h.engine.sends()[0]!.status).toBe('delivered');
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('5550142');
    expect(logged).not.toContain('Still interested');
    expect(logged).toContain('text sent');
    spy.mockRestore();
  });
});

describe('HTTP + screens', () => {
  it('without Quo the outreach API refuses by name, and the app names its states', async () => {
    const srv = createServer(createArborRequestHandler());
    await new Promise<void>((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const res = await fetch(`${base}/api/outreach`);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('quo_not_configured');
    srv.close();
    const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
    expect(html).toContain('Send catch-up to ');
    expect(html).toContain('texting registration not approved');
    expect(html).toContain('This is not zero candidates');
    expect(html.indexOf('outreachPanel(false).then')).toBeLessThan(html.indexOf("api('/api/brief?from="));
  });
});
