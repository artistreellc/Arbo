// R27 Phase A, owner app (builder c) — docs/R27_SPANISH_PLAN.md, "Order of work" 3: the owner app's Office hub (its
// head, the agents' proposals, the six desk tiles, the rest of Arbo, Appearance and Install), Numbers (the benchmark,
// the rated and unrated areas, the campaigns and their form), Settings (the switches, today's work ZIP, live location,
// Google, Bouncie, the data links, the webhooks, Quo and Appearance), the Agents desk (its own fixed copy — what each
// desk wrote is model output, data, shown as written and marked English), Measure, Teach Arbo, and the assistant (its
// desk, its approval sheet and Today's "Waiting for your OK" card) in Spanish — exactly as the crew door does it
// (D111): T / tf / tn, one literal per sentence, a safety line only through the safety pair (esSay), and the server's
// own lines in English, marked "en inglés", until Phase B gives them twins.
//
// What this file proves:
//   - no English literal on these screens reaches the screen unwrapped, and no sentence is glued from pieces;
//   - every screen has its own dictionary, served whole but for safety drafts;
//   - every safety-class key goes through esSay, and each NEW one is a ledger DRAFT — nothing is reviewed;
//   - the Spanish speaks with the glossary's words and passes every gate;
//   - run over the REAL runtime and the dictionaries as served, each screen draws Spanish — data as written,
//     server lines in English and marked, a safety line as its pair (or the pointer) — and English mode draws
//     exactly the English.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { unitFiles, readUnit, loadDoorDictionary } from '../src/i18n/dictionaries.js';
import { isSafetyClass, loadLedger, pairSha } from '../src/i18n/ledger.js';
import { TRADE_TERMS, APP_TERMS } from '../src/i18n/glossary.js';
import { normalizeEs, findBannedEs } from '../src/i18n/banList.js';
import { esGateProblems } from '../src/i18n/gates.js';
import { OWNER_C_DRAFTS, OWNER_C_UNITS } from './support/esOwnerC.js';
import { RECORDED_EN, HELD_EN } from './support/esRecorded.js';
import { loadI18n, fakeDoc, FakeNode, type I18n } from './support/i18nRuntime.js';

