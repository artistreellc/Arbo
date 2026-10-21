// BACK (Mike, 2026-10-20: "the app itself needs to have a back button as you
// cant navigate after selecting certain things" · "this is for iphone" ·
// "there has to be an actual back"), and the red Sona flags ("it doesnt say
// which one … is it clickable"). vitest has no DOM, so the history model is
// lifted out of the page and run against a fake history; the wiring is pinned
// in the source. The whole thing was also walked in a real browser at iPhone
// size (24 checks) before it shipped.
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';

const html = loadAppHtml();
function pageFn<T>(name: string, deps: Record<string, unknown> = {}): T {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return new Function(...Object.keys(deps), `${m[0]}\nreturn ${name};`)(...Object.values(deps)) as T;
}

/** A browser history in miniature: push, replace, back (which fires popstate). */
function fakeHistory() {
  const stack: Array<{ state: Record<string, unknown> | null; url: string }> = [{ state: null, url: '/app' }];
  let at = 0;
  const h = {
    get state() { return stack[at]!.state; },
    pushState(state: Record<string, unknown>, _t: string, url: string) { stack.splice(at + 1); stack.push({ state, url }); at++; },
    replaceState(state: Record<string, unknown>, _t: string, url?: string) { stack[at] = { state, url: url ?? stack[at]!.url }; },
    back() { if (at > 0) at--; },
    get url() { return stack[at]!.url; },
    get depth() { return at; },
  };
  return h;
}

