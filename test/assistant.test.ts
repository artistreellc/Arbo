// R28 (Mike, 2026-10-20): "Make it safe, then set it up" / "put it in the arbo
// app". Pins the server side of the business assistant (a Claude Managed
// Agent): a Quo item starts exactly ONE session; off / not set up start
// nothing and say so by name; at most three sessions work at once; a paused
// tool call becomes an Approval card showing what will really be sent; Mike's
// allow / deny goes back as user.tool_confirmation on the sevt_ id; a second
// decision is a 409; everything survives a restart; no log line carries a
// customer's name, number, address or words; the crew key and the office's
// preview never reach these routes.
//
// Every customer here is fake: SIM- names, 555-01xx numbers, a street that
// does not exist. The Anthropic client is a fake that records every call.
import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { Assistant, MAX_WORKING, quoItemFrom } from '../src/assistant/assistant.js';
import { AssistantStore } from '../src/assistant/store.js';
import { describeToolCall, classify, BODY_LIMIT } from '../src/assistant/describe.js';
import { AssistantApiError, type AgentEvent, type AssistantApi, type CreateSessionInput, type EventStream, type ToolConfirmation } from '../src/assistant/client.js';
import { assistantEnv } from '../src/env.js';

// ─── fakes ────────────────────────────────────────────────────────────────

class Channel {
  private buf: AgentEvent[] = [];
  private waiter: ((r: IteratorResult<AgentEvent>) => void) | null = null;
  private closed = false;
  push(ev: AgentEvent): void {
    if (this.closed) return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: ev, done: false });
    } else this.buf.push(ev);
  }
  close(): void {
    this.closed = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: undefined, done: true });
    }
  }
  iter(): AsyncIterable<AgentEvent> {
    const next = (): Promise<IteratorResult<AgentEvent>> => {
      if (this.buf.length) return Promise.resolve({ value: this.buf.shift()!, done: false });
      if (this.closed) return Promise.resolve({ value: undefined, done: true });
      return new Promise((r) => { this.waiter = r; });
    };
    const stop = (): Promise<IteratorResult<AgentEvent>> => {
      this.close();
      return Promise.resolve({ value: undefined, done: true });
    };
    return { [Symbol.asyncIterator]: () => ({ next, return: stop }) };
  }
}

class FakeApi implements AssistantApi {
  created: CreateSessionInput[] = [];
  sent: Array<{ sessionId: string; confirmation: ToolConfirmation }> = [];
  opened: string[] = [];
  history = new Map<string, AgentEvent[]>();
  channels = new Map<string, Channel>();
  createError: AssistantApiError | null = null;
  sendError: AssistantApiError | null = null;
  private n = 0;
  async createSession(input: CreateSessionInput): Promise<{ id: string }> {
    if (this.createError) throw this.createError;
    this.created.push(input);
    this.n += 1;
    const id = `sesn_sim${this.n}`;
    this.history.set(id, []);
    return { id };
  }
  async sendConfirmation(sessionId: string, confirmation: ToolConfirmation): Promise<void> {
    if (this.sendError) throw this.sendError;
    this.sent.push({ sessionId, confirmation });
  }
  async openStream(id: string): Promise<EventStream> {
    this.opened.push(id);
    const ch = new Channel();
    this.channels.set(id, ch);
    return { events: ch.iter(), close: () => ch.close() };
  }
  async *listEvents(id: string): AsyncIterable<AgentEvent> {
    for (const e of [...(this.history.get(id) ?? [])]) yield e;
  }
  /** The session emits an event: it lands in the history and on any open stream. */
  emit(id: string, ev: AgentEvent): void {
    if (!this.history.has(id)) this.history.set(id, []);
    this.history.get(id)!.push(ev);
    this.channels.get(id)?.push(ev);
  }
}

type Cfg = ReturnType<typeof assistantEnv>;
const READY: Cfg = { on: true, apiKey: 'sim-key', agentId: 'agent_sim', environmentId: 'env_sim', vaultId: 'vlt_sim', budgetCents: 300 };

function make(opts: { cfg?: Partial<Cfg>; dir?: string; now?: () => number; api?: FakeApi } = {}) {
  const api = opts.api ?? new FakeApi();
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), 'arbo-asst-'));
  const a = new Assistant({
    config: () => ({ ...READY, ...opts.cfg }),
    makeApi: () => api,
    store: new AssistantStore(dir),
    ...(opts.now ? { now: opts.now } : {}),
    sleep: async () => {},
  });
  return { a, api, dir };
}

// ─── fake Quo deliveries (SIM people only) ──────────────────────────────

const SIM = { name: 'SIM-Brooks', phone: '+17575550123', email: 'sim.brooks@example.com', street: '14 Simulation Row', words: 'my oak is leaning on the shed' };

const quoText = (evId: string, msgId: string, direction = 'incoming') => JSON.stringify({
  id: evId, object: 'event', createdAt: '2026-10-20T14:00:00.000Z', type: 'message.received',
  data: { object: { id: msgId, conversationId: 'CNsim1', direction, from: SIM.phone, to: '+17576069432', body: `Hi this is ${SIM.name} at ${SIM.street}, ${SIM.words}`, createdAt: '2026-10-20T14:00:00.000Z' } },
});
const quoCall = (evId: string, callId: string, extra: Record<string, unknown>) => JSON.stringify({
  id: evId, type: 'call.completed',
  data: { object: { id: callId, conversationId: 'CNsim2', direction: 'incoming', from: SIM.phone, createdAt: '2026-10-20T15:00:00.000Z', ...extra } },
});
const quoSummary = (evId: string, callId: string) => JSON.stringify({
  id: evId, type: 'call.summary.completed', data: { object: { callId, summary: [`${SIM.name} wants an estimate`], nextSteps: [] } },
});
const quoTranscript = (evId: string, callId: string, status = 'completed') => JSON.stringify({
  id: evId, type: 'call.transcript.completed',
  data: { object: { callId, status, dialogue: status === 'completed' ? [{ identifier: SIM.phone, content: SIM.words }] : null } },
});

