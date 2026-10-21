/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  Owner instruction from Mike, 2026-08-03. This is not decoration and it
  is not optional. It is here because this is the point in a build where
  things get broken by moving fast, and that already happened to him once
  on the website. It does not happen here.
  ═══════════════════════════════════════════════════════════════════════

  SLOW DOWN. DRASTICALLY. Then:

  1. READ EVERY LINE BEFORE YOU EDIT ONE. Every line, every letter,
     slowly. You are not skimming to find the spot to change — you are
     building a model of what this file already does. If you cannot say
     what the code above and below your edit does, you have not read it.

  2. AN AUDIT IS READ-ONLY. If you were asked to audit, you do not edit.
     You do not "fix it while you are in there." You do not refactor, or
     tidy, or rename. You READ, and you REPORT. Editing during an audit
     is disobeying the instruction, full stop.

  3. THINK BEFORE YOU TYPE. What does this already handle? What depends
     on it? What breaks downstream? Recognise the PATTERN before you call
     something a bug — most things in here that look wrong are a
     deliberate correction. Check docs/OWNER_RULINGS.md first. Use what
     you already know about this codebase instead of re-deciding it.

  4. BRING IT TO MIKE — DO NOT DECIDE IT. Anything that looks wrong,
     ambiguous, or outside what was asked: say it and WAIT. Flagging
     costs one sentence. Deciding on his behalf has cost real work and
     real money more than once.

  5. DO EXACTLY WHAT WAS ASKED. Not the adjacent thing. Not the bigger
     thing you thought of on the way. Not the cleanup. Exactly what was
     asked, and nothing else.

  If you are moving fast right now, you are already off the rails.

  Remember the marker: SLOW::ARBO
*/
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// R35 on the page (Mike, 2026-10-20): "when i select a name in my schedule it
// asks if i want to open google maps and its pre loaded or we just use the
// calender feture alreasy esists". Today's stops sit ABOVE the Google Calendar
// frame, which stays exactly as it is (R2). A tap on a stop opens a sheet that
// asks first; the address goes into a Google Maps link only on that tap.
// vitest has no DOM: page functions are lifted out and run on stand-ins.

const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');

