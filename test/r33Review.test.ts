/*
  SLOW::ARBO — tests a write switch. The note at the top of
  test/dataLinks.test.ts applies here in full.
*/
// R33 review (2026-10-20) — what the screens, Talk and the routes SAY while
// Google and Quo are read-only. Mike, verbatim: "Connect Google as a read
// only and connect quo as read only". §1B: off on purpose is its own state —
// never "sent 0", never a red failure, never a promise the card can't keep,
// and never "no texts" when Arbo simply isn't being told about them.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { GOOGLE_HOLDS_OFF_LINE, QUO_READ_ONLY_LINE, QUO_HOOK_MISSING_LINE } from '../src/integrations/readOnly.js';
import { GOOGLE_PERMISSIONS, GOOGLE_SCOPES } from '../src/integrations/googleTokenStore.js';
import * as tokenStore from '../src/integrations/googleTokenStore.js';
import * as quoMod from '../src/integrations/quo.js';
import { registrationFrom, type EnsureResult, type QuoApi } from '../src/integrations/quo.js';
import { QuoIntake } from '../src/ops/quoIntake.js';
import { CallMemory, CallRecordStore } from '../src/reception/callMemory.js';
import { loadAllConfig } from '../src/config/loadConfig.js';
import type { SonaCallFacts } from '../src/ops/quoExtract.js';
import { loadAppHtml } from '../src/server/appPage.js';
import { createTalkTools, talkReadsFrom, talkGuard, TALK_SYSTEM } from '../src/voice/ownerTalk.js';
import { createApi } from '../src/server/api.js';
import { createSimSource } from '../src/dev/simSource.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const NOW = Date.parse('2026-10-20T15:00:00Z');
const KEY = Buffer.from('arbo-test-signing-key-32-bytes!!').toString('base64');
const LINE = '+17576069432';
const CALLER = '+17575550142';
const { guardrails } = loadAllConfig();

// The new lines, as Mike reads them.
const TEXTS_HOOK_LINE = 'New Quo texts won’t show under Texts — read them in the Quo app.';
const TEXTS_PANEL_LINE = 'Quo line: texts webhook missing — Arbo is read-only and won’t create it. New Quo texts don’t show here; this is not zero texts.';
const HOLDS_OFF_NO_TIME = 'Calendar holds are off — Google is connected read-only (Mike, 2026-10-20). The caller gave no time — call them to set one.';

const FACTS: SonaCallFacts = {
  wantsEstimate: true, name: 'SIM-Dana', address: '4500 Simulated Ct', city: 'Virginia Beach', jobType: 'removal',
  treeDetails: 'big oak in the back yard', powerLines: 'no', emergency: false, requestedTime: 'Wednesday after 4',
  agentSlips: [], callerType: 'customer',
};

// ─── a stand-in DOM, just what these panels touch ──────────────────────────
class FakeEl {
  className = ''; children: FakeEl[] = []; dataset: Record<string, string> = {};
  disabled = false; href = ''; target = ''; rel = ''; placeholder = ''; rows = 0; value = ''; offsetHeight = 0;
  onclick: null | (() => unknown) = null; style: Record<string, string> = {};
  private text = '';
  constructor(readonly tag: string) {}
  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(' '); }
  set textContent(t: string) { this.text = t; this.children = []; }
  appendChild(n: FakeEl) { this.children.push(n); return n; }
  replaceChildren() { this.children = []; }
  addEventListener() {}
  setAttribute() {}
  all(): FakeEl[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}
