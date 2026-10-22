// R27 Phase A (es-owner-a) — the owner app's first screens in Spanish (docs/R27_SPANISH_PLAN.md,
// "Order of work" 3): Today (Before you roll, the feeds card, the weather, the hero and its strips),
// Leads and Calls & texts (the Sona flag, the segments, the chips, the lead rows, the call cards),
// Calendar (Today's stops, the maps sheet, the route planner, the embedded calendar), the key screen,
// the shell (the header, the dock, the sheets, Back, the toasts and the shared feed/error lines) and the
// Map page (src/app/map.html, its own small door dictionary — it follows the office app's arboLang).
//
// The same rules as the crew door (D111): every word goes through the runtime (T, tf, tn, esSay, esPair),
// one string literal per sentence, a value only through a slot (tf/tn), never a sentence glued from
// pieces; data passes through as typed; a safety or legal line only through the safety-pair helper —
// and every NEW safety-class line is a ledger DRAFT (no review is recorded here, so it shows in English,
// marked, until its blind review). English stays byte-identical: the English IS the dictionary key.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { unitFiles, readUnit, loadDoorDictionary } from '../src/i18n/dictionaries.js';
import { isSafetyClass, loadLedger, pairSha } from '../src/i18n/ledger.js';
import { esGateProblems } from '../src/i18n/gates.js';
import { findBannedEs, normalizeEs } from '../src/i18n/banList.js';
import { TRADE_TERMS, APP_TERMS } from '../src/i18n/glossary.js';
import { loadI18n, type I18n } from './support/i18nRuntime.js';
import { loadAppHtml, loadMapHtml } from '../src/server/appPage.js';
import { RECORDED_EN, HELD_EN } from './support/esRecorded.js';
import { OWNER_A_DRAFTS, OWNER_A_SCOPE, OWNER_A_STATEMENTS, OWNER_A_UNITS } from './support/esOwnerA.js';

const read = (f: string) => readFileSync(new URL(`../src/app/${f}`, import.meta.url), 'utf8');
const INDEX = read('index.html');
const MAP = read('map.html');
/** The page's own (last) inline script, and the line it starts on, for messages. */
function pageScript(html: string): { sf: ts.SourceFile; offset: number } {
  const at = html.lastIndexOf('<script>');
  const src = html.slice(at + 8, html.indexOf('</script>', at));
  return { sf: ts.createSourceFile('page.js', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), offset: html.slice(0, at).split('\n').length - 1 };
}
const APP = pageScript(INDEX);
const MAPJS = pageScript(MAP);

// What this unit covers in index.html (its scope) lives in test/support/esOwnerA.ts since D113, where the whole-app
// scan (test/esOwnerWhole.test.ts) reads it beside the other two units' scopes.
const MAP_UNITS = ['map-switch', 'map-page'] as const;

function topName(st: ts.Statement, sf: ts.SourceFile): string | null {
  if (ts.isFunctionDeclaration(st) && st.name) return st.name.text;
  if (ts.isVariableStatement(st)) return st.declarationList.declarations.map((d) => d.name.getText(sf)).join(',');
  return null;
}
function inScope(st: ts.Statement, sf: ts.SourceFile): boolean {
  const n = topName(st, sf);
  if (n !== null) return OWNER_A_SCOPE.includes(n);
  const text = st.getText(sf);
  return OWNER_A_STATEMENTS.some((s) => text.startsWith(s));
}
const scoped = (): ts.Statement[] => APP.sf.statements.filter((st) => inScope(st, APP.sf));

// ── The scan: a string literal is words on the screen unless it sits in a place that is code. ──
const KEYED = new Set(['T', 'tf', 'tn', 'esSay', 'esPair']);
// A Map, not an object literal: a call named like an Object.prototype member (toLocaleString, constructor) is looked up
// as written, never found on the prototype.
const CODE_CALLS = new Map<string, number[] | 'all'>(Object.entries({
  el: [0, 1], createElement: 'all', setAttribute: [0], getAttribute: 'all', removeAttribute: 'all', hasAttribute: 'all', addEventListener: [0],
  removeEventListener: [0], querySelector: 'all', querySelectorAll: 'all', getElementById: 'all', $: 'all', add: 'all', remove: 'all', toggle: 'all',
  contains: 'all', getItem: 'all', setItem: [0], removeItem: 'all', matchMedia: 'all', register: 'all', replaceState: 'all', pushState: 'all',
  replace: 'all', DateTimeFormat: 'all', indexOf: 'all', split: 'all', startsWith: 'all', endsWith: 'all', includes: 'all', get: 'all', has: 'all',
  Error: 'all', api: 'all', fetch: 'all', esToggleButton: 'all', esNotice: [1], esMarkPlaces: 'all', closest: 'all', esSayPick: [2], esSayTwin: [2],
  esPickEl: [0, 1, 3], esPick: [1], chip: [1], chipPair: [1], badge: [1], icon: 'all', svgEl: 'all', openPanel: 'all', switchTab: 'all', open: [1, 2],
  sysSet: [0, 1], toLocaleDateString: 'all', toLocaleTimeString: 'all', toLocaleString: 'all', closeSheet: 'all', sheetOpened: 'all', navPush: 'all',
  postMessage: 'all', mapPost: 'all', mapAim: 'all', openMap: 'all', test: 'all', match: 'all', RegExp: 'all', setProperty: 'all', scrollIntoView: 'all',
  padStart: 'all', join: 'all', localeCompare: 'all', encodeURIComponent: 'all', stat: [0, 2], ring: [0], legend: [0], go: [0], leadsTabBadge: [2],
  feedsCount: [0], feedText: [0], shellSay: [0], shellAttr: [0, 1], speak: 'all', cancel: 'all', layoutFor: 'all', has_: 'all', Map: 'all', Set: 'all',
} as Record<string, number[] | 'all'>));
const CODE_ATTRS = new Set(['id', 'lang', 'role', 'aria-live', 'aria-hidden', 'aria-disabled', 'frameborder', 'scrolling', 'aria-expanded', 'aria-pressed', 'aria-controls', 'aria-current', 'inputmode',
  'type', 'href', 'target', 'rel', 'tabindex', 'autocomplete', 'loading', 'referrerpolicy', 'allow', 'sandbox', 'src', 'enterkeyhint', 'aria-busy', 'for',
  'name', 'value', 'autocapitalize', 'spellcheck', 'class', 'autocorrect', 'data-roll', 'data-feed']);
