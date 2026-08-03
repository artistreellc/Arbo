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
// The in-app inbox watch. Fixtures are SYNTHETIC (§4.3) — SIM- names,
// 555-01xx numbers, senders shaped like the real ones and nothing else.

import { describe, it, expect, vi, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createArborRequestHandler } from '../src/server.js';
import {
  watchInbox,
  unavailablePass,
  assertNoPii,
  redact,
  watchLogLine,
  startInboxWatch,
  SeenMessages,
  WATCH_INTERVAL_MS,
  type GmailReader,
  type InboxMessage,
  type InboxRead,
  type InboxWatchResult,
} from '../src/ops/inboxWatch.js';

const AT = new Date('2026-08-03T12:00:00Z');

function msg(over: Partial<InboxMessage> & { id: string }): InboxMessage {
  return {
    from: 'someone@example.test',
    subject: 'hello',
    body: '',
    receivedAtIso: '2026-08-03T11:55:00Z',
    ...over,
  };
}

/** A reader that hands back exactly what the test names. Nothing else. */
function readerOf(read: InboxRead): GmailReader {
  return { recent: async () => read };
}

const FORMSUBMIT_HTML = `
<table>
  <tr><td><strong>name</strong></td><td>SIM Testerson</td></tr>
  <tr><td><strong>phone</strong></td><td>757-555-0142</td></tr>
  <tr><td><strong>email</strong></td><td>sim.testerson@example.test</td></tr>
  <tr><td><strong>address</strong></td><td>404 Nowhere Lane</td></tr>
  <tr><td><strong>serviceNeeded</strong></td><td>Tree removal</td></tr>
  <tr><td><strong>urgency</strong></td><td>Emergency</td></tr>
  <tr><td><strong>message</strong></td><td>Big oak leaning over the shed.</td></tr>
</table>`;

const WEBSITE_LEAD = msg({
  id: 'm-web-1',
  from: 'noreply@formsubmit.co',
  subject: 'New estimate request from SIM Testerson — Tree removal',
  body: FORMSUBMIT_HTML,
});

describe('inbox watch — §1B: a reader we cannot read is never an empty inbox', () => {
  it('reports UNAVAILABLE, not zero leads, when the reader says no', async () => {
    const r = await watchInbox(readerOf({ ok: false, reason: 'gmail 403' }), new SeenMessages(), AT);
    expect(r.status).toBe('unavailable');
    expect(r.reason).toContain('403');
    // The blind spot is NAMED. An unavailable pass with an empty `unreadable`
    // would render as a clean pass on any surface that only reads that field.
    expect(r.unreadable.length).toBeGreaterThan(0);
  });

  it('treats a reader that THREW the same as a reader that said no', async () => {
    const thrower: GmailReader = {
      recent: async () => {
        throw new Error('socket hang up');
      },
    };
    const r = await watchInbox(thrower, new SeenMessages(), AT);
    expect(r.status).toBe('unavailable');
    expect(r.reason).toContain('socket hang up');
  });

  it('never reports ok while a mailbox is unreadable — the SPAM hole', async () => {
    const r = await watchInbox(
      readerOf({ ok: true, messages: [], unreadable: ['SPAM'] }),
      new SeenMessages(),
      AT,
    );
    expect(r.status).toBe('degraded');
    expect(r.unreadable).toContain('SPAM');
    expect(watchLogLine(r)).toContain('DEGRADED');
  });

  it('an empty window that WAS fully read is ok — "nothing arrived" is a real answer', async () => {
    const r = await watchInbox(readerOf({ ok: true, messages: [], unreadable: [] }), new SeenMessages(), AT);
    expect(r.status).toBe('ok');
    expect(r.leads).toEqual([]);
  });
});

