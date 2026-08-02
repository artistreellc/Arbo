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
    // The embed is the ONE sanctioned outbound host. Anything else would be a
    // third-party dependency the app must not grow.
    const hosts = [...html.matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]!.toLowerCase());
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

  it('uses the §9 cockpit tokens (violet primary, dark base, 48px+ targets)', () => {
    expect(html).toContain('#7C3AED'); // luminous purple accent
    expect(html).toContain('#0B0D10'); // near-black base
    expect(html).toMatch(/min-height:\s*(48|56)px/);
  });
});
