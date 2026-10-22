// R27 (D110) — the dictionaries are inlined at serve time, per door, the
// sprite's way (docs/R27_SPANISH_PLAN.md, "Three kinds of text" 1): the page
// works offline, the crew page carries only crew strings, and what is inlined
// has passed the ban list, the gates and the ledger. Parity: every key a door
// uses is in its dictionary, and every dictionary key is used.
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { loadAppHtml, loadCrewHtml, loadMapHtml, loadTalkHtml, withI18n } from '../src/server/appPage.js';
import { loadDoorDictionary, unitFiles, readUnit } from '../src/i18n/dictionaries.js';
import { esGateProblems } from '../src/i18n/gates.js';
import { findBannedEs } from '../src/i18n/banList.js';
import { RUNTIME_SRC } from './support/i18nRuntime.js';

const raw = (f: string) => readFileSync(new URL(`../src/app/${f}`, import.meta.url), 'utf8');
const MARK = '<!--ARBO:I18N-->';
const inlined = (html: string) => {
  const m = /<script type="application\/json" id="arbo-i18n" data-door="(app|crew)">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('no inlined dictionary');
  return { door: m[1], cfg: JSON.parse(m[2]!) as { door: string; units: Record<string, Record<string, string>>; broken: string[] } };
};

describe('the marker — one per door page, right before the page’s own script, after the markup', () => {
  for (const f of ['index.html', 'crew.html']) {
    it(f, () => {
      const html = raw(f);
      expect(html.split(MARK)).toHaveLength(2);
      expect(html).toMatch(/<!--ARBO:I18N-->\n<script>\n'use strict';/);
      expect(html.indexOf('<!--ARBO:SPRITE-->')).toBeLessThan(html.indexOf(MARK));
      expect(html.indexOf('</main>')).toBeLessThan(html.indexOf(MARK));
    });
  }
  it('the map page, talk.html and the public pages carry none (map.html gets Spanish in a later unit)', () => {
    expect(raw('map.html')).not.toContain(MARK);
    expect(raw('talk.html')).not.toContain(MARK);
    expect(loadMapHtml()).not.toContain('arbo-i18n');
    expect(loadTalkHtml()).not.toContain('arbo-i18n');
  });
});

describe('serve time — the door’s dictionary, then the runtime, then the page’s script', () => {
  for (const [door, html] of [['app', loadAppHtml()], ['crew', loadCrewHtml()]] as const) {
    it(`${door}: replaced once, in that order, and nothing else on the page moved`, () => {
      expect(html).not.toContain(MARK);
      expect(html.match(/id="arbo-i18n"/g)).toHaveLength(1);
      const at = html.indexOf('id="arbo-i18n"');
      const rt = html.indexOf(RUNTIME_SRC.trim().slice(0, 60));
      expect(at).toBeGreaterThan(0);
      expect(rt).toBeGreaterThan(at);
      expect(html.indexOf("<script>\n'use strict';\n// All", rt)).toBeGreaterThan(rt);
      // Everything around the block is the page as written (the sprite aside).
      const block = html.slice(html.lastIndexOf('<script type="application/json"', at), html.indexOf('</script>', rt) + '</script>'.length);
      const sprite = raw('sprite.svg').replace(' xmlns="http://www.w3.org/2000/svg"', '');
      expect(html.replace(block, MARK)).toBe(raw(door === 'app' ? 'index.html' : 'crew.html').replace('<!--ARBO:SPRITE-->', sprite));
    });
  }

  it('the crew page carries only crew units; the office app only its own', () => {
    expect(Object.keys(inlined(loadCrewHtml()).cfg.units).every((u) => u.startsWith('crew-'))).toBe(true);
    expect(Object.keys(inlined(loadAppHtml()).cfg.units).every((u) => u.startsWith('app-'))).toBe(true);
    expect(inlined(loadCrewHtml()).door).toBe('crew');
    expect(inlined(loadAppHtml()).door).toBe('app');
    expect(Object.keys(inlined(loadCrewHtml()).cfg.units)).toContain('crew-switch');
    expect(Object.keys(inlined(loadAppHtml()).cfg.units)).toContain('app-switch');
  });

  it('nothing inlined can end the script early: every "<" is escaped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbo-i18n-'));
    writeFileSync(join(dir, 'crew-x.es.json'), JSON.stringify({ 'A </script><b>': 'Una </script><b>' }));
    const html = withI18n(`<main></main>\n${MARK}\n<script>\n'use strict';\n</script>`, 'crew', loadDoorDictionary('crew', pathToFileURL(dir + '/')));
    const json = html.slice(html.indexOf('data-door="crew">') + 17, html.indexOf('</script>'));
    expect(json).not.toContain('<');
    expect(JSON.parse(json).units['crew-x']['A </script><b>']).toBe('Una </script><b>');
  });
});

