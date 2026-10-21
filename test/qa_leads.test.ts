// Pre-deploy QA round — Leads, Calendar + route planner, Book + estimate prep.
// §1B on these screens: a feed Arbo could not read is NAMED, never headed as
// "no leads yet" / "the Book is empty", and an unreadable permit read is never
// drawn as "screen pending". vitest has no DOM, so the UI half is source pins
// over src/app/index.html, scoped to each function so a match elsewhere in
// the page cannot satisfy them.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

// The live lead source with its three reads under the test's control — no
// database is touched. Only these three are replaced; the rest stay real.
const repo = vi.hoisted(() => ({
  permitsFail: false,
  historyFail: false,
  rows: [
    {
      id: 'L-prop', source: 'call', details: null, qualification: null, is_emergency: false, status: 'new',
      created_at: '2026-10-17T12:00:00Z', contact: { name: 'SIM-Pat', phones: ['+17575550101'], is_first_timer: true },
      property: { id: 'P-1', address: '1 Simulation Row', city: 'Norfolk', zip: '23503' },
    },
    {
      id: 'L-none', source: 'call', details: null, qualification: null, is_emergency: false, status: 'new',
      created_at: '2026-10-17T11:00:00Z', contact: null, property: null,
    },
  ],
}));
vi.mock('../src/db/repositories.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/db/repositories.js')>()),
  listLeads: async () => repo.rows,
  latestPermitsForProperties: async () => { if (repo.permitsFail) throw new Error('permit read down'); return new Map(); },
  latestHistoryForProperties: async () => { if (repo.historyFail) throw new Error('history read down'); return new Map(); },
}));

import { createLiveSource } from '../src/server.js';
import { createApi } from '../src/server/api.js';

describe('the live lead source names a failed permit or history read (§1B)', () => {
  const liveApi = () => createApi({ ...createLiveSource(), ready: () => true });
  type Lead = { id: string; screenPending: boolean; permitUnreadable: boolean; historyUnreadable: boolean };
  const leadsOf = async () => ((await liveApi().leads(10)).body as { leads: Lead[] }).leads;
  afterEach(() => vi.restoreAllMocks());

  it('a permit read that throws marks leads WITH a property unreadable — not screen pending', async () => {
    repo.permitsFail = true; repo.historyFail = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const leads = await leadsOf();
    const withProp = leads.find((l) => l.id === 'L-prop')!;
    expect(withProp.permitUnreadable).toBe(true);
    expect(withProp.screenPending).toBe(false);
    expect(withProp.historyUnreadable).toBe(false);
    // No property means nothing to screen — the failure says nothing about it.
    expect(leads.find((l) => l.id === 'L-none')!.permitUnreadable).toBe(false);
  });

  it('a history read that throws is named on the lead with a property', async () => {
    repo.permitsFail = false; repo.historyFail = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const leads = await leadsOf();
    expect(leads.find((l) => l.id === 'L-prop')!.historyUnreadable).toBe(true);
    expect(leads.find((l) => l.id === 'L-none')!.historyUnreadable).toBe(false);
    // A permit read that worked and found nothing is still "pending".
    expect(leads.find((l) => l.id === 'L-prop')!.screenPending).toBe(true);
  });

  it('both reads working: no flag raised', async () => {
    repo.permitsFail = false; repo.historyFail = false;
    for (const l of await leadsOf()) {
      expect(l.permitUnreadable).toBe(false);
      expect(l.historyUnreadable).toBe(false);
    }
  });
});

const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
const css = html.slice(0, html.indexOf('</style>'));
/** The source between two anchors — each pin below is scoped to its function. */
function region(start: string, end: string): string {
  const a = html.indexOf(start);
  const b = html.indexOf(end, a + 1);
  expect(a, start).toBeGreaterThan(-1);
  expect(b, end).toBeGreaterThan(a);
  return html.slice(a, b);
}