const CODE_PROPS = new Set(['className', 'id', 'type', 'href', 'target', 'rel', 'autocomplete', 'autocapitalize', 'enterKeyHint', 'lang', 'src', 'inputMode',
  'loading', 'referrerPolicy', 'cssText', 'hash', 'name', 'value', 'allow', 'lang']);
const OPTION_KEYS = new Set(['hour', 'minute', 'weekday', 'month', 'day', 'year', 'timeZone', 'block', 'method', 'context', 'code', 'message', 'to', 'said',
  'behavior', 'error', 'kind', 'type', 'layer', 'rootMargin', 'tone', 'state', 'why', 'stage', 'view', 'cls', 'level']);
// Codes and names the page compares or passes on — written out, so a new English word is never waved through.
const CODES = new Set(['use strict', 'application/json', 'GET', 'POST', 'unknown', 'serviceWorker', 'ARBO', 'Art-is-Tree', 'VA', 'Arbo', 'Quo', 'Sona',
  // D113: a desk's name (R26), as written — the Leads hub's eyebrow says it as Office, Agents and Teach Arbo do (one voice).
  'Front Desk',
  'Gmail', 'Google Maps', 'TomTom', 'PDF', 'WEEK', 'AGENDA', 'America/New_York', ' · Art-is-Tree',
  // A 12-hour clock's suffix (clock12, the planner's t12): the time's format, not a word.
  ' AM', ' PM',
  // Names as written: the calendar's own name, and the route planner's example of an address (an address is data).
  '\u25CF Google Calendar \u2014 Art-is-Tree', '123 Example St, Virginia Beach, 23451\n45 Example Rd, Norfolk, 23503',
  // leadsTabBadge's own code: a half's gap marker ('gap:unread:2').
  'gap:',
  // The map's truck label when Bouncie gives no name: the VIN's or the device's last four, as an identifier.
  'VIN …', 'Bouncie …']);

