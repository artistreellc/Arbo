// M10 follow-up (lane B verification, 2026-10-20): the week's read of Quo's
// record counted as whole whenever it was not capped — including when it
// never finished. The boot week read failed once (a timeout), the 10-minute
// passes looked back one day, and the app, Talk and /health/feeds all said
// "No Sona calls in the last 7 days — checked against Quo's own record" / ok
// over five Sona calls 2–6 days old that Arbo had never read.
//
// Now the week counts as read only once a week-long pass finished with
// nothing left unread (weekReadOkAt), the timed passes keep reading the week
// until then (and read back to the last good pass after an outage), and
// every surface names the gap instead of an empty week (§1B).
// Simulated data only (555-01xx numbers).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { QuoIntake } from '../src/ops/quoIntake.js';
import { CallMemory, CallRecordStore } from '../src/reception/callMemory.js';
import { createTalkTools } from '../src/voice/ownerTalk.js';
import { buildFeedHealth } from '../src/ops/feedHealth.js';
import { loadAllConfig } from '../src/config/loadConfig.js';
import { QuoHttpError, type QuoApi, type QuoTranscript } from '../src/integrations/quo.js';
import type { SonaCallFacts } from '../src/ops/quoExtract.js';

const NOW = Date.parse('2026-10-20T15:00:00Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const WEEK = 7 * DAY;
const LINE = '+17576069432';
const unescape = (s: string) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
const html = unescape(readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8'));
const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');

const FACTS: SonaCallFacts = { wantsEstimate: false, name: null, address: null, city: null, jobType: null, treeDetails: null, powerLines: null, emergency: false, requestedTime: null, agentSlips: [], callerType: 'customer' };
const TR: QuoTranscript = { status: 'completed', dialogue: [{ identifier: LINE, content: 'Art-is-Tree, this is Sona.', userId: null }, { identifier: '+17575550100', content: 'SIM- a pine leaning on the fence', userId: null }] };

interface SimCall { id: string; number: string; at: number }
/** One Sona call per thread, `ageMs(i)` old. */
const calls = (n: number, ageMs: (i: number) => number): SimCall[] =>
  Array.from({ length: n }, (_, i) => ({ id: `AC${i}`, number: `+1757555${String(100 + i).padStart(4, '0')}`, at: NOW - ageMs(i) }));

/** A fake Quo that answers from `list` by window, and fails the first `failFirst` conversation listings. */
function fakeQuo(list: SimCall[], opts: { failFirst?: number; transcript?: (id: string) => Promise<QuoTranscript | null> } = {}): QuoApi & { windows: number[] } {
  let fails = opts.failFirst ?? 0;
  const windows: number[] = [];
  return {
    windows,
    listPhoneNumbers: async () => [LINE],
    phoneNumbers: async () => [{ id: 'PN1', number: LINE }],
    listConversations: async ({ updatedAfterIso }) => {
      windows.push(Date.parse(updatedAfterIso));
      if (fails > 0) {
        fails -= 1;
        throw new Error('Quo GET /conversations -> aborted (timeout)');
      }
      const since = Date.parse(updatedAfterIso);
      return list.filter((c) => c.at >= since).map((c) => ({ id: `CN${c.id}`, phoneNumberId: 'PN1', participants: [c.number], lastActivityAt: new Date(c.at).toISOString(), updatedAt: new Date(c.at).toISOString() }));
    },
    listCalls: async ({ participant, createdAfterIso }) => list
      .filter((c) => c.number === participant && c.at >= Date.parse(createdAfterIso))
      .map((c) => ({ id: c.id, direction: 'incoming' as const, status: 'completed', aiHandled: 'ai-agent', createdAt: new Date(c.at).toISOString(), answeredAt: null, completedAt: null })),
    listMessages: async () => [],
    getCallTranscript: opts.transcript ?? (async () => TR),
    listWebhooks: async () => [], getWebhook: async () => null,
    createWebhook: async () => { throw new Error('read only'); }, deleteWebhook: async () => { throw new Error('read only'); },
  };
}

function intake(now: () => number) {
  return new QuoIntake({
    guardrails: loadAllConfig().guardrails, extractor: { extract: async () => FACTS }, callMemory: new CallMemory(), callRecords: new CallRecordStore(),
    calendarHold: null, onText: () => {}, now, sleep: async () => {},
  });
}

const talkSona = async (q: QuoIntake) => {
  const reads = { quo: () => ({ status: q.status(), calls: q.list() }), mode: () => 'live' } as unknown as Parameters<typeof createTalkTools>[0];
  return (await createTalkTools(reads, { now: () => NOW }).run('arbo_sona_calls')).text;
};
const quoRecordFeed = (q: QuoIntake) => buildFeedHealth({
  gmail: { configured: true, started: true, last: null, state: null }, holds: { configured: true },
  quo: { configured: true, status: q.status() }, study: null, storm: null, bouncie: null,
}, new Date(NOW)).feeds.find((f) => f.feed === 'quo_record')!;

afterEach(() => vi.restoreAllMocks());

describe('M10 follow-up — a week read that never finished is never shown as the whole week', () => {
  it('the boot week read fails, the day read works: no "No Sona calls in the last 7 days", and the gap is named everywhere', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const old = calls(5, (i) => (2 + i) * DAY); // five Sona calls, 2–6 days old
    const api = fakeQuo(old, { failFirst: 1 });
    const q = intake(() => NOW);
    q.setRegistration('ok', 'wired', ['k'], [LINE]);
    await q.reconcile(api, 'PN1', WEEK); // the boot read: times out
    await q.reconcile(api, 'PN1', DAY); // a day-back pass: works, finds nothing
    const rec = q.status().quoRecord;
    expect(rec).toMatchObject({ error: null, weekThreadsNotRead: null, weekReadOkAt: null });
    expect(q.list()).toHaveLength(0); // five calls in Quo, none read — not "none"

    const talk = await talkSona(q);
    expect(talk).not.toContain('No Sona calls in the last 7 days');
    expect(talk).toContain("Arbo has not finished reading the past week of Quo's record");

    const feed = quoRecordFeed(q);
    expect(feed.state).not.toBe('ok');
    expect(feed).toMatchObject({ state: 'degraded', detail: expect.stringContaining('not finished reading the past week') });
  });

  it('the Sona card names it, and says "none this week" only after a whole week read', () => {
    const p = html.slice(html.indexOf('async function sonaPanel('), html.indexOf('// ---------- Text outreach via Quo'));
    expect(p).toContain("if (rec.lastAt && !rec.weekReadOkAt && !(rec.weekThreadsNotRead > 0)) {");
    expect(p).toContain("'Arbo has not finished reading the past week of Quo’s record — the Sona calls here are not the whole week yet.'");
    expect(p).toContain("if (!rec.lastAt) wrap.appendChild(el('div', 'storm-muted', 'Wired — reading Sona’s calls from Quo…'));");
    expect(p).toContain("else if (rec.weekReadOkAt) wrap.appendChild(el('div', 'storm-muted', 'No Sona calls in the last 7 days — checked against Quo’s own record.'));");
    // The empty-week line appears exactly once, and only behind weekReadOkAt.
    expect(p.split('No Sona calls in the last 7 days').length).toBe(2);
  });

  it('the timed passes keep reading the week until a week pass finishes, then read a day', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const old = calls(5, (i) => (2 + i) * DAY);
    const api = fakeQuo(old, { failFirst: 1 });
    const q = intake(() => NOW);
    expect(q.nextWindowMs(DAY)).toBe(WEEK); // nothing read yet
    await q.reconcile(api, 'PN1', WEEK); // fails
    expect(q.nextWindowMs(DAY)).toBe(WEEK);
    await q.reconcile(api, 'PN1', DAY); // works, but a day is not the week
    expect(q.nextWindowMs(DAY)).toBe(WEEK);
    await q.reconcile(api, 'PN1', q.nextWindowMs(DAY)); // the next timed pass reads the week
    expect(q.list()).toHaveLength(5);
    expect(q.status().quoRecord.weekReadOkAt).toBe(new Date(NOW).toISOString());
    expect(q.nextWindowMs(DAY)).toBe(DAY);
    // And now the empty-week line is earned: a quiet week, read whole, says so.
    const quiet = intake(() => NOW);
    quiet.setRegistration('ok', 'wired', ['k'], [LINE]);
    await quiet.reconcile(fakeQuo([]), 'PN1', WEEK);
    expect(await talkSona(quiet)).toContain("No Sona calls in the last 7 days — checked against Quo's own record.");
    expect(quoRecordFeed(quiet).state).toBe('ok');
  });

  it('the server’s 10-minute pass asks the intake how far back to read', () => {
    expect(server).toContain('void intake.reconcile(line.api, line.phoneNumberId, QUO_LEARN_BACKFILL_MS);');
    expect(server).toContain('setInterval(() => { void intake.reconcile(line.api, line.phoneNumberId, intake.nextWindowMs(QUO_LEARN_WINDOW_MS)); }, QUO_LEARN_EVERY_MS).unref();');
  });

  it('a capped week read keeps the week window, and the next week pass reads on past the cap', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const list = calls(120, (i) => (60 + i * 60) * MIN); // 1 hour to ~5 days old
    const api = fakeQuo(list);
    const q = intake(() => NOW);
    await q.reconcile(api, 'PN1', WEEK);
    expect(q.status().quoRecord).toMatchObject({ weekThreadsNotRead: 20, weekReadOkAt: null });
    expect(q.nextWindowMs(DAY)).toBe(WEEK);
    await q.reconcile(api, 'PN1', q.nextWindowMs(DAY));
    expect(q.list()).toHaveLength(120);
    expect(q.status().quoRecord).toMatchObject({ weekThreadsNotRead: 0, weekReadOkAt: new Date(NOW).toISOString() });
  });

  it('a call left unreadable takes the week window back, so it is read again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const list = calls(3, (i) => (2 + i) * DAY);
    let broken = true;
    const api = fakeQuo(list, { transcript: async (id) => { if (broken && id === 'AC2') throw new QuoHttpError('Quo GET /call-transcripts -> 503', 503, null); return TR; } });
    const q = intake(() => NOW);
    await q.reconcile(api, 'PN1', WEEK);
    expect(q.status().quoRecord).toMatchObject({ weekReadOkAt: null, unreadable: expect.stringMatching(/1 call\(s\) could not be read/) });
    expect(q.nextWindowMs(DAY)).toBe(WEEK);
    broken = false;
    await q.reconcile(api, 'PN1', q.nextWindowMs(DAY));
    expect(q.list()).toHaveLength(3);
    expect(q.status().quoRecord).toMatchObject({ unreadable: null, weekReadOkAt: new Date(NOW).toISOString() });
  });

  it('after Quo was unreadable for three days, the next pass reads back past the outage — never just the last day', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let now = NOW;
    const q = intake(() => now);
    await q.reconcile(fakeQuo([]), 'PN1', WEEK); // whole week, read at NOW
    expect(q.nextWindowMs(DAY)).toBe(DAY);
    now = NOW + 3 * DAY; // every pass since failed
    await q.reconcile(fakeQuo([], { failFirst: 1 }), 'PN1', q.nextWindowMs(DAY));
    expect(q.nextWindowMs(DAY)).toBe(4 * DAY); // the outage plus a day
    now = NOW + 10 * DAY;
    expect(q.nextWindowMs(DAY)).toBe(WEEK); // never more than the week the screens speak for
  });
});
