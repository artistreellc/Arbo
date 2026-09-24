// R19 (Mike, 2026-09-24): "making the resend website forms be sent directly
// to arbo" + "i want it to still be emailed to me but also go to arbo" +
// "add webhooks for everything".
//
// One intake for everything that can PUSH to Arbo. Nothing here changes how
// anything sends — the website keeps emailing Mike through Resend exactly as
// it does today; Resend additionally notifies this intake, so the same form
// submission lands in the app the moment it is sent. Same shape for
// ElevenLabs post-call transcripts and Railway deploy events.
//
// LAWS THAT APPLY HERE:
// - Arbo NEVER sends email. The Resend API key this module can hold is used
//   by exactly one method, a GET of one sent email's content. There is no
//   send path, and the tests pin that.
// - Every route refuses unsigned/unverified deliveries. A missing secret
//   means the source is NOT WIRED and the status endpoint says so by name
//   (§1B) — it never renders as "no events".
// - Stores are in-memory and capped, like every other pre-links store. Form
//   and call content is customer contact info: keywalled app UI only (R17),
//   never server logs (§4.3 — logs get counts and ids).

import { createHmac, timingSafeEqual } from 'node:crypto';

export type WebhookSource = 'resend' | 'elevenlabs' | 'railway' | 'twilio';

export interface WebhookEventEntry {
  at: string;
  source: WebhookSource;
  kind: string;
  /** Counts-and-ids summary — §4.3-safe, may appear anywhere. */
  summary: string;
}

export interface WebsiteFormEntry {
  at: string;
  emailId: string | null;
  /** 'parsed' = full body fields; 'subject_only' = body unavailable, gap NAMED. */
  bodyState: 'parsed' | 'subject_only';
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  service: string | null;
  timeline: string | null;
  message: string | null;
}

export interface CallTranscriptEntry {
  at: string;
  conversationId: string;
  status: string | null;
  summary: string | null;
  /** ElevenLabs data-collection results, flattened to name → value. */
  collected: Record<string, unknown>;
  turns: number;
}

/**
 * A text to the Arbo number (Mike, 2026-09-24: "how do i get arbo to be able
 * to see incoming texts"). RECEIVE ONLY — Arbo never replies; the webhook
 * answers Twilio with an empty TwiML <Response/>. Customer PII: keywall app
 * UI only (R17), never logs (§4.3).
 */
export interface TextEntry {
  at: string;
  /** 'arbo' = the Twilio number; 'business' = Mike's business cell, relayed by his iPhone Shortcut. */
  line: 'arbo' | 'business';
  messageSid: string | null;
  from: string | null;
  body: string;
  media: Array<{ url: string; contentType: string | null }>;
}

/**
 * Notes on a call Mike ANSWERED on his business cell (Mike, 2026-09-24: "it
 * still listens to the call and takes notes"). Arbo cannot hear his cell —
 * iOS records and transcribes the call itself, and a Share-sheet Shortcut
 * relays the transcript here. Customer PII: keywall app UI only.
 */
export interface CallNoteEntry {
  at: string;
  /** Who the call was with, as the Shortcut sends it (may be blank). */
  withWhom: string | null;
  text: string;
}

export interface SourceStatus {
  configured: boolean;
  received: number;
  rejected: number;
  lastAt: string | null;
  lastError: string | null;
}

const EVENT_CAP = 300;
const FORM_CAP = 100;
const TRANSCRIPT_CAP = 100;
const TEXT_CAP = 200;
const NOTE_CAP = 100;
/** Twilio sends at most 10 media items per MMS. */
const MEDIA_MAX = 10;
const SEEN_CAP = 500;
/** Svix guidance: reject webhooks older than 5 minutes to stop replays. */
const SVIX_TOLERANCE_MS = 5 * 60 * 1000;
/** ElevenLabs signs with a unix-seconds timestamp; they allow ~30 minutes. */
const ELEVEN_TOLERANCE_MS = 30 * 60 * 1000;