function callName(n: ts.CallExpression | ts.NewExpression): string {
  const e = n.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return '';
}
function argIndex(call: ts.CallExpression | ts.NewExpression, node: ts.Node): number {
  return (call.arguments ?? []).findIndex((a) => a.pos <= node.pos && node.end <= a.end);
}
// Where words land on the screen: a literal there is words, even a single lower-case one ('maybe', 'sent').
const DISPLAY_ARG: Record<string, number[]> = { el: [2], chip: [0], badge: [0], Option: [0], tile: [1], state: [0, 1], readOnlyToast: [0], talkStatus: [0] };
const DISPLAY_PROPS = new Set(['textContent', 'title', 'placeholder', 'alt']);
const DISPLAY_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt']);
/** True when the literal sits where the page draws it: a display argument, a text property, a label attribute. */
function inDisplaySlot(lit: ts.Node): boolean {
  let child: ts.Node = lit;
  for (let p: ts.Node | undefined = lit.parent; p; child = p, p = p.parent) {
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      const name = callName(p);
      const i = argIndex(p, child);
      if (i === -1) return false;
      if ((Object.hasOwn(DISPLAY_ARG, name) ? DISPLAY_ARG[name]! : []).includes(i)) return true;
      const a0 = p.arguments?.[0];
      if (name === 'setAttribute' && i === 1 && a0 && ts.isStringLiteral(a0) && DISPLAY_ATTRS.has(a0.text)) return true;
      return false;
    }
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && child === p.right) {
      return ts.isPropertyAccessExpression(p.left) && DISPLAY_PROPS.has(p.left.name.text);
    }
    if (ts.isBlock(p) || ts.isSourceFile(p) || ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isArrayLiteralExpression(p) || ts.isReturnStatement(p)) return false;
  }
  return false;
}
// English an older pin reads word for word, kept exactly as written; the Spanish takes its place beside it, by the
// SAME key: `const em = b.appendChild(chip('EMERGENCY', 'alarm'));` then `if (ES.lang === 'es') em.replaceChildren(esPair('EMERGENCY'));`,
// or `el('button', 'hudbtn', 'Phone line')` then `if (ES.lang === 'es') talkBtn.textContent = T('Phone line');`.
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function swappedBeside(lit: ts.Node, sf: ts.SourceFile): boolean {
  let st: ts.Node = lit;
  while (st.parent && !ts.isBlock(st.parent) && !ts.isSourceFile(st.parent)) st = st.parent;
  const list = (st.parent as ts.Block | ts.SourceFile | undefined)?.statements;
  const next = list ? list[list.indexOf(st as ts.Statement) + 1] : undefined;
  if (!next) return false;
  const key = escRe(`'${(lit as ts.StringLiteral).text}'`);
  return new RegExp(`^if \\(ES\\.lang === 'es'\\) \\w+\\.(?:replaceChildren\\(esPair\\(${key}\\)\\)|textContent = T\\(${key}\\));$`).test(next.getText(sf));
}
// Route the day: P7 pins the English expression itself (directionB_navigate, unchanged); Spanish is its own tn branch.
const PINNED_EN_BRANCH = ["'Route the day (' + plural(addrs.length, 'stop') + ')'"];
function pinnedEnglishBranch(lit: ts.Node, sf: ts.SourceFile): boolean {
  for (let p: ts.Node | undefined = lit.parent; p; p = p.parent) {
    if (ts.isConditionalExpression(p)) {
      return p.condition.getText(sf) === "ES.lang === 'es'" && PINNED_EN_BRANCH.includes(p.whenFalse.getText(sf))
        && ts.isCallExpression(p.whenTrue) && ts.isIdentifier(p.whenTrue.expression) && KEYED.has(p.whenTrue.expression.text);
    }
    if (ts.isBlock(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}
function exempt(lit: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral, sf: ts.SourceFile): string | null {
  const text = lit.text;
  if (swappedBeside(lit, sf)) return 'English as pinned, its Spanish swapped in beside it by the same key';
  if (pinnedEnglishBranch(lit, sf)) return 'the pinned English branch of a Spanish swap';
  if (!/[A-Za-z]{2}/.test(text)) return 'no words';
  if (CODES.has(text)) return 'listed code or name';
  if (/^(?:\/|\?|&|#|https?:|i-|:|\[|\.)/.test(text)) return 'a route, link, id, key suffix or selector';
  if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/.test(text) || /^[A-Z]+(?:_[A-Z]+)+$/.test(text)) return 'a code word';
  if (/^[a-z]{2}-[A-Z]{2}$/.test(text)) return 'a locale';
  if (/^--[a-z]/.test(text) || /^[a-zA-Z]+=/.test(text)) return 'a CSS custom property or a query parameter';
  // One lower-case word, or a list of class names ('hot wide', 'feed-state cut'), outside a display slot: a code
  // the page compares, passes on or styles by (a tone, a kind, a key, a class).
  if (/^[a-z][a-zA-Z]*(?:[ -][a-z][a-zA-Z]*)*$/.test(text) && !/ [a-z]+ [a-z]+ /.test(text) && !inDisplaySlot(lit)) return 'a code word or class';
  let child: ts.Node = lit;
  for (let p: ts.Node | undefined = lit.parent; p; child = p, p = p.parent) {
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      const name = callName(p);
      const i = argIndex(p, child);
      if (i !== -1 && KEYED.has(name)) return 'wrapped';
      const code = CODE_CALLS.get(name);
      if (i !== -1 && code && (code === 'all' || code.includes(i))) return `code (${name})`;
      const a0 = p.arguments?.[0];
      if (name === 'setAttribute' && i === 1 && a0 && ts.isStringLiteral(a0) && (CODE_ATTRS.has(a0.text) || a0.text.startsWith('data-'))) return 'a code attribute';
    }
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(p.operatorToken.kind)) return 'a comparison';
    if (ts.isCaseClause(p)) return 'a case';
    if (ts.isPropertyAssignment(p)) {
      const key = p.name.getText(sf).replace(/^['"]|['"]$/g, '');
      if (child === p.name) return 'a property name';
      if (OPTION_KEYS.has(key)) return 'an option';
    }
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(p.left) && child === p.right) {
      if (CODE_PROPS.has(p.left.name.text)) return 'a code property';
      const owner = p.left.expression;
      if (ts.isPropertyAccessExpression(owner) && (owner.name.text === 'dataset' || owner.name.text === 'style')) return 'a dataset or style value';
    }
    // PERMIT_STATE's labels reach the screen only through permitChip, each as its own esPair key (and the Permit
    // Desk reads them as codes); the rest are tables of codes.
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && ['ES_PLACES', 'MAP_HOME', 'MAP_LAYER_OF', 'VIEW_ALIAS', 'DOCK_OF', 'NAV_PARENT',
      'SHEETS', 'DESK_VIEW', 'PLAN_LINE_CLASS', 'TALK_AUDIO_SESSION', 'SONA_DONE_KEY', 'CONTACT_LINE', 'GCAL_ID', 'PERMIT_STATE'].includes(p.name.text)) return 'a code table';
    if (ts.isElementAccessExpression(p) && child === p.argumentExpression) return 'an index';
    if (ts.isBlock(p) || ts.isSourceFile(p)) break;
  }
  return null;
}
function unwrappedIn(statements: readonly ts.Node[], sf: ts.SourceFile, offset: number): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && exempt(n, sf) === null) {
      out.push(`${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 + offset}: ${JSON.stringify(n.text)}`);
    }
    if (ts.isTemplateExpression(n)) out.push(`${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 + offset}: a template literal — use tf`);
    ts.forEachChild(n, visit);
  };
  for (const s of statements) visit(s);
  return out;
}
/** Every keyed call's literal key in these statements, with the call's name. */
function keyedCalls(statements: readonly ts.Node[]): Array<{ name: string; key: string }> {
  const out: Array<{ name: string; key: string }> = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && KEYED.has(n.expression.text)) {
      const name = n.expression.text;
      const args = name === 'tn' ? [n.arguments[1], n.arguments[2]] : name === 'esSay' ? [n.arguments[1]] : [n.arguments[0]];
      for (const a of args) if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) out.push({ name, key: a.text });
    }
    ts.forEachChild(n, visit);
  };
  for (const s of statements) visit(s);
  return out;
}
/** A translated piece glued to English words: `T('…') + ' words'` or `'words ' + tf(…)`. */
function gluedIn(statements: readonly ts.Node[], sf: ts.SourceFile, offset: number): string[] {
  const out: string[] = [];
  const isKeyed = (n: ts.Node): boolean => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ['T', 'tf', 'tn'].includes(n.expression.text);
  const isWords = (n: ts.Node): boolean => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && /[A-Za-z]{2}/.test(n.text);
  const visit = (n: ts.Node) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken
      && ((isKeyed(n.left) && isWords(n.right)) || (isWords(n.left) && isKeyed(n.right)))) {
      out.push(`${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 + offset}: ${n.getText(sf).slice(0, 80)}`);
    }
    ts.forEachChild(n, visit);
  };
  for (const s of statements) visit(s);
  return out;
}

