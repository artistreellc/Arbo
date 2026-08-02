// The event bus (brief §8A.6b) — the durable spine that makes the agent
// ecosystem possible. Deliberately boring (§8A.1): a Postgres table with a
// bigserial sequence and per-consumer cursors. No delivery framework, no
// agent-to-agent calls — agents share STATE and EVENTS, nothing else.
//
// Emission is fire-and-forget-safe: an event insert failure must never break
// the business write it rides on (§1B graceful degradation) — callers use
// emitSafe() on hot paths and get an honest boolean back.

import { getDb, hasDb } from '../db/client.js';

/** The core event names (§8A.6b). Emit others freely; these are the spine. */
export const CoreEvents = {
  leadCreated: 'lead.created',
  estimateBooked: 'estimate.booked',
  estimateOutcome: 'estimate.outcome.recorded',
  jobBooked: 'job.booked',
  jobCompleted: 'job.completed',
  followupSent: 'followup.sent',
  permitFlagged: 'permit.flagged',
  equipmentFailed: 'equipment.failed',
  maintenanceDue: 'maintenance.due',
  needsDecision: 'needs_decision.raised',
  crewClockIn: 'crew.clockin',
  crewClockOut: 'crew.clockout',
} as const;

export interface BusEvent {
  seq: number;
  id: string;
  type: string;
  payload: Record<string, unknown>;
  source: string;
  emitted_at: string;
}

/** Insert one event. Throws on failure — use emitSafe() on business hot paths. */
export async function emitEvent(
  type: string,
  payload: Record<string, unknown>,
  source: string,
): Promise<void> {
  const { error } = await getDb().from('event').insert({ type, payload, source });
  if (error) throw new Error(`event emit failed: ${error.message}`);
}

/**
 * Emission that can never break the write it rides on. Returns false (and
 * stays quiet — no PII ever reaches logs, §4.3) when the insert failed or the
 * DB is down; the primary business write stands either way.
 */
export async function emitSafe(
  type: string,
  payload: Record<string, unknown>,
  source: string,
): Promise<boolean> {
  if (!hasDb()) return false;
  try {
    await emitEvent(type, payload, source);
    return true;
  } catch {
    return false;
  }
}

/** Read events after a sequence number, oldest first. */
export async function eventsAfter(seq: number, limit = 100): Promise<BusEvent[]> {
  const { data, error } = await getDb()
    .from('event')
    .select('seq,id,type,payload,source,emitted_at')
    .gt('seq', seq)
    .order('seq', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`event read failed: ${error.message}`);
  return (data ?? []) as BusEvent[];
}

async function getCursor(consumer: string): Promise<number> {
  const { data, error } = await getDb()
    .from('event_cursor')
    .select('last_seq')
    .eq('consumer', consumer)
    .maybeSingle();
  if (error) throw new Error(`cursor read failed: ${error.message}`);
  return data ? Number(data.last_seq) : 0;
}

async function setCursor(consumer: string, seq: number): Promise<void> {
  const { error } = await getDb()
    .from('event_cursor')
    .upsert({ consumer, last_seq: seq, updated_at: new Date().toISOString() });
  if (error) throw new Error(`cursor write failed: ${error.message}`);
}

/**
 * Consume new events for a named consumer. The handler runs once per event in
 * order; the cursor advances only past events the handler completed, so a
 * crash mid-batch re-delivers (at-least-once — consumers must be idempotent).
 */
export async function consumeNew(
  consumer: string,
  handler: (e: BusEvent) => Promise<void>,
  batch = 50,
): Promise<{ processed: number }> {
  const start = await getCursor(consumer);
  const events = await eventsAfter(start, batch);
  let processed = 0;
  for (const e of events) {
    await handler(e);
    await setCursor(consumer, e.seq);
    processed++;
  }
  return { processed };
}
