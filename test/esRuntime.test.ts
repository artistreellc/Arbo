// R27 (D110) — the Spanish runtime (src/app/i18n/runtime.js), run for real
// over a fake page: T, tf, tn, esPick, esPair, the switches, the fail-closed
// language read, the broken-dictionary notice, and the es-US rule.
import { describe, it, expect } from 'vitest';
import { loadI18n, FakeNode, RUNTIME_NAMES } from './support/i18nRuntime.js';
import { findBannedEs } from '../src/i18n/banList.js';
import { esGateProblems } from '../src/i18n/gates.js';

const DICT = {
  'crew-switch': { Language: 'Idioma', English: 'inglés', 'in English': 'en inglés' },
  'crew-test': {
    'No new leads': 'No hay prospectos nuevos',
    '{n} calls today': '{n} llamadas hoy',
    '{n} call': '{n} llamada',
    '{n} calls': '{n} llamadas',
    'Slots renamed {n}': 'Huecos {count}',
    'PERMIT LIKELY': 'PROBABLEMENTE SE NECESITA PERMISO',
    STOP: 'ALTO',
  },
};
const es = (over: Parameters<typeof loadI18n>[0] = {}) => loadI18n({ door: 'crew', units: DICT, stored: { arboCrewLang: 'es' }, ...over });
const en = (over: Parameters<typeof loadI18n>[0] = {}) => loadI18n({ door: 'crew', units: DICT, ...over });

describe('the language read fails closed — only the exact stored "es" is Spanish', () => {
  it('"es" is Spanish; anything else is English', () => {
    expect(es().ES.lang).toBe('es');
    for (const junk of ['', 'ES', 'es ', ' es', 'spanish', 'Español', 'true', 'en', '1', 'null']) {
      expect(loadI18n({ door: 'crew', units: DICT, stored: { arboCrewLang: junk } }).ES.lang, JSON.stringify(junk)).toBe('en');
    }
    expect(en().ES.lang).toBe('en');
  });

  it('storage that refuses to answer is English, and nothing throws', () => {
    const r = loadI18n({ door: 'crew', units: DICT, stored: 'throw' });
    expect(r.ES.lang).toBe('en');
    expect(r.ES.broken).toBe(false);
    expect(r.T('No new leads')).toBe('No new leads');
  });

  it('the two doors keep separate settings: arboLang never turns the crew door Spanish, nor arboCrewLang the office app', () => {
    expect(loadI18n({ door: 'crew', units: DICT, stored: { arboLang: 'es' } }).ES.lang).toBe('en');
    expect(loadI18n({ door: 'app', units: { 'app-switch': DICT['crew-switch'] }, stored: { arboCrewLang: 'es' } }).ES.lang).toBe('en');
    expect(loadI18n({ door: 'app', units: { 'app-switch': DICT['crew-switch'] }, stored: { arboLang: 'es' } }).ES.lang).toBe('es');
    expect(loadI18n({ door: 'app' }).ES.key).toBe('arboLang');
    expect(loadI18n({ door: 'crew' }).ES.key).toBe('arboCrewLang');
  });
});

describe('T, tf, tn — English is returned exactly as written; Spanish only where the dictionary has it', () => {
  it('T: English is the very same string; Spanish from the dictionary; a miss shows English and is noted', () => {
    const s = 'No new leads';
    expect(en().T(s)).toBe(s);
    const r = es();
    expect(r.T(s)).toBe('No hay prospectos nuevos');
    expect(r.T('Not translated yet')).toBe('Not translated yet');
    expect([...r.ES.missed]).toEqual(['Not translated yet']);
  });

  it('tf: English fills to the same bytes as the old concatenation; Spanish fills its own template', () => {
    expect(en().tf('{n} calls today', { n: 3 })).toBe(3 + ' calls today');
    expect(es().tf('{n} calls today', { n: 3 })).toBe('3 llamadas hoy');
  });

  it('tf: a Spanish template that renamed or lost a slot is not used — the English shows, with the value', () => {
    expect(es().tf('Slots renamed {n}', { n: 7 })).toBe('Slots renamed 7');
  });

  it('tf: data passes through exactly as typed — never translated, never re-filled, no $ pattern games', () => {
    const r = es();
    expect(r.tf('{n} calls today', { n: 'No new leads' })).toBe('No new leads llamadas hoy');
    expect(r.tf('{n} calls today', { n: '{n}' })).toBe('{n} llamadas hoy');
    expect(r.tf('{n} calls today', { n: "$& $' $1" })).toBe("$& $' $1 llamadas hoy");
  });

  it('tn: the one form for 1 only; the many form for 0 and 2', () => {
    const r = es();
    expect(r.tn(1, '{n} call', '{n} calls')).toBe('1 llamada');
    expect(r.tn(0, '{n} call', '{n} calls')).toBe('0 llamadas');
    expect(r.tn(2, '{n} call', '{n} calls')).toBe('2 llamadas');
    expect(en().tn(1, '{n} call', '{n} calls')).toBe('1 call');
    expect(en().tn(2, '{n} call', '{n} calls')).toBe('2 calls');
  });
});

