// R24 (Mike, 2026-09-27: "Yes it can read only everything"). Pins: the study
// and the Drive reader can only READ; every source is read and named when it
// cannot be; unchanged threads cost no model call; logs carry no number or
// word (§4.3). All data here is simulated (SIM- names, 555 numbers).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { QuoStudy, type StudyFacts } from '../src/ops/quoStudy.js';
import { createDriveFolderReader, parseCsv, DriveReadError, type DriveFolderReader } from '../src/integrations/driveRead.js';
import { QuoHttpError, type QuoApi, type QuoCall, type QuoMessage, type QuoTranscript } from '../src/integrations/quo.js';
import { createArborRequestHandler } from '../src/server.js';

const NOW = Date.parse('2026-09-27T15:00:00Z');
const MIN = 60_000;
const LINE = '+17576069432';
const A = '+17575550142';
const B = '+17575550188';

interface World {
  convs: Array<{ id: string; p: string }>;
  calls: Record<string, QuoCall[]>;
  msgs: Record<string, QuoMessage[]>;
  tr: Record<string, QuoTranscript | null>;
  listFails?: boolean;
}
const call = (id: string, at: number, over: Partial<QuoCall> = {}): QuoCall => ({ id, direction: 'incoming', status: 'completed', aiHandled: 'ai-agent', createdAt: new Date(at).toISOString(), answeredAt: null, completedAt: null, ...over });
const msg = (id: string, at: number, direction: 'incoming' | 'outgoing', text: string): QuoMessage => ({ id, direction, text, status: 'delivered', createdAt: new Date(at).toISOString() });

function quoOf(w: World): QuoApi {
  return {
    listPhoneNumbers: async () => [LINE],
    phoneNumbers: async () => [{ id: 'PN1', number: LINE }],
    listConversations: async () => { if (w.listFails) throw new QuoHttpError('Quo GET /conversations -> 500', 500, null); return w.convs.map((c) => ({ id: c.id, phoneNumberId: 'PN1', participants: [c.p], lastActivityAt: null, updatedAt: null })); },
    listCalls: async ({ participant }) => w.calls[participant] ?? [],
    listMessages: async ({ participant }) => w.msgs[participant] ?? [],
    getCallTranscript: async (id) => w.tr[id] ?? null,
    listWebhooks: async () => [],
    getWebhook: async () => null,
    createWebhook: async () => { throw new Error('the study must never write'); },
    deleteWebhook: async () => { throw new Error('the study must never write'); },
  };
}

const FACTS: StudyFacts = { customerName: 'SIM-Dana', wants: 'remove 2 pines', stage: 'waiting_on_us', nextStep: 'confirm Saturday', toldThem: ['offered Sat 12:00'], sourcesDisagree: null };

function world(): World {
  return {
    convs: [{ id: 'CN-A', p: A }],
    calls: { [A]: [call('AC1', NOW - 60 * MIN)] },
    msgs: { [A]: [msg('M1', NOW - 50 * MIN, 'outgoing', 'SIM- Can we come Sat at 12?'), msg('M2', NOW - 40 * MIN, 'incoming', 'SIM- Saturday works, see you then')] },
    tr: { AC1: { status: 'completed', dialogue: [{ identifier: LINE, content: 'Art-is-Tree, how can I help?', userId: null }, { identifier: A, content: 'SIM- I need two pines taken down.', userId: null }] } },
  };
}

function harness(w: World, opts: { drive?: DriveFolderReader | null; reader?: boolean } = {}) {
  const read = vi.fn(async (_thread: string) => FACTS);
  const study = new QuoStudy({ quo: quoOf(w), reader: opts.reader === false ? null : { read }, drive: opts.drive === undefined ? null : opts.drive, now: () => NOW, sleep: async () => {} });
  return { study, read };
}

const driveWith = (files: Array<{ name: string; kind: 'sheet' | 'doc'; text: string }>): DriveFolderReader => ({
  recent: async () => files.map((f, i) => ({ id: `F${i}`, name: f.name, modifiedTime: null, kind: f.kind, text: f.text })),
});

describe('read-only, by construction', () => {
  it('the Drive reader only ever GETs, and the study calls no Quo write and holds no sender', () => {
    const drive = readFileSync(new URL('../src/integrations/driveRead.ts', import.meta.url), 'utf8');
    expect(drive).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
    expect(drive).toContain("method: 'GET'");
    const study = readFileSync(new URL('../src/ops/quoStudy.ts', import.meta.url), 'utf8');
    expect(study).not.toMatch(/createWebhook|deleteWebhook|quoSend|sender|calendarHold|\.send\(/);
  });

  it('reads the newest sheets as CSV and docs as text; a 403 is named as "no Drive read in the sign-in"', async () => {
    const urls: string[] = [];
    const reader = createDriveFolderReader(async () => 'tok', 'FOLDER', async (url, init) => {
      urls.push(url);
      expect(init.method).toBe('GET');
      if (url.includes('/files?')) return { ok: true, status: 200, json: async () => ({ files: [{ id: 'S1', name: 'Lead Log 2026-09-27', mimeType: 'application/vnd.google-apps.spreadsheet' }, { id: 'D1', name: 'Ops State 2026-09-26', mimeType: 'application/vnd.google-apps.document' }, { id: 'P1', name: 'x.pdf', mimeType: 'application/pdf' }] }), text: async () => '' };
      return { ok: true, status: 200, json: async () => ({}), text: async () => (url.includes('S1') ? 'Name,Phone\nSIM-Dana,757-555-0142' : 'SIM ops line') };
    });
    const files = await reader.recent(6);
    expect(files.map((f) => [f.name, f.kind])).toEqual([['Lead Log 2026-09-27', 'sheet'], ['Ops State 2026-09-26', 'doc']]);
    expect(urls.some((u) => u.includes('S1/export?mimeType=text%2Fcsv'))).toBe(true);
    expect(urls.some((u) => u.includes('D1/export?mimeType=text%2Fplain'))).toBe(true);
    const denied = createDriveFolderReader(async () => 'tok', 'FOLDER', async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => 'body with SIM-Dana' }));
    const err = await denied.recent(6).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DriveReadError);
    expect((err as DriveReadError).status).toBe(403);
    expect((err as Error).message).not.toContain('SIM');
  });

  it('parses the export’s CSV, quotes and all', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
  });
});

