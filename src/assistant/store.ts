// R28: what the assistant must not forget across a redeploy — the approvals
// waiting on Mike, the last 300 things it did, the Quo events it already
// started a session for (so one event never starts two), the sessions it is
// still watching, the triggers queued behind the three-at-once cap, the days
// the daily office check ran or was missed and its latest report, and which
// way each recent Quo call went (id and direction only — never who called).
//
// Same shape as the Learn desk's LessonBook and the Google token store: one
// JSON file on the storage disk (ARBO_SECRET_DIR, else /data), written
// atomically, owner-only (0600 — approvals carry customer contact, R17). No
// disk means memory only, and the status SAYS so.
//
// A file that exists but cannot be read is NOT treated as empty: forgetting
// which events were handled would start a second session for each of them.
// The store is marked unreadable, nothing starts, the routes answer 503
// 'unreadable', and the file is never overwritten (§1B, fail closed).
//
// This is Arbo's own working memory on its own disk — not the database, and
// not business data imported into Arbo (§3): the data links stay cut.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApprovalDetail, ApprovalKind } from './describe.js';

export type Trigger = 'quo' | 'sweep' | 'route' | 'office';

export interface Approval {
  /** The sevt_ id of the paused agent.tool_use / agent.mcp_tool_use event. */
  id: string;
  sessionId: string;
  tool: string;
  kind: ApprovalKind;
  summary: string;
  details: ApprovalDetail[];
  requestedAt: string;
}

export interface StoredApproval extends Approval {
  /** A text's recipients as the call names them — for the quiet-hours check at Allow. Never logged, never sent to the app. */
  textTo?: string[];
  decided: null | {
    decision: 'allow' | 'deny';
    at: string;
    /** 'mike' = from the Arbo app; 'elsewhere' = the session shows it was answered another way (e.g. the Console). */
    by: 'mike' | 'elsewhere';
    note?: string;
  };
}

/** 'info' = Arbo's own note that is not a problem (e.g. back in touch with a session). */
export type ActivityKind = 'started' | 'tool' | 'waiting' | 'decided' | 'message' | 'done' | 'error' | 'info';

export interface ActivityItem {
  at: string;
  sessionId: string;
  kind: ActivityKind;
  text: string;
  tool?: string;
  permission?: 'allow' | 'ask' | 'deny';
}

export interface SessionRec {
  id: string;
  trigger: Trigger;
  /** e.g. 'quo text' — kind only, never a customer detail. */
  label: string;
  startedAt: string;
  /** working = the agent is running; waiting = parked on Mike's approval; done / error = finished. */
  state: 'working' | 'waiting' | 'done' | 'error';
  /** Ids of events already acted on, so a re-attach never repeats an activity line. */
  seen: string[];
  /** The dedupe key it was started for (e.g. 'quo:message:AC…', 'office:2026-10-20') — ids and dates only. */
  key?: string;
  /** Last 10 digits of the customer whose own text or call started it — a reply to them within the hour is not held by quiet hours. */
  replyTo?: string;
  /** When that text or call came in (Quo's own time) — the hour runs from here. */
  replyToAt?: string;
}

export interface QueuedTrigger {
  key: string;
  trigger: Trigger;
  label: string;
  title: string;
  message: string;
  queuedAt: string;
  /** Set (and saved) just before each create: a create whose answer was lost is looked up by its key before another is made. */
  triedAt?: string;
  /** Carried onto the session — see SessionRec.replyTo / replyToAt. */
  replyTo?: string;
  replyToAt?: string;
}

/** The office check's last words for the day — kept apart from Activity, which a busy morning scrolls past. */
export interface OfficeReport {
  /** ET date (YYYY-MM-DD) of the check. */
  day: string;
  at: string;
  text: string;
}

/** Which way a Quo call went, so Mike's own call out still starts nothing after a redeploy. */
export interface CallDirection {
  id: string;
  direction: string;
}

export interface AssistantState {
  version: 1;
  approvals: StoredApproval[];
  activity: ActivityItem[];
  /** Dedupe keys of every Quo event / call / text / sweep / route already started or queued. */
  processed: string[];
  sessions: SessionRec[];
  queue: QueuedTrigger[];
  lastSweepAt: string | null;
  /** ET date (YYYY-MM-DD) of the last 6:30 crew-route session. */
  lastRouteDay: string | null;
  /** ET date of the last daily office check queued (7am, Mon–Sat). */
  lastOfficeDay: string | null;
  /** ET date whose office check was named as missed — so it is said once. */
  officeMissedDay: string | null;
  officeReport: OfficeReport | null;
  /** Newest last; the last CALLS_KEEP. */
  callDirections: CallDirection[];
  lastEventAt: string | null;
}

export const ACTIVITY_CAP = 300;
const PROCESSED_CAP = 2000;
const DECIDED_KEEP = 200;
const FINISHED_SESSIONS_KEEP = 50;
const SEEN_CAP = 1000;
const CALLS_KEEP = 500;
const FILE = 'assistant.json';

