// M12 (audit 2026-10-20): when Gmail came back after an outage, the inbox
// watch read only the last 15 minutes and logged "ok" — a lead from the
// outage was never requested, and Today switched to "Nothing needs you in
// the inbox right now". Now the first good pass reads from the last good
// read (bounded at 10 days, the catch-up reach), the last good read survives
// a restart on the storage disk, and anything it could not read is a NAMED
// gap until a catch-up covers it. Simulated mail only (SIM- names).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startInboxWatch,
  planPass,
  memoryInboxState,
  CATCHUP_MAX_MS,
  type GmailReader,
  type InboxMessage,
  type InboxStateStore,
  type InboxWatchResult,
} from '../src/ops/inboxWatch.js';
import { InboxStateFile, parseInboxState } from '../src/ops/inboxWatchState.js';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-10-13T12:00:00Z');

const FORMSUBMIT_HTML = `
<table>
  <tr><td><strong>name</strong></td><td>SIM Outage</td></tr>
  <tr><td><strong>phone</strong></td><td>757-555-0143</td></tr>
  <tr><td><strong>email</strong></td><td>sim.outage@example.test</td></tr>
  <tr><td><strong>address</strong></td><td>404 Nowhere Lane</td></tr>
  <tr><td><strong>serviceNeeded</strong></td><td>Tree removal</td></tr>
  <tr><td><strong>urgency</strong></td><td>Emergency</td></tr>
  <tr><td><strong>message</strong></td><td>SIM oak over the shed.</td></tr>
</table>`;
const lead = (id: string, atMs: number): InboxMessage => ({
  id, from: 'noreply@formsubmit.co', subject: 'New estimate request from SIM Testerson — Tree removal', body: FORMSUBMIT_HTML, receivedAtIso: new Date(atMs).toISOString(),
});

/** A Gmail that can be switched off, holding mail with real arrival times; it honours sinceIso and the cap like Gmail does. */
function gmail(mail: InboxMessage[]) {
  const asked: Array<{ sinceIso: string; limit: number }> = [];
  let down = false;
  const reader: GmailReader = {
    recent: async (sinceIso, limit) => {
      asked.push({ sinceIso, limit });
      if (down) return { ok: false, reason: 'token refresh failed: HTTP 400' };
      const nowIso = new Date().toISOString(); // mail that has not arrived yet is not in Gmail
      return { ok: true, messages: mail.filter((m) => m.receivedAtIso >= sinceIso && m.receivedAtIso <= nowIso).slice(0, limit), unreadable: [] };
    },
  };
  return { reader, asked, setDown: (d: boolean) => { down = d; } };
}

