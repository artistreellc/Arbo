// Direction B, P17 (docs/DIRECTION_B_PLAN.md; Mike, 2026-10-20, the follow-up answers:
// "A red Sona flag clears when Mike taps Call back on that customer: it counts as
// handled and leaves the Leads badge. It stays in call history.").
// The plan's Q2 default: remembered on this phone (localStorage, wrapped in
// try/catch), by call id only — never the number, never a name — and forgotten
// after 7 days. The head and the badge skip handled calls; the card stays with
// SONA BROKE A RULE and a muted "Handled — you tapped Call back at …". A new slip
// (a new callId) raises the flag again. Storage lost or refused brings the flag
// back (the loud direction). No POST, no database write, no Quo write (R32/R33).
import { describe, it, expect, beforeEach } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';
import { sends } from './support/pageCode.js';

const html = loadAppHtml();
function fnSrc(name: string): string {
  const one = new RegExp(`^(?:async )?function ${name}\\(.*$`, 'm').exec(html);
  if (!one) throw new Error(`no function ${name} in the page`);
  if ((one[0].match(/\{/g) ?? []).length === (one[0].match(/\}/g) ?? []).length) return one[0];
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
function constSrc(name: string): string {
  const one = new RegExp(`^const ${name.replace(/\$/g, '\\$')} = (.*);\\s*(?://.*)?$`, 'm').exec(html);
  if (one) return `const ${name} = ${one[1]};`;
  const at = html.indexOf(`\nconst ${name} = `);
  if (at < 0) throw new Error(`no const ${name} in the page`);
  return html.slice(at + 1, html.indexOf('\n};', at) + 3);
}

// ---------- a stand-in DOM ----------
class N {
  className = ''; type = ''; id = ''; title = ''; hidden = false; disabled = false; href = '';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: N[] = [];
  parent: N | null = null;
  on: Record<string, Array<(e?: unknown) => unknown>> = {};
  private own = '';
  constructor(readonly tag: string) {}
  get textContent(): string { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(t: string) { for (const c of this.children) c.parent = null; this.children = []; this.own = t; }
  has(c: string) { return this.className.split(/\s+/).includes(c); }
  get classList() {
    return {
      add: (c: string) => { if (!this.has(c)) this.className = (this.className + ' ' + c).trim(); },
      remove: (c: string) => { this.className = this.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
      contains: (c: string) => this.has(c),
      toggle: (c: string, f?: boolean) => { if (f ?? !this.has(c)) this.classList.add(c); else this.classList.remove(c); },
    };
  }
  appendChild(c: N): N { c.parent?.drop(c); c.parent = this; this.children.push(c); return c; }
  drop(c: N) { this.children = this.children.filter((x) => x !== c); c.parent = null; }
  remove() { this.parent?.drop(this); }
  insertBefore(n: N, ref: N) { n.parent?.drop(n); n.parent = this; this.children.splice(this.children.indexOf(ref), 0, n); return n; }
  replaceChildren(...ns: N[]) { for (const c of this.children) c.parent = null; this.children = []; this.own = ''; for (const n of ns) this.appendChild(n); }
  hasChildNodes() { return this.children.length > 0 || this.own !== ''; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  addEventListener(t: string, f: (e?: unknown) => unknown) { (this.on[t] ??= []).push(f); }
  async click() { for (const f of this.on.click ?? []) await f({}); }
  all(): N[] { return [this, ...this.children.flatMap((c) => c.all())]; }
  private matches(sel: string): boolean {
    if (sel.startsWith('.')) return sel.slice(1).split('.').every((c) => this.has(c));
    return this.tag === sel;
  }
  querySelector(sel: string): N | null { return this.all().slice(1).find((n) => n.matches(sel)) ?? null; }
  querySelectorAll(sel: string): N[] { return this.all().slice(1).filter((n) => n.matches(sel)); }
}

/** A phone's storage: a plain map, or one that refuses (private mode, blocked site data). */
function storage(refuse: 'none' | 'read' | 'write' = 'none') {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => { if (refuse === 'read') throw new Error('SecurityError'); return m.has(k) ? m.get(k)! : null; },
    setItem: (k: string, v: string) => { if (refuse === 'write') throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

const HAZEL = '+17575550142';
const OAK = '+17575550143';
const SLIP = { rule: 'no-date-promise', said: 'We can have a crew out Thursday morning.' };
const call = (id: string, from: string, o: Record<string, unknown> = {}) => ({
  callId: id, handledBy: 'sona', from, at: '2026-10-18T21:48:00Z', facts: { name: from === HAZEL ? 'SIM-Hazel, Test' : 'SIM-Oak, Test' },
  slips: [], hold: 'read_only', summary: ['SIM words.'], dialogue: [], ...o,
});
const WHOLE = { registration: { state: 'read_only' }, reading: true, readsRetrying: 0, readRetryMax: 3, holds: 'read_only', quoRecord: { lastAt: 'x', weekReadOkAt: 'x' } };
const quo = (calls: Array<{ slips: unknown[] }>) => ({ status: { ...WHOLE, callsWithSlips: calls.filter((c) => c.slips.length).length }, calls });

type Kit = {
  renderLeadsHead: () => Promise<void>; sonaPanel: (limit: number, withT: boolean) => Promise<N>;
  sonaHandled: () => Record<string, number>; $: (id: string) => N; store: ReturnType<typeof storage>; posts: string[]; reads: string[];
  setQuo: (q: unknown) => void;
};
function kit(q: unknown, refuse: 'none' | 'read' | 'write' = 'none', store = storage(refuse)): Kit {
  const ids = new Map<string, N>();
  const document = {
    createElement: (t: string) => new N(t),
    createTextNode: (t: string) => { const n = new N('#text'); n.textContent = t; return n; },
    getElementById: (id: string) => { if (!ids.has(id)) { const n = new N('div'); n.id = id; ids.set(id, n); } return ids.get(id)!; },
  };
  let quoNow = q;
  const posts: string[] = [];
  const reads: string[] = [];
  const api = async (path: string, opts?: { method?: string }) => {
    if (opts && opts.method && opts.method !== 'GET') { posts.push(path); return {}; }
    reads.push(path);
    if (path === '/api/leads?limit=50') return { leads: [] };
    if (path === '/api/quo') return quoNow;
    throw new Error('unexpected read ' + path);
  };
  const helpers = ['feedKind', 'feedLine', 'plural', 'readingLine', 'badge', 'chip', 'slipRuleLabel', 'sonaSlipBox', 'quoOffLine',
    'leadsTabBadge', 'sonaTabBadge', 'leadsHeadOn', 'leadsFilter', 'renderLeadsHead', 'sonaHandled', 'sonaCalledBack', 'sonaPanel', 'sonaFlagGap', 'sonaNeedsYou'];
  const built = new Function('document', 'api', 'localStorage', `
    const $ = (id) => document.getElementById(id);
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
    let LINKS = 'readonly';
    const LINKS_READY = Promise.resolve('readonly');
    let CUR_TAB = 'calls';
    let LH_GEN = 0;
    let LEADS_FILTER = 'all';
    const fmtTime = (x) => 'T(' + x + ')';
    const switchTab = () => {}; const openSonaCall = () => {};
    ${['FEED_WORD', 'Cap', 'FEED_TAG', 'RETRY', 'TONE', 'VIEW_TITLES', 'LEADS_FILTERS', 'SONA_DONE_KEY', 'SONA_DONE_MS'].map(constSrc).join('\n')}
    ${helpers.map(fnSrc).join('\n')}
    return { renderLeadsHead, sonaPanel, sonaHandled };`)(document, api, store) as Pick<Kit, 'renderLeadsHead' | 'sonaPanel' | 'sonaHandled'>;
  return { ...built, $: (id: string) => document.getElementById(id), store, posts, reads, setQuo: (x: unknown) => { quoNow = x; } };
}
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const head = (k: Kit) => k.$('leads-head');
const flag = (k: Kit) => head(k).children.find((n) => n.has('storm')) ?? null;
const callsH1 = (k: Kit) => head(k).querySelectorAll('h1').find((n) => n.has('lh-calls'))!.textContent;
const dot = (k: Kit) => k.$('tab-leads').querySelector('.dot');
const callBack = (panel: N, callId: string) => panel.all().find((n) => n.dataset.sonaCall === callId)!.querySelector('.callbtn')!;

describe('Call back clears a Sona flag (P17)', () => {
  let now = Date.parse('2026-10-21T14:00:00Z');
  beforeEach(() => { now = Date.parse('2026-10-21T14:00:00Z'); });

  it('a tap on Call back marks every open flagged call from that caller, by call id — the head and the badge drop it, the card stays', async () => {
    // Review round: H3 asks for nothing (no estimate) — a call Mike must book is handled too (its own test below).
    const calls = [call('H1', HAZEL, { slips: [SLIP] }), call('H2', HAZEL, { slips: [SLIP] }), call('H3', HAZEL, { hold: 'not_requested' }), call('O1', OAK, { slips: [SLIP] })];
    const k = kit(quo(calls));
    await k.renderLeadsHead();
    expect(flag(k)!.querySelectorAll('.sliplink')).toHaveLength(3);
    expect(dot(k)!.textContent).toBe('3');
    const panel = await k.sonaPanel(20, true);
    await callBack(panel, 'H1').click();
    await flush();
    // Every flagged call from that caller — H1 and H2, never H3 (it needs nothing), never another caller's O1.
    expect(Object.keys(k.sonaHandled()).sort()).toEqual(['H1', 'H2']);
    expect(flag(k)!.querySelectorAll('.sliplink').map((r) => r.textContent)).toEqual(['SIM-Oak, Test · T(2026-10-18T21:48:00Z) · Promised a day or time']);
    expect(flag(k)!.textContent).toContain('Sona broke your rules on 1 call');
    expect(dot(k)!.textContent).toBe('1');
    expect(callsH1(k)).toBe('1 call needs you');
    // It stays in call history: the red card, its chip, her words — and a muted line that says it was handled.
    const again = await k.sonaPanel(20, true);
    const card = again.all().find((n) => n.dataset.sonaCall === 'H1')!;
    expect(card.has('emergency')).toBe(true);
    expect(card.textContent).toContain('SONA BROKE A RULE');
    expect(card.textContent).toContain('Sona said: “We can have a crew out Thursday morning.”');
    const done = card.all().find((n) => n.textContent.startsWith('Handled — you tapped Call back at '))!;
    expect(done.has('storm-muted')).toBe(true);
  });

  it('the line goes on the card at the tap, before any redraw', async () => {
    const k = kit(quo([call('H1', HAZEL, { slips: [SLIP] })]));
    const panel = await k.sonaPanel(20, true);
    const card = panel.all().find((n) => n.dataset.sonaCall === 'H1')!;
    expect(card.textContent).not.toContain('Handled —');
    await callBack(panel, 'H1').click();
    expect(card.querySelectorAll('.sona-handled')).toHaveLength(1);
    await callBack(panel, 'H1').click(); // a second tap adds no second line
    expect(card.querySelectorAll('.sona-handled')).toHaveLength(1);
  });

  it('a Call back on a different customer clears nothing', async () => {
    // Review round: Oak's call asks for nothing, so nothing is marked; one Oak must have booked is marked — Oak's own, never Hazel's.
    const k = kit(quo([call('H1', HAZEL, { slips: [SLIP] }), call('O9', OAK, { hold: 'not_requested' }), call('O8', OAK)]));
    const panel = await k.sonaPanel(20, true);
    await callBack(panel, 'O9').click();
    await flush();
    expect(Object.keys(k.sonaHandled())).toEqual(['O8']);
    await k.renderLeadsHead();
    expect(flag(k)!.querySelectorAll('.sliplink')).toHaveLength(1);
    expect(dot(k)!.textContent).toBe('1');
  });

  it('Today\'s Sona card does it too (the same card, the same tap); its own flag box drops the call', async () => {
    const k = kit(quo([call('H1', HAZEL, { slips: [SLIP] })]));
    const today = await k.sonaPanel(3, false);
    expect(today.all().filter((n) => n.has('sliplink'))).toHaveLength(1);
    await callBack(today, 'H1').click();
    const after = await k.sonaPanel(3, false);
    expect(after.all().filter((n) => n.has('sliplink'))).toHaveLength(0);
    expect(after.textContent).not.toContain('Sona broke your rules on');
    expect(after.all().find((n) => n.dataset.sonaCall === 'H1')!.textContent).toContain('SONA BROKE A RULE');
  });

  it('Today, at the tap with no redraw: its own flag box drops that caller, and every card from that caller says Handled (browser check)', async () => {
    const k = kit(quo([call('H1', HAZEL, { slips: [SLIP] }), call('H2', HAZEL, { slips: [SLIP] }), call('O1', OAK, { slips: [SLIP] })]));
    const today = await k.sonaPanel(3, false);
    expect(today.all().filter((n) => n.has('sliplink'))).toHaveLength(3);
    const at = today.children.findIndex((n) => n.has('storm'));
    expect(at).toBeGreaterThan(0);
    await callBack(today, 'H1').click();
    // The same panel, not redrawn: the box names Oak's call only, in its place under the title.
    const rows = today.all().filter((n) => n.has('sliplink'));
    expect(rows.map((r) => r.textContent)).toEqual(['SIM-Oak, Test · T(2026-10-18T21:48:00Z) · Promised a day or time']);
    expect(today.textContent).toContain('Sona broke your rules on 1 call');
    expect(today.children.findIndex((n) => n.has('storm'))).toBe(at);
    for (const id of ['H1', 'H2']) expect(today.all().find((n) => n.dataset.sonaCall === id)!.querySelectorAll('.sona-handled'), id).toHaveLength(1);
    expect(today.all().find((n) => n.dataset.sonaCall === 'O1')!.querySelectorAll('.sona-handled')).toHaveLength(0);
    // Its last flag handled, the box leaves; the cards stay red with her words.
    await callBack(today, 'O1').click();
    expect(today.all().filter((n) => n.has('sliplink'))).toHaveLength(0);
    expect(today.textContent).not.toContain('Sona broke your rules on');
    expect(today.all().filter((n) => n.dataset.sonaCall && n.has('emergency'))).toHaveLength(3);
  });

  it('Calls & texts, at the tap: every card from that caller says Handled (the head carries the flag)', async () => {
    const k = kit(quo([call('H1', HAZEL, { slips: [SLIP] }), call('H2', HAZEL, { slips: [SLIP] }), call('O1', OAK, { slips: [SLIP] })]));
    const panel = await k.sonaPanel(20, true);
    await callBack(panel, 'H2').click();
    for (const id of ['H1', 'H2']) expect(panel.all().find((n) => n.dataset.sonaCall === id)!.querySelectorAll('.sona-handled'), id).toHaveLength(1);
    expect(panel.all().find((n) => n.dataset.sonaCall === 'O1')!.querySelectorAll('.sona-handled')).toHaveLength(0);
    expect(panel.all().filter((n) => n.has('sliplink'))).toHaveLength(0);
  });

  it('a new slip (a new call id) raises the flag again', async () => {
    const k = kit(quo([call('H1', HAZEL, { slips: [SLIP] })]));
    await callBack(await k.sonaPanel(20, true), 'H1').click();
    await flush();
    expect(flag(k)).toBeNull();
    expect(dot(k)).toBeNull();
    k.setQuo(quo([call('H4', HAZEL, { slips: [SLIP] }), call('H1', HAZEL, { slips: [SLIP] })]));
    await k.renderLeadsHead();
    expect(flag(k)!.querySelectorAll('.sliplink')).toHaveLength(1);
    expect(dot(k)!.textContent).toBe('1');
  });

  it('a counted slip older than the calls Arbo still holds cannot be handled — it stays a flag ("… only in Quo now")', async () => {
    const q = quo([call('H1', HAZEL, { slips: [SLIP] })]);
    (q.status as Record<string, unknown>).callsWithSlips = 2;
    const k = kit(q);
    await callBack(await k.sonaPanel(20, true), 'H1').click();
    await flush();
    expect(flag(k)!.textContent).toContain('1 older call is only in Quo now.');
    expect(dot(k)!.textContent).toBe('1');
  });

  it('storage that throws keeps the flag (the loud direction) — reading or writing', async () => {
    for (const refuse of ['read', 'write'] as const) {
      const k = kit(quo([call('H1', HAZEL, { slips: [SLIP] })]), refuse);
      await callBack(await k.sonaPanel(20, true), 'H1').click();
      await flush();
      await k.renderLeadsHead();
      expect(flag(k)!.querySelectorAll('.sliplink'), refuse).toHaveLength(1);
      expect(dot(k)!.textContent, refuse).toBe('1');
    }
  });

  it('storage lost (cleared) brings the flag back', async () => {
    const k = kit(quo([call('H1', HAZEL, { slips: [SLIP] })]));
    await callBack(await k.sonaPanel(20, true), 'H1').click();
    await flush();
    expect(flag(k)).toBeNull();
    k.store.m.clear();
    await k.renderLeadsHead();
    expect(flag(k)!.querySelectorAll('.sliplink')).toHaveLength(1);
  });

  it('only call ids and tap times are stored — never a number, never a name', async () => {
    const k = kit(quo([call('H1', HAZEL, { slips: [SLIP] }), call('H2', HAZEL, { slips: [SLIP] })]));
    await callBack(await k.sonaPanel(20, true), 'H1').click();
    const raw = [...k.store.m.values()].join('\n');
    expect(raw).not.toContain('5550142');
    expect(raw).not.toContain('757');
    expect(raw).not.toContain('Hazel');
    const saved = JSON.parse(k.store.m.get([...k.store.m.keys()][0]!)!) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(['H1', 'H2']);
    for (const v of Object.values(saved)) expect(typeof v).toBe('number');
  });

  it('forgotten after 7 days (pruned): an old mark no longer hides a flag, and is dropped on the next write', () => {
    const store = storage();
    const day = 24 * 60 * 60 * 1000;
    store.setItem('arboSonaHandled', JSON.stringify({ OLD: Date.now() - 8 * day, NEW: Date.now() - day, BAD: 'x' }));
    const k = kit(quo([]), 'none', store);
    expect(Object.keys(k.sonaHandled())).toEqual(['NEW']);
    expect(now).toBeGreaterThan(0);
  });

  it('nothing is sent: no POST, no database write, no Quo write — the send snapshot is unchanged', async () => {
    const k = kit(quo([call('H1', HAZEL, { slips: [SLIP] })]));
    await callBack(await k.sonaPanel(20, true), 'H1').click();
    await flush();
    expect(k.posts).toEqual([]);
    expect(k.reads.every((p) => p === '/api/leads?limit=50' || p === '/api/quo')).toBe(true);
    for (const name of ['sonaHandled', 'sonaCalledBack']) {
      const src = fnSrc(name);
      expect(src, name).not.toMatch(/api\(|fetch\(|sendBeacon|XMLHttpRequest|sessionStorage|console\./);
    }
    expect(sends(html).length).toBe(42);
  });
});

describe('review round: Call back handles every call from that customer that asks Mike to act (R33: holds off)', () => {
  it('a call Mike must book himself (read_only) is handled by a Call back on that customer: it leaves "calls need you", keeps its card, gets its Handled line', async () => {
    const k = kit(quo([call('H3', HAZEL), call('O1', OAK)]));
    await k.renderLeadsHead();
    expect(callsH1(k)).toBe('2 calls need you');
    expect(dot(k)).toBeNull(); // the badge counts flags, not bookings
    const panel = await k.sonaPanel(20, true);
    await callBack(panel, 'H3').click();
    await flush();
    expect(Object.keys(k.sonaHandled())).toEqual(['H3']);
    expect(callsH1(k)).toBe('1 call needs you');
    const card = panel.all().find((n) => n.dataset.sonaCall === 'H3')!;
    expect(card.querySelectorAll('.sona-handled')).toHaveLength(1);
    expect(card.textContent).toContain('Calendar holds are off');
    await callBack(panel, 'O1').click();
    await flush();
    expect(callsH1(k)).toBe('No call needs you right now');
  });

  it('a call that needs nothing is never marked, and gets no Handled line', async () => {
    const k = kit(quo([call('H3', HAZEL, { hold: 'hangup' })]));
    const panel = await k.sonaPanel(20, true);
    await callBack(panel, 'H3').click();
    expect(k.sonaHandled()).toEqual({});
    expect(panel.all().find((n) => n.dataset.sonaCall === 'H3')!.querySelectorAll('.sona-handled')).toHaveLength(0);
  });
});
