// Direction B, P13 (docs/DIRECTION_B_PLAN.md; R29 #1: "split Queue into
// Follow-ups, Money, Fleet, Crew & safety, with the R26 desk name as the small
// line above each title"). The Queue was one long screen; now each job is a
// screen of its own: view-followups (Chief of Staff), view-money and view-fleet
// (Yard Boss), view-safety (Crew Chief). No view id is renamed or removed.
// Each new screen draws its head (DESK_LINE eyebrow, VIEW_TITLES title) before
// any read, then calls the panels the Queue held, unchanged — each still names
// its own dead feed in its own words (§1B). Every way in that went to the
// Queue lands on the new place: Today's tiles and hero (DESK_VIEW), Before you
// roll's rows, the agents' proposals (PROPOSAL_GO), More's tiles, and #queue.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadAppHtml } from '../src/server/appPage.js';
import { SECTION_AGENTS } from '../src/agents/sections.js';

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

class N {
  className = ''; id = ''; type = ''; hidden = false;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: N[] = [];
  parent: N | null = null;
  private own = '';
  constructor(readonly tag: string) {}
  get textContent(): string { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(t: string) { for (const c of this.children) c.parent = null; this.children = []; this.own = t; }
  has(c: string) { return this.className.split(/\s+/).includes(c); }
  appendChild(c: N): N { c.parent?.drop(c); c.parent = this; this.children.push(c); return c; }
  drop(c: N) { this.children = this.children.filter((x) => x !== c); c.parent = null; }
  remove() { this.parent?.drop(this); }
  replaceChildren(...ns: N[]) { for (const c of this.children) c.parent = null; this.children = []; this.own = ''; for (const n of ns) this.appendChild(n); }
  hasChildNodes() { return this.children.length > 0 || this.own !== ''; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener() {}
  all(): N[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}
const el = (tag: string, cls?: string, text?: string) => { const n = new N(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const readingLine = () => { const n = el('div', 'reading', 'Reading…'); n.setAttribute('role', 'status'); return n; };

const VIEW_TITLES = constVal<Record<string, string>>('VIEW_TITLES');
const DESKS = { money: 'renderMoneyView', fleet: 'renderFleetView', safety: 'renderSafetyView' } as const;

describe('the four desks are screens of their own (P13)', () => {
  it('VIEW_TITLES names them; every view id that existed is still there', () => {
    expect(VIEW_TITLES).toMatchObject({ followups: 'Follow-ups', money: 'Money', fleet: 'Fleet', safety: 'Crew & safety' });
    for (const id of ['learn', 'measure', 'agents', 'permits', 'today', 'leads', 'cal', 'book', 'followups', 'calls', 'perf', 'settings', 'more', 'assistant']) {
      expect(VIEW_TITLES, id).toHaveProperty(id);
      expect(html, id).toContain(`<div id="view-${id}" class="view`); // Today's carries "active" too
    }
    for (const id of ['money', 'fleet', 'safety']) expect(html, id).toContain(`<div id="view-${id}" class="view"></div>`);
  });

  it('DESK_LINE: the R26 desk name above each title, in one table (R27 can find it)', () => {
    // Direction B P14: Office's Teach Arbo tile reads its small line here too ("Learn", the plan's table); the R26 names are unchanged.
    expect(constVal('DESK_LINE')).toEqual({ followups: 'Chief of Staff', money: 'Yard Boss', fleet: 'Yard Boss', safety: 'Crew Chief', perf: 'Analyst', learn: 'Learn' });
    expect(fnSrc('deskView')).toContain("el('div', 'eyebrow', DESK_LINE[view])");
    expect(fnSrc('deskView')).toContain("el('h1', '', VIEW_TITLES[view])");
    expect(fnSrc('renderFollowUps')).toContain("el('div', 'eyebrow', DESK_LINE.followups)");
    expect(fnSrc('renderFollowUps')).toContain("el('h1', '', VIEW_TITLES.followups)");
    expect(fnSrc('renderPerformance')).toContain("el('div', 'eyebrow', DESK_LINE.perf)");
  });

  it('DOCK_OF says which dock tab lights: More for every desk (today\'s dock — the Office tab is P19), none for Settings', () => {
    const DOCK_OF = constVal<Record<string, string>>('DOCK_OF');
    for (const v of ['followups', 'money', 'fleet', 'safety', 'book', 'perf', 'more', 'permits', 'agents', 'measure', 'learn', 'assistant']) expect(DOCK_OF[v], v).toBe('more');
    expect(DOCK_OF).toMatchObject({ today: 'today', leads: 'leads', calls: 'calls', cal: 'cal' });
    expect(DOCK_OF).not.toHaveProperty('settings');
    expect(Object.keys(DOCK_OF).sort()).toEqual(Object.keys(VIEW_TITLES).filter((v) => v !== 'settings').sort());
  });

  it('switchTab takes its screens from VIEW_TITLES and the lit tab from DOCK_OF — the hand-kept lists are gone', () => {
    const sw = fnSrc('switchTab');
    expect(sw).toContain('Object.keys(VIEW_TITLES)');
    expect(sw).toContain('DOCK_OF[which]');
    expect(sw).not.toContain("['book', 'followups'");
    expect(sw).not.toContain("'measure', 'learn', 'assistant']");
  });

  it('NAV_PARENT: with nothing behind, Back from a desk lands on More', () => {
    expect(constVal<Record<string, string>>('NAV_PARENT')).toMatchObject({ followups: 'more', money: 'more', fleet: 'more', safety: 'more' });
  });

  it('the minute redraw and ↻ draw the three new screens (TIMED)', () => {
    const timed = /^const TIMED = \{(.*)\};$/m.exec(html)![1]!;
    expect(constKeys('TIMED')).toEqual(expect.arrayContaining(['followups', 'money', 'fleet', 'safety']));
    for (const [v, fn] of Object.entries(DESKS)) expect(timed).toContain(`${v}: ${fn}`);
  });

  it('#queue — never a link before — is an alias for More, where the four desks sit', () => {
    expect(constVal('VIEW_ALIAS')).toEqual({ queue: 'more' });
    const boot = html.slice(html.indexOf('// Home-screen shortcuts open a section directly'), html.indexOf('\nrefreshAll();'));
    expect(boot).toContain('VIEW_ALIAS');
  });
});

// ---------- each desk, run: its head before any read; Reading…; a newer draw owns it ----------
type Desk = { run: () => Promise<void>; v: N; log: string[]; settle: (i?: number) => void };
/** One desk render over stand-in panels: each panel logs its slot and whether the head was already drawn. */
function desk(view: keyof typeof DESKS, gen: Record<string, number> = {}): Desk {
  const v = el('div');
  const log: string[] = [];
  const pending: Array<() => void> = [];
  const panel = (name: string) => (slot: N) => {
    log.push(name + '#' + (slot.id || '-') + (v.children[0]?.has('viewhead') ? ':head-first' : ':no-head'));
    return new Promise<void>((res) => { pending.push(() => { slot.appendChild(el('div', 'card', name + ' drawn')); res(); }); });
  };
  const deps: Record<string, unknown> = {
    $: (id: string) => { expect(id).toBe('view-' + view); return v; }, el, readingLine, VIEW_TITLES, DESK_GEN: gen,
    DESK_LINE: constVal('DESK_LINE'),
    renderMoney: panel('money'), renderFleet: panel('fleet'), renderSafety: panel('safety'), renderRoster: panel('roster'),
    renderTrainingBoard: panel('training'), renderVetting: panel('vetting'), renderLibraryDesk: panel('library'),
  };
  const run = new Function(...Object.keys(deps), `${fnSrc('deskView')}\n${fnSrc(DESKS[view])}\nreturn ${DESKS[view]};`)(...Object.values(deps)) as () => Promise<void>;
  return { run, v, log, settle: (i?: number) => { if (i === undefined) pending.splice(0).forEach((f) => f()); else pending[i]!(); } };
}

describe('each desk draws its head before any read, then the Queue\'s panels, unchanged', () => {
  it('Money: Yard Boss over "Money", then the ledger in queue-money', async () => {
    const d = desk('money');
    const p = d.run();
    expect(d.log).toEqual(['money#queue-money:head-first']);
    const head = d.v.children[0]!;
    expect(head.children.map((c) => c.tag + ':' + c.className + ':' + c.textContent).slice(0, 2)).toEqual(['div:eyebrow:Yard Boss', 'h1::Money']);
    d.settle();
    await p;
  });

  it('Fleet: Yard Boss over "Fleet", then the units (with the Bouncie line) in queue-fleet', async () => {
    const d = desk('fleet');
    const p = d.run();
    expect(d.log).toEqual(['fleet#queue-fleet:head-first']);
    expect(d.v.children[0]!.children[0]!.textContent).toBe('Yard Boss');
    expect(d.v.children[0]!.children[1]!.textContent).toBe('Fleet');
    d.settle();
    await p;
  });

  it('Crew & safety: Crew Chief; the safety board (blind spots and aerial first) leads, then roster, training, lessons, library', async () => {
    const d = desk('safety');
    const p = d.run();
    expect(d.log).toEqual(['safety#queue-safety:head-first', 'roster#-:head-first', 'training#-:head-first', 'vetting#-:head-first', 'library#-:head-first']);
    expect(d.v.children[0]!.children[0]!.textContent).toBe('Crew Chief');
    expect(d.v.children[0]!.children[1]!.textContent).toBe('Crew & safety');
    d.settle();
    await p;
  });

  it('"Reading…" under the panels on a first draw until every panel has read — none on a redraw', async () => {
    const d = desk('safety');
    const p = d.run();
    const readings = () => d.v.all().filter((n) => n.has('reading')).length;
    expect(readings()).toBe(1);
    d.settle(0);
    await flush();
    expect(readings(), 'still reading the other four').toBe(1);
    d.settle();
    await p;
    expect(readings()).toBe(0);
    const again = d.run();
    expect(readings(), 'a redraw over a drawn screen says no Reading…').toBe(0);
    d.settle();
    await again;
  });

  it('overlapping draws never stack two screens: the newer one owns the view', async () => {
    const gen = {};
    const d = desk('money', gen);
    const p1 = d.run();
    const p2 = d.run();
    d.settle();
    await Promise.all([p1, p2]);
    expect(d.v.children.filter((c) => c.has('viewhead'))).toHaveLength(1);
    expect(d.v.textContent.match(/money drawn/g)).toHaveLength(1);
  });

  // UI review (b-wave-2, medium 2): the minute redraw emptied a desk without holding its height,
  // so the page collapsed to the heading and the scroll went to the top (Crew & safety 2678 → 0) —
  // undoing a Before you roll jump within 60 s. renderCalls' hold: keep the height until every
  // panel has landed, then let it go. A newer draw keeps its own hold.
  it('a redraw holds the screen\'s height until every panel has landed, so the scroll stays put', async () => {
    const d = desk('safety');
    Object.defineProperty(d.v, 'offsetHeight', { get: () => 2678 });
    const p = d.run();
    expect(d.v.style.minHeight).toBe('2678px');
    d.settle(0);
    await flush();
    expect(d.v.style.minHeight, 'four panels still out').toBe('2678px');
    d.settle();
    await p;
    expect(d.v.style.minHeight).toBe('');
  });

  // The browser re-run of that fix: scrolled to the very bottom of Money, the redraw still moved it 12 px
  // (388 → 376) — the last card's bottom margin collapsed out of the view, so offsetHeight left it out and
  // the held height came up short. On a phone the desks are their own block formatting context
  // (display:flow-root, layout-neutral: main's padding already stopped the collapse), so the hold is whole.
  it('on a phone the desks hold their whole height: no margin collapses out of the view (flow-root)', () => {
    expect(html).toContain('@media (max-width:899px){#view-followups.active,#view-money.active,#view-fleet.active,#view-safety.active{display:flow-root}}');
  });

  it('an older draw that lands late never lets go of a newer draw\'s hold', async () => {
    const gen = {};
    const d = desk('fleet', gen);
    Object.defineProperty(d.v, 'offsetHeight', { get: () => 827 });
    const p1 = d.run();
    const p2 = d.run();
    d.settle(0); // the older draw's panel lands first
    await p1;
    expect(d.v.style.minHeight, 'the newer draw is still reading').toBe('827px');
    d.settle();
    await p2;
    expect(d.v.style.minHeight).toBe('');
  });

  it('a panel that throws never takes the others on its desk down', async () => {
    const v = el('div');
    const drawn: string[] = [];
    const ok = (name: string) => async (slot: N) => { slot.appendChild(el('div', '', name)); drawn.push(name); };
    const deps: Record<string, unknown> = {
      $: () => v, el, readingLine, VIEW_TITLES, DESK_GEN: {}, DESK_LINE: constVal('DESK_LINE'),
      renderSafety: async () => { throw new Error('boom'); }, renderRoster: ok('roster'), renderTrainingBoard: ok('training'), renderVetting: ok('vetting'), renderLibraryDesk: ok('library'),
    };
    const run = new Function(...Object.keys(deps), `${fnSrc('deskView')}\n${fnSrc('renderSafetyView')}\nreturn renderSafetyView;`)(...Object.values(deps)) as () => Promise<void>;
    await run();
    expect(drawn).toEqual(['roster', 'training', 'vetting', 'library']);
    expect(v.all().some((n) => n.has('reading'))).toBe(false);
  });

  it('Follow-ups holds its height the same way until both its reads (loops, sends) have landed — a newer draw keeps its own', async () => {
    const v = el('div');
    Object.defineProperty(v, 'offsetHeight', { get: () => 1400 });
    const waits: Record<string, Array<(x: unknown) => void>> = {};
    const api = (p: string) => new Promise((res) => { (waits[p] ??= []).push(res); });
    const land = (p: string, i: number, x: unknown) => waits[p]![i]!(x);
    const stub = () => {};
    const deps: Record<string, unknown> = {
      $: () => v, el, readingLine, api, fmtTime: () => '', loopCard: () => el('div'), LINKS_READY: Promise.resolve('readonly'),
      feedLine: () => el('div'), showKeywall: stub, feedState: () => el('div'), state: () => el('div'), chip: () => el('span'),
      FU_LABEL: {}, showSaveFail: stub, document: { createTextNode: (t: string) => el('span', '', t) },
      DESK_LINE: constVal('DESK_LINE'), VIEW_TITLES,
    };
    const run = new Function(...Object.keys(deps), `let FU_GEN = 0;\n${fnSrc('renderFollowUps')}\nreturn renderFollowUps;`)(...Object.values(deps)) as () => Promise<void>;
    const p1 = run();
    expect(v.style.minHeight).toBe('1400px');
    land('/api/followups', 0, { due: [], suppressed: [] });
    await p1;
    expect(v.style.minHeight, 'the loops read is still out').toBe('1400px');
    land('/api/queue', 0, { open: [] });
    await flush();
    expect(v.style.minHeight).toBe('');
    // A newer draw starts; the older one's reads land late and must not let go of the newer hold.
    const p2 = run();
    const p3 = run();
    land('/api/queue', 1, { open: [] });
    land('/api/followups', 1, { due: [], suppressed: [] });
    await p2;
    await flush();
    expect(v.style.minHeight, 'the newest draw is still reading').toBe('1400px');
    land('/api/queue', 2, { open: [] });
    land('/api/followups', 2, { due: [], suppressed: [] });
    await p3;
    await flush();
    expect(v.style.minHeight).toBe('');
  });

  it('Follow-ups keeps the loops and the recommended sends — and only them', () => {
    const q = fnSrc('renderFollowUps');
    expect(q).toContain("loopsSlot.id = 'queue-loops';");
    expect(q).toContain("'Recommended sends'");
    for (const gone of ['renderSafety(', 'renderRoster(', 'renderTrainingBoard(', 'renderVetting(', 'renderLibraryDesk(', 'renderMoney(', 'renderFleet(', "'queue-money'", "'queue-fleet'", "'queue-safety'"]) {
      expect(q, gone).not.toContain(gone);
    }
  });
});

// ---------- a dead feed on one desk never touches another ----------
describe('a dead money feed does not touch Fleet', () => {
  it('Money names its ledger as cut; Fleet, its own screen, draws its units untouched', async () => {
    const views: Record<string, N> = { 'view-money': el('div'), 'view-fleet': el('div') };
    const FEED_WORD = constVal<Record<string, string>>('FEED_WORD');
    const api = async (p: string) => { if (p === '/api/money') throw Object.assign(new Error('link_cut'), { code: 503 }); throw new Error('unexpected ' + p); };
    const feedKind = new Function('LINKS', `${fnSrc('feedKind')}\nreturn feedKind;`)('readonly');
    const state = (t: string, m: string) => { const b = el('div', 'state'); b.appendChild(el('b', '', t)); b.appendChild(el('span', '', m)); return b; };
    const deps: Record<string, unknown> = {
      $: (id: string) => views[id], el, readingLine, VIEW_TITLES, DESK_GEN: {}, DESK_LINE: constVal('DESK_LINE'), api, LINKS_READY: Promise.resolve('readonly'),
      FEED_WORD, feedKind, state, feedSays: () => 'Nothing was deleted — it stays off until you reconnect it.',
      renderFleet: async (slot: N) => { slot.appendChild(el('div', 'card', 'Unit 1 · UP')); },
    };
    const built = new Function(...Object.keys(deps), `${fnSrc('deskView')}\n${fnSrc('renderMoney')}\n${fnSrc('renderMoneyView')}\n${fnSrc('renderFleetView')}\nreturn { renderMoneyView, renderFleetView };`)(...Object.values(deps)) as Record<string, () => Promise<void>>;
    await built.renderFleetView!();
    await built.renderMoneyView!();
    await flush();
    expect(views['view-money']!.textContent).toContain('Ledger — cut on purpose');
    expect(views['view-fleet']!.textContent).toContain('Unit 1 · UP');
    expect(views['view-fleet']!.textContent).not.toMatch(/Ledger|cut on purpose|Money/);
  });
});

// ---------- every way in lands on the new place ----------
describe('every link into the Queue lands on its desk (P13)', () => {
  it('PROPOSAL_GO: the plan\'s table — each proposal opens the desk where Mike acts on it', () => {
    const go = constVal<Record<string, [string, string]>>('PROPOSAL_GO');
    const target = Object.fromEntries(Object.entries(go).map(([k, [, t]]) => [k, t]));
    expect(target).toEqual({
      collections_review: 'money', parts_review: 'fleet', signback_review: 'fleet',
      fix_credentials: 'safety', lesson_draft: 'safety', vet_reference: 'safety', decide_open_loops: 'followups',
      area_review: 'perf', call_review: 'calls', route_fix: 'cal', weather_hold_review: 'cal',
    });
    expect(go.parts_review![0]).toBe('Open Fleet →');
    expect(go.collections_review![0]).toBe('Open Money →');
    expect(go.fix_credentials![0]).toBe('Open Crew & safety →');
    expect(go.decide_open_loops![0]).toBe('Open Follow-ups →');
    for (const [label] of Object.values(go)) expect(label).not.toContain('Queue');
  });

  it('every PROPOSAL_GO target is a screen the page can draw (TIMED or the step-back draw)', () => {
    const go = constVal<Record<string, [string, string]>>('PROPOSAL_GO');
    const drawable = [...constKeys('TIMED'), ...constKeys('NAV_DRAW')];
    for (const [k, [, t]] of Object.entries(go)) {
      expect(VIEW_TITLES, k).toHaveProperty(t);
      expect(drawable, k).toContain(t);
    }
  });

  it('DESK_VIEW re-pointed in one place: Today\'s tiles, the hero\'s loops and Before you roll land on the desks', () => {
    expect(constVal('DESK_VIEW')).toEqual({ loops: 'followups', money: 'money', fleet: 'fleet', safety: 'safety' });
    // The panel ids they aim at live on those desks.
    expect(fnSrc('renderFollowUps')).toContain("'queue-loops'");
    expect(fnSrc('renderMoneyView')).toContain("'queue-money'");
    expect(fnSrc('renderFleetView')).toContain("'queue-fleet'");
    expect(fnSrc('renderSafetyView')).toContain("'queue-safety'");
  });

  // Direction B P14: the four desks are Office's counted desk tiles now (OFFICE_DESKS, drawn by officeHub) — same
  // icons, each still opening its own desk (its tap is tested in directionB_office).
  it('More (Office since P14): four desk tiles where the Queue tile was, each opening its desk', () => {
    const desks = constVal<Array<{ view: string; icon: string }>>('OFFICE_DESKS');
    const icon = Object.fromEntries(desks.map((d) => [d.view, d.icon]));
    expect(icon.followups).toBe('i-queue');
    expect(icon.money).toBe('i-flag');
    // UI review (b-wave-2, low 6): Crew & safety wore the Assistant's shield and Fleet the Dispatcher's
    // route pin. Fleet is a truck (the mockup draws one); Crew & safety a safety cone (the hard hat is Crew's).
    expect(icon.fleet).toBe('i-truck');
    expect(icon.safety).toBe('i-cone');
    expect(fnSrc('officeHub')).toContain('switchTab(d.view)');
    expect(fnSrc('renderMore')).toContain('officeHub(v)');
    expect(fnSrc('renderMore')).not.toContain("'Queue'");
  });

  it('More (Office since P14): no two tiles share an icon, and every icon is in the sprite, drawn in its grammar', () => {
    const sprite = readFileSync(new URL('../src/app/sprite.svg', import.meta.url), 'utf8');
    const desks = constVal<Array<{ view: string; icon: string }>>('OFFICE_DESKS').map((d) => [d.icon, VIEW_TITLES[d.view]!] as const);
    const icons = [...desks, ...[...fnSrc('renderMore').matchAll(/tile\('(i-[a-z-]+)', '([^']+)'/g)].map((m) => [m[1]!, m[2]!] as const)];
    // Direction B P15: Book, Permits and Measure moved under Estimate (one Estimate tile) — the whole list, exactly.
    expect(icons.map(([, t]) => t)).toEqual(['Follow-ups', 'Money', 'Fleet', 'Crew & safety', 'Numbers', 'Teach Arbo', 'Assistant', 'Agents', 'Estimate', 'Crew', 'Phone line']);
    const seen = new Map<string, string>();
    for (const [ic, title] of icons) {
      expect(seen.get(ic), `${title} wears ${ic}, as ${seen.get(ic)} does`).toBeUndefined();
      seen.set(ic, title);
      expect(sprite, ic).toContain(`<symbol id="${ic}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">`);
    }
  });

  it('the breakdown sheet, once filed, redraws Fleet and Today — not the Follow-ups', () => {
    const bd = html.slice(html.indexOf("$('bd-go').addEventListener('click'"), html.indexOf('// ---------- Follow-ups'));
    expect(bd).toContain('renderFleetView();');
    expect(bd).toContain('renderToday();');
    expect(bd).not.toContain('renderFollowUps()');
    // Only after a filing that saved: the failure path returns before it.
    expect(bd.indexOf('renderFleetView();')).toBeGreaterThan(bd.indexOf("'Unit is now '"));
  });
});

// ---------- the words outside the page name the new screens ----------
describe('the desks\' names outside the page (P13)', () => {
  it('the section agents name the screen each works on', () => {
    const section = (id: string) => SECTION_AGENTS.find((a) => a.id === id)!.section;
    expect(section('chief-of-staff')).toBe('Today & Follow-ups');
    expect(section('yard-boss')).toBe('Money & Fleet');
    expect(section('crew-chief')).toBe('Crew & safety');
  });

  it('no proposal or input says "the Queue" any more', () => {
    const src = readFileSync(new URL('../src/agents/sections.ts', import.meta.url), 'utf8');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/on the Queue/);
  });

  it('docs/BOUNCIE.md says where the Fleet lines are now', () => {
    const doc = readFileSync(new URL('../docs/BOUNCIE.md', import.meta.url), 'utf8');
    expect(doc).not.toContain('Queue screen');
    expect(doc).toContain('On the Fleet screen each unit gets one line.');
  });
});

// ---------- the app bar says a desk's title whole (UI review of b-wave-2, medium 1) ----------
// At 390 the bar beside ‹ Back, Talk, the gear and ↻ leaves the title 97 px: "Follow-ups" (117 px at
// 21 px) read "Follow…" and "Crew & safety" (149) read "Crew …" — on a66f36d nothing was cut at 390.
// fitTitle steps a long title down on one line (21 → 16 px), then lets it take two lines (17 → 14 px);
// only past that floor does the old "…" rule cut it short.
describe('the app bar title fits whole (fitTitle)', () => {
  /** A stand-in #apptitle: text width scales with the font size; in two-line mode it wraps at spaces and after hyphens. */
  function titleBox(width: number, text: string) {
    const style: Record<string, string> = {};
    const cls = new Set<string>();
    let box = width;
    const px = () => parseFloat(style.fontSize || '21');
    const w = (s: string) => s.length * px() * 0.56;
    const lines = () => {
      if (!cls.has('two')) return [text];
      const out: string[] = [];
      for (const word of text.match(/[^\s-]+-?/g)!) {
        const last = out[out.length - 1];
        const join = last === undefined ? word : last + (last.endsWith('-') ? '' : ' ') + word;
        if (last !== undefined && w(join) <= box) out[out.length - 1] = join; else out.push(word);
      }
      return out;
    };
    const lh = () => px() * 1.1;
    const t = {
      style, textContent: text,
      classList: { contains: (c: string) => cls.has(c), toggle: (c: string, f: boolean) => { if (f) cls.add(c); else cls.delete(c); } },
      get scrollWidth() { return Math.ceil(Math.max(...lines().map(w))); },
      get clientWidth() { return box; },
      get scrollHeight() { return Math.ceil(lines().length * lh()); },
      get clientHeight() { return Math.ceil(Math.min(lines().length, cls.has('two') ? 2 : 1) * lh()); },
    };
    return { t, fits: () => t.scrollWidth <= t.clientWidth && t.scrollHeight <= t.clientHeight, lines, resize: (n: number) => { box = n; } };
  }
  const fit = (t: unknown) => new Function('$', `${fnSrc('fitTitle')}\nreturn fitTitle;`)(() => t) as () => void;

  it('a title that fits keeps the bar\'s own size (21 px, one line)', () => {
    for (const title of ['Leads', 'Money', 'Fleet', 'ARBO']) {
      const b = titleBox(97, title);
      fit(b.t)();
      expect(b.t.style.fontSize, title).toBe('');
      expect(b.t.classList.contains('two'), title).toBe(false);
    }
  });

  it('at 390 "Follow-ups" steps down on one line and shows whole — never "Follow…"', () => {
    const b = titleBox(97, 'Follow-ups');
    fit(b.t)();
    expect(b.t.classList.contains('two')).toBe(false);
    expect(parseFloat(b.t.style.fontSize ?? '')).toBeGreaterThanOrEqual(16);
    expect(parseFloat(b.t.style.fontSize ?? '')).toBeLessThan(21);
    expect(b.fits()).toBe(true);
  });

  it('at 390 "Crew & safety" takes two lines and shows whole — never "Crew …"', () => {
    const b = titleBox(97, 'Crew & safety');
    fit(b.t)();
    expect(b.t.classList.contains('two')).toBe(true);
    expect(parseFloat(b.t.style.fontSize ?? '')).toBeGreaterThanOrEqual(14);
    expect(b.lines()).toEqual(['Crew &', 'safety']);
    expect(b.fits()).toBe(true);
  });

  it('a wider bar (a rotated phone, Back gone) is fitted afresh: the title goes back to its own size', () => {
    const b = titleBox(97, 'Follow-ups');
    fit(b.t)();
    b.resize(200);
    fit(b.t)();
    expect(b.t.style.fontSize).toBe('');
    expect(b.t.classList.contains('two')).toBe(false);
  });

  it('past the floor (a 27 px box at 320) it is drawn as before — 21 px, one line, the "…" rule — no endless loop', () => {
    const b = titleBox(27, 'Crew & safety');
    fit(b.t)();
    expect(b.t.style.fontSize).toBe('');
    expect(b.t.classList.contains('two')).toBe(false);
    // The old one-line rule stays (the ellipsis), and two lines are clamped, never spilled.
    expect(html).toContain('#apptitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}');
    expect(html).toMatch(/#apptitle\.two\{[^}]*white-space:normal[^}]*-webkit-line-clamp:2[^}]*\}/);
  });

  it('it runs whenever the title or the room changes: every screen switch, a resize, the font landing', () => {
    const sw = fnSrc('switchTab');
    expect(sw.indexOf('fitTitle();')).toBeGreaterThan(sw.indexOf("$('apptitle').textContent = VIEW_TITLES[which] || 'ARBO';"));
    expect(sw.indexOf('fitTitle();')).toBeGreaterThan(sw.indexOf('navShowBack();')); // Back shown or hidden changes the room
    expect(html).toContain("window.addEventListener('resize', fitTitle);");
    expect(html).toContain('document.fonts.ready.then(fitTitle)');
  });
});
