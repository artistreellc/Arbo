import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadCrewHtml, loadAppHtml } from '../src/server/appPage.js';

const html = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');

describe('the crew door (§8C.1) — one app, two doors', () => {
  it('is a separate shell from the admin cockpit', () => {
    expect(loadCrewHtml()).not.toBe(loadAppHtml());
    expect(loadCrewHtml()).toContain('ARBO');
    expect(loadCrewHtml()).toContain('Crew');
  });

  it('is self-contained — no external scripts, styles, or fonts', () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+(stylesheet|font)/i);
    expect(html).not.toMatch(/@import/);
  });

  it('only ever calls crew endpoints — never an admin one', () => {
    const calls = [...html.matchAll(/api\('([^']+)'/g)].map((m) => m[1]!);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c, `crew page called a non-crew endpoint: ${c}`).toMatch(/^\/api\/crew\//);
    }
    for (const forbidden of ['/api/leads', '/api/properties', '/api/estimating', '/api/queue', '/api/followups', '/api/calendar']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('never mentions price, tracking, or customer-contact concepts', () => {
    // Scan the markup + logic, NOT the stylesheet (CSS legitimately says
    // "margin"). Business terms must not appear anywhere a crew member reads.
    const withoutCss = html.replace(/<style>[\s\S]*?<\/style>/g, '').toLowerCase();
    for (const term of ['quoted', 'margin', 'invoice', 'bouncie', 'lead quality', 'price', 'customer phone']) {
      expect(withoutCss, `crew page references "${term}"`).not.toContain(term);
    }
    expect(withoutCss).not.toMatch(/\$\s?\d/);
  });

  it('keeps work orders behind the gate — the day cannot open unbriefed', () => {
    // The renderer refuses to draw work orders until GATE.unlocked is true.
    expect(html).toMatch(/if \(!GATE\.unlocked\)/);
    expect(html).toContain('Your work orders unlock after the safety briefing');
  });

  it('treats the SERVER as the gate authority, not the page', () => {
    // The page posts its state and obeys the answer; it never self-unlocks.
    expect(html).toContain("/api/crew/briefing/ack");
    expect(html).toMatch(/if \(!res\.unlocked\)/);
  });

  it('requires all three gate conditions in the UI copy', () => {
    expect(html).toContain('scroll to the bottom');
    expect(html).toContain('tick the box');
    expect(html).toMatch(/read for/);
  });

  it('prompts the before/after photo law on every job (§1B)', () => {
    expect(html).toContain('Before + after photos required');
  });

  it('cites standards by clause, never reproducing text (§6U.3)', () => {
    expect(html).toContain('Per ');
    expect(html).toContain('verify on site');
  });

  it('renders all server text via textContent (XSS-safe by construction)', () => {
    expect(html).not.toMatch(/innerHTML/);
  });
});
