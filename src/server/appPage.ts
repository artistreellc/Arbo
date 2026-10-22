/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  Owner instruction from Mike, 2026-08-03. This is not decoration and it
  is not optional. It is here because this is the point in a build where
  things get broken by moving fast, and that already happened to him once
  on the website. It does not happen here.
  ═══════════════════════════════════════════════════════════════════════

  SLOW DOWN. DRASTICALLY. Then:

  1. READ EVERY LINE BEFORE YOU EDIT ONE. Every line, every letter,
     slowly. You are not skimming to find the spot to change — you are
     building a model of what this file already does. If you cannot say
     what the code above and below your edit does, you have not read it.

  2. AN AUDIT IS READ-ONLY. If you were asked to audit, you do not edit.
     You do not "fix it while you are in there." You do not refactor, or
     tidy, or rename. You READ, and you REPORT. Editing during an audit
     is disobeying the instruction, full stop.

  3. THINK BEFORE YOU TYPE. What does this already handle? What depends
     on it? What breaks downstream? Recognise the PATTERN before you call
     something a bug — most things in here that look wrong are a
     deliberate correction. Check docs/OWNER_RULINGS.md first. Use what
     you already know about this codebase instead of re-deciding it.

  4. BRING IT TO MIKE — DO NOT DECIDE IT. Anything that looks wrong,
     ambiguous, or outside what was asked: say it and WAIT. Flagging
     costs one sentence. Deciding on his behalf has cost real work and
     real money more than once.

  5. DO EXACTLY WHAT WAS ASKED. Not the adjacent thing. Not the bigger
     thing you thought of on the way. Not the cleanup. Exactly what was
     asked, and nothing else.

  If you are moving fast right now, you are already off the rails.

  Remember the marker: SLOW::ARBO
*/
// Serves the Arbo app shells (brief §8/§9, §8C.1 "one app, two doors"):
// self-contained HTML files —
// design tokens inlined, no CDN, no build step — so the app deploys with the
// server and can't drift from it. Loaded once and cached.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FOUR_CITY_BOX, ZCTA_SOURCE, ZIP_CENTROIDS, ZIP_NO_AREA } from '../lib/zipCentroids.js';
import { DEQ_MAPSERVER_BASE, DEQ_RPA_LAYER, DEQ_RPA_LIMITS } from '../permitting/gis/layers.js';
import { loadDoorDictionary, type Door, type DoorDictionary } from '../i18n/dictionaries.js';

const cache = new Map<string, string>();

function load(file: string): string {
  let html = cache.get(file);
  if (html === undefined) {
    const here = dirname(fileURLToPath(import.meta.url));
    html = readFileSync(join(here, '..', 'app', file), 'utf8');
    cache.set(file, html);
  }
  return html;
}

/**
 * The hand-drawn icon sprite (R25), inlined where a page carries the
 * `<!--ARBO:SPRITE-->` marker so `<use href="#i-…">` works with no request.
 */
function withSprite(html: string): string {
  // Inline SVG in HTML needs no xmlns; dropping it keeps the page free of
  // any other host's name (test/appUi.test.ts host allow-list).
  const sprite = load('sprite.svg').replace(' xmlns="http://www.w3.org/2000/svg"', '');
  return html.includes('<!--ARBO:SPRITE-->') ? html.replace('<!--ARBO:SPRITE-->', sprite) : html;
}

const dictionaries = new Map<Door, DoorDictionary>();
/**
 * A door's dictionary as it may be shown, read once. A broken unit or a held
 * entry is logged by unit name and count only — never its text (§4.3).
 */
function doorDictionary(door: Door): DoorDictionary {
  let d = dictionaries.get(door);
  if (!d) {
    d = loadDoorDictionary(door);
    if (d.broken.length || d.held.length) {
      console.warn(`[i18n] ${door}: ${d.broken.length} unit(s) broken${d.broken.length ? ` (${d.broken.join(', ')})` : ''}, ${d.held.length} entr(ies) held back`);
    }
    dictionaries.set(door, d);
  }
  return d;
}

/**
 * R27 (D110): the Spanish version, inlined where a page carries the
 * `<!--ARBO:I18N-->` marker — the sprite's way, so it works offline and needs
 * no request. First the door's dictionary (src/app/i18n/<door>-<unit>.es.json,
 * as src/i18n/dictionaries.ts lets it be shown), then the runtime
 * (src/app/i18n/runtime.js), both just before the page's own script. The crew
 * page carries only crew units. A broken unit is named in the block, and the
 * runtime then keeps the page in English and says so in both languages.
 * English is unchanged: the runtime turns Spanish on only for the exact stored "es".
 */
