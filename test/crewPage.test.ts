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

  // R9 + §1B on the SCREEN. The API distinguishes an empty day, rows held
  // back for having no signed contract, and a contract table it could not
  // read. Before this the page painted all three as "Nothing scheduled" —
  // found by adversarial review, and it is the exact spine violation the
  // boundary work was written to prevent.
  it('renders the R9 boundary note — a held-back day is not an empty one', () => {
    expect(html).toContain('boundaryNote');
    expect(html).toContain('notWorkOrders');
  });

  it('does not say "Nothing scheduled" when rows are being withheld', () => {
    // The empty branch must be conditional on there being no note. If this
    // regresses, "the app is holding 11 rows back" and "your day is clear"
    // become the same sentence again.
    // Structural, not positional: slicing around the copy is brittle because
    // "Nothing scheduled" appears more than once in this file.
    expect(html).toMatch(/if \(note\)\s*\{/);
    expect(html).toContain('No work orders for you today');
    // And the withheld branch must come from the note, not from a count that
    // could be zero while the note is still saying the table was unreadable.
    expect(html).toMatch(/const note = typeof data\.boundaryNote === 'string'/);
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

describe('reference library on the crew door (§6U)', () => {
  const html = loadCrewHtml();

  it('searches the crew-scoped library endpoint', () => {
    expect(html).toContain("'/api/crew/reference?q='");
    expect(html).toContain('How do I');
  });

  it('is OUTSIDE the briefing gate — reachable before the day starts', () => {
    // renderLibrary() runs on boot, not from renderWork(). Somebody who needs
    // to look a technique up is already standing at the trunk.
    expect(html).toMatch(/renderLibrary\(\);\s*\n\s*renderNearMiss\(\);/);
    expect(html).not.toMatch(/GATE\.unlocked[\s\S]{0,200}renderLibrary/);
  });

  it('cites the clause and never promises the standard itself (§6U.3)', () => {
    expect(html).toContain('never reprints the standard');
    expect(html).toContain('verify on site');
  });

  it('a library it could not read is NEVER drawn as an empty one (§1B)', () => {
    expect(html).toContain('Library unavailable');
    expect(html).toContain('That is NOT "nothing on file"');
  });

  it('separates "nothing matched" from "nothing is in here" (§1B)', () => {
    expect(html).toContain('Nothing published matches that');
    expect(html).toContain('Nothing is published in the library yet');
  });

  it('names entries held back for want of a human sign-off (§4.7)', () => {
    expect(html).toContain('not yet signed off by a person');
  });

  it('a technique with no recorded limits is shown as incomplete, not as safe', () => {
    expect(html).toContain('e.limitsWarning');
    expect(html).toContain('When this does NOT work');
    // The absence renders in the loud box, same as a real limit would.
    expect(html).toMatch(/lib-limits[\s\S]{0,120}limitsWarning/);
  });

  it('an unknown skill level is stated, never treated as a sign-off', () => {
    expect(html).toContain('could not read your signed-off level');
    expect(html).toContain('That is not a sign-off');
    expect(html).toContain('do not run it until the office signs you off');
  });

  it('says when the search words were too short to actually search on (§1B)', () => {
    expect(html).toContain('too short to search on');
    expect(html).toContain('this is the whole library, not matches');
  });

  it('will not build an href out of anything but http(s)', () => {
    // The rest of the page is XSS-safe because it only ever sets textContent.
    // An href is the one exception, so a stored source link is filtered.
    expect(html).toMatch(/\/\^https\?:\\\/\\\/\/i\.test\(e\.sourceLink\)/);
    // And a rejected link is named, not silently dropped (§1B).
    expect(html).toContain('not a link Arbo will open');
  });

  it('keeps field-sized targets on the lookup', () => {
    expect(html).toMatch(/#lib-q\{[^}]*min-height:56px/);
    expect(html).toMatch(/#lib-go\{[^}]*min-height:56px/);
  });
});

describe('arrival record + change order on the job card (§6)', () => {
  const html = loadCrewHtml();

  it('logs arrival against the job and shows the GAPS, not a confirmation', () => {
    expect(html).toContain("'/api/crew/arrival'");
    expect(html).toContain('gapline');
    // The weaknesses render before the reassurance.
    expect(html.indexOf('res.lines')).toBeLessThan(html.indexOf('res.defensible'));
  });

  it('the crew records THAT work was agreed and WHO agreed — never a figure (§8C)', () => {
    expect(html).toContain("'/api/crew/change-order'");
    expect(html).toContain('Who agreed to it?');
    // No money crosses onto this surface at all. The office fills it in.
    expect(html).not.toMatch(/amount/i);
    expect(html).toContain('office fills the number in');
  });

  it('tells the crew it is not on the bill until the office confirms', () => {
    expect(html).toContain('office to confirm before it goes on the bill');
  });

  it('keeps field-sized targets on the new job actions', () => {
    expect(html).toMatch(/\.jobbtn\{[^}]*min-height:52px/);
  });
});
