// QA round — the app shell and More (package shell-more). vitest has no DOM,
// so copy and wiring are source pins. The few pieces with real logic (the
// card time, the key check, the minute timer, the header line) are lifted
// out of the page and run against plain stand-ins for what they touch.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { loadAppHtml, loadTalkHtml } from '../src/server/appPage.js';
import { createArborRequestHandler } from '../src/server.js';

const html = loadAppHtml();
const sprite = readFileSync(new URL('../src/app/sprite.svg', import.meta.url), 'utf8');
const between = (from: string, to: string) => {
  const at = html.indexOf(from);
  expect(at, `page lost "${from}"`).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf(to, at));
};

// One top-level function out of the page (it closes with a "}" alone on its
// line), built with stand-ins for every outside name it reaches for.
function pageFn<T>(name: string, deps: Record<string, unknown> = {}): T {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return new Function(...Object.keys(deps), `${m[0]}\nreturn ${name};`)(...Object.values(deps)) as T;
}

type Field = { value: string; type: string };
const view = (fields: Field[] = [], active = false) => ({
  querySelectorAll: () => fields,
  classList: { contains: (c: string) => c === 'active' && active },
});

describe('More', () => {
  const more = between('function renderMore(', '// ---------- Theme');

  it('tiles line up, say what they open, and Settings has one door (the header button)', () => {
    expect(html).toMatch(/\.gtile\{[^}]*justify-content:flex-start/);
    expect(more).toContain("tile('i-crew', 'Crew', 'What the crew sees'");
    expect(more).toContain('The rest of Arbo, one tap away.');
    expect(more).toContain("'Which areas & ads pay'");
    expect(more).toContain("el('div', 'panel-title', 'Install')");
    for (const gone of ['Each desk has its own agent', 'Crew door', 'Money, fleet, crew', 'On your home screen', 'Links, Google, ZIP', 'renderSettings']) {
      expect(more, `More still carries "${gone}"`).not.toContain(gone);
    }
    expect(more).toContain("'Appearance'"); // Day/Night stays on More
  });

  it('the dock is near-opaque, so a solid button behind it never reads as a second selected tab', () => {
    expect(html).toMatch(/nav\{[^}]*background:color-mix\(in srgb,var\(--card\) 94%,transparent\);/);
    expect(html).not.toContain('var(--card) 82%');
  });

  it('More wears a grid, not "+"; the crew icon is a hard hat, not a desk bell', () => {
    expect(html).toContain('<button id="tab-more"><span class="navpill"><svg class="ico" aria-hidden="true"><use href="#i-more"/>');
    const sym = (id: string) => {
      const at = sprite.indexOf(`<symbol id="${id}"`);
      expect(at, `sprite lost ${id}`).toBeGreaterThan(-1);
      return sprite.slice(at, sprite.indexOf('</symbol>', at));
    };
    expect(sym('i-more').match(/<rect /g)).toHaveLength(4);
    expect(sym('i-crew')).toContain('M4.5 15.5a7 7 0 0 1 14 0');
    expect(sym('i-crew')).not.toContain('M10.5 9.5V6.75h3v2.75'); // the bell's knob
    expect(sym('i-plus')).toContain('M12 5.5v13'); // kept for a real "add"
  });

  it('the Talk tile reads the same R21 switch Today does, and goes quiet while the line is cut', () => {
    expect(more).toContain("api('/api/reception/status')");
    expect(more).toContain('if (!s.linkCut) return;');
    expect(more).toContain('talk.disabled = true;');
    expect(more).toContain('Off while Sona answers calls');
    expect(html).toMatch(/\.gtile:disabled\{opacity:/);
  });
});

describe('the Talk pages', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('talk.html uses the app palette and self-hosted type, and its back link opens the app', () => {
    const talk = loadTalkHtml();
    for (const want of ["url('/fonts/fraunces.woff2')", "url('/fonts/instrument-sans.woff2')", '#F7F5F0', '#1B4D3E', 'prefers-color-scheme:dark', 'href="/app"']) {
      expect(talk, `talk.html lost ${want}`).toContain(want);
    }
    expect(talk).not.toContain('href="/"'); // the public front door, not the app
    expect(talk).not.toContain('#7C3AED');
    expect(talk).not.toMatch(/https?:\/\//); // nothing from another host
  });

  it('the Talk-is-off page wears the same palette and type and leads back into the app', async () => {
    delete process.env.ARBO_LINK_ELEVENLABS;
    const srv = createServer(createArborRequestHandler());
    await new Promise<void>((r) => srv.listen(0, r));
    try {
      const res = await fetch(`http://127.0.0.1:${(srv.address() as { port: number }).port}/talk`);
      expect(res.status).toBe(503);
      const page = await res.text();
      for (const want of ['Talk to Arbo is off', 'Nothing was deleted', "url(/fonts/fraunces.woff2)", '#F7F5F0', '#1B4D3E', 'prefers-color-scheme:dark', 'href="/app"']) {
        expect(page, `talk-off page lost ${want}`).toContain(want);
      }
    } finally {
      srv.close();
    }
  });
});

describe('the key screen', () => {
  it('promises only what it can keep, on the screen and on the iPhone install card', () => {
    expect(html).toContain('Art-is-Tree ops. Enter your access key to open Arbo on this phone.');
    expect(html).not.toContain('once per device');
    expect(between('function installCard(', '// ---------- Offline')).toContain('You’ll enter your access key once more the first time you open it.');
    expect(html).toContain('#keywall button:disabled{opacity:.7}');
  });

  // Open, run against each answer the key check can get.
  async function open(typed: string, answer: unknown) {
    const els = { keygo: { disabled: false, textContent: 'Open' }, keyinput: { value: typed }, keyerr: { textContent: 'old line' } };
    const log: string[] = [];
    const saved: string[] = [];
    let busy: [boolean, string] | null = null;
    const unlock = pageFn<() => Promise<void>>('unlockWithKey', {
      $: (id: keyof typeof els) => els[id],
      api: async () => { busy = [els.keygo.disabled, els.keygo.textContent]; if (answer) throw answer; return {}; },
      showKeywall: (msg: string) => { log.push('wall: ' + msg); },
      hideKeywall: () => { log.push('hide'); },
      refreshAll: () => { log.push('refreshAll'); },
      refreshActiveMoreView: () => { log.push('refreshMoreDesk'); },
      localStorage: { setItem: (k: string, v: string) => { saved.push(k + '=' + v); } },
      KEY: '',
    });
    await unlock();
    return { log, saved, busy, button: [els.keygo.disabled, els.keygo.textContent], err: els.keyerr.textContent };
  }
  const fail = (code: number | undefined, message: string) => Object.assign(new Error(message), code ? { code } : {});

  it('a cut-mode 503 from Arbo itself still opens the app — the key passed the gate', async () => {
    const r = await open(' good-key ', fail(503, 'db_not_configured'));
    expect(r.log).toEqual(['hide', 'refreshAll', 'refreshMoreDesk']);
    expect(r.saved).toEqual(['arborKey=good-key']);
    expect(r.busy).toEqual([true, 'Checking…']);
    expect(r.button).toEqual([false, 'Open']);
    expect(r.err).toBe('');
  });

  it('a key Arbo could not check is never saved and never treated as accepted (§1B)', async () => {
    const reach = 'wall: Couldn’t reach Arbo to check the key — check your signal and try again.';
    for (const answer of [new TypeError('Failed to fetch'), fail(502, 'error'), fail(504, 'error')]) {
      const r = await open('k', answer);
      expect(r.log).toEqual([reach]);
      expect(r.saved).toEqual([]);
      expect(r.button).toEqual([false, 'Open']);
    }
  });

  it('a wrong key and an empty field each say so, and save nothing', async () => {
    const bad = await open('nope', fail(401, 'unauthorized'));
    expect(bad.log).toEqual(['wall: That key didn’t work — check it and try again.']);
    expect(bad.saved).toEqual([]);
    const empty = await open('   ', null);
    expect(empty.log).toEqual(['wall: Enter your access key.']);
    expect(empty.busy).toBeNull(); // nothing was sent
  });

  it('a good key opens the app and redraws the desk on screen too', async () => {
    const r = await open('k', null);
    expect(r.log).toEqual(['hide', 'refreshAll', 'refreshMoreDesk']);
    expect(r.saved).toEqual(['arborKey=k']);
  });

  it('the browser bar turns forest while the key screen is up, and goes back after', () => {
    const metas = [{ content: '#F7F5F0', dataset: {} }, { content: '#0B1512', dataset: {} }];
    const chrome = pageFn<(on: boolean) => void>('keywallChrome', { document: { querySelectorAll: () => metas } });
    chrome(true);
    chrome(true);
    expect(metas.map((m) => m.content)).toEqual(['#245F4D', '#245F4D']);
    chrome(false);
    expect(metas.map((m) => m.content)).toEqual(['#F7F5F0', '#0B1512']);
    expect(between('function showKeywall(', '\n}')).toContain('keywallChrome(true)');
    expect(between('function hideKeywall(', '\n}')).toContain('keywallChrome(false)');
    // Placed straight after showKeywall, ahead of the handlers (merge seam with Settings).
    const show = html.indexOf('function showKeywall(');
    expect(html.indexOf('function keywallChrome(')).toBeGreaterThan(show);
    expect(html.indexOf('function hideKeywall(')).toBeLessThan(html.indexOf("$('keygo').addEventListener('click', unlockWithKey)"));
  });
});

describe('refresh', () => {
  it('↻ also redraws the More desk on screen — Settings, Learn, Permits, Agents, Measure, More', () => {
    const ran: string[] = [];
    const deps: Record<string, unknown> = {};
    for (const n of ['renderSettings', 'renderPermits', 'renderAgents', 'renderMeasure', 'renderLearn', 'renderMore']) deps[n] = () => ran.push(n);
    let on = 'view-learn';
    deps.$ = (id: string) => view([], id === on);
    const redraw = pageFn<() => void>('refreshActiveMoreView', deps);
    redraw();
    expect(ran).toEqual(['renderLearn']);
    on = 'view-settings';
    redraw();
    expect(ran).toEqual(['renderLearn', 'renderSettings']);
    on = 'view-today'; // refreshAll owns this one
    redraw();
    expect(ran).toHaveLength(2);
    const handler = between("$('refresh').addEventListener", "$('settings-btn')");
    expect(handler.indexOf('refreshActiveMoreView()')).toBeGreaterThan(handler.indexOf('refreshAll()'));
  });

  it('the minute timer keeps Today fresh, skips a hidden page, and never wipes typed text', () => {
    const holdsTyping = pageFn<(v: unknown) => boolean>('holdsTyping');
    expect(holdsTyping(view([{ value: '', type: 'text' }, { value: 'on', type: 'checkbox' }]))).toBe(false);
    expect(holdsTyping(view([{ value: '12 Oak St', type: 'text' }]))).toBe(true);
    expect(holdsTyping(view([{ value: '2026-11-01', type: 'date' }]))).toBe(true);

    const ran: string[] = [];
    const TIMED = Object.fromEntries(['today', 'leads', 'book', 'calls'].map((t) => [t, () => ran.push(t)]));
    const page = { hidden: false };
    let wallUp = false;
    const els: Record<string, unknown> = {
      'view-today': view([], true), 'view-leads': view(), 'view-calls': view(),
      'view-book': view([{ value: '12 Oak St', type: 'text' }]), // half-typed estimate prep
      keywall: { classList: { contains: () => wallUp } },
    };
    const tick = pageFn<() => void>('autoRefresh', { document: page, $: (id: string) => els[id], TIMED, holdsTyping });
    tick();
    expect(ran).toEqual(['today', 'leads', 'calls']);
    page.hidden = true;
    tick();
    page.hidden = false;
    wallUp = true;
    tick();
    expect(ran).toHaveLength(3);

    const timed = between('const TIMED = {', '};');
    for (const r of ['renderToday', 'renderLeads', 'renderCalendar', 'renderBook', 'renderFollowUps', 'renderCalls', 'renderPerformance']) expect(timed).toContain(r);
    expect(timed).not.toContain('renderSettings'); // a half-typed ZIP must survive
    expect(html).toContain('setInterval(autoRefresh, 60000);');
    expect(html).toContain("document.addEventListener('visibilitychange', autoRefresh);");
    expect(html).toContain("window.addEventListener('online', () => { netState(); autoRefresh(); });");
    expect(html).not.toContain('setInterval(refreshAll');
  });
});

describe('the header', () => {
  it('Today drops the duplicate date; every other tab keeps it; simulation says so everywhere', () => {
    const sub = { textContent: '' };
    const line = (LINKS: string | null, CUR_TAB: string) => {
      pageFn<() => void>('setAppSub', { $: () => sub, LINKS, CUR_TAB, APPSUB_DATE: 'Sun, Oct 18' })();
      return sub.textContent;
    };
    expect(line(null, 'today')).toBe('Art-is-Tree');
    expect(line('live', 'calls')).toBe('Sun, Oct 18 · Art-is-Tree');
    expect(line('cut', 'perf')).toBe('Sun, Oct 18 · Art-is-Tree');
    expect(line('simulation', 'today')).toBe('SIMULATION · Art-is-Tree');
    // SIMULATION takes the name's place on a dated screen — one row at 390px.
    expect(line('simulation', 'perf')).toBe('SIMULATION · Sun, Oct 18');
    const sw = between('function switchTab(', '\n}');
    expect(sw).toContain('CUR_TAB = which;');
    expect(sw).toContain('setAppSub();');
    expect(html).toContain('setAppSub();\nLINKS_READY.then(setAppSub);');
  });

  it('on the office screen the header lines up with the content column', () => {
    expect(html).toContain('main{max-width:1120px;padding:12px 32px 24px}\n  header{padding-left:32px;padding-right:32px}.hrow{max-width:1056px}');
  });
});

describe('fmtTime: a card time always carries its day', () => {
  afterEach(() => { vi.useRealTimers(); });
  const fmt = pageFn<(iso: unknown) => string>('fmtTime');
  const t = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const now = (d: Date) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(d); };

  it('today is the time alone; yesterday and tomorrow say so; this week names the day; older names the date', () => {
    now(new Date(2026, 9, 18, 10, 0));
    const cases: Array<[Date, (d: Date) => string]> = [
      [new Date(2026, 9, 18, 15, 5), (d) => t(d)],
      [new Date(2026, 9, 17, 10, 1), (d) => 'Yesterday ' + t(d)], // under 24 hours ago, still yesterday
      [new Date(2026, 9, 19, 8, 0), (d) => 'Tomorrow ' + t(d)],
      [new Date(2026, 9, 15, 9, 30), (d) => d.toLocaleDateString([], { weekday: 'short' }) + ' ' + t(d)],
      [new Date(2026, 9, 22, 9, 30), (d) => d.toLocaleDateString([], { weekday: 'short' }) + ' ' + t(d)],
      [new Date(2026, 9, 11, 9, 30), (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + t(d)],
      [new Date(2026, 8, 28, 15, 5), (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + t(d)],
    ];
    for (const [d, want] of cases) expect(fmt(d.toISOString()), d.toString()).toBe(want(d));
  });

  it('compares calendar days, not 24-hour windows', () => {
    now(new Date(2026, 9, 18, 0, 30));
    const late = new Date(2026, 9, 17, 23, 50);
    expect(fmt(late.toISOString())).toBe('Yesterday ' + t(late));
    now(new Date(2026, 9, 18, 23, 59));
    const early = new Date(2026, 9, 18, 0, 1);
    expect(fmt(early.toISOString())).toBe(t(early));
  });

  it('no time, or one that does not parse, is blank — never "Invalid Date"', () => {
    for (const x of ['', null, undefined, 'not a time']) expect(fmt(x)).toBe('');
  });
});
