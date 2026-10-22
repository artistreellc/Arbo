// R27 Phase A, owner app (builder b) — docs/R27_SPANISH_PLAN.md, "Order of work" 3: the owner app's
// Estimate hub (prep from a lead, the Yard check, the permit result), Permit rules, Properties on file,
// Follow-ups, Money, Fleet (the truck lines, the breakdown sheet, HELD) and Crew & safety (the roster,
// Send sign-in link, the training board, the near-miss review, certifications, the safety lessons and
// the library) in Spanish — exactly as the crew door does it (D111): T / tf / tn, one literal per
// sentence, a safety line only through the safety pair (esSay), and the server's own lines in English,
// marked "en inglés", until Phase B gives them twins.
//
// What this file proves:
//   - no English literal on these screens reaches the screen unwrapped, and no sentence is glued from pieces;
//   - every screen (and its sheet) has its own dictionary, served whole but for safety drafts;
//   - every safety-class key goes through esSay, and each NEW one is a ledger DRAFT — nothing is reviewed;
//   - the Spanish speaks with the glossary's words;
//   - run over the REAL runtime and the dictionaries as served, each screen draws Spanish — data as written,
//     the shared dead-feed words in English and marked, a safety label as its pair (or the pointer) —
//     and English mode draws exactly the English.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { unitFiles, readUnit, loadDoorDictionary } from '../src/i18n/dictionaries.js';
import { isSafetyClass, loadLedger, pairSha } from '../src/i18n/ledger.js';
import { TRADE_TERMS, APP_TERMS } from '../src/i18n/glossary.js';
import { normalizeEs, findBannedEs } from '../src/i18n/banList.js';
import { esGateProblems } from '../src/i18n/gates.js';
import { OWNER_B_DRAFTS, OWNER_B_REUSED } from './support/esOwnerB.js';
import { RECORDED_EN, HELD_EN } from './support/esRecorded.js';
import { loadI18n, fakeDoc, FakeNode, type I18n } from './support/i18nRuntime.js';

