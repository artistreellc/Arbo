// Direction B, P3 (docs/DIRECTION_B_PLAN.md; spec quick fix "Loading screens
// say 'Reading…' instead of looking empty"). Leads (blank while it read) and
// Calls (empty slots) say "Reading…" on their first draw only; a redraw keeps
// what is on screen until the read lands, then swaps the new draw in with one
// replaceChildren, so the minute's redraw never blinks. A failed read takes
// "Reading…"'s place with the named feed (§1B); a 401 goes to the key wall.
// The same "Reading…" sits where Book's list, Numbers, the Agents roster,
// Learn, the Permits facts and the Recommended sends land, on a first draw.
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

// ---------- a stand-in DOM that counts swaps ----------
class FNode {
  className = ''; title = ''; id = ''; offsetHeight = 0; href = ''; disabled = false;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FNode[] = [];
  parent: FNode | null = null;
  swaps = 0; // replaceChildren calls
  private own = '';
  constructor(readonly tag: string) {}
  get textContent(): string { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(t: string) { for (const c of this.children) c.parent = null; this.children = []; this.own = t; }
  get childNodes(): FNode[] { return [...this.children]; }
  private names(): string[] { return this.className.split(/\s+/).filter(Boolean); }
  has(c: string): boolean { return this.names().includes(c); }
  get classList() {
    return {
      add: (c: string) => { if (!this.has(c)) this.className = [...this.names(), c].join(' '); },
      remove: (c: string) => { this.className = this.names().filter((x) => x !== c).join(' '); },
      contains: (c: string) => this.has(c),
      toggle: (c: string, f?: boolean) => { if (f ?? !this.has(c)) this.classList.add(c); else this.classList.remove(c); },
    };
  }
  appendChild(c: FNode): FNode { c.parent?.drop(c); c.parent = this; this.children.push(c); return c; }
  drop(c: FNode): void { this.children = this.children.filter((x) => x !== c); c.parent = null; }
  remove(): void { this.parent?.drop(this); }
  replaceWith(n: FNode): void { const p = this.parent!; n.parent?.drop(n); p.children[p.children.indexOf(this)] = n; n.parent = p; this.parent = null; }
  replaceChildren(...ns: FNode[]): void { this.swaps++; for (const c of this.children) c.parent = null; this.children = []; this.own = ''; for (const n of ns) this.appendChild(n); }
  hasChildNodes(): boolean { return this.children.length > 0 || this.own !== ''; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  removeAttribute(k: string): void { delete this.attrs[k]; }
  getAttribute(k: string): string | null { return this.attrs[k] ?? null; }
  addEventListener(): void {}
  querySelector(): FNode | null { return null; }
  querySelectorAll(): FNode[] { return []; }
  all(): FNode[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}
const READING = 'Reading…';
const readings = (n: FNode) => n.all().filter((x) => x !== n && x.textContent === READING && x.children.length === 0).length;

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const cut = () => Object.assign(new Error('link_cut'), { code: 503 });

/** The page's helpers and one renderer, built together over one stand-in document. */
function kit(target: string, inject: Record<string, unknown>, links = 'readonly') {
  const ids = new Map<string, FNode>();
  const document = {
    createElement: (t: string) => new FNode(t),
    createTextNode: (t: string) => { const n = new FNode('#text'); n.textContent = t; return n; },
    getElementById: (id: string) => { if (!ids.has(id)) { const n = new FNode('div'); n.id = id; ids.set(id, n); } return ids.get(id)!; },
  };
  const consts = ['$', 'el', 'FEED_WORD', 'Cap', 'FEED_TAG', 'FEED_SAYS', 'RETRY', 'TONE', 'LEAD_OPEN', 'CONTACT_LINE'];
  if (/^const DESK_LINE = /m.test(html)) consts.push('DESK_LINE'); // Direction B P13: the desk names, one table
  consts.push('VIEW_TITLES'); // Direction B P15: a desk's h1 can be its screen title (the Book's is)
  const helpers = ['readingLine', 'state', 'feedKind', 'feedSays', 'feedLine', 'feedState', 'chip', 'badge', 'plural', 'fmtWhen', 'fmtTime', 'leadsTabBadge', 'permitChip', 'permitBadge', 'tapCount', 'keepsPage', 'clampLine'];
  const names = Object.keys(inject);
  const fn = new Function('document', 'linksIn', ...names, `
    ${'TIMER_REDRAW' in inject ? '' : 'let TIMER_REDRAW = false;'}
    ${'holdsTyping' in inject ? '' : fnSrc('holdsTyping')}
    let LINKS = linksIn;
    const LINKS_READY = Promise.resolve(linksIn);
    const PERMIT_STATE = {};
    ${consts.map(constSrc).join('\n')}
    ${helpers.map(fnSrc).join('\n')}
    ${fnSrc(target)}
    return ${target};`)(document, links, ...names.map((n) => inject[n])) as (...a: unknown[]) => Promise<unknown>;
  return { run: fn, $: (id: string) => document.getElementById(id) };
}

describe('readingLine: one place the word lives (R27 can find it)', () => {
  it('is a status line that says "Reading…"', () => {
    const k = kit('readingLine', {});
    const n = k.run() as unknown as FNode;
    expect(n.textContent).toBe(READING);
    expect(n.className).toBe('reading');
    expect(n.attrs.role).toBe('status');
  });
  it('on a wide screen (the two-column views) the line spans the row, as the feed lines do', () => {
    const wide = html.slice(html.indexOf('@media (min-width:900px){'));
    const rule = /\n {2}(\.view \.viewhead,[^{]*)\{grid-column:1 \/ -1\}/.exec(wide)!;
    expect(rule[1]!.split(',')).toContain('.view .feed-state');
    expect(rule[1]!.split(',')).toContain('.view .reading');
  });
  it('the word is written once in the page\'s code, in readingLine', () => {
    const code = html.replace(/^\s*\/\/.*$/gm, ''); // comments may quote it
    expect(code.match(/Reading…/g)).toHaveLength(1);
    expect(fnSrc('readingLine')).toContain("'Reading…'");
  });
});

describe('Leads: "Reading…" on the first draw; a redraw keeps the list until the read lands', () => {
  const lead = { id: 'L1', name: 'SIM-Elm, Test', phone: '+17575550101', city: 'Norfolk', zip: '23503', createdAt: '2026-10-18T14:00:00Z', status: 'new',
    isEmergency: false, needsCallback: false, isFirstTimer: true, quality: { priority: 'warm' }, permit: null, screenPending: false, permitUnreadable: false, history: null, historyUnreadable: false, details: null };
  function mount() {
    const reads: Array<Deferred<unknown>> = [];
    const walls: number[] = [];
    const k = kit('renderLeads', {
      api: () => { const d = deferred<unknown>(); reads.push(d); return d.promise; },
      showKeywall: () => walls.push(1), icon: () => new FNode('svg'), showSaveFail: () => {},
    }, 'simulation');
    return { k, reads, walls, v: k.$('view-leads') };
  }

  it('first draw: exactly one "Reading…" while the read is out, none after; the cards land', async () => {
    const s = mount();
    const p = s.k.run();
    expect(readings(s.v)).toBe(1);
    expect(s.v.children).toHaveLength(1);
    s.reads[0]!.resolve({ leads: [lead] });
    await p;
    expect(readings(s.v)).toBe(0);
    expect(s.v.children[0]!.id).toBe('lead-L1');
  });

  it('a read that fails replaces "Reading…" with the named feed (never "No new leads")', async () => {
    const s = mount();
    const p = s.k.run();
    s.reads[0]!.reject(cut());
    await p;
    expect(readings(s.v)).toBe(0);
    expect(s.v.textContent).toContain('Leads — cut on purpose');
    expect(s.v.textContent).not.toContain('No new leads');
  });

  it('a 401 takes "Reading…" away and hands off to the key wall', async () => {
    const s = mount();
    const p = s.k.run();
    s.reads[0]!.reject(Object.assign(new Error('unauthorized'), { code: 401 }));
    await p;
    expect(s.walls).toHaveLength(1);
    expect(readings(s.v)).toBe(0);
    expect(s.v.children).toHaveLength(0);
  });

  it('a redraw over drawn cards inserts no "Reading…", keeps the old cards up, then swaps once', async () => {
    const s = mount();
    const p1 = s.k.run();
    s.reads[0]!.resolve({ leads: [lead] });
    await p1;
    const old = s.v.children[0]!;
    const swapsBefore = s.v.swaps;
    const p2 = s.k.run();
    expect(readings(s.v)).toBe(0);
    expect(s.v.children[0]).toBe(old); // still on screen while the read is out
    expect(s.v.swaps).toBe(swapsBefore);
    s.reads[1]!.resolve({ leads: [{ ...lead, id: 'L2' }] });
    await p2;
    expect(s.v.swaps).toBe(swapsBefore + 1); // one replaceChildren
    expect(s.v.children.map((c) => c.id)).toEqual(['lead-L2']);
  });
});

describe('Calls: one "Reading…" while its reads are out; a redraw swaps in whole when they land', () => {
  function mount() {
    const reads = new Map<string, Array<Deferred<unknown>>>();
    const pending = (key: string) => { const d = deferred<unknown>(); (reads.get(key) ?? reads.set(key, []).get(key)!).push(d); return d.promise; };
    const k = kit('renderCalls', {
      api: (path: string) => pending(path),
      studyPanel: () => pending('study'), outreachPanel: () => pending('outreach'), sonaPanel: () => pending('sona'),
      fillQuoSlots: (rs: Array<Promise<FNode | null>>, slots: FNode[]) => Promise.allSettled(rs).then((xs) => xs.forEach((x, i) => { if (x.status === 'fulfilled' && x.value) slots[i]!.appendChild(x.value); })),
      showKeywall: () => {}, showSaveFail: () => {}, photoStrip: () => new FNode('div'),
    });
    const settle = (fail: boolean) => {
      const answer: Record<string, unknown> = {
        study: null, outreach: null, sona: null,
        '/api/webhooks/texts': { linkCut: true, wired: false, texts: [] },
        '/api/relay/call-notes': { notes: [] },
        '/api/webhooks/calls': { linkCut: true, wired: false, transcripts: [] },
        '/api/review/backlog?all=1&limit=20': { conversations: [] },
      };
      for (const [key, ds] of reads) { const d = ds.shift(); if (!d) continue; if (fail && key.startsWith('/api/')) d.reject(cut()); else d.resolve(answer[key]); }
    };
    return { k, settle, v: k.$('view-calls') };
  }

  it('first draw: exactly one "Reading…" (a card of its own) while the reads are out, none after', async () => {
    const s = mount();
    const p = s.k.run();
    expect(readings(s.v)).toBe(1);
    expect(s.v.children.every((n) => n.has('slot'))).toBe(true); // nothing floats loose, "Reading…" included
    s.settle(false);
    await p;
    await flush();
    expect(readings(s.v)).toBe(0);
    expect(s.v.textContent).toContain('Arbo’s own line');
  });

  it('reads that fail leave no "Reading…" and name each feed', async () => {
    const s = mount();
    const p = s.k.run();
    s.settle(true);
    await p;
    await flush();
    expect(readings(s.v)).toBe(0);
    expect(s.v.textContent).toContain('Texts: cut on purpose.');
    expect(s.v.textContent).toContain('Call log: cut on purpose.');
  });

  it('a redraw inserts no "Reading…", keeps the old page up while it reads, then swaps it in with one replaceChildren', async () => {
    const s = mount();
    const p1 = s.k.run();
    s.settle(false);
    await p1;
    await flush();
    const old = [...s.v.children];
    const swapsBefore = s.v.swaps;
    const p2 = s.k.run();
    expect(readings(s.v)).toBe(0);
    expect(s.v.children).toEqual(old); // the old page stays up
    s.settle(true);
    await p2;
    await flush();
    expect(s.v.swaps).toBe(swapsBefore + 1);
    expect(s.v.children).not.toContain(old[0]);
    expect(s.v.textContent).toContain('Call log: cut on purpose.');
    expect(s.v.style.minHeight).toBe(''); // the held height still lets go
  });
});

describe('"Reading…" where each desk\'s read lands, on a first draw', () => {
  const desks: Array<[string, string, Record<string, unknown>]> = [
    ['renderBook', 'view-book', { estimatePrepPanel: () => { const n = new FNode('div'); n.className = 'card'; return n; } }],
    ['renderPerformance', 'view-perf', {}],
    ['renderAgents', 'view-agents', { AGENT_GEN: 0, AGENT_RUN: null }],
    ['renderLearn', 'view-learn', { LEARN_GEN: 0 }],
  ];
  it.each(desks)('%s: one "Reading…" under the head while the read is out; the named feed takes its place', async (name, view, extra) => {
    const reads: Array<Deferred<unknown>> = [];
    const k = kit(name, { api: () => { const d = deferred<unknown>(); reads.push(d); return d.promise; }, showKeywall: () => {}, ...extra });
    const v = k.$(view);
    const p = k.run();
    expect(readings(v)).toBe(1);
    expect(v.children[0]!.has('viewhead')).toBe(true);
    for (const d of reads) d.reject(cut());
    await p;
    expect(readings(v)).toBe(0);
    expect(v.textContent).toContain('cut on purpose');
  });

  it.each(desks)('%s: a redraw over a drawn screen says no "Reading…"', async (name, view, extra) => {
    const k = kit(name, { api: () => new Promise(() => {}), showKeywall: () => {}, ...extra });
    const v = k.$(view);
    v.appendChild(new FNode('div')); // drawn before
    void k.run();
    await flush();
    expect(readings(v)).toBe(0);
  });

  it('Permits: the facts read has "Reading…" in its place on a first draw, removed on every way out', () => {
    const p = fnSrc('renderPermits');
    expect(p).toMatch(/const first = !v\.hasChildNodes\(\);.*\n\s+v\.replaceChildren\(\);/);
    const at = p.indexOf('const reading = first ? v.appendChild(readingLine()) : null;');
    expect(at).toBeGreaterThan(p.indexOf('v.appendChild(job);'));
    expect(at).toBeLessThan(p.indexOf("api('/api/permits/db?city="));
    expect(p).toContain("api('/api/permits/db?city=' + encodeURIComponent(PERMIT_CITY)).finally(() => { if (reading) reading.remove(); })");
  });

  it('Recommended sends: "Reading…" sits in their own slot on a first draw, never on the page itself', () => {
    const q = fnSrc('renderFollowUps');
    expect(q).toContain('const reading = first ? fuSlot.appendChild(readingLine()) : null;');
    expect(q.indexOf('const reading = first')).toBeGreaterThan(q.indexOf('fuSlot.appendChild(note);'));
    expect(q.indexOf('const reading = first')).toBeLessThan(q.indexOf("api('/api/followups')"));
    expect(q).toContain("api('/api/followups').finally(() => { if (reading) reading.remove(); })");
  });
});

// ---------- review (UI 1): a tap while a redraw reads is never thrown away ----------
// P3 left the old cards up, still tappable, while a redraw read — then swapped
// in a list read BEFORE the tap: a spam Undo vanished (R23 says filing spam can
// be undone), a "Good lead ✓" reverted on screen, a failed-save line went.
// Now the swap waits: a tap on the page since the redraw began (counted by a
// capture listener on the view), or — for the minute timer's redraw — a page
// that holdsTyping when the read lands, keeps the page as Mike left it. The
// next redraw brings it up to date. ↻ still redraws a held page; a first draw
// always lands.
/** What the page's capture listener does on a tap anywhere in the view. */
const tap = (v: FNode) => { v.dataset.taps = String(Number(v.dataset.taps || 0) + 1); };

describe('Leads: a tap on the old cards while a redraw reads keeps them (review UI 1)', () => {
  const lead = { id: 'L1', name: 'SIM-Elm, Test', phone: '+17575550101', city: 'Norfolk', zip: '23503', createdAt: '2026-10-18T14:00:00Z', status: 'new',
    isEmergency: false, needsCallback: false, isFirstTimer: true, quality: { priority: 'warm' }, permit: null, screenPending: false, permitUnreadable: false, history: null, historyUnreadable: false, details: null };
  function mount(extra: Record<string, unknown> = {}) {
    const reads: Array<Deferred<unknown>> = [];
    const k = kit('renderLeads', {
      api: () => { const d = deferred<unknown>(); reads.push(d); return d.promise; },
      showKeywall: () => {}, icon: () => new FNode('svg'), showSaveFail: () => {}, ...extra,
    }, 'simulation');
    return { k, reads, v: k.$('view-leads') };
  }
  async function drawn(s: ReturnType<typeof mount>) {
    const p = s.k.run();
    s.reads[0]!.resolve({ leads: [lead] });
    await p;
    return s.v.children[0]!;
  }

  it.each([
    ['a read that lands', (d: Deferred<unknown>) => d.resolve({ leads: [{ ...lead, id: 'L2' }] })],
    ['a read that fails', (d: Deferred<unknown>) => d.reject(cut())],
    ['a read that comes back empty', (d: Deferred<unknown>) => d.resolve({ leads: [] })],
  ] as Array<[string, (d: Deferred<unknown>) => void]>)('tapped while it read, %s leaves the tapped cards on screen', async (_why, land) => {
    const s = mount();
    const old = await drawn(s);
    const swaps = s.v.swaps;
    const p = s.k.run();
    tap(s.v); // Spam, Good lead, Undo — any tap on the old cards
    land(s.reads[1]!);
    await p;
    expect(s.v.children[0]).toBe(old);
    expect(s.v.swaps).toBe(swaps);
  });

  it('the minute timer\'s redraw keeps a page that is held when its read lands (a spam filed while it read: its Undo stays)', async () => {
    let held = false;
    const s = mount({ TIMER_REDRAW: true, holdsTyping: () => held });
    const old = await drawn(s);
    const p = s.k.run();
    held = true; // the spam write came back and the Undo is on the card
    s.reads[1]!.resolve({ leads: [{ ...lead, id: 'L2' }] });
    await p;
    expect(s.v.children[0]).toBe(old);
  });

  it('↻ (not the timer) still redraws a held page — "Undo stays about 2 minutes, or until you tap ↻"', async () => {
    const s = mount({ holdsTyping: () => true });
    await drawn(s);
    const p = s.k.run();
    s.reads[1]!.resolve({ leads: [{ ...lead, id: 'L2' }] });
    await p;
    expect(s.v.children.map((c) => c.id)).toEqual(['lead-L2']);
  });

  it('a tap that starts the redraw itself does not hold it, and no tap swaps as before', async () => {
    const s = mount();
    await drawn(s);
    tap(s.v); // the tap's own handler then redraws (as Calls' "Don't text" does)
    const p = s.k.run();
    s.reads[1]!.resolve({ leads: [{ ...lead, id: 'L2' }] });
    await p;
    expect(s.v.children.map((c) => c.id)).toEqual(['lead-L2']);
  });

  it('a first draw always lands, tap or not', async () => {
    const s = mount();
    const p = s.k.run();
    tap(s.v);
    s.reads[0]!.resolve({ leads: [lead] });
    await p;
    expect(readings(s.v)).toBe(0);
    expect(s.v.children[0]!.id).toBe('lead-L1');
  });
});

describe('Calls: a tap on the old page while a redraw reads keeps it (review UI 1)', () => {
  function mount(extra: Record<string, unknown> = {}) {
    const reads = new Map<string, Array<Deferred<unknown>>>();
    const pending = (key: string) => { const d = deferred<unknown>(); (reads.get(key) ?? reads.set(key, []).get(key)!).push(d); return d.promise; };
    const k = kit('renderCalls', {
      api: (path: string) => pending(path),
      studyPanel: () => pending('study'), outreachPanel: () => pending('outreach'), sonaPanel: () => pending('sona'),
      fillQuoSlots: (rs: Array<Promise<FNode | null>>, slots: FNode[]) => Promise.allSettled(rs).then((xs) => xs.forEach((x, i) => { if (x.status === 'fulfilled' && x.value) slots[i]!.appendChild(x.value); })),
      showKeywall: () => {}, showSaveFail: () => {}, photoStrip: () => new FNode('div'), ...extra,
    });
    const settle = () => {
      const answer: Record<string, unknown> = {
        study: null, outreach: null, sona: null,
        '/api/webhooks/texts': { linkCut: true, wired: false, texts: [] },
        '/api/relay/call-notes': { notes: [] },
        '/api/webhooks/calls': { linkCut: true, wired: false, transcripts: [] },
        '/api/review/backlog?all=1&limit=20': { conversations: [] },
      };
      for (const [key, ds] of reads) { const d = ds.shift(); if (d) d.resolve(answer[key]); }
    };
    return { k, settle, v: k.$('view-calls') };
  }
  async function redraw(s: ReturnType<typeof mount>, during: () => void) {
    const p1 = s.k.run();
    s.settle();
    await p1;
    await flush();
    const old = [...s.v.children];
    const swaps = s.v.swaps;
    const p2 = s.k.run();
    during();
    s.settle();
    await p2;
    await flush();
    return { old, swaps };
  }

  it('tapped while it read (Mark reviewed, a transcript opened): the old page stays, and the held height lets go', async () => {
    const s = mount();
    const { old, swaps } = await redraw(s, () => tap(s.v));
    expect(s.v.children).toEqual(old);
    expect(s.v.swaps).toBe(swaps);
    expect(s.v.style.minHeight).toBe('');
  });

  it('the minute timer\'s redraw keeps a page that is held when its reads land', async () => {
    let held = false;
    const s = mount({ TIMER_REDRAW: true, holdsTyping: () => held });
    const { old } = await redraw(s, () => { held = true; });
    expect(s.v.children).toEqual(old);
  });

  it('no tap: the redraw swaps in whole, as before', async () => {
    const s = mount();
    const { old, swaps } = await redraw(s, () => {});
    expect(s.v.swaps).toBe(swaps + 1);
    expect(s.v.children).not.toContain(old[0]);
  });
});

describe('the page counts taps on Leads and Calls, and the minute timer marks its own redraws (review UI 1)', () => {
  it('a capture listener on each view counts every tap before any button\'s own handler runs', () => {
    expect(html).toMatch(/for \(const t of \['leads', 'calls'\]\) \$\('view-' \+ t\)\.addEventListener\('click', \(e\) => \{ e\.currentTarget\.dataset\.taps = String\(tapCount\(e\.currentTarget\) \+ 1\); \}, true\);/);
  });
  it('autoRefresh marks the redraws it starts, and lets go even if one throws', () => {
    expect(fnSrc('autoRefresh')).toMatch(/TIMER_REDRAW = true;\n\s+try \{ for \(const t in TIMED\) if \(!holdsTyping\(\$\('view-' \+ t\)\)\) TIMED\[t\]\(\); \} finally \{ TIMER_REDRAW = false; \}/);
  });
  it('each redraw reads the mark and the tap count before its first await', () => {
    for (const name of ['renderLeads', 'renderCalls']) {
      const f = fnSrc(name);
      const at = f.indexOf('const taps0 = tapCount(v), byTimer = TIMER_REDRAW;');
      expect(at, name).toBeGreaterThan(-1);
      expect(at, name).toBeLessThan(f.indexOf('await '));
    }
  });
});
