/* global document, localStorage, location */
// R27 (D110) — the Spanish runtime, shared by both doors. docs/R27_SPANISH_PLAN.md.
//
// The server inlines this file into a door's page at serve time, right after
// that door's dictionary (the #arbo-i18n JSON block), and right before the
// page's own script — the sprite's pattern
// (src/server/appPage.ts). Nothing here reads the network.
//
// English is the default and stays byte-identical: only the exact stored value
// "es" turns Spanish on (arboLang on the office app, arboCrewLang on the crew
// door — two settings, so Mike's crew preview can be Spanish while his own app
// is not). Anything else — unset, "ES", "es ", junk, or storage that refuses to
// answer — is English. Fail closed.
//
// A dictionary that is broken or missing keeps the page in English and says
// so in both languages (§1B) — never a blank screen.
//
// The English in the code is the dictionary key:
//   T('No new leads')                    fixed text
//   tf('{n} calls today', { n })         a value goes in (data passes through as typed)
//   tn(n, '{n} call', '{n} calls')       a count
//   esPick(obj, 'line')                  a server twin (obj.es.line), else the English
//   esPair('PERMIT LIKELY')              a safety label: Spanish first, the full English beneath
// A sentence is never built by gluing Spanish pieces together.
'use strict';

// Said in BOTH languages, written here and not in a dictionary: when these show,
// the dictionary that would translate them is the thing that failed.
const ES_BROKEN_LINE = {
  es: 'No se pudo cargar el texto en español, así que Arbo se muestra en inglés.',
  en: 'The Spanish text could not be loaded, so Arbo is showing English.',
};
const ES_STORAGE_LINE = {
  es: 'Este teléfono bloquea los ajustes guardados, así que no se pudo guardar el idioma.',
  en: 'This phone is blocking saved settings, so the language could not be kept.',
};
// The runtime's own words, from the door's switch unit (<door>-switch.es.json). Without them the
// dictionary is missing, whatever else it holds.
const ES_OWN_KEYS = ['English', 'in English'];
// The switch names each language in that language — the same words in English and in Spanish mode.
const ES_LANG_NAME = { en: 'English', es: 'Español' };
const ES_SWITCH_LABEL = {
  es: 'Español — ver Arbo en español',
  en: 'English — show Arbo in English',
};

const ES = (() => {
  const tag = document.getElementById('arbo-i18n');
  // R27 Phase A (es-owner-a): the Map page (/map, the office app's own frame) is a third door with its own
  // small dictionary (map-*.es.json). It follows the office app's setting, arboLang — never the crew door's.
  const named = tag && tag.getAttribute('data-door');
  const door = named === 'crew' || named === 'map' ? named : 'app';
  const key = door === 'crew' ? 'arboCrewLang' : 'arboLang';
  let wanted = 'en';
  try { wanted = localStorage.getItem(key) === 'es' ? 'es' : 'en'; } catch { wanted = 'en'; }
  const dict = {};
  const units = [];
  let dictBroken = false;
  try {
    const cfg = JSON.parse(tag ? tag.textContent : '');
    if (!cfg || typeof cfg !== 'object' || cfg.door !== door || !cfg.units || typeof cfg.units !== 'object' || Array.isArray(cfg.units)) throw new Error('shape');
    if (Array.isArray(cfg.broken) && cfg.broken.length) throw new Error('unit');
    // Review round (D110): a dictionary without this door's switch unit — the runtime's own words — is
    // MISSING, not empty (§1B). Spanish with nothing to say it in would mark English as "in English".
    const own = cfg.units[door + '-switch'];
    if (!own || typeof own !== 'object' || ES_OWN_KEYS.some((k) => typeof own[k] !== 'string' || !own[k])) throw new Error('missing');
    for (const unit of Object.keys(cfg.units)) {
      const entries = cfg.units[unit];
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('unit');
      for (const k of Object.keys(entries)) {
        if (typeof entries[k] !== 'string' || !entries[k]) throw new Error('entry');
        dict[k] = entries[k];
      }
      units.push(unit);
    }
  } catch {
    dictBroken = true;
  }
  const lang = wanted === 'es' && !dictBroken ? 'es' : 'en';
  return {
    door, key, wanted, lang, dictBroken, dict, units,
    broken: wanted === 'es' && dictBroken,
    missed: new Set(), // English keys asked for in Spanish with no entry yet (shown in English)
    places: null, // selector → unit, for the "en inglés" marks
    toggles: [], // the switches this page drew, relabelled on an in-place change
    onChange: null, // a page's own handling of a change (the crew door); unset = reload
  };
})();

