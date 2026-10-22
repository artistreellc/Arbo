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
  it('is a 44px target, and the header text gives it room', () => {
    const rule = /header \.es-toggle\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/min-height:44px/);
    expect(rule).toMatch(/margin-left:auto/);
    expect(rule).toMatch(/flex:none/);
    expect(css).toContain('header > div{min-width:0}');
  });
  it('the crew door handles a change itself (ES.onChange) — the office app’s plain reload is not its rule', () => {
    expect(crew).toContain('ES.onChange = crewLangChange;');
  });
  it('every panel and the header have a unit; each is marked "en inglés" in Spanish until its unit is translated', () => {
    const src = /^const ES_PLACES = \{[\s\S]*?^\};$/m.exec(crew)?.[0] ?? 'const ES_PLACES = {};';
    const places = new Function(`${src}\nreturn ES_PLACES;`)() as Record<string, string>;
    for (const s of ['header', '#whoami', '#gate-slot', '#quiz', '#work', '#library', '#nearmiss', '.preview-bar']) expect(places[s], s).toMatch(/^crew-[a-z]+$/);
    expect(crew).toContain('esMarkPlaces(ES_PLACES);');
    expect(css).toMatch(/main > div\[data-es-en\]:not\(:empty\)::before\{content:attr\(data-es-en\)/);
  });
});

describe('a change BEFORE sign-off reloads — the gate restarts in the new language', () => {
  const run = async (gate: Record<string, unknown>) => {
    const did: string[] = [];
    const p = lift<{ crewLangChange: (to: string) => Promise<void> }>(['crewLangChange', 'crewRedraw'], {
      GATE: gate, QUIZ: { sending: false }, location: { reload: () => did.push('reload') },
      esSwitchInPlace: (to: string) => did.push('inplace:' + to), paintSigned: () => did.push('paint'),
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
      GATE: gate, QUIZ: { sending: false, done: true, result: null }, location: { reload: () => did.push('reload') },
      esSwitchInPlace: () => did.push('inplace'), paintSigned: () => did.push('paint'), quizLogged: () => did.push('logged'),
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
      GATE: { unlocked: true, sending: false }, QUIZ: { sending: false, done: false, pool: { items: [] }, context: 'clock_in_gate' },
      location: { reload: () => did.push('reload') },
      esSwitchInPlace: (to: string) => did.push('inplace:' + to), paintSigned: () => did.push('paint'), quizLogged: () => did.push('logged'),
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
      GATE: { unlocked: true, sending: false }, QUIZ: { sending: false, done: true, result: res },
      location: { reload: () => did.push('reload') }, esSwitchInPlace: () => {}, paintSigned: () => {},
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
      GATE: { unlocked: true, sending: false }, QUIZ: quiz, location: { reload: () => did.push('reload') },
      esSwitchInPlace: () => did.push('inplace'), paintSigned: () => {}, quizLogged: () => {}, renderQuiz: () => did.push('quiz'),
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