const askEmail = (id: string, body = `Hi ${SIM.name}, thanks for calling about ${SIM.street}.`): AgentEvent => ({
  id, type: 'agent.mcp_tool_use', mcp_server_name: 'gmail', name: 'send_message', evaluated_permission: 'ask',
  input: { to: [SIM.email], subject: `Your proposal for ${SIM.street}`, body }, processed_at: '2026-10-20T14:01:00.000Z',
});
const idle = (id: string, type: string): AgentEvent => ({ id, type: 'session.status_idle', stop_reason: { type, ...(type === 'requires_action' ? { event_ids: [] } : {}) } });

// ─── triggers ─────────────────────────────────────────────────────────────

describe('a Quo item starts exactly one session', () => {
  it('an inbound text starts one session named by Quo ids only — a retried delivery starts none', async () => {
    const { a, api } = make();
    a.noteQuoEvent(quoText('EVsim1', 'ACsim1'));
    a.noteQuoEvent(quoText('EVsim1', 'ACsim1')); // Quo retried the same delivery
    await vi.waitFor(() => expect(api.created).toHaveLength(1));
    const s = api.created[0]!;
    expect(s).toMatchObject({ agentId: 'agent_sim', environmentId: 'env_sim', vaultId: 'vlt_sim', budgetCents: 300 });
    expect(s.firstMessage).toContain('an inbound text');
    expect(s.firstMessage).toContain('Quo event id: EVsim1');
    expect(s.firstMessage).toContain('Message id: ACsim1');
    expect(s.firstMessage).toContain('Conversation id: CNsim1');
    expect(s.firstMessage).toContain('Direction: incoming');
    expect(s.firstMessage).toContain('At: 2026-10-20T14:00:00.000Z');
    expect(s.firstMessage.trim().endsWith('Handle this one item per your instructions, then stop.')).toBe(true);
    // The words and the number stay in Quo — the agent reads them itself.
    for (const pii of [SIM.name, SIM.phone, SIM.street, SIM.words]) {
      expect(s.firstMessage).not.toContain(pii);
      expect(s.title).not.toContain(pii);
      expect(JSON.stringify(s.metadata)).not.toContain(pii);
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(api.created).toHaveLength(1);
  });

  it("one call is one session: its summary AND transcript never start two", async () => {
    const { a, api } = make();
    a.noteQuoEvent(quoCall('EVc1', 'ACcall1', { status: 'completed', answeredAt: '2026-10-20T15:00:05.000Z', completedAt: '2026-10-20T15:03:00.000Z' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.created).toHaveLength(0); // an answered call waits for its summary/transcript
    a.noteQuoEvent(quoTranscript('EVt0', 'ACcall1', 'in-progress')); // not finished yet — not a trigger
    await new Promise((r) => setTimeout(r, 20));
    expect(api.created).toHaveLength(0);
    a.noteQuoEvent(quoSummary('EVs1', 'ACcall1'));
    a.noteQuoEvent(quoTranscript('EVt1', 'ACcall1'));
    await vi.waitFor(() => expect(api.created).toHaveLength(1));
    expect(api.created[0]!.firstMessage).toContain("a finished call's summary");
    expect(api.created[0]!.firstMessage).toContain('Call id: ACcall1');
    expect(api.created[0]!.firstMessage).toContain('Direction: incoming'); // learned from call.completed
    await new Promise((r) => setTimeout(r, 20));
    expect(api.created).toHaveLength(1);
  });

  it('a missed call starts one; an outgoing text and a delivery receipt start none', async () => {
    const { a, api } = make();
    a.noteQuoEvent(quoCall('EVm1', 'ACmissed1', { status: 'missed', answeredAt: null }));
    a.noteQuoEvent(quoText('EVo1', 'ACout1', 'outgoing'));
    a.noteQuoEvent(JSON.stringify({ id: 'EVd1', type: 'message.delivered', data: { object: { id: 'ACout1', direction: 'outgoing', status: 'delivered' } } }));
    a.noteQuoEvent('not json at all');
    await vi.waitFor(() => expect(api.created).toHaveLength(1));
    expect(api.created[0]!.firstMessage).toContain('a missed call');
    expect(api.created[0]!.firstMessage).toContain('Call status: missed');
    await new Promise((r) => setTimeout(r, 20));
    expect(api.created).toHaveLength(1);
  });

  it('quoItemFrom ignores what it does not know', () => {
    const calls = new Map();
    expect(quoItemFrom(null, calls)).toBeNull();
    expect(quoItemFrom({ type: 'contact.updated', data: { object: { id: 'x' } } }, calls)).toBeNull();
    expect(quoItemFrom({ type: 'message.received', data: { object: {} } }, calls)).toBeNull();
  });
});

describe('off and not set up start nothing — and say so by name', () => {
  it('OFF: no session from a Quo event or the clock; the routes answer 503 assistant_off', async () => {
    const { a, api } = make({ cfg: { on: false } });
    a.noteQuoEvent(quoText('EVoff', 'ACoff'));
    a.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.created).toHaveLength(0);
    const st = a.status();
    expect(st.state).toBe('off');
    expect(st.reason).toMatch(/ARBO_AGENT/);
    expect(a.approvals()).toEqual({ status: 503, body: { error: 'assistant_off' } });
    expect(a.activity()).toEqual({ status: 503, body: { error: 'assistant_off' } });
    expect(await a.decide('sevt_x', 'allow')).toEqual({ status: 503, body: { error: 'assistant_off' } });
    expect(a.store.data.processed).toEqual([]); // not even remembered as handled
  });

  it('NOT SET UP: missing NAMES listed (never values); nothing starts', async () => {
    const { a, api } = make({ cfg: { agentId: undefined, vaultId: undefined, budgetCents: null } });
    a.noteQuoEvent(quoText('EVn', 'ACn'));
    a.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.created).toHaveLength(0);
    const st = a.status();
    expect(st.state).toBe('not_set_up');
    expect(st.missing).toEqual(['ARBO_AGENT_ID', 'ARBO_AGENT_VAULT_ID', 'ARBO_AGENT_SESSION_BUDGET_USD']);
    expect(st.reason).toContain('ARBO_AGENT_ID');
    expect(JSON.stringify(st)).not.toContain('sim-key');
    expect(a.approvals()).toEqual({ status: 503, body: { error: 'assistant_not_set_up' } });
  });

  it('the switch is exactly "live", read raw like ARBO_DATA_LINKS; the budget defaults to $3', () => {
    const saved = { ...process.env };
    try {
      for (const v of ['LIVE', 'true', ' live', 'live ', '', 'on']) {
        process.env.ARBO_AGENT = v;
        expect(assistantEnv().on, JSON.stringify(v)).toBe(false);
      }
      delete process.env.ARBO_AGENT;
      expect(assistantEnv().on).toBe(false);
      process.env.ARBO_AGENT = 'live';
      expect(assistantEnv().on).toBe(true);
      delete process.env.ARBO_AGENT_SESSION_BUDGET_USD;
      expect(assistantEnv().budgetCents).toBe(300);
      process.env.ARBO_AGENT_SESSION_BUDGET_USD = '4.50';
      expect(assistantEnv().budgetCents).toBe(450);
      for (const bad of ['0', '-1', 'three', '1.234', '$3']) {
        process.env.ARBO_AGENT_SESSION_BUDGET_USD = bad;
        expect(assistantEnv().budgetCents, bad).toBeNull();
      }
    } finally {
      process.env = saved;
    }
  });
});

describe('at most three sessions work at once; the rest wait their turn, in order', () => {
  it('the 4th and 5th start only as earlier ones stop working', async () => {
    const { a, api } = make();
    for (let i = 1; i <= 5; i++) a.noteQuoEvent(quoText(`EVcap${i}`, `ACcap${i}`));
    await vi.waitFor(() => expect(api.created).toHaveLength(MAX_WORKING));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.created).toHaveLength(3);
    expect(a.store.data.queue).toHaveLength(2);
    expect(a.status().sessionsOpen).toBe(3);
    // Session 1 parks on Mike's OK — it no longer works, so the 4th starts.
    api.emit('sesn_sim1', askEmail('sevt_cap1'));
    api.emit('sesn_sim1', idle('sevt_cap1i', 'requires_action'));
    await vi.waitFor(() => expect(api.created).toHaveLength(4));
    expect(api.created[3]!.firstMessage).toContain('ACcap4');
    // Session 2 finishes — the 5th starts.
    api.emit('sesn_sim2', idle('sevt_cap2i', 'end_turn'));
    await vi.waitFor(() => expect(api.created).toHaveLength(5));
    expect(api.created[4]!.firstMessage).toContain('ACcap5');
    expect(a.store.data.queue).toHaveLength(0);
    // Open = working + waiting on Mike; the finished one is not open.
    expect(a.status().sessionsOpen).toBe(4);
  });
});

