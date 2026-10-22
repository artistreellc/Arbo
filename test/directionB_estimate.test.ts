// Direction B, P15 (docs/DIRECTION_B_PLAN.md; R29 #1 and #4; spec "The hubs":
// "Estimate: prep starts from a lead's address; then Permit (permit-vocab chips
// only), Drive time (named when it couldn't be read), 811, Access; Yard check,
// Measure, Properties on file, Permit rules"). A new view, 'estimate'. The prep
// form moves here from the Book (renamed "Properties on file"), the Yard check
// moves here from Today (still one tap away), Permits is "Permit rules". Book,
// Permits and Measure are children of Estimate: with nothing behind, Back lands
// there. Never a price, never a booking; the permit words only — never "clear".
// vitest has no DOM: the screens are lifted out of the page with the page's own
// helpers, over one stand-in document.
import { describe, it, expect } from 'vitest';
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
/** The keys of a one-line object literal whose values name page functions (not evaluated). */
function constKeys(name: string): string[] {
  const m = new RegExp(`^const ${name} = \\{(.*)\\};$`, 'm').exec(html);
  if (!m) throw new Error(`no one-line const ${name} in the page`);
  return [...m[1]!.matchAll(/(?:^|,)\s*([a-z]+):/g)].map((x) => x[1]!);
}

// ---------- a stand-in DOM ----------
class FNode {
  className = ''; id = ''; type = ''; title = ''; hidden = false; disabled = false; value = ''; placeholder = ''; inputMode = ''; htmlFor = '';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FNode[] = [];
  parent: FNode | null = null;
  on: Record<string, Array<() => unknown>> = {};
  onclick: (() => unknown) | null = null;
  focused = false;
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
  replaceWith(...ns: FNode[]): void { const p = this.parent!; const at = p.children.indexOf(this); for (const n of ns) { n.parent?.drop(n); n.parent = p; } p.children.splice(p.children.indexOf(this) < 0 ? at : p.children.indexOf(this), 1, ...ns); this.parent = null; }
  replaceChildren(...ns: FNode[]): void { for (const c of this.children) c.parent = null; this.children = []; this.own = ''; for (const n of ns) this.appendChild(n); }
  hasChildNodes(): boolean { return this.children.length > 0 || this.own !== ''; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  removeAttribute(k: string): void { delete this.attrs[k]; }
  getAttribute(k: string): string | null { return this.attrs[k] ?? null; }
  addEventListener(ev: string, f: () => unknown): void { (this.on[ev] ??= []).push(f); }
  async click(): Promise<void> { if (this.onclick) await this.onclick(); for (const f of this.on.click ?? []) await f(); }
  focus(): void { this.focused = true; }
  get isConnected(): boolean { return true; }
  all(): FNode[] { return [this, ...this.children.flatMap((c) => c.all())]; }
  private match(sel: string): (n: FNode) => boolean {
    const cls = /^(?::scope > )?\.([\w-]+)$/.exec(sel);
    if (cls) return (n) => n.names().includes(cls[1]!);
    if (/^[a-z][a-z0-9]*$/.test(sel)) return (n) => n.tag === sel;
    throw new Error('stand-in DOM does not do ' + sel);
  }
  querySelectorAll(sel: string): FNode[] { const f = this.match(sel); return (sel.startsWith(':scope > ') ? this.children : this.all().slice(1)).filter(f); }
  querySelector(sel: string): FNode | null { return this.querySelectorAll(sel)[0] ?? null; }
}
class Option extends FNode { constructor(text: string, value: string) { super('option'); this.textContent = text; this.value = value; } }
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const fail = (code: number, message: string) => Object.assign(new Error(message), { code });

const CONSTS = ['$', 'el', 'FEED_WORD', 'Cap', 'FEED_TAG', 'FEED_SAYS', 'RETRY', 'TONE', 'PERMIT_STATE', 'ESTIMATE_TOOLS'];
// R27 Phase A (owner app b): the prep sheet's permit word is said through the page's permitLabel (the safety pair) — lifted with the rest.
const HELPERS = ['readingLine', 'plural', 'chip', 'badge', 'feedKind', 'feedLine', 'feedState', 'state', 'permitLabel', 'estimatePrepPanel', 'renderEstimate'];

type Answer = unknown | Error | (() => Promise<unknown>);
/** renderEstimate (and the prep form) with the page's own helpers, one stand-in document and one answer per path. */
function kit(answers: Record<string, Answer>, links = 'readonly') {
  const ids = new Map<string, FNode>();
  const document = {
    createElement: (t: string) => new FNode(t),
    createTextNode: (t: string) => { const n = new FNode('#text'); n.textContent = t; return n; },
    getElementById: (id: string) => { if (!ids.has(id)) { const n = new FNode('div'); n.id = id; ids.set(id, n); } return ids.get(id)!; },
  };
  const went: string[] = [];
  const asked: Array<{ path: string; method: string; body?: unknown }> = [];
  const api = async (path: string, o?: { method?: string; body?: unknown }) => {
    asked.push({ path, method: (o && o.method) || 'GET', body: o && o.body });
    if (!(path in answers)) throw new Error('unexpected read ' + path);
    const a = answers[path];
    if (a instanceof Error) throw a;
    if (typeof a === 'function') return (a as () => Promise<unknown>)();
    return JSON.parse(JSON.stringify(a));
  };
  const built = new Function('document', 'api', 'switchTab', 'icon', 'linksIn', 'went', 'Option', `
    let LINKS = linksIn;
    const LINKS_READY = Promise.resolve(linksIn);
    let EST_GEN = 0;
    let EST_BOOK = null;
    let PERMIT_CITY = 'Virginia Beach';
    let PREP_LEAD = null;
    const showKeywall = () => went.push('keywall');
    const openYard = () => went.push('yard');
    const NAV_DRAW = { permits: () => went.push('draw:permits'), measure: () => went.push('draw:measure') };
    const renderPermits = () => went.push('draw:permits');
    ${CONSTS.map(constSrc).join('\n')}
    ${HELPERS.map(fnSrc).join('\n')}
    return { renderEstimate, estimatePrepPanel, permitCity: () => PERMIT_CITY };`)(
    document, api, (t: string) => went.push(t), (id: string) => { const s = new FNode('svg'); s.dataset.icon = id; return s; }, links, went, Option,
  ) as { renderEstimate: () => Promise<void>; estimatePrepPanel: () => FNode; permitCity: () => string };
  const v = () => document.getElementById('view-estimate');
  const tools = () => v().querySelectorAll('.est-tool');
  const tool = (key: string) => tools().find((t) => t.dataset.tool === key)!;
  return { ...built, v, tools, tool, went, asked };
}
const PROPS = { properties: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], comingDue: [{ propertyId: 'p1' }], forecastUnavailable: false };

