// M12 follow-up (lane B verification, 2026-10-20): the catch-up's cap check
// counted the messages Arbo FETCHED, not the ids Gmail LISTED. After a 7-day
// outage the catch-up listed 250 ids (the cap — older mail behind it) and one
// fetch failed: the check saw 249, recorded no gap, and moved the last good
// read to now. The cut-off mail and the unopened message were mentioned on
// that one 5-minute pass and then vanished; the next 15-minute pass never
// reaches them. A catch-up with any "listed but unreadable" message did the
// same. Now the reader says how many it listed and how many it could not
// open, and the watch keeps a NAMED gap for both — the automatic catch-up
// and Mike's Catch up alike — until a catch-up reads that stretch whole.
// Simulated mail only (SIM- subjects, example.test senders).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGoogleGmailReader } from '../src/integrations/gmail.js';
import { startInboxWatch, memoryInboxState, type InboxStateStore, type InboxWatchResult } from '../src/ops/inboxWatch.js';
import { parseInboxState } from '../src/ops/inboxWatchState.js';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-10-13T13:00:00Z');
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

interface SimMail { id: string; at: number }
/**
 * Gmail over the wire, faked at fetch. It lists like Gmail: mail after the
 * query's `after:` second, newest first, at most maxResults. Any id in
 * `broken` answers 500 when opened.
 */