// ─── approvals ────────────────────────────────────────────────────────────

describe("a paused tool call becomes an Approval card showing what will really happen", () => {
  it('an ask on gmail.send_message: kind email, the real recipient, subject and body', async () => {
    const { a, api } = make();
    a.noteQuoEvent(quoText('EVa1', 'ACa1'));
    await vi.waitFor(() => expect(api.created).toHaveLength(1));
    api.emit('sesn_sim1', { id: 'sevt_used', type: 'agent.mcp_tool_use', mcp_server_name: 'quo', name: 'fetch-messages', evaluated_permission: 'allow', input: {} });
    api.emit('sesn_sim1', askEmail('sevt_mail1'));
    api.emit('sesn_sim1', idle('sevt_idle1', 'requires_action'));
    await vi.waitFor(() => expect((a.approvals().body as { approvals: unknown[] }).approvals).toHaveLength(1));
    const [ap] = (a.approvals().body as { approvals: Array<Record<string, unknown>> }).approvals;
    expect(ap).toMatchObject({
      id: 'sevt_mail1',
      sessionId: 'sesn_sim1',
      tool: 'gmail.send_message',
      kind: 'email',
      summary: `Email ${SIM.email}: Your proposal for ${SIM.street}`,
      requestedAt: '2026-10-20T14:01:00.000Z',
    });
    expect(ap!.details).toEqual(expect.arrayContaining([
      { label: 'To', value: SIM.email },
      { label: 'Subject', value: `Your proposal for ${SIM.street}` },
      { label: 'Body', value: `Hi ${SIM.name}, thanks for calling about ${SIM.street}.` },
    ]));
    const items = (a.activity().body as { items: Array<{ kind: string; tool?: string; permission?: string; text: string }> }).items;
    expect(items[0]).toMatchObject({ kind: 'waiting', tool: 'gmail.send_message', permission: 'ask' });
    expect(items.find((i) => i.kind === 'tool')).toMatchObject({ tool: 'quo.fetch-messages', permission: 'allow' });
    expect(items.at(-1)).toMatchObject({ kind: 'started' });
    expect(a.store.data.sessions[0]!.state).toBe('waiting');
  });

  it('kinds come from the MCP server and tool: email / payment / text / drive / calendar / other', () => {
    expect(classify('gmail', 'send_message')).toBe('email');
    expect(classify('Gmail', 'reply')).toBe('email');
    expect(classify('gmail', 'forward')).toBe('email');
    expect(classify('gmail', 'create_draft')).toBe('other');
    expect(classify('square', 'make_api_request')).toBe('payment');
    expect(classify('quo', 'send-message')).toBe('text');
    expect(classify('quo', 'send-bulk-messages')).toBe('text');
    expect(classify('quo', 'create-contact')).toBe('other');
    expect(classify('quo', 'create-contact-note')).toBe('other');
    expect(classify('quo', 'update-task')).toBe('other');
    expect(classify('google-drive', 'create_file')).toBe('drive');
    expect(classify('google-calendar', 'create_event')).toBe('calendar');
    expect(classify(undefined, 'bash')).toBe('other');
  });

  it('text, payment, drive and calendar cards carry what Mike decides on', () => {
    const text = describeToolCall({ mcp_server_name: 'quo', name: 'send-message', input: { from: '+17576069432', to: '+17575550142', content: 'Hi SIM-Ortiz, this is Art-is-Tree. Reply STOP to opt out.' } });
    expect(text.kind).toBe('text');
    expect(text.summary).toBe('Text +17575550142: Hi SIM-Ortiz, this is Art-is-Tree. Reply STOP to opt out.');
    expect(text.details).toEqual(expect.arrayContaining([{ label: 'Number', value: '+17575550142' }, { label: 'From', value: '+17576069432' }, { label: 'Message', value: 'Hi SIM-Ortiz, this is Art-is-Tree. Reply STOP to opt out.' }]));

    const pay = describeToolCall({ mcp_server_name: 'square', name: 'make_api_request', input: { service: 'invoices', method: 'create', request: { invoice: { primary_recipient: { customer_id: 'CUSTsim1' }, payment_requests: [{ computed_amount_money: { amount: 125000, currency: 'USD' } }] } } } });
    expect(pay.kind).toBe('payment');
    expect(pay.summary).toBe('Square: invoices create — $1250.00');
    expect(pay.details).toEqual(expect.arrayContaining([{ label: 'Amount', value: '$1250.00' }, { label: 'Customer', value: 'CUSTsim1' }]));
    expect(pay.details.find((d) => d.label === 'Request')!.value).toContain('CUSTsim1');

    const drive = describeToolCall({ mcp_server_name: 'drive', name: 'create_file', input: { title: 'SIM-Brooks visit notes', parentId: 'FOLDERsim', textContent: 'Oak by the shed.' } });
    expect(drive).toMatchObject({ kind: 'drive', summary: 'Drive: create “SIM-Brooks visit notes”' });
    expect(drive.details).toEqual(expect.arrayContaining([{ label: 'Folder', value: 'FOLDERsim' }, { label: 'Text', value: 'Oak by the shed.' }]));
    expect(describeToolCall({ mcp_server_name: 'drive', name: 'share_file', input: { fileId: 'Fsim' } }).details.some((d) => d.label === 'Heads-up')).toBe(true);

    const cal = describeToolCall({ mcp_server_name: 'calendar', name: 'create_event', input: { summary: 'Estimate — SIM-Brooks', startTime: '2026-10-24T09:00:00', endTime: '2026-10-24T09:30:00', location: SIM.street } });
    expect(cal).toMatchObject({ kind: 'calendar', summary: 'Calendar: Estimate — SIM-Brooks — 2026-10-24T09:00:00' });
    expect(cal.details).toEqual(expect.arrayContaining([{ label: 'Where', value: SIM.street }, { label: 'End', value: '2026-10-24T09:30:00' }]));
    expect(describeToolCall({ mcp_server_name: 'calendar', name: 'update_event', input: { eventId: 'Esim' } }).details.some((d) => d.label === 'Heads-up' && /never edits/.test(d.value))).toBe(true);
  });

  it('a reply with no "to" names who gets it; a saved draft says its words are not shown; unknown fields are still listed', () => {
    const reply = describeToolCall({ mcp_server_name: 'gmail', name: 'reply', input: { messageId: 'MSGsim', body: 'Thanks!' } });
    expect(reply.summary).toBe('Reply to email MSGsim');
    expect(reply.details.find((d) => d.label === 'To')!.value).toMatch(/sender of message MSGsim/);
    const draft = describeToolCall({ mcp_server_name: 'gmail', name: 'send_message', input: { draftId: 'DRsim' } });
    expect(draft.summary).toBe('Send saved Gmail draft DRsim');
    expect(draft.details.find((d) => d.label === 'Heads-up')!.value).toMatch(/NOT in this request/);
    const odd = describeToolCall({ mcp_server_name: 'quo', name: 'send-message', input: { to: '+17575550142', content: 'hi', scheduleAt: '2026-10-21T13:00:00Z' } });
    expect(odd.details).toContainEqual({ label: 'scheduleAt', value: '2026-10-21T13:00:00Z' });
  });

  it('a long body is cut at 4,000 characters with a mark; a dollar figure to a customer raises a heads-up', () => {
    const long = 'x'.repeat(BODY_LIMIT + 500);
    const card = describeToolCall({ mcp_server_name: 'gmail', name: 'send_message', input: { to: [SIM.email], subject: 'Hi', body: long } });
    const body = card.details.find((d) => d.label === 'Body')!.value;
    expect(body.startsWith('x'.repeat(BODY_LIMIT))).toBe(true);
    expect(body).toContain('[truncated — 500 more characters not shown]');
    expect(body.length).toBeLessThan(BODY_LIMIT + 100);
    const money = describeToolCall({ mcp_server_name: 'quo', name: 'send-message', input: { to: '+17575550142', content: 'Our minimum is $500.' } });
    expect(money.details.find((d) => d.label === 'Heads-up')!.value).toMatch(/never tells a customer a price/);
  });

  it('a text card read outside 8am–9pm ET carries the quiet-hours heads-up (worked out when Mike looks)', async () => {
    let now = Date.parse('2026-10-21T02:30:00.000Z'); // 10:30 PM ET
    const { a, api } = make({ now: () => now });
    a.noteQuoEvent(quoText('EVq', 'ACq'));
    await vi.waitFor(() => expect(api.created).toHaveLength(1));
    api.emit('sesn_sim1', { id: 'sevt_txt', type: 'agent.mcp_tool_use', mcp_server_name: 'quo', name: 'send-message', evaluated_permission: 'ask', input: { to: '+17575550142', content: 'hello' } });
    await vi.waitFor(() => expect((a.approvals().body as { approvals: unknown[] }).approvals).toHaveLength(1));
    const late = (a.approvals().body as { approvals: Array<{ details: Array<{ label: string; value: string }> }> }).approvals[0]!;
    expect(late.details.find((d) => d.label === 'Heads-up')!.value).toMatch(/TCPA quiet hours/);
    now = Date.parse('2026-10-21T14:00:00.000Z'); // 10:00 AM ET
    const day = (a.approvals().body as { approvals: Array<{ details: Array<{ label: string }> }> }).approvals[0]!;
    expect(day.details.some((d) => d.label === 'Heads-up')).toBe(false);
  });
});

