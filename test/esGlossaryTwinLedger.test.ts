// R27 (D110) — the glossary every unit is bound by, the server twins (withEs +
// enSha), and the review ledger whose check fails the build
// (docs/R27_SPANISH_PLAN.md "How quality is checked" 1 and 4, "Three kinds of
// text" 2). Mike, R29 #3: address the crew as usted.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  REGISTER, VARIANT, DISPLAY_LOCALE, MACHINE_LOCALE, TRADE_TERMS, FALSE_FRIENDS, SAFETY_PAIRS, CARRIER_KEYWORD,
  CREDENTIAL_GLOSS, glossaryPairs,
} from '../src/i18n/glossary.js';
import { enSha, twinFor, withEs } from '../src/i18n/twin.js';
import { pairSha, isSafetyClass, loadLedger, safetyCleared, ledgerProblems, type LedgerEntry } from '../src/i18n/ledger.js';
import { findBannedEs } from '../src/i18n/banList.js';
import { esGateProblems } from '../src/i18n/gates.js';
import { currentSafetyPairs } from '../src/i18n/dictionaries.js';

describe('the glossary — usted, neutral Latin-American Spanish, trade terms with the English beside', () => {
  it('names the register and the variety Mike chose (R29 #3)', () => {
    expect(REGISTER).toBe('usted');
    expect(VARIANT).toBe('neutral Latin-American Spanish');
    expect(DISPLAY_LOCALE).toBe('es-US');
    expect(MACHINE_LOCALE).toBe('en-US');
  });

  it('keeps the English beside each trade term the crews use', () => {
    for (const t of TRADE_TERMS) expect(t.es, t.en).toContain(`(${t.en})`);
    const by = Object.fromEntries(TRADE_TERMS.map((t) => [t.en, t.es]));
    expect(by.groundie).toBe('ayudante de tierra (groundie)');
    expect(by['drop zone']).toBe('zona de caída (drop zone)');
    expect(by.chipper).toBe('astilladora (chipper)');
  });

  it('pins the known false friends: conductor, utility, applied', () => {
    const ff = Object.fromEntries(FALSE_FRIENDS.map((f) => [f.en, f]));
    expect(ff['conductor (electrical)']!.es).toBe('cable / línea eléctrica');
    expect(ff['conductor (electrical)']!.never).toContain('conductor');
    expect(ff.utility!.es).toBe('la compañía de luz');
    expect(ff.utility!.never).toContain('utilidad');
    expect(ff.applied!.es).toBe('SOLICITADO');
    expect(ff.applied!.never).toContain('aplicado');
  });

  it('holds the plan’s safety-label table word for word — Spanish leads with what to do', () => {
    expect(SAFETY_PAIRS.map((p) => [p.en, p.es])).toEqual([
      ['PERMIT LIKELY', 'PROBABLEMENTE SE NECESITA PERMISO'],
      ['PERMIT: REVIEW NEEDED', 'PERMISO: HAY QUE REVISAR'],
      ['NO OVERLAY — VERIFY W/ CITY', 'VERIFIQUE CON LA CIUDAD — EL MAPA NO MOSTRÓ ZONA PROTEGIDA'],
      ['PERMIT SCREEN PENDING', 'CHEQUEO DE PERMISO SIN HACER'],
      ['HELD', 'NO SE MANEJA — FRENOS/DIRECCIÓN'],
      ['NO AERIAL WORK', 'NO PUEDE TRABAJAR EN ALTURA'],
      ['NO EXPIRY DATE', 'FALTA LA FECHA DE VENCIMIENTO'],
    ]);
    const plan = readFileSync(new URL('../docs/R27_SPANISH_PLAN.md', import.meta.url), 'utf8');
    for (const p of SAFETY_PAIRS) expect(plan, p.en).toContain(`| ${p.es} |`);
  });

  it('never translates STOP, and quotes credential wording in English with a Spanish gloss', () => {
    expect(CARRIER_KEYWORD).toBe('STOP');
    expect(CREDENTIAL_GLOSS.es.startsWith(`"${CREDENTIAL_GLOSS.en}"`)).toBe(true);
    for (const { es } of glossaryPairs()) expect(es).not.toMatch(/licenciad|acreditad/i);
  });

  it('every Spanish line in the glossary passes the ban list and every gate', () => {
    for (const { en, es } of glossaryPairs()) {
      expect(findBannedEs(es), es).toEqual([]);
      expect(esGateProblems(en, es), `${en} → ${es}`).toEqual([]);
    }
  });
});

