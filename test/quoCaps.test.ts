// M10 (audit 2026-10-20): the 7-day Quo reads stop at a cap — 60 customer
// threads for the R24 study, 100 calls for learning Sona's calls. Every pass
// since 2026-10-18 summed to exactly 60 and every boot "learned 100", yet the
// screens said "N customers in the last 7 days" as if that were the week.
// Now the most recent are read first, what the cap left unread is counted,
// and the app, the study status and Talk all say "first 60 of N".
// Simulated data only (SIM- names, 555-01xx numbers).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { QuoStudy, CONVERSATION_CAP, type StudyFacts } from '../src/ops/quoStudy.js';
import { QuoIntake } from '../src/ops/quoIntake.js';
import { CallMemory, CallRecordStore } from '../src/reception/callMemory.js';
import { createTalkTools } from '../src/voice/ownerTalk.js';
import { loadAllConfig } from '../src/config/loadConfig.js';
import type { QuoApi, QuoConversation, QuoTranscript } from '../src/integrations/quo.js';
import type { SonaCallFacts } from '../src/ops/quoExtract.js';

const NOW = Date.parse('2026-10-20T15:00:00Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const LINE = '+17576069432';
const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8').replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

/** n single-caller threads; thread i's last activity is i minutes ago, so a smaller i is more recent. */
function threads(n: number, ageOf: (i: number) => number = (i) => i * MIN): Array<{ conv: QuoConversation; number: string; at: number }> {
  return Array.from({ length: n }, (_, i) => {
    const number = `+1757555${String(1000 + i).padStart(4, '0')}`;
    const at = NOW - ageOf(i);
    return { number, at, conv: { id: `CN${i}`, phoneNumberId: 'PN1', participants: [number], lastActivityAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString() } };
  });
}

function fakeQuo(list: Array<{ conv: QuoConversation; number: string; at: number }>, transcript: QuoTranscript | null = null): QuoApi {
  // Quo's own order is not recency — shuffle it so the code has to sort.
  const shuffled = [...list].sort((a, b) => (a.conv.id.length - b.conv.id.length) || a.conv.id.localeCompare(b.conv.id)).reverse();
  return {
    listPhoneNumbers: async () => [LINE],
    phoneNumbers: async () => [{ id: 'PN1', number: LINE }],
    listConversations: async () => shuffled.map((t) => t.conv),
    listCalls: async ({ participant }) => {
      const t = list.find((x) => x.number === participant)!;
      return [{ id: `AC-${t.conv.id}`, direction: 'incoming', status: 'completed', aiHandled: 'ai-agent', createdAt: new Date(t.at).toISOString(), answeredAt: null, completedAt: null }];
    },
    listMessages: async () => [],
    getCallTranscript: async () => transcript,
    listWebhooks: async () => [], getWebhook: async () => null,
    createWebhook: async () => { throw new Error('read only'); }, deleteWebhook: async () => { throw new Error('read only'); },
  };
}

const STUDY: StudyFacts = { customerName: 'SIM-Caller', wants: 'remove a pine', stage: 'waiting_on_us', nextStep: 'call back', toldThem: [], sourcesDisagree: null };

afterEach(() => vi.restoreAllMocks());

describe('M10 — the R24 study names its cap: "the 60 most recent of N"', () => {
  it('70 threads: the 60 most recent are studied, 10 are counted as not read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const list = threads(70);
    const read = vi.fn(async () => STUDY);
    const study = new QuoStudy({ quo: fakeQuo(list, { status: 'completed', dialogue: [{ identifier: LINE, content: 'Art-is-Tree.', userId: null }, { identifier: list[0]!.number, content: 'SIM- a pine', userId: null }] }), reader: { read }, drive: null, now: () => NOW, sleep: async () => {} });
    await study.run('PN1', 7 * DAY, [LINE]);
    const st = study.status();
    expect(CONVERSATION_CAP).toBe(60);
    expect(st).toMatchObject({ threadsInWindow: 70, threadsStudied: 60 });
    const studiedIds = new Set(study.notes().map((n) => n.conversationId));
    expect(studiedIds.size).toBe(60);
    // The ten OLDEST went unread — never the newest.
    for (let i = 0; i < 60; i += 1) expect(studiedIds.has(`CN${i}`), `CN${i}`).toBe(true);
    for (let i = 60; i < 70; i += 1) expect(studiedIds.has(`CN${i}`), `CN${i}`).toBe(false);
  });

  it('under the cap the counts match, so nothing is said', async () => {
    const study = new QuoStudy({ quo: fakeQuo(threads(5)), reader: { read: async () => STUDY }, drive: null, now: () => NOW, sleep: async () => {} });
    await study.run('PN1', 7 * DAY, [LINE]);
    expect(study.status()).toMatchObject({ threadsInWindow: 5, threadsStudied: 5 });
  });

  it('a note whose thread left the 7-day window is dropped, so the count is the window', async () => {
    let list = threads(3);
    let now = NOW;
    const quo = { ...fakeQuo(list), listConversations: async () => list.map((t) => t.conv) } as QuoApi;
    const study = new QuoStudy({ quo, reader: { read: async () => STUDY }, drive: null, now: () => now, sleep: async () => {} });
    await study.run('PN1', 7 * DAY, [LINE]);
    expect(study.notes()).toHaveLength(3);
    list = list.slice(0, 1); // two threads went quiet for a week
    now += DAY;
    await study.run('PN1', 7 * DAY, [LINE]);
    expect(study.notes().map((n) => n.conversationId)).toEqual(['CN0']);
  });

  it('the app says it on the study card — and never "N customers in the last 7 days" over a capped read', () => {
    const p = html.slice(html.indexOf('async function studyPanel('), html.indexOf('// ---------- The Quo fold'));
    expect(p).toContain("const capped = st.threadsInWindow != null && st.threadsStudied != null && st.threadsInWindow > st.threadsStudied;");
    // R27 Phase A (es-owner-a; pins moved, meaning kept): one sentence per count, the cap named in both.
    expect(p).toContain("tn(all - studied, 'Arbo studied the {studied} most recent customer threads of {all} in the last 7 days — {n} older thread was not read.");
    expect(p).toContain("capped ? tn(notes.length, '{n} customer (first {studied} customer threads of {all})', '{n} customers (first {studied} customer threads of {all})', { studied, all })");
    expect(p).toContain(": tn(notes.length, '{n} customer in the last 7 days', '{n} customers in the last 7 days')");
  });
});

