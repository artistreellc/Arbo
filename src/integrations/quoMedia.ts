// Quo photos, VIEW-ONLY (Mike, 2026-10-20: "Needs to be able to view photos
// on quo"). Customers text photos to the Quo line; Arbo already READS those
// texts (R20 webhook, R24 study). This file lets Mike SEE the photos inside
// Arbo without a photo's address ever reaching his phone:
//
//   - The server keeps, IN MEMORY ONLY, a map from an opaque random id to the
//     address it read itself — from Quo's API (the R24 study) or from an
//     authentic, signature-checked Quo webhook. The page only ever gets the
//     id. An id Arbo did not mint is unknown: 404.
//   - GET /api/quo/media/<id> (owner key only) fetches the photo from Quo and
//     hands the bytes on. Nothing is written to disk, to the database, to
//     Drive, or anywhere else, and nothing is sent anywhere.
//   - Only https addresses on Quo's media host are fetched — with NO Quo API
//     key attached (the address carries Quo's own signature), no redirect
//     followed off that host, a size cap, a photo-type check and a deadline.
//
// §4.3: logs carry reasons, counts and a refused HOST name at most — never an
// address, an id or a customer's number. §1B: a photo Arbo could not load is
// named by the page, never a blank square or a silent gap.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * The hosts Quo serves message photos from — exact names, https only. Quo's
 * docs (2026-03-30 webhook payloads) show only this one; the real serving
 * host was not reachable from the build sandbox, so a photo on any other host
 * is refused and its HOST (never the address) is logged once, to learn it.
 */
export const QUO_MEDIA_HOSTS: ReadonlySet<string> = new Set(['share.quo.com']);
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_DEADLINE_MS = 8_000;
/** Redirects followed — each one must land on the list again. */
const MAX_HOPS = 2;
/** Ids held at once; the oldest-refreshed goes first. */
const STORE_CAP = 3_000;
/** The study re-reads a week back every 30 minutes and re-mints what it still sees; an id nobody refreshed for 8 days is let go. */
const MEDIA_TTL_MS = 8 * 24 * 60 * 60 * 1000;
/** Quo and Twilio both carry at most 10 items on one text. */
const PER_TEXT_MAX = 10;
/** Photo types the page can show. Never SVG: an SVG can carry script. */
const PHOTO_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif']);
const SIM_PHOTO = new URL('../app/sim-quo-photo.png', import.meta.url);

export type MediaKind = 'photo' | 'video' | 'audio' | 'contact' | 'pdf' | 'file';

/** All the page is ever told about one attachment. */
export interface MediaRef {
  /** Opaque and random; null when Arbo cannot show this item (not a photo, or an address it will not fetch). */
  mediaId: string | null;
  contentType: string | null;
  kind: MediaKind;
}

/** 'image/JPEG; name=x' → 'image/jpeg'; nothing usable → null. */
function bareType(ct: string | null | undefined): string | null {
  const t = (ct ?? '').split(';')[0]!.trim().toLowerCase().slice(0, 100);
  return t || null;
}

export function mediaKind(contentType: string | null): MediaKind {
  const t = bareType(contentType);
  // Quo's type is optional (string | null). An untyped item is tried as a
  // photo; the fetch checks the real type before a byte reaches the page.
  if (t === null || PHOTO_TYPES.has(t)) return 'photo';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t === 'text/vcard' || t === 'text/x-vcard' || t === 'text/directory') return 'contact';
  if (t === 'application/pdf') return 'pdf';
  return 'file';
}

/** An attachment Arbo names but does not show — the cut Twilio line's, for one. */
export function unviewable(contentType: string | null): MediaRef {
  return { mediaId: null, contentType: bareType(contentType), kind: mediaKind(contentType) };
}

/** https, an exact listed host, the default port, no user:password@. */
export function quoMediaUrlAllowed(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && QUO_MEDIA_HOSTS.has(u.hostname) && u.port === '' && !u.username && !u.password;
}

/** The host alone, for a log line — never the path or the signature. */
function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/[^a-z0-9.-]/g, '').slice(0, 80) || 'no host';
  } catch {
    return 'unreadable address';
  }
}

export type MediaHttp = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; redirect: 'manual'; signal: NonNullable<RequestInit['signal']> },
) => Promise<Response>;

export type MediaLoad =
  | { ok: true; contentType: string; bytes: Buffer }
  | { ok: false; status: number; error: string };

type Failure = { ok: false; status: number; error: string; why: string };
const fail = (status: number, error: string, why: string): Failure => ({ ok: false, status, error, why });

interface Entry {
  url: string | null;
  sim: boolean;
  key: string | null;
  at: number;
}

export interface QuoMediaOptions {
  http?: MediaHttp;
  now?: () => number;
  maxBytes?: number;
  deadlineMs?: number;
  simFile?: URL;
}

export class QuoMediaStore {
  private readonly byId = new Map<string, Entry>();
  /** `quo/<messageId>/<index>` → id, so a re-read keeps the id and refreshes the address. */
  private readonly byKey = new Map<string, string>();
  private readonly loggedHosts = new Set<string>();
  private shownOnce = false;
  private readonly http: MediaHttp;
  private readonly now: () => number;
  private readonly maxBytes: number;
  private readonly deadlineMs: number;
  private readonly simFile: URL;

  constructor(opts: QuoMediaOptions = {}) {
    this.http = opts.http ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? (() => Date.now());
    this.maxBytes = opts.maxBytes ?? MEDIA_MAX_BYTES;
    this.deadlineMs = opts.deadlineMs ?? MEDIA_DEADLINE_MS;
    this.simFile = opts.simFile ?? SIM_PHOTO;
  }

