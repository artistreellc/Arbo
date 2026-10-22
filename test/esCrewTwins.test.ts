// R27 Phase A unit 1 (D111) — the server text the crew door shows, with its
// Spanish twin (docs/R27_SPANISH_PLAN.md, "Three kinds of text" 2, "Quiz and
// briefing stay correct"):
//   - the fixed lines a server module writes (work-order hazards and permit notes,
//     the library's no-limits warning) — twin tables in src/i18n/twins/, each row
//     carrying the English it was translated from and its enSha;
//   - the office's own text in the database (the day's briefing, the quiz) — a
//     twin stored on the row beside the English, served only under the plan's
//     rules (same English, same option count and order, the keyed answer
//     re-checked, its review recorded on it). Grading never sees Spanish.
// English output stays byte-identical whatever twins exist.
import { describe, it, expect } from 'vitest';
import { twinTableNames, readTwinTable, twinOf, currentTwinPairs } from '../src/i18n/serverTwins.js';
import { enSha, twinFor } from '../src/i18n/twin.js';
import { findBannedEs, normalizeEs } from '../src/i18n/banList.js';
import { TRADE_TERMS } from '../src/i18n/glossary.js';
import { esGateProblems } from '../src/i18n/gates.js';
import { isSafetyClass, loadLedger, pairSha, type LedgerEntry } from '../src/i18n/ledger.js';
import { currentSafetyPairs } from '../src/i18n/dictionaries.js';
import { buildCrewPayload, crewPayloadTwins, CREW_LINES, type WorkOrderSource } from '../src/crew/workOrder.js';
import { toCrewFacing as libraryFacing, NO_LIMITS_WARNING } from '../src/reference/library.js';
import { briefingTwin, quizTwin, quizEnSha } from '../src/i18n/dataTwins.js';
import { toCrewFacing as quizFacing, gradeSubmission } from '../src/training/grading.js';
import { RECORDED_EN, HELD_EN, oneCharEdit } from './support/esRecorded.js';

const src = (over: Partial<WorkOrderSource> = {}): WorkOrderSource => ({
  jobId: 'j1', routeOrder: 1, address: 'SIM 1 Simulation Row', city: 'Virginia Beach', timeIso: null, scope: 'SIM scope',
  hazardPowerLines: true, hazardStructures: true, permitStatus: 'PERMIT_LIKELY', photoRefs: [], briefingId: null, ...over,
});
const reviewedLedger = (table: string): LedgerEntry[] => Object.values(readTwinTable(table) ?? {}).map((r) => ({
  en: r.en, es: r.es, sha: pairSha(r.en, r.es), where: 'test', pass: 'reviewed', translatedBy: 't', reviewedBy: 'r', backTranslation: 'b', on: '2026-10-22',
}));

