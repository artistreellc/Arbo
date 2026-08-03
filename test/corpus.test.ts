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
import { describe, it, expect } from 'vitest';
import { CORPUS, searchCorpus, NEVER_REPRODUCE, type CorpusEntry } from '../src/reference/corpus.js';

// docs/ARBORICULTURE_CORPUS.md. The corpus document sets its own rules —
// provenance on everything, uncertainty carried not dropped, never reproduce
// ANSI, credentialed sources only. These tests are those rules as code.

describe('provenance — Recommendation 5', () => {
  it('every entry names an author, an institution, a venue and a year', () => {
    for (const e of CORPUS) {
      expect(e.authors.trim(), e.id).not.toBe('');
      expect(e.institution.trim(), e.id).not.toBe('');
      expect(e.venue.trim(), e.id).not.toBe('');
      expect(e.year, e.id).toBeGreaterThan(1970);
    }
  });

  it('every open-access entry carries a URL somebody can actually open', () => {
    // If it is open access, the audit trail has to be one click away.
    for (const e of CORPUS.filter((x) => x.openAccess && x.url !== null)) {
      expect(e.url, e.id).toMatch(/^https?:\/\//);
    }
  });

  it('has ids that are unique', () => {
    expect(new Set(CORPUS.map((e) => e.id)).size).toBe(CORPUS.length);
  });
});

describe('uncertainty is carried, never dropped — Recommendation 4 / Appendix C', () => {
  const flagged = (id: string) => CORPUS.find((e) => e.id === id)!;

  it.each([
    ['smiley-1992-strength-loss', /half the failures|33%/i],
    ['okun-2023-decay-tools', /decision aids|never verdicts/i],
    ['rathjens-2021-callery', /more time is needed|long-term/i],
    ['gilman-uf-pruning', /generalisation|not a species-specific/i],
    ['ctla-guide-10', /disagreement|9th/i],
    ['duryea-2007-coastal-plain', /observational|not precise probabilities/i],
    ['smith-2006-codit-today', /conceptual|bricks and mortar/i],
  ])('%s carries its Appendix C flag', (id, pattern) => {
    // All seven contested findings in the corpus document. A missing flag here
    // means the agent would present a disputed tool as settled fact.
    expect(flagged(id).uncertainty, id).not.toBeNull();
    expect(flagged(id).uncertainty!).toMatch(pattern);
  });

  it('reports how many results are contested, so the caller can hedge', () => {
    expect(searchCorpus({ section: 'risk_assessment' }).contested).toBeGreaterThan(0);
  });
});

describe('never reproduce copyrighted standards — a legal constraint', () => {
  it('names ANSI A300 and Z133 as never-reproduce', () => {
    expect(NEVER_REPRODUCE).toContain('ANSI A300');
    expect(NEVER_REPRODUCE).toContain('ANSI Z133');
  });

  it('points at the FREE government equivalent instead of the paywalled standard', () => {
    const va = CORPUS.find((e) => e.id === 'va-16vac25-73')!;
    expect(va.openAccess).toBe(true);
    expect(va.finding).toMatch(/free, citable government equivalent/i);
  });

  it('carries no block of reproduced standard text', () => {
    // Findings are paraphrase. Nothing here should look like a clause body.
    for (const e of CORPUS) {
      expect(e.finding.length, e.id).toBeLessThan(700);
    }
  });
});

describe('searching the corpus', () => {
  it('puts the foundational source first', () => {
    expect(searchCorpus({ section: 'biology_decay' }).entries[0]!.id).toBe('shigo-1977-codit');
    expect(searchCorpus({ section: 'storm_wind' }).entries[0]!.id).toBe('duryea-2007-coastal-plain');
  });

  it('can narrow to what actually applies to Hampton Roads', () => {
    const r = searchCorpus({ regionalOnly: true });
    expect(r.entries.length).toBeGreaterThan(5);
    expect(r.entries.every((e: CorpusEntry) => e.regional)).toBe(true);
    // Laurel oak is the local caution the corpus calls out by name.
    expect(r.entries.some((e) => /laurel oak/i.test(e.finding))).toBe(true);
  });

  it('COUNTS what a paywall filter removed rather than hiding it (§1B)', () => {
    const r = searchCorpus({ openAccessOnly: true });
    expect(r.paywalledHeld).toBeGreaterThan(0);
    expect(r.entries.every((e) => e.openAccess)).toBe(true);
  });

  it('distinguishes "nothing matched" from "the corpus is empty"', () => {
    expect(searchCorpus({ text: 'submarine' }).noMatch).toBe(true);
    expect(searchCorpus({ text: 'decay' }).noMatch).toBe(false);
  });

  it('covers all eleven subject areas', () => {
    expect(new Set(CORPUS.map((e) => e.section)).size).toBe(11);
  });
});
