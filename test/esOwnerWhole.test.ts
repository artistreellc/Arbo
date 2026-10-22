// R27 Phase A unit 2 (D113) — the owner app in Spanish, as ONE app: the three builders' units merged.
//
// Each unit's own test (esOwnerA, esOwnerB, esOwnerC) scans the code it owns. This file checks what none of
// them can see alone:
//   - the WHOLE page script is covered: every top-level statement is in one unit's scope, or holds no words;
//   - the page's own markup (the key screen, the header, the dock, the sheets) is said through T in Spanish;
//   - one voice: an English key two units both carry says the same Spanish in each (the runtime merges the
//     door's units into one dictionary, so two Spanish for one key would let the alphabet pick one);
//   - the shared §1B words one unit translated (FEED_WORD, the feed cards, the save failures) are never glued to
//     English or marked "en inglés" by another unit's screen;
//   - a count Spanish cannot agree with is said in a number-invariant form ("1 con atraso", never "1 vencidas").
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { unitFiles, readUnit, loadDoorDictionary } from '../src/i18n/dictionaries.js';
import { OWNER_A_SCOPE, OWNER_A_STATEMENTS } from './support/esOwnerA.js';
import { OWNER_B_PANELS, OWNER_B_SHARED } from './support/esOwnerB.js';
import { OWNER_C_PANELS, OWNER_C_SWEEP } from './support/esOwnerC.js';
import { loadI18n, FakeNode } from './support/i18nRuntime.js';