describe('the study', () => {
  it('reads Sona’s call, our texts, their texts and the assistant’s matching log lines into one note', async () => {
    const drive = driveWith([
      { name: 'Lead Log 2026-09-27', kind: 'sheet', text: 'Name,Phone,Status\nSIM-Dana,(757) 555-0142,offered Sat 12:00\nSIM-Other,757-555-0999,new' },
      { name: 'Ops State 2026-09-26', kind: 'doc', text: 'SIM-Dana 7575550142 wants Saturday\nunrelated line' },
    ]);
    const h = harness(world(), { drive });
    expect(await h.study.run('PN1', 7 * 24 * 60 * MIN)).toEqual({ read: 1, unchanged: 0, failed: 0 });
    const thread = h.read.mock.calls[0]![0];
    expect(thread).toContain('CALL in (Sona answered)');
    expect(thread).toContain('Customer: SIM- I need two pines taken down.');
    expect(thread).toContain('Sona: Art-is-Tree, how can I help?');
    expect(thread).toContain('TEXT from us: SIM- Can we come Sat at 12?');
    expect(thread).toContain('TEXT from customer: SIM- Saturday works');
    expect(thread).toContain("ASSISTANT'S LEAD LOG (Lead Log 2026-09-27): Name: SIM-Dana | Phone: (757) 555-0142 | Status: offered Sat 12:00");
    expect(thread).toContain("ASSISTANT'S OPS NOTE (Ops State 2026-09-26): SIM-Dana 7575550142 wants Saturday");
    expect(thread).not.toContain('SIM-Other');
    expect(thread).not.toContain('unrelated line');
    const [n] = h.study.notes();
    expect(n).toMatchObject({ customerName: 'SIM-Dana', stage: 'waiting_on_us', lastTouch: 'customer', sources: { calls: 1, texts: 2, logLines: 2 }, noWords: false });
  });

  it('an unchanged thread costs no model call; a new text re-reads it', async () => {
    const w = world();
    const h = harness(w);
    await h.study.run('PN1', 7 * 24 * 60 * MIN);
    expect(await h.study.run('PN1', 7 * 24 * 60 * MIN)).toEqual({ read: 0, unchanged: 1, failed: 0 });
    w.msgs[A]!.push(msg('M3', NOW - 5 * MIN, 'outgoing', 'SIM- See you Saturday'));
    expect(await h.study.run('PN1', 7 * 24 * 60 * MIN)).toEqual({ read: 1, unchanged: 0, failed: 0 });
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.study.notes()[0]!.lastTouch).toBe('us');
  });

  it('hang-ups only: a note that SAYS no words, and no model call; our own numbers are never studied', async () => {
    const w = world();
    w.convs.push({ id: 'CN-B', p: B }, { id: 'CN-OWN', p: '+17573195131' });
    w.calls[B] = [call('AC2', NOW - 10 * MIN)];
    w.tr.AC2 = null;
    const h = harness(w);
    await h.study.run('PN1', 7 * 24 * 60 * MIN, [LINE, '+17573195131']);
    const notes = h.study.notes();
    expect(notes.map((n) => n.number).sort()).toEqual([A, B]);
    expect(notes.find((n) => n.number === B)).toMatchObject({ noWords: true, stage: 'unclear' });
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it('every dead source is NAMED, never a quiet zero — and no number or word reaches the log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const denied: DriveFolderReader = { recent: async () => { throw new DriveReadError('Drive GET -> 403', 403); } };
    const h = harness(world(), { drive: denied });
    await h.study.run('PN1', 7 * 24 * 60 * MIN);
    expect(h.study.status().driveError).toMatch(/does not include Drive read/);
    expect(harness(world()).study.status().driveError).toBeNull(); // never run yet
    const noDrive = harness(world(), { drive: null });
    await noDrive.study.run('PN1', MIN);
    expect(noDrive.study.status().driveError).toMatch(/not connected/);
    const w = world();
    w.listFails = true;
    const dead = harness(w);
    await expect(dead.study.run('PN1', MIN)).resolves.toEqual({ read: 0, unchanged: 0, failed: 0 });
    expect(dead.study.status().quoError).toMatch(/500/);
    const noModel = harness(world(), { reader: false });
    expect(await noModel.study.run('PN1', 7 * 24 * 60 * MIN)).toEqual({ read: 0, unchanged: 0, failed: 1 });
    expect(noModel.study.status().reading).toBe(false);
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('5550142');
    expect(logged).not.toContain('SIM');
    spy.mockRestore();
  });
});

describe('HTTP + screens', () => {
  it('without Quo the notes door refuses by name; the app shows the panel above the brief on Today and on Calls', async () => {
    const srv = createServer(createArborRequestHandler());
    await new Promise<void>((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const res = await fetch(`${base}/api/quo/study`);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('quo_not_configured');
    srv.close();
    const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
    expect(html).toContain('Where each customer stands');
    expect(html).toContain('This is not zero customers.');
    expect(html.indexOf('studyPanel(5).then')).toBeLessThan(html.indexOf("api('/api/brief?from="));
    expect(html).toContain('studyPanel(60).then');
  });
});
