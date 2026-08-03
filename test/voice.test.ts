/*
  ═══════════════════════════════════════════════════════════════════════
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
*/
import { describe, it, expect } from 'vitest';
import { loadGuardrails, loadLegal } from '../src/config/loadConfig.js';
import type { Alerter, ChatMessage, LlmClient } from '../src/reception/receptionist.js';
import {
  createElevenLabsBridge,
  deriveSessionKey,
  SESSION_TTL_MS,
  type BridgeDeps,
  type BridgeRequestBody,
} from '../src/voice/elevenlabsBridge.js';
import { createVoiceLlm, withFallback, VOICE_FALLBACK_LINE } from '../src/voice/anthropicLlm.js';
import { createElevenLabsTts, GEORGE_VOICE_ID, TTS_MODEL, TTS_OUTPUT_FORMAT } from '../src/voice/elevenlabsTts.js';

const g = loadGuardrails();
const legal = loadLegal();
const noPriceLine = g.goldenRules.find((r) => r.id === 'no-price')!.approvedLine;

class FakeLlm implements LlmClient {
  private i = 0;
  constructor(private readonly script: string[]) {}
  async complete(_system: string, _messages: ChatMessage[]): Promise<string> {
    return this.script[this.i++] ?? 'How can I help with your trees today?';
  }
}
class FakeAlerter implements Alerter {
  public calls: Array<{ reason: string }> = [];
  async emergency(p: { reason: string }): Promise<void> {
    this.calls.push({ reason: p.reason });
  }
}

const SECRET = 'test-bridge-secret';
const AUTH = `Bearer ${SECRET}`;

function makeBridge(overrides: Partial<BridgeDeps> = {}) {
  const alerter = new FakeAlerter();
  const bridge = createElevenLabsBridge({
    guardrails: g,
    legal,
    llm: new FakeLlm(["Happy to help — what's the address?"]),
    alerter,
    bridgeSecret: SECRET,
    ...overrides,
  });
  return { bridge, alerter };
}

function turnBody(texts: string[], extra: Partial<BridgeRequestBody> = {}): BridgeRequestBody {
  return {
    messages: texts.map((t, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: t })),
    ...extra,
  };
}

describe('ElevenLabs bridge — auth (fail closed)', () => {
  it('refuses everything when no bridge secret is configured (503)', async () => {
    const { bridge } = makeBridge({ bridgeSecret: undefined });
    const out = await bridge.handle(AUTH, turnBody(['Hi']));
    expect(out.status).toBe(503);
  });

  it('rejects a wrong or missing bearer token (401)', async () => {
    const { bridge } = makeBridge();
    expect((await bridge.handle('Bearer nope', turnBody(['Hi']))).status).toBe(401);
    expect((await bridge.handle(undefined, turnBody(['Hi']))).status).toBe(401);
  });

  it('400s when there is no user message to answer', async () => {
    const { bridge } = makeBridge();
    const out = await bridge.handle(AUTH, { messages: [{ role: 'assistant', content: 'Hello!' }] });
    expect(out.status).toBe(400);
  });
});

describe('ElevenLabs bridge — chat-completions contract', () => {
  it('returns an OpenAI-shaped JSON completion with the guarded reply', async () => {
    const { bridge } = makeBridge({ llm: new FakeLlm(['That oak removal runs about $800.']) });
    const out = await bridge.handle(AUTH, turnBody(['How much to remove my oak?']));
    expect(out.status).toBe(200);
    const body = out.json as { object: string; choices: Array<{ message: { role: string; content: string }; finish_reason: string }> };
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0]!.finish_reason).toBe('stop');
    // The guard is law even over the voice platform: the price never ships.
    expect(body.choices[0]!.message.content).toBe(noPriceLine);
    expect(body.choices[0]!.message.content).not.toContain('$');
  });

  it('streams SSE frames with the reply guarded BEFORE the first byte', async () => {
    const { bridge } = makeBridge({ llm: new FakeLlm(['Just $500 for you!']) });
    const out = await bridge.handle(AUTH, turnBody(['Price me a tree removal'], { stream: true }));
    expect(out.status).toBe(200);
    expect(out.sse).toBeDefined();
    const frames = out.sse!;
    expect(frames.at(-1)).toBe('data: [DONE]');
    const contentFrame = frames
      .filter((f) => f !== 'data: [DONE]')
      .map((f) => JSON.parse(f.slice('data: '.length)) as { choices: Array<{ delta: { content?: string } }> })
      .find((f) => f.choices[0]!.delta.content !== undefined)!;
    expect(contentFrame.choices[0]!.delta.content).toBe(noPriceLine);
    const finishFrame = JSON.parse(frames.at(-2)!.slice('data: '.length)) as { choices: Array<{ finish_reason: string | null }> };
    expect(finishFrame.choices[0]!.finish_reason).toBe('stop');
  });
});