function gmailFetch(mail: SimMail[], broken: Set<string>) {
  const fn = async (url: string) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/messages')) {
      const max = Number(u.searchParams.get('maxResults'));
      const afterMs = Number(/after:(\d+)/.exec(u.searchParams.get('q') ?? '')![1]) * 1000;
      const hits = mail.filter((m) => m.at >= afterMs).sort((a, b) => b.at - a.at).slice(0, max);
      return { ok: true, status: 200, json: async () => ({ messages: hits.map((m) => ({ id: m.id })) }) };
    }
    const id = decodeURIComponent(u.pathname.split('/').pop()!);
    if (broken.has(id)) return { ok: false, status: 500, json: async () => ({}) };
    const m = mail.find((x) => x.id === id)!;
    return {
      ok: true, status: 200,
      json: async () => ({
        id, threadId: `t-${id}`, internalDate: String(m.at),
        payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'news@example.test' }, { name: 'Subject', value: 'SIM newsletter' }], body: { data: b64('SIM') } },
      }),
    };
  };
  return fn;
}
const token = async () => 'tok';
const preloaded = (lastGoodReadAt: string): InboxStateStore => {
  const s = memoryInboxState();
  s.save({ lastGoodReadAt, unavailableSince: null, gap: null });
  return s;
};
/** n messages, message i arriving `stepMs` after the one before, the first at `startMs`. */
const mailFrom = (startMs: number, n: number, stepMs = 30 * 60_000): SimMail[] => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, at: startMs + i * stepMs }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('M12 follow-up — a catch-up that could not read everything Gmail listed keeps a named gap', () => {
  it('the reader says how many ids Gmail listed and how many it could not open', async () => {
    const read = await createGoogleGmailReader(token, gmailFetch(mailFrom(T0, 3), new Set(['m1']))).recent(new Date(T0).toISOString(), 50);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.messages).toHaveLength(2);
    expect(read).toMatchObject({ listed: 3, missed: 1 });
  });

  it('after a 7-day outage: 250 listed (the cap), 249 opened — the cap is still named, and kept as a gap', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers({ now: T0 + 7 * DAY });
    const passes: InboxWatchResult[] = [];
    const reader = createGoogleGmailReader(token, gmailFetch(mailFrom(T0, 300), new Set(['m297']))); // 300 over the outage; one of the newest won't open
    const h = startInboxWatch(reader, { intervalMs: HOUR, stateStore: preloaded(new Date(T0).toISOString()), onPass: (r) => passes.push(r) });
    await vi.advanceTimersByTimeAsync(0);
    expect(passes[0]!.caughtUpFromIso).toBeDefined();
    expect(passes[0]!.gap).toMatchObject({ why: 'catchup_capped', fromIso: passes[0]!.caughtUpFromIso });
    expect(passes[0]!.listed).toBe(250);
    expect(passes[0]!.missed).toBe(1);
    // And it is still on screen after the pass that found it — the next pass does not wipe it.
    await vi.advanceTimersByTimeAsync(HOUR);
    h.stop();
    expect(h.state().gap).toMatchObject({ why: 'catchup_capped', fromIso: passes[0]!.caughtUpFromIso });
    expect(passes.at(-1)!.gap).toMatchObject({ why: 'catchup_capped', fromIso: passes[0]!.caughtUpFromIso });
  });

  it('a catch-up under the cap with a message it could not open keeps a "could not open" gap', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers({ now: T0 + 2 * DAY });
    const passes: InboxWatchResult[] = [];
    const reader = createGoogleGmailReader(token, gmailFetch(mailFrom(T0, 30), new Set(['m4'])));
    const h = startInboxWatch(reader, { intervalMs: HOUR, stateStore: preloaded(new Date(T0).toISOString()), onPass: (r) => passes.push(r) });
    await vi.advanceTimersByTimeAsync(0);
    expect(passes[0]!.gap).toMatchObject({ why: 'catchup_unread', fromIso: passes[0]!.caughtUpFromIso });
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(h.state().gap).toMatchObject({ why: 'catchup_unread', fromIso: passes[0]!.caughtUpFromIso });
    h.stop();
  });

  it('Mike’s Catch up names the same two holes — and one that reads the stretch whole closes it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const NOW = T0 + 7 * DAY;
    vi.useFakeTimers({ now: NOW });
    const list = mailFrom(NOW - 20 * HOUR, 300, 4 * 60_000); // 300 in the last 20 hours
    const broken = new Set(['m297']);
    const reader = createGoogleGmailReader(token, gmailFetch(list, broken));
    const h = startInboxWatch(reader, { intervalMs: HOUR, stateStore: preloaded(new Date(NOW - 60_000).toISOString()) });
    await vi.advanceTimersByTimeAsync(0);
    const since = new Date(NOW - DAY).toISOString();
    // 250 listed, 249 opened: the cap.
    expect((await h.backfill(since)).gap).toMatchObject({ why: 'catchup_capped', fromIso: since });
    // Under the cap, one unopened: still a gap.
    list.splice(0, 280);
    expect((await h.backfill(since)).gap).toMatchObject({ why: 'catchup_unread', fromIso: since });
    // Gmail answers for it now: the same stretch, read whole, closes it.
    broken.clear();
    const whole = await h.backfill(since);
    h.stop();
    expect(whole.gap).toBeUndefined();
    expect(h.state().gap).toBeNull();
  });

  it('a short Catch up with one unopened message never trades away a wider gap that is still open', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers({ now: T0 });
    const reader = createGoogleGmailReader(token, gmailFetch(mailFrom(T0 - 4 * 60_000, 3, 60_000), new Set(['m2'])));
    const h = startInboxWatch(reader, { intervalMs: HOUR }); // first check on this disk: "no record"
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state().gap).toMatchObject({ why: 'no_record' });
    await h.backfill(new Date(T0 - 5 * 60_000).toISOString());
    h.stop();
    // "Catch up → Last week" — the wider gap's own fix — would read that message again.
    expect(h.state().gap).toMatchObject({ why: 'no_record' });
  });

  it('the gap survives a restart, and the app says it in words with a catch-up offered', () => {
    const g = { fromIso: '2026-10-13T12:59:00.000Z', toIso: '2026-10-20T13:00:00.000Z', why: 'catchup_unread' };
    expect(parseInboxState({ lastGoodReadAt: g.toIso, unavailableSince: null, gap: g })).toEqual({ lastGoodReadAt: g.toIso, unavailableSince: null, gap: g });
    const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8').replace(/\\u([0-9a-fA-F]{4})/g, (_, x: string) => String.fromCharCode(parseInt(x, 16)));
    const gapFn = html.slice(html.indexOf('const gmailGapLine = (g) => {'), html.indexOf("return el('div', 'feed-state unread', words);"));
    expect(gapFn).toContain("g.why === 'catchup_unread'");
    expect(gapFn).toContain('could not open');
    expect(html).toContain("else if (g && g.fromIso && (g.why === 'catchup_capped' || g.why === 'catchup_unread')) {");
  });
});
