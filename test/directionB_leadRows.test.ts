// Direction B, P8 (docs/DIRECTION_B_PLAN.md; spec quick fix "Leads shows about
// twice as many per screen (compact rows with a round call button instead of a
// full-width Call back slab)"). Call back moves into the lead's top row as a
// 52 px round button (the phone icon, a visually hidden "Call back" and
// aria-label="Call back"); no flexBasis slab. What a customer said and past work
// fold to two lines, a tap opens them. Unchanged: Good lead / Spam keep their
// words and aria labels, the spam Undo hold, no button on an older lead or a
// lead with no phone (R32), and Today's emergency card and the Sona cards keep
// their big Call back.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
const css = html.slice(0, html.indexOf('</style>'));
function fnSrc(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
function pageFn<T>(name: string, deps: Record<string, unknown>): T {
  return new Function(...Object.keys(deps), `${fnSrc(name)}\nreturn ${name};`)(...Object.values(deps)) as T;
}

class Node {
  className = ''; textContent = ''; disabled = false; title = ''; href = '';
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
      toggle: (c: string, f?: boolean) => { if (f ?? !this.names().includes(c)) this.classList.add(c); else this.classList.remove(c); },
    };
  }
  has(c: string): boolean { return this.names().includes(c); }
  appendChild(c: Node): Node { c.parent?.drop(c); c.parent = this; this.children.push(c); return c; }
  drop(c: Node): void { this.children = this.children.filter((x) => x !== c); c.parent = null; }
  remove(): void { this.parent?.drop(this); }
  replaceWith(n: Node): void { const p = this.parent!; n.parent?.drop(n); p.children[p.children.indexOf(this)] = n; n.parent = p; this.parent = null; }
  replaceChildren(...ns: Node[]): void { for (const c of this.children) c.parent = null; this.children = []; for (const n of ns) this.appendChild(n); }
  hasChildNodes(): boolean { return this.children.length > 0; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  getAttribute(k: string): string | null { return this.attrs[k] ?? null; }
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
const el = (tag: string, cls?: string, text?: string): Node => { const n = new Node(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const chip = (text: string, tone: string): Node => { const n = el('span', 'badge', text); n.dataset.tone = String(tone); return n; };

type Lead = Record<string, unknown>;
const lead = (o: Lead = {}): Lead => ({
  id: 'L1', name: 'SIM-Elm, Test', phone: '+17575550101', city: 'Norfolk', zip: '23503',
  createdAt: '2026-10-18T14:00:00Z', status: 'new', isEmergency: false, needsCallback: false,
  isFirstTimer: true, quality: { priority: 'warm' }, permit: null, screenPending: false,
  permitUnreadable: false, history: null, historyUnreadable: false, details: null, ...o,
});
async function draw(leads: Lead[]) {
  const v = el('div');
  const posts: string[] = [];
  const renderLeads = pageFn<() => Promise<void>>('renderLeads', {
    $: () => v, el, chip, fmtWhen: (x: unknown) => (x ? 'WHEN' : ''), plural: (n: number, one: string) => n + ' ' + one + (n === 1 ? '' : 's'),
    api: async (path: string, opts?: unknown) => { if (!opts) return { leads }; posts.push(path); return { ok: true }; },
    permitBadge: () => null, leadsTabBadge: () => {}, readingLine: () => el('div', 'reading', 'Reading…'), tapCount: () => 0, keepsPage: () => false, TIMER_REDRAW: false,
    icon: (id: string) => el('svg', 'ico ' + id), showKeywall: () => {}, LINKS_READY: Promise.resolve('simulation'),
    state: (t: string, m: string) => { const n = el('div', 'state', t); n.appendChild(el('span', '', m)); return n; },
    feedState: (_e: unknown, w: string) => el('div', 'state', w), feedLine: (_e: unknown, w: string) => el('div', 'feed-state', w),
    showSaveFail: () => {}, emergencyLeads: () => {}, clampLine: pageFn('clampLine', { el }),
  });
  await renderLeads();
  return { v, posts, cards: v.children.filter((n) => n.has('card')) };
}

describe('Leads: compact rows with a round call button (P8)', () => {
  it('a lead with a phone has exactly one call button: round, in the top row, the phone icon, named "Call back"', async () => {
    const { cards } = await draw([lead()]);
    const c = cards[0]!;
    const calls = c.all().filter((n) => n.has('callbtn'));
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.tag).toBe('a');
    expect(call.has('round')).toBe(true);
    expect(call.parent!.has('toprow'), 'inside .toprow').toBe(true);
    expect(call.href).toBe('tel:+17575550101');
    expect(call.attrs['aria-label']).toBe('Call back');
    expect(call.children.some((n) => n.tag === 'svg' && n.has('i-calls'))).toBe(true);
    const hidden = call.children.find((n) => n.has('sr-only'))!;
    expect(hidden.textContent).toBe('Call back');
    // The top row keeps the name and the time, then the button, then the city (beside the time on screen).
    const top = call.parent!;
    expect(top.children.map((n) => n.className.split(' ')[0])).toEqual(['who', 'when', 'callbtn', 'addr']);
    expect(top.children[3]!.textContent).toBe('Norfolk · 23503');
    expect(c.children.filter((n) => n.has('addr'))).toEqual([]); // said once
  });

  it('a lead with no button keeps its city on its own line under the top row', async () => {
    const { cards } = await draw([lead({ phone: null })]);
    const c = cards[0]!;
    expect(c.children.find((n) => n.has('toprow'))!.children.map((n) => n.className)).toEqual(['who', 'when']);
    expect(c.children.find((n) => n.has('addr'))!.textContent).toBe('Norfolk · 23503');
  });

  it('no element carries the old full-width slab (flexBasis)', async () => {
    const { v } = await draw([lead(), lead({ id: 'L2', needsCallback: true }), lead({ id: 'L3', isEmergency: true, status: 'emergency' })]);
    expect(v.all().filter((n) => 'flexBasis' in n.style)).toEqual([]);
    expect(fnSrc('renderLeads')).not.toContain('flexBasis');
  });

  it('no phone, no button; an older lead, no button (R32)', async () => {
    const { cards } = await draw([lead({ id: 'NP', phone: null }), lead({ id: 'OLD', older: true, ageDays: 40 })]);
    for (const c of cards) expect(c.all().some((n) => n.has('callbtn'))).toBe(false);
  });

  it('Good lead / Spam keep their words and aria labels, and stay in the actions row', async () => {
    const { cards } = await draw([lead()]);
    const row = cards[0]!.children.find((n) => n.has('actions'))!;
    const btns = row.children.filter((n) => n.tag === 'button');
    expect(btns.map((b) => b.text())).toEqual(['Good lead', 'Spam']);
    expect(btns.map((b) => b.attrs['aria-label'])).toEqual(['Mark as a good lead', 'File as spam or wrong number']);
    expect(row.all().some((n) => n.has('callbtn'))).toBe(false);
  });

  it('spam still offers Undo, and Undo puts the pair back', async () => {
    const { cards, posts } = await draw([lead()]);
    const c = cards[0]!;
    await c.all().find((n) => n.has('bad'))!.click();
    const undo = c.all().find((n) => n.textContent === 'Undo')!;
    expect(undo).toBeTruthy();
    await undo.click();
    expect(c.all().filter((n) => n.has('ok') || n.has('bad'))).toHaveLength(2);
    expect(posts).toEqual(['/api/leads/L1/status', '/api/leads/L1/status']);
    // The round call button never left the top row.
    expect(c.all().filter((n) => n.has('callbtn') && n.parent!.has('toprow'))).toHaveLength(1);
  });

  it('what the customer said and past work fold to two lines, and a tap opens them', async () => {
    const { cards } = await draw([lead({ details: 'SIM words: a long note about the oak by the fence and when to call.', history: '2 past jobs' })]);
    const c = cards[0]!;
    const said = c.children.find((n) => n.textContent.startsWith('SIM words'))!;
    const past = c.children.find((n) => n.textContent === '2 past jobs')!;
    for (const n of [said, past]) {
      expect(n.has('scope') && n.has('clamp')).toBe(true);
      expect(n.has('open')).toBe(false);
    }
    await said.click();
    expect(said.has('open')).toBe(true);
    // The ruling lines never fold: an older lead's age line and the spam Undo line.
    const old = (await draw([lead({ older: true, ageDays: 40, filedAsEmergency: true })])).cards[0]!;
    expect(old.children.find((n) => n.textContent.startsWith('Older lead'))!.has('clamp')).toBe(false);
  });

  it('CSS: a 52 px round button, a visually hidden label, the two-line fold', () => {
    expect(css).toMatch(/\.callbtn\.round\{[^}]*width:52px;height:52px;[^}]*border-radius:50%/);
    expect(css).toMatch(/\.sr-only\{position:absolute;width:1px;height:1px;/);
    expect(css).toMatch(/\.clamp\{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden/);
    expect(css).toMatch(/\.clamp\.open\{display:block/);
  });

  it('Today\'s emergency card and the Sona cards keep their big worded Call back', () => {
    expect(fnSrc('emergencyLeadCard')).toContain("const call = el('a', 'callbtn', 'Call back');");
    expect(fnSrc('sonaPanel')).toContain("el('a', 'callbtn', 'Call back')");
    expect(html.match(/callbtn round/g)).toHaveLength(1);
  });
});