const unitsOf = (door: string) => unitFiles().filter((u) => u.door === door);
const unitDict = (names: readonly string[]): Record<string, string> =>
  Object.assign({}, ...names.map((u) => readUnit(`${u}.es.json`) ?? {}));
const OWN = (): Record<string, string> => unitDict(OWNER_A_UNITS);

describe('every word these screens draw goes through the runtime (index.html: Today, Leads, Calls & texts, Calendar, the key screen, the shell)', () => {
  it('the scope names real declarations — nothing listed is missing from the page', () => {
    const names = new Set(APP.sf.statements.map((s) => topName(s, APP.sf)).filter(Boolean));
    expect(OWNER_A_SCOPE.filter((n) => !names.has(n))).toEqual([]);
    for (const s of OWNER_A_STATEMENTS) expect(APP.sf.statements.some((st) => st.getText(APP.sf).startsWith(s)), s).toBe(true);
  });
  it('no English literal reaches the screen unwrapped (each sentence is a T/tf/tn/esSay/esPair key)', () => {
    expect(unwrappedIn(scoped(), APP.sf, APP.offset)).toEqual([]);
  });
  it('no translated piece is glued to English words, and no key is a fragment that starts or ends with a space', () => {
    expect(gluedIn(scoped(), APP.sf, APP.offset)).toEqual([]);
    for (const c of keyedCalls(scoped())) expect(/^\s|\s$/.test(c.key), JSON.stringify(c.key)).toBe(false);
  });
  it('the scan bites: a bare sentence, a sentence glued from pieces, a template literal and glue onto a key are each caught', () => {
    const probe = (src: string) => {
      const sf = ts.createSourceFile('p.js', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      return [...unwrappedIn(sf.statements, sf, 0), ...gluedIn(sf.statements, sf, 0)].map((l) => l.replace(/^\d+: /, ''));
    };
    expect(probe("box.appendChild(el('div', 'state', 'Nothing scheduled'));")).toEqual(['"Nothing scheduled"']);
    expect(probe("x.textContent = 'Only ' + n + ' left';")).toEqual(['"Only "', '" left"']);
    expect(probe('x.textContent = `${n} left`;')).toEqual(['a template literal — use tf']);
    expect(probe("x.textContent = T('Calls') + ' today';")).toEqual(['" today"', "T('Calls') + ' today'"]);
    expect(probe("box.appendChild(el('div', 'state', T('Nothing scheduled')));")).toEqual([]);
    expect(probe("if (e.message === 'not_simulated') return;")).toEqual([]);
    // English kept as a pin reads it is waved through only with its Spanish swapped in beside it, by the same key.
    expect(probe("const c = b.appendChild(chip('EMERGENCY', 'alarm'));\nif (ES.lang === 'es') c.replaceChildren(esPair('EMERGENCY'));")).toEqual([]);
    expect(probe("const c = b.appendChild(chip('EMERGENCY', 'alarm'));")).toEqual(['"EMERGENCY"']);
    expect(probe("const c = b.appendChild(chip('EMERGENCY', 'alarm'));\nif (ES.lang === 'es') c.replaceChildren(esPair('POWER LINES'));")).toEqual(['"EMERGENCY"']);
    expect(probe("const b = el('button', 'x', 'Phone line');\nif (ES.lang === 'es') b.textContent = T('Phone line');")).toEqual([]);
    expect(probe("const r = el('a', 'x', ES.lang === 'es' ? tn(n, 'A ({n} stop)', 'A ({n} stops)') : 'Other ' + plural(n, 'stop'));")).toEqual(['"Other "']); // 'stop' is plural's code word
  });
});

describe('the map page (src/app/map.html) — its own small door dictionary, following the office app’s language', () => {
  it('no English literal in its script reaches the screen unwrapped, and nothing is glued', () => {
    expect(unwrappedIn(MAPJS.sf.statements, MAPJS.sf, MAPJS.offset)).toEqual([]);
    expect(gluedIn(MAPJS.sf.statements, MAPJS.sf, MAPJS.offset)).toEqual([]);
  });
  it('carries the marker once, right before its own script and after Leaflet; served, the map door’s units only', () => {
    expect(MAP.split('<!--ARBO:I18N-->')).toHaveLength(2);
    expect(MAP).toMatch(/<script src="\/map\/leaflet\.js"><\/script>\n<!--ARBO:I18N-->\n<script>\n'use strict';/);
    const served = loadMapHtml();
    const m = /<script type="application\/json" id="arbo-i18n" data-door="map">([\s\S]*?)<\/script>/.exec(served);
    expect(m).not.toBeNull();
    const cfg = JSON.parse(m![1]!) as { door: string; units: Record<string, unknown>; broken: string[] };
    expect(cfg.door).toBe('map');
    expect(Object.keys(cfg.units).sort()).toEqual([...MAP_UNITS].sort());
    expect(cfg.broken).toEqual([]);
  });
  it('the map door follows the office app’s setting (arboLang) — never the crew door’s', () => {
    const units = { 'map-switch': readUnit('map-switch.es.json')! };
    expect(loadI18n({ door: 'map', units, stored: { arboLang: 'es' } }).ES.lang).toBe('es');
    expect(loadI18n({ door: 'map', units, stored: { arboCrewLang: 'es' } }).ES.lang).toBe('en');
    expect(loadI18n({ door: 'map', units }).ES.key).toBe('arboLang');
    // Another door's dictionary in the map's page keeps it English (the runtime's door check).
    expect(loadI18n({ door: 'map', json: JSON.stringify({ door: 'app', units }), stored: { arboLang: 'es' } }).ES.lang).toBe('en');
  });
  it('parity: every key the map uses is in its dictionary, and every map key is used', () => {
    const used = new Set(keyedCalls(MAPJS.sf.statements).map((c) => c.key));
    const runtime = ['English', 'in English', 'Safety notice — only in English for now; ask someone to read it to you:'];
    const dict = new Set(unitsOf('map').flatMap((u) => Object.keys(readUnit(u.file) ?? {})));
    expect([...used].filter((k) => !dict.has(k))).toEqual([]);
    expect([...dict].filter((k) => !used.has(k) && !runtime.includes(k))).toEqual([]);
    expect(unitsOf('map').map((u) => u.unit).sort()).toEqual([...MAP_UNITS].sort());
  });
});

describe('a dictionary per place — every place this unit owns has its unit, served whole', () => {
  const places = new Function(`${/^const ES_PLACES = \{[\s\S]*?^\};$/m.exec(INDEX)?.[0] ?? 'const ES_PLACES = {};'}\nreturn ES_PLACES;`)() as Record<string, string>;
  const mine = Object.entries(places).filter(([, u]) => (OWNER_A_UNITS as readonly string[]).includes(u));
  it('the key screen, the header, the dock, the sheets, Today, Leads, Calls & texts, Calendar and the map frame are this unit’s places', () => {
    expect(mine.map(([sel]) => sel).sort()).toEqual(['#appbar', '#keywall', '#leads-head', '#view-cal', '#view-calls', '#view-leads', '#view-map', '#view-today', '.sheet', 'nav'].sort());
  });
  it('each place’s unit file is there and nothing in it is held back but a safety line whose review is not recorded', () => {
    const served = loadDoorDictionary('app');
    expect(served.broken).toEqual([]);
    for (const u of OWNER_A_UNITS) expect(served.units[u], u).toBeDefined();
    for (const h of served.held.filter((x) => (OWNER_A_UNITS as readonly string[]).includes(x.unit))) expect(isSafetyClass(h.key), `${h.unit}: ${h.key}`).toBe(true);
  });
  it('every key these screens use is in this unit’s files (or the switch unit), and every key in them is used by the page', () => {
    const own = OWN();
    const sw = readUnit('app-switch.es.json') ?? {};
    const used = keyedCalls(scoped()).map((c) => c.key);
    expect([...new Set(used)].filter((k) => !(k in own) && !(k in sw))).toEqual([]);
    const pageKeys = new Set(keyedCalls(APP.sf.statements).map((c) => c.key));
    expect(Object.keys(own).filter((k) => !pageKeys.has(k))).toEqual([]);
  });
  it('the served office app carries these units, and the map page carries none of them', () => {
    const app = loadAppHtml();
    for (const u of OWNER_A_UNITS) expect(app).toContain(`"${u}":`);
    expect(loadMapHtml()).not.toContain('"app-today":');
  });
});

describe('every Spanish line here passes the ban list and every gate — usted, the numbers, the negations, the hedges, the slots', () => {
  const all = { ...OWN(), ...unitDict(MAP_UNITS) };
  it('the gates', () => {
    const bad = Object.entries(all).map(([en, es]) => ({ en, p: esGateProblems(en, es) })).filter((x) => x.p.length);
    expect(bad).toEqual([]);
  });
  it('the ban list', () => {
    expect(Object.entries(all).filter(([, es]) => findBannedEs(es).length).map(([en]) => en)).toEqual([]);
  });
  it('STOP is never translated, and nothing is left untranslated by accident (the Spanish differs from the English, names and codes aside)', () => {
    for (const [en, es] of Object.entries(all)) if (/\bSTOP\b(?!\s+WORK)/.test(en)) expect(es, en).toMatch(/\bSTOP\b/);
    // The same in both languages on purpose: a word Spanish shares, and Sona's name.
    const SAME_OK = new Set(['Video', 'Sona (Quo)', 'Sona: {text}']);
    const same = Object.entries(all).filter(([en, es]) => en === es && !SAME_OK.has(en) && /[a-z]{3}/.test(en.replace(/\{\w+\}/g, '')));
    expect(same.map(([en]) => en)).toEqual([]);
  });
  it('a key naming a glossary term says that term’s Spanish (one voice with the crew door)', () => {
    for (const t of [...TRADE_TERMS, ...APP_TERMS]) {
      const head = normalizeEs(t.es.replace(/\s*\(.*\)\s*$/, ''));
      const enRe = new RegExp(`\\b${t.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i');
      for (const [en, es] of Object.entries(all)) {
        if (!enRe.test(en) || RECORDED_EN.includes(en)) continue; // a recorded label's words are the blind review's (D112)
        const n = normalizeEs(es);
        if (n.includes(normalizeEs(t.en))) continue;
        const stem = head.split(' ').map((w) => w.replace(/(?:es|s)$/, '').slice(0, Math.max(4, w.length - 2))).join('[a-z]* ');
        expect(new RegExp(stem).test(n), `${t.en} → "${t.es}": ${en} → ${es}`).toBe(true);
      }
    }
  });
});

// ── Safety and legal lines (R27 #4): only through the safety-pair helper, and every NEW one a DRAFT
// (test/support/esOwnerA.ts). A label D112 recorded is used word for word; HELD is D112's own draft. ──
describe('safety and legal lines — only through the safety-pair helper; every new one a ledger DRAFT (no review recorded)', () => {
  const own = OWN();
  const mapDict = unitDict(MAP_UNITS);
  it('every safety-class key these screens use is drawn by esSay or esPair — never T, tf or tn (no English beneath)', () => {
    for (const c of [...keyedCalls(scoped()), ...keyedCalls(MAPJS.sf.statements)]) if (isSafetyClass(c.key)) expect(['esSay', 'esPair'], c.key).toContain(c.name);
  });
  it('each has a ledger entry for its exact pair; the new ones are exactly OWNER_A_DRAFTS, all at pass "draft"', () => {
    const safety = [...new Set([...Object.entries(own), ...Object.entries(mapDict)].filter(([en]) => isSafetyClass(en)).map(([en]) => en))];
    for (const en of safety) {
      const es = own[en] ?? mapDict[en]!;
      const e = loadLedger().find((x) => x.en === en && x.es === es);
      expect(e, en).toBeDefined();
      expect(e!.sha).toBe(pairSha(en, es));
      if (RECORDED_EN.includes(en)) continue; // a label already recorded (D112), used word for word
      expect(e!.pass, en).toBe('draft');
      expect(e!.reviewedBy, en).toBeUndefined();
      expect(e!.note, en).toMatch(/^Not recorded/);
    }
    expect(safety.filter((en) => !RECORDED_EN.includes(en) && !HELD_EN.includes(en)).sort()).toEqual([...OWNER_A_DRAFTS].sort());
  });
  it('so the served dictionary holds each draft back — Spanish mode shows the English, marked, until its blind review is recorded', () => {
    const served = loadDoorDictionary('app');
    for (const en of [...OWNER_A_DRAFTS, 'HELD']) {
      expect(en in own, en).toBe(true);
      expect(Object.values(served.units).some((u) => en in u), en).toBe(false);
    }
    expect(Object.values(loadDoorDictionary('map').units).some((u) => 'EMERGENCY' in u)).toBe(false);
  });
});

// ── Spanish draws over the REAL runtime: the page's own functions, lifted, on a fake DOM. ──
const fnSrc = (name: string): string => {
  // A one-line function first: the many-line pattern would run on to the next function's closing brace.
  const m = new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\}$`, 'm').exec(INDEX) ?? new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(INDEX);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
};
const constSrc = (name: string): string => {
  // A one-line const (a trailing comment allowed) first: the many-line pattern would run on to the next const's closing brace.
  const m = new RegExp(`^const ${name} = [^\\n]*;(?:\\s*//[^\\n]*)?$`, 'm').exec(INDEX) ?? new RegExp(`^const ${name} = \\{[\\s\\S]*?^\\};$`, 'm').exec(INDEX);
  if (!m) throw new Error(`no const ${name} in the page`);
  return m[0];
};
const SERVED = loadDoorDictionary('app');
function runtime(lang: 'en' | 'es'): I18n {
  return loadI18n({ door: 'app', units: SERVED.units, stored: lang === 'es' ? { arboLang: 'es' } : {} });
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Lifted = Record<string, any>;
function lift(rt: I18n, consts: string[], fns: string[], extra: Record<string, unknown> = {}): Lifted {
  const doc = rt.doc;
  const el = (tag: string, cls?: string, text?: string) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const deps: Record<string, unknown> = {
    T: rt.T, tf: rt.tf, tn: rt.tn, esSay: rt.esSay, esPair: rt.esPair, esSayTwin: rt.esSayTwin, esEnMark: rt.esEnMark, esLocale: rt.esLocale, ES: rt.ES,
    document: doc, el, $: (id: string) => doc.getElementById(id), LINKS: 'simulation', showKeywall: () => {}, ...extra,
  };
  const body = `${consts.map(constSrc).join('\n')}\n${fns.map(fnSrc).join('\n')}\nreturn { ${[...consts, ...fns].join(', ')} };`;
  return new Function(...Object.keys(deps), body)(...Object.values(deps)) as Lifted;
}
const SHARED_CONSTS = ['FEED_WORD', 'FEED_TAG', 'FEED_SAYS', 'RETRY', 'READ_ONLY_LINE', 'TONE', 'PERMIT_STATE'];
const SHARED_FNS = ['feedKind', 'feedLine', 'feedState', 'saveFailText', 'state', 'chip', 'badge', 'permitChip', 'routeLeftOut', 'stopAddress'];

describe('the shared lines in Spanish — every failure still named (§1B), now in Spanish; English exactly as before', () => {
  const en = lift(runtime('en'), SHARED_CONSTS, SHARED_FNS);
  const es = lift(runtime('es'), SHARED_CONSTS, SHARED_FNS);
  const errs = { cut: { code: 503, message: 'link_cut' }, sim: { code: 503, message: 'not_simulated' }, unset: { code: 503, message: 'not_built' }, unread: { code: 500, message: 'error' } };
  it('a feed line: English byte-identical to the old glue; Spanish one sentence, the name passed through as given', () => {
    expect(en.feedLine(errs.cut, 'Calls').textContent).toBe('Calls: cut on purpose.');
    expect(en.feedLine(errs.unread, 'Calls', 'That doesn’t mean there are none.').textContent).toBe('Calls: couldn’t read it. Tap ↻ at the top to try again. That doesn’t mean there are none.');
    expect(en.feedLine(errs.sim, 'Calls').textContent).toBe('Calls: not in the practice data.');
    expect(en.feedLine(errs.unset, 'Calls').textContent).toBe('Calls: not set up yet.');
    for (const k of Object.keys(errs) as Array<keyof typeof errs>) {
      const s = es.feedLine(errs[k], 'Llamadas').textContent as string;
      expect(s.startsWith('Llamadas: ' + es.FEED_WORD[k]), `${k}: ${s}`).toBe(true); // the feeds card's "said already" check holds in Spanish
      expect(s).not.toMatch(/cut on purpose|couldn’t read|practice data|set up/);
    }
  });
  it('a feed card: the title names the gap, the body says it is not an empty list — in Spanish', () => {
    const en1 = en.feedState(errs.unread, 'Schedule', 'an empty day');
    expect(en1.querySelector('b').textContent).toBe('Schedule — couldn’t read it');
    expect(en1.textContent).toBe('Schedule — couldn’t read itThe read failed just now. Tap ↻ at the top to try again. This is not an empty day.');
    const es1 = es.feedState(errs.unread, 'Agenda', 'un día vacío'); // the caller's own words, already in Spanish
    expect(es1.textContent).toContain('no se pudo leer');
    expect(es1.textContent).toContain('Esto no es');
    expect(es1.textContent).not.toMatch(/This is not|couldn’t/);
  });
  it('a save that failed says so — every reason in Spanish, the server’s own read-only line passed through', () => {
    const cases = [errs.cut, errs.sim, errs.unset, errs.unread, {}, null];
    for (const e of cases) {
      const english = en.saveFailText(e) as string;
      expect(english.startsWith('Not saved — ')).toBe(true);
      const spanish = es.saveFailText(e) as string;
      expect(spanish, english).toMatch(/^No se guardó/);
    }
    expect(es.saveFailText({ code: 503, message: 'read_only', line: 'Server words.' })).toBe('Server words.');
    expect(en.saveFailText({ code: 503, message: 'read_only' })).toBe('Read-only: Arbo can look but not save. Nothing was written.');
  });
  it('a permit chip: in English the label as before; in Spanish the recorded label over its full English (D112)', () => {
    expect(en.permitChip('PERMIT_LIKELY').textContent).toBe('PERMIT LIKELY');
    expect(en.permitChip('nonsense').textContent).toBe('NO OVERLAY — VERIFY W/ CITY');
    const c = es.permitChip('PERMIT_LIKELY');
    expect(c.querySelector('.es-pair-es').textContent).toBe('PROBABLEMENTE SE NECESITA PERMISO');
    expect(c.querySelector('.es-pair-en').textContent).toBe('inglés PERMIT LIKELY');
    expect(c.className).toBe('badge t-watch');
  });
  it('every word in the permit map has its own pair in permitChip; a word it has no pair for stays the English chip', () => {
    for (const status of Object.keys(es.PERMIT_STATE)) {
      const c = es.permitChip(status);
      expect(c.querySelector('.es-pair-en')?.textContent, status).toBe('inglés ' + es.PERMIT_STATE[status][0]);
    }
    // A renamed word (the map changed, the pair did not): the English chip, never another state's Spanish.
    const renamed = lift(runtime('es'), SHARED_CONSTS, SHARED_FNS, {});
    renamed.PERMIT_STATE.PERMIT_LIKELY[0] = 'PERMIT PROBABLE';
    const r = renamed.permitChip('PERMIT_LIKELY');
    expect(r.textContent).toBe('PERMIT PROBABLE');
    expect(r.querySelector('.es-pair-es')).toBeNull();
  });
  it('a stop left out of the route: one sentence, the count by tn, the names as written', () => {
    const stops = [{ name: 'SIM Ana' }, { name: '' }, { address: '1 SIM Row', name: 'x' }];
    expect(en.routeLeftOut(stops).textContent).toBe('⚠ Not in the route: 2 stops with no street on file — SIM Ana, Unnamed.');
    expect(en.routeLeftOut([stops[0]]).textContent).toBe('⚠ Not in the route: 1 stop with no street on file — SIM Ana.');
    const s = es.routeLeftOut(stops).textContent as string;
    expect(s).toContain('SIM Ana');
    expect(s).not.toMatch(/Not in the route|Unnamed/);
  });
});

// ── What the browser check (390x844 and 320x640, sim / cut / read-only) found in Spanish, kept fixed. ──
describe('Spanish on a small phone — the browser check’s findings stay fixed (English untouched)', () => {
  const css = INDEX.slice(0, INDEX.indexOf('</style>'));
  it('at 320px the Spanish dock words fit: each button takes its word’s room, never under 44px; English keeps equal fifths', () => {
    expect(css).toContain('@media (max-width:359px){html[lang="es"] nav button{flex:1 1 auto;min-width:44px}}');
    expect(css).toContain('nav button{flex:1 1 0;min-width:0;min-height:56px;');
  });
  it('a long Spanish sheet title never squeezes Close under 44px', () => {
    expect(css).toContain('.sheet-head > button{flex:none}');
  });
  it('the hero never pushes a Spanish stat off the screen, and a long systems chip wraps inside it', () => {
    expect(css).toContain('html[lang="es"] .hstat span,html[lang="es"] .hstat small{letter-spacing:.08em;-webkit-hyphens:auto;hyphens:auto}');
    expect(css).toContain('@media (max-width:389px){html[lang="es"] .hero-stats{grid-template-columns:repeat(2,minmax(0,1fr))}html[lang="es"] .hero-stats > :last-child{grid-column:1 / -1}html[lang="es"] .hstat span,html[lang="es"] .hstat small{overflow-wrap:anywhere}}');
    expect(css).toContain('html[lang="es"] .sys{white-space:normal;max-width:100%;line-height:1.25}');
    expect(css).toContain('.hero-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:16px}'); // English as before
  });
  it('an "en inglés" mark inside a chip reads in the chip’s own colour', () => {
    expect(css).toContain('.badge .es-en-mark{color:inherit;border-color:currentColor;opacity:.85}');
  });
  it('a fleet row in Spanish is one block of text (the pair inside one span); in English the button holds the line itself', () => {
    expect(INDEX).toContain("const t = ES.lang === 'es' ? b.appendChild(el('span')) : b;");
    expect(INDEX).toContain("esSay(t, 'HELD', lead);");
    expect(INDEX).toContain("} else esSay(t, 'DOWN', lead);");
  });
  it('the systems chip says simulation and unknown in the page’s language (English unchanged)', () => {
    expect(INDEX).toContain(": d === 'simulation' ? T('simulation') : d === 'unknown' ? T('unknown') : d);");
  });
  it('a server line is never passed off as Spanish: the blind spot, the Quo wiring detail and the map’s own server lines are marked "en inglés"', () => {
    expect(INDEX).toContain("row(k, ES.lang === 'es' ? (n) => { n.appendChild(el('span', '', line)).appendChild(esEnMark()); } : line,");
    expect(INDEX).toContain("reg.replaceChildren(esSayTwin(el('span'), st.registration, 'detail'));");
    expect(MAP).toContain("if (g.en && ES.lang === 'es') { said.setAttribute('lang', 'en'); said.appendChild(esEnMark()); }");
    expect(MAP).toContain('en: g.text === d.line || g.text === d.tomtomLine }));');
  });
  it('a count Spanish cannot agree with stays number-invariant ("1 con alerta", never "1 marcadas")', () => {
    const today = readUnit('app-today.es.json')!;
    expect(today['{n} flagged']).toBe('{n} con alerta');
    expect(today['{n} read — sorting continues for a few minutes']).toBe('leídos: {n} — el orden sigue unos minutos');
    expect(readUnit('app-leads.es.json')!['{label}: {n} counted, {state} — not the whole count']).toBe('{label}: {n} en la cuenta, {state} — no es la cuenta completa');
  });
});
