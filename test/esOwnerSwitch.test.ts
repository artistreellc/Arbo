// R27 (D110) — the office app's language switch (docs/R27_SPANISH_PLAN.md,
// "The switch"): English | Español in Office → Appearance, and a small toggle
// on the key screen because an employee meets that first. Remembered per phone
// as arboLang; a change reloads the page. Until a screen's own unit is
// translated (Phase A) Spanish mode shows it in English, marked "en inglés".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadI18n, FakeNode } from './support/i18nRuntime.js';

const raw = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
const crew = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');
const css = raw.slice(raw.indexOf('<style>'), raw.indexOf('</style>'));
const script = raw.slice(raw.indexOf("<!--ARBO:I18N-->\n<script>"), raw.lastIndexOf('</script>'));
const fnSrc = (src: string, name: string): string => {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(src);
  if (!m) throw new Error(`no function ${name}`);
  return m[0];
};
const appUnits = { 'app-switch': JSON.parse(readFileSync(new URL('../src/app/i18n/app-switch.es.json', import.meta.url), 'utf8')) as Record<string, string> };

describe('the key screen — a small toggle, the first switch an employee meets', () => {
  it('is put on the key screen at boot, from the runtime', () => {
    expect(script).toContain("$('keywall').appendChild(esToggleButton('es-toggle'));");
  });
  it('is a 44px target that does not wear the key screen’s big gold button', () => {
    const rule = /#keywall button\.es-toggle\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/min-height:44px/);
    expect(rule).toMatch(/width:auto/);
    expect(rule).toMatch(/background:none/);
    expect(rule).toMatch(/box-shadow:none/);
  });
  it('reads "Español" in English and "English" in Spanish; a tap stores arboLang and reloads', () => {
    const r = loadI18n({ door: 'app', units: appUnits });
    const b = r.esToggleButton('es-toggle') as FakeNode;
    expect([b.textContent, b.getAttribute('lang')]).toEqual(['Español', 'es']);
    b.click();
    expect(r.storage.get('arboLang')).toBe('es');
    expect(r.storage.has('arboCrewLang')).toBe(false);
    expect(r.reloads).toBe(1);
    const s = loadI18n({ door: 'app', units: appUnits, stored: { arboLang: 'es' } });
    const back = s.esToggleButton('es-toggle') as FakeNode;
    expect([back.textContent, back.getAttribute('lang')]).toEqual(['English', 'en']);
    back.click();
    expect(s.storage.get('arboLang')).toBe('en');
    expect(s.reloads).toBe(1);
  });
  it('the office app never sets a handler of its own: a change always reloads', () => {
    expect(script).not.toMatch(/ES\.onChange\s*=/);
  });
});