describe("Mike's decision goes back as user.tool_confirmation on the sevt_ id", () => {
  async function withTwoAsks() {
    const made = make();
    made.a.noteQuoEvent(quoText('EVd1', 'ACd1'));
    await vi.waitFor(() => expect(made.api.created).toHaveLength(1));
    made.api.emit('sesn_sim1', askEmail('sevt_one'));
    made.api.emit('sesn_sim1', { id: 'sevt_two', type: 'agent.mcp_tool_use', mcp_server_name: 'quo', name: 'send-message', evaluated_permission: 'ask', input: { to: '+17575550142', content: 'hi' } });
    made.api.emit('sesn_sim1', idle('sevt_i', 'requires_action'));
    await vi.waitFor(() => expect((made.a.approvals().body as { approvals: unknown[] }).approvals).toHaveLength(2));
    return made;
  }

  it('allow sends {tool_use_id: sevt, result: allow}; a second decision is 409; an unknown id is 404', async () => {
    const { a, api } = await withTwoAsks();
    expect(await a.decide('sevt_one', 'allow')).toEqual({ status: 200, body: { ok: true } });
    expect(api.sent).toEqual([{ sessionId: 'sesn_sim1', confirmation: { type: 'user.tool_confirmation', tool_use_id: 'sevt_one', result: 'allow' } }]);
    expect(await a.decide('sevt_one', 'deny')).toEqual({ status: 409, body: { error: 'already_decided' } });
    expect(await a.decide('sevt_nope', 'allow')).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(api.sent).toHaveLength(1);
    const left = (a.approvals().body as { approvals: Array<{ id: string }> }).approvals;
    expect(left.map((x) => x.id)).toEqual(['sevt_two']);
    const items = (a.activity().body as { items: Array<{ kind: string; text: string }> }).items;
    expect(items[0]).toMatchObject({ kind: 'decided' });
    expect(items[0]!.text).toMatch(/^You allowed: Email/);
  });

  it('deny carries the note as deny_message', async () => {
    const { a, api } = await withTwoAsks();
    expect(await a.decide('sevt_two', 'deny', 'Not tonight — text them at 9am')).toEqual({ status: 200, body: { ok: true } });
    expect(api.sent[0]).toEqual({ sessionId: 'sesn_sim1', confirmation: { type: 'user.tool_confirmation', tool_use_id: 'sevt_two', result: 'deny', deny_message: 'Not tonight — text them at 9am' } });
  });

  it('a failed send is a 502 with a line, and the approval is still waiting', async () => {
    const { a, api } = await withTwoAsks();
    api.sendError = new AssistantApiError(500, 'upstream');
    const r = await a.decide('sevt_one', 'allow');
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ error: 'send_failed' });
    expect((r.body as { line: string }).line).toMatch(/still waiting/);
    expect((a.approvals().body as { approvals: unknown[] }).approvals).toHaveLength(2);
    api.sendError = null;
    expect((await a.decide('sevt_one', 'allow')).status).toBe(200);
  });

  it('a decision made elsewhere (the Console) is seen on the stream and closes the card', async () => {
    const { a, api } = await withTwoAsks();
    api.emit('sesn_sim1', { id: 'sevt_conf', type: 'user.tool_confirmation', tool_use_id: 'sevt_two', result: 'deny' });
    await vi.waitFor(() => expect((a.approvals().body as { approvals: unknown[] }).approvals).toHaveLength(1));
    expect(await a.decide('sevt_two', 'allow')).toEqual({ status: 409, body: { error: 'already_decided' } });
  });

  it('the session finishing, failing, or stopping at its budget is named in the activity', async () => {
    const { a, api } = make();
    for (let i = 1; i <= 3; i++) a.noteQuoEvent(quoText(`EVf${i}`, `ACf${i}`));
    await vi.waitFor(() => expect(api.created).toHaveLength(3));
    api.emit('sesn_sim1', { id: 'sevt_m', type: 'agent.message', content: [{ type: 'text', text: 'Drafted a reply for Mike to approve.' }] });
    api.emit('sesn_sim1', idle('sevt_e1', 'end_turn'));
    api.emit('sesn_sim2', { id: 'sevt_err', type: 'session.error', error: { type: 'mcp_authentication_failed_error', mcp_server_name: 'gmail', message: 'token expired' } });
    api.emit('sesn_sim2', idle('sevt_e2', 'retries_exhausted'));
    api.emit('sesn_sim3', idle('sevt_e3', 'budget_reached'));
    await vi.waitFor(() => expect(a.store.data.sessions.every((s) => s.state === 'done' || s.state === 'error')).toBe(true));
    const items = (a.activity().body as { items: Array<{ sessionId: string; kind: string; text: string }> }).items;
    expect(items.find((i) => i.sessionId === 'sesn_sim1' && i.kind === 'message')!.text).toBe('Drafted a reply for Mike to approve.');
    expect(items.find((i) => i.sessionId === 'sesn_sim1' && i.kind === 'done')).toBeTruthy();
    expect(items.find((i) => i.sessionId === 'sesn_sim2' && i.kind === 'error' && /mcp_authentication_failed_error \(gmail\)/.test(i.text))).toBeTruthy();
    expect(items.find((i) => i.sessionId === 'sesn_sim2' && i.kind === 'error' && /gave up/.test(i.text))).toBeTruthy();
    expect(items.find((i) => i.sessionId === 'sesn_sim3' && /\$3\.00 budget/.test(i.text))).toBeTruthy();
    expect(a.store.data.sessions.map((s) => s.state)).toEqual(['done', 'error', 'error']);
    expect(a.status().sessionsOpen).toBe(0);
  });

  it('a send that ran WITHOUT asking (a wrong permission policy) is named — reads are not', async () => {
    const { a, api } = make();
    a.noteQuoEvent(quoText('EVw', 'ACw'));
    await vi.waitFor(() => expect(api.created).toHaveLength(1));
    const ran = (id: string, server: string, name: string, input: Record<string, unknown> = {}): AgentEvent => ({ id, type: 'agent.mcp_tool_use', mcp_server_name: server, name, evaluated_permission: 'allow', input });
    api.emit('sesn_sim1', ran('sevt_r1', 'quo', 'fetch-messages'));
    api.emit('sesn_sim1', ran('sevt_r2', 'square', 'make_api_request', { service: 'invoices', method: 'list' }));
    api.emit('sesn_sim1', ran('sevt_r3', 'drive', 'search_files'));
    api.emit('sesn_sim1', ran('sevt_r4', 'gmail', 'send_message', { to: [SIM.email] }));
    api.emit('sesn_sim1', ran('sevt_r5', 'square', 'make_api_request', { service: 'payments', method: 'create' }));
    await vi.waitFor(() => expect(a.store.data.sessions[0]!.seen).toContain('sevt_r5'));
    const warned = (a.activity().body as { items: Array<{ kind: string; tool?: string; text: string }> }).items.filter((i) => i.kind === 'error' && /WITHOUT your OK/.test(i.text));
    expect(warned.map((w) => w.tool).sort()).toEqual(['gmail.send_message', 'square.make_api_request']);
  });

  it("a card whose session has truly ended is closed by name on the decision, not left waiting forever", async () => {
    const { a, api } = make();
    a.noteQuoEvent(quoText('EVg', 'ACg'));
    await vi.waitFor(() => expect(api.created).toHaveLength(1));
    api.emit('sesn_sim1', askEmail('sevt_dead'));
    api.emit('sesn_sim1', { id: 'sevt_term', type: 'session.status_terminated' });
    await vi.waitFor(() => expect(a.store.data.sessions[0]!.state).toBe('done'));
    expect((a.approvals().body as { approvals: unknown[] }).approvals).toHaveLength(1); // kept when the session ended
    api.sendError = new AssistantApiError(400, 'session is terminated');
    const r = await a.decide('sevt_dead', 'allow');
    expect(r.status).toBe(502);
    expect((r.body as { line: string }).line).toMatch(/session has ended, so nothing was sent/);
    expect((a.approvals().body as { approvals: unknown[] }).approvals).toHaveLength(0);
    expect((a.activity().body as { items: Array<{ text: string }> }).items[0]!.text).toMatch(/^Closed without sending/);
    expect((await a.decide('sevt_dead', 'allow')).status).toBe(404);
  });

  it('a dropped stream reconnects and the history fills the gap — nothing is lost or repeated', async () => {
    const { a, api } = make();
    a.noteQuoEvent(quoText('EVr', 'ACr'));
    await vi.waitFor(() => expect(api.opened).toEqual(['sesn_sim1']));
    api.emit('sesn_sim1', askEmail('sevt_before'));
    await vi.waitFor(() => expect((a.approvals().body as { approvals: unknown[] }).approvals).toHaveLength(1));
    // The stream drops; while Arbo is away the agent asks again.
    api.channels.get('sesn_sim1')!.close();
    api.history.get('sesn_sim1')!.push(askEmail('sevt_during_gap', 'Second note.'));
    await vi.waitFor(() => expect(api.opened.length).toBeGreaterThanOrEqual(2));
    await vi.waitFor(() => expect((a.approvals().body as { approvals: unknown[] }).approvals).toHaveLength(2));
    const waiting = (a.activity().body as { items: Array<{ kind: string }> }).items.filter((i) => i.kind === 'waiting');
    expect(waiting).toHaveLength(2);
  });
});

