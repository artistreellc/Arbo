// R18: learning (conversation only), the call record, and the live calendar
// hold — filed exactly the way Mike files his own estimates.
import { describe, it, expect } from 'vitest';
import {
  CallMemory,
  CallRecordStore,
  normalizeCallerId,
  repeatCallerNote,
} from '../src/reception/callMemory.js';
import { parseRequestedWindow } from '../src/ops/requestedWindow.js';
import { createElevenLabsBridge, type BridgeRequestBody, type CallHold } from '../src/voice/elevenlabsBridge.js';
import { loadGuardrails, loadLegal } from '../src/config/loadConfig.js';
import type { Alerter, ChatMessage, LlmClient } from '../src/reception/receptionist.js';

const g = loadGuardrails();
const legal = loadLegal();
const SECRET = 's';
const AUTH = `Bearer ${SECRET}`;

class ScriptLlm implements LlmClient {
  public systems: string[] = [];
  private i = 0;
  constructor(private readonly script: string[]) {}
  async complete(system: string, _m: ChatMessage[]): Promise<string> {
    this.systems.push(system);
    return this.script[this.i++] ?? 'How can I help with your trees today?';
  }
}
const alerter: Alerter = { emergency: async () => {} };

function bridgeWith(llm: LlmClient, extra: Record<string, unknown> = {}) {
  return createElevenLabsBridge({ guardrails: g, legal, llm, alerter, bridgeSecret: SECRET, ...extra });
}

const TOOLS = { tools: [{ type: 'function', function: { name: 'end_call' } }] };
// Tuesday 11:00 ET.
const NOW_MS = Date.parse('2026-09-22T15:00:00Z');

function body(texts: string[], conv: string, extra: Partial<BridgeRequestBody> = {}): BridgeRequestBody {
  return {
    user: '+17575550142',
    elevenlabs_extra_body: { conversation_id: conv },
    messages: texts.map((t, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: t })),
    ...extra,
  };
}

describe('normalizeCallerId + CallMemory', () => {
  it('accepts phone shapes, rejects noise', () => {
    expect(normalizeCallerId('+17575550142')).toBe('+17575550142');
    expect(normalizeCallerId('(757) 555-0142')).toBe('7575550142');
    expect(normalizeCallerId('conv_abc123')).toBeNull();
    expect(normalizeCallerId(undefined)).toBeNull();
  });

  it('merges calls: new facts win, absence never erases', () => {
    const m = new CallMemory();
    m.remember('+1757', { state: { name: 'Pat', address: '1 Oak St' } }, '2026-09-22T00:00:00Z');
    m.remember('+1757', { state: { jobType: 'removal' }, zip: '23452' }, '2026-09-23T00:00:00Z');
    const r = m.recall('+1757')!;
    expect(r.calls).toBe(2);
    expect(r.name).toBe('Pat');
    expect(r.zip).toBe('23452');
    expect(r.jobTypes).toEqual(['removal']);
  });

  it('the repeat-caller note confirms, never asserts, never recites the number', () => {
    const m = new CallMemory();
    m.remember('+1757', { state: { name: 'Pat', address: '1 Oak St' } }, '2026-09-22T00:00:00Z');
    const note = repeatCallerNote(m.recall('+1757'))!;
    expect(note).toContain('REPEAT CALLER');
    expect(note).toContain('Pat');
    expect(note).toContain('CONFIRM');
    expect(note).toContain('verify you are talking to the same person');
    expect(note).not.toContain('757');
    expect(repeatCallerNote(null)).toBeNull();
  });
});

describe('parseRequestedWindow', () => {
  const now = new Date(NOW_MS); // Tuesday 11:00 ET

  it('"Wednesday after 4" → next day 16:00 ET, 20-minute hold', () => {
    const w = parseRequestedWindow('Is he available Wednesday after 4:00?', now)!;
    expect(w.label).toBe('wednesday after 4');
    expect(w.startIso).toBe('2026-09-23T20:00:00.000Z'); // 16:00 EDT
    expect(Date.parse(w.endIso) - Date.parse(w.startIso)).toBe(20 * 60 * 1000);
  });

  it('day-of-week said on that same weekday means NEXT week', () => {
    const w = parseRequestedWindow('tuesday morning works', now)!;
    expect(w.startIso).toBe('2026-09-29T13:00:00.000Z'); // next Tue 9:00 EDT
  });

  it('tomorrow morning / saturday afternoon / at 10 am', () => {
    expect(parseRequestedWindow('tomorrow morning?', now)!.startIso).toBe('2026-09-23T13:00:00.000Z');
    expect(parseRequestedWindow('how about saturday afternoon', now)!.startIso).toBe('2026-09-26T18:00:00.000Z');
    expect(parseRequestedWindow('friday at 10 am', now)!.startIso).toBe('2026-09-25T14:00:00.000Z');
  });

  it('half a guess is null: day without time, time without day, neither', () => {
    expect(parseRequestedWindow('sometime wednesday', now)).toBeNull();
    expect(parseRequestedWindow('after 4 works', now)).toBeNull();
    expect(parseRequestedWindow('sounds good', now)).toBeNull();
  });
});

