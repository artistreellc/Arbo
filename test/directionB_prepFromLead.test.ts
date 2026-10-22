// Direction B, P18 (docs/DIRECTION_B_PLAN.md; spec "Estimate: prep starts from a
// lead's address"). A lead row gets "Prep estimate ›": Estimate opens prefilled —
// a "From NAME's lead" pill (× clears it), the street, city, ZIP and what the
// customer said. The lead is handed over in memory, by its id — NEVER through the
// URL hash, history.state, storage or a log, because an address is a customer's
// detail. /api/leads carries the street from the lead's property (a read through
// the properties link, readable under readonly). A lead with no street prefills
// what it has, focuses the street box and says it is not on file; a street Arbo
// could not read (or a properties link kept cut) is named, never left blank.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

// ---------- the server: the street rides /api/leads ----------
const repo = vi.hoisted(() => ({
  rows: [
    {
      id: 'L-street', source: 'call', details: 'side gate, dogs', qualification: null, is_emergency: false, status: 'new',
      created_at: '2026-10-20T12:00:00Z', contact: { name: 'SIM-Pat', phones: ['+17575550101'], is_first_timer: true },
      property: { id: 'P-1', address: '1 Simulation Row', city: 'Norfolk', zip: '23503' },
    },
    {
      id: 'L-blank', source: 'call', details: null, qualification: null, is_emergency: false, status: 'new',
      created_at: '2026-10-20T11:00:00Z', contact: null, property: { id: 'P-2', address: '  ', city: 'Chesapeake', zip: null },
    },
    {
      id: 'L-none', source: 'call', details: null, qualification: null, is_emergency: false, status: 'new',
      created_at: '2026-10-20T10:00:00Z', contact: null, property: null,
    },
  ],
}));
vi.mock('../src/db/repositories.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/db/repositories.js')>()),
  listLeads: async () => repo.rows,
  latestPermitsForProperties: async () => new Map(),
  latestHistoryForProperties: async () => new Map(),
}));

import { createLiveSource } from '../src/server.js';
import { createApi, type DataSource } from '../src/server/api.js';
import { createSimSource } from '../src/dev/simSource.js';

type L = { id: string; street: string | null; streetCut?: true; streetUnreadable?: true };
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });
const liveLeads = async () => ((await createApi({ ...createLiveSource(), ready: () => true }).leads(10)).body as { leads: L[] }).leads;
const by = (ls: L[], id: string) => ls.find((l) => l.id === id)!;

describe('/api/leads carries the street from the lead’s property (P18)', () => {
  it('read-only: the street comes from the property; none on file, or no property, is null with no flag', async () => {
    process.env.ARBO_DATA_LINKS = 'readonly';
    const ls = await liveLeads();
    expect(by(ls, 'L-street').street).toBe('1 Simulation Row');
    expect(by(ls, 'L-blank').street).toBeNull();
    expect(by(ls, 'L-none').street).toBeNull();
    for (const l of ls) { expect(l.streetCut, l.id).toBeUndefined(); expect(l.streetUnreadable, l.id).toBeUndefined(); }
  });

  it('a properties link kept cut is named on the lead that has a property — never an empty street that reads as "none on file"', async () => {
    process.env.ARBO_DATA_LINKS = 'live';
    process.env.ARBO_LINK_LEADS = 'live';
    delete process.env.ARBO_LINK_PROPERTIES;
    const ls = await liveLeads();
    expect(by(ls, 'L-street').street).toBeNull();
    expect(by(ls, 'L-street').streetCut).toBe(true);
    expect(by(ls, 'L-none').streetCut).toBeUndefined(); // no property: nothing to read
  });

  it('a source that could not read a street says so, and the API passes it on as a named gap', async () => {
    const base = createSimSource();
    const src: DataSource = { ...base, newLeads: async (n: number) => (await base.newLeads(n)).map((l, i) => (i === 0 ? { ...l, street: null, streetUnreadable: true } : l)) };
    const ls = ((await createApi(src).leads(10)).body as { leads: L[] }).leads;
    expect(ls[0]!.street).toBeNull();
    expect(ls[0]!.streetUnreadable).toBe(true);
  });

  it('the practice data has streets on most leads and none where a lead has no property (streets that do not exist)', async () => {
    const ls = ((await createApi(createSimSource()).leads(10)).body as { leads: Array<L & { name: string }> }).leads;
    expect(ls.filter((l) => l.street).length).toBeGreaterThanOrEqual(2);
    expect(ls.some((l) => l.street === null)).toBe(true);
    for (const l of ls) if (l.street) expect(l.street).toMatch(/Simulation|Placeholder|Practice|Fakeleaf|Testbed|Sandbox/);
  });
});

