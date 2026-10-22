// R27 Phase A unit 1 (D111) — the runtime's safety-line and server-twin helpers
// the crew door draws with (docs/R27_SPANISH_PLAN.md, "Safety and legal labels",
// "Three kinds of text" 2). They put the words INTO the page's own node:
//   esSay(node, 'STOP-WORK LINE')        a safety line from the door's dictionary — a pair in Spanish
//   esSayPick(node, obj, field, prefix)  a safety line a server module wrote, with its twin — a pair
//   esSayTwin(node, obj, field, prefix)  any other server line with its twin — Spanish, or the English marked
// English is byte-identical: node.textContent is the English as written, nothing
// from another document — so a page harness's own fake nodes keep working.
import { describe, it, expect } from 'vitest';
import { loadI18n, FakeNode } from './support/i18nRuntime.js';

const POINTER = 'Aviso de seguridad — por ahora solo en inglés; pídale a alguien que se lo lea:';
const DICT = {
  'crew-switch': { English: 'inglés', 'in English': 'en inglés', 'Safety notice — only in English for now; ask someone to read it to you:': POINTER },
  'crew-test': { 'Do not start work — call the office.': 'No empiece a trabajar — llame a la oficina.' },
};
const es = () => loadI18n({ door: 'crew', units: DICT, stored: { arboCrewLang: 'es' } });
const en = () => loadI18n({ door: 'crew', units: DICT });

describe('esSay — a safety line from the dictionary, into the page’s own node', () => {
  it('English: the line as written, set on the node itself (no new node, no other document)', () => {
    const b = new FakeNode('b');
    expect(en().esSay(b, 'Do not start work — call the office.')).toBe(b);
    expect(b.textContent).toBe('Do not start work — call the office.');
    expect(b.children.map((c) => c.tagName)).toEqual(['#text']);
  });
  it('English works on any object with textContent — a harness’s own fake node included', () => {
    const plain = { textContent: 'old' };
    en().esSay(plain, 'Do not start work — call the office.');
    expect(plain.textContent).toBe('Do not start work — call the office.');
  });
  it('Spanish: one es-pair holder — the Spanish, then the full English beneath, marked English', () => {
    const b = new FakeNode('b');
    es().esSay(b, 'Do not start work — call the office.');
    expect(b.children.map((c) => c.className)).toEqual(['es-pair']);
    const pair = b.children[0]!;
    expect(pair.children.map((c) => c.className)).toEqual(['es-pair-es', 'es-pair-en']);
    expect(pair.children[0]!.textContent).toBe('No empiece a trabajar — llame a la oficina.');
    expect(pair.children[1]!.getAttribute('lang')).toBe('en');
    expect(pair.children[1]!.textContent).toBe('inglés Do not start work — call the office.');
  });
  // Review round (D111, UI 1 + 3): a held line is never English alone under Spanish — a Spanish pointer
  // (not the order itself) says a safety notice follows in English, on its own line, then the English.
  it('Spanish with no reviewed Spanish (held back): a Spanish pointer on its own line, then the English, marked "en inglés" — never a blank', () => {
    const b = new FakeNode('b');
    es().esSay(b, 'Your work orders stay locked — do not start work; call the office to log your briefing.');
    expect(b.textContent).toBe(POINTER + 'Your work orders stay locked — do not start work; call the office to log your briefing.en inglés');
    const box = b.children[0]!;
    expect(box.className).toBe('es-pair es-held');
    expect(box.children[0]!.className).toBe('es-held-why');
    expect(box.children[0]!.getAttribute('lang')).toBe('es');
    expect(box.children[0]!.textContent).toBe(POINTER);
    expect(box.children[1]!.getAttribute('lang')).toBe('en');
    expect(box.children[1]!.textContent).toBe('Your work orders stay locked — do not start work; call the office to log your briefing.');
  });
  it('a reviewed line carries no pointer — the Spanish over its full English', () => {
    const b = new FakeNode('b');
    es().esSay(b, 'Do not start work — call the office.');
    expect(b.all().some((n) => n.className === 'es-held-why')).toBe(false);
  });
  it('replaces what the node held before (a redraw never stacks)', () => {
    const b = new FakeNode('b');
    const r = es();
    r.esSay(b, 'Do not start work — call the office.');
    r.esSay(b, 'Do not start work — call the office.');
    expect(b.children).toHaveLength(1);
  });
  // D111: a failure line is its reason, then the stop-work order — two sentences, each its own key.
  it('a lead-in (the sentence before the order): English is ONE text node, byte-identical; Spanish keeps the lead, then the pair', () => {
    const lead = 'Your sign-off could not be recorded (the office didn’t answer). ';
    const b = new FakeNode('div');
    en().esSay(b, 'Do not start work — call the office.', lead);
    expect(b.textContent).toBe(lead + 'Do not start work — call the office.');
    expect(b.children.map((c) => c.tagName)).toEqual(['#text']);
    const s = new FakeNode('div');
    es().esSay(s, 'Do not start work — call the office.', 'No se pudo registrar su firma (la oficina no contestó). ');
    expect(s.children.map((c) => (c.tagName === '#text' ? '#text' : c.className))).toEqual(['#text', 'es-pair']);
    expect(s.children[0]!.textContent).toBe('No se pudo registrar su firma (la oficina no contestó). ');
    expect(s.children[1]!.children[0]!.textContent).toBe('No empiece a trabajar — llame a la oficina.');
  });
  it('a held line keeps its lead-in too, and the English it shows is marked', () => {
    const s = new FakeNode('div');
    es().esSay(s, 'Your work orders stay locked — do not start work; call the office to log your briefing.', 'Lead. ');
    expect(s.textContent).toBe('Lead. ' + POINTER + 'Your work orders stay locked — do not start work; call the office to log your briefing.en inglés');
    expect(s.children.map((c) => (c.tagName === '#text' ? '#text' : c.className))).toEqual(['#text', 'es-pair es-held']);
  });
});

