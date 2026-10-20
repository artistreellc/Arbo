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
//
// R33 (Mike, 2026-10-20: "connect quo as read only"): Quo API keys cannot be
// scoped, so Arbo enforces it. While ARBO_QUO_SEND is not exactly 'live'
// (src/integrations/readOnly.ts) this client's two writes — createWebhook and
// deleteWebhook — refuse before anything leaves, and ensureQuoWebhooks keeps
// the hooks Quo already has, as they are: a missing one is NAMED, never
// created; one whose key Quo withholds is named, never replaced. Every read
// keeps working, and Arbo reads Sona's calls from Quo's own record anyway.

import { QUO_HOOK_MISSING_LINE, QUO_HOOK_NO_KEY_LINE, QuoReadOnlyError, quoWritesLive } from './readOnly.js';

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
  /**
   * Photos and files on the text — Quo's signed address and MIME type, https
   * only, at most 10. Server-side only: the app is handed an opaque id per
   * photo (src/integrations/quoMedia.ts), never this address. Optional so a
   * reader that never looks at photos need not carry it.
   */
  media?: Array<{ url: string; contentType: string | null }>;
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
  /** createdAfterIso null = the WHOLE history (the filter is optional in Quo's spec) — how STOP is read. */
  listMessages(input: { phoneNumberId: string; participant: string; createdAfterIso: string | null }): Promise<QuoMessage[]>;
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

/**
 * A refused Quo read, carrying Quo's own error code (e.g. '0206400' = texting
 * registration not approved — Quo refuses even GET /messages until then) so a
 * caller can NAME the state instead of calling it "unreadable". The code is
 * the only thing read from the body — never echo it, it can carry customer
 * data (§4.3).
 */
export class QuoHttpError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
    this.name = 'QuoHttpError';
  }
}

/** A history longer than the page cap — "we could not read it all" is not "there is nothing there" (§1B). */
export class QuoTruncatedError extends Error {
  constructor(path: string) {
    super(`Quo GET ${path} -> more than ${PAGE_CAP} pages; history not fully read`);
    this.name = 'QuoTruncatedError';
  }
}

