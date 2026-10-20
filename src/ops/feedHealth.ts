// GET /health/feeds — every feed Arbo depends on, its NAMED state, and when
// it last worked (audit M14, 2026-10-20). Before this, /health answered 200
// "ok" through a week-long Google outage, and nobody was told anything had
// died until Mike happened to open the app.
//
// Owner key only (the states name what is down; the route itself carries no
// customer data — counts, times and reasons only, §4.3). It answers 503 when
// any feed is DOWN, so an outside uptime monitor watching it can page Mike.
// Which monitor, and where it pages, is Mike's call (docs/GO_LIVE.md): Arbo
// itself sends nothing.
//
// The states, and §1B in each of them:
//   ok       — read cleanly on its last try
//   degraded — read, but something is missing and named (a cap, a gap, a retry)
//   down     — could not read, or cannot even try (a missing sign-in) — pages
//   waiting  — nothing to judge yet (a feed that runs on demand, a first pass
//              not finished) — never shown as ok
//   off      — switched off on purpose (Mike's switch) — named, never ok

import type { InboxWatchResult, InboxWatchState } from './inboxWatch.js';
import type { QuoIntake } from './quoIntake.js';
import type { QuoStudy } from './quoStudy.js';
import type { AlertsProvider } from './stormWatch.js';
import type { PositionsState } from '../integrations/bouncie.js';

export type FeedState = 'ok' | 'degraded' | 'down' | 'waiting' | 'off';

export interface FeedLine {
  feed: string;
  label: string;
  state: FeedState;
  /** Plain words: why this state. Never a number, a name or a message. */
  detail: string;
  /** When it last worked — null = not since Arbo last restarted (or never). */
  lastGoodAt: string | null;
}

export interface FeedHealth {
  ok: boolean;
  checkedAt: string;
  /** The feeds that are down, by id — what a monitor alert should say. */
  down: string[];
  feeds: FeedLine[];
  note: string;
}

