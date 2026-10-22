// Direction B, P10 (docs/DIRECTION_B_PLAN.md; spec quick fix "Today's count tiles
// open what they count; the hero's three stats are tappable; weather that
// couldn't be read is a dashed, untappable tile that says so — never a zero").
// The hero's stats are buttons: HERO.go(key, fn) says where a tap lands; a '–'
// stat is .gap — dashed, aria-disabled, worded with its feed word, no handler.
// Weather at a real 0 stays inert but not dashed (a real zero is a fact).
// Tiles: goTile(t, fn); a tile whose feed failed (tileWhy over a '–') is dashed
// and inert. Every target is a DESK_VIEW desk or a VIEW_TITLES screen, opened
// through openPanel (switch, find with retries, scroll, flash — openSonaCall's way).
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';

const html = loadAppHtml();
function fnSrc(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
const VIEW_TITLES = new Function(`return ${/^const VIEW_TITLES = (\{.*\});$/m.exec(html)![1]};`)() as Record<string, string>;

class E {
  className = ''; type = ''; tabIndex = -1; id = '';
  children: E[] = [];
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  on: Record<string, Array<(e?: unknown) => void>> = {};
  scrolled: unknown[] = [];
  private text = '';
  constructor(readonly tag: string) {}
  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(''); }
  set textContent(t: string) { this.text = t; this.children = []; }
  get offsetWidth() { return 1; }
  has(c: string) { return this.className.split(/\s+/).includes(c); }
  get classList() {
    return {
      add: (c: string) => { if (!this.has(c)) this.className = (this.className + ' ' + c).trim(); },
      remove: (c: string) => { this.className = this.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
      contains: (c: string) => this.has(c),
    };
  }
  appendChild(n: E) { this.children.push(n); return n; }
  hasChildNodes() { return this.children.length > 0; }
  replaceChildren(...n: E[]) { this.text = ''; this.children = [...n]; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  addEventListener(t: string, f: (e?: unknown) => void) { (this.on[t] ??= []).push(f); }
  click() { for (const f of this.on.click ?? []) f({ preventDefault() {} }); }
  marginAtScroll: string[] = [];
  height = 0;
  scrollIntoView(o: unknown) { this.scrolled.push(o); this.marginAtScroll.push(this.style.scrollMarginTop ?? ''); }
  getBoundingClientRect() { return { height: this.height, top: 0, bottom: this.height }; }
  querySelector(tag: string): E | null {
    for (const c of this.children) { if (c.tag === tag) return c; const d = c.querySelector(tag); if (d) return d; }
    return null;
  }
  all(): E[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}
const el = (tag: string, cls?: string, text?: string) => { const n = new E(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

type Hero = { stat: (k: string, v: unknown, c: string, f: string, note?: string) => void; go: (k: string, fn: () => void) => void };
function hero() {
  const ring = { svg: el('svg'), set: () => {}, clock: () => {} };
  const { box, HERO } = new Function('el', 'dayRing', 'dayFraction', `let HERO = null;\n${fnSrc('buildHero')}\nconst box = buildHero();\nreturn { box, HERO };`)(el, () => ring, () => 0.5) as { box: E; HERO: Hero };
  const cells = box.all().filter((n) => n.has('hstat'));
  return { box, HERO, cell: (i: number) => cells[i]! };
}

describe('the hero\'s three stats open what they count (P10)', () => {
  it('each stat is a button, inert until a read lands and HERO.go names where it goes', () => {
    const h = hero();
    for (const i of [0, 1, 2]) {
      expect(h.cell(i).tag).toBe('button');
      expect(h.cell(i).type).toBe('button');
      expect(h.cell(i).getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('a read number with a target: a tap opens it', () => {
    const h = hero();
    let opened = 0;
    h.HERO.stat('stops', 3, '', '3 stops today');
    h.HERO.go('stops', () => { opened++; });
    expect(h.cell(0).getAttribute('aria-disabled')).toBe('false');
    h.cell(0).click();
    expect(opened).toBe(1);
  });

  it('a "–" stat is a gap: dashed (.gap), aria-disabled, worded with its feed word, and a tap opens nothing', () => {
    const h = hero();
    let opened = 0;
    h.HERO.go('loops', () => { opened++; });
    h.HERO.stat('loops', '–', '', 'loops cut');
    const c = h.cell(1);
    expect(c.has('gap')).toBe(true);
    expect(c.getAttribute('aria-disabled')).toBe('true');
    expect(c.getAttribute('aria-label')).toContain('loops cut');
    expect(c.querySelector('small')!.textContent).toBe(''); // the note never carries it; the subline names it (qa3 #25)
    c.click();
    expect(opened).toBe(0);
    // Read again, and it opens.
    h.HERO.stat('loops', 2, 'warn', '2 open loops');
    expect(c.has('gap')).toBe(false);
    c.click();
    expect(opened).toBe(1);
  });

  it('weather at a real 0 is inert but never dashed — a real zero is a fact', () => {
    const h = hero();
    h.HERO.stat('alerts', 0, '', 'no weather alerts');
    const c = h.cell(2);
    expect(c.has('gap')).toBe(false);
    expect(c.getAttribute('aria-disabled')).toBe('true');
    expect(c.className).toBe('hstat');
  });

  // Review (b-wave-1b, UI 10): "1 weather alerts", "1 stops today" on the screen-reader name.
  it('the screen-reader name counts in good English: one stop, one loop, one alert', () => {
    const h = hero();
    h.HERO.stat('stops', 1, '', '1 stop today');
    h.HERO.stat('loops', 1, 'warn', '1 open loop');
    h.HERO.stat('alerts', 1, 'hot', '1 weather alert');
    expect([0, 1, 2].map((i) => h.cell(i).getAttribute('aria-label'))).toEqual(['1 stop today', '1 open loop', '1 weather alert']);
    h.HERO.stat('stops', 2, '', '2 stops today');
    h.HERO.stat('alerts', 0, '', 'no weather alerts');
    expect(h.cell(0).getAttribute('aria-label')).toBe('2 stops today');
    expect(h.cell(2).getAttribute('aria-label')).toBe('0 weather alerts');
    // The label on the tile itself is unchanged (qa3_today-rest pins it).
    expect(h.cell(0).querySelector('span')!.textContent).toBe('stops today');
  });

  // Review (b-wave-1b, UI 9; mockup B-0): solid against dashed was the only sign a stat
  // opens something. A tappable stat or tile carries a › — hidden from screen readers,
  // drawn only while it can be tapped (a gap or an inert real 0 never shows it).
  it('a stat or a tile that opens something carries a › cue; the CSS shows it only while it can be tapped', () => {
    const h = hero();
    for (const i of [0, 1, 2]) {
      const cue = h.cell(i).all().find((n) => n.has('cue'))!;
      expect(cue, 'each stat has its cue').toBeTruthy();
      expect(cue.textContent).toBe('›');
      expect(cue.getAttribute('aria-hidden')).toBe('true');
    }
    const goTile = new Function('el', `${fnSrc('goTile')}\nreturn goTile;`)(el) as (t: E, fn: () => void) => void;
    const t = el('div', 'tile'); t.appendChild(el('b', '', '3')); t.appendChild(el('span', '', 'x'));
    goTile(t, () => {});
    const cue = t.all().find((n) => n.has('cue'))!;
    expect(cue, 'the tile has its cue').toBeTruthy();
    expect(cue.textContent).toBe('›');
    expect(cue.getAttribute('aria-hidden')).toBe('true');
    expect(t.querySelector('span')!.textContent, 'the label is still the first span').toBe('x');
    expect(html).toMatch(/\.hstat \.cue\{[^}]*display:none/);
    expect(html).toMatch(/\.hstat\[aria-disabled="false"\] \.cue\{[^}]*display:block/);
    expect(html).toMatch(/\.tile \.cue\{[^}]*display:none/);
    expect(html).toMatch(/\.tile\.go:not\(\.gap\) \.cue\{[^}]*display:block/);
  });

  it('CSS: a gap stat and a gap tile are dashed; a live one shows it can be tapped', () => {
    expect(html).toMatch(/\.hstat\.gap\{[^}]*border-style:dashed/);
    expect(html).toMatch(/\.tile\.gap\{[^}]*border-style:dashed/);
    expect(html).toMatch(/button\.hstat\{[^}]*min-height:44px/);
  });
});

describe('openPanel: switch, find (retrying while the screen draws), scroll, flash', () => {
  function world(cur: string, drawn: Record<string, boolean> = {}) {
    const went: string[] = [];
    const drew: string[] = [];
    const nodes: Record<string, E> = {};
    const views: Record<string, E> = {};
    const $ = (id: string) => { if (id.startsWith('view-')) { const v = views[id] ??= el('div'); if (drawn[id.slice(5)]) v.children = [el('div')]; return v; } return nodes[id] ?? null; };
    const timers: Array<() => void> = [];
    const NAV_DRAW = { agents: () => drew.push('agents'), more: () => drew.push('more') };
    const bar = el('header'); bar.height = 65;
    const open = new Function('switchTab', '$', 'CUR_TAB', 'NAV_DRAW', 'setTimeout', 'document', `${fnSrc('openPanel')}\nreturn openPanel;`)(
      (t: string) => went.push(t), $, cur, NAV_DRAW, (f: () => void) => timers.push(f), { getElementById: (id: string) => (id === 'appbar' ? bar : nodes[id] ?? null) },
    ) as (view: string, target?: string | (() => E | null)) => void;
    return { open, went, drew, nodes, timers, hasChildren: (v: string) => ($('view-' + v) as E) };
  }

  it('a screen with no panel named: it switches there', () => {
    const w = world('today');
    w.open('book');
    expect(w.went).toEqual(['book']);
  });

  it('a desk never drawn is drawn first (the step-back draw), then shown', () => {
    const w = world('today');
    w.open('agents');
    expect(w.drew).toEqual(['agents']);
    expect(w.went).toEqual(['agents']);
    const d = world('today', { agents: true });
    d.open('agents');
    expect(d.drew).toEqual([]);
  });

  it('a panel not drawn yet is looked for again, then scrolled to and flashed', () => {
    const w = world('today');
    w.open('followups', 'queue-money');
    expect(w.went).toEqual(['followups']);
    expect(w.timers).toHaveLength(1);
    w.timers.shift()!();
    const slot = el('div');
    w.nodes['queue-money'] = slot;
    w.timers.shift()!();
    expect(slot.scrolled).toHaveLength(1);
    expect(slot.has('flash')).toBe(true);
  });

  it('on the same screen it does not switch; a finder can name the panel', () => {
    const w = world('today');
    const card = el('div', 'card emergency');
    w.open('today', () => card);
    expect(w.went).toEqual([]);
    expect(card.scrolled).toHaveLength(1);
  });

  // Review (b-wave-1b, UI 2): block:'start' with no margin put the item's top 65 px under
  // the sticky app bar — "SIM Chipper is DOWN" landed with its name and chip hidden.
  it('the item lands below the sticky app bar, its whole top in sight', () => {
    const w = world('today');
    const card = el('div', 'card');
    w.open('today', () => card);
    expect(card.marginAtScroll).toEqual(['77px']); // the bar's 65 px and a 12 px breath, set before the scroll
    expect(card.scrolled).toEqual([{ behavior: 'smooth', block: 'start' }]);
  });

  it('a miss gives up after a few seconds — still on the right screen', () => {
    const w = world('today');
    w.open('followups', 'nowhere');
    let n = 0;
    while (w.timers.length && n < 100) { w.timers.shift()!(); n++; }
    expect(n).toBeLessThan(40);
    expect(w.went).toEqual(['followups']);
  });
});

describe('goTile: a tile opens what it counts; a gap tile opens nothing', () => {
  const goTile = new Function('el', `${fnSrc('goTile')}\nreturn goTile;`)(el) as (t: E, fn: () => void) => void;
  const tile = (n: string) => { const t = el('div', 'tile'); t.appendChild(el('b', '', n)); t.appendChild(el('span', '', 'x')); return t; };

  it('a read tile is a button that opens its target', () => {
    const t = tile('3');
    let opened = 0;
    goTile(t, () => { opened++; });
    expect(t.getAttribute('role')).toBe('button');
    expect(t.tabIndex).toBe(0);
    expect(t.has('go')).toBe(true);
    t.click();
    expect(opened).toBe(1);
  });

  it('a "–" tile (a feed not read) opens nothing', () => {
    const t = tile('–');
    let opened = 0;
    goTile(t, () => { opened++; });
    t.click();
    expect(opened).toBe(0);
  });
});

describe('every tap target on Today is a DESK_VIEW desk or a real screen (source pins)', () => {
  const today = fnSrc('renderToday');
  const DESK_VIEW = new Function(`return ${/^const DESK_VIEW = (\{.*\});$/m.exec(html)![1]};`)() as Record<string, string>;

  it('DESK_VIEW names the four desks — P13 split the Queue and re-pointed them — and each desk\'s slot carries its id', () => {
    expect(DESK_VIEW).toEqual({ loops: 'followups', money: 'money', fleet: 'fleet', safety: 'safety' });
    expect(fnSrc('renderFollowUps')).toContain("'queue-loops'");
    expect(fnSrc('renderMoneyView')).toContain("'queue-money'");
    expect(fnSrc('renderFleetView')).toContain("'queue-fleet'");
    expect(fnSrc('renderSafetyView')).toContain("'queue-safety'");
  });

  it('every goTile and HERO.go hands its tap to openPanel, aimed at DESK_VIEW or a VIEW_TITLES key', () => {
    const src = [today, fnSrc('heroLoops')].join('\n');
    const calls = [...src.matchAll(/(?:goTile\([^,]+|HERO\.go\('[a-z]+'), \(\) => openPanel\(([^,)]+)/g)].map((m) => m[1]!.trim());
    expect(calls.length).toBeGreaterThanOrEqual(10);
    for (const t of calls) {
      const desk = /^DESK_VIEW\.([a-z]+)$/.exec(t);
      const lit = /^'([a-z]+)'$/.exec(t);
      expect(desk || lit, t).toBeTruthy();
      if (desk) expect(DESK_VIEW, t).toHaveProperty(desk[1]!);
      if (lit) expect(VIEW_TITLES, t).toHaveProperty(lit[1]!);
    }
    // No tap target bypasses openPanel.
    expect([...src.matchAll(/goTile\(/g)].length).toBe([...src.matchAll(/goTile\([^,]+, \(\) => openPanel\(/g)].length);
  });

  it('the targets are the plan\'s: the run, Book, Agents, Money, the emergency card, the flagged stop; loops and weather', () => {
    expect(today).toMatch(/goTile\(jobsTile, \(\) => openPanel\('today', runAt\)\)/);
    expect(today).toMatch(/goTile\(estTile, \(\) => openPanel\('today', runAt\)\)/);
    expect(today).toMatch(/HERO\.go\('stops', \(\) => openPanel\('today', runAt\)\)/);
    expect(today).toContain("goTile(dueTile, () => openPanel('book'))");
    expect(today).toContain("goTile(agentTile, () => openPanel('agents'))");
    expect(today).toContain("goTile(owedTile, () => openPanel(DESK_VIEW.money, 'queue-money'))");
    expect(today).toContain("goTile(billTile, () => openPanel(DESK_VIEW.money, 'queue-money'))");
    expect(today).toMatch(/goTile\(emgTile, \(\) => openPanel\('today', /);
    expect(today).toMatch(/goTile\(hud\.firstChild, \(\) => openPanel\('today', /);
    expect(today).toMatch(/HERO\.go\('alerts', \(\) => openPanel\('today', 'today-storm'\)\)/);
    expect(fnSrc('heroLoops')).toContain("HERO.go('loops', () => openPanel(DESK_VIEW.loops, 'queue-loops'))");
  });

  // Review (b-wave-2, correctness 1): "All N open loops →" switched to 'followups' with no
  // guard — pointed at More, every test stayed green. It goes where the hero's loops stat
  // goes, through the same table, and lands on the loops panel (flashed), not the screen top.
  it('"All N open loops →" opens the open loops on Follow-ups, through DESK_VIEW like the hero\'s loops stat', () => {
    const at = today.indexOf("const more = el('button', 'hudbtn', tf('All {n} open loops →', { n: q.open.length }));"); // R27 Phase A (es-owner-a)
    expect(at).toBeGreaterThan(-1);
    const wire = today.slice(at, today.indexOf('loopsPanel.appendChild(more);', at));
    expect(wire).toContain("more.addEventListener('click', () => openPanel(DESK_VIEW.loops, 'queue-loops'));");
    expect(wire).not.toContain('switchTab(');
  });

  it('a target is set only where its read succeeded — never in a failure path', () => {
    const brief = today.indexOf("api('/api/brief?from=");
    const caught = today.slice(brief, today.indexOf('const s = brief.summary;'));
    expect(caught).not.toMatch(/goTile\(|HERO\.go\(/);
    expect(today.indexOf("goTile(dueTile")).toBeGreaterThan(today.indexOf('setTile(dueTile, p.comingDue.length'));
    expect(today.indexOf("goTile(dueTile")).toBeLessThan(today.indexOf("else tileWhy(dueTile, T('forecast unreadable'))"));
    const loops = fnSrc('heroLoops');
    expect(loops.indexOf("HERO.go('loops'")).toBeLessThan(loops.indexOf('.catch('));
  });

  it('a tile whose feed failed is marked a gap where its "–" stays', () => {
    expect(today).toMatch(/const tileWhy = \(t, why\) => \{[^\n]*if \(t\.querySelector\('b'\)\.textContent === '–'\) t\.classList\.add\('gap'\);/);
  });

  it('the pinned tile shapes are kept', () => {
    expect(today).toContain("const jobsTile = tile('–', T('jobs today'));");
    expect(today).toContain("hud.prepend(tile(s.redFlagCount, s.redFlagCount === 1 ? T('flagged stop') : T('flagged stops'), 'hot wide'))");
  });
});
