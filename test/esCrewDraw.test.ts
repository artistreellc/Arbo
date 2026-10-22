// R27 Phase A unit 1 (D111) — the crew door drawn in Spanish. The page's own
// functions run over the REAL runtime (src/app/i18n/runtime.js) and the crew
// dictionary exactly as the server serves it (loadDoorDictionary('crew'): the
// unreviewed safety lines held back), on a small fake DOM.
//
// What it proves, per the plan and R27:
//   - every screen says its words in Spanish (usted), and every failure still
//     names the failure (§1B) — in Spanish;
//   - data passes through as written: names, addresses, scope, the office's
//     briefing and quiz items (Spanish only as a served, reviewed twin);
//   - a safety line (the stop-work order, a hazard, a permit note) shows the
//     Spanish over the FULL English once its review is recorded — and until
//     then the English, marked "en inglés" (never a blank, never unreviewed Spanish);
//   - quiz answers stay keyed by position, whatever language drew them;
//   - after sign-off a change redraws every panel in place: no read, no send.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadI18n, FakeNode, type I18n } from './support/i18nRuntime.js';
import { loadDoorDictionary } from '../src/i18n/dictionaries.js';
import { readTwinTable } from '../src/i18n/serverTwins.js';
import { pairSha, type LedgerEntry } from '../src/i18n/ledger.js';
import { buildCrewPayload, crewPayloadTwins, CREW_LINES, type WorkOrderSource } from '../src/crew/workOrder.js';
import { briefingTwin, quizTwin, quizEnSha } from '../src/i18n/dataTwins.js';
import { enSha } from '../src/i18n/twin.js';

