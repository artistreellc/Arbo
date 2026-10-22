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
import { pairSha, isSafetyClass, loadLedger, readLedger, safetyCleared, ledgerProblems, type LedgerEntry } from '../src/i18n/ledger.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findBannedEs } from '../src/i18n/banList.js';
import { esGateProblems } from '../src/i18n/gates.js';
import { currentSafetyPairs } from '../src/i18n/dictionaries.js';
import { RECORDED_EN, RECORDED_SHA, HELD_EN, oneCharEdit } from './support/esRecorded.js';

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
      // D112 held-five round (pin moved, meaning kept): HELD's Spanish is the one the fresh blind pass recorded.
      ['HELD', 'NO LO MANEJE NI LO USE — FUERA DE SERVICIO (FRENOS O DIRECCIÓN)'],
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
    // D112 held-five round (pin moved, meaning kept): every glossary label is recorded now, so the draft
    // is PERMIT LIKELY's work-order line — one of the four "protected work" lines the review still holds.
    const label = 'PERMIT LIKELY — do not start protected work until the permit is confirmed.';
    const es = 'PROBABLEMENTE SE NECESITA PERMISO — no empiece el trabajo que requiere permiso (protected work) hasta que se confirme el permiso.';
    expect(isSafetyClass(label)).toBe(true);
    expect(loadLedger().find((e) => e.en === label && e.es === es)?.pass).toBe('draft');
    expect(twinFor(label, { es, enSha: enSha(label) })).toBeNull();
    const reviewed: LedgerEntry[] = [{ en: label, es, sha: pairSha(label, es), where: 'test', pass: 'reviewed', translatedBy: 't', reviewedBy: 'r', backTranslation: 'A PERMIT IS PROBABLY NEEDED — …', on: '2026-10-22' }];
    expect(safetyCleared(label, es, reviewed)).toBe(true);
    expect(safetyCleared(label, es + ' ', reviewed)).toBe(false);
    // And a recorded glossary label is served from the committed ledger, exactly as recorded.
    expect(twinFor('PERMIT LIKELY', { es: 'PROBABLEMENTE SE NECESITA PERMISO', enSha: enSha('PERMIT LIKELY') })).toBe('PROBABLEMENTE SE NECESITA PERMISO');
    // HELD: its recorded Spanish is served; the plan's words it replaced have no ledger entry and are not.
    const held = 'NO LO MANEJE NI LO USE — FUERA DE SERVICIO (FRENOS O DIRECCIÓN)';
    expect(twinFor('HELD', { es: held, enSha: enSha('HELD') })).toBe(held);
    expect(loadLedger().some((e) => e.es === 'NO SE MANEJA — FRENOS/DIRECCIÓN')).toBe(false);
    expect(safetyCleared('HELD', 'NO SE MANEJA — FRENOS/DIRECCIÓN')).toBe(false);
    expect(twinFor('HELD', { es: 'NO SE MANEJA — FRENOS/DIRECCIÓN', enSha: enSha('HELD') })).toBeNull();
  });
});