const raw = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
// The page's own script: the last <script> block (the runtime and the dictionary are inlined before it at serve time).
const at = raw.lastIndexOf('<script>');
const script = raw.slice(at + 8, raw.indexOf('</script>', at));
const OFFSET = raw.slice(0, at).split('\n').length - 1;
const sf = ts.createSourceFile('index.html', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const lineOf = (n: ts.Node, f: ts.SourceFile = sf) => f.getLineAndCharacterOfPosition(n.getStart(f)).line + 1 + (f === sf ? OFFSET : 0);

// ── This unit's code, by screen: top-level functions and tables, and the approval sheet's close ($('id')). ──
const PANELS: Record<(typeof OWNER_C_UNITS)[number], string[]> = {
  'app-office': ['OFFICE_DESKS', 'officeDesk', 'officeProposals', 'officeRunAge', 'officeAge', 'officeHub', 'renderMore', 'isStandalone', 'installCard'],
  'app-numbers': ['VERDICT_LABEL', 'MIX_SAYS', 'mixLine', 'renderPerformance', 'renderCampaignList', 'refreshCampaignList', 'CAMPAIGN_TYPES', 'campaignComposer', 'areaCard'],
  'app-settings': ['renderSettings', 'buildSettings', 'bouncieRows', 'bouncieSettings'],
  'app-agents': ['AGENT_ICONS', 'INPUT_STATE', 'REPORT_STATUS', 'noRefs', 'PROPOSAL_GO', 'PROPOSAL_AT', 'agentProposals', 'proposalRow', 'runAllEight', 'renderAgents'],
  'app-measure': ['CONF_BADGE', 'upWords', 'renderMeasure', 'measureResult'],
  'app-learn': ['SECTION_NAMES', 'BRAIN_LABEL', 'lessonLabel', 'lessonTier', 'lessonsWaiting', 'renderLearn'],
  'app-assistant': ['APPROVAL_KIND', 'approvalChip', 'APPROVAL_NEXT', 'approvalAnswered', 'approvalRow', 'approvalDone', 'assistantReread', 'APPROVAL_BOX',
    'openApproval', "$('approval-close')", 'fillAssistToday', 'assistGap', 'ACTIVITY_CHIP', 'activityRow', 'assistStateLine', 'ASSIST_STATE', 'renderAssistant'],
};
// The sweep (task: "any remaining owner-app view or panel not named in groups a/b"): the shared code no other builder
// carries — the desk names' table (Teach Arbo's line is a word; the R26 names are names), the desk screens' head, the
// two-tap arm, the theme — each proven to hold no unwrapped English. Their keys (one: 'Learn') live in app-office.
const SWEEP = ['DESK_LINE', 'DESK_GEN', 'deskView', 'armTwice', 'themePref', 'applyTheme', 'setTheme', 'refreshActiveMoreView', "$('tab-more')", "$('settings-btn')"];

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
const MY_UNITS = Object.keys(PANELS) as Array<keyof typeof PANELS>;
const ALL_NAMES = [...Object.values(PANELS).flat(), ...SWEEP];

// ── The scan (the crew door's, D111, with the owner app's own code positions — es-owner-a's and es-owner-b's) ──
const KEYED = new Set(['T', 'tf', 'tn', 'esSay', 'esPair']);
// A literal in one of these positions is not words on the screen: a tag or a class, a selector, an attribute or event
// name, a route, an id, a tone, a field name, a locale or a format option. A Map, so a call named like an
// Object.prototype member (toLocaleString) is looked up as written.
const CODE_CALLS = new Map<string, number[] | 'all'>(Object.entries({
  el: [0, 1], createElement: 'all', setAttribute: [0], getAttribute: 'all', removeAttribute: 'all', hasAttribute: 'all',
  addEventListener: [0], querySelector: 'all', querySelectorAll: 'all', getElementById: 'all', $: 'all', add: 'all', remove: 'all',
  toggle: 'all', contains: 'all', closest: 'all', indexOf: 'all', split: 'all', startsWith: 'all', includes: 'all', replace: 'all', localeCompare: 'all',
  toLocaleString: 'all', toLocaleDateString: 'all', api: 'all', fetch: 'all', encodeURIComponent: 'all', scrollIntoView: 'all', switchTab: 'all',
  icon: 'all', sheetOpened: 'all', closeSheet: 'all', Error: 'all', has: 'all', get: 'all', getItem: 'all', setItem: [0], matchMedia: 'all', test: 'all',
  open: 'all', assign: 'all', join: 'all', openPanel: 'all', go: 'all',
  // a body's list fields checked before a count is trusted (officeDesk's lists), and the feeds card's screen key
  lists: [1], feedsCard: 'all',
  // The page's chip/badge: words first, then the tone (or class). A server line's field name. The shared dead-feed
  // helpers take the panel's own name, already in the page's language — keyed at the call (their words are es-owner-a's).
  chip: [1], badge: [1], esSayTwin: [2], esSayPick: [2], feedLine: [], feedState: [], state: [],
} as Record<string, number[] | 'all'>));
// A method name that is also a local function's name elsewhere is code only as a method: x.add('…').
const METHOD_ONLY = new Set(['add', 'remove', 'toggle', 'contains', 'has', 'get', 'replace', 'split', 'indexOf', 'includes', 'startsWith', 'closest', 'localeCompare',
  'test', 'join', 'open', 'assign']);
const CODE_ATTRS = new Set(['id', 'lang', 'role', 'aria-disabled', 'aria-hidden', 'aria-busy', 'aria-pressed', 'autocomplete', 'aria-live']);
const CODE_PROPS = new Set(['className', 'id', 'type', 'href', 'target', 'rel', 'inputMode', 'value', 'htmlFor', 'color', 'marginTop', 'minHeight', 'opacity',
  'cssText', 'accept', 'whiteSpace', 'width', 'minHeight']);
const OPTION_KEYS = new Set(['key', 'icon', 'view', 'method', 'status', 'behavior', 'block', 'top', 'body', 'decision', 'brain', 'minimumFractionDigits',
  'maximumFractionDigits', 'headers', 'x-arbor-key']);
// Codes the page compares, sends or keys by — written out so a new English word is never waved through.
const CODES = new Set([
  'use strict', 'unreadable', 'error', 'none', ' old', 'textarea', 'input', 'select', 'option', 'date', 'text', 'file', 'button', 'details', 'summary',
  'ul', 'li', 'span', 'small', 'label', 'div', 'smooth', 'center', 'start', 'nearest', 'noopener', '_blank', 'en', 'es',
  // the tones (TONE) and the office tiles' looks, the feed kinds, a dashed tile's class
  'alarm', 'stop', 'watch', 'good', 'info', 'hot', 'warn', 'ok', 'cut', 'sim', 'unset', 'unread', 'gap', 'bad', 'alt',
  // the theme's stored values (arboTheme)
  'auto', 'light', 'dark',
  // the looks the page styles by (tile and feed-state classes, the assistant's list modifier)
  'accent', 'accent wide', 'feed-state sim', 'feed-state cut', ' own',
  // the screens a proposal opens (PROPOSAL_GO's tab codes), the campaign types' codes, the figures' keys, the answers sent
  'calls', 'cal', 'followups', 'money', 'fleet', 'safety', 'perf', 'flyer', 'ads', 'seasonal', 'dbh', 'height', 'crown', 'lean',
  'approved', 'rejected', 'allow', 'deny', 'other',
  // the scan file's types a LiDAR app exports (the file picker's accept list), and the units every crew talks in (feet and
  // inches stay — R27 plan, "Dates and numbers")
  '.ply,.las,.xyz,.pts,.txt', ' in', ' ft', ' cm', ' m', '°',
  // the brain's name (a product), a trade abbreviation the crews use as written, the R26 desk names (names, as the Agents
  // roster the server sends), and the brands and variables named as written
  'Opus', 'DBH', 'Chief of Staff', 'Yard Boss', 'Crew Chief', 'Analyst', 'Front Desk', 'Dispatcher', 'Permit Desk', 'Arborist',
  'Google', 'ElevenLabs', 'Twilio',
]);
const isEsCheck = (e: ts.Expression, f: ts.SourceFile) => /^ES\.lang\s*===\s*'es'$/.test(e.getText(f).trim());
// English an older pin reads word for word (appUi, unchanged), kept as written in the English half of a Spanish-mode choice.
// Compared with runs of white space folded to one.
const PINNED_EN = new Set([
  "state('Numbers — ' + FEED_WORD[feedKind(e)], e.code === 503 ? feedSays(e) + ' Arbo cannot rate any area.' : 'Could not read the numbers. This is not a claim that everything is fine.')",
  "state('Channel switches — ' + FEED_WORD[feedKind(e)], 'Nothing was changed.')",
  "feedLine(rzErr, 'Work ZIP', 'Nothing was changed.')",
]);
const folded = (t: string) => t.replace(/\s+/g, ' ').trim();
// The bouncie sign-in's EXPIRED: a safety badge word, kept as its English code in bouncieRows (the rows' pins read it) and
// said through the safety pair where the chip is drawn (bouncieSettings: word === 'EXPIRED' ? esSay(…) — proven below).
const SAID_AT_DRAW = new Set(['EXPIRED']);

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
function exempt(lit: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral, f: ts.SourceFile = sf): string | null {
  const text = lit.text;
  if (!/[A-Za-z]{2}/.test(text)) return 'no words';
  if (CODES.has(text)) return 'listed code or name';
  if (/^(?:\/|\?|&|#|https?:|i-|cmp-|approval-|workzip-|perf-|queue-|today-|safety-|view-|tab-|:scope)/.test(text)) return 'a route, an id or a selector';
  if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/.test(text) || /^[A-Z]+(?:_[A-Z]+)+$/.test(text)) return 'a code word';
  if (/^[a-z]{2}-[A-Z]{2}$/.test(text)) return 'a locale';
  if (/^var\(--[a-z0-9-]+\)$/.test(text) || /^[a-z-]+:[^;]+(?:;[a-z-]+:[^;]+)*;?$/.test(text)) return 'a style value';
  let child: ts.Node = lit;
  for (let p: ts.Node | undefined = lit.parent; p; child = p, p = p.parent) {
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      const name = callName(p);
      const i = argIndex(p, child);
      if (i !== -1 && KEYED.has(name)) return 'wrapped';
      const code = METHOD_ONLY.has(name) && !ts.isPropertyAccessExpression(p.expression) ? undefined : CODE_CALLS.get(name);
      if (i !== -1 && code && (code === 'all' || code.includes(i))) return `code (${name})`;
      const a0 = p.arguments?.[0];
      if (name === 'setAttribute' && i === 1 && a0 && ts.isStringLiteral(a0) && (CODE_ATTRS.has(a0.text) || a0.text.startsWith('data-'))) return 'a code attribute';
    }
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) return 'a comparison';
    if (ts.isCaseClause(p) && child === p.expression) return 'a case';
    if (ts.isPropertyAssignment(p)) {
      const key = p.name.getText(f).replace(/^['"]|['"]$/g, '');
      if (child === p.name) return 'a property name';
      if (OPTION_KEYS.has(key)) return 'an option';
    }
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(p.left) && child === p.right) {
      if (CODE_PROPS.has(p.left.name.text)) return 'a code property';
      const owner = p.left.expression;
      if (ts.isPropertyAccessExpression(owner) && (owner.name.text === 'dataset' || owner.name.text === 'style')) return 'a dataset or style value';
    }
    // The English half of a Spanish-mode choice, kept as written because an older pin (appUi) reads its source word for word.
    if (ts.isConditionalExpression(p) && child === p.whenFalse && isEsCheck(p.condition, f) && PINNED_EN.has(folded(p.whenFalse.getText(f)))
      && /\b(?:T|tf|tn)\(/.test(p.whenTrue.getText(f))) return 'the pinned English half of a keyed choice';
    if (ts.isElementAccessExpression(p) && child === p.argumentExpression) return 'an index';
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && ['AGENT_ICONS', 'PROPOSAL_AT', 'APPROVAL_BOX'].includes(p.name.text)) return 'a code table';
    if (ts.isArrayLiteralExpression(p) && SAID_AT_DRAW.has(text) && p.elements[0] === child) return 'a safety word said at draw (esSay)';
    if (ts.isBlock(p) || ts.isSourceFile(p)) break; // an exemption holds within its own statement, never from a call around a callback
  }
  return null;
}
function unwrappedIn(node: ts.Node, f: ts.SourceFile = sf): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && exempt(n, f) === null) out.push(`${lineOf(n, f)}: ${JSON.stringify(n.text)}`);
    if (ts.isTemplateExpression(n)) out.push(`${lineOf(n, f)}: a template literal — use tf`);
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
      for (const a of args) { const k = lit(a); if (k !== null) out.push({ name, key: k, at: lineOf(n) }); }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}
/** A translated piece glued to English words: `T('…') + ' words'` or `'words ' + tf(…)`. */
function gluedIn(node: ts.Node, f: ts.SourceFile = sf): string[] {
  const out: string[] = [];
  const isKeyed = (n: ts.Node): boolean => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ['T', 'tf', 'tn'].includes(n.expression.text);
  const isWords = (n: ts.Node): boolean => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && /[A-Za-z]{2}/.test(n.text);
  const visit = (n: ts.Node) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken
      && ((isKeyed(n.left) && isWords(n.right)) || (isWords(n.left) && isKeyed(n.right)))) out.push(`${lineOf(n, f)}: ${n.getText(f).slice(0, 80)}`);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}
const keysOf = (names: string[]) => names.flatMap((nm) => keyedIn(nodeOf(nm)));
const unitDict = (unit: string): Record<string, string> => readUnit(`${unit}.es.json`) ?? {};
const myDict = (): Record<string, string> => Object.assign({}, ...MY_UNITS.map(unitDict));

