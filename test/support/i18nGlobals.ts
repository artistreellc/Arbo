// R27 (D110) — the test stubs every page harness needs (a vitest setup file,
// vitest.config.ts). Many tests lift a page function out of index.html or
// crew.html and run it with `new Function`; once a page wraps its copy in
// T('…'), tf, tn, esPick or esPair, that lifted code looks those names up on
// the global object. Here they are, from the REAL runtime in English — the
// exact English behaviour a phone with no language set gets — so no harness
// has to change when a unit is translated.
import { loadI18n, RUNTIME_NAMES } from './i18nRuntime.js';

const english = loadI18n();
for (const name of RUNTIME_NAMES) (globalThis as Record<string, unknown>)[name] = english[name];
