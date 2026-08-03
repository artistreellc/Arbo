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
// The receptionist brain in production: Claude behind the ElevenLabs voice
// agent (D39 — ElevenLabs supersedes the Vapi default D4). The model NEVER
// speaks straight to a caller — every candidate reply goes through the output
// guard inside Receptionist (the guard is law, §0 rule 4). This client is
// latency-tuned for a live phone call: thinking disabled, lowest effort,
// short replies. The quality bar is carried by the system prompt plus the
// deterministic guard, not by long deliberation.

import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, LlmClient } from '../reception/receptionist.js';

export const RECEPTIONIST_MODEL = 'claude-opus-5';

/**
 * Guard-clean line spoken when the model is unreachable (no key yet, outage,
 * timeout). Keeps qualification moving instead of dropping the call — same
 * honesty rule as the permit screen: degrade, never fabricate.
 */
export const VOICE_FALLBACK_LINE =
  "I'm sorry — I had a little trouble there. Could I get your name, the address of the property, and what tree work you're looking to have done?";

export interface AnthropicLlmOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

/** Direct SDK-backed LlmClient. Throws on API failure — wrap with withFallback for live calls. */
export function createAnthropicLlm(options: AnthropicLlmOptions = {}): LlmClient {
  const client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  const model = options.model ?? RECEPTIONIST_MODEL;
  const maxTokens = options.maxTokens ?? 1024;
  return {
    async complete(system: string, messages: ChatMessage[]): Promise<string> {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      return response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
    },
  };
}

/** Wrap an LlmClient so a model failure NEVER drops a live call. */
export function withFallback(inner: LlmClient, fallbackLine: string = VOICE_FALLBACK_LINE): LlmClient {
  return {
    async complete(system, messages) {
      try {
        const reply = await inner.complete(system, messages);
        return reply.trim() !== '' ? reply : fallbackLine;
      } catch (err) {
        // Log the error class only — caller text never hits logs (§4.3).
        console.error('[voice] LLM error — speaking fallback line:', err instanceof Error ? err.name : 'error');
        return fallbackLine;
      }
    },
  };
}

/**
 * The LlmClient the server wires in: real Claude when a key is configured,
 * otherwise a static client that always speaks the fallback line (the bridge
 * stays up and honest while credentials are pending).
 */
export function createVoiceLlm(apiKey: string | undefined, fallbackLine: string = VOICE_FALLBACK_LINE): LlmClient {
  if (!apiKey) {
    return { complete: async () => fallbackLine };
  }
  return withFallback(createAnthropicLlm({ apiKey }), fallbackLine);
}