describe('ElevenLabs bridge — sessions', () => {
  it('keeps one Receptionist per conversation: emergency alert fires ONCE across turns', async () => {
    const { bridge, alerter } = makeBridge({
      llm: new FakeLlm(['Help is on the way.', 'Mike has been alerted and will call you right back.']),
    });
    const id = { conversation_id: 'conv-1' };
    await bridge.handle(AUTH, turnBody(['A tree fell on my house!'], id));
    await bridge.handle(AUTH, turnBody(['A tree fell on my house!', 'Help is on the way.', "It's still an emergency, hurry!"], id));
    expect(alerter.calls).toHaveLength(1);
    expect(bridge.sessionCount()).toBe(1);
  });

  it('falls back to a stable first-utterance key when the platform sends no id', async () => {
    const { bridge } = makeBridge();
    await bridge.handle(AUTH, turnBody(['Hello, I need some trimming']));
    await bridge.handle(AUTH, turnBody(['Hello, I need some trimming', 'Sure!', 'It is at my place in Norfolk']));
    expect(bridge.sessionCount()).toBe(1);
  });

  it('expires sessions after the TTL', async () => {
    let t = 1_000_000;
    const { bridge } = makeBridge({ now: () => t });
    await bridge.handle(AUTH, turnBody(['Hi there'], { conversation_id: 'old-call' }));
    expect(bridge.sessionCount()).toBe(1);
    t += SESSION_TTL_MS + 1;
    await bridge.handle(AUTH, turnBody(['New call'], { conversation_id: 'new-call' }));
    expect(bridge.sessionCount()).toBe(1); // old-call swept, only new-call remains
  });

  it('prefers the explicit platform conversation id over the fallback hash', () => {
    const withId = deriveSessionKey({ elevenlabs_extra_body: { conversation_id: 'abc' }, messages: [{ role: 'user', content: 'x' }] });
    expect(withId).toBe('id:abc');
    const hashed = deriveSessionKey({ messages: [{ role: 'user', content: 'x' }] });
    expect(hashed.startsWith('h:')).toBe(true);
  });
});

describe('voice LLM resilience', () => {
  const failing: LlmClient = {
    complete: async () => {
      throw new Error('api down');
    },
  };

  it('withFallback speaks the safe line on any model error', async () => {
    const llm = withFallback(failing);
    expect(await llm.complete('sys', [{ role: 'user', content: 'hi' }])).toBe(VOICE_FALLBACK_LINE);
  });

  it('withFallback replaces an empty model reply', async () => {
    const llm = withFallback(new FakeLlm(['   ']));
    expect(await llm.complete('sys', [{ role: 'user', content: 'hi' }])).toBe(VOICE_FALLBACK_LINE);
  });

  it('createVoiceLlm without a key is a static fallback client (bridge stays up)', async () => {
    const llm = createVoiceLlm(undefined);
    expect(await llm.complete('sys', [{ role: 'user', content: 'hi' }])).toBe(VOICE_FALLBACK_LINE);
  });

  it('the fallback line itself passes the output guard', async () => {
    const { guardReply } = await import('../src/reception/outputGuard.js');
    expect(guardReply(VOICE_FALLBACK_LINE, g).safe).toBe(true);
  });
});

describe('ElevenLabs TTS client', () => {
  it('POSTs the documented endpoint with voice, model, and format from the quickstart', async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const fakeFetch = async (url: string, init?: RequestInit) => {
      captured = { url, init };
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    };
    const tts = createElevenLabsTts('xi-key', fakeFetch);
    const bytes = await tts.synthesize('Good morning, Mike.');
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(captured!.url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${GEORGE_VOICE_ID}?output_format=${TTS_OUTPUT_FORMAT}`);
    expect(captured!.init!.headers).toMatchObject({ 'xi-api-key': 'xi-key' });
    expect(JSON.parse(captured!.init!.body as string)).toEqual({ text: 'Good morning, Mike.', model_id: TTS_MODEL });
  });

  it('throws on an API error instead of returning garbage audio', async () => {
    const tts = createElevenLabsTts('xi-key', async () => new Response('nope', { status: 401 }));
    await expect(tts.synthesize('hello')).rejects.toThrow(/HTTP 401/);
  });
});
