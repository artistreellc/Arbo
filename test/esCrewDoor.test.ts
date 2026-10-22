// R27 Phase A unit 1 (D111) — the crew door in Spanish (docs/R27_SPANISH_PLAN.md,
// "Order of work" 3; R27, R29 #3). Every word the crew door draws goes through
// the runtime (T, tf, tn, esSay…), each sentence one string literal, and every
// place on the page has its unit, so Spanish mode shows Spanish — with English
// left only where it is data (names, addresses, notes, the office's own text) or
// a safety line whose review is not recorded yet, and then marked "en inglés".
//
// This file holds the static gates. The Spanish drawing itself is proven by
// running the page's own functions over the real runtime and the real crew
// dictionaries (test/esCrewDraw.test.ts).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { unitFiles, readUnit, loadDoorDictionary } from '../src/i18n/dictionaries.js';
import { isSafetyClass, loadLedger } from '../src/i18n/ledger.js';
import { TRADE_TERMS, APP_TERMS } from '../src/i18n/glossary.js';
import { normalizeEs } from '../src/i18n/banList.js';

const crew = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');
const script = [...crew.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).join('\n');
const sf = ts.createSourceFile('crew.html', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const crewUnits = () => unitFiles().filter((u) => u.door === 'crew');
const crewDict = (): Record<string, string> => Object.assign({}, ...crewUnits().map((u) => readUnit(u.file) ?? {}));

// The runtime's calls that carry a dictionary key (the parity test's list, test/esInline.test.ts).
const KEYED = new Set(['T', 'tf', 'tn', 'esSay', 'esPair']);
// A literal in one of these positions is not words on the screen: a tag or a class, a selector, an
// attribute or event name, a storage key, a route, a locale or a format option.
const CODE_CALLS: Record<string, number[] | 'all'> = {
  el: [0, 1], createElement: 'all', setAttribute: [0], getAttribute: 'all', removeAttribute: 'all', hasAttribute: 'all',
  addEventListener: [0], querySelector: 'all', querySelectorAll: 'all', getElementById: 'all', $: 'all', add: 'all', remove: 'all',
  toggle: 'all', contains: 'all', getItem: 'all', setItem: [0], removeItem: 'all', load: 'all', matchMedia: 'all', register: 'all',
  replaceState: 'all', replace: 'all', DateTimeFormat: 'all', indexOf: 'all', split: 'all', startsWith: 'all', includes: 'all',
  get: 'all', Error: 'all', api: 'all', fetch: 'all', esToggleButton: 'all', esNotice: [1], esMarkPlaces: 'all', closest: 'all',
  // A server line's field name, and the code a signed gate's line is kept by.
  esSayPick: [2], esSayTwin: [2], showSigned: [1],
};
// setAttribute's value is words for some attributes (aria-label, title…) — code only for these.
const CODE_ATTRS = new Set(['id', 'lang', 'autocorrect']);
const CODE_PROPS = new Set(['className', 'id', 'type', 'href', 'target', 'rel', 'autocomplete', 'autocapitalize', 'enterKeyHint', 'lang']);
const OPTION_KEYS = new Set(['hour', 'minute', 'weekday', 'month', 'day', 'timeZone', 'block', 'method', 'content-type', 'context', 'code', 'message', 'to', 'said']);
// Codes the page compares or passes on — written out so a new English word is never waved through.
const CODES = new Set([
  'use strict', 'clock_in_gate', 'friday_questionnaire', 'application/json', 'VA', 'arboGateStart:', 'GET', 'unknown', 'serviceWorker',
  'lib-q', 'lib-go', 'lib-out', 'nm-desc', 'nm-go', 'nm-out',
]);

function callName(n: ts.CallExpression | ts.NewExpression): string {
  const e = n.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return '';
}
function argIndex(call: ts.CallExpression | ts.NewExpression, node: ts.Node): number {
  return (call.arguments ?? []).findIndex((a) => a.pos <= node.pos && node.end <= a.end);
}
/** Why a literal is not words on the screen, or null when it is (and must be wrapped). */
function exempt(lit: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral): string | null {
  const text = lit.text;
  if (!/[A-Za-z]{2}/.test(text)) return 'no words';
  if (CODES.has(text)) return 'listed code';
  if (/^(?:\/|\?|&|#|https?:)/.test(text)) return 'a route or a link';
  let child: ts.Node = lit;
  for (let p: ts.Node | undefined = lit.parent; p; child = p, p = p.parent) {
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      const name = callName(p);
      const i = argIndex(p, child);
      if (i !== -1 && KEYED.has(name)) return 'wrapped';
      const code = CODE_CALLS[name];
      if (i !== -1 && code && (code === 'all' || code.includes(i))) return `code (${name})`;
      const a0 = p.arguments?.[0];
      if (name === 'setAttribute' && i === 1 && a0 && ts.isStringLiteral(a0) && CODE_ATTRS.has(a0.text)) return 'a code attribute';
    }
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) return 'a comparison';
    if (ts.isCaseClause(p)) return 'a case';
    if (ts.isPropertyAssignment(p)) {
      const key = p.name.getText(sf).replace(/^['"]|['"]$/g, '');
      if (child === p.name) return 'a property name';
      if (OPTION_KEYS.has(key)) return 'an option';
      if (key === 'es' || key === 'en') return 'a bilingual pair';
    }
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(p.left)
      && CODE_PROPS.has(p.left.name.text) && child === p.right) return 'a code property';
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && p.name.text === 'ES_PLACES') return 'the place → unit map';
    if (ts.isElementAccessExpression(p)) return 'an index';
    if (ts.isBlock(p) || ts.isSourceFile(p)) break;
  }
  return null;
}
function unwrapped(): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && exempt(n) === null) {
      out.push(`${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${JSON.stringify(n.text)}`);
    }
    if (ts.isTemplateExpression(n)) out.push(`${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: a template literal — use tf`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
function keyedCalls(): Array<{ name: string; key: string }> {
  const out: Array<{ name: string; key: string }> = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && KEYED.has(n.expression.text)) {
      const name = n.expression.text;
      const args = name === 'tn' ? [n.arguments[1], n.arguments[2]] : name === 'esSay' ? [n.arguments[1]] : [n.arguments[0]];
      for (const a of args) if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) out.push({ name, key: a.text });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('every word the crew door draws goes through the runtime', () => {
  it('no English literal reaches the screen unwrapped (each sentence is a T/tf/tn/esSay key)', () => {
    expect(unwrapped()).toEqual([]);
  });
  it('the scan bites: a bare sentence, a sentence glued from pieces and a template literal are each caught', () => {
    const probe = (src: string) => {
      const f = ts.createSourceFile('p.js', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const hits: string[] = [];
      const v = (n: ts.Node) => { if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && exempt(n) === null) hits.push(n.text); if (ts.isTemplateExpression(n)) hits.push('template'); ts.forEachChild(n, v); };
      v(f);
      return hits;
    };
    expect(probe("box.appendChild(el('div', 'state', 'Nothing scheduled'));")).toEqual(['Nothing scheduled']);
    expect(probe("x.textContent = 'Only ' + n + ' left';")).toEqual(['Only ', ' left']);
    expect(probe('x.textContent = `${n} left`;')).toEqual(['template']);
    expect(probe("box.appendChild(el('div', 'state', T('Nothing scheduled')));")).toEqual([]);
    expect(probe("if (e.message === 'off_roster') return;")).toEqual([]);
  });
  it('a value goes into a sentence only through tf/tn — no Spanish piece is ever glued to another', () => {
    // The old glue points, each now one template: the held count, the quiz shortfall, the read clock, the pay line.
    for (const key of [
      '{n} job on today’s sheet is on hold — no signed contract yet. Check with the office.',
      '{n} jobs on today’s sheet are on hold — no signed contract yet. Check with the office.',
      'Only {n} question(s) available — the office has not published enough yet. This is not a short week.',
      'read for {n}s more', '{n} min paid — on the clock.', 'Your sign-off could not be recorded ({why}).',
    ]) expect(keyedCalls().some((c) => c.key === key), key).toBe(true);
  });
});

describe('every place on the crew page has its unit, so Spanish mode marks nothing as English but data', () => {
  const places = new Function(`${/^const ES_PLACES = \{[\s\S]*?^\};$/m.exec(crew)?.[0] ?? 'const ES_PLACES = {};'}\nreturn ES_PLACES;`)() as Record<string, string>;
  it('each place’s unit file is there and served whole (nothing held back but unreviewed safety lines)', () => {
    const served = loadDoorDictionary('crew');
    for (const [sel, unit] of Object.entries(places)) {
      expect(crewUnits().map((u) => u.unit), `${sel} → ${unit}`).toContain(unit);
      expect(served.units[unit], unit).toBeDefined();
    }
    expect(served.broken).toEqual([]);
    for (const h of served.held) expect(isSafetyClass(h.key), `${h.unit}: ${h.key}`).toBe(true);
  });
  it('the crew door’s units are its places plus its shared reasons and the switch — nothing else', () => {
    expect(crewUnits().map((u) => u.unit).sort()).toEqual([...new Set([...Object.values(places), 'crew-switch', 'crew-why'])].sort());
  });
});

// The plan's safety-pair rule (R27 #4): a safety or legal line shows the Spanish first and the FULL
// English beneath. On the crew door that is the stop-work order in its three wordings. They are
// drafts: nothing in this unit is recorded as reviewed (the blind second pass and the
// back-translation come first), so each reads in English, marked, until its review is in the ledger.
const SAFETY_KEYS = [
  'Do not start work — call the office.',
  'Your work orders stay locked — do not start work; call the office to log your briefing.',
  'This is not an empty day — do not start work; call the office.',
];
describe('the crew door’s safety lines — through the pair helper, in the ledger as drafts only', () => {
  it('the safety-class keys are exactly the stop-work orders', () => {
    expect(Object.keys(crewDict()).filter(isSafetyClass).sort()).toEqual([...SAFETY_KEYS].sort());
  });
  it('each is drawn with esSay (Spanish over the full English), never with T or tf (no English beneath)', () => {
    for (const c of keyedCalls()) if (isSafetyClass(c.key)) expect(c.name, c.key).toBe('esSay');
    for (const k of SAFETY_KEYS) expect(keyedCalls().some((c) => c.name === 'esSay' && c.key === k), k).toBe(true);
  });
  it('each has a ledger entry for its exact Spanish — as a draft: no review is recorded in this unit', () => {
    const dict = crewDict();
    for (const k of SAFETY_KEYS) {
      const e = loadLedger().find((x) => x.en === k && x.es === dict[k]);
      expect(e, k).toBeDefined();
      expect(e!.pass, k).toBe('draft');
      expect(e!.reviewedBy, k).toBeUndefined();
      expect(e!.backTranslation, k).toBeUndefined();
    }
  });
  it('no entry anywhere in the ledger records a review yet (the Language phase records it, R27 #5)', () => {
    for (const e of loadLedger()) expect(e.pass, e.en).toBe('draft');
  });
  it('so the served crew dictionary holds every one back — Spanish mode shows the English, marked', () => {
    const held = loadDoorDictionary('crew').held.map((h) => h.key).sort();
    expect(held).toEqual([...SAFETY_KEYS].sort());
  });
});

describe('the crew door’s Spanish speaks with one voice — the glossary’s words, the English beside a trade term', () => {
  const dict = crewDict();
  it('a key naming a glossary term says that term’s Spanish (never a synonym that drifts)', () => {
    for (const t of [...TRADE_TERMS, ...APP_TERMS]) {
      const head = normalizeEs(t.es.replace(/\s*\(.*\)\s*$/, ''));
      const enRe = new RegExp(`\\b${t.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i');
      for (const [en, es] of Object.entries(dict)) {
        if (!enRe.test(en)) continue;
        const n = normalizeEs(es);
        // Kept in English as written (a search example the library will match) is the English beside.
        if (n.includes(normalizeEs(t.en))) continue;
        // A plural is the same words with the plural ending; the glossary names the singular.
        const stem = head.split(' ').map((w) => w.replace(/(?:es|s)$/, '').slice(0, Math.max(4, w.length - 2))).join('[a-z]* ');
        expect(new RegExp(stem).test(n), `${t.en} → "${t.es}": ${en} → ${es}`).toBe(true);
      }
    }
  });
  it('the near miss and the briefing keep their English beside in the panel titles the crew looks for', () => {
    expect(dict['Report a near miss']).toContain('(near miss)');
    expect(normalizeEs(dict['Morning safety briefing — required']!)).toContain('charla de seguridad');
    expect(dict["Today's work orders"]).toContain('(work orders)');
  });
});