describe('esSayPick — a server-written safety line and its twin, as a pair', () => {
  const wo = { permitNote: 'PERMIT LIKELY — do not start protected work until the permit is confirmed.' };
  const twinned = { ...wo, es: { permitNote: 'PROBABLEMENTE SE NECESITA PERMISO — no empiece el trabajo que requiere permiso (protected work) hasta que se confirme el permiso.' } };
  it('English: prefix + the English field, byte-identical, on the node itself', () => {
    const n = new FakeNode('div');
    en().esSayPick(n, twinned, 'permitNote', '⚠ ');
    expect(n.textContent).toBe('⚠ ' + wo.permitNote);
    expect(n.children).toHaveLength(1);
  });
  it('Spanish with a served twin: prefix, then ONE holder (a flex row keeps it one item) with Spanish over the full English', () => {
    const n = new FakeNode('div');
    es().esSayPick(n, twinned, 'permitNote', '⚠ ');
    expect(n.children.map((c) => c.tagName === '#text' ? '#text:' + c.textContent : c.className)).toEqual(['#text:⚠ ', 'es-pair']);
    const pair = n.children[1]!;
    expect(pair.children[0]!.textContent).toBe(twinned.es.permitNote);
    expect(pair.children[1]!.textContent).toBe('inglés ' + wo.permitNote);
  });
  it('Spanish with no twin served: the English, marked "en inglés"', () => {
    const n = new FakeNode('div');
    es().esSayPick(n, wo, 'permitNote', '');
    expect(n.textContent).toBe(POINTER + wo.permitNote + 'en inglés');
  });
});

describe('esSayTwin — any other server line and its twin', () => {
  const line = { limitsWarning: 'No limits recorded for this technique.' };
  it('English: prefix + English, on the node', () => {
    const n = new FakeNode('div');
    en().esSayTwin(n, { ...line, es: { limitsWarning: 'Sin límites.' } }, 'limitsWarning', '⚠ ');
    expect(n.textContent).toBe('⚠ No limits recorded for this technique.');
    expect(n.hasAttribute('lang')).toBe(false);
  });
  it('Spanish: the twin alone; with none, the English with lang="en" and "en inglés"', () => {
    const a = new FakeNode('div');
    es().esSayTwin(a, { ...line, es: { limitsWarning: 'No hay límites registrados para esta técnica.' } }, 'limitsWarning', '⚠ ');
    expect(a.textContent).toBe('⚠ No hay límites registrados para esta técnica.');
    const b = new FakeNode('div');
    es().esSayTwin(b, line, 'limitsWarning', '⚠ ');
    expect(b.getAttribute('lang')).toBe('en');
    expect(b.textContent).toBe('⚠ No limits recorded for this technique.en inglés');
  });
});