const fresh = (): AssistantState => ({
  version: 1,
  approvals: [],
  activity: [],
  processed: [],
  sessions: [],
  queue: [],
  lastSweepAt: null,
  lastRouteDay: null,
  lastOfficeDay: null,
  officeMissedDay: null,
  officeReport: null,
  callDirections: [],
  lastEventAt: null,
});

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const reportOf = (v: unknown): OfficeReport | null => {
  const r = v as Partial<OfficeReport> | null;
  return r && typeof r === 'object' && typeof r.day === 'string' && typeof r.at === 'string' && typeof r.text === 'string' ? { day: r.day, at: r.at, text: r.text } : null;
};

export class AssistantStore {
  data: AssistantState = fresh();
  /** 'unknown' until the first write tells us whether the disk takes it. */
  where: 'unknown' | 'disk' | 'memory' = 'unknown';
  /** Why the file could not be read — null when it was read, or did not exist yet. */
  unreadable: string | null = null;

  constructor(private readonly dir: string = process.env.ARBO_SECRET_DIR ?? '/data') {
    let raw: string;
    try {
      raw = readFileSync(join(dir, FILE), 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // No file yet (or no disk at all): a first boot, nothing was handled.
      if (code === 'ENOENT' || code === 'ENOTDIR') return;
      this.unreadable = `could not open ${FILE}: ${code ?? 'error'}`;
      return;
    }
    try {
      const p = JSON.parse(raw) as Record<string, unknown>;
      if (typeof p !== 'object' || p === null || Array.isArray(p)) throw new Error('not an object');
      this.data = {
        version: 1,
        approvals: arr<StoredApproval>(p.approvals),
        activity: arr<ActivityItem>(p.activity),
        processed: arr<string>(p.processed),
        sessions: arr<SessionRec>(p.sessions).map((s) => ({ ...s, seen: arr<string>(s.seen) })),
        queue: arr<QueuedTrigger>(p.queue),
        lastSweepAt: strOrNull(p.lastSweepAt),
        lastRouteDay: strOrNull(p.lastRouteDay),
        lastOfficeDay: strOrNull(p.lastOfficeDay),
        officeMissedDay: strOrNull(p.officeMissedDay),
        officeReport: reportOf(p.officeReport),
        callDirections: arr<CallDirection>(p.callDirections).filter((c) => c && typeof c.id === 'string' && typeof c.direction === 'string'),
        lastEventAt: strOrNull(p.lastEventAt),
      };
      this.where = 'disk';
    } catch {
      this.unreadable = `${FILE} is not valid JSON`;
    }
  }

  /** Trim to the caps, then write atomically, owner-only. Never over an unreadable file. */
  save(): void {
    if (this.unreadable) return;
    const d = this.data;
    if (d.activity.length > ACTIVITY_CAP) d.activity = d.activity.slice(-ACTIVITY_CAP);
    if (d.processed.length > PROCESSED_CAP) d.processed = d.processed.slice(-PROCESSED_CAP);
    if (d.callDirections.length > CALLS_KEEP) d.callDirections = d.callDirections.slice(-CALLS_KEEP);
    const decided = d.approvals.filter((a) => a.decided);
    if (decided.length > DECIDED_KEEP) {
      const drop = new Set(decided.slice(0, decided.length - DECIDED_KEEP).map((a) => a.id));
      d.approvals = d.approvals.filter((a) => !drop.has(a.id));
    }
    // A finished session with an approval still waiting is kept whole: Mike's
    // decision re-attaches to it, and its seen ids stop a replay repeating lines.
    // Today's office check is never trimmed: Today reads its state from it,
    // and a busy day must not turn "done" into "could not start" (§1B).
    const pending = new Set(d.approvals.filter((a) => !a.decided).map((a) => a.sessionId));
    const todaysOffice = d.lastOfficeDay ? `office:${d.lastOfficeDay}` : null;
    const finished = d.sessions.filter((s) => s.state === 'done' || s.state === 'error');
    for (const s of finished) if (!pending.has(s.id)) s.seen = [];
    if (finished.length > FINISHED_SESSIONS_KEEP) {
      const drop = new Set(finished.slice(0, finished.length - FINISHED_SESSIONS_KEEP).filter((s) => !pending.has(s.id) && s.key !== todaysOffice).map((s) => s.id));
      d.sessions = d.sessions.filter((s) => !drop.has(s.id));
    }
    for (const s of d.sessions) if (s.seen.length > SEEN_CAP) s.seen = s.seen.slice(-SEEN_CAP);
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = join(this.dir, `${FILE}.tmp`);
      writeFileSync(tmp, JSON.stringify(d), { mode: 0o600 });
      renameSync(tmp, join(this.dir, FILE));
      this.where = 'disk';
    } catch {
      this.where = 'memory';
    }
  }
}
