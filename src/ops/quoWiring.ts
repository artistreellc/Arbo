// Quo wiring that does not give up after one try (audit M15, 2026-10-20).
//
// Arbo registers its webhooks with Quo and learns the Quo line at boot. That
// used to happen ONCE: a brief Quo error during a deploy left Sona's calls
// unread (or reconcile, the study and outreach never started) until the next
// deploy — and deploys are manual. Now a failed or partial wiring is tried
// again at 1, 5 and 15 minutes, then every 15 minutes, until it is whole.
// The work that needs the line (reading Quo's record, the study, outreach)
// starts ONCE, on the first attempt that learns it — never twice.
// Every waiting state is NAMED (§1B): the intake's registration says when
// the next try is, so "not wired" never reads as a quiet phone.

/** Wait before try 2, 3, 4 …; the last step repeats. Bounded: never faster, never further apart than 15 minutes. */
export const QUO_WIRE_RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

export interface WireAttempt<L> {
  /** The Quo line, when this attempt learned it. */
  line: L | null;
  /** True when something is still missing (a webhook, the line) and a later try could fix it. */
  retry: boolean;
}

export interface QuoWiringDeps<L> {
  /** One wiring attempt. May throw — a throw is a retryable failure. */
  wire: () => Promise<WireAttempt<L>>;
  /** Runs ONCE, on the first attempt that learns the line. */
  onLine: (line: L) => void;
  /** Names the wait: the next try's time and how many tries so far. */
  onRetry: (nextAt: Date, attempts: number) => void;
  now?: () => number;
  /** Test seam. Real timers are unref'd so they never hold the process open. */
  setTimer?: (fn: () => void, ms: number) => void;
}

export function startQuoWiring<L>(deps: QuoWiringDeps<L>): { attempts: () => number; lineKnown: () => boolean } {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => {
    setTimeout(fn, ms).unref?.();
  });
  let attempts = 0;
  let lineKnown = false;
  const tryOnce = async (): Promise<void> => {
    attempts += 1;
    let out: WireAttempt<L>;
    try {
      out = await deps.wire();
    } catch (err) {
      console.error('[quo] wiring attempt failed:', err instanceof Error ? err.message : 'error');
      out = { line: null, retry: true };
    }
    if (out.line && !lineKnown) {
      lineKnown = true;
      deps.onLine(out.line);
    }
    if (!out.retry) return;
    const wait = QUO_WIRE_RETRY_MS[Math.min(attempts - 1, QUO_WIRE_RETRY_MS.length - 1)]!;
    deps.onRetry(new Date(now() + wait), attempts);
    console.error(`[quo] wiring not complete after try ${attempts} — trying again in ${Math.round(wait / 60_000)} min`);
    setTimer(() => { void tryOnce(); }, wait);
  };
  void tryOnce();
  return { attempts: () => attempts, lineKnown: () => lineKnown };
}