const FORM_SUBJECT = /^New estimate request from (.+?)(?: — (.+))?$/;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Verify a Svix-style signature (what Resend sends): HMAC-SHA256 over
 * `${id}.${timestamp}.${body}` with the base64 part of the whsec_ secret,
 * compared against the space-separated `v1,<base64>` list.
 */
export function verifySvixSignature(
  secret: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  rawBody: string,
  nowMs: number,
): { ok: boolean; reason: string | null } {
  if (!headers.id || !headers.timestamp || !headers.signature) return { ok: false, reason: 'missing_headers' };
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(nowMs - ts * 1000) > SVIX_TOLERANCE_MS) return { ok: false, reason: 'stale_timestamp' };
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest('base64');
  const match = headers.signature
    .split(' ')
    .map((part) => part.split(',', 2))
    .some(([version, sig]) => version === 'v1' && sig !== undefined && safeEqual(sig, expected));
  return match ? { ok: true, reason: null } : { ok: false, reason: 'bad_signature' };
}

/**
 * Verify an ElevenLabs post-call signature: header `t=<unix>,v0=<hex>` where
 * v0 = HMAC-SHA256 hex over `${t}.${body}`.
 */
export function verifyElevenLabsSignature(
  secret: string,
  header: string | undefined,
  rawBody: string,
  nowMs: number,
): { ok: boolean; reason: string | null } {
  if (!header) return { ok: false, reason: 'missing_header' };
  const parts = new Map(header.split(',').map((p) => p.split('=', 2) as [string, string]));
  const t = parts.get('t');
  const v0 = parts.get('v0');
  if (!t || !v0) return { ok: false, reason: 'bad_header' };
  const ts = Number(t);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(nowMs - ts * 1000) > ELEVEN_TOLERANCE_MS) return { ok: false, reason: 'stale_timestamp' };
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return safeEqual(v0, expected) ? { ok: true, reason: null } : { ok: false, reason: 'bad_signature' };
}

/** Pull the labelled fields back out of the text body api/contact.js builds. */
export function parseFormText(text: string): Omit<WebsiteFormEntry, 'at' | 'emailId' | 'bodyState'> | null {
  const field = (label: string): string | null => {
    const m = text.match(new RegExp(`^${label}: (.*)$`, 'm'));
    const v = m?.[1]?.trim();
    return v ? v : null;
  };
  const name = field('Name');
  if (!name) return null;
  const msg = text.match(/^Message:\r?\n([\s\S]*)$/m);
  return {
    name,
    phone: field('Phone'),
    email: field('Email'),
    address: field('Property Address'),
    service: field('Service Needed'),
    timeline: field('Timeline'),
    message: msg?.[1]?.trim() || null,
  };
}

export interface WebhookIntakeOptions {
  resendSecret?: string | null;
  elevenSecret?: string | null;
  railwayKey?: string | null;
  twilioSmsKey?: string | null;
  /** GET one sent email's content from Resend — the ONLY Resend API call Arbo makes. */
  fetchEmail?: ((emailId: string) => Promise<{ subject?: string; text?: string } | null>) | null;
  now?: () => number;
}

export class WebhookIntake {
  private readonly opts: WebhookIntakeOptions;
  private readonly now: () => number;
  private readonly events: WebhookEventEntry[] = [];
  private readonly forms: WebsiteFormEntry[] = [];
  private readonly transcripts: CallTranscriptEntry[] = [];
  private readonly textLog: TextEntry[] = [];
  private readonly callNotes: CallNoteEntry[] = [];
  private readonly seenEmailIds = new Set<string>();
  private readonly counters: Record<WebhookSource, { received: number; rejected: number; lastAt: string | null; lastError: string | null }> = {
    resend: { received: 0, rejected: 0, lastAt: null, lastError: null },
    elevenlabs: { received: 0, rejected: 0, lastAt: null, lastError: null },
    railway: { received: 0, rejected: 0, lastAt: null, lastError: null },
    twilio: { received: 0, rejected: 0, lastAt: null, lastError: null },
  };

  constructor(opts: WebhookIntakeOptions = {}) {
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
  }

