// Maps wave A, M0 (docs/MAPS_PLAN.md "src/app/index.html"): the shell's Map
// screen. The map runs in a same-origin frame (/map) made once by renderMap —
// the calendar frame's own pattern (R2) — so the shell keeps its laws, its dock,
// ‹ Back and its sheets. A layer is chosen by postMessage, never the frame's
// hash (a hash change in a frame is a history step Back would undo). Where Map
// belongs follows the layer it was opened for (MAP_HOME): Trucks lights Office
// and steps back to Fleet, Leads keeps Leads lit. Messages from the frame are
// taken only from that frame, on this origin, of three known types; a forged
// one opens nothing. Every Google Maps link still comes from mapsDirUrl.
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';

const html = loadAppHtml();
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

describe('the Map screen\'s tables', () => {
  it('Map is a screen: a container, a title, a draw path and a ↻ path', () => {
    expect(html).toContain('<div id="view-map" class="view"></div>');
    expect(constVal<Record<string, string>>('VIEW_TITLES').map).toBe('Map');
    expect(oneLine('NAV_DRAW')).toContain('map: () => renderMap()');
    expect(fnSrc('refreshActiveMoreView')).toContain('map: () => refreshMap()');
  });

  it('MAP_HOME: where each layer belongs; MAP_LAYER_OF: the four deep links', () => {
    expect(constVal('MAP_HOME')).toEqual({ today: 'cal', permits: 'estimate', leads: 'leads', trucks: 'fleet' });
    expect(constVal('MAP_LAYER_OF')).toEqual({ 'map-today': 'today', 'map-permits': 'permits', 'map-leads': 'leads', 'map-trucks': 'trucks' });
    const alias = constVal<Record<string, string>>('VIEW_ALIAS');
    for (const k of ['map-today', 'map-permits', 'map-leads', 'map-trucks']) expect(alias[k], k).toBe('map');
    // Until a layer says otherwise, Map belongs to Calendar (Today's stops are its first layer).
    expect(constVal<Record<string, string>>('DOCK_OF').map).toBe('cal');
    expect(constVal<Record<string, string>>('NAV_PARENT').map).toBe('cal');
  });

  it('the shell hands the key to its own frame through a getter — the frame never reads storage for it', () => {
    expect(html).toContain('window.arboMapKey = () => KEY;');
  });
});

