// H4 (audit 2026-10-20), labels only: Today, the Morning Brief, the booking
// agent and the storm "stops at risk" read Arbo's OWN estimate and job rows,
// labelled as a Google Calendar mirror that does not exist. With the jobs and
// estimates links open, the home screen would say "Nothing on the books
// today" over a full Google Calendar and mark the schedule healthy. Now every
// one of them says it reads Arbo's bookings only. Whether Arbo should READ
// the Google Calendar is Mike's call — nothing here starts reading it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createApi, type DataSource } from '../src/server/api.js';
import { briefToSpeech, buildMorningBrief } from '../src/ops/morningBrief.js';
import type { BookingAgentResult } from '../src/agents/bookingAgent.js';

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const empty: DataSource = { ready: () => true, stopsBetween: async () => [], newLeads: async () => [], calendarEvents: async () => [] };

describe('H4 — the schedule says whose bookings it is', () => {
  it('the brief names its source: Arbo’s tables only, the Google Calendar not read', async () => {
    const r = await createApi(empty).brief('2026-10-20T04:00:00Z', '2026-10-21T04:00:00Z');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ scheduleSource: 'arbo_tables_only', calendarRead: false });
  });

  it('/api/calendar no longer calls Arbo’s tables a Google Calendar mirror', async () => {
    const r = await createApi(empty).calendar('2026-10-20T04:00:00Z', '2026-10-27T04:00:00Z');
    expect(r.body).toMatchObject({ source: 'arbo_tables_only', calendarRead: false });
    const api = src('src/server/api.ts');
    expect(api).not.toContain("'google_calendar_mirror'");
    expect(api).not.toContain('mirrored hourly');
    expect(src('src/db/repositories.ts')).not.toContain('These rows are the mirror the hourly sweep keeps');
  });

  it('storm "stops at risk" says it checked Arbo’s bookings only', async () => {
    const alerts = { activeAlerts: async () => [{ id: 'a', event: 'SIM Severe Thunderstorm Warning', severity: 'Severe', headline: null, onset: null, ends: null, cities: ['Norfolk' as const] }] };
    const r = await createApi(empty, { alerts: alerts as never }).storm();
    expect(r.body).toMatchObject({ atRisk: [], atRiskScope: 'arbo_tables_only', calendarRead: false });
  });

  it('the spoken brief never says "Nothing on the books today" over a calendar it does not read', () => {
    const none = briefToSpeech(buildMorningBrief([]));
    expect(none).not.toContain('Nothing on the books today');
    expect(none).toContain("Nothing booked in Arbo today — your Google Calendar isn't read here");
    expect(briefToSpeech(buildMorningBrief([{ id: '1', kind: 'job', address: 'x', city: 'Norfolk', timeIso: '2026-10-20T13:00:00Z', name: 'SIM-A' }]))).toContain("1 stop today in Arbo's bookings");
  });

  it('the booking agent names its scope, and its finding never reads as "his day has no clash"', () => {
    const r: BookingAgentResult = { agent: 'booking', stopsChecked: 0, issues: 0, newlyRaised: 0, llm: 'not_configured', status: 'ok', scope: 'arbo_tables_only' };
    expect(r.scope).toBe('arbo_tables_only');
    expect(src('src/agents/bookingAgent.ts')).toContain('scope=arbo_tables_only calendar_not_read');
    const sections = src('src/agents/sections.ts');
    expect(sections).toContain("in Arbo's own bookings tomorrow — your Google Calendar is not read here, so a clash there would not show.");
    expect(sections).not.toContain("? [{ severity: 'act', text: `${plural(r.issues, 'booking issue', 'booking issues')} on tomorrow's route (double-booked slot or ZIP-run break).` }]");
  });

  it('Today: no confident empty day — a named gap with the Calendar one tap away, and the schedule chip is a warning', () => {
    const html = src('src/app/index.html').replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    expect(html).toContain("const onlyArbo = brief.scheduleSource === 'arbo_tables_only';");
    expect(html).toContain("state('No bookings in Arbo today', 'Arbo only sees bookings made in Arbo — your Google Calendar isn’t read here, so your real day may not be empty.')");
    expect(html).toContain("sysSet('schedule', onlyArbo ? 'warn' : 'ok', onlyArbo ? s.totalStops + ' in Arbo · Calendar not read' : s.totalStops + ' stops');");
    expect(html).toContain("if (s.atRiskScope === 'arbo_tables_only' && !s.atRiskUnread)");
  });

  // Lane B verification: the card under them said "No bookings in Arbo today",
  // but the top numbers still read "0 stops today", "0 jobs today" and
  // "0 estimates today" — the confident zero, one line higher.
  it('Today’s top numbers say "in Arbo" too — never "0 stops today" / "0 jobs today" over a calendar Arbo does not read', () => {
    const html = src('src/app/index.html').replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    const fill = html.slice(html.indexOf("const onlyArbo = brief.scheduleSource === 'arbo_tables_only';"), html.indexOf('if (s.zipRun && s.zipRun.length) {'));
    expect(fill).toContain("if (onlyArbo) { jobsTile.querySelector('span').textContent = 'jobs in Arbo'; estTile.querySelector('span').textContent = 'estimates in Arbo'; }");
    expect(fill).toContain("plural(s.totalStops, 'stop') + (onlyArbo ? ' in Arbo today' : ' today')");
    expect(fill).not.toContain("plural(s.totalStops, 'stop') + ' today'");
    // The relabel runs before the numbers land, so a 0 is never shown under "today".
    expect(fill.indexOf("'jobs in Arbo'")).toBeLessThan(fill.indexOf('setTile(jobsTile, s.jobs || 0)'));
  });

  it('Talk says the same out loud', () => {
    const talk = src('src/voice/ownerTalk.ts');
    expect(talk).toContain("Today's stops: none booked in Arbo. Your Google Calendar isn't read here, so that is not an empty day — check the calendar.");
    expect(talk).toContain("Stops inside the alert were checked against Arbo's own bookings only — your Google Calendar isn't read here.");
  });
});
