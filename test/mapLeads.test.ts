// Maps wave B, M3 (docs/MAPS_PLAN.md "M3 Leads & jobs"): open leads on the
// map, grouped by ZIP AREA — never by address. The layer makes the Leads tab's
// own read (/api/leads?limit=50) and keeps only what it draws: id, name, ZIP,
// city, age, older, emergency and status — never a phone, the details or a
// street. A lead is placed only at its ZIP area (the Census table; the ZIP
// from the lead's property record, Q15), and no geocoder is asked. Outside
// practice the layer opens with the Leads tab's own "not fed" line (R4); older
// leads are hidden and counted before any count or empty line (Q6); a failed
// read is the Leads tab's own feed word and draws no marker (§1B). Jobs live
// on Google Calendar (R2, Q14); Arbo's job records are named as not drawn.
// A tap on a name opens that lead in Leads — the message carries its id only.
import { describe, it, expect } from 'vitest';
import { loadMapHtml, loadAppHtml } from '../src/server/appPage.js';
import { ZIP_CENTROIDS, ZIP_NO_AREA, ZCTA_SOURCE } from '../src/lib/zipCentroids.js';

const page = loadMapHtml();
// R27 Phase A (es-owner-a): the Spanish runtime is inlined just before the page's own script — the page's is the last.
const script = [...page.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)].at(-1)![1]!;
const shell = loadAppHtml();
function srcOf(text: string, name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(text);
  if (!m) throw new Error(`no function ${name}`);
  return m[0];
}
function frameFn<T>(name: string, deps: Record<string, unknown> = {}): T {
  return new Function(...Object.keys(deps), `${srcOf(script, name)}\nreturn ${name};`)(...Object.values(deps)) as T;
}
function constBlock<T>(name: string): T {
  const at = script.indexOf(`\nconst ${name} = {`);
  if (at < 0) throw new Error(`no const ${name} block in the map page`);
  const end = script.indexOf('\n};', at);
  return new Function(`return (${script.slice(script.indexOf('{', at), end + 2)});`)() as T;
}
const MAP_SAYS = constBlock<Record<string, string>>('MAP_SAYS');
const ZIPS = { zips: ZIP_CENTROIDS, noArea: ZIP_NO_AREA, checked: ZCTA_SOURCE.checked };

type Kept = { id: string; name: string | null; zip: string | null; city: string | null; ageDays: number | null; older: boolean; emergency: boolean; status: string | null };
type Group = { zip: string; lat: number; lon: number; leads: Kept[] };
const keepLead = frameFn<(l: Record<string, unknown>) => Kept>('keepLead');
const leadPlace = frameFn<(zip: unknown, zips: typeof ZIPS) => { zip?: string; lat?: number; lon?: number; why?: string }>('leadPlace');
const byLead = frameFn<(a: Kept, b: Kept) => number>('byLead');
const leadGroups = frameFn<(leads: Kept[], zips: typeof ZIPS) => { groups: Group[]; miss: Record<string, number> }>('leadGroups', { leadPlace, byLead });
const leadGroupLine = frameFn<(g: Group) => string>('leadGroupLine', { MAP_SAYS });
const cutLine = frameFn<(kind: string, links: string | null) => string>('cutLine', { MAP_SAYS });
const leadFacts = frameFn<(d: { leads: Kept[]; full: boolean }, showOlder: boolean, zips: typeof ZIPS, practice: boolean) => Array<{ kind: string; text: string }>>('leadFacts', { MAP_SAYS, leadGroups });
const leadGaps = frameFn<(kind: string | null, links: string | null) => Array<{ cls: string; text: string; retry: boolean }>>('leadGaps', { MAP_SAYS, cutLine });

// A lead as /api/leads hands it out (the fields the Leads tab uses — phone, details and street among them).
const API = (o: Record<string, unknown> = {}) => ({
  id: 'L1', source: 'phone', details: 'Big oak over the house, call after 5', isEmergency: false, status: 'new', createdAt: '2026-10-20T14:00:00Z',
  name: 'SIM-Alder, Test', phone: '+17575550101', needsCallback: false, older: false, ageDays: 2, city: 'Norfolk', zip: '23508', street: '101 Simulation Row',
  isFirstTimer: true, quality: { priority: 'warm' }, permit: null, screenPending: false, permitUnreadable: false, history: 'Pruned 2024', historyUnreadable: false, ...o,
});
const K = (o: Record<string, unknown> = {}) => keepLead(API(o));

