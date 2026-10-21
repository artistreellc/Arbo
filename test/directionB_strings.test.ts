// Direction B, P1 (docs/DIRECTION_B_PLAN.md): the words that carry a ruling
// must survive the redesign word for word. The mockups are drawings with
// practice text; where they disagree with the app, the app's words win
// (the plan's precedence). A screen may be renamed only as Mike approved
// (RENAMED, from docs/DIRECTION_B.md) — removing anything else here fails.
// Also: the snapshot of every POST the pages make. Direction B adds none.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadAppHtml, loadCrewHtml } from '../src/server/appPage.js';

// The page as it reads on screen: "—" in a string literal is the "—" Mike sees.
const unescape = (s: string) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
const raw = loadAppHtml();
// Code only: a word kept alive in a comment is not on any screen.
const code = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
const app = unescape(code(raw));
const spec = readFileSync(new URL('../docs/DIRECTION_B.md', import.meta.url), 'utf8');

/** The approved renames (R29 + the follow-up answers): old words → the new name(s). */
const RENAMED: Record<string, string[]> = {
  Book: ['Properties on file'],
  Permits: ['Permit rules'],
  Queue: ['Office', 'Follow-ups'],
  Calls: ['Calls & texts'],
  More: ['Office'],
  'Talk to Arbo': ['Phone line'],
};
const survives = (s: string, has: (x: string) => boolean) => has(s) || (RENAMED[s] ?? []).some(has);

const RULING_STRINGS: Record<string, string[]> = {
  '§1B feed words': ['cut on purpose', 'not in the practice data', 'not set up yet', 'couldn’t read it', 'The read failed just now.', 'Nothing was deleted — it stays off until you reconnect it.'],
  'R32 read-only': ['Read-only: Arbo can look but not save. Nothing was written.', 'Read-only: Arbo is reading your real records and saving nothing. Anything that would save says so.'],
  'the Sona flag': ['Sona broke your rules on ', ' — tap one to see what she said, then call them back.', 'SONA BROKE A RULE', ' only in Quo now.', ' — Sona said: “'],
  'the slip rows (slipRuleLabel)': ['Gave a price', 'Diagnosed a tree over the phone', 'Promised a day or time', 'Offered a discount or free work', 'Said a word Arbo never says'],
  'R33 Quo read-only': ['Quo is read-only — send from the Quo app.', 'Arbo texts no one while Quo is read-only (your call, 2026-10-20)', 'Arbo texts — Quo read-only', 'to text from the Quo app',
    'Quo line: texts webhook missing — Arbo is read-only and won’t create it. New Quo texts don’t show here; this is not zero texts.'],
  'permit words (PERMIT_STATE)': ['PERMIT LIKELY', 'PERMIT: REVIEW NEEDED', 'NO OVERLAY — VERIFY W/ CITY', 'PERMIT SCREEN PENDING'],
  'the yard check': ['Yard check — will this job pay?', '✓ ON TARGET', '△ BELOW TARGET', '✕ LOSES MONEY', 'Never a price, never a booking.'],
  'R2 the calendar is Google\'s': ['● Google Calendar — Art-is-Tree', 'Open in Google Calendar ↗',
    'Calendar not showing? Google may need you signed in on this device, or the connection dropped — tap Open in Google Calendar above.',
    'Live Google Calendar — not simulated. These are your real appointments, not practice data.'],
  'crew safety': ['NO AERIAL WORK', '⚠ CANNOT SEE', 'This is not a claim that everyone is current.'],
  'the desks\' failure lines': ['This is not a claim that everything runs.', 'This is not a claim that everything is paid.', 'That is not a sign that nothing is open.',
    'Nothing due from what Arbo could read', 'This is not a claim that none are due.'],
  'R21 / R36 the old phone line': ['Talk to Arbo', 'Off on purpose — disconnected while Sona handles calls. Nothing was deleted.'],
};

describe('the ruling-carrying words survive word for word (P1)', () => {
  for (const [group, list] of Object.entries(RULING_STRINGS)) {
    it.each(list)(`${group}: %o`, (s) => {
      expect(survives(s, (x) => app.includes(x)), s + ' was removed with no approved rename').toBe(true);
    });
  }

  it('the screen titles keep their names, or carry an approved rename', () => {
    const titles = Object.values(new Function(`return ${/^const VIEW_TITLES = (\{.*\});$/m.exec(raw)![1]};`)() as Record<string, string>);
    const BASELINE = ['Learn', 'Measure', 'Agents', 'Permits', 'ARBO', 'Leads', 'Calendar', 'Book', 'Queue', 'Calls', 'Numbers', 'Settings', 'More', 'Assistant'];
    for (const t of BASELINE) expect(survives(t, (x) => titles.includes(x)), t).toBe(true);
  });

  it('the dock labels keep their names, or carry an approved rename', () => {
    const nav = app.slice(app.indexOf('<nav aria-label="Sections">'), app.indexOf('</nav>'));
    const labels = [...nav.matchAll(/<\/svg><span>([^<]+)<\/span>/g)].map((m) => m[1]!);
    for (const t of ['Today', 'Calls', 'Calendar', 'Leads', 'More']) expect(survives(t, (x) => labels.includes(x)), t).toBe(true);
  });

  it('every approved rename is Mike\'s word in the spec, and nothing else is on the list', () => {
    expect(Object.keys(RENAMED).sort()).toEqual(['Book', 'Calls', 'More', 'Permits', 'Queue', 'Talk to Arbo']);
    for (const names of Object.values(RENAMED)) for (const n of names) expect(spec, n).toContain(n);
  });
});

