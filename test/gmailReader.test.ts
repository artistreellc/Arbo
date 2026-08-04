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
// The live Gmail reader, exercised entirely offline through an injected
// fetch. Fixtures are SYNTHETIC (§4.3).

import { describe, it, expect } from 'vitest';
import { createGoogleGmailReader, extractBody } from '../src/integrations/gmail.js';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

/** A fetch that answers from a map of URL-substring → payload. */
function fakeFetch(routes: { match: string; status?: number; body?: unknown; throws?: boolean }[]) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const r = routes.find((x) => url.includes(x.match));
    if (!r) throw new Error(`unrouted: ${url}`);
    if (r.throws) throw new Error('network down');
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body,
    };
  };
  return { fn, calls };
}

const token = async () => 'tok';

describe('gmail reader — body extraction', () => {
  it('prefers HTML, because the website form has no plaintext part at all', () => {
    const body = extractBody({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64('plain version') } },
        { mimeType: 'text/html', body: { data: b64('<table><tr><td>html version</td></tr></table>') } },
      ],
    });
    expect(body).toContain('html version');
    expect(body).not.toContain('plain version');
  });

  it('falls back to plaintext when that is all there is (CallRail, LSA)', () => {
    const body = extractBody({ mimeType: 'text/plain', body: { data: b64('Call from SIM') } });
    expect(body).toBe('Call from SIM');
  });

  it('finds a body nested two levels down (multipart/mixed → alternative)', () => {
    const body = extractBody({
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [{ mimeType: 'text/html', body: { data: b64('<p>deep</p>') } }],
        },
      ],
    });
    expect(body).toBe('<p>deep</p>');
  });

  it('skips attachments — a PDF is not a body', () => {
    const body = extractBody({
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', body: { data: b64('the actual message') } },
        { mimeType: 'application/pdf', filename: 'permit.pdf', body: { data: b64('%PDF-1.4 junk') } },
      ],
    });
    expect(body).toBe('the actual message');
    expect(body).not.toContain('PDF');
  });

  it('an empty payload is an empty string, not a crash', () => {
    expect(extractBody(undefined)).toBe('');
    expect(extractBody({ mimeType: 'text/plain' })).toBe('');
  });
});

describe('gmail reader — reading a window', () => {
  const MSG = {
    id: 'm1',
    threadId: 't1',
    internalDate: '1785758400000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'no-reply@callrail.com' },
        { name: 'Subject', value: 'Missed call from SIM for Art-is-Tree' },
      ],
      body: { data: b64('Duration: 0:00') },
    },
  };

  it('lists and fetches, and asks for spam explicitly', async () => {
    const { fn, calls } = fakeFetch([
      { match: '/messages?', body: { messages: [{ id: 'm1' }] } },
      { match: '/messages/m1', body: MSG },
    ]);
    const read = await createGoogleGmailReader(token, fn).recent('2026-08-03T12:00:00Z', 50);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.messages).toHaveLength(1);
    expect(read.messages[0]!.from).toBe('no-reply@callrail.com');
    expect(read.messages[0]!.subject).toContain('Missed call');
    expect(read.unreadable).toEqual([]);
    // The SPAM blind spot the connector has, closed at the query.
    expect(calls[0]).toContain('includeSpamTrash=true');
    // Gmail's after: is epoch SECONDS, opened a second early on purpose.
    expect(calls[0]).toContain(`after%3A${Math.floor(Date.parse('2026-08-03T12:00:00Z') / 1000) - 1}`);
  });

  it('a failed list is UNAVAILABLE, never an empty window (§1B)', async () => {
    const { fn } = fakeFetch([{ match: '/messages?', status: 403 }]);
    const read = await createGoogleGmailReader(token, fn).recent('2026-08-03T12:00:00Z', 50);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toContain('403');
  });

  it('a token we could not mint is UNAVAILABLE too', async () => {
    const { fn } = fakeFetch([{ match: '/messages?', body: { messages: [] } }]);
    const bad = async () => {
      throw new Error('refresh token expired');
    };
    const read = await createGoogleGmailReader(bad, fn).recent('2026-08-03T12:00:00Z', 50);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toContain('refresh token expired');
  });

  it('a message listed but unreadable is NAMED, not dropped', async () => {
    const { fn } = fakeFetch([
      { match: '/messages?', body: { messages: [{ id: 'm1' }, { id: 'm2' }] } },
      { match: '/messages/m1', body: MSG },
      { match: '/messages/m2', status: 500 },
    ]);
    const read = await createGoogleGmailReader(token, fn).recent('2026-08-03T12:00:00Z', 50);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.messages).toHaveLength(1);
    // The list worked, so this is not `ok: false` — but one message we never
    // read might have been the lead, and that has to show up somewhere.
    expect(read.unreadable.join(' ')).toContain('1 message(s) listed but unreadable');
  });

  it('a full window says so — a cap is not a quiet hour', async () => {
    const { fn } = fakeFetch([
      { match: '/messages?', body: { messages: [{ id: 'm1' }, { id: 'm2' }] } },
      { match: '/messages/m1', body: MSG },
      { match: '/messages/m2', body: { ...MSG, id: 'm2' } },
    ]);
    const read = await createGoogleGmailReader(token, fn).recent('2026-08-03T12:00:00Z', 2);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.unreadable.join(' ')).toContain('cap');
  });

  it('an empty window that WAS read is ok and empty', async () => {
    const { fn } = fakeFetch([{ match: '/messages?', body: {} }]);
    const read = await createGoogleGmailReader(token, fn).recent('2026-08-03T12:00:00Z', 50);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.messages).toEqual([]);
    expect(read.unreadable).toEqual([]);
  });
});
