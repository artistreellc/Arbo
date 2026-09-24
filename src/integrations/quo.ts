// Quo (formerly OpenPhone) — the business phone Sona answers on (Mike,
// 2026-09-24: "auto do it" — Arbo learns from Sona's calls automatically).
//
// This client can do exactly four things: list the account's phone numbers,
// list webhooks, create a webhook, and delete a webhook ARBO ITSELF created
// (one whose url is Arbo's own). It has NO message or call method — Arbo
// still never sends anything, and the tests pin that this file never
// touches a messages/calls send endpoint.
//
// API facts (Quo docs): base https://api.openphone.com/v1; the API key goes
// in the Authorization header AS-IS (no "Bearer"); webhooks are created per
// family (/webhooks/messages, /calls, /call-summaries, /call-transcripts)
// and each carries its own signing `key`.

export const QUO_API_BASE = 'https://api.openphone.com/v1';

export type QuoWebhookFamily = 'messages' | 'calls' | 'call-summaries' | 'call-transcripts';

/** The events Arbo listens for, per family. */
export const QUO_EVENTS: Record<QuoWebhookFamily, string[]> = {
  messages: ['message.received'],
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

export interface QuoApi {
  listPhoneNumbers(): Promise<string[]>;
  listWebhooks(): Promise<QuoWebhook[]>;
  getWebhook(id: string): Promise<QuoWebhook | null>;
  createWebhook(family: QuoWebhookFamily, url: string): Promise<QuoWebhook>;
  deleteWebhook(id: string): Promise<void>;
}

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
  return {
    async listPhoneNumbers() {
      const out = (await call('GET', '/phone-numbers')) as { data?: Array<{ number?: unknown }> } | null;
      return (out?.data ?? []).map((p) => p.number).filter((n): n is string => typeof n === 'string');
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