describe('Office → Appearance — English | Español, beside the theme', () => {
  const more = fnSrc(raw, 'renderMore');
  const block = more.slice(more.indexOf('  // R27 (D110): the language'), more.indexOf("  v.appendChild(el('div', 'panel-title', 'Install'));"));
  const run = (r: ReturnType<typeof loadI18n>) => {
    const v = new FakeNode('div');
    const el = (tag: string, cls?: string, text?: string) => { const n = new FakeNode(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
    new Function('v', 'el', 'T', 'ES', 'ES_LANG_NAME', 'esChange', block)(v, el, r.T, r.ES, r.ES_LANG_NAME, r.esChange);
    r.doc.querySelector('main')!.appendChild(v);
    return v;
  };

  it('sits after the theme chips and before Install', () => {
    expect(block.length).toBeGreaterThan(0);
    expect(more.indexOf("v.appendChild(el('div', 'panel-title', 'Appearance'));")).toBeLessThan(more.indexOf('  // R27 (D110): the language'));
    expect(more.indexOf('v.appendChild(seg);')).toBeLessThan(more.indexOf('  // R27 (D110): the language'));
  });

  it('English: "Language", then English (lit) and Español, each in its own language', () => {
    const v = run(loadI18n({ door: 'app', units: appUnits }));
    expect(v.children[0]!.textContent).toBe('Language');
    const chips = v.children[1]!;
    expect(chips.className).toBe('chips');
    expect(chips.children.map((c) => [c.textContent, c.className, c.getAttribute('lang'), c.getAttribute('aria-pressed')])).toEqual([
      ['English', 'loc-toggle on', 'en', 'true'], ['Español', 'loc-toggle', 'es', 'false'],
    ]);
  });

  it('Spanish: "Idioma", Español lit; a tap on English stores it and reloads', () => {
    const r = loadI18n({ door: 'app', units: appUnits, stored: { arboLang: 'es' } });
    const v = run(r);
    expect(v.children[0]!.textContent).toBe('Idioma');
    const chips = v.children[1]!;
    expect(chips.children.map((c) => c.className)).toEqual(['loc-toggle', 'loc-toggle on']);
    chips.children[0]!.click();
    expect(r.storage.get('arboLang')).toBe('en');
    expect(r.reloads).toBe(1);
  });

  it('storage that refuses: no reload, and the line says so in both languages under the chips', () => {
    const r = loadI18n({ door: 'app', units: appUnits, stored: 'throw' });
    const v = run(r);
    v.children[1]!.children[1]!.click();
    expect(r.reloads).toBe(0);
    expect(v.children[2]!.className).toBe('es-storage');
  });
});

describe('Spanish mode marks every screen that has no Spanish yet — "en inglés", never a silent English page', () => {
  const src = /^const ES_PLACES = \{[\s\S]*?^\};$/m.exec(raw)?.[0] ?? 'const ES_PLACES = {};';
  const places = new Function(`${src}\nreturn ES_PLACES;`)() as Record<string, string>;
  it('every view, the key screen, the leads head, the sheets, the header and the dock are named', () => {
    const views = [...raw.matchAll(/<div id="(view-[a-z]+)" class="view/g)].map((m) => '#' + m[1]);
    expect(views.length).toBeGreaterThan(15);
    for (const v of views) expect(places[v], v).toMatch(/^app-[a-z]+$/);
    for (const s of ['#keywall', '#leads-head', '.sheet', '#appbar', 'nav']) expect(places[s], s).toMatch(/^app-[a-z]+$/);
  });
  it('every place names something in the markup', () => {
    for (const sel of Object.keys(places)) {
      const ok = sel.startsWith('#') ? raw.includes(`id="${sel.slice(1)}"`) : sel.startsWith('.') ? raw.includes(`class="${sel.slice(1)}"`) : raw.includes(`<${sel} `);
      expect(ok, sel).toBe(true);
    }
  });
  it('the places are marked at boot, before anything draws', () => {
    expect(script).toContain('esMarkPlaces(ES_PLACES);');
  });
  it('the chip shows on a screen and on the key screen only while it is marked', () => {
    expect(css).toMatch(/\.view\[data-es-en\]::before,#keywall\[data-es-en\]::before\{content:attr\(data-es-en\)/);
  });
  it('the broken-dictionary and storage notices, the "en inglés" mark and the safety pair are styled', () => {
    for (const sel of ['.es-broken{', '.es-storage{', '.es-en-mark{', '.es-pair-en{', '.es-pair-tag{', '.es-lang-label{']) expect(css, sel).toContain(sel);
  });
});

describe('storage that refuses — the office app still starts, in English (it used to stop on the first line)', () => {
  it('the key read survives a throwing localStorage', () => {
    const line = /^let KEY = [^\n]*$/m.exec(raw)![0];
    const read = new Function('localStorage', `${line}\nreturn KEY;`);
    expect(read({ getItem() { throw new Error('SecurityError'); } })).toBe('');
    expect(read({ getItem: () => 'k1' })).toBe('k1');
  });
});

describe('times a machine compares stay en-US / en-CA; money stays en-US in both languages', () => {
  it('the office app formats money in en-US', () => {
    expect(/^function money\([\s\S]*?^\}$/m.exec(raw)?.[0] ?? raw.slice(raw.indexOf('function money('), raw.indexOf('function money(') + 200)).toContain("toLocaleString('en-US'");
    expect(raw).toContain("function dollars(n) { return '$' + Math.round(n).toLocaleString('en-US'); }");
  });
  it('the crew door’s Friday check and ET day never follow the display language', () => {
    expect(fnSrc(crew, 'isFridayEt')).toContain("new Intl.DateTimeFormat('en-US'");
    expect(fnSrc(crew, 'etDayNow')).toContain("new Intl.DateTimeFormat('en-CA'");
    expect(fnSrc(crew, 'isFridayEt')).not.toMatch(/esLocale|esNum/);
    expect(fnSrc(crew, 'etDayNow')).not.toMatch(/esLocale|esNum/);
  });
});