export function createQuoApi(apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, base = QUO_API_BASE): QuoApi {
  const headers = { Authorization: apiKey, 'Content-Type': 'application/json' };
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    // Status and Quo's error code only — never echo a response body (§4.3).
    if (!res.ok) {
      let code: string | null = null;
      try {
        const b = (await res.json()) as { code?: unknown } | null;
        code = typeof b?.code === 'string' ? b.code : null;
      } catch {
        code = null;
      }
      throw new QuoHttpError(`Quo ${method} ${path.split('?')[0]} -> ${res.status}`, res.status, code);
    }
    return res.status === 204 ? null : res.json();
  };
  /** strict: a history that runs past the page cap THROWS instead of returning a silent prefix. */
  const pages = async (path: string, params: string, strict = false): Promise<unknown[]> => {
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
    if (strict && token) throw new QuoTruncatedError(path);
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
        `phoneNumberId=${encodeURIComponent(phoneNumberId)}&participants=${encodeURIComponent(participant)}${createdAfterIso ? `&createdAfter=${encodeURIComponent(createdAfterIso)}` : ''}&maxResults=100`,
        true, // R22: STOP is read from this history — a cut-off read must never pass as "no STOP".
      );
      return raw.flatMap((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        const id = str(o.id);
        const d = dir(o.direction);
        if (!id || !d) return [];
        const media = Array.isArray(o.media)
          ? (o.media as Array<Record<string, unknown> | null>)
              .map((m) => ({ url: str(m?.url), contentType: str(m?.type) }))
              .filter((m): m is { url: string; contentType: string | null } => m.url !== null && m.url.startsWith('https://'))
              .slice(0, 10)
          : [];
        return [{ id, direction: d, text: str(o.text) ?? '', status: str(o.status), createdAt: str(o.createdAt), media }];
      });
    },
    async getCallTranscript(callId) {
      let out: { data?: Record<string, unknown> } | null;
      try {
        out = (await call('GET', `/call-transcripts/${encodeURIComponent(callId)}`)) as { data?: Record<string, unknown> } | null;
      } catch (err) {
        // Quo answers 404 for a call that has no transcript at all — that is
        // "none exists", not "could not read" (seen live 2026-09-25).
        if (err instanceof QuoHttpError && err.status === 404) return null;
        throw err;
      }
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
      if (!quoWritesLive()) throw new QuoReadOnlyError('webhook.create'); // R33 — before the fetch
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
      if (!quoWritesLive()) throw new QuoReadOnlyError('webhook.delete'); // R33 — before the fetch
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
  /** R33: true while Quo is read-only — nothing was created, replaced or deleted. */
  readOnly: boolean;
  /** R33: families Arbo would have registered and won't while read-only, each with its line. Never 'failed'. */
  missing: Array<{ family: QuoWebhookFamily; why: string }>;
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
  if (!quoWritesLive()) return useWebhooksAsTheyAre(api, existing);
  const result: EnsureResult = { keys: [], created: [], reused: [], failed: [], readOnly: false, missing: [] };
  // One family at a time, each on its own: a family Quo refuses (plan
  // limits) must not take texts and calls down with it.
  for (const family of Object.keys(QUO_EVENTS) as QuoWebhookFamily[]) {
    try {
      const wanted = QUO_EVENTS[family];
      const mine = existing.filter((w) => wanted.every((e) => w.events.includes(e)));
      // An older hook of OURS (our url) for this family that lacks an event we
      // now want — e.g. the messages hook registered before R22 added
      // message.delivered. Left alone it keeps posting with a key Arbo no
      // longer learns, so every text would ALSO arrive as a signature failure.
      const partial = existing.filter((w) => !mine.includes(w) && wanted.some((e) => w.events.includes(e)));
      for (const stale of partial) await api.deleteWebhook(stale.id);
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

/**
 * R33 — read-only: use the hooks of OURS that Quo already has, exactly as
 * they are. A hook that carries any event a family wants is used (an older
 * texts hook without message.delivered still brings texts in), and its
 * signing key is learned from the list or, failing that, read by id — so
 * its deliveries verify. Nothing is created, replaced or deleted. A family
 * with no hook, or with a hook whose key Quo will not show, is NAMED in
 * `missing` — never 'failed', and never a throw: Arbo still reads Quo's
 * record on its timer.
 */
async function useWebhooksAsTheyAre(api: QuoApi, existing: QuoWebhook[]): Promise<EnsureResult> {
  const result: EnsureResult = { keys: [], created: [], reused: [], failed: [], readOnly: true, missing: [] };
  for (const family of Object.keys(QUO_EVENTS) as QuoWebhookFamily[]) {
    const ours = existing.filter((w) => QUO_EVENTS[family].some((e) => w.events.includes(e)));
    if (ours.length === 0) {
      result.missing.push({ family, why: QUO_HOOK_MISSING_LINE });
      continue;
    }
    try {
      let found = 0;
      for (const w of ours) {
        const key = w.key ?? (await api.getWebhook(w.id))?.key;
        if (!key) continue;
        found += 1;
        if (!result.keys.includes(key)) result.keys.push(key);
      }
      if (found === 0) {
        result.missing.push({ family, why: QUO_HOOK_NO_KEY_LINE });
        continue;
      }
      result.reused.push(family);
    } catch (err) {
      // A READ Quo refused — that is a failure, and named as one.
      result.failed.push({ family, why: err instanceof Error ? err.message : 'error' });
    }
  }
  return result;
}

/**
 * The intake's registration line for what ensureQuoWebhooks found. Three
 * states, never fewer (§1B): every hook in place ('ok'), read-only with a
 * hook missing ('read_only' — off on purpose, said in its own muted line),
 * and a refusal from Quo ('failed').
 */
export function registrationFrom(hooks: EnsureResult): { state: 'ok' | 'failed' | 'read_only'; detail: string } {
  const failed = hooks.failed.length ? ` NOT wired: ${hooks.failed.map((f) => `${f.family} (${f.why})`).join(', ')}.` : '';
  if (!hooks.readOnly) {
    return {
      state: hooks.failed.length ? 'failed' : 'ok',
      detail: `Wired to Quo — ${hooks.created.length} webhook(s) created, ${hooks.reused.length} reused.${failed}`,
    };
  }
  const missing = hooks.missing.length
    ? `${[...new Set(hooks.missing.map((m) => m.why))].join(' ')} Missing: ${hooks.missing.map((m) => m.family).join(', ')}.`
    : '';
  if (hooks.failed.length) return { state: 'failed', detail: `Quo is read-only — ${hooks.reused.length} webhook(s) in place, none created.${failed}${missing ? ` ${missing}` : ''}` };
  if (!missing) return { state: 'ok', detail: `Wired to Quo, read-only — ${hooks.reused.length} webhooks in place, none created.` };
  return { state: 'read_only', detail: missing };
}