describe('what may be inlined — a broken unit is named; a banned, unservable or unreviewed safety entry is held back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arbo-i18n-'));
  writeFileSync(join(dir, 'crew-good.es.json'), JSON.stringify({ Language: 'Idioma', 'Wait {n} minutes': 'Espere {n} minutos' }));
  writeFileSync(join(dir, 'crew-banned.es.json'), JSON.stringify({ 'No overlay found': 'Zona libre', 'Look it up': 'Búsquelo' }));
  writeFileSync(join(dir, 'crew-safety.es.json'), JSON.stringify({ 'PERMIT LIKELY': 'PROBABLEMENTE SE NECESITA PERMISO' }));
  writeFileSync(join(dir, 'crew-slots.es.json'), JSON.stringify({ '{n} calls today': '{count} llamadas hoy' }));
  writeFileSync(join(dir, 'crew-broken.es.json'), '{"Language": ');
  writeFileSync(join(dir, 'crew-notflat.es.json'), JSON.stringify({ Language: { es: 'Idioma' } }));
  writeFileSync(join(dir, 'app-other.es.json'), JSON.stringify({ Language: 'Idioma' }));
  writeFileSync(join(dir, 'notes.json'), '{}');
  const d = loadDoorDictionary('crew', pathToFileURL(dir + '/'));

  it('only this door’s unit files are read, by name', () => {
    expect(unitFiles(pathToFileURL(dir + '/')).map((u) => u.unit)).toEqual(['app-other', 'crew-banned', 'crew-broken', 'crew-good', 'crew-notflat', 'crew-safety', 'crew-slots']);
    expect(Object.keys(d.units).sort()).toEqual(['crew-banned', 'crew-good', 'crew-safety', 'crew-slots']);
  });
  it('a unit that is not a flat object of strings is BROKEN — the page will stay English and say so', () => {
    expect(d.broken.sort()).toEqual(['crew-broken', 'crew-notflat']);
  });
  it('a banned Spanish word, a renamed slot, or a safety line the ledger has not cleared is held back — the rest of the unit stays', () => {
    expect(d.units['crew-good']).toEqual({ Language: 'Idioma', 'Wait {n} minutes': 'Espere {n} minutos' });
    expect(d.units['crew-banned']).toEqual({ 'Look it up': 'Búsquelo' });
    expect(d.units['crew-safety']).toEqual({});
    expect(d.units['crew-slots']).toEqual({});
    expect(d.held.map((h) => `${h.unit}:${h.key}`).sort()).toEqual(['crew-banned:No overlay found', 'crew-safety:PERMIT LIKELY', 'crew-slots:{n} calls today']);
  });
});

// ── Parity: the keys a door uses (its page and the shared runtime) against its dictionary ──
function usedKeys(src: string, file: string): { keys: string[]; computed: string[] } {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const keys: string[] = [];
  const computed: string[] = [];
  const lit = (n: ts.Expression | undefined) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null);
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const name = n.expression.text;
      // R27 Phase A (D111): esSay(node, 'line') says a dictionary line into a node — its key is the second argument.
      const args = name === 'tn' ? [n.arguments[1], n.arguments[2]] : name === 'T' || name === 'tf' || name === 'esPair' ? [n.arguments[0]] : name === 'esSay' ? [n.arguments[1]] : [];
      for (const a of args) {
        const k = lit(a);
        if (k !== null) keys.push(k); else computed.push(`${name}(${a ? a.getText(sf) : ''})`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { keys, computed };
}
const pageScripts = (html: string) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).join('\n');

describe('parity — no missing key, no stale key, per door', () => {
  for (const [door, file] of [['app', 'index.html'], ['crew', 'crew.html']] as const) {
    it(door, () => {
      const page = usedKeys(pageScripts(raw(file)), file);
      const runtime = usedKeys(RUNTIME_SRC, 'runtime.js');
      // The runtime's own tn passes its chosen form on to tf — that is the implementation, not a key.
      expect(page.computed, 'a T/tf/tn/esPair/esSay key must be written out, so it can be checked').toEqual([]);
      const used = new Set([...page.keys, ...runtime.keys]);
      const dict = new Set(unitFiles().filter((u) => u.door === door).flatMap((u) => Object.keys(readUnit(u.file) ?? {})));
      expect([...used].filter((k) => !dict.has(k)), 'missing from the dictionary').toEqual([]);
      expect([...dict].filter((k) => !used.has(k)), 'stale: in the dictionary, used by nothing').toEqual([]);
    });
  }
});

describe('every dictionary entry in the repo passes the ban list and every gate, and no unit file is broken', () => {
  for (const u of unitFiles()) {
    it(u.unit, () => {
      const entries = readUnit(u.file);
      expect(entries, `${u.file} is not a flat object of strings`).not.toBeNull();
      for (const [en, es] of Object.entries(entries!)) {
        expect(findBannedEs(es), `${en} → ${es}`).toEqual([]);
        expect(esGateProblems(en, es), `${en} → ${es}`).toEqual([]);
      }
      expect(loadDoorDictionary(u.door).held.filter((h) => h.unit === u.unit)).toEqual([]);
    });
  }
});

// Review round (D110, correctness #5): a dictionary directory the server could
// not read was taken as an empty one — "couldn't read it" rendered the same as
// "nothing there". Now unitFiles says it could not read, and the door's
// dictionary is BROKEN by name, so a Spanish reader gets English and the notice.
describe('review round — an unreadable dictionary directory is named, never an empty dictionary', () => {
  const gone = pathToFileURL(join(tmpdir(), `arbo-i18n-gone-${process.pid}-${Date.now()}`) + '/');
  it('unitFiles throws rather than answering "no units"', () => {
    expect(() => unitFiles(gone)).toThrow();
  });
  it('the door’s dictionary is broken by name, and the inlined block carries it', () => {
    const d = loadDoorDictionary('crew', gone);
    expect(d.units).toEqual({});
    expect(d.broken).toEqual(['crew-*']);
    const html = withI18n(`<main></main>\n${MARK}\n<script>\n'use strict';\n</script>`, 'crew', d);
    expect(inlined(html).cfg.broken).toEqual(['crew-*']);
  });
});
