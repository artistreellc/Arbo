// Serves the Arbo app shells (brief §8/§9, §8C.1 "one app, two doors"):
// self-contained HTML files —
// design tokens inlined, no CDN, no build step — so the app deploys with the
// server and can't drift from it. Loaded once and cached.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

/** The ADMIN door (Mike's cockpit). */
export function loadAppHtml(): string {
  return load('index.html');
}

/** The CREW door (§8C.1) — work orders + the gated briefing, nothing else. */
export function loadCrewHtml(): string {
  return load('crew.html');
}