describe('inbox watch — classification', () => {
  it('sees a website form lead and reports presence, never content', async () => {
    const r = await watchInbox(
      readerOf({ ok: true, messages: [WEBSITE_LEAD], unreadable: [] }),
      new SeenMessages(),
      AT,
    );
    expect(r.status).toBe('ok');
    expect(r.leads).toHaveLength(1);
    const lead = r.leads[0]!;
    expect(lead.provider).toBe('website_form');
    expect(lead.hasPhone).toBe(true);
    expect(lead.hasEmail).toBe(true);
    expect(lead.hasAddress).toBe(true);
    expect(lead.urgency).toBe('Emergency');
    // The form carries no city or ZIP, so nobody can tell. null, not false —
    // rendering "unknown" as "out of area" bins real work.
    expect(lead.inServiceArea).toBeNull();
    // And none of the customer is in the report.
    const json = JSON.stringify(r);
    expect(json).not.toContain('SIM Testerson');
    expect(json).not.toContain('757-555-0142');
    expect(json).not.toContain('Nowhere Lane');
  });

  it('counts a switched-off channel by name instead of dropping it (§3.7)', async () => {
    const ha = msg({
      id: 'm-ha-1',
      from: 'newlead@em.angi.com',
      subject: 'New Opportunity: Tree removal in Norfolk',
      body: 'x',
    });
    const r = await watchInbox(readerOf({ ok: true, messages: [ha], unreadable: [] }), new SeenMessages(), AT);
    expect(r.leads).toHaveLength(0);
    expect(r.channelOff.home_advisor).toBe(1);
    // Off is a stated fact, not a fault — the pass is still ok.
    expect(r.status).toBe('ok');
    expect(watchLogLine(r)).toContain('home_advisor=1');
  });

  it('ALARMS on mail from a sender we claim to understand and could not parse', async () => {
    // This is the defect class that hit three times in one day: the runbook
    // describes the channel, the code cannot reach it, and the mail lands in
    // the noise pile.
    const weird = msg({
      id: 'm-cr-1',
      from: 'no-reply@callrail.com',
      subject: 'Some subject shape nobody wrote a rule for',
      body: 'x',
    });
    const r = await watchInbox(readerOf({ ok: true, messages: [weird], unreadable: [] }), new SeenMessages(), AT);
    expect(r.unparsedKnownSenderIds).toEqual(['m-cr-1']);
    expect(r.otherMail).toBe(0);
    expect(r.status).toBe('degraded');
    expect(watchLogLine(r)).toContain('UNPARSED_KNOWN_SENDER=1');
  });

  it('does NOT alarm on ordinary mail — a newsletter is not a missed lead', async () => {
    const news = msg({ id: 'm-news-1', from: 'digest@arborist-weekly.test', subject: 'August issue' });
    const r = await watchInbox(readerOf({ ok: true, messages: [news], unreadable: [] }), new SeenMessages(), AT);
    expect(r.otherMail).toBe(1);
    expect(r.unparsedKnownSenderIds).toEqual([]);
    expect(r.status).toBe('ok');
  });

  it('a lookalike sender does not count as a known channel', async () => {
    const fake = msg({ id: 'm-fake-1', from: 'no-reply@callrail.com.evil.test', subject: 'Call from someone' });
    const r = await watchInbox(readerOf({ ok: true, messages: [fake], unreadable: [] }), new SeenMessages(), AT);
    expect(r.unparsedKnownSenderIds).toEqual([]);
    expect(r.otherMail).toBe(1);
  });

  it('the arithmetic closes — every scanned message lands in exactly one bucket', async () => {
    const messages = [
      WEBSITE_LEAD,
      msg({ id: 'm-ha-2', from: 'newlead@em.angi.com', subject: 'New Opportunity: x', body: 'x' }),
      msg({ id: 'm-cr-2', from: 'no-reply@callrail.com', subject: 'nonsense' }),
      msg({ id: 'm-news-2', from: 'digest@arborist-weekly.test', subject: 'August issue' }),
    ];
    const r = await watchInbox(readerOf({ ok: true, messages, unreadable: [] }), new SeenMessages(), AT);
    const off = Object.values(r.channelOff).reduce((a, b) => a + b, 0);
    expect(r.leads.length + off + r.unparsedKnownSenderIds.length + r.otherMail).toBe(r.scanned);
    expect(r.scanned).toBe(4);
  });
});

describe('inbox watch — dedupe', () => {
  it('reports a message once, then counts it as already seen', async () => {
    const seen = new SeenMessages();
    const reader = readerOf({ ok: true, messages: [WEBSITE_LEAD], unreadable: [] });
    const first = await watchInbox(reader, seen, AT);
    const second = await watchInbox(reader, seen, AT);
    expect(first.leads).toHaveLength(1);
    expect(second.leads).toHaveLength(0);
    expect(second.alreadySeen).toBe(1);
    expect(second.scanned).toBe(0);
  });

  it('the memory is bounded — a long-lived process cannot grow it forever', () => {
    const seen = new SeenMessages(3);
    ['a', 'b', 'c', 'd'].forEach((id) => seen.remember(id));
    expect(seen.size).toBe(3);
    expect(seen.has('a')).toBe(false); // oldest out first
    expect(seen.has('d')).toBe(true);
  });
});

