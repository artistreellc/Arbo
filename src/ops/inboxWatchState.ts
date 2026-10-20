// The inbox watch's memory across restarts (audit M12, 2026-10-20): when it
// last read Gmail cleanly, since when Gmail has been unreadable, and any mail
// it knows it did not read. Timestamps and a reason code only — never a
// message, an id, a sender or a subject (§3: nothing imported; §4.3).
//
// Kept on the storage disk beside the Google sign-in (default /data), so a
// deploy in the middle of a Gmail outage does not forget the outage. With no
// disk it lives in memory, and a restart reads as "no record" — named on the
// screen, never as a clean inbox.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InboxGap, InboxStateStore, InboxWatchState } from './inboxWatch.js';

const FILE = 'inbox-watch.json';
const WHY = new Set<InboxGap['why']>(['older_than_catchup', 'catchup_capped', 'no_record']);
const isoOrNull = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

/** Only a well-formed state is believed; anything else is "no record" (and the screen says so). */
export function parseInboxState(raw: unknown): InboxWatchState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const g = o.gap && typeof o.gap === 'object' ? (o.gap as Record<string, unknown>) : null;
  const gap: InboxGap | null = g && WHY.has(g.why as InboxGap['why']) && isoOrNull(g.toIso)
    ? { fromIso: isoOrNull(g.fromIso), toIso: isoOrNull(g.toIso)!, why: g.why as InboxGap['why'] }
    : null;
  return { lastGoodReadAt: isoOrNull(o.lastGoodReadAt), unavailableSince: isoOrNull(o.unavailableSince), gap };
}

export class InboxStateFile implements InboxStateStore {
  private mem: InboxWatchState | null = null;
  constructor(private readonly dir: string = process.env.ARBO_SECRET_DIR ?? '/data') {}

  load(): InboxWatchState | null {
    try {
      this.mem = parseInboxState(JSON.parse(readFileSync(join(this.dir, FILE), 'utf8')));
    } catch {
      /* no file yet, or no disk */
    }
    return this.mem;
  }

  save(s: InboxWatchState): void {
    this.mem = { ...s };
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = join(this.dir, `${FILE}.tmp`);
      writeFileSync(tmp, JSON.stringify(s));
      renameSync(tmp, join(this.dir, FILE));
    } catch (err) {
      // Said once, not every five minutes: memory only, so a restart reads as "no record".
      if (!this.warned) console.error('[inbox] watch state kept in memory only — no storage disk:', err instanceof Error ? err.name : 'error');
      this.warned = true;
    }
  }

  private warned = false;
}