describe('the Back button', () => {
  it('is a real, labeled button in the header, hidden until there is somewhere to go back to', () => {
    expect(html).toMatch(/<button id="back-btn" title="Back" hidden><svg class="hico" aria-hidden="true"><use href="#i-chevron"\/><\/svg><span>Back<\/span><\/button>/);
    // The same size as the header's other buttons: a full thumb target.
    expect(html).toContain('#refresh,#settings-btn,#back-btn,.iconbtn{');
    expect(html).toContain("$('back-btn').addEventListener('click', navBack);");
  });

  it('every screen switch is a step, and the header shows Back after it', () => {
    const sw = html.slice(html.indexOf('function switchTab('), html.indexOf('\n}', html.indexOf('function switchTab(')));
    expect(sw.indexOf('navPush(which);')).toBeGreaterThan(-1);
    expect(sw.indexOf('navPush(which);')).toBeLessThan(sw.indexOf('CUR_TAB = which;')); // recorded before the switch
    expect(sw).toContain('navShowBack();');
  });

  it('navPush: one step per new screen, remembers where the old one was scrolled, never doubles a step', () => {
    const h = fakeHistory();
    const win = { scrollY: 420 };
    const push = pageFn<(w: string) => void>('navPush', { history: h, window: win, NAV_QUIET: false, CUR_TAB: 'today' });
    h.replaceState({ v: 'today', d: 0 }, '', '#today');
    push('more');
    expect(h.state).toEqual({ v: 'more', d: 1 });
    expect(h.url).toBe('#more');
    h.back();
    expect(h.state).toEqual({ v: 'today', d: 0, y: 420 }); // Today's scroll is kept for the step back
    push('more'); push('more');
    expect(h.depth).toBe(1); // the same screen twice is one step
    pageFn<(w: string) => void>('navPush', { history: h, window: win, NAV_QUIET: true, CUR_TAB: 'more' })('agents');
    expect(h.depth).toBe(1); // drawing a back step never adds a step
  });

  it('navShowBack: hidden only on the screen the app opened on', () => {
    const btn = { hidden: true, closest: () => ({ classList: { toggle: () => {} } }) };
    const run = (tab: string, d: number) => {
      pageFn<() => void>('navShowBack', { $: () => btn, CUR_TAB: tab, history: { state: { v: tab, d } } })();
      return btn.hidden;
    };
    expect(run('today', 0)).toBe(true);
    expect(run('today', 2)).toBe(false); // came back to Today from somewhere: Back still goes there
    for (const t of ['calls', 'cal', 'leads', 'more', 'book', 'followups', 'perf', 'settings', 'permits', 'agents', 'measure', 'learn']) {
      expect(run(t, 0), t).toBe(false);
    }
  });

  it('navBack: closes an open sheet first, then steps back, and with nothing behind lands on the parent', () => {
    const calls: string[] = [];
    const sheets: Record<string, boolean> = { twin: false, yard: false, bd: false };
    const deps = (tab: string, d: number) => ({
      SHEETS: ['twin', 'yard', 'bd'],
      $: (id: string) => ({ classList: { contains: () => sheets[id] } }),
      closeSheet: (id: string) => calls.push('close:' + id),
      history: { state: { v: tab, d }, back: () => calls.push('back'), replaceState: (s: { v: string }) => calls.push('replace:' + s.v) },
      CUR_TAB: tab,
      NAV_PARENT: { book: 'more', followups: 'more', perf: 'more', permits: 'more', agents: 'more', measure: 'more', learn: 'more', settings: 'today' },
      navShow: (v: string) => calls.push('show:' + v),
    });
    sheets.yard = true;
    pageFn<() => void>('navBack', deps('today', 1))();
    expect(calls).toEqual(['close:yard']);
    sheets.yard = false; calls.length = 0;
    pageFn<() => void>('navBack', deps('agents', 2))();
    expect(calls).toEqual(['back']);
    calls.length = 0;
    pageFn<() => void>('navBack', deps('permits', 0))(); // a reload on #permits
    expect(calls).toEqual(['show:more', 'replace:more']);
    calls.length = 0;
    pageFn<() => void>('navBack', deps('calls', 0))(); // a home-screen shortcut to Calls
    expect(calls).toEqual(['show:today', 'replace:today']);
  });

  it('the phone\'s own back walks the same steps: popstate draws the screen without adding one, and closes a sheet', () => {
    const pop = html.slice(html.indexOf("window.addEventListener('popstate'"), html.indexOf("$('back-btn').addEventListener"));
    expect(pop).toContain("for (const id of SHEETS) if (st.sheet !== id) $(id).classList.remove('show');");
    expect(pop).toContain('navShow(want);');
    expect(pop).toContain('window.scrollTo(0, st.y || 0);');
    // navShow draws quietly: no step is added while stepping back.
    expect(html).toContain("function navShow(which) {\n  NAV_QUIET = true;");
  });

  it('a desk drawn by stepping back keeps what it showed (an Agents run is not thrown away)', () => {
    const draws: string[] = [];
    const show = pageFn<(w: string) => void>('navShow', {
      NAV_DRAW: { agents: () => draws.push('agents'), more: () => draws.push('more') },
      $: (id: string) => ({ hasChildNodes: () => id === 'view-agents' }),
      switchTab: (w: string) => draws.push('tab:' + w),
      set NAV_QUIET(_v: boolean) { /* ignore */ },
    });
    show('agents');
    expect(draws).toEqual(['tab:agents']); // already drawn: not redrawn
    show('more');
    expect(draws).toEqual(['tab:agents', 'more', 'tab:more']); // More always redraws, as its tab does
  });

  it('every sheet is a step: opening records it, X steps back', () => {
    for (const id of ['twin', 'yard', 'bd']) {
      expect(html, id).toContain(`$('${id}').classList.add('show');`);
      expect(html, id).toContain(`sheetOpened('${id}')`);
      expect(html, id).toContain(`$('${id}-close').addEventListener('click', () => closeSheet('${id}'));`);
    }
  });

  it('iPhone: a swipe right from the left edge steps back — only in the installed app, never twice in Safari', () => {
    expect(html).toContain("const STANDALONE = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);");
    const swipe = html.slice(html.indexOf('if (STANDALONE) {'), html.indexOf('if (STANDALONE) {') + 900);
    expect(swipe).toContain('t.clientX < 20');
    expect(swipe).toContain('if (dx > 70 && dy < 60');
    expect(swipe).toContain('navBack();');
  });

  it('start-up: the first screen is step zero, drawn without adding a step', () => {
    expect(html).toContain("try { history.replaceState({ v: CUR_TAB, d: 0 }, '', '#' + CUR_TAB); } catch (e) { /* ignore */ }");
  });
});

