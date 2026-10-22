// Today screen, QA round 3 (package "today-rest": confirmed items 4, 23, 25, 26).
// vitest has no DOM, so the pieces with logic are lifted out of the page and
// run against a small stand-in element; the CSS is pinned as source.
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';

const html = loadAppHtml();
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
/** A one-line `const NAME = …;` from the page, evaluated. */
const pageConst = <T>(name: string): T => {
  const m = new RegExp(`^const ${name} = (.*);(?: //.*)?$`, 'm').exec(html);
  if (!m) throw new Error(`no const ${name} in the page`);
  return new Function(`return (${m[1]});`)() as T;
};

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
const flush = () => new Promise((r) => setTimeout(r, 0));
const FEED_WORD = pageConst<Record<string, string>>('FEED_WORD');
const plural = (n: number, one: string, many?: string) => n + ' ' + (n === 1 ? one : many || one + 's');

describe('#4: a links chip cut on purpose is grey, like every other cut on Today', () => {
  /** The Data links chip after /health answers (or fails). */
  async function linksChip(health: () => Promise<unknown>): Promise<FakeEl> {
    const labels = /^const SYS_LABELS = .*$/m.exec(html)![0];
    const { row } = new Function('el', 'api', 'navigator',
      `${labels}\nlet SYS = null;\n${src('buildSystems')}\nconst row = buildSystems();\nreturn { row };`,
    )(el, health, { onLine: true }) as { row: FakeEl };
    await flush();
    return row.children[0]!;
  }

  it('cut and simulation take the grey cut look; live is green; anything unknown stays amber', async () => {
    const cut = await linksChip(async () => ({ dataLinks: 'cut' }));
    expect(cut.className).toBe('sys cut');
    expect(cut.textContent).toBe('Data links · cut on purpose');
    const sim = await linksChip(async () => ({ dataLinks: 'simulation' }));
    expect(sim.className).toBe('sys cut');
    expect(sim.textContent).toBe('Data links · simulation');
    expect((await linksChip(async () => ({ dataLinks: 'live' }))).className).toBe('sys ok');
    expect((await linksChip(async () => ({ dataLinks: 'unknown' }))).className).toBe('sys warn');
    const dead = await linksChip(async () => { throw new Error('offline'); });
    expect(dead.className).toBe('sys warn');
    expect(dead.textContent).toBe('Data links · unreadable');
  });

  // R32: a switch Mike set on purpose — grey like cut, and worded, never "live".
  it('read-only takes the grey cut look and says "read-only"', async () => {
    const ro = await linksChip(async () => ({ dataLinks: 'readonly' }));
    expect(ro.className).toBe('sys cut');
    expect(ro.textContent).toBe('Data links · read-only');
  });

  it('cut has no rule of its own: the plain grey dot, and it is not pulled to the front', () => {
    expect(html).not.toMatch(/\.sys\.cut\b/);
    expect(html).toContain('.sys i{width:8px;height:8px;border-radius:50%;background:var(--ink-4);');
    expect(html).toContain('.sys.down{order:-2}.sys.warn{order:-1}');
    expect(pageConst<Record<string, string>>('FEED_TONE')).toMatchObject({ cut: 'info', sim: 'info' });
  });
});

