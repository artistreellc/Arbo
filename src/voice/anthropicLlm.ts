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
