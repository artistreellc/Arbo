// Quo (formerly OpenPhone) — the business phone Sona answers on (Mike,
// 2026-09-24: "auto do it" — Arbo learns from Sona's calls automatically).
//
// This client is READ-ONLY plus webhook registration: it lists the account's
// numbers, conversations, calls, messages and transcripts, and creates or
// deletes webhooks ARBO ITSELF registered (only hooks whose url is Arbo's).
// The ONE outbound path Arbo has — a text via Quo, owner-ruled R22 — lives
// in its own file, src/integrations/quoSend.ts, behind the compliance gate.
// The tests pin that this file's only POST/DELETE targets are /webhooks.
//
// API facts (Quo's published OpenAPI): base https://api.quo.com/v1 (the old
// api.openphone.com host redirects, and a redirect can silently turn a POST
// into a GET, so the documented host is used directly); the API key goes in
// the Authorization header AS-IS (no "Bearer"); list endpoints are cursor
// paginated (maxResults + pageToken -> nextPageToken); GET /calls and
// GET /messages REQUIRE phoneNumberId + one participant; webhooks are
// created per family and each carries its own signing `key`.

export const QUO_API_BASE = 'https://api.quo.com/v1';

export type QuoWebhookFamily = 'messages' | 'calls' | 'call-summaries' | 'call-transcripts';

/** The events Arbo listens for, per family. */
export const QUO_EVENTS: Record<QuoWebhookFamily, string[]> = {
  messages: ['message.received', 'message.delivered'],
  calls: ['call.completed'],
  'call-summaries': ['call.summary.completed'],
  'call-transcripts': ['call.transcript.completed'],
};

export interface QuoWebhook {
  id: string;
  url: string;
  events: string[];
  /** Signing key (base64). Present on create; may be absent on list. */
  key?: string;
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface QuoPhoneNumber {
  id: string;
  number: string;
}

export interface QuoConversation {
  id: string;
  phoneNumberId: string | null;
  /** E.164 numbers — Quo also emits 'Anonymous' / 'Blocked' / 'Restricted' / short codes; those are filtered out. */
  participants: string[];
  lastActivityAt: string | null;
  updatedAt: string | null;
}

export interface QuoCall {
  id: string;
  direction: 'incoming' | 'outgoing';
  status: string | null;
  /** 'ai-agent' when Sona answered, null when a person did. */
  aiHandled: string | null;
  createdAt: string | null;
  answeredAt: string | null;
  completedAt: string | null;
}

export interface QuoMessage {
  id: string;
  direction: 'incoming' | 'outgoing';
  text: string;
  status: string | null;
  createdAt: string | null;
}

export interface QuoTranscriptLine {
  identifier: string | null;
  content: string;
  userId: string | null;
}

export interface QuoTranscript {
  status: 'absent' | 'in-progress' | 'completed' | 'failed' | string;
  dialogue: QuoTranscriptLine[] | null;
}

export interface QuoApi {
  listPhoneNumbers(): Promise<string[]>;
  phoneNumbers(): Promise<QuoPhoneNumber[]>;
  /** Conversations on one Quo number updated after a moment, newest first (cursor-paginated, capped). */
  listConversations(input: { phoneNumberId: string; updatedAfterIso: string }): Promise<QuoConversation[]>;
  listCalls(input: { phoneNumberId: string; participant: string; createdAfterIso: string }): Promise<QuoCall[]>;
  listMessages(input: { phoneNumberId: string; participant: string; createdAfterIso: string }): Promise<QuoMessage[]>;
  getCallTranscript(callId: string): Promise<QuoTranscript | null>;
  listWebhooks(): Promise<QuoWebhook[]>;
  getWebhook(id: string): Promise<QuoWebhook | null>;
  createWebhook(family: QuoWebhookFamily, url: string): Promise<QuoWebhook>;
  deleteWebhook(id: string): Promise<void>;
}

const E164 = /^\+[1-9]\d{6,14}$/;
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const dir = (v: unknown): 'incoming' | 'outgoing' | null => (v === 'incoming' || v === 'outgoing' ? v : null);

/** Cursor pagination, capped — the spec itself warns totalItems is unreliable, so never loop on it. */
const PAGE_CAP = 5;

function asWebhook(raw: unknown): QuoWebhook | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.url !== 'string') return null;
  return {
    id: o.id,
    url: o.url,
    events: Array.isArray(o.events) ? o.events.filter((e): e is string => typeof e === 'string') : [],
    ...(typeof o.key === 'string' && o.key ? { key: o.key } : {}),
  };
}