describe('server twins — withEs and enSha (a stale twin is never served)', () => {
  const en = { headline: 'Two jobs on hold — no signed contract yet.', note: 'Mike checks it.' };
  const tw = (es: string, from = en.headline) => ({ es, enSha: enSha(from) });

  it('enSha is the fingerprint of the exact English', () => {
    expect(enSha('PERMIT LIKELY')).toMatch(/^[0-9a-f]{64}$/);
    expect(enSha('PERMIT LIKELY')).toBe(enSha('PERMIT LIKELY'));
    expect(enSha('PERMIT LIKELY')).not.toBe(enSha('PERMIT LIKELY '));
  });

  it('serves the twin under es, with the same field names, and leaves the English byte-identical', () => {
    const out = withEs(en, { headline: tw('Dos trabajos en espera — todavía sin contrato firmado.') });
    expect(out.headline).toBe(en.headline);
    expect(out.note).toBe(en.note);
    expect((out as { es?: Record<string, string> }).es).toEqual({ headline: 'Dos trabajos en espera — todavía sin contrato firmado.' });
  });

  it('a twin made from English that has since changed is not served — the object stays exactly as English', () => {
    const stale = withEs(en, { headline: tw('Dos trabajos en espera — sin contrato.', 'Two jobs held.') });
    expect(stale).toBe(en);
    expect(JSON.stringify(stale)).toBe(JSON.stringify(en));
  });

  it('a twin with a banned word, a dropped number or no text is not served', () => {
    const one = { line: 'Wait 10 minutes.' };
    expect(twinFor(one.line, { es: 'Zona libre.', enSha: enSha(one.line) })).toBeNull();
    expect(twinFor(one.line, { es: 'Espere unos minutos.', enSha: enSha(one.line) })).toBeNull();
    expect(twinFor(one.line, { es: '  ', enSha: enSha(one.line) })).toBeNull();
    expect(twinFor(one.line, { es: 'Espere 10 minutos.', enSha: enSha(one.line) })).toBe('Espere 10 minutos.');
    expect(twinFor(one.line, null)).toBeNull();
  });

  it('a safety-class twin is served only once the ledger records its review (a draft is not enough)', () => {
    const label = 'PERMIT LIKELY';
    const es = 'PROBABLEMENTE SE NECESITA PERMISO';
    expect(isSafetyClass(label)).toBe(true);
    // The glossary pair is in the ledger as a draft — blind review and back-translation are Phase A.
    expect(twinFor(label, { es, enSha: enSha(label) })).toBeNull();
    const reviewed: LedgerEntry[] = [{ en: label, es, sha: pairSha(label, es), where: 'test', pass: 'reviewed', translatedBy: 't', reviewedBy: 'r', backTranslation: 'PERMIT PROBABLY NEEDED', on: '2026-10-22' }];
    expect(safetyCleared(label, es, reviewed)).toBe(true);
    expect(safetyCleared(label, es + ' ', reviewed)).toBe(false);
  });
});

describe('the review ledger (src/i18n/reviewed.json) — a safety string edited without a new review fails the build', () => {
  it('names every safety-class Spanish string in the repo, each fingerprint current — THE BUILD CHECK', () => {
    expect(ledgerProblems(currentSafetyPairs())).toEqual([]);
  });

  it('the ledger is honest about where each entry stands: the plan’s table is a draft, not a review', () => {
    for (const e of loadLedger()) {
      expect(['draft', 'reviewed', 'person']).toContain(e.pass);
      expect(e.sha).toBe(pairSha(e.en, e.es));
      if (e.pass !== 'draft') {
        expect(e.reviewedBy, e.en).toBeTruthy();
        expect(e.backTranslation, e.en).toBeTruthy();
      }
    }
    for (const p of SAFETY_PAIRS) expect(loadLedger().find((e) => e.en === p.en)?.pass).toBe('draft');
  });

  it('bites: an edited Spanish line, a missing entry, a stale entry and a tampered fingerprint each fail', () => {
    const pairs = currentSafetyPairs();
    const first = pairs[0]!;
    const edited = pairs.map((p) => (p === first ? { ...p, es: p.es + ' (editado)' } : p));
    expect(ledgerProblems(edited).join('\n')).toMatch(/not re-reviewed|no ledger entry/);
    expect(ledgerProblems([...pairs, { en: 'STOP WORK', es: 'PARE EL TRABAJO', where: 'test' }]).join('\n')).toMatch(/STOP WORK/);
    expect(ledgerProblems(pairs.slice(1)).join('\n')).toMatch(/stale/);
    const tampered = loadLedger().map((e, i) => (i === 0 ? { ...e, sha: '0'.repeat(64) } : e));
    expect(ledgerProblems(pairs, tampered).join('\n')).toMatch(/fingerprint/);
  });

  it('decides safety-class from the English itself, so nobody can skip the ledger by leaving a flag off', () => {
    for (const s of ['PERMIT LIKELY', 'STOP WORK', 'Call 911', 'Call 811 before you dig', 'Call Dominion', 'NO AERIAL WORK', 'HELD', 'EMERGENCY', 'POWER LINES', 'Do not start work — call the office.']) {
      expect(isSafetyClass(s), s).toBe(true);
    }
    for (const s of ['Language', 'in English', 'Español', 'Look it up']) expect(isSafetyClass(s), s).toBe(false);
  });
});