// ─── persistence ──────────────────────────────────────────────────────────

describe('it survives a restart', () => {
  it('approvals, activity and handled events reload; sessions still open are re-attached; the file is owner-only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbo-asst-'));
    const first = make({ dir });
    first.a.noteQuoEvent(quoText('EVp1', 'ACp1'));
    await vi.waitFor(() => expect(first.api.created).toHaveLength(1));
    first.api.emit('sesn_sim1', askEmail('sevt_keep'));
    first.api.emit('sesn_sim1', idle('sevt_ki', 'requires_action'));
    await vi.waitFor(() => expect(first.a.store.data.sessions[0]!.state).toBe('waiting'));
    expect(statSync(join(dir, 'assistant.json')).mode & 0o777).toBe(0o600);

    // A redeploy: new process, same disk, same session history at Anthropic.
    const api2 = new FakeApi();
    api2.history.set('sesn_sim1', [...first.api.history.get('sesn_sim1')!]);
    const second = make({ dir, api: api2 });
    const ap = (second.a.approvals().body as { approvals: Array<{ id: string; summary: string }> }).approvals;
    expect(ap.map((x) => x.id)).toEqual(['sevt_keep']);
    expect((second.a.activity().body as { items: unknown[] }).items.length).toBeGreaterThan(0);
    second.a.start();
    await vi.waitFor(() => expect(api2.opened).toContain('sesn_sim1'));
    await new Promise((r) => setTimeout(r, 20));
    // The replayed history did not repeat the card or its activity line.
    expect((second.a.approvals().body as { approvals: unknown[] }).approvals).toHaveLength(1);
    expect((second.a.activity().body as { items: Array<{ kind: string }> }).items.filter((i) => i.kind === 'waiting')).toHaveLength(1);
    // The same Quo event after the restart starts nothing new.
    second.a.noteQuoEvent(quoText('EVp1', 'ACp1'));
    await new Promise((r) => setTimeout(r, 20));
    expect(api2.created.filter((c) => c.firstMessage.includes('ACp1'))).toHaveLength(0);
    // And Mike's decision still reaches the session.
    expect(await second.a.decide('sevt_keep', 'allow')).toEqual({ status: 200, body: { ok: true } });
    expect(api2.sent[0]!.confirmation.tool_use_id).toBe('sevt_keep');
  });

  it('a store that cannot be read is NOT treated as empty: nothing starts, the routes say unreadable, the file is untouched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbo-asst-'));
    writeFileSync(join(dir, 'assistant.json'), '{not json');
    const { a, api } = make({ dir });
    a.noteQuoEvent(quoText('EVu', 'ACu'));
    a.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.created).toHaveLength(0);
    expect(a.status()).toMatchObject({ state: 'error' });
    expect(a.status().reason).toMatch(/could not read/);
    expect(a.approvals()).toEqual({ status: 503, body: { error: 'unreadable' } });
    expect(a.activity()).toEqual({ status: 503, body: { error: 'unreadable' } });
    expect(readFileSync(join(dir, 'assistant.json'), 'utf8')).toBe('{not json');
  });
});