describe('what the map keeps of a lead — and nothing more (M3)', () => {
  it('id, name, ZIP, city, age, older, emergency and status; never the phone, the details, the street or the history', () => {
    const k = K({ isEmergency: true });
    expect(Object.keys(k).sort()).toEqual(['ageDays', 'city', 'emergency', 'id', 'name', 'older', 'status', 'zip']);
    expect(k).toEqual({ id: 'L1', name: 'SIM-Alder, Test', zip: '23508', city: 'Norfolk', ageDays: 2, older: false, emergency: true, status: 'new' });
    expect(JSON.stringify(k)).not.toMatch(/555|Simulation Row|oak|Pruned/);
  });

  it('the read is reduced as it lands: the answer itself is never kept', () => {
    const r = srcOf(script, 'readLeads');
    expect(r).toContain("mapGet('/api/leads?limit=50')");
    expect(r).toContain('body.leads.map(keepLead)');
    expect(script).not.toMatch(/LEADS\.\w+ = body\s*[;,)}]/);
  });
});

describe('placed by ZIP area only — every lead not placed is counted by why (M3)', () => {
  it('a ZIP with a ZIP area is placed at the Census point; ZIP+4 too', () => {
    expect(leadPlace('23508', ZIPS)).toEqual({ zip: '23508', lat: ZIP_CENTROIDS['23508']!.lat, lon: ZIP_CENTROIDS['23508']!.lon });
    expect(leadPlace(' 23508-1234 ', ZIPS).zip).toBe('23508');
  });
  it('no ZIP, a ZIP with no map area, a ZIP outside the four cities — each its own reason; an unchecked table is "not loaded"', () => {
    for (const z of [null, '', '2350', 'abcde', 42]) expect(leadPlace(z, ZIPS), String(z)).toEqual({ why: 'noZip' });
    expect(leadPlace('23450', ZIPS)).toEqual({ why: 'noArea' });
    expect(leadPlace('23434', ZIPS)).toEqual({ why: 'outside' });
    expect(leadPlace('90210', ZIPS)).toEqual({ why: 'outside' });
    expect(leadPlace('23508', { zips: {}, noArea: [], checked: null } as never)).toEqual({ why: 'notLoaded' });
  });
  it('grouped by ZIP area: one group per ZIP, emergencies first then newest; misses counted', () => {
    const { groups, miss } = leadGroups([
      K({ id: 'a', ageDays: 5 }), K({ id: 'b', ageDays: 1 }), K({ id: 'c', isEmergency: true, ageDays: 9 }),
      K({ id: 'd', zip: '23451', city: 'Virginia Beach' }), K({ id: 'e', zip: null }), K({ id: 'f', zip: '23434' }), K({ id: 'g', zip: '23450' }),
    ], ZIPS);
    expect(groups.map((g) => [g.zip, g.leads.map((l) => l.id).join('')])).toEqual([['23451', 'd'], ['23508', 'cba']]);
    expect(miss).toEqual({ noZip: 1, outside: 1, noArea: 1, notLoaded: 0 });
  });
  it('a marker\'s line: "23508 · Norfolk · 3 open leads, 1 new" — an older lead is never counted as new', () => {
    const g = leadGroups([K({ id: 'a' }), K({ id: 'b', older: true, ageDays: 30 }), K({ id: 'c', older: true, ageDays: 40 })], ZIPS).groups[0]!;
    expect(leadGroupLine(g)).toBe('23508 · Norfolk · 3 open leads, 1 new');
    const one = leadGroups([K({ id: 'a', city: null })], ZIPS).groups[0]!;
    expect(leadGroupLine(one)).toBe('23508 · 1 open lead, 1 new');
  });
});

