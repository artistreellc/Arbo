/*
  SLOW::ARBO — part of the data-link switch (read-only mode). The note at the
  top of src/db/client.ts applies here in full. Read it before editing.
*/

/**
 * What Arbo did NOT save because it is read-only (R-READONLY, Mike
 * 2026-10-20: "give arbo and its agents read only data access").
 *
 * A writer that is skipped in read-only mode says so HERE, so "not saved" is
 * a named, counted state on /api/links and the boot of every sweep — never a
 * silent drop and never a confident zero (§1B). Counts and fixed kind names
 * only (a table or a writer's name): never a row, a name, a number or an
 * address (§4.3). In memory on purpose — read-only mode must not write the
 * fact that it did not write.
 */
const counts = new Map<string, number>();
let lastAtIso: string | null = null;

/** Count `n` skipped writes of one kind. `kind` is a fixed name (e.g. 'agent_run'), never data. */
export function noteNotSaved(kind: string, n = 1): void {
  if (n <= 0) return;
  counts.set(kind, (counts.get(kind) ?? 0) + n);
  lastAtIso = new Date().toISOString();
}

export interface NotSavedReport {
  total: number;
  byKind: Record<string, number>;
  lastAtIso: string | null;
}

/** Everything skipped since this process started. Resets on a redeploy, and says so where it is shown. */
export function notSavedReport(): NotSavedReport {
  const byKind = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return { total: [...counts.values()].reduce((s, n) => s + n, 0), byKind, lastAtIso };
}

/** Tests only. */
export function resetNotSaved(): void {
  counts.clear();
  lastAtIso = null;
}