// ─── status + clock ───────────────────────────────────────────────────────

describe('status names every state', () => {
  it("ready → error with Anthropic's answer named → ready again once a start succeeds", async () => {
    let now = Date.parse('2026-10-21T03:00:00.000Z'); // 11 PM ET — outside the sweep window, so only the Quo item starts
    const { a, api } = make({ now: () => now });
    expect(a.status()).toEqual({ state: 'ready', missing: [], reason: null, sessionsOpen: 0, lastEventAt: null });
    api.createError = new AssistantApiError(401, 'invalid x-api-key');
    a.noteQuoEvent(quoText('EVs', 'ACs'));
    await vi.waitFor(() => expect(a.status().state).toBe('error'));
    expect(a.status().reason).toBe('Anthropic answered 401 — check ANTHROPIC_API_KEY');
    expect(a.store.data.queue).toHaveLength(1); // kept, not dropped
    api.createError = null;
    a.tick(); // still backing off
    await new Promise((r) => setTimeout(r, 20));
    expect(api.created).toHaveLength(0);
    now += 61_000;
    a.tick();
    await vi.waitFor(() => expect(api.created).toHaveLength(1));
    expect(a.status().state).toBe('ready');
    expect(a.status().sessionsOpen).toBe(1);
  });
});

describe('the clock: a sweep every 30 minutes 7am–9pm ET, crew routes at 6:30am ET', () => {
  it('starts each on time, names the window since the last sweep, and never doubles up', async () => {
    let now = Date.parse('2026-10-20T10:31:00.000Z'); // 6:31 AM EDT
    const { a, api } = make({ now: () => now });
    a.tick();
    await vi.waitFor(() => expect(api.created).toHaveLength(1));
    expect(api.created[0]!.firstMessage).toBe("Prepare each crew's route summary for today and request approval to text it.");
    now = Date.parse('2026-10-20T10:45:00.000Z');
    a.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.created).toHaveLength(1); // once a day, and no sweep before 7
    now = Date.parse('2026-10-20T11:00:00.000Z'); // 7:00 AM
    a.tick();
    await vi.waitFor(() => expect(api.created).toHaveLength(2));
    expect(api.created[1]!.firstMessage).toBe('Check Gmail (including website form emails) and Quo for anything new since 2026-10-20T10:30:00.000Z that no earlier session handled; handle each, then stop.');
    now = Date.parse('2026-10-20T11:20:00.000Z');
    a.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.created).toHaveLength(2);
    now = Date.parse('2026-10-20T11:30:00.000Z'); // 7:30 AM — but the 7:00 sweep is still working
    a.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.created).toHaveLength(2); // one sweep at a time
    api.emit('sesn_sim2', idle('sevt_sw1', 'end_turn'));
    await vi.waitFor(() => expect(a.store.data.sessions[1]!.state).toBe('done'));
    now = Date.parse('2026-10-20T11:31:00.000Z');
    a.tick();
    await vi.waitFor(() => expect(api.created).toHaveLength(3));
    expect(api.created[2]!.firstMessage).toContain('since 2026-10-20T11:00:00.000Z');
    now = Date.parse('2026-10-21T01:31:00.000Z'); // 9:31 PM — after the window
    a.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.created).toHaveLength(3);
  });
});

