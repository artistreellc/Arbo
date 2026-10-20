// QA round 2 — Permit Desk, Measure desk and the crew door. vitest has no DOM,
// so the UI is pinned by its source, and the small pieces that decide what a
// person reads (factCard's source labels, checkCard's chip and jump, upWords,
// crewWhy, the gate's refusal handling) are lifted out of the page and run on
// stand-ins. The shared chip()/fmtWhen() helpers land from the 'shared'
// package; here they are stand-ins, so these tests hold this package's code.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadAppHtml } from '../src/server/appPage.js';
import { FACTS } from '../src/permitting/publicWorks/facts.js';
import { jobChecklist, type JobInput } from '../src/permitting/publicWorks/query.js';
import { createApi, type DataSource } from '../src/server/api.js';
import { createSimSource } from '../src/dev/simSource.js';
import { requiredReadSeconds } from '../src/crew/briefingGate.js';

const html = loadAppHtml();
const crew = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');

/** The source between two anchors. */
function region(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(a);
  return src.slice(a, b);
}

/** One top-level function (closing "}" alone on its line), built with stand-ins. */
function pageFn<T>(src: string, name: string, deps: Record<string, unknown> = {}): T {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(src);
  if (!m) throw new Error(`no function ${name} in the page`);
  return new Function(...Object.keys(deps), `${m[0]}\nreturn ${name};`)(...Object.values(deps)) as T;
}

/** A page constant, evaluated: `const NAME = <value>;` (the value may span lines), with any page names it reads. */
function pageConst<T>(src: string, name: string, deps: Record<string, unknown> = {}): T {
  const m = new RegExp(`^const ${name} = ([\\s\\S]*?);$`, 'm').exec(src);
  if (!m) throw new Error(`no const ${name} in the page`);
  return new Function(...Object.keys(deps), `return ${m[1]}`)(...Object.values(deps)) as T;
}