export function withI18n(html: string, door: Door, dict: DoorDictionary = doorDictionary(door)): string {
  if (!html.includes('<!--ARBO:I18N-->')) return html;
  const cfg = scriptJson({ door, units: dict.units, broken: dict.broken });
  const block = `<script type="application/json" id="arbo-i18n" data-door="${door}">${cfg}</script>\n<script>\n${load('i18n/runtime.js')}</script>`;
  return html.replace('<!--ARBO:I18N-->', () => block);
}

/** The ADMIN door (Mike's cockpit). */
export function loadAppHtml(): string {
  return withI18n(withSprite(load('index.html')), 'app');
}

/** The CREW door (§8C.1) — work orders + the gated briefing, nothing else. */
export function loadCrewHtml(): string {
  return withI18n(withSprite(load('crew.html')), 'crew');
}

/**
 * Talk-to-Arbo page (Mike, 2026-09-21). Its own file ON PURPOSE: it carries
 * the ElevenLabs widget from their CDN, which the cockpit shell's
 * no-external-scripts law forbids — so the widget lives one tap away
 * instead of inside the shell.
 */
export function loadTalkHtml(): string {
  return load('talk.html');
}

/**
 * The ElevenLabs widget bundle, served from OUR server (Mike, 2026-09-21:
 * "why isnt the voice widget loading from our servers"). Vendored via the
 * pinned npm package — no third-party CDN in the serving path. The version
 * moves when package-lock moves, deliberately: an update is a reviewed
 * dependency bump, never a silent CDN change. The CONVERSATION still runs
 * browser ↔ ElevenLabs platform; only the code is ours to serve.
 */
export function loadTalkWidgetJs(): string {
  let js = cache.get('__talk_widget__');
  if (js === undefined) {
    const here = dirname(fileURLToPath(import.meta.url));
    js = readFileSync(join(here, '..', '..', 'node_modules', '@elevenlabs', 'convai-widget-embed', 'dist', 'index.js'), 'utf8');
    cache.set('__talk_widget__', js);
  }
  return js;
}

/** JSON that is safe inside a <script> block: no "<" can end it early. */
function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

/**
 * The Map page (Maps wave A, M0 — docs/MAPS_PLAN.md). Its own file ON PURPOSE:
 * Leaflet's source uses innerHTML and names its own site, which the cockpit
 * shell's laws forbid (test/appUi.test.ts), so the map runs in a same-origin
 * frame the shell makes once — the calendar frame's pattern (R2). At serve
 * time two markers are filled, each from its one source: the ZIP table
 * (src/lib/zipCentroids.ts) and the DEQ values (layers.ts). The sprite is NOT
 * inlined here (Maps wave B, D108): the map draws no sprite icon, and it was
 * about 12 KB of every map load. The page itself carries no customer data; it
 * reads /api with the shell's key.
 */
export function loadMapHtml(): string {
  let html = cache.get('__map__');
  if (html === undefined) {
    const zips = scriptJson({ zips: ZIP_CENTROIDS, noArea: ZIP_NO_AREA, checked: ZCTA_SOURCE.checked, box: FOUR_CITY_BOX });
    const deq = scriptJson({ base: DEQ_MAPSERVER_BASE, layer: DEQ_RPA_LAYER, limits: DEQ_RPA_LIMITS });
    html = load('map.html').replace('<!--ARBO:ZIPS-->', () => zips).replace('<!--ARBO:DEQ-->', () => deq);
    cache.set('__map__', html);
  }
  return html;
}

const LEAFLET_FILES = new Set(['leaflet.js', 'leaflet.css']);

/**
 * Leaflet 1.9.4 (BSD-2-Clause), served from OUR server like the ElevenLabs
 * widget — the pinned npm package, no third-party CDN. Exactly two names; any
 * other is null (a 404), so no path can walk out of the package. Leaflet's
 * licence rides at the top of each file, as its BSD terms ask of a copy.
 */
export function loadLeafletFile(name: string): string | null {
  if (!LEAFLET_FILES.has(name)) return null;
  const key = '__leaflet__' + name;
  let text = cache.get(key);
  if (text === undefined) {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', 'leaflet');
    const licence = readFileSync(join(dir, 'LICENSE'), 'utf8');
    text = `/*! Leaflet's licence, kept with the copy Arbo serves:\n${licence}*/\n${readFileSync(join(dir, 'dist', name), 'utf8')}`;
    cache.set(key, text);
  }
  return text;
}
