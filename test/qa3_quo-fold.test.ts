// QA round 3 — the Quo fold (confirmed items 1, 2, 3 and 5).
// 1–3: the merged "Quo isn't connected" card's title wrapped to two lines at
//      phone width (leaving a stub of the gold title rule), and its last
//      sentence ended on a vague "there are none".
// 5:   Calls drew the same one cause as three cards; Today folded it into one.
// The fold is now ONE shared helper, fillQuoSlots, used by Today and Calls.
// vitest has no DOM, so the helper and renderCalls are lifted out of the page
// and run against a small stand-in element; the copy is pinned as source.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');

/** One top-level function's source, from its declaration to the "}" alone on its line. */
function src(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
/** That function, built with stand-ins for every outside name it reaches for. */
function pageFn<T>(name: string, deps: Record<string, unknown>): T {
  return new Function(...Object.keys(deps), `${src(name)}\nreturn ${name};`)(...Object.values(deps)) as T;
}

// ---------- a stand-in element: just what fillQuoSlots and renderCalls touch ----------
class FakeEl {
  className = '';
  children: FakeEl[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  offsetHeight = 0;
  parent: FakeEl | null = null;
  private text = '';
  constructor(readonly tag: string) {}
  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(''); }
  set textContent(t: string) { this.text = t; this.children = []; }
  appendChild(n: FakeEl): FakeEl { this.children.push(n); n.parent = this; return n; }
  replaceChildren(...n: FakeEl[]): void { this.text = ''; this.children = [...n]; }
  // Direction B P3: a first draw says "Reading…" in a card of its own, and takes it away once every read has landed.
  hasChildNodes(): boolean { return this.children.length > 0 || this.text !== ''; }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  setAttribute(): void {}
  addEventListener(): void {}
}
const el = (tag: string, cls?: string, text?: string): FakeEl => {
  const n = new FakeEl(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
/** A panel as studyPanel / outreachPanel / sonaPanel return it: a titled card, quoOff when Quo isn't connected. */
const panel = (title: string, quoOff: boolean): FakeEl => {
  const w = el('div');
  w.appendChild(el('div', 'panel-title', title));
  // Off, each one says its own "Waiting on Quo" line (the fold must hide those); on, any body.
  w.appendChild(el('div', 'feed-state unset', quoOff ? 'Waiting on Quo — ' + title : title + ' body'));
  if (quoOff) w.dataset.quoOff = '1';
  return w;
};
// Direction B P16: the fold's line is one builder, quoOffLine — the fold and the Leads head say it the same way.
const quoOffLine = pageFn<(links: string) => FakeEl>('quoOffLine', { el, Cap: (s: string) => s.charAt(0).toUpperCase() + s.slice(1), FEED_WORD: { sim: 'not in the practice data' } });
const fillQuoSlots = pageFn<(reads: Promise<FakeEl | null>[], slots: FakeEl[]) => Promise<void>>('fillQuoSlots', { el, LINKS_READY: Promise.resolve('live'), quoOffLine });
const fillQuoSlotsSim = pageFn<(reads: Promise<FakeEl | null>[], slots: FakeEl[]) => Promise<void>>('fillQuoSlots', { el, LINKS_READY: Promise.resolve('simulation'), quoOffLine });
const slots = () => [el('div', 'slot'), el('div', 'slot'), el('div', 'slot')];
const titles = (s: FakeEl[]) => s.map((x) => x.children.map((c) => c.children[0]?.textContent ?? ''));

const FOLD_BODY = 'Quo isn’t connected to Arbo yet — Arbo can’t read your customer threads, can’t text anyone, and Sona’s calls aren’t reaching Arbo. That doesn’t mean there are no customer threads or Sona calls.';

describe('items 1–3: the folded Quo card keeps its title on one line and names what is not zero', () => {
  it('the title is one short word, like Inbox and Website forms — the explanation stays in the body', () => {
    const fold = src('fillQuoSlots');
    // Direction B P16: the body's one builder; wave 3b review: on Calls & texts the head says it, so the card points there.
    expect(fold).toContain("q.appendChild(saidAbove ? el('div', 'storm-muted', T('Shown in its own place on this screen.')) : quoOffLine(links));");
    expect(fold).toContain("q.appendChild(el('div', 'panel-title', 'Quo'));");
    // The long title that wrapped at 390px and squeezed the gold rule to a stub is gone everywhere.
    expect(html).not.toContain('Quo — customers, texts and Sona’s calls');
    expect(html).not.toContain('Quo \\u2014 customers, texts and Sona');
  });

  it('the last sentence says exactly what is not zero, once — never a bare "there are none"', () => {
    const fold = src('quoOffLine'); // Direction B P16: the fold's words, one builder (the Leads head says them too)
    expect(fold).toContain(`el('div', 'feed-state unset', T('${FOLD_BODY}'))`); // R27 Phase A (es-owner-a): through T
    expect(fold.match(/That doesn’t mean/g)).toHaveLength(1);
    expect(fold).not.toContain('there are none');
    expect(fold).not.toContain('This is not zero');
  });

  it('run: all three panels off → ONE card in the first slot, titled "Quo", in the not-set-up feed words', async () => {
    const s = slots();
    await fillQuoSlots([Promise.resolve(panel('Where each customer stands', true)), Promise.resolve(panel('Text outreach', true)), Promise.resolve(panel('Sona calls (Quo)', true))], s);
    expect(s[0]!.children).toHaveLength(1);
    const card = s[0]!.children[0]!;
    expect(card.children.map((c) => c.className)).toEqual(['panel-title', 'feed-state unset']);
    expect(card.children[0]!.textContent).toBe('Quo');
    expect(card.children[1]!.textContent).toBe(FOLD_BODY);
    // The other two slots stay empty, so '.slot:empty' hides them.
    expect(s[1]!.children).toHaveLength(0);
    expect(s[2]!.children).toHaveLength(0);
  });
});

describe('practice mode: the folded Quo card uses the practice-data words, like Inbox and Website forms', () => {
  it('simulation → grey "not in the practice data", never the real-outage sentence', async () => {
    const s = slots();
    await fillQuoSlotsSim([Promise.resolve(panel('Where each customer stands', true)), Promise.resolve(panel('Text outreach', true)), Promise.resolve(panel('Sona calls (Quo)', true))], s);
    const card = s[0]!.children[0]!;
    expect(card.children.map((c) => c.className)).toEqual(['panel-title', 'feed-state sim']);
    // "real": the one PRACTICE text under Calls › Texts is made up, so the card never says no texts show at all.
    expect(card.children[1]!.textContent).toBe('Not in the practice data — no real customer threads, texts or Sona calls show here; those stay in Quo.');
    expect(card.children[1]!.textContent).not.toContain('isn’t connected');
  });
});

describe('fillQuoSlots: one cause folds, anything else keeps its own card', () => {
  it('one panel that is not "Quo isn’t connected" → no fold; each panel fills its own slot, in order', async () => {
    const s = slots();
    await fillQuoSlots([Promise.resolve(panel('Where each customer stands', true)), Promise.resolve(panel('Text outreach', true)), Promise.resolve(panel('Sona calls (Quo)', false))], s);
    expect(titles(s)).toEqual([['Where each customer stands'], ['Text outreach'], ['Sona calls (Quo)']]);
  });

  it('a panel with nothing to show (401 → null) is not counted as "off": no fold, the others still draw', async () => {
    const s = slots();
    await fillQuoSlots([Promise.resolve(panel('Where each customer stands', true)), Promise.resolve(null), Promise.resolve(panel('Sona calls (Quo)', true))], s);
    expect(titles(s)).toEqual([['Where each customer stands'], [], ['Sona calls (Quo)']]);
  });

  it('a panel that throws empties only its own slot — it never takes the other two down, and never fakes the fold', async () => {
    const s = slots();
    await fillQuoSlots([Promise.resolve(panel('Where each customer stands', true)), Promise.reject(new Error('boom')), Promise.resolve(panel('Sona calls (Quo)', true))], s);
    expect(titles(s)).toEqual([['Where each customer stands'], [], ['Sona calls (Quo)']]);
  });
});

describe('item 5: Calls folds the same way Today does — one shared helper, no fork', () => {
  it('source: Today and Calls each call fillQuoSlots once; neither carries an inline fold of its own', () => {
    const today = src('renderToday');
    const calls = src('renderCalls');
    // Direction B P12: Today hands the fold its feeds card's place; P16: Calls & texts too — Sona's calls first (the mockup).
    expect(today).toContain('fillQuoSlots([studyPanel(5), outreachPanel(false), sonaPanel(3, false)], [studySlot, outreachSlot, sonaSlot], feeds.place);');
    // Wave 3b review: Calls & texts passes saidAbove — the Leads head says the fold's words there.
    expect(calls).toContain('fills.push(fillQuoSlots([sonaPanel(20, true), studyPanel(60), outreachPanel(true)], [sonaCallsSlot, studyFull, outreachFull], feeds.place, true));');
    for (const [name, s] of [['renderToday', today], ['renderCalls', calls]] as const) {
      expect(s.match(/fillQuoSlots\(/g), name).toHaveLength(1);
      expect(s, name).not.toContain('dataset.quoOff');
      expect(s, name).not.toContain('Promise.all([studyPanel');
    }
    // The helper itself, plus the two callers — nowhere else.
    expect(html.match(/fillQuoSlots\(/g)).toHaveLength(3);
    // Calls fills each panel only through the fold, never one by one.
    expect(calls).not.toContain('studyPanel(60).then');
    expect(calls).not.toContain('outreachPanel(true).then');
    expect(calls).not.toContain('sonaPanel(20, true).then');
    // The three slots are placed before the read — Sona's calls first on Calls & texts (Direction B P16, the mockup).
    const at = ['const sonaCallsSlot', 'const studyFull', 'const outreachFull'].map((x) => calls.indexOf(x));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(at[2]).toBeLessThan(calls.indexOf('fillQuoSlots('));
  });

  // renderCalls, run: the three Quo panels are stand-ins; every other read on the screen answers "cut".
  function mountCalls(quoOff: [boolean, boolean, boolean]) {
    const v = el('div');
    const api = async (path: string) => {
      if (path === '/api/webhooks/texts') return { linkCut: true, wired: false, texts: [] };
      if (path === '/api/relay/call-notes') return { notes: [] };
      if (path === '/api/webhooks/calls') return { linkCut: true, wired: false, transcripts: [] };
      if (path === '/api/review/backlog?all=1&limit=20') return { conversations: [] };
      throw new Error('unexpected read ' + path);
    };
    // Direction B P16: Calls & texts' feeds card, as a stand-in with the page's fold rule (a feed off on purpose or not
    // set up goes INTO the card; anything else to its slot) — the card itself is pinned in directionB_feeds.
    const card = el('div', 'card feeds');
    const feedsCard = () => ({
      el: card,
      place: (slot: FakeEl, x: unknown) => Promise.resolve(x as FakeEl | null).then((n) => { if (n) (['cut', 'sim', 'unset'].includes(n.dataset.off ?? '') ? card : slot).appendChild(n); }),
      note: () => Promise.resolve(),
    });
    const renderCalls = pageFn<() => Promise<void>>('renderCalls', {
      $: () => v, el, api, fillQuoSlots, readingLine: () => el('div', 'reading', 'Reading…'), tapCount: () => 0, keepsPage: () => false, TIMER_REDRAW: false, feedsCard, feedKind: () => 'cut', 
      studyPanel: async () => panel('Where each customer stands', quoOff[0]),
      outreachPanel: async () => panel('Text outreach', quoOff[1]),
      sonaPanel: async () => panel('Sona calls (Quo)', quoOff[2]),
      chip: (t: string) => el('span', 'badge', t), plural: (n: number, one: string) => n + ' ' + one,
      fmtWhen: () => '', fmtTime: () => '', showKeywall: () => {}, showSaveFail: () => {},
      LINKS_READY: Promise.resolve('simulation'),
      state: (t: string, m: string) => el('div', 'state', t + ' ' + m),
      feedLine: (_e: unknown, what: string) => el('div', 'feed-state sim', what),
    });
    return { v, renderCalls, card };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));
  /** The Quo slots: Sona's calls first, then (past the feeds card's place) the study and outreach — Direction B P16. */
  const quoSlots = (v: FakeEl) => [v.children[0]!, v.children[2]!, v.children[3]!];

  // Direction B P16: the one "Quo" card is a feed not set up — it goes into Calls & texts' feeds card (named there,
  // its words intact; the Leads head says them above the segments), and the three slots stay empty.
  it('run: Quo not connected → Calls shows ONE "Quo" card, not three saying the same thing', async () => {
    const s = mountCalls([true, true, true]);
    await s.renderCalls();
    await flush();
    const q = quoSlots(s.v);
    expect(q.every((x) => x.className === 'slot')).toBe(true);
    expect(titles(q)).toEqual([[], [], []]);
    const quo = s.card.children.filter((c) => c.children[0]?.textContent === 'Quo'); // (Arbo's own line, cut, folds in beside it)
    expect(quo).toHaveLength(1);
    // Wave 3b review (UI #7): the Leads head above says FOLD_BODY (directionB_leadsHub); the card names Quo and points there.
    expect(quo[0]!.children[1]!.textContent).toBe('Shown in its own place on this screen.');
    expect(s.v.textContent).not.toContain('Waiting on Quo');
    expect(s.v.style.minHeight).toBe(''); // the held height still lets go once the fold has landed
  });

  it('run: any other state → Calls keeps its three cards, in order (Sona\'s calls first — Direction B P16)', async () => {
    const s = mountCalls([false, false, false]);
    await s.renderCalls();
    await flush();
    expect(titles(quoSlots(s.v))).toEqual([['Sona calls (Quo)'], ['Where each customer stands'], ['Text outreach']]);
    const mixed = mountCalls([true, true, false]);
    await mixed.renderCalls();
    await flush();
    expect(titles(quoSlots(mixed.v))).toEqual([['Sona calls (Quo)'], ['Where each customer stands'], ['Text outreach']]);
  });
});

// Direction B wave 3b review (UI #7): on Calls & texts the Leads head already says the fold's words where Sona's
// flag goes, so the screen's feeds card names Quo and points there — the paragraph is said once on the screen.
describe('review round: Calls & texts says "Quo isn’t connected" once', () => {
  const fillSaidAbove = pageFn<(reads: Promise<FakeEl | null>[], slots: FakeEl[], place: undefined, saidAbove: boolean) => Promise<void>>('fillQuoSlots', { el, LINKS_READY: Promise.resolve('live'), quoOffLine });
  it('said above: the folded card is titled Quo, off as not set up, and points to its place — not the paragraph again', async () => {
    const s = slots();
    await fillSaidAbove([Promise.resolve(panel('Where each customer stands', true)), Promise.resolve(panel('Text outreach', true)), Promise.resolve(panel('Sona calls (Quo)', true))], s, undefined, true);
    const card = s[0]!.children[0]!;
    expect(card.dataset.off).toBe('unset');
    expect(card.dataset.feedName).toBe('Quo');
    expect(card.textContent).not.toContain('Quo isn’t connected');
    expect(card.children.map((c) => c.textContent)).toEqual(['Quo', 'Shown in its own place on this screen.']);
  });
  it('Calls & texts passes it (the head carries the words); Today does not (no head there)', () => {
    expect(src('renderCalls')).toContain('fills.push(fillQuoSlots([sonaPanel(20, true), studyPanel(60), outreachPanel(true)], [sonaCallsSlot, studyFull, outreachFull], feeds.place, true));');
    expect(src('renderToday')).toContain('fillQuoSlots([studyPanel(5), outreachPanel(false), sonaPanel(3, false)], [studySlot, outreachSlot, sonaSlot], feeds.place);');
  });
});
