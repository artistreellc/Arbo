// M15 (audit 2026-10-20): Quo was wired ONCE, at boot. A Quo error during a
// deploy left Sona's calls unread — or reading Quo's record, the customer
// study and texting never started — until the next (manual) deploy, and a
// failed phone-number read was swallowed into "Wired to Quo". Now wiring is
// retried on a bounded backoff (1, 5, 15, then every 15 minutes), the work
// that needs the line starts once, and every wait is named.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { startQuoWiring, QUO_WIRE_RETRY_MS, type WireAttempt } from '../src/ops/quoWiring.js';
import { QuoIntake } from '../src/ops/quoIntake.js';
import { createQuoApi } from '../src/integrations/quo.js';
import { CallMemory, CallRecordStore } from '../src/reception/callMemory.js';
import { loadAllConfig } from '../src/config/loadConfig.js';

const NOW = Date.parse('2026-10-20T15:00:00Z');
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.restoreAllMocks());

function harness(script: Array<WireAttempt<string> | Error>) {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const lines: string[] = [];
  const retries: Array<{ at: string; attempts: number }> = [];
  let i = 0;
  const w = startQuoWiring<string>({
    wire: async () => {
      const step = script[Math.min(i, script.length - 1)]!;
      i += 1;
      if (step instanceof Error) throw step;
      return step;
    },
    onLine: (l) => lines.push(l),
    onRetry: (at, attempts) => retries.push({ at: at.toISOString(), attempts }),
    now: () => NOW,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); },
  });
  const fire = async () => {
    const t = timers.shift();
    if (!t) throw new Error('no retry scheduled');
    t.fn();
    await flush();
  };
  return { w, timers, lines, retries, fire };
}

describe('M15 — Quo wiring tries again instead of waiting for the next deploy', () => {
  it('a registration that throws at boot is tried again, and the line-dependent work starts once it works', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness([new Error('Quo GET /webhooks -> 503'), { line: 'PN1', retry: false }]);
    await flush();
    expect(h.lines).toEqual([]);
    expect(h.timers.map((t) => t.ms)).toEqual([60_000]);
    expect(h.retries).toEqual([{ at: new Date(NOW + 60_000).toISOString(), attempts: 1 }]);
    await h.fire();
    expect(h.lines).toEqual(['PN1']);
    expect(h.timers).toHaveLength(0); // whole: no more tries
    expect(h.w.attempts()).toBe(2);
  });

  it('a phone-number read that failed once (webhooks fine) is retried; the work starts ONCE even when later tries still retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness([{ line: null, retry: true }, { line: 'PN1', retry: true }, { line: 'PN1', retry: false }]);
    await flush();
    expect(h.lines).toEqual([]);
    await h.fire();
    expect(h.lines).toEqual(['PN1']);
    await h.fire();
    expect(h.lines).toEqual(['PN1']); // never twice — no doubled reconcile, study or outreach timers
    expect(h.timers).toHaveLength(0);
  });

  it('the backoff is bounded: 1, 5, 15 minutes, then every 15 — never faster, never further apart', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness([new Error('down')]);
    await flush();
    const waits: number[] = [];
    for (let n = 0; n < 6; n += 1) {
      waits.push(h.timers[0]!.ms);
      await h.fire();
    }
    expect(QUO_WIRE_RETRY_MS).toEqual([60_000, 300_000, 900_000]);
    expect(waits).toEqual([60_000, 300_000, 900_000, 900_000, 900_000, 900_000]);
    expect(h.lines).toEqual([]);
  });

  it('a config gap (no key, no public address) is not retried — a retry would not fix it', async () => {
    const h = harness([{ line: null, retry: false }]);
    await flush();
    expect(h.timers).toHaveLength(0);
    expect(h.w.attempts()).toBe(1);
  });

  it('the wait is NAMED on the intake: when Arbo tries again', () => {
    const intake = new QuoIntake({ guardrails: loadAllConfig().guardrails, extractor: null, callMemory: new CallMemory(), callRecords: new CallRecordStore(), calendarHold: null, onText: () => {} });
    intake.setRegistration('failed', 'Quo registration failed (503).');
    intake.noteWiringRetry(new Date(NOW + 300_000), 2);
    expect(intake.status().registration).toMatchObject({ state: 'failed', retryAt: new Date(NOW + 300_000).toISOString(), attempts: 2 });
    // A later success clears the wait.
    intake.setRegistration('ok', 'Wired to Quo.');
    expect(intake.status().registration.retryAt).toBeNull();
  });

  it('the server no longer swallows a failed phone-number read, and wires through the retry loop', () => {
    const src = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('api.phoneNumbers().catch(() => [])');
    expect(src).toContain('Quo would not list its phone numbers (');
    expect(src).toContain('startQuoWiring<QuoLine>({');
    expect(src).toContain('onRetry: (nextAt, attempts) => intake.noteWiringRetry(nextAt, attempts),');
    const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
    expect(html).toContain("reg.detail + (reg.retryAt ? ' Arbo tries again at ' + fmtTime(reg.retryAt)");
    expect(html).toContain('quoRegLine(st.registration)');
    expect(html).toContain(': quoRegLine(reg))));');
  });

  it('every Quo call carries a deadline, so a hung Quo fails and is named instead of stalling the wiring', async () => {
    const seen: unknown[] = [];
    const api = createQuoApi('k', async (_url, init) => {
      seen.push(init.signal);
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    });
    await api.phoneNumbers();
    expect(seen[0]).toBeInstanceOf(globalThis.AbortSignal);
  });
});