/** Just enough DOM for the card builders. */
class FakeNode {
  kids: FakeNode[] = [];
  listeners: Record<string, (ev: unknown) => void> = {};
  parent: FakeNode | null = null;
  scrolled: unknown[] = [];
  isConnected = true;
  href = '';
  id = '';
  target = '';
  rel = '';
  title = '';
  constructor(public tag: string, public cls = '', public text = '') {}
  appendChild(k: FakeNode): FakeNode { k.parent = this; this.kids.push(k); return k; }
  addEventListener(type: string, fn: (ev: unknown) => void): void { this.listeners[type] = fn; }
  querySelector(sel: string): FakeNode | null {
    const want = sel.replace(/^\./, '');
    for (const k of this.kids) {
      if (k.cls.split(' ').includes(want)) return k;
      const d = k.querySelector(sel);
      if (d) return d;
    }
    return null;
  }
  remove(): void { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
  scrollIntoView(opts: unknown): void { this.scrolled.push(opts); }
  get firstChild(): FakeNode | null { return this.kids[0] ?? null; }
  get textContent(): string { return this.text + this.kids.map((k) => k.textContent).join(''); }
}
const el = (tag: string, cls?: string, text?: string): FakeNode => new FakeNode(tag, cls ?? '', text ?? '');
const chip = (text: string, tone: string): FakeNode => new FakeNode('span', 'chip ' + tone, text);
const toneOf = (n: FakeNode | null | undefined): string => (n ? n.cls.replace(/^chip /, '') : '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Stand-in for the shared fmtWhen on a bare day ('2026-09-28' -> 'Sep 28').
const fmtWhen = (v: string): string => { const [, m, d] = v.split('-').map(Number); return MONTHS[(m ?? 1) - 1] + ' ' + d; };

const nb = new Function(`return ${/const nb = (\(s\) => [^\n]+);/.exec(html)?.[1]}`)() as (s: string) => string;
const KNOWN_HOSTS = pageConst<Record<string, string>>(html, 'KNOWN_HOSTS');
// R26 (qa-x6): the three permit words point at the one label per permit state.
const PERMIT_STATE = pageConst<Record<string, [string, string]>>(html, 'PERMIT_STATE');
const PERMIT_STATUS = pageConst<Record<string, [string, string]>>(html, 'PERMIT_STATUS', { PERMIT_STATE });
const CONF_BADGE = pageConst<Record<string, [string, string]>>(html, 'CONF_BADGE');

function buildDeps(byId: Record<string, FakeNode> = {}, win: { scrollTo: unknown[] } = { scrollTo: [] }) {
  const document = {
    createTextNode: (t: string) => new FakeNode('#text', '', t),
    getElementById: (id: string) => byId[id] ?? null,
  };
  const whoLine = pageFn<(w: unknown) => FakeNode>(html, 'whoLine', { el, document, nb });
  const window = { scrollTo: (o: unknown) => win.scrollTo.push(o) };
  return { el, chip, nb, whoLine, fmtWhen, KNOWN_HOSTS, PERMIT_STATUS, document, window };
}
type Fact = (typeof FACTS)[number];
const factCardOf = (deps: ReturnType<typeof buildDeps>) => pageFn<(f: Fact, stale: boolean) => FakeNode>(html, 'factCard', deps);

describe('Permits — one chip table; the power-line CALL FIRST is the only alarm', () => {
  it('statuses are [label, tone] on the shared tones', () => {
    expect(PERMIT_STATUS).toEqual({
      'PERMIT LIKELY': ['PERMIT LIKELY', 'watch'],
      'REVIEW NEEDED': ['PERMIT: REVIEW NEEDED', 'watch'],
      'NO OVERLAY–VERIFY': ['NO OVERLAY — VERIFY W/ CITY', 'info'],
      'CALL FIRST': ['CALL FIRST', 'alarm'],
      'TICKET REQUIRED': ['TICKET REQUIRED', 'stop'],
    });
  });

  it('only the Dominion power-line step carries safety, in every city', () => {
    for (const city of ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Portsmouth'] as const) {
      const all: JobInput = { city, inRpa: true, nearPowerLines: true, inRightOfWay: true, stumpGrinding: true, historicDistrict: true, haulingDebris: true, burning: true };
      const items = jobChecklist(all);
      const safe = items.filter((i) => i.safety);
      expect(safe, city).toHaveLength(1);
      expect(safe[0]!.step).toMatch(/^Call Dominion Energy/);
      expect(items.filter((i) => i.status === 'CALL FIRST'), city).toHaveLength(2); // hauling's call-ahead shares the words
    }
  });

  it('checkCard: power lines alarm, hauling amber, VA811 stop, no-overlay grey, an unknown status amber', () => {
    const checkCard = pageFn<(it: unknown) => FakeNode>(html, 'checkCard', buildDeps());
    const items = jobChecklist({ city: 'Norfolk', inRpa: false, nearPowerLines: true, inRightOfWay: 'unknown', stumpGrinding: true, historicDistrict: false, haulingDebris: true, burning: false });
    const tone = (pred: (s: string) => boolean): string => {
      const it = items.find((i) => pred(i.step));
      expect(it).toBeDefined();
      return toneOf(checkCard(it).kids[0]?.kids[0]);
    };
    expect(tone((s) => s.startsWith('Call Dominion'))).toBe('alarm');
    expect(tone((s) => s.includes('drop-off site'))).toBe('watch');
    expect(tone((s) => s.startsWith('Call VA811'))).toBe('stop');
    expect(tone((s) => s.includes('no RPA overlay'))).toBe('info');
    expect(tone((s) => s.startsWith('UNKNOWN: right-of-way'))).toBe('watch');
    expect(toneOf(checkCard({ step: 's', why: 'w', factIds: [], status: 'SOMETHING NEW' }).kids[0]?.kids[0])).toBe('watch');
  });

  it('rule cards: city info, SOURCED good / anything else watch, RE-CHECK DUE watch', () => {
    const card = factCardOf(buildDeps());
    const sourced = FACTS.find((f) => f.confidence === 'SOURCED')!;
    const unconfirmed = FACTS.find((f) => f.confidence !== 'SOURCED')!;
    const s = card(sourced, true).kids[0]!.kids.map((k) => [k.text, toneOf(k)]);
    expect(s).toEqual([[sourced.city.toUpperCase(), 'info'], ['SOURCED', 'good'], ['RE-CHECK DUE', 'watch']]);
    expect(toneOf(card(unconfirmed, false).kids[0]!.kids[1])).toBe('watch');
  });

  it('Measure confidence: GOOD good; FAIR, LOW and UNREADABLE amber (a level, not a hazard)', () => {
    expect(CONF_BADGE).toEqual({ good: ['GOOD', 'good'], fair: ['FAIR', 'watch'], low: ['LOW', 'watch'], unreadable: ['UNREADABLE', 'watch'] });
    const result = region(html, 'function measureResult(', '// ---------- Learn desk');
    expect(result).toContain("const cb = CONF_BADGE[conf.level] || [conf.level, 'watch'];");
    expect(result).toContain('const b = chip(cb[0], cb[1]);');
  });

  it('a failed read is a named feed line or state, never the alarm box', () => {
    const permits = region(html, 'async function renderPermits()', 'function checkCard(');
    expect(permits).toContain("out.replaceChildren(el('div', 'feed-state unread', (e.code ?");
    expect(permits).toContain("state('Permit base — ' + FEED_WORD[feedKind(e)], 'Arbo could not read its permit base right now. That is not the same as “no rules”.')");
    expect(permits).not.toContain('Permit base unavailable');
  });
});

describe('Permits — rule cards read like a person wrote them', () => {
  it('"Checked" is a human day, never a machine date', () => {
    const card = factCardOf(buildDeps());
    const src = region(html, 'function factCard(', '// ---------- Agents desk');
    expect(src).toContain("'Checked ' + nb(fmtWhen(f.verifiedOn))");
    for (const f of FACTS) {
      const line = card(f, false).querySelector('.srcs')!.textContent;
      expect(line, f.id).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(line, f.id).toMatch(/^Checked [A-Z][a-z]{2} \d{1,2} · /);
    }
  });

  it('no card shows two identical source labels, none says TCIA, and correspondence is "your"', () => {
    const card = factCardOf(buildDeps());
    let numbered = 0;
    for (const f of FACTS) {
      const srcs = card(f, false).querySelector('.srcs')!;
      const labels = srcs.kids.slice(1).filter((k) => k.text !== ' · ').map((k) => k.text);
      expect(labels, f.id).toHaveLength(f.sourceUrls.length);
      expect(new Set(labels).size, f.id).toBe(labels.length);
      for (const l of labels) expect(l, f.id).not.toMatch(/tcia/i);
      if (labels.some((l) => / \(\d\)$/.test(l))) numbered++;
      f.sourceUrls.forEach((u, i) => {
        if (u.startsWith('arbo:')) expect(labels[i], f.id).toMatch(/^your permit correspondence/);
      });
    }
    expect(numbered).toBeGreaterThan(0); // the repeated-host cards really are numbered
    expect(html).not.toContain('Mike’s permit correspondence');
    expect(KNOWN_HOSTS['tcimag.tcia.org']).toBe('TCI Magazine (trade press)');
  });

  it('two pages on one site are numbered (1), (2); a single page is not', () => {
    const card = factCardOf(buildDeps());
    const f = { ...FACTS[0]!, sourceUrls: ['https://parks.virginiabeach.gov/a', 'https://www.parks.virginiabeach.gov/b', 'https://pw.virginiabeach.gov/c'] };
    const labels = card(f, false).querySelector('.srcs')!.kids.filter((k) => k.tag === 'a').map((k) => k.text);
    expect(labels).toEqual(['parks.virginiabeach.gov (1)', 'parks.virginiabeach.gov (2)', 'pw.virginiabeach.gov']);
  });

  it('an UNCONFIRMED rule with no office says so; a SOURCED one without an office stays quiet', () => {
    const card = factCardOf(buildDeps());
    const NO_OFFICE = 'No office on file — ask the city which office handles this.';
    // QA round 3: a state, regional or industry rule is no city's to answer.
    const NO_OFFICE_WIDE = 'No office on file — confirm it with the body that publishes it before relying on it.';
    const lines = (f: Fact) => card(f, false).querySelector('.factmeta')!.kids.map((k) => k.text);
    const notCity = (f: Fact) => f.city === 'Virginia' || f.city === 'Regional';
    const bare = FACTS.filter((f) => !f.whoToCall);
    expect(bare.some((f) => f.confidence === 'UNCONFIRMED')).toBe(true);
    for (const f of bare) {
      if (f.confidence === 'SOURCED') {
        expect(lines(f), f.id).not.toContain(NO_OFFICE);
        expect(lines(f), f.id).not.toContain(NO_OFFICE_WIDE);
      } else if (notCity(f)) {
        expect(lines(f), f.id).toContain(NO_OFFICE_WIDE);
        expect(lines(f), f.id).not.toContain(NO_OFFICE);
      } else expect(lines(f), f.id).toContain(NO_OFFICE);
    }
    for (const f of FACTS.filter((x) => x.whoToCall)) {
      expect(lines(f), f.id).not.toContain(NO_OFFICE);
      expect(lines(f), f.id).not.toContain(NO_OFFICE_WIDE);
    }
  });

  it('"Source & date checked ↓" scrolls in place — the hash never changes — and the rule gets one way back', () => {
    const target = factCardOf(buildDeps())(FACTS.find((f) => f.id === 'va-dominion-10ft')!, false);
    const win = { scrollTo: [] as unknown[] };
    const deps = buildDeps({ 'fact-va-dominion-10ft': target }, win);
    const checkCard = pageFn<(it: unknown) => FakeNode>(html, 'checkCard', deps);
    const item = jobChecklist({ city: 'Virginia Beach', inRpa: false, nearPowerLines: true, inRightOfWay: false, stumpGrinding: false, historicDistrict: false, haulingDebris: false, burning: false })[0]!;
    const c = checkCard(item);
    const a = c.querySelector('.srcs')!.kids[0]!;
    expect(a.href).toBe('#fact-va-dominion-10ft');
    let prevented = 0;
    const ev = { preventDefault: () => { prevented++; } };
    a.listeners.click!(ev);
    a.listeners.click!(ev); // a second jump replaces the back link, never stacks a second one
    expect(prevented).toBe(2);
    expect(target.scrolled).toHaveLength(2);
    const backs = target.querySelector('.factmeta')!.kids.filter((k) => k.cls.includes('back-to-check'));
    expect(backs).toHaveLength(1);
    const up = backs[0]!.kids[0]!;
    expect(up.text).toBe('↑ Back to the job check');
    up.listeners.click!(ev);
    expect(c.scrolled).toEqual([{ behavior: 'smooth', block: 'center' }]);
    c.isConnected = false; // a newer check replaced that card: back to the top instead
    up.listeners.click!(ev);
    expect(win.scrollTo).toEqual([{ top: 0, behavior: 'smooth' }]);
    expect(region(html, 'function checkCard(', 'function whoLine(')).not.toMatch(/location\.hash\s*=/);
  });
});

describe('Measure — status is a fact, the up axis is plain words, an unconfirmed axis is a warning', () => {
  const measure = region(html, 'function renderMeasure()', 'function measureResult(');
  const result = region(html, 'function measureResult(', '// ---------- Learn desk');

  it('upWords names the axis and why, without engine language', () => {
    const upWords = pageFn<(ua: unknown) => string>(html, 'upWords');
    expect(upWords(null)).toBe('');
    expect(upWords({ axis: 'z', source: 'override', reason: 'set by the person measuring' })).toBe(' Read Z as up — you chose this.');
    expect(upWords({ axis: 'z', source: 'data', reason: 'the lowest points form a flat ground layer along Z…' })).toBe(' Read Z as up — the ground in the scan lies flat that way.');
    expect(upWords({ axis: 'y', source: 'format', reason: 'x' })).toBe(' Read Y as up — the usual way for this file type.');
  });

  it('the status line is a fact line (not the tip style) and keeps the engine reason on hover', () => {
    expect(measure).toContain("const status = el('div', 'factmeta', LIDAR_LAST");
    expect(measure).toContain("status.className = 'factmeta';");
    expect(measure).not.toContain("status.className = 'storm-muted'");
    expect(measure).toContain("if (LIDAR_LAST && LIDAR_LAST.file.upAxis) status.title = LIDAR_LAST.file.upAxis.reason || '';");
    expect(measure).toContain("status.title = (body.file.upAxis && body.file.upAxis.reason) || '';");
    expect(measure).toContain('Leave on Auto unless height reads far too small or the trunk width looks wrong — iPhone apps usually export Y as up, LAS files Z.');
  });

  it('an axis the scan could not confirm is an amber warning after the units warning, above the tiles', () => {
    const warnAt = result.indexOf("for (const w of m.warnings) wrap.appendChild(el('div', 'late', w));");
    const axisAt = result.indexOf("if (ua && ua.source === 'format' && /no clear ground layer/.test(ua.reason || '')) wrap.appendChild(el('div', 'late', 'Which way is up was not confirmed by the scan (read ' + ua.axis.toUpperCase() + ' as up). Every number depends on it — if height reads far too small, switch Up and open the file again.'));");
    expect(warnAt).toBeGreaterThan(-1);
    expect(axisAt).toBeGreaterThan(warnAt);
    expect(result.indexOf('wrap.appendChild(hud);')).toBeGreaterThan(axisAt);
    expect(result).not.toContain("'storm-muted', 'Read with");
  });

  it('scatter reads inches first, centimetres in brackets', () => {
    expect(result).toContain("'; scatter ' + round(m.dbhFit.rmseCm / 2.54, 2) + ' in (' + round(m.dbhFit.rmseCm, 1) + ' cm)'");
  });
});

describe('Crew door — no flash of the full page on a keyless phone', () => {
  const boot = crew.slice(crew.indexOf('if (renderWhoAmI()) {'));

  it('a phone with no key hides the panels until the briefing answers; any answer shows them again', () => {
    expect(boot).toMatch(/^if \(renderWhoAmI\(\)\) \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(!KEY\) document\.querySelector\('main'\)\.classList\.add\('door-locked'\);\n\s*renderWork\(\);/);
    // Audit 2026-10-20 (M2): the gate's 429 reaches the door card too, with the server's reason.
    expect(boot).toMatch(/if \(e\.code === 401 \|\| e\.code === 429\) return renderDoorKey\(e\.message === 'crew_key_not_set', e\.message\);\n\s*document\.querySelector\('main'\)\.classList\.remove\('door-locked'\);/);
    const gate = /^function renderGate\(brief\) \{\n([^\n]*)\n/m.exec(crew)?.[1];
    expect(gate).toBe("  document.querySelector('main').classList.remove('door-locked'); // the door answered: show the panels");
    // The key card itself is unchanged: it still locks the door.
    expect(region(crew, 'function renderDoorKey(', "box.appendChild(el('h2', '', 'Crew door key'));")).toContain("document.querySelector('main').classList.add('door-locked');");
  });
});

describe('Crew door — a mistyped crew code is told as one (POST /api/crew/briefing/ack)', () => {
  const content = { id: '33333333-3333-3333-3333-333333333333', body: 'Watch the drop zone. Call every cut.', standardRefs: [] };
  const passing = { scrolledToBottom: true, checkboxTicked: true, secondsOnScreen: 20 };
  const times = { startedAtIso: '2026-10-18T10:00:00Z', completedAtIso: '2026-10-18T10:00:20Z' };
  const src = (record: DataSource['recordBriefingAck']): DataSource => ({
    ready: () => true, stopsBetween: async () => [], newLeads: async () => [], recordBriefingAck: record,
  });
  const neverCalled: DataSource['recordBriefingAck'] = async () => { throw new Error('must not be reached'); };

  it('a code that is not a crew code shape is a 400 bad_crew_id before anything is written', async () => {
    const res = await createApi(src(neverCalled)).ackBriefing({ crewMemberId: 'SIM-7', content, state: passing, ...times });
    expect(res).toEqual({ status: 400, body: { error: 'bad_crew_id' } });
  });

  it('a well-formed code that matches nobody (foreign key 23503) is a 400 unknown_crew, not a 500', async () => {
    const fk = async () => { throw Object.assign(new Error('fk'), { code: '23503' }); };
    const res = await createApi(src(fk)).ackBriefing({ crewMemberId: '55555555-5555-4555-8555-555555555555', content, state: passing, ...times });
    expect(res).toEqual({ status: 400, body: { error: 'unknown_crew' } });
  });

  it('any other write failure still throws (a 500 stays a 500)', async () => {
    const boom = async () => { throw Object.assign(new Error('db down'), { code: '08006' }); };
    await expect(createApi(src(boom)).ackBriefing({ crewMemberId: '55555555-5555-4555-8555-555555555555', content, state: passing, ...times })).rejects.toThrow('db down');
  });

  it('the practice data still answers 503 not_simulated first, whatever the code', async () => {
    const res = await createApi(createSimSource(), { dataLinksSim: true }).ackBriefing({ crewMemberId: 'SIM-7', content, state: passing, ...times });
    expect(res).toEqual({ status: 503, body: { error: 'not_simulated' } });
  });
});

describe('Crew door — the gate counts down the server’s number and styles a stop-work order as one', () => {
  it('GET /api/crew/briefing carries the read floor the gate will hold the crew to', async () => {
    const body = Array.from({ length: 60 }, (_, i) => 'word' + i).join(' ');
    const source: DataSource = {
      ready: () => true, stopsBetween: async () => [], newLeads: async () => [],
      todaysBriefing: async () => ({ id: 'b', body, standardRefs: [] }),
    };
    const res = await createApi(source).crewBriefing();
    expect(res.status).toBe(200);
    expect((res.body as { requiredSeconds: number }).requiredSeconds).toBe(requiredReadSeconds(body));
    expect(requiredReadSeconds(body)).toBe(15);
    expect(crew).toContain('GATE.requiredSeconds = brief.requiredSeconds || 10;');
  });

  // submitGate lifted with stand-ins: the server's answer decides what the gate line holds.
  const run = async (answer: () => Promise<unknown>, links: string | null = 'cut') => {
    const GATE: Record<string, unknown> = { content: {}, startedAt: '', scrolled: true, checked: true, openedMs: 0, unlocked: false, serverMsg: 'old', serverErr: true };
    const go = { disabled: false, textContent: '', className: '' };
    const crewWhy = pageFn<(e: unknown) => string>(crew, 'crewWhy', { LINKS: links });
    const submitGate = pageFn<() => Promise<void>>(crew, 'submitGate', {
      $: () => go, GATE, api: answer, CREW_ID: 'x', secondsOnScreen: () => 20,
      GATE_NEED: pageConst<Record<string, string>>(crew, 'GATE_NEED'), refreshGate: () => {}, renderQuiz: () => {}, renderWork: () => {},
      document: { querySelector: () => ({}) }, LINKS_READY: Promise.resolve(), crewWhy,
    });
    await submitGate();
    return GATE;
  };

  it('a read-time refusal leaves the line to the live countdown, on the server’s seconds', async () => {
    const g = await run(async () => ({ unlocked: false, missing: ['read_time'], requiredSeconds: 15 }));
    expect(g.serverMsg).toBe('');
    expect(g.serverErr).toBe(false);
    expect(g.requiredSeconds).toBe(15);
    const g2 = await run(async () => ({ unlocked: false, missing: ['checkbox', 'read_time'], requiredSeconds: 12 }));
    expect(g2.serverMsg).toBe('Still needed: tick the box');
  });

  it('a failed sign-off is an error line with the crew door’s reason and the stop-work order', async () => {
    const g = await run(async () => { throw Object.assign(new Error('db_not_configured'), { code: 503 }); }, 'cut');
    expect(g.serverErr).toBe(true);
    expect(g.serverMsg).toBe('Your sign-off could not be recorded (the office data link is cut on purpose). Your work orders stay locked — do not start work; call the office to log your briefing.');
    const s = await run(async () => { throw Object.assign(new Error('not_simulated'), { code: 503 }); });
    expect(s.serverMsg).toMatch(/^Your sign-off could not be recorded \(not part of the practice data\)\./);
    const bad = await run(async () => { throw Object.assign(new Error('bad_crew_id'), { code: 400 }); });
    expect(bad.serverMsg).toBe('That sign-off was rejected — check your crew code with the office.');
  });

  it('refreshGate wears the error style only while an error is on the line', () => {
    const toggles: Array<[string, boolean]> = [];
    const status = { textContent: '', classList: { toggle: (c: string, on: boolean) => { toggles.push([c, on]); } } };
    const els: Record<string, unknown> = { 'gate-status': status, gobtn: { disabled: false, className: '' } };
    const GATE: Record<string, unknown> = { unlocked: false, scrolled: true, checked: true, serverMsg: 'Your sign-off could not be recorded', serverErr: true, requiredSeconds: 10 };
    const refreshGate = pageFn<() => void>(crew, 'refreshGate', { GATE, $: (id: string) => els[id], secondsOnScreen: () => 99 });
    refreshGate();
    GATE.serverMsg = '';
    refreshGate();
    expect(toggles).toEqual([['err', true], ['err', false]]);
    expect(status.textContent).toBe('Ready — press GO.');
    expect(crew).toContain('.gate-status.err{color:#FFD9A0;font-size:14px;font-weight:700;line-height:1.4;border-left:3px solid var(--warning);padding-left:10px}');
  });

  it('every place that clears serverMsg clears serverErr too', () => {
    // QA round 3: the tick clears the GO hold too (test/qa3_crew-sim.test.ts).
    expect(crew).toContain("GATE.checked = cb.checked; GATE.serverMsg = ''; GATE.serverErr = false; GATE.serverHold = false; refreshGate();");
    expect(crew).toMatch(/go\.disabled = true;\s*GATE\.serverMsg = '';\s*GATE\.serverErr = false;/);
    expect(crew).toContain('serverErr: false,');
  });
});

describe('Crew door — one wording for a read that failed', () => {
  it('crewWhy: practice data, cut on purpose, not set up, no answer', () => {
    const why = (links: string | null) => pageFn<(e: unknown) => string>(crew, 'crewWhy', { LINKS: links });
    const e503 = (m: string) => ({ code: 503, message: m });
    expect(why('simulation')(e503('not_simulated'))).toBe('not part of the practice data');
    expect(why('cut')(e503('db_not_configured'))).toBe('the office data link is cut on purpose');
    expect(why(null)(e503('db_not_configured'))).toBe('the office data link is cut on purpose');
    expect(why('live')(e503('db_not_configured'))).toBe('not set up on the server yet');
    // As index.html feedKind: a named link held cut is on purpose; an unbuilt route is not set up.
    expect(why('live')(e503('link_cut'))).toBe('the office data link is cut on purpose');
    expect(why('live')(e503('not_built'))).toBe('not set up on the server yet');
    expect(why('live')({ code: 500, message: 'not_simulated' })).toBe('the office didn’t answer');
    expect(why('live')({ code: 500, message: 'error' })).toBe('the office didn’t answer');
    expect(why('live')(new Error('Failed to fetch'))).toBe('the office didn’t answer');
    expect(crew).toContain("const LINKS_READY = api('/health').then((h) => { LINKS = h.dataLinks || 'unknown'; }).catch(() => null);");
  });

  it('the briefing card: the reason, then the order as its own line — never "Do / not start work"', () => {
    const boot = crew.slice(crew.indexOf("api('/api/crew/briefing').then(renderGate)"));
    expect(boot).toContain('await LINKS_READY;');
    expect(boot).toContain("s.appendChild(document.createTextNode(why.charAt(0).toUpperCase() + why.slice(1) + '.'));");
    expect(boot).toContain("s.appendChild(el('b', 'order', 'Do not start work \\u2014 call the office.'));");
    expect(boot).not.toContain("+ ' Do not start work");
    expect(crew).not.toContain('The office system isn');
    expect(crew).not.toContain('the office system is not connected');
    expect(crew).not.toContain('Library unavailable');
  });

  it('near miss, sign-off and library say the same reason', () => {
    expect(crew).toContain("'Did not save — ' + crewWhy(e) + '.'");
    expect(crew).toContain("'Your sign-off could not be recorded (' + crewWhy(e) + ').'");
    expect(crew).toContain("'Library: ' + crewWhy(e) + '. That is NOT \"nothing on file\" — ask the office.'");
  });
});

describe('Crew door — polish', () => {
  it('"Show key" sits on the card edge and keeps its 44px target', () => {
    expect(crew).toContain('#whoami button.keyshow{width:auto;min-height:44px;background:none;color:var(--canopy);font-weight:700;padding:0;margin:-4px 0 6px 0}');
  });

  it('the near-miss intro is short, says "the office" once, and wraps evenly', () => {
    const nm = region(crew, 'function renderNearMiss()', "const ta = el('textarea');");
    expect(nm).toContain("'Something almost went wrong? Say it here — nobody gets blamed or written up. '");
    expect(nm).toContain("+ 'It’s filed under your crew code, and the office turns it into a lesson for the next crew. '");
    expect(nm).toContain("+ 'Leave other people’s names out.'");
    expect(crew).toMatch(/#nm-card \.why\{[^}]*text-wrap:pretty\}/);
    expect(crew).toMatch(/#lib-card \.why\{[^}]*text-wrap:pretty\}/);
  });
});