describe('the twin tables — every row is the Spanish of a line the module writes today', () => {
  it('the crew door’s two tables are there and readable', () => {
    expect(twinTableNames()).toEqual(expect.arrayContaining(['crew-library', 'crew-workorder']));
    for (const t of ['crew-library', 'crew-workorder']) expect(readTwinTable(t), t).not.toBeNull();
  });
  it('each row’s enSha is the fingerprint of its own English', () => {
    for (const t of twinTableNames()) for (const [id, r] of Object.entries(readTwinTable(t)!)) expect(r.enSha, `${t}.${id}`).toBe(enSha(r.en));
  });
  it('each row passes the ban list and every gate', () => {
    for (const t of twinTableNames()) {
      for (const [id, r] of Object.entries(readTwinTable(t)!)) {
        expect(findBannedEs(r.es), `${t}.${id}`).toEqual([]);
        expect(esGateProblems(r.en, r.es), `${t}.${id} ${r.es}`).toEqual([]);
      }
    }
  });
  it('crew-workorder: one row per line the work order writes, and its English is that line exactly (no stale twin)', () => {
    const table = readTwinTable('crew-workorder')!;
    expect(Object.keys(table).sort()).toEqual(Object.keys(CREW_LINES).sort());
    for (const [id, en] of Object.entries(CREW_LINES)) expect(table[id]!.en, id).toBe(en);
  });
  // Review round (D111, UI 5 + blind second pass): "protected work" is work that needs permit clearance
  // before a crew starts (src/permitting/permitRecord.ts requiresClearance). "Trabajo protegido" reads as
  // work done with protection, and a back-translation would never flag it — so the glossary pins it.
  it('"protected work" is "trabajo que requiere permiso (protected work)" in every twin — never "trabajo protegido"', () => {
    for (const t of twinTableNames()) {
      for (const [id, r] of Object.entries(readTwinTable(t)!)) {
        expect(normalizeEs(r.es), `${t}.${id}`).not.toContain('trabajo protegido');
        if (/\bprotected work\b/i.test(r.en)) expect(r.es, `${t}.${id}`).toContain('trabajo que requiere permiso (protected work)');
      }
    }
    expect(TRADE_TERMS.find((x) => x.en === 'protected work')?.es).toBe('trabajo que requiere permiso (protected work)');
  });
  it('NO OVERLAY: the plan’s label, then a whole sentence that ties the time limit to VERIFY — no clause left dangling after it', () => {
    const es = readTwinTable('crew-workorder')!.noOverlayVerify!.es;
    expect(es.startsWith('VERIFIQUE CON LA CIUDAD — EL MAPA NO MOSTRÓ ZONA PROTEGIDA. ')).toBe(true);
    expect(es).not.toMatch(/PROTEGIDA — antes/);
  });
  it('crew-library: the no-limits warning, exactly as the library writes it', () => {
    expect(readTwinTable('crew-library')!.noLimits!.en).toBe(NO_LIMITS_WARNING);
  });
  it('a table that cannot be read is named and serves nothing — the English shows (§1B)', () => {
    expect(readTwinTable('no-such-table')).toBeNull();
    expect(twinOf('no-such-table', 'x')).toBeNull();
  });
  // D112 (pin moved): the blind review recorded the two hazards and REVIEW NEEDED; the four lines that
  // say "protected work" stay drafts (no blind second translation has agreed with their words yet).
  it('every safety-class row is in the review ledger — the three recorded by the blind review reviewed, the four "protected work" lines drafts', () => {
    const safety = currentTwinPairs().filter((p) => isSafetyClass(p.en));
    expect(safety.length).toBe(Object.keys(CREW_LINES).length);
    const recorded: string[] = [CREW_LINES.hazardPowerLines, CREW_LINES.hazardStructures, CREW_LINES.reviewNeeded];
    for (const p of safety) {
      expect(currentSafetyPairs().some((c) => c.en === p.en && c.es === p.es), p.en).toBe(true);
      const e = loadLedger().find((x) => x.en === p.en && x.es === p.es);
      expect(e?.pass, p.en).toBe(recorded.includes(p.en) ? 'reviewed' : 'draft');
      expect(RECORDED_EN.includes(p.en), p.en).toBe(recorded.includes(p.en));
      expect(HELD_EN.includes(p.en), p.en).toBe(!recorded.includes(p.en));
    }
  });
});