function preloaded(lastGoodReadAt: string | null, unavailableSince: string | null = null): InboxStateStore {
  const s = memoryInboxState();
  s.save({ lastGoodReadAt, unavailableSince, gap: null });
  return s;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('M12 — the first good pass after a Gmail outage reads from the last good read', () => {
  it('two days down, then back: the recovery pass reaches back to the last good read and finds the outage lead', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers({ now: T0 });
    const g = gmail([lead('m-outage-1', T0 + DAY)]); // arrives mid-outage
    const passes: InboxWatchResult[] = [];
    const h = startInboxWatch(g.reader, { intervalMs: HOUR, stateStore: preloaded(new Date(T0 - 5 * 60_000).toISOString()), onPass: (r) => passes.push(r) });
    await vi.advanceTimersByTimeAsync(0);
    expect(passes[0]!.status).toBe('ok');
    g.setDown(true);
    await vi.advanceTimersByTimeAsync(2 * DAY);
    const down = passes.at(-1)!;
    expect(down.status).toBe('unavailable');
    expect(down.unavailableSince).toBe(new Date(T0 + HOUR).toISOString());
    g.setDown(false);
    await vi.advanceTimersByTimeAsync(HOUR);
    h.stop();
    const back = passes.at(-1)!;
    const ask = g.asked.at(-1)!;
    // Not the last 15 minutes: from the last good read (minus a minute of overlap), with the catch-up cap.
    expect(Date.parse(ask.sinceIso)).toBeLessThanOrEqual(T0 + 1);
    expect(Date.parse(ask.sinceIso)).toBeGreaterThan(T0 - 5 * 60_000);
    expect(ask.limit).toBe(250);
    expect(back.status).toBe('ok');
    expect(back.caughtUpFromIso).toBe(ask.sinceIso);
    expect(back.leads.map((l) => l.messageId)).toEqual(['m-outage-1']);
    expect(back.gap).toBeUndefined();
    expect(h.state()).toMatchObject({ unavailableSince: null, gap: null });
    expect(Date.parse(h.state().lastGoodReadAt!)).toBe(Date.parse(back.ranAtIso));
    // The pass after recovery is back to the usual 15 minutes.
    expect(planPass(h.state(), Date.parse(back.ranAtIso) + 5 * 60_000, 15, 50)).toMatchObject({ lookbackMinutes: 15, catchUpFromIso: null });
  });

  it('a restart in the middle of an outage does not forget it: the state is on the storage disk', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), 'arbo-inbox-'));
    try {
      const file = new InboxStateFile(dir);
      file.save({ lastGoodReadAt: new Date(T0).toISOString(), unavailableSince: new Date(T0 + HOUR).toISOString(), gap: null });
      expect(JSON.parse(readFileSync(join(dir, 'inbox-watch.json'), 'utf8'))).toMatchObject({ lastGoodReadAt: new Date(T0).toISOString() });
      // A new process — a deploy — reads it back and catches up from there.
      vi.useFakeTimers({ now: T0 + 3 * DAY });
      const g = gmail([lead('m-outage-2', T0 + 2 * DAY)]);
      const passes: InboxWatchResult[] = [];
      const h = startInboxWatch(g.reader, { intervalMs: HOUR, stateStore: new InboxStateFile(dir), onPass: (r) => passes.push(r) });
      await vi.advanceTimersByTimeAsync(0);
      h.stop();
      expect(Date.parse(g.asked[0]!.sinceIso)).toBeLessThanOrEqual(T0);
      expect(passes[0]!.leads.map((l) => l.messageId)).toEqual(['m-outage-2']);
      expect(new InboxStateFile(dir).load()).toMatchObject({ unavailableSince: null, gap: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an outage longer than the 10-day reach reads the 10 days it can and NAMES the rest', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers({ now: T0 + 12 * DAY });
    const g = gmail([]);
    const passes: InboxWatchResult[] = [];
    const h = startInboxWatch(g.reader, { intervalMs: HOUR, stateStore: preloaded(new Date(T0).toISOString()), onPass: (r) => passes.push(r) });
    await vi.advanceTimersByTimeAsync(0);
    h.stop();
    const reach = T0 + 12 * DAY - CATCHUP_MAX_MS;
    expect(Date.parse(g.asked[0]!.sinceIso)).toBe(reach);
    expect(passes[0]!.gap).toEqual({ fromIso: new Date(T0).toISOString(), toIso: new Date(reach).toISOString(), why: 'older_than_catchup' });
    expect(passes[0]!.status).toBe('ok'); // the read worked — the gap rides beside it, named
  });

  it('a catch-up that hits its 250-message cap is a named gap, and a full catch-up over it closes it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers({ now: T0 + 2 * DAY });
    const flood = Array.from({ length: 260 }, (_, i) => ({ id: `m-news-${i}`, from: 'news@example.test', subject: 'SIM newsletter', body: '', receivedAtIso: new Date(T0 + HOUR + i * 60_000).toISOString() }));
    const g = gmail(flood);
    const passes: InboxWatchResult[] = [];
    const h = startInboxWatch(g.reader, { intervalMs: HOUR, stateStore: preloaded(new Date(T0).toISOString()), onPass: (r) => passes.push(r) });
    await vi.advanceTimersByTimeAsync(0);
    expect(passes[0]!.gap).toMatchObject({ why: 'catchup_capped' });
    expect(h.state().gap).toMatchObject({ why: 'catchup_capped' });
    // Mike's Catch up from before the gap, which this time reads under the cap, closes it.
    flood.splice(0, 200);
    const r = await h.backfill(new Date(T0 - HOUR).toISOString());
    h.stop();
    expect(r.gap).toBeUndefined();
    expect(h.state().gap).toBeNull();
  });

  it('no record of an earlier good read is NAMED on the first pass; "Catch up → Last week" closes it', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers({ now: T0 });
    const g = gmail([]);
    const passes: InboxWatchResult[] = [];
    const h = startInboxWatch(g.reader, { intervalMs: HOUR, onPass: (r) => passes.push(r) });
    await vi.advanceTimersByTimeAsync(0);
    expect(passes[0]!.gap).toMatchObject({ fromIso: null, why: 'no_record' });
    await h.backfill(new Date(Date.now() - 24 * HOUR).toISOString()); // a day is not the week
    expect(h.state().gap).toMatchObject({ why: 'no_record' });
    await h.backfill(new Date(Date.now() - 7 * DAY).toISOString());
    h.stop();
    expect(h.state().gap).toBeNull();
  });

  it('a short Catch up right after Gmail returns does not paper over the outage — the next pass still reaches back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers({ now: T0 + 2 * DAY });
    const g = gmail([lead('m-outage-3', T0 + DAY)]);
    g.setDown(true);
    const passes: InboxWatchResult[] = [];
    const h = startInboxWatch(g.reader, { intervalMs: HOUR, stateStore: preloaded(new Date(T0).toISOString()), onPass: (r) => passes.push(r) });
    await vi.advanceTimersByTimeAsync(0);
    expect(passes[0]!.status).toBe('unavailable');
    g.setDown(false);
    await h.backfill(new Date(Date.now() - 5 * 60_000).toISOString());
    expect(h.state().lastGoodReadAt).toBe(new Date(T0).toISOString());
    await vi.advanceTimersByTimeAsync(HOUR);
    h.stop();
    expect(Date.parse(g.asked.at(-1)!.sinceIso)).toBeLessThanOrEqual(T0);
    expect(passes.at(-1)!.leads.map((l) => l.messageId)).toEqual(['m-outage-3']);
  });

  it('only a well-formed state file is believed', () => {
    expect(parseInboxState({ lastGoodReadAt: 'not a date', gap: { why: 'bogus', toIso: 'x' } })).toEqual({ lastGoodReadAt: null, unavailableSince: null, gap: null });
    expect(parseInboxState(null)).toBeNull();
    expect(parseInboxState({ lastGoodReadAt: '2026-10-13T12:00:00.000Z', unavailableSince: null, gap: { fromIso: null, toIso: '2026-10-13T11:45:00.000Z', why: 'no_record' } }))
      .toEqual({ lastGoodReadAt: '2026-10-13T12:00:00.000Z', unavailableSince: null, gap: { fromIso: null, toIso: '2026-10-13T11:45:00.000Z', why: 'no_record' } });
  });

  it('the app names the gap and never says "Nothing needs you" over it; the API carries it', () => {
    const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
    expect(html).toContain('const gmailGapLine = (g) => {');
    expect(html).toContain("const gapLine = gmailGapLine(d.gmailGap);");
    expect(html).toContain("d.gmailGap ? T('Nothing needs you in the mail Arbo has read"); // R27 Phase A (es-owner-a): through T
    expect(html).toContain("[14390, T('Last 10 days')]");
    const src = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(src).toContain('gmailGap: inboxWatch?.state().gap ?? null,');
    expect(src).toContain('stateStore: new InboxStateFile()');
  });
});