describe('Estimate is a screen of its own (P15): the title, the links, Back, the timer', () => {
  const titles = constVal<Record<string, string>>('VIEW_TITLES');

  it('view "estimate", titled Estimate; Book is "Properties on file" and Permits "Permit rules" (the follow-up renames)', () => {
    expect(html).toContain('<div id="view-estimate" class="view"></div>');
    expect(titles.estimate).toBe('Estimate');
    expect(titles.book).toBe('Properties on file');
    expect(titles.permits).toBe('Permit rules');
  });

  it('Properties on file, Permit rules and Measure are its children: with nothing behind, Back lands on Estimate; Estimate on Today', () => {
    const parent = constVal<Record<string, string>>('NAV_PARENT');
    expect(parent.book).toBe('estimate');
    expect(parent.permits).toBe('estimate');
    expect(parent.measure).toBe('estimate');
    expect(parent.estimate ?? 'today').toBe('today');
  });

  it('it lights the tab its old screens lit until the dock flips (P19), and the minute timer and ↻ draw it', () => {
    const dock = constVal<Record<string, string>>('DOCK_OF');
    expect(dock.estimate).toBe(dock.book);
    expect(constKeys('TIMED')).toContain('estimate');
    expect(html).toMatch(/^const TIMED = \{.*estimate: renderEstimate/m);
  });
});

describe('Estimate: the head and the prep form first, then the tools (P15)', () => {
  it('the head and the prep form are drawn before any read lands', () => {
    const k = kit({ '/api/properties': () => new Promise(() => {}) });
    void k.renderEstimate();
    const kids = k.v().children;
    expect(kids[0]!.has('viewhead')).toBe(true);
    expect(kids[0]!.children[0]!.textContent).toBe('Arborist · Permit Desk');
    expect(kids[0]!.children[1]!.textContent).toBe('Before you write it up');
    // P15 review: the head says once what the sheet is and that it never prices or books; the form card follows it.
    expect(kids[0]!.children[2]!.textContent).toBe('Start with the address: permit, drive time, 811 and access. Never a price, never a booking.');
    expect(kids[1]!.has('prep-card')).toBe(true);
    expect(kids[1]!.textContent).toContain('Build prep sheet');
    // the spec's order — the Yard check first, so it sits on the first screen (R29 #4: one tap away)
    expect(k.tools().map((t) => t.dataset.tool)).toEqual(['yard', 'measure', 'book', 'permits']);
    expect(k.tool('book').textContent).toContain('Reading…');
  });

  it('the tools: Permit rules, Measure a tree, the Yard check (moved here from Today) and Properties on file', async () => {
    const k = kit({ '/api/properties': PROPS });
    await k.renderEstimate();
    await flush();
    expect(k.tool('permits').textContent).toContain('Permit rules');
    expect(k.tool('measure').textContent).toContain('Measure a tree');
    expect(k.tool('yard').textContent).toContain('Yard check — will this job pay?');
    expect(k.tool('book').textContent).toContain('Properties on file');
    expect(k.tool('book').textContent).toContain('3 on file · 1 coming due');
    for (const key of ['permits', 'measure', 'yard', 'book']) await k.tool(key).click();
    // Permit rules and Measure are drawn as their old More tiles drew them; the Yard check opens its sheet.
    expect(k.went).toEqual(['permits', 'draw:permits', 'measure', 'draw:measure', 'yard', 'book']);
  });

  it('every tool is a 44 px tap target', () => {
    const css = html.slice(0, html.indexOf('</style>'));
    const m = /\n\.est-tool\{[^}]*min-height:(\d+)px/.exec(css);
    expect(m, '.est-tool min-height').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(44);
  });

  it.each([
    ['cut', fail(503, 'link_cut'), 'cut on purpose'],
    ['not set up', fail(503, 'db_not_configured'), 'not set up yet'],
    ['unreadable', new TypeError('Failed to fetch'), 'couldn’t read it'],
  ])('Properties on file %s: the row names the feed, shows no count, and opens nothing (§1B)', async (_k, err, word) => {
    const k = kit({ '/api/properties': err });
    await k.renderEstimate();
    await flush();
    const row = k.tool('book');
    expect(row.textContent).toContain('Properties on fileNot counted — ' + word); // its title, then why there is no count
    expect(row.textContent).not.toMatch(/\d+ on file/);
    expect(row.has('gap')).toBe(true);
    expect(row.getAttribute('aria-disabled')).toBe('true');
    await row.click();
    expect(k.went).toEqual([]);
    // The other tools need no read and still open.
    await k.tool('yard').click();
    expect(k.went).toEqual(['yard']);
  });

  it('a redraw keeps what Properties on file said, tappable, until its own read lands — "Reading…" only on a first draw', async () => {
    const answers: Record<string, Answer> = { '/api/properties': PROPS };
    const k = kit(answers);
    await k.renderEstimate();
    answers['/api/properties'] = () => new Promise(() => {});
    void k.renderEstimate(); // the minute timer, or ↻
    await flush();
    expect(k.tool('book').textContent).toContain('3 on file · 1 coming due');
    expect(k.v().textContent).not.toContain('Reading…');
    await k.tool('book').click();
    expect(k.went).toEqual(['book']);
  });

  it('the minute timer holds Estimate while an address is half-typed (holdsTyping), as it does every form', () => {
    const holdsTyping = new Function(`${fnSrc('holdsTyping')}\nreturn holdsTyping;`)() as (v: unknown) => boolean;
    const view = (value: string) => ({ querySelector: () => null, querySelectorAll: (sel: string) => (sel === '.lead-filed' ? [] : [{ value, type: 'text' }]) });
    expect(holdsTyping(view('12 Oak'))).toBe(true);
    expect(holdsTyping(view(''))).toBe(false);
    expect(fnSrc('estimatePrepPanel')).toContain("const addr = el('input'); addr.type = 'text';");
  });

  it('a forecast Arbo couldn’t read is said beside the count, never "0 coming due"', async () => {
    const k = kit({ '/api/properties': { properties: [{ id: 'p1' }], comingDue: null, forecastUnavailable: true } });
    await k.renderEstimate();
    await flush();
    expect(k.tool('book').textContent).toContain('1 on file · coming due: couldn’t read it');
    expect(k.tool('book').textContent).not.toContain('0 coming due');
  });
});

describe('the prep sheet, row by row, in the server’s words (P15)', () => {
  const sheet = (over: Record<string, unknown> = {}) => ({
    address: '1 Simulation Row', city: 'Norfolk', jobType: 'removal',
    permit: { ran: true, status: 'REVIEW_NEEDED', headline: 'One overlay to check with the city.', overlays: [] },
    drive: { fromZip: null, reason: 'No work ZIP set today — set today’s work ZIP in Settings to see the drive time.' },
    missUtility: { flagged: true, note: 'Ask: has the property been marked? If not, they should schedule Miss Utility (811) before any grinding or digging.' },
    access: { notes: 'side gate', note: 'The caller’s own words — verify on site.' },
    preparedAtIso: '2026-10-21T12:00:00Z', ...over,
  });
  async function build(answer: Answer) {
    const k = kit({ '/api/estimate/prep': answer });
    const card = k.estimatePrepPanel();
    const input = card.all().find((n) => n.tag === 'input' && n.id === 'ep-address')!;
    input.value = '1 Simulation Row';
    card.all().find((n) => n.tag === 'select' && n.id === 'ep-city')!.value = 'Norfolk'; // a real select starts on its first city; the stand-in starts empty
    const go = card.all().find((n) => n.tag === 'button' && n.textContent === 'Build prep sheet')!;
    await go.click();
    await flush();
    return { k, card, go };
  }

  it('Permit: the permit words only, then "Open the job check ›" — Permit rules for that city', async () => {
    const { k, card } = await build(sheet());
    const text = card.textContent;
    expect(card.querySelector('.vhead')!.textContent).toBe('PERMIT: REVIEW NEEDED');
    expect(text).not.toMatch(/you(?:’|')re clear|\bclear\b|exempt/i);
    for (const label of ['Permit', 'Drive', '811', 'Access']) expect(card.querySelectorAll('.prep-lab').map((n) => n.textContent)).toContain(label);
    const jc = card.all().find((n) => n.tag === 'button' && n.textContent === 'Open the job check ›')!;
    await jc.click();
    expect(k.permitCity()).toBe('Norfolk');
    expect(k.went).toEqual(['permits', 'draw:permits']);
  });

  it('a screen that never ran is PERMIT SCREEN PENDING, with its reason', async () => {
    const { card } = await build(sheet({ permit: { ran: false, reason: 'GIS provider not configured — CBPA/RPA screen has NOT run; run it before quoting or scheduling.' } }));
    expect(card.querySelector('.vhead')!.textContent).toBe('PERMIT SCREEN PENDING');
    expect(card.textContent).toContain('GIS provider not configured');
  });

  it('Drive: a time Arbo could not work out is named — never a 0 — and ↻ builds the sheet again', async () => {
    const { k, card } = await build(sheet());
    const drive = card.all().find((n) => n.has('feed-state') && n.textContent.includes('No work ZIP set today'))!;
    expect(drive).toBeDefined();
    expect(card.textContent).not.toMatch(/~0 min/);
    const again = card.all().find((n) => n.tag === 'button' && n.textContent === '↻ Build again')!;
    await again.click();
    await flush();
    expect(k.asked.filter((a) => a.path === '/api/estimate/prep')).toHaveLength(2);
  });

  it('811 and Access: the server’s own lines, the typed notes in quotes', async () => {
    const { card } = await build(sheet());
    expect(card.textContent).toContain('Miss Utility (811)');
    expect(card.textContent).toContain('"side gate" — The caller’s own words — verify on site.');
  });

  it('a prep read that failed is named: "Prep sheet unavailable right now — nothing was screened."', async () => {
    const { card } = await build(fail(503, 'link_cut'));
    expect(card.textContent).toContain('Prep sheet unavailable right now — nothing was screened.');
  });
});

describe('the Yard check moved from Today to Estimate (R29 #4), still one tap away', () => {
  it('Today has no Yard check', () => {
    const today = fnSrc('renderToday');
    expect(today).not.toContain('openYard');
    expect(today).not.toContain('Yard check — will this job pay?');
    expect(today).not.toContain('yardBtn');
  });

  it('Estimate carries it, word for word, and opens the same sheet', () => {
    const tools = constVal<Array<{ key: string; title: string }>>('ESTIMATE_TOOLS');
    expect(tools.find((t) => t.key === 'yard')!.title).toBe('Yard check — will this job pay?');
    expect(fnSrc('renderEstimate')).toContain('openYard()');
  });
});

describe('Properties on file (the Book, renamed): its list only — the prep form moved to Estimate', () => {
  it('renderBook draws no prep form; its head says Properties on file; cut, it is the head and the named feed', async () => {
    expect(fnSrc('renderBook')).not.toContain('estimatePrepPanel');
    const ids = new Map<string, FNode>();
    const document = {
      createElement: (t: string) => new FNode(t),
      createTextNode: (t: string) => { const n = new FNode('#text'); n.textContent = t; return n; },
      getElementById: (id: string) => { if (!ids.has(id)) { const n = new FNode('div'); n.id = id; ids.set(id, n); } return ids.get(id)!; },
    };
    const book = new Function('document', `
      let LINKS = 'cut';
      const LINKS_READY = Promise.resolve('cut');
      const api = async () => { throw Object.assign(new Error('link_cut'), { code: 503 }); };
      const showKeywall = () => {};
      ${['$', 'el', 'FEED_WORD', 'FEED_SAYS', 'RETRY', 'VIEW_TITLES'].map(constSrc).join('\n')}
      ${['readingLine', 'feedKind', 'feedState', 'state', 'renderBook'].map(fnSrc).join('\n')}
      return renderBook;`)(document) as () => Promise<void>;
    await book();
    const v = document.getElementById('view-book');
    expect(v.children.map((c) => c.className)).toEqual(['viewhead', 'state']);
    expect(v.children[0]!.children[1]!.textContent).toBe('Properties on file');
    expect(v.textContent).toContain('cut on purpose');
    // P15 review: the dead feed names the screen by its new name — never "The Book … not an empty Book" under it
    expect(v.children[1]!.textContent).toContain('Properties on file — cut on purpose');
    expect(v.textContent).not.toMatch(/\bBook\b/);
  });
});

describe('Office once the dock flips (P19): Estimate is a dock tab, so Office carries none of its tiles', () => {
  it('renderMore has no Estimate tile (until P19 it had one), and the three old tiles stay gone', () => {
    const more = fnSrc('renderMore');
    expect(more).not.toContain("tile('i-tree', 'Estimate', ");
    for (const gone of ["'Book'", "'Permits'", "'Measure'"]) expect(more, gone).not.toContain(gone);
    // The Estimate tab opens it instead (the dock, P19).
    expect(html).toContain('<button id="tab-estimate"><span class="navpill"><svg class="ico" aria-hidden="true"><use href="#i-tree"/></svg><span>Estimate</span></span></button>');
  });
});

// ---------- Review round (after 289baa0): what the reviews confirmed on Estimate and Properties on file ----------
describe('Estimate review: the Yard check on the first screen, its desk line, a row that opens while it reads, the Book renamed', () => {
  it('the tools come straight after the form — no heading row between (the list keeps its name for a screen reader)', () => {
    const k = kit({ '/api/properties': () => new Promise(() => {}) });
    void k.renderEstimate();
    const kids = k.v().children;
    expect(kids.map((c) => c.className)).toEqual(['viewhead', 'card prep-card', 'est-tools']);
    expect(kids[2]!.getAttribute('role')).toBe('group');
    expect(kids[2]!.getAttribute('aria-label')).toBe('Tools for the estimate');
    // the form card carries no title or help line of its own — the head says them once
    expect(kids[1]!.querySelector('.panel-title')).toBeNull();
    expect(kids[1]!.textContent).not.toContain('one sheet before you drive');
    // two lines of access notes, a little tighter, on Estimate only
    const css = html.slice(0, html.indexOf('</style>'));
    expect(css).toContain('.prep-card .field textarea{min-height:60px}');
  });

  it('every tool’s small line is a desk name (R26) — the Yard check’s is the Yard Boss, not a note that it moved', () => {
    const tools = constVal<Array<{ key: string; line: string }>>('ESTIMATE_TOOLS');
    const desks = Object.values(constVal<Record<string, string>>('SECTION_NAMES'));
    for (const t of tools) expect(desks, t.key).toContain(t.line);
    expect(tools.find((t) => t.key === 'yard')!.line).toBe('Yard Boss');
  });

  it('Properties on file opens while its count still reads — only a read that failed makes it inert', async () => {
    const k = kit({ '/api/properties': () => new Promise(() => {}) });
    void k.renderEstimate();
    await flush();
    expect(k.tool('book').textContent).toContain('Reading…');
    expect(k.tool('book').getAttribute('aria-disabled')).toBe('false');
    expect(k.tool('book').has('gap')).toBe(false);
    await k.tool('book').click();
    expect(k.went).toEqual(['book']);
  });
});
