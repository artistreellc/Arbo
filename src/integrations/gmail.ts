/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  Owner instruction from Mike, 2026-08-03. This is not decoration and it
  is not optional. It is here because this is the point in a build where
  things get broken by moving fast, and that already happened to him once
  on the website. It does not happen here.
  ═══════════════════════════════════════════════════════════════════════

  SLOW DOWN. DRASTICALLY. Then:

  1. READ EVERY LINE BEFORE YOU EDIT ONE. Every line, every letter,
     slowly. You are not skimming to find the spot to change — you are
     building a model of what this file already does. If you cannot say
     what the code above and below your edit does, you have not read it.

  2. AN AUDIT IS READ-ONLY. If you were asked to audit, you do not edit.
     You do not "fix it while you are in there." You do not refactor, or
     tidy, or rename. You READ, and you REPORT. Editing during an audit
     is disobeying the instruction, full stop.

  3. THINK BEFORE YOU TYPE. What does this already handle? What depends
     on it? What breaks downstream? Recognise the PATTERN before you call
     something a bug — most things in here that look wrong are a
     deliberate correction. Check docs/OWNER_RULINGS.md first. Use what
     you already know about this codebase instead of re-deciding it.

  4. BRING IT TO MIKE — DO NOT DECIDE IT. Anything that looks wrong,
     ambiguous, or outside what was asked: say it and WAIT. Flagging
     costs one sentence. Deciding on his behalf has cost real work and
     real money more than once.

  5. DO EXACTLY WHAT WAS ASKED. Not the adjacent thing. Not the bigger
     thing you thought of on the way. Not the cleanup. Exactly what was
     asked, and nothing else.

  If you are moving fast right now, you are already off the rails.

  Remember the marker: SLOW::ARBO
*/
// The live Gmail reader (backlog #36's Gmail half). Auth-agnostic like the
// Calendar and Drive modules: pass `getAccessToken`, get a `GmailReader`.
//
// ═══ READ-ONLY, AND THE SCOPE SAYS SO ═══
// This module calls exactly two endpoints, both GET: messages.list and
// messages.get. The OAuth scope it needs is `gmail.readonly` — request that
// one and nothing here CAN write, label, archive, or send, no matter what a
// future edit tries. "Never send email. Ever." is enforced at the token.
//
// ═══ IT CAN SEE SPAM. THE CONNECTOR CANNOT. ═══
// Every scheduled sweep so far has reported SPAM as unreadable — seven runs
// in a row — which means a lead that Google files as spam is invisible to all
// of them. The Gmail API takes `includeSpamTrash`, so this reader asks for it
// and spam lands IN the window rather than behind it. That is the whole
// reason the in-app poller is worth building beyond the five-minute interval.
//
// Note what this does NOT claim: it does not report "we read the spam folder"
// as a separate fact, because a window with no spam in it and a window where
// spam was withheld look identical from here. What it can honestly say is
// that spam was in scope for the query, and that is what it says.
//
// ═══ WHAT IT STILL NEEDS ═══
// A token for a CONSUMER Gmail account (artistreeofvirginia@gmail.com). The
// service-account credentials already in env are NOT enough on their own:
// service accounts reach a personal mailbox only through domain-wide
// delegation, which requires Workspace. This is a user-consent OAuth refresh
// token, and getting one is Mike's call, not something to quietly arrange.

import type { GmailReader, InboxMessage, InboxRead } from '../ops/inboxWatch.js';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

type FetchFn = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
}

