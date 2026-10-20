// R28 (Mike, 2026-10-20): the thin wrapper over the Managed Agents SDK
// (`client.beta.sessions` in @anthropic-ai/sdk 0.115.0). Arbo never creates,
// updates or archives the AGENT — Mike creates it once in the Claude Console
// from the config he approves. Arbo only starts SESSIONS of it and answers
// the approvals it asks for.
//
// The surface is deliberately narrow: start a session with its one first
// message, read its events, and send a tool CONFIRMATION. There is no method
// that sends a second user.message, edits an agent, or touches a vault — a
// caller cannot ask for what the type cannot express.
//
// Tests inject a fake AssistantApi; nothing here is reached without a key.

import Anthropic from '@anthropic-ai/sdk';

/** The event fields Arbo reads. A structural subset of the SDK's event union. */
export interface AgentEvent {
  id: string;
  type: string;
  processed_at?: string | null;
  /** agent.tool_use / agent.mcp_tool_use */
  name?: string;
  mcp_server_name?: string;
  input?: Record<string, unknown>;
  evaluated_permission?: 'allow' | 'ask' | 'deny';
  /** agent.message */
  content?: Array<{ type: string; text?: string }>;
  /** session.status_idle */
  stop_reason?: { type: string; event_ids?: string[] };
  /** session.error */
  error?: { type?: string; message?: string; mcp_server_name?: string; retry_status?: { type?: string } };
  /** user.tool_confirmation (the echo of a decision) */
  tool_use_id?: string;
  result?: 'allow' | 'deny';
}

/** The ONLY event Arbo sends into a running session: Mike's decision on one tool call. */
export interface ToolConfirmation {
  type: 'user.tool_confirmation';
  /** The sevt_ id of the agent.tool_use / agent.mcp_tool_use event — never a toolu_ id. */
  tool_use_id: string;
  result: 'allow' | 'deny';
  /** Only with 'deny': delivered to the agent as the rejected tool result. */
  deny_message?: string;
}

export interface CreateSessionInput {
  agentId: string;
  environmentId: string;
  vaultId: string;
  /** Hard cap in whole US cents (§ Session budgets). */
  budgetCents: number;
  /** Ids and kind only — never a customer's name, number or words. */
  title: string;
  metadata: Record<string, string>;
  firstMessage: string;
}

export interface EventStream {
  events: AsyncIterable<AgentEvent>;
  close(): void;
}

export interface AssistantApi {
  createSession(input: CreateSessionInput): Promise<{ id: string }>;
  sendConfirmation(sessionId: string, confirmation: ToolConfirmation): Promise<void>;
  /** Live SSE. Open it BEFORE listEvents — the stream has no replay. */
  openStream(sessionId: string): Promise<EventStream>;
  /** The session's full history, oldest first. */
  listEvents(sessionId: string): AsyncIterable<AgentEvent>;
}

/** Every SDK failure, normalised: the HTTP status when there was one, and the SDK's message. */
export class AssistantApiError extends Error {
  constructor(readonly status: number | null, message: string) {
    super(message);
    this.name = 'AssistantApiError';
  }
}

function normalise(err: unknown): AssistantApiError {
  if (err instanceof AssistantApiError) return err;
  if (err instanceof Anthropic.APIError) return new AssistantApiError(typeof err.status === 'number' ? err.status : null, err.message);
  return new AssistantApiError(null, err instanceof Error ? err.message : 'error');
}

export function createAnthropicAssistantApi(apiKey: string): AssistantApi {
  const client = new Anthropic({ apiKey });
  return {
    async createSession(input) {
      const params = {
        agent: input.agentId,
        environment_id: input.environmentId,
        vault_ids: [input.vaultId],
        title: input.title,
        metadata: input.metadata,
        // Create + first message in one call: the session starts running with
        // exactly this message, and never exists without it.
        initial_events: [{ type: 'user.message' as const, content: [{ type: 'text' as const, text: input.firstMessage }] }],
        // § Session budgets: a create-only hard cap, minor units as an integer
        // string ("300" = $3.00). SDK 0.115.0 does not type `budget` yet;
        // create() forwards every body field, so it reaches the API as documented.
        budget: { type: 'limit', max_list_cost: { amount: String(input.budgetCents), currency: 'USD' } },
      };
      try {
        const s = await client.beta.sessions.create(params as Parameters<typeof client.beta.sessions.create>[0]);
        return { id: s.id };
      } catch (err) {
        throw normalise(err);
      }
    },
    async sendConfirmation(sessionId, confirmation) {
      try {
        await client.beta.sessions.events.send(sessionId, { events: [confirmation] });
      } catch (err) {
        throw normalise(err);
      }
    },
    async openStream(sessionId) {
      try {
        const stream = await client.beta.sessions.events.stream(sessionId);
        return {
          events: (async function* () {
            try {
              for await (const ev of stream) yield ev as unknown as AgentEvent;
            } catch (err) {
              throw normalise(err);
            }
          })(),
          close: () => stream.controller.abort(),
        };
      } catch (err) {
        throw normalise(err);
      }
    },
    listEvents(sessionId) {
      return (async function* () {
        try {
          for await (const ev of client.beta.sessions.events.list(sessionId)) yield ev as unknown as AgentEvent;
        } catch (err) {
          throw normalise(err);
        }
      })();
    },
  };
}
