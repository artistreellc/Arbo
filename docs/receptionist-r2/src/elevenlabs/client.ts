/** Minimal ElevenLabs Conversational AI API client — plain fetch, no SDK dependency. */
import { config } from "../config.js";

const BASE = config.elevenLabs.baseUrl;

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "xi-api-key": config.elevenLabs.apiKey(),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs API ${init.method ?? "GET"} ${path} -> ${res.status}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export interface AgentResponse {
  agent_id: string;
  name: string;
  conversation_config: {
    agent: {
      first_message: string;
      prompt: { prompt: string; llm: string; temperature: number; [k: string]: unknown };
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  metadata: { created_at_unix_secs: number; updated_at_unix_secs: number };
  [k: string]: unknown;
}

export function getAgent(agentId = config.elevenLabs.agentId): Promise<AgentResponse> {
  return api<AgentResponse>(`/v1/convai/agents/${agentId}`);
}

/** PATCH a partial update onto the agent (e.g. new prompt text or first message). */
export function updateAgent(patch: Record<string, unknown>, agentId = config.elevenLabs.agentId): Promise<AgentResponse> {
  return api<AgentResponse>(`/v1/convai/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export interface ConversationSummary {
  conversation_id: string;
  agent_id: string;
  start_time_unix_secs: number;
  call_duration_secs: number;
  status: string;
  [k: string]: unknown;
}

export function listConversations(agentId = config.elevenLabs.agentId): Promise<{ conversations: ConversationSummary[] }> {
  return api(`/v1/convai/conversations?agent_id=${agentId}`);
}

export function getConversation(conversationId: string): Promise<Record<string, unknown>> {
  return api(`/v1/convai/conversations/${conversationId}`);
}
