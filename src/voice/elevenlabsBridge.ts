// ElevenLabs Agents ↔ ARBOR bridge (D39). The ElevenLabs platform owns
// telephony/STT/TTS and calls THIS endpoint as its "custom LLM" — an
// OpenAI-chat-completions-compatible request per caller turn. Routing every
// turn through our Receptionist keeps the output guard as law: prices,
// diagnoses, and forbidden terms are blocked server-side no matter what the
// voice platform or model does.
//
// Deliberate tradeoff (D39): the reply is fully generated and GUARDED before
// anything is streamed back. We never token-stream the raw model — a guard
// that can only inspect completed text must see the whole reply first. Cost:
// a beat of extra latency. Benefit: the guard can never be bypassed by a
// stream that has already been spoken.
//
// Session state: ElevenLabs resends the whole transcript each turn, but the
// Receptionist is stateful (emergency/incident alerts fire ONCE per call, not
// once per turn), so calls are kept in an in-memory session map with a TTL.
// Keyed by the platform's conversation id when present, else by a stable hash
// of the call's first caller utterance.

import type { Guardrails } from '../config/guardrails.schema.js';
import type { LegalConfig } from '../config/legal.schema.js';
import { Receptionist, type Alerter, type Escalator, type LlmClient } from '../reception/receptionist.js';

export const SESSION_TTL_MS = 30 * 60 * 1000; // a phone call is over well inside 30 min

/** Subset of the OpenAI chat-completions request ElevenLabs sends. */
export interface BridgeRequestBody {
  model?: string;
  stream?: boolean;
  messages?: Array<{ role?: string; content?: unknown }>;
  user?: string;
  conversation_id?: string;
  metadata?: { conversation_id?: string };
  elevenlabs_extra_body?: { conversation_id?: string };
}

export interface BridgeResponse {
  status: number;
  /** JSON body (non-stream responses and every error). */
  json?: unknown;
  /** Ordered SSE frames, each already `data: `-prefixed, when streaming. */
  sse?: string[];
}

interface Session {
  receptionist: Receptionist;
  lastSeenMs: number;
  turns: number;
}

export interface BridgeDeps {
  guardrails: Guardrails;
  legal: LegalConfig;
  llm: LlmClient;
  alerter: Alerter;
  escalator?: Escalator;
  /** Secret WE minted; the ElevenLabs agent sends it as a Bearer token. */
  bridgeSecret: string | undefined;
  /**
   * §5A #29 review-loop sink: persist each turn for the human-in-the-loop
   * backlog. Best-effort — a logging failure must NEVER drop a live call, so
   * the bridge fires it and swallows errors.
   */
  logTurn?: (sessionKey: string, turn: { at: string; caller: string; reply: string; flags: string[] }) => Promise<void>;
  now?: () => number;
}

/** Text of a chat message whether content is a string or an array of parts. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
      .join(' ')
      .trim();
  }
  return '';
}

/** Stable non-crypto hash (djb2) — session fallback key only, never security. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function deriveSessionKey(body: BridgeRequestBody): string {
  const explicit =
    body.elevenlabs_extra_body?.conversation_id ?? body.conversation_id ?? body.metadata?.conversation_id ?? body.user;
  if (explicit && explicit.trim() !== '') return `id:${explicit.trim()}`;
  const firstUser = (body.messages ?? []).find((m) => m.role === 'user');
  return `h:${hash(contentText(firstUser?.content))}`;
}

export interface ElevenLabsBridge {
  handle(authorization: string | undefined, body: BridgeRequestBody): Promise<BridgeResponse>;
  /** Live (unexpired) session count — for tests and ops visibility. */
  sessionCount(): number;
}

export function createElevenLabsBridge(deps: BridgeDeps): ElevenLabsBridge {
  const sessions = new Map<string, Session>();
  const now = deps.now ?? Date.now;

  function sweep(nowMs: number): void {
    for (const [key, s] of sessions) {
      if (nowMs - s.lastSeenMs > SESSION_TTL_MS) sessions.delete(key);
    }
  }

  return {
    sessionCount: () => sessions.size,

    async handle(authorization, body) {
      // Fail closed: without a configured secret the bridge refuses everything.
      if (!deps.bridgeSecret) return { status: 503, json: { error: 'bridge_not_configured' } };
      if (authorization !== `Bearer ${deps.bridgeSecret}`) return { status: 401, json: { error: 'unauthorized' } };

      const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
      const text = contentText(lastUser?.content);
      if (text === '') return { status: 400, json: { error: 'no_user_message' } };

      const nowMs = now();
      sweep(nowMs);
      const key = deriveSessionKey(body);
      let session = sessions.get(key);
      if (!session) {
        session = {
          receptionist: new Receptionist({
            g: deps.guardrails,
            legal: deps.legal,
            llm: deps.llm,
            alerter: deps.alerter,
            ...(deps.escalator ? { escalator: deps.escalator } : {}),
          }),
          lastSeenMs: nowMs,
          turns: 0,
        };
        sessions.set(key, session);
      }
      session.lastSeenMs = nowMs;
      session.turns += 1;

      const turn = await session.receptionist.handleUserTurn(text);

      if (deps.logTurn) {
        const flags = [
          `intent:${turn.intent}`,
          ...(turn.emergency ? ['emergency'] : []),
          ...(turn.guard.safe ? [] : turn.guard.violations.map((v) => `guard_blocked:${v.rule}`)),
        ];
        // awaited so serverless doesn't freeze the write mid-flight; failures
        // are swallowed — the review log never costs a caller their reply.
        try {
          await deps.logTurn(key, { at: new Date(nowMs).toISOString(), caller: text, reply: turn.reply, flags });
        } catch {
          console.error('[voice] review log write failed'); // reason only, no PII (§4.3)
        }
      }

      const id = `arbor-${key}-${session.turns}`;
      const created = Math.floor(nowMs / 1000);
      const model = body.model ?? 'arbor-receptionist';

      if (body.stream) {
        // One content chunk carrying the already-guarded reply (see header note).
        const chunk = (delta: Record<string, unknown>, finish: string | null) =>
          `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}`;
        return {
          status: 200,
          sse: [chunk({ role: 'assistant' }, null), chunk({ content: turn.reply }, null), chunk({}, 'stop'), 'data: [DONE]'],
        };
      }

      return {
        status: 200,
        json: {
          id,
          object: 'chat.completion',
          created,
          model,
          choices: [{ index: 0, message: { role: 'assistant', content: turn.reply }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        },
      };
    },
  };
}