// ─── logs ─────────────────────────────────────────────────────────────────

describe('logs carry counts and ids only (§4.3)', () => {
  afterEach(() => vi.restoreAllMocks());
  it("no log line holds a customer's name, number, email, address or words", async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => { lines.push(args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
    vi.spyOn(console, 'warn').mockImplementation(capture);
    vi.spyOn(console, 'info').mockImplementation(capture);
    const { a, api } = make();
    a.noteQuoEvent(quoText('EVl', 'ACl'));
    a.noteQuoEvent(quoCall('EVl2', 'ACl2', { status: 'missed' }));
    await vi.waitFor(() => expect(api.created).toHaveLength(2));
    api.emit('sesn_sim1', askEmail('sevt_l1'));
    api.emit('sesn_sim1', { id: 'sevt_l2', type: 'agent.mcp_tool_use', mcp_server_name: 'quo', name: 'send-message', evaluated_permission: 'ask', input: { to: SIM.phone, content: `Hi ${SIM.name}, about ${SIM.words}` } });
    api.emit('sesn_sim1', { id: 'sevt_l3', type: 'agent.message', content: [{ type: 'text', text: `${SIM.name} at ${SIM.street} wants a quote` }] });
    api.emit('sesn_sim1', { id: 'sevt_l4', type: 'session.error', error: { type: 'unknown_error', message: `failed for ${SIM.email}` } });
    api.emit('sesn_sim1', { id: 'sevt_l4b', type: 'agent.mcp_tool_use', mcp_server_name: 'gmail', name: 'send_message', evaluated_permission: 'allow', input: { to: [SIM.email], body: SIM.words } });
    api.emit('sesn_sim1', idle('sevt_l5', 'requires_action'));
    await vi.waitFor(() => expect((a.approvals().body as { approvals: unknown[] }).approvals).toHaveLength(2));
    await a.decide('sevt_l1', 'deny', `${SIM.name} asked us not to email`);
    api.sendError = new AssistantApiError(400, `bad request for ${SIM.phone}`);
    await a.decide('sevt_l2', 'allow');
    api.emit('sesn_sim2', idle('sevt_l6', 'end_turn'));
    await vi.waitFor(() => expect(a.store.data.sessions[1]!.state).toBe('done'));
    a.noteQuoEvent('{"type": "message.received", "data": {"object": "' + SIM.name + '"}}');
    expect(lines.length).toBeGreaterThan(3);
    const all = lines.join('\n');
    for (const pii of [SIM.name, SIM.phone, '5550123', SIM.email, SIM.street, SIM.words]) expect(all, pii).not.toContain(pii);
    expect(all).toMatch(/\[assistant\] session sesn_sim1 started \(quo text\)/);
    expect(all).toMatch(/approval\(s\) waiting/);
    expect(all).toMatch(/WARNING sesn_sim1: gmail\.send_message \(email\) ran without approval/);
  });
});

// ─── routes ───────────────────────────────────────────────────────────────

const saved = { ...process.env };
afterAll(() => { process.env = { ...saved }; vi.resetModules(); });

async function serve(envOverrides: Record<string, string | undefined>, assistant: Assistant): Promise<{ base: string; srv: Server }> {
  vi.resetModules();
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { createArborRequestHandler } = await import('../src/server.js');
  const srv = createServer(createArborRequestHandler({ assistant }));
  await new Promise<void>((r) => srv.listen(0, r));
  const addr = srv.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, srv };
}