describe('work orders — the English payload is byte-identical; a twin rides under es only once it may be served', () => {
  // D112 (pin moved, meaning kept): the committed ledger now records the two hazards, so their twins
  // ride under es; PERMIT LIKELY's line is still a draft, so no permitNote twin. The English is untouched.
  it('the English fields are the very same as before; the recorded hazards ride under es; the held PERMIT LIKELY line does not', () => {
    const p = buildCrewPayload(src());
    const table = readTwinTable('crew-workorder')!;
    expect(p.hazards).toEqual([CREW_LINES.hazardPowerLines, CREW_LINES.hazardStructures]);
    expect(p.permitNote).toBe(CREW_LINES.permitLikely);
    expect(p.es).toEqual({ hazards: [table.hazardPowerLines!.es, table.hazardStructures!.es] });
    const english = { ...p };
    delete english.es;
    expect(JSON.stringify(english)).toBe(JSON.stringify({
      jobId: 'j1', routeOrder: 1, address: 'SIM 1 Simulation Row', city: 'Virginia Beach', timeIso: null, scope: 'SIM scope',
      hazards: [CREW_LINES.hazardPowerLines, CREW_LINES.hazardStructures], permitNote: CREW_LINES.permitLikely,
      photoRefs: [], briefingId: null, requiresBeforeAfterPhotos: true,
    }));
    // Each held permit line: no twin from the committed ledger. The recorded one (REVIEW NEEDED): its twin.
    for (const s of ['PERMIT_LIKELY', 'NO_OVERLAY_VERIFY'] as const) {
      expect(buildCrewPayload(src({ hazardPowerLines: false, hazardStructures: false, permitStatus: s })).es, s).toBeUndefined();
    }
    expect(buildCrewPayload(src({ hazardPowerLines: false, hazardStructures: false, permitStatus: null, permitUnreadable: true })).es).toBeUndefined();
    expect(buildCrewPayload(src({ hazardPowerLines: false, hazardStructures: false, permitStatus: null, permitScreenPending: true })).es).toBeUndefined();
    expect(buildCrewPayload(src({ hazardPowerLines: false, hazardStructures: false, permitStatus: 'REVIEW_NEEDED' })).es).toEqual({ permitNote: table.reviewNeeded!.es });
    // No hazard and no permit note: the payload has no es at all — the same object as before.
    expect('es' in buildCrewPayload(src({ hazardPowerLines: false, hazardStructures: false, permitStatus: null }))).toBe(false);
  });
  it('a recorded hazard whose Spanish is edited by ONE character is not served — the English shows', () => {
    const r = readTwinTable('crew-workorder')!.hazardPowerLines!;
    expect(twinFor(r.en, { es: r.es, enSha: r.enSha })).toBe(r.es);
    expect(twinFor(r.en, { es: oneCharEdit(r.es), enSha: r.enSha })).toBeNull();
  });
  it('once reviewed, the twins ride under es with the same field names — hazards by position — and the English is untouched', () => {
    const p = buildCrewPayload(src({ permitStatus: 'NO_OVERLAY_VERIFY' }));
    const out = crewPayloadTwins(p, reviewedLedger('crew-workorder'));
    const table = readTwinTable('crew-workorder')!;
    expect(out.hazards).toEqual(p.hazards);
    expect(out.permitNote).toBe(p.permitNote);
    expect(out.es).toEqual({ hazards: [table.hazardPowerLines!.es, table.hazardStructures!.es], permitNote: table.noOverlayVerify!.es });
  });
  // Review round (D111, code D2): hazards are matched to their twins BY POSITION. With only the second
  // line reviewed, the first slot is null — never dropped, or STRUCTURES' Spanish would sit over POWER LINES.
  it('only the second hazard reviewed: es.hazards is [null, its Spanish] — the position is kept', () => {
    const p = buildCrewPayload(src({ permitStatus: null }));
    const only = reviewedLedger('crew-workorder').filter((e) => e.en === CREW_LINES.hazardStructures);
    const out = crewPayloadTwins(p, only);
    expect(out.hazards).toEqual([CREW_LINES.hazardPowerLines, CREW_LINES.hazardStructures]);
    expect(out.es).toEqual({ hazards: [null, readTwinTable('crew-workorder')!.hazardStructures!.es] });
  });
  it('a stale twin (English changed since) is never served', () => {
    const p = { ...buildCrewPayload(src()), permitNote: 'PERMIT LIKELY — a changed line.' };
    expect(crewPayloadTwins(p, reviewedLedger('crew-workorder')).es?.permitNote).toBeUndefined();
  });
  it('the payload still has no slot for price, tracking or customer contact — es included', () => {
    const out = crewPayloadTwins(buildCrewPayload(src()), reviewedLedger('crew-workorder')) as unknown as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(/\$\s?\d/);
    expect(Object.keys(out.es as object).sort()).toEqual(['hazards', 'permitNote']);
  });
});

describe('the library — its fixed framing has a twin; what the office wrote is data', () => {
  const entry = { id: 'e1', techniqueName: 'SIM Rigging', skillLevel: 1, howTo: 'SIM how', pros: [], cons: [], wontWorkWhen: null, sourceLink: null, standardRefs: [], published: true };
  it('no limits: the English warning stays, and its Spanish rides under es (not safety-class, so served now)', () => {
    const c = libraryFacing(entry);
    expect(c.limitsWarning).toBe(NO_LIMITS_WARNING);
    expect((c as { es?: Record<string, string> }).es).toEqual({ limitsWarning: readTwinTable('crew-library')!.noLimits!.es });
  });
  it('limits written: no warning and no twin; the office’s words are never twinned', () => {
    const c = libraryFacing({ ...entry, wontWorkWhen: 'SIM limit' });
    expect(c.limitsWarning).toBeNull();
    expect('es' in c).toBe(false);
  });
});