describe('bridge finalize (R18)', () => {
  it('files the hold the way Mike does, remembers the caller, keeps the record — once', async () => {
    const holds: CallHold[] = [];
    const memory = new CallMemory();
    const records = new CallRecordStore();
    const llm = new ScriptLlm([
      "Got it — what's the address?",
      'Wednesday after 4 it is as a request — Mike will confirm. Thanks so much — have a good one! [[END_CALL]]',
      'Anything else? [[END_CALL]]',
    ]);
    const bridge = bridgeWith(llm, {
      callMemory: memory,
      callRecords: records,
      calendarHold: async (h: CallHold) => {
        holds.push(h);
      },
      now: () => NOW_MS,
    });

    await bridge.handle(AUTH, body(["Hi, my name's Pat Jones, I need a big oak removed"], 'c1', TOOLS));
    const t2 = await bridge.handle(
      AUTH,
      body(
        ["Hi, my name's Pat Jones, I need a big oak removed", 'ack', 'Can he come Wednesday after 4?'],
        'c1',
        TOOLS,
      ),
    );
    expect(t2.status).toBe(200);
    // wait a tick for the fire-and-forget hold
    await new Promise((r) => setTimeout(r, 0));

    expect(holds).toHaveLength(1);
    const h = holds[0]!;
    expect(h.summary).toMatch(/- 7575550142$/); // Mike's "Name - digits" shape
    expect(h.description.startsWith('Estimate - ')).toBe(true);
    expect(h.description).toContain('UNCONFIRMED');
    expect(h.description).toContain('Caller asked for: wednesday after 4');
    expect(h.startIso).toBe('2026-09-23T20:00:00.000Z');

    const rec = memory.recall('+17575550142')!;
    expect(rec.calls).toBe(1);

    expect(records.list()).toHaveLength(1);
    expect(records.list()[0]!.calendarHold).toBe('attempted');
    expect(records.list()[0]!.requestedWindow).toBe('wednesday after 4');

    // a third turn with another marker must NOT double-finalize
    await bridge.handle(AUTH, body(['x', 'y', 'z', 'w', 'one more thing'], 'c1', TOOLS));
    await new Promise((r) => setTimeout(r, 0));
    expect(holds).toHaveLength(1);
    expect(records.list()).toHaveLength(1);
  });

  it('a repeat caller gets the REPEAT CALLER note in the system prompt', async () => {
    const memory = new CallMemory();
    memory.remember('+17575550142', { state: { name: 'Pat Jones' } }, '2026-09-20T00:00:00Z');
    const llm = new ScriptLlm(['Welcome back!']);
    const bridge = bridgeWith(llm, { callMemory: memory, now: () => NOW_MS });
    await bridge.handle(AUTH, body(['Hey, me again'], 'c2'));
    expect(llm.systems[0]).toContain('REPEAT CALLER');
    expect(llm.systems[0]).toContain('Pat Jones');
  });

  it('no calendar writer: record says no_writer, nothing throws', async () => {
    const records = new CallRecordStore();
    const llm = new ScriptLlm(['Bye now — have a good one! [[END_CALL]]']);
    const bridge = bridgeWith(llm, { callRecords: records, now: () => NOW_MS });
    await bridge.handle(AUTH, body(['bye'], 'c3', TOOLS));
    expect(records.list()[0]!.calendarHold).toBe('no_writer');
  });

  it('a failing calendar writer never breaks the reply', async () => {
    const llm = new ScriptLlm(['Bye — have a good one! [[END_CALL]]']);
    const bridge = bridgeWith(llm, {
      calendarHold: async () => {
        throw new Error('403');
      },
      now: () => NOW_MS,
    });
    const out = await bridge.handle(AUTH, body(['bye'], 'c4', TOOLS));
    await new Promise((r) => setTimeout(r, 0));
    expect(out.status).toBe(200);
  });
});
