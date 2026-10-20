// QA round 2 — Calls, Calendar and Leads (package calls-cal-leads).
// vitest has no DOM, so the two screens with real logic (Leads' file-it pair
// and Undo, Calls' held height and its own-line card) are lifted out of the
// page and run against a small stand-in DOM; the rest are source pins scoped
// to the function that renders them. The shared helpers (chip, plural,
// fmtWhen) come from the 'shared' package and are stubbed here by contract.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const repo = vi.hoisted(() => ({ statuses: [] as string[] }));
vi.mock('../src/db/repositories.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/db/repositories.js')>()),
  updateLeadStatus: async (id: string, status: string) => { repo.statuses.push(id + ':' + status); },
}));

import { createApi } from '../src/server/api.js';
import { createLiveSource } from '../src/server.js';

const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
const css = html.slice(0, html.indexOf('</style>'));

/** One top-level function's source: from its declaration to the "}" alone on a line. */
function fnSrc(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
/** The same function, built with stand-ins for every outside name it reaches for. */
function pageFn<T>(name: string, deps: Record<string, unknown>): T {
  return new Function(...Object.keys(deps), `${fnSrc(name)}\nreturn ${name};`)(...Object.values(deps)) as T;
}

// ---------- a stand-in DOM: just what these two screens touch ----------
class Node {
  className = '';
  textContent = '';
  disabled = false;
  title = '';
  href = '';
  offsetHeight = 0;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
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
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  addEventListener(_type: string, f: () => unknown): void { this.handlers.push(f); }
  async click(): Promise<void> { await Promise.all(this.handlers.map((h) => h())); }
  querySelector(sel: string): Node | null {
    const m = /^:scope > \.([\w-]+)$/.exec(sel);
    if (!m) throw new Error('stand-in DOM does not do ' + sel);
    return this.children.find((c) => c.has(m[1]!)) ?? null;
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
// The shared package's contract: chip(text, tone) is a .badge span in that tone.
const chip = (text: string, tone: string): Node => { const n = el('span', 'badge', text); n.dataset.tone = String(tone); return n; };
// R26 (qa-x6): the permit words live in one page map, PERMIT_STATE, read through permitChip.
const PERMIT_STATE = new Function(`return ${/^const PERMIT_STATE = (\{.*\});$/m.exec(html)![1]}`)() as Record<string, [string, string]>;
const permitChip = pageFn<(s: string) => Node>('permitChip', { chip, PERMIT_STATE });
const plural = (n: number, one: string, many?: string) => n + ' ' + (n === 1 ? one : (many || one + 's'));
const fmtWhen = (v: unknown) => (v ? 'WHEN(' + String(v) + ')' : '');
const chipsIn = (n: Node) => n.all().filter((x) => x.has('badge')).map((x) => x.textContent + '=' + x.dataset.tone);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Leads: the file-it pair, Undo and the chip rows (run, not just read)', () => {
  type Lead = Record<string, unknown>;
  const lead = (o: Lead = {}): Lead => ({
    id: 'L1', name: 'SIM-Elm, Test', phone: '+17575550101', city: 'Norfolk', zip: '23503',
    createdAt: '2026-10-18T14:00:00Z', status: 'new', isEmergency: false, needsCallback: false,
    isFirstTimer: true, quality: { priority: 'warm' }, permit: null, screenPending: true,
    permitUnreadable: false, history: null, historyUnreadable: false, details: null, ...o,
  });
  function mount(leads: Lead[]) {
    const v = el('div');
    const posts: Array<{ path: string; status: unknown }> = [];
    const saveFails: unknown[] = [];
    const ctl = { fail: false };
    const api = async (path: string, opts?: { body: { status: unknown } }) => {
      if (!opts) return { leads };
      posts.push({ path, status: opts.body.status });
      if (ctl.fail) { ctl.fail = false; throw Object.assign(new Error('link_cut'), { code: 503 }); }
      return { ok: true };
    };
    const permitBadge = pageFn<(l: Lead) => Node | null>('permitBadge', { permitChip });
    const renderLeads = pageFn<() => Promise<void>>('renderLeads', {
      $: () => v, el, api, chip, fmtWhen, plural, permitBadge, leadsTabBadge: () => {},
      icon: (id: string) => el('svg', 'ico ' + id),
      showKeywall: () => {}, LINKS_READY: Promise.resolve('simulation'),
      state: (t: string) => el('div', 'state', t), feedState: (_e: unknown, w: string) => el('div', 'state', w),
      feedLine: (_e: unknown, w: string) => el('div', 'feed-state', w),
      showSaveFail: (_box: Node, e: unknown) => { saveFails.push(e); },
    });
    const card = () => v.children[0]!;
    const buttons = () => card().all().filter((n) => n.tag === 'button');
    const good = () => buttons().find((b) => b.has('ok'))!;
    const spam = () => buttons().find((b) => b.has('bad'))!;
    const undo = () => buttons().find((b) => b.textContent === 'Undo')!;
    return { v, renderLeads, posts, saveFails, ctl, card, good, spam, undo };
  }

  // R-READONLY: an older lead (the server's `older`, > 14 days) is never new work.
  it('an older lead sits under its own heading with its age: no alarm, no call-back label, no Call back button', async () => {
    const s = mount([
      lead({ id: 'OLD', createdAt: '2026-07-12T14:00:00Z', older: true, ageDays: 100, filedAsEmergency: true, isEmergency: false, needsCallback: false, quality: { priority: 'hot' } }),
      lead({ id: 'NEW', needsCallback: true }),
    ]);
    await s.renderLeads();
    const kids = s.v.children;
    // The recent lead first, then the heading, then the older one.
    expect(kids[0]!.text()).toContain('SIM-Elm');
    const head = kids.findIndex((n) => n.textContent === 'Older leads — more than 14 days old');
    expect(head).toBeGreaterThan(0);
    const old = kids.slice(head).find((n) => n.has('card'))!;
    expect(old.text()).toContain('Older lead — came in 100 days ago. Filed as an emergency then — not a live alarm.');
    expect(old.text()).toContain('WHEN(2026-07-12T14:00:00Z)'); // its date, in the card's one time format
    expect(chipsIn(old)).toContain('OLDER LEAD=info');
    expect(chipsIn(old).join(' ')).not.toMatch(/EMERGENCY|HOT/);
    expect(old.has('emergency') || old.has('callback')).toBe(false);
    expect(old.all().some((n) => n.textContent === 'Call back' || n.textContent === 'Call back needed')).toBe(false);
    // The recent lead keeps everything it had.
    expect(kids[0]!.all().some((n) => n.textContent === 'Call back')).toBe(true);
  });

  it('only older leads: the screen says nothing new is waiting, then shows them for the record', async () => {
    const s = mount([lead({ id: 'OLD', older: true, ageDays: 30 })]);
    await s.renderLeads();
    expect(s.v.children[0]!.textContent).toBe('No new leads');
    expect(s.v.children.some((n) => n.textContent === 'Older leads — more than 14 days old')).toBe(true);
  });

  it('Undo on an emergency lead puts back "emergency", not "new"', async () => {
    const s = mount([lead({ id: 'E1', status: 'emergency', isEmergency: true, quality: { priority: 'hot' } })]);
    await s.renderLeads();
    await s.spam().click();
    expect(s.card().has('dismissed')).toBe(true);
    expect(s.card().text()).toContain('Filed as spam — Undo stays about 2 minutes, or until you tap\u00a0↻.'); // ↻ never wraps alone
    await s.undo().click();
    expect(s.posts.map((p) => p.status)).toEqual(['spam', 'emergency']);
    expect(s.posts[1]!.path).toBe('/api/leads/E1/status');
    expect(s.card().has('dismissed')).toBe(false);
    expect(chipsIn(s.card())).not.toContain('SPAM=info');
  });

  it('a good lead keeps its half of the pair, done — and Undo after spam puts back "qualified"', async () => {
    const s = mount([lead()]);
    await s.renderLeads();
    const good = s.good();
    await good.click();
    expect(s.posts.map((p) => p.status)).toEqual(['qualified']);
    // Still in the row, disabled, saying it is done — never removed.
    expect(s.good()).toBe(good);
    expect(good.disabled).toBe(true);
    expect(good.text()).toContain('Good lead ✓');
    expect(s.spam().disabled).toBe(false);
    expect(chipsIn(s.card())).toContain('QUALIFIED=good');
    await s.spam().click();
    expect(chipsIn(s.card())).not.toContain('QUALIFIED=good');
    await s.undo().click();
    expect(s.posts.map((p) => p.status)).toEqual(['qualified', 'spam', 'qualified']);
    expect(chipsIn(s.card())).toContain('QUALIFIED=good');
    expect(s.good().disabled).toBe(true); // Undo re-enables Spam, never the done half
    expect(s.spam().disabled).toBe(false);
  });

  it('a lead already qualified at load draws the same done half', async () => {
    const s = mount([lead({ status: 'qualified' })]);
    await s.renderLeads();
    expect(s.good().disabled).toBe(true);
    expect(s.good().text()).toContain('Good lead ✓');
    expect(s.good().dataset.done).toBe('1');
    expect(s.spam().disabled).toBe(false);
  });

  it('a tap that did not save says so and turns the pair back on (the done half stays done)', async () => {
    const s = mount([lead()]);
    await s.renderLeads();
    s.ctl.fail = true;
    await s.good().click();
    expect(s.saveFails).toHaveLength(1);
    expect(s.good().disabled).toBe(false);
    expect(s.good().text()).toContain('Good lead');
    expect(s.good().text()).not.toContain('✓');
    const q = mount([lead({ status: 'qualified' })]);
    await q.renderLeads();
    q.ctl.fail = true;
    await q.spam().click();
    expect(q.saveFails).toHaveLength(1);
    expect(q.spam().disabled).toBe(false);
    expect(q.good().disabled).toBe(true);
  });

  it('line 1 is triage + who they are, line 2 the permit state; EMERGENCY never sits beside HOT', async () => {
    const s = mount([
      lead({ id: 'E1', isEmergency: true, quality: { priority: 'hot' }, status: 'emergency' }),
      lead({ id: 'H1', quality: { priority: 'hot' }, isFirstTimer: false, permit: { screenStatus: 'PERMIT_LIKELY' }, screenPending: false }),
      lead({ id: 'C1', quality: { priority: 'cool' }, permit: { screenStatus: 'NO_OVERLAY_VERIFY' }, screenPending: false }),
    ]);
    await s.renderLeads();
    const rows = (i: number) => s.v.children[i]!.children.filter((n) => n.has('badges')).map(chipsIn);
    expect(rows(0)).toEqual([['EMERGENCY=alarm', 'FIRST-TIMER=info'], ['PERMIT SCREEN PENDING=watch']]);
    expect(rows(1)).toEqual([['HOT=stop', 'REPEAT=info'], ['PERMIT LIKELY=watch']]);
    expect(rows(2)).toEqual([['COOL=info', 'FIRST-TIMER=info'], ['NO OVERLAY — VERIFY W/ CITY=info']]);
    const permitRow = s.v.children[0]!.children.filter((n) => n.has('badges'))[1]!;
    expect(permitRow.style.marginTop).toBe('6px');
  });

  it('the card time is the one human format, never a bare day', async () => {
    const s = mount([lead({ createdAt: '2026-10-18T14:05:00Z' })]);
    await s.renderLeads();
    const when = s.card().all().find((n) => n.has('when'))!;
    expect(when.textContent).toBe('WHEN(2026-10-18T14:05:00Z)');
    const leads = fnSrc('renderLeads');
    expect(leads).toContain("top.appendChild(el('div', 'when', fmtWhen(lead.createdAt)));");
    expect(leads).not.toContain('toLocaleDateString');
  });
});

describe('the permit chip keeps Mike’s words and takes a tone', () => {
  const permitBadge = pageFn<(l: unknown) => Node | null>('permitBadge', { permitChip });
  const tone = (l: unknown) => { const n = permitBadge(l); return n && n.textContent + '=' + n.dataset.tone; };

  it('PERMIT LIKELY / REVIEW NEEDED / PENDING need a look; NO OVERLAY — VERIFY is context', () => {
    expect(tone({ permit: { screenStatus: 'PERMIT_LIKELY' } })).toBe('PERMIT LIKELY=watch');
    expect(tone({ permit: { screenStatus: 'REVIEW_NEEDED' } })).toBe('PERMIT: REVIEW NEEDED=watch');
    expect(tone({ permit: { screenStatus: 'NO_OVERLAY_VERIFY' } })).toBe('NO OVERLAY — VERIFY W/ CITY=info');
    expect(tone({ permit: null, screenPending: true })).toBe('PERMIT SCREEN PENDING=watch');
    expect(permitBadge({ permit: null, screenPending: false })).toBeNull();
    expect(fnSrc('permitBadge')).not.toContain('badge(');
  });
});

describe('Calls: one own-line card, and a redraw that holds its height (run, not just read)', () => {
  type Deferred = { promise: Promise<null>; resolve: () => void };
  const deferred = (): Deferred => { let resolve!: () => void; const promise = new Promise<null>((r) => { resolve = () => r(null); }); return { promise, resolve }; };
  function mount(backlog: () => unknown) {
    const v = el('div');
    v.offsetHeight = 1234;
    const study = deferred();
    const keywall = vi.fn();
    const api = async (path: string) => {
      if (path === '/api/webhooks/texts') return { linkCut: true, wired: false, texts: [] };
      if (path === '/api/relay/call-notes') return { notes: [] };
      if (path === '/api/webhooks/calls') return { linkCut: true, wired: false, transcripts: [] };
      if (path === '/api/review/backlog?all=1&limit=20') return backlog();
      throw new Error('unexpected read ' + path);
    };
    const renderCalls = pageFn<() => Promise<void>>('renderCalls', {
      $: () => v, el, api, chip, plural, fmtWhen, fmtTime: fmtWhen,
      studyPanel: () => study.promise, outreachPanel: async () => null, sonaPanel: async () => null,
      fillQuoSlots: pageFn('fillQuoSlots', { el, LINKS_READY: Promise.resolve('live') }),
      showKeywall: keywall, LINKS_READY: Promise.resolve('simulation'),
      state: (t: string, m: string) => el('div', 'state', t + ' ' + m),
      feedLine: (_e: unknown, what: string, tail?: string) => el('div', 'feed-state sim', what + ': not in the practice data.' + (tail ? ' ' + tail : '')),
      showSaveFail: () => {},
    });
    const ownSlot = () => v.children.find((n) => n.children[0]?.textContent === 'Arbo’s own line')!;
    return { v, renderCalls, study, keywall, ownSlot };
  }
  const notSimulated = () => { throw Object.assign(new Error('not_simulated'), { code: 503 }); };

  it('a call log Arbo could not read is one line in the card, with the card’s one "not zero calls"', async () => {
    const s = mount(notSimulated);
    await s.renderCalls();
    await flush();
    const own = s.ownSlot();
    expect(own.has('slot')).toBe(true);
    expect(own.children.map((n) => n.className)).toEqual(['panel-title', '', 'feed-state sim']);
    expect(own.children[1]!.text()).toBe('Call transcripts: disconnected while Sona handles calls. Sona answers on the Quo line — its status is in the Quo card above.');
    expect(own.children[2]!.text()).toBe('Call log: not in the practice data. This is not zero calls.');
    expect(own.text().match(/not zero/g)).toHaveLength(1);
    // Every section of the screen is a card; nothing floats loose on the page.
    expect(s.v.children.every((n) => n.has('slot'))).toBe(true);
    expect(s.v.all().some((n) => n.has('state'))).toBe(false);
  });

  it('holds the page height through the redraw, and lets go once every slot has landed', async () => {
    const s = mount(notSimulated);
    await s.renderCalls();
    await flush();
    expect(s.v.style.minHeight).toBe('1234px'); // the customer-notes read is still out
    s.study.resolve();
    await flush();
    expect(s.v.style.minHeight).toBe('');
  });

  it('lets go on every way out: the key wall, an empty log, and a full one', async () => {
    const locked = mount(() => { throw Object.assign(new Error('unauthorized'), { code: 401 }); });
    await locked.renderCalls();
    locked.study.resolve();
    await flush();
    expect(locked.keywall).toHaveBeenCalledTimes(1);
    expect(locked.v.style.minHeight).toBe('');

    const empty = mount(() => ({ conversations: [] }));
    await empty.renderCalls();
    empty.study.resolve();
    await flush();
    expect(empty.v.style.minHeight).toBe('');
    expect(empty.ownSlot().children[2]!.text()).toContain('No calls yet');

    const full = mount(() => ({ conversations: [{
      id: 'C1', channel: 'voice', started_at: '2026-10-18T13:00:00Z', reviewed: false,
      turns: [{ caller: 'SIM caller words', reply: 'SIM reply', flags: ['emergency', 'guard_blocked:price'] }],
    }, {
      id: 'C2', channel: 'web', started_at: '2026-10-17T13:00:00Z', reviewed: true,
      turns: [{ caller: 'a', reply: 'b', flags: [] }, { caller: 'c', reply: 'd', flags: [] }],
    }] }));
    await full.renderCalls();
    full.study.resolve();
    await flush();
    expect(full.v.style.minHeight).toBe('');
    const cards = full.ownSlot().children.filter((n) => n.has('card'));
    expect(cards).toHaveLength(2);
    expect(chipsIn(cards[0]!)).toEqual(['EMERGENCY=alarm', 'GUARD BLOCKED A REPLY=stop', 'VOICE=info']);
    expect(chipsIn(cards[1]!)).toEqual(['WEB=info', 'REVIEWED=good']);
    const top = (c: Node) => c.children[0]!.children.map((n) => n.textContent);
    expect(top(cards[0]!)).toEqual(['WHEN(2026-10-18T13:00:00Z)', '1 turn']);
    expect(top(cards[1]!)).toEqual(['WHEN(2026-10-17T13:00:00Z)', '2 turns']);
  });

  it('source: the height is taken before the clear, and release() runs before every return after the log read', () => {
    const calls = fnSrc('renderCalls');
    const hold = calls.indexOf("v.style.minHeight = v.offsetHeight + 'px';");
    expect(hold).toBeGreaterThan(-1);
    expect(hold).toBeLessThan(calls.indexOf('v.replaceChildren();'));
    expect(calls).toContain('const fills = [];');
    // QA round 3: the three Quo panels are one fill (fillQuoSlots), so 4, not 6.
    expect(calls.match(/fills\.push\(/g)).toHaveLength(4);
    expect(calls).toContain("const release = () => Promise.allSettled(fills).then(() => { v.style.minHeight = ''; });");
    const tail = calls.slice(calls.indexOf('const release'));
    const returns = [...tail.matchAll(/\breturn\b/g)].map((m) => tail.slice(Math.max(0, m.index! - 24), m.index!));
    expect(returns).toHaveLength(3);
    for (const before of returns) expect(before).toContain('release();');
    expect(tail.trimEnd().endsWith('release();\n}')).toBe(true);
  });

  it('copy: no "since deploy", no machine dates, chips by tone only', () => {
    const calls = fnSrc('renderCalls');
    expect(calls).not.toContain('since deploy');
    expect(calls).toContain('Business cell: nothing relayed from your iPhone since Arbo last restarted. If the Shortcut is set up, text yourself to test it.');
    expect(calls).toContain("trSlot.appendChild(el('div', 'feed-state unset', 'Call transcripts: not set up yet.'));");
    expect(calls).not.toContain('toLocaleString');
    expect(calls).not.toContain('badge(');
    expect(calls).toContain("plural(tr.turns, 'turn')");
    expect(calls).toContain("chip(m.line === 'business' ? 'BUSINESS CELL' : m.line === 'quo' ? 'QUO LINE' : 'ARBO LINE', 'info')");
  });
});

describe('Calendar', () => {
  const cal = fnSrc('renderCalendar');

  it('in practice mode the real calendar says it is real, once, right under its heading', () => {
    const head = cal.indexOf('v.appendChild(head);');
    const note = cal.indexOf("LINKS_READY.then((l) => { if (l === 'simulation' && head.isConnected) head.after(el('div', 'feed-state sim', 'Live Google Calendar \\u2014 not simulated. These are your real appointments, not practice data.')); });");
    expect(note).toBeGreaterThan(head);
    expect(note).toBeLessThan(cal.indexOf("el('a', 'cal-open'"));
  });

  it('the fallback under the frame is sentence-case help text, not the all-caps label style', () => {
    expect(cal).toContain("v.appendChild(el('div', 'storm-muted',\n    'Calendar not showing?");
    expect(cal.match(/'cal-src'/g)).toHaveLength(1); // the heading only
  });

  it('no bgcolor is computed from the theme any more', () => {
    const url = fnSrc('gcalEmbedUrl');
    expect(url).not.toContain('getComputedStyle');
    expect(url).toContain('// no bgcolor: Google’s embed has no dark mode; its default white matches its own grid in Day and Night.');
  });
});

describe('Route planner results', () => {
  const planner = fnSrc('routePlannerPanel');

  it('warnings read the 12-hour clock too, so "ends 21:30" is "ends 9:30 PM"', () => {
    const t12At = planner.indexOf('const t12 = ');
    expect(t12At).toBeGreaterThan(-1);
    expect(t12At).toBeLessThan(planner.indexOf('plan.warnings'));
    expect(planner).toContain("for (const w of plan.warnings) pout.appendChild(el('div', 'late', '\\u26a0 ' + w.replace(/\\b\\d{1,2}:\\d{2}\\b/g, t12)));");
    // The same replace, run: only HH:MM changes.
    const t12 = new Function('return ' + /const t12 = (\(s\) => \{.*\});/.exec(planner)![1])() as (s: string) => string;
    expect('Plan runs past 8pm (ends 21:30) — consider moving a stop to another day.'.replace(/\b\d{1,2}:\d{2}\b/g, t12))
      .toBe('Plan runs past 8pm (ends 9:30 PM) — consider moving a stop to another day.');
    expect('Morning run spills past noon (ends 12:20) — trim it or start earlier.'.replace(/\b\d{1,2}:\d{2}\b/g, t12))
      .toBe('Morning run spills past noon (ends 12:20 PM) — trim it or start earlier.');
  });

  it('each visit is a time chip, then the stop and when it ends', () => {
    expect(planner).toContain("row.appendChild(chip(t12(vt.startTime), 'info'));");
    expect(planner).toContain("row.appendChild(el('span', '', vt.order + '. ' + vt.label + ' (until\\u00a0' + t12(vt.endTime).replace(' ', '\\u00a0') + ')'));");
    expect(planner).not.toContain('badge(');
  });

  it('ZIP estimates are a named feed state (unread when Maps failed, unset when no key) — no ℹ help tip', () => {
    expect(planner).toContain("el('div', 'feed-state ' + (/Maps call failed/.test(plan.note) ? 'unread' : 'unset'), 'ZIP estimates \\u00b7 ' + plan.note)");
    expect(planner).toContain("el('div', 'storm-muted', 'Live traffic \\u00b7 ' + plan.note)");
    expect(planner).not.toContain('\\u2139');
    expect(planner).not.toContain('ℹ');
  });

  it('the day select and Plan route split the row evenly, and the select wears the shared chevron', () => {
    // QA round 3: flex-basis 0 left the select 16px wider (its padding), so the row is an equal grid.
    expect(planner).toContain("prow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr';");
    expect(planner).toContain("daySel.style.cssText = 'min-width:0';");
    expect(planner).toContain("pbtn.style.cssText = 'min-width:0;width:100%;margin-top:0';");
    expect(planner).not.toContain('flex:1 1 0');
    // At half a phone row the long label clipped ("Weekday (after ·"); the hint line carries "after 4 PM".
    expect(planner).toContain("[['saturday', 'Saturday'], ['weekday', 'Weekday']]");
    expect(planner).toContain('Weekdays start after 4 PM.');
    expect(css).toMatch(/\.field select,#yard select,select\.input\{-webkit-appearance:none;appearance:none;[^}]*background-image:/);
  });
});

describe('Leads buttons and copy (source pins)', () => {
  const leads = fnSrc('renderLeads');

  it('the file-it pair is the lighter control; its tone rides the icon, Call back stays heavy', () => {
    const mark = css.indexOf('.minibtn.mark{display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:1;min-height:44px;font-size:13.5px;color:var(--ink-2);border-color:var(--hairline)}.minibtn.mark .ico{width:18px;height:18px}\n');
    expect(mark).toBeGreaterThan(-1);
    const pair = css.indexOf('.minibtn.mark.ok .ico{color:var(--ok)}.minibtn.mark.bad .ico{color:var(--emergency)}');
    expect(pair).toBe(css.indexOf('\n', mark) + 1); // directly after the mark rule
  });

  it('Undo restores what the lead was; the done half is never removed', () => {
    expect(leads).toContain('const was = lead.status;');
    expect(leads).toContain("body: { status: qTag ? 'qualified' : was }");
    expect(leads).toContain("btn.disabled = true; btn.replaceChildren(icon('i-check'), el('span', '', 'Good lead ✓'));");
    expect(leads).not.toContain('btn.remove()');
    expect(leads).not.toContain("'new' } });");
    expect(leads).not.toContain('badge(');
    expect(leads).toContain("chip('SPAM', 'info')");
  });

  it('no developer copy on these screens', () => {
    for (const name of ['renderCalls', 'renderLeads', 'routePlannerPanel', 'renderCalendar', 'permitBadge']) {
      const src = fnSrc(name);
      expect(src, name).not.toMatch(/'[^'\n]*[a-z]\(s\)[^'\n]*'/i); // "stop(s)" in copy — plural() instead
      expect(src, name).not.toContain('since deploy');
      expect(src, name).not.toMatch(/'[^'\n]*\b(clear|cleared|exempt)\b[^'\n]*'/i);
    }
  });
});

describe('setLeadStatus takes "emergency" (Undo on an emergency lead)', () => {
  it('the handler accepts it and hands it to the source; nonsense is still a 400', async () => {
    const seen: string[] = [];
    const api = createApi({
      ready: () => true, stopsBetween: async () => [], newLeads: async () => [],
      setLeadStatus: async (id, status) => { seen.push(id + ':' + status); },
    });
    expect((await api.setLeadStatus('L1', 'emergency')).status).toBe(200);
    expect((await api.setLeadStatus('L1', 'EMERGENCY')).status).toBe(400);
    expect((await api.setLeadStatus('L1', 'banana')).status).toBe(400);
    expect(seen).toEqual(['L1:emergency']);
  });

  it('the live source passes it straight to the repository write', async () => {
    repo.statuses.length = 0;
    const live = createApi({ ...createLiveSource(), ready: () => true });
    expect((await live.setLeadStatus('L9', 'emergency')).status).toBe(200);
    expect(repo.statuses).toEqual(['L9:emergency']);
  });
});
