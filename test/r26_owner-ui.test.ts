// R26 — the owner-ui package (Mike's pre-deploy review answers, 2026-10-20):
// one label per permit state (qa-x6), page headings and desk names (qa-x7,
// qa-x13), an emergency lead on Today and a badge on the Leads tab (qa-x10),
// the SPANISH SPEAKER chip, the owner-only storm price-law flag, and the
// Permit Desk's pests & quarantines topic. vitest has no DOM, so the pieces
// with logic are lifted out of the page and run against a small stand-in DOM;
// layout and copy are source pins.
import { describe, it, expect, vi } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';
import { SECTION_AGENTS } from '../src/agents/sections.js';
import { GOVERNOR_NOTE } from '../src/ops/stormLaw.js';

const html = loadAppHtml();
const css = html.slice(0, html.indexOf('</style>'));

/** One top-level function's source: from its declaration to the "}" alone on a line. */
function fnSrc(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
/** The same function, built with stand-ins for every outside name it reaches for. */
function pageFn<T>(name: string, deps: Record<string, unknown>, src = fnSrc(name)): T {
  return new Function(...Object.keys(deps), `${src}\nreturn ${name};`)(...Object.values(deps)) as T;
}
/** The page line that starts with `start` (a one-line const or function). */
function oneLine(start: string): string {
  const at = html.indexOf('\n' + start);
  expect(at, start).toBeGreaterThan(-1);
  return html.slice(at + 1, html.indexOf('\n', at + 1));
}
/** A top-level `const NAME = …;` (it may span lines), evaluated with any page names it reads. */
function pageConst<T>(name: string, deps: Record<string, unknown> = {}): T {
  const m = new RegExp(`^const ${name} = ([\\s\\S]*?);$`, 'm').exec(html);
  if (!m) throw new Error(`no const ${name} in the page`);
  return new Function(...Object.keys(deps), `return ${m[1]}`)(...Object.values(deps)) as T;
}
const between = (from: string, to: string) => {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a + from.length);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(a);
  return html.slice(a, b);
};
/** The single-quoted string literals in a piece of page code, comments left out. */
const literals = (code: string): string[] => code.split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .map((l) => l.replace(/\s\/\/ .*$/, ''))
  .join('\n')
  .match(/'(?:[^'\\\n]|\\.)*'/g) ?? [];

