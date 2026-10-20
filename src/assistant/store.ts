// R28: what the assistant must not forget across a redeploy — the approvals
// waiting on Mike, the last 300 things it did, the Quo events it already
// started a session for (so one event never starts two), the sessions it is
// still watching, and the triggers queued behind the three-at-once cap.
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

export type Trigger = 'quo' | 'sweep' | 'route';

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
  decided: null | {
    decision: 'allow' | 'deny';
    at: string;
    /** 'mike' = from the Arbo app; 'elsewhere' = the session shows it was answered another way (e.g. the Console). */
    by: 'mike' | 'elsewhere';
    note?: string;
  };
}

export type ActivityKind = 'started' | 'tool' | 'waiting' | 'decided' | 'message' | 'done' | 'error';

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
}

export interface QueuedTrigger {
  key: string;
  trigger: Trigger;
  label: string;
  title: string;
  message: string;
  queuedAt: string;
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
  lastEventAt: string | null;
}

export const ACTIVITY_CAP = 300;
const PROCESSED_CAP = 2000;
const DECIDED_KEEP = 200;
const FINISHED_SESSIONS_KEEP = 50;
const SEEN_CAP = 1000;
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
  lastEventAt: null,
});

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

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
    const decided = d.approvals.filter((a) => a.decided);
    if (decided.length > DECIDED_KEEP) {
      const drop = new Set(decided.slice(0, decided.length - DECIDED_KEEP).map((a) => a.id));
      d.approvals = d.approvals.filter((a) => !drop.has(a.id));
    }
    // A finished session with an approval still waiting is kept whole: Mike's
    // decision re-attaches to it, and its seen ids stop a replay repeating lines.
    const pending = new Set(d.approvals.filter((a) => !a.decided).map((a) => a.sessionId));
    const finished = d.sessions.filter((s) => s.state === 'done' || s.state === 'error');
    for (const s of finished) if (!pending.has(s.id)) s.seen = [];
    if (finished.length > FINISHED_SESSIONS_KEEP) {
      const drop = new Set(finished.slice(0, finished.length - FINISHED_SESSIONS_KEEP).filter((s) => !pending.has(s.id)).map((s) => s.id));
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