/** Gmail ships base64url. Buffer wants base64. */
function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function headerOf(msg: GmailMessage, name: string): string {
  const hs = msg.payload?.headers ?? [];
  return hs.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/**
 * Pull the best body out of a MIME tree.
 *
 * HTML WINS ON PURPOSE. The FormSubmit notification — the website contact
 * form, Mike's own channel — has NO text/plain part at all; its whole payload
 * is one HTML table, and `parseWebsiteForm` reads that table. A reader that
 * preferred plaintext would hand the classifier an empty string and every
 * website lead would parse to a blank row. Preferring HTML costs the other
 * parsers nothing: they match on regexes that survive tags.
 *
 * Attachments are skipped (they carry `filename`) — a PDF's base64 is not a
 * body, and decoding one into a string would be megabytes of noise.
 */
export function extractBody(payload: GmailPart | undefined): string {
  let html = '';
  let text = '';

  const walk = (part: GmailPart | undefined): void => {
    if (!part) return;
    if (part.filename) return; // attachment, not body
    const data = part.body?.data;
    if (data) {
      if (part.mimeType === 'text/html' && !html) html = decodeB64Url(data);
      else if (part.mimeType === 'text/plain' && !text) text = decodeB64Url(data);
    }
    for (const child of part.parts ?? []) walk(child);
  };

  walk(payload);
  return html || text;
}

/**
 * Live Gmail. `fetchFn` is injected so the whole thing is testable offline —
 * same discipline as the GIS provider (D33).
 */
export function createGoogleGmailReader(
  getAccessToken: () => Promise<string>,
  fetchFn: FetchFn = (u, i) => fetch(u, i),
): GmailReader {
  return {
    async recent(sinceIso: string, limit: number): Promise<InboxRead> {
      let auth: Record<string, string>;
      try {
        auth = { Authorization: `Bearer ${await getAccessToken()}` };
      } catch (err) {
        // A token we could not mint is a mailbox we cannot see — never an
        // empty inbox (§1B).
        return { ok: false, reason: `gmail auth failed: ${err instanceof Error ? err.message : 'error'}` };
      }

      // Gmail's `after:` takes epoch SECONDS. It is also whole-second
      // granular and inclusive-ish, so the window is deliberately opened one
      // second early rather than risk clipping a message that landed on the
      // boundary. Re-reporting is deduped upstream; missing is not.
      const afterSec = Math.floor(Date.parse(sinceIso) / 1000) - 1;
      const params = new URLSearchParams({
        q: `after:${afterSec}`,
        maxResults: String(limit),
        includeSpamTrash: 'true',
      });

      let listed: { messages?: { id: string }[] };
      try {
        const res = await fetchFn(`${BASE}/messages?${params}`, { headers: auth });
        if (!res.ok) return { ok: false, reason: `gmail messages.list ${res.status}` };
        listed = (await res.json()) as { messages?: { id: string }[] };
      } catch (err) {
        return { ok: false, reason: `gmail messages.list failed: ${err instanceof Error ? err.message : 'error'}` };
      }

      const ids = (listed.messages ?? []).map((m) => m.id);
      const messages: InboxMessage[] = [];
      // Messages we were listed but could not fetch. This is the honest
      // middle: the list call worked, so `ok: false` would be a lie, but a
      // message we never read might have been the lead. Named, not dropped.
      let missed = 0;
      for (const id of ids) {
        try {
          const res = await fetchFn(`${BASE}/messages/${encodeURIComponent(id)}?format=full`, { headers: auth });
          if (!res.ok) {
            missed++;
            continue;
          }
          const m = (await res.json()) as GmailMessage;
          messages.push({
            id: m.id,
            threadId: m.threadId,
            from: headerOf(m, 'From'),
            subject: headerOf(m, 'Subject'),
            body: extractBody(m.payload),
            receivedAtIso: m.internalDate
              ? new Date(Number(m.internalDate)).toISOString()
              : sinceIso,
          });
        } catch {
          missed++;
        }
      }

      const unreadable: string[] = [];
      if (missed > 0) unreadable.push(`${missed} message(s) listed but unreadable`);
      // A full window is suspicious, not clean: Gmail capped us and there may
      // be more behind the cap. Say so rather than let a busy hour look quiet.
      if (ids.length >= limit) unreadable.push(`hit the ${limit}-message cap — there may be more`);

      return { ok: true, messages, unreadable };
    },
  };
}
