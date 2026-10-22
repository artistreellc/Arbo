// Direction B P1 review (D2–D4): the P1 guards must bite. Each test below
// breaks the owner page the way the review did and checks that the guard
// sees it. A guard that passes on a broken page is worse than none: it says
// "locked" over something that is not.
//   D2 — the send snapshot saw only the exact text `method: 'POST'`.
//   D3 — the calm-phrase gate was case-sensitive, and the scoped inbox line
//        could be reused anywhere.
//   D4 — a ruling word kept alive in a trailing // or /* */ comment, or as a
//        lookup key, passed the strings guard.
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';
import { screenText, sends, calmPhrases, bareNothingNeedsYou } from './support/pageCode.js';

const raw = loadAppHtml();
/** The page with one edit; the edit's target must be there exactly once. */
const mutate = (from: string, to: string): string => {
  expect(raw.split(from).length - 1, `mutation target: ${from}`).toBe(1);
  return raw.replace(from, () => to);
};
const PANEL = 'async function outreachPanel(full) {';
// R27 Phase A (es-owner-a; pins moved, meaning kept): the permit chip also says its label through the safety pair keyed
// by the same words (permitChip: w === 'PERMIT LIKELY' ? esSay(c, 'PERMIT LIKELY') — esSay since D113, as every other
// safety chip). That draw is relabelled with the map, so the word is left only in lookups — the map's key, the === that
// picks the pair, PERMIT_STATUS['PERMIT LIKELY'].
const PAIR_DRAW = "w === 'PERMIT LIKELY' ? esSay(c, 'PERMIT LIKELY')";
const PAIR_UNDRAWN = "w === 'PERMIT LIKELY' ? esSay(c, 'Permit likely')";
/** The page with a line of code added at the top of outreachPanel. */
const withCode = (line: string) => mutate(PANEL, `${PANEL}\n  if (full === 'x') { ${line} }`);

describe('the send snapshot sees every send, however it is spelled (D2)', () => {
  const base = sends(raw);
  /** What a page sends beyond today's page (a multiset difference: a second send to a listed path counts). */
  const added = (html: string) => {
    const left = [...base];
    return sends(html).filter((s) => { const i = left.indexOf(s); if (i < 0) return true; left.splice(i, 1); return false; });
  };

  it.each([
    ['double quotes', `api('/api/evil/send', { method: "POST" });`, "'/api/evil/send'"],
    ['no space', `api('/api/evil/send', { method:'POST' });`, "'/api/evil/send'"],
    ['a template literal', 'api(\'/api/evil/send\', { method: `POST` });', "'/api/evil/send'"],
    ['lower case', `api('/api/evil/send', { method: 'post' });`, "'/api/evil/send'"],
    ['a DELETE', `api('/api/leads/1', { method: 'DELETE' });`, "DELETE '/api/leads/1'"],
    ['a PUT', `api('/api/leads/1', { method: 'PUT', body: {} });`, "PUT '/api/leads/1'"],
    ['a PATCH', `api('/api/leads/1', { method: 'PATCH', body: {} });`, "PATCH '/api/leads/1'"],
    ['a quoted key', `api('/api/evil/send', { 'method': 'POST' });`, "'/api/evil/send'"],
    ['fetch, not api', `fetch('/api/evil/send', { method: 'POST' });`, "'/api/evil/send'"],
  ])('a send written with %s is seen', (_why, line, want) => {
    expect(added(withCode(line))).toEqual([want]);
  });

  it('a method that is not written out is seen, and named', () => {
    expect(added(withCode(`const m = 'POST'; api('/api/evil/send', { method: m });`))).toEqual(["computed '/api/evil/send'"]);
  });

  it('options built apart from the call are seen', () => {
    expect(added(withCode(`const o = { method: 'POST' }; api('/api/evil/send', o);`))).toEqual(['POST (not in a call)']);
    expect(added(withCode(`const o = {}; o.method = 'POST'; api('/api/evil/send', o);`))).toEqual(['POST (set apart)']);
  });

  it('a send by another road is seen: sendBeacon, XMLHttpRequest, a posting form', () => {
    expect(added(withCode(`navigator.sendBeacon('/api/evil/send', '{}');`))).toEqual(['sendBeacon']);
    expect(added(withCode(`const x = new XMLHttpRequest(); x.open('POST', '/api/evil/send');`))).toEqual(['XMLHttpRequest']);
    expect(added(mutate('<p class="talk-foot">', '<form method="post" action="/api/evil/send"></form><p class="talk-foot">'))).toEqual(['form post']);
  });

  it('a send that is only a comment is not one (it sends nothing)', () => {
    expect(sends(withCode(`// api('/api/old/send', { method: 'POST' });`))).toEqual(base);
    expect(sends(withCode(`/* api('/api/old/send', { method: 'POST' }); */`))).toEqual(base);
  });

  it('a GET, written out, is not a send', () => {
    expect(sends(withCode(`api('/api/leads', { method: 'GET' });`))).toEqual(base);
  });
});

