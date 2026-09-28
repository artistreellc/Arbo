// Public works & permits knowledge base (R25, Mike 2026-09-28). Pins the
// sourcing rule, the vocabulary law (never "clear"), no price outside `fee`,
// no Suffolk in customer-facing text, and §1B: 'unknown' is never fine.
import { describe, it, expect } from 'vitest';
import { FACTS } from '../src/permitting/publicWorks/facts.js';
import { TOPICS, type Fact } from '../src/permitting/publicWorks/types.js';
import {
  CHECKLIST_STATUSES,
  factById,
  factsByTopic,
  factsFor,
  jobChecklist,
  stale,
  summary,
  type ChecklistItem,
  type JobInput,
  type Maybe,
} from '../src/permitting/publicWorks/query.js';
import { scanForbidden } from '../src/lint/forbiddenStrings.js';
import { loadGuardrails } from '../src/config/loadConfig.js';
import { SERVICE_CITIES } from '../src/lib/address.js';

const MAYBES: Maybe[] = [true, false, 'unknown'];
const BOOLS = [true, false];

// Every input combination, every city — 2,592 checklists. Cheap, and exhaustive.
function allInputs(): JobInput[] {
  const out: JobInput[] = [];
  for (const city of SERVICE_CITIES)
    for (const inRpa of MAYBES)
      for (const nearPowerLines of MAYBES)
        for (const inRightOfWay of MAYBES)
          for (const historicDistrict of MAYBES)
            for (const stumpGrinding of BOOLS)
              for (const haulingDebris of BOOLS)
                for (const burning of BOOLS)
                  out.push({ city, inRpa, nearPowerLines, inRightOfWay, historicDistrict, stumpGrinding, haulingDebris, burning });
  return out;
}
const CHECKLISTS: ChecklistItem[][] = allInputs().map(jobChecklist);
const ITEMS = CHECKLISTS.flat();

const base: JobInput = {
  city: 'Virginia Beach',
  inRpa: false,
  nearPowerLines: false,
  inRightOfWay: false,
  stumpGrinding: false,
  historicDistrict: false,
  haulingDebris: false,
  burning: false,
};

/** Fact fields a customer script could read. `notes` is internal and excluded. */
function customerFacing(f: Fact): Array<{ label: string; text: string }> {
  const out = [
    { label: `${f.id}.title`, text: f.title },
    { label: `${f.id}.rule`, text: f.rule },
  ];
  if (f.whoToCall) out.push({ label: `${f.id}.whoToCall.office`, text: f.whoToCall.office });
  if (f.form) out.push({ label: `${f.id}.form.name`, text: f.form.name });
  if (f.fee) out.push({ label: `${f.id}.fee`, text: f.fee });
  if (f.leadTime) out.push({ label: `${f.id}.leadTime`, text: f.leadTime });
  return out;
}