describe('esPick / esPickEl — a server twin, or the English with "en inglés" (never a blank)', () => {
  const line = { note: 'Two jobs on hold.', es: { note: 'Dos trabajos en espera.' } };
  const bare = { note: 'Two jobs on hold.' };
  it('English mode always reads the English field', () => {
    expect(en().esPick(line, 'note')).toBe('Two jobs on hold.');
    const n = en().esPickEl('div', 'x', bare, 'note') as FakeNode;
    expect(n.textContent).toBe('Two jobs on hold.');
    expect(n.hasAttribute('lang')).toBe(false);
    expect(n.children).toHaveLength(1);
  });
  it('Spanish mode serves the twin when there is one', () => {
    expect(es().esPick(line, 'note')).toBe('Dos trabajos en espera.');
    expect((es().esPickEl('div', 'x', line, 'note') as FakeNode).textContent).toBe('Dos trabajos en espera.');
  });
  it('Spanish mode with no twin shows the English, marked lang="en" with "en inglés"', () => {
    expect(es().esPick(bare, 'note')).toBe('Two jobs on hold.');
    const n = es().esPickEl('div', 'x', bare, 'note') as FakeNode;
    expect(n.getAttribute('lang')).toBe('en');
    expect(n.textContent).toBe('Two jobs on hold.en inglés');
    expect(n.children[1]!.className).toBe('es-en-mark');
  });
});

describe('esPair — Spanish first, the full English line beneath it, smaller and marked English (R27 #4)', () => {
  it('English mode: the English alone, as one text node (byte-identical to textContent)', () => {
    const n = en().esPair('PERMIT LIKELY') as FakeNode;
    expect(n.tagName).toBe('#text');
    expect(n.textContent).toBe('PERMIT LIKELY');
  });
  it('Spanish mode: the Spanish, then a small lang="en" line holding the whole English', () => {
    const host = new FakeNode('div');
    host.appendChild(es().esPair('PERMIT LIKELY') as FakeNode);
    expect(host.children.map((c) => c.className)).toEqual(['es-pair-es', 'es-pair-en']);
    expect(host.children[0]!.textContent).toBe('PROBABLEMENTE SE NECESITA PERMISO');
    expect(host.children[1]!.tagName).toBe('small');
    expect(host.children[1]!.getAttribute('lang')).toBe('en');
    expect(host.children[1]!.textContent).toBe('inglés PERMIT LIKELY');
  });
  it('a label with no Spanish yet shows the English with "en inglés", never a blank', () => {
    const host = new FakeNode('div');
    host.appendChild(es().esPair('STOP WORK') as FakeNode);
    expect(host.textContent).toBe('STOP WORKen inglés');
  });
  it('STOP, the carrier keyword, is never translated — even if a dictionary tried', () => {
    const n = es().esPair('STOP') as FakeNode;
    expect(n.tagName).toBe('#text');
    expect(n.textContent).toBe('STOP');
  });
});

describe('a broken or missing dictionary keeps English and says so in both languages (§1B)', () => {
  const notices = (r: ReturnType<typeof loadI18n>) => r.doc.querySelectorAll('.es-broken');
  for (const [name, json] of [['not JSON', '{"door":"crew","units":{'], ['a broken unit named', JSON.stringify({ door: 'crew', units: {}, broken: ['crew-gate'] })], ['another door’s dictionary', JSON.stringify({ door: 'app', units: {} })], ['a non-string entry', JSON.stringify({ door: 'crew', units: { 'crew-x': { a: 1 } } })]] as const) {
    it(`${name}: a Spanish reader gets English and the notice, Spanish first`, () => {
      const r = loadI18n({ door: 'crew', json, stored: { arboCrewLang: 'es' } });
      expect(r.ES.lang).toBe('en');
      expect(r.ES.broken).toBe(true);
      expect(r.T('No new leads')).toBe('No new leads');
      const n = notices(r);
      expect(n).toHaveLength(1);
      expect(n[0]!.children.map((c) => [c.getAttribute('lang'), c.textContent])).toEqual([['es', r.ES_BROKEN_LINE.es], ['en', r.ES_BROKEN_LINE.en]]);
      expect(n[0]!.getAttribute('role')).toBe('status');
    });
  }
  it('no dictionary tag at all (the office app): a Spanish reader gets English and the notice', () => {
    const r = loadI18n({ door: 'app', json: null, stored: { arboLang: 'es' } });
    expect(r.ES.lang).toBe('en');
    expect(r.ES.broken).toBe(true);
    expect(notices(r)).toHaveLength(1);
  });
  it('an English reader of a broken dictionary sees nothing new at all', () => {
    const r = loadI18n({ door: 'crew', json: '{', stored: {} });
    expect(r.ES.broken).toBe(false);
    expect(notices(r)).toHaveLength(0);
    expect(r.doc.documentElement.getAttribute('lang')).toBe('en');
  });
  it('the key screen gets the notice too, when there is one', () => {
    const wall = new FakeNode('div');
    wall.setAttribute('id', 'keywall');
    const r = loadI18n({ door: 'app', json: '{', stored: { arboLang: 'es' }, extra: [wall] });
    expect(notices(r)).toHaveLength(2);
    expect(wall.children[0]!.className).toBe('es-broken');
  });
});

