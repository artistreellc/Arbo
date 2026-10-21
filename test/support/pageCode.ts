// Direction B P1 guards (review D2–D4): what a page can put on screen, and
// what it can send — read from the page's own code by the TypeScript parser,
// never by a regex over the source. A comment (whole line, trailing, or
// /* … */) can then neither keep a ruling word alive nor hide a send, and a
// send is a send however it is spelled: "POST", 'post', `PUT`, a DELETE, a
// method held in a variable, options built apart from the call, or another
// road out (sendBeacon, XMLHttpRequest, a form that posts).
import ts from 'typescript';

interface Page {
  /** The markup outside <script>, comments gone, entities decoded: the words as Mike sees them. */
  markup: string;
  /** Each inline script, parsed. */
  scripts: ts.SourceFile[];
}

const ENTITY: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…', middot: '·', bull: '•', times: '×', check: '✓', larr: '←', rarr: '→', uarr: '↑', darr: '↓',
};
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITY[e.toLowerCase()] ?? m);

function read(html: string): Page {
  const scripts: ts.SourceFile[] = [];
  const markup = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (_m, attrs: string, body: string) => {
    if (!/\bsrc\s*=/.test(attrs)) scripts.push(ts.createSourceFile(`inline-${scripts.length}.js`, body, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));
    return '\n';
  });
  return { markup: decode(markup.replace(/<!--[\s\S]*?-->/g, '')), scripts };
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

const isText = (n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateLiteralLikeNode =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n);
const EQUALITY = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);
const LOOKUPS = new Set(['includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'has', 'get', 'getElementById', 'querySelector', 'querySelectorAll', 'closest', 'matches']);
/** A string the code only compares or looks up by — never drawn: an object key, a `case`, either side of ===, x['key'], x.includes('…'). */
function onlyLooksUp(n: ts.Node): boolean {
  const p = n.parent;
  if (ts.isPropertyAssignment(p) && p.name === n) return true;
  if (ts.isCaseClause(p) && p.expression === n) return true;
  if (ts.isBinaryExpression(p) && EQUALITY.has(p.operatorToken.kind)) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return true;
  if (ts.isCallExpression(p) && p.arguments.includes(n as ts.Expression) && ts.isPropertyAccessExpression(p.expression) && LOOKUPS.has(p.expression.name.text)) return true;
  return false;
}

/** Every string a page's code holds that can reach the screen, with the function it sits in. */
function literals(page: Page): Array<{ text: string; fn: string }> {
  const out: Array<{ text: string; fn: string }> = [];
  for (const sf of page.scripts) walk(sf, (n) => { if (isText(n) && !onlyLooksUp(n)) out.push({ text: n.text, fn: enclosingFunction(n) }); });
  return out;
}

function enclosingFunction(n: ts.Node): string {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)) && p.name) return p.name.text;
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) return p.parent.name.text;
  }
  return '(top level)';
}

/** The words a page can show: its markup and every string in its code — no comment, no lookup key. */
export function screenText(html: string): string {
  const page = read(html);
  return [page.markup, ...literals(page).map((l) => l.text)].join('\n');
}

/** The calm phrases a hub must never draw (Direction B P1), in any case. */
export const CALM = ['All clear', 'Nothing holding', '0 new leads', 'you’re clear', "you're clear", 'you are clear'];
export function calmPhrases(html: string): string[] {
  const t = screenText(html).toLowerCase();
  return CALM.filter((p) => t.includes(p.toLowerCase()));
}

/** The two scoped inbox lines (M12): each said once, and only in the inbox panel. */
export const INBOX_LINES = ['Nothing needs you in the inbox right now.', 'Nothing needs you in the mail Arbo has read — but see the gap above.'];
/** "Nothing needs you" said anywhere but those two lines, where they belong. */
export function bareNothingNeedsYou(html: string): string[] {
  const page = read(html);
  const bad: string[] = [];
  if (/nothing needs you/i.test(page.markup)) bad.push('in the markup');
  const said = literals(page).filter((l) => /nothing needs you/i.test(l.text));
  for (const l of said) if (!INBOX_LINES.includes(l.text) || l.fn !== 'inboxIntentPanel') bad.push(`${l.fn}: ${l.text}`);
  for (const line of INBOX_LINES) if (said.filter((l) => l.text === line).length > 1) bad.push(`said twice: ${line}`);
  return bad;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
/** A method's value as written, upper case; null when it is not written out. */
function verbOf(v: ts.Expression | undefined): string | null {
  return v && (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) ? v.text.toUpperCase() : null;
}
const isMethodName = (name: ts.PropertyName | ts.MemberName | undefined) =>
  !!name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === 'method';

/**
 * Every send in a page, one entry each, sorted:
 *   POST to a path                 → the path as written ("'/api/leads/' + lead.id + '/status'")
 *   another verb                   → "DELETE '/api/…'"
 *   a method not written out       → "computed <path>" (the page's own api() helper is the one allowed)
 *   options built apart            → "POST (not in a call)", "POST (set apart)"
 *   another road out               → "sendBeacon", "XMLHttpRequest", "form post"
 * A GET is not a send; a comment is not code.
 */
export function sends(html: string): string[] {
  const page = read(html);
  const out: string[] = [];
  const record = (verb: string | null, where: string, fn: string) => {
    if (verb === 'GET') return;
    if (verb === null) { if (!(fn === 'api' && where === 'path')) out.push(`computed ${where}`); return; }
    out.push(verb === 'POST' ? where : `${verb} ${where}`);
  };
  for (const sf of page.scripts) walk(sf, (n) => {
    if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && isMethodName(n.name)) {
      const obj = n.parent;
      const call = obj.parent;
      const verb = ts.isPropertyAssignment(n) ? verbOf(n.initializer) : null;
      if (ts.isCallExpression(call) && call.arguments.includes(obj as ts.Expression) && call.arguments[0] && call.arguments[0] !== obj) {
        record(verb, norm(call.arguments[0].getText(sf)), enclosingFunction(n));
      } else {
        out.push(`${verb ?? 'computed'} (not in a call)`);
      }
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && (ts.isPropertyAccessExpression(n.left) ? isMethodName(n.left.name) : ts.isElementAccessExpression(n.left) && ts.isStringLiteral(n.left.argumentExpression) && n.left.argumentExpression.text === 'method')) {
      out.push(`${verbOf(n.right) ?? 'computed'} (set apart)`);
    } else if (ts.isIdentifier(n) && (n.text === 'sendBeacon' || n.text === 'XMLHttpRequest')) {
      out.push(n.text);
    }
  });
  for (const m of page.markup.matchAll(/<form\b[^>]*>/gi)) if (/\b(method|action)\s*=/i.test(m[0])) out.push('form post');
  return out.sort();
}
