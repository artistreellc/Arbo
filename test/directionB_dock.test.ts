// Direction B, P19 (docs/DIRECTION_B_PLAN.md; R29 #1: "The dock becomes Today · Leads ·
// Calendar · Estimate · Office"). The dock flips once: five visible buttons in that
// order (Estimate a new tab, Office the More button relabelled); the old buttons stay
// as dock-hidden so every link to them keeps working. One DOCK_OF table says which tab
// lights; NAV_PARENT says where Back lands with nothing behind. The boot reads the
// hash through startView(hash), drawn the way a step back draws (navShow), so the
// plan's whole deep-link table is run here: where each link lands, which tab lights,
// and where Back goes from there. The words that named the old screens move with them
// ("Office → Assistant", "Office, then Crew", "No follow-ups due", the section names);
// ruling-carrying strings stay word for word (directionB_strings).
import { describe, it, expect, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { loadAppHtml, loadCrewHtml } from '../src/server/appPage.js';
import { screenText } from './support/pageCode.js';
import { SECTION_AGENTS } from '../src/agents/sections.js';

const html = loadAppHtml();
const crew = loadCrewHtml();
function fnSrc(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
function oneLine(name: string): string {
  const m = new RegExp(`^const ${name} = .*;$`, 'm').exec(html);
  if (!m) throw new Error('no one-line const ' + name);
  return m[0];
}
const constVal = <T,>(name: string): T => new Function(`${oneLine(name)}\nreturn ${name};`)() as T;
const VIEW_TITLES = constVal<Record<string, string>>('VIEW_TITLES');
const DOCK_OF = constVal<Record<string, string>>('DOCK_OF');

const NAV = html.slice(html.indexOf('<nav aria-label="Sections">'), html.indexOf('</nav>'));
const BUTTONS = [...NAV.matchAll(/<button id="(tab-[a-z]+)"( class="[^"]*")?><span class="navpill"><svg class="ico" aria-hidden="true"><use href="#(i-[a-z]+)"\/><\/svg><span>([^<]+)<\/span><\/span><\/button>/g)]
  .map((m) => ({ id: m[1]!, hidden: /dock-hidden/.test(m[2] ?? ''), icon: m[3]!, label: m[4]!.replace(/&amp;/g, '&') }));

describe('the dock flips once: Today · Leads · Calendar · Estimate · Office (R29 #1)', () => {
  it('exactly five visible buttons, in that order, with their labels and icons', () => {
    expect(BUTTONS.filter((b) => !b.hidden).map((b) => [b.id, b.label, b.icon])).toEqual([
      ['tab-today', 'Today', 'i-today'],
      ['tab-leads', 'Leads', 'i-leads'],
      ['tab-cal', 'Calendar', 'i-calendar'],
      ['tab-estimate', 'Estimate', 'i-tree'],
      ['tab-more', 'Office', 'i-more'], // the More button relabelled (its id, and every link to it, kept)
    ]);
  });

  it('the old buttons stay, dock-hidden, so every link to them keeps working — named for their screens now', () => {
    expect(BUTTONS.filter((b) => b.hidden).map((b) => [b.id, b.label])).toEqual([
      ['tab-calls', 'Calls & texts'], ['tab-book', 'Properties on file'], ['tab-followups', 'Follow-ups'], ['tab-perf', 'Numbers'],
    ]);
    // No dock label names a screen that is gone (Queue, Book, More); every button is one the markup draws.
    for (const gone of ['Queue', 'Book', 'More', 'Calls']) expect(BUTTONS.map((b) => b.label), gone).not.toContain(gone);
    expect(NAV.match(/<button /g)).toHaveLength(BUTTONS.length);
  });

  it('each visible tab is wired: a tap switches to its screen (Office is drawn fresh, as More was)', () => {
    const wire = html.slice(html.indexOf("for (const t of ['today'"), html.indexOf("$('tab-more').addEventListener"));
    const wired = /for \(const t of \[([^\]]*)\]\)/.exec(wire)![1]!.split(',').map((x) => x.trim().replace(/'/g, ''));
    for (const t of ['today', 'leads', 'cal', 'estimate', 'calls', 'book', 'followups', 'perf']) expect(wired, t).toContain(t);
    expect(html).toContain("$('tab-more').addEventListener('click', () => { renderMore(); switchTab('more'); });");
  });

  it('DOCK_OF is the plan\'s table — one table, every screen but Settings, and every tab it names is a visible one', () => {
    expect(DOCK_OF).toEqual({
      today: 'today',
      leads: 'leads', calls: 'leads',
      cal: 'cal',
      estimate: 'estimate', book: 'estimate', permits: 'estimate', measure: 'estimate',
      more: 'more', followups: 'more', money: 'more', fleet: 'more', safety: 'more', perf: 'more', agents: 'more', learn: 'more', assistant: 'more',
      map: 'cal', // Maps wave A (D106): until a layer says otherwise; openMap moves it with MAP_HOME (test/mapShell.test.ts)
    });
    const visible = BUTTONS.filter((b) => !b.hidden).map((b) => b.id);
    for (const t of new Set(Object.values(DOCK_OF))) expect(visible, t).toContain('tab-' + t);
    expect(Object.keys(DOCK_OF).sort()).toEqual(Object.keys(VIEW_TITLES).filter((v) => v !== 'settings').sort());
  });

  it('every screen lights exactly one tab; Settings (from the sliders button) lights none', () => {
    for (const v of Object.keys(VIEW_TITLES)) {
      const n = core();
      n.switchTab(v);
      expect(n.lit(), v).toEqual(v === 'settings' ? [] : ['tab-' + DOCK_OF[v]]);
    }
  });

  it('the tabs fit: five across the dock share it evenly, labels never cut (CSS)', () => {
    const css = html.slice(0, html.indexOf('</style>'));
    expect(css).toMatch(/nav button\{flex:1 1 0;min-width:0;min-height:56px;/);
    expect(css).toMatch(/nav button\.dock-hidden\{display:none\}/);
  });
});

// The navigation core, run together: startView, switchTab, navPush, navShowBack, navShow, navBack and the
// popstate handler share one CUR_TAB, against a history whose back() fires popstate (navBack.test's model).
function core() {
  type Fake = { hidden: boolean; textContent: string; on: Set<string>; kids: number; classList: Record<string, (c: string, f?: boolean) => unknown>; closest: () => Fake; hasChildNodes: () => boolean };
  const nodes = new Map<string, Fake>();
  const $ = (id: string): Fake | null => {
    if (!html.includes(`id="${id}"`)) return null;
    if (!nodes.has(id)) {
      const n: Fake = {
        hidden: false, textContent: '', on: new Set(), kids: 0,
        classList: {
          toggle: (c, f) => { if (f ?? !n.on.has(c)) n.on.add(c); else n.on.delete(c); },
          add: (c) => n.on.add(c), remove: (c) => n.on.delete(c), contains: (c) => n.on.has(c),
        },
        closest: () => n, hasChildNodes: () => n.kids > 0,
      };
      // As the markup draws it: Today's tab starts lit (class="active"), the rest do not.
      if (new RegExp(`id="${id}" class="active"`).test(html)) n.on.add('active');
      if (new RegExp(`id="${id}"[^>]* hidden>`).test(html)) n.hidden = true; // Back starts hidden (the markup's [hidden])
      nodes.set(id, n);
    }
    return nodes.get(id)!;
  };
  const listeners: Record<string, (ev: { state: unknown }) => void> = {};
  const stack: Array<{ state: Record<string, unknown> | null; url: string }> = [{ state: null, url: '/app' }];
  let at = 0;
  const history = {
    get state() { return stack[at]!.state; },
    pushState(s: Record<string, unknown>, _t: string, url: string) { stack.splice(at + 1); stack.push({ state: s, url }); at++; },
    replaceState(s: Record<string, unknown>, _t: string, url?: string) { stack[at] = { state: s, url: url ?? stack[at]!.url }; },
    back() { if (at > 0) { at--; listeners.popstate!({ state: stack[at]!.state }); } },
    get depth() { return at; },
    get url() { return stack[at]!.url; },
  };
  const window = { scrollY: 0, scrollTo: () => {}, addEventListener: (t: string, f: (ev: { state: unknown }) => void) => { listeners[t] = f; } };
  const drawn: string[] = [];
  const navDraw = oneLine('NAV_DRAW');
  const renders = [...new Set([...navDraw.matchAll(/\b(render[A-Z]\w*)\(/g)].map((m) => m[1]!))];
  const pop = html.slice(html.indexOf("window.addEventListener('popstate'"), html.indexOf("$('back-btn').addEventListener"));
  const c = new Function('$', 'history', 'window', 'setAppSub', 'talkEnd', 'photoLetGo', 'fitTitle', 'leadsHeadOn', ...renders, `
    let CUR_TAB = 'today'; let NAV_QUIET = false; const TALK = { on: false }; let PHOTO_OPEN = null;
    ${['VIEW_TITLES', 'VIEW_ALIAS', 'DOCK_OF', 'NAV_PARENT', 'SHEETS'].map(oneLine).join('\n')}
    ${navDraw}
    ${['switchTab', 'navPush', 'navShowBack', 'navShow', 'navBack', 'startView'].map(fnSrc).join('\n')}
    ${pop}
    return { switchTab, navBack, startView, tab: () => CUR_TAB };`)(
    $, history, window, () => {}, () => {}, () => {}, () => {}, () => {}, ...renders.map((r) => () => drawn.push(r)),
  ) as { switchTab: (w: string) => void; navBack: () => void; startView: (h: string) => void; tab: () => string };
  const lit = () => { $('tab-today'); return [...nodes.entries()].filter(([id, n]) => id.startsWith('tab-') && n.on.has('active')).map(([id]) => id); };
  return { ...c, lit, history, drawn, backHidden: () => $('back-btn')!.hidden };
}

describe('the deep-link table, cold (the plan\'s "Deep links and Back", target state)', () => {
  // [link, lands on, tab lit, Back with nothing behind ('hidden' = no Back: the screen the app opened on)]
  const TABLE: Array<[string, string, string, string]> = [
    ['', 'today', 'today', 'hidden'],
    ['today', 'today', 'today', 'hidden'],
    ['calls', 'calls', 'leads', 'leads'], // the manifest's shortcut: Leads › Calls & texts; Back → New leads
    ['leads', 'leads', 'leads', 'today'],
    ['cal', 'cal', 'cal', 'today'], // the manifest's shortcut (R35's Today's stops ride the Calendar)
    ['book', 'book', 'estimate', 'estimate'],
    ['permits', 'permits', 'estimate', 'estimate'],
    ['measure', 'measure', 'estimate', 'estimate'],
    ['followups', 'followups', 'more', 'more'],
    ['perf', 'perf', 'more', 'more'], ['agents', 'agents', 'more', 'more'], ['learn', 'learn', 'more', 'more'], ['assistant', 'assistant', 'more', 'more'],
    ['more', 'more', 'more', 'today'], // the crew preview's way back
    ['queue', 'more', 'more', 'today'], // an alias: Office
    ['settings', 'today', 'today', 'hidden'], // not a deep link — it opens from the sliders button
    ['estimate', 'estimate', 'estimate', 'today'],
    ['money', 'money', 'more', 'more'], ['fleet', 'fleet', 'more', 'more'], ['safety', 'safety', 'more', 'more'],
    ['nope', 'today', 'today', 'hidden'],
  ];

  it.each(TABLE)('#%s → %s, %s lit, Back with nothing behind → %s', (link, lands, tab, back) => {
    const n = core();
    n.startView(link ? '#' + link : '');
    expect(n.tab()).toBe(lands);
    expect(n.lit()).toEqual(['tab-' + tab]);
    expect(n.history.state).toEqual({ v: lands, d: 0 }); // step zero: the cold start adds no step
    expect(n.history.url).toBe('#' + lands);
    if (back === 'hidden') { expect(n.backHidden()).toBe(true); return; }
    expect(n.backHidden()).toBe(false);
    n.navBack();
    expect(n.tab()).toBe(back);
    expect(n.lit()).toEqual(['tab-' + DOCK_OF[back]]);
  });

  it('a desk off the minute timer is drawn before it shows, the way a step back draws it (navShow)', () => {
    for (const [h, r] of [['more', 'renderMore'], ['permits', 'renderPermits'], ['agents', 'renderAgents'], ['measure', 'renderMeasure'], ['learn', 'renderLearn'], ['assistant', 'renderAssistant'], ['queue', 'renderMore']]) {
      const n = core();
      n.startView('#' + h);
      expect(n.drawn, h).toEqual([r]);
    }
    const s = core();
    s.startView('#settings');
    expect(s.drawn).toEqual([]); // Settings opens only from its button
  });

  it('the boot reads the hash through startView, once, before the first draw of every screen', () => {
    const boot = html.slice(html.indexOf('// Home-screen shortcuts open a section directly'), html.indexOf('\nrefreshAll();'));
    expect(boot).toContain('startView(location.hash);');
    expect(fnSrc('startView')).toContain('VIEW_ALIAS');
    expect(fnSrc('startView')).toContain('navShow(want);');
    expect(fnSrc('startView')).toContain("try { history.replaceState({ v: CUR_TAB, d: 0 }, '', '#' + CUR_TAB); } catch (e) { /* ignore */ }");
  });

  it('a six-tap walk through the new dock is retraced by Back, tab by tab', () => {
    const n = core();
    n.startView('');
    for (const t of ['leads', 'calls', 'cal', 'estimate', 'permits', 'more']) n.switchTab(t);
    expect(n.history.depth).toBe(6);
    for (const want of ['permits', 'estimate', 'cal', 'calls', 'leads', 'today']) {
      n.navBack();
      expect(n.tab()).toBe(want);
      expect(n.lit()).toEqual(['tab-' + DOCK_OF[want]]);
    }
    expect(n.backHidden()).toBe(true);
  });
});

describe('the home-screen shortcuts', () => {
  const saved = { ...process.env };
  afterAll(() => { process.env = { ...saved }; vi.resetModules(); });
  async function serve(): Promise<{ base: string; srv: Server }> {
    vi.resetModules();
    const { createArborRequestHandler } = await import('../src/server.js');
    const srv = createServer(createArborRequestHandler());
    await new Promise<void>((r) => srv.listen(0, r));
    const addr = srv.address();
    return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, srv };
  }

  it('the Calls shortcut is named for its screen, "Calls & texts" — every URL unchanged', async () => {
    const { base, srv } = await serve();
    try {
      const m = await (await fetch(base + '/manifest.webmanifest')).json() as { shortcuts: Array<{ name: string; url: string }> };
      expect(m.shortcuts).toEqual([
        { name: 'Calls & texts', url: '/app#calls' },
        { name: 'Calendar', url: '/app#cal' },
        { name: 'Crew preview', url: '/crew?preview=1' },
      ]);
    } finally { srv.close(); }
  });
});

describe('the words that named the old screens move with them (ruling strings stay — directionB_strings)', () => {
  const app = screenText(html);
  it('no screen text sends Mike to More, the Queue or the Book', () => {
    expect(app).not.toMatch(/More →|More, then|Open More|Queue clear|the Queue\b|Open Calls →/);
    expect(screenText(crew)).not.toMatch(/More, then|More →/);
    expect(app).toContain('Open Office → Assistant.');
    expect(screenText(crew)).toContain('Open it from the office app — Office, then Crew — on a phone signed in to it.');
  });

  it('Follow-ups with nothing due says so in its own name — never over a feed it could not check', () => {
    // Pin moved (R27 Phase A, owner app b), meaning kept: the two names are said through T, and "a feed it could not check" is
    // the storm or coming-due nudges the server could not read (storm || grow — what unread.length counted).
    expect(fnSrc('renderFollowUps')).toContain("state(storm || grow ? T('Nothing due from what Arbo could read') : T('No follow-ups due'),");
    expect(fnSrc('renderFollowUps')).toContain('const storm = !!q.seasonalUnavailable;');
    expect(fnSrc('renderFollowUps')).toContain('const grow = !!q.growthUnavailable;');
  });

  it('a proposal for a call review opens Calls & texts, by that name', () => {
    expect(html).toContain("call_review: [T('Open Calls & texts →'), 'calls'],"); // pin moved (R27 Phase A, owner app c): the same name, through T
  });

  it('the server\'s own lines point to Office → Assistant', () => {
    const src = readFileSync(new URL('../src/assistant/assistant.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('More → Assistant');
    expect(src.match(/Office → Assistant/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it('the Agents desk cards name the screens the desks work on now', () => {
    const section = (id: string) => SECTION_AGENTS.find((a) => a.id === id)!.section;
    expect(section('front-desk')).toBe('Leads › Calls & texts');
    expect(section('arborist')).toBe('Estimate');
    expect(section('permit-desk')).toBe('Permit rules');
  });

  it('the docs Mike reads follow the new paths (GO_LIVE, the Spanish plan) — the rulings are left as written', () => {
    const go = readFileSync(new URL('../docs/GO_LIVE.md', import.meta.url), 'utf8');
    expect(go).not.toMatch(/More →|tile in More/);
    expect(go).toContain('Office → Assistant → Status');
    const es = readFileSync(new URL('../docs/R27_SPANISH_PLAN.md', import.meta.url), 'utf8');
    expect(es).toContain('Office → Appearance');
    expect(es).not.toContain('More → Appearance');
  });
});

// Direction B wave 3b review: the words and the room the dock flip left behind.
describe('review round: the dock at 320, PHONE_SETUP\'s screen names, a long name on a card', () => {
  const css = html.slice(0, html.indexOf('</style>'));

  it('on a 320 px phone the dock gives its five labels room — the buttons take the gutter and the gaps, the 12 px label stays (UI #6: "Calendar Estimate" read as one)', () => {
    const narrow = /@media \(max-width:359px\)\{nav\{([^}]*)\}nav button\{([^}]*)\}\}/.exec(css);
    expect(narrow, 'a narrow-phone rule for the dock').toBeTruthy();
    expect(narrow![1]).toBe('left:8px;right:8px;padding:8px 4px;gap:0');
    expect(narrow![2]).toBe('letter-spacing:0'); // never under the P2 12 px floor
    // Still five even buttons, each a 56 px tall target, labels never cut (the rule above, unchanged).
    expect(css).toMatch(/nav button\{flex:1 1 0;min-width:0;min-height:56px;/);
  });

  it('PHONE_SETUP.md names the screens Sona\'s state shows on now (Today, Leads › Calls & texts)', () => {
    const doc = readFileSync(new URL('../docs/PHONE_SETUP.md', import.meta.url), 'utf8');
    expect(doc).not.toMatch(/Today \/ Calls screens/);
    expect(doc).toContain('State on `GET /api/quo`, on Today and on Leads › Calls & texts.');
  });

  it('a long unbroken name on any card\'s top row wraps instead of pushing the page sideways (Today\'s emergency card at 320)', () => {
    expect(css).toMatch(/\n\.card \.toprow \.who\{min-width:0;overflow-wrap:anywhere\}/);
    // …and the row that names a person in a red box (Before you roll, Sona's flag): a button whose text could not wrap.
    expect(css).toMatch(/\n\.sliplink\{overflow-wrap:anywhere\}/);
  });
});
