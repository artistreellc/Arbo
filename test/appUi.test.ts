import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';

// The app ships as one self-contained file — these are structural guarantees,
// not pixel tests. The §2 forbidden terms are checked here too because this is
// a customer-adjacent surface that renders live business data.

describe('ARBOR app shell', () => {
  const html = loadAppHtml();

  it('loads and is a complete standalone document', () => {
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('</html>');
    expect(html).toContain('name="viewport"');
  });

  it('is fully self-contained — no external scripts, styles, or fonts', () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+(stylesheet|font)/i);
    expect(html).not.toMatch(/@import/);
  });

  it('embeds the real Google Calendar — and only calendar.google.com', () => {
    // Mike's rule: the calendar IS Google Calendar, planted in the app.
    expect(html).toContain('calendar.google.com/calendar/embed');
    expect(html).toContain('artistreeofvirginia@gmail.com');
    // These three are the ONLY sanctioned outbound hosts. Anything else — over
    // https, http, or protocol-relative — is a dependency the app must not grow.
    const hosts = [...html.matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1]!.toLowerCase());
    const allowed = new Set(['calendar.google.com', 'maps.google.com', 'www.google.com']);
    expect([...new Set(hosts)].filter((h) => !allowed.has(h))).toEqual([]);
  });

  it('talks to the real API routes', () => {
    expect(html).toContain('/api/brief');
    expect(html).toContain('/api/leads');
    expect(html).toContain('x-arbor-key');
  });

  it('never contains forbidden terms (§2) or the word Suffolk/TCIA', () => {
    expect(html).not.toMatch(/suffolk/i);
    expect(html).not.toMatch(/TCIA/);
  });

  it('never claims a permit is clear — pending/verify language only', () => {
    // The §6B never-say-clear rule extends to the UI copy.
    expect(html).not.toMatch(/permit[^<]{0,20}clear/i);
    expect(html).toContain('VERIFY W/ CITY');
    expect(html).toContain('PERMIT SCREEN PENDING');
  });

  it('renders user-sourced text via textContent, never innerHTML', () => {
    expect(html).not.toContain('innerHTML');
  });

  it('the safety board never declares anyone qualified or cleared (§4)', () => {
    // "No expiry problem found" is the strongest thing Arbo may say.
    expect(html).toContain('That is not a clearance');
    expect(html).not.toMatch(/is qualified|are qualified|cleared to climb|good to climb|certified and current/i);
  });

  it('the safety board shows what it CANNOT see before anything reassuring (§1B)', () => {
    expect(html).toContain('CANNOT SEE');
    expect(html).toContain('not a claim that everyone is current');
  });

  it('the training board never shows an untested topic as a pass (§1B/§6M.5)', () => {
    expect(html).toContain('/api/training/board');
    expect(html).toContain('Never asked about');
    expect(html).toContain('NEVER TESTED');
    // An unreadable weekly feed is UNKNOWN, not "nobody owes anything".
    expect(html).toContain('WEEK UNKNOWN');
  });

  it('a dead training board is named, not drawn as a current crew (§1B)', () => {
    expect(html).toContain('Training board unavailable');
    expect(html).toContain('not a claim that everyone is current');
  });

  it('the vetting queue demands a named human before publishing (§4.7)', () => {
    expect(html).toContain('/api/training/drafts');
    expect(html).toContain('cannot publish without your name on it');
    // The UI must collect the vetter, so the DB CHECK is never the thing that
    // says no — a 500 on a safety surface teaches people to click harder.
    expect(html).toContain('required to publish');
  });

  it('a dead draft queue is named, not rendered as an empty queue (§1B)', () => {
    expect(html).toContain('Draft queue unavailable');
    expect(html).toContain('not a claim that nothing is waiting');
  });

  it('the money surface names a dead ledger instead of implying everything is paid (§1B)', () => {
    expect(html).toContain('Ledger unavailable');
    expect(html).toContain('not a claim that everything is paid');
  });

  it('a clean ledger reads differently from a section that never ran (§1B)', () => {
    expect(html).toContain('Nothing owed, nothing unbilled');
    expect(html).toContain('Arbo checked the ledger');
  });

  it('the money surface never threatens a customer (§4.8)', () => {
    for (const forbidden of ['legal action', 'collections agency', 'lien', 'small claims', 'we will sue']) {
      expect(html.toLowerCase(), `app copy threatened: "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('the fleet surface names a dead feed instead of drawing all-units-up (§1B)', () => {
    expect(html).toContain('Fleet status unknown');
    expect(html).toContain('not a claim that everything runs');
  });

  it('the breakdown sheet never offers to order a part (§6E2.3)', () => {
    expect(html).toContain('/api/fleet/breakdown');
    expect(html).toContain('holds no card');
    expect(html).not.toMatch(/order (the |this )?part|add to cart|checkout|buy now/i);
  });

  it('the performance screen shows the benchmark and the blind spots FIRST (§1B/§6N.3)', () => {
    expect(html).toContain('/api/performance');
    expect(html).toContain('fleet $/crew-hr');
    // Rated on crew-hours, and the screen says so — per-job rewards job mix.
    expect(html).toContain('not per job');
    expect(html).toContain('BLIND SPOT');
  });

  it('unrated areas are shown apart, never as the bottom of a ranking', () => {
    expect(html).toContain('Not enough work yet to rate');
    expect(html).toContain('unmeasured, not underperforming');
  });

  it('a dead performance feed is named, not drawn as healthy numbers', () => {
    expect(html).toContain('Performance unavailable');
    expect(html).toContain('not a claim that everything is fine');
    expect(html).toContain('not "no campaigns running"');
  });

  it('is the only place the §6U library can be written, and it writes drafts', () => {
    expect(html).toContain('/api/reference/drafts');
    expect(html).toContain("api('/api/reference'");
    expect(html).toContain('Write a new entry');
    // §6U.3 stated where the entry is actually typed, not only in the API.
    expect(html).toContain('never paste the standard text');
  });

  it('a library entry cannot publish without a name on it (§4.7)', () => {
    expect(html).toContain("'/api/reference/' + draft.id + '/publish'");
    expect(html).toContain('cannot publish without your name on it');
  });

  it('shows a draft\'s GAPS before the publish button (§1B)', () => {
    // Scoped to the library desk — 'Vet & publish' also appears in the lesson
    // queue further up the file.
    const desk = html.slice(html.indexOf('async function renderLibraryQueue'),
      html.indexOf('function libraryComposer'));
    expect(desk).toContain('draft.gaps');
    expect(desk.indexOf('draft.gaps')).toBeLessThan(desk.indexOf("'Vet & publish'"));
    expect(html).toContain('No limits recorded — the crew will see a warning in their place.');
  });

  it('a dead library queue is named, not drawn as an empty one (§1B)', () => {
    expect(html).toContain('Library queue unavailable');
    expect(html).toContain('not a claim that nothing is waiting');
  });

  it('uses the §9 cockpit tokens (violet primary, dark base, 48px+ targets)', () => {
    expect(html).toContain('#7C3AED'); // luminous purple accent
    expect(html).toContain('#0B0D10'); // near-black base
    expect(html).toMatch(/min-height:\s*(48|56)px/);
  });
});
