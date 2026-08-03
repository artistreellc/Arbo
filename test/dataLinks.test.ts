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
import { describe, it, expect, afterAll, vi } from 'vitest';

// The data-link switch (owner instruction 2026-08-03: "cut all data links to
// the app till we finish the rough build").
//
// The whole value of this switch is that it FAILS CLOSED. A typo, an empty
// string, a missing variable, a plausible-looking 'true' — every one of them
// must leave the link cut, because the expensive failure is the unfinished app
// silently reaching live customer data, not a screen saying it cannot see.
//
// env.ts freezes its values at import, exactly as it does in the real process,
// so each case reloads the module with the environment already set. Mutating
// process.env after import would test nothing.

const REAL_LOOKING_URL = 'https://wdpyysgxmwvvoyveihum.supabase.co';
const REAL_LOOKING_KEY = 'sb_secret_TESTONLYTESTONLYTESTONLY';
const saved = { ...process.env };

/** Load a fresh copy of the client with credentials PRESENT and this switch. */
async function loadWithCreds(link: string | undefined) {
  vi.resetModules();
  process.env.SUPABASE_URL = REAL_LOOKING_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = REAL_LOOKING_KEY;
  if (link === undefined) delete process.env.ARBO_DATA_LINKS;
  else process.env.ARBO_DATA_LINKS = link;
  return import('../src/db/client.js');
}

afterAll(() => {
  process.env = { ...saved };
  vi.resetModules();
});

describe('the data-link switch', () => {
  it('is CUT by default, even with the database fully configured', async () => {
    const c = await loadWithCreds(undefined);
    expect(c.dbConfigured()).toBe(true);   // the credentials ARE there
    expect(c.dataLinksLive()).toBe(false); // and the link is still cut
    expect(c.hasDb()).toBe(false);
  });

  it.each(['', 'off', 'false', 'true', 'yes', 'LIVE', ' live', 'live '])(
    'stays CUT for %o — only the exact string "live" opens it',
    async (value) => {
      const c = await loadWithCreds(value);
      expect(c.dataLinksLive()).toBe(false);
      expect(c.hasDb()).toBe(false);
    },
  );

  it('opens only on the exact string "live"', async () => {
    const c = await loadWithCreds('live');
    expect(c.dataLinksLive()).toBe(true);
    expect(c.hasDb()).toBe(true);
  });

  it('getDb() is the second door and refuses on its own', async () => {
    // A repository that forgets to check hasDb() must STILL be unable to reach
    // a real table by accident. getDb() is the only way to a live query.
    const c = await loadWithCreds('off');
    expect(() => c.getDb()).toThrow(/links are CUT/i);
  });

  it('says which of the two reasons it refused for', async () => {
    // "The link is cut" and "there is no database" are different facts, and
    // the message says so rather than leaving somebody hunting a missing key.
    const c = await loadWithCreds('off');
    expect(() => c.getDb()).toThrow(/ARBO_DATA_LINKS/);
    expect(() => c.getDb()).toThrow(/Nothing was deleted/);
  });

  it('never reports the database as unconfigured just because the link is cut', async () => {
    // The boot line and /health both read this. Collapsing "configured but
    // cut" into "not configured" would be the §1B lie in the one place an
    // operator looks to see whether Arbo is alive.
    const c = await loadWithCreds('off');
    expect(c.dbConfigured()).toBe(true);
    expect(c.hasDb()).toBe(false);
  });
});