// ---------- a stand-in DOM: just what these pieces touch ----------
class N {
  className = '';
  textContent = '';
  id = '';
  href = '';
  title = '';
  disabled = false;
  children: N[] = [];
  parent: N | null = null;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  handlers: Array<() => unknown> = [];
  scrolled: unknown[] = [];
  constructor(readonly tag: string) {}
  has(c: string): boolean { return this.className.split(' ').includes(c); }
  appendChild(n: N): N { n.parent?.drop(n); n.parent = this; this.children.push(n); return n; }
  prepend(n: N): void { n.parent?.drop(n); n.parent = this; this.children.unshift(n); }
  drop(n: N): void { this.children = this.children.filter((c) => c !== n); }
  remove(): void { this.parent?.drop(this); this.parent = null; }
  replaceChildren(...ns: N[]): void { this.children = []; for (const n of ns) this.appendChild(n); }
  hasChildNodes(): boolean { return this.children.length > 0 || this.textContent !== ''; } // Direction B P3: a first draw says "Reading…"
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  removeAttribute(k: string): void { delete this.attrs[k]; if (k === 'title') this.title = ''; }
  addEventListener(_t: string, f: () => unknown): void { this.handlers.push(f); }
  async click(): Promise<void> { for (const h of this.handlers) await h(); }
  scrollIntoView(o: unknown): void { this.scrolled.push(o); }
  get classList() { return { add: (c: string) => { if (!this.has(c)) this.className = (this.className + ' ' + c).trim(); }, contains: (c: string) => this.has(c) }; }
  all(): N[] { return [this, ...this.children.flatMap((c) => c.all())]; }
  querySelectorAll(sel: string): N[] {
    const match = sel.startsWith('.') ? (n: N) => n.has(sel.slice(1)) : (n: N) => n.tag === sel;
    return this.all().slice(1).filter(match);
  }
  querySelector(sel: string): N | null { return this.querySelectorAll(sel)[0] ?? null; }
  text(): string { return [this.textContent, ...this.children.map((c) => c.text())].filter(Boolean).join(' '); }
}
const el = (tag: string, cls?: string, text?: string): N => {
  const n = new N(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const chip = (text: string, tone: string): N => { const n = el('span', 'badge', text); n.dataset.tone = String(tone); return n; };
const chipsIn = (n: N) => n.all().filter((x) => x.has('badge')).map((x) => x.textContent + '=' + x.dataset.tone);
const document = { createTextNode: (t: string) => el('#text', '', t) };
const fail = (code: number | undefined, message = 'error') => Object.assign(new Error(message), { code });

// The page's own shared words, so the lines asserted are the lines Mike reads.
const FEED_WORD = pageConst<Record<string, string>>('FEED_WORD');
const FEED_TAG = pageConst<Record<string, string>>('FEED_TAG');
const RETRY = pageConst<string>('RETRY');
const PERMIT_STATE = pageConst<Record<string, [string, string]>>('PERMIT_STATE');
const plural = pageFn<(n: number, one: string, many?: string) => string>('plural', {});
const feedKindWith = (LINKS: string) => pageFn<(e: unknown) => string>('feedKind', { LINKS });
const feedKind = feedKindWith('cut');
const feedLine = pageFn<(e: unknown, what: string, tail?: string) => N>('feedLine', { el, feedKind, FEED_WORD, RETRY }, oneLine('function feedLine('));
const permitChip = pageFn<(s: string) => N>('permitChip', { chip, PERMIT_STATE });
// The page's own hold: a spam Undo filed under 2 minutes ago keeps Leads from being redrawn.
const holdsTyping = pageFn<(v: N) => boolean>('holdsTyping', {});
/** A stand-in Leads view, with a spam filing `filedAgo` ms ago (null: none). */
function leadsView(filedAgo: number | null): N {
  const view = el('div');
  if (filedAgo !== null) { const f = el('div', 'lead-filed'); f.dataset.at = String(Date.now() - filedAgo); view.appendChild(f); }
  return view;
}

// ---------- qa-x6: one label per permit state ----------
describe('R26 qa-x6 — one label per permit state, the badge wording everywhere', () => {
  it('PERMIT_STATE is the one map: the Leads badge words, with their tones', () => {
    expect(PERMIT_STATE).toEqual({
      PERMIT_LIKELY: ['PERMIT LIKELY', 'watch'],
      REVIEW_NEEDED: ['PERMIT: REVIEW NEEDED', 'watch'],
      NO_OVERLAY_VERIFY: ['NO OVERLAY — VERIFY W/ CITY', 'info'],
      SCREEN_PENDING: ['PERMIT SCREEN PENDING', 'watch'],
    });
    // Each label is written once in the page script — every surface reads it from the map.
    // Pin moved (R27 Phase A, owner app b), meaning kept: permitLabel says a drawn label again through the safety pair — it
    // matches the label the map drew (a case) and draws that same English (the dictionary key), so it is no second spelling;
    // outside it, each label is still written once, and its cases are exactly the map's labels.
    const sayer = fnSrc('permitLabel');
    for (const label of ['PERMIT: REVIEW NEEDED', 'NO OVERLAY — VERIFY W/ CITY', 'PERMIT SCREEN PENDING']) {
      expect(html.replace(sayer, '').split("'" + label + "'").length - 1, label).toBe(1);
      expect(sayer, label).toContain(`case '${label}': return esSay(n, '${label}');`);
    }
    expect(sayer).toContain("case 'PERMIT LIKELY': return esSay(n, 'PERMIT LIKELY');");
    expect(html.split("['PERMIT LIKELY', ").length - 1).toBe(1);
    // The pinned words are still on the page (appUi).
    expect(html).toContain('VERIFY W/ CITY');
    expect(html).toContain('PERMIT SCREEN PENDING');
  });

  it('permitChip wears the map; a status it does not know keeps the old "verify with the city" reading', () => {
    const t = (s: string) => { const n = permitChip(s); return n.textContent + '=' + n.dataset.tone; };
    expect(t('PERMIT_LIKELY')).toBe('PERMIT LIKELY=watch');
    expect(t('REVIEW_NEEDED')).toBe('PERMIT: REVIEW NEEDED=watch');
    expect(t('NO_OVERLAY_VERIFY')).toBe('NO OVERLAY — VERIFY W/ CITY=info');
    expect(t('SCREEN_PENDING')).toBe('PERMIT SCREEN PENDING=watch');
    expect(t('SOMETHING_NEW')).toBe('NO OVERLAY — VERIFY W/ CITY=info');
    const permitBadge = pageFn<(l: unknown) => N | null>('permitBadge', { permitChip });
    expect(permitBadge({ permit: { screenStatus: 'REVIEW_NEEDED' } })!.textContent).toBe('PERMIT: REVIEW NEEDED');
    expect(permitBadge({ permit: null, screenPending: true })!.textContent).toBe('PERMIT SCREEN PENDING');
    expect(permitBadge({ permit: null, screenPending: false })).toBeNull();
  });

  it('the property sheet (twin) uses the same chip — no second spelling of a permit state', () => {
    const twin = between('async function openTwin(', "$('twin-close')");
    expect(twin).toContain('b.appendChild(permitLabel(permitChip(pr.screen_status)));'); // pin moved (R27): the same chip, said through the safety pair
    for (const old of ["chip('PERMIT LIKELY'", "chip('REVIEW NEEDED'", "chip('NO OVERLAY"]) expect(twin).not.toContain(old);
  });

  it("Book's prep sheet heads with the same label; a screen that never ran is PERMIT SCREEN PENDING, as on Leads", () => {
    const prep = fnSrc('estimatePrepPanel');
    // Pin moved (R27 Phase A, owner app b), meaning kept: the head is the same label, said through the safety pair (permitLabel).
    const m = /const ps = (PERMIT_STATE\[[^\n]+\]);\n\s*sheet\.appendChild\(permitLabel\(el\('div', 'vhead', ([^\n]+)\)\)\);/.exec(prep);
    expect(m).not.toBeNull();
    const head = new Function('s', 'PERMIT_STATE', `const ps = ${m![1]}; return ${m![2]};`) as (s: unknown, p: unknown) => string;
    const h = (permit: unknown) => head({ permit }, PERMIT_STATE);
    expect(h({ ran: true, status: 'PERMIT_LIKELY' })).toBe('PERMIT LIKELY');
    expect(h({ ran: true, status: 'REVIEW_NEEDED' })).toBe('PERMIT: REVIEW NEEDED');
    expect(h({ ran: true, status: 'NO_OVERLAY_VERIFY' })).toBe('NO OVERLAY — VERIFY W/ CITY');
    expect(h({ ran: false, reason: 'GIS provider not configured' })).toBe('PERMIT SCREEN PENDING');
    expect(h({ ran: true, status: 'SOMETHING_NEW' })).toBe('SOMETHING NEW');
    expect(html).not.toContain('SCREEN NOT RUN');
  });

  it("the Permit Desk's checklist words point at the same entries, so its REVIEW NEEDED reads as the badge does", () => {
    const PERMIT_STATUS = pageConst<Record<string, [string, string]>>('PERMIT_STATUS', { PERMIT_STATE });
    expect(PERMIT_STATUS['PERMIT LIKELY']).toBe(PERMIT_STATE.PERMIT_LIKELY);
    expect(PERMIT_STATUS['REVIEW NEEDED']).toBe(PERMIT_STATE.REVIEW_NEEDED);
    expect(PERMIT_STATUS['NO OVERLAY–VERIFY']).toBe(PERMIT_STATE.NO_OVERLAY_VERIFY);
    const nb = new Function(`return ${/const nb = (\(s\) => [^\n]+);/.exec(html)![1]}`)() as (s: string) => string;
    // R27 Phase A (owner app b): checkCard says its label through the page's permitLabel (in English, as written).
    const permitLabel = pageFn<(n: N) => N>('permitLabel', {});
    const checkCard = pageFn<(it: unknown) => N>('checkCard', { el, chip, nb, whoLine: () => el('div'), PERMIT_STATUS, document, window: {}, permitLabel });
    const card = checkCard({ status: 'REVIEW NEEDED', step: 'UNKNOWN: right-of-way', why: 'w', factIds: [] });
    expect(chipsIn(card)).toEqual(['PERMIT: REVIEW NEEDED=watch']);
  });
});

// ---------- qa-x7 / qa-x13: page headings and desk names ----------
describe('R26 qa-x7 / qa-x13 — Book, Queue, Numbers and Settings carry the desks’ heading, named by their desk', () => {
  const head = (v: N) => {
    const h = v.children[0]!;
    expect(h.has('viewhead')).toBe(true);
    return h.children.map((c) => c.tag + ':' + c.className + ':' + c.textContent);
  };

  // Direction B P15: the Book is "Properties on file" (Mike's rename) and its prep card moved to Estimate.
  it('Book (Properties on file) — eyebrow Arborist, drawn before the properties read (a dead feed keeps it)', async () => {
    const v = el('div');
    const book = pageFn<() => Promise<void>>('renderBook', {
      $: () => v, el, readingLine: () => el('div', 'reading', 'Reading…'), api: async () => { throw fail(503, 'link_cut'); },
      showKeywall: () => {}, LINKS_READY: Promise.resolve('cut'), feedState: (_e: unknown, w: string) => el('div', 'state', w),
      VIEW_TITLES: pageConst<Record<string, string>>('VIEW_TITLES'),
    });
    await book();
    expect(head(v)).toEqual(['div:eyebrow:Arborist', 'h1::Properties on file', 'p::Every property Arbo has on file. Tap one for its history, trees and permit screens.']);
    expect(v.children.map((c) => c.className)).toEqual(['viewhead', 'state']);
  });

  it('Numbers — eyebrow Analyst, above the read', async () => {
    const v = el('div');
    const perf = pageFn<() => Promise<void>>('renderPerformance', {
      $: () => v, el, readingLine: () => el('div', 'reading', 'Reading…'), api: async () => { throw fail(503, 'link_cut'); }, showKeywall: () => {}, LINKS_READY: Promise.resolve('cut'),
      state: (t: string) => el('div', 'state', t), FEED_WORD, feedKind, feedSays: () => '',
      DESK_LINE: pageConst<Record<string, string>>('DESK_LINE'), // Direction B P13: the desk names, one table
    });
    await perf();
    expect(head(v)[0]).toBe('div:eyebrow:Analyst');
    expect(head(v)[1]).toBe('h1::Which areas & campaigns pay');
    expect(v.children[1]!.textContent).toBe('Numbers — cut on purpose');
  });

  it('Follow-ups (the Queue, split by Direction B P13) — eyebrow Chief of Staff; the loops slot keeps its two wide-screen columns by id, not by "first child"', async () => {
    const v = el('div');
    const stub = () => {};
    const queue = pageFn<() => Promise<void>>('renderFollowUps', {
      FU_GEN: 0, $: () => v, el, readingLine: () => el('div', 'reading', 'Reading…'), api: async () => { throw fail(503, 'link_cut'); }, fmtTime: () => '', loopCard: () => el('div'),
      LINKS_READY: Promise.resolve('cut'), feedLine, showKeywall: stub,
      feedState: (_e: unknown, w: string) => el('div', 'state', w), state: () => el('div'), chip, FU_LABEL: {}, showSaveFail: stub, document,
      DESK_LINE: pageConst<Record<string, string>>('DESK_LINE'), VIEW_TITLES: pageConst<Record<string, string>>('VIEW_TITLES'),
    });
    await queue();
    expect(head(v)[0]).toBe('div:eyebrow:Chief of Staff');
    expect(head(v)[1]).toBe('h1::Follow-ups'); // P13: the desk's title (VIEW_TITLES), its desk name above it
    expect(v.children[1]!.id).toBe('queue-loops');
    expect(css).toContain('#queue-loops{grid-column:1 / -1;display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}');
    expect(css).toContain('#queue-loops .panel-title{grid-column:1 / -1}');
    expect(css).not.toContain('#view-followups > div:first-child');
  });

  it('Settings — eyebrow Settings, drawn even when the switches cannot load', async () => {
    const v = el('div');
    const build = pageFn<(v: N, gen: number) => Promise<void>>('buildSettings', {
      settingsGen: 1, el, api: async () => { throw fail(500); }, state: (t: string) => el('div', 'state', t),
      FEED_WORD, feedKind, showKeywall: () => {}, themePref: () => 'auto', setTheme: () => {},
    });
    await build(v, 1);
    expect(head(v)).toEqual(['div:eyebrow:Settings', 'h1::Switches & connections', 'p::Lead channels, today’s work ZIP, Google, the data links and webhooks — each one named, on or off.']);
    expect(v.children[1]!.textContent).toBe('Lead channel switches');
  });

  // Direction B P15 (R29 #4): the calculator moved from Today to Estimate, its name unchanged.
  it('the calculator stays "Yard check" (on Estimate now), and Measure keeps the Arborist eyebrow', () => {
    // Pin moved (R27 Phase A, owner app b), meaning kept: the same title, said through T when the tools are drawn.
    expect(html).toMatch(/key: 'yard', [^}]*title: T\('Yard check — will this job pay\?'\)/);
    expect(fnSrc('renderMeasure')).toContain("el('div', 'eyebrow', 'Arborist')");
  });

  it('the Agents desk cards name the screen each desk works on', () => {
    const section = (id: string) => SECTION_AGENTS.find((a) => a.id === id)!.section;
    expect(section('arborist')).toBe('Estimate'); // Direction B P19: Measure and the Book (Properties on file) sit under Estimate
    // Direction B P13 split the Queue: each desk names the screens it works on now.
    expect(section('chief-of-staff')).toContain('Follow-ups');
    expect(section('analyst')).toBe('Numbers');
    // The Yard Boss desk is the Money and Fleet screens.
    expect(section('yard-boss')).toBe('Money & Fleet');
    // The card subtitle is the section, as one unbreakable part.
    expect(fnSrc('renderAgents')).toContain('[a.section].concat(a.roles.map(noRefs))');
  });
});

// ---------- qa-x10: the emergency lead on Today and the Leads tab badge ----------
describe('R26 qa-x10 — the Leads tab badge', () => {
  const mount = () => {
    const btn = el('button');
    const badge = pageFn<(err: unknown, n?: number) => void>('leadsTabBadge', { $: () => btn, el, feedKind, FEED_WORD, plural });
    return { btn, badge };
  };

  it('a red count, said in words to a screen reader', () => {
    const { btn, badge } = mount();
    badge(null, 2);
    const dot = btn.querySelector('.dot')!;
    expect(dot.className).toBe('dot');
    expect(dot.textContent).toBe('2');
    expect(dot.attrs['aria-hidden']).toBe('true');
    expect(btn.attrs['aria-label']).toBe('Leads: 2 emergency leads');
    expect(btn.title).toBe('Leads: 2 emergency leads');
    badge(null, 1);
    expect(btn.querySelectorAll('.dot')).toHaveLength(1); // one dot, updated in place
    expect(btn.attrs['aria-label']).toBe('Leads: 1 emergency lead');
  });

  it('no emergency leads: no dot and no label', () => {
    const { btn, badge } = mount();
    badge(null, 3);
    badge(null, 0);
    expect(btn.querySelector('.dot')).toBeNull();
    expect(btn.attrs['aria-label']).toBeUndefined();
    expect(btn.title).toBe('');
  });

  it('a feed Arbo could not read keeps a dot in the feed-state colours and says so — never a quiet no-badge (§1B)', () => {
    const { btn, badge } = mount();
    badge(fail(503, 'link_cut'));
    expect(btn.querySelector('.dot')!.className).toBe('dot gap cut');
    expect(btn.querySelector('.dot')!.textContent).toBe('');
    expect(btn.attrs['aria-label']).toBe('Leads: cut on purpose. Emergency leads unknown — not zero.');
    badge(fail(undefined));
    expect(btn.querySelector('.dot')!.className).toBe('dot gap unread');
    expect(btn.attrs['aria-label']).toBe('Leads: couldn’t read it. Emergency leads unknown — not zero.');
    badge(null, 1); // the feed came back
    expect(btn.querySelector('.dot')!.className).toBe('dot');
  });

  it('the dot sits on the tab icon in the shared colours: red count, grey cut, amber not set up, hollow amber unread', () => {
    expect(css).toContain('\nnav button{position:relative}\n');
    expect(css).toContain('nav button .dot{position:absolute;top:5px;left:calc(50% + 5px);min-width:18px;height:18px;');
    expect(css).toContain('background:var(--emergency);color:var(--on-emergency);border:2px solid var(--card);');
    expect(css).toContain('\nnav button .dot.cut,nav button .dot.sim{background:var(--ink-4)}\n');
    expect(css).toContain('\nnav button .dot.unset{background:var(--warning)}\n');
    expect(css).toContain('\nnav button .dot.unread{background:var(--card);box-shadow:inset 0 0 0 2px var(--warning)}\n');
  });
});

describe('R26 qa-x10 — Today reads the emergency leads', () => {
  it('returns only the EMERGENCY leads and badges the tab with their count', async () => {
    const badge = vi.fn();
    const read = pageFn<() => Promise<{ list?: unknown[]; gap?: unknown } | null>>('emergencyLeads', {
      api: async (p: string) => { expect(p).toBe('/api/leads?limit=50'); return { leads: [{ id: 'A', isEmergency: true }, { id: 'B', isEmergency: false }, { id: 'C', isEmergency: true }] }; },
      LINKS_READY: Promise.resolve('simulation'), leadsTabBadge: badge,
    });
    const r = await read();
    expect((r!.list as Array<{ id: string }>).map((l) => l.id)).toEqual(['A', 'C']);
    expect(badge).toHaveBeenCalledWith(null, 2);
  });

  it('a feed it could not read comes back as a named gap, and the tab says so; the key wall is left to the key wall', async () => {
    const badge = vi.fn();
    const err = fail(503, 'link_cut');
    const read = pageFn<() => Promise<unknown>>('emergencyLeads', { api: async () => { throw err; }, LINKS_READY: Promise.resolve('cut'), leadsTabBadge: badge });
    expect(await read()).toEqual({ gap: err });
    expect(badge).toHaveBeenCalledWith(err);
    const badge2 = vi.fn();
    const locked = pageFn<() => Promise<unknown>>('emergencyLeads', { api: async () => { throw fail(401, 'unauthorized'); }, LINKS_READY: Promise.resolve('cut'), leadsTabBadge: badge2 });
    expect(await locked()).toBeNull();
    expect(badge2).not.toHaveBeenCalled();
  });

  it('an emergency Mike marked Good (qualified) has been acted on: no Today card, nothing on the tile, no badge — an open one still alarms', async () => {
    const badge = vi.fn();
    const read = pageFn<() => Promise<{ list?: Array<{ id: string }> } | null>>('emergencyLeads', {
      api: async () => ({ leads: [
        { id: 'Q', isEmergency: true, status: 'qualified' },
        { id: 'E', isEmergency: true, status: 'emergency' },
        { id: 'N', isEmergency: true, status: 'new' }, // the simulated phone lead's shape
        { id: 'W', isEmergency: false, status: 'qualified' },
      ] }),
      LINKS_READY: Promise.resolve('simulation'), leadsTabBadge: badge,
    });
    const r = await read();
    // Today draws a card per r.list entry and hands r.list.length to the emergencies tile (pinned below).
    expect(r!.list!.map((l) => l.id)).toEqual(['E', 'N']);
    expect(badge).toHaveBeenCalledWith(null, 2);
    const badge2 = vi.fn();
    const onlyGood = pageFn<() => Promise<{ list?: unknown[] } | null>>('emergencyLeads', {
      api: async () => ({ leads: [{ id: 'Q', isEmergency: true, status: 'qualified' }] }),
      LINKS_READY: Promise.resolve('simulation'), leadsTabBadge: badge2,
    });
    expect((await onlyGood())!.list).toEqual([]);
    expect(badge2).toHaveBeenCalledWith(null, 0);
  });

  it('a body with no leads list is a read that failed — never "no emergencies" (§1B)', async () => {
    const badge = vi.fn();
    const read = pageFn<() => Promise<{ gap?: { code?: number } } | null>>('emergencyLeads', { api: async () => ({}), LINKS_READY: Promise.resolve('live'), leadsTabBadge: badge });
    const r = await read();
    expect(r!.gap).toBeInstanceOf(TypeError);
    expect(feedKind(r!.gap)).toBe('unread');
    expect(badge).toHaveBeenCalledTimes(1);
    expect(badge.mock.calls[0]).toHaveLength(1); // the gap, never a count
  });
});

describe('R26 qa-x10 — the red alarm card links to the lead', () => {
  const openLead = vi.fn();
  const card = pageFn<(l: unknown) => N>('emergencyLeadCard', { el, chip, fmtWhen: (v: string) => 'WHEN(' + v + ')', openLead });
  const lead = { id: 'E1', name: 'SIM-Oak, Test', phone: '+17575550101', city: 'Norfolk', zip: '23503', createdAt: '2026-10-20T13:00:00Z', details: 'SIM tree on the roof', isEmergency: true };

  it('who, where, what they said, EMERGENCY as the alarm chip, then Call back and Open the lead', async () => {
    const c = card(lead);
    expect(c.className).toBe('card emergency');
    expect(c.text()).toContain('SIM-Oak, Test');
    expect(c.text()).toContain('WHEN(2026-10-20T13:00:00Z)');
    expect(c.text()).toContain('Norfolk · 23503');
    expect(c.text()).toContain('SIM tree on the roof');
    expect(chipsIn(c)).toEqual(['EMERGENCY=alarm']);
    const call = c.all().find((n) => n.has('callbtn'))!;
    expect(call.href).toBe('tel:+17575550101');
    const open = c.all().find((n) => n.tag === 'button')!;
    expect(open.textContent).toBe('Open the lead →');
    await open.click();
    expect(openLead).toHaveBeenCalledWith('E1');
  });

  it('no phone, no call button; a nameless caller reads as one', () => {
    const c = card({ ...lead, phone: null, name: null });
    expect(c.all().some((n) => n.has('callbtn'))).toBe(false);
    expect(c.text()).toContain('Unknown caller');
  });

  // openLead on a stand-in Leads view: `onScreen` = the lead's card is there before any redraw.
  const filters: string[] = [];
  function opener(filedAgo: number | null, onScreen: boolean) {
    const order: string[] = [];
    const view = leadsView(filedAgo);
    const target = el('div');
    let drawn = onScreen;
    const go = pageFn<(id: string) => Promise<void>>('openLead', {
      leadsFilter: (f: string) => filters.push(f), // Direction B P16: a lead Mike is sent to is never hidden by a filter chip
      switchTab: (t: string) => order.push('tab:' + t),
      renderLeads: async () => { order.push('render'); drawn = true; },
      holdsTyping,
      $: (id: string) => { expect(id).toBe('view-leads'); return view; },
      document: { getElementById: (id: string) => { order.push('find:' + id); return drawn ? target : null; } },
    });
    return { go, order, target };
  }

  it('openLead goes to Leads, redraws it, then scrolls to that lead', async () => {
    const { go, order, target } = opener(null, true);
    filters.length = 0;
    await go('E1');
    expect(filters).toEqual(['all']); // Direction B P16: the filter goes back to All first
    expect(order).toEqual(['tab:leads', 'render', 'find:lead-E1']);
    expect(target.scrolled).toEqual([{ behavior: 'smooth', block: 'center' }]);
  });

  it('a spam Undo still on offer is kept: with the lead already on Leads there is no redraw (the tab switch still comes first)', async () => {
    const { go, order, target } = opener(5000, true);
    await go('E1');
    expect(order).toEqual(['tab:leads', 'find:lead-E1', 'find:lead-E1']);
    expect(target.scrolled).toEqual([{ behavior: 'smooth', block: 'center' }]);
    // Past the 2-minute hold it redraws, as before.
    const late = opener(121000, true);
    await late.go('E1');
    expect(late.order).toEqual(['tab:leads', 'render', 'find:lead-E1']);
  });

  it('a lead not on Leads yet is drawn even under the hold — showing the lead wins', async () => {
    const { go, order, target } = opener(5000, false);
    await go('E1');
    expect(order).toEqual(['tab:leads', 'find:lead-E1', 'render', 'find:lead-E1']);
    expect(target.scrolled).toEqual([{ behavior: 'smooth', block: 'center' }]);
  });
});

describe('R26 qa-x10 — Today: the place on screen and the emergencies count', () => {
  const today = fnSrc('renderToday');
  const briefFetch = today.indexOf("api('/api/brief?from=");

  it('the alarm slot sits under the storm alert and above the run; both reads start before the brief fetch', () => {
    const storm = today.indexOf('v.appendChild(stormSlot);');
    const emg = today.indexOf('v.appendChild(emgSlot);');
    const law = today.indexOf('v.appendChild(lawSlot);');
    const day = today.indexOf('v.appendChild(day);');
    expect(storm).toBeGreaterThan(-1);
    expect(storm).toBeLessThan(emg);
    expect(emg).toBeLessThan(law);
    expect(law).toBeLessThan(day);
    // Full cards like the run's: display:contents, never inside a .slot (whose cards are flattened onto paper).
    expect(today).toContain("const emgSlot = el('div');\n  emgSlot.style.display = 'contents';");
    expect(css).toContain('.slot .card{box-shadow:none;border-color:var(--hairline);background:var(--paper)}');
    expect(today).toContain("const lawSlot = el('div', 'slot plain');");
    // Links cut, the brief returns early: anything after it never renders in production.
    expect(today.indexOf('emergencyLeads().then(')).toBeGreaterThan(-1);
    expect(today.indexOf('emergencyLeads().then(')).toBeLessThan(briefFetch);
    // Direction B P12: the law flag's slot is filled through Today's feeds card.
    expect(today.indexOf('feeds.place(lawSlot, stormLawFlag(alerting));')).toBeGreaterThan(-1);
    expect(today.indexOf('feeds.place(lawSlot, stormLawFlag(alerting));')).toBeLessThan(briefFetch);
  });

  it('the law flag learns whether NWS has an alert out from the storm banner’s own read — never a second one', () => {
    expect(today).toContain('const alerting = stormBanner().then((b) => { if (b) stormSlot.appendChild(b); return !!b; });');
    expect(today.indexOf('const alerting = stormBanner()')).toBeLessThan(today.indexOf('stormLawFlag(alerting)'));
    // The banner returns its card only when the feed named at least one alert.
    expect(fnSrc('stormBanner')).toContain('if (!na) return null;');
    expect(html.split("api('/api/storm')").length - 1).toBe(1);
  });

  it('an unread leads feed is named on Today in the shared feed words', () => {
    // Direction B P12: the line goes through Today's feeds card (folded when cut, kept in emgSlot when it failed).
    expect(today).toContain('feeds.place(emgSlot, emgP.then((r) => {');
    expect(today).toContain("const n = feedLine(r.gap, 'Emergency leads', 'That doesn’t mean there are none.');");
    const line = feedLine(fail(503, 'link_cut'), 'Emergency leads', 'That doesn’t mean there are none.');
    expect(line.className).toBe('feed-state cut');
    expect(line.textContent).toBe('Emergency leads: cut on purpose. That doesn’t mean there are none.');
    // More than three: one button to all of them, never a wall of red cards.
    expect(today).toContain('for (const l of r.list.slice(0, 3)) emgSlot.appendChild(emergencyLeadCard(l));');
    expect(today).toContain("'All ' + r.list.length + ' emergency leads →'");
  });

  it('"All N emergency leads →" keeps a spam Undo still on offer, as the minute timer does', () => {
    const m = /\n\s*more\.addEventListener\('click', (\(\) => \{ switchTab\('leads'\);[^\n]*\})\);\n/.exec(today);
    expect(m).not.toBeNull();
    const run = (filedAgo: number | null) => {
      const order: string[] = [];
      const view = leadsView(filedAgo);
      const tap = new Function('switchTab', 'holdsTyping', '$', 'renderLeads', `return ${m![1]};`)(
        (t: string) => order.push('tab:' + t), holdsTyping,
        (id: string) => { expect(id).toBe('view-leads'); return view; }, () => order.push('render'),
      ) as () => void;
      tap();
      return order;
    };
    expect(run(null)).toEqual(['tab:leads', 'render']);
    expect(run(5000)).toEqual(['tab:leads']);
    expect(run(121000)).toEqual(['tab:leads', 'render']);
  });

  // setEmergencies and layoutFlags, lifted out of renderToday and run on a stand-in grid.
  const block = /\n {2}const layoutFlags = \(\) => \{[\s\S]*?\n {2}\};\n(?=\s*emergencyLeads\(\)\.then\()/.exec(today)?.[0];
  function grid() {
    const hud = el('div', 'hud');
    for (const label of ['jobs today', 'estimates today', 'coming due', 'agent runs', 'overdue', 'to bill']) hud.appendChild(el('div', 'tile', label));
    const tile = (n: unknown, label: string, cls: string) => { const t = el('div', 'tile ' + cls); t.appendChild(el('b', '', String(n))); t.appendChild(el('span', '', label)); return t; };
    const tileWhy = (t: N, why: string) => { if (t.querySelector('small')) return; t.appendChild(el('small', '', why)); };
    // Direction B P10: the emergencies tile opens the first emergency card (goTile — not run here).
    const set = new Function('tile', 'tileWhy', 'hud', 'goTile', `${block}\nreturn setEmergencies;`)(tile, tileWhy, hud, () => {}) as (half: string, val: unknown) => void;
    const first = () => hud.children[0]!;
    return { hud, tile, set, first };
  }

  it('the lifted block is there', () => { expect(block).toBeTruthy(); });

  it('counts emergency stops AND emergency leads, in a real plural, leading the grid', () => {
    const g = grid();
    g.set('leads', 2);
    expect(g.first().text()).toBe('2 emergencies');
    expect(g.first().style.gridColumn).toBe('1 / -1');
    g.set('stops', 1);
    expect(g.first().text()).toBe('3 emergencies');
    expect(g.hud.querySelectorAll('.wide')).toHaveLength(1);
  });

  it('it leads a flagged-stops tile whichever half landed first, and the two share the first row', () => {
    const g = grid();
    g.set('leads', 1); // the leads read lands before the brief
    g.hud.prepend(g.tile(2, 'flagged stops', 'hot wide')); // the brief prepends its flagged stops…
    g.set('stops', 0); // …then hands over its emergencies
    expect(g.first().text()).toBe('1 emergency');
    expect(g.hud.children[1]!.text()).toBe('2 flagged stops');
    for (const t of g.hud.querySelectorAll('.wide')) expect(t.style.gridColumn).toBe('span 3');
  });

  it('a half Arbo could not read is named on the tile, never counted as 0 (§1B)', () => {
    const g = grid();
    g.set('leads', FEED_TAG.cut);
    g.set('stops', 1);
    expect(g.first().text()).toBe('1 emergency leads cut');
    expect(g.first().querySelector('small')!.textContent).toBe('leads cut');
    const h = grid();
    h.set('stops', FEED_TAG.unread);
    h.set('leads', 2);
    expect(h.first().querySelector('small')!.textContent).toBe('schedule unreadable');
  });

  it('nothing to count — or nothing readable — draws no emergencies tile (each gap is named in its own place)', () => {
    const g = grid();
    g.set('stops', 0);
    g.set('leads', 0);
    expect(g.hud.children).toHaveLength(6);
    const h = grid();
    h.set('stops', FEED_TAG.cut);
    h.set('leads', FEED_TAG.cut);
    expect(h.hud.children).toHaveLength(6);
  });

  it('the brief hands both of its paths to the tile', () => {
    expect(today).toContain("setEmergencies('stops', why);");
    expect(today).toContain("setEmergencies('stops', s.emergencies || 0);");
    expect(today).toContain("setEmergencies('leads', FEED_TAG[feedKind(r.gap)]);");
    expect(today).toContain("setEmergencies('leads', r.list.length);");
  });
});

// ---------- Leads: the SPANISH SPEAKER chip, the card's anchor, the badge ----------
describe('R26 — Leads flags a Spanish speaker and keeps the tab badge current', () => {
  type Lead = Record<string, unknown>;
  const lead = (o: Lead = {}): Lead => ({
    id: 'L1', name: 'SIM-Elm, Test', phone: '+17575550101', city: 'Norfolk', zip: '23503',
    createdAt: '2026-10-18T14:00:00Z', status: 'new', isEmergency: false, needsCallback: false,
    isFirstTimer: true, quality: { priority: 'warm' }, permit: null, screenPending: false,
    permitUnreadable: false, history: null, historyUnreadable: false, details: null, ...o,
  });
  async function mount(leads: Lead[] | Error) {
    const v = el('div');
    const badge = vi.fn();
    const reread = vi.fn(); // emergencyLeads: the re-read that re-badges the tab
    const render = pageFn<() => Promise<void>>('renderLeads', {
      $: () => v, el, readingLine: () => el('div', 'reading', 'Reading…'), tapCount: () => 0, keepsPage: () => false, TIMER_REDRAW: false, api: async () => { if (leads instanceof Error) throw leads; return { leads }; }, chip, fmtWhen: () => '',
      permitBadge: () => null, leadsTabBadge: badge, icon: (id: string) => el('svg', 'ico ' + id),
      showKeywall: () => {}, LINKS_READY: Promise.resolve('simulation'), state: (t: string) => el('div', 'state', t),
      feedState: (_e: unknown, w: string) => el('div', 'state', w), feedLine, showSaveFail: () => {}, emergencyLeads: reread,
      // Direction B P16: New leads' feeds card (its own tests: directionB_feeds, directionB_leadsHub).
      feedsCard: () => ({ el: el('div', 'card feeds'), place: () => Promise.resolve(), note: () => Promise.resolve() }), feedKind: () => 'cut',
    });
    await render();
    return { v, badge, reread };
  }

  it('language "es" (or lang "es") shows SPANISH SPEAKER as context, beside who they are', async () => {
    const { v } = await mount([lead({ id: 'S1', language: 'es' }), lead({ id: 'S2', lang: 'es' }), lead({ id: 'E1', language: 'en' }), lead({ id: 'N1' })]);
    const line1 = (i: number) => chipsIn(v.children[i]!.children.find((n) => n.has('badges'))!);
    expect(line1(0)).toEqual(['WARM=watch', 'FIRST-TIMER=info', 'SPANISH SPEAKER=info']);
    expect(line1(1)).toContain('SPANISH SPEAKER=info');
    expect(line1(2)).not.toContain('SPANISH SPEAKER=info');
    expect(line1(3)).not.toContain('SPANISH SPEAKER=info');
  });

  it('each card carries its anchor for Today’s "Open the lead", and the tab badge counts the emergencies', async () => {
    const { v, badge } = await mount([lead({ id: 'A', isEmergency: true, status: 'emergency', quality: { priority: 'hot' } }), lead({ id: 'B' })]);
    expect(v.children.map((c) => c.id)).toEqual(['lead-A', 'lead-B']);
    expect(badge).toHaveBeenCalledWith(null, 1);
    const empty = await mount([]);
    expect(empty.badge).toHaveBeenCalledWith(null, 0);
  });

  it('an emergency Mike marked Good stays red at the top of Leads, chips and all — the badge counts only the ones not acted on', async () => {
    const { v, badge } = await mount([
      lead({ id: 'B' }),
      lead({ id: 'Q', isEmergency: true, status: 'qualified', quality: { priority: 'hot' } }),
      lead({ id: 'E', isEmergency: true, status: 'emergency', quality: { priority: 'hot' } }),
    ]);
    expect(v.children.map((c) => c.id)).toEqual(['lead-Q', 'lead-E', 'lead-B']);
    const q = v.children[0]!;
    expect(q.has('emergency')).toBe(true);
    expect(chipsIn(q.children.find((n) => n.has('badges'))!)).toEqual(['EMERGENCY=alarm', 'FIRST-TIMER=info', 'QUALIFIED=good']);
    expect(badge).toHaveBeenCalledWith(null, 1);
  });

  it('tapping Good lead on an emergency re-reads the emergencies, so the tab badge drops at once; a plain lead does not', async () => {
    const { v, reread } = await mount([lead({ id: 'E', isEmergency: true, status: 'emergency', quality: { priority: 'hot' } }), lead({ id: 'B' })]);
    const good = (i: number) => v.children[i]!.all().find((n) => n.tag === 'button' && n.has('ok'))!;
    await good(1).click(); // B, a plain lead
    expect(reread).not.toHaveBeenCalled();
    await good(0).click(); // E, the emergency
    expect(reread).toHaveBeenCalledTimes(1);
    expect(chipsIn(v.children[0]!)).toContain('QUALIFIED=good');
  });

  it('a leads feed it could not read badges the tab with the gap, beside the named state', async () => {
    const err = fail(503, 'link_cut');
    const { v, badge } = await mount(err);
    expect(badge).toHaveBeenCalledWith(err);
    // Direction B P16: New leads' feeds card counts it, above; the named state stays where the list would be.
    expect(v.children.map((n) => n.className)).toEqual(['card feeds', 'state']);
    expect(v.children[1]!.textContent).toBe('Leads');
  });

  it('SPANISH SPEAKER is an identity tag in the tone word list', () => {
    expect(html).toContain('//     REPEAT, SPANISH SPEAKER, SPAM, COOL,');
  });
});

// ---------- the owner-only storm price-law flag ----------
describe('R26 — the storm price-law flag on Today (owner only)', () => {
  const flag = (api: () => Promise<unknown>, LINKS = 'live') => pageFn<(alerting?: Promise<boolean>) => Promise<N | null>>('stormLawFlag', {
    api, LINKS_READY: Promise.resolve(LINKS), feedKind: feedKindWith(LINKS), feedLine, el, document,
  });
  // The server's own sentence: the Governor's half of the law is in no feed Arbo can read.
  const GOV = GOVERNOR_NOTE;
  const NO_FEED = 'Governor declarations are not in any feed Arbo can read.';
  const alert = Promise.resolve(true);
  const calm = Promise.resolve(false);

  it('active: one amber card — never the alarm — with the declaration titles, then the Governor note', async () => {
    const box = await flag(async () => ({ state: 'active', governorNote: GOV, declarations: [{ title: 'SIM Tropical Storm declaration' }, 'SIM County emergency', { title: '' }] }))(calm);
    expect(box!.className).toBe('late');
    expect(box!.children[0]!.textContent).toBe('Virginia post-disaster price law in effect — check with counsel');
    expect(box!.children.slice(1).map((c) => c.tag + ':' + c.textContent)).toEqual(['small:SIM Tropical Storm declaration', 'small:SIM County emergency', 'small:' + GOV]);
    // No titles: the sentence and the note.
    const none = await flag(async () => ({ state: 'active', governorNote: GOV }))();
    expect(none!.children.map((c) => c.textContent)).toEqual(['Virginia post-disaster price law in effect — check with counsel', GOV]);
    // An odd declarations field — or no note from the server — never costs Mike the flag or the note.
    const odd = await flag(async () => ({ state: 'active', declarations: { title: 'x' } }))();
    expect(odd!.className).toBe('late');
    expect(odd!.children.map((c) => c.textContent)).toEqual(['Virginia post-disaster price law in effect — check with counsel', NO_FEED]);
  });

  it('none on a calm day: nothing. None while NWS has an alert out: one muted line naming what Arbo cannot see', async () => {
    expect(await flag(async () => ({ state: 'none', governorNote: GOV }))()).toBeNull();
    expect(await flag(async () => ({ state: 'none', governorNote: GOV }))(calm)).toBeNull();
    const line = await flag(async () => ({ state: 'none', governorNote: GOV }))(alert);
    expect(line!.className).toBe('storm-muted'); // help text: the FEMA read itself succeeded
    expect(line!.textContent).toBe('Storm price law: no open FEMA declaration. ' + GOV);
    expect(line!.children).toEqual([]);
    const bare = await flag(async () => ({ state: 'none' }))(alert);
    expect(bare!.textContent).toBe('Storm price law: no open FEMA declaration. ' + NO_FEED);
  });

  it('unreadable — or a state this page does not know — is named, never read as "no declaration" (§1B), storm or calm', async () => {
    for (const weather of [undefined, calm, alert]) {
      const unread = await flag(async () => ({ state: 'unreadable', governorNote: GOV }))(weather);
      expect(unread!.className).toBe('feed-state unread');
      expect(unread!.textContent).toBe('Storm price law: couldn’t read it. ' + RETRY);
      expect((await flag(async () => ({ state: 'later' }))(weather))!.className).toBe('feed-state unread');
    }
  });

  it('not built on this server (404 / not_built), or the key wall: nothing. A read that failed: named.', async () => {
    expect(await flag(async () => { throw fail(404, 'not_found'); })()).toBeNull();
    expect(await flag(async () => { throw fail(503, 'not_built'); })()).toBeNull();
    expect(await flag(async () => { throw fail(401, 'unauthorized'); })()).toBeNull();
    const down = await flag(async () => { throw fail(500); })();
    expect(down!.textContent).toBe('Storm price law: couldn’t read it. ' + RETRY);
    expect((await flag(async () => { throw fail(undefined); })())!.className).toBe('feed-state unread');
  });

  it('it lives on the owner page only — the crew door never reads it', async () => {
    const { loadCrewHtml } = await import('../src/server/appPage.js');
    expect(loadCrewHtml()).not.toContain('/api/storm/law');
    expect(html.split("api('/api/storm/law')").length - 1).toBe(1);
  });
});

// ---------- the Permit Desk topic ----------
describe('R26 — the Permit Desk names the pests & quarantines topic', () => {
  it("TOPIC_NAMES carries 'pests_quarantine' as Pests & quarantines, after the topics before it", () => {
    const TOPIC_NAMES = pageConst<Record<string, string>>('TOPIC_NAMES');
    expect(TOPIC_NAMES.pests_quarantine).toBe('Pests & quarantines');
    expect(Object.keys(TOPIC_NAMES).at(-1)).toBe('pests_quarantine');
    expect(Object.keys(TOPIC_NAMES)).toContain('eagle_wildlife');
  });
});

// ---------- the repo's law, on everything this package added ----------
describe('R26 owner-ui — the law holds on the new copy', () => {
  const added = ['leadsTabBadge', 'openLead', 'emergencyLeads', 'emergencyLeadCard', 'stormLawFlag', 'permitChip'].map(fnSrc);
  const heads = ['renderBook', 'renderFollowUps', 'renderPerformance', 'buildSettings'].map((f) => {
    const s = fnSrc(f);
    return s.slice(s.indexOf("const head = el('div', 'viewhead');"), s.indexOf('v.appendChild(head);'));
  });

  it('no "clear", "cleared", "exempt", Suffolk, TCIA, price figure or date promise in the new words', () => {
    for (const code of [...added, ...heads]) {
      for (const lit of literals(code)) {
        expect(lit).not.toMatch(/\b(clear|cleared|exempt)\b/i);
        expect(lit).not.toMatch(/suffolk|tcia/i);
        expect(lit).not.toMatch(/\$\s?\d/);
        expect(lit).not.toMatch(/\b(we will|we'll|guarantee)\b/i);
      }
    }
  });

  it('nothing is logged (no customer detail in a log) and nothing is sent', () => {
    for (const code of added) {
      expect(code).not.toContain('console.');
      expect(code).not.toMatch(/method: 'POST'/);
    }
  });

  it('every new chip goes through chip()', () => {
    for (const code of added) expect(code).not.toContain('badge(');
  });
});

// ---------- CREW_PLAN C3 (D109): the roster hands each person their sign-in link ----------
// Q6 default: the link carries the crew code only — never the door key, never
// the app key. Arbo sends nothing: the phone's own share sheet does, or the
// link is copied for Mike to paste. The armed "Take off the roster" line no
// longer says the code still opens the crew door (an off-roster code is now
// refused on the paid routes), and still promises nothing the code does not do.
describe('C3 — Send sign-in link on each active person, and the armed line', () => {
  const ON = '00000000-0000-4000-8000-0000000000c1';
  const people = [
    { id: ON, name: 'SIM-Alder, Test', role: 'climber', competencyLevel: 7, active: true, certCount: 1 },
    { id: '00000000-0000-4000-8000-0000000000c9', name: 'SIM-Gone, Test', role: 'groundie', competencyLevel: 2, active: false, certCount: 0 },
  ];
  const list = async (navigator: Record<string, unknown>) => {
    const slot = el('div');
    const armed: string[] = [];
    const sent: string[] = [];
    const fn = pageFn<(s: N) => Promise<boolean>>('renderRosterList', {
      api: async (path: string, opts?: { method?: string }) => { if (opts?.method) sent.push(path); return { people, certsKnown: true, activeCount: 1 }; },
      LINKS_READY: Promise.resolve(), state: () => el('div'), FEED_WORD: {}, feedKind: () => 'x', feedSays: () => '',
      el, chip, plural, CREW_ROLES: ['climber', 'foreman', 'groundie', 'driver'], certAdder: () => el('div'),
      armTwice: (_b: N, text: string) => { armed.push(text); },
      location: { origin: 'https://arbo.example' }, navigator,
    });
    await fn(slot);
    const cards = slot.children;
    const sendBtn = (i: number) => cards[i]!.all().find((n) => n.tag === 'button' && n.textContent === 'Send sign-in link');
    return { slot, cards, armed, sent, sendBtn };
  };

  it('each active person gets a Send sign-in link button; someone off the roster does not', async () => {
    const r = await list({});
    expect(r.sendBtn(0)).toBeDefined();
    expect(r.sendBtn(0)!.className).toBe('actbtn');
    expect(r.sendBtn(1)).toBeUndefined();
  });

  it('it hands the phone’s share sheet the link — the crew code only, in the fragment, no key — and Arbo sends nothing', async () => {
    const shared: Array<Record<string, string>> = [];
    const r = await list({ share: async (d: Record<string, string>) => { shared.push(d); } });
    await r.sendBtn(0)!.click();
    expect(shared).toHaveLength(1);
    expect(shared[0]!.url).toBe(`https://arbo.example/crew#crew=${ON}`);
    expect(JSON.stringify(shared[0])).not.toMatch(/key|arbor|x-arbo/i);
    expect(r.sent).toEqual([]);
  });

  it('no share sheet: the link is copied, and the card says so', async () => {
    const copied: string[] = [];
    const r = await list({ clipboard: { writeText: async (t: string) => { copied.push(t); } } });
    await r.sendBtn(0)!.click();
    expect(copied).toEqual([`https://arbo.example/crew#crew=${ON}`]);
    expect(r.cards[0]!.text()).toContain('Link copied — paste it into a text to SIM-Alder, Test.');
  });

  it('a share sheet that fails (not a cancel) falls back to the copy; a cancel does nothing', async () => {
    const copied: string[] = [];
    const clipboard = { writeText: async (t: string) => { copied.push(t); } };
    const failed = await list({ share: async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); }, clipboard });
    await failed.sendBtn(0)!.click();
    expect(copied).toHaveLength(1);
    const cancelled = await list({ share: async () => { throw Object.assign(new Error('cancel'), { name: 'AbortError' }); }, clipboard });
    await cancelled.sendBtn(0)!.click();
    expect(copied).toHaveLength(1);
    expect(cancelled.cards[0]!.text()).not.toContain('Link copied');
  });

  it('neither share nor copy: the link is shown to copy by hand — never a silent nothing', async () => {
    const r = await list({ clipboard: { writeText: async () => { throw new Error('denied'); } } });
    await r.sendBtn(0)!.click();
    expect(r.cards[0]!.text()).toContain(`Copy this link and text it to SIM-Alder, Test: https://arbo.example/crew#crew=${ON}`);
  });

  it('the armed line names the boards and no longer says the code still opens the crew door', async () => {
    const r = await list({});
    expect(r.armed).toEqual(['Tap again to take SIM-Alder, Test off the roster — the safety and training boards stop counting them.']);
    expect(html).not.toContain('Their crew code still opens the crew door');
    expect(html).not.toContain('lose crew-door access');
  });

  it('the new words keep the law: no "clear", no price, nothing logged', () => {
    const code = fnSrc('renderRosterList');
    for (const lit of literals(code)) {
      expect(lit).not.toMatch(/\b(clear|cleared|exempt)\b/i);
      expect(lit).not.toMatch(/\$\s?\d/);
    }
    expect(code).not.toContain('console.');
  });
});