const crew = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');
const fnSrc = (name: string): string => {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(crew);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
};
const objSrc = (name: string): string => {
  // A one-line const first: the many-line pattern would run on to the next const's closing brace.
  const m = new RegExp(`^const ${name} = [^\\n]*;$`, 'm').exec(crew) ?? new RegExp(`^const ${name} = \\{[\\s\\S]*?^\\};$`, 'm').exec(crew);
  if (!m) throw new Error(`no const ${name} in the page`);
  return m[0];
};
const SERVED = loadDoorDictionary('crew');
const DICT: Record<string, string> = Object.assign({}, ...Object.values(SERVED.units));
const ORDER_LOCKED = 'Your work orders stay locked — do not start work; call the office to log your briefing.';
const ORDER = 'Do not start work — call the office.';
const raw = (unit: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../src/app/i18n/${unit}.es.json`, import.meta.url), 'utf8'));
/** The dictionary as it will be served once the stop-work orders' reviews are recorded (nothing else changes). */
const REVIEWED_UNITS = { ...SERVED.units, 'crew-gate': raw('crew-gate'), 'crew-work': raw('crew-work') };

const PANELS = ['dateline', 'whoami', 'gate-slot', 'quiz', 'work', 'library', 'nearmiss'];
const CODE = 'c0de0000-0000-4000-8000-00000000000a';
function runtime(lang: 'en' | 'es', units = SERVED.units): I18n {
  const extra = PANELS.map((id) => { const n = new FakeNode('div'); n.id = id; return n; });
  return loadI18n({ door: 'crew', units, stored: lang === 'es' ? { arboCrewLang: 'es' } : {}, extra });
}

const FNS = ['crewWhy', 'fmtTime', 'renderGate', 'secondsOnScreen', 'refreshGate', 'signedWords', 'showSigned', 'paintSigned', 'submitGate',
  'isFridayEt', 'renderQuiz', 'submitQuiz', 'quizSaveErr', 'quizLogged', 'renderWork', 'crewMapsUrl', 'arrivalButton', 'changeOrderButton',
  'renderLibrary', 'libSearch', 'libEntry', 'renderNearMiss', 'nmSay', 'nmCategory', 'renderWhoAmI', 'checkWho', 'renderDoorKey',
  'doorKeyChanged', 'crewWords', 'paintDateline', 'crewRedraw'];
const CONSTS = ['GATE', 'GATE_NEED', 'QUIZ', 'QUIZ_TITLE', 'NM'];
type Page = Record<string, any> & { calls: Array<{ method: string; path: string; body?: any }> }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The crew page's own functions, lifted over the runtime `rt` and its DOM. `answer` is the server. */
function page(rt: I18n, answer: (method: string, path: string, body?: unknown) => unknown, o: { links?: string } = {}): Page {
  const calls: Page['calls'] = [];
  const api = async (path: string, opts?: { method?: string; body?: unknown }) => {
    const method = (opts && opts.method) || 'GET';
    calls.push({ method, path, body: opts?.body });
    return answer(method, path, opts?.body);
  };
  const doc = rt.doc;
  const el = (tag: string, cls?: string, text?: string) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const deps: Record<string, unknown> = {
    T: rt.T, tf: rt.tf, tn: rt.tn, esSay: rt.esSay, esSayPick: rt.esSayPick, esSayTwin: rt.esSayTwin, esEnMark: rt.esEnMark,
    esLocale: rt.esLocale, ES: rt.ES, document: doc, $: (id: string) => doc.getElementById(id), el, api,
    LINKS: o.links ?? 'simulation', LINKS_READY: Promise.resolve(), CREW_ID: CODE, PREVIEW: false, PREVIEW_WHY: rt.T('Off in the preview — nothing here signs, files or clocks in.'),
    KEY: 'k', SIGN_IN: null, STORAGE_BLOCKED: '', BAD_LINK: '', localStorage: { setItem() {}, removeItem() {}, getItem: () => null },
    location: { reload() { throw new Error('a redraw must never reload'); }, hash: '', pathname: '/crew', search: '' },
    history: { replaceState() {} }, setInterval: () => 1, keptGateStart: () => '2026-10-22T10:00:00.000Z', loadBriefing: () => {},
    installedApp: () => true, DOOR_KEY_ASKED: false, BRIEF_DAY: '2026-10-22',
  };
  const body = `${CONSTS.map(objSrc).join('\n')}\n${FNS.map(fnSrc).join('\n')}\nreturn { ${[...CONSTS, ...FNS].join(', ')}, doorKeyAsked: () => DOOR_KEY_ASKED };`;
  const p = new Function(...Object.keys(deps), body)(...Object.values(deps)) as Page;
  p.calls = calls;
  return p;
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const node = (rt: I18n, id: string) => rt.doc.getElementById(id)!;
const refused = (code: number, message: string) => () => { throw Object.assign(new Error(message), { code }); };

describe('every failure is named — in Spanish (crewWhy, §1B)', () => {
  const reasons = [
    { code: 429, message: 'too_many_attempts' }, { code: 403, message: 'off_roster' }, { code: 400, message: 'unknown_crew' },
    { code: 503, message: 'roster_unreadable' }, { code: 401, message: 'crew_key_not_set' }, { code: 401, message: 'no_app_key' },
    { code: 403, message: 'briefing_not_signed' }, { code: 409, message: 'not_todays_briefing' }, { code: 503, message: 'signoff_unreadable' },
    { code: 400, message: 'bad_times' }, { code: 400, message: 'bad_request' }, { code: 401, message: 'unauthorized' },
    { code: 503, message: 'not_simulated' }, { code: 503, message: 'read_only' }, { code: 503, message: 'link_cut' },
    { code: 503, message: 'db_not_configured' }, { code: 500, message: 'error' }, {},
  ];
  it('each reason the crew door names reads in Spanish — the dictionary’s words, never the English', () => {
    const en = page(runtime('en'), () => ({}));
    const es = page(runtime('es'), () => ({}));
    for (const e of reasons) {
      const english = en.crewWhy(e);
      expect(es.crewWhy(e), english).toBe(DICT[english]);
      expect(es.crewWhy(e)).not.toBe(english);
    }
  });
});

const SRC = (over: Partial<WorkOrderSource> = {}): WorkOrderSource => ({
  jobId: 'j1', routeOrder: 1, address: '101 SIM Simulation Row', city: 'Virginia Beach', timeIso: '2026-10-22T13:00:00Z',
  scope: 'SIMULATED — remove leaning pine', hazardPowerLines: true, hazardStructures: true, permitStatus: 'PERMIT_LIKELY',
  photoRefs: [], briefingId: null, ...over,
});
const reviewed = (table: string): LedgerEntry[] => Object.values(readTwinTable(table) ?? {}).map((r) => ({
  en: r.en, es: r.es, sha: pairSha(r.en, r.es), where: 'test', pass: 'reviewed', translatedBy: 't', reviewedBy: 'r', backTranslation: 'b', on: '2026-10-22',
}));

describe('work orders in Spanish — the page’s words in Spanish, the job’s data as written, the server’s safety lines paired', () => {
  const draw = async (rt: I18n, day: unknown) => {
    const p = page(rt, () => day);
    p.GATE.unlocked = true;
    await p.renderWork();
    return { p, work: node(rt, 'work') };
  };

  it('no review recorded (today): every hazard and the permit note show the English, marked "en inglés"', async () => {
    const wo = buildCrewPayload(SRC());
    expect('es' in wo).toBe(false); // the committed ledger holds drafts only
    const rt = runtime('es');
    const { work } = await draw(rt, { workOrders: [wo], notWorkOrders: 0, contractLookupFailed: false });
    const t = work.textContent;
    expect(t).toContain('Órdenes de trabajo de hoy (work orders)');
    expect(t).toContain('Cómo llegar');
    expect(t).toContain('101 SIM Simulation Row, Virginia Beach'); // data, as written
    expect(t).toContain('SIMULATED — remove leaning pine');
    expect(t).toContain('📷 Se requieren fotos de antes y después');
    const hz = work.querySelectorAll('.hz');
    expect(hz.map((h) => h.textContent)).toEqual([`⚠ ${CREW_LINES.hazardPowerLines}en inglés`, `⚠ ${CREW_LINES.hazardStructures}en inglés`]);
    for (const h of hz) expect(h.all().some((k) => k.getAttribute('lang') === 'en' && k.textContent === h.textContent.slice(2, -'en inglés'.length))).toBe(true);
    expect(hz[0]!.className).toBe('hz power');
    expect(work.querySelector('.permit')!.textContent).toBe(`${CREW_LINES.permitLikely}en inglés`);
  });

  it('once a line’s review is recorded, the server sends its twin and the page shows the Spanish over the FULL English', async () => {
    const wo = crewPayloadTwins(buildCrewPayload(SRC({ permitStatus: 'NO_OVERLAY_VERIFY' })), reviewed('crew-workorder'));
    const table = readTwinTable('crew-workorder')!;
    const rt = runtime('es');
    const { work } = await draw(rt, { workOrders: [wo], notWorkOrders: 0, contractLookupFailed: false });
    const hz = work.querySelectorAll('.hz');
    expect(hz[0]!.querySelector('.es-pair-es')!.textContent).toBe(table.hazardPowerLines!.es);
    expect(hz[0]!.querySelector('.es-pair-en')!.textContent).toBe(`inglés ${CREW_LINES.hazardPowerLines}`);
    expect(hz[0]!.querySelector('.es-pair-en')!.getAttribute('lang')).toBe('en');
    const permit = work.querySelector('.permit')!;
    expect(permit.querySelector('.es-pair-es')!.textContent).toBe(table.noOverlayVerify!.es);
    expect(permit.querySelector('.es-pair-en')!.textContent).toBe(`inglés ${CREW_LINES.noOverlayVerify}`);
  });

  // Review round (D111, code D2): a twin is drawn by its hazard's position — only the second reviewed,
  // the first is the English, marked, and the second is the Spanish over ITS OWN English.
  it('only the second hazard reviewed: POWER LINES stays English (marked), STRUCTURES reads Spanish over its own English', async () => {
    const only = reviewed('crew-workorder').filter((e) => e.en === CREW_LINES.hazardStructures);
    const wo = crewPayloadTwins(buildCrewPayload(SRC({ permitStatus: null })), only);
    const table = readTwinTable('crew-workorder')!;
    const { work } = await draw(runtime('es'), { workOrders: [wo], notWorkOrders: 0, contractLookupFailed: false });
    const hz = work.querySelectorAll('.hz');
    expect(hz).toHaveLength(2);
    expect(hz[0]!.className).toBe('hz power');
    expect(hz[0]!.querySelector('.es-pair-es')).toBeNull();
    expect(hz[0]!.textContent).toContain(CREW_LINES.hazardPowerLines);
    expect(hz[0]!.textContent).not.toContain(table.hazardStructures!.es);
    expect(hz[0]!.querySelector('.es-en-mark')).not.toBeNull();
    expect(hz[1]!.querySelector('.es-pair-es')!.textContent).toBe(table.hazardStructures!.es);
    expect(hz[1]!.querySelector('.es-pair-en')!.textContent).toBe(`inglés ${CREW_LINES.hazardStructures}`);
  });

  it('the same payload in English is exactly the English card — the twin never shows', async () => {
    const wo = crewPayloadTwins(buildCrewPayload(SRC()), reviewed('crew-workorder'));
    const rt = runtime('en');
    const { work } = await draw(rt, { workOrders: [wo], notWorkOrders: 0, contractLookupFailed: false });
    expect(work.querySelectorAll('.hz').map((h) => h.textContent)).toEqual([`⚠ ${CREW_LINES.hazardPowerLines}`, `⚠ ${CREW_LINES.hazardStructures}`]);
    expect(work.querySelector('.permit')!.textContent).toBe(CREW_LINES.permitLikely);
    expect(work.textContent).not.toMatch(/inglés|LÍNEAS/);
  });

  it('a failed read, a held day and an unreadable contract list are each named in Spanish — never an empty day', async () => {
    const rt = runtime('es');
    const p = page(rt, refused(503, 'link_cut'));
    p.GATE.unlocked = true;
    await p.renderWork();
    expect(node(rt, 'work').textContent).toBe('Órdenes de trabajo de hoy (work orders)No se pudieron cargar sus órdenes de trabajoLa conexión con los registros de la oficina está cortada a propósito.Eso no es un día vacío — llame a la oficina.');
    for (const [held, line] of [[1, '1 trabajo de la hoja de hoy está en espera'], [2, '2 trabajos de la hoja de hoy están en espera']] as const) {
      const { work } = await draw(runtime('es'), { workOrders: [], notWorkOrders: held, contractLookupFailed: false });
      expect(work.textContent).toContain('Nada confirmado para empezar');
      expect(work.textContent).toContain(line);
    }
    const { work } = await draw(runtime('es'), { workOrders: [], notWorkOrders: 0, contractLookupFailed: true });
    expect(work.textContent).toContain('No se pueden confirmar los trabajos de hoy');
    expect(work.textContent).toContain('Arbo no pudo leer la lista de contratos, así que ningún trabajo está confirmado. ');
    // The stop-work order is a safety line with no recorded review: the English, marked.
    expect(work.textContent).toContain('This is not an empty day — do not start work; call the office.en inglés');
  });
});

const BRIEF = { id: 'b0000000-0000-4000-8000-000000000001', body: 'SIMULATED tailgate briefing.\nStay out of the drop zone — 2 tree lengths.', standardRefs: ['Z133 §5.1'], requiredSeconds: 10 };
const BRIEF_ES = 'Charla de seguridad SIMULADA.\nNo entre en la zona de caída (drop zone) — 2 largos de árbol.';

describe('the gate in Spanish — its words in Spanish, the briefing the office’s own (a reviewed twin, or the English marked)', () => {
  it('no twin: the briefing is the English, lang="en", marked — and the gate around it is Spanish', () => {
    const rt = runtime('es');
    const p = page(rt, () => ({}));
    p.renderGate({ ...BRIEF });
    const gate = node(rt, 'gate-slot');
    expect(gate.querySelector('.gate-head')!.textContent).toBe('Charla de seguridad de la mañana (tailgate briefing) — obligatoria');
    const body = gate.querySelector('#brief-body')!;
    expect(body.getAttribute('lang')).toBe('en');
    expect(body.querySelector('.es-en-mark')!.textContent).toBe('en inglés');
    expect(body.querySelectorAll('p').map((n) => n.textContent)).toEqual(['SIMULATED tailgate briefing.', 'Stay out of the drop zone — 2 tree lengths.']);
    expect(body.querySelector('.clause')!.textContent).toBe('Según Z133 §5.1 — verifique en el lugar de trabajo.');
    expect(gate.querySelector('label')!.textContent).toBe('Leí esta charla de seguridad y la entiendo.');
    expect(gate.querySelector('#gobtn')!.textContent).toBe('EMPEZAR');
    expect(gate.querySelector('#gate-status')!.textContent).toMatch(/^Todavía falta: baje hasta el final · marque la casilla · lea \d+ s más$/);
  });

  it('a reviewed twin the server sent: the briefing in Spanish, no English mark', () => {
    const twin = briefingTwin(BRIEF.body, { text: BRIEF_ES, enSha: enSha(BRIEF.body), pass: 'reviewed', translatedBy: 'a', reviewedBy: 'b', backTranslation: 'c', on: '2026-10-22' });
    expect(twin).toBe(BRIEF_ES);
    const rt = runtime('es');
    const p = page(rt, () => ({}));
    p.renderGate({ ...BRIEF, es: { body: twin } });
    const body = node(rt, 'gate-slot').querySelector('#brief-body')!;
    expect(body.getAttribute('lang')).toBeNull();
    expect(body.querySelectorAll('p').map((n) => n.textContent)).toEqual(BRIEF_ES.split('\n'));
  });

  // Review round (D111, code D3): a served twin is for a Spanish reader only — English mode draws the
  // office's English exactly as before, with no mark and no lang.
  it('English mode never shows a served briefing copy — the English body, as before', () => {
    const rt = runtime('en');
    const p = page(rt, () => ({}));
    p.renderGate({ ...BRIEF, es: { body: BRIEF_ES } });
    const body = node(rt, 'gate-slot').querySelector('#brief-body')!;
    expect(body.querySelectorAll('p').map((n) => n.textContent)).toEqual(BRIEF.body.split('\n'));
    expect(body.getAttribute('lang')).toBeNull();
    expect(body.textContent).not.toContain('Charla');
  });

  it('a refused sign-off names the reason in Spanish, then the stop-work order: the English, marked, until its review is recorded — GO never green', async () => {
    const rt = runtime('es');
    const p = page(rt, refused(503, 'link_cut'));
    p.renderGate({ ...BRIEF });
    p.GATE.scrolled = true; p.GATE.checked = true; p.GATE.openedMs = Date.now() - 60_000;
    await p.submitGate();
    expect(p.GATE.serverMsg).toBe('No se pudo registrar su firma (la conexión con los registros de la oficina está cortada a propósito).');
    expect(p.GATE.serverOrder).toBe(true);
    const status = node(rt, 'gate-slot').querySelector('#gate-status')!;
    expect(status.textContent).toBe(`No se pudo registrar su firma (la conexión con los registros de la oficina está cortada a propósito). ${ORDER_LOCKED}en inglés`);
    expect(status.querySelector('.es-pair')!.querySelector('span')!.getAttribute('lang')).toBe('en');
    expect(node(rt, 'gate-slot').querySelector('#gobtn')!.className).toBe('');
    p.refreshGate(); // the 1-second tick says it the same way, and never stacks it
    expect(status.querySelectorAll('.es-pair')).toHaveLength(1);
  });

  it('once the order’s review is recorded it reads Spanish first, the FULL English beneath (R27 #4)', async () => {
    const rt = runtime('es', REVIEWED_UNITS);
    const p = page(rt, refused(503, 'link_cut'));
    p.renderGate({ ...BRIEF });
    p.GATE.scrolled = true; p.GATE.checked = true; p.GATE.openedMs = Date.now() - 60_000;
    await p.submitGate();
    const status = node(rt, 'gate-slot').querySelector('#gate-status')!;
    expect(status.querySelector('.es-pair-es')!.textContent).toBe(raw('crew-gate')[ORDER_LOCKED]);
    expect(status.querySelector('.es-pair-en')!.textContent).toBe(`inglés ${ORDER_LOCKED}`);
  });

  it('the read-only note: Spanish, with its stop-work order its own bold line (the English, marked, today)', async () => {
    const rt = runtime('es');
    const p = page(rt, () => ({}), { links: 'readonly' });
    p.renderGate({ ...BRIEF });
    await settle();
    const ro = node(rt, 'gate-slot').querySelector('.ro-note')!;
    expect(ro.children[0]!.textContent).toBe('Arbo está en solo lectura hoy — su firma no se puede guardar en este teléfono.');
    expect(ro.children[1]!.tagName).toBe('b');
    expect(ro.children[1]!.textContent).toBe(`${ORDER}en inglés`);
  });

  it('signed: the unlocked gate in Spanish — "Firmado a las …", DÍA DESBLOQUEADO', () => {
    const rt = runtime('es');
    const p = page(rt, () => ({ workOrders: [], notWorkOrders: 0 }));
    p.renderGate({ ...BRIEF, signedAt: '2026-10-22T10:42:00.000Z', signedCheck: 'read' });
    const gate = node(rt, 'gate-slot');
    expect(gate.querySelector('.gate-head')!.textContent).toBe('Charla de seguridad confirmada — registrada');
    expect(gate.querySelector('#gate-status')!.textContent).toMatch(/^Firmado a las .+ — registrado\. No se cuenta dos veces\.$/);
    expect(gate.querySelector('#gobtn')!.textContent).toBe('DÍA DESBLOQUEADO ✓');
  });
});

describe('the quiz in Spanish — a twin only with the same options in the same order; answers keyed by position', () => {
  const item = { id: 'q0000000-0000-4000-8000-000000000001', topic: 'SIM Drop zone', type: 'quiz_question', prompt: 'SIM: Where does the groundie stand while the climber cuts?', options: ['Under the limb', 'Outside the drop zone', 'By the chipper'], readOnly: false };
  const twinEs = { prompt: 'SIM: ¿Dónde se para el ayudante de tierra (groundie) mientras el trepador (climber) corta?', options: ['Debajo de la rama', 'Fuera de la zona de caída (drop zone)', 'Junto a la astilladora (chipper)'] };
  const served = quizTwin(item, { ...twinEs, enSha: quizEnSha(item.prompt, item.options), keyCheckedBy: 'b', pass: 'reviewed', translatedBy: 'a', reviewedBy: 'b', on: '2026-10-22' }, true);
  const pool = (items: unknown[]) => ({ itemsLoaded: true, shortfall: 0, items });
  const draw = async (rt: I18n, items: unknown[]) => {
    const p = page(rt, (method) => (method === 'GET' ? pool(items) : { payableMinutes: 2, gradedOk: true, score: 1, correct: 1, answered: 1 }));
    p.GATE.unlocked = true;
    await p.renderQuiz('clock_in_gate');
    return { p, quiz: node(rt, 'quiz') };
  };

  it('no twin: the office’s English question, lang="en" and marked; the frame around it Spanish', async () => {
    const { quiz } = await draw(runtime('es'), [item]);
    expect(quiz.querySelector('.panel-title')!.textContent).toBe('Pregunta antes de salir');
    expect(quiz.querySelector('.paynote')!.textContent).toBe('Esto es tiempo pagado — cuenta como horas de trabajo.');
    expect(quiz.querySelector('.card')!.getAttribute('lang')).toBe('en');
    expect(quiz.querySelector('.qprompt')!.textContent).toBe(`${item.prompt}en inglés`);
    expect(quiz.querySelectorAll('.qopt').map((b) => b.textContent)).toEqual(item.options);
    expect(quiz.querySelector('.qprogress')!.textContent).toBe('0 de 1 contestadas');
    expect(quiz.querySelector('#quiz-go')!.textContent).toBe('Enviar');
  });

  it('a served twin: the Spanish question and options in the same order — a tap records the position, and the answer sent is the position', async () => {
    expect(served).toEqual(twinEs);
    const { p, quiz } = await draw(runtime('es'), [{ ...item, es: served }]);
    expect(quiz.querySelector('.card')!.getAttribute('lang')).toBeNull();
    expect(quiz.querySelector('.qprompt')!.textContent).toBe(twinEs.prompt);
    const opts = quiz.querySelectorAll('.qopt');
    expect(opts.map((b) => b.textContent)).toEqual(twinEs.options);
    opts[1]!.click();
    expect(p.QUIZ.answers).toEqual({ [item.id]: 1 });
    await p.submitQuiz();
    const sent = p.calls.find((c) => c.method === 'POST')!;
    expect(sent.body.answers).toEqual({ [item.id]: 1 });
    expect(sent.body.itemIds).toEqual([item.id]);
    expect(quiz.textContent).toBe('Registrado2 min pagados — cuentan como horas de trabajo.1 de 1 correctas.');
  });

  // Review round (D111, code D3): English mode never draws a served question copy.
  it('English mode never shows a served question copy — the English prompt and options, as before', async () => {
    const { quiz } = await draw(runtime('en'), [{ ...item, es: served }]);
    expect(quiz.querySelector('.qprompt')!.textContent).toBe(item.prompt);
    expect(quiz.querySelectorAll('.qopt').map((b) => b.textContent)).toEqual(item.options);
    expect(quiz.querySelector('.card')!.getAttribute('lang')).toBeNull();
  });

  it('a twin with a different count of options is never drawn — the English shows, marked', async () => {
    const { quiz } = await draw(runtime('es'), [{ ...item, es: { prompt: twinEs.prompt, options: twinEs.options.slice(0, 2) } }]);
    expect(quiz.querySelectorAll('.qopt').map((b) => b.textContent)).toEqual(item.options);
    expect(quiz.querySelector('.card')!.getAttribute('lang')).toBe('en');
  });

  it('answers that did not save are named in Spanish, and said again after a language change', async () => {
    const rt = runtime('en');
    const p = page(rt, (method) => { if (method === 'GET') return pool([item]); throw Object.assign(new Error('read_only'), { code: 503 }); });
    p.GATE.unlocked = true;
    await p.renderQuiz('clock_in_gate');
    node(rt, 'quiz').querySelectorAll('.qopt')[0]!.click();
    await p.submitQuiz();
    expect(node(rt, 'quiz').querySelector('.errline')!.textContent).toBe('Your answers were not saved (Arbo is read-only right now — it can look but not save, so nothing was written). Tell the office so your paid time is logged.');
    rt.esSwitchInPlace('es');
    await p.renderQuiz(p.QUIZ.context, true);
    expect(node(rt, 'quiz').querySelector('.errline')!.textContent).toBe('Sus respuestas no se guardaron (Arbo está en solo lectura ahora mismo — puede mirar pero no guardar, así que no se guardó nada). Avise a la oficina para que registren su tiempo pagado.');
    expect(node(rt, 'quiz').querySelectorAll('.qopt').filter((b) => b.classList.contains('picked'))).toHaveLength(1);
  });
});

describe('the library and the near miss in Spanish — the frame Spanish, the office’s entries as written', () => {
  it('a lookup that answered: the entry’s own words as written, its framing Spanish, and a Spanish reader told to search in English', async () => {
    const rt = runtime('es');
    const entry = { techniqueName: 'SIM Rigging a heavy limb', howTo: 'SIM how-to', pros: ['SIM pro'], cons: ['SIM con'], wontWorkWhen: null,
      limitsWarning: 'No limits recorded for this technique. That does not mean it always works — ask before using it somewhere unusual.',
      es: { limitsWarning: readTwinTable('crew-library')!.noLimits!.es }, standardRefs: ['Z133 §8.1'], aboveSkillLevel: true };
    const p = page(rt, () => ({ entries: [entry], roster: 'checked', skillKnown: true }));
    p.renderLibrary();
    const lib = node(rt, 'library');
    expect(lib.querySelector('.panel-title')!.textContent).toBe('¿Cómo hago…?');
    expect(lib.textContent).toContain('La biblioteca está escrita en inglés, así que busque con palabras en inglés.');
    expect(lib.querySelector('#lib-q')!.placeholder).toBe('Ej.: rigging a heavy limb');
    lib.querySelector('#lib-q')!.value = 'rigging';
    lib.querySelector('#lib-go')!.click();
    await settle();
    const out = lib.querySelector('#lib-out')!;
    expect(out.querySelector('.lib-name')!.textContent).toBe('SIM Rigging a heavy limb');
    expect(out.querySelector('.lib-how')!.textContent).toBe('SIM how-to');
    expect(out.querySelector('.lib-above')!.textContent).toBe('⚠ Por encima de su nivel aprobado por la oficina — léala, pero no la haga hasta que la oficina le apruebe ese nivel.');
    expect(out.querySelector('.lib-limits')!.textContent).toBe(`⚠ ${readTwinTable('crew-library')!.noLimits!.es}`);
    expect(out.querySelector('.lib-clause')!.textContent).toBe('Según Z133 §8.1 — verifique en el lugar de trabajo.');
  });

  it('a library it could not read is named in Spanish — never "nothing on file"', async () => {
    const rt = runtime('es');
    const p = page(rt, refused(503, 'read_only'));
    p.renderLibrary();
    await p.libSearch('rigging', node(rt, 'library').querySelector('#lib-out'), node(rt, 'library').querySelector('#lib-go'));
    expect(node(rt, 'library').querySelector('#lib-out')!.textContent).toBe('Biblioteca: Arbo está en solo lectura ahora mismo — puede mirar pero no guardar, así que no se guardó nada. Eso NO es "no hay nada registrado" — pregunte a la oficina.');
  });

  it('a near miss filed: "Enviado", its category in Spanish; one that failed names why', async () => {
    const rt = runtime('es');
    const p = page(rt, () => ({ hazardCategory: 'struck_by', roster: 'unchecked' }));
    p.renderNearMiss();
    const nm = node(rt, 'nearmiss');
    expect(nm.querySelector('.panel-title')!.textContent).toBe('Reporte un casi accidente (near miss)');
    nm.querySelector('#nm-desc')!.value = 'SIM: a limb swung toward the truck';
    nm.querySelector('#nm-go')!.click();
    await settle();
    expect(nm.querySelector('#nm-out')!.textContent).toBe('Enviado. Gracias — así es como nadie se lastima la próxima vez. Registrado como: golpe por objeto. Arbo no pudo revisar la lista del personal en este momento.');
    const rt2 = runtime('es');
    const q = page(rt2, refused(503, 'link_cut'));
    q.renderNearMiss();
    node(rt2, 'nearmiss').querySelector('#nm-desc')!.value = 'SIM: a limb swung toward the truck';
    node(rt2, 'nearmiss').querySelector('#nm-go')!.click();
    await settle(); await settle();
    expect(node(rt2, 'nearmiss').querySelector('#nm-out')!.textContent).toBe('No se guardó — la conexión con los registros de la oficina está cortada a propósito. Avise directamente a la oficina.');
    expect(node(rt2, 'nearmiss').querySelector('#nm-desc')!.value).toBe('SIM: a limb swung toward the truck'); // the words stay to send again
  });
});

describe('after sign-off a language change redraws every panel in place — no read, no send, no reload', () => {
  const signedPage = async () => {
    const rt = runtime('en');
    const day = { workOrders: [buildCrewPayload(SRC())], notWorkOrders: 0, contractLookupFailed: false };
    const p = page(rt, (method, path) => {
      if (path.startsWith('/api/crew/me')) return { firstName: 'SIM-Rudy', active: true };
      if (path.startsWith('/api/crew/workorders')) return day;
      if (path.startsWith('/api/crew/quiz')) return { itemsLoaded: true, shortfall: 0, items: [] };
      if (path.startsWith('/api/crew/near-miss')) return { hazardCategory: 'electrical', roster: 'checked' };
      return {};
    });
    node(rt, 'dateline').textContent = 'x';
    p.paintDateline();
    p.renderWhoAmI();
    p.renderLibrary();
    p.renderNearMiss();
    p.renderGate({ ...BRIEF, signedAt: '2026-10-22T10:42:00.000Z', signedCheck: 'read' });
    await settle(); await settle();
    const nm = node(rt, 'nearmiss');
    nm.querySelector('#nm-desc')!.value = 'SIM: first report';
    nm.querySelector('#nm-go')!.click();
    await settle();
    nm.querySelector('#nm-desc')!.value = 'SIM: a second one, typed and not sent';
    return { rt, p };
  };

  it('English first: the name, the signed gate, the day, the near miss — as before', async () => {
    const { rt } = await signedPage();
    expect(node(rt, 'whoami').textContent).toContain('On this phone: SIM-Rudy —');
    expect(node(rt, 'dateline').textContent).toMatch(/^SIMULATION · /);
    expect(node(rt, 'nearmiss').querySelector('#nm-out')!.textContent).toBe('Filed. Thank you — that is how nobody gets hurt next time. Logged under: electrical.');
  });

  it('then Spanish: every panel says its words again from what the phone already had — and nothing is read or sent', async () => {
    const { rt, p } = await signedPage();
    const before = p.calls.length;
    rt.esSwitchInPlace('es');
    p.crewRedraw();
    await settle(); await settle();
    expect(p.calls.length).toBe(before);
    expect(node(rt, 'dateline').textContent).toMatch(/^SIMULACIÓN · /);
    expect(node(rt, 'whoami').textContent).toContain('En este teléfono: SIM-Rudy —');
    expect(node(rt, 'whoami').textContent).toContain('¿No es usted?');
    const gate = node(rt, 'gate-slot');
    expect(gate.querySelector('.gate-head')!.textContent).toBe('Charla de seguridad confirmada — registrada');
    expect(gate.querySelector('label')!.textContent).toBe('Leí esta charla de seguridad y la entiendo.');
    expect(gate.querySelector('#brief-body')!.getAttribute('lang')).toBe('en'); // no twin: the English, marked
    expect(gate.querySelector('#gobtn')!.textContent).toBe('DÍA DESBLOQUEADO ✓');
    expect(node(rt, 'work').querySelector('.navbtn')!.textContent).toBe('Cómo llegar');
    const nm = node(rt, 'nearmiss');
    expect(nm.querySelector('#nm-desc')!.value).toBe('SIM: a second one, typed and not sent');
    expect(nm.querySelector('#nm-out')!.textContent).toBe('Enviado. Gracias — así es como nadie se lastima la próxima vez. Registrado como: eléctrico.');
    expect(node(rt, 'library').querySelector('.panel-title')!.textContent).toBe('¿Cómo hago…?');
    // and back to English: the same words as before the change
    rt.esSwitchInPlace('en');
    p.crewRedraw();
    await settle();
    expect(p.calls.length).toBe(before);
    expect(node(rt, 'whoami').textContent).toContain('On this phone: SIM-Rudy —');
    expect(gate.querySelector('#brief-body')!.getAttribute('lang')).toBeNull();
    expect(nm.querySelector('#nm-out')!.textContent).toBe('Filed. Thank you — that is how nobody gets hurt next time. Logged under: electrical.');
  });

  it('a door-key card a changed key put up after sign-off is drawn again in Spanish, the typed key kept — not the name line', async () => {
    const { rt, p } = await signedPage();
    p.doorKeyChanged(Object.assign(new Error('unauthorized'), { code: 401 }));
    expect(p.doorKeyAsked()).toBe(true);
    node(rt, 'whoami').querySelector('#doorkey')!.value = 'half a phr';
    rt.esSwitchInPlace('es');
    p.crewRedraw();
    await settle();
    const who = node(rt, 'whoami');
    expect(who.querySelector('h2')!.textContent).toBe('Clave de la puerta de la cuadrilla');
    expect(who.querySelector('#doorkey')!.value).toBe('half a phr');
    expect(who.textContent).not.toContain('En este teléfono');
  });

  it('a work-order read that failed is said again in Spanish — never read again', async () => {
    const rt = runtime('en');
    const p = page(rt, refused(503, 'link_cut'));
    p.GATE.unlocked = true;
    await p.renderWork();
    const reads = p.calls.length;
    rt.esSwitchInPlace('es');
    p.crewRedraw();
    await settle(); await settle();
    expect(p.calls.filter((c) => c.path.startsWith('/api/crew/workorders'))).toHaveLength(reads);
    expect(node(rt, 'work').textContent).toContain('No se pudieron cargar sus órdenes de trabajo');
    expect(node(rt, 'work').textContent).toContain('La conexión con los registros de la oficina está cortada a propósito.');
  });
});
