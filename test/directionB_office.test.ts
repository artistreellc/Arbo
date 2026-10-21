// Direction B, P14 (docs/DIRECTION_B_PLAN.md; R29 #1, spec "The hubs": "Office
// (replaces More and Queue): agent proposals at the top, each jumping to its
// panel; counted desk tiles for Follow-ups, Money, Fleet, Crew & safety, each
// with its R26 desk name above the title; then the rest"). The view id stays
// 'more'; its title and content become Office. Each desk tile counts from the
// same read its screen makes; a read that failed is a dashed tile with the feed
// word and no digit, and opens nothing (§1B). The head counts the desks that
// need Mike and never reads calm over a desk Arbo did not read.
// vitest has no DOM: renderMore and the Office helpers are lifted out of the
// page with the page's own helpers, over one stand-in document.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';

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
const constVal = <T,>(name: string): T => new Function(`${constSrc(name)}\nreturn ${name};`)() as T;

// ---------- a stand-in DOM ----------
class FNode {
  className = ''; id = ''; type = ''; title = ''; hidden = false; disabled = false;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FNode[] = [];
  parent: FNode | null = null;
  on: Record<string, Array<() => unknown>> = {};
  private own = '';
  constructor(readonly tag: string) {}
  get textContent(): string { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(t: string) { for (const c of this.children) c.parent = null; this.children = []; this.own = t; }
  private names(): string[] { return this.className.split(/\s+/).filter(Boolean); }
  get classList() {
    return {
      add: (c: string) => { if (!this.names().includes(c)) this.className = [...this.names(), c].join(' '); },
      remove: (c: string) => { this.className = this.names().filter((x) => x !== c).join(' '); },
      contains: (c: string) => this.names().includes(c),
      toggle: (c: string, f?: boolean) => { const on = f ?? !this.names().includes(c); if (on) this.classList.add(c); else this.classList.remove(c); },
    };
  }
  has(c: string): boolean { return this.names().includes(c); }
  appendChild(c: FNode): FNode { c.parent?.drop(c); c.parent = this; this.children.push(c); return c; }
  drop(c: FNode): void { this.children = this.children.filter((x) => x !== c); c.parent = null; }
  remove(): void { this.parent?.drop(this); }
  replaceWith(...ns: FNode[]): void {
    const p = this.parent!;
    const at = p.children.indexOf(this);
    for (const n of ns) { n.parent?.drop(n); n.parent = p; }
    p.children.splice(p.children.indexOf(this) === -1 ? at : p.children.indexOf(this), 1, ...ns);
    this.parent = null;
  }
  replaceChildren(...ns: FNode[]): void { for (const c of this.children) c.parent = null; this.children = []; this.own = ''; for (const n of ns) this.appendChild(n); }
  hasChildNodes(): boolean { return this.children.length > 0 || this.own !== ''; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  removeAttribute(k: string): void { delete this.attrs[k]; }
  getAttribute(k: string): string | null { return this.attrs[k] ?? null; }
  addEventListener(ev: string, f: () => unknown): void { (this.on[ev] ??= []).push(f); }
  async click(): Promise<void> { for (const f of this.on.click ?? []) await f(); }
  get isConnected(): boolean { return true; }
  compareDocumentPosition(o: FNode): number { const top = (n: FNode): FNode => (n.parent ? top(n.parent) : n); const all = top(this).all(); return all.indexOf(o) > all.indexOf(this) ? 4 : 2; }
  all(): FNode[] { return [this, ...this.children.flatMap((c) => c.all())]; }
  private match(sel: string): (n: FNode) => boolean {
    const cls = /^(?::scope > )?\.([\w-]+)$/.exec(sel);
    if (cls) return (n) => n.names().includes(cls[1]!);
    if (/^[a-z0-9]+$/.test(sel)) return (n) => n.tag === sel;
    throw new Error('stand-in DOM does not do ' + sel);
  }
  querySelectorAll(sel: string): FNode[] { const f = this.match(sel); return (sel.startsWith(':scope > ') ? this.children : this.all().slice(1)).filter(f); }
  querySelector(sel: string): FNode | null { return this.querySelectorAll(sel)[0] ?? null; }
}
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const fail = (code: number, message: string) => Object.assign(new Error(message), { code });
const cut = () => fail(503, 'link_cut');

// ---------- every read the Office makes, as the server answers it ----------
type Answer = unknown | Error | (() => Promise<unknown>);
const FULL: Record<string, Answer> = {
  '/api/queue': { open: [{}, {}, {}] },
  '/api/followups': { due: [{}, {}], suppressed: [] },
  '/api/money': { collections: [{}], suppressed: [{}], unknown: [{}], drafts: [{}, {}, {}], blocked: [] },
  '/api/fleet/units': { units: [{ status: 'up' }, { status: 'up' }, { status: 'held' }, { status: 'down' }], down: 1, held: 1 },
  '/api/safety': { aerialBlocked: ['c1'], blindSpots: [], certProblems: [
    { crewMemberId: 'c1', daysUntil: -3, state: 'lapsed' }, { crewMemberId: 'c2', daysUntil: 12, state: 'urgent' }, { crewMemberId: 'c3', daysUntil: 25, state: 'upcoming' }] },
  '/api/performance': { areas: [{ verdict: 'above' }, { verdict: 'not_enough_data' }], withheld: [], campaigns: [], campaignsKnown: true },
  '/api/sim/state': { report: null, lessons: { lessons: [{ status: 'proposed', rule: 'r1' }, { status: 'proposed', rule: 'unhandled:x' }, { status: 'approved', rule: 'r2' }] } },
  '/api/assistant/approvals': { approvals: [] },
  '/api/reception/status': { linkCut: true },
};
const ZERO: Record<string, Answer> = {
  ...FULL,
  '/api/queue': { open: [] },
  '/api/followups': { due: [], suppressed: [] },
  '/api/money': { collections: [], suppressed: [], unknown: [], drafts: [], blocked: [] },
  '/api/fleet/units': { units: [{ status: 'up' }], down: 0, held: 0 },
  '/api/safety': { aerialBlocked: [], blindSpots: [], certProblems: [] },
};

const CONSTS = ['$', 'el', 'FEED_WORD', 'Cap', 'FEED_TAG', 'FEED_SAYS', 'RETRY', 'TONE', 'FEEDS_SAID', 'FEEDS_OPEN', 'FEEDS_BOX', 'FEEDS_GEN',
  'VIEW_TITLES', 'DESK_LINE', 'OFFICE_DESKS', 'PROPOSAL_GO', 'noRefs'];
const HELPERS = ['readingLine', 'plural', 'fmtWhen', 'chip', 'badge', 'feedKind', 'feedsCard', 'agentProposals', 'proposalRow', 'moneyCounts', 'lessonsWaiting',
  'runAllEight', 'officeRunAge', 'officeDesk', 'officeProposals', 'officeHub', 'renderMore', 'dollars'];

/** renderMore with the page's own helpers, over one stand-in document, with one answer per path. */
function kit(answers: Record<string, Answer>, opts: { links?: string; run?: unknown; extra?: string[] } = {}) {
  const ids = new Map<string, FNode>();
  const document = {
    createElement: (t: string) => new FNode(t),
    createTextNode: (t: string) => { const n = new FNode('#text'); n.textContent = t; return n; },
    getElementById: (id: string) => { if (!ids.has(id)) { const n = new FNode('div'); n.id = id; ids.set(id, n); } return ids.get(id)!; },
  };
  const went: string[] = [];
  const asked: Array<{ path: string; method: string }> = [];
  const api = async (path: string, o?: { method?: string }) => {
    asked.push({ path, method: (o && o.method) || 'GET' });
    if (!(path in answers)) throw new Error('unexpected read ' + path);
    const a = answers[path];
    if (a instanceof Error) throw a;
    if (typeof a === 'function') return (a as () => Promise<unknown>)();
    return JSON.parse(JSON.stringify(a));
  };
  const built = new Function('document', 'api', 'switchTab', 'icon', 'linksIn', 'runIn', 'stubs', `
    let LINKS = linksIn;
    const LINKS_READY = Promise.resolve(linksIn);
    let AGENT_RUN = runIn;
    const { renderAssistant, renderAgents, renderLearn, renderMeasure, renderPermits, themePref, setTheme, installCard, location, window, NAV_DRAW } = stubs;
    ${CONSTS.map(constSrc).join('\n')}
    ${HELPERS.concat(opts.extra ?? []).map(fnSrc).join('\n')}
    return { renderMore, moneyCounts, getRun: () => AGENT_RUN, setRun: (r) => { AGENT_RUN = r; }, call: (n, ...a) => eval(n)(...a) };`)(
    document, api, (t: string) => went.push(t), (id: string) => { const s = new FNode('svg'); s.className = 'ico'; s.dataset.icon = id; return s; },
    opts.links ?? 'readonly', opts.run ?? null,
    {
      renderAssistant: () => went.push('draw:assistant'), renderAgents: () => went.push('draw:agents'), renderLearn: () => went.push('draw:learn'),
      renderMeasure: () => {}, renderPermits: () => {}, themePref: () => 'auto', setTheme: () => {}, installCard: () => new FNode('div'),
      location: {}, window: { open: () => {} }, NAV_DRAW: { learn: () => went.push('draw:learn') },
    },
  ) as { renderMore: () => void; moneyCounts: (m: unknown) => Record<string, number>; getRun: () => unknown; setRun: (r: unknown) => void;
    call: (name: string, ...args: unknown[]) => unknown };
  const v = () => document.getElementById('view-more');
  const tiles = () => v().querySelectorAll('.otile');
  const tile = (desk: string) => tiles().find((t) => t.dataset.desk === desk)!;
  const h1 = () => v().querySelector('h1')!;
  return { ...built, v, tiles, tile, h1, went, asked };
}

describe('Office replaces More (P14): the title, the desk lines, one table of desks', () => {
  it('the view id stays "more"; its title is Office, and Learn is named Teach Arbo', () => {
    const titles = constVal<Record<string, string>>('VIEW_TITLES');
    expect(titles.more).toBe('Office');
    expect(titles.learn).toBe('Teach Arbo');
    expect(html).toContain('<div id="view-more" class="view"></div>');
  });

  it('OFFICE_DESKS: the four desks the Queue held, then Numbers and Teach Arbo — each a screen, its line in DESK_LINE (R27 can find it)', () => {
    const desks = constVal<Array<{ view: string; icon: string; need?: boolean }>>('OFFICE_DESKS');
    expect(desks.map((d) => d.view)).toEqual(['followups', 'money', 'fleet', 'safety', 'perf', 'learn']);
    expect(desks.filter((d) => d.need).map((d) => d.view)).toEqual(['followups', 'money', 'fleet', 'safety']);
    const lines = constVal<Record<string, string>>('DESK_LINE');
    expect(desks.map((d) => lines[d.view])).toEqual(['Chief of Staff', 'Yard Boss', 'Yard Boss', 'Crew Chief', 'Analyst', 'Learn']);
    const titles = constVal<Record<string, string>>('VIEW_TITLES');
    for (const d of desks) expect(titles, d.view).toHaveProperty(d.view);
  });
});

describe('Office: the head, then the proposals, then the desks (P14)', () => {
  it('the head is drawn before any read lands; every desk tile says "Reading…" until its own read does', async () => {
    const pending = Object.fromEntries(Object.keys(FULL).map((p) => [p, () => new Promise(() => {})]));
    const k = kit(pending);
    k.renderMore();
    const head = k.v().children[0]!;
    expect(head.has('viewhead')).toBe(true);
    expect(head.children[0]!.textContent).toBe('The back office');
    expect(k.h1().textContent).toBe('Office');
    expect(k.v().children[1]!.has('proposals')).toBe(true);
    expect(k.tiles()).toHaveLength(6);
    for (const t of k.tiles()) {
      expect(t.textContent, t.dataset.desk).toContain('Reading…');
      expect(t.getAttribute('aria-disabled'), t.dataset.desk).toBe('true');
    }
    // the desk line sits above the title on every tile
    expect(k.tile('money').querySelector('.odesk')!.textContent).toBe('Yard Boss');
    expect(k.tile('money').querySelector('.otitle')!.textContent).toBe('Money');
    expect(k.tile('learn').querySelector('.otitle')!.textContent).toBe('Teach Arbo');
  });

  it('the counts: each desk counts from the same read its screen makes', async () => {
    const k = kit(FULL);
    k.renderMore();
    await flush();
    const said = (d: string) => k.tile(d).textContent.replace(/\u00a0/g, ' ');
    expect(said('followups')).toContain('3 open loops');
    expect(said('followups')).toContain('2 recommended sends — to text from the Quo app');
    expect(said('money')).toContain('2 overdue');
    expect(said('money')).toContain('3 to bill · 1 can’t tell');
    expect(said('fleet')).toContain('2 held or down');
    expect(said('fleet')).toContain('2 units up');
    expect(said('safety')).toContain('1 no aerial');
    expect(said('safety')).toContain('2 certs due in 30 days · 1 more needs a look');
    expect(said('perf')).toContain('1 area rated');
    expect(said('perf')).toContain('Ads: not set up yet');
    expect(said('learn')).toContain('1 to approve');
    for (const t of k.tiles()) expect(t.textContent, t.dataset.desk).not.toContain('Reading…');
    // A wrapped line never ends on "·" or a bare count: each count is glued to its words, each dot to the part after it.
    expect(k.tile('money').querySelector('small')!.textContent).toBe('3 to bill · 1 can’t tell');
    // Red where something stops the day, amber where it waits; Numbers and Teach Arbo carry no alarm colour.
    expect(k.tile('money').has('hot')).toBe(true);
    expect(k.tile('fleet').has('hot')).toBe(true);
    expect(k.tile('safety').has('hot')).toBe(true);
    expect(k.tile('followups').has('warn')).toBe(true);
    for (const d of ['perf', 'learn']) expect(['hot', 'warn'].some((c) => k.tile(d).has(c)), d).toBe(false);
    expect(k.h1().textContent).toBe('4 desks need you');
  });

  it('a desk read cut on purpose: a dashed tile, the feed word, no digit, and it opens nothing; the head says one is off', async () => {
    const k = kit({ ...FULL, '/api/money': cut() });
    k.renderMore();
    await flush();
    const money = k.tile('money');
    expect(money.has('gap')).toBe(true);
    expect(money.textContent).toContain('Cut on purpose');
    expect(money.querySelector('.ocount')!.textContent).toBe('–');
    expect(money.textContent).not.toMatch(/\d/);
    expect(money.getAttribute('aria-disabled')).toBe('true');
    await money.click();
    expect(k.went).toEqual([]);
    expect(k.h1().textContent).toBe('3 desks need you · 1 off');
  });

  it('a desk Arbo couldn’t read is named in the head, and the head never reads calm over it', async () => {
    const k = kit({ ...ZERO, '/api/fleet/units': new TypeError('Failed to fetch') });
    k.renderMore();
    await flush();
    expect(k.tile('fleet').textContent).toContain('Couldn’t read it');
    expect(k.h1().textContent).toBe('No desk Arbo read needs you · 1 couldn’t be read');
    expect(k.h1().textContent).not.toContain('right now');
  });

  it('only when all four desks read and none needs Mike: "No desk needs you right now"', async () => {
    const k = kit(ZERO);
    k.renderMore();
    await flush();
    expect(k.h1().textContent).toBe('No desk needs you right now');
    const none = kit(Object.fromEntries(Object.keys(FULL).map((p) => [p, p.startsWith('/api/assistant') || p.startsWith('/api/reception') ? FULL[p] : cut()])));
    none.renderMore();
    await flush();
    expect(none.h1().textContent).toBe('No desk could be read · 6 off');
  });

  it('recommended sends waiting make Follow-ups amber; sends Arbo couldn’t read keep the head from reading calm', async () => {
    const sends = kit({ ...ZERO, '/api/followups': { due: [{}, {}] } });
    sends.renderMore();
    await flush();
    expect(sends.tile('followups').has('warn')).toBe(true);
    expect(sends.h1().textContent).toBe('1 desk needs you');
    const lost = kit({ ...ZERO, '/api/followups': fail(503, 'link_cut') });
    lost.renderMore();
    await flush();
    expect(lost.tile('followups').textContent).toContain('Recommended sends: cut on purpose');
    expect(lost.h1().textContent).toBe('No desk Arbo read needs you');
  });

  it('a body without the list it should carry is a read that failed, never a zero', async () => {
    const k = kit({ ...ZERO, '/api/safety': { aerialBlocked: [] } });
    k.renderMore();
    await flush();
    expect(k.tile('safety').has('gap')).toBe(true);
    expect(k.tile('safety').textContent).not.toMatch(/\b0\b/);
  });

  it('a second read that failed is named under the count, never a 0 (Follow-ups’ recommended sends)', async () => {
    const k = kit({ ...FULL, '/api/followups': new TypeError('Failed to fetch') });
    k.renderMore();
    await flush();
    const t = k.tile('followups').textContent.replace(/\u00a0/g, ' ');
    expect(t).toContain('3 open loops');
    expect(t).toContain('Recommended sends: couldn’t read it');
    expect(t).not.toMatch(/\b0 recommended/);
  });

  it('every desk tile opens its own screen — only once its read has landed', async () => {
    const pending = kit({ ...FULL, '/api/queue': () => new Promise(() => {}) });
    pending.renderMore();
    await flush();
    await pending.tile('followups').click();
    expect(pending.went).toEqual([]);
    const k = kit(FULL);
    k.renderMore();
    await flush();
    for (const d of ['followups', 'money', 'fleet', 'safety', 'perf', 'learn']) await k.tile(d).click();
    // Teach Arbo is off the minute timer, so its tap draws it fresh, as its old More tile did.
    expect(k.went).toEqual(['followups', 'money', 'fleet', 'safety', 'perf', 'learn', 'draw:learn']);
  });

  it('the feeds card counts each desk Arbo couldn’t read and the ads it has no feed for — named, left in place', async () => {
    const k = kit({ ...FULL, '/api/money': cut(), '/api/performance': new TypeError('Failed to fetch') });
    k.renderMore();
    await flush();
    const card = k.v().querySelector('.feeds')!;
    expect(card.textContent).toContain('2 feeds off: 1 cut on purpose, 1 couldn’t read');
    expect(card.textContent).toContain('Money — cut on purpose');
    expect(card.textContent).toContain('Numbers — couldn’t read it');
    expect(k.tile('money').has('gap')).toBe(true); // still in its place
    const ok = kit(FULL);
    ok.renderMore();
    await flush();
    const card2 = ok.v().querySelector('.feeds')!;
    expect(card2.textContent).toContain('1 feed off: 1 not set up');
    expect(card2.textContent).toContain('Ads — not set up yet');
  });

  it('the rest of Arbo: the Assistant leads it; the desks moved up are not repeated there', async () => {
    const k = kit(FULL);
    k.renderMore();
    await flush();
    const grid = k.v().querySelector('.grid-tiles')!;
    const titles = grid.children.map((t) => t.querySelector('b')!.textContent);
    expect(titles[0]).toBe('Assistant');
    expect(titles).toContain('Agents');
    expect(titles).toContain('Crew');
    expect(titles).toContain('Phone line');
    for (const gone of ['Follow-ups', 'Money', 'Fleet', 'Crew & safety', 'Numbers', 'Learn']) expect(titles, gone).not.toContain(gone);
    // Appearance and Install stay on Office (the plan's Q4 default); Settings keeps its one door, the gear.
    expect(k.v().textContent).toContain('Appearance');
    expect(k.v().textContent).toContain('Install');
    expect(k.v().textContent).toContain('Settings open from the gear at the top.');
  });
});

describe('Office: the agents’ proposals at the top (P14, from P6’s list)', () => {
  const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
  const report = (agentId: string, name: string, status: string, proposals: Array<{ kind: string; text: string }>) =>
    ({ agentId, name, status, inputs: [], findings: [], proposals });

  it('no run this launch: "Not run since Arbo started" and a Run button — the same one read-only POST — then the list', async () => {
    const run = { ranAt: ago(0), reports: [report('yard-boss', 'Yard Boss', 'ok', [{ kind: 'signback_review', text: 'Sign Unit 3 back on.' }])] };
    const k = kit({ ...FULL, '/api/agents/sections/run': run });
    k.renderMore();
    await flush();
    const card = k.v().children[1]!;
    expect(card.textContent).toContain('Not run since Arbo started');
    expect(card.textContent).not.toMatch(/no proposals/i);
    const btn = card.querySelector('button')!;
    expect(btn.textContent).toBe('Run all eight');
    await btn.click();
    await flush();
    expect(k.asked.filter((a) => a.method === 'POST')).toEqual([{ path: '/api/agents/sections/run', method: 'POST' }]);
    expect(k.getRun()).toEqual(run);
    const after = k.v().children[1]!;
    expect(after.textContent).toContain('Proposals for you (1)');
    expect(after.textContent).toContain('Sign Unit 3 back on.');
  });

  it('a run: its proposals in the run’s order, each opening the screen where Mike acts on it; when it ran, on top', async () => {
    const run = { ranAt: ago(2), reports: [
      report('yard-boss', 'Yard Boss', 'ok', [{ kind: 'signback_review', text: 'Sign Unit 3 back on.' }]),
      report('chief-of-staff', 'Chief of Staff', 'ok', [{ kind: 'decide_open_loops', text: 'Decide 2 open loops.' }]),
    ] };
    const k = kit(FULL, { run });
    k.renderMore();
    await flush();
    const card = k.v().children[1]!;
    expect(card.children[0]!.textContent).toMatch(/^Agents · ran /);
    const rows = card.querySelectorAll('.prop-row');
    expect(rows.map((r) => r.querySelector('.scope')!.textContent)).toEqual(['Sign Unit 3 back on.', 'Decide 2 open loops.']);
    // Each button names the screen it opens ("Fleet ›"), and keeps "Open Fleet" as its accessible name.
    expect(rows.map((r) => r.querySelector('button')!.textContent)).toEqual(['Fleet ›', 'Follow-ups ›']);
    expect(rows.map((r) => r.querySelector('button')!.getAttribute('aria-label'))).toEqual(['Open Fleet', 'Open Follow-ups']);
    await rows[0]!.querySelector('button')!.click();
    await rows[1]!.querySelector('button')!.click();
    expect(k.went).toEqual(['fleet', 'followups']);
    expect(card.querySelector('.actbtn')).toBeNull(); // a fresh run asks for no second run here
  });

  it('a run over 15 minutes old says so above its list, with Run again', async () => {
    const run = { ranAt: ago(20), reports: [report('yard-boss', 'Yard Boss', 'ok', [{ kind: 'signback_review', text: 'Sign Unit 3 back on.' }])] };
    const k = kit(FULL, { run });
    k.renderMore();
    await flush();
    const card = k.v().children[1]!;
    const kids = card.children.map((c) => c.textContent);
    const stale = kids.findIndex((t) => t.includes('over 15 minutes old'));
    const row = kids.findIndex((t) => t.includes('Sign Unit 3 back on.'));
    expect(stale).toBeGreaterThan(-1);
    expect(stale).toBeLessThan(row);
    expect(card.querySelector('.actbtn')!.textContent).toBe('Run all eight again');
  });

  it('a run that did not complete, and a run where desks couldn’t read everything, never read as "no proposals"', async () => {
    const bad = kit(FULL, { run: { error: 'error' } });
    bad.renderMore();
    await flush();
    expect(bad.v().children[1]!.textContent).toContain('The run did not complete');
    expect(bad.v().children[1]!.textContent).not.toContain('No proposals from this run.');
    const short = kit(FULL, { run: { ranAt: ago(1), reports: [report('analyst', 'Analyst', 'degraded', [])] } });
    short.renderMore();
    await flush();
    expect(short.v().children[1]!.textContent).toContain('No proposals — 1 desk couldn’t read everything');
  });
});

describe('Money counts one way on Today and on Office (P14: moneyCounts)', () => {
  it('overdue is past due plus the legal gate’s held ones; to bill is the drafts; undatable and no-figure are apart', () => {
    const k = kit(FULL);
    expect(k.moneyCounts({ collections: [{}], suppressed: [{}, {}], unknown: [{}], drafts: [{}], blocked: [{}, {}] }))
      .toEqual({ over: 3, unk: 1, bill: 1, noFigure: 2 });
    expect(k.moneyCounts({ collections: [], drafts: [] })).toEqual({ over: 0, unk: 0, bill: 0, noFigure: 0 });
  });

  it('Today’s overdue and to-bill tiles and Office’s Money tile both count through it', () => {
    expect(fnSrc('renderToday')).toContain('moneyCounts(m)');
    expect(fnSrc('officeDesk')).toContain('moneyCounts(');
    expect(fnSrc('renderToday')).not.toContain('m.collections.length');
  });
});

describe('Office adds no send (P14)', () => {
  it('Run all eight is the Agents run, sent from one place (runAllEight) — Agents and Office both call it', () => {
    expect(fnSrc('runAllEight')).toContain("api('/api/agents/sections/run', { method: 'POST' })");
    expect(fnSrc('renderAgents')).toContain('runAllEight()');
    expect(fnSrc('renderAgents')).not.toContain("'/api/agents/sections/run'");
    expect(fnSrc('officeProposals')).toContain('runAllEight()');
  });

  it('a desk tile is a 44 px tap target at least', () => {
    const css = html.slice(0, html.indexOf('</style>'));
    const m = /\n\.otile\{[^}]*min-height:(\d+)px/.exec(css);
    expect(m, '.otile min-height').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(44);
  });
});

// ---------- Review round (after 289baa0): what the two reviews confirmed on Office ----------
describe('Office review: a run that ages while Office is on screen says so (Office is off the minute timer)', () => {
  const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
  const run = (min: number) => ({ ranAt: ago(min), reports: [{ agentId: 'yard-boss', name: 'Yard Boss', status: 'ok', inputs: [], findings: [],
    proposals: [{ kind: 'signback_review', text: 'Sign Unit 3 back on.' }] }] });
  afterEach(() => { vi.useRealTimers(); });

  it('the minute the run turns 15 minutes old, the card is drawn again in place — the stale line above the list, with Run again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const k = kit(FULL, { run: run(14), extra: ['officeAge'] });
    k.renderMore();
    await flush();
    expect(k.v().children[1]!.textContent).not.toContain('over 15 minutes old');
    k.call('officeAge'); // nothing changed yet: the card stays the very same node
    const card = k.v().children[1]!;
    vi.setSystemTime(Date.now() + 2 * 60000);
    k.call('officeAge');
    const now = k.v().children[1]!;
    expect(now).not.toBe(card);
    expect(now.has('office-props')).toBe(true);
    const kids = now.children.map((c) => c.textContent);
    const stale = kids.findIndex((t) => t.includes('over 15 minutes old'));
    expect(stale).toBeGreaterThan(-1);
    expect(stale).toBeLessThan(kids.findIndex((t) => t.includes('Sign Unit 3 back on.')));
    expect(now.querySelector('.actbtn')!.textContent).toBe('Run all eight again');
  });

  it('a run made on Agents after Office was drawn replaces the old one; a run in flight is left alone', async () => {
    const k = kit(FULL, { run: null, extra: ['officeAge'] });
    k.renderMore();
    await flush();
    const card = k.v().children[1]!;
    card.querySelector('button')!.disabled = true; // Run all eight was tapped and is still running
    k.setRun(run(0));
    k.call('officeAge');
    expect(k.v().children[1]).toBe(card);
    card.querySelector('button')!.disabled = false;
    k.call('officeAge');
    expect(k.v().children[1]!.textContent).toContain('Sign Unit 3 back on.');
  });

  it('the page checks it every minute and when the phone wakes', () => {
    expect(html).toContain('setInterval(officeAge, 60000);');
    expect(html).toContain("document.addEventListener('visibilitychange', officeAge);");
  });
});

describe('Office review: the head never reads calm over nudges Follow-ups couldn’t check (§1B)', () => {
  it('storm or coming-due nudges unread: "No desk Arbo read needs you", and the feeds card names them', async () => {
    for (const flag of ['seasonalUnavailable', 'growthUnavailable']) {
      const k = kit({ ...ZERO, '/api/followups': { due: [], suppressed: [], [flag]: true } });
      k.renderMore();
      await flush();
      expect(k.tile('followups').textContent.replace(/\u00a0/g, ' '), flag).toContain('some couldn’t be checked');
      expect(k.h1().textContent, flag).toBe('No desk Arbo read needs you');
      expect(k.v().querySelector('.feeds')!.textContent, flag).toContain('Storm or coming-due nudges — couldn’t read it');
    }
  });
});

describe('Office review: Numbers says the ad spend Arbo reads (the plan: "ad spend, or dashed Ads: not set up yet")', () => {
  const perf = (p: Record<string, unknown>) => ({ ...FULL, '/api/performance': { areas: [{ verdict: 'above' }], withheld: [], ...p } });
  const said = (k: ReturnType<typeof kit>) => k.tile('perf').textContent.replace(/\u00a0/g, ' ');

  it('campaigns with their cost on file: the spend, never "not set up", and nothing on the feeds card', async () => {
    const k = kit(perf({ campaigns: [{ cost: 400 }, { cost: 750 }], campaignsKnown: true }));
    k.renderMore();
    await flush();
    expect(said(k)).toContain('Ads: $1,150 spent');
    expect(said(k)).not.toContain('not set up');
    expect(k.tile('perf').querySelector('.ogap')).toBeNull();
    const card = k.v().querySelector('.feeds')!;
    expect(card.textContent).not.toContain('Ads');
  });

  it('a campaign with no cost on file is said beside the spend, never folded into it', async () => {
    const k = kit(perf({ campaigns: [{ cost: 400 }, { cost: null }], campaignsKnown: true }));
    k.renderMore();
    await flush();
    expect(said(k)).toContain('Ads: $400 spent · 1 with no cost on file');
    const none = kit(perf({ campaigns: [{ cost: null }], campaignsKnown: true }));
    none.renderMore();
    await flush();
    expect(said(none)).toContain('Ads: 1 with no cost on file');
    expect(said(none)).not.toMatch(/\$0/);
  });

  it('campaigns Arbo couldn’t read: "couldn’t read it" — the Numbers screen’s own word, never "not set up"', async () => {
    const k = kit(perf({ campaigns: [], campaignsKnown: false }));
    k.renderMore();
    await flush();
    expect(said(k)).toContain('Ads: couldn’t read it');
    expect(said(k)).not.toContain('not set up');
    expect(k.v().querySelector('.feeds')!.textContent).toContain('Ads — couldn’t read it');
  });

  it('no campaign on file: "Ads: not set up yet", counted on the feeds card', async () => {
    const k = kit(perf({ campaigns: [], campaignsKnown: true }));
    k.renderMore();
    await flush();
    expect(said(k)).toContain('Ads: not set up yet');
    expect(k.v().querySelector('.feeds')!.textContent).toContain('Ads — not set up yet');
  });
});
