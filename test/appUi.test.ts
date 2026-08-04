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

  // ── §6B THE PERMIT BOARD TAB. The screen for the part of the job that can
  // cost a violation before a saw starts. A screen can break the never-clear
  // rule just as easily as a handler can.
  it('has a Permits tab wired into the nav, the views and the refresh loop', () => {
    // The recurring defect this catches: an endpoint with no door. /api/permits
    // shipped hours before anything called it.
    expect(html).toContain('id="tab-permits"');
    expect(html).toContain('id="view-permits"');
    expect(html).toContain("'/api/permits'");
    expect(html).toContain('renderPermits()');
    // Registered in BOTH loops — a tab missing from either is dead or stale.
    const switchLoop = html.slice(html.indexOf('function switchTab'), html.indexOf('function switchTab') + 400);
    expect(switchLoop).toContain("'permits'");
  });

  it('the permit board renders the engine\'s words, never its own reassurance', () => {
    const fn = html.slice(html.indexOf('async function renderPermits'), html.indexOf('function switchTab'));
    // Headline and next step come straight from the server, unsummarised.
    expect(fn).toContain('r.headline');
    expect(fn).toContain('r.nextStep');
    // And the screen adds no clear of its own.
    expect(fn.toLowerCase()).not.toMatch(/all clear|you'?re clear|no permit (needed|required)|good to cut/);
  });

  it('an unreadable permit board is NOT reported as nothing outstanding (§1B)', () => {
    const fn = html.slice(html.indexOf('async function renderPermits'), html.indexOf('function switchTab'));
    expect(fn).toMatch(/NOT the same as nothing being outstanding/i);
    // Even the empty state refuses to imply a clear.
    expect(fn).toMatch(/not the same as nothing needing a permit/i);
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

  it('is the only place a crew member or a card can be put on file (§4)', () => {
    expect(html).toContain("api('/api/roster')");
    expect(html).toContain('/certification');
    expect(html).toContain('Add somebody to the roster');
    // The crew code is what somebody types into the crew door.
    expect(html).toContain('Crew code: ');
  });

  it('the roster counts cards on file and never rules on anybody', () => {
    expect(html).toContain('CARDS ON FILE');
    // Scoped to the roster — 'qualified' is also a LEAD status elsewhere on
    // this page, which is a different word about a different thing.
    const roster = html.slice(html.indexOf('function renderRoster('), html.indexOf('// ---------- Training board'));
    expect(roster).not.toMatch(/qualified|certified|cleared|is current|good to/i);
  });

  it('unreadable cards read as UNKNOWN on the roster, never as zero (§1B)', () => {
    expect(html).toContain('CARDS UNKNOWN');
    expect(html).toContain('Card counts below are unknown — not zero.');
  });

  it('an empty roster explains what it breaks, and a dead one is named apart', () => {
    expect(html).toContain('Nobody on the roster yet');
    expect(html).toContain('Roster unavailable');
    expect(html).toContain('not a claim that nobody is on it');
  });

  it('a card recorded with no expiry is shown as a warning, not a win (§1B)', () => {
    expect(html).toContain('res.expiryKnown ?');
    expect(html).toContain("'var(--warning)'");
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

  it('is the only place a unit, a part, or a campaign can be created (§6E/§6D)', () => {
    expect(html).toContain("api('/api/fleet/units'");
    expect(html).toContain("'/retire'");
    expect(html).toContain("'/part'");
    expect(html).toContain("api('/api/campaigns'");
    expect(html).toContain('Add a unit to the fleet');
    expect(html).toContain('Register a campaign');
  });

  it('an unmeasured unit is flagged on the card as conservatively routed', () => {
    expect(html).toContain('SIZE UNKNOWN — ROUTED CONSERVATIVELY');
    expect(html).toContain('a guessed clearance is worse than none');
  });

  it('an untracked campaign is a warning, never presented as a clean save', () => {
    expect(html).toContain('res.attributionWired && res.costKnown ?');
    expect(html).toContain('it will say UNKNOWN rather than report it as zero');
  });

  it('no write form is offered over a feed Arbo could not read', () => {
    // Offering the form would imply Arbo is talking to a database it is not.
    expect(html).toContain('if (readable) slot.appendChild(fleetComposer(listSlot))');
    expect(html).toContain('if (p.campaignsKnown) v.appendChild(campaignComposer(campSlot))');
  });

  it('uses the §9 cockpit tokens (violet primary, dark base, 48px+ targets)', () => {
    expect(html).toContain('#7C3AED'); // luminous purple accent
    expect(html).toContain('#0B0D10'); // near-black base
    expect(html).toMatch(/min-height:\s*(48|56)px/);
  });
});