describe('#23: links take the forest brand colour, not the off-palette status blue', () => {
  it('stop addresses, permit-desk links and the calendar link are forest', () => {
    expect(html).toContain('.card .addr a{color:var(--forest);text-decoration:none;font-weight:600}');
    expect(html).toContain('.factmeta a{color:var(--forest);font-weight:600;text-decoration:none}');
    expect(html).toContain('.cal-ev .gcal{color:var(--forest);');
    expect(html).not.toMatch(/ a\{color:var\(--info\)/);
    expect(html).not.toMatch(/\.gcal\{color:var\(--info\)/);
  });

  it('the --info token itself stays for the chips that still use it', () => {
    expect(html).toContain('--info:#2461C8');
    expect(html).toContain('.b-review{background:var(--info);color:#fff}');
  });
});

describe('#25: a red stops count says why on its own tile', () => {
  type Hero = { stat: (k: string, v: unknown, c: string, f: string, note?: string) => void };
  const hero = () => {
    const ring = { svg: el('svg'), set: () => {}, clock: () => {} };
    return new Function('el', 'dayRing', 'dayFraction',
      `let HERO = null;\n${src('buildHero')}\nconst box = buildHero();\nreturn { box, HERO };`,
    )(el, () => ring, () => 0.5) as { box: FakeEl; HERO: Hero };
  };

  it('the note sits on the tile under its label, and is empty again when none is given', () => {
    const { box, HERO } = hero();
    const stops = byClass(box, 'hstat')!;
    // b, span, small: the note under its label; then the › tap cue (Direction B P10 review), drawn only while the stat opens something.
    expect(stops.children.map((c) => c.tag)).toEqual(['b', 'span', 'small', 'i']);
    HERO.stat('stops', 2, 'hot', '2 stops today', '1 flagged');
    expect(stops.className).toBe('hstat hot');
    expect(stops.querySelector('span')!.textContent).toBe('stops today');
    expect(stops.querySelector('small')!.textContent).toBe('1 flagged');
    HERO.stat('stops', '–', '', 'schedule cut');
    expect(stops.querySelector('small')!.textContent).toBe('');
    // The subline still names only the dashes; the note never reaches it.
    HERO.stat('loops', 0, '', 'no open loops');
    HERO.stat('alerts', 0, '', 'no weather alerts');
    expect(byClass(box, 'sub')!.textContent).toBe('schedule cut');
  });

  it('the reason is the strongest one, as a count — never a name', () => {
    const line = /^ *(const flagNote = .*;)$/m.exec(html);
    expect(line).not.toBeNull();
    expect(line![1]).not.toMatch(/\.name|\.address|stops\[/);
    const note = (s: { emergencies: number; redFlagCount: number }) =>
      new Function('s', 'plural', `${line![1]}\nreturn flagNote;`)(s, plural) as string;
    expect(note({ emergencies: 0, redFlagCount: 1 })).toBe('1 flagged');
    expect(note({ emergencies: 0, redFlagCount: 3 })).toBe('3 flagged');
    expect(note({ emergencies: 1, redFlagCount: 2 })).toBe('1 emergency');
    expect(note({ emergencies: 2, redFlagCount: 2 })).toBe('2 emergencies');
    expect(note({ emergencies: 0, redFlagCount: 0 })).toBe('');
    // H4: "today" only when the day is really read; Arbo's own bookings say "in Arbo today".
    // R27 Phase A (es-owner-a; pin moved): one sentence per count and source, through tn.
    expect(html).toContain("HERO.stat('stops', s.totalStops, (s.emergencies || s.redFlagCount) ? 'hot' : '', onlyArbo ? tn(s.totalStops, '{n} stop in Arbo today', '{n} stops in Arbo today') : tn(s.totalStops, '{n} stop today', '{n} stops today'), flagNote);");
  });

  it('an empty note takes no room; a hot tile ties its border and note to the red count', () => {
    expect(html).toContain('.hstat small:empty{display:none}');
    expect(html).toContain('.hstat.hot{border-color:rgba(255,160,143,.45)}.hstat.hot small{color:#FFA08F}');
    expect(html).toContain('.hstat.warn b{color:#F2CF73}.hstat.hot b{color:#FFA08F}');
  });
});

const Cap = (x: string): string => x.charAt(0).toUpperCase() + x.slice(1);

describe('#26: in practice mode the Inbox and Website forms cards name the practice data', () => {
  const inbox = (reason: string, links: string | null) => pageFn<() => Promise<FakeEl>>('inboxIntentPanel', {
    el, FEED_WORD, Cap, LINKS_READY: Promise.resolve(links),
    api: async () => ({ pipeline: 'no_gmail', gmailReason: reason }),
  })();
  const forms = (links: string | null) => pageFn<() => Promise<FakeEl>>('websiteFormsPanel', {
    el, FEED_WORD, Cap, LINKS_READY: Promise.resolve(links), api: async () => ({ wired: false, forms: [] }),
  })();

  it('Inbox: practice mode is the grey sim row in the practice words; cut and live keep their wording', async () => {
    const sim = await inbox('no Gmail credentials configured', 'simulation');
    expect(sim.children.map((c) => c.className)).toEqual(['panel-title', 'feed-state sim']);
    expect(sim.children[1]!.textContent).toBe('Not in the practice data — Arbo isn’t reading your Gmail here. That doesn’t mean no mail came in.');
    expect(sim.textContent).not.toContain('isn’t connected');
    for (const links of ['cut', 'live', null]) {
      const off = await inbox('no Gmail credentials configured', links);
      expect(off.children.map((c) => c.className)).toEqual(['panel-title', 'feed-state unset']);
      expect(off.children[1]!.textContent).toBe('Gmail isn’t connected, so Arbo can’t check your inbox. That doesn’t mean no mail came in.');
    }
  });

  it('Inbox: a Gmail read that failed in practice mode is still a failed read, never the practice words', async () => {
    const dead = await inbox('token refresh failed', 'simulation');
    expect(dead.children[1]!.className).toBe('feed-state unread');
    expect(dead.children[1]!.textContent).toContain('Arbo couldn’t read Gmail on its last check.');
  });

  it('Website forms: practice mode is the grey sim row; cut keeps the not-connected line', async () => {
    const sim = await forms('simulation');
    expect(sim.children.map((c) => c.className)).toEqual(['panel-title', 'feed-state sim']);
    expect(sim.children[1]!.textContent).toBe('Not in the practice data. Real ones still arrive in your Gmail inbox.');
    for (const links of ['cut', 'live', null]) {
      const off = await forms(links);
      expect(off.children.map((c) => c.className)).toEqual(['panel-title', 'feed-state unset']);
      expect(off.children[1]!.textContent).toBe('Website forms aren’t connected to Arbo yet. They still arrive in your Gmail inbox.');
    }
  });

  it('the practice words come from the one shared table, and the sim row wears the grey dot', () => {
    expect(src('inboxIntentPanel')).toContain('FEED_WORD.sim');
    expect(src('websiteFormsPanel')).toContain('FEED_WORD.sim');
    expect(html).toContain('.feed-state.cut::before,.feed-state.sim::before{background:var(--ink-4)}');
  });
});