const el = (tag: string, cls?: string, text?: string) => { const n = new FakeEl(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const chip = (t: string, tone: string) => { const n = el('span', 'badge ' + tone, t); n.dataset.tone = tone; return n; };
const plural = (n: number, one: string, many?: string) => n + ' ' + (n === 1 ? one : many || one + 's');
const flush = () => new Promise((r) => setTimeout(r, 0));

const html = loadAppHtml();
const src = (name: string): string => {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
};
const pageFn = <T,>(name: string, deps: Record<string, unknown>): T =>
  new Function(...Object.keys(deps), `${src(name)}\nreturn ${name};`)(...Object.values(deps)) as T;
const deps = {
  el, chip, plural, fmtTime: () => '', feedLine: () => el('div', 'feed-state unread', 'x'),
  renderCalls: () => {}, renderToday: () => {}, slipRuleLabel: (r: string) => r, openSonaCall: () => {},
  document: { createElement: (t: string) => el(t) },
  // M15 merge: the Sona panel words a registration through the page's own quoRegLine — the real one, lifted from the page.
  quoRegLine: (reg: unknown) => pageFn<(r: unknown) => string>('quoRegLine', { fmtTime: () => '' })(reg),
};

// ═══ 1–2: the outreach panel while Quo is read-only ═══════════════════════
describe('the outreach panel while Quo is read-only (review #1, #2)', () => {
  const ro = {
    wired: true, fromNumber: LINE, autoFollowUps: false, readOnly: true, template: { ok: true, text: 'Art-is-Tree. Reply STOP to opt out.', problems: [] as string[] },
    paused: null, deferredUntil: null, queued: 0, lastRunAt: 'x', candidates: { total: 2, eligible: 2, skipped: {} }, sent: 0,
  };
  const panelFor = (status: Record<string, unknown>) =>
    pageFn<(full: boolean) => Promise<FakeEl>>('outreachPanel', { ...deps, api: async () => ({ status, candidates: [], sends: [] }) })(true);

  it('#1 no "sent 0" / "queued 0" and no highlighted "ready to text" — who to text from Quo, and Arbo texts OFF', async () => {
    const panel = await panelFor(ro);
    const tiles = panel.all().filter((n) => n.className.split(' ').includes('tile'));
    expect(tiles.map((t) => t.textContent)).toEqual(['2 to text from the Quo app', 'OFF Arbo texts — Quo read-only']);
    expect(tiles.some((t) => t.className.includes('accent') || t.className.includes('warn'))).toBe(false);
    expect(panel.textContent).not.toMatch(/ready to text|\bsent\b|\bqueued\b/);
  });

  it('#1 the disabled button carries the read-only line — never "Send catch-up to N now"', async () => {
    const panel = await panelFor(ro);
    const buttons = panel.all().filter((n) => n.tag === 'button' && n.className === 'actbtn');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe(QUO_READ_ONLY_LINE);
    expect(buttons[0]!.disabled).toBe(true);
    expect(buttons[0]!.onclick).toBeNull();
    expect(panel.textContent).not.toContain('Send catch-up');
  });

  it('#2 a line not learned yet still says read-only first — and never "until Arbo registers with Quo"', async () => {
    const panel = await panelFor({ ...ro, wired: false, fromNumber: null });
    expect(panel.children[1]!.textContent).toBe(QUO_READ_ONLY_LINE);
    expect(panel.children[1]!.className).toBe('feed-state cut');
    expect(panel.textContent).not.toContain('registers with Quo');
  });

  it('#2 a template that fails the rules is muted, not a red NOTHING-is-sent failure; the read list still shows', async () => {
    const panel = await panelFor({ ...ro, template: { ok: false, text: 'x', problems: ['no STOP line'] } });
    expect(panel.children[1]!.textContent).toBe(QUO_READ_ONLY_LINE);
    expect(panel.all().some((n) => n.className === 'storm' && /NOTHING is sent/.test(n.textContent))).toBe(false);
    const tpl = panel.children.find((n) => n.textContent.includes('no STOP line'))!;
    expect(tpl.className).toBe('storm-muted');
    expect(panel.textContent).toContain('2 to text from the Quo app');
  });

  it('with sends on (Mike’s word) the panel is as before: the red template failure, the tiles, the button', async () => {
    const bad = await panelFor({ ...ro, readOnly: false, template: { ok: false, text: 'x', problems: ['no STOP line'] } });
    expect(bad.all().some((n) => n.className === 'storm' && /NOTHING is sent/.test(n.textContent))).toBe(true);
    const ok = await panelFor({ ...ro, readOnly: false });
    expect(ok.textContent).toContain('2 ready to text');
    expect(ok.textContent).toContain('Send catch-up to 2 now');
    expect(ok.textContent).not.toContain(QUO_READ_ONLY_LINE);
  });
});

// ═══ 3: a missing texts webhook is named on the Texts panel ═══════════════
describe('a missing Quo texts webhook is named where the texts would show (review #3)', () => {
  const hooks = (missing: Array<'messages' | 'calls' | 'call-summaries' | 'call-transcripts'>): EnsureResult => ({
    keys: [], created: [], reused: [], failed: [], readOnly: true, missing: missing.map((family) => ({ family, why: QUO_HOOK_MISSING_LINE })),
  });

  it('the registration line says new Quo texts won’t show under Texts — only when the texts hook is the missing one', () => {
    expect(registrationFrom(hooks(['messages', 'calls'])).detail).toContain(TEXTS_HOOK_LINE);
    expect(registrationFrom(hooks(['calls'])).detail).not.toContain(TEXTS_HOOK_LINE);
    expect(registrationFrom(hooks(['messages'])).detail).toContain(QUO_HOOK_MISSING_LINE); // Mike's line is kept
    const fn = (quoMod as Record<string, unknown>).textsHookMissing as ((h: EnsureResult) => boolean) | undefined;
    expect(typeof fn).toBe('function');
    expect(fn!(hooks(['messages']))).toBe(true);
    expect(fn!(hooks(['calls']))).toBe(false);
    expect(fn!({ ...hooks(['messages']), readOnly: false })).toBe(false);
  });

  it('the intake holds it for the Texts route; the server sets it at boot and the route returns it', () => {
    const intake = new QuoIntake({ guardrails, extractor: null, callMemory: new CallMemory(), callRecords: new CallRecordStore(), calendarHold: null, onText: () => {} });
    const i = intake as unknown as { textsHookMissing?: () => boolean; setTextsHookMissing?: (b: boolean) => void };
    expect(typeof i.textsHookMissing).toBe('function');
    expect(i.textsHookMissing!()).toBe(false);
    i.setTextsHookMissing!(true);
    expect(i.textsHookMissing!()).toBe(true);
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(server).toContain('intake.setTextsHookMissing(textsHookMissing(hooks));');
    expect(server).toContain('quoTextsHookMissing: quoIntake.textsHookMissing(),');
  });

  it('the Texts panel says it in the cut tone — never an empty list that reads as no texts', async () => {
    const mount = async (texts: Record<string, unknown>) => {
      const v = el('div');
      const routes: Record<string, unknown> = {
        '/api/webhooks/texts': texts, '/api/relay/call-notes': { notes: [] },
        '/api/webhooks/calls': { linkCut: true, wired: false, transcripts: [] }, '/api/review/backlog?all=1&limit=20': { conversations: [] },
      };
      const renderCalls = pageFn<() => Promise<void>>('renderCalls', {
        ...deps, $: () => v, fmtWhen: () => '', api: async (p: string) => routes[p],
        studyPanel: async () => null, outreachPanel: async () => null, sonaPanel: async () => null, fillQuoSlots: () => Promise.resolve(),
        showKeywall: () => {}, LINKS_READY: Promise.resolve('sim'), state: (t: string, m: string) => el('div', 'state', t + ' ' + m), showSaveFail: () => {},
      });
      await renderCalls();
      await flush();
      return v.children.find((n) => n.className === 'slot texts')!;
    };
    const missing = await mount({ linkCut: true, wired: false, texts: [], quoTextsHookMissing: true });
    const line = missing.all().find((n) => n.textContent === TEXTS_PANEL_LINE)!;
    expect(line).toBeDefined();
    expect(line.className).toBe('feed-state cut');
    const inPlace = await mount({ linkCut: true, wired: false, texts: [], quoTextsHookMissing: false });
    expect(inPlace.textContent).not.toContain('texts webhook missing');
  });
});

// ═══ 4–5: Settings → Google says what was granted ═════════════════════════
describe('Settings → Google says what Google actually granted (review #4, #5)', () => {
  it('#4 a scope Google did not grant is named — an unknown grant (no scope returned) is not', () => {
    const fn = (tokenStore as Record<string, unknown>).missingScopes as ((g: string[]) => string[]) | undefined;
    expect(typeof fn).toBe('function');
    expect(fn!(GOOGLE_SCOPES)).toEqual([]);
    expect(fn!([GOOGLE_SCOPES[0]!, GOOGLE_SCOPES[2]!])).toEqual([GOOGLE_SCOPES[1]]);
    expect(fn!([])).toEqual([]);
  });

  it('#4 the connect route returns missingScopes (and the log carries a count only); /api/calls/records names Quo’s record (#10)', async () => {
    vi.resetModules();
    vi.stubEnv('APP_ACCESS_KEY', 'SIM-app-key');
    vi.stubEnv('ARBO_DATA_LINKS', 'sim');
    vi.stubEnv('GMAIL_OAUTH_CLIENT_ID', 'SIM-client');
    vi.stubEnv('GMAIL_OAUTH_CLIENT_SECRET', 'SIM-secret');
    vi.stubEnv('ARBO_SECRET_DIR', mkdtempSync(join(tmpdir(), 'arbo-r33r-')));
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
      if (String(u) === 'https://oauth2.googleapis.com/token') {
        // Mike unticked the calendar box on Google's screen.
        return new Response(JSON.stringify({ refresh_token: 'SIM-refresh', scope: `${GOOGLE_SCOPES[0]} ${GOOGLE_SCOPES[2]}` }), { status: 200 });
      }
      return realFetch(u, init);
    });
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
    const { createArborRequestHandler } = await import('../src/server.js');
    const srv = createServer(createArborRequestHandler());
    await new Promise<void>((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    try {
      const res = await realFetch(`${base}/api/google/connect`, {
        method: 'POST', headers: { 'x-arbor-key': 'SIM-app-key', 'content-type': 'application/json' },
        body: JSON.stringify({ pasted: 'http://localhost/?code=4/0SIM-code&scope=x' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { missingScopes?: string[] };
      expect(body.missingScopes).toEqual([GOOGLE_SCOPES[1]]);
      const line = logs.find((l) => l.startsWith('[google] reconnected'))!;
      expect(line).toContain('1 asked-for not granted');
      expect(line).not.toContain('googleapis.com');
      const rec = (await (await realFetch(`${base}/api/calls/records`, { headers: { 'x-arbor-key': 'SIM-app-key' } })).json()) as { note: string };
      expect(rec.note).toBe('In-memory since deploy — calendar holds are off (R33), so Quo’s own record is the lasting copy.');
      expect(rec.note).not.toContain('calendar hold is the durable copy');
    } finally {
      srv.close();
    }
  });

  const build = async (gs: Record<string, unknown>, post?: Record<string, unknown>) => {
    const v = el('div');
    const routes: Record<string, unknown> = {
      '/api/settings/channels': { channels: [] }, '/api/inbox/intents': { pipeline: 'live' },
      '/api/settings/route': { workZip: null, location: { enabled: false, zip: null, ageMinutes: null } },
      '/api/reception/status': { linkCut: false }, '/api/google/connect': gs, '/api/links': { master: 'cut', links: [] },
      '/api/webhooks': { sources: {}, cut: [] }, '/api/quo': { status: { registration: { state: 'ok' }, received: 0 } },
    };
    const api = async (p: string, o?: { method?: string }) => {
      if (o?.method === 'POST') return post;
      if (!(p in routes)) throw Object.assign(new Error('error'), { code: 500 });
      return routes[p];
    };
    const buildSettings = pageFn<(v: FakeEl, gen: number) => Promise<void>>('buildSettings', {
      ...deps, settingsGen: 1, api, state: (t: string, m: string) => el('div', 'state', t + ' ' + m),
      feedKind: () => 'unread', FEED_WORD: {}, LINKS_READY: Promise.resolve('cut'), showKeywall: () => {},
      showSaveFail: () => {}, saveFailText: () => '', renderSettings: () => {}, themePref: () => 'auto', setTheme: () => {},
      bouncieSettings: async () => {},
    });
    await buildSettings(v, 1);
    return v;
  };
  const gsBase = { consentUrl: 'https://example.invalid/consent', readOnly: true, permissions: GOOGLE_PERMISSIONS, fallbackVariable: false };

  it('#4 after Connect, a permission Google did not grant is named — never "Gmail, the calendar and Drive are read again"', async () => {
    const v = await build({ ...gsBase, token: { stored: true, where: 'disk', savedAt: null } }, { ok: true, where: 'disk', scopes: [], extraScopes: [], missingScopes: [GOOGLE_SCOPES[1]] });
    // The Connect button, and the line Arbo answers in right under it.
    const connectAndRead = async (card: FakeEl) => {
      const connect = card.children.find((n) => n.tag === 'button' && n.textContent === 'Connect')!;
      await connect.onclick!();
      return card.children[card.children.indexOf(connect) + 1]!.textContent;
    };
    expect(await connectAndRead(v)).toBe('Connected, but Google didn’t grant: Read the calendar — tap Open Google and approve all three.');
    const full = await build({ ...gsBase, token: { stored: true, where: 'disk', savedAt: null } }, { ok: true, where: 'disk', scopes: GOOGLE_SCOPES, extraScopes: [], missingScopes: [] });
    expect(await connectAndRead(full)).toBe('Connected read-only. Gmail, the calendar and Drive are read again — saved on the storage disk.');
  });

  it('#5 before anything is connected: no green chip and no ✓ — what Arbo ASKS for, in a neutral tone', async () => {
    const v = await build({ ...gsBase, token: { stored: false, where: null } });
    const ro = v.all().find((n) => n.tag === 'span' && n.textContent === 'READ-ONLY')!;
    expect(ro.dataset.tone).toBe('info');
    expect(v.textContent).not.toContain('✓');
    for (const p of GOOGLE_PERMISSIONS) expect(v.textContent).toContain(`Arbo asks for: ${p.what} — Google calls it “${p.googleSays}”`);
    const stored = await build({ ...gsBase, token: { stored: true, where: 'disk', savedAt: null } });
    expect(stored.all().find((n) => n.tag === 'span' && n.textContent === 'READ-ONLY')!.dataset.tone).toBe('good');
    expect(stored.textContent).toContain('✓ Read Gmail');
  });

  it('#5 the card never claims Arbo-the-assistant writes nothing — only Arbo’s own Google sign-in', async () => {
    const v = await build({ ...gsBase, token: { stored: true, where: 'disk', savedAt: null } });
    expect(v.textContent).toContain('Arbo’s own Google sign-in writes nothing');
    expect(v.textContent).not.toContain('Arbo reads Google and writes nothing');
  });

  it('#5 GO_LIVE §8 makes the "Connected read-only…" message the sign it worked — not the chip', () => {
    const golive = readFileSync(new URL('../docs/GO_LIVE.md', import.meta.url), 'utf8');
    const s8 = golive.slice(golive.indexOf('## 8. Reconnect Google read-only')).replace(/\s+/g, ' ');
    expect(s8).toContain('That message is the sign it worked.');
    expect(s8).not.toContain('The card shows a green **READ-ONLY** chip and the three permissions.');
  });
});

// ═══ 6, 8, 9: Sona call cards and the holds-off lines ═════════════════════
describe('holds-off lines never promise what the card can’t show (review #6, #8, #9)', () => {
  const status = {
    registration: { state: 'ok', detail: '' }, reading: true, callsWithSlips: 0, sonaCalls: 2, learnedFromRecord: 0,
    // H1 merge: the intake's real shape — holdsAttempted split into filed / failed / waiting.
    holdsFiled: 0, holdsFailed: 0, holdsWaiting: 0, readsRetrying: 0, readRetryMax: 5, holds: 'read_only',
    hangups: 0, quoRecord: { lastAt: 'x' }, notUsed: {},
  };
  const card = (callId: string, requestedTime: string | null) => ({
    callId, at: 'x', from: CALLER, handledBy: 'sona', slips: [], summary: [], dialogue: [], facts: { name: callId, requestedTime }, hold: 'read_only',
  });

  it('#6 a caller who gave no time gets "call them to set one", not "Sona’s requested time is shown"', async () => {
    const panel = await pageFn<(n: number, t: boolean) => Promise<FakeEl>>('sonaPanel', { ...deps, api: async () => ({ status, calls: [card('SIM-A', 'Wednesday after 4'), card('SIM-B', null)] }) })(20, true);
    const cards = panel.all().filter((n) => n.dataset.sonaCall);
    expect(cards[0]!.textContent).toContain(GOOGLE_HOLDS_OFF_LINE);
    expect(cards[0]!.textContent).toContain('Asked for: Wednesday after 4');
    expect(cards[1]!.textContent).toContain(HOLDS_OFF_NO_TIME);
    expect(cards[1]!.textContent).not.toContain(GOOGLE_HOLDS_OFF_LINE);
  });

  it('#6 Talk says how many gave a time and how many to call — never "book the time the caller asked for" for all', async () => {
    const api = createApi(createSimSource(), { dataLinksSim: true, alerts: { activeAlerts: async () => [] } });
    const stormLaw = async () => ({ state: 'none' as const, declarations: [], flag: null, governorNote: '', checkedAt: new Date().toISOString(), reason: null });
    const calls = [card('SIM-A', 'Wednesday after 4'), card('SIM-B', null)];
    const text = (await createTalkTools(talkReadsFrom({ api, quo: () => ({ status, calls }) as never, stormLaw, mode: () => 'sim' })).run('arbo_sona_calls')).text;
    expect(text).toContain('Calendar holds: off — Google is connected read-only, so you book estimates yourself');
    expect(text).toContain('1 caller gave a time, on the call card; 1 gave none — call them to set one');
    expect(text).not.toContain('book the time the caller asked for');
    expect(talkGuard(text, guardrails)).toEqual([]);
  });

  it('#6 PHONE_SETUP says the card shows the time only when the caller gave one', () => {
    const phone = readFileSync(new URL('../docs/PHONE_SETUP.md', import.meta.url), 'utf8');
    expect(phone).toContain('shows it, when the caller gave one');
    expect(phone).not.toContain('and shows the time the caller asked for');
  });

  it('#8 a call learned from Quo’s record after a deploy says holds are off — and its record says read_only, not no_writer', async () => {
    const records = new CallRecordStore();
    const intake = new QuoIntake({
      guardrails, extractor: { extract: async () => FACTS }, callMemory: new CallMemory(), callRecords: records,
      calendarHold: async () => { throw new Error('never called'); }, onText: () => {}, now: () => NOW, sleep: async () => {},
    });
    intake.setRegistration('ok', 'test', [KEY], [LINE]);
    const api = {
      listConversations: async () => [{ id: 'CN1', phoneNumberId: 'PN1', participants: [CALLER], lastActivityAt: null, updatedAt: null }],
      listCalls: async () => [{ id: 'AC-OLD', direction: 'incoming', status: 'completed', aiHandled: 'ai-agent', createdAt: new Date(NOW - 3 * 86_400_000).toISOString(), answeredAt: null, completedAt: null }],
      getCallTranscript: async () => ({ status: 'completed', dialogue: [
        { identifier: LINE, content: 'Hi, Art-is-Tree.', userId: null },
        { identifier: CALLER, content: 'I need an oak looked at in my back yard for an estimate.', userId: null },
      ] }),
    } as unknown as QuoApi;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await intake.reconcile(api, 'PN1', 7 * 86_400_000);
    const [c] = intake.list();
    expect(c).toMatchObject({ callId: 'AC-OLD', handledBy: 'sona', source: 'quo_record', hold: 'read_only' });
    expect(records.list()[0]!.calendarHold).toBe('read_only');
  });

  it('#9 no model key while holds are off: the warning blames nothing on the key it doesn’t cause', async () => {
    const off = await pageFn<(n: number, t: boolean) => Promise<FakeEl>>('sonaPanel', { ...deps, api: async () => ({ status: { ...status, reading: false }, calls: [] }) })(20, true);
    expect(off.textContent).toContain('Arbo cannot read Sona calls right now (no model key) — calls are kept but not checked, so a rule slip can be missed.');
    expect(off.textContent).not.toContain('no calendar holds are filed');
    const on = await pageFn<(n: number, t: boolean) => Promise<FakeEl>>('sonaPanel', { ...deps, api: async () => ({ status: { ...status, reading: false, holds: 'on' }, calls: [] }) })(20, true);
    expect(on.textContent).toContain('calls are kept, but no calendar holds are filed');
  });
});

// ═══ 7: Talk never sends Mike to a text button that isn't there ═══════════
describe('Talk says to text from the Quo app (review #7)', () => {
  it('the instructions carve texts out of "a tap in the app"', () => {
    expect(TALK_SYSTEM).toContain('If Mike asks for one of those, say it is a tap in the app — except a text: Quo is read-only in Arbo, so say to send it from the Quo app.');
  });

  it('the guard lets that answer through', () => {
    expect(talkGuard("I can't send a text — Quo is read-only in Arbo, so send it from the Quo app.", guardrails)).toEqual([]);
  });
});