describe('Leads screen (source pins)', () => {
  const leads = region('async function renderLeads()', '// ---------- Route planner');

  it('a failed read is worded by the feed-state vocabulary, never "No leads yet"', () => {
    expect(leads).toContain("feedState(e, 'Leads', 'an empty inbox')");
    for (const gone of ['No leads yet', 'Inbox zero', 'Pull refresh', 'Database not connected']) {
      expect(leads, gone).not.toContain(gone);
    }
    // A real empty inbox promises no ingestion while R4 holds.
    expect(leads).toContain("state('No new leads', 'Nothing waiting right now.')");
  });

  it('the two lead buttons say what they do, in words, with an icon', () => {
    expect(leads).toContain("mark('i-check', 'Good lead', 'Mark as a good lead', 'ok', 'qualified')");
    expect(leads).toContain("mark('i-close', 'Spam', 'File as spam or wrong number', 'bad', 'spam')");
    expect(leads).toContain("setAttribute('aria-label', aria)");
    expect(leads).not.toMatch(/mark\('[✓✗]'/);
  });

  it('a failed save is shown on the card, spam can be undone, and only spam dims the card', () => {
    expect(leads).toContain('showSaveFail(c, e)');
    // QA round 3: the minute timer holds a filed card for about 2 minutes, and the copy says so.
    expect(leads).toContain('Filed as spam — Undo stays about 2 minutes, or until you tap\\u00a0↻.');
    expect(leads).toContain("'Undo'");
    expect(leads).toContain("chip('QUALIFIED', 'good')");
    expect(leads.match(/classList\.add\('dismissed'\)/g)).toHaveLength(1);
    // The filed line, its Undo, and any save error stay readable on a dimmed card.
    expect(leads).toContain("el('div', 'lead-filed')");
    expect(css).toContain('.card.dismissed > :not(.lead-filed):not(.save-err){opacity:.42}');
  });

  it('triage leads line 1 (EMERGENCY, else HOT/WARM/COOL), and the permit chip has a line of its own', () => {
    // QA round 2: EMERGENCY already outranks HOT, so the two never sit side by side.
    const emg = leads.indexOf("if (lead.isEmergency) b.appendChild(chip('EMERGENCY', 'alarm'));");
    const pri = leads.indexOf("else b.appendChild(chip(lead.quality.priority.toUpperCase(), { hot: 'stop', warm: 'watch', cool: 'info' }[lead.quality.priority]));");
    const permit = leads.indexOf('const pb = permitBadge(lead);');
    expect(emg).toBeGreaterThan(-1);
    expect(pri).toBeGreaterThan(emg);
    expect(permit).toBeGreaterThan(leads.indexOf('c.appendChild(b);'));
    expect(leads).toContain("if (pb) { const pr = el('div', 'badges'); pr.style.marginTop = '6px'; pr.appendChild(pb); c.appendChild(pr); }");
    expect(leads).not.toContain('b.appendChild(pb)');
  });

  it('an unreadable permit or history read gets a feed line, and no new permit badge word', () => {
    expect(leads).toContain('lead.permitUnreadable');
    // R32: a link kept cut on purpose is said as cut — a failed read keeps the null (unread) form.
    // Direction B P16: the cut one is said once, in New leads' feeds card (cut words), never on every lead.
    expect(leads).toContain("if (lead.permitUnreadable && !lead.permitCut) c.appendChild(feedLine(null, 'Permit screen'));");
    expect(leads).toContain('lead.historyUnreadable');
    expect(leads).toContain("else if (lead.historyUnreadable && !lead.historyCut) c.appendChild(feedLine(null, 'Past work'));");
    expect(leads).toContain("const n = feedLine({ code: 503, message: 'link_cut' }, what, 'It shows on no lead below.');");
    expect(leads).toContain("cutPast && feeds.place(v, cutLine('Past work'))");
    expect(leads).toContain("cutPermit && feeds.place(v, cutLine('Permit screen'))");
    // Permit wording is Mike's (X6) — the read failure is a feed state, not a badge.
    expect(html).not.toContain('PERMIT CHECK UNREADABLE');
  });

  it('the lead buttons are styled as icon + word pills', () => {
    const bad = css.indexOf('.minibtn.bad{');
    // QA round 2: lighter pills (ink text, hairline border, the tone on the icon) so Call back stays the one heavy control.
    const mark = css.indexOf('.minibtn.mark{display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:1;min-height:44px;font-size:13.5px;color:var(--ink-2);border-color:var(--hairline)}');
    expect(mark).toBeGreaterThan(bad);
    expect(mark).toBeLessThan(css.indexOf('.card.dismissed >'));
  });

  it('day-theme gold text is dark enough to read (Night untouched)', () => {
    const day = css.slice(css.indexOf(':root{'), css.indexOf('/* Night'));
    expect(day).toContain('--gold-6:#7E5C0A');
    expect(css).not.toContain('--gold-6:#9A7212');
    expect(css.match(/--gold-6:#E9C877/g)).toHaveLength(2);
  });
});

describe('Calendar + route planner (source pins)', () => {
  const cal = region('function gcalEmbedUrl()', '// ---------- The Book');
  const planner = region('function routePlannerPanel(v)', '// ---------- Calendar: the ACTUAL');

  it('the fallback line names possible causes, never one as fact', () => {
    expect(cal).not.toContain('signed out of Google on this device');
    expect(cal).toContain('Calendar not showing? Google may need you signed in on this device, or the connection dropped');
  });

  it('the embed sends no bgcolor (Google has no dark mode)', () => {
    // The URL the page actually builds, phone width and desk width — the
    // comment that says why may name the word; the request never carries it.
    const src = /^function gcalEmbedUrl\(\) \{[\s\S]*?^\}$/m.exec(html);
    const id = /^const GCAL_ID = '([^']+)';$/m.exec(html);
    expect(src).not.toBeNull();
    expect(id).not.toBeNull();
    for (const innerWidth of [390, 1280]) {
      const url = new Function('window', 'GCAL_ID', `${src![0]}\nreturn gcalEmbedUrl();`)({ innerWidth }, id![1]) as string;
      expect(url.startsWith('https://calendar.google.com/calendar/embed?')).toBe(true);
      expect(new URL(url).searchParams.has('bgcolor')).toBe(false);
      expect(url).toContain('src=artistreeofvirginia%40gmail.com');
    }
    expect(cal).not.toContain("getPropertyValue('--card')");
    expect(html).not.toContain('#0B0D10');
  });

  it('on a wide screen the Calendar view stacks like the phone (the last wide-screen rule)', () => {
    const start = css.indexOf('@media (min-width:900px){');
    const block = css.slice(start, css.indexOf('\n}\n', start)).trim();
    expect(block.endsWith('#view-cal.view.active{display:block}')).toBe(true);
  });

  it('planner controls use the shared form and button styles at 16px+', () => {
    expect(planner).toContain("ta.className = 'input'");
    expect(planner).toContain("daySel.className = 'input'");
    expect(planner).toContain("el('button', 'actbtn', 'Plan route')");
    expect(planner).not.toContain('font-size:15px');
    expect(planner).not.toContain('Synthetic');
    expect(planner).toContain("'123 Example St, Virginia Beach, 23451\\n45 Example Rd, Norfolk, 23503'");
  });

  it('an empty box is a quiet note with no API call, and plan warnings are amber, not the red alarm', () => {
    const empty = planner.indexOf('Add at least one stop — one per line.');
    expect(empty).toBeGreaterThan(-1);
    expect(empty).toBeLessThan(planner.indexOf("api('/api/route/plan'"));
    expect(planner).toContain("for (const w of plan.warnings) pout.appendChild(el('div', 'late',");
  });

  it('visit times print as 12-hour clock times', () => {
    const m = planner.match(/const t12 = (\(s\) => \{.*\});/);
    expect(m).not.toBeNull();
    const t12 = new Function('return ' + m![1])() as (s: string) => string;
    expect(t12('08:00')).toBe('8:00 AM');
    expect(t12('12:20')).toBe('12:20 PM');
    expect(t12('16:05')).toBe('4:05 PM');
    expect(t12('00:30')).toBe('12:30 AM');
    // Anything that is not HH:MM is shown as it came, never mangled.
    expect(t12('soon')).toBe('soon');
  });

  it('ON pills, the JOB badge, stop numbers and the TODAY tag read in Night (no white on light green)', () => {
    expect(css).toContain('.loc-toggle.on{background:var(--forest);border-color:var(--forest);color:var(--paper)}');
    expect(css).toContain('.b-job{background:var(--forest);color:var(--paper)}');
    expect(css).toMatch(/\.ordernum\{[^}]*background:var\(--forest\);color:var\(--paper\);/);
    expect(css).toMatch(/\.cal-day\.today \.cal-daylabel::after\{[^}]*background:var\(--forest\);color:var\(--paper\);/);
  });
});

describe('Book + estimate prep (source pins)', () => {
  const book = region('async function renderBook()', '// The twin sheet');
  const twin = region('async function openTwin(', "$('twin-close')");
  const prep = region('function estimatePrepPanel()', 'async function renderBook()');

  it('an unreadable Book is worded by the feed-state vocabulary, never "The Book is empty"', () => {
    // Direction B P15 review: the Book is "Properties on file" (VIEW_TITLES.book) — its dead feed says that name.
    expect(book).toContain("feedState(e, VIEW_TITLES.book, 'an empty list')");
    for (const gone of ['The Book is empty', 'Pull refresh', 'Database not connected']) {
      expect(book, gone).not.toContain(gone);
    }
    expect(twin).toContain("feedState(e, 'This property', 'a property with no history', 'Close this and tap the property again.')");
    expect(twin).not.toContain('Pull refresh');
  });

  it('a dead coming-due forecast is named before the property list', () => {
    const named = book.indexOf('if (data.forecastUnavailable)');
    expect(named).toBeGreaterThan(-1);
    expect(named).toBeLessThan(book.indexOf('data.comingDue && data.comingDue.length'));
    expect(book).toContain("feedLine(null, 'Coming-due forecast'");
  });

  it('SCREEN NOT RUN and NO OVERLAY — VERIFY never wear the green ON TARGET style', () => {
    expect(prep).not.toContain('v-on');
    const m = prep.match(/const pc = ([^;]+);/);
    expect(m).not.toBeNull();
    const pc = new Function('s', 'return ' + m![1]) as (s: unknown) => string;
    expect(pc({ permit: { ran: false } })).toBe('v-below');
    expect(pc({ permit: { ran: true, status: 'PERMIT_LIKELY' } })).toBe('v-lose');
    expect(pc({ permit: { ran: true, status: 'REVIEW_NEEDED' } })).toBe('v-below');
    expect(pc({ permit: { ran: true, status: 'NO_OVERLAY_VERIFY' } })).toBe('v-verify');
    // The neutral style sits with its siblings, not next to the internal tag.
    const lose = css.indexOf('.verdict.v-lose .vhead');
    const verify = css.indexOf('.verdict.v-verify{border-color:var(--border)}.verdict.v-verify .vhead{color:var(--ink-2)}');
    expect(verify).toBeGreaterThan(lose);
    expect(verify).toBeLessThan(css.indexOf('.verdict .drv'));
  });

  it('prep labels are tied to their fields and use the shared label style', () => {
    expect(prep).toContain('l.htmlFor = node.id');
    expect(prep).not.toContain('l.style.');
    // Direction B P15 review: what the sheet holds is said once, in Estimate's head (the card's own intro repeated it).
    expect(html).toContain("'Start with the address: permit, drive time, 811 and access. Never a price, never a booking.'");
  });

  it('dropdowns and the prep card title match the rest of the form', () => {
    expect(css.indexOf('.field select,#yard select,select.input{-webkit-appearance:none;appearance:none;'))
      .toBeGreaterThan(css.indexOf('.field textarea{'));
    expect(css).toContain('.slot > div > .panel-title:first-child,.slot > .panel-title:first-child,.card > .panel-title:first-child{margin-top:0}');
  });
});
