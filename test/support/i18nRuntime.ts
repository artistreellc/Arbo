// R27 (D110) — the Spanish runtime (src/app/i18n/runtime.js), run in a test.
//
// loadI18n() evaluates the REAL runtime file over a small fake DOM, with the
// language, dictionary and storage a test wants, and hands back everything it
// defines (T, tf, tn, esPick, esPair, ES…). Every page harness gets the same
// functions in English for free: test/support/i18nGlobals.ts (a vitest setup
// file) installs them on globalThis, so page code lifted into a harness with
// `new Function` can call T('…') with no change to that harness.
import { readFileSync } from 'node:fs';

export const RUNTIME_SRC = readFileSync(new URL('../../src/app/i18n/runtime.js', import.meta.url), 'utf8');

/** The names the runtime defines for a page — the stubs every harness gets. */
export const RUNTIME_NAMES = [
  'ES', 'T', 'tf', 'tn', 'esPick', 'esPickEl', 'esPair', 'esPairOf', 'esSay', 'esSayPick', 'esSayTwin', 'esEnMark', 'esLocale', 'esNum', 'esMarkPlaces',
  'esBrokenNotice', 'esSayStorage', 'esChange', 'esKeepLang', 'esSwitchInPlace', 'esToggleButton', 'esNotice', 'esLanguageChips',
  'ES_BROKEN_LINE', 'ES_STORAGE_LINE', 'ES_LANG_NAME', 'ES_SWITCH_LABEL',
] as const;

export class FakeNode {
  children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  attrs = new Map<string, string>();
  listeners: Record<string, Array<() => void>> = {};
  dataset: Record<string, string> = {};
  className = '';
  type = '';
  id = '';
  private data = '';
  constructor(public tagName: string, text = '') { if (tagName === '#text') this.data = text; else if (text) this.textContent = text; }
  get textContent(): string { return this.tagName === '#text' ? this.data : this.children.map((c) => c.textContent).join(''); }
  set textContent(v: string) { if (this.tagName === '#text') this.data = v; else { this.children = []; if (v !== '') this.appendChild(new FakeNode('#text', v)); } }
  get lang(): string { return this.getAttribute('lang') ?? ''; }
  set lang(v: string) { this.setAttribute('lang', v); }
  get firstChild(): FakeNode | null { return this.children[0] ?? null; }
  get nextSibling(): FakeNode | null { const p = this.parentNode; if (!p) return null; return p.children[p.children.indexOf(this) + 1] ?? null; }
  get classList() {
    const list = () => this.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c: string) => list().includes(c),
      add: (c: string) => { if (!list().includes(c)) this.className = [...list(), c].join(' '); },
      remove: (c: string) => { this.className = list().filter((x) => x !== c).join(' '); },
      toggle: (c: string, on?: boolean) => { const want = on ?? !list().includes(c); if (want) this.classList.add(c); else this.classList.remove(c); return want; },
    };
  }
  appendChild(c: FakeNode): FakeNode {
    if (c.tagName === '#fragment') { for (const k of [...c.children]) this.appendChild(k); c.children = []; return c; }
    c.parentNode?.removeChild(c);
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  insertBefore(c: FakeNode, ref: FakeNode | null): FakeNode {
    if (!ref) return this.appendChild(c);
    if (c.tagName === '#fragment') { for (const k of [...c.children]) this.insertBefore(k, ref); c.children = []; return c; }
    c.parentNode?.removeChild(c);
    c.parentNode = this;
    this.children.splice(this.children.indexOf(ref), 0, c);
    return c;
  }
  removeChild(c: FakeNode): void { this.children = this.children.filter((x) => x !== c); c.parentNode = null; }
  remove(): void { this.parentNode?.removeChild(this); }
  replaceChildren(...kids: FakeNode[]): void { this.children = []; for (const k of kids) this.appendChild(k); }
  setAttribute(k: string, v: string): void { this.attrs.set(k, String(v)); if (k === 'id') this.id = String(v); }
  getAttribute(k: string): string | null { return this.attrs.has(k) ? this.attrs.get(k)! : null; }
  hasAttribute(k: string): boolean { return this.attrs.has(k); }
  removeAttribute(k: string): void { this.attrs.delete(k); }
  addEventListener(type: string, fn: () => void): void { (this.listeners[type] ??= []).push(fn); }
  click(): void { for (const fn of this.listeners.click ?? []) fn(); }
  all(): FakeNode[] { return this.children.flatMap((k) => [k, ...k.all()]); }
}