const NEVER_SAY = [/you['’]re clear/i, /you are clear/i, /no permit needed/i, /no permit required/i, /\bclear\b/i, /\bexempt/i];

describe('publicWorks facts — sourcing', () => {
  it('ids are unique', () => {
    const ids = FACTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every fact has a source, or is UNCONFIRMED with the reason in notes', () => {
    for (const f of FACTS) {
      if (f.sourceUrls.length === 0) expect(f.confidence, f.id).toBe('UNCONFIRMED');
      if (f.confidence === 'UNCONFIRMED') expect(f.notes ?? '', f.id).toMatch(/UNCONFIRMED/);
    }
    // Every fact in this DB does carry at least one source.
    expect(FACTS.filter((f) => f.sourceUrls.length === 0)).toEqual([]);
  });

  it('sources are public URLs or the cities.ts reference', () => {
    for (const f of FACTS)
      for (const u of f.sourceUrls) expect(u, f.id).toMatch(/^(https?:\/\/\S+|arbo:src\/permitting\/cities\.ts)$/);
  });

  it('verifiedOn is the R25 date or the cities.ts date', () => {
    for (const f of FACTS) expect(['2026-09-28', '2026-08-01'], f.id).toContain(f.verifiedOn);
  });

  it('each of the four cities has at least 8 facts', () => {
    for (const city of SERVICE_CITIES) expect(factsFor(city).length, city).toBeGreaterThanOrEqual(8);
  });

  it('every topic has at least one fact', () => {
    for (const t of TOPICS) expect(FACTS.some((f) => f.topic === t), t).toBe(true);
  });

  it('the Norfolk phone conflict is UNCONFIRMED and lists both numbers — never one silently', () => {
    const conflict = factById('nor-cbpa-phone-conflict');
    expect(conflict?.confidence).toBe('UNCONFIRMED');
    expect(conflict?.whoToCall?.phone).toContain('757-664-4368');
    expect(conflict?.whoToCall?.phone).toContain('757-664-4752');
    for (const f of FACTS) {
      const phone = f.whoToCall?.phone ?? '';
      if (phone.includes('757-664-4368') || phone.includes('757-664-4752')) {
        expect(f.confidence, f.id).toBe('UNCONFIRMED');
        expect(phone, f.id).toContain('757-664-4368');
        expect(phone, f.id).toContain('757-664-4752');
      }
    }
  });

  it('the research items are all present', () => {
    const must = [
      'vb-rpa-buffer', 'vb-ppr-tree-removal-form', 'vb-hazard-order', 'vb-row-permit', 'vb-row-resort-closure-ban',
      'vb-landfill-no-commercial-yard-waste', 'vb-no-yard-debris-burning', 'vb-eagle-dwr',
      'nor-cbpa-prune-too', 'nor-specimen-mitigation', 'nor-street-tree-permit', 'nor-row-closure-permit',
      'ches-rpa-canopy', 'ches-dead-tree-discretion', 'ches-exception-hearing', 'ches-2025-manual', 'ches-burn-permit',
      'pts-wqia', 'pts-historic-coa', 'pts-pops', 'pts-row-use-permit',
      'reg-spsa-yard-waste', 'reg-spsa-landfill', 'reg-wetlands-jpa',
      'va-811-notice', 'va-811-stump', 'va-dominion-10ft', 'va-high-voltage-act', 'va-dpor-classes', 'va-4pm-burn-law',
    ];
    for (const id of must) expect(factById(id), id).toBeDefined();
    expect(factById('nor-street-tree-permit')?.whoToCall?.email).toBe('treepermits@norfolk.gov');
    expect(factById('nor-row-closure-permit')?.fee).toMatch(/\$25.*July 1, 2026/);
    expect(factById('nor-row-closure-permit')?.leadTime).toMatch(/7–14 days/);
    expect(factById('pts-historic-coa')?.confidence).toBe('UNCONFIRMED');
    expect(factById('pts-row-use-permit')?.rule).toMatch(/§ 32-59/);
    expect(factById('ches-exception-hearing')?.leadTime).toMatch(/40–45 days/);
    expect(factById('va-dominion-10ft')?.whoToCall?.phone).toBe('1-866-366-4357');
  });
});

describe('publicWorks — vocabulary law and forbidden strings', () => {
  it('no fact anywhere (notes included) says clear / exempt / no permit needed', () => {
    const all = JSON.stringify(FACTS);
    for (const re of NEVER_SAY) expect(all, String(re)).not.toMatch(re);
  });

  it('no checklist line says clear / exempt / no permit needed', () => {
    for (const item of ITEMS) for (const re of NEVER_SAY) expect(`${item.step} ${item.why}`, String(re)).not.toMatch(re);
  });

  it('customer-facing fact text passes the §12 forbidden-string guard (Suffolk, TCIA)', () => {
    const hits = FACTS.flatMap(customerFacing).flatMap(({ label, text }) => scanForbidden(text, label));
    expect(hits).toEqual([]);
  });

  it('no title / rule / step / why names Suffolk; the SPSA landfill keeps it in internal notes only', () => {
    for (const f of FACTS) expect(`${f.title} ${f.rule}`, f.id).not.toMatch(/suffolk/i);
    for (const item of ITEMS) expect(`${item.step} ${item.why}`).not.toMatch(/suffolk/i);
    const landfill = factById('reg-spsa-landfill');
    expect(landfill?.whoToCall?.phone).toBe('757-961-3683');
    expect(landfill?.notes).toMatch(/Suffolk/);
  });

  it('checklist lines pass the §12 forbidden-string guard', () => {
    const hits = ITEMS.flatMap((i) => scanForbidden(`${i.step} ${i.why}`, 'checklist'));
    expect(hits).toEqual([]);
  });

  it('never prices: no-price patterns never match title / rule / step / why (figures live in `fee` only)', () => {
    const noPrice = loadGuardrails().goldenRules.find((r) => r.id === 'no-price');
    expect(noPrice).toBeDefined();
    const patterns = (noPrice?.forbiddenPatterns ?? []).map((p) => new RegExp(p, 'i'));
    expect(patterns.length).toBeGreaterThan(0);
    const texts = new Set([...FACTS.flatMap((f) => [f.title, f.rule]), ...ITEMS.flatMap((i) => [i.step, i.why])]);
    for (const t of texts) for (const re of patterns) expect(t, String(re)).not.toMatch(re);
  });

  it('checklist statuses are only the five allowed words', () => {
    for (const item of ITEMS) expect(CHECKLIST_STATUSES).toContain(item.status);
  });

  it('every checklist factId resolves to a real fact', () => {
    for (const item of ITEMS) for (const id of item.factIds) expect(factById(id), id).toBeDefined();
  });
});

describe('jobChecklist — §1B: unknown is never fine', () => {
  const cases: Array<{ field: 'inRpa' | 'nearPowerLines' | 'inRightOfWay' | 'historicDistrict'; name: RegExp }> = [
    { field: 'inRpa', name: /Resource Protection Area/ },
    { field: 'nearPowerLines', name: /power lines/ },
    { field: 'inRightOfWay', name: /right-of-way/ },
    { field: 'historicDistrict', name: /historic district/ },
  ];
  for (const { field, name } of cases) {
    for (const city of SERVICE_CITIES) {
      it(`${city}: ${field} = 'unknown' → REVIEW NEEDED naming it`, () => {
        const items = jobChecklist({ ...base, city, [field]: 'unknown' });
        const hit = items.find((i) => i.status === 'REVIEW NEEDED' && /^UNKNOWN:/.test(i.step) && name.test(i.step));
        expect(hit, JSON.stringify(items)).toBeDefined();
        expect(hit?.factIds.length).toBeGreaterThan(0);
      });
    }
  }

  it('every unknown input, in every combination, yields its own named REVIEW NEEDED line', () => {
    const inputs = allInputs();
    inputs.forEach((input, n) => {
      const unknownSteps = (CHECKLISTS[n] ?? []).filter((i) => /^UNKNOWN:/.test(i.step));
      const expected = [input.inRpa, input.nearPowerLines, input.inRightOfWay, input.historicDistrict].filter((v) => v === 'unknown').length;
      expect(unknownSteps).toHaveLength(expected);
      for (const s of unknownSteps) expect(s.status).toBe('REVIEW NEEDED');
    });
  });

  it('RPA always yields a line — false is NO OVERLAY–VERIFY, never silence', () => {
    for (const city of SERVICE_CITIES) {
      const items = jobChecklist({ ...base, city });
      const rpa = items.find((i) => i.status === 'NO OVERLAY–VERIFY');
      expect(rpa?.step).toMatch(/verify with the city/);
    }
  });

  it('RPA true → PERMIT LIKELY; Norfolk says pruning too', () => {
    for (const city of SERVICE_CITIES) {
      const items = jobChecklist({ ...base, city, inRpa: true });
      expect(items.some((i) => i.status === 'PERMIT LIKELY' && /Resource Protection Area/.test(i.step))).toBe(true);
    }
    const nor = jobChecklist({ ...base, city: 'Norfolk', inRpa: true }).find((i) => i.status === 'PERMIT LIKELY');
    expect(nor?.why).toMatch(/prune/);
    expect(nor?.factIds).toContain('nor-cbpa-phone-conflict');
  });
});

describe('jobChecklist — fixed rules', () => {
  it('stump grinding always yields TICKET REQUIRED (VA811)', () => {
    const inputs = allInputs();
    inputs.forEach((input, n) => {
      const ticket = (CHECKLISTS[n] ?? []).find((i) => i.status === 'TICKET REQUIRED');
      if (input.stumpGrinding) {
        expect(ticket?.step).toMatch(/VA811/);
        expect(ticket?.factIds).toContain('va-811-stump');
      } else {
        expect(ticket).toBeUndefined();
      }
    });
  });

  it('near power lines yields CALL FIRST with Dominion, first in the list', () => {
    for (const city of SERVICE_CITIES) {
      const items = jobChecklist({ ...base, city, nearPowerLines: true, stumpGrinding: true, inRpa: true });
      expect(items[0]?.status).toBe('CALL FIRST');
      expect(items[0]?.step).toMatch(/Dominion Energy/);
      expect(items[0]?.step).toContain('1-866-366-4357');
      expect(items[0]?.factIds).toContain('va-dominion-10ft');
      expect(items[0]?.factIds).toContain('va-high-voltage-act');
    }
  });

  it('VB right-of-way carries the Oceanfront/Sandbridge closure ban', () => {
    const row = jobChecklist({ ...base, inRightOfWay: true }).find((i) => i.status === 'PERMIT LIKELY');
    expect(row?.why).toMatch(/Oceanfront or Sandbridge from May 1 to Sep 30/);
  });

  it('VB hauling warns the city landfill refuses commercial yard waste', () => {
    const haul = jobChecklist({ ...base, haulingDebris: true }).find((i) => i.status === 'CALL FIRST');
    expect(haul?.why).toMatch(/no commercial yard waste/);
    expect(haul?.factIds).toContain('reg-spsa-yard-waste');
  });

  it('burning: VB not approved, Chesapeake needs a permit, the 4 PM law is always cited', () => {
    const vb = jobChecklist({ ...base, burning: true }).at(-1);
    expect(vb?.step).toMatch(/not approved/);
    expect(vb?.status).toBe('REVIEW NEEDED');
    const ches = jobChecklist({ ...base, city: 'Chesapeake', burning: true }).at(-1);
    expect(ches?.status).toBe('PERMIT LIKELY');
    for (const city of SERVICE_CITIES) expect(jobChecklist({ ...base, city, burning: true }).at(-1)?.factIds).toContain('va-4pm-burn-law');
  });

  it('UNCONFIRMED facts are marked as such in the why', () => {
    const hist = jobChecklist({ ...base, city: 'Portsmouth', historicDistrict: true }).find((i) => /historic/.test(i.step));
    expect(hist?.why).toMatch(/\(UNCONFIRMED\)/);
  });
});

describe('queries', () => {
  it('factsByTopic merges city + Regional + Virginia, in that order', () => {
    const disposal = factsByTopic('Norfolk', 'disposal');
    expect(disposal.map((f) => f.city)).toEqual(['Norfolk', 'Regional', 'Regional', 'Regional']);
    expect(factsByTopic('Chesapeake', 'power_lines').every((f) => f.city === 'Virginia')).toBe(true);
    expect(factsByTopic('Portsmouth', 'private_tree_cbpa').every((f) => f.city === 'Portsmouth')).toBe(true);
  });

  it('factsFor is exact-scope', () => {
    expect(factsFor('Regional').every((f) => f.city === 'Regional')).toBe(true);
    expect(factsFor('Virginia').length).toBeGreaterThan(0);
  });

  it('stale: nothing on the build date; cities.ts copies first; everything by next year', () => {
    expect(stale(FACTS, '2026-09-28')).toEqual([]);
    const nov = stale(FACTS, new Date('2026-11-15T12:00:00Z'));
    expect(nov.length).toBeGreaterThan(0);
    expect(nov.every((f) => f.verifiedOn === '2026-08-01')).toBe(true);
    expect(stale(FACTS, '2027-01-01')).toHaveLength(FACTS.length);
  });

  it('summary counts add up', () => {
    const s = summary();
    expect(s.total).toBe(FACTS.length);
    const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
    expect(sum(s.byCity)).toBe(FACTS.length);
    expect(sum(s.byTopic)).toBe(FACTS.length);
    expect(s.byConfidence.SOURCED + s.byConfidence.UNCONFIRMED).toBe(FACTS.length);
    expect(s.byConfidence.UNCONFIRMED).toBeGreaterThan(0);
  });
});
