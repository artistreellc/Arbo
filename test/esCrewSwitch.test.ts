// R27 (D110) — the crew door's language toggle (docs/R27_SPANISH_PLAN.md,
// "The switch"): a header toggle on every screen, the door-key screen
// included, remembered as arboCrewLang (never the office app's arboLang).
// Before the day's briefing is signed, a change reloads and the gate restarts
// (scroll, tick and timer) in the new language. AFTER sign-off it redraws the
// work orders, the library and the quiz in place and never reloads — a reload
// would re-lock the day and could write a second paid sign-off.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const crew = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');
const css = crew.slice(crew.indexOf('<style>'), crew.indexOf('</style>'));
const fnSrc = (name: string): string => {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(crew);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
};
const lift = <T,>(names: string[], deps: Record<string, unknown>): T =>
  new Function(...Object.keys(deps), `${names.map(fnSrc).join('\n')}\nreturn { ${names.join(', ')} };`)(...Object.values(deps)) as T;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

class N {
  kids: N[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  classList = { add: (c: string) => { if (!this.className.split(' ').includes(c)) this.className = (this.className + ' ' + c).trim(); }, remove: (c: string) => { this.className = this.className.split(' ').filter((x) => x !== c).join(' '); }, toggle: () => {} };
  disabled = false; id = ''; value = ''; placeholder = ''; autocomplete = ''; href = ''; target = ''; rel = '';
  constructor(public tag: string, public className = '', public textContent = '') {}
  appendChild(k: N): N { this.kids.push(k); return k; }
  insertBefore(k: N, ref: N): N { this.kids.splice(Math.max(0, this.kids.indexOf(ref)), 0, k); return k; }
  replaceChildren(): void { this.kids = []; }
  addEventListener(t: string, f: () => void): void { this.listeners[t] = f; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  querySelector(sel: string): N | null { return this.all().find((n) => '.' + n.className === sel) ?? null; }
  querySelectorAll(sel: string): N[] { return this.all().filter((n) => n.className.split(' ').includes(sel.replace(/^\./, ''))); }
  all(): N[] { return this.kids.flatMap((k) => [k, ...k.all()]); }
  text(): string { return [this.textContent, ...this.kids.map((k) => k.text())].filter(Boolean).join(' '); }
}
const el = (tag: string, cls?: string, text?: string) => new N(tag, cls ?? '', text ?? '');
const doc = { createElement: (t: string) => new N(t), createTextNode: (t: string) => new N('#text', '', t), querySelector: () => new N('main') };

describe('the header toggle — on every screen, the door-key screen included', () => {
  it('is put in the header at boot, before the door answers, so the key screen has it too', () => {
    const at = crew.indexOf("document.querySelector('header').appendChild(esToggleButton('es-toggle'));");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(crew.indexOf('if (renderWhoAmI()) {'));
    // The header is outside <main>, so main.door-locked (the door-key card) never hides it.
    expect(crew).toMatch(/<\/header>\n<main>/);
  });
  it('is a 44px target that sits OUT of the header’s flow, so the English header keeps its height (review round, UI 2)', () => {
    const rule = /header \.es-toggle\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/min-height:44px/);
    expect(rule).toMatch(/position:absolute/);
    expect(rule).toMatch(/right:16px/);
    // The pill is drawn 5px inside the 44px target, so it spans the brand line and never the date line.
    expect(css).toMatch(/header \.es-toggle::before\{[^}]*inset:5px 0/);
    // Nothing else in the header changes: the date line is not squeezed (it was, at 320px).
    expect(css).not.toContain('header > div{min-width:0}');
    expect(rule).not.toMatch(/margin-left:auto|flex:none/);
  });
  it('the crew door handles a change itself (ES.onChange) — the office app’s plain reload is not its rule', () => {
    expect(crew).toContain('ES.onChange = crewLangChange;');
  });
  it('every panel and the header have a unit; each is marked "en inglés" in Spanish until its unit is translated', () => {
    const src = /^const ES_PLACES = \{[\s\S]*?^\};$/m.exec(crew)?.[0] ?? 'const ES_PLACES = {};';
    const places = new Function(`${src}\nreturn ES_PLACES;`)() as Record<string, string>;
    for (const s of ['header', '#whoami', '#gate-slot', '#quiz', '#work', '#library', '#nearmiss', '.preview-bar']) expect(places[s], s).toMatch(/^crew-[a-z]+$/);
    expect(crew).toContain('esMarkPlaces(ES_PLACES);');
    // Review round (UI 3): ONE mark for the page, at the top of <main> — never one per panel,
    // where each sat under the card above it and read as that card's label.
    expect(css).toMatch(/main\[data-es-en\]::before\{content:attr\(data-es-en\)/);
    expect(css).not.toMatch(/main > div\[data-es-en\][^{]*::before/);
  });
});

describe('a change BEFORE sign-off reloads — the gate restarts in the new language', () => {
  const run = async (gate: Record<string, unknown>) => {
    const did: string[] = [];
    const p = lift<{ crewLangChange: (to: string) => Promise<void> }>(['crewLangChange', 'crewRedraw'], {
      GATE: gate, QUIZ: { sending: false }, NM: { sending: false }, location: { reload: () => did.push('reload') },
      esSwitchInPlace: (to: string) => did.push('inplace:' + to), crewEsMark: () => {}, paintSigned: () => did.push('paint'),
      renderQuiz: () => did.push('quiz'), renderWork: () => did.push('work'), renderLibrary: () => did.push('library'),
      libSearch: () => did.push('lib'), $: () => null,
    });
    await p.crewLangChange('es');
    return did;
  };
  it('the gate still locked: reload, nothing redrawn in place', async () => {
    expect(await run({ unlocked: false, sending: false })).toEqual(['reload']);
  });
  it('the door-key screen (nothing signed, door locked): reload', async () => {
    expect(await run({ unlocked: false, sending: false, content: null })).toEqual(['reload']);
  });
  it('a sign-off on its way is waited for: refused → reload; signed → redraw in place, never a reload', async () => {
    const gate = { unlocked: false, sending: true };
    const did: string[] = [];
    const p = lift<{ crewLangChange: (to: string) => Promise<void> }>(['crewLangChange', 'crewRedraw'], {
      GATE: gate, QUIZ: { sending: false, done: true, result: null }, NM: { sending: false }, location: { reload: () => did.push('reload') },
      esSwitchInPlace: () => did.push('inplace'), crewEsMark: () => {}, paintSigned: () => did.push('paint'), quizLogged: () => did.push('logged'),
      renderQuiz: () => did.push('quiz'), renderWork: Object.assign(() => did.push('work'), { lastDay: null }), renderLibrary: () => did.push('library'),
      libSearch: Object.assign(() => did.push('lib'), { last: null }), $: () => null,
    });
    const pending = p.crewLangChange('es');
    await tick(150);
    expect(did).toEqual([]); // nothing while the answer is out
    gate.sending = false;
    gate.unlocked = true; // the server signed it
    await pending;
    expect(did).not.toContain('reload');
    expect(did[0]).toBe('inplace');
  });
});

describe('a change AFTER sign-off redraws in place — no reload, no read, no second sign-off', () => {
  it('repaints the signed gate, the quiz, the work orders and the library from what the phone already read', async () => {
    const did: string[] = [];
    const calls: string[] = [];
    const day = { workOrders: [], notWorkOrders: 0, contractLookupFailed: false };
    const lib = new N('input'); lib.value = 'rigging a heav';
    const p = lift<{ crewLangChange: (to: string) => Promise<void> }>(['crewLangChange', 'crewRedraw'], {
      GATE: { unlocked: true, sending: false }, QUIZ: { sending: false, done: false, pool: { items: [] }, context: 'clock_in_gate' }, NM: { sending: false },
      location: { reload: () => did.push('reload') },
      esSwitchInPlace: (to: string) => did.push('inplace:' + to), crewEsMark: () => {}, paintSigned: () => did.push('paint'), quizLogged: () => did.push('logged'),
      renderQuiz: (ctx: string, kept: boolean) => did.push(`quiz:${ctx}:${kept}`),
      renderWork: Object.assign((kept: unknown) => did.push('work:' + (kept === day)), { lastDay: day }),
      renderLibrary: () => did.push('library'),
      libSearch: Object.assign((q: string, _o: unknown, _b: unknown, kept: unknown) => did.push(`lib:${q}:${Boolean(kept)}`), { last: { q: 'rigging', res: { entries: [] } } }),
      $: (id: string) => (id === 'lib-q' ? lib : new N('div')),
      api: (path: string, o?: { method?: string }) => { calls.push(((o && o.method) || 'GET') + ' ' + path); return Promise.resolve({}); },
    });
    await p.crewLangChange('es');
    expect(did).toEqual(['inplace:es', 'paint', 'quiz:clock_in_gate:true', 'work:true', 'library', 'lib:rigging:true']);
    expect(did).not.toContain('reload');
    expect(calls).toEqual([]);
    expect(lib.value).toBe('rigging a heav'); // typed text survives the redraw
  });

  it('an answered quiz redraws its logged card, never the questions', async () => {
    const did: string[] = [];
    const res = { payableMinutes: 2 };
    const p = lift<{ crewLangChange: (to: string) => Promise<void> }>(['crewLangChange', 'crewRedraw'], {
      GATE: { unlocked: true, sending: false }, QUIZ: { sending: false, done: true, result: res }, NM: { sending: false },
      location: { reload: () => did.push('reload') }, esSwitchInPlace: () => {}, crewEsMark: () => {}, paintSigned: () => {},
      quizLogged: (_v: unknown, r: unknown) => did.push('logged:' + (r === res)), renderQuiz: () => did.push('quiz'),
      renderWork: Object.assign(() => {}, { lastDay: null }), renderLibrary: () => {}, libSearch: Object.assign(() => {}, { last: null }), $: () => new N('div'),
    });
    await p.crewLangChange('en');
    expect(did).toEqual(['logged:true']);
  });

  it('a quiz answer on its way is waited for — a redraw never offers a second Submit while one is out', async () => {
    const did: string[] = [];
    const quiz = { sending: true, done: false, pool: null, context: 'clock_in_gate' };
    const p = lift<{ crewLangChange: (to: string) => Promise<void> }>(['crewLangChange', 'crewRedraw'], {
      GATE: { unlocked: true, sending: false }, QUIZ: quiz, NM: { sending: false }, location: { reload: () => did.push('reload') },
      esSwitchInPlace: () => did.push('inplace'), crewEsMark: () => {}, paintSigned: () => {}, quizLogged: () => {}, renderQuiz: () => did.push('quiz'),
      renderWork: Object.assign(() => {}, { lastDay: null }), renderLibrary: () => {}, libSearch: Object.assign(() => {}, { last: null }), $: () => new N('div'),
    });
    const pending = p.crewLangChange('es');
    await tick(150);
    expect(did).toEqual([]);
    quiz.sending = false;
    await pending;
    expect(did).toEqual(['inplace', 'quiz']);
  });
});

describe('the page’s own drawing, redrawn from memory', () => {
  const WO = { jobId: 'sim-job-1', routeOrder: 1, address: '101 Simulation Row', city: 'Virginia Beach', timeIso: '2026-10-21T13:00:00Z', scope: 'SIMULATED — remove leaning pine', hazards: [], permitNote: null, requiresBeforeAfterPhotos: true };
  const workDeps = (v: N, api: () => Promise<unknown>) => ({
    $: () => v, el, document: doc, api, GATE: { unlocked: true }, PREVIEW: false, PREVIEW_WHY: '', CREW_ID: 'x', fmtTime: () => '9:00 AM',
    arrivalButton: () => el('div'), changeOrderButton: () => el('div'), crewMapsUrl: () => 'https://www.google.com/maps/dir/?api=1&destination=x',
    LINKS_READY: Promise.resolve(), crewWhy: () => 'why', doorKeyChanged: () => {},
  });
  it('renderWork keeps the day it read, and redraws it from memory with no read at all', async () => {
    const v = new N('div');
    const day = { workOrders: [WO], notWorkOrders: 0, contractLookupFailed: false };
    const { renderWork } = lift<{ renderWork: ((kept?: unknown) => Promise<void>) & { lastDay?: unknown } }>(['renderWork'], workDeps(v, async () => day));
    await renderWork();
    expect(renderWork.lastDay).toBe(day);
    const first = v.text();
    const { renderWork: again } = lift<{ renderWork: (kept?: unknown) => Promise<void> }>(['renderWork'], workDeps(v, async () => { throw new Error('a redraw must not read'); }));
    await again(day);
    expect(v.text()).toBe(first);
    expect(v.text()).toContain('101 Simulation Row');
  });

  it('renderQuiz redraws the questions it already read, the picked answer still picked, the start time unchanged', async () => {
    const v = new N('div');
    const q = { itemsLoaded: true, shortfall: 0, items: [{ id: 'q1', topic: 'Rigging', type: 'quiz_question', prompt: 'SIM question?', options: ['A', 'B'], readOnly: false }] };
    const QUIZ = { startedAt: '2026-10-22T11:00:00.000Z', items: q.items, answers: { q1: 1 }, done: false, context: 'clock_in_gate', pool: q };
    const { renderQuiz } = lift<{ renderQuiz: (ctx?: string, kept?: boolean) => Promise<void> }>(['renderQuiz'], {
      $: (id: string) => (id === 'quiz' ? v : v.all().find((n) => n.id === id) ?? null), el, document: doc,
      api: async () => { throw new Error('a redraw must not read'); }, GATE: { unlocked: true }, QUIZ,
      QUIZ_TITLE: { clock_in_gate: 'Question before you roll' }, isFridayEt: () => false, CREW_ID: 'x', submitQuiz: () => {},
      LINKS_READY: Promise.resolve(), crewWhy: () => 'why', doorKeyChanged: () => {},
    });
    await renderQuiz('clock_in_gate', true);
    expect(v.text()).toContain('SIM question?');
    expect(QUIZ.startedAt).toBe('2026-10-22T11:00:00.000Z');
    expect(QUIZ.answers).toEqual({ q1: 1 });
    const opts = v.all().filter((n) => n.className.split(' ').includes('qopt'));
    expect(opts.map((o) => o.className)).toEqual(['qopt', 'qopt picked']);
  });

  it('the logged card is one function, drawn the same way after Submit and after a redraw', () => {
    const v = new N('div');
    const { quizLogged } = lift<{ quizLogged: (v: N, r: unknown) => void }>(['quizLogged'], { el });
    quizLogged(v, { payableMinutes: 3, gradedOk: true, score: 1, correct: 1, answered: 1, duplicate: false });
    expect(v.text()).toBe('Logged 3 min paid — on the clock. 1 of 1 correct.');
    expect(fnSrc('submitQuiz')).toContain('QUIZ.result = res;');
    expect(fnSrc('submitQuiz')).toContain("quizLogged($('quiz'), res);");
  });

  it('a quiz answer on its way is marked, so a redraw waits for it', () => {
    const s = fnSrc('submitQuiz');
    expect(s.indexOf('QUIZ.sending = true;')).toBeLessThan(s.indexOf("api('/api/crew/quiz/complete'"));
    expect((s.match(/QUIZ\.sending = false;/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('libSearch redraws the last answer from memory with no lookup', async () => {
    const out = new N('div');
    const btn = new N('button');
    const { libSearch } = lift<{ libSearch: ((q: string, o: N, b: N, kept?: unknown) => Promise<void>) & { last?: unknown } }>(['libSearch', 'libEntry'], {
      el, api: async () => { throw new Error('a redraw must not read'); }, CREW_ID: 'x', LINKS_READY: Promise.resolve(), crewWhy: () => 'why', doorKeyChanged: () => {},
    });
    const res = { entries: [{ techniqueName: 'SIM rigging', howTo: 'SIM how', pros: [], cons: [], wontWorkWhen: 'SIM limit', standardRefs: [] }] };
    await libSearch('rigging', out, btn, res);
    expect(out.text()).toContain('SIM rigging');
    expect(libSearch.last).toEqual({ q: 'rigging', res });
  });

  it('the signed gate is repainted by one function; showSigned keeps what it said', () => {
    const s = fnSrc('showSigned');
    expect(s).toContain('GATE.signed = { at: signedAtIso, line };');
    expect(s).toContain('paintSigned();');
    expect(s.indexOf('paintSigned();')).toBeLessThan(s.indexOf('renderQuiz();'));
    const p = fnSrc('paintSigned');
    expect(p).toContain("head.textContent = 'Briefing acknowledged — logged';");
    expect(p).toContain("go.textContent = 'DAY UNLOCKED ✓';");
  });
});

describe('two quiz draws never stack — the newest owns the panel', () => {
  it('a language change while the first read is still out: the late first answer draws nothing', async () => {
    const v = new N('div');
    let release: (q: unknown) => void = () => {};
    const slow = new Promise((r) => { release = r; });
    const q = { itemsLoaded: true, shortfall: 0, items: [{ id: 'q1', topic: 'Rigging', type: 'quiz_question', prompt: 'SIM question?', options: ['A', 'B'], readOnly: false }] };
    let reads = 0;
    const QUIZ = { done: false, items: [], answers: {}, context: 'clock_in_gate', pool: null as unknown };
    const { renderQuiz } = lift<{ renderQuiz: (ctx?: string, kept?: boolean) => Promise<void> }>(['renderQuiz'], {
      $: (id: string) => (id === 'quiz' ? v : v.all().find((n) => n.id === id) ?? null), el, document: doc,
      api: async () => { reads += 1; return reads === 1 ? slow : q; }, GATE: { unlocked: true }, QUIZ,
      QUIZ_TITLE: { clock_in_gate: 'Question before you roll' }, isFridayEt: () => false, CREW_ID: 'x', submitQuiz: () => {},
      LINKS_READY: Promise.resolve(), crewWhy: () => 'why', doorKeyChanged: () => {},
    });
    const first = renderQuiz();
    await renderQuiz(undefined, true); // the redraw: no pool yet, so it reads — and draws
    release(q);
    await first;
    expect(v.all().filter((n) => n.className === 'qprompt')).toHaveLength(1);
    expect(reads).toBe(2);
  });
});

// ── Review round (D110) ─────────────────────────────────────────────────────

// Correctness #1: the library kept only its last SUCCESS, so a language change
// put an older answer under the newer words and the named failure vanished.
describe('review round — the library redraws exactly what it last had, a failure included', () => {
  const libDeps = (api: () => Promise<unknown>) => ({ el, api, CREW_ID: 'x', LINKS_READY: Promise.resolve(), crewWhy: () => 'the office data link is cut on purpose', doorKeyChanged: () => {} });
  it('a failed lookup is kept as a failure, and a redraw says it again — never the older answer, never a read', async () => {
    let reads = 0;
    const ok = { entries: [{ techniqueName: 'SIM Rigging a heavy limb', howTo: 'SIM how', pros: [], cons: [], wontWorkWhen: 'SIM limit', standardRefs: [] }] };
    const { libSearch } = lift<{ libSearch: ((q: string, o: N, b: N, kept?: unknown, keptErr?: unknown) => Promise<void>) & { last?: { q: string; res?: unknown; err?: unknown } } }>(['libSearch', 'libEntry'], libDeps(async () => {
      reads += 1;
      if (reads === 1) return ok;
      throw Object.assign(new Error('link_cut'), { code: 503 });
    }));
    await libSearch('rigging a heavy limb', new N('div'), new N('button'));
    const out = new N('div');
    await libSearch('felling a dead pine', out, new N('button'));
    expect(out.text()).toMatch(/Library: the office data link is cut on purpose/);
    expect(libSearch.last!.q).toBe('felling a dead pine');
    expect(libSearch.last!.res).toBeUndefined();
    expect(libSearch.last!.err).toBeTruthy();
    const again = new N('div');
    await libSearch(libSearch.last!.q, again, new N('button'), libSearch.last!.res, libSearch.last!.err);
    expect(again.text()).toBe(out.text());
    expect(again.text()).not.toContain('SIM Rigging');
    expect(reads).toBe(2);
  });
  it('crewRedraw hands the kept failure back with its own words', async () => {
    const did: string[] = [];
    const err = Object.assign(new Error('link_cut'), { code: 503 });
    const p = lift<{ crewLangChange: (to: string) => Promise<void> }>(['crewLangChange', 'crewRedraw'], {
      GATE: { unlocked: true, sending: false }, QUIZ: { sending: false, done: true, result: null }, NM: { sending: false },
      location: { reload: () => did.push('reload') }, esSwitchInPlace: () => {}, crewEsMark: () => {}, paintSigned: () => {}, quizLogged: () => {}, renderQuiz: () => {},
      renderWork: Object.assign(() => {}, { lastDay: null }), renderLibrary: () => {},
      libSearch: Object.assign((q: string, _o: unknown, _b: unknown, kept: unknown, keptErr: unknown) => did.push(`lib:${q}:${kept === undefined}:${keptErr === err}`), { last: { q: 'felling a dead pine', err } }),
      $: () => new N('input'),
    });
    await p.crewLangChange('es');
    expect(did).toEqual(['lib:felling a dead pine:true:true']);
  });
  it('a lookup still on its way is waited for, so its answer is what the redraw shows', async () => {
    const did: string[] = [];
    const libSearch = Object.assign(() => did.push('lib'), { last: null as unknown, pending: 1 });
    const p = lift<{ crewLangChange: (to: string) => Promise<void> }>(['crewLangChange', 'crewRedraw'], {
      GATE: { unlocked: true, sending: false }, QUIZ: { sending: false, done: true, result: null }, NM: { sending: false },
      location: { reload: () => did.push('reload') }, esSwitchInPlace: () => did.push('inplace'), crewEsMark: () => {}, paintSigned: () => {}, quizLogged: () => {}, renderQuiz: () => {},
      renderWork: Object.assign(() => {}, { lastDay: null }), renderLibrary: () => {}, libSearch, $: () => new N('input'),
    });
    const pending = p.crewLangChange('es');
    await tick(150);
    expect(did).toEqual([]);
    libSearch.pending = 0;
    libSearch.last = { q: 'felling', res: { entries: [] } };
    await pending;
    expect(did).toEqual(['inplace', 'lib']);
  });
  it('a lookup marks itself while it is out, and unmarks on an answer or a failure', () => {
    const src = fnSrc('libSearch');
    expect(src).toMatch(/libSearch\.pending = \(libSearch\.pending \|\| 0\) \+ 1;/);
    expect((src.match(/libSearch\.pending -= 1;/g) ?? []).length).toBe(2);
    expect(src).toContain('libSearch.last = { q, err: e };');
  });
});

// Correctness #4: before sign-off a change reloads — and reloaded straight over
// a near-miss report: the typed words were lost, and a report just sent lost
// its "Filed", so the crew could not tell whether it went in.
describe('review round — a change before sign-off never reloads over a near-miss report', () => {
  const run = async (o: { typed?: string; nm?: { sending: boolean }; release?: (nm: { sending: boolean }, box: N) => void } = {}) => {
    const did: string[] = [];
    const box = new N('textarea'); box.value = o.typed ?? '';
    const nm = o.nm ?? { sending: false };
    const p = lift<{ crewLangChange: (to: string) => Promise<void> }>(['crewLangChange', 'crewRedraw'], {
      GATE: { unlocked: false, sending: false }, QUIZ: { sending: false }, NM: nm, NM_HOLD: { typed: 'TYPED', sent: 'SENT' },
      location: { reload: () => did.push('reload') }, esSwitchInPlace: () => did.push('inplace'), crewEsMark: () => {},
      crewLangHold: (line: string) => did.push('hold:' + line), libSearch: Object.assign(() => {}, { pending: 0 }),
      $: (id: string) => (id === 'nm-desc' ? box : null),
    });
    const pending = p.crewLangChange('es');
    if (o.release) { await tick(150); expect(did).toEqual([]); o.release(nm, box); }
    await pending;
    return did;
  };
  it('typed and not sent: held, with the words kept — no reload', async () => {
    expect(await run({ typed: 'limb swung toward the truck' })).toEqual(['hold:TYPED']);
  });
  it('only spaces typed: nothing to lose, so it reloads', async () => {
    expect(await run({ typed: '   ' })).toEqual(['reload']);
  });
  it('sent and still out: waited for; filed (box cleared) → held so the crew reads "Filed"', async () => {
    expect(await run({ typed: 'x', nm: { sending: true }, release: (nm, box) => { box.value = ''; nm.sending = false; } })).toEqual(['hold:SENT']);
  });
  it('sent and still out: waited for; failed (words still in the box) → held on the words', async () => {
    expect(await run({ typed: 'x', nm: { sending: true }, release: (nm) => { nm.sending = false; } })).toEqual(['hold:TYPED']);
  });
  it('nothing typed, nothing out: the plain reload', async () => {
    expect(await run()).toEqual(['reload']);
  });
  it('the hold puts the stored choice back and says why in both languages, at the report', () => {
    const src = fnSrc('crewLangHold');
    expect(src).toContain('esKeepLang();');
    expect(src).toMatch(/esNotice\(line, 'es-hold'\)/);
    expect(src).toContain("$('nm-card')");
    expect(css).toMatch(/\.es-hold/);
  });
  it('a near-miss send marks itself while it is out (set before the POST, cleared in finally)', () => {
    const src = fnSrc('renderNearMiss');
    expect(src.indexOf('NM.sending = true;')).toBeGreaterThan(0);
    expect(src.indexOf('NM.sending = true;')).toBeLessThan(src.indexOf("api('/api/crew/near-miss'"));
    expect(src).toMatch(/finally \{\n\s*NM\.sending = false;/);
  });
  it('the hold lines are usted, pass the ban list and every gate, and keep the glossary’s "casi accidente (near miss)"', async () => {
    const { findBannedEs } = await import('../src/i18n/banList.js');
    const { esGateProblems } = await import('../src/i18n/gates.js');
    const m = /^const NM_HOLD = (\{[\s\S]*?^\});$/m.exec(crew);
    expect(m).not.toBeNull();
    const lines = new Function(`return ${m![1]};`)() as Record<string, { es: string; en: string }>;
    for (const [k, l] of Object.entries(lines)) {
      expect(findBannedEs(l.es), k).toEqual([]);
      expect(esGateProblems(l.en, l.es), k).toEqual([]);
      expect(l.es, k).toContain('casi accidente (near miss)');
    }
  });
});

// UI 3: one "en inglés" mark for the page, at the top of <main>, the office app's one per screen.
describe('review round — one "en inglés" mark for the crew page, not one per panel', () => {
  const page = () => {
    const kids = ['whoami', 'gate-slot', 'quiz'].map((id) => { const d = new N('div'); d.id = id; return d; });
    const main = new N('main');
    for (const k of kids) main.appendChild(k);
    Object.assign(main, {
      removeAttribute: (k: string) => { delete main.attrs[k]; },
      getAttribute: (k: string) => main.attrs[k] ?? null,
      querySelector: (sel: string) => (sel === ':scope > [data-es-en]' ? kids.find((k) => 'data-es-en' in k.attrs) ?? null : null),
    });
    for (const k of kids) Object.assign(k, { getAttribute: (a: string) => k.attrs[a] ?? null });
    return { main, kids };
  };
  it('the page mark follows the panels: on while any panel is English in Spanish mode, off when none is', () => {
    const { main, kids } = page();
    const { crewEsMark } = lift<{ crewEsMark: () => void }>(['crewEsMark'], { document: { querySelector: () => main } });
    kids[1]!.attrs['data-es-en'] = 'en inglés';
    crewEsMark();
    expect(main.attrs['data-es-en']).toBe('en inglés');
    delete kids[1]!.attrs['data-es-en'];
    crewEsMark();
    expect(main.attrs['data-es-en']).toBeUndefined();
  });
  it('is set at boot and again after an in-place change', () => {
    expect(crew.indexOf('crewEsMark();', crew.indexOf('esMarkPlaces(ES_PLACES);'))).toBeGreaterThan(0);
    expect(fnSrc('crewLangChange')).toMatch(/esSwitchInPlace\(to\);\n\s*crewEsMark\(\);/);
  });
});
