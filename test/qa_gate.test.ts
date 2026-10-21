// Pre-deploy review gate (2026-10-18). The screen review found a dead feed
// worded as an empty one in a dozen places. These phrases are the ones it
// found; none may come back. A failed read is worded through feedKind().
import { describe, it, expect } from 'vitest';
import { loadAppHtml, loadCrewHtml } from '../src/server/appPage.js';
import { CALM, calmPhrases, bareNothingNeedsYou } from './support/pageCode.js';

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
  // Direction B P1: the calm phrases a hub must never draw — over a dead feed
  // or over a desk Arbo did not read. Any case (review D3): read from what the
  // page can put on screen, so a comment that quotes a banned phrase is not it.
  it.each(CALM)('the owner app never says %o, in any case', (p) => expect(calmPhrases(app)).not.toContain(p));
  it('"Nothing needs you" is never said bare — only the two scoped lines, once each, in the inbox panel (M12)', () => {
    // The two inbox lines name what was read ("in the inbox right now" draws only
    // on a whole read; the other points at the gap above). Anything else is banned,
    // and so is either line anywhere but inboxIntentPanel (review D3).
    expect(bareNothingNeedsYou(app)).toEqual([]);
  });
  it('R33: "ready to text" and "Send catch-up" appear only in outreachPanel’s sends-on branch', () => {
    const at = app.indexOf('async function outreachPanel(');
    const end = app.indexOf('\n}\n', at);
    const panel = app.slice(at, end);
    for (const p of ['ready to text', 'Send catch-up']) {
      const all = [...app.matchAll(new RegExp(p, 'g'))].map((m) => m.index!);
      expect(all.length, p).toBeGreaterThan(0);
      for (const i of all) {
        expect(i > at && i < end, p + ' outside outreachPanel').toBe(true);
        // The nearest read-only test above it: its own branch was closed by `} else` before the phrase.
        const before = panel.slice(0, i - at);
        const ro = before.lastIndexOf('st.readOnly');
        expect(ro, p + ': no read-only test above it').toBeGreaterThan(-1);
        expect(before.slice(ro), p + ' sits in the read-only branch').toMatch(/\}\s*else/);
      }
    }
  });
  it('every chip on every screen takes its colour from the one tone table', () => {
    const calls = app.match(/\bbadge\(/g) ?? [];
    // The only direct badge() calls left are the helper's own definition and chip() itself.
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(app).toContain('function chip(text, tone)');
    expect(app).not.toMatch(/badge\([^)]*'b-[a-z-]+'\)/);
  });
});