// Direction B, P1: the whole step-back loop run together — the page's own
// switchTab, navPush, navBack, navShow, sheetOpened, closeSheet and popstate
// handler share one CUR_TAB, against a history whose back() fires popstate.
describe('Back retraces every tab tapped, in order (Direction B P1)', () => {
  const oneLine = (name: string) => {
    const m = new RegExp(`^const ${name} = .*;$`, 'm').exec(html);
    if (!m) throw new Error('no one-line const ' + name);
    return m[0];
  };
  const fnText = (name: string) => {
    const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
    if (!m) throw new Error('no function ' + name);
    return m[0];
  };
  const pop = html.slice(html.indexOf("window.addEventListener('popstate'"), html.indexOf("$('back-btn').addEventListener"));
  const SHEET_IDS = new Function(`return ${oneLine('SHEETS').replace(/^const SHEETS = /, '').replace(/;$/, '')};`)() as string[];

  function navCore() {
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
    };
    const window = { scrollY: 0, scrollTo: () => {}, addEventListener: (t: string, f: (ev: { state: unknown }) => void) => { listeners[t] = f; } };
    const drawn: string[] = [];
    const navDrawLine = oneLine('NAV_DRAW');
    const renders = [...new Set([...navDrawLine.matchAll(/\b(render[A-Z]\w*)\(/g)].map((m) => m[1]!))];
    const core = new Function('$', 'history', 'window', 'setAppSub', 'talkEnd', 'photoLetGo', ...renders, `
      let CUR_TAB = 'today'; let NAV_QUIET = false; const TALK = { on: false }; let PHOTO_OPEN = null;
      ${oneLine('VIEW_TITLES')}
      ${oneLine('DOCK_OF')}
      ${oneLine('NAV_PARENT')}
      ${oneLine('SHEETS')}
      ${navDrawLine}
      ${['switchTab', 'navPush', 'navShowBack', 'navShow', 'navBack', 'sheetOpened', 'closeSheet'].map(fnText).join('\n')}
      ${pop}
      return { switchTab, navBack, sheetOpened, tab: () => CUR_TAB };`)(
      $, history, window, () => {}, () => {}, () => {}, ...renders.map((r) => () => drawn.push(r)),
    ) as { switchTab: (w: string) => void; navBack: () => void; sheetOpened: (id: string) => void; tab: () => string };
    history.replaceState({ v: 'today', d: 0 }, '', '#today'); // the boot step
    const openSheet = (id: string) => { $(id)!.classList.add!('show'); core.sheetOpened(id); };
    const sheetShown = (id: string) => $(id)!.on.has('show');
    return { ...core, history, openSheet, sheetShown, backHidden: () => $('back-btn')!.hidden };
  }

  it('Today → Leads → Calendar → More, then Back three times: Calendar, Leads, Today — never straight to Today', () => {
    const n = navCore();
    n.switchTab('leads'); n.switchTab('cal'); n.switchTab('more');
    expect(n.tab()).toBe('more');
    expect(n.history.depth).toBe(3);
    n.navBack();
    expect(n.tab()).toBe('cal');
    n.navBack();
    expect(n.tab()).toBe('leads');
    n.navBack();
    expect(n.tab()).toBe('today');
    expect(n.history.depth).toBe(0);
    expect(n.backHidden()).toBe(true); // back on the screen the app opened on, with nothing behind
  });

  it('every sheet the page knows — the R35 maps sheet included — closes before a step back', () => {
    expect(SHEET_IDS).toContain('maps');
    for (const id of SHEET_IDS) {
      const n = navCore();
      n.switchTab('leads'); n.switchTab('cal');
      n.openSheet(id);
      expect(n.sheetShown(id), id).toBe(true);
      n.navBack();
      expect(n.sheetShown(id), id + ' closed').toBe(false);
      expect(n.tab(), id + ': the screen under it stays').toBe('cal');
      n.navBack();
      expect(n.tab(), id + ': the next Back steps back').toBe('leads');
    }
  });
});