const raw = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
const at = raw.lastIndexOf('<script>');
const script = raw.slice(at + 8, raw.indexOf('</script>', at));
const OFFSET = raw.slice(0, at).split('\n').length - 1;
const sf = ts.createSourceFile('index.html', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 + OFFSET;

// ── Every statement of the page script: in a unit's scope, or code only ──
const SCOPED = new Set<string>([...OWNER_A_SCOPE, ...Object.values(OWNER_B_PANELS).flat(), ...OWNER_B_SHARED, ...Object.values(OWNER_C_PANELS).flat(), ...OWNER_C_SWEEP]);
function topNames(st: ts.Statement): string[] {
  if (ts.isFunctionDeclaration(st) && st.name) return [st.name.text];
  if (ts.isVariableStatement(st)) return st.declarationList.declarations.map((d) => d.name.getText(sf));
  if (ts.isExpressionStatement(st) && ts.isCallExpression(st.expression)) {
    const m = /^(\$\('[\w-]+'\))\.addEventListener\(/.exec(st.expression.getText(sf));
    if (m) return [m[1]!];
  }
  return [];
}
const covered = (st: ts.Statement) => topNames(st).some((n) => SCOPED.has(n)) || OWNER_A_STATEMENTS.some((s) => st.getText(sf).startsWith(s));
// A statement no unit's scan reads may hold codes only — every one written out here, so a new English word in an unowned
// statement fails until it is wrapped (and its statement put in a unit's scope). The tab and view ids, the storage keys,
// the event names, the tones' classes, ES_PLACES's selectors and units, the units' status codes.
const UNOWNED_CODES = new Set([
  'use strict', 'arborKey', '/health', 'unknown', 'info', 'watch', 'good', 'stop', 'function', '400px 0px', 'arboSonaHandled', 'all',
  'artistreeofvirginia@gmail.com', 'message', 'en-US', 'keygo', 'click', 'keyinput', 'keydown', 'Enter', 'svg', 'keywall', 'es-toggle',
  'beforeinstallprompt', 'online', 'offline', 'talk-close', 'talk', 'talk-go', 'done', 'visibilitychange', 'hidden', 'back-btn', 'photo-close',
  'photo', 'maps-close', 'maps', '(display-mode: standalone)', 'today', 'leads', 'cal', 'estimate', 'book', 'followups', 'calls', 'more', 'perf',
  'show', 'resize', 'nav', 'tab-',
  // The office's home city for the permit desk: a name, as written.
  'Virginia Beach',
]);
// UNIT_STATUS: the units' status labels, said where they are drawn (the fleet's statusSay; DOWN and HELD through the pair).
const SAID_AT_DRAW = new Set(['UP', 'DOWN', 'NEEDS ATTENTION', 'HELD', 'RETIRED']);
const isCodeLike = (t: string) => /^(?:[#.][\w-]|app-|view-|t-(?:alarm|stop|watch|good|info)$)/.test(t);

describe('the whole page script is covered — every statement in one unit’s scope, or code only', () => {
  it('a statement no unit scans holds no words: each literal is a listed code, a selector, a unit or a tone class', () => {
    const words: string[] = [];
    for (const st of sf.statements) {
      if (covered(st)) continue;
      const names = topNames(st);
      const visit = (n: ts.Node) => {
        if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && /[A-Za-z]{2}/.test(n.text)) {
          const ok = UNOWNED_CODES.has(n.text) || isCodeLike(n.text) || (names.includes('UNIT_STATUS') && SAID_AT_DRAW.has(n.text));
          if (!ok) words.push(`${lineOf(n)}: ${JSON.stringify(n.text)}`);
        }
        if (ts.isTemplateExpression(n)) words.push(`${lineOf(n)}: a template literal`);
        ts.forEachChild(n, visit);
      };
      visit(st);
    }
    expect(words).toEqual([]);
  });
  it('every UNIT_STATUS label is said where it is drawn — a case in the fleet chip’s statusSay', () => {
    const table = sf.statements.find((st) => topNames(st).includes('UNIT_STATUS'))!.getText(sf);
    const labels = [...table.matchAll(/:\s*\['([^']+)'/g)].map((m) => m[1]!);
    expect(labels.length).toBeGreaterThan(2);
    const fleet = sf.statements.find((st) => topNames(st).includes('renderFleetList'))!.getText(sf);
    for (const l of labels) expect(fleet, l).toMatch(new RegExp(`case '${l}': (?:return esSay\\(n, '${l}'\\)|n\\.textContent = T\\('${l}'\\); return n);`));
  });
  it('the scopes name real statements, and no statement is scanned by two units (one owner each)', () => {
    const tops = new Set(sf.statements.flatMap(topNames));
    expect([...SCOPED].filter((n) => !tops.has(n))).toEqual([]);
    const owners = (n: string) => [OWNER_A_SCOPE.includes(n), Object.values(OWNER_B_PANELS).flat().includes(n) || OWNER_B_SHARED.includes(n),
      Object.values(OWNER_C_PANELS).flat().includes(n) || OWNER_C_SWEEP.includes(n)].filter(Boolean).length;
    expect([...SCOPED].filter((n) => owners(n) > 1)).toEqual([]);
  });
});

// ── The page's own markup ──
const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…', nbsp: ' ', middot: '·' };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITY[e] ?? m));
const markup = raw.slice(raw.indexOf('<body'), at).replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '');
// Names, as written in both languages: the brand on the key screen and the header, the company, Google's own product name.
const BRANDS = new Set(['ARBO', 'Art-is-Tree', 'GOOGLE MAPS']);
const appDict = (): Record<string, string> => Object.assign({}, ...Object.values(loadDoorDictionary('app').units));

describe('the page’s own markup is said in Spanish — every text and label on the key screen, the header, the dock and the sheets', () => {
  const texts = [
    ...[...markup.matchAll(/>([^<]+)</g)].map((m) => decode(m[1]!).replace(/\s+/g, ' ').trim()),
    ...[...markup.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]*)"/g)].map((m) => decode(m[1]!).trim()),
  ].filter((t) => /[A-Za-z]{2}/.test(t));
  it('finds the markup’s words (the scan reads the page)', () => {
    expect(texts.length).toBeGreaterThan(40);
    expect(texts).toContain('YARD CHECK');
    expect(texts).toContain('Close');
  });
  it('each is a brand, or a key the page script says through T and the served dictionary holds', () => {
    const dict = appDict();
    const said = (t: string) => script.includes(`T('${t.replace(/'/g, '\\\'')}')`) || script.includes(`T('${t}')`);
    const missing = texts.filter((t) => !BRANDS.has(t)).map((t) => t.replace(/ —$/, '')) // the breakdown sheet's "BREAKDOWN —": the word, then the unit (data)
      .filter((t) => !(said(t) && t in dict));
    expect([...new Set(missing)]).toEqual([]);
  });
});

// ── One voice across the units ──
describe('one voice — an English key carries one Spanish in every unit that holds it', () => {
  const byKey = new Map<string, Map<string, string>>();
  for (const u of unitFiles().filter((f) => f.door === 'app' || f.door === 'map')) {
    for (const [k, v] of Object.entries(readUnit(u.file) ?? {})) {
      if (!byKey.has(k)) byKey.set(k, new Map());
      byKey.get(k)!.set(u.unit, v);
    }
  }
  it('no key says two things (the office app’s units and the map page’s)', () => {
    const split = [...byKey].filter(([, m]) => new Set(m.values()).size > 1).map(([k, m]) => `${k} → ${[...m].map(([u, v]) => `${u}: ${v}`).join(' | ')}`);
    expect(split).toEqual([]);
  });
  it('a key the units share is really shared (the check reads them)', () => {
    expect([...byKey.values()].filter((m) => m.size > 1).length).toBeGreaterThan(20);
  });
  it('one word for the same thing: "coming due" is "por vencer", a data link D111’s "conexión con los registros de la oficina"', () => {
    const d = appDict();
    expect(d['Coming due']).toBe('Por vencer');
    expect(d['coming due']).toBe('por vencer');
    expect(d['COMING DUE']).toBe('POR VENCER');
    // D111's wording decision, in every unit (the crew door's "office data link" says it too).
    for (const [en, es] of Object.entries(d)) if (/\bdata links?\b/i.test(en)) expect(es.toLowerCase(), en).toMatch(/conexi(?:ón|ones) con los registros de la oficina/);
    expect(d['YARD CHECK']).toBe('REVISIÓN DE RENTABILIDAD');
  });
  it('a count Spanish cannot agree with is number-invariant: the money tile reads "1 con atraso", never "1 vencidas"', () => {
    const d = appDict();
    expect(d['overdue']).toBe('con atraso');
  });
});

// ── The shared §1B words: one unit translated them; no other unit glues English to them or marks them English ──
describe('the shared feed and save-failure words are said in Spanish on every screen — never glued to English, never marked English', () => {
  it('no string literal with words is joined to FEED_WORD, FEED_SAYS or feedSays() by +, outside the English half of a Spanish-mode choice', () => {
    const bad: string[] = [];
    const chain = (e: ts.Expression): ts.Expression[] => {
      let x: ts.Expression = e;
      while (ts.isParenthesizedExpression(x)) x = x.expression;
      return ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.PlusToken ? [...chain(x.left), ...chain(x.right)] : [x];
    };
    // An operand that is English words as written: a literal, or a choice between literals (never a keyed call's argument).
    const english = (e: ts.Expression): boolean => {
      let x: ts.Expression = e;
      while (ts.isParenthesizedExpression(x)) x = x.expression;
      if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return /[A-Za-z]{2}/.test(x.text);
      if (ts.isConditionalExpression(x)) return english(x.whenTrue) || english(x.whenFalse);
      if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.PlusToken) return chain(x).some(english);
      return false;
    };
    const shared = (e: ts.Expression) => /\bFEED_WORD\b|\bFEED_SAYS\b|\bfeedSays\(/.test(e.getText(sf));
    const visit = (n: ts.Node) => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken && !(ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
        const ops = chain(n);
        let inEnglishHalf = false;
        for (let p: ts.Node = n; p.parent; p = p.parent) {
          if (ts.isConditionalExpression(p.parent) && p.parent.whenFalse === p && /^ES\.lang\s*===\s*'es'$/.test(p.parent.condition.getText(sf).trim())) inEnglishHalf = true;
        }
        if (!inEnglishHalf && ops.some(shared) && ops.some(english)) bad.push(`${lineOf(n)}: ${n.getText(sf).slice(0, 100)}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(bad).toEqual([]);
  });
  it('the scan bites: an English piece glued to the shared words is caught; keyed sentences and the English half of a keyed choice are not', () => {
    const probe = (src: string) => {
      const f = ts.createSourceFile('p.js', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      let hit = false;
      const v = (n: ts.Node) => { if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken && /FEED_WORD|feedSays/.test(n.getText(f)) && /'[^']*[A-Za-z]{2}[^']*' \+|\+ '[^']*[A-Za-z]{2}/.test(n.getText(f))) hit = true; ts.forEachChild(n, v); };
      v(f);
      return hit;
    };
    expect(probe("x = 'Ledger — ' + FEED_WORD[k];")).toBe(true);
    expect(probe("x = feedSays(e) + ' Arbo cannot tell you what is owed.';")).toBe(true);
    expect(probe("x = feedSays(e) + ' ' + T('Arbo cannot tell you what is owed.');")).toBe(false);
  });
  // "en inglés" marks a line Arbo cannot say in Spanish yet: the server's own words (Phase B), a key not translated.
  // These are the only functions that put the mark on a node directly — each one checked by hand at the merge (D113);
  // a new one means a new English line on a Spanish screen, and is read before it is added here.
  const MARKS_ENGLISH = new Map<string, string>([
    ['beforeYouRoll', 'a blind spot is the server’s own words (Phase B twins them)'],
    ['saveFailMark', 'a save refused in the server’s own words (read-only’s line)'],
  ]);
  it('only the listed functions mark a node "en inglés" directly — never a dead-feed card, a feed line or a save failure built from the shared words', () => {
    const marking = sf.statements.filter((st) => /\besEnMark\(\)/.test(st.getText(sf))).flatMap(topNames);
    expect(marking.sort()).toEqual([...MARKS_ENGLISH.keys()].sort());
  });
  it('a save refused in the server’s own words (read-only’s line) is the one save failure marked English — by showSaveFail, for every screen', () => {
    const fn = sf.statements.find((st) => topNames(st).includes('showSaveFail'))!.getText(sf);
    expect(fn).toContain('saveFailMark(n, e)');
    const mark = sf.statements.find((st) => topNames(st).includes('saveFailMark'))!.getText(sf);
    expect(mark).toContain("e.message === 'read_only' && e.line");
    expect(mark).toContain("if (ES.lang !== 'es') return n;"); // English draws exactly as before
  });
});

// ── One way to say a safety label (D111's rule): a label held back says the Spanish pointer first, never English alone. ──
// es-owner-a's permitChip said its pair with esPair (no pointer when held); es-owner-b's permitLabel and every other
// safety chip use esSay. Merged, the Leads chip and the Estimate/Permit rules chips must behave the same when a label is held.
describe('a permit label held back wears the pointer on every screen — the Leads chip as the others', () => {
  const src = (re: RegExp) => { const m = re.exec(script); if (!m) throw new Error(String(re)); return m[0]; };
  const page = (units: Record<string, Record<string, string>>) => {
    const rt = loadI18n({ door: 'app', units, stored: { arboLang: 'es' } });
    const el = (tag: string, cls?: string, text?: string) => { const n = rt.doc.createElement(tag) as FakeNode; if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
    const body = [src(/^const TONE = [^\n]*$/m), src(/^function badge\([^\n]*\}$/m), src(/^function chip\([\s\S]*?^\}$/m),
      src(/^const PERMIT_STATE = [^\n]*$/m), src(/^function permitChip\([\s\S]*?^\}$/m), 'return { permitChip };'].join('\n');
    return new Function('ES', 'T', 'esSay', 'esPair', 'el', body)(rt.ES, rt.T, rt.esSay, rt.esPair, el) as { permitChip: (s: string) => FakeNode };
  };
  const served = loadDoorDictionary('app').units;
  it('recorded (as served today): the Spanish over the full English, in one .es-pair holder', () => {
    const c = page(served).permitChip('PERMIT_LIKELY');
    const box = c.querySelector('.es-pair')!;
    expect(box).not.toBeNull();
    expect(box.classList.contains('es-held')).toBe(false);
    expect(c.querySelector('.es-pair-es')!.textContent).toBe('PROBABLEMENTE SE NECESITA PERMISO');
  });
  it('held (its review not recorded): the pointer, then the English — never the English alone', () => {
    const held = Object.fromEntries(Object.entries(served).map(([u, d]) => [u, Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'PERMIT LIKELY'))]));
    const c = page(held).permitChip('PERMIT_LIKELY');
    const box = c.querySelector('.es-pair')!;
    expect(box && box.classList.contains('es-held')).toBe(true);
    expect(box.children[0]!.textContent).toBe('Aviso de seguridad — por ahora solo en inglés; pídale a alguien que se lo lea:');
    expect(box.textContent).toContain('PERMIT LIKELY');
  });
});

// ── What the merged browser check found at 320 px (D113), kept fixed — Spanish only, English lays out exactly as before. ──
describe('the merged app at 320 px in Spanish — what the browser check found', () => {
  const css = [...raw.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]!).join('\n');
  it('an Office desk tile’s Spanish title fits its tile ("Seguimientos" ran 15 px past it, clipped)', () => {
    expect(css).toContain('@media (max-width:359px){html[lang="es"] .otile .otitle{font-size:16px;overflow-wrap:anywhere}}');
  });
  it('a feeds card head’s Spanish counts wrap inside the button ("1 sin estar en los datos de práctica" ran past it)', () => {
    expect(css).toContain('html[lang="es"] .feeds-head .fh{white-space:normal}');
    // English keeps each count with its words, as before.
    expect(css).toContain('.feeds-head .fh{white-space:nowrap}');
  });
});