// ---------- the page: the hand-over and the prefill ----------
const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
function fnSrc(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
function constSrc(name: string): string {
  const one = new RegExp(`^const ${name.replace(/\$/g, '\\$')} = (.*);\\s*(?://.*)?$`, 'm').exec(html);
  if (one) return `const ${name} = ${one[1]};`;
  const at = html.indexOf(`\nconst ${name} = `);
  return html.slice(at + 1, html.indexOf('\n};', at) + 3);
}

class FNode {
  className = ''; id = ''; type = ''; title = ''; hidden = false; disabled = false; value = ''; placeholder = ''; inputMode = ''; htmlFor = ''; selected = false;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FNode[] = [];
  parent: FNode | null = null;
  on: Record<string, Array<() => unknown>> = {};
  onclick: (() => unknown) | null = null;
  focused = 0;
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
  insertBefore(c: FNode, ref: FNode | null): FNode { c.parent?.drop(c); c.parent = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  drop(c: FNode): void { this.children = this.children.filter((x) => x !== c); c.parent = null; }
  remove(): void { this.parent?.drop(this); }
  replaceChildren(...ns: FNode[]): void { for (const c of this.children) c.parent = null; this.children = []; this.own = ''; for (const n of ns) this.appendChild(n); }
  hasChildNodes(): boolean { return this.children.length > 0 || this.own !== ''; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  getAttribute(k: string): string | null { return this.attrs[k] ?? null; }
  addEventListener(ev: string, f: () => unknown): void { (this.on[ev] ??= []).push(f); }
  async click(): Promise<void> { if (this.onclick) await this.onclick(); for (const f of this.on.click ?? []) await f(); }
  focus(): void { this.focused++; }
  all(): FNode[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}
class Option extends FNode { constructor(text: string, value: string) { super('option'); this.textContent = text; this.value = value; } }
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

/** estimatePrepPanel and prepFromLead with the page's own helpers. Records every way out a customer detail could take. */
function kit() {
  const document = {
    createElement: (t: string) => new FNode(t),
    createTextNode: (t: string) => { const n = new FNode('#text'); n.textContent = t; return n; },
    getElementById: () => new FNode('div'),
  };
  const leaks: string[] = [];
  const went: string[] = [];
  const history = { state: { v: 'leads', d: 1 }, pushState: (s: unknown, _t: string, u: string) => leaks.push('push ' + JSON.stringify(s) + ' ' + u), replaceState: (s: unknown, _t: string, u: string) => leaks.push('replace ' + JSON.stringify(s) + ' ' + u) };
  const location = { hash: '#leads' };
  const store = { setItem: (k: string, v: string) => leaks.push('store ' + k + '=' + v), getItem: () => null };
  const console = { log: (...a: unknown[]) => leaks.push('log ' + a.join(' ')), error: (...a: unknown[]) => leaks.push('log ' + a.join(' ')) };
  const built = new Function('document', 'history', 'location', 'localStorage', 'sessionStorage', 'console', 'switchTab', 'renderEstimate', 'Option', 'api', `
    let LINKS = 'readonly';
    const LINKS_READY = Promise.resolve('readonly');
    let PERMIT_CITY = 'Virginia Beach';
    let PREP_LEAD = null;
    const showKeywall = () => {};
    const renderPermits = () => {};
    ${['el', 'FEED_WORD', 'Cap', 'PERMIT_STATE'].map(constSrc).join('\n')}
    ${['feedKind', 'estimatePrepPanel', 'prepFromLead'].map(fnSrc).join('\n')}
    return { estimatePrepPanel, prepFromLead, lead: () => PREP_LEAD };`)(
    document, history, location, store, store, console, (t: string) => went.push('tab:' + t), () => went.push('draw:estimate'), Option,
    async () => ({}),
  ) as { estimatePrepPanel: () => FNode; prepFromLead: (l: unknown) => void; lead: () => unknown };
  const field = (card: FNode, id: string) => card.all().find((n) => n.id === 'ep-' + id)!;
  return { ...built, leaks, went, location, field };
}
const LEAD = { id: 'L-street', name: 'SIM-Pat', street: '1 Simulation Row', city: 'Norfolk', zip: '23503', details: 'side gate, dogs', phone: '+17575550101', older: false };

describe('Prep estimate from a lead: handed over in memory, by id (P18)', () => {
  it('prepFromLead opens Estimate drawn fresh — the hash, history and storage carry nothing of the lead', () => {
    const k = kit();
    k.prepFromLead(LEAD);
    expect(k.went).toEqual(['tab:estimate', 'draw:estimate']);
    expect(k.leaks).toEqual([]);
    expect(k.location.hash).toBe('#leads');
    expect((k.lead() as { id: string }).id).toBe('L-street');
    // Only what the prep needs is kept — never the phone number.
    expect(JSON.stringify(k.lead())).not.toContain('+1757');
  });

  it('the prefill: a "From NAME’s lead" pill, the street, city, ZIP and what the customer said — no retyping', async () => {
    const k = kit();
    k.prepFromLead(LEAD);
    const card = k.estimatePrepPanel();
    await flush();
    expect(card.textContent).toContain('From SIM-Pat’s lead');
    expect(k.field(card, 'address').value).toBe('1 Simulation Row');
    expect(k.field(card, 'city').value).toBe('Norfolk');
    expect(k.field(card, 'zip').value).toBe('23503');
    expect(k.field(card, 'access-notes').value).toBe('side gate, dogs');
    expect(k.field(card, 'address').focused).toBe(0); // nothing to type: no keyboard pops up
    expect(k.leaks).toEqual([]);
  });

  it('× clears the lead: the pill goes, the boxes empty, and the next Estimate draw starts blank', async () => {
    const k = kit();
    k.prepFromLead(LEAD);
    const card = k.estimatePrepPanel();
    const x = card.all().find((n) => n.tag === 'button' && n.getAttribute('aria-label') === 'Clear the lead')!;
    await x.click();
    expect(card.textContent).not.toContain('From SIM-Pat’s lead');
    expect(k.field(card, 'address').value).toBe('');
    expect(k.field(card, 'zip').value).toBe('');
    expect(k.field(card, 'access-notes').value).toBe('');
    expect(k.lead()).toBeNull();
    expect(k.estimatePrepPanel().textContent).not.toContain('lead');
  });

  it('a lead with no street on file: city and ZIP filled, the street box focused and labelled "Street not on file" — said, not guessed', async () => {
    const k = kit();
    k.prepFromLead({ ...LEAD, id: 'L-blank', street: null, zip: null });
    const card = k.estimatePrepPanel();
    await flush();
    const addr = k.field(card, 'address');
    expect(addr.value).toBe('');
    expect(addr.placeholder).toBe('Street not on file');
    expect(addr.focused).toBe(1);
    expect(k.field(card, 'city').value).toBe('Norfolk');
    expect(card.textContent).toContain('Street not on file — type it in.');
    // The minute timer's redraw does not raise the keyboard a second time.
    const again = k.estimatePrepPanel();
    await flush();
    expect(k.field(again, 'address').focused).toBe(0);
  });

  it.each([
    [{ streetUnreadable: true }, 'Street: couldn’t read it — type it in.'],
    [{ streetCut: true }, 'Street: cut on purpose — type it in.'],
  ])('a street Arbo could not read is named (%o), never left as a blank that reads "none on file"', async (gap, said) => {
    const k = kit();
    k.prepFromLead({ ...LEAD, street: null, ...gap });
    const card = k.estimatePrepPanel();
    await flush();
    expect(card.textContent).toContain(said);
    expect(card.textContent).not.toContain('Street not on file');
  });

  it('a lead with no ZIP says so before Build — the drive time needs one; with a ZIP nothing is said; × takes the line away (P18 review)', async () => {
    const k = kit();
    k.prepFromLead({ ...LEAD, zip: null });
    const card = k.estimatePrepPanel();
    await flush();
    expect(k.field(card, 'zip').value).toBe('');
    expect(card.textContent).toContain('ZIP not on file — without it the drive time can’t be worked out.');
    // the box's grey hint never reads like a filled-in ZIP
    expect(k.field(card, 'zip').placeholder).not.toMatch(/^\d{5}$/);
    const x = card.all().find((n) => n.tag === 'button' && n.getAttribute('aria-label') === 'Clear the lead')!;
    await x.click();
    expect(card.textContent).not.toContain('ZIP not on file');
    const withZip = kit();
    withZip.prepFromLead(LEAD);
    expect(withZip.estimatePrepPanel().textContent).not.toContain('ZIP not on file');
    // a blank form (no lead) says nothing about a ZIP
    expect(kit().estimatePrepPanel().textContent).not.toContain('ZIP not on file');
  });

  it('a city outside the four is kept as the lead said it — the server flags it; never silently swapped for Virginia Beach', () => {
    const k = kit();
    k.prepFromLead({ ...LEAD, city: 'Suffolk' });
    const card = k.estimatePrepPanel();
    expect(k.field(card, 'city').value).toBe('Suffolk');
  });

  it('a lead with no city leaves the city to choose — never a default that looks like the lead’s', () => {
    const k = kit();
    k.prepFromLead({ ...LEAD, city: null });
    const card = k.estimatePrepPanel();
    expect(k.field(card, 'city').value).toBe('');
    expect(card.textContent).toContain('City not on file — choose one.');
  });
});

describe('the lead row’s "Prep estimate ›" (P18)', () => {
  const leads = fnSrc('renderLeads');
  it('every lead that is new work gets the button; an older lead does not (R32: not new work)', () => {
    expect(leads).toContain("el('button', 'minibtn prep-lead', T('Prep estimate ›'))");
    expect(leads).toContain('prepFromLead(lead)');
    expect(leads).toMatch(/if \(!lead\.older\) \{\n\s+const prep = el\('button', 'minibtn prep-lead'/);
  });

  it('the hand-over code never writes the lead anywhere but memory: no hash, history, storage or log', () => {
    for (const name of ['prepFromLead', 'estimatePrepPanel']) {
      const src = fnSrc(name);
      for (const way of ['location', 'history', 'localStorage', 'sessionStorage', 'console', 'pushState', 'replaceState', 'document.cookie']) expect(src, name + ' ' + way).not.toContain(way);
    }
  });

  it('the button is a 44 px tap target', () => {
    const css = html.slice(0, html.indexOf('</style>'));
    const m = /\.minibtn\.prep-lead\{[^}]*min-height:(\d+)px/.exec(css);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(44);
  });
});