describe('the review ledger (src/i18n/reviewed.json) — a safety string edited without a new review fails the build', () => {
  it('names every safety-class Spanish string in the repo, each fingerprint current — THE BUILD CHECK', () => {
    expect(ledgerProblems(currentSafetyPairs())).toEqual([]);
  });

  it('the ledger is honest about where each entry stands: every pass is named, every fingerprint its own pair', () => {
    for (const e of loadLedger()) {
      expect(['draft', 'reviewed', 'person']).toContain(e.pass);
      expect(e.sha).toBe(pairSha(e.en, e.es));
      expect(e.translatedBy, e.en).toBeTruthy();
      if (e.pass !== 'draft') {
        expect(e.reviewedBy, e.en).toBeTruthy();
        expect(e.backTranslation, e.en).toBeTruthy();
      }
    }
  });

  // D112 (replaces "the plan's table is a draft"): the blind review recorded exactly these lines and
  // held exactly these — RECORDED_EN / HELD_EN (test/support/esRecorded.ts) are the one list the page
  // and twin tests read. Only a blind-reviewed line is served; nothing is at "person" yet (R27 #5).
  it('records exactly the blind-reviewed set — 13 reviewed, 4 held as drafts, none read by a person yet', () => {
    const at = (pass: string) => loadLedger().filter((e) => e.pass === pass).map((e) => e.en);
    expect(at('reviewed')).toEqual([...RECORDED_EN]);
    // …and by fingerprint, so a recorded line's Spanish can't change and be re-marked unnoticed.
    expect(loadLedger().filter((e) => e.pass === 'reviewed').map((e) => e.sha)).toEqual([...RECORDED_SHA]);
    expect(at('draft')).toEqual([...HELD_EN]);
    expect(at('person')).toEqual([]);
    expect(loadLedger().length).toBe(RECORDED_EN.length + HELD_EN.length);
    for (const e of loadLedger()) {
      if (e.pass === 'reviewed') {
        // Both blind passes named, with the date, and the back-translation itself on the entry.
        expect(e.reviewedBy, e.en).toMatch(/second translation/);
        expect(e.reviewedBy, e.en).toMatch(/back-translation/);
        expect(e.reviewedBy, e.en).toMatch(/2026-10-22/);
        expect(e.note, e.en).toMatch(/^Recorded 2026-10-22 \(D112\)/);
      } else {
        expect(e.reviewedBy, e.en).toBeUndefined();
        expect(e.note, e.en).toMatch(/^Not recorded \(D112\)/);
      }
    }
    // The glossary's seven labels: all recorded (HELD since D112's held-five round, with new Spanish),
    // each as the very pair the glossary holds.
    for (const p of SAFETY_PAIRS) {
      const e = loadLedger().find((x) => x.en === p.en);
      expect(e?.pass, p.en).toBe('reviewed');
      expect(e?.es, p.en).toBe(p.es);
    }
    expect(RECORDED_EN.length).toBe(13);
    expect(HELD_EN.length).toBe(4);
  });

  it('serves exactly the recorded lines as written — and a recorded line whose Spanish is edited by ONE character stops being served', () => {
    for (const e of loadLedger()) {
      expect(safetyCleared(e.en, e.es), e.en).toBe(e.pass === 'reviewed');
      const edited = oneCharEdit(e.es);
      expect(edited.length - e.es.length, e.en).toBeLessThanOrEqual(1);
      expect(edited, e.en).not.toBe(e.es);
      expect(safetyCleared(e.en, edited), `${e.en} → ${edited}`).toBe(false);
      expect(twinFor(e.en, { es: edited, enSha: enSha(e.en) }), `${e.en} → ${edited}`).toBeNull();
    }
    // …and the build check names it: edited and not re-reviewed.
    const pairs = currentSafetyPairs();
    const rec = pairs.find((p) => p.en === 'POWER LINES — utility coordination required before work near conductors')!;
    expect(safetyCleared(rec.en, rec.es)).toBe(true);
    const edited = pairs.map((p) => (p === rec ? { ...p, es: oneCharEdit(p.es) } : p));
    expect(ledgerProblems(edited).join('\n')).toMatch(/edited and not re-reviewed \(twin:crew-workorder\): POWER LINES/);
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

// Review round (D110, correctness #6): an unparsable reviewed.json threw out of
// loadLedger, and with any safety-class dictionary entry present the door page
// itself threw — after the 200 header, so the crew got a blank page instead of
// English. Now a ledger that cannot be read is an EMPTY ledger for serving
// (fail closed: every safety-class Spanish line is held back and the English
// shows) and a named problem for the build.
describe('review round — a ledger that cannot be read fails closed, and never takes a page down', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arbo-ledger-'));
  writeFileSync(join(dir, 'cut.json'), '{"entries": [');
  writeFileSync(join(dir, 'shape.json'), JSON.stringify({ entries: 'none' }));
  writeFileSync(join(dir, 'ok.json'), JSON.stringify({ entries: [] }));
  const at = (f: string) => pathToFileURL(join(dir, f));
  it('an unparsable or missing ledger does not throw; it reads as no entries and says why', () => {
    for (const f of ['cut.json', 'missing.json', 'shape.json']) {
      let r: ReturnType<typeof readLedger> | undefined;
      expect(() => { r = readLedger(at(f)); }, f).not.toThrow();
      expect(r!.entries, f).toEqual([]);
      expect(r!.error, f).toMatch(/could not be read/);
    }
    expect(readLedger(at('ok.json'))).toEqual({ entries: [], error: null });
  });
  it('with no readable ledger, no safety-class Spanish is served', () => {
    expect(safetyCleared('PERMIT LIKELY', 'PROBABLEMENTE SE NECESITA PERMISO', readLedger(at('cut.json')).entries)).toBe(false);
    expect(twinFor('Look it up', { es: 'Búsquelo', enSha: enSha('Look it up') })).toBe('Búsquelo');
  });
  it('the build check names an unreadable ledger first', () => {
    const problems = ledgerProblems(currentSafetyPairs(), [], 'the review ledger could not be read: Unexpected end of JSON input');
    expect(problems[0]).toMatch(/could not be read/);
  });
  it('the committed ledger reads cleanly', () => {
    expect(readLedger().error).toBeNull();
    expect(readLedger().entries).toEqual(loadLedger());
  });
});

// UI review #5: "la compañía de luz" is the POWER company. Utility lines and
// 811 markings also cover gas, water and phone — a crew member who read
// "compañía de luz" there would take it that only electric lines were marked.
describe('review round — "utility" is the power company only; utility lines and markings are all of them', () => {
  it('keeps the plan’s "la compañía de luz" for the utility (the power company), with the narrow sense said', () => {
    const ff = Object.fromEntries(FALSE_FRIENDS.map((f) => [f.en, f]));
    expect(ff.utility!.es).toBe('la compañía de luz');
    expect(ff.utility!.why).toMatch(/power company/i);
    expect(ff.utility!.why).toMatch(/servicios públicos/);
  });
  it('utility lines and utility markings are "servicios públicos", the English beside', () => {
    const by = Object.fromEntries(TRADE_TERMS.map((t) => [t.en, t.es]));
    expect(by['utility lines']).toBe('líneas de servicios públicos (utility lines)');
    expect(by['utility markings']).toBe('marcas de servicios públicos (utility markings)');
  });
  it('a gate catches utility lines or markings narrowed to the power company', () => {
    expect(esGateProblems('Utility markings expire.', 'Las marcas de la compañía de luz vencen.').join(' ')).toMatch(/power/);
    expect(esGateProblems('Wait for the utility lines to be marked.', 'Espere a que marquen las líneas de luz.').join(' ')).toMatch(/power/);
    expect(esGateProblems('Utility markings expire.', 'Las marcas de servicios públicos vencen.')).toEqual([]);
    expect(esGateProblems('Call the utility.', 'Llame a la compañía de luz.')).toEqual([]);
  });
});