describe('the layer\'s lines, in the plan\'s order (M3, §1B)', () => {
  const notFed = /const notFed = T\('([^']+)'\);/.exec(srcOf(shell, 'renderLeads'))![1]!; // R27 Phase A (es-owner-a): through T
  const FEED_WORD = new Function(`${/^const FEED_WORD = .*;$/m.exec(shell)![0]}\nreturn FEED_WORD;`)() as Record<string, string>;

  it('outside practice the layer opens with the Leads tab\'s own "not fed" line, word for word; in practice it does not', () => {
    expect(MAP_SAYS.notFed).toBe(notFed);
    for (const links of ['readonly', 'cut', 'live', null]) expect(leadGaps(null, links)[0]!.text, String(links)).toBe(notFed);
    expect(leadGaps(null, 'simulation').map((l) => l.text)).not.toContain(notFed);
  });

  it('a read that failed is the Leads tab\'s own feed word ("Leads: cut on purpose."), never a 0; only "couldn\'t read it" has ↻', () => {
    for (const [kind, word] of Object.entries(FEED_WORD)) {
      const line = leadGaps(kind, 'readonly').find((l) => l.text.startsWith('Leads: '))!;
      expect(line.text).toBe(`Leads: ${word}. This is not an empty inbox.`);
      expect(line.cls).toBe(kind);
      expect(line.retry).toBe(kind === 'unread');
    }
  });

  it('the frame\'s feed word follows the shell\'s feedKind for every answer', () => {
    const shellKind = (e: unknown, links: string | null) => new Function('LINKS', `${srcOf(shell, 'feedKind')}\nreturn feedKind;`)(links)(e) as string;
    const leadFeedKind = frameFn<(e: unknown, links: string | null) => string>('leadFeedKind');
    const cases = [null, {}, { code: 500, message: 'server_error' }, { code: 503, message: 'db_not_configured' }, { code: 503, message: 'link_cut' },
      { code: 503, message: 'not_simulated' }, { code: 503, message: 'quo_not_configured' }, { code: 503, message: 'not_built' }, { code: 404, message: 'x' }];
    for (const links of ['readonly', 'live', 'cut', 'simulation', null]) for (const e of cases) expect(leadFeedKind(e, links), JSON.stringify([e, links])).toBe(shellKind(e, links));
  });

  it('Arbo\'s job and estimate records: cut on purpose by R32 in read-only, cut with every link, otherwise not drawn — never "no jobs"', () => {
    expect(leadGaps(null, 'readonly').at(-1)!.text).toBe('Arbo’s job and estimate records are cut on purpose (R32) — none drawn; this is not “no jobs”.');
    expect(leadGaps(null, 'cut').at(-1)!.text).toBe('Arbo’s job and estimate records are cut on purpose — none drawn; this is not “no jobs”.');
    expect(leadGaps(null, 'simulation').at(-1)!.text).toBe(MAP_SAYS.jobsNotDrawn);
    expect(MAP_SAYS.jobsNotDrawn).toMatch(/not “no jobs”/);
  });

  it('older leads are hidden and counted FIRST — before any count or empty line (Q6); Show older puts them on the map', () => {
    const d = { leads: [K({ id: 'a' }), K({ id: 'b', older: true }), K({ id: 'c', older: true, zip: null })], full: false };
    const hidden = leadFacts(d, false, ZIPS, false);
    expect(hidden.map((f) => f.kind)).toEqual(['older', 'count', 'jobs']);
    expect(hidden[0]!.text).toBe('2 older leads hidden — Show older');
    expect(hidden[1]!.text).toBe('1 of 1 open lead on the map');
    const shown = leadFacts(d, true, ZIPS, false);
    expect(shown[0]!.text).toBe('2 older leads shown — Hide older');
    expect(shown.map((f) => f.text)).toContain('2 of 3 open leads on the map');
    expect(shown.map((f) => f.text)).toContain('1 lead with no ZIP — not on the map');
  });

  it('the empty line only after a good read, after the older line; practice says practice', () => {
    expect(leadFacts({ leads: [K({ older: true })], full: false }, false, ZIPS, false).map((f) => f.kind)).toEqual(['older', 'empty', 'jobs']);
    expect(leadFacts({ leads: [K({ older: true })], full: false }, false, ZIPS, false)[1]!.text).toBe(MAP_SAYS.leadsEmptyOlder);
    expect(leadFacts({ leads: [], full: false }, false, ZIPS, false).map((f) => f.text)).toEqual([MAP_SAYS.leadsEmpty, MAP_SAYS.jobs]);
    expect(leadFacts({ leads: [], full: false }, false, ZIPS, true)[0]!.text).toBe(MAP_SAYS.leadsEmptyPractice);
    for (const k of ['leadsEmpty', 'leadsEmptyOlder', 'leadsEmptyPractice']) expect(MAP_SAYS[k], k).not.toMatch(/inbox is empty|no leads\b/i);
  });

  it('an answer exactly 50 long says "newest 50 open leads"; one shorter does not', () => {
    const fifty = { leads: Array.from({ length: 50 }, (_, i) => K({ id: 'L' + i })), full: true };
    expect(leadFacts(fifty, false, ZIPS, false).map((f) => f.text)).toContain(MAP_SAYS.newest50);
    expect(MAP_SAYS.newest50).toContain('newest 50 open leads');
    expect(leadFacts({ ...fifty, full: false }, false, ZIPS, false).map((f) => f.text)).not.toContain(MAP_SAYS.newest50);
    expect(srcOf(script, 'readLeads')).toContain('full: body.leads.length === 50');
  });

  it('every reason a lead is not on the map is named with its count; practice\'s SIM leads (no ZIP) say so', () => {
    const d = { leads: [K({ id: 'a', zip: null }), K({ id: 'b', zip: null }), K({ id: 'c', zip: '23434' }), K({ id: 'd', zip: '90210' }), K({ id: 'e', zip: '23450' })], full: false };
    const t = leadFacts(d, false, ZIPS, false).map((f) => f.text);
    expect(t).toContain('2 leads with no ZIP — not on the map');
    expect(t).toContain('2 leads outside the four cities — not on the map');
    expect(t).toContain('1 lead’s ZIP has no map area');
    expect(t).toContain('0 of 5 open leads on the map');
    const sim = { leads: [1, 2, 3, 4, 5].map((i) => K({ id: 'sim-lead-' + i, zip: null })), full: false };
    expect(leadFacts(sim, false, ZIPS, true).map((f) => f.text)).toContain('5 leads with no ZIP — not on the map');
  });

  it('jobs point to Today (Q14): the map does not read /api/brief', () => {
    expect(MAP_SAYS.jobs).toBe('Jobs are on your Google Calendar — today’s are on the Today layer. Other days aren’t on the map yet.');
    expect(script).not.toContain('/api/brief');
    expect([...script.matchAll(/mapGet\('([^']+)'\)/g)].map((m) => m[1]).filter((p) => /lead/.test(p!))).toEqual(['/api/leads?limit=50']);
  });
});

describe('a failed read draws no marker; a good one draws one per ZIP area (M3)', () => {
  function harness(answer: () => unknown, links = 'readonly') {
    const did: string[] = [];
    const asked: string[] = [];
    const LEADS = { seq: 0, d: null as null | { leads: Kept[] }, failed: null as string | null, layer: { clearLayers: () => did.push('clear') }, showOlder: false };
    const GAPS: Record<string, unknown[]> = { key: [], leads: [] };
    const readLeads = frameFn<() => Promise<void>>('readLeads', {
      LEADS, GAPS, ON: { leads: true }, LINKS_READY: Promise.resolve(links), MAP_SAYS, keepLead,
      mapGet: async (p: string) => { asked.push(p); return answer(); },
      keyGap: () => false, leadFeedKind: () => 'unread', setLeadLines: () => did.push('lines'), drawLeadPins: () => did.push('pins'), drawStatus: () => did.push('status'),
      get LINKS() { return links; },
    });
    return { readLeads, did, asked, LEADS };
  }
  it('the read is the Leads tab\'s own, once; the leads held carry no phone and no details', async () => {
    const h = harness(() => ({ leads: [API(), API({ id: 'L2', zip: '23451' })] }));
    await h.readLeads();
    expect(h.asked).toEqual(['/api/leads?limit=50']);
    expect(h.did).toContain('pins');
    for (const l of h.LEADS.d!.leads) { expect(l).not.toHaveProperty('phone'); expect(l).not.toHaveProperty('details'); expect(l).not.toHaveProperty('street'); }
  });
  it('a read that fails, or an answer without its list, clears every marker and draws none', async () => {
    for (const answer of [() => { throw Object.assign(new Error('x'), { why: 'unread', code: 503, message: 'link_cut' }); }, () => ({ nope: true })]) {
      const h = harness(answer);
      await h.readLeads();
      expect(h.LEADS.d).toBeNull();
      expect(h.LEADS.failed).toBe('unread');
      expect(h.did).toContain('clear');
      expect(h.did).not.toContain('pins');
    }
  });
});

describe('a tap lists names and ages; a name opens that lead in Leads by id only (M3)', () => {
  it('the list is DOM text: names, ages and the Leads tab\'s tags — never a phone; each name posts {type:"lead", id}', () => {
    const s = srcOf(script, 'leadsNode');
    expect(s).toContain("toShell({ type: 'lead', id: l.id })");
    expect(s).not.toMatch(/phone|details|street|innerHTML/);
    // R27 Phase A (es-owner-a; pin moved): EMERGENCY is a safety label — drawn through esPair (in English the word
    // itself, as MAP_SAYS.tagEmergency said it), never a plain T line.
    expect(s).toContain("if (l.emergency) tg.appendChild(esPair('EMERGENCY'));");
    expect(MAP_SAYS).not.toHaveProperty('tagEmergency');
    expect(MAP_SAYS.leadZipNote).toBe('ZIP from the lead’s record — the ZIP area, not the exact spot.');
    // Every message the frame posts about a lead is the id alone.
    for (const m of script.matchAll(/toShell\(\{ type: 'lead'([^}]*)\}/g)) expect(m[1]).toBe(', id: l.id ');
  });
  it('a lead\'s age in words: today, 1 day, N days', () => {
    const leadAge = frameFn<(d: number | null) => string>('leadAge', { MAP_SAYS });
    expect(leadAge(0)).toBe('came in today');
    expect(leadAge(1)).toBe('1 day ago');
    expect(leadAge(12)).toBe('12 days ago');
    expect(leadAge(null)).toBe('');
  });
  it('markers that would touch share one (the Today layer\'s own rule), listing each ZIP area', () => {
    const screenGroups = frameFn<(g: Group[], toPx: (g: { lat: number; lon: number }) => { x: number; y: number }, gap: number, join?: (p: Group[]) => unknown) => Array<{ parts?: Group[]; zip?: string }>>('screenGroups', { byTime: () => 0 });
    const joinZips = frameFn<(p: Group[]) => { parts: Group[] }>('joinZips');
    const { groups } = leadGroups([K({ id: 'a', zip: '23508' }), K({ id: 'b', zip: '23517' }), K({ id: 'c', zip: '23451' })], ZIPS);
    const px = (g: { lat: number; lon: number }) => ({ x: g.lon * 200, y: -g.lat * 200 }); // zoomed far out: Norfolk's two ZIPs touch
    const out = screenGroups(groups, px, 48, joinZips);
    expect(out).toHaveLength(2);
    const shared = out.find((m) => m.parts)!;
    expect(shared.parts!.map((g) => g.zip)).toEqual(['23508', '23517']);
  });
});

describe('the way in: the Leads header (M3)', () => {
  it('a Map chip beside the segments opens the Leads layer; it shows over New leads only', () => {
    const s = srcOf(shell, 'renderLeadsHead');
    expect(s).toContain("openMap('leads')");
    expect(s).toMatch(/el\('button', 'lmap lh-leads', T\('Map'\)\)/); // R27 Phase A (es-owner-a): through T
    expect(s).toContain('segs.appendChild(toMap);');
    expect(shell).toMatch(/\.lseg \.lmap\{[^}]*min-height:44px/);
  });
});
