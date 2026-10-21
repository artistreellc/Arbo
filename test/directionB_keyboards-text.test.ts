// Direction B, P2 (docs/DIRECTION_B_PLAN.md; spec quick fixes "Number fields
// open the number keyboard" and "Small text gets larger and higher-contrast").
// The number fields stay type="text" so a typo still reaches the server's own
// refusal — only the phone's keyboard changes. Text gets a 12 px floor; the
// hero's labels on the dark green get their contrast back.
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';

const html = loadAppHtml();
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

function fnSrc(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
function pageFn<T>(name: string, deps: Record<string, unknown>): T {
  return new Function(...Object.keys(deps), `${fnSrc(name)}\nreturn ${name};`)(...Object.values(deps)) as T;
}

// A stand-in DOM: the composers only build nodes until a tap.
class FNode {
  className = ''; type = ''; placeholder = ''; inputMode = ''; value = ''; textContent = ''; style: Record<string, string> = {};
  children: FNode[] = [];
  constructor(readonly tag: string) {}
  appendChild(c: FNode): FNode { this.children.push(c); return c; }
  addEventListener(): void {}
  setAttribute(): void {}
  all(): FNode[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}
const el = (tag: string, cls?: string, text?: string) => { const n = new FNode(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const document = { createElement: (t: string) => new FNode(t) };
const disclose = (label: string, node: FNode) => { const d = el('details'); d.appendChild(el('summary', '', label)); d.appendChild(node); return d; };
const inputs = (n: FNode) => n.all().filter((x) => x.tag === 'input');
const field = (n: FNode, ph: RegExp) => { const f = inputs(n).find((x) => ph.test(x.placeholder)); if (!f) throw new Error('no field ' + ph); return f; };

describe('number fields open the number keyboard (P2)', () => {
  it('the roster\'s skill level: numeric keyboard, still a text box', () => {
    const c = pageFn<(s: unknown) => FNode>('rosterComposer', { el, document, disclose, CREW_ROLES: ['climber'], api: () => {} })(el('div'));
    const level = field(c, /^Skill level/);
    expect(level.inputMode).toBe('numeric');
    expect(level.type).toBe('text');
  });

  it('a new unit\'s height and weight: numeric keyboard, still text boxes (a typo reaches the server\'s refusal)', () => {
    const c = pageFn<(s: unknown) => FNode>('fleetComposer', { el, document, disclose, api: () => {} })(el('div'));
    for (const ph of [/^Height in inches/, /^Loaded weight in lbs/]) {
      const f = field(c, ph);
      expect(f.inputMode, String(ph)).toBe('numeric');
      expect(f.type, String(ph)).toBe('text');
    }
    // The words stay words: name, kind and VIN keep the full keyboard.
    for (const ph of [/^Name/, /^Kind/, /^VIN/]) expect(field(c, ph).inputMode, String(ph)).toBe('');
  });

  it('the library\'s skill level (the same 1–10 field as the roster\'s): numeric keyboard', () => {
    const c = pageFn<(s: unknown) => FNode>('libraryComposer', { el, document, disclose, api: () => {} })(el('div'));
    const f = c.all().find((x) => /^Skill level/.test(x.placeholder))!;
    expect(f.inputMode).toBe('numeric');
    expect(f.type).toBe('text');
  });

  it('every number field drawn in the markup carries an inputmode (the yard check)', () => {
    const numberInputs = [...html.matchAll(/<input [^>]*type="number"[^>]*>/g)].map((m) => m[0]);
    expect(numberInputs.length).toBeGreaterThanOrEqual(6);
    for (const i of numberInputs) expect(i, i).toMatch(/inputmode="(?:numeric|decimal)"/);
  });

  it('every field whose placeholder asks for a number sets its keyboard in the same function', () => {
    // A placeholder (set directly, or through a composer's mk()/add()) that is a number, a ZIP, a level, inches or pounds.
    // P18 review: the prep ZIP's hint is "5 digits" (a sample ZIP read like a filled-in value) — still a number field.
    const numeric = /(?:placeholder = |\bmk\(|\badd\('\w+', )'(?:\d+|5 digits|5-digit ZIP|Skill level 1–10|Height in inches \(optional\)|Loaded weight in lbs \(optional\))'/g;
    const found = [...html.matchAll(numeric)];
    expect(found.length).toBe(6); // prep ZIP, work ZIP, roster level, height, weight, library level
    for (const m of found) {
      const at = m.index!;
      const start = html.lastIndexOf('\nfunction ', at) >= html.lastIndexOf('\nasync function ', at) ? html.lastIndexOf('\nfunction ', at) : html.lastIndexOf('\nasync function ', at);
      const body = html.slice(start, html.indexOf('\n}\n', at));
      expect(body, m[0]).toMatch(/inputMode = '(?:numeric|decimal)'/);
    }
  });
});

describe('small text: a 12 px floor, higher contrast on the hero (P2)', () => {
  /** Every font-size in the page's <style>, with the selector it sits in. */
  const sizes = [...css.matchAll(/font-size:([\d.]+)px/g)].map((m) => {
    const open = css.lastIndexOf('{', m.index);
    const sel = css.slice(css.lastIndexOf('}', open) + 1, open).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    return { sel, px: Number(m[1]) };
  });
  // The ones allowed under 12 px, each with its reason (DECISIONS D101).
  const UNDER_12: Record<string, number> = {
    '.brand small': 11.5, // ART-IS-TREE under the name: 11.5 px is the most that keeps it one row at 390 (the plan's number)
    '.hstat span': 10.5, // the hero's three stat labels: contrast raised (.9), not size — three tiles across must not wrap a third line
    '.hstat small': 10.5, // the hero stat's note: the same
    'nav button .dot': 10.5, // the count inside the 18 px badge dot on a dock button
    '.qphoto': 11.5, // the word inside a photo thumbnail while it loads
  };

  it('nothing in the page style is under 12 px except the listed few', () => {
    expect(sizes.length).toBeGreaterThan(50);
    const under = sizes.filter((s) => s.px < 12);
    for (const s of under) expect(UNDER_12[s.sel], `${s.sel} is ${s.px}px`).toBe(s.px);
    expect(under.map((s) => s.sel).sort()).toEqual(Object.keys(UNDER_12).sort());
  });

  it.each(['.eyebrow', '.badge', '.tile span', '.tile small', '.loop-kind', '.field label,#yard label,#bd label', '.cb-label', '.cal-src', '.internal-tag', '.adetail .lab', '.gtile small', 'nav button', '.cal-day.today .cal-daylabel::after'])(
    '%s is at least 12 px', (sel) => {
      const found = sizes.filter((s) => s.sel === sel || s.sel.endsWith('\n' + sel) || s.sel.endsWith(' ' + sel));
      expect(found.length, sel).toBeGreaterThan(0);
      for (const s of found) expect(s.px, sel).toBeGreaterThanOrEqual(12);
    });

  it('.brand small is 11.5 px and still one row (nowrap, ellipsis)', () => {
    expect(css).toMatch(/\.brand small\{[^}]*font-size:11\.5px;[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/);
  });

  it('the hero\'s labels read at .85 alpha or more on the dark green', () => {
    for (const sel of ['.hstat span', '.hstat small']) {
      const rule = new RegExp(`\\n${sel.replace('.', '\\.')}\\{[^}]*color:rgba\\(244,239,224,([\\d.]+)\\)`).exec(css);
      expect(rule, sel).not.toBeNull();
      expect(Number(rule![1]), sel).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('the four feed-dot looks stay distinct: cut/sim grey, not set up amber, couldn\'t read hollow amber', () => {
    expect(css).toContain(".feed-state::before{content:'';position:absolute;left:1px;top:.5em;width:8px;height:8px;border-radius:50%;background:var(--warning);box-sizing:border-box}");
    expect(css).toContain('.feed-state.cut::before,.feed-state.sim::before{background:var(--ink-4)}');
    expect(css).toContain('.feed-state.unread::before{background:none;border:2px solid var(--warning)}');
  });

  it('--ink-4 stays dots-only: never the colour of text', () => {
    const uses = [...css.matchAll(/([\w-]+):[^;{}]*var\(--ink-4\)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const prop of uses) expect(['background', 'box-shadow'], prop).toContain(prop);
  });
});

// ---------- review (UI 2, UI 3): larger text must not cut what it says ----------
describe('the header date is shown whole or not at all — never "WED, OCT 2…" (review UI 2)', () => {
  // P2's 11.5 px cut the day off the date on every non-Today screen at 390
  // ("Wed, Oct 21 · Art-is-Tree" read "WED, OCT 2…" — another day). The date
  // is now one atomic piece (inline-block): a row too narrow for it hides it
  // whole behind the ellipsis. The Back screens' row is spaced tighter so the
  // whole date fits at 390 again.
  type Sub = { textContent: string; parts: Array<string | { className: string; textContent: string }>; replaceChildren: (...xs: Sub['parts']) => void };
  const line = (LINKS: string | null, CUR_TAB: string) => {
    const sub: Sub = {
      textContent: '', parts: [],
      replaceChildren(...xs) { this.parts = xs; this.textContent = xs.map((x) => (typeof x === 'string' ? x : x.textContent)).join(''); },
    };
    pageFn<() => void>('setAppSub', { $: () => sub, el, LINKS, CUR_TAB, APPSUB_DATE: 'Sun, Oct 18' })();
    return sub;
  };

  it('on a dated screen the date is its own .sub-date piece, and the words are unchanged', () => {
    for (const [links, words] of [['cut', 'Sun, Oct 18 · Art-is-Tree'], ['live', 'Sun, Oct 18 · Art-is-Tree'], ['simulation', 'SIMULATION · Sun, Oct 18']] as const) {
      const sub = line(links, 'calls');
      expect(sub.textContent, links).toBe(words);
      const date = sub.parts.filter((x) => typeof x !== 'string');
      expect(date, links).toHaveLength(1);
      expect(date[0], links).toMatchObject({ className: 'sub-date', textContent: 'Sun, Oct 18' });
    }
  });

  it('the date piece is atomic (inline-block), so an ellipsis takes it whole — and never the row\'s first box, which a browser clips instead', () => {
    expect(css).toContain(".brand small .sub-date{display:inline-block}#appsub::before{content:'';display:inline-block}");
  });

  it('the Back screens\' row is spaced .06em (was .14em), so the whole date fits at 390', () => {
    expect(css).toContain('.brand.has-back > span{min-width:0}.brand.has-back small{letter-spacing:.06em}');
  });
});

describe('at 320 px a tile\'s one-word label is never clipped (review UI 3)', () => {
  // P2's 12 px made "ESTIMATES" (Today) and "SCENARIOS" (Learn) wider than a
  // third of a 320 px screen; the tile hides overflow, so the S was cut. Under
  // 360 px the tiles keep 12 px and three across, with less side padding and
  // tracking — the same narrow-screen rule the More grid already has.
  it('the narrow-screen rule trims the tile\'s padding and the label\'s tracking — not its size', () => {
    expect(css).toContain('@media (max-width:359px){.gtile{padding:12px 9px}.gtile b{font-size:15px}.tile{padding:12px 8px 10px}.tile span{letter-spacing:.02em}}');
  });
});