// ---------- the POST snapshot ----------
/** Every `method: 'POST'` in a page, as the path expression of the call it belongs to. */
function posts(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/method: 'POST'/g)) {
    const before = src.slice(0, m.index);
    const at = Math.max(before.lastIndexOf('api('), before.lastIndexOf('fetch('));
    const open = src.indexOf('(', at) + 1;
    let depth = 0;
    let i = open;
    for (; i < m.index!; i++) {
      const c = src[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 0) break;
    }
    out.push(src.slice(open, i).replace(/\s+/g, ' ').trim());
  }
  return out.sort();
}

// What each POST is, from the code that sends it. Direction B adds none (the plan's
// rule); a new one fails here until it is listed with the ruling that allows it.
const OWNER_POSTS: Record<string, string> = {
  "'/api/agents/sections/run'": 'the eight read-only desks (R25)',
  "'/api/assistant/approvals/' + encodeURIComponent(a.id)": 'Mike\'s per-item OK (R28)',
  "'/api/bouncie/connect'": 'Bouncie sign-in (R31, D95)',
  "'/api/campaigns'": 'ad campaign entry (R25)',
  "'/api/estimate/prep'": 'a prep sheet — reads only (2026-09-24)',
  "'/api/estimating/check'": 'the yard check — computes only (§6J2)',
  "'/api/fleet/breakdown'": 'the breakdown sheet (R26, R29 #5)',
  "'/api/fleet/units'": 'add a unit (R25)',
  "'/api/fleet/units/' + u.id + '/retire'": 'retire a unit (R25)',
  "'/api/fleet/units/' + u.id + '/sign-back'": 'sign a unit back on (R26)',
  "'/api/fleet/units/' + unit.id + '/part'": 'log a part (R25)',
  "'/api/followups/' + kind + '/' + a.targetId + '/sent'": 'mark a follow-up sent (R25)',
  "'/api/google/connect'": 'Google sign-in (R33)',
  "'/api/inbox/backfill'": 'an inbox catch-up read (R17)',
  "'/api/inbox/convert'": 'convert approved work, refused while read-only (R17, R32)',
  "'/api/inbox/intents/approve'": 'approve an inbox intent (R17)',
  "'/api/inbox/intents/reject'": 'reject an inbox intent (R17)',
  "'/api/inbox/relabel'": 're-label surfaced mail (R17)',
  "'/api/invoices'": 'raise an invoice (R25)',
  "'/api/invoices/' + invoiceId + '/status'": 'mark an invoice paid (R25)',
  "'/api/leads/' + lead.id + '/status'": 'Good lead / Spam and its Undo (R26, R29 #6)',
  "'/api/location/tracking'": 'location ON/OFF (§21)',
  "'/api/outreach/catchup'": 'the R22 catch-up — refused while Quo is read-only (R33)',
  "'/api/outreach/exclude'": 'Don\'t text (R22)',
  "'/api/outreach/preview'": 'find past-week callers — a read (R22)',
  "'/api/permits/checklist'": 'the permit job check — computes only (R25)',
  "'/api/reference'": 'library entry (R25)',
  "'/api/reference/' + draft.id + '/publish'": 'publish a vetted reference (R25)',
  "'/api/review/' + conv.id + '/reviewed'": 'mark a call reviewed (§29)',
  "'/api/roster'": 'add a crew member (R25)',
  "'/api/roster/' + p.id + '/deactivate'": 'take someone off the roster (R25)',
  "'/api/roster/' + person.id + '/certification'": 'record a credential (R25)',
  "'/api/route/plan'": 'plan a route — computes only (R16, R35)',
  "'/api/settings/channels'": 'inbox channel switches (R12)',
  "'/api/settings/location'": 'location setting (§21)',
  "'/api/settings/route'": 'the work ZIP (R16)',
  "'/api/sim/lessons/decide'": 'approve or reject a lesson (R25)',
  "'/api/sim/run'": 'a practice run (R25)',
  "'/api/talk'": 'Talk — read-only answers (R30)',
  "'/api/training/drafts/' + draft.id + '/publish'": 'publish vetted training (R25)',
  "'/api/lidar/measure?name=' + encodeURIComponent(f.name) + (LIDAR_UP ? '&up=' + LIDAR_UP : '')": 'measure a LiDAR file in memory (R25)',
};
const CREW_POSTS = ["'/api/crew/arrival'", "'/api/crew/briefing/ack'", "'/api/crew/change-order'", "'/api/crew/near-miss'", "'/api/crew/quiz/complete'"];

describe('the POST snapshot: Direction B adds no new send or save (P1)', () => {
  it('the owner app\'s POSTs are exactly the listed ones, each with its ruling', () => {
    const found = posts(raw);
    const unlisted = [...new Set(found)].filter((p) => !(p in OWNER_POSTS));
    expect(unlisted, 'a new POST needs a ruling cited here').toEqual([]);
    const gone = Object.keys(OWNER_POSTS).filter((p) => !found.includes(p));
    expect(gone, 'a listed POST is gone — take it off the list in the same commit').toEqual([]);
    expect(found.length).toBe(42); // 41 paths: the Leads status call is sent from two places (Good/Spam, Undo)
  });

  it('the crew door\'s POSTs are exactly its five', () => {
    expect([...new Set(posts(loadCrewHtml()))]).toEqual(CREW_POSTS);
  });
});
