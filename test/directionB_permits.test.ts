// Direction B, P9 (docs/DIRECTION_B_PLAN.md; spec quick fix "Permits folds down
// from ~22 screens to ~3, with the result pinned"). The job check stays on top.
// Its result is pinned: a sticky one-line verdict above the questions — the
// strongest chip (alarm > stop > watch > info) in the permit words only, CALL
// FIRST and TICKET REQUIRED kept on it, then "N steps · city"; a tap scrolls to
// the results. Each rule topic folds into a closed <details class="topic">
// whose summary names it, counts its rules and keeps UNCONFIRMED and RE-CHECK
// DUE visible while folded. "Source & date checked ↓" opens the topic before it
// scrolls. Permits stays out of TIMED (a <details> there would freeze nothing).
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';
import { FACTS } from '../src/permitting/publicWorks/facts.js';
import { jobChecklist, type JobInput } from '../src/permitting/publicWorks/query.js';
import { FORBIDDEN_CLEAR } from '../src/permitting/screening.js';

const html = loadAppHtml();
function fnSrc(name: string): string {
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
const PERMIT_STATE = new Function(`${constSrc('PERMIT_STATE')}\nreturn PERMIT_STATE;`)() as Record<string, [string, string]>;
const PERMIT_STATUS = new Function('PERMIT_STATE', `${constSrc('PERMIT_STATUS')}\nreturn PERMIT_STATUS;`)(PERMIT_STATE) as Record<string, [string, string]>;
// R27 Phase A (owner app b): the page's permitLabel says a permit or call-ahead label through the safety pair (in English, as written).
const permitLabel = new Function(`${fnSrc('permitLabel')}\nreturn permitLabel;`)() as (n: unknown) => unknown;
const plural = (n: number, one: string, many?: string) => n + ' ' + (n === 1 ? one : (many || one + 's'));
const NONE: Omit<JobInput, 'city'> = { inRpa: false, nearPowerLines: false, inRightOfWay: false, stumpGrinding: false, historicDistrict: false, haulingDebris: false, burning: false };

describe('permitVerdict: the pinned one-line result', () => {
  type V = { chips: Array<[string, string]>; line: string };
  const permitVerdict = new Function('PERMIT_STATUS', 'plural', `${fnSrc('permitVerdict')}\nreturn permitVerdict;`)(PERMIT_STATUS, plural) as (items: unknown[], city: string) => V;
  const LABELS = Object.values(PERMIT_STATUS).map(([l]) => l);

  it('the strongest chip leads: the power-line CALL FIRST (alarm), and TICKET REQUIRED stays on it', () => {
    const items = jobChecklist({ city: 'Virginia Beach', ...NONE, nearPowerLines: true, stumpGrinding: true, inRpa: 'unknown' });
    const v = permitVerdict(items, 'Virginia Beach');
    expect(v.chips[0]).toEqual(['CALL FIRST', 'alarm']);
    expect(v.chips).toContainEqual(['TICKET REQUIRED', 'stop']);
    expect(v.line).toBe(plural(items.length, 'step') + ' · Virginia Beach');
  });

  it('hauling\'s call-ahead keeps the words, not the alarm colour — and still stays on the verdict', () => {
    const items = jobChecklist({ city: 'Norfolk', ...NONE, haulingDebris: true, inRpa: 'unknown' });
    const call = items.filter((i) => i.status === 'CALL FIRST');
    expect(call.length).toBeGreaterThan(0);
    expect(call.every((i) => !i.safety)).toBe(true);
    const v = permitVerdict(items, 'Norfolk');
    expect(v.chips).toContainEqual(['CALL FIRST', 'watch']);
    expect(v.chips.some(([, t]) => t === 'alarm')).toBe(false);
  });

  it('with nothing stronger than info, the info chip is the verdict', () => {
    const items = jobChecklist({ city: 'Chesapeake', ...NONE });
    const v = permitVerdict(items, 'Chesapeake');
    const ranks = ['alarm', 'stop', 'watch', 'good', 'info'];
    const best = Math.min(...items.map((i) => ranks.indexOf((PERMIT_STATUS[i.status] ?? ['', 'watch'])[1]!)));
    expect(ranks.indexOf(v.chips[0]![1])).toBe(best);
  });

  it('every chip is a permit word, never a calm line, in every city and every answer', () => {
    const tri = [true, false, 'unknown'] as const;
    for (const city of ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Portsmouth'] as const) {
      for (const rpa of tri) for (const pl of tri) for (const row of tri) {
        const items = jobChecklist({ city, ...NONE, inRpa: rpa, nearPowerLines: pl, inRightOfWay: row, historicDistrict: 'unknown', haulingDebris: pl === true, stumpGrinding: row === true });
        const v = permitVerdict(items, city);
        expect(v.chips.length).toBeGreaterThan(0);
        for (const [l] of v.chips) expect(LABELS, l).toContain(l);
        expect(new Set(v.chips.map(([l]) => l)).size, 'no chip twice').toBe(v.chips.length);
        expect(v.chips.map(([l]) => l).join(' ') + ' ' + v.line).not.toMatch(FORBIDDEN_CLEAR);
      }
    }
  });

  // Review (b-wave-1b, correctness 1 / UI 5): the pin picked one chip by colour, so
  // PERMIT LIKELY lost a tie to REVIEW NEEDED (both amber) and lost outright to any
  // CALL FIRST or TICKET REQUIRED — the permit word itself was dropped. The
  // strongest permit word is always on the pin; the call-aheads sit beside it.
  it('the strongest permit word is always pinned, beside any CALL FIRST or TICKET REQUIRED (every answer, every city)', () => {
    const ORDER = ['PERMIT LIKELY', 'REVIEW NEEDED', 'NO OVERLAY–VERIFY'];
    const tri = [true, false, 'unknown'] as const;
    const bool = [true, false];
    let likely = 0;
    for (const city of ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Portsmouth'] as const) {
      for (const rpa of tri) for (const pl of tri) for (const row of tri) for (const hist of tri)
        for (const stump of bool) for (const haul of bool) for (const burn of bool) {
          const items = jobChecklist({ city, inRpa: rpa, nearPowerLines: pl, inRightOfWay: row, historicDistrict: hist, stumpGrinding: stump, haulingDebris: haul, burning: burn });
          const labels = permitVerdict(items, city).chips.map(([l]) => l);
          const word = ORDER.find((w) => items.some((i) => i.status === w));
          if (word) expect(labels, `${city} ${JSON.stringify({ rpa, pl, row, hist, stump, haul, burn })}`).toContain(PERMIT_STATUS[word]![0]);
          if (word === 'PERMIT LIKELY') { likely++; expect(labels).not.toContain(PERMIT_STATUS['REVIEW NEEDED']![0]); }
          for (const s of ['CALL FIRST', 'TICKET REQUIRED']) if (items.some((i) => i.status === s)) expect(labels).toContain(s);
        }
    }
    expect(likely, 'the sweep reaches PERMIT LIKELY answers').toBeGreaterThan(0);
  });

  it('the review\'s three Virginia Beach cases pin PERMIT LIKELY (the page\'s own starting answers, then one changed)', () => {
    const START: Omit<JobInput, 'city'> = { inRpa: 'unknown', nearPowerLines: 'unknown', inRightOfWay: 'unknown', historicDistrict: 'unknown', stumpGrinding: false, haulingDebris: false, burning: false };
    const vb = (o: Partial<JobInput>) => { const items = jobChecklist({ city: 'Virginia Beach', ...START, ...o }); return permitVerdict(items, 'Virginia Beach').chips; };
    expect(vb({ inRpa: true })[0]).toEqual(['PERMIT LIKELY', 'watch']);
    expect(vb({ inRpa: true }).map(([l]) => l)).not.toContain('PERMIT: REVIEW NEEDED');
    const stump = vb({ inRpa: true, stumpGrinding: true });
    expect(stump).toContainEqual(['TICKET REQUIRED', 'stop']);
    expect(stump).toContainEqual(['PERMIT LIKELY', 'watch']);
    const power = vb({ inRpa: true, nearPowerLines: true });
    expect(power[0]).toEqual(['CALL FIRST', 'alarm']);
    expect(power).toContainEqual(['PERMIT LIKELY', 'watch']);
  });

  it('no steps back is never a calm verdict: it says the check gave no answer', () => {
    const v = permitVerdict([], 'Portsmouth');
    expect(v.chips).toEqual([]);
    expect(v.line).toMatch(/not an answer/);
    expect(v.line).not.toMatch(FORBIDDEN_CLEAR);
  });
});

// ---------- the desk, drawn on a stand-in DOM ----------
class N {
  className = ''; type = ''; id = ''; href = ''; checked = false; open = false; offsetHeight = 0;
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: N[] = [];
  parent: N | null = null;
  scrolled: unknown[] = [];
  on: Record<string, Array<(e?: unknown) => void>> = {};
  private own = '';
  constructor(readonly tag: string) {}
  get textContent(): string { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(t: string) { this.children = []; this.own = t; }
  has(c: string) { return this.className.split(/\s+/).includes(c); }
  get classList() { return { toggle: (c: string, f?: boolean) => { const on = f ?? !this.has(c); this.className = on ? (this.has(c) ? this.className : (this.className + ' ' + c).trim()) : this.className.split(/\s+/).filter((x) => x !== c).join(' '); }, add: (c: string) => this.classList.toggle(c, true), remove: (c: string) => this.classList.toggle(c, false), contains: (c: string) => this.has(c) }; }
  appendChild(c: N): N { c.parent = this; this.children.push(c); return c; }
  replaceChildren(...ns: N[]): void { this.children = []; this.own = ''; for (const n of ns) this.appendChild(n); }
  hasChildNodes(): boolean { return this.children.length > 0; }
  get firstChild(): N | null { return this.children[0] ?? null; }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  removeAttribute(k: string): void { delete this.attrs[k]; }
  addEventListener(t: string, f: (e?: unknown) => void): void { (this.on[t] ??= []).push(f); }
  click(): void { for (const f of this.on.click ?? []) f({ preventDefault() {} }); }
  scrollIntoView(o: unknown): void { this.scrolled.push(o); }
  all(): N[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}
const el = (tag: string, cls?: string, text?: string) => { const n = new N(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

function desk(opts: { checklistFails?: boolean } = {}) {
  const v = el('div');
  const city = 'Virginia Beach';
  const facts = FACTS.filter((f) => f.city === city || f.city === 'Virginia' || f.city === 'Regional');
  const stale = facts.filter((f) => f.confidence === 'SOURCED').slice(0, 2).map((f) => f.id);
  const api = async (path: string, o?: { body: Omit<JobInput, 'city'> & { city: typeof city } }) => {
    if (path === '/api/permits/checklist') {
      if (opts.checklistFails) throw Object.assign(new Error('x'), { code: 500 });
      return { items: jobChecklist(o!.body) };
    }
    return { facts, stale };
  };
  const document = { createElement: (t: string) => el(t), createTextNode: (t: string) => el('#text', '', t) };
  const factCard = (f: { id: string }) => { const c = el('div', 'card fact'); c.id = 'fact-' + f.id; return c; };
  const chip = (t: string, tone: string) => el('span', 'badge ' + tone, t);
  const render = new Function('$', 'el', 'api', 'document', 'factCard', 'checkCard', 'chip', 'plural', 'readingLine', 'state', 'feedKind', 'FEED_WORD', 'showKeywall', 'PERMIT_STATUS', 'permitLabel', `
    let PERMIT_CITY = 'Virginia Beach';
    let PERMIT_GEN = 0;
    ${constSrc('TOPIC_NAMES')}
    ${constSrc('PERMIT_ANS')}
    ${fnSrc('permitVerdict')}
    ${fnSrc('topicFold')}
    ${fnSrc('renderPermits')}
    return renderPermits;`)(() => v, el, api, document, factCard, (it: { status: string }) => el('div', 'card check-item', it.status), chip, plural,
    () => el('div', 'reading', 'Reading…'), (t: string, m: string) => el('div', 'state', t + ' ' + m), () => 'unread', { unread: 'couldn’t read it' }, () => {}, PERMIT_STATUS, permitLabel) as () => Promise<void>;
  return { v, render, facts, stale };
}

describe('renderPermits: folded topics, pinned result', () => {
  it('the verdict sits under the job check title and above the first question, and a tap scrolls to the results', async () => {
    const d = desk();
    await d.render();
    await flush();
    const job = d.v.children.find((c) => c.has('slot'))!;
    const kids = job.children;
    const verdict = kids.find((c) => c.has('permit-verdict'))!;
    expect(verdict, 'a verdict').toBeTruthy();
    expect(verdict.tag).toBe('button');
    expect(kids.indexOf(verdict)).toBe(1); // right under "Job check — city"
    expect(kids.findIndex((c) => c.has('qrow'))).toBeGreaterThan(kids.indexOf(verdict));
    expect(verdict.textContent).toMatch(/\d+ steps? · Virginia Beach$/);
    expect(verdict.children.filter((c) => c.has('badge')).length).toBeGreaterThan(0);
    verdict.click();
    const results = kids[kids.length - 1]!;
    expect(results.children.every((c) => c.has('check-item'))).toBe(true);
    expect(results.scrolled).toHaveLength(1);
  });

  it('a check that failed: the verdict says so — no permit word, no calm line (§1B)', async () => {
    const d = desk({ checklistFails: true });
    await d.render();
    await flush();
    const verdict = d.v.all().find((c) => c.has('permit-verdict'))!;
    expect(verdict.children.some((c) => c.has('badge'))).toBe(false);
    expect(verdict.textContent).toMatch(/not an answer|could not/i);
    expect(verdict.textContent).not.toMatch(FORBIDDEN_CLEAR);
  });

  it('every topic is folded: a closed <details class="topic">, its name, its rule count and its UNCONFIRMED / RE-CHECK DUE counts', async () => {
    const d = desk();
    await d.render();
    await flush();
    const topics = d.v.children.filter((c) => c.tag === 'details');
    expect(topics.length).toBeGreaterThan(5);
    for (const t of topics) {
      expect(t.has('topic')).toBe(true);
      expect(t.open).toBe(false);
      expect(t.children[0]!.tag).toBe('summary');
    }
    // Every fact is inside a topic — none left loose on the page.
    const inTopics = topics.flatMap((t) => t.children.filter((c) => c.has('fact')));
    expect(inTopics.length).toBe(d.facts.filter((f) => f.topic in new Function(`${constSrc('TOPIC_NAMES')}\nreturn TOPIC_NAMES;`)()).length);
    expect(d.v.children.filter((c) => c.has('fact'))).toEqual([]);
    // The summary counts are the facts' own.
    const names = new Function(`${constSrc('TOPIC_NAMES')}\nreturn TOPIC_NAMES;`)() as Record<string, string>;
    for (const t of topics) {
      const s = t.children[0]!;
      const name = s.children[0]!.textContent;
      const key = Object.keys(names).find((k) => names[k] === name)!;
      const list = d.facts.filter((f) => f.topic === key);
      expect(s.textContent).toContain(plural(list.length, 'rule'));
      const unconf = list.filter((f) => f.confidence !== 'SOURCED').length;
      const due = list.filter((f) => d.stale.includes(f.id)).length;
      const chips = s.all().filter((c) => c.has('badge')).map((c) => c.textContent);
      expect(chips).toEqual([...(unconf ? [unconf + ' UNCONFIRMED'] : []), ...(due ? [due + ' RE-CHECK DUE'] : [])]);
    }
  });

  it('Permits stays out of TIMED: its folds never hold a minute redraw', () => {
    const timed = /^const TIMED = \{(.*)\};$/m.exec(html)![1]!;
    expect(timed).not.toMatch(/\bpermits\b/);
  });
});

describe('"Source & date checked ↓" opens the topic before it scrolls', () => {
  it('the closed topic around the rule is opened, then the rule is scrolled to', () => {
    const topic = el('details', 'topic');
    const target = el('div', 'card fact');
    target.id = 'fact-x';
    target.appendChild(el('div', 'factmeta'));
    topic.appendChild(target);
    const order: string[] = [];
    Object.defineProperty(topic, 'open', { get: () => order.includes('open'), set: (v: boolean) => { if (v) order.push('open'); } });
    (target as unknown as { closest: (s: string) => N | null }).closest = (s: string) => (s === 'details.topic' ? topic : null);
    target.scrollIntoView = (o: unknown) => { order.push('scroll'); target.scrolled.push(o); };
    (target as unknown as { querySelector: (s: string) => N | null }).querySelector = (s: string) => (s === '.factmeta' ? target.children[0]! : null);
    const document = { getElementById: (id: string) => (id === 'fact-x' ? target : null), createTextNode: (t: string) => el('#text', '', t) };
    const checkCard = new Function('el', 'chip', 'nb', 'whoLine', 'PERMIT_STATUS', 'document', 'window', 'permitLabel', `${fnSrc('checkCard')}\nreturn checkCard;`)(
      el, (t: string, tone: string) => el('span', 'badge ' + tone, t), (s: string) => s, () => el('div'), PERMIT_STATUS, document, {}, permitLabel) as (it: unknown) => N;
    const c = checkCard({ status: 'REVIEW NEEDED', step: 's', why: 'w', factIds: ['x'] });
    const a = c.all().find((n) => n.tag === 'a')!;
    a.click();
    expect(order).toEqual(['open', 'scroll']);
  });
});

describe('CSS: the verdict sticks under the app bar; the summary is a full tap target', () => {
  it('pinned, with its own background, and a summary at least 48 px tall', () => {
    expect(html).toMatch(/\.permit-verdict\{[^}]*position:sticky;[^}]*background:/);
    expect(html).toMatch(/\.topic > summary\{[^}]*min-height:(4[89]|5\d)px/);
  });
});