describe('inbox watch — §4.3, structurally', () => {
  it('assertNoPii throws on a phone number', () => {
    const bad = { ...unavailablePass('2026-08-03T12:00:00Z', 'x'), reason: 'call 757-555-0142' };
    expect(() => assertNoPii(bad)).toThrow(/phone/i);
  });

  it('assertNoPii throws on an email address', () => {
    const bad = { ...unavailablePass('2026-08-03T12:00:00Z', 'x'), reason: 'sim@example.test' };
    expect(() => assertNoPii(bad)).toThrow(/email/i);
  });

  it('assertNoPii throws on a street address', () => {
    const bad = { ...unavailablePass('2026-08-03T12:00:00Z', 'x'), reason: '404 Nowhere Lane' };
    expect(() => assertNoPii(bad)).toThrow(/street/i);
  });

  it('does NOT trip on an ISO timestamp — the guard must survive normal data', () => {
    expect(() => assertNoPii(unavailablePass('2026-08-03T12:00:00Z', 'gmail 403'))).not.toThrow();
  });

  it('a reader error that quotes an address is redacted, not crashed', async () => {
    // §1B beats a tidy guard: an honest UNAVAILABLE must survive a 403 that
    // happens to name the mailbox.
    const thrower: GmailReader = {
      recent: async () => {
        throw new Error('403 for artistreeofvirginia@example.test');
      },
    };
    const r = await watchInbox(thrower, new SeenMessages(), AT);
    expect(r.status).toBe('unavailable');
    expect(r.reason).toContain('[redacted-email]');
    expect(r.reason).not.toContain('@example.test');
  });

  it('redact leaves ordinary text alone', () => {
    expect(redact('gmail 403 on SPAM')).toBe('gmail 403 on SPAM');
  });

  it('redact scrubs EVERY shape the assertion rejects — the two cannot drift', () => {
    // The regression this locks: redact used to be the weaker list, so an
    // error text carrying a street address or a "(757) 555" fragment slipped
    // past it and then blew up the assertion, losing the honest UNAVAILABLE.
    for (const raw of [
      'gmail 403 for sim@example.test',
      'timeout calling 757-555-0142',
      'bad recipient (757) 555',
      'no mailbox at 404 Nowhere Lane',
    ]) {
      expect(() => unavailablePass('2026-08-03T12:00:00Z', raw)).not.toThrow();
      expect(redact(raw)).toContain('[redacted');
    }
  });

  it('the log line carries counts and ids only', async () => {
    const r = await watchInbox(
      readerOf({ ok: true, messages: [WEBSITE_LEAD], unreadable: [] }),
      new SeenMessages(),
      AT,
    );
    const line = watchLogLine(r);
    expect(line).toContain('leads=1');
    expect(line).not.toContain('SIM');
    expect(line).not.toContain('0142');
  });

  it('the UNAVAILABLE line says so out loud and does not imply zero', () => {
    const line = watchLogLine(unavailablePass('2026-08-03T12:00:00Z', 'no Gmail credentials configured'));
    expect(line).toContain('UNAVAILABLE');
    expect(line).toContain('not zero leads');
  });
});

describe('inbox watch — the five-minute loop', () => {
  it('runs on Mike’s five minutes', () => {
    expect(WATCH_INTERVAL_MS).toBe(5 * 60_000);
  });

  it('with no credentials it still reports, and reports UNAVAILABLE', async () => {
    vi.useFakeTimers();
    try {
      const passes: InboxWatchResult[] = [];
      const h = startInboxWatch(null, { onPass: (r) => passes.push(r) });
      await vi.advanceTimersByTimeAsync(0); // the boot proof-of-life pass
      h.stop();
      expect(passes).toHaveLength(1);
      expect(passes[0]!.status).toBe('unavailable');
      expect(passes[0]!.reason).toContain('no Gmail credentials');
      // Never a confident zero on a screen that cannot see.
      expect(passes[0]!.unreadable.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ticks again on the interval and never overlaps itself', async () => {
    vi.useFakeTimers();
    try {
      let inFlight = 0;
      let overlapped = false;
      let calls = 0;
      const slow: GmailReader = {
        recent: async () => {
          calls++;
          if (inFlight > 0) overlapped = true;
          inFlight++;
          await new Promise((res) => setTimeout(res, WATCH_INTERVAL_MS * 2));
          inFlight--;
          return { ok: true, messages: [], unreadable: [] };
        },
      };
      const h = startInboxWatch(slow);
      await vi.advanceTimersByTimeAsync(WATCH_INTERVAL_MS * 3);
      h.stop();
      expect(overlapped).toBe(false);
      expect(calls).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes the last pass so a surface can render it without triggering one', async () => {
    vi.useFakeTimers();
    try {
      const h = startInboxWatch(readerOf({ ok: true, messages: [WEBSITE_LEAD], unreadable: [] }));
      expect(h.last()).toBeNull();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.last()?.leads).toHaveLength(1);
      h.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── The API path. The tests above prove the engine; this proves the app
// actually calls it, which is the failure mode this codebase keeps hitting —
// a tested function nothing invokes.
describe('GET /api/inbox', () => {
  let server: Server | null = null;
  afterAll(() => {
    server?.close();
  });

  it('answers UNAVAILABLE — not an empty pass — when no watch has run', async () => {
    server = createServer(createArborRequestHandler());
    await new Promise<void>((r) => server!.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/inbox`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as InboxWatchResult;
    // The handler is reached (not a 404) and it tells the truth about a watch
    // that has not completed a pass. On a screen, "unavailable" and "0 leads"
    // look the same and mean opposite things.
    expect(body.status).toBe('unavailable');
    expect(body.leads).toEqual([]);
    expect(body.unreadable.length).toBeGreaterThan(0);
  });
});

describe('inbox watch — read-only by construction (R4)', () => {
  it('the reader interface has exactly one method, and it reads', () => {
    // A structural test, not a style one: "never send email, ever" and R4's
    // read-only sweep both survive a refactor only if there is nothing to
    // call. If someone adds label()/send() here, this fails.
    const shape: GmailReader = { recent: async () => ({ ok: true, messages: [], unreadable: [] }) };
    expect(Object.keys(shape)).toEqual(['recent']);
  });
});
