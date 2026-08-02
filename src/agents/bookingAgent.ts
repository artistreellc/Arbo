// Agent #2 — Booking / Dispatch (brief §8A.5, upgraded to Opus in the brief's
// own audit). Deterministic core: reads tomorrow's booked day the way Mike
// will live it and flags what the booking brain's rules say is wrong —
// double-booked slots and stops that break the ZIP run (§3.11). Recommends
// only; it never moves an event (suggest-Mike-approves is calendar law §3.22).

import { startAgentRun } from '../binder/agentRun.js';
import { emitSafe } from '../binder/eventBus.js';
import { getDb, hasDb } from '../db/client.js';
import { env } from '../env.js';

export interface BookingIssue {
  key: string; // stable dedupe key
  kind: 'double_booked' | 'zip_run_break';
  stopIds: string[];
  line: string; // admin-only human line, no PII beyond what the admin app already shows
}

export interface BookingStopInput {
  id: string;
  timeIso: string | null;
  zip: string | null;
}

/** Pure rules — testable without a database. */
export function findBookingIssues(stops: BookingStopInput[], dayLabel: string): BookingIssue[] {
  const issues: BookingIssue[] = [];

  // Double-booked: two stops sharing the same start time.
  const byTime = new Map<string, BookingStopInput[]>();
  for (const s of stops) {
    if (!s.timeIso) continue;
    const k = s.timeIso;
    byTime.set(k, [...(byTime.get(k) ?? []), s]);
  }
  for (const [time, group] of byTime) {
    if (group.length > 1) {
      issues.push({
        key: `double_booked:${dayLabel}:${time}:${group.map((g) => g.id).sort().join(',')}`,
        kind: 'double_booked',
        stopIds: group.map((g) => g.id),
        line: `${group.length} stops share the same ${new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} slot — one of them needs to move.`,
      });
    }
  }

  // ZIP-run break (§3.11: work a ZIP dry): flag when the day bounces between
  // more than two ZIPs AND some ZIP appears non-contiguously in time order.
  const timed = stops.filter((s) => s.timeIso && s.zip).sort((a, b) => a.timeIso!.localeCompare(b.timeIso!));
  const zipSeq = timed.map((s) => s.zip as string);
  const distinct = new Set(zipSeq);
  if (distinct.size > 1) {
    const firstLast = new Map<string, { first: number; last: number }>();
    zipSeq.forEach((z, i) => {
      const cur = firstLast.get(z);
      if (!cur) firstLast.set(z, { first: i, last: i });
      else cur.last = i;
    });
    for (const [zip, span] of firstLast) {
      const between = zipSeq.slice(span.first, span.last + 1);
      if (between.some((z) => z !== zip)) {
        issues.push({
          key: `zip_run_break:${dayLabel}:${zip}`,
          kind: 'zip_run_break',
          stopIds: timed.filter((s) => s.zip === zip).map((s) => s.id),
          line: `The route leaves ZIP ${zip} and comes back — resequencing keeps the run dry (§3.11).`,
        });
        break; // one break flag per day is enough signal
      }
    }
  }
  return issues;
}

export interface BookingAgentResult {
  agent: 'booking';
  stopsChecked: number;
  issues: number;
  newlyRaised: number;
  llm: 'not_configured' | 'available';
  status: 'ok' | 'error';
}

async function alreadyRaisedKeys(now: Date): Promise<Set<string>> {
  if (!hasDb()) return new Set();
  const since = new Date(now.getTime() - 3 * 86400_000).toISOString();
  const res = await getDb()
    .from('event')
    .select('payload')
    .eq('type', 'booking.issue.raised')
    .gte('emitted_at', since);
  if (res.error) return new Set();
  const out = new Set<string>();
  for (const r of res.data ?? []) {
    const k = (r.payload as { key?: string }).key;
    if (k) out.add(k);
  }
  return out;
}

/** Live wrapper: check TOMORROW (the day Mike can still fix tonight). */
export async function runBookingAgent(now = new Date()): Promise<BookingAgentResult> {
  const run = await startAgentRun({ agent: 'booking', modelUsed: env.anthropic.apiKey ? 'claude-opus-5' : undefined });
  const llm = env.anthropic.apiKey ? 'available' as const : 'not_configured' as const;
  try {
    const start = new Date(now); start.setHours(24, 0, 0, 0);
    const end = new Date(start.getTime() + 86400_000);
    const db = getDb();
    const [jobs, ests] = await Promise.all([
      db.from('job').select('id, scheduled_for, property:property_id(zip)')
        .gte('scheduled_for', start.toISOString()).lt('scheduled_for', end.toISOString())
        .in('status', ['booked', 'in_progress']),
      db.from('estimate').select('id, scheduled_slot, property:property_id(zip)')
        .gte('scheduled_slot', start.toISOString()).lt('scheduled_slot', end.toISOString())
        .eq('outcome', 'pending'),
    ]);
    if (jobs.error) throw jobs.error;
    if (ests.error) throw ests.error;
    type Row = { id: string; scheduled_for?: string | null; scheduled_slot?: string | null; property: { zip: string | null } | null };
    const stops: BookingStopInput[] = [
      ...((jobs.data ?? []) as unknown as Row[]).map((r) => ({ id: r.id, timeIso: r.scheduled_for ?? null, zip: r.property?.zip ?? null })),
      ...((ests.data ?? []) as unknown as Row[]).map((r) => ({ id: r.id, timeIso: r.scheduled_slot ?? null, zip: r.property?.zip ?? null })),
    ];
    const issues = findBookingIssues(stops, start.toISOString().slice(0, 10));
    const seen = await alreadyRaisedKeys(now);
    let raised = 0;
    for (const issue of issues) {
      if (seen.has(issue.key)) continue;
      const ok = await emitSafe('booking.issue.raised', { key: issue.key, kind: issue.kind, stopIds: issue.stopIds, line: issue.line }, 'booking-agent');
      if (ok) raised++;
    }
    await run.finish({ status: 'ok', outputSummary: `stops=${stops.length} issues=${issues.length} newly_raised=${raised} llm=${llm}` });
    return { agent: 'booking', stopsChecked: stops.length, issues: issues.length, newlyRaised: raised, llm, status: 'ok' };
  } catch (err) {
    await run.finish({ status: 'error', outputSummary: err instanceof Error ? err.message : 'error' });
    return { agent: 'booking', stopsChecked: 0, issues: 0, newlyRaised: 0, llm, status: 'error' };
  }
}