  /** One Quo attachment → what the page may know. An id is minted (or refreshed) only for a photo on Quo's host. */
  mint(messageId: string | null, index: number, item: { url: string | null; contentType: string | null }): MediaRef {
    const ref = unviewable(item.contentType);
    if (ref.kind !== 'photo') return ref;
    if (!item.url || !quoMediaUrlAllowed(item.url)) {
      const host = item.url ? hostOf(item.url) : 'no address';
      if (!this.loggedHosts.has(host) && this.loggedHosts.size < 20) {
        this.loggedHosts.add(host);
        console.error(`[quo-media] a Quo photo on a host not on the list (${host}) was not kept — the app names it "couldn't load"`);
      }
      return ref;
    }
    const key = messageId ? `quo/${messageId}/${index}` : null;
    const known = key ? this.byKey.get(key) : undefined;
    const id = known && this.byId.has(known) ? known : randomBytes(16).toString('base64url');
    this.put(id, { url: item.url, sim: false, key, at: this.now() });
    return { ...ref, mediaId: id };
  }

  /** Every attachment on one text, in order (at most 10). */
  refs(messageId: string | null, media: ReadonlyArray<{ url: string | null; contentType: string | null }>): MediaRef[] {
    return media.slice(0, PER_TEXT_MAX).map((m, i) => this.mint(messageId, i, m));
  }

  /** Practice data only: the SIM placeholder photo from the repo — never a customer's. */
  mintSim(name: string): MediaRef {
    const key = `sim/${name}`;
    const known = this.byKey.get(key);
    const id = known && this.byId.has(known) ? known : randomBytes(16).toString('base64url');
    this.put(id, { url: null, sim: true, key, at: this.now() });
    return { mediaId: id, contentType: 'image/png', kind: 'photo' };
  }

  /** Ids held right now — a count, for status and tests. */
  size(): number {
    return this.byId.size;
  }

  private put(id: string, e: Entry): void {
    this.byId.delete(id); // re-set moves it to the newest end: a photo still being read is the last one let go
    this.byId.set(id, e);
    if (e.key) this.byKey.set(e.key, id);
    while (this.byId.size > STORE_CAP) {
      const oldest = this.byId.entries().next().value;
      if (!oldest) break;
      this.drop(oldest[0], oldest[1]);
    }
  }

  private drop(id: string, e: Entry): void {
    this.byId.delete(id);
    if (e.key && this.byKey.get(e.key) === id) this.byKey.delete(e.key);
  }

  /** The bytes of one photo Arbo minted, read from Quo now — held in memory for this answer only. */
  async load(id: string): Promise<MediaLoad> {
    const e = this.byId.get(id);
    if (!e) return { ok: false, status: 404, error: 'unknown_media' };
    if (this.now() - e.at > MEDIA_TTL_MS) {
      this.drop(id, e);
      return { ok: false, status: 404, error: 'unknown_media' };
    }
    if (e.sim) return { ok: true, contentType: 'image/png', bytes: readFileSync(this.simFile) };
    const out = await this.fetchPhoto(e.url ?? '');
    if (!out.ok) {
      console.error(`[quo-media] a photo did not load — ${out.why}`);
      return { ok: false, status: out.status, error: out.error };
    }
    if (!this.shownOnce) {
      this.shownOnce = true;
      console.log('[quo-media] photos are loading from Quo (first one shown since boot)');
    }
    return out;
  }

  private async fetchPhoto(start: string): Promise<{ ok: true; contentType: string; bytes: Buffer } | Failure> {
    const signal = globalThis.AbortSignal.timeout(this.deadlineMs);
    const mb = Math.round(this.maxBytes / (1024 * 1024));
    let url = start;
    try {
      for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
        if (!quoMediaUrlAllowed(url)) return fail(502, 'host_not_allowed', `${hop ? 'Quo redirected to' : 'an address on'} a host not on the list (${hostOf(url)})`);
        // No Authorization header, ever: the address carries Quo's own
        // signature, and the Quo API key never goes to a media host.
        const res = await this.http(url, { method: 'GET', headers: { accept: 'image/*' }, redirect: 'manual', signal });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          await res.body?.cancel().catch(() => {});
          if (!loc) return fail(502, 'bad_redirect', 'Quo redirected without saying where');
          url = new URL(loc, url).toString();
          continue;
        }
        if (!res.ok) {
          await res.body?.cancel().catch(() => {});
          return fail(502, 'quo_refused', `Quo answered ${res.status}`);
        }
        const type = bareType(res.headers.get('content-type'));
        if (!type || !PHOTO_TYPES.has(type)) {
          await res.body?.cancel().catch(() => {});
          return fail(502, 'not_a_photo', `not a photo type (${type ?? 'none given'})`);
        }
        const declared = Number(res.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > this.maxBytes) {
          await res.body?.cancel().catch(() => {});
          return fail(502, 'too_large', `over ${mb} MB`);
        }
        if (!res.body) return fail(502, 'empty', 'no bytes');
        // Counted as it arrives: a missing or false content-length cannot get past the cap.
        const chunks: Buffer[] = [];
        let total = 0;
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > this.maxBytes) {
            await reader.cancel().catch(() => {});
            return fail(502, 'too_large', `over ${mb} MB`);
          }
          chunks.push(Buffer.from(value));
        }
        if (total === 0) return fail(502, 'empty', 'no bytes');
        return { ok: true, contentType: type === 'image/jpg' || type === 'image/pjpeg' ? 'image/jpeg' : type, bytes: Buffer.concat(chunks, total) };
      }
      return fail(502, 'too_many_redirects', `more than ${MAX_HOPS} redirects`);
    } catch {
      return signal.aborted
        ? fail(504, 'timeout', `took over ${Math.round(this.deadlineMs / 1000)} s`)
        : fail(502, 'unreachable', 'Quo could not be reached');
    }
  }
}