describe('the strings guard reads what can be on screen, never a comment or a lookup key (D4)', () => {
  // Pins moved (R27 Phase A, owner app b), meaning kept: these cases ask whether the page's CODE keeps a word alive, so they
  // run on the page with its inlined Spanish dictionary emptied — a dictionary key is no code (it is said only through a
  // keyed call the code still makes). NO AERIAL WORK is now drawn through the safety pair, and PERMIT LIKELY is said again
  // by permitLabel (a case it looks up, then the key it draws): each mutation relabels every place the code draws the word.
  const code = raw.replace(/(<script type="application\/json" id="arbo-i18n"[^>]*>)[\s\S]*?(<\/script>)/, '$1{}$2');
  const mutateCode = (page: string, from: string, to: string): string => {
    expect(page.split(from).length - 1, `mutation target: ${from}`).toBe(1);
    return page.replace(from, () => to);
  };
  const LIKELY_SAID = "case 'PERMIT LIKELY': return esSay(n, 'PERMIT LIKELY');";
  const LIKELY_UNSAID = "case 'PERMIT LIKELY': return esSay(n, 'Permit likely');";
  it.each([
    // Merged (D113): builder a's T('SONA BROKE A RULE') and permitChip pair draw, builder b's NO AERIAL WORK pair and
    // permitLabel case — each mutation relabels every place the merged code draws the word.
    ['a trailing // comment', [["b.appendChild(esSay(chip('', 'alarm'), 'NO AERIAL WORK'));", "b.appendChild(chip('GROUNDED', 'alarm')); // was NO AERIAL WORK"]], 'NO AERIAL WORK'],
    ['a trailing /* */ comment', [["b.appendChild(chip(T('SONA BROKE A RULE'), 'stop'));", "b.appendChild(chip(T('SLIP'), 'stop')); /* SONA BROKE A RULE */"]], 'SONA BROKE A RULE'],
    ['a lookup key', [["PERMIT_LIKELY: ['PERMIT LIKELY', 'watch']", "PERMIT_LIKELY: ['Permit likely', 'watch']"], [LIKELY_SAID, LIKELY_UNSAID], [PAIR_DRAW, PAIR_UNDRAWN]], 'PERMIT LIKELY'],
  ] as Array<[string, Array<[string, string]>, string]>)('a ruling word kept only in %s is gone', (_why, edits, word) => {
    expect(screenText(code)).toContain(word); // control: it is on screen today
    expect(screenText(edits.reduce((page, [from, to]) => mutateCode(page, from, to), code))).not.toContain(word);
  });

  it('a ruling word kept only as an index or a lookup argument is gone', () => {
    const relabelled = mutateCode(mutateCode(mutateCode(code, "PERMIT_LIKELY: ['PERMIT LIKELY', 'watch']", "PERMIT_LIKELY: ['Permit likely', 'watch']"), LIKELY_SAID, LIKELY_UNSAID), PAIR_DRAW, PAIR_UNDRAWN);
    const kept = relabelled.replace(PANEL, `${PANEL}\n  const k = PERMIT_STATUS['PERMIT LIKELY']; if (String(k).includes('PERMIT LIKELY')) return;`);
    expect(screenText(kept)).not.toContain('PERMIT LIKELY');
  });

  it('a word after a URL on the same line is still read (a // inside a string is no comment)', () => {
    expect(screenText(withCode(`const u = 'https://example.invalid/x'; el('div', '', 'KEEP ME ON SCREEN');`))).toContain('KEEP ME ON SCREEN');
  });

  it('the markup reads as Mike sees it: entities decoded, HTML comments gone', () => {
    const t = screenText(raw);
    expect(t).toContain('it can’t send, book or change anything');
    expect(screenText(mutate('<p class="talk-foot">', '<!-- GONE WORD --><p class="talk-foot">'))).not.toContain('GONE WORD');
  });
});

describe('the calm-phrase gate is not fooled by case, and the scoped inbox line stays in the inbox (D3)', () => {
  it('the page as it stands says none of them', () => {
    expect(calmPhrases(raw)).toEqual([]);
    expect(bareNothingNeedsYou(raw)).toEqual([]);
  });

  it.each([
    ["'Fleet: all clear'", 'All clear'],
    ["'ALL CLEAR — fleet'", 'All clear'],
    ["'nothing holding you up'", 'Nothing holding'],
    ["'You are clear to roll'", 'you are clear'],
    ["'0 New Leads'", '0 new leads'],
  ])('%s on screen is caught', (literal, phrase) => {
    expect(calmPhrases(withCode(`document.body.appendChild(el('div', '', ${literal}));`))).toContain(phrase);
  });

  it('a banned phrase quoted in a comment is not on screen, so it is not caught', () => {
    expect(calmPhrases(withCode('// never say "All clear" here'))).toEqual([]);
  });

  it('the scoped inbox line reused outside the inbox panel is caught', () => {
    const bad = withCode(`document.body.appendChild(el('div', '', 'Nothing needs you in the inbox right now.'));`);
    expect(bareNothingNeedsYou(bad).length).toBeGreaterThan(0);
  });

  it('"Nothing needs you" in any other case or wording is caught', () => {
    expect(bareNothingNeedsYou(withCode(`el('div', '', 'nothing needs you today');`)).length).toBeGreaterThan(0);
  });
});