describe('the day’s briefing — the office’s text, with a reviewed twin on its row or none', () => {
  const en = 'SIMULATED tailgate briefing.\nDrop zone stays clear of people while the saw runs — 2 tree lengths.';
  const es = 'Charla de seguridad SIMULADA.\nNadie entra en la zona de caída (drop zone) mientras la motosierra está en marcha — 2 largos de árbol.';
  const good = { text: es, enSha: enSha(en), pass: 'reviewed', translatedBy: 'a', reviewedBy: 'b', backTranslation: 'c', on: '2026-10-22' };
  it('served: the same English, reviewed with a back-translation, clean of the ban list and the gates', () => {
    expect(briefingTwin(en, good)).toBe(es);
  });
  it('not served: none, a draft, no reviewer, no back-translation, a stale English, a dropped number, a banned word', () => {
    expect(briefingTwin(en, undefined)).toBeNull();
    expect(briefingTwin(en, { ...good, pass: 'draft' })).toBeNull();
    expect(briefingTwin(en, { ...good, reviewedBy: '' })).toBeNull();
    expect(briefingTwin(en, { ...good, backTranslation: undefined })).toBeNull();
    expect(briefingTwin(en + ' ', good)).toBeNull();
    expect(briefingTwin(en, { ...good, text: es.replace('2 largos', 'dos largos') })).toBeNull();
    expect(briefingTwin(en, { ...good, text: es + ' Zona libre.' })).toBeNull();
    expect(briefingTwin(en, { ...good, pass: 'person' })).toBeNull(); // "person" names who read it
    expect(briefingTwin(en, { ...good, pass: 'person', readBy: 'Rudy' })).toBe(es);
  });
  // Review round (D111, code D1): the database copy is checked at serving time only, so it gets EVERY
  // gate — a dropped negation, a lost hedge or a lost "at least" / "working days" is not served.
  it('not served: a copy that drops a negation, a hedge, "at least" or "working days" (the full gates, every paragraph)', () => {
    const rec = { pass: 'reviewed', translatedBy: 'a', reviewedBy: 'b', backTranslation: 'c', on: '2026-10-22' };
    const en1 = 'Never work within 10 ft of the hedge row. Wait at least 3 working days after the rain before you use the stump grinder.';
    const es1 = 'Trabaje a 10 ft de la fila de arbustos. Espere 3 días después de la lluvia antes de usar la trituradora de tocones (stump grinder).';
    expect(briefingTwin(en1, { text: es1, enSha: enSha(en1), ...rec })).toBeNull();
    const en2 = 'You may need a second climber.';
    expect(briefingTwin(en2, { text: 'Usted necesita un segundo trepador (climber).', enSha: enSha(en2), ...rec })).toBeNull();
    expect(briefingTwin(en2, { text: 'Puede que necesite un segundo trepador (climber).', enSha: enSha(en2), ...rec })).toBe('Puede que necesite un segundo trepador (climber).');
  });
  it('not served: a copy with a different number of paragraphs, or one whose paragraph moved a number to another paragraph', () => {
    expect(briefingTwin(en, { ...good, text: es.replace('\n', ' ') })).toBeNull();
    const two = 'Wear your hard hat.\nKeep 2 tree lengths back.';
    const moved = 'Use su casco (hard hat) — 2 veces revisado.\nMantenga distancia de largos de árbol.';
    expect(briefingTwin(two, { ...good, text: moved, enSha: enSha(two) })).toBeNull();
  });
  // Review round (D111, design question): a safety line inside the office's own text (911, 811, Dominion,
  // stop work, a badge) needs its review in the committed ledger and the English beneath it — neither
  // exists for per-day text yet, so a copy holding one is never served: the English shows, marked.
  it('not served: a briefing holding any safety-class line, however its review is recorded on the row', () => {
    const s = 'SIMULATED tailgate briefing.\nIf a line comes down, call 911 if anyone is hurt, then Dominion.';
    const sEs = 'Charla de seguridad SIMULADA.\nSi se cae una línea, llame al 911 si alguien está herido, y luego a Dominion.';
    expect(briefingTwin(s, { ...good, text: sEs, enSha: enSha(s) })).toBeNull();
    expect(briefingTwin(s, { ...good, text: sEs, enSha: enSha(s), pass: 'person', readBy: 'Rudy' })).toBeNull();
  });
});