describe('the switches — a change is stored for this door, then the page acts on it', () => {
  it('the office app (no handler): stores "es" under arboLang and reloads', () => {
    const r = loadI18n({ door: 'app', units: { 'app-switch': DICT['crew-switch'] } });
    const b = r.esToggleButton('es-toggle') as FakeNode;
    expect(b.textContent).toBe('Español');
    expect(b.getAttribute('lang')).toBe('es');
    b.click();
    expect(r.storage.get('arboLang')).toBe('es');
    expect(r.reloads).toBe(1);
  });
  it('a page handler (the crew door) is called instead of a reload', () => {
    const r = loadI18n({ door: 'crew', units: DICT });
    const seen: string[] = [];
    r.ES.onChange = (to: string) => seen.push(to);
    (r.esToggleButton('x') as FakeNode).click();
    expect(seen).toEqual(['es']);
    expect(r.reloads).toBe(0);
    expect(r.storage.get('arboCrewLang')).toBe('es');
  });
  it('storage that refuses: nothing reloads, and the line says so in both languages beside the switch', () => {
    const r = loadI18n({ door: 'app', units: {}, stored: 'throw' });
    const b = r.esToggleButton('es-toggle') as FakeNode;
    r.doc.querySelector('main')!.appendChild(b);
    b.click();
    expect(r.reloads).toBe(0);
    const said = b.nextSibling!;
    expect(said.className).toBe('es-storage');
    expect(said.textContent).toBe(r.ES_STORAGE_LINE.es + r.ES_STORAGE_LINE.en);
    b.click();
    expect(r.doc.querySelectorAll('.es-storage')).toHaveLength(1); // said once, not stacked
  });
  it('a toggle in a header row (the crew door) has the storage line said at the top of the page, not in the row', () => {
    const header = new FakeNode('header');
    const r = loadI18n({ door: 'crew', units: DICT, stored: 'throw', extra: [header] });
    const b = header.appendChild(r.esToggleButton('es-toggle') as FakeNode);
    b.click();
    expect(header.children).toHaveLength(1);
    expect(r.doc.querySelector('main')!.children[0]!.className).toBe('es-storage');
  });
  it('tapping the language already chosen does nothing', () => {
    const r = loadI18n({ door: 'app', units: {} });
    r.esChange('en', null);
    expect(r.reloads).toBe(0);
    expect(r.storage.size).toBe(0);
  });
  it('in place (after the crew’s sign-off): the language, html lang, marks and the toggle’s own label all follow', () => {
    const work = new FakeNode('div');
    work.setAttribute('id', 'work');
    const r = loadI18n({ door: 'crew', units: DICT, extra: [work] });
    r.esMarkPlaces({ '#work': 'crew-work' });
    expect(work.hasAttribute('data-es-en')).toBe(false);
    const b = r.esToggleButton('x') as FakeNode;
    r.esSwitchInPlace('es');
    expect(r.ES.lang).toBe('es');
    expect(r.doc.documentElement.lang).toBe('es');
    expect(work.getAttribute('lang')).toBe('en');
    expect(work.getAttribute('data-es-en')).toBe('en inglés');
    expect(b.textContent).toBe('English');
    r.esSwitchInPlace('en');
    expect(r.ES.lang).toBe('en');
    expect(work.hasAttribute('lang')).toBe(false);
    expect(work.hasAttribute('data-es-en')).toBe(false);
    expect(b.textContent).toBe('Español');
  });
});

describe('"en inglés" marks — every place whose unit has no Spanish yet, and only in Spanish mode', () => {
  const place = (id: string) => { const n = new FakeNode('div'); n.setAttribute('id', id); return n; };
  it('English: nothing is touched', () => {
    const a = place('gate-slot');
    const r = loadI18n({ door: 'crew', units: DICT, extra: [a] });
    r.esMarkPlaces({ '#gate-slot': 'crew-gate' });
    expect([...a.attrs.keys()]).toEqual(['id']);
  });
  it('Spanish: an untranslated unit is marked; a translated one is not', () => {
    const a = place('gate-slot');
    const b = place('test');
    const r = es({ extra: [a, b] });
    r.esMarkPlaces({ '#gate-slot': 'crew-gate', '#test': 'crew-test' });
    expect(a.getAttribute('data-es-en')).toBe('en inglés');
    expect(a.getAttribute('lang')).toBe('en');
    expect(b.hasAttribute('data-es-en')).toBe(false);
  });
});