/** The last outcome of an on-demand feed, kept by trackedAlerts below. */
export interface FeedLog {
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

export interface FeedInputs {
  gmail: { configured: boolean; started: boolean; last: InboxWatchResult | null; state: InboxWatchState | null };
  /**
   * readOnly (R33, Mike 2026-10-20: "Connect Google as a read only"): holds
   * are OFF on purpose — named 'off', never 'down' (it must not page) and
   * never 'waiting' (nothing will ever come). Absent = holds may be made.
   */
  holds: { configured: boolean; readOnly?: boolean };
  quo: { configured: boolean; status: ReturnType<QuoIntake['status']> | null };
  study: ReturnType<QuoStudy['status']> | null;
  storm: FeedLog | null;
  bouncie: { state: PositionsState; readAt: string | null } | null;
}

/** Wrap the NWS provider so its last good read and last failure are known (M14). Same answers, same throws. */
export function trackedAlerts(inner: AlertsProvider, log: FeedLog, now: () => number = () => Date.now()): AlertsProvider {
  return {
    async activeAlerts() {
      try {
        const a = await inner.activeAlerts();
        log.lastOkAt = new Date(now()).toISOString();
        return a;
      } catch (err) {
        log.lastErrorAt = new Date(now()).toISOString();
        log.lastError = err instanceof Error ? err.message : 'error';
        throw err;
      }
    },
  };
}

const later = (a: string | null, b: string | null): boolean => a !== null && (b === null || a > b);

export function buildFeedHealth(i: FeedInputs, now: Date): FeedHealth {
  const feeds: FeedLine[] = [];
  const add = (f: FeedLine) => feeds.push(f);

  // Gmail — the five-minute inbox watch.
  {
    const g = i.gmail;
    const lastGoodAt = g.state?.lastGoodReadAt ?? null;
    if (!g.configured) add({ feed: 'gmail', label: 'Gmail (inbox watch)', state: 'down', detail: 'No Google sign-in on the server — Arbo cannot read Gmail. Settings → Reconnect Google.', lastGoodAt });
    else if (!g.started || !g.last) add({ feed: 'gmail', label: 'Gmail (inbox watch)', state: 'waiting', detail: 'The inbox watch has not finished a pass yet.', lastGoodAt });
    else if (g.last.status === 'unavailable') add({ feed: 'gmail', label: 'Gmail (inbox watch)', state: 'down', detail: `Gmail could not be read${g.state?.unavailableSince ? ` since ${g.state.unavailableSince}` : ''} (${g.last.reason ?? 'no reason given'}). Not zero mail.`, lastGoodAt });
    else if (g.state?.gap) add({ feed: 'gmail', label: 'Gmail (inbox watch)', state: 'degraded', detail: `Reading, but mail Arbo knows it has not read: ${g.state.gap.why} (to ${g.state.gap.toIso}). Catch up in the app.`, lastGoodAt });
    else if (g.last.status === 'degraded') add({ feed: 'gmail', label: 'Gmail (inbox watch)', state: 'degraded', detail: 'Reading, but a mailbox or a known sender could not be read — named on the last pass.', lastGoodAt });
    else add({ feed: 'gmail', label: 'Gmail (inbox watch)', state: 'ok', detail: 'Read on the last pass.', lastGoodAt });
  }

  // Google Calendar — Sona's R18 holds (create only).
  {
    const log = i.quo.status?.feedLog ?? null;
    const lastGoodAt = log?.holdFiledAt ?? null;
    if (i.holds.readOnly) add({ feed: 'calendar_holds', label: 'Google Calendar (Sona’s holds)', state: 'off', detail: 'Off on purpose — Google is connected read-only (R33, Mike 2026-10-20), so Arbo files no holds. Sona’s requested time shows on each call card for you to book. Not a failure, not zero holds.', lastGoodAt });
    else if (!i.holds.configured) add({ feed: 'calendar_holds', label: 'Google Calendar (Sona’s holds)', state: 'down', detail: 'No Google sign-in on the server — no calendar hold can be filed. Not zero holds.', lastGoodAt });
    else if (log && later(log.holdFailedAt, log.holdFiledAt)) add({ feed: 'calendar_holds', label: 'Google Calendar (Sona’s holds)', state: 'down', detail: `The last hold FAILED (${log.holdError ?? 'error'}) — it is not on the calendar. Book it yourself; check Settings → Reconnect Google.`, lastGoodAt });
    else if (!lastGoodAt) add({ feed: 'calendar_holds', label: 'Google Calendar (Sona’s holds)', state: 'waiting', detail: 'No hold has been needed since Arbo last restarted — nothing to judge yet.', lastGoodAt });
    else add({ feed: 'calendar_holds', label: 'Google Calendar (Sona’s holds)', state: 'ok', detail: 'The last hold reached the calendar.', lastGoodAt });
  }

  // Quo — webhooks, Quo's own record, and the model that reads Sona's calls.
  {
    const st = i.quo.status;
    if (!i.quo.configured || !st) {
      add({ feed: 'quo_webhooks', label: 'Quo (Sona’s calls pushed to Arbo)', state: 'down', detail: 'No QUO_API_KEY on the server — Sona’s calls are not reaching Arbo. Not zero calls.', lastGoodAt: null });
      add({ feed: 'quo_record', label: 'Quo (calls read from Quo’s record)', state: 'down', detail: 'No QUO_API_KEY on the server.', lastGoodAt: null });
      add({ feed: 'sona_reading', label: 'Reading Sona’s calls (AI model)', state: 'down', detail: 'No Quo, so no calls to read.', lastGoodAt: null });
    } else {
      const reg = st.registration;
      // R33: 'read_only' = a webhook Quo lacks that Arbo won't create while Quo is
      // read-only — off on purpose, named in R33's own words, never 'down' (no page).
      const regState: FeedState = reg.state === 'ok' ? 'ok' : reg.state === 'pending' ? 'waiting' : reg.state === 'read_only' ? 'off' : 'down';
      add({ feed: 'quo_webhooks', label: 'Quo (Sona’s calls pushed to Arbo)', state: regState, detail: reg.state === 'ok' ? 'Registered with Quo.' : reg.state === 'read_only' ? reg.detail : `${reg.state === 'pending' ? 'Registering with Quo.' : 'Not wired to Quo.'}${reg.retryAt ? ` Arbo tries again at ${reg.retryAt}.` : ''}`, lastGoodAt: st.lastAt });
      const rec = st.quoRecord;
      const recState: FeedState = rec.error ? 'down' : !rec.lastAt ? 'waiting' : rec.unreadable || (rec.weekThreadsNotRead ?? 0) > 0 ? 'degraded' : 'ok';
      add({ feed: 'quo_record', label: 'Quo (calls read from Quo’s record)', state: recState, detail: rec.error ? `Could not read Quo’s record (${rec.error}).` : !rec.lastAt ? 'First read not finished yet.' : rec.unreadable ? `Read, but ${rec.unreadable}.` : (rec.weekThreadsNotRead ?? 0) > 0 ? `Read, but ${rec.weekThreadsNotRead} older customer thread(s) of the week were past the cap.` : 'Read on the last pass.', lastGoodAt: rec.lastOkAt });
      const readState: FeedState = !st.reading ? 'down' : st.readsRetrying > 0 ? 'degraded' : 'ok';
      add({ feed: 'sona_reading', label: 'Reading Sona’s calls (AI model)', state: readState, detail: !st.reading ? `No model key — Sona’s calls are kept but not read${st.holds === 'read_only' ? ', so a rule slip can be missed' : ', and no hold is filed'}.` : st.readsRetrying > 0 ? `${st.readsRetrying} call(s) could not be read yet — retrying.` : 'Reading.', lastGoodAt: st.feedLog.readOkAt });
    }
  }

  // The R24 study and the assistant's Drive lead logs.
  {
    const s = i.study;
    if (!s) {
      add({ feed: 'quo_study', label: 'Customer study (Quo threads)', state: 'down', detail: 'No QUO_API_KEY on the server — no customer notes. Not zero customers.', lastGoodAt: null });
      add({ feed: 'drive_lead_logs', label: 'Drive lead logs', state: 'down', detail: 'Read with the customer study, which is not running.', lastGoodAt: null });
    } else {
      const studyState: FeedState = s.quoError || !s.reading ? 'down' : !s.lastAt ? 'waiting' : s.threadsInWindow !== null && s.threadsStudied !== null && s.threadsInWindow > s.threadsStudied ? 'degraded' : 'ok';
      add({ feed: 'quo_study', label: 'Customer study (Quo threads)', state: studyState, detail: s.quoError ? `Could not read Quo (${s.quoError}).` : !s.reading ? 'No model key — no customer notes.' : !s.lastAt ? 'First read not finished yet.' : studyState === 'degraded' ? `Read the ${s.threadsStudied} most recent of ${s.threadsInWindow} customer threads.` : 'Read on the last pass.', lastGoodAt: s.lastOkAt });
      add({ feed: 'drive_lead_logs', label: 'Drive lead logs', state: s.driveError ? 'down' : !s.lastAt ? 'waiting' : 'ok', detail: s.driveError ? `Not read (${s.driveError}).` : !s.lastAt ? 'First read not finished yet.' : `${s.driveFiles} file(s) read.`, lastGoodAt: s.driveOkAt });
    }
  }

  // NWS storm alerts — read when a screen or an agent asks.
  {
    const l = i.storm;
    if (!l) add({ feed: 'nws_storm', label: 'Storm alerts (National Weather Service)', state: 'down', detail: 'No weather feed configured.', lastGoodAt: null });
    else if (later(l.lastErrorAt, l.lastOkAt)) add({ feed: 'nws_storm', label: 'Storm alerts (National Weather Service)', state: 'down', detail: `The last read failed (${l.lastError ?? 'error'}). Not clear skies.`, lastGoodAt: l.lastOkAt });
    else if (!l.lastOkAt) add({ feed: 'nws_storm', label: 'Storm alerts (National Weather Service)', state: 'waiting', detail: 'Read when a screen or an agent asks — not asked since Arbo last restarted.', lastGoodAt: null });
    else add({ feed: 'nws_storm', label: 'Storm alerts (National Weather Service)', state: 'ok', detail: 'The last read worked.', lastGoodAt: l.lastOkAt });
  }

  // Bouncie — built dormant (R31): off until Mike switches it on.
  {
    const b = i.bouncie;
    const state: FeedState = !b || b.state === 'keys_missing' || b.state === 'link_cut' ? 'off' : b.state === 'ok' || b.state === 'no_trucks' ? 'ok' : 'down';
    add({ feed: 'bouncie', label: 'Truck positions (Bouncie)', state, detail: !b ? 'Not set up.' : b.state === 'link_cut' ? 'Cut on purpose (ARBO_LINK_BOUNCIE is not "live").' : b.state === 'keys_missing' ? 'Not set up on the server.' : b.state === 'ok' ? 'Read.' : b.state === 'no_trucks' ? 'Bouncie answered with no trucks.' : `Not readable (${b.state}).`, lastGoodAt: b?.readAt ?? null });
  }

  const down = feeds.filter((f) => f.state === 'down').map((f) => f.feed);
  return {
    ok: down.length === 0,
    checkedAt: now.toISOString(),
    down,
    feeds,
    note: 'In-memory since Arbo last restarted except Gmail’s last good read (kept on the storage disk). 503 means a feed is DOWN — the outside monitor that watches this, and where it pages, is Mike’s choice (docs/GO_LIVE.md). Arbo itself sends nothing.',
  };
}