describe('M10 — learning Sona’s calls names its cap too', () => {
  const FACTS: SonaCallFacts = { wantsEstimate: false, name: null, address: null, city: null, jobType: null, treeDetails: null, powerLines: null, emergency: false, requestedTime: null, agentSlips: [], callerType: 'customer' };

  function intake() {
    return new QuoIntake({
      guardrails: loadAllConfig().guardrails, extractor: { extract: async () => FACTS }, callMemory: new CallMemory(), callRecords: new CallRecordStore(),
      calendarHold: null, onText: () => {}, now: () => NOW, sleep: async () => {},
    });
  }

  it('120 calls in the week: the boot read learns the 100 most recent and counts 20 threads not read — and keeps saying so', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // One call per thread, from 1 hour to ~5 days old (all before boot: learned without holds).
    const list = threads(120, (i) => (60 + i * 60) * MIN);
    const tr: QuoTranscript = { status: 'completed', dialogue: [{ identifier: LINE, content: 'Art-is-Tree.', userId: null }, { identifier: '+17575550000', content: 'hello there friend', userId: null }] };
    const q = intake();
    const r = await q.reconcile(fakeQuo(list, tr), 'PN1', 7 * DAY);
    expect(r.learned).toBe(100);
    expect(q.status().quoRecord).toMatchObject({ threadsNotRead: 20, weekThreadsNotRead: 20, callCap: 100 });
    const learnedIds = new Set(q.list().map((c) => c.callId));
    expect(learnedIds.has('AC-CN0')).toBe(true); // the most recent
    expect(learnedIds.has('AC-CN119')).toBe(false); // the oldest went unread
    // The 10-minute passes look back a day only: the week's shortfall still stands.
    await q.reconcile(fakeQuo(list.slice(0, 5), tr), 'PN1', DAY);
    expect(q.status().quoRecord).toMatchObject({ threadsNotRead: 0, weekThreadsNotRead: 20 });
  });

  it('a week read under the cap counts nothing unread', async () => {
    const q = intake();
    await q.reconcile(fakeQuo(threads(3), null), 'PN1', 7 * DAY);
    expect(q.status().quoRecord).toMatchObject({ threadsNotRead: 0, weekThreadsNotRead: 0 });
  });

  it('the Sona card says the week was cut short, and never "No Sona calls in the last 7 days" over it', () => {
    const p = html.slice(html.indexOf('async function sonaPanel('), html.indexOf('// ---------- Text outreach via Quo'));
    expect(p).toContain("if (rec.weekThreadsNotRead > 0) {");
    expect(p).toContain("'Arbo read the first {cap} calls of the past week from Quo’s record — {n} older customer thread was not read"); // R27 Phase A (es-owner-a)
    // R33 merge: a webhook Arbo won't create ('read_only') still reads the week from Quo's record, so the same rule holds for it.
    expect(p).toContain("if ((st.registration.state === 'ok' || st.registration.state === 'read_only') && !rec.error && !(rec.weekThreadsNotRead > 0)) {");
  });

  it('Talk says it too, and does not claim an empty week', async () => {
    const st = {
      registration: { state: 'ok', detail: 'wired' }, reading: true, received: 0, rejected: 0, lastAt: null, lastError: null,
      sonaCalls: 0, slips: 0, callsWithSlips: 0, holdsFiled: 0, holdsFailed: 0, holdsWaiting: 0, readsRetrying: 0, readRetryMax: 5, hangups: 0, learnedFromRecord: 0, notUsed: {},
      quoRecord: { lastAt: new Date(NOW).toISOString(), learned: 100, pending: 0, error: null, unreadable: null, threadsNotRead: 0, weekThreadsNotRead: 20, callCap: 100 },
    };
    const reads = { quo: () => ({ status: st, calls: [] }), mode: () => 'live' } as unknown as Parameters<typeof createTalkTools>[0];
    const text = (await createTalkTools(reads).run('arbo_sona_calls')).text;
    expect(text).toContain("Arbo has not read all of this week's calls yet — 20 older customer threads not read");
    expect(text).not.toContain('No Sona calls in the last 7 days');
  });
});
