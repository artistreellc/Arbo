// Direction B, P12 (docs/DIRECTION_B_PLAN.md; spec: "One feeds card per screen
// for off / cut / couldn't-read notices (e.g. '9 feeds off: 8 cut on purpose,
// 1 couldn't read'), opening to name every feed. A failed feed is still named,
// never hidden (§1B)" — R29 #1).
// feedsCard(key) returns { el, place(slot, x) }. A screen hands each panel's
// answer (the node, or the read's promise) to place():
//   · a wrapper that only reports a feed cut on purpose / not in the practice
//     data / not set up (data-off + data-feed-name) folds INTO the card;
//   · one Arbo couldn't read (data-off="unread"), or one kept in its place
//     (data-keep), stays where it would show — and is counted in the card too;
//   · anything else goes to its slot, as before.
// The card counts only this screen's reads through place(); a read in flight
// is "Reading…", never counted as working. It opens with a button
// (aria-expanded) — never a <details>, which would freeze a timed screen's
// minute redraw (the plan's fact 5).
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';

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

class N {
  className = ''; type = ''; id = ''; title = ''; hidden = false; disabled = false;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: N[] = [];
  parent: N | null = null;
  on: Record<string, Array<() => void>> = {};
  private own = '';
  constructor(readonly tag: string) {}
  get textContent(): string { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(t: string) { for (const c of this.children) c.parent = null; this.children = []; this.own = t; }
  has(c: string) { return this.className.split(/\s+/).includes(c); }
  get classList() { return { add: (c: string) => { if (!this.has(c)) this.className = (this.className + ' ' + c).trim(); }, remove: (c: string) => { this.className = this.className.split(/\s+/).filter((x) => x && x !== c).join(' '); }, contains: (c: string) => this.has(c), toggle: (c: string, f?: boolean) => { if (f ?? !this.has(c)) this.classList.add(c); else this.classList.remove(c); } }; }
  appendChild(c: N): N { c.parent?.drop(c); c.parent = this; this.children.push(c); return c; }
  prepend(c: N): void { c.parent?.drop(c); c.parent = this; this.children.unshift(c); }
  drop(c: N) { this.children = this.children.filter((x) => x !== c); c.parent = null; }
  remove() { this.parent?.drop(this); }
  replaceChildren(...ns: N[]) { for (const c of this.children) c.parent = null; this.children = []; this.own = ''; for (const n of ns) this.appendChild(n); }
  hasChildNodes() { return this.children.length > 0 || this.own !== ''; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  addEventListener(t: string, f: () => void) { (this.on[t] ??= []).push(f); }
  click() { for (const f of this.on.click ?? []) f(); }
  all(): N[] { return [this, ...this.children.flatMap((c) => c.all())]; }
  querySelector(sel: string): N | null { return this.all().slice(1).find((n) => (sel.startsWith('.') ? n.has(sel.slice(1)) : n.tag === sel)) ?? null; }
  // The document's order, for the card's list (P12 review): a node is on the page when its root is a 'document'.
  private root(): N { return this.parent ? this.parent.root() : this; }
  get isConnected() { return this.root().tag === 'document'; }
  compareDocumentPosition(o: N) { const all = this.root().all(); return all.indexOf(o) > all.indexOf(this) ? 4 : 2; }
}
const el = (tag: string, cls?: string, text?: string) => { const n = new N(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

// ---------- the helper, lifted with the page's own words ----------
type Card = { el: N; place: (slot: N, x: unknown) => Promise<void>; note: (name: string, where: N, kind: unknown) => Promise<void> };
/** The page's feedsCard with its tables; `state` carries the per-screen memory across draws (a redraw is a second call). */
function build() {
  const make = new Function('el', 'document', `
    ${['FEED_WORD', 'FEEDS_SAID', 'FEEDS_OPEN', 'FEEDS_BOX', 'FEEDS_GEN'].map(constSrc).join('\n')}
    ${['plural', 'readingLine', 'feedsCard'].map(fnSrc).join('\n')}
    return { feedsCard, FEEDS_SAID, FEED_WORD };`);
  return make(el, { createElement: (t: string) => new N(t), createTextNode: (t: string) => { const n = new N('#text'); n.textContent = t; return n; } }) as {
    feedsCard: (key: string) => Card; FEEDS_SAID: Record<string, string>; FEED_WORD: Record<string, string>;
  };
}
/** A wrapper as the panels return one: a title and a feed-state line, marked as the plan says. */
function wrapper(name: string, kind?: string, keep = false): N {
  const w = el('div');
  w.appendChild(el('div', 'panel-title', name));
  w.appendChild(el('div', 'feed-state ' + (kind ?? 'x'), name + ': ' + (kind ?? 'fine') + '.'));
  if (kind) { w.dataset.off = kind; w.dataset.feedName = name; }
  if (keep) w.dataset.keep = '1';
  return w;
}
const head = (card: N) => card.all().find((n) => n.has('feeds-head'));
const list = (card: N) => card.all().find((n) => n.has('feeds-list'));
const reading = (card: N) => card.all().filter((n) => n.has('reading'));

describe('feedsCard: what folds, what stays, what counts (P12)', () => {
  it('an off wrapper moves into the card and is counted; its own slot stays empty', async () => {
    const { feedsCard } = build();
    const f = feedsCard('t');
    const slot = el('div', 'slot');
    const w = wrapper('Location tracking', 'cut');
    await f.place(slot, w);
    await flush();
    expect(slot.children).toEqual([]);
    expect(f.el.hidden).toBe(false);
    expect(head(f.el)!.textContent).toContain('1 feed off: 1 cut on purpose');
    expect(list(f.el)!.all()).toContain(w); // the wrapper itself, its words intact
    expect(list(f.el)!.textContent).toContain('Location tracking: cut.');
    // Every feed is named with its state word, whatever its own wrapper says.
    expect(list(f.el)!.textContent).toContain('Location tracking — cut on purpose');
  });

  it('an unread wrapper stays in its slot — where the number would be — and is counted too', async () => {
    const { feedsCard } = build();
    const f = feedsCard('t');
    const slot = el('div', 'slot');
    const w = wrapper('Inbox', 'unread');
    await f.place(slot, w);
    await flush();
    expect(slot.children).toEqual([w]);
    expect(head(f.el)!.textContent).toContain('1 feed off: 1 couldn’t read');
    // The open list names it as well, with the shared word — never only a count.
    expect(list(f.el)!.textContent).toContain('Inbox — couldn’t read it');
  });

  it('a kept wrapper (data-keep: a partial read rides with it, or the schedule card) stays and is counted', async () => {
    const { feedsCard } = build();
    const f = feedsCard('t');
    const slot = el('div');
    const w = wrapper('Schedule', 'cut', true);
    await f.place(slot, w);
    await flush();
    expect(slot.children).toEqual([w]);
    expect(head(f.el)!.textContent).toContain('1 feed off: 1 cut on purpose');
    expect(list(f.el)!.textContent).toContain('Schedule — cut on purpose');
  });

  it('a normal node goes to its slot, uncounted; nothing (a 401) and a read that threw place nothing', async () => {
    const { feedsCard } = build();
    const f = feedsCard('t');
    const a = el('div'); const b = el('div'); const c = el('div');
    const ok = wrapper('Inbox');
    await f.place(a, ok);
    await f.place(b, null);
    await f.place(c, Promise.reject(new Error('boom')));
    await flush();
    expect(a.children).toEqual([ok]);
    expect(b.children).toEqual([]);
    expect(c.children).toEqual([]);
    expect(f.el.hidden, 'nothing off: no card').toBe(true);
    expect(f.el.children).toEqual([]);
  });

  it('the headline is the spec\'s: "N feeds off: X cut on purpose, Y not in the practice data, Z not set up, W couldn’t read", in that order', async () => {
    const { feedsCard } = build();
    const f = feedsCard('t');
    const s = el('div');
    const placed = [
      wrapper('A', 'unread'), wrapper('B', 'cut'), wrapper('C', 'unset'), wrapper('D', 'cut'), wrapper('E', 'sim'),
      wrapper('F', 'cut'), wrapper('G', 'cut'), wrapper('H', 'cut'), wrapper('I', 'cut'),
    ];
    for (const w of placed) f.place(s, w);
    await flush();
    expect(head(f.el)!.textContent).toContain('9 feeds off: 6 cut on purpose, 1 not in the practice data, 1 not set up, 1 couldn’t read');
    // Every feed is named in the list, in the order the screen placed them (never the order the reads landed).
    const names = list(f.el)!.textContent;
    let at = -1;
    for (const n of 'ABCDEFGHI'.split('')) { const i = names.indexOf(n + ' — '); expect(i, n).toBeGreaterThan(at); at = i; }
  });

  it('a read still in flight shows "Reading…" and is never counted as working', async () => {
    const { feedsCard } = build();
    const f = feedsCard('t');
    let land!: (n: N) => void;
    const pending = new Promise<N>((r) => { land = r; });
    const s1 = el('div'); const s2 = el('div');
    f.place(s1, pending);
    await flush();
    // Nothing landed yet: "Reading…", and no count at all — never "0 feeds off".
    expect(reading(f.el).map((n) => n.textContent)).toEqual(['Reading…']);
    expect(f.el.textContent).not.toMatch(/\b0 feeds?\b/);
    expect(f.el.hidden).toBe(false);
    f.place(s2, wrapper('Website forms', 'unset'));
    await flush();
    expect(head(f.el)!.textContent).toContain('1 feed off: 1 not set up');
    expect(reading(f.el)).toHaveLength(1); // still reading the other one
    land(wrapper('Inbox', 'cut'));
    await flush();
    expect(head(f.el)!.textContent).toContain('2 feeds off: 1 cut on purpose, 1 not set up');
    expect(reading(f.el)).toHaveLength(0);
  });

  it('the card opens with a button (aria-expanded), never a <details>; the list is hidden until it is opened', async () => {
    const { feedsCard } = build();
    const f = feedsCard('t');
    f.place(el('div'), wrapper('Inbox', 'cut'));
    await flush();
    expect(f.el.all().some((n) => n.tag === 'details' || n.tag === 'summary')).toBe(false);
    const b = head(f.el)!;
    expect(b.tag).toBe('button');
    expect(b.type).toBe('button');
    expect(b.attrs['aria-expanded']).toBe('false');
    expect(b.attrs['aria-controls']).toBe(list(f.el)!.id);
    expect(list(f.el)!.hidden).toBe(true);
    b.click();
    expect(b.attrs['aria-expanded']).toBe('true');
    expect(list(f.el)!.hidden).toBe(false);
    b.click();
    expect(list(f.el)!.hidden).toBe(true);
    expect(fnSrc('feedsCard')).not.toMatch(/details|summary/);
  });

  it('open stays open through the minute redraw (the next card on the same screen)', async () => {
    const { feedsCard } = build();
    const f = feedsCard('t');
    f.place(el('div'), wrapper('Inbox', 'cut'));
    await flush();
    head(f.el)!.click();
    const g = feedsCard('t');
    expect(g.el, 'the same card, never a new one').toBe(f.el);
    g.place(el('div'), wrapper('Inbox', 'cut'));
    await flush();
    expect(head(g.el)!.attrs['aria-expanded']).toBe('true');
    expect(list(g.el)!.hidden).toBe(false);
    // Another screen's card is its own.
    const other = feedsCard('u');
    other.place(el('div'), wrapper('Inbox', 'cut'));
    await flush();
    expect(list(other.el)!.hidden).toBe(true);
  });

  it('a redraw keeps the last card up — no "Reading…" — until its own reads land, then swaps', async () => {
    const { feedsCard } = build();
    const f = feedsCard('t');
    f.place(el('div'), wrapper('Inbox', 'cut'));
    await flush();
    const before = head(f.el)!.textContent;
    let land!: (n: N) => void;
    const g = feedsCard('t');
    g.place(el('div'), wrapper('Website forms', 'unset'));
    g.place(el('div'), new Promise<N>((r) => { land = r; }));
    await flush();
    expect(head(g.el)!.textContent, 'the old card stays while the new reads are out').toBe(before);
    expect(reading(g.el)).toHaveLength(0);
    land(wrapper('Quo', 'unset'));
    await flush();
    expect(head(g.el)!.textContent).toContain('2 feeds off: 2 not set up');
  });

  it('an older draw that lands late never paints over a newer one', async () => {
    const { feedsCard } = build();
    let late!: (n: N) => void;
    const f = feedsCard('t');
    f.place(el('div'), new Promise<N>((r) => { late = r; }));
    const g = feedsCard('t');
    g.place(el('div'), wrapper('Inbox', 'cut'));
    await flush();
    late(wrapper('Old', 'unset'));
    await flush();
    expect(head(g.el)!.textContent).toContain('1 feed off: 1 cut on purpose');
    expect(g.el.textContent).not.toContain('Old');
  });

  it('nothing off and nothing reading: no card — never a calm line', async () => {
    const { feedsCard } = build();
    const f = feedsCard('t');
    f.place(el('div'), wrapper('Inbox'));
    await flush();
    expect(f.el.hidden).toBe(true);
    expect(f.el.textContent).toBe('');
    // The card never claims the rest are fine (it counts only what it was handed).
    expect(fnSrc('feedsCard')).not.toMatch(/all (?:feeds|read)|every feed read|nothing off|all clear/i);
  });

  it('the card counts only the screen\'s own reads through place() — it reads nothing itself', () => {
    const src = fnSrc('feedsCard');
    expect(src).not.toContain('api(');
    expect(src).not.toContain('/health');
  });

  it('its words are the shared feed words, in the spec\'s short form', () => {
    const { FEEDS_SAID, FEED_WORD } = build();
    expect(FEEDS_SAID).toEqual({ cut: FEED_WORD.cut, sim: FEED_WORD.sim, unset: 'not set up', unread: 'couldn’t read' });
  });

  it('every tap target is at least 44 px, and the open list never hides behind a CSS content string', () => {
    expect(html).toMatch(/\.feeds-head\{[^}]*min-height:(4[4-9]|5\d)px/);
    expect(html).not.toMatch(/\.feeds[^{]*\{[^}]*content:'[^']+'/);
  });
});

// ---------- UI review of b-wave-2: the card's count, its list's words and order, its headline at 320 ----------
describe('feedsCard after the UI review (P12): every feed the screen shows off, said once, in the screen\'s order', () => {
  // Finding 3: "N feeds off" read as a total, but the hero's dashes, Before you roll's lines and the
  // tiles named feeds off that the card never counted. A screen hands those reads to note(): counted,
  // named, and left where they show — never moved, never a second line on the screen.
  it('note(): a read shown off in its own place is counted and named — "Shown in its own place" — and nothing moves', async () => {
    const { feedsCard } = build();
    const f = feedsCard('t');
    const tile = el('div', 'tile');
    tile.appendChild(el('b', '', '–'));
    f.note('Overdue and to bill', tile, Promise.resolve('cut'));
    f.note('Agent runs', el('div'), Promise.resolve(null)); // it read: not counted
    await flush();
    expect(head(f.el)!.textContent).toBe('1 feed off: 1 cut on purpose');
    expect(list(f.el)!.textContent).toContain('Overdue and to bill — cut on purpose');
    expect(list(f.el)!.textContent).toContain('Shown in its own place on this screen.');
    expect(list(f.el)!.textContent).not.toContain('Agent runs');
    expect(tile.children.map((c) => c.textContent)).toEqual(['–']);
  });

  it('note(): in flight it is "Reading…", never counted as working; the same feed noted twice counts once', async () => {
    const { feedsCard } = build();
    const f = feedsCard('t');
    let land!: (k: string) => void;
    f.note('Weather alerts', el('div'), new Promise<string>((r) => { land = r; }));
    await flush();
    expect(reading(f.el)).toHaveLength(1);
    expect(f.el.textContent).not.toMatch(/\b0 feeds?\b/);
    f.note('Weather alerts', el('div'), Promise.resolve('unread'));
    land('unread');
    await flush();
    expect(head(f.el)!.textContent).toBe('1 feed off: 1 couldn’t read');
    expect(reading(f.el)).toHaveLength(0);
  });

  it('a note that throws or names no kind counts nothing, and the card still settles', async () => {
    const { feedsCard } = build();
    const f = feedsCard('t');
    f.note('A', el('div'), Promise.reject(new Error('boom')));
    f.note('B', el('div'), Promise.resolve('nonsense'));
    await flush();
    expect(f.el.hidden).toBe(true);
    expect(reading(f.el)).toHaveLength(0);
  });

  // Finding 4: "Emergency leads — cut on purpose" over "Emergency leads: cut on purpose. That doesn't
  // mean there are none." said the name and state twice. A folded line that already opens with
  // "Name: state word" is the item's name line; no second one above it.
  it('a folded line that already says "Name: state word" is not named twice; one that doesn\'t gets the name line', async () => {
    const { feedsCard, FEED_WORD } = build();
    const f = feedsCard('t');
    const line = el('div', 'feed-state cut', 'Emergency leads: ' + FEED_WORD.cut + '. That doesn’t mean there are none.');
    line.dataset.off = 'cut'; line.dataset.feedName = 'Emergency leads';
    const loc = el('div');
    loc.appendChild(el('div', 'panel-title', 'Location tracking'));
    loc.appendChild(el('div', 'feed-state cut', 'Location tracking: ' + FEED_WORD.cut + '. No check-ins are being recorded.'));
    loc.dataset.off = 'cut'; loc.dataset.feedName = 'Location tracking';
    const quo = el('div');
    quo.appendChild(el('div', 'panel-title', 'Quo'));
    quo.appendChild(el('div', 'feed-state unset', 'Quo isn’t connected to Arbo yet.'));
    quo.dataset.off = 'unset'; quo.dataset.feedName = 'Quo';
    for (const n of [line, loc, quo]) f.place(el('div'), n);
    await flush();
    const names = list(f.el)!.all().filter((n) => n.has('feeds-name')).map((n) => n.textContent);
    expect(names).toEqual(['Quo — not set up yet']);
    // Every feed is still named with its state word, once.
    const items = list(f.el)!.children.map((c) => c.all().filter((n) => !n.has('panel-title')).map((n) => n.children.length ? '' : n.textContent).join(''));
    expect(items).toEqual([
      'Emergency leads: cut on purpose. That doesn’t mean there are none.',
      'Location tracking: cut on purpose. No check-ins are being recorded.',
      'Quo — not set up yetQuo isn’t connected to Arbo yet.',
    ]);
  });

  // Finding 5: the list followed the order the reads were handed over (Storm price law first), not
  // the screen's. It follows where each shows, top to bottom; two in one place keep their handed order.
  it('the open list follows the screen top to bottom, whatever order the reads were handed over', async () => {
    const { feedsCard } = build();
    const f = feedsCard('t');
    const doc = el('document');
    const view = doc.appendChild(el('div'));
    const hero = view.appendChild(el('div'));
    const emg = view.appendChild(el('div'));
    const law = view.appendChild(el('div'));
    const day = view.appendChild(el('div'));
    f.place(law, wrapper('Storm price law', 'unread'));
    f.place(emg, wrapper('Emergency leads', 'cut'));
    f.place(day, wrapper('Schedule', 'cut', true));
    f.note('Open loops', hero, Promise.resolve('cut'));
    f.note('Weather alerts', hero, Promise.resolve('unread'));
    await flush();
    const order = list(f.el)!.children.map((c) => c.textContent.split(/ — |:/)[0]);
    expect(order).toEqual(['Open loops', 'Weather alerts', 'Emergency leads', 'Storm price law', 'Schedule']);
  });

  // Finding 7: at 320 the closed headline broke "…, 4 / not in the practice data, 1 / couldn’t read".
  // Each count stays with its words: one unbreakable piece per count, the line breaks between them.
  it('the headline keeps each count with its words — one unbreakable piece each — and reads the same', async () => {
    const { feedsCard } = build();
    const f = feedsCard('t');
    for (const [n, k] of [['A', 'cut'], ['B', 'sim'], ['C', 'sim'], ['D', 'unread']] as const) f.place(el('div'), wrapper(n, k));
    await flush();
    const said = head(f.el)!.all().find((n) => n.has('feed-state'))!;
    expect(said.textContent).toBe('4 feeds off: 1 cut on purpose, 2 not in the practice data, 1 couldn’t read');
    expect(said.children.filter((c) => c.has('fh')).map((c) => c.textContent)).toEqual(['4 feeds off:', '1 cut on purpose,', '2 not in the practice data,', '1 couldn’t read']);
    expect(html).toMatch(/\.feeds-head \.fh\{white-space:nowrap\}/);
  });
});

// ---------- each panel marks the wrapper that only reports a dead feed ----------
const fail = (code: number | undefined, message: string) => Object.assign(new Error(message), { code });
const FEED_WORD = new Function(`${constSrc('FEED_WORD')}\nreturn FEED_WORD;`)() as Record<string, string>;
const FEED_TAG_T = new Function(`${constSrc('FEED_TAG')}\nreturn FEED_TAG;`)() as Record<string, string>;
/** The page's own feedKind against a LINKS value. */
const feedKindFor = (links: string) => new Function('LINKS', `${fnSrc('feedKind')}\nreturn feedKind;`)(links) as (e: unknown) => string;
function panel<T>(name: string, links: string, api: (p: string) => Promise<unknown>, extra: Record<string, unknown> = {}): T {
  const feedKind = feedKindFor(links);
  const deps: Record<string, unknown> = {
    el, api, feedKind, FEED_WORD, LINKS_READY: Promise.resolve(links), Cap: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
    RETRY: 'Tap ↻ at the top to try again.', fmtTime: () => '', fmtWhen: () => '', plural: (n: number, one: string, many?: string) => n + ' ' + (n === 1 ? one : many || one + 's'),
    chip: (t: string) => el('span', 'badge', t), renderToday: () => {}, renderCalls: () => {}, showSaveFail: () => {},
    document: { getElementById: () => null, createTextNode: (t: string) => { const n = new N('#text'); n.textContent = t; return n; } },
    ...extra,
  };
  deps.feedLine = new Function('el', 'feedKind', 'FEED_WORD', 'RETRY', `${fnSrc('feedLine')}\nreturn feedLine;`)(el, feedKind, FEED_WORD, deps.RETRY);
  return new Function(...Object.keys(deps), `${fnSrc(name)}\nreturn ${name};`)(...Object.values(deps)) as T;
}
const throws = (e: Error) => async () => { throw e; };

describe('the panels mark the wrapper that only reports a dead feed (data-off + data-feed-name)', () => {
  it.each([
    ['cut', fail(503, 'link_cut'), 'readonly'],
    ['unset', fail(503, 'db_not_configured'), 'readonly'],
    ['sim', fail(503, 'not_simulated'), 'simulation'],
    ['unread', new TypeError('Failed to fetch'), 'readonly'],
  ] as const)('a %s read: Location, Phone line, Inbox, Website forms, the three Quo panels and the storm law flag', async (kind, err, links) => {
    const run = async (name: string, ...args: unknown[]) => (await panel<(...a: unknown[]) => Promise<N | null>>(name, links, throws(err))(...args))!;
    const got: Array<[string, N]> = [
      ['Location tracking', await run('locationStrip')],
      ['Arbo’s phone line', await run('receptionStrip')],
      ['Inbox', await run('inboxIntentPanel')],
      ['Website forms', await run('websiteFormsPanel')],
      ['Customer notes', await run('studyPanel', 5)],
      ['Text outreach', await run('outreachPanel', false)],
      ['Sona calls', await run('sonaPanel', 3, false)],
    ];
    // The storm law flag says nothing when its read is "not set up" (no such read yet), as before.
    const law = await panel<(a: Promise<boolean>) => Promise<N | null>>('stormLawFlag', links, throws(err))(Promise.resolve(false));
    if (kind === 'unset') expect(law).toBeNull();
    else got.push(['Storm price law', law!]);
    for (const [name, w] of got) {
      expect(w.dataset.off, name).toBe(kind);
      expect(w.dataset.feedName, name).toBe(name);
      expect(w.dataset.keep, name).toBeUndefined();
    }
  });

  it('Quo not connected: each Quo panel is marked not set up, as its own words say', async () => {
    const quoOff = throws(fail(503, 'quo_not_configured'));
    for (const [name, args] of [['studyPanel', [5]], ['outreachPanel', [false]]] as const) {
      const w = (await panel<(...a: unknown[]) => Promise<N>>(name, 'readonly', quoOff)(...args));
      expect(w.dataset.off, name).toBe('unset');
      expect(w.dataset.quoOff, name).toBe('1'); // the fold still sees it
    }
    const sona = await panel<(n: number, t: boolean) => Promise<N>>('sonaPanel', 'readonly', async () => ({ status: { registration: { state: 'not_configured' }, reading: true, quoRecord: {} }, calls: [] }))(3, false);
    expect(sona.dataset.off).toBe('unset');
    expect(sona.dataset.feedName).toBe('Sona calls');
  });

  it('the old phone line cut on purpose (R21) and website forms not wired are marked; a healthy read never is', async () => {
    const rec = await panel<() => Promise<N>>('receptionStrip', 'readonly', async () => ({ linkCut: true }))();
    expect(rec.dataset.off).toBe('cut');
    const live = await panel<() => Promise<N>>('receptionStrip', 'readonly', async () => ({ linkCut: false, configured: true, turnsSinceBoot: 0, callsSinceBoot: 0, llmKeyPresent: true }))();
    expect(live.dataset.off).toBeUndefined();
    const formsSim = await panel<() => Promise<N>>('websiteFormsPanel', 'simulation', async () => ({ wired: false, forms: [] }))();
    expect(formsSim.dataset.off).toBe('sim');
    const formsOff = await panel<() => Promise<N>>('websiteFormsPanel', 'readonly', async () => ({ wired: false, forms: [] }))();
    expect(formsOff.dataset.off).toBe('unset');
    const formsOn = await panel<() => Promise<N>>('websiteFormsPanel', 'readonly', async () => ({ wired: true, forms: [] }))();
    expect(formsOn.dataset.off).toBeUndefined();
  });

  it('Inbox with no Gmail: marked in its own words — and kept in its place when a gap line rides with it (partial reads never fold)', async () => {
    const inbox = (links: string, d: unknown) => panel<() => Promise<N>>('inboxIntentPanel', links, async () => d)();
    const unsetBox = await inbox('readonly', { pipeline: 'no_gmail', gmailReason: 'no Gmail credentials configured' });
    expect(unsetBox.dataset.off).toBe('unset');
    expect(unsetBox.dataset.feedName).toBe('Inbox');
    expect(unsetBox.dataset.keep).toBeUndefined();
    const simBox = await inbox('simulation', { pipeline: 'no_gmail', gmailReason: 'no Gmail credentials configured' });
    expect(simBox.dataset.off).toBe('sim');
    const failed = await inbox('readonly', { pipeline: 'no_gmail', gmailReason: 'invalid_grant' });
    expect(failed.dataset.off).toBe('unread');
    const gap = await inbox('readonly', { pipeline: 'no_gmail', gmailReason: 'no Gmail credentials configured', gmailGap: { why: 'no_record', toIso: '2026-10-20T12:00:00Z' } });
    expect(gap.dataset.off).toBe('unset');
    expect(gap.dataset.keep).toBe('1');
  });

  it('a storm law read Arbo could not make sense of is marked unread', async () => {
    const odd = await panel<(a: Promise<boolean>) => Promise<N>>('stormLawFlag', 'readonly', async () => ({ state: 'unreadable' }))(Promise.resolve(false));
    expect(odd.dataset.off).toBe('unread');
    expect(odd.dataset.feedName).toBe('Storm price law');
  });
});

describe('fillQuoSlots hands its answers to the screen\'s place, when it has one', () => {
  const fill = (links: string) => new Function('el', 'LINKS_READY', 'Cap', 'FEED_WORD', `${fnSrc('fillQuoSlots')}\nreturn fillQuoSlots;`)(
    el, Promise.resolve(links), (s: string) => s.charAt(0).toUpperCase() + s.slice(1), FEED_WORD,
  ) as (reads: Array<Promise<N | null>>, slots: N[], place?: (slot: N, x: unknown) => Promise<void>) => Promise<unknown>;
  const quoOff = (title: string) => { const w = el('div'); w.appendChild(el('div', 'panel-title', title)); w.dataset.quoOff = '1'; return w; };

  it('every slot is handed over at once, before the reads land, so the card knows they are in flight', async () => {
    const calls: Array<[N, unknown]> = [];
    const slots = [el('div'), el('div'), el('div')];
    let land!: (n: N) => void;
    const p = fill('readonly')([new Promise<N>((r) => { land = r; }), Promise.resolve(null), Promise.resolve(null)], slots, (s, x) => { calls.push([s, x]); return Promise.resolve(x).then(() => {}); });
    expect(calls.map(([s]) => slots.indexOf(s))).toEqual([0, 1, 2]);
    land(el('div'));
    await p;
  });

  it('all three off: ONE "Quo" card, marked not set up (or not in the practice data), in the first slot', async () => {
    for (const [links, kind] of [['readonly', 'unset'], ['simulation', 'sim']] as const) {
      const got: Array<N | null> = [];
      const slots = [el('div'), el('div'), el('div')];
      await fill(links)([Promise.resolve(quoOff('a')), Promise.resolve(quoOff('b')), Promise.resolve(quoOff('c'))], slots,
        (s, x) => Promise.resolve(x).then((n) => { got[slots.indexOf(s)] = n as N | null; }));
      expect(got[0]!.dataset.off, links).toBe(kind);
      expect(got[0]!.dataset.feedName, links).toBe('Quo');
      expect(got[0]!.children[0]!.textContent).toBe('Quo');
      expect(got.slice(1)).toEqual([null, null]);
    }
  });

  it('without a place (Calls), it appends as it always did', async () => {
    const slots = [el('div'), el('div'), el('div')];
    const a = el('div', '', 'a'); const c = el('div', '', 'c');
    await fill('readonly')([Promise.resolve(a), Promise.resolve(null), Promise.resolve(c)], slots);
    expect(slots.map((s) => s.children)).toEqual([[a], [], [c]]);
  });
});

// ---------- P12, Today: every slot a panel fills goes through the card ----------
describe('Today hands every panel slot to its feeds card (P12, source pins)', () => {
  const today = fnSrc('renderToday');
  const brief = today.indexOf("api('/api/brief?from=");
  const caught = today.slice(brief, today.indexOf('const s = brief.summary;'));

  it('one card for Today, made before anything is handed to it and before the brief await', () => {
    const made = today.indexOf("const feeds = feedsCard('today');");
    expect(made).toBeGreaterThan(-1);
    expect(made).toBeLessThan(today.indexOf('feeds.place('));
    expect(made).toBeLessThan(brief);
  });

  it('every panel slot is handed to place — and before the brief await, which ends Today early in production', () => {
    for (const want of [
      'feeds.place(emgSlot, ',
      'feeds.place(lawSlot, stormLawFlag(alerting));',
      'feeds.place(locSlot, locationStrip()',
      'feeds.place(recSlot, receptionStrip());',
      'feeds.place(inboxSlot, inboxIntentPanel());',
      'fillQuoSlots([studyPanel(5), outreachPanel(false), sonaPanel(3, false)], [studySlot, outreachSlot, sonaSlot], feeds.place);',
      'feeds.place(formsSlot, websiteFormsPanel());',
      'feeds.place(day, ',
    ]) {
      expect(today, want).toContain(want);
      expect(today.indexOf(want), want).toBeLessThan(brief);
    }
    // No slot is filled straight from a read any more.
    expect(today).not.toMatch(/\.then\(\(b\) => \{ if \(b\) \w+\.appendChild\(b\); \}\)/);
    expect(today).not.toContain('emgSlot.appendChild(feedLine(');
    expect(today).not.toContain('day.appendChild(sc)');
  });

  it('the slots that never carry a dead-feed wrapper keep their own way — named here so a new one is a choice', () => {
    // The storm alarm (its gap is the hero's '–'), Before you roll (names its own gaps),
    // the assistant's slot (R28: fillAssistToday fills it, quiet when off or not set up), the R32 line.
    expect(today).toContain('const alerting = stormBanner().then((b) => { if (b) stormSlot.appendChild(b); return !!b; });');
    expect(today).toContain('rollSlot.appendChild(beforeYouRoll(');
    expect(today).toContain('fillAssistToday(assistSlot);');
    expect(today).toContain("if (LINKS === 'readonly') roSlot.appendChild(el('div', 'storm-muted', 'Read-only: Arbo is reading your real records and saving nothing. Anything that would save says so.'));");
  });

  it('the card sits under the day and its instruments, above the notices it folds — hero, Before you roll and the day come first', () => {
    const at = (s: string) => { const i = today.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    expect(at('v.appendChild(rollSlot);')).toBeLessThan(at('v.appendChild(day);'));
    expect(at('v.appendChild(instr);')).toBeLessThan(at('v.appendChild(feeds.el);'));
    expect(at('v.appendChild(feeds.el);')).toBeLessThan(at('v.appendChild(locSlot);'));
  });

  it('the schedule card stays in the day (data-keep), counted on the card; its place is taken before the brief is read', () => {
    expect(today.indexOf('feeds.place(day, new Promise((res) => { schedDone = res; }));')).toBeGreaterThan(-1);
    expect(today.indexOf('feeds.place(day, new Promise((res) => { schedDone = res; }));')).toBeLessThan(brief);
    expect(caught).toContain("const sc = feedState(e, 'Schedule', 'an empty day');");
    expect(caught).toContain('sc.dataset.off = k;');
    expect(caught).toContain("sc.dataset.feedName = 'Schedule';");
    expect(caught).toContain("sc.dataset.keep = '1';");
    expect(caught.indexOf('sc.appendChild(calBtn);')).toBeLessThan(caught.indexOf('schedDone(sc);'));
  });

  it('every way out of the brief read settles the schedule\'s place, so the card never reads forever', () => {
    expect(caught).toContain('if (e.code === 401) { schedDone(null); return showKeywall(); }');
    const s = today.indexOf('const s = brief.summary;');
    expect(today.slice(s - 40, s)).toContain('schedDone(null);');
    expect(today.match(/schedDone\(/g)).toHaveLength(3);
  });

  it('the emergency leads gap goes through the card, marked and named; the tile still names the gap', () => {
    const at = today.indexOf('feeds.place(emgSlot, ');
    const block = today.slice(at, today.indexOf('}));', at));
    expect(block).toContain("const n = feedLine(r.gap, 'Emergency leads', 'That doesn’t mean there are none.');");
    expect(block).toContain('n.dataset.off = feedKind(r.gap);');
    expect(block).toContain("n.dataset.feedName = 'Emergency leads';");
    expect(at).toBeLessThan(today.indexOf('emergencyLeads().then('));
    expect(today).toContain("setEmergencies('leads', FEED_TAG[feedKind(r.gap)]);");
  });

  it('Today stays free of <details> (a timed screen)', () => {
    expect(today).not.toContain("'details'");
  });

  // UI review of b-wave-2, finding 3: the hero's dashes, Before you roll's lines and the tiles named feeds
  // off the card never counted — so "N feeds off" undercounted what the screen showed. Each of those reads
  // is noted on the card (counted, named, left where it shows), before the brief await like everything here.
  it('every read Today shows off in a place of its own is noted on the card — before the brief await', () => {
    for (const want of [
      "feeds.note('Open loops', v.firstChild, heroLoops());",
      "feeds.note('Weather alerts', v.firstChild, alerting.then(",
      'rollSlot.appendChild(beforeYouRoll(emgP, alerting.then(() => STORM_READ), feeds.note));',
      "feeds.note('Coming due', dueTile, api('/api/properties')",
      "feeds.note('Agent runs', agentTile, api('/api/agents/runs?limit=5')",
      "feeds.note('Overdue and to bill', owedTile, api('/api/money')",
    ]) {
      expect(today, want).toContain(want);
      expect(today.indexOf(want), want).toBeLessThan(brief);
    }
    // A dead tile names its gap in the word the card uses: worded once the links are known.
    for (const t of ['dueTile', 'agentTile', 'owedTile']) {
      const at = today.indexOf('tileWhy(' + t + ', FEED_TAG[feedKind(e)])');
      expect(today.slice(at - 140, at), t).toContain('LINKS_READY.then(() => {');
    }
  });

  it('heroLoops hands back what its read came to: null when it read, its kind when it did not (a 401 is the key wall\'s)', async () => {
    const run = async (api: () => Promise<unknown>) => new Function('api', 'HERO', 'LINKS_READY', 'feedKind', 'FEED_TAG', 'sysSet', 'plural', 'openPanel', 'DESK_VIEW',
      `${fnSrc('heroLoops')}\nreturn heroLoops;`)(api, null, Promise.resolve('readonly'), feedKindFor('readonly'), FEED_TAG_T, () => {}, (n: number, w: string) => n + ' ' + w, () => {}, {})() as Promise<unknown>;
    expect(await run(async () => ({ open: [] }))).toBeNull();
    expect(await run(() => Promise.reject(fail(503, 'link_cut')))).toBe('cut');
    expect(await run(() => Promise.reject(fail(503, 'db_not_configured')))).toBe('unset');
    expect(await run(() => Promise.reject(new TypeError('Failed to fetch')))).toBe('unread');
    expect(await run(() => Promise.reject(fail(401, 'unauthorized')))).toBeNull();
  });
});
