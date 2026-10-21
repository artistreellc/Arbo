// QA round 3 — Calls, the route planner, Leads' spam Undo, Settings and the
// Permit Desk's rule cards. vitest has no DOM, so each screen's logic is lifted
// out of the page and run against a small stand-in DOM; CSS and copy are
// source pins. The shared feed words (feedKind, FEED_WORD, RETRY, feedLine)
// are the page's own, so the lines asserted here are the lines Mike reads.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';
import { FACTS } from '../src/permitting/publicWorks/facts.js';

const html = loadAppHtml();
const css = html.slice(0, html.indexOf('</style>'));

/** One top-level function's source: from its declaration to the "}" alone on a line. */
function fnSrc(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
/** The same function, built with stand-ins for every outside name it reaches for. */
function pageFn<T>(name: string, deps: Record<string, unknown>, src = fnSrc(name)): T {
  return new Function(...Object.keys(deps), `${src}\nreturn ${name};`)(...Object.values(deps)) as T;
}
/** A one-line page declaration (`const X = …;` or `function f(…) { … }`), as source. */
function oneLine(start: string): string {
  const at = html.indexOf('\n' + start);
  expect(at, start).toBeGreaterThan(-1);
  return html.slice(at + 1, html.indexOf('\n', at + 1));
}

// ---------- a stand-in DOM: just what these screens touch ----------
class Node {
  className = '';
  textContent = '';
  disabled = false;
  hidden = false;
  title = '';
  href = '';
  value = '';
  type = '';
  offsetHeight = 0;
  onclick: (() => Promise<void>) | null = null;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: Node[] = [];
  parent: Node | null = null;
  private handlers: Array<() => unknown> = [];
  constructor(readonly tag: string) {}
  private names(): string[] { return this.className.split(/\s+/).filter(Boolean); }
  get classList() {
    return {
      add: (c: string) => { if (!this.names().includes(c)) this.className = [...this.names(), c].join(' '); },
      remove: (c: string) => { this.className = this.names().filter((x) => x !== c).join(' '); },
      contains: (c: string) => this.names().includes(c),
      toggle: () => {},
    };
  }
  has(c: string): boolean { return this.names().includes(c); }
  appendChild(c: Node): Node { c.parent?.drop(c); c.parent = this; this.children.push(c); return c; }
  drop(c: Node): void { this.children = this.children.filter((x) => x !== c); c.parent = null; }
  remove(): void { this.parent?.drop(this); }
  replaceWith(n: Node): void {
    const p = this.parent!;
    n.parent?.drop(n);
    p.children[p.children.indexOf(this)] = n;
    n.parent = p;
    this.parent = null;
  }
  replaceChildren(...ns: Node[]): void {
    for (const c of this.children) c.parent = null;
    this.children = [];
    for (const n of ns) this.appendChild(n);
  }
  hasChildNodes(): boolean { return this.children.length > 0; } // Direction B P3: a first draw says "Reading…"
  setAttribute(): void {}
  addEventListener(_type: string, f: () => unknown): void { this.handlers.push(f); }
  async click(): Promise<void> { await Promise.all(this.handlers.map((h) => h())); }
  querySelector(sel: string): Node | null {
    if (sel === 'details[open]') return this.all().find((n) => n.tag === 'details' && n.dataset.open === '1') ?? null;
    const m = /^:scope > \.([\w-]+)$/.exec(sel);
    if (!m) throw new Error('stand-in DOM does not do ' + sel);
    return this.children.find((c) => c.has(m[1]!)) ?? null;
  }
  querySelectorAll(sel: string): Node[] {
    if (sel === '.lead-filed') return this.all().filter((n) => n.has('lead-filed'));
    if (sel === 'input, textarea') return this.all().filter((n) => n.tag === 'input' || n.tag === 'textarea');
    throw new Error('stand-in DOM does not do ' + sel);
  }
  text(): string { return [this.textContent, ...this.children.map((c) => c.text())].filter(Boolean).join(' '); }
  all(): Node[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}
const el = (tag: string, cls?: string, text?: string): Node => {
  const n = new Node(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const chip = (text: string, tone: string): Node => { const n = el('span', 'badge', text); n.dataset.tone = String(tone); return n; };
const plural = (n: number, one: string) => n + ' ' + (n === 1 ? one : one + 's');
const fmtWhen = (v: unknown) => (v ? 'WHEN(' + String(v) + ')' : '');
const flush = () => new Promise((r) => setTimeout(r, 0));

// The page's own feed words, so a named failure reads exactly as on screen.
const FEED_WORD = new Function(`${oneLine('const FEED_WORD = ')}\nreturn FEED_WORD;`)() as Record<string, string>;
const RETRY = new Function(`${oneLine('const RETRY = ')}\nreturn RETRY;`)() as string;
const feedKind = pageFn<(e: unknown) => string>('feedKind', { LINKS: 'simulation' });
const feedLine = pageFn<(e: unknown, what: string, tail?: string) => Node>('feedLine', { el, FEED_WORD, RETRY, feedKind }, oneLine('function feedLine('));
const fail = (code?: number, message = 'error') => Object.assign(new Error(message), code ? { code } : {});

// ---------- Calls ----------
describe('Calls: the Texts card lines up its two phone lines (QA3 #6)', () => {
  it('the hanging indent is scoped to the Texts card, so summary lines elsewhere stay flush', () => {
    expect(fnSrc('renderCalls')).toContain("const txSlot = el('div', 'slot texts');");
    expect(css).toContain('\n.texts .feed-state + .storm-muted{padding-left:18px}\n');
    // The .feed-state text starts 18px in; the muted line under it hangs at the same column.
    expect(css).toMatch(/\n\.feed-state\{[^}]*padding-left:18px/);
    // Never the global pair: Customers and Sona put a summary under a feed-state row.
    expect(css).not.toMatch(/\n\.feed-state \+ \.storm-muted\{/);
  });
});

describe('Calls: a transcripts or call-notes read that failed is named, never an absent section (QA3 #7)', () => {
  function mount(routes: Record<string, () => unknown>) {
    const v = el('div');
    const keywall = vi.fn();
    const api = async (path: string) => {
      const r = routes[path];
      if (!r) throw new Error('unexpected read ' + path);
      return r();
    };
    const renderCalls = pageFn<() => Promise<void>>('renderCalls', {
      $: () => v, el, api, chip, plural, fmtWhen, fmtTime: fmtWhen, readingLine: () => el('div', 'reading', 'Reading…'), tapCount: () => 0, keepsPage: () => false, TIMER_REDRAW: false, 
      studyPanel: async () => null, outreachPanel: async () => null, sonaPanel: async () => null,
      // The Quo panels fold through the shared helper (QA3 quo-fold); a no-op here.
      fillQuoSlots: () => Promise.resolve(),
      showKeywall: keywall, LINKS_READY: Promise.resolve('simulation'),
      state: (t: string, m: string) => el('div', 'state', t + ' ' + m),
      feedLine, showSaveFail: () => {},
    });
    const slotTitled = (t: string) => v.children.find((n) => n.children[0]?.textContent === t);
    return { v, renderCalls, keywall, slotTitled };
  }
  const ok = {
    '/api/webhooks/texts': () => ({ linkCut: true, wired: false, texts: [] }),
    '/api/relay/call-notes': () => ({ notes: [] }),
    '/api/webhooks/calls': () => ({ linkCut: false, wired: true, transcripts: [] }),
    '/api/review/backlog?all=1&limit=20': () => ({ conversations: [] }),
  };

  it('a dropped transcripts read is one named line in Arbo’s own line card', async () => {
    for (const e of [fail(), fail(500)]) {
      const s = mount({ ...ok, '/api/webhooks/calls': () => { throw e; } });
      await s.renderCalls();
      await flush();
      const own = s.slotTitled('Arbo’s own line')!;
      expect(own.text()).toContain('Call transcripts: couldn’t read it. Tap ↻ at the top to try again.');
      expect(own.all().find((n) => n.textContent.startsWith('Call transcripts:'))!.className).toBe('feed-state unread');
    }
  });

  it('a dropped call-notes read keeps its title and says so', async () => {
    const s = mount({ ...ok, '/api/relay/call-notes': () => { throw fail(502); } });
    await s.renderCalls();
    await flush();
    const notes = s.slotTitled('Notes from calls you answered')!;
    expect(notes.has('slot')).toBe(true);
    expect(notes.children.map((n) => n.className)).toEqual(['panel-title', 'feed-state unread']);
    expect(notes.children[1]!.textContent).toBe('Call notes: couldn’t read it. Tap ↻ at the top to try again.');
  });

  it('read fine and empty stays quiet: no notes section, no transcripts line', async () => {
    const s = mount(ok);
    await s.renderCalls();
    await flush();
    expect(s.slotTitled('Notes from calls you answered')).toBeUndefined();
    expect(s.v.text()).not.toContain('Call transcripts');
    expect(s.v.text()).not.toContain('Call notes');
  });

  it('a 401 on either read adds nothing — the backlog read owns the key wall', async () => {
    const s = mount({
      ...ok,
      '/api/webhooks/calls': () => { throw fail(401, 'unauthorized'); },
      '/api/relay/call-notes': () => { throw fail(401, 'unauthorized'); },
      '/api/review/backlog?all=1&limit=20': () => { throw fail(401, 'unauthorized'); },
    });
    await s.renderCalls();
    await flush();
    expect(s.keywall).toHaveBeenCalledTimes(1);
    expect(s.v.text()).not.toContain('Call transcripts');
    expect(s.slotTitled('Notes from calls you answered')).toBeUndefined();
  });
});

// ---------- Route planner ----------
describe('Route planner: the day select and Plan route are two equal halves (QA3 #8)', () => {
  const planner = fnSrc('routePlannerPanel');

  it('the row is a two-column grid; neither box carries a flex share its padding can skew', () => {
    const prow = planner.indexOf("const prow = el('div', 'loc-strip');");
    expect(planner.indexOf("prow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr';")).toBeGreaterThan(prow);
    expect(planner).toContain("daySel.style.cssText = 'min-width:0';");
    expect(planner).toContain("pbtn.style.cssText = 'min-width:0;width:100%;margin-top:0';");
    expect(planner).not.toContain('flex:1 1 0');
    // The grid keeps .loc-strip's 12px gap; the select fills its track from .input.
    expect(css).toMatch(/\n\.loc-strip\{[^}]*gap:12px/);
    expect(css).toMatch(/#bd input\[type=text\],\.input\{\n {2}width:100%;/);
    expect(css).toContain('*{box-sizing:border-box;');
  });
});

// ---------- Leads ----------
describe('Leads: a spam Undo holds the minute timer for about 2 minutes, not forever (QA3 #9)', () => {
  afterEach(() => { vi.useRealTimers(); });
  const lead = {
    id: 'L1', name: 'SIM-Elm, Test', phone: '+17575550101', city: 'Norfolk', zip: '23503',
    createdAt: '2026-10-18T14:00:00Z', status: 'emergency', isEmergency: true, needsCallback: false,
    isFirstTimer: true, quality: { priority: 'hot' }, permit: null, screenPending: false,
    permitUnreadable: false, history: null, historyUnreadable: false, details: null,
  };
  function mount() {
    const v = el('div');
    const api = async (_path: string, opts?: unknown) => (opts ? { ok: true } : { leads: [lead] });
    // R26: the permit words come through permitChip (one map); Leads also updates the tab badge.
    const PERMIT_STATE = new Function(`return ${/^const PERMIT_STATE = (\{.*\});$/m.exec(html)![1]}`)();
    const permitChip = pageFn<(s: string) => Node>('permitChip', { chip, PERMIT_STATE });
    const permitBadge = pageFn<(l: unknown) => Node | null>('permitBadge', { permitChip });
    const renderLeads = pageFn<() => Promise<void>>('renderLeads', {
      $: () => v, el, api, chip, fmtWhen, permitBadge, leadsTabBadge: () => {}, readingLine: () => el('div', 'reading', 'Reading…'), tapCount: () => 0, keepsPage: () => false, TIMER_REDRAW: false, 
      icon: (id: string) => el('svg', 'ico ' + id),
      showKeywall: () => {}, LINKS_READY: Promise.resolve('simulation'),
      state: (t: string) => el('div', 'state', t), feedState: (_e: unknown, w: string) => el('div', 'state', w),
      feedLine, showSaveFail: () => {},
    });
    const spam = () => v.all().find((n) => n.tag === 'button' && n.has('bad'))!;
    return { v, renderLeads, spam };
  }
  const holdsTyping = pageFn<(v: Node) => boolean>('holdsTyping', {});

  it('the filed line is stamped when it was filed, and says how long Undo stays', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T15:00:00Z'));
    const s = mount();
    await s.renderLeads();
    await s.spam().click();
    const filed = s.v.all().find((n) => n.has('lead-filed'))!;
    expect(filed.dataset.at).toBe(String(Date.parse('2026-10-18T15:00:00Z')));
    expect(filed.text()).toContain('Filed as spam — Undo stays about 2 minutes, or until you tap ↻.');
    expect(fnSrc('renderLeads')).not.toContain('it leaves the inbox when you tap');
  });

  it('the minute timer skips Leads while the Undo is fresh, then redraws it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.parse('2026-10-18T15:00:00Z');
    vi.setSystemTime(t0);
    const s = mount();
    await s.renderLeads();
    await s.spam().click();
    const ran: string[] = [];
    const TIMED = { today: () => ran.push('today'), leads: () => ran.push('leads') };
    const views: Record<string, unknown> = { 'view-today': el('div'), 'view-leads': s.v, keywall: el('div') };
    const tick = pageFn<() => void>('autoRefresh', { document: { hidden: false }, $: (id: string) => views[id], TIMED, holdsTyping });
    vi.setSystemTime(t0 + 60000);
    tick();
    expect(ran).toEqual(['today']); // a minute in: the Undo is still on offer
    vi.setSystemTime(t0 + 121000);
    tick();
    expect(ran).toEqual(['today', 'today', 'leads']); // past 2 minutes: a new lead can land
  });

  it('typed text and an open transcript still hold with no time limit; an unstamped filed line never holds', () => {
    const typed = el('div');
    typed.appendChild(Object.assign(el('input'), { value: '12 Oak St', type: 'text' }));
    expect(holdsTyping(typed)).toBe(true);
    const open = el('div');
    open.appendChild(Object.assign(el('details'), { dataset: { open: '1' } }));
    expect(holdsTyping(open)).toBe(true);
    const unstamped = el('div');
    unstamped.appendChild(el('div', 'lead-filed'));
    expect(holdsTyping(unstamped)).toBe(false); // NaN age: redraw rather than freeze
  });
});

// ---------- Settings ----------
type Route = unknown | { fail: { code?: number; message?: string } };
const OK_ROUTES: Record<string, Route> = {
  '/api/settings/channels': { channels: [{ id: 'gmail', label: 'Gmail leads', on: true }, { id: 'lsa', label: 'Google LSA', on: false }] },
  '/api/inbox/intents': { pipeline: 'live' },
  '/api/settings/route': { workZip: null, location: { enabled: false, zip: null, ageMinutes: null } },
  '/api/reception/status': { linkCut: false },
  '/api/google/connect': { token: { stored: true, where: 'disk', savedAt: null }, consentUrl: 'https://example.invalid/consent' },
  '/api/links': { master: 'cut', links: [{ link: 'leads', state: 'cut' }] },
  '/api/webhooks': { sources: { resend: { configured: false, received: 0 }, railway: { configured: false, received: 0 }, twilio: { configured: false, received: 0 } }, cut: [] },
  '/api/quo': { status: { registration: { state: 'ok' }, received: 0 } },
};
async function buildSettings(over: Record<string, Route> = {}, post?: (path: string) => Promise<unknown>) {
  const routes = { ...OK_ROUTES, ...over };
  const api = async (path: string, opts?: unknown) => {
    if (opts && post) return post(path);
    const r = routes[path] as { fail?: { code?: number; message?: string } } | undefined;
    if (r === undefined) throw fail(500);
    if (r && typeof r === 'object' && 'fail' in r && r.fail) throw fail(r.fail.code, r.fail.message);
    return r;
  };
  const v = el('div');
  const saveFails: unknown[] = [];
  const rerender = vi.fn();
  const build = pageFn<(v: Node, gen: number) => Promise<void>>('buildSettings', {
    settingsGen: 1, api, el, chip, feedKind, FEED_WORD, feedLine,
    document: { createElement: (tag: string) => el(tag) },
    state: (title: string, msg: string) => el('div', 'state', title + ' | ' + msg),
    LINKS_READY: Promise.resolve('cut'), showKeywall: () => {},
    showSaveFail: (_box: Node, e: unknown) => { saveFails.push(e); },
    saveFailText: () => '', fmtTime: () => '', renderSettings: rerender,
    themePref: () => 'auto', setTheme: () => {},
    bouncieSettings: async () => {}, // R31: the Bouncie card has its own tests (test/bouncie.test.ts)
  });
  await build(v, 1);
  const texts = () => v.all().map((n) => n.textContent).filter(Boolean);
  const withText = (s: string) => v.all().find((n) => n.textContent.includes(s));
  return { v, texts, withText, saveFails, rerender };
}

describe('Settings: each unwired webhook names what it is missing (QA3 #12)', () => {
  it('Railway names its URL key and itself once; Resend keeps the signing-secret sentence', async () => {
    const { texts } = await buildSettings();
    const railway = texts().find((t) => t.startsWith('Railway (deploy notices)'))!;
    expect(railway).toBe('Railway (deploy notices) — RAILWAY_WEBHOOK_KEY (the key in the webhook link) isn’t set, so Arbo can’t count deploy notices; this is not zero events');
    expect(railway.match(/Railway/g)).toHaveLength(1);
    expect(railway).not.toContain('signing secret');
    expect(texts()).toContain('Resend (website form copies) — no signing secret set on Railway, so Arbo can’t count what it sent; this is not zero events');
  });

  it('Twilio is gated by a URL key too, so it names that variable; a cut Twilio still reads as cut', async () => {
    const { texts } = await buildSettings();
    expect(texts()).toContain('Twilio — TWILIO_SMS_WEBHOOK_KEY (the key in the webhook link) isn’t set, so Arbo can’t count incoming texts; this is not zero events');
    const cut = await buildSettings({ '/api/webhooks': { sources: { twilio: { configured: false, received: 0 } }, cut: ['twilio'] } });
    expect(cut.texts()).toContain('Twilio — disconnected while Sona handles calls');
  });

  it('every unwired row keeps the §1B "this is not zero events" clause', async () => {
    const { texts } = await buildSettings();
    const rows = texts().filter((t) => /^(Resend|Railway|Twilio)/.test(t));
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r, r).toMatch(/; this is not zero events$/);
  });
});

describe('Settings: a tapped switch shows its tap at once (QA3 #13)', () => {
  type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
  function deferredPost() {
    const calls: Pending[] = [];
    const post = () => new Promise((resolve, reject) => { calls.push({ resolve, reject }); });
    return { calls, post };
  }
  const toggle = (v: Node, label: string, nth = 0) => v.all().filter((n) => n.tag === 'button' && n.has('loc-toggle') && n.textContent === label)[nth]!;

  it('a channel switch reads "Saving…" while the save and the rebuild run; a refusal puts ON back', async () => {
    const d = deferredPost();
    const s = await buildSettings({}, d.post);
    const btn = toggle(s.v, 'ON');
    const p = btn.onclick!();
    expect(btn.textContent).toBe('Saving…');
    expect(btn.disabled).toBe(true);
    d.calls[0]!.reject(fail(503, 'link_cut'));
    await p;
    expect(btn.textContent).toBe('ON');
    expect(btn.disabled).toBe(false);
    expect(s.saveFails).toHaveLength(1);
    expect(s.rerender).not.toHaveBeenCalled();
  });

  it('a saved tap keeps "Saving…" up until the rebuilt page swaps in', async () => {
    const d = deferredPost();
    const s = await buildSettings({}, d.post);
    const btn = toggle(s.v, 'OFF');
    const p = btn.onclick!();
    d.calls[0]!.resolve({ ok: true });
    await p;
    expect(btn.textContent).toBe('Saving…');
    expect(s.rerender).toHaveBeenCalledTimes(1);
  });

  it('the Live location toggle does the same, and puts OFF back on a refusal', async () => {
    const d = deferredPost();
    const s = await buildSettings({}, d.post);
    const lbtn = s.withText('OFF — no location is received or kept')!.parent!.children[0]!;
    expect(lbtn.textContent).toBe('OFF');
    const p = lbtn.onclick!();
    expect(lbtn.textContent).toBe('Saving…');
    d.calls[0]!.reject(fail());
    await p;
    expect(lbtn.textContent).toBe('OFF');
    expect(lbtn.disabled).toBe(false);
  });

  it('a disabled toggle looks disabled — an idle ON one too', () => {
    expect(css).toContain('\n.loc-toggle:disabled,.loc-toggle.idle:disabled{opacity:.55}\n');
    // It comes after .on.idle (same weight), so it wins over that rule's .75.
    expect(css.indexOf('.loc-toggle.idle:disabled')).toBeGreaterThan(css.indexOf('.loc-toggle.on.idle{'));
  });
});

describe('Settings: an unread phone-line status never reads as the live caller offer (QA3 #14)', () => {
  const UNREAD = 'Arbo couldn’t read whether its own phone line is on, so it can’t say whether callers are offered the nearby estimate.';

  it('with a ZIP set, the intro still says the status went unread', async () => {
    const { withText } = await buildSettings({
      '/api/reception/status': { fail: { code: 502 } },
      '/api/settings/route': { workZip: '23451', location: { enabled: false, zip: null, ageMinutes: null } },
    });
    const intro = withText('Where you’re working today')!.textContent;
    expect(intro).toContain(UNREAD);
    expect(intro).not.toContain('get offered an easy weekday estimate');
    expect(intro).toContain('sets where your route and estimate prep sheets start');
    expect(withText('Set for today: 23451')).toBeDefined();
  });

  it('with no ZIP, it is said once — the unset line does not repeat it', async () => {
    const { texts } = await buildSettings({ '/api/reception/status': { fail: {} } });
    expect(texts().filter((t) => t.includes('couldn’t read whether'))).toHaveLength(1);
    expect(texts()).toContain('Not set today — route and prep sheets have no starting ZIP.');
  });

  it('a read status keeps its own sentence: live offers, cut does not', async () => {
    const live = await buildSettings();
    expect(live.withText('Where you’re working today')!.textContent).toContain('callers in or near this ZIP get offered an easy weekday estimate');
    const cut = await buildSettings({ '/api/reception/status': { linkCut: true } });
    expect(cut.withText('Where you’re working today')!.textContent).toContain('no caller is offered the nearby estimate right now');
    for (const s of [live, cut]) expect(s.texts().join(' ')).not.toContain('couldn’t read whether');
  });
});

// ---------- Permit Desk ----------
describe('Permits: a rule with no office points where it belongs (QA3 #15, #16)', () => {
  const NO_OFFICE = 'No office on file — ask the city which office handles this.';
  const NO_OFFICE_WIDE = 'No office on file — confirm it with the body that publishes it before relying on it.';
  type Fact = (typeof FACTS)[number];
  const nb = new Function(`${oneLine('const nb = ')}\nreturn nb;`)() as (s: string) => string;
  const KNOWN_HOSTS = new Function(`${oneLine('const KNOWN_HOSTS = ')}\nreturn KNOWN_HOSTS;`)() as Record<string, string>;
  const document = { createTextNode: (t: string) => el('#text', '', t) };
  const factCard = pageFn<(f: Fact, stale: boolean) => Node>('factCard', {
    el, chip, nb, fmtWhen, KNOWN_HOSTS, document, whoLine: () => el('div', 'who-line', 'OFFICE'),
  });
  const metaLines = (f: Fact) => factCard(f, false).all().find((n) => n.has('factmeta'))!.children.map((n) => n.textContent);
  const notCity = (f: Fact) => f.city === 'Virginia' || f.city === 'Regional';

  it('the ANSI Z133 standard never tells Mike to ask the city', () => {
    const z133 = FACTS.find((f) => f.id === 'va-z133-2026')!;
    expect(z133.city).toBe('Virginia');
    expect(z133.whoToCall).toBeFalsy();
    expect(metaLines(z133)).toContain(NO_OFFICE_WIDE);
    expect(metaLines(z133)).not.toContain(NO_OFFICE);
  });

  it('no Virginia or Regional rule says "ask the city"; a bare city rule still does', () => {
    for (const f of FACTS.filter(notCity)) expect(factCard(f, false).text(), f.id).not.toContain('ask the city');
    const bareCity = FACTS.filter((f) => !notCity(f) && !f.whoToCall && f.confidence !== 'SOURCED');
    expect(bareCity.length).toBeGreaterThan(0);
    for (const f of bareCity) expect(metaLines(f), f.id).toContain(NO_OFFICE);
  });

  it('the new line keeps the permit and brand guardrails', () => {
    expect(NO_OFFICE_WIDE).not.toMatch(/\bclear(ed)?\b|exempt|tcia|suffolk/i);
    expect(fnSrc('factCard')).toContain("(f.city === 'Virginia' || f.city === 'Regional')");
  });
});