describe('the quiz — a twin only with the same options in the same order, the key re-checked; grading never sees Spanish', () => {
  const item = { prompt: 'SIM: Where does the groundie stand while the climber cuts?', options: ['Under the limb', 'Outside the drop zone', 'By the chipper'] };
  const es = { prompt: 'SIM: ¿Dónde se para el ayudante de tierra (groundie) mientras el trepador (climber) corta?', options: ['Debajo de la rama', 'Fuera de la zona de caída (drop zone)', 'Junto a la astilladora (chipper)'] };
  const good = { ...es, enSha: quizEnSha(item.prompt, item.options), keyCheckedBy: 'b', pass: 'reviewed', translatedBy: 'a', reviewedBy: 'b', on: '2026-10-22' };
  it('served when every rule holds', () => {
    expect(quizTwin(item, good, true)).toEqual(es);
  });
  it('not served: a different count of options, a reordered English, no key check, a draft, a blank option', () => {
    expect(quizTwin(item, { ...good, options: es.options.slice(0, 2) }, true)).toBeNull();
    expect(quizTwin({ ...item, options: [item.options[1]!, item.options[0]!, item.options[2]!] }, good, true)).toBeNull();
    expect(quizTwin(item, { ...good, keyCheckedBy: '' }, true)).toBeNull();
    expect(quizTwin(item, { ...good, pass: 'draft' }, true)).toBeNull();
    expect(quizTwin(item, { ...good, options: ['a', '', 'c'] }, true)).toBeNull();
  });
  it('a lesson (nothing graded) needs no key check, but still its review', () => {
    const lesson = { prompt: 'SIM lesson', options: [] as string[] };
    const tw = { prompt: 'Lección SIM', options: [], enSha: quizEnSha('SIM lesson', []), pass: 'reviewed', translatedBy: 'a', reviewedBy: 'b', on: '2026-10-22' };
    expect(quizTwin(lesson, tw, false)).toEqual({ prompt: 'Lección SIM', options: [] });
    expect(quizTwin(lesson, { ...tw, pass: 'draft' }, false)).toBeNull();
  });
  // Review round (D111, design question): this test said a safety-class question is served once its row
  // names a back-translation. Stricter now (pin moved, D111): the committed ledger cannot hold per-day
  // text and a quiz option has no room for the English beneath, so a safety-class question is never
  // served from its row — the English shows, marked — until Mike rules how those get reviewed.
  it('a safety-class question is never served from its row — not even with a back-translation', () => {
    const s = { prompt: 'SIM: A line is DOWN. Who do you call?', options: ['911 if anyone is hurt, Dominion for the line', 'Nobody'] };
    const tw = { prompt: 'SIM: Una línea está caída (DOWN). ¿A quién llama?', options: ['Al 911 si hay alguien herido, a Dominion por la línea', 'A nadie'], enSha: quizEnSha(s.prompt, s.options), keyCheckedBy: 'b', pass: 'reviewed', translatedBy: 'a', reviewedBy: 'b', on: '2026-10-22' };
    expect(quizTwin(s, tw, true)).toBeNull();
    expect(quizTwin(s, { ...tw, backTranslation: 'c' }, true)).toBeNull();
    expect(quizTwin(s, { ...tw, backTranslation: 'c', pass: 'person', readBy: 'Rudy' }, true)).toBeNull();
  });
  // Review round (D111, code D1): every gate, prompt and every option.
  it('not served: a question or an option that drops a negation or a hedge', () => {
    const q = { prompt: 'SIM: Should you ever cut near a limb without a spotter?', options: ['Yes', 'No, never'] };
    const tw = { prompt: 'SIM: ¿Debe cortar cerca de una rama (limb) sin un observador?', options: ['Sí', 'No, nunca'], enSha: quizEnSha(q.prompt, q.options), keyCheckedBy: 'k', pass: 'reviewed', translatedBy: 'a', reviewedBy: 'b', on: '2026-10-22' };
    expect(quizTwin(q, tw, true)).toEqual({ prompt: tw.prompt, options: tw.options });
    expect(quizTwin(q, { ...tw, prompt: 'SIM: ¿Debe cortar cerca de una rama (limb) con un observador?' }, true)).toBeNull();
    expect(quizTwin(q, { ...tw, options: ['Sí', 'Siempre'] }, true)).toBeNull();
    const h = { prompt: 'SIM: The limb may be hollow. What do you do?', options: ['Sound it first'] };
    const htw = { prompt: 'SIM: La rama (limb) está hueca. ¿Qué hace?', options: ['Golpéela primero para oír'], enSha: quizEnSha(h.prompt, h.options), keyCheckedBy: 'k', pass: 'reviewed', translatedBy: 'a', reviewedBy: 'b', on: '2026-10-22' };
    expect(quizTwin(h, htw, true)).toBeNull();
    expect(quizTwin(h, { ...htw, prompt: 'SIM: La rama (limb) puede estar hueca. ¿Qué hace?' }, true)).toEqual({ prompt: 'SIM: La rama (limb) puede estar hueca. ¿Qué hace?', options: htw.options });
  });
  it('the crew-facing item carries the twin under es; the English prompt and options are untouched', () => {
    const row = { id: 'q1', topic: 'SIM Drop zone', type: 'quiz_question', body: { ...item, answer: 1, es: good } };
    const [c] = quizFacing([row]);
    expect(c!.prompt).toBe(item.prompt);
    expect(c!.options).toEqual(item.options);
    expect(c!.es).toEqual(es);
    const [bare] = quizFacing([{ ...row, body: { ...item, answer: 1 } }]);
    expect('es' in bare!).toBe(false);
  });
  it('grading reads the English key by position, never the Spanish', () => {
    const row = { id: '00000000-0000-4000-8000-000000000001', topic: 'SIM Drop zone', type: 'quiz_question', body: { ...item, answer: 'Outside the drop zone', es: { ...good, options: ['Outside the drop zone', 'x', 'y'] } } };
    expect(gradeSubmission([row], { [row.id]: 1 }).correct).toBe(1);
    expect(gradeSubmission([row], { [row.id]: 0 }).correct).toBe(0);
  });
});

