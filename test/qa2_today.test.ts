// Today screen, QA round 2 (package "today", fixes T0–T7). vitest has no DOM,
// so most of this is source pins; the few pieces with real logic (the hero
// subline, the systems strip, the Quo / phone-line / location panels) are
// lifted out of the page and run against a small stand-in element.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadAppHtml } from '../src/server/appPage.js';

const html = loadAppHtml();
const sprite = readFileSync(new URL('../src/app/sprite.svg', import.meta.url), 'utf8');
const between = (from: string, to: string) => {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  expect(a, `missing anchor ${from}`).toBeGreaterThan(-1);
  expect(b, `missing anchor ${to}`).toBeGreaterThan(a);
  return html.slice(a, b);
};
/** One top-level function's source, from its declaration to the "}" alone on its line. */
const src = (name: string): string => {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
};
/** That function, built with stand-ins for every outside name it reaches for. */
function pageFn<T>(name: string, deps: Record<string, unknown> = {}): T {
  return new Function(...Object.keys(deps), `${src(name)}\nreturn ${name};`)(...Object.values(deps)) as T;
}

// A stand-in element: enough of the DOM for the functions lifted below.
class FakeEl {
  className = '';
  children: FakeEl[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  private text = '';
  constructor(readonly tag: string) {}
  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(''); }
  set textContent(t: string) { this.text = t; this.children = []; }
  appendChild(n: FakeEl) { this.children.push(n); return n; }
  prepend(n: FakeEl) { this.children.unshift(n); }
  remove() {}
  replaceChildren(...n: FakeEl[]) { this.text = ''; this.children = [...n]; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener() {} // Direction B P10: the hero's stats are buttons
  querySelector(tag: string): FakeEl | null {
    for (const c of this.children) {
      if (c.tag === tag) return c;
      const d = c.querySelector(tag);
      if (d) return d;
    }
    return null;
  }
}
const el = (tag: string, cls?: string, text?: string) => {
  const n = new FakeEl(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const byClass = (n: FakeEl, cls: string): FakeEl | null => {
  if (n.className.split(' ').includes(cls)) return n;
  for (const c of n.children) { const d = byClass(c, cls); if (d) return d; }
  return null;
};
const fail = (code: number | undefined, message: string) => Object.assign(new Error(message), { code });
const feedLine = (_e: unknown, what: string, tail?: string) => el('div', 'feed-state unread', what + (tail ? ' ' + tail : ''));
const common = {
  el,
  feedLine,
  feedKind: () => 'unread',
  chip: (t: string, tone: string) => el('span', 'badge ' + tone, t),
  plural: (n: number, one: string, many?: string) => n + ' ' + (n === 1 ? one : many || one + 's'),
  fmtTime: () => '',
};

/** The single-quoted string literals in a piece of page code, comments left out. */
const literals = (code: string): string[] => code.split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .map((l) => l.replace(/\s\/\/ .*$/, ''))
  .join('\n')
  .match(/'(?:[^'\\\n]|\\.)*'/g) ?? [];

const today = between('async function renderToday()', '// ---------- Open loops');
const briefFetch = today.indexOf("api('/api/brief?from=");
const MINE = ['stormBanner', 'locationStrip', 'inboxIntentPanel', 'studyPanel', 'sonaPanel', 'outreachPanel',
  'websiteFormsPanel', 'receptionStrip', 'renderToday', 'buildHero', 'buildSystems', 'heroLoops'];

describe('T0: Today speaks the shared vocabulary', () => {
  it('every chip is chip(text, tone) — no legacy badge() call left in Today’s functions', () => {
    for (const f of MINE) expect(src(f), `${f} still calls badge()`).not.toContain('badge(');
    expect(today).toContain("chip(stop.kind === 'job' ? 'JOB' : 'ESTIMATE', 'info')");
    expect(today).toContain("stop.redFlags.forEach(f => b.appendChild(chip(f, 'alarm')))");
    expect(today).toContain("stop.tags.forEach(t => b.appendChild(chip(t, 'info')))");
    const sona = src('sonaPanel');
    expect(sona).toContain("chip('EMERGENCY', 'alarm')");
    expect(sona).toContain("chip('SONA BROKE A RULE', 'stop')");
    expect(sona).toContain("chip(String(f.jobType).toUpperCase(), 'info')");
  });

  it('a customer waiting on Mike is a watch chip on the clay call-back edge, every other stage is context', () => {
    const stages = between('const STUDY_STAGE = {', '};');
    expect(stages).toContain("waiting_on_us: ['WAITING ON YOU', 'watch']");
    expect(stages).not.toContain("'b-");
    expect(stages.match(/'info'\]/g)).toHaveLength(8);
    const study = src('studyPanel');
    expect(study).toContain("n.stage === 'waiting_on_us' ? ' callback' : ''");
    expect(study).not.toContain("' emergency'");
    expect(study).toContain('chip(label, tone)');
  });

  it('real plurals, plain words, no env var, no "since deploy", no "This is not zero" in Today’s functions', () => {
    for (const f of MINE) {
      const s = src(f);
      for (const lit of literals(s)) {
        expect(lit, `${f} still writes a "(s)" plural`).not.toMatch(/[a-z]\(s\)/);
        expect(lit, `${f} names an env var in its copy`).not.toMatch(/[A-Z]{2,}_[A-Z0-9_]{2,}/);
      }
      expect(s, `${f} still says "since deploy"`).not.toContain('since deploy');
      expect(s, `${f} still carries the old honesty tag`).not.toContain('This is not zero');
    }
    expect(src('stormBanner')).toContain("plural(nr, 'booked stop')");
    expect(src('outreachPanel')).toContain("'OFF — not turned on yet'");
    expect(src('outreachPanel')).not.toContain('ARBO_OUTREACH');
    expect(src('receptionStrip')).toContain('since Arbo last restarted');
    expect(src('websiteFormsPanel')).toContain('Connected — no submissions since Arbo last restarted.');
    const inbox = src('inboxIntentPanel');
    expect(inbox).not.toContain('lastModelErrorName');
    expect(inbox).not.toContain('intent model');
    expect(inbox).not.toContain('the engine is watching');
  });

  it('a read that failed is the feed-state row, never the help-tip style', () => {
    expect(src('studyPanel')).toContain("el('div', 'feed-state unread', 'Your assistant");
    expect(src('sonaPanel')).toContain("el('div', 'feed-state unread', 'Last read of Quo: '");
  });
});

describe('T1: the hero says each fact once', () => {
  it('a real number stays on its tile; the subline names only the dashes, one per line, no "·"', () => {
    const hero = src('buildHero');
    expect(hero).toContain("facts[key] = String(value) === '–' ? fact : null;");
    expect(hero).toContain("const keys = ['stops', 'loops', 'alerts'];");
    expect(hero).toContain("sub.replaceChildren(...parts.map((p) => el('span', '', p)));");
    expect(hero).not.toContain("'· '");
    expect(html).toContain('.hero .sub span{display:block;white-space:nowrap}');
  });

  it('runs: "Reading the day…" until every feed answers, then only the gaps, then nothing', () => {
    const ring = { svg: el('svg'), set: () => {}, clock: () => {} };
    const { box, HERO } = new Function('el', 'dayRing', 'dayFraction',
      `let HERO = null;\n${src('buildHero')}\nconst box = buildHero();\nreturn { box, HERO };`,
    )(el, () => ring, () => 0.5) as { box: FakeEl; HERO: { stat: (k: string, v: unknown, c: string, f: string) => void } };
    const sub = byClass(box, 'sub')!;
    const lines = () => sub.children.map((c) => c.textContent);
    expect(sub.textContent).toBe('Reading the day…');
    HERO.stat('stops', 2, '', '2 stops today');
    expect(sub.textContent).toBe('Reading the day…'); // loops and weather have not answered
    HERO.stat('loops', '–', '', 'loops cut');
    expect(lines()).toEqual(['loops cut']);
    HERO.stat('alerts', '–', '', 'weather unreadable');
    expect(lines()).toEqual(['loops cut', 'weather unreadable']);
    for (const l of lines()) expect(l).not.toContain('·');
    HERO.stat('loops', 3, 'warn', '3 open loops');
    expect(lines()).toEqual(['weather unreadable']);
    HERO.stat('alerts', 0, '', 'no weather alerts');
    expect(sub.textContent).toBe(''); // every feed read: the tiles say it all
    expect(byClass(box, 'hstat')!.querySelector('b')!.textContent).toBe('2');
  });

  it('an unread ring’s legend is a dash — the subline already names it', () => {
    expect(today).toContain("HERO.legend('stops', '–')");
    expect(src('heroLoops')).toContain("HERO.legend('loops', '–')");
    expect(today).toContain("'schedule ' + why");
    expect(src('heroLoops')).toContain("'loops ' + why");
  });

  it('the stops legend names the next stop by the clock (route order is not clock order)', () => {
    expect(today).toContain(".sort((a, b) => Date.parse(a.timeIso) - Date.parse(b.timeIso))[0]");
    expect(today).toContain("next ? 'next ' + fmtWhen(next.timeIso) : !s.totalStops ? (onlyArbo ? 'none in Arbo' : 'none today') : timed.length ? 'all times passed' : 'no times set'");
    expect(today).toContain('nothing records a stop as done (D85)');
    expect(today).toContain("(s.emergencies || s.redFlagCount) ? 'hot' : ''");
    // H4: "today" only when the day is really read; Arbo's own bookings say "in Arbo today".
    expect(today).toContain("plural(s.totalStops, 'stop') + (onlyArbo ? ' in Arbo today' : ' today')");
  });
});

describe('T2: the systems strip carries only what the hero does not', () => {
  it('no Weather, Loops or Schedule chip; their sysSet calls stay and land nowhere', () => {
    const labels = between('const SYS_LABELS = {', '};');
    for (const k of ['Weather', 'Loops', 'Schedule']) expect(labels).not.toContain(k);
    expect(src('stormBanner')).toContain("sysSet('weather'");
    expect(src('heroLoops')).toContain("sysSet('loops'");
    expect(today).toContain("sysSet('schedule'");
    expect(src('buildSystems')).toContain("'cut on purpose'");
    expect(html).toContain('.systems{display:flex;flex-wrap:wrap;');
    expect(html).toContain('.sys.down{order:-2}.sys.warn{order:-1}');
  });

  it('runs: network shows only while offline; an unreadable links read is amber, not red', async () => {
    const labels = /^const SYS_LABELS = .*$/m.exec(html)![0];
    let reject: (e: Error) => void = () => {};
    const health = new Promise((_r, j) => { reject = j; });
    const { row, SYS } = new Function('el', 'api', 'navigator',
      `${labels}\nlet SYS = null;\n${src('buildSystems')}\nconst row = buildSystems();\nreturn { row, SYS: (...a) => SYS(...a) };`,
    )(el, () => health, { onLine: true }) as { row: FakeEl; SYS: (k: string, l: string, t: string) => void };
    expect(row.children).toHaveLength(2);
    const [links, network] = row.children as [FakeEl, FakeEl];
    expect(network.style.display).toBe('none');
    SYS('network', 'down', 'offline');
    expect(network.style.display).toBe('');
    expect(network.textContent).toBe('Network · offline');
    SYS('network', 'ok', 'online');
    expect(network.style.display).toBe('none');
    SYS('weather', 'down', 'unreadable'); // no chip: a no-op, never a throw
    expect(row.children).toHaveLength(2);
    reject(new Error('offline'));
    await health.catch(() => {});
    await Promise.resolve();
    expect(links.className).toBe('sys warn');
    expect(links.textContent).toBe('Data links · unreadable');
    expect(src('buildSystems')).not.toContain("'down', 'unreadable'");
  });
});

describe('T3: the tile grid stands on its own feeds', () => {
  it('the tiles and their reads sit above the brief fetch, so a cut schedule keeps them', () => {
    expect(today.indexOf('instr.prepend(hud)')).toBeGreaterThan(-1);
    expect(today.indexOf('instr.prepend(hud)')).toBeLessThan(briefFetch);
    expect(today.indexOf('instr.appendChild(loopsPanel)')).toBeLessThan(briefFetch);
    for (const feed of ["api('/api/queue')", "api('/api/properties')", "api('/api/agents/runs?limit=5')", "api('/api/money')"]) {
      expect(today.indexOf(feed), feed).toBeGreaterThan(-1);
      expect(today.indexOf(feed), feed).toBeLessThan(briefFetch);
    }
    // Direction B P15: the Yard check left Today for Estimate (R29 #4) — nothing sits between the tiles and the loops.
    expect(today).not.toContain('yardBtn');
  });

  it('jobs and estimates keep the "today" scope, and a dead schedule names why on them', () => {
    expect(today).toContain("const jobsTile = tile('–', 'jobs today');");
    expect(today).toContain("const estTile = tile('–', 'estimates today');");
    const caught = today.slice(briefFetch, today.indexOf('const s = brief.summary;'));
    expect(caught).toContain('tileWhy(jobsTile, why); tileWhy(estTile, why);');
    expect(today).toContain('setTile(jobsTile, s.jobs || 0); setTile(estTile, s.estimates || 0);');
    expect(today).not.toContain("'jobs')");
    expect(today).not.toContain("'estimates')");
  });

  it('a safety flag takes the first slot, in a real plural that counts stops', () => {
    expect(today).toContain("hud.prepend(tile(s.redFlagCount, s.redFlagCount === 1 ? 'flagged stop' : 'flagged stops', 'hot wide'))");
    // R26: the emergencies tile counts emergency stops AND emergency leads (setEmergencies), in a real plural.
    expect(today).toContain("emgTile.querySelector('span').textContent = n === 1 ? 'emergency' : 'emergencies';");
    expect(today).not.toContain("'red flags'");
    // Emergencies are prepended last, so they lead.
    expect(today.indexOf('hud.prepend(tile(s.redFlagCount')).toBeLessThan(today.indexOf("setEmergencies('stops', s.emergencies || 0)"));
    expect(today).toContain('hud.prepend(emgTile);');
    // and they fill the first row exactly, so the six tiles below stay one even row on the office screen.
    expect(today).toContain("flags.forEach((t) => { t.style.gridColumn = flags.length === 1 ? '1 / -1' : 'span 3'; });");
  });

  it('to bill never counts the job with no agreed figure, and never reads a calm 0 over it', () => {
    // Direction B P14: counted through moneyCounts (shared with Office's Money tile) — the same three rules.
    expect(html).toContain('noFigure: (m.blocked || []).length');
    expect(today).toContain("setTile(billTile, mc.bill, (mc.bill || mc.noFigure) ? 'warn' : 'ok-t');");
    expect(today).toContain("if (mc.noFigure) billTile.appendChild(el('small', '', '+' + mc.noFigure + ' no agreed figure'));");
  });
});

describe('T4: every Today note sits in a titled card', () => {
  it('a failed location read is a titled card; the live ON/OFF strip stays plain', async () => {
    expect(src('locationStrip')).toContain("'panel-title', 'Location tracking'");
    expect(today).toContain("const locSlot = el('div', 'slot plain');");
    expect(today).toContain("if (b.dataset.feed) locSlot.className = 'slot';");
    const loc = pageFn<() => Promise<FakeEl>>('locationStrip', {
      ...common, api: async () => { throw fail(503, 'db_not_configured'); }, LINKS_READY: Promise.resolve(), showSaveFail: () => {}, renderToday: () => {},
    });
    const w = await loc();
    expect(w.dataset.feed).toBe('1');
    expect(w.children.map((c) => c.className)).toEqual(['panel-title', 'feed-state unread']);
    expect(w.children[0]!.textContent).toBe('Location tracking');
  });

  it('the phone-line card always opens with its title; a cut line is a feed-state, with no vendor names', async () => {
    const rec = src('receptionStrip');
    expect(rec.match(/'panel-title', 'Arbo’s phone line'/g)).toHaveLength(2);
    expect(rec).toContain("el('div', 'feed-state cut', 'Off on purpose — disconnected while Sona handles calls. Nothing was deleted.')");
    expect(rec).not.toContain("'storm-muted', 'Arbo’s own phone line");
    expect(rec).not.toContain("'storm-muted', 'Arbo\\u2019s own phone line");
    expect(rec).not.toContain('ElevenLabs + Twilio');
    expect(today).toContain("const recSlot = el('div', 'slot');");
    const run = (api: () => Promise<unknown>) =>
      pageFn<() => Promise<FakeEl | null>>('receptionStrip', { ...common, api, document: { getElementById: () => null } })();
    const dead = (await run(async () => { throw fail(undefined, 'error'); }))!;
    expect(dead.children.map((c) => c.className)).toEqual(['panel-title', 'feed-state unread']);
    const cut = (await run(async () => ({ linkCut: true })))!;
    expect(cut.children.map((c) => c.className)).toEqual(['panel-title', 'feed-state cut']);
    expect(await run(async () => { throw fail(401, 'unauthorized'); })).toBeNull();
  });
});

describe('T5: one cause, one card, plain words', () => {
  it('each Quo panel marks "Quo isn’t connected", and only that state', async () => {
    const quoOff = async () => { throw fail(503, 'quo_not_configured'); };
    const cut = async () => { throw fail(503, 'db_not_configured'); };
    const deps = { ...common, renderCalls: () => {}, renderToday: () => {} };
    const study = (api: () => Promise<unknown>) => pageFn<(n: number) => Promise<FakeEl>>('studyPanel', { ...deps, api })(5);
    const outreach = (api: () => Promise<unknown>) => pageFn<(f: boolean) => Promise<FakeEl>>('outreachPanel', { ...deps, api })(false);
    expect((await study(quoOff)).dataset.quoOff).toBe('1');
    expect((await study(cut)).dataset.quoOff).toBeUndefined();
    expect((await outreach(quoOff)).dataset.quoOff).toBe('1');
    expect((await outreach(cut)).dataset.quoOff).toBeUndefined();
    const sona = (state: string) => pageFn<(n: number, t: boolean) => Promise<FakeEl>>('sonaPanel', {
      ...deps, api: async () => ({ status: { registration: { state, detail: 'Registering with Quo…' }, reading: true, quoRecord: {} }, calls: [] }),
      sonaSlipBox: () => null, // Direction B P16: the red flag's one builder (no slips here; its own tests: navBack, directionB_leadsHub)
    })(3, false);
    const off = await sona('not_configured');
    expect(off.dataset.quoOff).toBe('1');
    expect(off.children.map((c) => c.className)).toEqual(['panel-title', 'feed-state unset']);
    expect(off.textContent).toContain('Waiting on Quo — Sona’s calls are not reaching Arbo.');
    expect((await sona('pending')).dataset.quoOff).toBeUndefined();
  });

  it('Today fills its three Quo slots from one read, and folds them into ONE titled card when all three are off', () => {
    // QA round 3: the fold is the shared fillQuoSlots (Calls uses it too); its
    // title fits one line at phone width, and its last sentence names what is not zero.
    const fold = src('fillQuoSlots');
    expect(fold).toContain('bs.every((b) => b && b.dataset.quoOff)');
    expect(fold).toContain("el('div', 'panel-title', 'Quo')");
    // Direction B P16: the body is one builder, quoOffLine (the Leads head says the same words in the flag's place).
    expect(fold).toContain('q.appendChild(quoOffLine(links));');
    const words = src('quoOffLine');
    expect(words).toContain("el('div', 'feed-state unset', 'Quo isn’t connected to Arbo yet — Arbo can’t read your customer threads, can’t text anyone, and Sona’s calls aren’t reaching Arbo. That doesn’t mean there are no customer threads or Sona calls.')");
    expect(words.match(/That doesn’t mean/g)).toHaveLength(1);
    // Direction B P12: Today hands the fold its feeds card's place (the one Quo card folds into it when off).
    expect(today).toContain('fillQuoSlots([studyPanel(5), outreachPanel(false), sonaPanel(3, false)], [studySlot, outreachSlot, sonaSlot], feeds.place);');
    // The slots are placed before any read, in a fixed order.
    const slots = ['const studySlot', 'const outreachSlot', 'const sonaSlot'].map((x) => today.indexOf(x));
    expect(slots).toEqual([...slots].sort((a, b) => a - b));
    expect(slots[2]).toBeLessThan(today.indexOf('fillQuoSlots([studyPanel(5)'));
    expect(today).not.toContain('studyPanel(5).then');
    expect(today).not.toContain('outreachPanel(false).then');
    expect(today).not.toContain('sonaPanel(3, false).then');
  });

  it('the plain tags replace "This is not zero …" on Today and in the Quo detail', () => {
    expect(src('inboxIntentPanel')).toContain('That doesn’t mean no mail came in.');
    expect(src('inboxIntentPanel')).toContain('Nothing needs you in the inbox right now.');
    expect(src('inboxIntentPanel')).toContain('⚠ Arbo’s mail reader is down — sorting mail by simple rules for now.');
    expect(src('sonaPanel')).toContain('That doesn\\u2019t mean no calls came in.');
    expect(src('websiteFormsPanel')).toContain('Website forms aren’t connected to Arbo yet. They still arrive in your Gmail inbox.');
    const intake = readFileSync(new URL('../src/ops/quoIntake.ts', import.meta.url), 'utf8');
    expect(intake).toContain('Quo isn’t connected to Arbo yet — Sona’s calls are not reaching Arbo. That doesn’t mean no calls came in.');
    expect(intake).not.toContain('This is not zero calls');
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(server).toContain('Sona’s calls cannot reach Arbo. That doesn’t mean no calls came in.');
    expect(server).toContain('Sona calls are NOT reaching Arbo. That doesn’t mean no calls came in.');
    expect(server).not.toContain("setRegistration('failed', 'Arbo has no public web address to give Quo — Sona’s calls cannot reach Arbo. This is not zero calls.')");
  });
});

describe('T6: the Yard check says what it is for; the calendar way out sits in the schedule card', () => {
  // Direction B P15 (R29 #4): the Yard check lives on Estimate now, with the same words and the same sheet.
  it('names the will-this-job-pay check', () => {
    expect(html).toMatch(/key: 'yard', [^}]*title: 'Yard check — will this job pay\?'/);
    expect(html).not.toContain('run a number');
    expect(html.slice(html.indexOf('async function renderEstimate()'))).toContain('openYard();');
  });

  it('a dead schedule card carries its own Open the Calendar button', () => {
    const caught = today.slice(briefFetch, today.indexOf('const s = brief.summary;'));
    expect(caught).toContain("const sc = feedState(e, 'Schedule', 'an empty day');");
    expect(caught).toContain("calBtn.prepend(icon('i-calendar'));");
    expect(caught).toContain("calBtn.style.margin = '14px 0 0';");
    // Direction B P12: the card reaches the day through the feeds card's place (kept in the day, counted on the card).
    expect(caught.indexOf('sc.appendChild(calBtn);')).toBeLessThan(caught.indexOf('schedDone(sc);'));
    expect(caught).not.toContain('day.appendChild(calBtn)');
    expect(caught).toContain('Open the Calendar tab');
  });
});

describe('T7: the route button and the unread ring', () => {
  it('Route the day carries the route icon and sits left-aligned on the office screen', () => {
    expect(sprite).toContain('<symbol id="i-route"');
    expect(today).toContain("r.prepend(icon('i-route'));");
    expect(today).toContain("'Route the day (' + plural(addrs.length, 'stop') + ')'");
    const wide = html.indexOf('@media (min-width:900px){');
    const rule = html.indexOf('#view-today .hud .wide{grid-column:span 2}\n  #view-today .routebtn{justify-self:start;padding:0 24px}');
    expect(rule).toBeGreaterThan(wide);
  });

  it('an unread ring is neutral dots, not the data colour', () => {
    expect(html).toContain('.dayring .unk{stroke:rgba(244,239,224,.45)}');
    expect(html).not.toContain('.dayring .unk{stroke-opacity:.45}');
  });
});