const raw = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
const script = [...raw.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).join('\n');
const sf = ts.createSourceFile('index.html', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

// ── This unit's code, by screen: top-level functions, tables and the sheets' listeners ($('id')). ──
const PANELS: Record<string, string[]> = {
  'app-estimate': ['openYard', 'yardWords', "$('yard-close')", "$('y-go')", 'ESTIMATE_TOOLS', 'renderEstimate', 'prepFromLead', 'estimatePrepPanel'],
  'app-book': ['renderBook', 'openTwin', 'twinWords', "$('twin-close')"],
  'app-followups': ['FU_LABEL', 'renderFollowUps'],
  'app-money': ['STAGE_LABEL', 'renderMoney', 'paidButton', 'renderMoneyView'],
  'app-fleet': ['TRACK_SAYS', 'loadTrack', 'agoWords', 'truckWords', 'trackWords', 'fleetTrackLine', 'fillTrack', 'renderFleet', 'renderFleetList',
    'partAdder', 'fleetComposer', 'openBreakdown', 'bdWords', "$('bd-close')", "$('bd-go')", 'renderFleetView'],
  'app-safety': ['CERT_STATE', 'CERT_TYPES', 'CREW_ROLES', 'renderSafety', 'renderRoster', 'renderRosterList', 'disclose', 'certAdder', 'rosterComposer',
    'renderTrainingBoard', 'renderVetting', 'renderLibraryDesk', 'renderLibraryQueue', 'libraryComposer', 'renderSafetyView'],
  'app-permits': ['PERMIT_STATUS', 'TOPIC_NAMES', 'KNOWN_HOSTS', 'permitVerdict', 'topicFold', 'renderPermits', 'checkCard', 'whoLine', 'factCard'],
};
// The permit-label helper is this unit's, shared by four of its screens (Estimate, Properties on file, Permit rules).
const SHARED = ['permitLabel'];
// Each screen, and each sheet a screen opens, names its unit in ES_PLACES.
const PLACES: Record<string, string> = {
  '#view-estimate': 'app-estimate', '#yard': 'app-estimate', '#view-book': 'app-book', '#twin': 'app-book', '#view-followups': 'app-followups',
  '#view-money': 'app-money', '#view-fleet': 'app-fleet', '#bd': 'app-fleet', '#view-safety': 'app-safety', '#view-permits': 'app-permits',
};

function topName(n: ts.Statement): string | null {
  if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
  if (ts.isVariableStatement(n)) { const d = n.declarationList.declarations[0]; return d && ts.isIdentifier(d.name) ? d.name.text : null; }
  if (ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)) {
    const m = /^(\$\('[\w-]+'\))\.addEventListener\(/.exec(n.expression.getText(sf));
    if (m) return m[1]!;
  }
  return null;
}
const TOP = new Map<string, ts.Node>();
for (const s of sf.statements) { const k = topName(s); if (k && !TOP.has(k)) TOP.set(k, s); }
const nodeOf = (name: string): ts.Node => { const n = TOP.get(name); if (!n) throw new Error(`no ${name} in the page`); return n; };
const ALL_NAMES = [...Object.values(PANELS).flat(), ...SHARED];

// ── The scan (the crew door's, D111, with the owner app's own code positions) ──
const KEYED = new Set(['T', 'tf', 'tn', 'esSay', 'esPair']);
// A literal in one of these positions is not words on the screen: a tag or a class, a selector, an attribute
// or event name, a route, an id, a tone, a field name, a locale or a format option.
const CODE_CALLS: Record<string, number[] | 'all'> = {
  el: [0, 1], createElement: 'all', setAttribute: [0], getAttribute: 'all', removeAttribute: 'all', hasAttribute: 'all',
  addEventListener: [0], querySelector: 'all', querySelectorAll: 'all', getElementById: 'all', $: 'all', add: 'all', remove: 'all',
  toggle: 'all', contains: 'all', closest: 'all', indexOf: 'all', split: 'all', startsWith: 'all', includes: 'all', replace: 'all', localeCompare: 'all',
  toLocaleString: 'all' as const, toLocaleDateString: 'all', api: 'all', fetch: 'all', encodeURIComponent: 'all', scrollIntoView: 'all', scrollTo: 'all',
  switchTab: 'all', openMap: 'all', icon: 'all', sheetOpened: 'all', closeSheet: 'all', Option: [1], Error: 'all', has: 'all', get: 'all',
  // The page's chip/badge: words first, then the tone (or class). A shared dead-feed helper (feedState, feedLine) composes the
  // shared §1B vocabulary in English — its line is drawn English and marked "en inglés" in Spanish (see the draw tests).
  chip: [1], badge: [1], feedState: 'all', feedLine: 'all',
  // A server line's field name; the prep form's field id; the job check's answer keys.
  esSayTwin: [2], esSayPick: [2], field: [0], tri: [0], flag: [0], forLabel: [0],
};
// A method name that is also a local function's name elsewhere (the library form's add) is code only as a method: x.add('…').
const METHOD_ONLY = new Set(['add', 'remove', 'toggle', 'contains', 'has', 'get', 'replace', 'split', 'indexOf', 'includes', 'startsWith', 'closest', 'localeCompare']);
const CODE_ATTRS = new Set(['id', 'lang', 'role', 'aria-disabled', 'aria-hidden', 'aria-busy', 'aria-pressed']);
const CODE_PROPS = new Set(['className', 'id', 'type', 'href', 'target', 'rel', 'inputMode', 'value', 'htmlFor', 'color', 'marginTop', 'minHeight', 'opacity', 'overflowWrap']);
const OPTION_KEYS = new Set(['key', 'icon', 'method', 'status', 'behavior', 'block', 'top', 'reportedBy', 'url', 'minimumFractionDigits', 'maximumFractionDigits']);
// Codes the page compares, sends or keys by — written out so a new English word is never waved through.
const CODES = new Set([
  'use strict', 'removal', 'pruning', 'stump', 'land_clearing', 'other', 'unknown', 'climber', 'foreman', 'groundie', 'driver', 'first_aid', 'cpr',
  'aerial_rescue', 'tree_rescue', 'cdl', 'paid', 'owner', 'yard', 'measure', 'book', 'permits', 'trucks', 'AbortError', 'smooth', 'center', 'start',
  'nearest', 'review', 'estimate', 'fleet', 'money', 'safety', 'followups', 'techniqueName', 'howTo', 'wontWorkWhen', 'pros', 'cons', 'standardRefs',
  'skillLevel', 'sourceLink', 'inRpa', 'nearPowerLines', 'inRightOfWay', 'historicDistrict', 'stumpGrinding', 'haulingDebris', 'burning',
  'arbo:', 'textarea', 'input', 'select', 'option', 'checkbox', 'date', 'text', 'numeric', 'decimal', 'button', 'tcimag.tcia.org', 'error',
  // the tones (TONE), the feed kinds (feedKind), and the third word a shared-vocabulary line carries in Spanish ('en').
  'alarm', 'stop', 'watch', 'good', 'info', 'cut', 'sim', 'unset', 'unread', 'en',
]);
// Names, never translated: the desks' names (the eight agents, R26), the four cities, the brand.
const NAMES = new Set(['Arborist · Permit Desk', 'Arborist', 'Permit Desk', 'Yard Boss', 'Virginia Beach', 'Norfolk', 'Chesapeake', 'Portsmouth', 'Arbo Crew']);
// An example the box shows, as an address is written.
const EXAMPLES = new Set(['123 Oak St']);

function callName(n: ts.CallExpression | ts.NewExpression): string {
  const e = n.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return '';
}
function argIndex(call: ts.CallExpression | ts.NewExpression, node: ts.Node): number {
  return (call.arguments ?? []).findIndex((a) => a.pos <= node.pos && node.end <= a.end);
}
const isEsCheck = (e: ts.Expression, f: ts.SourceFile) => /^ES\.lang\s*===\s*'es'$/.test(e.getText(f).trim());
/**
 * Why a literal is not words on the screen, or null when it is (and must be wrapped). `inDeadFeed`: the literal
 * sits in a dead-feed card — state('<feed> — ' + FEED_WORD[…], …) — the shared §1B vocabulary, kept English.
 */
function exempt(lit: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral, f: ts.SourceFile = sf): string | null {
  const text = lit.text;
  if (!/[A-Za-z]{2}/.test(text)) return 'no words';
  if (CODES.has(text)) return 'listed code';
  if (NAMES.has(text)) return 'a name';
  if (EXAMPLES.has(text)) return 'an example';
  if (/^(?:\/|\?|&|#|https?:|tel:|fact-|ep-|cert-exp-|i-|y-|queue-|safety-library$)/.test(text)) return 'a route or an id';
  // A line's look — the page's classes, written whole: the feed-state looks, the muted help look, the verdict colours.
  if (/^(?:feed-state(?: (?:cut|sim|unset|unread))? ?|storm-muted|v-(?:on|below|lose|verify))$/.test(text)) return 'a look (a class)';
  let child: ts.Node = lit;
  for (let p: ts.Node | undefined = lit.parent; p; child = p, p = p.parent) {
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      const name = callName(p);
      const i = argIndex(p, child);
      if (i !== -1 && KEYED.has(name)) return 'wrapped';
      const code = METHOD_ONLY.has(name) && !ts.isPropertyAccessExpression(p.expression) ? undefined : CODE_CALLS[name];
      if (i !== -1 && code && (code === 'all' || code.includes(i))) return `code (${name})`;
      const a0 = p.arguments?.[0];
      if (name === 'setAttribute' && i === 1 && a0 && ts.isStringLiteral(a0) && CODE_ATTRS.has(a0.text)) return 'a code attribute';
      // A dead-feed card: state(title, body) whose title is built on FEED_WORD — the shared vocabulary, English, marked.
      if (name === 'state' && i !== -1 && p.arguments?.[0] && /\bFEED_WORD\b/.test(p.arguments[0].getText(f))) return 'the shared dead-feed words';
    }
    // A line built on the shared §1B feed words (FEED_WORD, feedSays, RETRY) is the shared dead-feed vocabulary — English as
    // written, and marked "en inglés" where it is drawn in Spanish (the draw tests prove the mark).
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      let top: ts.Node = p;
      while (ts.isBinaryExpression(top.parent) && top.parent.operatorToken.kind === ts.SyntaxKind.PlusToken) top = top.parent;
      if (/\bFEED_WORD\b|\bfeedSays\(|\bRETRY\b/.test(top.getText(f))) return 'the shared dead-feed words';
    }
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) return 'a comparison';
    if (ts.isCaseClause(p) && child === p.expression) return 'a case';
    if (ts.isPropertyAssignment(p)) {
      const key = p.name.getText(f).replace(/^['"]|['"]$/g, '');
      if (child === p.name) return 'a property name';
      if (OPTION_KEYS.has(key)) return 'an option';
    }
    if (ts.isGetAccessorDeclaration(p) && child === p.name) return 'a property name';
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(p.left)
      && CODE_PROPS.has(p.left.name.text) && child === p.right) return 'a code property';
    // The English half of a Spanish-mode choice, kept as written because an older test pins its source: the Spanish half is keyed.
    if (ts.isConditionalExpression(p) && child === p.whenFalse && isEsCheck(p.condition, f) && /\b(?:T|tf|tn)\(/.test(p.whenTrue.getText(f))) return 'the English half of a keyed choice';
    if (ts.isElementAccessExpression(p)) return 'an index';
    // CERT_STATE's and PERMIT_STATUS's labels stay their English (older tests pin both tables): each is said at draw —
    // by renderSafety's certSay and by permitLabel, the safety ones through the pair — and a test below proves every
    // label has its case there.
    if (ts.isArrayLiteralExpression(p) && p.elements[0] === child && ts.isPropertyAssignment(p.parent)
      && ts.isObjectLiteralExpression(p.parent.parent) && ts.isVariableDeclaration(p.parent.parent.parent)
      && ['CERT_STATE', 'PERMIT_STATUS'].includes(p.parent.parent.parent.name.getText(f))) return 'a label said at draw (certSay, permitLabel)';
    if (ts.isBlock(p) || ts.isSourceFile(p)) break; // an exemption holds within its own statement, never from a call around a callback
  }
  return null;
}
function unwrappedIn(node: ts.Node): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && exempt(n) === null) {
      out.push(`${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${JSON.stringify(n.text)}`);
    }
    if (ts.isTemplateExpression(n)) out.push(`${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: a template literal — use tf`);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}
type Keyed = { name: string; key: string; at: number };
function keyedIn(node: ts.Node): Keyed[] {
  const out: Keyed[] = [];
  const lit = (a: ts.Expression | undefined) => (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null);
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && KEYED.has(n.expression.text)) {
      const name = n.expression.text;
      const args = name === 'tn' ? [n.arguments[1], n.arguments[2]] : name === 'esSay' ? [n.arguments[1]] : [n.arguments[0]];
      for (const a of args) { const k = lit(a); if (k !== null) out.push({ name, key: k, at: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 }); }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}
const keysOf = (names: string[]) => names.flatMap((nm) => keyedIn(nodeOf(nm)));
const unitDict = (unit: string): Record<string, string> => readUnit(`${unit}.es.json`) ?? {};
const MY_UNITS = Object.keys(PANELS);
const myDict = (): Record<string, string> => Object.assign({}, ...MY_UNITS.map(unitDict));

describe('every word these screens draw goes through the runtime', () => {
  for (const [unit, names] of Object.entries(PANELS)) {
    it(`${unit}: no English literal reaches the screen unwrapped (each sentence a T/tf/tn/esSay key)`, () => {
      expect(names.flatMap((n) => unwrappedIn(nodeOf(n)))).toEqual([]);
    });
  }
  it('the permit-label helper too', () => {
    expect(SHARED.flatMap((n) => unwrappedIn(nodeOf(n)))).toEqual([]);
  });
  it('the scan bites: a bare sentence, a sentence glued from pieces and a template literal are each caught', () => {
    const probe = (src: string) => {
      const f = ts.createSourceFile('p.js', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const hits: string[] = [];
      const v = (n: ts.Node) => {
        if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && exempt(n, f) === null) hits.push(n.text);
        if (ts.isTemplateExpression(n)) hits.push('template');
        ts.forEachChild(n, v);
      };
      v(f);
      return hits;
    };
    expect(probe("box.appendChild(el('div', 'state', 'No units on file'));")).toEqual(['No units on file']);
    expect(probe("x.textContent = 'Owed — ' + n + ' past due';")).toEqual(['Owed — ', ' past due']);
    expect(probe('x.textContent = `${n} past due`;')).toEqual(['template']);
    expect(probe("box.appendChild(el('div', 'state', T('No units on file')));")).toEqual([]);
    expect(probe("if (e.message === 'bad_expiry_date') return;")).toEqual([]);
    // A Spanish-mode choice only exempts its English half when the Spanish half is keyed.
    expect(probe("x.textContent = ES.lang === 'es' ? 'Hola' : 'Hello';")).toEqual(['Hola', 'Hello']);
    expect(probe("x.textContent = ES.lang === 'es' ? tf('{n} card', { n }) : n + ' cards';")).toEqual([]);
  });
});
describe('one literal per sentence — no Spanish sentence is ever glued from pieces', () => {
  it('no key starts or ends with a space, a dash or a colon left open for a piece (a fragment is a glued sentence)', () => {
    const bad = keysOf(ALL_NAMES).filter((k) => /^\s|\s$|[—–:-]\s*$|^\s*[—–]/.test(k.key) && !/^[^A-Za-z]*$/.test(k.key));
    expect(bad.map((k) => `${k.at}: ${k.key}`)).toEqual([]);
  });
  it('T never carries a {slot} (a value goes in only through tf/tn)', () => {
    expect(keysOf(ALL_NAMES).filter((k) => k.name === 'T' && /\{\w+\}/.test(k.key)).map((k) => k.key)).toEqual([]);
  });
  it('two keyed pieces are joined only as whole sentences (the first ends a sentence) or as a " · " list — never mid-sentence', () => {
    const bad: string[] = [];
    const keyedKey = (e: ts.Expression): string[] | null => {
      let x: ts.Expression = e;
      while (ts.isParenthesizedExpression(x)) x = x.expression;
      if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && ['T', 'tf', 'tn'].includes(x.expression.text)) {
        const a = x.expression.text === 'tn' ? x.arguments[2] : x.arguments[0];
        return a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? [a.text] : [''];
      }
      if (ts.isConditionalExpression(x)) { const a = keyedKey(x.whenTrue); const b = keyedKey(x.whenFalse); return a && b ? [...a, ...b] : null; }
      return null;
    };
    const chain = (e: ts.Expression): ts.Expression[] => {
      let x: ts.Expression = e;
      while (ts.isParenthesizedExpression(x)) x = x.expression;
      return ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.PlusToken ? [...chain(x.left), ...chain(x.right)] : [x];
    };
    for (const nm of ALL_NAMES) {
      const visit = (n: ts.Node) => {
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken
          && !(ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
          const ops = chain(n);
          for (let i = 0; i < ops.length; i++) {
            const left = keyedKey(ops[i]!);
            if (!left) continue;
            let j = i + 1;
            const joiners: string[] = [];
            while (j < ops.length && ts.isStringLiteral(ops[j]!) && !/[A-Za-z]/.test((ops[j] as ts.StringLiteral).text)) { joiners.push((ops[j] as ts.StringLiteral).text); j++; }
            const right = j < ops.length ? keyedKey(ops[j]!) : null;
            if (!right) continue;
            const list = joiners.join('') === ' · ';
            const sentence = joiners.join('') === ' ' && left.every((k) => /[.!?…:)]$/.test(k));
            if (!list && !sentence) bad.push(`${nm}: ${n.getText(sf).slice(0, 120)}`);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(nodeOf(nm));
    }
    expect(bad).toEqual([]);
  });
});

describe('every screen and sheet has its own dictionary, served whole but for the safety drafts', () => {
  const places = new Function(`${/^const ES_PLACES = \{[\s\S]*?^\};$/m.exec(raw)?.[0] ?? 'const ES_PLACES = {};'}\nreturn ES_PLACES;`)() as Record<string, string>;
  it('each screen and each sheet it opens names its unit — the sheets after ".sheet", so their own unit decides', () => {
    for (const [sel, unit] of Object.entries(PLACES)) expect(places[sel], sel).toBe(unit);
    const order = Object.keys(places);
    for (const s of ['#yard', '#twin', '#bd']) expect(order.indexOf(s), s).toBeGreaterThan(order.indexOf('.sheet'));
  });
  it('each unit file is there, a flat object of strings, and served with nothing held back but a safety draft', () => {
    const served = loadDoorDictionary('app');
    expect(served.broken).toEqual([]);
    for (const unit of MY_UNITS) {
      expect(unitFiles().map((u) => u.unit), unit).toContain(unit);
      expect(readUnit(`${unit}.es.json`), unit).not.toBeNull();
      expect(served.units[unit], unit).toBeDefined();
      for (const h of served.held.filter((x) => x.unit === unit)) {
        expect(isSafetyClass(h.key), `${unit}: ${h.key}`).toBe(true);
        expect(loadLedger().some((e) => e.en === h.key && e.es === unitDict(unit)[h.key] && e.pass === 'draft'), `${unit}: ${h.key}`).toBe(true);
      }
    }
  });
  it('each screen’s keys are in its own unit (the permit-label helper’s in the units of the screens that draw them)', () => {
    for (const [unit, names] of Object.entries(PANELS)) {
      const d = unitDict(unit);
      const missing = keysOf(names).filter((k) => !(k.key in d)).map((k) => `${k.at}: ${k.key}`);
      expect(missing, unit).toEqual([]);
    }
    const all = myDict();
    expect(keysOf(SHARED).filter((k) => !(k.key in all)).map((k) => k.key)).toEqual([]);
  });
  it('a key in two of these units says the same Spanish in both', () => {
    const seen = new Map<string, { unit: string; es: string }>();
    for (const unit of MY_UNITS) {
      for (const [en, es] of Object.entries(unitDict(unit))) {
        const was = seen.get(en);
        if (was) expect(es, `${en}: ${was.unit} vs ${unit}`).toBe(was.es);
        else seen.set(en, { unit, es });
      }
    }
  });
  it('no unit holds a key its screens never use (parity, per unit)', () => {
    for (const [unit, names] of Object.entries(PANELS)) {
      const used = new Set([...keysOf(names), ...keysOf(SHARED)].map((k) => k.key));
      expect(Object.keys(unitDict(unit)).filter((k) => !used.has(k)), unit).toEqual([]);
    }
  });
});

describe('safety lines — only through the safety pair, and every NEW one a ledger draft (nothing reviewed here)', () => {
  it('every safety-class key these screens use is said with esSay (Spanish over the full English, or the pointer), never T/tf/tn', () => {
    const wrong = keysOf(ALL_NAMES).filter((k) => isSafetyClass(k.key) && k.name !== 'esSay').map((k) => `${k.at}: ${k.name}(${k.key})`);
    expect(wrong).toEqual([]);
  });
  it('the safety-class keys are exactly this unit’s new drafts plus the labels the ledger already holds', () => {
    const safety = [...new Set(keysOf(ALL_NAMES).filter((k) => isSafetyClass(k.key)).map((k) => k.key))].sort();
    expect(safety).toEqual([...new Set([...OWNER_B_DRAFTS.map((d) => d.en), ...OWNER_B_REUSED])].sort());
  });
  it('each new one is in its unit with the Spanish named here, and the ledger holds that exact pair as a DRAFT — no blind pass is claimed', () => {
    for (const d of OWNER_B_DRAFTS) {
      expect(unitDict(d.unit)[d.en], d.en).toBe(d.es);
      const e = loadLedger().find((x) => x.en === d.en && x.es === d.es);
      expect(e, d.en).toBeDefined();
      expect(e!.pass, d.en).toBe('draft');
      expect(e!.sha, d.en).toBe(pairSha(d.en, d.es));
      expect(e!.where, d.en).toBe(`dict:${d.unit}`);
      expect(e!.reviewedBy, d.en).toBeUndefined();
      expect(e!.backTranslation, d.en).toBeUndefined();
      expect(e!.note, d.en).toMatch(/^Not recorded — new in R27 Phase A \(owner app\)/);
    }
  });
  it('the reused labels carry the ledger’s Spanish word for word — six served (recorded by D112), HELD held (its draft)', () => {
    for (const en of OWNER_B_REUSED) {
      const units = MY_UNITS.filter((u) => en in unitDict(u));
      expect(units.length, en).toBeGreaterThan(0);
      for (const u of units) {
        const e = loadLedger().find((x) => x.en === en && x.es === unitDict(u)[en]);
        expect(e, `${u}: ${en}`).toBeDefined();
        expect(e!.pass, en).toBe(en === 'HELD' ? 'draft' : 'reviewed');
      }
    }
  });
  it('the 17 entries D112 left are untouched — still exactly the recorded twelve and the held five, first in the file', () => {
    const first = loadLedger().slice(0, RECORDED_EN.length + HELD_EN.length);
    expect(first.filter((e) => e.pass === 'reviewed').map((e) => e.en)).toEqual([...RECORDED_EN]);
    expect(first.filter((e) => e.pass === 'draft').map((e) => e.en)).toEqual([...HELD_EN]);
    expect(loadLedger().filter((e) => e.pass !== 'draft').length).toBe(RECORDED_EN.length);
  });
  it('so the served dictionary holds back exactly the drafts — and serves the six recorded labels', () => {
    const served = loadDoorDictionary('app');
    const held = served.held.filter((h) => MY_UNITS.includes(h.unit)).map((h) => h.key);
    expect([...new Set(held)].sort()).toEqual([...OWNER_B_DRAFTS.map((d) => d.en), 'HELD'].sort());
    const out = Object.assign({}, ...MY_UNITS.map((u) => served.units[u] ?? {})) as Record<string, string>;
    for (const en of OWNER_B_REUSED.filter((x) => x !== 'HELD')) expect(out[en], en).toBe(loadLedger().find((e) => e.en === en)!.es);
  });
});

describe('the Spanish speaks with one voice — the glossary’s words, usted, nothing banned', () => {
  it('every entry passes the ban list and every gate', () => {
    for (const [en, es] of Object.entries(myDict())) {
      expect(findBannedEs(es), `${en} → ${es}`).toEqual([]);
      expect(esGateProblems(en, es), `${en} → ${es}`).toEqual([]);
    }
  });
  it('a key naming a glossary term says that term’s Spanish (never a synonym that drifts)', () => {
    const dict = myDict();
    for (const t of [...TRADE_TERMS, ...APP_TERMS]) {
      const head = normalizeEs(t.es.replace(/\s*\(.*\)\s*$/, ''));
      const enRe = new RegExp(`\\b${t.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i');
      for (const [en, es] of Object.entries(dict)) {
        if (!enRe.test(en)) continue;
        // A label the ledger already holds is the plan's table word for word (R27 #4, recorded by D112) — not re-worded here.
        if (OWNER_B_REUSED.includes(en)) continue;
        const n = normalizeEs(es);
        if (n.includes(normalizeEs(t.en))) continue;
        const stem = head.split(' ').map((w) => w.replace(/(?:es|s)$/, '').slice(0, Math.max(4, w.length - 2))).join('[a-z]* ');
        expect(new RegExp(stem).test(n), `${t.en} → "${t.es}": ${en} → ${es}`).toBe(true);
      }
    }
  });
  it('the roster is "la lista del personal", the sign-in link "el enlace de acceso", the crew code "el código de cuadrilla" (D111)', () => {
    for (const [en, es] of Object.entries(myDict())) {
      if (/\broster\b/i.test(en)) expect(normalizeEs(es), en).toContain('lista del personal');
      if (/\bsign-in link\b/i.test(en)) expect(normalizeEs(es), en).toContain('enlace de acceso');
      if (/\bcrew code\b/i.test(en)) expect(normalizeEs(es), en).toContain('codigo de cuadrilla');
      if (/\bon site\b/i.test(en)) expect(normalizeEs(es), en).toContain('en el lugar de trabajo');
    }
  });
  it('STOP stays STOP, and a credential is never "licenciado" or "acreditado"', () => {
    for (const [en, es] of Object.entries(myDict())) {
      if (/\bSTOP\b/.test(en)) expect(es, en).toMatch(/\bSTOP\b/);
      expect(normalizeEs(es), en).not.toMatch(/licenciad|acreditad/);
    }
  });
  it('the served page carries no Spanish the English guards would trip on (the dictionary is inlined)', () => {
    for (const es of Object.values(myDict())) {
      expect(es).not.toMatch(/permit[^<]{0,20}clear/i);
      expect(es).not.toMatch(/suffolk|TCIA/i);
    }
  });
});

// ── The screens drawn over the REAL runtime and the dictionaries as served (loadDoorDictionary('app')) ──
const SERVED = loadDoorDictionary('app');
class XNode extends FakeNode {
  style: Record<string, string> = {};
  offsetHeight = 0;
  htmlFor = '';
  inputMode = '';
  onclick: null | (() => unknown) = null;
  hasChildNodes(): boolean { return this.children.length > 0; }
  scrollIntoView(): void {}
  focus(): void {}
}
class XOption extends XNode { constructor(text: string, value: string) { super('option'); this.textContent = text; this.value = value; } }
const fnOf = (name: string): string => {
  const one = new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\}$`, 'm').exec(script); // a one-line function
  if (one) return one[0];
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(script);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
};
const constOf = (name: string): string => {
  const one = new RegExp(`^const ${name} = [^\\n]*;(?: *//[^\\n]*)?$`, 'm').exec(script);
  if (one) return one[0];
  const m = new RegExp(`^const ${name} = [\\{\\[][\\s\\S]*?^[\\}\\]];$`, 'm').exec(script);
  if (!m) throw new Error(`no const ${name} in the page`);
  return m[0];
};
const CONSTS = ['READ_ONLY_LINE', 'FEED_WORD', 'Cap', 'FEED_TAG', 'FEED_SAYS', 'RETRY', 'TONE', 'FEED_TONE', 'PERMIT_STATE', 'ESTIMATE_TOOLS', 'CERT_STATE', 'CERT_TYPES',
  'CREW_ROLES', 'STAGE_LABEL', 'TRACK_SAYS', 'UNIT_STATUS', 'FU_LABEL', 'LOOP_LABEL', 'DESK_LINE', 'VIEW_TITLES', 'PERMIT_STATUS', 'TOPIC_NAMES', 'KNOWN_HOSTS', 'PERMIT_ANS', 'nb'];
const FNS = ['state', 'readingLine', 'chip', 'badge', 'plural', 'fmtWhen', 'fmtTime', 'feedKind', 'feedSays', 'feedLine', 'feedState', 'saveFailText', 'permitChip',
  'permitLabel', 'armTwice', 'disclose', 'loopCard', 'renderEstimate', 'estimatePrepPanel', 'renderBook', 'openTwin', 'renderSafety', 'renderRosterList', 'certAdder',
  'renderTrainingBoard', 'renderVetting', 'renderLibraryQueue', 'money', 'renderMoney', 'paidButton', 'agoWords', 'truckWords', 'trackWords', 'fleetTrackLine', 'fillTrack',
  'renderFleetList', 'partAdder', 'renderFollowUps', 'permitVerdict', 'topicFold', 'checkCard', 'whoLine', 'factCard'] as const;
type Fn = (...a: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Page = Record<(typeof FNS)[number] | 'setTrack', Fn> & { doc: ReturnType<typeof fakeDoc>; byId: (id: string) => XNode };
/** This unit's functions with the page's shared helpers, over the real runtime in `lang`, one answer per path. */
function screens(lang: 'en' | 'es', answer: (path: string, body?: unknown) => unknown, units = SERVED.units): Page {
  const doc = fakeDoc();
  doc.createElement = (t: string) => new XNode(t);
  const rt: I18n = loadI18n({ door: 'app', units, stored: lang === 'es' ? { arboLang: 'es' } : {}, doc });
  const ids = new Map<string, XNode>();
  const byId = (id: string) => { if (!ids.has(id)) { const n = new XNode('div'); n.id = id; ids.set(id, n); } return ids.get(id)!; };
  const el = (tag: string, cls?: string, text?: string) => { const n = doc.createElement(tag) as XNode; if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const api = async (path: string, o?: { body?: unknown }) => { const a = answer(path, o && o.body); if (a instanceof Error) throw a; return JSON.parse(JSON.stringify(a)); };
  const deps: Record<string, unknown> = {
    T: rt.T, tf: rt.tf, tn: rt.tn, esSay: rt.esSay, esSayPick: rt.esSayPick, esSayTwin: rt.esSayTwin, esEnMark: rt.esEnMark, ES: rt.ES,
    document: doc, $: byId, el, api, Option: XOption, showKeywall: () => {}, switchTab: () => {}, openMap: () => {}, openYard: () => {}, openBreakdown: () => {},
    icon: () => new XNode('svg'), sheetOpened: () => {}, closeSheet: () => {}, NAV_DRAW: {}, location: { origin: 'https://arbo.test' }, navigator: {}, window: {},
  };
  const body = `let LINKS = 'readonly'; const LINKS_READY = Promise.resolve();
    let EST_GEN = 0, EST_BOOK = null, PREP_LEAD = null, PERMIT_CITY = 'Virginia Beach', PERMIT_GEN = 0, FU_GEN = 0, TRACK = null;
    ${CONSTS.map(constOf).join('\n')}
    ${FNS.map(fnOf).join('\n')}
    return { ${FNS.join(', ')}, setTrack: (t) => { TRACK = t; } };`;
  const p = new Function(...Object.keys(deps), body)(...Object.values(deps)) as Page;
  p.doc = doc;
  p.byId = byId;
  return p;
}
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const fail = (code: number, message: string) => Object.assign(new Error(message), { code });
const all = (n: FakeNode): FakeNode[] => [n, ...n.all()];
/** Every node the page marked English in Spanish mode (lang="en"; its "en inglés" mark inside it). */
const markedEnglish = (n: FakeNode) => all(n).filter((x) => x.getAttribute('lang') === 'en');
const POINTER = 'Aviso de seguridad — por ahora solo en inglés; pídale a alguien que se lo lea:';
/** A safety line said through esSay: its holder — the Spanish over the full English (recorded), or the pointer then the English (held). */
const pairOf = (n: FakeNode) => (n.classList.contains('es-pair') ? n : n.querySelector('.es-pair'));
const heldEnglish = (n: FakeNode) => { const box = pairOf(n); return box && box.classList.contains('es-held') ? box.children[1]!.textContent : null; };
const servedSpanish = (n: FakeNode) => { const box = pairOf(n); return box && !box.classList.contains('es-held') ? box.querySelector('.es-pair-es')!.textContent : null; };

describe('the screens in Spanish — the page’s words in Spanish, data as written, server lines and the shared feed words in English (marked), safety lines paired', () => {
  const MONEY = {
    collections: [{ invoiceId: 'i1', name: 'SIM-Alder', daysOverdue: 12, stage: 'reminder', note: 'Reminder sent 3 days ago.' }],
    invoices: [{ id: 'i1', name: 'SIM-Alder', amount: 1200, lateFeeOwed: 18, lateFeePct: 1.5 }, { id: 'i2', name: 'SIM-Birch', amount: 300 }],
    drafts: [{ jobId: 'j1', name: 'SIM-Cedar', amount: 900, netDays: 15, lateFeePct: 1.5 }],
    blocked: [{ name: 'SIM-Dogwood', line: 'No agreed figure on file.' }],
    unknown: [{ invoiceId: 'i2', line: 'Sent date unknown.' }],
    suppressed: [{ id: 's1' }],
  };
  it('Money: every heading and button in Spanish, the names as written, the server’s notes marked, the legal gate’s STOP line held (pointer + English)', async () => {
    const p = screens('es', () => MONEY);
    const slot = new XNode('div');
    await p.renderMoney(slot);
    const t = slot.textContent;
    for (const s of ['Se debe — 1 con pago atrasado', 'Listo para facturar — 1', 'Todavía no se puede facturar — 1', 'No se sabe si está atrasada — 1',
      'Retenidos por el filtro legal: 1', 'PAGO ATRASADO', '+$18.00 CARGO POR ATRASO (TOPE DE 1.5%)', 'Marcar como pagada ✓', 'Preparar la factura',
      '12 d de atraso', 'El trabajo está hecho y el monto acordado está registrado. Neto 15, cargo por atraso con tope de 1.5%.']) expect(t, s).toContain(s);
    for (const name of ['SIM-Alder', 'SIM-Birch', 'SIM-Cedar', 'SIM-Dogwood']) expect(t).toContain(name);
    for (const en of ['Owed —', 'Ready to bill', 'Mark paid', 'Draft the invoice', 'PAST DUE', 'Cannot bill yet', 'held by the legal gate']) expect(t, en).not.toContain(en);
    expect(markedEnglish(slot).map((n) => n.textContent)).toEqual(expect.arrayContaining(['Reminder sent 3 days ago.en inglés', 'No agreed figure on file.en inglés', 'Sent date unknown.en inglés']));
    const gate = all(slot).find((n) => n.classList.contains('es-pair'))!;
    expect(gate.classList.contains('es-held')).toBe(true);
    expect(gate.children[0]!.textContent).toBe(POINTER);
    expect(gate.children[1]!.textContent).toBe('No consent on file or STOP on record — Arbo will not nudge these.');
  });
  it('Money in English: the English as written — no mark, no pair, no Spanish', async () => {
    const p = screens('en', () => MONEY);
    const slot = new XNode('div');
    await p.renderMoney(slot);
    const t = slot.textContent;
    for (const s of ['Owed — 1 past due', 'Ready to bill — 1', 'Cannot bill yet — 1', 'Can’t tell if overdue — 1', '1 held by the legal gate',
      'No consent on file or STOP on record — Arbo will not nudge these.', '+$18.00 LATE FEE (1.5% CAP)', '12d late', 'Mark paid ✓',
      'Work is done and the agreed figure is on file. Net 15, late fee capped at 1.5%.', 'Reminder sent 3 days ago.']) expect(t, s).toContain(s);
    expect(t).not.toMatch(/inglés|Se debe|Dinero/);
    expect(all(slot).some((n) => n.getAttribute('lang') !== null || n.classList.contains('es-pair'))).toBe(false);
  });
  it('a dead ledger in Spanish: the panel’s name in Spanish, the dead-feed card in the shared words — English, lang="en", marked', async () => {
    const p = screens('es', () => fail(503, 'link_cut'));
    const slot = new XNode('div');
    await p.renderMoney(slot);
    expect(slot.children[0]!.textContent).toBe('Dinero');
    const card = slot.children[1]!;
    expect(card.getAttribute('lang')).toBe('en');
    expect(card.textContent).toMatch(/^Ledger — (?:cut on purpose|not set up yet).*en inglés$/);
  });

  const FLEET = {
    down: 1, held: 1,
    units: [
      { id: 'u1', name: 'SIM Chipper', kind: 'chipper', status: 'down', schedulable: false, openTasks: 1, heightInches: 100, weightLbsLoaded: 9000 },
      { id: 'u2', name: 'SIM Bucket', kind: 'bucket truck', status: 'held', schedulable: false, openTasks: 0, holdReason: null, heightInches: null, weightLbsLoaded: null },
      { id: 'u3', name: 'SIM Pickup', kind: 'pickup', status: 'up', schedulable: true, openTasks: 0, heightInches: 80, weightLbsLoaded: 5000 },
    ],
  };
  it('Fleet: the heading counts in Spanish; DOWN and HELD are held safety labels (the pointer, then the English); UP reads Spanish; names as written', async () => {
    const p = screens('es', () => FLEET);
    const slot = new XNode('div');
    await p.renderFleetList(slot);
    const t = slot.textContent;
    expect(slot.children[0]!.textContent).toBe('Flota — 1 unidad fuera de servicio, 1 unidad retenida');
    const cards = slot.children.filter((c) => c.dataset.unit);
    expect(heldEnglish(cards[0]!.querySelector('.badges')!.children[0]!)).toBe('DOWN');
    expect(heldEnglish(cards[1]!.querySelector('.badges')!.children[0]!)).toBe('HELD');
    expect(cards[2]!.querySelector('.badges')!.children[0]!.textContent).toBe('EN SERVICIO');
    for (const s of ['NO SE PUEDE PROGRAMAR', '1 tarea abierta', 'TAMAÑO DESCONOCIDO — RUTA CON PRECAUCIÓN', 'Retenida: falla de frenos o de dirección.',
      'Volver a habilitarla', 'Reportar una avería', 'Dar de baja esta unidad', 'SIM Chipper', 'SIM Bucket', 'chipper']) expect(t, s).toContain(s);
    expect(t).not.toMatch(/Report a breakdown|Retire this unit|NOT SCHEDULABLE|Sign it back on/);
  });
  it('Fleet in English: the heading and chips exactly as before', async () => {
    const p = screens('en', () => FLEET);
    const slot = new XNode('div');
    await p.renderFleetList(slot);
    expect(slot.children[0]!.textContent).toBe('Fleet — 1 unit down, 1 unit held');
    const chips = slot.children.filter((c) => c.dataset.unit).map((c) => c.querySelector('.badges')!.children.map((b) => b.textContent));
    expect(chips).toEqual([['DOWN', 'NOT SCHEDULABLE', '1 open task'], ['HELD', 'NOT SCHEDULABLE', 'SIZE UNKNOWN — ROUTED CONSERVATIVELY'], ['UP']]);
    expect(slot.textContent).toContain('On hold: brake/steering defect. It stays off the schedule until you sign it back on.');
  });
  it('a truck line in the shared feed words is marked "en inglés" in Spanish — and English answers exactly the [words, look] it always did', () => {
    const es = screens('es', () => ({}));
    expect(es.trackWords({ failed: { code: 500 } }, 'u1')).toEqual(['Tracking: couldn’t read it', 'feed-state unread', 'en']);
    expect(es.trackWords({ state: 'link_cut', units: [] }, 'u1')).toEqual(['Rastreo cortado a propósito — Arbo no lee ninguna ubicación hasta que se vuelva a conectar', 'feed-state cut']);
    es.setTrack({ failed: { code: 500 } });
    const line = es.fleetTrackLine({ id: 'u1' });
    expect(line.getAttribute('lang')).toBe('en');
    expect(line.textContent).toBe('Tracking: couldn’t read iten inglés');
    const en = screens('en', () => ({}));
    expect(en.trackWords({ failed: { code: 500 } }, 'u1')).toEqual(['Tracking: couldn’t read it', 'feed-state unread']);
    expect(en.agoWords(5)).toBe('5 min ago');
    expect(es.agoWords(5)).toBe('hace 5 min');
  });

  const SAFETY = {
    blindSpots: ['Near misses — not in the practice data. Arbo cannot check whether every incident has a lesson.'],
    aerialBlocked: ['c1'],
    certProblems: [
      { crewMemberId: 'c1', crewMemberName: 'SIM-Alder', type: 'aerial_rescue', state: 'lapsed', daysUntil: -3, blocksAerialWork: true, line: 'Aerial rescue EXPIRED 3 days ago — this is not a reminder, it is a stop.' },
      { crewMemberId: 'c2', crewMemberName: 'SIM-Birch', type: 'cpr', state: 'unknown', daysUntil: null, blocksAerialWork: false, line: 'CPR has no expiry date on file.' },
    ],
    nearMisses: [{ hazardCategory: 'struck_by', occurredOn: '2026-10-20', description: 'A limb swung back toward the groundie.', hasTrainingItem: false }],
  };
  it('Crew & safety: NO EXPIRY DATE and NO AERIAL WORK read Spanish over the full English (recorded, D112); EXPIRED is held; the near miss as typed', async () => {
    const p = screens('es', () => SAFETY);
    const slot = new XNode('div');
    await p.renderSafety(slot);
    const t = slot.textContent;
    expect(t).toContain('Seguridad — 1 sin poder trabajar en altura');
    expect(t).toContain('1 miembro de la cuadrilla no puede trabajar en altura');
    const cards = slot.children.filter((c) => c.dataset.crew);
    const alder = cards.find((c) => c.dataset.crew === 'c1')!.querySelector('.badges')!;
    expect(heldEnglish(alder.children[0]!)).toBe('EXPIRED');
    expect(servedSpanish(alder.children[1]!)).toBe('NO PUEDE TRABAJAR EN ALTURA');
    expect(alder.children[1]!.textContent).toContain('NO AERIAL WORK'); // the FULL English beneath
    const birch = cards.find((c) => c.dataset.crew === 'c2')!.querySelector('.badges')!;
    expect(servedSpanish(birch.children[0]!)).toBe('FALTA LA FECHA DE VENCIMIENTO');
    expect(birch.children[0]!.textContent).toContain('NO EXPIRY DATE');
    // The row: who (data) · the card (Spanish) · its state (held: the pointer, then EXPIRED).
    const row = all(slot).find((n) => n.className === 'sliplink')!;
    expect(row.textContent.startsWith('SIM-Alder · Rescate en altura (aerial rescue) · ')).toBe(true);
    expect(heldEnglish(row)).toBe('EXPIRED');
    expect(t).toContain('golpe por objeto');
    expect(t).toContain('A limb swung back toward the groundie.');
    expect(markedEnglish(slot).map((n) => n.textContent)).toEqual(expect.arrayContaining([
      'Near misses — not in the practice data. Arbo cannot check whether every incident has a lesson.en inglés', 'CPR has no expiry date on file.en inglés']));
  });
  it('Crew & safety in English: the row and the chips exactly as before', async () => {
    const p = screens('en', () => SAFETY);
    const slot = new XNode('div');
    await p.renderSafety(slot);
    const row = all(slot).find((n) => n.className === 'sliplink')!;
    expect(row.textContent).toBe('SIM-Alder · Aerial rescue · EXPIRED');
    const chips = slot.children.filter((c) => c.dataset.crew).map((c) => c.querySelector('.badges')!.children.map((b) => b.textContent));
    expect(chips).toEqual([['EXPIRED', 'NO AERIAL WORK'], ['NO EXPIRY DATE']]);
    expect(slot.textContent).toContain('Safety — 1 cannot go aerial');
    expect(slot.textContent).toContain('3 days ago');
  });

  it('the roster in Spanish: the crew code and the sign-in link in the glossary’s words; the role in Spanish with the English beside; the card count a real plural', async () => {
    const p = screens('es', () => ({ certsKnown: true, people: [{ id: 'c0de0000-0000-4000-8000-00000000000a', name: 'SIM-Alder', role: 'climber', competencyLevel: 6, active: true, certCount: 2 }] }));
    const slot = new XNode('div');
    await p.renderRosterList(slot);
    const t = slot.textContent;
    for (const s of ['TREPADOR (CLIMBER)', 'nivel 6', '2 tarjetas registradas', 'Código de cuadrilla: c0de0000-0000-4000-8000-00000000000a', 'Enviar enlace de acceso',
      'Quitar de la lista del personal', 'Registrar / renovar una tarjeta']) expect(t, s).toContain(s);
    const en = screens('en', () => ({ certsKnown: true, people: [{ id: 'x1', name: 'SIM-Alder', role: 'climber', competencyLevel: 6, active: true, certCount: 2 }] }));
    const s2 = new XNode('div');
    await en.renderRosterList(s2);
    for (const s of ['CLIMBER', 'level 6', '2 cards on file', 'Crew code: x1', 'Send sign-in link', 'Take off the roster']) expect(s2.textContent, s).toContain(s);
  });

  const PREP = {
    city: 'Norfolk',
    permit: { ran: true, status: 'PERMIT_LIKELY', headline: 'Inside the RPA — a permit is likely.', overlays: [{ meaning: 'Resource Protection Area' }], mitigation: null, scaleEscalation: null, powerLine: null },
    drive: { fromZip: '23451', minutes: 25, note: 'from today’s work ZIP' },
    missUtility: { note: 'Call 811 at least 3 working days before any digging or stump grinding.' },
    access: { notes: 'tight gate', note: 'Bring the small chipper.' },
    cityNote: null,
  };
  const buildPrep = async (lang: 'en' | 'es') => {
    const p = screens(lang, () => PREP);
    const card = p.estimatePrepPanel() as XNode;
    (card.all().find((n) => n.id === 'ep-address') as XNode).value = '1 Oak St';
    (card.all().find((n) => n.id === 'ep-city') as XNode).value = 'Norfolk';
    const go = card.all().find((n) => n.className === 'actbtn') as XNode;
    const label = go.textContent;
    await go.onclick!();
    await flush();
    return { card, label, sheet: card.querySelector('.verdict')! };
  };
  it('the prep sheet in Spanish: the permit word recorded (Spanish over the FULL English), the 811 line held, the server’s lines marked, the typed notes as written', async () => {
    const { card, label, sheet } = await buildPrep('es');
    expect(label).toBe('Armar la hoja de preparación');
    const head = sheet.querySelector('.vhead')!;
    expect(servedSpanish(head)).toBe('PROBABLEMENTE SE NECESITA PERMISO');
    expect(head.textContent).toContain('PERMIT LIKELY');
    expect(sheet.querySelectorAll('.prep-lab').map((n) => n.textContent)).toEqual(['Permiso', 'Viaje', '811', 'Acceso']);
    const t = sheet.textContent;
    expect(t).toContain('~25 min desde 23451 — ');
    expect(t).toContain('"tight gate" — ');
    const call811 = sheet.querySelectorAll('.drv').find((n) => n.textContent.includes('Call 811'))!;
    expect(heldEnglish(call811)).toBe('Call 811 at least 3 working days before any digging or stump grinding.');
    expect(markedEnglish(sheet).map((n) => n.textContent)).toEqual(expect.arrayContaining(['Inside the RPA — a permit is likely.en inglés', 'Bring the small chipper.en inglés']));
    // The form's labels in Spanish; the ids its own words (the same in both languages).
    expect(card.all().filter((n) => n.tagName === 'label').map((n) => n.textContent)).toEqual(['Dirección', 'Ciudad', 'Código postal (ZIP)', 'Tipo de trabajo', 'Notas de acceso']);
  });
  it('the prep sheet in English: the same rows, word for word as before', async () => {
    const { card, sheet } = await buildPrep('en');
    expect(sheet.querySelector('.vhead')!.textContent).toBe('PERMIT LIKELY');
    expect(sheet.querySelectorAll('.drv').map((n) => n.textContent)).toEqual([
      'Inside the RPA — a permit is likely.', '⚠ Resource Protection Area', '~25 min from 23451 — from today’s work ZIP',
      'Call 811 at least 3 working days before any digging or stump grinding.', '"tight gate" — Bring the small chipper.',
    ]);
    expect(card.all().filter((n) => n.tagName === 'label').map((n) => n.textContent)).toEqual(['Address', 'City', 'ZIP', 'Job type', 'Access notes']);
  });

  it('the job check in Spanish: CALL FIRST held (a new draft), REVIEW NEEDED recorded; a life-safety step wears the pointer, the reason is marked', () => {
    const p = screens('es', () => ({}));
    const power = p.checkCard({ status: 'CALL FIRST', safety: true, step: 'Call Dominion Energy at 1-866-366-4357 before any work within 10 ft of a power line.', why: 'Virginia law.', factIds: [] });
    expect(heldEnglish(power.querySelector('.badges')!.children[0]!)).toBe('CALL FIRST');
    expect(heldEnglish(power.querySelector('.who')!)).toContain('Call Dominion Energy');
    expect(power.querySelector('.scope')!.getAttribute('lang')).toBe('en');
    const review = p.checkCard({ status: 'REVIEW NEEDED', step: 'UNKNOWN: right-of-way', why: 'w', factIds: [] });
    expect(servedSpanish(review.querySelector('.badges')!.children[0]!)).toBe('PERMISO: HAY QUE REVISAR');
    const en = screens('en', () => ({})).checkCard({ status: 'CALL FIRST', safety: true, step: 'Call Dominion.', why: 'w', factIds: [] });
    expect(en.querySelector('.badges')!.textContent).toBe('CALL FIRST');
    expect(en.querySelector('.who')!.textContent).toBe('Call Dominion.');
  });

  it('Properties on file in Spanish: POWER LINES and STRUCTURES held (new drafts); the counts real plurals; the addresses as written', async () => {
    const p = screens('es', () => ({ properties: [{ id: 'p1', address: '1 SIM Oak Ln', city: 'Norfolk', zip: '23503', jobs: [{ count: 2 }], estimates: [{ count: 1 }], trees: [{ count: 3 }], hazard_power_lines: true, hazard_structures: true }], comingDue: [] }));
    await p.renderBook();
    const v = p.byId('view-book');
    const t = v.textContent;
    expect(t).toContain('2 trabajos · 1 estimado · 3 árboles');
    expect(t).toContain('1 SIM Oak Ln');
    expect(t).toContain('Todas las propiedades');
    const badges = v.querySelector('.badges')!;
    expect(heldEnglish(badges.children[1]!)).toBe('POWER LINES');
    expect(heldEnglish(badges.children[2]!)).toBe('STRUCTURES');
  });

  it('Follow-ups in Spanish: the sends in Spanish, a dead loops feed in the shared words (marked), the legal gate’s STOP line held', async () => {
    const p = screens('es', (path) => (path === '/api/queue' ? fail(503, 'link_cut') : { due: [{ type: 'estimate_follow_up', name: 'SIM-Elm', scheduledFor: null, note: 'Estimate sent 5 days ago.', targetId: 't1' }], suppressed: [{}], seasonalUnavailable: false, growthUnavailable: true }));
    await p.renderFollowUps();
    await flush();
    const v = p.byId('view-followups');
    const t = v.textContent;
    for (const s of ['Envíos recomendados', 'SEGUIMIENTO', 'Marcar como enviado ✓', 'SIM-Elm', 'Retenidos por el filtro legal: 1',
      'Arbo no pudo revisar los avisos de revisión pronta (no se pudieron leer los registros de propiedades). Esto no quiere decir que no haya ninguno pendiente.']) expect(t, s).toContain(s);
    const loops = v.querySelector('#queue-loops')!;
    expect(loops.children[0]!.textContent).toBe('Pendientes abiertos');
    expect(loops.children[1]!.getAttribute('lang')).toBe('en');
    expect(loops.children[1]!.textContent).toMatch(/^Open loops: .*en inglés$/);
    const gate = all(v).find((n) => n.classList.contains('es-pair'))!;
    expect(gate.children[1]!.textContent).toBe('No consent on file or STOP on record — these never send.');
  });

  it('a recorded review is what turns a held line into Spanish over its English — proven with this unit’s drafts served as if reviewed', async () => {
    // The dictionaries as written (nothing held back) stand for a ledger that recorded every draft: the same code then shows
    // the Spanish first and the full English beneath — no code change waits on the review, only the ledger.
    const asIfReviewed = Object.fromEntries(MY_UNITS.map((u) => [u, unitDict(u)]));
    const p = screens('es', () => FLEET, { ...SERVED.units, ...asIfReviewed });
    const slot = new XNode('div');
    await p.renderFleetList(slot);
    const down = slot.children.filter((c) => c.dataset.unit)[0]!.querySelector('.badges')!.children[0]!;
    expect(servedSpanish(down)).toBe('FUERA DE SERVICIO');
    expect(down.textContent).toContain('DOWN');
  });
});

describe('the sheets’ fixed words: the markup holds the English, and each is a key the sheet’s words function says in Spanish', () => {
  const markup = (id: string) => {
    const at = raw.indexOf(`<div id="${id}" class="sheet">`);
    return raw.slice(at, raw.indexOf('\n</div>\n', at));
  };
  const text = (html: string) => [...html.replace(/<svg[\s\S]*?<\/svg>/g, '').matchAll(/>([^<>]*[A-Za-z][^<>]*)</g)].map((m) => m[1]!.replace(/&mdash;/g, '—').trim()).filter(Boolean);
  const attrs = (html: string, a: string) => [...html.matchAll(new RegExp(`${a}="([^"]*[A-Za-z][^"]*)"`, 'g'))].map((m) => m[1]!);
  it('the Yard check, the breakdown sheet and the property sheet: every word in their markup is said by yardWords / bdWords / twinWords', () => {
    const say = (fn: string) => new Set(keyedIn(nodeOf(fn)).map((k) => k.key));
    const cases: Array<[string, string]> = [['yard', 'yardWords'], ['bd', 'bdWords'], ['twin', 'twinWords']];
    for (const [id, fn] of cases) {
      const words = say(fn);
      const m = markup(id);
      for (const w of [...text(m), ...attrs(m, 'placeholder').filter((x) => /[A-Za-z]{2}/.test(x)), ...attrs(m, 'aria-label')]) {
        const key = w.replace(/\s*—$/, ''); // BREAKDOWN — <span>: the dash joins the unit's name (data)
        expect(words.has(key), `${id}: "${w}"`).toBe(true);
      }
    }
  });
  it('English mode never runs them (the markup is the English); in Spanish each runs once at load', () => {
    for (const fn of ['yardWords', 'bdWords', 'twinWords']) {
      expect(fnOf(fn)).toMatch(/^function \w+\(\) \{\n {2}if \(ES\.lang !== 'es'\) return;/);
      expect(script).toContain(`\n${fn}();\n`);
    }
  });
});