  private record(source: WebhookSource, kind: string, summary: string): void {
    this.events.push({ at: new Date(this.now()).toISOString(), source, kind, summary });
    if (this.events.length > EVENT_CAP) this.events.splice(0, this.events.length - EVENT_CAP);
    const c = this.counters[source];
    c.received += 1;
    c.lastAt = new Date(this.now()).toISOString();
  }

  private reject(source: WebhookSource, reason: string): { status: number; body: unknown } {
    const c = this.counters[source];
    c.rejected += 1;
    c.lastError = reason;
    // Refusals are counts-only in logs, and honest about which failure it was.
    console.error(`[webhooks] ${source} delivery refused: ${reason}`);
    const status = reason === 'not_wired' ? 503 : 401;
    return { status, body: { error: reason === 'not_wired' ? 'webhook_not_wired' : 'signature_rejected', reason } };
  }

  /** POST /webhooks/resend — svix-signed email lifecycle events. */
  async handleResend(
    headers: { id?: string; timestamp?: string; signature?: string },
    rawBody: string,
  ): Promise<{ status: number; body: unknown }> {
    if (!this.opts.resendSecret) return this.reject('resend', 'not_wired');
    const v = verifySvixSignature(this.opts.resendSecret, headers, rawBody, this.now());
    if (!v.ok) return this.reject('resend', v.reason ?? 'bad_signature');
    let payload: { type?: string; data?: { email_id?: string; subject?: string } };
    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      return this.reject('resend', 'bad_json');
    }
    const kind = payload.type ?? 'unknown';
    const emailId = payload.data?.email_id ?? null;
    this.record('resend', kind, `email ${emailId ?? 'id-unknown'}`);
    // The website form capture: fires once per email, on whichever of
    // sent/delivered arrives first. Every other event type is logged above
    // and needs nothing more.
    const subject = payload.data?.subject ?? '';
    const m = subject.match(FORM_SUBJECT);
    if ((kind === 'email.sent' || kind === 'email.delivered') && m) {
      const dedupeKey = emailId ?? `subject:${subject}:${new Date(this.now()).toISOString().slice(0, 16)}`;
      if (!this.seenEmailIds.has(dedupeKey)) {
        this.seenEmailIds.add(dedupeKey);
        if (this.seenEmailIds.size > SEEN_CAP) {
          const first = this.seenEmailIds.values().next().value as string;
          this.seenEmailIds.delete(first);
        }
        await this.captureForm(emailId, m[1] ?? 'Unknown', m[2] ?? null);
      }
    }
    return { status: 200, body: { ok: true } };
  }

  private async captureForm(emailId: string | null, nameFromSubject: string, serviceFromSubject: string | null): Promise<void> {
    let entry: WebsiteFormEntry = {
      at: new Date(this.now()).toISOString(),
      emailId,
      bodyState: 'subject_only',
      name: nameFromSubject,
      phone: null,
      email: null,
      address: null,
      service: serviceFromSubject,
      timeline: null,
      message: null,
    };
    if (emailId && this.opts.fetchEmail) {
      try {
        const mail = await this.opts.fetchEmail(emailId);
        const parsed = mail?.text ? parseFormText(mail.text) : null;
        if (parsed) entry = { ...entry, ...parsed, bodyState: 'parsed' };
      } catch (err) {
        // Body fetch failing must not lose the submission — the entry stays
        // subject_only and SAYS so (§1B), and the log gets the id, not the form.
        console.error(`[webhooks] form body fetch failed for ${emailId}:`, err instanceof Error ? err.message : 'error');
      }
    }
    this.forms.push(entry);
    if (this.forms.length > FORM_CAP) this.forms.splice(0, this.forms.length - FORM_CAP);
    console.error(`[webhooks] website form captured (${entry.bodyState}) — total ${this.forms.length}`);
  }

  /** POST /webhooks/elevenlabs — post-call transcript, HMAC-signed. */
  handleElevenLabs(signatureHeader: string | undefined, rawBody: string): { status: number; body: unknown } {
    if (!this.opts.elevenSecret) return this.reject('elevenlabs', 'not_wired');
    const v = verifyElevenLabsSignature(this.opts.elevenSecret, signatureHeader, rawBody, this.now());
    if (!v.ok) return this.reject('elevenlabs', v.reason ?? 'bad_signature');
    let payload: {
      type?: string;
      data?: {
        conversation_id?: string;
        status?: string;
        transcript?: unknown[];
        analysis?: { transcript_summary?: string; data_collection_results?: Record<string, { value?: unknown }> };
      };
    };
    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      return this.reject('elevenlabs', 'bad_json');
    }
    const kind = payload.type ?? 'unknown';
    const d = payload.data;
    this.record('elevenlabs', kind, `conversation ${d?.conversation_id ?? 'id-unknown'}`);
    if (kind === 'post_call_transcription' && d?.conversation_id) {
      const collected: Record<string, unknown> = {};
      for (const [k, r] of Object.entries(d.analysis?.data_collection_results ?? {})) {
        if (r && r.value !== undefined && r.value !== null) collected[k] = r.value;
      }
      this.transcripts.push({
        at: new Date(this.now()).toISOString(),
        conversationId: d.conversation_id,
        status: d.status ?? null,
        summary: d.analysis?.transcript_summary ?? null,
        collected,
        turns: Array.isArray(d.transcript) ? d.transcript.length : 0,
      });
      if (this.transcripts.length > TRANSCRIPT_CAP) this.transcripts.splice(0, this.transcripts.length - TRANSCRIPT_CAP);
    }
    return { status: 200, body: { ok: true } };
  }

  /** POST /webhooks/railway?key=… — deploy events, gated by the minted URL key. */
  handleRailway(givenKey: string | null, rawBody: string): { status: number; body: unknown } {
    if (!this.opts.railwayKey) return this.reject('railway', 'not_wired');
    if (!givenKey || !safeEqual(givenKey, this.opts.railwayKey)) return this.reject('railway', 'bad_key');
    // Two shapes in the wild: the current one ({ type: 'Deployment.deployed',
    // resource: { deployment: { id } } }) and the legacy one ({ type:
    // 'DEPLOY', status, deployment: { id } }). Read both.
    let payload: {
      type?: string;
      status?: string;
      deployment?: { id?: string };
      resource?: { deployment?: { id?: string } };
    };
    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      return this.reject('railway', 'bad_json');
    }
    const kind = [payload.type ?? 'event', payload.status].filter(Boolean).join(':');
    const deploymentId = payload.resource?.deployment?.id ?? payload.deployment?.id ?? 'id-unknown';
    this.record('railway', kind, `deployment ${deploymentId}`);
    return { status: 200, body: { ok: true } };
  }

  /**
   * POST /webhooks/twilio/sms?key=… — an incoming text or photo to the Arbo
   * number. Twilio posts form-encoded fields (From, Body, NumMedia,
   * MediaUrlN, MediaContentTypeN, MessageSid). Gated by the minted URL key,
   * same as Railway. The caller answers Twilio with an EMPTY TwiML response:
   * Arbo reads texts, it never sends one.
   */
  handleTwilioSms(givenKey: string | null, rawBody: string): { status: number; body: unknown } {
    if (!this.opts.twilioSmsKey) return this.reject('twilio', 'not_wired');
    if (!givenKey || !safeEqual(givenKey, this.opts.twilioSmsKey)) return this.reject('twilio', 'bad_key');
    const f = new URLSearchParams(rawBody);
    const sid = f.get('MessageSid') ?? f.get('SmsMessageSid');
    const numMedia = Math.min(Math.max(Number(f.get('NumMedia') ?? '0') || 0, 0), MEDIA_MAX);
    const media: TextEntry['media'] = [];
    for (let i = 0; i < numMedia; i += 1) {
      const url = f.get(`MediaUrl${i}`);
      if (url && /^https:\/\//.test(url)) media.push({ url, contentType: f.get(`MediaContentType${i}`) });
    }
    this.pushText({
      at: new Date(this.now()).toISOString(),
      line: 'arbo',
      messageSid: sid,
      from: f.get('From'),
      body: (f.get('Body') ?? '').slice(0, 2000),
      media,
    });
    // Counts and ids only — never the number or the words (§4.3).
    this.record('twilio', media.length ? 'mms.received' : 'sms.received', `message ${sid ?? 'id-unknown'} · ${media.length} photo(s)`);
    return { status: 200, body: null };
  }

  /** §1B: a source with no secret is NOT WIRED by name — never "no events". */
  status(): { sources: Record<WebhookSource, SourceStatus>; note: string } {
    const src = (s: WebhookSource, configured: boolean): SourceStatus => ({ configured, ...this.counters[s] });
    return {
      sources: {
        resend: src('resend', Boolean(this.opts.resendSecret)),
        elevenlabs: src('elevenlabs', Boolean(this.opts.elevenSecret)),
        railway: src('railway', Boolean(this.opts.railwayKey)),
        twilio: src('twilio', Boolean(this.opts.twilioSmsKey)),
      },
      note: 'A source without a secret is NOT WIRED — that is not zero events. Stores are in-memory since deploy.',
    };
  }

  recentEvents(limit = 50): WebhookEventEntry[] {
    return this.events.slice(-limit).reverse();
  }

  websiteForms(): WebsiteFormEntry[] {
    return [...this.forms].reverse();
  }

  private pushText(t: TextEntry): void {
    this.textLog.push(t);
    if (this.textLog.length > TEXT_CAP) this.textLog.splice(0, this.textLog.length - TEXT_CAP);
  }

  /**
   * A text that arrived on Mike's BUSINESS CELL, relayed by his iPhone
   * Shortcuts automation (POST /api/relay/text, behind the app key). iOS
   * gives the automation the sender and the words — never photos — so this
   * entry carries no media, and the app says so rather than implying none.
   */
  relayText(input: { from?: unknown; text?: unknown }): { ok: boolean; error?: string } {
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text) return { ok: false, error: 'text_required' };
    const from = typeof input.from === 'string' && input.from.trim() ? input.from.trim().slice(0, 120) : null;
    this.pushText({ at: new Date(this.now()).toISOString(), line: 'business', messageSid: null, from, body: text.slice(0, 2000), media: [] });
    console.error(`[relay] business-line text received — ${this.textLog.filter((t) => t.line === 'business').length} since deploy`);
    return { ok: true };
  }

  /** A call transcript Mike shared from his iPhone (POST /api/relay/call-notes). */
  relayCallNote(input: { with?: unknown; text?: unknown }): { ok: boolean; error?: string } {
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text) return { ok: false, error: 'text_required' };
    const withWhom = typeof input.with === 'string' && input.with.trim() ? input.with.trim().slice(0, 120) : null;
    this.callNotes.push({ at: new Date(this.now()).toISOString(), withWhom, text: text.slice(0, 20000) });
    if (this.callNotes.length > NOTE_CAP) this.callNotes.splice(0, this.callNotes.length - NOTE_CAP);
    console.error(`[relay] call notes received — ${this.callNotes.length} since deploy`);
    return { ok: true };
  }

  notes(): CallNoteEntry[] {
    return [...this.callNotes].reverse();
  }

  texts(): TextEntry[] {
    return [...this.textLog].reverse();
  }

  callTranscripts(): CallTranscriptEntry[] {
    return [...this.transcripts].reverse();
  }
}

/**
 * The one Resend API call Arbo makes: GET a sent email's content so a form
 * capture can carry the fields, not just the subject. THERE IS NO SEND PATH
 * IN THIS FILE AND THERE NEVER WILL BE — "never send email" is a hard
 * boundary, and the tests pin that this module never POSTs to Resend.
 */
export function createResendEmailFetcher(
  apiKey: string,
  fetchImpl: (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }> = fetch,
): (emailId: string) => Promise<{ subject?: string; text?: string } | null> {
  return async (emailId: string) => {
    const res = await fetchImpl(`https://api.resend.com/emails/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { subject?: string; text?: string };
    return { subject: body.subject, text: body.text };
  };
}