describe('the red Sona flags say which call and open it', () => {
  const label = pageFn<(r: string) => string>('slipRuleLabel');

  it('each rule is named in plain words; an unknown one is still named, never blank', () => {
    expect(label('no-price')).toBe('Gave a price');
    expect(label('no-date-promise')).toBe('Promised a day or time');
    expect(label('no-diagnosis')).toBe('Diagnosed a tree over the phone');
    expect(label('no-financial-authority')).toBe('Offered a discount or free work');
    expect(label('forbidden-term')).toBe('Said a word Arbo never says');
    expect(label('something-new')).toBe('Broke a rule (something-new)');
  });

  it('the banner is a list of tappable rows — who, when, which rule — each opening that call', () => {
    const p = html.slice(html.indexOf('async function sonaPanel('), html.indexOf('const holdText = {', html.indexOf('async function sonaPanel(')));
    expect(p).toContain("const row = el('button', 'sliplink', (f.name || c.from || 'Caller') + ' · ' + fmtTime(c.at) + ' · ' + rules);");
    expect(p).toContain("row.addEventListener('click', () => openSonaCall(c.callId));");
    expect(p).toContain("' only in Quo now.'"); // a counted call Arbo no longer holds is said, not hidden
    expect(p).not.toContain('see the red cards');
  });

  it('every red card says which rule beside what Sona said, and can be found by its call', () => {
    expect(html).toContain("card.appendChild(el('div', 'storm', slipRuleLabel(sl.rule) + ' — Sona said: \\u201c' + sl.said + '\\u201d'));");
    expect(html).toContain('card.dataset.sonaCall = c.callId;');
    // Today puts the red and emergency calls first; Calls keeps every red call past its limit.
    expect(html).toContain('const order = withTranscripts ? sona : [...sona.filter(urgent), ...sona.filter((c) => !urgent(c))];');
    expect(html).toContain('if (withTranscripts) for (const c of order.slice(limit)) if (urgent(c)) shown.push(c);');
  });

  it('openSonaCall goes to Calls, scrolls to the card and flashes it', () => {
    const o = html.slice(html.indexOf('function openSonaCall('), html.indexOf('async function sonaPanel('));
    expect(o).toContain("switchTab('calls');");
    expect(o).toContain("card.scrollIntoView({ behavior: 'smooth', block: 'center' });");
    expect(o).toContain("card.classList.add('flash');");
  });
});

describe('the aerial-work warning names each person and opens their credential', () => {
  it('one row per blocked crew member — name and what is wrong — each scrolling to that person\'s card', () => {
    const at = html.indexOf('if (s.aerialBlocked.length) {');
    const block = html.slice(at, html.indexOf('if (s.certProblems.length) {', at));
    expect(block).toContain('for (const id of s.aerialBlocked) {');
    expect(block).toContain("const row = el('button', 'sliplink', ((lead && lead.crewMemberName) || 'A crew member') + (lead ? ' · ' + what(lead) : '')");
    expect(block).toContain("' · ' + (CERT_STATE[f.state] || [String(f.state).toUpperCase()])[0]");
    expect(block).toContain(".find((n) => n.dataset.crew === id);");
    expect(html).toContain('c.dataset.crew = f.crewMemberId;');
  });
});

describe('a refused save says the server\'s own words', () => {
  it('api() carries body.line on the error, and the breakdown sheet shows it', () => {
    expect(html).toContain("throw Object.assign(new Error(body.error || 'error'), { code: res.status, line: typeof body.line === 'string' ? body.line : null });");
    expect(html).toContain("out.appendChild(state('Not filed', e.line || ('The report did not save (' + (e.message || 'error') + '). Nothing was changed.')));");
  });
});

/** A one-line `const NAME = …;` table's value, as written. */
function oneLineVal(name: string): string {
  const m = new RegExp(`^const ${name} = (.*);$`, 'm').exec(html);
  if (!m) throw new Error('no one-line const ' + name);
  return m[1]!;
}

describe('three small navigation fixes from the usability audit', () => {
  it('the sheets\' close X draws its icon at button size, not the browser\'s 300×150 default', () => {
    expect(html).toContain('.sheet-head button .hico{width:21px;height:21px}');
  });
  it('Settings opens from the gear and lights no dock tab', () => {
    // Direction B P13: one DOCK_OF table says which tab lights (the plan: it replaces the hand-kept More list).
    const sw = html.slice(html.indexOf('function switchTab('), html.indexOf('\n}', html.indexOf('function switchTab(')));
    expect(sw).toContain('DOCK_OF[which]');
    const DOCK_OF = new Function(`return ${oneLineVal('DOCK_OF')};`)() as Record<string, string>;
    expect(DOCK_OF).not.toHaveProperty('settings');
    // R28: the Assistant desk sits behind More too; so do the Queue's four desks.
    for (const v of ['book', 'followups', 'money', 'fleet', 'safety', 'perf', 'more', 'permits', 'agents', 'measure', 'learn', 'assistant']) expect(DOCK_OF[v], v).toBe('more');
  });
});
