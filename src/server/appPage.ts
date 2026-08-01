// Serves the ARBOR app shell (brief §8/§9): one self-contained HTML file —
// design tokens inlined, no CDN, no build step — so the app deploys with the
// server and can't drift from it. Loaded once and cached.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let cached: string | null = null;

export function loadAppHtml(): string {
  if (cached === null) {
    const here = dirname(fileURLToPath(import.meta.url));
    cached = readFileSync(join(here, '..', 'app', 'index.html'), 'utf8');
  }
  return cached;
}
