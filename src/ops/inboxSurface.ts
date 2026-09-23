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
// The SURFACED-MAIL store: what the intent engine decided, held for the app.
//
// ═══ R17 — WHY THERE IS CUSTOMER DATA IN THIS FILE ═══
// Mike's ruling (2026-09-23) overrides presence-only FOR THE APP UI: a
// surfaced card carries the customer's name, phone, and ZIP so he can act
// from the Today screen. The boundary MOVED, it did not fall: everything
// here is served ONLY through keywall-gated /api/inbox/* routes, and
// NOTHING here may cross into a log line, a chat reply, or the watch's own
// report — those stay counts-and-ids (§4.3). There is deliberately no
// toString/log helper on this store.
//
// ═══ IN MEMORY, BOUNDED, HONESTLY EPHEMERAL ═══
// Links are cut (§3): nothing is written anywhere. A redeploy empties the
// store and the UI says so rather than rendering empty-as-quiet (§1B).
// `ignored` means NOT SHOWN by default — the log keeps every entry (id +
// one redacted line) so misses can be reviewed. Nothing is ever deleted
// from Gmail by anything in this codebase.

export interface SurfacedItem {
  messageId: string;
  threadId: string | null;
  intent: string;
  intentLabel: string;
  confidence: 'high' | 'maybe';
  receivedAtIso: string;
  /** One redacted line: why this lane. */
  reason: string;
  /** R17 fields — app UI only, never logs. */
  name?: string;
  phone?: string;
  email?: string;
  zip?: string;
  address?: string;
  details?: string;
  source?: string;
  /** Link into Gmail so one tap lands on the real thread. */
  gmailLink: string | null;
  subjectHint?: string;
  /** True on contract_approval — the card prompts the estimate→job step. */
  contractApproval?: boolean;
  /** The verdict came from patterns alone (model was unreachable). */
  modelUnavailable?: boolean;
}

export interface IgnoredEntry {
  messageId: string;
  threadId: string | null;
  reason: string;
  receivedAtIso: string;
}

export interface DayCounts {
  read: number;
  surfaced: number;
  maybe: number;
  ignored: number;
}

const SURFACED_CAP = 100;
const MAYBE_CAP = 100;
const IGNORED_CAP = 300;
const COUNTER_DAYS = 14;

const ET_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: 'numeric',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function etParts(now: Date): { dateKey: string; weekday: string; hour: number } {
  const parts = ET_DAY.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'),
    hour: Number(get('hour')) % 24,
  };
}

export class InboxSurfaceStore {
  private readonly surfaced: SurfacedItem[] = [];
  private readonly maybe: SurfacedItem[] = [];
  private readonly ignored: IgnoredEntry[] = [];
  /** ET date key → counts. Insertion-ordered; oldest day evicted first. */
  private readonly counters = new Map<string, DayCounts>();

  private day(now: Date): DayCounts {
    const { dateKey } = etParts(now);
    let c = this.counters.get(dateKey);
    if (!c) {
      c = { read: 0, surfaced: 0, maybe: 0, ignored: 0 };
      this.counters.set(dateKey, c);
      while (this.counters.size > COUNTER_DAYS) {
        const oldest = this.counters.keys().next().value;
        if (oldest === undefined) break;
        this.counters.delete(oldest);
      }
    }
    return c;
  }

  /** Every examined thread bumps `read`, whatever lane it lands in. */
  countRead(now: Date): void {
    this.day(now).read++;
  }

  addSurfaced(item: SurfacedItem, now: Date): void {
    this.push(this.surfaced, item, SURFACED_CAP);
    this.day(now).surfaced++;
  }

  addMaybe(item: SurfacedItem, now: Date): void {
    this.push(this.maybe, item, MAYBE_CAP);
    this.day(now).maybe++;
  }

  addIgnored(entry: IgnoredEntry, now: Date): void {
    this.push(this.ignored, entry, IGNORED_CAP);
    this.day(now).ignored++;
  }

  /** Mike re-labeled a thread: pull every copy out of both visible lanes.
   *  (The re-classified item is re-added by the orchestrator.) */
  removeThread(threadId: string): void {
    for (const list of [this.surfaced, this.maybe]) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i]!.threadId === threadId) list.splice(i, 1);
      }
    }
  }

  private push<T>(list: T[], item: T, cap: number): void {
    list.unshift(item); // newest first — that is how the UI reads them
    while (list.length > cap) list.pop();
  }

  /**
   * The zero-surfaced tripwire (prompt §5): a normal weekday afternoon with
   * NOTHING surfaced is itself a finding. Only fires when the pipeline could
   * actually look — an unavailable Gmail already screams louder (§1B), and
   * stacking this flag on top would blame the classifier for a dead feed.
   */
  zeroSurfacedFlag(now: Date, gmailReadable: boolean): string | null {
    if (!gmailReadable) return null;
    const { weekday, hour } = etParts(now);
    if (weekday === 'Sat' || weekday === 'Sun') return null;
    if (hour < 12) return null;
    const today = this.day(now);
    if (today.surfaced > 0) return null;
    return 'Nothing surfaced yet today — on a normal weekday that is itself worth a look.';
  }

  snapshot(now: Date): {
    surfaced: SurfacedItem[];
    maybe: SurfacedItem[];
    ignored: IgnoredEntry[];
    today: DayCounts;
  } {
    return {
      surfaced: [...this.surfaced],
      maybe: [...this.maybe],
      ignored: [...this.ignored],
      today: { ...this.day(now) },
    };
  }
}