describe('the routes: owner key only', () => {
  const call = (base: string, method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  it('the owner key reads status, approvals and activity and decides; the crew key and the preview are refused', async () => {
    const { a, api } = make();
    a.noteQuoEvent(quoText('EVrt', 'ACrt'));
    await vi.waitFor(() => expect(api.created).toHaveLength(1));
    api.emit('sesn_sim1', askEmail('sevt_route'));
    await vi.waitFor(() => expect((a.approvals().body as { approvals: unknown[] }).approvals).toHaveLength(1));
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', ARBO_DATA_LINKS: undefined }, a);
    try {
      for (const [m, p] of [['GET', '/api/assistant/status'], ['GET', '/api/assistant/approvals'], ['GET', '/api/assistant/activity'], ['POST', '/api/assistant/approvals/sevt_route']] as const) {
        const crew = await call(base, m, p, { 'x-arbor-key': 'crew-k' }, m === 'POST' ? { decision: 'allow' } : undefined);
        expect(crew.status, `crew ${p}`).toBe(401);
        const none = await call(base, m, p, {}, m === 'POST' ? { decision: 'allow' } : undefined);
        expect(none.status, `no key ${p}`).toBe(401);
        const preview = await call(base, m, p, { 'x-arbor-key': 'admin-k', 'x-arbo-preview': '1' }, m === 'POST' ? { decision: 'allow' } : undefined);
        expect(preview.status, `preview ${p}`).toBe(403);
        expect(await preview.json()).toEqual({ error: 'preview_read_only' });
      }
      expect(api.sent).toHaveLength(0); // none of those reached Anthropic

      const st = await call(base, 'GET', '/api/assistant/status', { 'x-arbor-key': 'admin-k' });
      expect(st.status).toBe(200);
      expect(await st.json()).toMatchObject({ state: 'ready', missing: [], sessionsOpen: 1 });
      const ap = await call(base, 'GET', '/api/assistant/approvals', { 'x-arbor-key': 'admin-k' });
      expect(((await ap.json()) as { approvals: Array<{ id: string }> }).approvals.map((x) => x.id)).toEqual(['sevt_route']);
      const act = await call(base, 'GET', '/api/assistant/activity', { 'x-arbor-key': 'admin-k' });
      expect(((await act.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);

      const bad = await call(base, 'POST', '/api/assistant/approvals/sevt_route', { 'x-arbor-key': 'admin-k' }, { decision: 'yes' });
      expect(bad.status).toBe(400);
      const ok = await call(base, 'POST', '/api/assistant/approvals/sevt_route', { 'x-arbor-key': 'admin-k' }, { decision: 'deny', note: 'wrong customer' });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ ok: true });
      expect(api.sent[0]!.confirmation).toEqual({ type: 'user.tool_confirmation', tool_use_id: 'sevt_route', result: 'deny', deny_message: 'wrong customer' });
      const again = await call(base, 'POST', '/api/assistant/approvals/sevt_route', { 'x-arbor-key': 'admin-k' }, { decision: 'allow' });
      expect(again.status).toBe(409);
      expect(await again.json()).toEqual({ error: 'already_decided' });
      const missing = await call(base, 'POST', '/api/assistant/approvals/sevt_none', { 'x-arbor-key': 'admin-k' }, { decision: 'allow' });
      expect(missing.status).toBe(404);
    } finally { srv.close(); }
  });

  it('with no APP_ACCESS_KEY the assistant is locked — never the "open while the DB is cut" door', async () => {
    const { a } = make();
    const { base, srv } = await serve({ APP_ACCESS_KEY: undefined, CREW_ACCESS_KEY: undefined, ARBO_DATA_LINKS: undefined }, a);
    try {
      const r = await call(base, 'GET', '/api/assistant/approvals', {});
      expect(r.status).toBe(401);
      expect(await r.json()).toMatchObject({ error: 'no_app_key' });
    } finally { srv.close(); }
  });

  it('off / not set up answer 503 by name through the route', async () => {
    const off = make({ cfg: { on: false } }).a;
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', ARBO_DATA_LINKS: undefined }, off);
    try {
      const r = await call(base, 'GET', '/api/assistant/approvals', { 'x-arbor-key': 'admin-k' });
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ error: 'assistant_off' });
      const st = await call(base, 'GET', '/api/assistant/status', { 'x-arbor-key': 'admin-k' });
      expect(st.status).toBe(200);
      expect(await st.json()).toMatchObject({ state: 'off' });
    } finally { srv.close(); }
  });

  it('server.ts hands Quo deliveries to the assistant only after the signature check answered 200', () => {
    const src = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    const route = src.slice(src.indexOf("url.pathname === '/webhooks/quo'"), src.indexOf("url.pathname === '/webhooks/twilio/sms'"));
    expect(route).toContain('const out = quoIntake.handle(');
    expect(route).toContain('if (out.status === 200) assistant.noteQuoEvent(raw);');
    expect(route.indexOf('quoIntake.handle(')).toBeLessThan(route.indexOf('assistant.noteQuoEvent'));
    expect(src.match(/noteQuoEvent\(/g)).toHaveLength(1);
  });
});
