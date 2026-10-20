// R26 (Mike, 2026-10-20) — package facts-stormlaw. Pins:
// A) the research-package facts went in UNCONFIRMED, each saying so in its
//    notes, in the permit vocabulary, with no price outside `fee`, no
//    diagnosis, no Suffolk and no TCIA; they ride the checklist as links and
//    never become its words; the power-line wording is never loosened.
// B) the owner-only storm-law flag: OpenFEMA read-only, one sentence when
//    active, a failed read named 'unreadable' — never 'none' — and no price.
//    No test here touches the network: every fetch is a fake.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { FACTS } from '../src/permitting/publicWorks/facts.js';
import { TOPICS, type Fact } from '../src/permitting/publicWorks/types.js';
import { factById, factsByTopic, jobChecklist, summary, type JobInput } from '../src/permitting/publicWorks/query.js';
import { permitsDb } from '../src/server/r25Routes.js';
import { scanForbidden } from '../src/lint/forbiddenStrings.js';
import { loadGuardrails } from '../src/config/loadConfig.js';
import { SERVICE_CITIES } from '../src/lib/address.js';
import {
  createStormLawCheck,
  judgeDeclarations,
  GOVERNOR_NOTE,
  OPENFEMA_PAGE,
  openFemaUrl,
  STORM_LAW_CACHE_MS,
  STORM_LAW_FLAG,
  STORM_LAW_TAIL_DAYS,
  STORM_LAW_TIMEOUT_MS,
  type StormLawFetch,
  type StormLawStatus,
} from '../src/ops/stormLaw.js';

const GROK_NOTE =
  'UNCONFIRMED: From a third-party research package (2026-09-28); not yet checked by Arbo — verify with the source before relying on it.';

// The dig-site duties came from the package but were then read against the
// Code text by Arbo (2026-10-20), so they are SOURCED, not in this list.
const NEW_IDS = [
  'reg-fire-ant-quarantine',
  'va-hvl-408-10ft',
  'va-hvl-409-sign',
  'va-hvl-410-arrangements',
  'va-hvl-411-notice',
  'va-hvl-413-utility-crews',
  'va-osha-1910-333',
  'va-slf-quarantine-repealed',
  'va-eab-quarantines-ended',
  'reg-spongy-moth-area',
  'va-forest-health-reports',
  'reg-crapemyrtle-bark-scale',
];
const fact = (id: string): Fact => {
  const f = factById(id);
  if (!f) throw new Error(`missing fact ${id}`);
  return f;
};
const NEW = NEW_IDS.map(fact);
const words = (f: Fact) => `${f.title} ${f.rule}`;

const guardrails = loadGuardrails();
const patterns = (id: string) =>
  (guardrails.goldenRules.find((r) => r.id === id)?.forbiddenPatterns ?? []).map((p) => new RegExp(p, 'i'));