export interface FakeDoc {
  documentElement: FakeNode;
  body: FakeNode;
  createElement(tag: string): FakeNode;
  createTextNode(text: string): FakeNode;
  createDocumentFragment(): FakeNode;
  getElementById(id: string): FakeNode | null;
  querySelector(sel: string): FakeNode | null;
  querySelectorAll(sel: string): FakeNode[];
}

/** A document with a body, a <main>, and whatever elements a test hands it (by id). */
export function fakeDoc(extra: FakeNode[] = []): FakeDoc {
  const html = new FakeNode('html');
  html.setAttribute('lang', 'en');
  const body = html.appendChild(new FakeNode('body'));
  body.appendChild(new FakeNode('main'));
  for (const n of extra) body.appendChild(n);
  const all = () => [html, ...html.all()];
  const match = (n: FakeNode, sel: string) => (sel.startsWith('#') ? n.id === sel.slice(1) : sel.startsWith('.') ? n.classList.contains(sel.slice(1)) : n.tagName === sel);
  return {
    documentElement: html,
    body,
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (t) => new FakeNode('#text', t),
    createDocumentFragment: () => new FakeNode('#fragment'),
    getElementById: (id) => all().find((n) => n.id === id) ?? null,
    querySelector: (sel) => all().find((n) => match(n, sel)) ?? null,
    querySelectorAll: (sel) => all().filter((n) => match(n, sel)),
  };
}

export interface I18nOptions {
  door?: 'app' | 'crew';
  /** The inlined config's text; null = no #arbo-i18n tag at all. Default: a valid config with `units`. */
  json?: string | null;
  units?: Record<string, Record<string, string>>;
  /** What storage holds for this door's key, or 'throw' when storage refuses. Default: nothing. */
  stored?: Record<string, string> | 'throw';
  doc?: FakeDoc;
  extra?: FakeNode[];
}

// The runtime is plain JS; a test calls its functions with whatever the page would pass.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type I18n = Record<(typeof RUNTIME_NAMES)[number], any> & { doc: FakeDoc; storage: Map<string, string>; reloads: number; };

/** The real runtime, evaluated over a fake page. */
export function loadI18n(o: I18nOptions = {}): I18n {
  const door = o.door ?? 'app';
  const doc = o.doc ?? fakeDoc(o.extra);
  const json = o.json === undefined ? JSON.stringify({ door, units: o.units ?? {}, broken: [] }) : o.json;
  // A harness's own document may have no body to hold the tag: then the runtime reads no tag (English).
  if (json !== null && doc.body) {
    const tag = new FakeNode('script', json);
    tag.setAttribute('id', 'arbo-i18n');
    tag.setAttribute('data-door', door);
    doc.body.appendChild(tag);
  }
  const storage = new Map<string, string>(o.stored && o.stored !== 'throw' ? Object.entries(o.stored) : []);
  const blocked = o.stored === 'throw';
  const localStorage = {
    getItem: (k: string) => { if (blocked) throw new Error('SecurityError'); return storage.has(k) ? storage.get(k)! : null; },
    setItem: (k: string, v: string) => { if (blocked) throw new Error('SecurityError'); storage.set(k, String(v)); },
    removeItem: (k: string) => { if (blocked) throw new Error('SecurityError'); storage.delete(k); },
  };
  const state = { reloads: 0 };
  const location = { reload: () => { state.reloads += 1; } };
  const api = new Function('window', 'document', 'localStorage', 'location',
    `${RUNTIME_SRC}\nreturn { ${RUNTIME_NAMES.join(', ')} };`)({}, doc, localStorage, location) as Record<string, unknown>;
  const out = Object.assign(api, { doc, storage });
  Object.defineProperty(out, 'reloads', { get: () => state.reloads });
  return out as unknown as I18n;
}
