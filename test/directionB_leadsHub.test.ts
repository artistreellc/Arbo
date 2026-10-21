// Direction B, P16 (docs/DIRECTION_B_PLAN.md; R29 #1: "Calls folds into Leads … a
// red Sona flag stays above the segments, just as loud as today, so it never sinks
// into the second segment; the home-screen shortcut to Calls keeps working").
// The Leads hub's head sits over New leads and Calls & texts alike, outside both
// views (an open transcript on one never holds the other): "Front Desk", a count
// per segment, the red Sona flag ABOVE the segments, the two segments, and New
// leads' filter chips. Every count comes from a read that succeeded — a failed one
// is '–' with its feed word, never a 0 (§1B). The Leads tab's badge is built from
// two reads (the leads, and Quo) and a failed half never reads as zero (the plan's
// P16 matrix). Calls & texts is the old Calls screen in the mockup's order, Sona's
// calls first. Lead rows get the one-line summary (city · what they said), the
// permit badge keeps its own row, and a contact instruction never folds (§5.9).
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';

const html = loadAppHtml();
const css = html.slice(0, html.indexOf('</style>'));
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

// ---------- a stand-in DOM: enough of one for the head, the badge and the views ----------
class N {
  className = ''; type = ''; id = ''; title = ''; hidden = false; disabled = false; href = '';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: N[] = [];
  parent: N | null = null;
  on: Record<string, Array<() => unknown>> = {};
  swaps = 0;
  private own = '';
  constructor(readonly tag: string) {}
  get textContent(): string { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(t: string) { for (const c of this.children) c.parent = null; this.children = []; this.own = t; }
  get childNodes(): N[] { return [...this.children]; }
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
  replaceWith(n: N) { const p = this.parent!; n.parent?.drop(n); p.children[p.children.indexOf(this)] = n; n.parent = p; this.parent = null; }
  replaceChildren(...ns: N[]) { this.swaps++; for (const c of this.children) c.parent = null; this.children = []; this.own = ''; for (const n of ns) this.appendChild(n); }
  hasChildNodes() { return this.children.length > 0 || this.own !== ''; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  addEventListener(t: string, f: () => unknown) { (this.on[t] ??= []).push(f); }
  async click() { for (const f of this.on.click ?? []) await f(); }
  all(): N[] { return [this, ...this.children.flatMap((c) => c.all())]; }
  private matches(sel: string): boolean {
    if (sel.startsWith('.')) return sel.slice(1).split('.').every((c) => this.has(c));
    const a = /^\[data-([a-z-]+)\]$/.exec(sel);
    if (a) return a[1]!.replace(/-([a-z])/g, (_m, x: string) => x.toUpperCase()) in this.dataset;
    return this.tag === sel;
  }
  querySelector(sel: string): N | null { return this.all().slice(1).find((n) => n.matches(sel)) ?? null; }
  querySelectorAll(sel: string): N[] { return this.all().slice(1).filter((n) => n.matches(sel)); }
  text(): string { return this.textContent; }
}
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const fail = (code?: number, message = 'error') => Object.assign(new Error(message), code ? { code } : {});

type Lead = Record<string, unknown>;
const lead = (o: Lead = {}): Lead => ({
  id: 'L1', name: 'SIM-Elm, Test', phone: '+17575550101', city: 'Norfolk', zip: '23503',
  createdAt: '2026-10-18T14:00:00Z', status: 'new', isEmergency: false, needsCallback: false,
  isFirstTimer: true, quality: { priority: 'warm' }, permit: null, screenPending: false,
  permitUnreadable: false, history: null, historyUnreadable: false, details: null, ...o,
});
const FIVE = [
  lead({ id: 'A', isEmergency: true, status: 'emergency', quality: { priority: 'hot' } }),
  lead({ id: 'B', needsCallback: true }),
  lead({ id: 'C', needsCallback: true }),
  lead({ id: 'D' }),
  lead({ id: 'E' }),
];
/** A Sona call as /api/quo lists it. */
const call = (id: string, o: Record<string, unknown> = {}) => ({
  callId: id, handledBy: 'sona', from: '+17575550142', at: '2026-10-18T21:48:00Z', facts: { name: 'SIM-Hazel, Test' },
  slips: [], hold: 'read_only', summary: [], dialogue: [], ...o,
});
const WHOLE = { registration: { state: 'read_only' }, reading: true, readsRetrying: 0, quoRecord: { lastAt: 'x', weekReadOkAt: 'x' } };
const quo = (calls: unknown[], st: Record<string, unknown> = {}) => {
  const listed = (calls as Array<{ slips: unknown[] }>).filter((c) => c.slips.length).length;
  return { status: { ...WHOLE, callsWithSlips: listed, ...st }, calls };
};
const SLIP = { rule: 'no-date-promise', said: 'We can have a crew out Thursday morning.' };

// ---------- the page's head, badge and helpers, built together over one stand-in document ----------
type Kit = {
  renderLeadsHead: () => Promise<void>; leadsHeadOn: (w: string) => void; leadsFilter: (f: string) => void;
  leadsTabBadge: (err: unknown, n?: number) => void; sonaTabBadge: (err: unknown, n?: number) => void;
  $: (id: string) => N; tabs: string[]; opened: string[]; filter: () => string;
};
function kit(routes: { leads?: () => unknown; quo?: () => unknown }, links = 'readonly', cur = 'leads'): Kit {
  const ids = new Map<string, N>();
  const document = {
    createElement: (t: string) => new N(t),
    createTextNode: (t: string) => { const n = new N('#text'); n.textContent = t; return n; },
    getElementById: (id: string) => { if (!ids.has(id)) { const n = new N('div'); n.id = id; ids.set(id, n); } return ids.get(id)!; },
  };
  const tabs: string[] = [];
  const opened: string[] = [];
  const api = async (path: string) => {
    if (path === '/api/leads?limit=50') return (routes.leads ?? (() => ({ leads: FIVE })))();
    if (path === '/api/quo') return (routes.quo ?? (() => quo([])))();
    throw new Error('unexpected read ' + path);
  };
  const helpers = ['feedKind', 'feedLine', 'plural', 'readingLine', 'slipRuleLabel', 'sonaSlipBox', 'quoOffLine',
    'leadsTabBadge', 'sonaTabBadge', 'leadsHeadOn', 'leadsFilter', 'renderLeadsHead'];
  const built = new Function('document', 'api', 'switchTab', 'openSonaCall', 'linksIn', 'curIn', `
    const $ = (id) => document.getElementById(id);
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
    let LINKS = linksIn;
    const LINKS_READY = Promise.resolve(linksIn);
    let CUR_TAB = curIn;
    let LH_GEN = 0;
    let LEADS_FILTER = 'all';
    const fmtTime = (x) => 'T(' + x + ')';
    ${['FEED_WORD', 'Cap', 'FEED_TAG', 'RETRY', 'VIEW_TITLES', 'LEADS_FILTERS'].map(constSrc).join('\n')}
    ${helpers.map(fnSrc).join('\n')}
    return { renderLeadsHead, leadsHeadOn, leadsFilter, leadsTabBadge, sonaTabBadge, filter: () => LEADS_FILTER };`)(
    document, api, (t: string) => tabs.push(t), (id: string) => opened.push(id), links, cur,
  ) as Omit<Kit, '$' | 'tabs' | 'opened'>;
  return { ...built, $: (id: string) => document.getElementById(id), tabs, opened };
}
const head = (k: Kit) => k.$('leads-head');
const h1s = (k: Kit) => head(k).querySelectorAll('h1');
const h1For = (k: Kit, seg: 'leads' | 'calls') => h1s(k).find((n) => n.has(seg === 'leads' ? 'lh-leads' : 'lh-calls'))!;
const segs = (k: Kit) => head(k).querySelectorAll('.lseg-btn');
const seg = (k: Kit, view: string) => segs(k).find((b) => b.dataset.seg === view)!;
const chips = (k: Kit) => head(k).querySelectorAll('.lchip');
const ZERO = /(^|\D)0(\D|$)/;

describe('the Leads hub head: where it sits (P16)', () => {
  it('one element before view-leads, outside both views — so neither view\'s hold ever holds the other', () => {
    expect(html).toMatch(/\n {2}<div id="leads-head" class="hubhead"><\/div>\n {2}<div id="view-leads" class="view"><\/div>\n/);
    const main = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
    expect(main.match(/id="leads-head"/g)).toHaveLength(1);
    // Not inside a view: it opens and closes before the first view-* that follows it.
    expect(main.indexOf('id="leads-head"')).toBeLessThan(main.indexOf('id="view-leads"'));
  });

  it('a class shows it over Leads and Calls & texts, never [hidden] (the .sys lesson); the segment on says which', () => {
    expect(css).toMatch(/\n\.hubhead\{display:none\}\.hubhead\.on\{display:block\}/);
    const k = kit({});
    for (const [w, on, calls] of [['leads', true, false], ['calls', true, true], ['today', false, false], ['estimate', false, false]] as const) {
      k.leadsHeadOn(w);
      expect(head(k).has('on'), w).toBe(on);
      expect(head(k).has('calls'), w).toBe(calls);
      expect(head(k).hidden, w).toBe(false);
    }
    expect(fnSrc('leadsHeadOn')).not.toContain('hidden');
    // switchTab says which screen is on, every switch.
    expect(fnSrc('switchTab')).toContain('leadsHeadOn(which);');
  });
});

describe('the Leads hub head: counts, flag, segments, chips (run)', () => {
  it('New leads: "5 new leads, 1 emergency" — the eyebrow is Front Desk, the counts are the read\'s', async () => {
    const k = kit({});
    await k.renderLeadsHead();
    expect(head(k).querySelector('.eyebrow')!.textContent).toBe('Front Desk');
    expect(h1For(k, 'leads').textContent).toBe('5 new leads, 1 emergency');
    expect(seg(k, 'leads').querySelector('.lcount')!.textContent).toBe('5');
    expect(chips(k).map((c) => [c.dataset.filter, c.querySelector('b')!.textContent])).toEqual([['all', '5'], ['emergency', '1'], ['callback', '2']]);
  });

  it('an older lead is never new work (R32): not counted, and "filed as an emergency" then never lights the badge', async () => {
    const k = kit({ leads: () => ({ leads: [...FIVE, lead({ id: 'OLD', older: true, ageDays: 40, filedAsEmergency: true })] }) });
    await k.renderLeadsHead();
    expect(h1For(k, 'leads').textContent).toBe('5 new leads, 1 emergency');
    expect(k.$('tab-leads').querySelector('.dot')!.textContent).toBe('1');
    // An emergency Mike marked Good has been acted on: it leaves the badge (R29 #6) but stays red on the list.
    const good = kit({ leads: () => ({ leads: [lead({ id: 'A', isEmergency: true, status: 'qualified', quality: { priority: 'hot' } })] }) });
    await good.renderLeadsHead();
    expect(good.$('tab-leads').querySelector('.dot')).toBeNull();
    expect(h1For(good, 'leads').textContent).toBe('1 new lead');
    expect(chips(good).find((c) => c.dataset.filter === 'emergency')!.querySelector('b')!.textContent).toBe('1');
  });

  it('the red Sona flag sits ABOVE the segments, and shows on both segments; each row opens its call', async () => {
    const k = kit({ quo: () => quo([call('Q1', { slips: [SLIP] }), call('Q2')]) });
    await k.renderLeadsHead();
    const kids = head(k).children;
    const flag = kids.findIndex((n) => n.has('storm'));
    const segAt = kids.findIndex((n) => n.has('lseg'));
    expect(flag).toBeGreaterThan(-1);
    expect(flag).toBeLessThan(segAt); // above the segments: it never sinks into the second one
    expect(kids[flag]!.textContent).toContain('Sona broke your rules on 1 call — tap one to see what she said, then call them back.');
    // Not hidden on either segment: the flag carries no segment class.
    expect(kids[flag]!.has('lh-leads') || kids[flag]!.has('lh-calls')).toBe(false);
    const row = kids[flag]!.querySelector('.sliplink')!;
    expect(row.textContent).toBe('SIM-Hazel, Test · T(2026-10-18T21:48:00Z) · Promised a day or time');
    await row.click();
    expect(k.opened).toEqual(['Q1']);
    expect(h1For(k, 'calls').textContent).toBe('1 call needs you');
    expect(seg(k, 'calls').querySelector('.lcount')!.textContent).toBe('1');
    expect(seg(k, 'calls').querySelector('.lcount')!.has('hot')).toBe(true);
  });

  it('segments: New leads / Calls & texts, each tap is switchTab (one Back step); the one on is pressed', async () => {
    const k = kit({}, 'readonly', 'calls');
    await k.renderLeadsHead();
    expect(segs(k).map((b) => b.dataset.seg)).toEqual(['leads', 'calls']);
    expect(segs(k).map((b) => b.textContent.replace(/\d+$/, ''))).toEqual(['New leads', 'Calls & texts']);
    expect(seg(k, 'calls').attrs['aria-pressed']).toBe('true');
    expect(seg(k, 'leads').attrs['aria-pressed']).toBe('false');
    await seg(k, 'leads').click();
    await seg(k, 'calls').click();
    expect(k.tabs).toEqual(['leads', 'calls']);
  });

  it('Calls & texts with nothing red: "No call needs you right now" only when Quo\'s whole week was read', async () => {
    const whole = kit({ quo: () => quo([call('Q2')]) });
    await whole.renderLeadsHead();
    expect(h1For(whole, 'calls').textContent).toBe('No call needs you right now');
    expect(seg(whole, 'calls').querySelector('.lcount')).toBeNull(); // a pill is a count, never a bare 0
    for (const st of [{ reading: false }, { quoRecord: { lastAt: 'x' } }, { quoRecord: { lastAt: 'x', weekReadOkAt: 'x', weekThreadsNotRead: 3 } },
      { quoRecord: { lastAt: 'x', weekReadOkAt: 'x', error: 'quo_down' } }, { readsRetrying: 1 }, { registration: { state: 'failed', detail: 'x' } }]) {
      const part = kit({ quo: () => quo([call('Q2')], st) });
      await part.renderLeadsHead();
      expect(h1For(part, 'calls').textContent, JSON.stringify(st)).toBe('No call Arbo read needs you');
    }
  });

  it('a red call that is an emergency or a hold that failed needs Mike too — "calls need you" counts every red card', async () => {
    const k = kit({ quo: () => quo([call('Q1', { slips: [SLIP] }), call('Q2', { facts: { name: 'SIM-B', emergency: true } }), call('Q3', { hold: 'failed' }), call('Q4')]) });
    await k.renderLeadsHead();
    expect(h1For(k, 'calls').textContent).toBe('3 calls need you');
  });
});

describe('the Leads hub head: a read that died is named, never a 0 (§1B)', () => {
  it.each([
    ['unread', fail(), 'couldn’t read it'],
    ['cut', fail(503, 'link_cut'), 'cut on purpose'],
    ['not set up (readonly, no database)', fail(503, 'db_not_configured'), 'not set up yet'],
  ])('leads %s: the h1 says Leads and the feed word, New leads is – and named, no chips', async (_k, err, word) => {
    const k = kit({ leads: () => { throw err; } });
    await k.renderLeadsHead();
    expect(h1For(k, 'leads').textContent).toBe('Leads · ' + word);
    const s = seg(k, 'leads');
    expect(s.querySelector('.lcount')!.textContent).toBe('–');
    expect(s.textContent).toContain(word);
    expect(s.attrs['aria-label']).toBe('New leads: ' + word + ' — not a zero');
    expect(chips(k)).toEqual([]);
    expect(h1For(k, 'leads').textContent).not.toMatch(ZERO);
    expect(head(k).textContent).not.toMatch(/No new leads/);
  });

  it('Quo unreadable: a named line in the flag\'s place, Calls & texts is – and named, the calls h1 names it', async () => {
    const k = kit({ quo: () => { throw fail(); } });
    await k.renderLeadsHead();
    const kids = head(k).children;
    const line = kids.find((n) => n.has('feed-state'))!;
    expect(line.has('unread')).toBe(true);
    expect(line.textContent).toContain('Sona calls (Quo): couldn’t read it.');
    expect(kids.indexOf(line)).toBeLessThan(kids.findIndex((n) => n.has('lseg'))); // in the flag's place, above the segments
    expect(seg(k, 'calls').querySelector('.lcount')!.textContent).toBe('–');
    expect(seg(k, 'calls').textContent).toContain('couldn’t read it');
    expect(h1For(k, 'calls').textContent).toBe('Calls & texts · couldn’t read it');
    expect(head(k).textContent).not.toContain('No call');
  });

  it.each([['readonly', 'unset', 'Quo isn’t connected to Arbo yet'], ['simulation', 'sim', 'Not in the practice data']])(
    'Quo not set up (%s): the fold words, once, in the flag\'s place', async (links, kind, words) => {
      const k = kit({ quo: () => ({ status: { registration: { state: 'not_configured' }, reading: true, quoRecord: {} }, calls: [] }) }, links);
      await k.renderLeadsHead();
      const lines = head(k).all().filter((n) => n.textContent.startsWith(words) && n.has('feed-state'));
      expect(lines).toHaveLength(1);
      expect(lines[0]!.has(kind)).toBe(true);
      expect(seg(k, 'calls').querySelector('.lcount')!.textContent).toBe('–');
      expect(seg(k, 'calls').textContent).toContain(kind === 'sim' ? 'not in the practice data' : 'not set up yet');
    });

  it('real data with no new leads: "New leads are not in Arbo", no count, no chips — never a 0; practice data: "No new leads"', async () => {
    const real = kit({ leads: () => ({ leads: [lead({ id: 'OLD', older: true, ageDays: 40 })] }) });
    await real.renderLeadsHead();
    expect(h1For(real, 'leads').textContent).toBe('New leads are not in Arbo');
    expect(seg(real, 'leads').querySelector('.lcount')).toBeNull();
    expect(chips(real)).toEqual([]);
    expect(head(real).textContent).not.toMatch(/\b0 new leads?\b/);
    const sim = kit({ leads: () => ({ leads: [] }) }, 'simulation');
    await sim.renderLeadsHead();
    expect(h1For(sim, 'leads').textContent).toBe('No new leads');
  });

  it('a body without its list is a read that failed, never "no leads" or "no calls"', async () => {
    const k = kit({ leads: () => ({}), quo: () => ({ status: { registration: { state: 'ok' } } }) });
    await k.renderLeadsHead();
    expect(seg(k, 'leads').querySelector('.lcount')!.textContent).toBe('–');
    expect(seg(k, 'calls').querySelector('.lcount')!.textContent).toBe('–');
    expect(head(k).textContent).not.toMatch(/No new leads|No call/);
  });

  it('a 401 leaves the head to the key wall: nothing drawn over it', async () => {
    const k = kit({ leads: () => { throw fail(401); } });
    await k.renderLeadsHead();
    expect(head(k).querySelector('.lseg')).toBeNull();
  });
});

describe('the Leads hub head: filter chips (New leads only)', () => {
  it('a chip sets #view-leads[data-filter] (hiding is CSS) and is not a Back step; the filter is kept for the minute redraw', async () => {
    const k = kit({});
    await k.renderLeadsHead();
    await chips(k).find((c) => c.dataset.filter === 'emergency')!.click();
    expect(k.$('view-leads').dataset.filter).toBe('emergency');
    expect(k.filter()).toBe('emergency');
    expect(k.tabs).toEqual([]); // no switchTab: the list stays the same screen
    expect(chips(k).map((c) => c.attrs['aria-pressed'])).toEqual(['false', 'true', 'false']);
    await k.renderLeadsHead(); // the minute redraw
    expect(chips(k).map((c) => c.attrs['aria-pressed'])).toEqual(['false', 'true', 'false']);
    expect(k.$('view-leads').dataset.filter).toBe('emergency');
  });

  it('openLead resets the filter to All before it scrolls (a lead Today sends Mike to is never hidden)', () => {
    const o = fnSrc('openLead');
    expect(o).toContain("leadsFilter('all');");
    expect(o.indexOf("leadsFilter('all');")).toBeLessThan(o.indexOf('scrollIntoView'));
  });

  it('CSS: an EMERGENCY card shows under every filter; the chips and their empty lines are New leads\' only', () => {
    expect(css).toContain('#view-leads[data-filter="emergency"] .card.lead:not(.emergency),#view-leads[data-filter="callback"] .card.lead:not(.callback):not(.emergency)');
    // No rule anywhere hides a .card.emergency.
    expect(css).not.toMatch(/\.emergency[^{,]*\{[^}]*display:none/);
    expect(css).toMatch(/\.hubhead\.calls \.lchips/);
  });

  it('a filter with nothing to show says so (from a read that landed), never a blank list', async () => {
    const k = kit({ leads: () => ({ leads: [lead({ id: 'D' }), lead({ id: 'E' })] }) });
    await k.renderLeadsHead();
    const none = head(k).querySelectorAll('.filter-none');
    expect(none.map((n) => n.dataset.for)).toEqual(['emergency', 'callback']);
    expect(none.every((n) => /All shows every lead\.$/.test(n.textContent))).toBe(true);
    const some = kit({});
    await some.renderLeadsHead();
    expect(head(some).querySelectorAll('.filter-none')).toEqual([]);
  });
});

describe('the Leads hub head: refresh', () => {
  it('a redraw keeps the old head up until both reads land, then swaps once; the newest draw owns it', async () => {
    let release!: () => void;
    let slow = false;
    const k = kit({ quo: () => (slow ? new Promise((r) => { release = () => r(quo([])); }) : quo([])) });
    await k.renderLeadsHead();
    const old = head(k).children[0]!;
    const swaps = head(k).swaps;
    slow = true;
    const p = k.renderLeadsHead();
    await flush();
    expect(head(k).children[0]).toBe(old); // still up while Quo reads
    expect(head(k).swaps).toBe(swaps);
    release();
    await p;
    expect(head(k).swaps).toBe(swaps + 1);
  });

  it('autoRefresh redraws the head every minute, even while both Leads views hold', () => {
    const ran: string[] = [];
    const tick = new Function('document', '$', 'TIMED', 'holdsTyping', 'renderLeadsHead', `let TIMER_REDRAW = false;\n${fnSrc('autoRefresh')}\nreturn autoRefresh;`)(
      { hidden: false }, (id: string) => ({ id, classList: { contains: () => false } }),
      { leads: () => ran.push('leads'), calls: () => ran.push('calls') }, () => true, () => ran.push('head'),
    ) as () => void;
    tick();
    expect(ran).toEqual(['head']);
  });

  it('an open transcript on Calls & texts holds only Calls & texts: New leads and the head still redraw (the reverse too)', () => {
    const run = (held: string) => {
      const ran: string[] = [];
      new Function('document', '$', 'TIMED', 'holdsTyping', 'renderLeadsHead', `let TIMER_REDRAW = false;\n${fnSrc('autoRefresh')}\nreturn autoRefresh;`)(
        { hidden: false }, (id: string) => ({ id, classList: { contains: () => false } }),
        { leads: () => ran.push('leads'), calls: () => ran.push('calls') }, (v: { id: string }) => v.id === 'view-' + held, () => ran.push('head'),
      )();
      return ran;
    };
    expect(run('calls')).toEqual(['leads', 'head']);
    expect(run('leads')).toEqual(['calls', 'head']);
  });

  it('↻ and start-up draw it too (refreshAll)', () => {
    expect(fnSrc('refreshAll')).toContain('renderLeadsHead();');
  });
});

describe('the Leads tab badge: built from two reads, a failed half never reads as zero (the plan\'s P16 matrix)', () => {
  const dot = (k: Kit) => k.$('tab-leads').querySelector('.dot');
  const label = (k: Kit) => k.$('tab-leads').attrs['aria-label'];

  it('leads ok n, Quo ok m: a red count n+m', () => {
    const k = kit({});
    k.leadsTabBadge(null, 2);
    k.sonaTabBadge(null, 1);
    expect(dot(k)!.className).toBe('dot');
    expect(dot(k)!.textContent).toBe('3');
    expect(label(k)).toBe('Leads: 2 emergency leads. 1 Sona flag not handled');
  });

  it('leads failed, Quo ok m: m plus the gap marker; the label says "Emergency leads unknown — not zero."', () => {
    const k = kit({});
    k.leadsTabBadge(fail());
    k.sonaTabBadge(null, 2);
    expect(dot(k)!.textContent).toBe('2');
    expect(dot(k)!.className).toBe('dot part p-unread');
    expect(label(k)).toContain('Emergency leads unknown — not zero.');
    expect(label(k)).toContain('2 Sona flags not handled');
  });

  it('leads ok n, Quo failed: n plus the gap marker; the label says "Sona calls unknown — not zero"', () => {
    const k = kit({});
    k.leadsTabBadge(null, 1);
    k.sonaTabBadge(fail());
    expect(dot(k)!.textContent).toBe('1');
    expect(dot(k)!.className).toBe('dot part p-unread');
    expect(label(k)).toContain('1 emergency lead');
    expect(label(k)).toContain('Sona calls unknown — not zero');
  });

  it('a failed half with nothing counted on the other: the plain gap dot, no digit', () => {
    const k = kit({});
    k.leadsTabBadge(null, 0);
    k.sonaTabBadge(fail());
    expect(dot(k)!.className).toBe('dot gap unread');
    expect(dot(k)!.textContent).toBe('');
  });

  it('ok 0 and ok 0: no dot and no label', () => {
    const k = kit({});
    k.leadsTabBadge(null, 3);
    k.sonaTabBadge(null, 1);
    k.leadsTabBadge(null, 0);
    k.sonaTabBadge(null, 0);
    expect(dot(k)).toBeNull();
    expect(label(k)).toBeUndefined();
  });

  it('any leads read, Quo not set up: an unset gap (counts still shown)', () => {
    const k = kit({});
    k.leadsTabBadge(null, 0);
    k.sonaTabBadge(fail(503, 'quo_not_configured'));
    expect(dot(k)!.className).toBe('dot gap unset');
    k.leadsTabBadge(null, 2);
    expect(dot(k)!.className).toBe('dot part p-unset');
    expect(dot(k)!.textContent).toBe('2');
    k.leadsTabBadge(fail(503, 'link_cut'));
    expect(dot(k)!.className).toBe('dot gap unset'); // the louder of the two gaps
  });

  it('the head feeds both halves from its own two reads (the badge is current on every screen, every minute)', async () => {
    const k = kit({ quo: () => quo([call('Q1', { slips: [SLIP] })]) });
    await k.renderLeadsHead();
    expect(dot(k)!.textContent).toBe('2'); // 1 emergency lead + 1 Sona flag
    const off = kit({ quo: () => ({ status: { registration: { state: 'not_configured' }, reading: true, quoRecord: {} }, calls: [] }) });
    await off.renderLeadsHead();
    expect(dot(off)!.className).toBe('dot part p-unset');
  });

  it('CSS: the gap marker rides the count in the feed-state colours', () => {
    expect(css).toMatch(/nav button \.dot\.part::after\{content:'';/);
    expect(css).toMatch(/nav button \.dot\.p-cut::after,nav button \.dot\.p-sim::after\{background:var\(--ink-4\)\}/);
    expect(css).toMatch(/nav button \.dot\.p-unread::after\{background:var\(--card\);box-shadow:inset 0 0 0 2px var\(--warning\)\}/);
  });
});

describe('Sona\'s flags ride the Leads badge — never Today\'s emergencies tile (the plan)', () => {
  it('Today\'s emergencies tile counts emergency stops and emergency leads only', () => {
    const today = fnSrc('renderToday');
    const set = today.slice(today.indexOf('const setEmergencies = '), today.indexOf('emergencyLeads().then('));
    expect(set).not.toMatch(/slip|sona/i);
  });
});

describe('Calls & texts: the old Calls screen, Sona first (P16)', () => {
  const calls = fnSrc('renderCalls');

  it('the mockup\'s order: Sona\'s calls, the feeds card, then the study, outreach, texts, notes and Arbo\'s own line', () => {
    const at = ['const sonaCallsSlot', 'const feedsAt', 'const studyFull', 'const outreachFull', 'const txSlot', 'const cnSlot', 'const ownSlot'].map((x) => calls.indexOf(x));
    expect(at.every((x) => x > -1)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(calls).toContain("const feeds = feedsCard('calls');");
    expect(calls).toContain('fills.push(fillQuoSlots([sonaPanel(20, true), studyPanel(60), outreachPanel(true)], [sonaCallsSlot, studyFull, outreachFull], feeds.place));');
  });

  it('sonaPanel on Calls & texts leaves the red flag to the head above; Today keeps its own box (one builder, sonaSlipBox)', async () => {
    const make = (withTranscripts: boolean) => {
      const ids = new Map<string, N>();
      const document = { createElement: (t: string) => new N(t), createTextNode: (t: string) => { const n = new N('#text'); n.textContent = t; return n; }, getElementById: (id: string) => ids.get(id) ?? null };
      return new Function('document', 'api', 'openSonaCall', `
        const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
        const fmtTime = (x) => 'T(' + x + ')';
        ${['FEED_WORD', 'Cap', 'RETRY', 'TONE'].map(constSrc).join('\n')}
        ${['plural', 'badge', 'chip', 'slipRuleLabel', 'feedKind', 'feedLine', 'sonaSlipBox', 'sonaPanel'].map(fnSrc).join('\n')}
        return sonaPanel(withT ? 20 : 3, withT);`.replace(/withT/g, String(withTranscripts)))(
        document, async () => quo([call('Q1', { slips: [SLIP] })]), () => {},
      ) as Promise<N>;
    };
    const onCalls = await make(true);
    expect(onCalls.all().some((n) => n.has('sliplink'))).toBe(false);
    expect(onCalls.textContent).not.toContain('Sona broke your rules on');
    expect(onCalls.textContent).toContain('SONA BROKE A RULE'); // the card itself stays red, with her words
    const onToday = await make(false);
    expect(onToday.all().filter((n) => n.has('sliplink'))).toHaveLength(1);
    expect(fnSrc('sonaPanel')).toContain('sonaSlipBox(d)');
  });

  it('openSonaCall\'s target view holds the [data-sona-call] cards (sonaPanel(20, true) fills a slot of view-calls)', () => {
    expect(fnSrc('openSonaCall')).toContain("switchTab('calls');");
    expect(fnSrc('openSonaCall')).toContain("document.querySelectorAll('#view-calls [data-sona-call]')");
    expect(calls).toContain("const v = $('view-calls');");
    expect(calls.indexOf('sonaPanel(20, true)')).toBeGreaterThan(-1);
  });

  it('the cut lines go through the feeds card: Arbo\'s own line (R21/R36), its transcripts and the call log', () => {
    for (const n of ['Arbo line texts', 'Call transcripts', 'Call log']) expect(calls, n).toContain(`'${n}'`);
    expect(calls).toContain('feeds.place(');
    // The R33 Quo texts line is a partial read — it never folds (it stays in the Texts card).
    expect(calls).toContain("txSlot.appendChild(el('div', 'feed-state cut',\n        'Quo line: texts webhook missing");
  });
});

describe('lead rows: the one-line summary (P16 — where the 2× density is addressed)', () => {
  const leads = fnSrc('renderLeads');

  it('the summary rides the top row under the name: where (city · ZIP) and what they said, one line', () => {
    expect(leads).toContain("const sum = el('div', 'lsum');");
    expect(css).toMatch(/\.card \.lsum \.clamp\{[^}]*-webkit-line-clamp:1/);
    // The city is never cut short (P8 review): the summary's words give way (and drop under the city when the
    // two cannot share a line), the city does not — no nowrap, no ellipsis, no hidden overflow on it.
    const city = /\.card \.lsum \.addr\{([^}]*)\}/.exec(css)![1]!;
    expect(city).not.toMatch(/nowrap|ellipsis|overflow:hidden/);
    expect(css).toMatch(/\.card \.lsum \.clamp\{flex:1 1 80px;min-width:0;/);
  });

  it('a contact instruction never folds into the summary: it keeps a line of its own, whole (§5.9)', () => {
    expect(leads).toContain("const sayInSum = !!said && said.classList.contains('clamp');");
    expect(leads).toContain('if (said && !sayInSum) c.appendChild(said);');
  });

  it('the permit badge keeps its own row — never moved onto the chip line', () => {
    expect(leads).toContain("if (pb) { const pr = el('div', 'badges'); pr.style.marginTop = '6px'; pr.appendChild(pb); c.appendChild(pr); }");
    expect(leads.indexOf('c.appendChild(b);')).toBeLessThan(leads.indexOf('const pb = permitBadge(lead);'));
  });

  it('Good lead, Spam and Prep estimate › share one row at 390 (the prep button no longer takes a line of its own)', () => {
    const m = /\.minibtn\.prep-lead\{([^}]*)\}/.exec(css)!;
    expect(m[1]).not.toContain('flex:1 1 100%');
    expect(m[1]).toMatch(/min-height:44px/);
  });

  it('a lead card is a .card.lead (what the filters hide by), and the older heading is marked for the filters', () => {
    expect(leads).toContain("el('div', 'card lead' + (lead.isEmergency ? ' emergency' : '') + (lead.needsCallback ? ' callback' : ''))");
    expect(leads).toContain("el('div', 'panel-title older-head', 'Older leads — more than 14 days old')");
  });

  it('a past-work or permit read cut on purpose is one line in New leads\' feeds card, not one per lead; one that failed stays on its lead', () => {
    expect(leads).toContain("feedsCard('leads')");
    expect(leads).toContain("else if (lead.historyUnreadable && !lead.historyCut) c.appendChild(feedLine(null, 'Past work'));");
    expect(leads).toContain("if (lead.permitUnreadable && !lead.permitCut) c.appendChild(feedLine(null, 'Permit screen'));");
  });
});
