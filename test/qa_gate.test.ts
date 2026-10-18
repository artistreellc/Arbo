// Pre-deploy review gate (2026-10-18). The screen review found a dead feed
// worded as an empty one in a dozen places. These phrases are the ones it
// found; none may come back. A failed read is worded through feedKind().
import { describe, it, expect } from 'vitest';
import { loadAppHtml, loadCrewHtml } from '../src/server/appPage.js';

describe('no dead feed reads as an empty one', () => {
  const app = loadAppHtml();
  const crew = loadCrewHtml();
  it.each(['Database not connected', 'Pull refresh', 'No leads yet', 'The Book is empty', 'No calls logged yet', 'No follow-up queue yet'])(
    'the owner app no longer says %o', (p) => expect(app).not.toContain(p));
  it('the crew door no longer says "Pull to refresh" (there is no pull gesture)', () => {
    expect(crew).not.toContain('Pull to refresh');
  });
  it('the shared vocabulary is in place', () => {
    expect(app).toContain('function feedKind(');
    for (const w of ['cut on purpose', 'not in the practice data', 'not set up yet', 'couldn’t read it']) expect(app).toContain(w);
  });
});
