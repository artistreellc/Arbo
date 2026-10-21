// Direction B, P1 (docs/DIRECTION_B_PLAN.md, "Deep links and Back"): the links
// that exist today must keep landing somewhere real while the screens move.
// vitest has no DOM, so the page's own boot block, switchTab and tables are
// lifted out of index.html and run against stand-ins; the manifest is served
// by the real request handler, the same way r25Routes does.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { loadAppHtml, loadCrewHtml } from '../src/server/appPage.js';

const html = loadAppHtml();
const crew = loadCrewHtml();

/** One top-level function's source: its declaration to the "}" alone on a line. */
function fnSrc(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
function pageFn<T>(name: string, deps: Record<string, unknown>): T {
  return new Function(...Object.keys(deps), `${fnSrc(name)}\nreturn ${name};`)(...Object.values(deps)) as T;
}
/** A one-line `const NAME = …;` table, evaluated. */
function constVal<T>(name: string): T {
  const m = new RegExp(`^const ${name} = (.*);$`, 'm').exec(html);
  if (!m) throw new Error(`no one-line const ${name} in the page`);
  return new Function(`return (${m[1]});`)() as T;
}
/** A multi-line `const NAME = {` … `};` table, evaluated. */
function constBlock<T>(name: string): T {
  const at = html.indexOf(`\nconst ${name} = {`);
  if (at < 0) throw new Error(`no const ${name} block in the page`);
  const end = html.indexOf('\n};', at);
  return new Function(`return (${html.slice(html.indexOf('{', at), end + 2)});`)() as T;
}
/** The keys of a one-line object literal, without evaluating its values (they name page functions). */
function constKeys(name: string): string[] {
  const m = new RegExp(`^const ${name} = \\{(.*)\\};$`, 'm').exec(html);
  if (!m) throw new Error(`no one-line const ${name} in the page`);
  return [...m[1]!.matchAll(/(?:^|,)\s*([a-z]+):/g)].map((x) => x[1]!);
}

const VIEW_TITLES = constVal<Record<string, string>>('VIEW_TITLES');
const VIEWS = Object.keys(VIEW_TITLES);
const NAV_PARENT = constVal<Record<string, string>>('NAV_PARENT');
const TIMED = constKeys('TIMED');
const NAV_DRAW = constKeys('NAV_DRAW');
const REFRESH_DESKS = (() => {
  const src = fnSrc('refreshActiveMoreView');
  const m = /const r = \{(.*)\};/.exec(src);
  if (!m) throw new Error('refreshActiveMoreView has no desk table');
  return [...m[1]!.matchAll(/(?:^|,)\s*([a-z]+):/g)].map((x) => x[1]!);
})();

// The dock's buttons as the page draws them: which exist, and which are visible.
const NAV = html.slice(html.indexOf('<nav aria-label="Sections">'), html.indexOf('</nav>'));
const TAB_IDS = [...NAV.matchAll(/<button id="(tab-[a-z]+)"( class="[^"]*")?/g)];
const VISIBLE_TABS = TAB_IDS.filter((m) => !/dock-hidden/.test(m[2] ?? '')).map((m) => m[1]!);
const ALL_TABS = TAB_IDS.map((m) => m[1]!);

/** The page's boot block (the home-screen shortcut reader), run for one hash. Returns the screen it lands on. */
const BOOT = (() => {
  const start = html.indexOf('// Home-screen shortcuts open a section directly');
  const end = html.indexOf('\nrefreshAll();', start);
  if (start < 0 || end < 0) throw new Error('the boot block moved');
  return html.slice(start, end);
})();
function boot(hash: string): { landed: string; drawn: string[] } {
  const drawn: string[] = [];
  const renders = [...new Set([...BOOT.matchAll(/\b(render[A-Z]\w*)\(/g)].map((m) => m[1]!))];
  const fn = new Function('location', 'VIEW_TITLES', 'history', ...renders, `
    let CUR_TAB = 'today'; let NAV_QUIET = false;
    const switchTab = (w) => { CUR_TAB = w; };
    ${BOOT}
    return CUR_TAB;`);
  const landed = fn({ hash: hash ? '#' + hash : '' }, VIEW_TITLES, { replaceState: () => {} },
    ...renders.map((r) => () => drawn.push(r))) as string;
  return { landed, drawn };
}

/** switchTab, lifted, with stand-in elements: which tabs it lights for one view. */
function litTabs(view: string): string[] {
  const nodes = new Map<string, { on: Set<string>; textContent: string }>();
  const $ = (id: string) => {
    if (!html.includes(`id="${id}"`)) return null;
    if (!nodes.has(id)) nodes.set(id, { on: new Set(), textContent: '' });
    const n = nodes.get(id)!;
    return Object.assign(n, { classList: { toggle: (c: string, f: boolean) => { if (f) n.on.add(c); else n.on.delete(c); } } });
  };
  const sw = pageFn<(w: string) => void>('switchTab', {
    navPush: () => {}, $, VIEW_TITLES, CUR_TAB: 'today', setAppSub: () => {}, navShowBack: () => {}, window: { scrollTo: () => {} },
  });
  sw(view);
  expect($('view-' + view)!.on.has('active'), 'view-' + view + ' is shown').toBe(true);
  return ALL_TABS.filter((t) => nodes.get(t)?.on.has('active'));
}

describe('every link that exists today lands on a real screen (P1)', () => {
  const LINKS_TODAY = ['today', 'leads', 'calls', 'cal', 'book', 'followups', 'perf', 'more', 'permits', 'agents', 'measure', 'learn', 'assistant'];

  it.each(LINKS_TODAY)('#%s resolves at boot to its own view-* container', (h) => {
    expect(html, 'view-' + h).toContain(`id="view-${h}"`);
    expect(VIEWS).toContain(h);
    expect(boot(h).landed).toBe(h);
  });

  it('only #today (or no hash, or an unknown one) lands on Today', () => {
    for (const h of LINKS_TODAY.filter((x) => x !== 'today')) expect(boot(h).landed, h).not.toBe('today');
    expect(boot('').landed).toBe('today');
    expect(boot('nope').landed).toBe('today');
    // Settings opens from the gear, never from a link (the plan's table: unchanged).
    expect(boot('settings').landed).toBe('today');
  });

  it('a desk opened cold is drawn before it shows (More, Permits, Agents, Measure, Learn, Assistant)', () => {
    for (const h of ['more', 'permits', 'agents', 'measure', 'learn', 'assistant']) {
      expect(boot(h).drawn.length, h).toBeGreaterThan(0);
    }
  });

  describe('the served manifest and the crew door', () => {
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

    it('every /app#x home-screen shortcut resolves to its screen', async () => {
      const { base, srv } = await serve();
      try {
        const m = await (await fetch(base + '/manifest.webmanifest')).json() as { shortcuts: Array<{ name: string; url: string }> };
        const appLinks = m.shortcuts.filter((s) => s.url.startsWith('/app#'));
        expect(appLinks.length).toBeGreaterThanOrEqual(2); // Calls and Calendar today
        for (const s of appLinks) {
          const h = s.url.slice('/app#'.length);
          expect(VIEWS, s.url).toContain(h);
          expect(boot(h).landed, s.url).toBe(h);
        }
        // The crew shortcut stays the look-only preview (R26 qa-x1).
        expect(m.shortcuts.map((s) => s.url)).toContain('/crew?preview=1');
      } finally { srv.close(); }
    });

    it('the crew preview\'s way back (/app#more) resolves', () => {
      const backs = [...crew.matchAll(/'\/app#([a-z]+)'/g)].map((x) => x[1]!);
      expect(backs.length).toBeGreaterThan(0);
      for (const h of backs) expect(boot(h).landed, '/app#' + h).toBe(h);
    });
  });

  it('every switchTab(\'x\') literal names a screen', () => {
    const lits = [...html.matchAll(/switchTab\('([a-z]+)'\)/g)].map((m) => m[1]!);
    expect(lits.length).toBeGreaterThan(10);
    for (const t of lits) expect(VIEWS, t).toContain(t);
  });

  it('every agent proposal opens a screen that exists', () => {
    const go = constBlock<Record<string, [string, string]>>('PROPOSAL_GO');
    expect(Object.keys(go).length).toBeGreaterThan(5);
    for (const [kind, [, target]] of Object.entries(go)) expect(VIEWS, kind).toContain(target);
  });
});

describe('every screen but Today and Settings has a container, a lit tab, a parent, a draw path and a ↻ path (P1)', () => {
  const screens = VIEWS.filter((v) => v !== 'today' && v !== 'settings');

  it.each(screens)('%s', (v) => {
    expect(html, 'container').toContain(`id="view-${v}"`);
    // A lit tab: at least one VISIBLE dock button lights while it shows.
    const lit = litTabs(v);
    expect(lit.some((t) => VISIBLE_TABS.includes(t)), 'lit: ' + lit.join(',')).toBe(true);
    // A parent: where Back lands with nothing behind — a real screen, never itself.
    const parent = NAV_PARENT[v] || 'today';
    expect(VIEWS, 'parent').toContain(parent);
    expect(parent).not.toBe(v);
    // A draw path: the minute timer (TIMED) or the step-back draw (NAV_DRAW).
    expect(TIMED.includes(v) || NAV_DRAW.includes(v), 'draw path').toBe(true);
    // A ↻ path: refreshAll (TIMED) or the on-screen desk redraw.
    expect(TIMED.includes(v) || REFRESH_DESKS.includes(v), '↻ path').toBe(true);
  });

  it('Settings lights no visible dock tab (it opens from the gear)', () => {
    expect(litTabs('settings').filter((t) => VISIBLE_TABS.includes(t))).toEqual([]);
  });

  it('Today lights the Today tab', () => {
    expect(litTabs('today')).toEqual(['tab-today']);
  });
});