// ---- Text ---------------------------------------------------------------
const ES_SLOT = /\{(\w+)\}/g;
function esSlots(s) { return String(s).match(ES_SLOT) || []; }
function esSameSlots(a, b) {
  const x = esSlots(a).sort().join(' ');
  return x === esSlots(b).sort().join(' ');
}
function esFill(tpl, vars) {
  return String(tpl).replace(ES_SLOT, (m, k) => (vars && Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}

/** Fixed text: the Spanish when Spanish is on and the dictionary has it, else the English as written. */
function T(en) {
  if (ES.lang !== 'es') return en;
  const s = ES.dict[en];
  if (typeof s === 'string') return s;
  ES.missed.add(en);
  return en;
}

/** Text with values in it. A value is data and goes in exactly as given — never translated. */
function tf(en, vars) {
  if (ES.lang !== 'es') return esFill(en, vars);
  const s = ES.dict[en];
  // A Spanish template that lost or renamed a slot would drop a value: the English shows instead.
  if (typeof s !== 'string' || !esSameSlots(en, s)) { ES.missed.add(en); return esFill(en, vars); }
  return esFill(s, vars);
}

/** A count: the one form or the many form, with {n} filled in. */
function tn(n, one, many, vars) {
  return tf(n === 1 ? one : many, Object.assign({ n }, vars || {}));
}

/** A server twin: obj.es[field] when Spanish is on and the server served one, else the English field. */
function esPick(obj, field) {
  if (!obj) return '';
  const en = obj[field];
  if (ES.lang !== 'es') return en;
  const tw = obj.es && obj.es[field];
  return typeof tw === 'string' && tw ? tw : en;
}

/** The small "en inglés" mark beside English shown in Spanish mode. */
function esEnMark() {
  const m = document.createElement('small');
  m.className = 'es-en-mark';
  m.setAttribute('lang', 'es');
  m.textContent = T('in English');
  return m;
}

/** An element holding a server twin — the English with "en inglés" when no twin was served. */
function esPickEl(tag, cls, obj, field) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  const en = obj ? obj[field] : '';
  const tw = ES.lang === 'es' && obj && obj.es ? obj.es[field] : null;
  if (typeof tw === 'string' && tw) { n.textContent = tw; return n; }
  n.textContent = en === null || en === undefined ? '' : String(en);
  if (ES.lang === 'es') { n.setAttribute('lang', 'en'); n.appendChild(esEnMark()); }
  return n;
}

/**
 * A safety or legal label (R27 #4): in Spanish, the Spanish first and the FULL
 * English beneath it, smaller, marked as English — because the city, the
 * utility and the inspector work in English. In English: the English alone,
 * as one text node. STOP, the carrier keyword, is never translated.
 */
function esPair(en) {
  const text = String(en);
  if (ES.lang !== 'es' || /^\s*STOP\s*$/.test(text)) return document.createTextNode(text);
  return esPairOf(text, ES.dict[text]);
}

/** The Spanish-mode pair for an English line and its Spanish (dictionary or server twin); no Spanish: the English, "en inglés". */
function esPairOf(text, es) {
  const f = document.createDocumentFragment();
  if (typeof es !== 'string' || !es) {
    const s = document.createElement('span');
    s.setAttribute('lang', 'en');
    s.textContent = text;
    f.appendChild(s);
    f.appendChild(esEnMark());
    return f;
  }
  const top = document.createElement('span');
  top.className = 'es-pair-es';
  top.textContent = es;
  const under = document.createElement('small');
  under.className = 'es-pair-en';
  under.setAttribute('lang', 'en');
  const tag = document.createElement('span');
  tag.className = 'es-pair-tag';
  tag.setAttribute('lang', 'es');
  tag.textContent = T('English');
  under.appendChild(tag);
  under.appendChild(document.createTextNode(' ' + text));
  f.appendChild(top);
  f.appendChild(under);
  return f;
}

// R27 Phase A (D111): the drawing helpers. Each puts its words INTO the page's own node, so English
// stays byte-identical (node.textContent is the English as written) and nothing in English comes from
// another document — a page harness's own fake nodes keep working. In Spanish a pair goes in ONE
// span.es-pair holder, so a flex row (a hazard line's ⚠ beside its words) keeps it as one item.
//
// Review round (D111, UI 1 + 3): a safety line held back (its review not recorded) is never English
// alone under Spanish words — a Spanish reader would take the Spanish reason before it for the whole
// message and never read the order. It wears a Spanish POINTER first, on its own line: it says a safety
// notice follows in English and to have someone read it — it does not translate the order (that waits
// for its review). Then the English starts on its own line, so nobody has to find where the Spanish ends.
function esPairInto(node, prefix, text, es) {
  node.textContent = prefix;
  const box = document.createElement('span');
  box.className = 'es-pair';
  if (typeof es !== 'string' || !es) {
    box.className = 'es-pair es-held';
    const why = document.createElement('span');
    why.className = 'es-held-why';
    why.setAttribute('lang', 'es');
    why.textContent = T('Safety notice — only in English for now; ask someone to read it to you:');
    box.appendChild(why);
  }
  box.appendChild(esPairOf(text, es));
  node.appendChild(box);
  return node;
}

/**
 * A safety or legal line from the door's dictionary, said into `node` (R27 #4): in English the line
 * as written; in Spanish the Spanish first and the full English beneath — or, while its review is not
 * recorded (the entry is held back), the English marked "en inglés". The key is written out at the
 * call site, as T's is, so parity can check it. STOP alone is never translated.
 * `lead` (optional) is the sentence before the line, already in the page's language — a failure's
 * reason before its stop-work order. In English the node holds ONE text node, lead + line, exactly
 * as the page wrote it before (D111).
 */
function esSay(node, en, lead) {
  const text = String(en);
  const pre = lead || '';
  if (ES.lang !== 'es' || /^\s*STOP\s*$/.test(text)) { node.textContent = pre + text; return node; }
  return esPairInto(node, pre, text, ES.dict[text]);
}

const esTwinOf = (obj, field) => (obj && obj.es && typeof obj.es[field] === 'string' && obj.es[field] ? obj.es[field] : null);
const esField = (obj, field) => (obj && obj[field] !== null && obj[field] !== undefined ? String(obj[field]) : '');

/**
 * A safety line a server module wrote (obj[field]) and its twin (obj.es[field]), said into `node` as
 * a pair: English prefix + the English field; Spanish prefix + the twin over the full English, or the
 * English marked "en inglés" when the server served no twin (stale, unreviewed or none).
 */
function esSayPick(node, obj, field, prefix) {
  const pre = prefix || '';
  const en = esField(obj, field);
  if (ES.lang !== 'es') { node.textContent = pre + en; return node; }
  return esPairInto(node, pre, en, esTwinOf(obj, field));
}

/**
 * Any other server line and its twin, said into `node`: English prefix + the English field; Spanish
 * prefix + the twin, or the English with lang="en" and "en inglés" (never a blank).
 */
function esSayTwin(node, obj, field, prefix) {
  const pre = prefix || '';
  const en = esField(obj, field);
  const tw = ES.lang === 'es' ? esTwinOf(obj, field) : null;
  if (tw) { node.textContent = pre + tw; return node; }
  node.textContent = pre + en;
  if (ES.lang === 'es') { node.setAttribute('lang', 'en'); node.appendChild(esEnMark()); }
  return node;
}

// ---- Dates and numbers ----------------------------------------------------
// Display dates in Spanish use es-US, which writes numbers the way English does
// (a decimal point, comma groups): a decimal comma on a DBH would be dangerous.
// Money keeps its own en-US formatting in both languages. Times a machine
// compares (quiet hours, the Friday check, the ET day) never come through here:
// they stay en-US / en-CA forever.
/** The locale for a date or time shown to a person: es-US in Spanish, the phone's own ([]) in English. */
function esLocale() { return ES.lang === 'es' ? 'es-US' : []; }
/** A number shown to a person: es-US in Spanish, the phone's own default in English. */
function esNum(n, opts) { return Number(n).toLocaleString(ES.lang === 'es' ? 'es-US' : undefined, opts); }

// ---- The page in Spanish mode -------------------------------------------
/**
 * Mark each place whose unit has no Spanish yet: lang="en" (a screen reader
 * says it in English) and data-es-en="en inglés" (the page's CSS shows it as a
 * small chip). Back in English every mark comes off. places: selector → unit.
 */
function esMarkPlaces(places) {
  if (places) ES.places = places;
  if (!ES.places) return;
  for (const sel of Object.keys(ES.places)) {
    const translated = ES.units.indexOf(ES.places[sel]) !== -1;
    for (const n of document.querySelectorAll(sel)) {
      if (ES.lang === 'es' && !translated) {
        n.setAttribute('lang', 'en');
        n.setAttribute('data-es-en', T('in English'));
      } else if (n.hasAttribute('data-es-en')) {
        n.removeAttribute('data-es-en');
        n.removeAttribute('lang');
      }
    }
  }
}

function esNotice(line, cls) {
  const box = document.createElement('div');
  box.className = cls;
  box.setAttribute('role', 'status');
  const es = document.createElement('div');
  es.setAttribute('lang', 'es');
  es.textContent = line.es;
  const en = document.createElement('div');
  en.setAttribute('lang', 'en');
  en.textContent = line.en;
  box.appendChild(es);
  box.appendChild(en);
  return box;
}

/** The broken-dictionary notice, in both languages, at the top of the page and of the key screen. */
function esBrokenNotice() {
  for (const old of document.querySelectorAll('.es-broken')) old.remove();
  if (!ES.broken) return;
  for (const host of [document.querySelector('main'), document.getElementById('keywall')]) {
    if (host) host.insertBefore(esNotice(ES_BROKEN_LINE, 'es-broken'), host.firstChild);
  }
}

/**
 * Storage refused the choice: said once, in both languages, right after the switch that was tapped —
 * or, for a switch in a header row (the crew door), at the top of the page, where there is room.
 */
function esSayStorage(anchor) {
  if (!anchor || !anchor.parentNode || document.querySelector('.es-storage')) return;
  const row = anchor.parentNode;
  const host = String(row.tagName).toLowerCase() === 'header' ? document.querySelector('main') : row;
  if (!host) return;
  host.insertBefore(esNotice(ES_STORAGE_LINE, 'es-storage'), host === row ? anchor.nextSibling : host.firstChild);
}

/**
 * Store the choice for this door, then let the page act on it: the office app
 * reloads (the plain way to leave no half-translated screen); the crew door
 * sets ES.onChange (before sign-off a reload, after it a redraw in place).
 */
function esChange(to, anchor) {
  const lang = to === 'es' ? 'es' : 'en';
  if (lang === ES.wanted) return;
  try { localStorage.setItem(ES.key, lang); } catch { esSayStorage(anchor); return; }
  if (typeof ES.onChange === 'function') ES.onChange(lang);
  else location.reload();
}

/**
 * A page held a change (the crew door, before sign-off, over a near-miss report): the stored choice
 * goes back to the language on screen, so a later reload does not switch behind the reader's back.
 */
function esKeepLang() {
  try { localStorage.setItem(ES.key, ES.wanted); } catch { /* storage refused: nothing was kept to undo */ }
}

/** Switch in place, without a reload (the crew door after sign-off). The page redraws its own panels. */
function esSwitchInPlace(to) {
  ES.wanted = to === 'es' ? 'es' : 'en';
  ES.lang = ES.wanted === 'es' && !ES.dictBroken ? 'es' : 'en';
  ES.broken = ES.wanted === 'es' && ES.dictBroken;
  document.documentElement.lang = ES.lang;
  esMarkPlaces();
  esBrokenNotice();
  for (const t of ES.toggles) t();
}

/** One button that switches to the other language, named in that language. */
function esToggleButton(cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  const label = () => {
    const to = ES.wanted === 'es' ? 'en' : 'es';
    b.textContent = ES_LANG_NAME[to];
    b.setAttribute('lang', to);
    b.setAttribute('aria-label', ES_SWITCH_LABEL[to]);
    b.dataset.to = to;
  };
  label();
  ES.toggles.push(label);
  b.addEventListener('click', () => esChange(b.dataset.to, b));
  return b;
}

/**
 * English | Español as two chips under a label (the office app's Appearance — in Office and, review
 * round D110 UI 7, in Settings): each language named in its own language, the one on this phone lit.
 * A tap stores the choice (esChange). Built with the page's own element maker (el), so the chips are
 * the page's own; the label's words come from the page (T('Language')). In Spanish the label says it
 * is Spanish (lang="es", review round UI 8): it sits in a screen still marked English.
 */
function esLanguageChips(host, el, label) {
  const lab = el('div', 'es-lang-label', label);
  if (ES.lang === 'es') lab.setAttribute('lang', 'es');
  host.appendChild(lab);
  const row = el('div', 'chips');
  for (const lang of ['en', 'es']) {
    const b = el('button', 'loc-toggle' + (ES.wanted === lang ? ' on' : ''), ES_LANG_NAME[lang]);
    b.setAttribute('lang', lang);
    b.setAttribute('aria-pressed', ES.wanted === lang ? 'true' : 'false');
    b.addEventListener('click', () => esChange(lang, row));
    row.appendChild(b);
  }
  host.appendChild(row);
}

// Spanish mode (or a Spanish reader whose dictionary failed) is set up before the page's own script runs.
if (ES.lang === 'es') document.documentElement.lang = 'es';
esBrokenNotice();