describe('every word these screens draw goes through the runtime', () => {
  it('the scope names real declarations — nothing listed is missing from the page', () => {
    expect(ALL_NAMES.filter((n) => !TOP.has(n))).toEqual([]);
  });
  for (const [unit, names] of Object.entries(PANELS)) {
    it(`${unit}: no English literal reaches the screen unwrapped (each sentence a T/tf/tn/esSay key)`, () => {
      expect(names.flatMap((n) => unwrappedIn(nodeOf(n)))).toEqual([]);
    });
  }
  it('the sweep: the shared code no other builder carries holds no unwrapped English either', () => {
    expect(SWEEP.flatMap((n) => unwrappedIn(nodeOf(n)))).toEqual([]);
  });
  it('the scan bites: a bare sentence, a sentence glued from pieces, a template literal and glue onto a key are each caught', () => {
    const probe = (src: string) => {
      const f = ts.createSourceFile('p.js', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      return [...unwrappedIn(f, f), ...gluedIn(f, f)].map((l) => l.replace(/^\d+: /, ''));
    };
    expect(probe("box.appendChild(el('div', 'storm-muted', 'No proposals from this run.'));")).toEqual(['"No proposals from this run."']);
    expect(probe("x.textContent = 'Ran ' + when + ' ago';")).toEqual(['"Ran "', '" ago"']);
    expect(probe('x.textContent = `${n} desks`;')).toEqual(['a template literal — use tf']);
    expect(probe("x.textContent = T('Agents') + ' ran';")).toEqual(['" ran"', "T('Agents') + ' ran'"]);
    expect(probe("box.appendChild(el('div', 'storm-muted', T('No proposals from this run.')));")).toEqual([]);
    expect(probe("if (e.message === 'assistant_off') return;")).toEqual([]);
    // A dead-feed helper's name is the caller's words: keyed at the call, never waved through as code.
    expect(probe("v.appendChild(feedLine(e, 'Google status'));")).toEqual(['"Google status"']);
    expect(probe("v.appendChild(feedLine(e, T('Google status')));")).toEqual([]);
    // A Spanish-mode choice exempts its English half only when that half is a pinned one and the Spanish half is keyed.
    expect(probe("x.textContent = ES.lang === 'es' ? 'Hola' : 'Hello';")).toEqual(['"Hola"', '"Hello"']);
    expect(probe("x = ES.lang === 'es' ? tf('{n} desks', { n }) : feedLine(rzErr, 'Work ZIP', 'Nothing was changed.');")).toEqual([]);
    expect(probe("x = ES.lang === 'es' ? tf('{n} desks', { n }) : feedLine(rzErr, 'Work zip', 'Nothing was changed.');")).toEqual(['"Work zip"', '"Nothing was changed."']);
    // EXPIRED is waved through only as a row's first word (bouncieRows), never as a sentence.
    expect(probe("rows.push(['EXPIRED', 'stop', T('x')]);")).toEqual([]);
    expect(probe("x.textContent = 'EXPIRED';")).toEqual(['"EXPIRED"']);
  });
});

describe('one literal per sentence — no Spanish sentence is ever glued from pieces', () => {
  it('no translated piece is glued to English words', () => {
    expect(ALL_NAMES.flatMap((n) => gluedIn(nodeOf(n)))).toEqual([]);
  });
  it('no key starts or ends with a space, or ends open on a dash or a colon (a fragment is a glued sentence)', () => {
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
  it('every key is written out at its call, so parity can check it (no T(variable))', () => {
    const computed: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && KEYED.has(n.expression.text)) {
        const name = n.expression.text;
        const args = name === 'tn' ? [n.arguments[1], n.arguments[2]] : name === 'esSay' ? [n.arguments[1]] : [n.arguments[0]];
        for (const a of args) if (a && !ts.isStringLiteral(a) && !ts.isNoSubstitutionTemplateLiteral(a)) computed.push(`${lineOf(n)}: ${n.getText(sf).slice(0, 80)}`);
      }
      ts.forEachChild(n, visit);
    };
    for (const nm of ALL_NAMES) visit(nodeOf(nm));
    expect(computed).toEqual([]);
  });
});

describe('every screen has its own dictionary, served whole but for the safety drafts', () => {
  const places = new Function(`${/^const ES_PLACES = \{[\s\S]*?^\};$/m.exec(raw)?.[0] ?? 'const ES_PLACES = {};'}\nreturn ES_PLACES;`)() as Record<string, string>;
  it('each screen names its unit in ES_PLACES (unchanged), and each unit is one of these files', () => {
    expect(places['#view-more']).toBe('app-office');
    expect(places['#view-perf']).toBe('app-numbers');
    expect(places['#view-settings']).toBe('app-settings');
    expect(places['#view-agents']).toBe('app-agents');
    expect(places['#view-measure']).toBe('app-measure');
    expect(places['#view-learn']).toBe('app-learn');
    expect(places['#view-assistant']).toBe('app-assistant');
    expect([...MY_UNITS].sort()).toEqual([...OWNER_C_UNITS].sort());
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
  it('each screen’s keys are in its own unit (the sweep’s in app-office)', () => {
    for (const [unit, names] of Object.entries(PANELS)) {
      const d = unitDict(unit);
      expect(keysOf(names).filter((k) => !(k.key in d)).map((k) => `${k.at}: ${k.key}`), unit).toEqual([]);
    }
    const office = unitDict('app-office');
    expect(keysOf(SWEEP).filter((k) => !(k.key in office)).map((k) => k.key)).toEqual([]);
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
      const used = new Set([...keysOf(names), ...(unit === 'app-office' ? keysOf(SWEEP) : [])].map((k) => k.key));
      expect(Object.keys(unitDict(unit)).filter((k) => !used.has(k)), unit).toEqual([]);
    }
  });
});

describe('safety lines — only through the safety pair, and every NEW one a ledger draft (nothing reviewed here)', () => {
  it('every safety-class key these screens use is said with esSay (Spanish over the full English, or the pointer), never T/tf/tn', () => {
    expect(keysOf(ALL_NAMES).filter((k) => isSafetyClass(k.key) && k.name !== 'esSay').map((k) => `${k.at}: ${k.name}(${k.key})`)).toEqual([]);
  });
  it('the safety-class keys are exactly this unit’s new drafts', () => {
    const safety = [...new Set(keysOf(ALL_NAMES).filter((k) => isSafetyClass(k.key)).map((k) => k.key))].sort();
    expect(safety).toEqual(OWNER_C_DRAFTS.map((d) => d.en).sort());
    // …and no other key in these units is safety-class.
    expect(Object.keys(myDict()).filter(isSafetyClass).sort()).toEqual(OWNER_C_DRAFTS.map((d) => d.en).sort());
  });
  it('each new one is in its unit with the Spanish named here, and the ledger holds that exact pair as a DRAFT — no blind pass is claimed', () => {
    for (const d of OWNER_C_DRAFTS) {
      expect(unitDict(d.unit)[d.en], d.en).toBe(d.es);
      const e = loadLedger().find((x) => x.en === d.en && x.es === d.es && x.where === `dict:${d.unit}`);
      expect(e, d.en).toBeDefined();
      expect(e!.pass, d.en).toBe('draft');
      expect(e!.sha, d.en).toBe(pairSha(d.en, d.es));
      expect(e!.reviewedBy, d.en).toBeUndefined();
      expect(e!.backTranslation, d.en).toBeUndefined();
      expect(e!.note, d.en).toMatch(/^Not recorded — new in R27 Phase A \(owner app\)/);
    }
  });
  it('EXPIRED reaches the screen only through the pair: bouncieSettings draws the row’s word with esSay', () => {
    const src = nodeOf('bouncieSettings').getText(sf);
    expect(src).toContain("word === 'EXPIRED' ? esSay(chip('', tone), 'EXPIRED') : chip(word, tone)");
    // Only bouncieRows holds the bare word, as a row's first element (its pins read it).
    const bare = ALL_NAMES.flatMap((n) => {
      const hits: string[] = [];
      const v = (x: ts.Node) => { if (ts.isStringLiteral(x) && x.text === 'EXPIRED' && exempt(x) === 'a safety word said at draw (esSay)') hits.push(n); ts.forEachChild(x, v); };
      v(nodeOf(n));
      return hits;
    });
    expect([...new Set(bare)]).toEqual(['bouncieRows']);
  });
  it('the 17 entries D112 left are untouched — still exactly the recorded twelve and the held five, first in the file', () => {
    const first = loadLedger().slice(0, RECORDED_EN.length + HELD_EN.length);
    expect(first.filter((e) => e.pass === 'reviewed').map((e) => e.en)).toEqual([...RECORDED_EN]);
    expect(first.filter((e) => e.pass === 'draft').map((e) => e.en)).toEqual([...HELD_EN]);
    expect(loadLedger().filter((e) => e.pass !== 'draft').length).toBe(RECORDED_EN.length);
  });
  it('so the served dictionary holds back exactly the drafts from these units', () => {
    const served = loadDoorDictionary('app');
    const held = served.held.filter((h) => (MY_UNITS as string[]).includes(h.unit)).map((h) => h.key);
    expect([...new Set(held)].sort()).toEqual(OWNER_C_DRAFTS.map((d) => d.en).sort());
  });
});

describe('the Spanish speaks with one voice — the glossary’s words, usted, nothing banned', () => {
  it('every entry passes the ban list and every gate', () => {
    for (const [en, es] of Object.entries(myDict())) {
      expect(findBannedEs(es), `${en} → ${es}`).toEqual([]);
      expect(esGateProblems(en, es), `${en} → ${es}`).toEqual([]);
    }
  });
  // English says "1 off", "1 passed", "1 received" with the same words as many; Spanish agrees in number. A count said
  // through tf (one English form, no one/many pair) must read right with one — so its Spanish never puts a plural word
  // straight after the count ("1 apagados", "1 aprobados" — browser check, es-owner-c). The tile labels shown after a
  // big number are labels, not sentences; "overdue" is Today's shared word (a-today's "vencidas") and is flagged there.
  const ONE_FORM = ['{n} couldn’t be read', '{n} off', '{n} passed', '{n} broke a rule', '{n} missed something', '{n} can’t answer yet',
    '{n} to bill', '{n} no agreed figure', '{n} can’t tell', '⚠ {n} can’t see', '{n} with no cost on file', '{n} removal', '{n} pruning', '{n} other',
    '{label} — {n} received, last {when}', '{label} — {n} received since Arbo last restarted',
    'Quo (Sona calls & texts) — {n} received, last {when}', 'Quo (Sona calls & texts) — {n} received since Arbo last restarted'];
  it('a count with one English form reads right with one in Spanish', () => {
    const dict = myDict();
    for (const en of ONE_FORM) {
      const es = dict[en];
      expect(es, en).toBeTypeOf('string');
      const one = es!.replace('{n}', '1');
      // A plural word after one — unless it is inside a phrase a preposition opens ("1 sin fallas", "1 con una regla rota").
      expect(one, `${en} → ${es}`).not.toMatch(/(?:^|[^\d])1 (?!(?:sin|con|de|por|para) )(?:\p{L}+ )?\p{L}+(?:os|as)\b/u);
      expect(one, `${en} → ${es}`).not.toMatch(/(?:^|[^\d])1 [^·,:]*\b\p{L}+(?:ron|an|en)\b/u); // a plural verb after one ("1 no se pudieron leer")
    }
    // The fleet tile's label is the desk's own, said the same with one or many.
    expect(dict['held or down']).toBe('en espera o fuera de servicio');
  });
  // The glossary's "roster" is the office's list of who is on the crew; the Agents screen's roster is the list of the eight
  // agents — another thing, said as such ("la lista de agentes"), never the crew's list.
  const OTHER_SENSE: Record<string, string[]> = { roster: ['The agent roster', 'an empty roster'] };
  it('a key naming a glossary term says that term’s Spanish (never a synonym that drifts)', () => {
    const dict = myDict();
    for (const t of [...TRADE_TERMS, ...APP_TERMS]) {
      const head = normalizeEs(t.es.replace(/\s*\(.*\)\s*$/, ''));
      const enRe = new RegExp(`\\b${t.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i');
      for (const [en, es] of Object.entries(dict)) {
        if (!enRe.test(en) || (OTHER_SENSE[t.en] ?? []).includes(en)) continue;
        const n = normalizeEs(es);
        if (n.includes(normalizeEs(t.en))) continue;
        const stem = head.split(' ').map((w) => w.replace(/(?:es|s)$/, '').slice(0, Math.max(4, w.length - 2))).join('[a-z]* ');
        expect(new RegExp(stem).test(n), `${t.en} → "${t.es}": ${en} → ${es}`).toBe(true);
      }
    }
  });
  it('the D111 wording decisions hold: the roster, the data link, on site, the crew door, the door key', () => {
    for (const [en, es] of Object.entries(myDict())) {
      const n = normalizeEs(es);
      if (/\broster\b/i.test(en) && !OTHER_SENSE.roster!.includes(en)) expect(n, en).toContain('lista del personal');
      if (OTHER_SENSE.roster!.includes(en)) expect(n, en).toContain('lista de agentes');
      if (/\bdata links?\b/i.test(en)) {
        expect(n, en).toMatch(/conexion(?:es)? con los registros de la oficina/);
        expect(n, en).not.toMatch(/conexion(?:es)? de datos|enlaces? de datos/);
      }
      if (/\bon site\b/i.test(en)) expect(n, en).toContain('en el lugar de trabajo');
      if (/\bcrew door\b/i.test(en)) expect(n, en).toContain('puerta de la cuadrilla');
      if (/\bsign-in link\b/i.test(en)) expect(n, en).toContain('enlace de acceso');
    }
  });
  it('STOP stays STOP, a credential is never "licenciado" or "acreditado", and every value slot survives', () => {
    for (const [en, es] of Object.entries(myDict())) {
      if (/\bSTOP\b/.test(en)) expect(es, en).toMatch(/\bSTOP\b/);
      expect(normalizeEs(es), en).not.toMatch(/licenciad|acreditad/);
      expect((es.match(/\{\w+\}/g) ?? []).sort(), en).toEqual((en.match(/\{\w+\}/g) ?? []).sort());
    }
  });
  it('the Railway, Supabase and Bouncie variable names, the migration and the routes are kept exactly as written', () => {
    for (const [en, es] of Object.entries(myDict())) {
      for (const v of en.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\bmigration \d+\b|https?:\/\/\S+/g) ?? []) expect(es, en).toContain(v.replace(/^migration /, ''));
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
  maxLength = 0;
  rows = 0;
  accept = '';
  title = '';
  files: unknown = null;
  onclick: null | (() => unknown) = null;
  hasChildNodes(): boolean { return this.children.length > 0; }
  focus(): void {}
  replaceWith(...kids: FakeNode[]): void {
    const p = this.parentNode;
    if (!p) return;
    const at = p.children.indexOf(this);
    p.removeChild(this);
    kids.forEach((k, i) => { k.parentNode?.removeChild(k); k.parentNode = p; p.children.splice(at + i, 0, k); });
  }
}
const fnOf = (name: string): string => {
  const one = new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\}$`, 'm').exec(script);
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
const CONSTS = ['FEED_WORD', 'Cap', 'FEED_TAG', 'FEED_SAYS', 'RETRY', 'TONE', 'FEED_TONE', 'VIEW_TITLES', 'DESK_LINE', 'nb', 'VERDICT_LABEL', 'MIX_SAYS',
  'CAMPAIGN_TYPES', 'AGENT_ICONS', 'INPUT_STATE', 'REPORT_STATUS', 'noRefs', 'PROPOSAL_GO', 'PROPOSAL_AT', 'CONF_BADGE', 'SECTION_NAMES', 'BRAIN_LABEL',
  'lessonTier', 'APPROVAL_KIND', 'APPROVAL_NEXT', 'APPROVAL_BOX', 'ACTIVITY_CHIP', 'ASSIST_STATE', 'OFFICE_DESKS'];
const FNS = ['state', 'readingLine', 'chip', 'badge', 'plural', 'fmtWhen', 'fmtTime', 'feedKind', 'feedSays', 'feedLine', 'feedState', 'saveFailText', 'showSaveFail',
  'dollars', 'money', 'moneyCounts', 'armTwice', 'mixLine', 'renderPerformance', 'renderCampaignList', 'campaignComposer', 'areaCard', 'agentProposals', 'proposalRow',
  'renderAgents', 'upWords', 'renderMeasure', 'measureResult', 'lessonLabel', 'lessonsWaiting', 'renderLearn', 'approvalChip', 'approvalAnswered', 'approvalRow',
  'approvalDone', 'openApproval', 'assistGap', 'activityRow', 'assistStateLine', 'renderAssistant', 'fillAssistToday', 'officeDesk', 'officeRunAge',
  'officeProposals', 'bouncieRows', 'bouncieSettings', 'buildSettings', 'installCard', 'isStandalone'] as const;
type Fn = (...a: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Page = Record<(typeof FNS)[number] | 'setRun', Fn> & { byId: (id: string) => XNode };
/** This unit's functions with the page's shared helpers, over the real runtime in `lang`, one answer per path. */
function screens(lang: 'en' | 'es', answer: (path: string, body?: unknown) => unknown): Page {
  const doc = fakeDoc();
  doc.createElement = (t: string) => new XNode(t);
  const rt: I18n = loadI18n({ door: 'app', units: SERVED.units, stored: lang === 'es' ? { arboLang: 'es' } : {}, doc });
  const ids = new Map<string, XNode>();
  const byId = (id: string) => { if (!ids.has(id)) { const n = new XNode('div'); n.id = id; ids.set(id, n); } return ids.get(id)!; };
  const el = (tag: string, cls?: string, text?: string) => { const n = doc.createElement(tag) as XNode; if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const api = async (path: string, o?: { body?: unknown }) => { const a = answer(path, o && o.body); if (a instanceof Error) throw a; return JSON.parse(JSON.stringify(a)); };
  const deps: Record<string, unknown> = {
    T: rt.T, tf: rt.tf, tn: rt.tn, esSay: rt.esSay, esSayTwin: rt.esSayTwin, esEnMark: rt.esEnMark, esNum: rt.esNum, esLanguageChips: rt.esLanguageChips, ES: rt.ES,
    document: doc, $: byId, el, api, showKeywall: () => {}, switchTab: () => {}, openPanel: () => {}, renderMore: () => {}, sheetOpened: () => {}, closeSheet: () => {},
    icon: () => new XNode('svg'), location: { assign: () => {}, href: '' }, window: { matchMedia: () => ({ matches: false }), navigator: {} },
    navigator: { userAgent: 'test', onLine: true }, KEY: 'k', KEY_REFUSED: {}, themePref: () => 'auto', setTheme: () => {}, renderSettings: () => {},
  };
  const body = `let LINKS = 'readonly'; const LINKS_READY = Promise.resolve('readonly'); let KEY_REFUSED_WHY = '';
    let AGENT_RUN = null, AGENT_GEN = 0, ASSIST_GEN = 0, ASSIST_TODAY_GEN = 0, LEARN_GEN = 0, LEARN_POLL = null, settingsGen = 1, INSTALL_EVT = null;
    let LIDAR_LAST = null, LIDAR_UP = '', LIDAR_UP_CHANGED = false;
    async function runAllEight() { return AGENT_RUN; }
    function assistantReread() {}
    ${CONSTS.map(constOf).join('\n')}
    ${FNS.map(fnOf).join('\n')}
    return { ${FNS.join(', ')}, setRun: (r) => { AGENT_RUN = r; } };`;
  const p = new Function(...Object.keys(deps), body)(...Object.values(deps)) as Page;
  p.byId = byId;
  return p;
}
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const fail = (code: number, message: string) => Object.assign(new Error(message), { code });
const all = (n: FakeNode): FakeNode[] => [n, ...n.all()];
/** A drawn node's inline style (the page's harness nodes are XNodes). */
const styleOf = (n: FakeNode): Record<string, string> => (n as XNode).style;
/** Every node the page marked English in Spanish mode (lang="en"; its "en inglés" mark inside it). */
const markedEnglish = (n: FakeNode) => all(n).filter((x) => x.getAttribute('lang') === 'en').map((x) => x.textContent);
const POINTER = 'Aviso de seguridad — por ahora solo en inglés; pídale a alguien que se lo lea:';
/** In English: nothing marked, no pair, no Spanish words. */
// The language chips (Appearance) name each language in its own language, in both modes — they are the switch, not copy.
const isLangChip = (x: FakeNode) => x.getAttribute('lang') !== null && ['English', 'Español'].includes(x.textContent);
const plainEnglish = (n: FakeNode) => {
  expect(all(n).filter((x) => !isLangChip(x) && (x.getAttribute('lang') !== null || /\bes-(?:pair|held|en-mark)\b/.test(x.className)))).toEqual([]);
  expect(n.textContent.replace(/Español/g, '')).not.toMatch(/[áéíóúñ¿¡]|\binglés\b/);
};

const PERF = {
  fleetRatePerCrewHour: 412, windowDays: 365, checkedAtIso: null, withheld: ['23456'],
  blindSpots: ['Jobs without crew hours are left out of every rate.'],
  areas: [
    { areaKey: '23451', jobs: 6, verdict: 'above', normalizedRatePerCrewHour: 520, line: '6 jobs, 41 crew-hours.', mix: { removal: 4, pruning: 2 } },
    { areaKey: '23456', jobs: 1, verdict: 'not_enough_data', normalizedRatePerCrewHour: 300, line: '1 job.', mix: { other: 1 } },
  ],
  campaignsKnown: true,
  campaigns: [{ type: 'flyer', costPerBookedJob: 200, bookedJobs: 2, cost: 400, line: '$400 spent · 2 booked jobs.' }, { type: 'ads', costPerBookedJob: null, bookedJobs: null, cost: 300, line: 'No tracking number.' }],
};
describe('Numbers in Spanish over the real runtime — the page’s words in Spanish, the areas and the server’s lines as written (marked)', () => {
  it('Spanish: the head, the benchmark, the window, the sections, the chips and the campaign form', async () => {
    const p = screens('es', () => PERF);
    await p.renderPerformance();
    const v = p.byId('view-perf');
    const t = v.textContent;
    for (const s of ['Qué zonas y campañas dejan ganancia', 'promedio de la empresa por hora de cuadrilla', 'zonas calificadas', 'sin calificar',
      'Trabajos terminados y pagados en los últimos 12 meses: 7 trabajos.', '⚠ PUNTO CIEGO', 'Zonas calificadas — 1', 'Todavía no hay suficiente trabajo para calificar — 1',
      'SOBRE EL PROMEDIO', 'NO HAY DATOS SUFICIENTES', '4 de remoción · 2 de poda', '1 de otro tipo', 'Campañas', 'Reparto de volantes', '$200 por trabajo agendado',
      'Desconocido', 'Registrar una campaña', 'Lo que costó ($)', 'Registrarla', '$520/hora de cuadrilla']) expect(t, s).toContain(s);
    for (const en of ['Which areas', 'company avg', 'Paid, completed', 'BLIND SPOT', 'Rated areas', 'ABOVE AVERAGE', 'removal', 'per booked job', 'Register a campaign']) expect(t, en).not.toContain(en);
    // Data as written: the area keys; the server's own lines in English, marked.
    for (const k of ['23451', '23456']) expect(t).toContain(k);
    expect(markedEnglish(v)).toEqual(expect.arrayContaining(['Jobs without crew hours are left out of every rate.en inglés', '6 jobs, 41 crew-hours.en inglés', '$400 spent · 2 booked jobs.en inglés']));
  });
  it('a campaign’s figure may wrap in Spanish (twice the English, it squeezed the name at 320 px); English draws it as before', async () => {
    const figure = async (lang: 'es' | 'en') => {
      const p = screens(lang, () => PERF);
      await p.renderPerformance();
      return all(p.byId('view-perf')).find((n) => n.className === 'when' && /\$200/.test(n.textContent))!;
    };
    expect(styleOf(await figure('es'))).toMatchObject({ whiteSpace: 'normal', textAlign: 'right' });
    expect(styleOf(await figure('en')).whiteSpace).toBeUndefined();
  });
  it('English: exactly the English, nothing marked', async () => {
    const p = screens('en', () => PERF);
    await p.renderPerformance();
    const v = p.byId('view-perf');
    for (const s of ['Which areas & campaigns pay', 'company avg per crew-hour', 'Paid, completed jobs in the last 12 months: 7 jobs.', '⚠ BLIND SPOT', 'Rated areas — 1',
      'Not enough work yet to rate — 1', 'ABOVE AVERAGE', '4 removal · 2 pruning', '$200 per booked job', 'Unknown', '$520/crew-hr', 'Register it']) expect(v.textContent, s).toContain(s);
    plainEnglish(v);
  });
  it('a dead feed: Spanish names it in one template; English keeps appUi’s source line', async () => {
    const es = screens('es', () => fail(503, 'link_cut'));
    await es.renderPerformance();
    expect(es.byId('view-perf').textContent).toContain('Números — ');
    expect(es.byId('view-perf').textContent).toContain('Arbo no puede calificar ninguna zona.');
    const en = screens('en', () => fail(503, 'link_cut'));
    await en.renderPerformance();
    expect(en.byId('view-perf').textContent).toContain('Numbers — cut on purpose');
    expect(en.byId('view-perf').textContent).toContain('Arbo cannot rate any area.');
  });
});

const ROSTER = { brain: 'off', agents: [
  { id: 'yard-boss', name: 'Yard Boss', section: 'Fleet & money', roles: ['Fleet/Equipment/Parts (#10)'], reads: ['units', 'invoices'], can: ['read:fleet'], cannot: ['send anything'] },
  { id: 'analyst', name: 'Analyst', section: 'Numbers', roles: ['Analyst (#12)'], reads: ['jobs'], can: ['read:jobs'], cannot: ['spend money'] },
] };
const RUN = { ranAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(), reports: [
  { agentId: 'yard-boss', name: 'Yard Boss', status: 'degraded', inputs: [{ name: 'Units', state: 'read', detail: '' }, { name: 'Invoices', state: 'cut', detail: 'link cut' }],
    findings: [{ severity: 'act', text: 'Unit 3 is down.' }], proposals: [{ kind: 'parts_review', text: 'Review the chipper parts.' }] },
  { agentId: 'analyst', name: 'Analyst', status: 'ok', inputs: [{ name: 'Jobs', state: 'read', detail: '' }], findings: [], proposals: [] },
] };
describe('Agents in Spanish — its own copy in Spanish; the desks’ names and what they wrote as written (marked English)', () => {
  it('Spanish', async () => {
    const p = screens('es', (path) => (path === '/api/agents/sections' ? ROSTER : null));
    p.setRun(RUN);
    await p.renderAgents();
    const v = p.byId('view-agents');
    const t = v.textContent;
    for (const s of ['El cerebro', 'Ocho escritorios, un solo reglamento', 'Correr los ocho otra vez', 'hace más de 15 minutos', 'IA apagada — solo cuentas simples',
      'Propuestas para usted (1)', '1 escritorio no pudo leerlo todo (se nombra abajo) — puede que haya más.', 'Abrir Flota →', 'FALTAN DATOS', 'BIEN', 'LEÍDO',
      'Propuesta para usted: Review the chipper parts.', 'Lo que puede y no puede hacer', 'Puede: read fleet', 'Nunca: send anything',
      'Las conexiones con los registros de la oficina están cortadas a propósito']) expect(t, s).toContain(s);
    for (const en of ['The brain', 'Proposals for you', 'Run all eight', 'What it may and may not do', 'MISSING INPUTS']) expect(t, en).not.toContain(en);
    for (const name of ['Yard Boss', 'Analyst']) expect(t).toContain(name);
    expect(markedEnglish(v)).toEqual(expect.arrayContaining(['Review the chipper parts.en inglés', 'Unit 3 is down.en inglés', 'Invoices — link cuten inglés']));
  });
  it('English: exactly the English, nothing marked', async () => {
    const p = screens('en', (path) => (path === '/api/agents/sections' ? ROSTER : null));
    p.setRun(RUN);
    await p.renderAgents();
    const v = p.byId('view-agents');
    for (const s of ['The brain', 'Eight desks, one rulebook', 'Run all eight again', 'Proposals for you (1)', '1 desk couldn’t read everything (named below) — there may be more.',
      'Open Fleet →', 'Proposal for you: Review the chipper parts.', 'Invoices — link cut', 'May: read fleet']) expect(v.textContent, s).toContain(s);
    plainEnglish(v);
  });
  it('the roster’s role line: a short part stays whole, a long one may wrap between its words (it ran a 320 px page sideways)', async () => {
    const R2 = { brain: 'off', agents: [{ id: 'arborist', name: 'Arborist', section: 'Estimate', roles: ['#5 Master Arborist Knowledge', '#8 Vision & Labeling'], reads: [], can: [], cannot: [] }] };
    for (const lang of ['es', 'en'] as const) {
      const p = screens(lang, (path) => (path === '/api/agents/sections' ? R2 : null));
      await p.renderAgents();
      const line = all(p.byId('view-agents')).find((n) => n.className === 'loop-kind' && /Master Arborist/.test(n.textContent))!;
      const parts = line.children.filter((n) => n.tagName === 'span').map((n) => [n.textContent, styleOf(n).whiteSpace]);
      expect(parts, lang).toEqual([['Estimate', 'nowrap'], ['Master Arborist Knowledge', undefined], ['Vision & Labeling', 'nowrap']]);
      expect(line.textContent).toBe('Estimate ·\u00a0Master Arborist Knowledge ·\u00a0Vision & Labeling');
    }
  });
  it('Office’s proposals card: Spanish frame, the proposal as written (marked), the short button names its screen', () => {
    const es = screens('es', () => null);
    es.setRun(RUN);
    const c = es.officeProposals();
    expect(c.textContent).toContain('Agentes · trabajaron: ');
    expect(c.textContent).toContain('Propuestas para usted (1)');
    expect(c.textContent).toContain('Correr los ocho otra vez');
    expect(markedEnglish(c)).toEqual(['Review the chipper parts.en inglés']);
    const b = all(c).find((n) => n.tagName === 'button' && n.className === 'minibtn')!;
    // The screen's title is VIEW_TITLES (es-owner-a's unit): "Flota" once that unit's Spanish is in, the page's own title either way.
    expect(b.textContent).toMatch(/^(?:Fleet|Flota) ›$/);
    expect(b.getAttribute('aria-label')).toBe('Abrir Flota');
    const en = screens('en', () => null);
    en.setRun(RUN);
    const ce = en.officeProposals();
    expect(all(ce).find((n) => n.tagName === 'button' && n.className === 'minibtn')!.getAttribute('aria-label')).toBe('Open Fleet');
    plainEnglish(ce);
  });
});

describe('the Office desk tiles in Spanish — one template per part, the count’s label in its one/many form', () => {
  const ANSWERS: Record<string, unknown> = {
    '/api/money': { collections: [{}, {}], drafts: [{}], unknown: [{}], blocked: [] },
    '/api/fleet/units': { units: [{ status: 'held' }, { status: 'up' }, { status: 'maintenance' }] },
    '/api/safety': { aerialBlocked: [{}], blindSpots: [{}], certProblems: [{ daysUntil: 10 }, { daysUntil: -3 }] },
    '/api/performance': { areas: [{ verdict: 'above' }], campaigns: [{ cost: 120 }, { cost: null }], campaignsKnown: true },
  };
  it('Spanish and English, word for word', async () => {
    const es = screens('es', (path) => ANSWERS[path]);
    expect(await es.officeDesk('money')).toMatchObject({ n: 2, what: 'vencidas', sub: '1 por facturar · 1 no se sabe' });
    expect(await es.officeDesk('fleet')).toMatchObject({ n: 1, what: 'en espera o fuera de servicio', sub: '1 unidad en servicio · 1 necesita atención' });
    expect(await es.officeDesk('safety')).toMatchObject({ n: 1, what: 'sin trabajo en altura', sub: '1 certificación vence dentro de 30 días · 1 más necesita revisión · ⚠ 1 sin poder ver' });
    expect(await es.officeDesk('perf')).toMatchObject({ n: 1, what: 'zona calificada', sub: 'Anuncios: $120 gastados · 1 sin el costo registrado' });
    const en = screens('en', (path) => ANSWERS[path]);
    expect(await en.officeDesk('money')).toMatchObject({ what: 'overdue', sub: '1 to bill · 1 can’t tell' });
    expect(await en.officeDesk('fleet')).toMatchObject({ what: 'held or down', sub: '1 unit up · 1 needs attention' });
    expect(await en.officeDesk('safety')).toMatchObject({ what: 'no aerial', sub: '1 cert due in 30 days · 1 more needs a look · ⚠ 1 can’t see' });
    expect(await en.officeDesk('perf')).toMatchObject({ what: 'area rated', sub: 'Ads: $120 spent · 1 with no cost on file' });
  });
});

describe('Settings in Spanish — Bouncie’s EXPIRED through the safety pair (held: the pointer, then the English), the rest in Spanish', () => {
  const B = { signIn: { state: 'expired' }, link: { open: true }, positions: { state: 'ok' }, trucks: { known: 2 }, webhook: { wired: true, deliveries: 3, received: 3 } };
  it('Spanish: the EXPIRED chip is held (its review is not recorded) — the pointer, then the English; every other word Spanish', async () => {
    const p = screens('es', (path) => (path === '/api/bouncie' ? B : null));
    const v = new XNode('div');
    await p.bouncieSettings(v, () => false);
    const t = v.textContent;
    for (const s of ['Bouncie (rastreo de camiones)', 'La sesión de Bouncie venció o se quitó — toque Volver a conectar Bouncie.', 'ABIERTO',
      'Ubicaciones encendidas — 2 camiones, ningún reporte desde que Arbo se reinició.', 'CONECTADO', 'Actualizaciones en vivo — 3 actualizaciones guardadas desde que Arbo se reinició.',
      'Volver a conectar Bouncie']) expect(t, s).toContain(s);
    const pair = all(v).find((n) => n.classList.contains('es-pair'))!;
    expect(pair.classList.contains('es-held')).toBe(true);
    expect(pair.children[0]!.textContent).toBe(POINTER);
    expect(pair.children[1]!.textContent).toBe('EXPIRED');
    expect(pair.children[1]!.getAttribute('lang')).toBe('en');
    expect(pair.children[2]!.textContent).toBe('en inglés');
    // The pill holding the pair takes a line of its own and wraps — beside the words it ran past a 320 px phone.
    const pill = all(v).find((n) => n.children.includes(pair))!;
    const row = all(v).find((n) => n.children.includes(pill))!;
    expect(styleOf(row).flexWrap).toBe('wrap');
    expect(styleOf(pill)).toMatchObject({ whiteSpace: 'normal', flex: '1 1 100%' });
  });
  it('a held line’s Spanish pointer is a line of its own in the office app, as on the crew door (it ran into the English)', () => {
    const crew = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');
    const rule = '.es-held-why{display:block;margin-bottom:2px;font-size:.85em;font-weight:700}';
    expect(crew).toContain(rule);
    expect(raw).toContain(rule);
    // The "en inglés" mark beside an agent's finding or a scan's warning (alert boxes, whose <small> is a block line) stays a small tag.
    expect(raw).toContain('.storm .es-en-mark,.late .es-en-mark{display:inline-block;margin-top:0}');
  });
  it('a Settings row fits a 320 px phone in either language: long key names wrap, a switch keeps its width (browser check)', () => {
    // Beside a badge, GOOGLE_OAUTH_CLIENT_SECRET ran the page to 342 px in English and 378 px in Spanish; a squeezed switch
    // let ENCENDIDO run past its edge. Scoped to Settings: the badge keeps its own rule (min-width 92px, one line).
    expect(raw).toContain('#view-settings .loc-strip > span:not(.badge){min-width:0;overflow-wrap:anywhere}');
    expect(raw).toContain('#view-settings .loc-strip > .loc-toggle{flex:none}');
    expect(raw).toContain('.loc-strip .badge{flex:none;min-width:92px;text-align:center;white-space:nowrap}');
  });
  it('English: the rows as before, the chip plain', async () => {
    const p = screens('en', (path) => (path === '/api/bouncie' ? B : null));
    const v = new XNode('div');
    await p.bouncieSettings(v, () => false);
    expect(v.textContent).toContain('EXPIREDThe Bouncie sign-in expired or was removed — tap Reconnect Bouncie. Positions stop until you do.');
    expect(v.textContent).toContain('Positions on — 2 trucks, no report since Arbo last restarted.');
    plainEnglish(v);
  });
  const ROUTES: Record<string, unknown> = {
    '/api/settings/channels': { channels: [{ id: 'gmail', label: 'Gmail leads', on: true }] },
    '/api/inbox/intents': { pipeline: 'live' },
    '/api/settings/route': { workZip: '23451', location: { enabled: true, zip: '23452', ageMinutes: 4 } },
    '/api/reception/status': { linkCut: true },
    '/api/google/connect': { readOnly: true, token: { stored: false }, permissions: [{ what: 'Read Gmail', googleSays: 'Read your email', scope: 's1' }], consentUrl: 'https://example.invalid/c' },
    '/api/bouncie': { signIn: { state: 'keys_missing' }, link: { open: false }, webhook: { wired: false }, redirectUri: 'https://example.invalid/r' },
    '/api/links': { master: 'readonly', links: [{ link: 'leads', state: 'read-only', rowCounts: { lead: 3 } }, { link: 'calls', state: 'cut', reason: 'kept cut' }] },
    '/api/webhooks': { sources: { resend: { configured: true, received: 2 }, railway: { configured: false, received: 0 } }, cut: [] },
    '/api/quo': { status: { registration: { state: 'read_only', detail: 'Hook not created.' }, quoWrites: 'off' } },
  };
  it('the whole screen in Spanish: the data links say "conexiones con los registros de la oficina", the data stays as written', async () => {
    const p = screens('es', (path) => ROUTES[path]);
    const v = new XNode('div');
    await p.buildSettings(v, 1);
    await flush();
    const t = v.textContent;
    for (const s of ['Ajustes', 'Interruptores y conexiones', 'Interruptores de los canales de prospectos', 'ENCENDIDO', 'ZIP de trabajo de hoy', 'Configurado para hoy: 23451',
      'En vivo — última señal hace 4 min', 'SOLO LECTURA', 'Arbo pide: Read Gmail — Google lo llama “Read your email”', 'Abrir Google', 'Conectar',
      'Conexiones con los registros de la oficina', 'Prospectos — lead: 3', 'Registros de llamadas y mensajes', 'CORTADO', 'Resend (copias de los formularios del sitio web) — recibidos desde que Arbo se reinició: 2',
      'Quo (llamadas y mensajes de Sona) — Hook not created.', 'FALTA EL WEBHOOK', 'Apariencia', 'Automático', 'Idioma', 'SIN CONFIGURAR']) expect(t, s).toContain(s);
    for (const data of ['Gmail leads', 'Read Gmail', '23451']) expect(t).toContain(data);
    for (const en of ['Switches & connections', 'Data links', 'Appearance', 'Set for today', 'Open Google']) expect(t, en).not.toContain(en);
  });
  it('English: the whole screen as before, nothing marked', async () => {
    const p = screens('en', (path) => ROUTES[path]);
    const v = new XNode('div');
    await p.buildSettings(v, 1);
    await flush();
    for (const s of ['Switches & connections', 'Set for today: 23451', 'Live — last ping 4 min ago', 'Arbo asks for: Read Gmail — Google calls it “Read your email”',
      'Leads — lead: 3', 'Resend (website form copies) — 2 received since Arbo last restarted', 'Quo (Sona calls & texts) — Hook not created.', 'HOOK MISSING']) expect(v.textContent, s).toContain(s);
    plainEnglish(v);
  });
});

describe('the assistant in Spanish — its desk, the sheet and Today’s card; the STOP rule through the safety pair (held)', () => {
  const ST = { state: 'ready', sessionsOpen: 2, lastEventAt: null, officeCheck: { state: 'done', line: 'Office check done at 7:02.', report: { text: 'Two invoices unpaid.' } } };
  const AP = { approvals: [{ id: 'a1', kind: 'payment', summary: 'Invoice SIM-Alder', requestedAt: '2026-10-20T13:10:00Z', details: [{ label: 'Amount', value: '450.00' }] }] };
  const ACT = { items: [{ at: '2026-10-20T13:00:00Z', kind: 'decided', permission: 'deny', text: 'Text to SIM-Birch' }] };
  const answer = (path: string) => (path === '/api/assistant/status' ? ST : path === '/api/assistant/approvals' ? AP : ACT);
  it('Spanish: the desk', async () => {
    const p = screens('es', answer);
    await p.renderAssistant();
    const v = p.byId('view-assistant');
    const t = v.textContent;
    for (const s of ['Su asistente', 'Lo que le pregunta primero', 'Cada correo, antes de que salga.', 'Lo que hace por su cuenta', 'Estado', 'ENCENDIDO',
      'Encendido — trabajando en 2 cosas · todavía sin noticias', 'Esperando su visto bueno', 'PAGO', 'Lo que hizo', 'DENEGADO']) expect(t, s).toContain(s);
    // Data and the assistant's own words as written: the summary, the activity; the office check's line and report marked English.
    for (const d of ['Invoice SIM-Alder', 'Text to SIM-Birch']) expect(t).toContain(d);
    expect(markedEnglish(v)).toEqual(expect.arrayContaining(['Office check done at 7:02.en inglés', 'Two invoices unpaid.en inglés']));
    // The STOP rule is a safety line with no recorded review: the pointer, then the English, marked.
    const pair = all(v).find((n) => n.classList.contains('es-pair'))!;
    expect(pair.classList.contains('es-held')).toBe(true);
    expect(pair.children[0]!.textContent).toBe(POINTER);
    expect(pair.children[1]!.textContent).toBe('Every text, before it goes out. Texts to customers also need their consent, stop for good on STOP, and only go 8am–9pm ET.');
    expect(pair.children[1]!.getAttribute('lang')).toBe('en');
    expect(pair.children[2]!.textContent).toBe('en inglés');
  });
  it('Spanish: the approval sheet — a Square charge asks twice, its amount a value', () => {
    const p = screens('es', answer);
    p.openApproval(AP.approvals[0]);
    const body = p.byId('approval-body');
    const t = body.textContent;
    expect(p.byId('approval-title').textContent).toBe('Invoice SIM-Alder');
    for (const s of ['PAGO', 'Lo pidió: ', 'Amount', '450.00', 'Aprobar — cobrar $450.00', 'Por qué, para Arbo (opcional)', 'Denegar']) expect(t, s).toContain(s);
    expect(p.approvalAnswered({ kind: 'payment' }, 'allow')).toBe('Aprobado — Arbo lo va a cobrar ahora.');
    expect(p.approvalAnswered({ kind: 'crm' }, 'allow')).toBe('Aprobado — Arbo lo va a hacer ahora.');
    expect(p.approvalAnswered({ kind: 'email' }, 'deny', 'no')).toBe('Denegado — a Arbo se le dijo por qué.');
  });
  it('English: the desk and the sheet as before, nothing marked', async () => {
    const p = screens('en', answer);
    await p.renderAssistant();
    const v = p.byId('view-assistant');
    for (const s of ['Your assistant', 'Every text, before it goes out. Texts to customers also need their consent, stop for good on STOP, and only go 8am–9pm ET.',
      'On — working on 2 things · not heard from yet', 'Office check done at 7:02.', 'DENIED']) expect(v.textContent, s).toContain(s);
    plainEnglish(v);
    p.openApproval(AP.approvals[0]);
    expect(p.byId('approval-body').textContent).toContain('Approve — charge $450.00');
    expect(p.approvalAnswered({ kind: 'payment' }, 'allow')).toBe('Approved — Arbo will charge it now.');
    plainEnglish(p.byId('approval-body'));
  });
});

describe('Measure and Teach Arbo in Spanish — the page’s words in Spanish; the engine’s and the scenarios’ words as written (marked)', () => {
  const R = {
    file: { name: 'oak.ply', points: 123456, upAxis: { axis: 'y', source: 'data', reason: 'ground' }, notes: ['Cropped to one tree.'] },
    measurement: { dbhCm: 50.8, heightM: 12, crownSpreadM: 8, leanDeg: 3.2, dbhFit: { rmseCm: 1.27 }, warnings: ['Scan may be in feet.'],
      confidence: { dbh: { level: 'good', reason: 'full circle' }, height: { level: 'low', reason: 'top not seen' }, crown: { level: 'fair', reason: 'gaps' }, lean: { level: 'good', reason: 'ok' } } },
    signOff: 'Measured by Arbo from a phone scan.',
  };
  it('Measure: Spanish, and English as before', () => {
    const es = screens('es', () => null);
    es.renderMeasure();
    const v = es.byId('view-measure');
    for (const s of ['Medir un árbol', 'Cómo escanear', 'Párese a 3–10 ft del tronco', 'Abrir un archivo de escaneo', 'Y arriba', 'Todavía no se ha medido nada.']) expect(v.textContent, s).toContain(s);
    const r = es.measureResult(R);
    for (const s of ['20 in', 'altura', 'copa', 'inclinación', 'BUENA', 'BAJA', 'DBH — buena: full circle; dispersión 0.5 in (1.3 cm)', 'ALTURA — baja: top not seen']) expect(r.textContent, s).toContain(s);
    expect(markedEnglish(r)).toEqual(expect.arrayContaining(['Scan may be in feet.en inglés', 'Cropped to one tree.en inglés', 'Measured by Arbo from a phone scan.en inglés']));
    expect(es.upWords(R.file.upAxis)).toBe(' Se leyó Y como arriba — el suelo del escaneo queda plano en ese sentido.');
    const en = screens('en', () => null);
    const re = en.measureResult(R);
    expect(re.textContent).toContain('DBH — good: full circle; scatter 0.5 in (1.3 cm)');
    expect(re.textContent).toContain('HEIGHT — low: top not seen');
    plainEnglish(re);
    expect(en.upWords(R.file.upAxis)).toBe(' Read Y as up — the ground in the scan lies flat that way.');
  });
  const CAT = { total: 3, rules: { r1: {}, r2: {} }, scenarios: [{ id: 's1', section: 'front_desk', title: 'Caller asks for a price', persona: 'SIM-Pat', difficulty: 2 }] };
  const STATE = { brain: 'scripted', opusAvailable: false, status: 'idle', report: { ranAt: '2026-10-20T13:00:00Z', passRate: 0.5, unhandled: 1, byRule: { r1: { passed: 1, violations: 0 } },
    bySection: { front_desk: { total: 2, passed: 1, broke: 1, missed: 0, unhandled: 0 } } },
    lessons: { where: 'memory', lessons: [{ id: 'l1', rule: 'r1', status: 'proposed', scenarioIds: ['s1'], proposedLesson: 'Never quote a price.', evidence: 'It costs $400', evidenceSaid: true }] } };
  it('Teach Arbo: Spanish, and English as before', async () => {
    const es = screens('es', (path) => (path === '/api/sim/catalog' ? CAT : STATE));
    await es.renderLearn();
    const v = es.byId('view-learn');
    for (const s of ['Enséñele al cerebro', 'escenarios', 'reglas revisadas', 'aprobado', '1 todavía sin respuesta', 'Correr la revisión de reglas', 'Por escritorio',
      '1 sin fallas · 1 con una regla rota', 'Lecciones esperando su respuesta', 'Rompió una regla', '1 escenario', 'Dijo: “It costs $400”', 'Aprobar', 'Rechazar',
      'Los problemas con los que practica', '• Caller asks for a price (SIM-Pat, nivel 2)', 'Front Desk']) expect(v.textContent, s).toContain(s);
    expect(markedEnglish(v)).toEqual(expect.arrayContaining(['Never quote a price.en inglés', 'Caller asks for a price' + 'en inglés']));
    const en = screens('en', (path) => (path === '/api/sim/catalog' ? CAT : STATE));
    await en.renderLearn();
    const ve = en.byId('view-learn');
    for (const s of ['Teach the brain', '1 can’t answer yet', '1 passed · 1 broke a rule · 0 missed something · 0 can’t answer yet', 'It said: “It costs $400”', '• Caller asks for a price (SIM-Pat, level 2)']) expect(ve.textContent, s).toContain(s);
    plainEnglish(ve);
  });
});
