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

describe('crew near-miss filing (§6V) — blameless and always reachable', () => {
  const html = loadCrewHtml();

  it('posts to the crew near-miss endpoint', () => {
    expect(html).toContain('/api/crew/near-miss');
  });

  it('is OUTSIDE the briefing gate — reportable before the day starts', () => {
    // renderNearMiss() runs on boot, not from renderWork(), which is the
    // gate-guarded path. A near miss that has to wait for a briefing is a
    // near miss that never gets filed.
    expect(html).toMatch(/renderNearMiss\(\);\s*\n\s*api\('\/api\/crew\/briefing'\)/);
  });

  it('promises no blame in the copy, and asks for no name', () => {
    expect(html).toContain('No names, no blame, no write-up');
    expect(html).not.toMatch(/who was at fault|whose fault|who caused/i);
  });

  it('a failed filing is told to the crew, never swallowed', () => {
    expect(html).toContain('Did not save');
    expect(html).toContain('Tell the office directly');
  });
});

describe('clock-in question (§6M/§4.6) on the crew door', () => {
  const html = loadCrewHtml();

  it('asks the server for the questions and posts answers, never a score', () => {
    expect(html).toContain("'/api/crew/quiz?context=' + ctx");
    expect(html).toContain('/api/crew/quiz/complete');
    // The phone sends WHICH option it picked. It never asserts correctness —
    // the server grades against a key this page has never seen.
    expect(html).toContain('answers: QUIZ.answers');
    expect(html).not.toMatch(/correct:\s*\d/);
  });

  it('picks the Friday questionnaire by the Hampton Roads day, not UTC', () => {
    expect(html).toContain("timeZone: 'America/New_York', weekday: 'short'");
    expect(html).toContain('friday_questionnaire');
    expect(html).toContain('clock_in_gate');
  });

  it('shows progress and never dresses a short pool up as a full quiz (§1B)', () => {
    expect(html).toContain('answered');
    expect(html).toContain('This is not a short week');
  });

  it('shows the crew that the time is paid (§4.6)', () => {
    expect(html).toContain('paid time');
    expect(html).toContain('min paid');
  });

  it('a quiz that fails to load says so instead of silently skipping', () => {
    expect(html).toContain('do not skip it quietly');
    expect(html).toContain('not "no questions"');
  });

  it('the question only renders after the briefing gate unlocks', () => {
    expect(html).toMatch(/if \(!GATE\.unlocked \|\| QUIZ\.done\) return;/);
  });

  it('keeps field-sized targets', () => {
    expect(html).toMatch(/\.qopt\{[^}]*min-height:56px/);
  });
});