// The navigation core (directionB_dock's model) with the map's functions: one CUR_TAB, a history whose
// back() fires popstate, the frame stood in by a window that records what it is sent.
function core() {
  type Fake = { hidden: boolean; textContent: string; on: Set<string>; kids: Fake[]; id?: string; src?: string; title?: string; className?: string; contentWindow?: unknown; classList: Record<string, (c: string, f?: boolean) => unknown>; closest: () => Fake; hasChildNodes: () => boolean; replaceChildren: (...k: Fake[]) => void; setAttribute: () => void };
  const nodes = new Map<string, Fake>();
  const posted: Array<{ msg: unknown; origin: string }> = [];
  const frameWin = { postMessage: (msg: unknown, origin: string) => posted.push({ msg, origin }) };
  const make = (): Fake => {
    const n: Fake = {
      hidden: false, textContent: '', on: new Set(), kids: [],
      classList: { toggle: (c, f) => { if (f ?? !n.on.has(c)) n.on.add(c); else n.on.delete(c); }, add: (c) => n.on.add(c), remove: (c) => n.on.delete(c), contains: (c) => n.on.has(c) },
      closest: () => n, hasChildNodes: () => n.kids.length > 0,
      replaceChildren: (...k) => { n.kids = k; for (const c of k) if (c.id) nodes.set(c.id, c); }, setAttribute: () => {},
    };
    return n;
  };
  const $ = (id: string): Fake | null => {
    if (nodes.has(id)) return nodes.get(id)!;
    if (!html.includes(`id="${id}"`)) return null;
    const n = make();
    if (new RegExp(`id="${id}" class="active"`).test(html)) n.on.add('active');
    if (new RegExp(`id="${id}"[^>]* hidden>`).test(html)) n.hidden = true;
    nodes.set(id, n);
    return n;
  };
  let frames = 0;
  const document = { createElement: () => { frames++; const f = make(); f.contentWindow = frameWin; return f; } };
  const el = () => make();
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
  const location = { origin: 'https://arbo.test' };
  const opened: unknown[] = [];
  const navDraw = oneLine('NAV_DRAW');
  const renders = [...new Set([...navDraw.matchAll(/\b(render[A-Z]\w*)\(/g)].map((m) => m[1]!))].filter((r) => r !== 'renderMap');
  const pop = html.slice(html.indexOf("window.addEventListener('popstate'"), html.indexOf("$('back-btn').addEventListener"));
  const c = new Function('$', 'history', 'window', 'document', 'location', 'el', 'setAppSub', 'talkEnd', 'photoLetGo', 'fitTitle', 'leadsHeadOn', 'openMapsStop', 'openPanel', 'api', 'openMapsDay', 'readOnlyToast', 'showKeywall', ...renders, `
    let CUR_TAB = 'today'; let NAV_QUIET = false; const TALK = { on: false }; let PHOTO_OPEN = null; let KEY = 'k';
    ${['VIEW_TITLES', 'VIEW_ALIAS', 'DOCK_OF', 'NAV_PARENT', 'SHEETS', 'MAP_HOME', 'MAP_LAYER_OF', 'MAP_MAX'].map(oneLine).join('\n')}
    let MAP_READY = false; let MAP_HELD = null;
    ${navDraw}
    ${['switchTab', 'navPush', 'navShowBack', 'navShow', 'navBack', 'startView', 'mapPost', 'mapAim', 'openMap', 'renderMap', 'refreshMap', 'mapTick', 'mapMessage'].map(fnSrc).join('\n')}
    ${pop}
    return { switchTab, navBack, startView, openMap, refreshMap, mapTick, mapMessage, tab: () => CUR_TAB, dock: () => DOCK_OF, parent: () => NAV_PARENT, ready: () => MAP_READY };`)(
    $, history, window, document, location, el, () => {}, () => {}, () => {}, () => {}, () => {},
    (s: unknown) => opened.push(['stop', s]), (v: string, t: string) => opened.push(['panel', v, t]), async () => ({}), () => {}, () => {}, () => {},
    ...renders.map(() => () => {}),
  ) as { switchTab: (w: string) => void; navBack: () => void; startView: (h: string) => void; openMap: (l: string) => void; refreshMap: () => void; mapTick: () => void; mapMessage: (e: unknown) => void; tab: () => string; dock: () => Record<string, string>; parent: () => Record<string, string>; ready: () => boolean };
  const lit = () => { $('tab-today'); return [...nodes.entries()].filter(([id, n]) => id.startsWith('tab-') && n.on.has('active')).map(([id]) => id); };
  const ready = () => c.mapMessage({ origin: location.origin, source: frameWin, data: { type: 'ready' } });
  return { ...c, lit, history, posted, opened, frameWin, frames: () => frames, readyFrame: ready, location };
}

describe('deep links land on Map with their layer, lit where the layer belongs (M0)', () => {
  const TABLE: Array<[string, string, string, string]> = [
    ['map-today', 'today', 'tab-cal', 'cal'],
    ['map-permits', 'permits', 'tab-estimate', 'estimate'],
    ['map-leads', 'leads', 'tab-leads', 'leads'],
    ['map-trucks', 'trucks', 'tab-more', 'fleet'],
  ];
  it.each(TABLE)('#%s → Map with %s on, %s lit, Back with nothing behind → %s', (link, layer, tab, back) => {
    const n = core();
    n.startView('#' + link);
    expect(n.tab()).toBe('map');
    expect(n.lit()).toEqual([tab]);
    expect(n.history.state).toEqual({ v: 'map', d: 0 });
    expect(n.frames(), 'the frame is made once, by renderMap').toBe(1);
    // The layer waits for the frame to be ready, then goes by message — never the frame's hash.
    expect(n.posted).toEqual([]);
    n.readyFrame();
    expect(n.posted).toEqual([{ msg: { type: 'layer', layer }, origin: 'https://arbo.test' }]);
    n.navBack();
    expect(n.tab()).toBe(back);
  });

  it('#map alone lands on Map, Calendar lit, and Back → Calendar', () => {
    const n = core();
    n.startView('#map');
    expect(n.tab()).toBe('map');
    expect(n.lit()).toEqual(['tab-cal']);
    n.navBack();
    expect(n.tab()).toBe('cal');
  });
});

describe('opening Map from a screen, and Back', () => {
  it('after openMap(\'trucks\') from Calendar, one Back returns to Calendar; Map lit Office meanwhile', () => {
    const n = core();
    n.startView('');
    n.switchTab('cal');
    n.openMap('trucks');
    expect(n.tab()).toBe('map');
    expect(n.lit()).toEqual(['tab-more']);
    n.navBack();
    expect(n.tab()).toBe('cal');
    expect(n.lit()).toEqual(['tab-cal']);
  });

  it('a layer change while Map shows adds no step: one Back still leaves Map', () => {
    const n = core();
    n.startView('');
    n.switchTab('cal');
    n.openMap('today');
    n.readyFrame();
    const depth = n.history.depth;
    n.openMap('trucks'); // already on Map: a message to the frame, no new step
    expect(n.history.depth).toBe(depth);
    expect(n.posted.map((p) => p.msg)).toEqual([{ type: 'layer', layer: 'today' }, { type: 'layer', layer: 'trucks' }]);
    n.navBack();
    expect(n.tab()).toBe('cal');
  });

  it('Map from Leads keeps Leads lit', () => {
    const n = core();
    n.startView('');
    n.switchTab('leads');
    n.openMap('leads');
    expect(n.lit()).toEqual(['tab-leads']);
  });

  it('only renderMap makes the frame, and only once; a tick never reloads it', () => {
    const n = core();
    n.openMap('today');
    n.openMap('trucks');
    n.startView('#map-leads');
    expect(n.frames()).toBe(1);
    expect(html.match(/'map-frame'/g)!.length).toBeGreaterThan(0);
    // The one place that sets the frame's id is renderMap.
    const sets = [...html.matchAll(/\.id = 'map-frame'/g)];
    expect(sets).toHaveLength(1);
    expect(fnSrc('renderMap')).toContain(".id = 'map-frame'");
    expect(fnSrc('renderMap')).toContain("if ($('map-frame')) return;");
    expect(fnSrc('renderMap')).toContain("f.src = '/map';");
    expect(html).not.toMatch(/map-frame'\)\.src\s*=|\.contentWindow\.location|#map-[a-z]+'\s*;?\s*\/\/ frame/);
    // Review round (D106): no frame address with a hash or a query anywhere — the one src is renderMap's '/map'.
    expect(html).not.toMatch(/['"`]\/map[#?]/);
    expect([...html.matchAll(/\.src = '\/map/g)]).toHaveLength(1);
  });

  it('↻ on Map reaches the frame as a refresh message', () => {
    const n = core();
    n.openMap('today');
    n.readyFrame();
    n.posted.length = 0;
    n.refreshMap();
    expect(n.posted).toEqual([{ msg: { type: 'refresh' }, origin: 'https://arbo.test' }]);
    expect(html).toContain("$('refresh').addEventListener('click', () => {");
    expect(fnSrc('refreshActiveMoreView')).toContain('map: () => refreshMap()');
  });
});

describe('messages from the frame: only from it, only three kinds, nothing oversized', () => {
  const stop = { type: 'stop', title: 'SIM-Alder', address: '101 Simulation Row, Virginia Beach, VA 23451', note: 'ZIP area — not the exact spot' };

  it('a real stop tap opens R35\'s own "Open in Google Maps?" sheet with what the frame sent', () => {
    const n = core();
    n.openMap('today');
    n.mapMessage({ origin: n.location.origin, source: n.frameWin, data: stop });
    expect(n.opened).toEqual([['stop', { title: 'SIM-Alder', address: '101 Simulation Row, Virginia Beach, VA 23451', note: 'ZIP area — not the exact spot' }]]);
  });

  it('forged messages open nothing: another origin, another window, an unknown type, an oversized address, no address', () => {
    const n = core();
    n.openMap('today');
    n.mapMessage({ origin: 'https://evil.test', source: n.frameWin, data: stop });
    n.mapMessage({ origin: n.location.origin, source: { postMessage: () => {} }, data: stop });
    n.mapMessage({ origin: n.location.origin, source: null, data: stop });
    n.mapMessage({ origin: n.location.origin, source: n.frameWin, data: { type: 'navigate', url: 'https://evil.test' } });
    n.mapMessage({ origin: n.location.origin, source: n.frameWin, data: { ...stop, address: 'x'.repeat(301) } });
    n.mapMessage({ origin: n.location.origin, source: n.frameWin, data: { ...stop, title: 'y'.repeat(301) } });
    n.mapMessage({ origin: n.location.origin, source: n.frameWin, data: { ...stop, address: '   ' } });
    n.mapMessage({ origin: n.location.origin, source: n.frameWin, data: { ...stop, address: 42 } });
    n.mapMessage({ origin: n.location.origin, source: n.frameWin, data: 'stop' });
    n.mapMessage({ origin: n.location.origin, source: n.frameWin, data: null });
    n.mapMessage({ origin: n.location.origin, source: n.frameWin, data: { type: 'lead', id: '../x' } });
    n.mapMessage({ origin: n.location.origin, source: n.frameWin, data: { type: 'lead', id: { toString: () => 'x' } } });
    expect(n.opened).toEqual([]);
  });

  it('a forged "ready" from another window never releases a held layer', () => {
    const n = core();
    n.openMap('trucks');
    n.mapMessage({ origin: n.location.origin, source: { postMessage: () => {} }, data: { type: 'ready' } });
    expect(n.ready()).toBe(false);
    expect(n.posted).toEqual([]);
  });

  it('a lead carries an id only, and opens that lead on Leads', () => {
    const n = core();
    n.openMap('leads');
    n.mapMessage({ origin: n.location.origin, source: n.frameWin, data: { type: 'lead', id: 'L-123_a' } });
    expect(n.opened).toEqual([['panel', 'leads', 'lead-L-123_a']]);
  });

  it('the listener is wired once, and the day route reads Calendar\'s own answer into R35\'s day sheet', () => {
    expect(html.match(/window\.addEventListener\('message', mapMessage\);/g)).toHaveLength(1);
    expect(fnSrc('mapDay')).toContain("api('/api/route/today')");
    expect(fnSrc('mapDay')).toContain('openMapsDay(d)');
  });

  it('the Maps sheet shows the frame\'s note under the name, and still takes its link from mapsDirUrl', () => {
    const s = fnSrc('openMapsStop');
    expect(s).toContain('yes.href = mapsDirUrl([s.address]);');
    expect(s).toContain("s.note ? el('div', 'storm-muted', s.note) : null");
  });
});

describe('the frame in the Calendar view\'s place: the swipe strip and the size', () => {
  it('a 16 px strip over the frame\'s left edge keeps the iOS swipe-back in the shell', () => {
    expect(fnSrc('renderMap')).toContain("el('div', 'map-edge')");
    expect(html).toMatch(/\.map-edge\{[^}]*width:16px/);
  });
  // UI review (D106): the frame is exactly the band between the app bar and the dock — its own page never scrolls
  // and never runs under the dock; the map inside takes all of it but the chips (≥560 px at 390×844, browser check).
  it('the frame fills the band between the app bar and the dock, and never runs under the dock', () => {
    const rule = /#map-frame\{([^}]*)\}/.exec(html)![1]!;
    expect(rule).toContain('height:calc(100dvh - 185px - env(safe-area-inset-top) - env(safe-area-inset-bottom))');
    const min = /min-height:(\d+)px/.exec(rule);
    expect(min && Number(min[1])).toBeLessThanOrEqual(320);
  });
});

// Review round (D106): the map must never sit on an old day, and "Route the whole day" from the map must
// never say "Nothing to route" over a calendar Arbo couldn't read (§1B).
describe('the shell keeps the map on today (review round)', () => {
  it('the minute tick and coming back on screen send the frame a tick; a hidden app or the key screen sends none', () => {
    const run = (hidden: boolean, wall: boolean) => {
      const ticks: number[] = [];
      const fake = (on: boolean) => ({ classList: { contains: () => on }, querySelector: () => null, querySelectorAll: () => [] });
      const auto = new Function('$', 'document', 'TIMED', 'holdsTyping', 'renderLeadsHead', 'mapTick', `let TIMER_REDRAW = false;\n${fnSrc('autoRefresh')}\nreturn autoRefresh;`)(
        (id: string) => fake(id === 'keywall' ? wall : false), { hidden }, { cal: () => {} }, () => false, () => {}, () => ticks.push(1),
      ) as () => void;
      auto();
      return ticks.length;
    };
    expect(run(false, false)).toBe(1);
    expect(run(true, false)).toBe(0);
    expect(run(false, true)).toBe(0);
    expect(html).toContain("document.addEventListener('visibilitychange', autoRefresh);");
  });

  it('mapTick posts {type:"tick"} to a ready frame only', () => {
    const n = core();
    n.openMap('today');
    n.mapTick();
    expect(n.posted).toEqual([]);
    n.readyFrame();
    n.posted.length = 0;
    n.mapTick();
    expect(n.posted).toEqual([{ msg: { type: 'tick' }, origin: 'https://arbo.test' }]);
  });
});

describe('Route the whole day from the map (review round)', () => {
  const SIGNIN = "Couldn't read your calendar — Google sign-in needs reconnecting (Settings → Reconnect Google). This is not an empty day.";
  async function day(answer: unknown) {
    const did: unknown[] = [];
    const mapDay = new Function('api', 'openMapsDay', 'readOnlyToast', 'showKeywall', 'mapTick', `${fnSrc('mapDay')}\nreturn mapDay;`)(
      async () => { if (answer instanceof Error) throw answer; return answer; },
      (d: unknown) => did.push(['day', d]), (t: string) => did.push(['toast', t]), () => did.push(['keywall']), () => did.push(['tick']),
    ) as () => Promise<void>;
    await mapDay();
    return did;
  }
  it('a calendar not read: R35\'s own line, never "Nothing to route"; the frame re-reads so the map agrees', async () => {
    for (const state of ['google_signin', 'calendar_refused', 'calendar_error', 'google_not_connected']) {
      const did = await day({ state, line: SIGNIN, practice: false, stops: [], plan: null });
      expect(did, state).toEqual([['toast', SIGNIN], ['tick']]);
    }
  });
  it('a good read with a plan opens R35\'s day sheet; a good read with nothing in the route says so', async () => {
    const ok = { state: 'ok', line: null, stops: [{ id: 'a', address: '1 Sim St' }], plan: { engine: 'tomtom', order: ['a'] } };
    expect(await day(ok)).toEqual([['day', ok]]);
    expect(await day({ ...ok, plan: { engine: null, order: [] } })).toEqual([['toast', 'Nothing to route today — Calendar says why for each stop.']]);
    expect(await day({ ...ok, state: 'practice', plan: null })).toEqual([['toast', 'Nothing to route today — Calendar says why for each stop.']]);
  });
  it('a refused key opens the key screen; a failed read is named', async () => {
    expect(await day(Object.assign(new Error('unauthorized'), { code: 401 }))).toEqual([['keywall']]);
    expect(await day(Object.assign(new Error('x'), { code: 503 }))).toEqual([['toast', 'Couldn’t read today’s route just now — tap ↻ and try again.']]);
  });
});
