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
// ZIP / route clustering (brief §5A #10). Estimates & jobs in the same ZIP
// should land around the same times so Mike isn't crisscrossing Hampton Roads.
// A candidate slot scores higher when same-ZIP work is already booked that day
// (and higher still when it's temporally adjacent).

import type { Interval } from './availability.js';

export interface ZipEvent extends Interval {
  zip?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function localDateKey(iso: string): string {
  // Group by calendar day (UTC day is fine for relative same-day comparison in tests;
  // production events carry offsets and normalize to the same instant ordering).
  return new Date(Date.parse(iso)).toISOString().slice(0, 10);
}

/** Group pending items by ZIP so same-area work can be batched. */
export function groupByZip<T extends { zip?: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const key = it.zip ?? 'unknown';
    const arr = map.get(key) ?? [];
    arr.push(it);
    map.set(key, arr);
  }
  return map;
}

/**
 * Score how well a candidate slot clusters with existing same-ZIP work.
 * Higher is better. Same-day same-ZIP work is a strong signal; adjacency (within
 * ~2h) adds a bonus. Different ZIP on the same day slightly penalizes (a detour).
 */
export function clusterScore(slot: Interval, zip: string | undefined, existing: ZipEvent[]): number {
  if (!zip) return 0;
  const slotStart = Date.parse(slot.startIso);
  const slotDay = localDateKey(slot.startIso);
  let score = 0;
  for (const e of existing) {
    const sameDay = localDateKey(e.startIso) === slotDay;
    if (!sameDay) continue;
    if (e.zip === zip) {
      score += 10;
      const gap = Math.abs(Date.parse(e.startIso) - slotStart);
      if (gap <= 2 * 60 * 60 * 1000) score += 5; // adjacent in time
    } else if (e.zip && e.zip !== zip) {
      score -= 2; // a same-day detour to a different ZIP
    }
  }
  return score;
}

/** Convenience: is there any same-ZIP work within `withinDays` of the slot? */
export function hasNearbyZipWork(slot: Interval, zip: string, existing: ZipEvent[], withinDays = 1): boolean {
  const slotStart = Date.parse(slot.startIso);
  return existing.some(
    (e) => e.zip === zip && Math.abs(Date.parse(e.startIso) - slotStart) <= withinDays * DAY_MS,
  );
}
