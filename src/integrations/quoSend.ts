// THE ONE OUTBOUND PATH — a text via Quo. Owner ruling R22 (Mike, 2026-09-24):
// "set up the ability to send texts via quo to have people reach back out to
// 7573195131 if they are still intrested in a quote for the past week only
// and after that use the same templet for follow ups".
//
// Everything else Arbo does is still read-only or receive-only: email never,
// calendar edits never, Twilio/ElevenLabs cut. This file is deliberately
// tiny and dumb — it knows how to POST one message and how to name each way
// Quo can refuse. It does NOT decide whether a message may go out: that is
// src/ops/outreach.ts behind inspectMessage (consent, STOP, quiet hours,
// price/diagnosis/date rules). Nothing may call this without that gate.
//
// §4.3: a refusal is logged by status and Quo's error code only. Never the
// recipient, never the words, never Quo's response body.

import { QUO_API_BASE } from './quo.js';

/** Why Quo refused, by name — each one renders differently in the app. */
export type SendRefusal =
  | 'not_registered'
  | 'daily_cap'
  | 'rate_limited'
  | 'unauthorized'
  | 'subscription_expired'
  | 'bad_request'
  | 'network'
  | 'unreadable_response'
  | `http_${number}`;

export type SendResult =
  | { ok: true; id: string | null; status: string | null; conversationId: string | null }
  | { ok: false; reason: SendRefusal; code: string | null };

export interface QuoSender {
  send(input: { from: string; to: string; content: string }): Promise<SendResult>;
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Quo's documented error codes on POST /v1/messages. */
const CODE_NOT_REGISTERED = '0206400';
const CODE_DAILY_CAP = '0204403';
/** The spec's hard limit on content. */
export const MAX_CONTENT_CHARS = 1600;

export function createQuoSender(apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, base = QUO_API_BASE): QuoSender {
  return {
    async send({ from, to, content }) {
      if (!content.trim() || content.length > MAX_CONTENT_CHARS) return { ok: false, reason: 'bad_request', code: null };
      let res: { ok: boolean; status: number; json(): Promise<unknown> };
      try {
        res = await fetchImpl(`${base}/messages`, {
          method: 'POST',
          headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
          // One recipient per POST: more than one number in `to` makes a GROUP text.
          body: JSON.stringify({ content, from, to: [to] }),
        });
      } catch {
        return { ok: false, reason: 'network', code: null };
      }
      let body: Record<string, unknown> | null = null;
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        body = null;
      }
      if (res.ok) {
        const d = (body?.data ?? null) as Record<string, unknown> | null;
        if (!d) return { ok: false, reason: 'unreadable_response', code: null };
        return {
          ok: true,
          id: typeof d.id === 'string' ? d.id : null,
          status: typeof d.status === 'string' ? d.status : null,
          conversationId: typeof d.conversationId === 'string' ? d.conversationId : null,
        };
      }
      const code = typeof body?.code === 'string' ? body.code : null;
      const reason: SendRefusal =
        res.status === 400 && code === CODE_NOT_REGISTERED ? 'not_registered'
        : res.status === 403 && code === CODE_DAILY_CAP ? 'daily_cap'
        : res.status === 429 ? 'rate_limited'
        : res.status === 401 ? 'unauthorized'
        : res.status === 402 ? 'subscription_expired'
        : res.status === 400 ? 'bad_request'
        : `http_${res.status}`;
      console.error(`[quo-send] refused: ${reason}${code ? ` (${code})` : ''}`);
      return { ok: false, reason, code };
    },
  };
}