export function createQuoApi(apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, base = QUO_API_BASE): QuoApi {
  const headers = { Authorization: apiKey, 'Content-Type': 'application/json' };
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    // Status only — never echo a response body, it can carry customer data (§4.3).
    if (!res.ok) throw new Error(`Quo ${method} ${path.split('?')[0]} -> ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
  const pages = async (path: string, params: string): Promise<unknown[]> => {
    const items: unknown[] = [];
    let token: string | null = null;
    for (let i = 0; i < PAGE_CAP; i += 1) {
      const out = (await call('GET', `${path}?${params}${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`)) as
        | { data?: unknown[]; nextPageToken?: unknown }
        | null;
      items.push(...(out?.data ?? []));
      token = typeof out?.nextPageToken === 'string' && out.nextPageToken ? out.nextPageToken : null;
      if (!token) break;
    }
    return items;
  };
  return {
    async listPhoneNumbers() {
      const out = (await call('GET', '/phone-numbers')) as { data?: Array<{ number?: unknown }> } | null;
      return (out?.data ?? []).map((p) => p.number).filter((n): n is string => typeof n === 'string');
    },
    async phoneNumbers() {
      const out = (await call('GET', '/phone-numbers')) as { data?: Array<{ id?: unknown; number?: unknown }> } | null;
      return (out?.data ?? [])
        .map((p) => ({ id: str(p.id), number: str(p.number) }))
        .filter((p): p is QuoPhoneNumber => p.id !== null && p.number !== null);
    },
    async listConversations({ phoneNumberId, updatedAfterIso }) {
      const raw = await pages(
        '/conversations',
        `phoneNumbers=${encodeURIComponent(phoneNumberId)}&updatedAfter=${encodeURIComponent(updatedAfterIso)}&maxResults=100`,
      );
      return raw.flatMap((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        const id = str(o.id);
        if (!id) return [];
        const participants = Array.isArray(o.participants)
          ? o.participants.filter((x): x is string => typeof x === 'string' && E164.test(x))
          : [];
        return [{ id, phoneNumberId: str(o.phoneNumberId), participants, lastActivityAt: str(o.lastActivityAt), updatedAt: str(o.updatedAt) }];
      });
    },
    async listCalls({ phoneNumberId, participant, createdAfterIso }) {
      // The spec: pass "participants" without brackets, one number, E.164.
      const raw = await pages(
        '/calls',
        `phoneNumberId=${encodeURIComponent(phoneNumberId)}&participants=${encodeURIComponent(participant)}&createdAfter=${encodeURIComponent(createdAfterIso)}&maxResults=50`,
      );
      return raw.flatMap((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        const id = str(o.id);
        const d = dir(o.direction);
        if (!id || !d) return [];
        return [{ id, direction: d, status: str(o.status), aiHandled: str(o.aiHandled), createdAt: str(o.createdAt), answeredAt: str(o.answeredAt), completedAt: str(o.completedAt) }];
      });
    },
    async listMessages({ phoneNumberId, participant, createdAfterIso }) {
      const raw = await pages(
        '/messages',
        `phoneNumberId=${encodeURIComponent(phoneNumberId)}&participants=${encodeURIComponent(participant)}&createdAfter=${encodeURIComponent(createdAfterIso)}&maxResults=50`,
      );
      return raw.flatMap((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        const id = str(o.id);
        const d = dir(o.direction);
        if (!id || !d) return [];
        return [{ id, direction: d, text: str(o.text) ?? '', status: str(o.status), createdAt: str(o.createdAt) }];
      });
    },
    async getCallTranscript(callId) {
      const out = (await call('GET', `/call-transcripts/${encodeURIComponent(callId)}`)) as { data?: Record<string, unknown> } | null;
      const d = out?.data;
      if (!d) return null;
      const dialogue = Array.isArray(d.dialogue)
        ? (d.dialogue as Array<Record<string, unknown>>).flatMap((l) => {
            const content = str(l.content);
            return content ? [{ identifier: str(l.identifier), content, userId: str(l.userId) }] : [];
          })
        : null;
      return { status: str(d.status) ?? 'absent', dialogue };
    },
    async listWebhooks() {
      const out = (await call('GET', '/webhooks')) as { data?: unknown[] } | null;
      return (out?.data ?? []).map(asWebhook).filter((w): w is QuoWebhook => w !== null);
    },
    async getWebhook(id) {
      const out = (await call('GET', `/webhooks/${encodeURIComponent(id)}`)) as { data?: unknown } | null;
      return asWebhook(out?.data);
    },
    async createWebhook(family, url) {
      const body = { url, events: QUO_EVENTS[family], label: `Arbo — ${family}` };
      // "All numbers" is ['*'] in Quo's docs; if the account rejects that
      // form, one retry without it (Quo's default scope is the workspace).
      let out: { data?: unknown } | null;
      try {
        out = (await call('POST', `/webhooks/${family}`, { ...body, resourceIds: ['*'] })) as { data?: unknown } | null;
      } catch {
        out = (await call('POST', `/webhooks/${family}`, body)) as { data?: unknown } | null;
      }
      const hook = asWebhook(out?.data);
      if (!hook) throw new Error(`Quo POST /webhooks/${family} -> unreadable response`);
      return hook;
    },
    async deleteWebhook(id) {
      await call('DELETE', `/webhooks/${encodeURIComponent(id)}`);
    },
  };
}

export interface EnsureResult {
  /** Signing keys for every Arbo webhook now registered — verification tries each. */
  keys: string[];
  created: QuoWebhookFamily[];
  reused: QuoWebhookFamily[];
  /** Families Quo refused, by name — e.g. transcripts need the Business plan. */
  failed: Array<{ family: QuoWebhookFamily; why: string }>;
}

/**
 * Make sure Arbo has one webhook per family pointed at its own URL, and
 * learn their signing keys. Idempotent across restarts: an existing Arbo
 * webhook is reused when the list returns its key; when the list withholds
 * the key, that ONE Arbo-owned webhook is replaced (never anyone else's —
 * only hooks whose url is exactly Arbo's are ever deleted).
 */
export async function ensureQuoWebhooks(api: QuoApi, url: string): Promise<EnsureResult> {
  const existing = (await api.listWebhooks()).filter((w) => w.url === url);
  const result: EnsureResult = { keys: [], created: [], reused: [], failed: [] };
  // One family at a time, each on its own: a family Quo refuses (plan
  // limits) must not take texts and calls down with it.
  for (const family of Object.keys(QUO_EVENTS) as QuoWebhookFamily[]) {
    try {
      const wanted = QUO_EVENTS[family];
      const mine = existing.filter((w) => wanted.every((e) => w.events.includes(e)));
      const withKey = mine.find((w) => w.key);
      if (withKey?.key) {
        result.keys.push(withKey.key);
        result.reused.push(family);
        continue;
      }
      for (const stale of mine) await api.deleteWebhook(stale.id);
      const hook = await api.createWebhook(family, url);
      const key = hook.key ?? (await api.getWebhook(hook.id))?.key;
      if (!key) throw new Error('created without a signing key');
      result.keys.push(key);
      result.created.push(family);
    } catch (err) {
      result.failed.push({ family, why: err instanceof Error ? err.message : 'error' });
    }
  }
  if (result.keys.length === 0) {
    throw new Error(`no webhook registered (${result.failed.map((f) => `${f.family}: ${f.why}`).join('; ')})`);
  }
  return result;
}
