// The reference library (brief §6U). "How do I do X" for a crew standing
// under the tree, not a textbook.
//
// Three laws:
//   §6U.3  CLAUSE CITATIONS ONLY. Arbo cites "Z133 §8.1"; it never reproduces
//          standard text. Reproducing it is both a copyright problem and an
//          accuracy one — a paraphrase of a safety standard that drifts is
//          worse than a pointer to the real thing.
//   §4.7   Nothing publishes without a named human vetter. The DB CHECK
//          (reference_entry_vetted_before_publish) is the floor.
//   §1B    A technique with no stated limits is presented as INCOMPLETE, never
//          as universally applicable. "When this does not work" is the field
//          that keeps someone out of a bad cut, so its absence is loud.

export interface ReferenceEntry {
  id: string;
  techniqueName: string;
  skillLevel: number;
  howTo: string;
  pros: string[];
  cons: string[];
  /** The limits. Absence is a gap, and is reported as one. */
  wontWorkWhen: string | null;
  sourceLink: string | null;
  /** Clause citations ONLY — never standard text (§6U.3). */
  standardRefs: string[];
  published: boolean;
}

export interface CrewFacingEntry {
  id: string;
  techniqueName: string;
  skillLevel: number;
  howTo: string;
  pros: string[];
  cons: string[];
  wontWorkWhen: string | null;
  standardRefs: string[];
  sourceLink: string | null;
  /** Shown in place of limits when none are recorded. Never left blank. */
  limitsWarning: string | null;
  /** True when this entry is above the reader's recorded skill level. */
  aboveSkillLevel: boolean;
}

export const NO_LIMITS_WARNING =
  'No limits recorded for this technique. That does not mean it always works — ask before using it somewhere unusual.';

/**
 * A citation is a clause reference, not prose. Anything long enough to be
 * reproduced standard text is rejected at the boundary rather than trusted to
 * a reviewer's eye (§6U.3).
 */
const CITATION_RE = /^[A-Za-z0-9][A-Za-z0-9 .\-/]{0,24}§\s?[\d.]+[A-Za-z]?$/;

export function isClauseCitation(ref: string): boolean {
  return CITATION_RE.test(ref.trim());
}

/** Drop anything that is not a clause citation, and say how many were dropped. */
export function sanitiseRefs(refs: string[]): { refs: string[]; dropped: number } {
  const kept = refs.filter((r) => isClauseCitation(r));
  return { refs: kept, dropped: refs.length - kept.length };
}

/**
 * Shape an entry for a crew phone. Only published entries reach here; an
 * unpublished one has not been through a human (§4.7) and is never returned.
 */
export function toCrewFacing(entry: ReferenceEntry, readerSkillLevel = 99): CrewFacingEntry {
  const { refs } = sanitiseRefs(entry.standardRefs);
  const hasLimits = Boolean(entry.wontWorkWhen?.trim());
  return {
    id: entry.id,
    techniqueName: entry.techniqueName,
    skillLevel: entry.skillLevel,
    howTo: entry.howTo,
    pros: entry.pros,
    cons: entry.cons,
    wontWorkWhen: hasLimits ? entry.wontWorkWhen : null,
    standardRefs: refs,
    sourceLink: entry.sourceLink,
    limitsWarning: hasLimits ? null : NO_LIMITS_WARNING,
    // Not a lock — a groundie may need to READ about a climber technique. It
    // is a flag so nobody tries something they have not been signed off on.
    aboveSkillLevel: entry.skillLevel > readerSkillLevel,
  };
}

export interface LibraryQuery {
  /** Free text from the crew. Empty returns everything, easiest first. */
  text?: string;
  readerSkillLevel?: number;
}

export interface LibraryResult {
  entries: CrewFacingEntry[];
  /** Entries that exist but are not published — counted, never shown. */
  unpublishedHeld: number;
  /** Citations stripped for not being clause references (§6U.3). */
  refsDropped: number;
  /** True when the search found nothing AND the library is not simply empty. */
  noMatch: boolean;
  /**
   * The crew typed something, but every word was too short to search on, so
   * this is the WHOLE library and not a set of matches. Saying nothing here
   * would let a page render "everything" as "what you asked for" (§1B).
   */
  queryTooShort: boolean;
}

function score(entry: ReferenceEntry, terms: string[]): number {
  if (terms.length === 0) return 1;
  const name = entry.techniqueName.toLowerCase();
  const body = `${entry.howTo} ${entry.pros.join(' ')} ${entry.cons.join(' ')} ${entry.wontWorkWhen ?? ''}`.toLowerCase();
  let s = 0;
  for (const t of terms) {
    if (name.includes(t)) s += 10;      // a name hit is what the crew meant
    else if (body.includes(t)) s += 1;
  }
  return s;
}

/**
 * Search the library. Deterministic ordering so the same question always
 * gives the same answer to two crew members standing next to each other.
 */
export function searchLibrary(all: ReferenceEntry[], query: LibraryQuery = {}): LibraryResult {
  const published = all.filter((e) => e.published);
  const unpublishedHeld = all.length - published.length;

  const raw = (query.text ?? '').trim();
  const terms = raw
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length > 2);
  // Every word was too short to search on. The result below is the whole
  // library, so the caller has to be told that — otherwise "up" looks like it
  // matched everything (§1B).
  const queryTooShort = raw.length > 0 && terms.length === 0;

  const scored = published
    .map((e) => ({ e, s: score(e, terms) }))
    .filter((x) => x.s > 0)
    .sort((a, b) =>
      b.s - a.s
      || a.e.skillLevel - b.e.skillLevel
      || a.e.techniqueName.localeCompare(b.e.techniqueName));

  const refsDropped = scored.reduce((n, x) => n + sanitiseRefs(x.e.standardRefs).dropped, 0);

  return {
    entries: scored.map((x) => toCrewFacing(x.e, query.readerSkillLevel ?? 99)),
    unpublishedHeld,
    refsDropped,
    // "Nothing matched your search" and "the library is empty" are different
    // facts and must not render the same (§1B).
    noMatch: scored.length === 0 && published.length > 0,
    queryTooShort,
  };
}