describe('twinFor takes a ledger, so a review can be proven in a test without editing the committed one', () => {
  it('the committed ledger: a draft safety line is held back; the same pair reviewed is served', () => {
    const r = readTwinTable('crew-workorder')!.permitLikely!;
    expect(twinFor(r.en, { es: r.es, enSha: r.enSha })).toBeNull();
    expect(twinFor(r.en, { es: r.es, enSha: r.enSha }, reviewedLedger('crew-workorder'))).toBe(r.es);
  });
});

describe('GET /api/crew/briefing — the stored twin never rides raw; its Spanish rides under es only when served', () => {
  const en = 'SIMULATED tailgate briefing.\nStay out of the drop zone — 2 tree lengths.';
  const es = 'Charla de seguridad SIMULADA.\nNo entre en la zona de caída (drop zone) — 2 largos de árbol.';
  const twin = { text: es, enSha: enSha(en), pass: 'reviewed', translatedBy: 'a', reviewedBy: 'b', backTranslation: 'c', on: '2026-10-22' };
  const get = async (esTwin: unknown) => {
    const { createApi } = await import('../src/server/api.js');
    const src = { ready: () => true, stopsBetween: async () => [], newLeads: async () => [], todaysBriefing: async () => ({ id: '00000000-0000-4000-8000-0000000000b1', body: en, standardRefs: ['Z133 §5.1'], ...(esTwin === undefined ? {} : { esTwin }) }) };
    return (await createApi(src as never).crewBriefing('')).body as Record<string, unknown>;
  };
  it('a reviewed twin: es.body, the English body untouched, no esTwin in the answer', async () => {
    const b = await get(twin);
    expect(b.body).toBe(en);
    expect(b.es).toEqual({ body: es });
    expect('esTwin' in b).toBe(false);
  });
  it('a draft twin, or none: the answer is exactly the English one', async () => {
    const plain = await get(undefined);
    expect(await get({ ...twin, pass: 'draft' })).toEqual(plain);
    expect(Object.keys(plain).sort()).toEqual(['body', 'id', 'requiredSeconds', 'standardRefs']);
  });
});