describe('dates and numbers — es-US for display, money and decimals as English writes them', () => {
  it('esLocale is es-US in Spanish and the phone’s own in English', () => {
    expect(es().esLocale()).toBe('es-US');
    expect(en().esLocale()).toEqual([]);
  });
  it('es-US keeps the decimal point and comma groups (a decimal comma on a DBH would be dangerous)', () => {
    expect(es().esNum(1234.5)).toBe('1,234.5');
    expect(es().esNum(14.5)).toBe('14.5');
    expect((1234.5).toLocaleString('es-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe('1,234.50');
    expect(en().esNum(1234)).toBe((1234).toLocaleString());
  });
});

describe('the runtime’s own bilingual lines pass the ban list and the gates', () => {
  const r = loadI18n();
  for (const [name, line] of [['broken', r.ES_BROKEN_LINE], ['storage', r.ES_STORAGE_LINE], ['switch label', { en: r.ES_SWITCH_LABEL.en, es: r.ES_SWITCH_LABEL.es }]] as const) {
    it(name, () => {
      expect(findBannedEs(line.es)).toEqual([]);
      if (name !== 'switch label') expect(esGateProblems(line.en, line.es)).toEqual([]);
    });
  }
});

describe('the stubs every harness needs — the runtime’s names, in English, on the global object', () => {
  it('a page function lifted with new Function can call T, tf, tn and esPick and gets plain English', () => {
    const lifted = new Function('return [T("No new leads"), tf("{n} calls today", { n: 2 }), tn(1, "{n} call", "{n} calls"), esPick({ a: "x", es: { a: "y" } }, "a")];');
    expect(lifted()).toEqual(['No new leads', '2 calls today', '1 call', 'x']);
  });
  it('every name the runtime defines is there', () => {
    for (const n of RUNTIME_NAMES) expect((globalThis as Record<string, unknown>)[n], n).toBeDefined();
  });
});

// Review round (D110, correctness #5): a MISSING dictionary was taken as an
// empty one — the page turned Spanish on with nothing to say it in, the marks
// read "in English" in English, and no notice showed. "Couldn't load it" is
// never "nothing to translate" (§1B): no units, units that are not an object,
// or a door whose own switch unit (the runtime's own words) is absent is a
// missing dictionary — English, and the notice in both languages.
describe('review round — a missing dictionary is named, never taken as an empty one', () => {
  const sw = { Language: 'Idioma', English: 'inglés', 'in English': 'en inglés' };
  const cases: Array<[string, string]> = [
    ['no units at all', JSON.stringify({ door: 'crew', units: {}, broken: [] })],
    ['units as an array', JSON.stringify({ door: 'crew', units: [], broken: [] })],
    ['units as a string', JSON.stringify({ door: 'crew', units: 'crew-switch', broken: [] })],
    ['the door’s switch unit missing', JSON.stringify({ door: 'crew', units: { 'crew-test': { 'No new leads': 'No hay prospectos nuevos' } }, broken: [] })],
    ['the switch unit without “in English”', JSON.stringify({ door: 'crew', units: { 'crew-switch': { English: 'inglés' } }, broken: [] })],
    ['the other door’s switch unit only', JSON.stringify({ door: 'crew', units: { 'app-switch': sw }, broken: [] })],
  ];
  for (const [name, json] of cases) {
    it(`${name}: a Spanish reader gets English and the two-language notice`, () => {
      const r = loadI18n({ door: 'crew', json, stored: { arboCrewLang: 'es' } });
      expect(r.ES.lang).toBe('en');
      expect(r.ES.broken).toBe(true);
      expect(r.doc.querySelectorAll('.es-broken')).toHaveLength(1);
      expect(r.doc.documentElement.getAttribute('lang')).toBe('en');
    });
    it(`${name}: an English reader sees nothing new`, () => {
      const r = loadI18n({ door: 'crew', json });
      expect(r.ES.broken).toBe(false);
      expect(r.doc.querySelectorAll('.es-broken')).toHaveLength(0);
    });
  }
  it('a dictionary with its switch unit is not missing', () => {
    const r = loadI18n({ door: 'crew', json: JSON.stringify({ door: 'crew', units: { 'crew-switch': sw }, broken: [] }), stored: { arboCrewLang: 'es' } });
    expect(r.ES.lang).toBe('es');
    expect(r.ES.broken).toBe(false);
  });
});