const NO_PRICE = patterns('no-price');
const NO_DIAGNOSIS = patterns('no-diagnosis');
const NEVER_SAY = [/you['’]re clear/i, /you are clear/i, /no permit needed/i, /no permit required/i, /\bclear(ed)?\b/i, /\bexempt/i];

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

describe('R26 facts — every one UNCONFIRMED and says why', () => {
  it('all twelve are present, UNCONFIRMED, carry the package note, and cite public URLs', () => {
    expect(new Set(NEW_IDS).size).toBe(NEW_IDS.length);
    for (const f of NEW) {
      expect(f.confidence, f.id).toBe('UNCONFIRMED');
      expect(f.notes?.startsWith(GROK_NOTE), f.id).toBe(true);
      expect(f.verifiedOn, f.id).toBe('2026-09-28');
      expect(f.sourceUrls.length, f.id).toBeGreaterThan(0);
      for (const u of f.sourceUrls) expect(u, f.id).toMatch(/^https:\/\/\S+$/);
    }
  });

  it('no title or rule holds a price, a diagnosis, clear / exempt, Suffolk or TCIA', () => {
    for (const f of NEW) {
      for (const re of [...NO_PRICE, ...NO_DIAGNOSIS]) expect(words(f), `${f.id} ${re}`).not.toMatch(re);
      // Notes included: the whole fact never says clear or exempt.
      for (const re of NEVER_SAY) expect(JSON.stringify(f), `${f.id} ${re}`).not.toMatch(re);
      expect(scanForbidden(`${words(f)} ${f.whoToCall?.office ?? ''} ${f.fee ?? ''}`, f.id)).toEqual([]);
      // Suffolk stays out of these facts entirely, notes included.
      expect(JSON.stringify(f), f.id).not.toMatch(/suffolk/i);
    }
    expect(NO_PRICE.length).toBeGreaterThan(0);
    expect(NO_DIAGNOSIS.length).toBeGreaterThan(0);
  });
});

describe('R26 facts — what each one says', () => {
  it('VA811 dig-site duties (§ 56-265.24): read against the Code text, SOURCED; 2-ft hand dig, call again + 3 hours, stop / notify / no backfill; dollars only in fee', () => {
    const f = fact('va-811-dig-site-duties');
    expect(f.topic).toBe('utility_811');
    expect(f.city).toBe('Virginia');
    expect(f.confidence).toBe('SOURCED');
    expect(f.verifiedOn).toBe('2026-10-20');
    expect(f.title).toContain('§ 56-265.24');
    expect(f.rule).toMatch(/every utility on the ticket has responded/);
    expect(f.rule).toMatch(/2 ft of either side of a utility mark, expose the line by hand digging/);
    expect(f.rule).toMatch(/machines \(the stump grinder included\) 2 ft from any exposed line/);
    expect(f.rule).toMatch(/call VA811 again and do not dig there until 3 hours after that call/);
    expect(f.rule).toMatch(/stop, notify the line's operator immediately, and do not backfill/);
    expect(f.fee).toMatch(/§ 56-265\.32/);
    expect(f.fee).toMatch(/\$10,000/);
    expect(f.fee).toMatch(/\$5,000/);
    for (const re of NEVER_SAY) expect(JSON.stringify(f), `${re}`).not.toMatch(re);
    expect(words(f)).not.toMatch(/\$/);
    expect(f.sourceUrls).toContain('https://law.lis.virginia.gov/vacode/title56/chapter10.3/section56-265.24/');
  });

  it('imported fire ant quarantine: all four cities, soil-bearing logs and used stump grinders, certificate or compliance agreement', () => {
    const f = fact('reg-fire-ant-quarantine');
    expect(f.topic).toBe('disposal');
    expect(f.city).toBe('Regional');
    for (const c of SERVICE_CITIES) expect(f.rule).toContain(c);
    expect(f.rule).toMatch(/May 27, 2025/);
    expect(f.rule).toMatch(/Logs and pulpwood with soil attached/);
    expect(f.rule).toMatch(/stump grinder/);
    expect(f.rule).toMatch(/certificate or a compliance agreement/);
    expect(f.whoToCall?.office).toMatch(/VDACS/);
  });

  it('power-line law by section: 408, 409, 410, 411, 413 and 29 CFR 1910.333(c)(3)', () => {
    expect(fact('va-hvl-408-10ft').title).toContain('§ 59.1-408');
    expect(fact('va-hvl-408-10ft').rule).toMatch(/within 10 ft/);
    expect(fact('va-hvl-409-sign').title).toContain('§ 59.1-409');
    expect(fact('va-hvl-409-sign').rule).toMatch(/warning sign/);
    expect(fact('va-hvl-410-arrangements').title).toContain('§ 59.1-410');
    expect(fact('va-hvl-410-arrangements').rule).toMatch(/complete before the work starts/);
    expect(fact('va-hvl-411-notice').title).toContain('§ 59.1-411');
    expect(fact('va-hvl-411-notice').rule).toMatch(/does not start on the date in the notice, a new notice is needed/);
    expect(fact('va-hvl-413-utility-crews').title).toContain('§ 59.1-413');
    expect(fact('va-hvl-413-utility-crews').rule).toMatch(/Every other crew follows them in full/);
    const osha = fact('va-osha-1910-333');
    expect(osha.title).toContain('1910.333(c)(3)');
    expect(osha.rule).toMatch(/10 ft .* 50 kV or less, plus 4 in\. for every 10 kV over 50 kV/);
    expect(osha.rule).toMatch(/does not loosen Arbo's rule/);
    for (const id of NEW_IDS.filter((i) => i.startsWith('va-hvl-') || i === 'va-osha-1910-333')) {
      expect(fact(id).topic, id).toBe('power_lines');
      expect(fact(id).city, id).toBe('Virginia');
    }
  });

  it('the voltage wording is never loosened: rules say "600 V or more"; the statute\'s "in excess of 600 volts" lives in notes', () => {
    for (const f of factsByTopic('Norfolk', 'power_lines')) {
      expect(f.rule, f.id).not.toMatch(/in excess of 600|more than 600|over 600|above 600/i);
    }
    expect(fact('va-high-voltage-act').rule).toMatch(/600 V or more/);
    expect(fact('va-hvl-408-10ft').rule).toMatch(/600 V or more/);
    expect(fact('va-high-voltage-act').notes).toMatch(/in excess of 600 volts/);
    expect(fact('va-hvl-408-10ft').notes).toMatch(/in excess of 600 volts/);
    // The existing fact keeps its sourcing; only a note was added.
    expect(fact('va-high-voltage-act').confidence).toBe('SOURCED');
  });

  it('pest regulatory status is its own topic, a status and a report line — never a verdict on a tree', () => {
    expect(TOPICS).toContain('pests_quarantine');
    const pests = FACTS.filter((f) => f.topic === 'pests_quarantine');
    expect(pests.map((f) => f.id).sort()).toEqual(
      ['reg-crapemyrtle-bark-scale', 'reg-spongy-moth-area', 'va-eab-quarantines-ended', 'va-forest-health-reports', 'va-slf-quarantine-repealed'],
    );
    expect(summary().byTopic.pests_quarantine).toBe(5);
    for (const f of pests) expect(words(f), f.id).not.toMatch(/sever|remov|cut (it )?down|take (it )?down|diagnos|infest|dying|\bdead\b/i);
    expect(fact('va-slf-quarantine-repealed').rule).toMatch(/repealed effective Mar 27, 2025\. Sightings should still be reported/);
    expect(fact('va-eab-quarantines-ended').rule).toMatch(/Jan 14, 2021/);
    expect(fact('va-eab-quarantines-ended').rule).toMatch(/Dec 28, 2012/);
    expect(fact('reg-spongy-moth-area').rule).toMatch(/Hampton Roads .* 2VAC5-330-30/);
    expect(fact('va-forest-health-reports').rule).toMatch(/laurel wilt .* beech leaf disease .* Virginia Department of Forestry, Forest Health/);
    expect(fact('reg-crapemyrtle-bark-scale').rule).toMatch(/first found in Virginia in Chesapeake, in 2014/);
  });
});

describe('R26 facts — on the Permit Desk, as links, never as the checklist\'s words', () => {
  it('the city base serves them with the regional and state rules', () => {
    for (const city of SERVICE_CITIES) {
      const ids = ((permitsDb(city).body as { facts: Fact[] }).facts).map((f) => f.id);
      for (const id of NEW_IDS) expect(ids, `${city} ${id}`).toContain(id);
    }
  });

  it('stump grinding links the dig-site duties; hauling links the fire ant quarantine; power lines link every section', () => {
    for (const city of SERVICE_CITIES) {
      const items = jobChecklist({ ...base, city, stumpGrinding: true, haulingDebris: true, nearPowerLines: true });
      const ticket = items.find((i) => i.status === 'TICKET REQUIRED');
      expect(ticket?.factIds, city).toContain('va-811-dig-site-duties');
      const haul = items.find((i) => i.step.includes('drop-off site'));
      expect(haul?.factIds, city).toContain('reg-fire-ant-quarantine');
      const power = items.find((i) => i.safety);
      for (const id of ['va-hvl-408-10ft', 'va-hvl-409-sign', 'va-hvl-410-arrangements', 'va-hvl-411-notice', 'va-hvl-413-utility-crews', 'va-osha-1910-333']) {
        expect(power?.factIds, `${city} ${id}`).toContain(id);
      }
      // Lead facts first: the step still opens on its sourced rules.
      expect(power?.factIds.slice(0, 2)).toEqual(['va-dominion-10ft', 'va-high-voltage-act']);
      expect(ticket?.factIds.slice(0, 2)).toEqual(['va-811-stump', 'va-811-notice']);
    }
  });

  it('no checklist line is worded from an unchecked package fact', () => {
    const items = SERVICE_CITIES.flatMap((city) =>
      jobChecklist({ ...base, city, stumpGrinding: true, haulingDebris: true, nearPowerLines: true }),
    );
    for (const i of items) {
      for (const f of NEW) expect(`${i.step} ${i.why}`, `${f.id} in "${i.step}"`).not.toContain(f.rule);
    }
  });
});

// ── B) storm-law flag ───────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const row = (over: Row = {}): Row => ({
  state: 'VA',
  disasterNumber: 3631,
  femaDeclarationString: 'EM-3631-VA',
  declarationType: 'EM',
  declarationTitle: 'SEVERE WINTER STORM',
  declarationDate: '2026-01-23T00:00:00.000Z',
  incidentEndDate: null,
  designatedArea: 'Virginia Beach (Independent City)',
  fipsCountyCode: '810',
  ...over,
});
const FOUR_CITIES: Row[] = [
  row(),
  row({ designatedArea: 'Norfolk (Independent City)', fipsCountyCode: '710' }),
  row({ designatedArea: 'Chesapeake (Independent City)', fipsCountyCode: '550' }),
  row({ designatedArea: 'Portsmouth (Independent City)', fipsCountyCode: '740' }),
];
const ELSEWHERE: Row = row({ disasterNumber: 4801, declarationTitle: 'FLOODING', designatedArea: 'Buchanan (County)', fipsCountyCode: '027' });

function fakeFetch(answer: { ok?: boolean; status?: number; body?: unknown; throws?: boolean; badJson?: boolean }) {
  const calls: string[] = [];
  const fn: StormLawFetch = async (url) => {
    calls.push(url);
    if (answer.throws) throw new Error('network down');
    return {
      ok: answer.ok ?? true,
      status: answer.status ?? 200,
      json: async () => {
        if (answer.badJson) throw new SyntaxError('Unexpected token <');
        return answer.body;
      },
    };
  };
  return { fn, calls };
}
const fema = (rows: Row[]) => ({ metadata: { skip: 0, top: OPENFEMA_PAGE }, DisasterDeclarationsSummaries: rows });
const FEMA_BASE = 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?';

function expectNoPrice(s: StormLawStatus): void {
  const text = JSON.stringify(s);
  for (const re of NO_PRICE) expect(text, String(re)).not.toMatch(re);
  expect(Object.keys(s).sort()).toEqual(['checkedAt', 'declarations', 'flag', 'governorNote', 'reason', 'state']);
}

describe('storm-law flag — what FEMA says', () => {
  it('asks OpenFEMA, read-only, for Virginia incidents open or ended within the last 30 days — dated from the injected clock', async () => {
    const at = new Date('2026-10-20T12:00:00Z');
    const url = openFemaUrl(at);
    expect(url.startsWith(FEMA_BASE + '$filter=')).toBe(true);
    expect(decodeURIComponent(url)).toContain("state eq 'VA' and (incidentEndDate eq null or incidentEndDate ge '2026-09-20T12:00:00.000Z')");
    expect(url.endsWith(`&$top=${OPENFEMA_PAGE}`)).toBe(true);
    expect(STORM_LAW_TAIL_DAYS).toBe(30);
    const { fn, calls } = fakeFetch({ body: fema([]) });
    await createStormLawCheck(fn, () => at).status();
    expect(calls).toEqual([url]);
    // Built per read, never once at load: a later clock asks from a later date.
    expect(decodeURIComponent(openFemaUrl(new Date('2026-11-01T00:00:00Z')))).toContain("incidentEndDate ge '2026-10-02T00:00:00.000Z'");
  });

  it('the statute’s 30-day tail (§ 59.1-526 (ii)): an incident that ended within 30 days still flags; one that ended earlier does not', async () => {
    const now = new Date('2026-10-12T12:00:00Z');
    // FEMA often declares after the incident period has already closed (declared 10-08 for an incident that ended 10-03).
    const hurricane = (end: unknown) => fema([row({ disasterNumber: 4901, declarationType: 'DR', declarationTitle: 'HURRICANE', declarationDate: '2026-10-08T00:00:00.000Z', incidentEndDate: end })]);
    expect(judgeDeclarations(hurricane('2026-10-03T00:00:00.000Z'), now)).toEqual({
      state: 'active', declarations: [{ number: 4901, title: 'HURRICANE', declared: '2026-10-08T00:00:00.000Z' }], reason: null,
    });
    // Thirty days to the millisecond still counts; a millisecond more does not.
    expect(judgeDeclarations(hurricane('2026-09-12T12:00:00.000Z'), now).state).toBe('active');
    expect(judgeDeclarations(hurricane('2026-09-12T11:59:59.999Z'), now).state).toBe('none');
    // Through the check, the date is the injected clock's — not the machine's.
    const soon = fakeFetch({ body: hurricane('2026-10-03T00:00:00.000Z') });
    expect(await createStormLawCheck(soon.fn, () => now).status()).toMatchObject({ state: 'active', flag: STORM_LAW_FLAG });
    const late = fakeFetch({ body: hurricane('2026-10-03T00:00:00.000Z') });
    expect(await createStormLawCheck(late.fn, () => new Date('2026-11-02T00:00:00.001Z')).status()).toMatchObject({ state: 'none', flag: null });
  });

  it('active: a declaration covering the four cities is ONE declaration, and the one sentence', async () => {
    const { fn } = fakeFetch({ body: fema([...FOUR_CITIES, ELSEWHERE]) });
    const s = await createStormLawCheck(fn, () => new Date('2026-10-20T12:00:00Z')).status();
    expect(s.state).toBe('active');
    expect(s.declarations).toEqual([{ number: 3631, title: 'SEVERE WINTER STORM', declared: '2026-01-23T00:00:00.000Z' }]);
    expect(s.flag).toBe('Virginia post-disaster price law in effect — check with counsel');
    expect(s.flag).toBe(STORM_LAW_FLAG);
    expect(s.governorNote).toBe('Governor declarations are not in any feed Arbo can read — check governor.virginia.gov.');
    expect(s.checkedAt).toBe('2026-10-20T12:00:00.000Z');
    expect(s.reason).toBeNull();
    expectNoPrice(s);
  });

  it('active: one city alone, a statewide designation, or a FIPS code with an odd area name', () => {
    expect(judgeDeclarations(fema([row({ designatedArea: 'Portsmouth (Independent City)', fipsCountyCode: '740' })])).state).toBe('active');
    expect(judgeDeclarations(fema([row({ designatedArea: 'Statewide', fipsCountyCode: '000' })])).state).toBe('active');
    expect(judgeDeclarations(fema([row({ designatedArea: 'City of Norfolk', fipsCountyCode: '710' })])).state).toBe('active');
    expect(judgeDeclarations(fema([row({ designatedArea: undefined, fipsCountyCode: '000' })])).state).toBe('active');
  });

  it('none: only other places, or nothing open — no flag, and the Governor note still rides', async () => {
    const { fn } = fakeFetch({ body: fema([ELSEWHERE]) });
    const s = await createStormLawCheck(fn).status();
    expect(s.state).toBe('none');
    expect(s.declarations).toEqual([]);
    expect(s.flag).toBeNull();
    expect(s.governorNote).toBe(GOVERNOR_NOTE);
    expectNoPrice(s);
    expect(judgeDeclarations(fema([])).state).toBe('none');
    // Names that only start like a service city are other places.
    expect(judgeDeclarations(fema([row({ designatedArea: 'Norfolk County Historical', fipsCountyCode: '999' })])).state).toBe('none');
    // '000' beside some other named area is not taken as statewide.
    expect(judgeDeclarations(fema([row({ designatedArea: 'Pamunkey Indian Tribe', fipsCountyCode: '000' })])).state).toBe('none');
  });

  it('a row FEMA should not have sent never counts: another state, or an incident that ended more than 30 days ago', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(judgeDeclarations(fema([row({ state: 'NC', designatedArea: 'Statewide', fipsCountyCode: '000' })]), now).state).toBe('none');
    expect(judgeDeclarations(fema([row({ incidentEndDate: '2026-02-01T00:00:00.000Z' })]), now).state).toBe('none');
    // An end date Arbo cannot read on a row for somewhere else changes nothing for the four cities.
    expect(judgeDeclarations(fema([{ ...ELSEWHERE, incidentEndDate: 'soon' }]), now).state).toBe('none');
  });

  it('a fire management (FM) grant is not a President\'s declaration; EM and DR are', () => {
    expect(judgeDeclarations(fema([row({ declarationType: 'FM' })])).state).toBe('none');
    expect(judgeDeclarations(fema([row({ declarationType: 'EM' })])).state).toBe('active');
    expect(judgeDeclarations(fema([row({ declarationType: 'DR' })])).state).toBe('active');
  });
});

describe('storm-law flag — §1B: a failed read is named "unreadable", never "none"', () => {
  const failures: Array<[string, Parameters<typeof fakeFetch>[0], RegExp]> = [
    ['HTTP error', { ok: false, status: 503 }, /HTTP 503/],
    ['network failure', { throws: true }, /could not reach FEMA/],
    ['not JSON', { badJson: true }, /not readable/],
    ['no declarations list', { body: { error: 'bad filter' } }, /did not carry a declarations list/],
    ['empty body', { body: null }, /did not carry a declarations list/],
    ['a full page', { body: fema(Array.from({ length: OPENFEMA_PAGE }, () => ELSEWHERE)) }, /full page/],
    ['an entry that is not an object', { body: fema([42 as unknown as Row]) }, /could not read/],
    ['a row with no area at all', { body: fema([row({ designatedArea: undefined, fipsCountyCode: undefined })]) }, /without saying where/],
    ['a covering row with no number', { body: fema([row({ disasterNumber: '3631' })]) }, /service cities that Arbo could not read/],
    // Neither guessed open nor guessed past the 30-day tail.
    ['a covering row whose incident end is not a date', { body: fema([row({ incidentEndDate: 'not a date' })]) }, /incident end Arbo could not read/],
    ['a covering row whose incident end is not text', { body: fema([row({ incidentEndDate: 20261003 })]) }, /incident end Arbo could not read/],
  ];
  for (const [name, answer, reason] of failures) {
    it(`${name} → unreadable, with its reason, no flag, the Governor note`, async () => {
      const { fn } = fakeFetch(answer);
      const s = await createStormLawCheck(fn).status();
      expect(s.state).toBe('unreadable');
      expect(s.state).not.toBe('none');
      expect(s.reason).toMatch(reason);
      expect(s.declarations).toEqual([]);
      expect(s.flag).toBeNull();
      expect(s.governorNote).toBe(GOVERNOR_NOTE);
      expectNoPrice(s);
    });
  }

  it('a fetch that throws before it even returns a promise is still caught', async () => {
    const fn = ((): never => { throw new Error('sync boom'); }) as unknown as StormLawFetch;
    await expect(createStormLawCheck(fn).status()).resolves.toMatchObject({ state: 'unreadable' });
  });

  it('a FEMA that never answers is named unreadable after the timeout, not a page left hanging', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const fn: StormLawFetch = () => new Promise(() => {});
      const pending = createStormLawCheck(fn).status();
      await vi.advanceTimersByTimeAsync(STORM_LAW_TIMEOUT_MS);
      const s = await pending;
      expect(s.state).toBe('unreadable');
      expect(s.reason).toMatch(/did not answer in time/);
      expect(s.flag).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('one deadline covers the whole read: a FEMA that answers but never finishes its body is named unreadable on time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      let calls = 0;
      const fn: StormLawFetch = async () => {
        calls += 1;
        return { ok: true, status: 200, json: () => new Promise<never>(() => {}) }; // headers, then the body stalls
      };
      const check = createStormLawCheck(fn);
      const answers: StormLawStatus[] = [];
      void check.status().then((s) => answers.push(s));
      void check.status().then((s) => answers.push(s)); // a second ask shares the one stalled read
      await vi.advanceTimersByTimeAsync(STORM_LAW_TIMEOUT_MS - 1);
      expect(answers).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(answers).toHaveLength(2);
      for (const s of answers) {
        expect(s.state).toBe('unreadable');
        expect(s.reason).toMatch(/did not answer in time/);
        expect(s.flag).toBeNull();
        expect(s.governorNote).toBe(GOVERNOR_NOTE);
      }
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('storm-law flag — cached for an hour', () => {
  it('a good answer is kept an hour, then FEMA is asked again', async () => {
    let t = Date.parse('2026-10-20T12:00:00Z');
    const { fn, calls } = fakeFetch({ body: fema(FOUR_CITIES) });
    const check = createStormLawCheck(fn, () => new Date(t));
    const first = await check.status();
    t += STORM_LAW_CACHE_MS - 1;
    const second = await check.status();
    expect(calls).toHaveLength(1);
    expect(second).toEqual(first);
    expect(second.checkedAt).toBe('2026-10-20T12:00:00.000Z'); // a cached answer keeps its own time
    t += 1;
    await check.status();
    expect(calls).toHaveLength(2);
    expect(STORM_LAW_CACHE_MS).toBe(60 * 60 * 1000);
  });

  it('a failed read is not kept — the next ask tries FEMA again, and an old good answer is never served stale', async () => {
    let t = Date.parse('2026-10-20T12:00:00Z');
    let down = false;
    const calls: string[] = [];
    const fn: StormLawFetch = async (url) => {
      calls.push(url);
      return { ok: !down, status: down ? 502 : 200, json: async () => fema([ELSEWHERE]) };
    };
    const check = createStormLawCheck(fn, () => new Date(t));
    expect((await check.status()).state).toBe('none');
    down = true;
    t += STORM_LAW_CACHE_MS;
    expect((await check.status()).state).toBe('unreadable');
    expect((await check.status()).state).toBe('unreadable');
    expect(calls).toHaveLength(3);
    down = false;
    expect((await check.status()).state).toBe('none');
  });

  it('asks at the same moment share one FEMA read', async () => {
    const { fn, calls } = fakeFetch({ body: fema([]) });
    const check = createStormLawCheck(fn);
    const [a, b] = await Promise.all([check.status(), check.status()]);
    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
  });
});

// ── the route ───────────────────────────────────────────────────────────────

const saved = { ...process.env };
afterAll(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function serve(envOverrides: Record<string, string | undefined>): Promise<{ base: string; srv: Server }> {
  vi.resetModules();
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { createArborRequestHandler } = await import('../src/server.js');
  const srv = createServer(createArborRequestHandler());
  await new Promise<void>((r) => srv.listen(0, r));
  const addr = srv.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, srv };
}

describe('GET /api/storm/law', () => {
  it('admin key only — the crew key and no key are refused; FEMA is faked, never fetched', async () => {
    const realFetch = globalThis.fetch;
    const outside: string[] = [];
    vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
      outside.push(url);
      if (url.startsWith(FEMA_BASE)) {
        return Promise.resolve(new Response(JSON.stringify(fema(FOUR_CITIES)), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return Promise.resolve(new Response('no network in tests', { status: 599 }));
    });
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', ARBO_DATA_LINKS: undefined });
    try {
      const get = (k?: string) => fetch(base + '/api/storm/law', { headers: k ? { 'x-arbor-key': k } : {} });
      const crew = await get('crew-k');
      expect(crew.status).toBe(401);
      expect(await crew.json()).toEqual({ error: 'unauthorized' });
      expect((await get()).status).toBe(401);
      expect(outside).toEqual([]); // a refused ask never reaches FEMA
      const r = await get('admin-k');
      expect(r.status).toBe(200);
      const body = (await r.json()) as StormLawStatus;
      expect(body.state).toBe('active');
      expect(body.flag).toBe(STORM_LAW_FLAG);
      expect(body.declarations).toEqual([{ number: 3631, title: 'SEVERE WINTER STORM', declared: '2026-01-23T00:00:00.000Z' }]);
      expect(body.governorNote).toBe(GOVERNOR_NOTE);
      // One FEMA read, dated from the server's own clock (30 days back from now).
      expect(outside).toHaveLength(1);
      expect(decodeURIComponent(outside[0]!)).toMatch(
        /^https:\/\/www\.fema\.gov\/api\/open\/v2\/DisasterDeclarationsSummaries\?\$filter=state eq 'VA' and \(incidentEndDate eq null or incidentEndDate ge '\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z'\)&\$top=1000$/,
      );
      // Second ask within the hour: served from the cache, FEMA not asked again.
      expect((await get('admin-k')).status).toBe(200);
      expect(outside).toHaveLength(1);
    } finally {
      srv.close();
      vi.unstubAllGlobals();
    }
  });
});

describe('VA811 notice — corrected from the Code text (2026-10-20)', () => {
  it('marks are due 7:00 a.m. on the third working day, and nobody digs before every utility responds', () => {
    const f = fact('va-811-notice');
    expect(f.confidence).toBe('SOURCED');
    expect(f.verifiedOn).toBe('2026-10-20');
    expect(f.rule).toMatch(/7:00 a\.m\. on the third working day/);
    expect(f.rule).toMatch(/Dig only after every utility on the ticket has posted its response/);
    expect(f.rule).not.toMatch(/\b2 working days|48 hours from 7:00/);
    expect(f.sourceUrls).toContain('https://law.lis.virginia.gov/vacode/title56/chapter10.3/section56-265.19/');
    const step = jobChecklist({ ...base, stumpGrinding: true }).find((i) => i.status === 'TICKET REQUIRED');
    expect(step?.step).toMatch(/at least 3 working days before grinding the stump, and grind only after every utility on the ticket has responded/);
  });
});