function fnSrc(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
function pageFn<T>(name: string, deps: Record<string, unknown>): T {
  return new Function(...Object.keys(deps), `${fnSrc(name)}\nreturn ${name};`)(...Object.values(deps)) as T;
}

class N {
  className = '';
  textContent = '';
  href = '';
  target = '';
  rel = '';
  type = '';
  id = '';
  children: N[] = [];
  handlers: Array<() => unknown> = [];
  shown = false;
  constructor(readonly tag: string) {}
  get classList() {
    return {
      add: (c: string) => { if (c === 'show') this.shown = true; else this.className += ' ' + c; },
      remove: (c: string) => { if (c === 'show') this.shown = false; },
      contains: (c: string) => (c === 'show' ? this.shown : this.className.split(/\s+/).includes(c)),
    };
  }
  appendChild(c: N): N { this.children.push(c); return c; }
  replaceChildren(...ns: N[]): void { this.children = [...ns]; }
  setAttribute(k: string, v: string): void { (this as unknown as Record<string, string>)[k] = v; }
  addEventListener(_t: string, f: () => unknown): void { this.handlers.push(f); }
  async click(): Promise<void> { for (const h of this.handlers) await h(); }
  all(): N[] { return [this, ...this.children.flatMap((c) => c.all())]; }
  text(): string { return this.all().map((n) => n.textContent).filter(Boolean).join(' | '); }
}
const el = (tag: string, cls?: string, text?: string) => { const n = new N(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const plural = (n: number, one: string, many?: string) => n + ' ' + (n === 1 ? one : (many || one + 's'));
const clock12 = pageFn<(s: string) => string>('clock12', {});
const mapsDirUrl = pageFn<(a: string[]) => string>('mapsDirUrl', {});
const MAPS_STOPS_PER_LINK = Number(/^const MAPS_STOPS_PER_LINK = (\d+);/m.exec(html)![1]);
const mapsLinks = pageFn<(a: string[]) => string[]>('mapsLinks', { mapsDirUrl, MAPS_STOPS_PER_LINK });

function sheetWorld() {
  const nodes = new Map<string, N>();
  const $ = (id: string) => { if (!nodes.has(id)) nodes.set(id, el('div')); return nodes.get(id)!; };
  const steps: string[] = [];
  const deps = { $, el, plural, mapsDirUrl, mapsLinks, MAPS_STOPS_PER_LINK, sheetOpened: (id: string) => steps.push('open:' + id), closeSheet: (id: string) => steps.push('close:' + id) };
  return { $, steps, deps };
}

const STOP = { id: 's1', time: '16:00', allDay: false, title: 'SIM-Alder, Test', city: 'Virginia Beach', address: '101 Simulation Row, Virginia Beach, VA 23451', why: null, plan: { order: 1, start: '16:00', end: '16:20' } };

describe('the Google Maps hand-off', () => {
  it('a stop link is Google’s documented directions URL — address encoded, driving, no key', () => {
    expect(mapsDirUrl(['101 Simulation Row, Virginia Beach, VA 23451'])).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=101%20Simulation%20Row%2C%20Virginia%20Beach%2C%20VA%2023451&travelmode=driving',
    );
    const u = new URL(mapsDirUrl(['A St', 'B St', 'C St']));
    expect(u.searchParams.get('api')).toBe('1');
    expect(u.searchParams.get('destination')).toBe('C St');
    expect(u.searchParams.get('waypoints')).toBe('A St|B St');
    expect(u.searchParams.get('travelmode')).toBe('driving');
  });

  it('the whole day respects the phone’s cap of 3 stops on the way: 6 stops are 2 links, in order', () => {
    expect(MAPS_STOPS_PER_LINK).toBe(4);
    const links = mapsLinks(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']).map((l) => new URL(l));
    expect(links).toHaveLength(2);
    expect(links[0]!.searchParams.get('waypoints')).toBe('a1|a2|a3');
    expect(links[0]!.searchParams.get('destination')).toBe('a4');
    expect(links[1]!.searchParams.get('waypoints')).toBe('a5');
    expect(links[1]!.searchParams.get('destination')).toBe('a6');
  });

  it('a tap asks "Open in Google Maps?" with the name and address; Yes is a plain new-tab link; No closes', async () => {
    const w = sheetWorld();
    const open = pageFn<(s: typeof STOP) => void>('openMapsStop', w.deps);
    open(STOP);
    expect(w.$('maps').classList.contains('show')).toBe(true);
    expect(w.steps).toEqual(['open:maps']);
    const body = w.$('maps-body');
    expect(body.text()).toContain('Open in Google Maps?');
    expect(body.text()).toContain('SIM-Alder, Test');
    expect(body.text()).toContain('101 Simulation Row, Virginia Beach, VA 23451');
    const yes = body.all().find((n) => n.tag === 'a')!;
    expect(yes.href).toBe(mapsDirUrl([STOP.address]));
    expect(yes.target).toBe('_blank');
    expect(yes.rel).toBe('noopener');
    const no = body.all().find((n) => n.tag === 'button')!;
    await no.click();
    expect(w.steps).toEqual(['open:maps', 'close:maps']);
  });

  it('Route the whole day opens the planned order, split and SAID so past the cap', () => {
    const w = sheetWorld();
    const stops = Array.from({ length: 6 }, (_, i) => ({ ...STOP, id: 's' + i, title: 'SIM-' + i, address: i + ' SIM Row, Norfolk, VA 23503' }));
    const openDay = pageFn<(d: unknown) => void>('openMapsDay', w.deps);
    openDay({ stops, plan: { engine: 'tomtom', order: ['s5', 's0', 's1', 's2', 's3', 's4'] } });
    const body = w.$('maps-body');
    const links = body.all().filter((n) => n.tag === 'a');
    expect(links).toHaveLength(2);
    expect(new URL(links[0]!.href).searchParams.get('waypoints')).toBe('5 SIM Row, Norfolk, VA 23503|0 SIM Row, Norfolk, VA 23503|1 SIM Row, Norfolk, VA 23503');
    expect(body.text()).toContain('split into 2 parts');
    expect(links[1]!.textContent).toContain('stops 5–6');
    expect(w.steps).toEqual(['open:maps']);
  });
});

describe('Today’s stops on the Calendar tab', () => {
  function mount(answer: unknown | Error) {
    const box = el('div');
    const opened: unknown[] = [];
    const render = pageFn<() => Promise<void>>('renderTodayStops', {
      $: (id: string) => (id === 'today-stops' ? box : el('div')),
      el, plural, clock12,
      api: async (p: string) => { expect(p).toBe('/api/route/today'); if (answer instanceof Error) throw answer; return answer; },
      feedLine: (_e: unknown, what: string, tail: string) => el('div', 'feed-state unread', what + ': couldn’t read it. ' + tail),
      todayStopRow: pageFn('todayStopRow', { el, clock12, openMapsStop: (s: unknown) => opened.push(s) }),
      openMapsDay: (d: unknown) => opened.push(d),
      // Maps wave A (M1): the header carries a Map button that opens Today's stops on the map.
      todayStopsHead: pageFn('todayStopsHead', { el, openMap: (l: string) => opened.push('map:' + l) }),
      PLAN_LINE_CLASS: new Function(`return ${/^const PLAN_LINE_CLASS = (\{.*\});$/m.exec(html)![1]}`)(),
      TODAY_SEQ: 0,
    });
    return { box, render, opened };
  }
  const OK = {
    state: 'ok', line: null, practice: false, day: '2026-10-21', dayKind: 'weekday', calendarId: 'primary',
    tomtom: { set: false, state: 'not_set', line: 'TomTom not set up — add TOMTOM_API_KEY in Railway.' },
    stops: [STOP, { ...STOP, id: 's2', time: '17:30', title: 'SIM-Cedar call', city: null, address: null, why: 'No address on the event', plan: null }],
    plan: { engine: 'zip', kind: 'estimate', line: 'ZIP estimates — not a mapped route · 1 stop', note: 'SIM note', warnings: ['Plan runs past 8pm (ends 21:30)'], order: ['s1'], driveMinutes: 0 },
  };

  it('the header: "Today’s stops" and a Map button that opens Today on the map — after a read and after a failed one (Maps wave A)', async () => {
    for (const answer of [OK, Object.assign(new Error('x'), { code: 503 })]) {
      const m = mount(answer);
      await m.render();
      const head = m.box.children[0]!;
      expect(head.children[0]!.textContent).toBe('Today’s stops');
      const b = head.children[1]!;
      expect([b.tag, b.type, b.textContent]).toEqual(['button', 'button', 'Map']);
      await b.click();
      expect(m.opened).toEqual(['map:today']);
    }
  });

  it('lists each stop: its time, the event title, the city — a stop with no address says so and has no Maps button', async () => {
    const m = mount(OK);
    await m.render();
    const t = m.box.text();
    expect(t).toContain('Today’s stops');
    expect(t).toContain('4:00 PM');
    expect(t).toContain('SIM-Alder, Test');
    expect(t).toContain('Virginia Beach');
    expect(t).toContain('ZIP estimates');
    expect(t).toContain('TomTom not set up — add TOMTOM_API_KEY in Railway.');
    expect(t).toContain('ends 9:30 PM');
    const rows = m.box.all().filter((n) => n.className.split(' ').includes('cal-ev'));
    expect(rows.map((r) => r.tag)).toEqual(['button', 'div']);
    expect(rows[1]!.text()).toContain('No address on the event');
    expect(rows[1]!.text()).not.toContain('Maps');
    // No address sits in any link until a tap.
    expect(m.box.all().some((n) => n.href)).toBe(false);
    await rows[0]!.click();
    expect(m.opened).toEqual([STOP]);
  });

  it('a calendar Arbo could not read is named in the server’s words — never "nothing on the calendar"', async () => {
    const m = mount({ ...OK, state: 'google_signin', line: "Couldn't read your calendar — Google sign-in needs reconnecting.", stops: [], plan: null });
    await m.render();
    expect(m.box.text()).toContain("Couldn't read your calendar — Google sign-in needs reconnecting.");
    expect(m.box.text()).not.toContain('Nothing on your Google Calendar today');
    const dead = mount(new Error('fetch failed'));
    await dead.render();
    expect(dead.box.text()).toContain('not an empty day');
    expect(dead.box.text()).not.toContain('Nothing on');
  });

  it('only a calendar that WAS read and is empty says nothing is on it', async () => {
    const m = mount({ ...OK, stops: [], plan: null });
    await m.render();
    expect(m.box.text()).toContain('Nothing on your Google Calendar today.');
  });

  it('practice stops say they are practice', async () => {
    const m = mount({ ...OK, state: 'practice', practice: true, plan: { ...OK.plan, kind: 'practice' } });
    await m.render();
    expect(m.box.text()).toContain('Practice stops');
  });
});

describe('review fixes on the page (2026-10-21)', () => {
  it('UI #3 — the whole-day sheet names each stop with an address that is not in the route, and why', () => {
    const w = sheetWorld();
    const openDay = pageFn<(d: unknown) => void>('openMapsDay', w.deps);
    const stops = [
      STOP,
      { ...STOP, id: 's2', title: 'SIM-NoZip', address: '5 SIM Row, Norfolk', why: 'No ZIP in the address — not in the plan', plan: null },
      { ...STOP, id: 's3', title: 'SIM-NoAddr', address: null, why: 'No address on the event', plan: null },
    ];
    openDay({ stops, plan: { engine: 'zip', order: ['s1'] } });
    const body = w.$('maps-body');
    expect(body.text()).toContain('Not in this route');
    expect(body.text()).toContain('SIM-NoZip');
    expect(body.text()).toContain('No ZIP in the address');
    expect(body.text()).not.toContain('SIM-NoAddr'); // nothing to drive to
    expect(body.all().filter((n) => n.tag === 'a')).toHaveLength(1);
  });

  it('UI #4 — a long unbroken title wraps instead of pushing the page sideways', () => {
    expect(html).toMatch(/\.cal-ev \.who\{[^}]*overflow-wrap:anywhere/);
    expect(html).toMatch(/\.cal-ev \.where\{[^}]*overflow-wrap:anywhere/);
  });

  it('rules #2 — an event carried over from an earlier day reads "Ongoing", never a stale clock time', () => {
    const row = pageFn<(s: unknown) => N>('todayStopRow', { el, clock12, openMapsStop: () => {} })({ ...STOP, time: null, ongoing: true, plan: null, why: 'Started on an earlier day — not routed' });
    expect(row.children[0]!.textContent).toBe('Ongoing');
    expect(row.text()).toContain('Started on an earlier day');
  });
});

describe('the Calendar tab keeps its frame (R2) and gains a box above it', () => {
  const cal = fnSrc('renderCalendar');

  it('the box comes first, the frame is built as before, and the box refreshes even when the frame stays', () => {
    const box = cal.indexOf("stops.id = 'today-stops';");
    expect(box).toBeGreaterThan(-1);
    expect(box).toBeLessThan(cal.indexOf("frame.id = 'gcal-frame';"));
    expect(cal).toContain("if (v.querySelector('#gcal-frame')) { renderTodayStops(); return; }");
    expect(cal).toContain('frame.src = gcalEmbedUrl();');
    expect(html).toContain("const GCAL_ID = 'artistreeofvirginia@gmail.com';");
  });

  it('a half-typed planner box (holdsTyping) does not freeze today’s stops: they keep their own minute', () => {
    expect(html).toContain("setInterval(() => { if (!document.hidden && !$('keywall').classList.contains('show') && holdsTyping($('view-cal'))) renderTodayStops(); }, 60000);");
  });

  it('the Maps sheet is a sheet like the others: in SHEETS, X and Back close it', () => {
    expect(html).toContain("const SHEETS = ['twin', 'yard', 'bd', 'talk', 'approval', 'photo', 'maps'];");
    expect(html).toContain('<div id="maps" class="sheet">\n  <div class="sheet-head">\n    <button id="maps-close" aria-label="Close"><svg class="hico" aria-hidden="true"><use href="#i-close"/></svg></button>');
    expect(html).toContain("$('maps-close').addEventListener('click', () => closeSheet('maps'));");
    expect(fnSrc('openMapsStop')).toContain("$('maps').classList.add('show'); sheetOpened('maps');");
    expect(fnSrc('openMapsDay')).toContain("$('maps').classList.add('show'); sheetOpened('maps');");
  });

  it('the route planner names TomTom: its own line when TomTom planned, and why when it did not', () => {
    const planner = fnSrc('routePlannerPanel');
    expect(planner).toContain("plan.mode === 'tomtom_traffic'");
    expect(planner).toContain("'TomTom live traffic \\u00b7 ' + plan.note");
    expect(planner).toContain('plan.tomtom && plan.tomtom.line');
  });

  it('R35 is filed in Mike’s words with its open questions; the steps and the empty variable are where Mike looks', () => {
    const rulings = readFileSync(new URL('../docs/OWNER_RULINGS.md', import.meta.url), 'utf8');
    expect(rulings).toMatch(/^## R35 — TomTom plans the day; tap a stop to open Google Maps \(Mike, 2026-10-20\)$/m);
    const r35 = rulings.slice(rulings.indexOf('## R35 — '));
    expect(r35).toContain('*"and for a route planner intergrate tomtom"*');
    expect(r35).toContain('`primary`');
    for (const open of ['bucket truck and chipper dimensions', '**Sunday.**', '**Start and end:**', '**Privacy page']) expect(r35).toContain(open);
    const steps = readFileSync(new URL('../docs/ROUTE_PLANNER.md', import.meta.url), 'utf8');
    expect(steps).toContain('developer.tomtom.com');
    expect(steps).toContain('`TOMTOM_API_KEY`');
    expect(steps).toContain('Deploy by hand');
    expect(readFileSync(new URL('../.env.example', import.meta.url), 'utf8')).toMatch(/^TOMTOM_API_KEY=$/m);
  });

  it('no developer copy in the new screen code', () => {
    for (const name of ['renderTodayStops', 'todayStopRow', 'openMapsStop', 'openMapsDay']) {
      const src = fnSrc(name);
      expect(src, name).not.toMatch(/'[^'\n]*[a-z]\(s\)[^'\n]*'/i);
      expect(src, name).not.toMatch(/'[^'\n]*\b(clear|cleared|exempt)\b[^'\n]*'/i);
    }
  });
});
