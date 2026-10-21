// Direction B, P11 (docs/DIRECTION_B_PLAN.md; spec quick fix: Today gets a
// "Before you roll" strip — crew who can't go aerial, trucks down or held,
// emergencies, and a named row for any feed it couldn't read). It sits directly
// under the hero and starts its reads BEFORE the /api/brief await (that await
// ends Today early whenever the schedule is cut — always, in production).
// Reads: /api/safety, /api/fleet/units, and the emergencyLeads() promise and
// stormBanner()'s outcome Today already has — nothing is read twice.
// §1B: every unreadable read is its own named row; cut / not set up share one
// muted line; the chip counts only real items; "Nothing to check before you
// roll" only when every read succeeded and there is no blind spot.
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';

const html = loadAppHtml();
function fnSrc(name: string): string {
  const one = new RegExp(`^(?:async )?function ${name}\\(.*$`, 'm').exec(html);
  if (!one) throw new Error(`no function ${name} in the page`);
  if ((one[0].match(/\{/g) ?? []).length === (one[0].match(/\}/g) ?? []).length) return one[0];
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
function constSrc(name: string): string {
  const one = new RegExp(`^const ${name.replace(/\$/g, '\\$')} = (.*);\\s*(?://.*)?$`, 'm').exec(html);
  if (one) return `const ${name} = ${one[1]};`;
  const at = html.indexOf(`\nconst ${name} = `);
  if (at < 0) throw new Error(`no const ${name} in the page`);
  return html.slice(at + 1, html.indexOf('\n};', at) + 3);
}

class N {
  className = ''; type = ''; id = ''; title = ''; disabled = false;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: N[] = [];
  parent: N | null = null;
  on: Record<string, Array<() => void>> = {};
  private own = '';
  constructor(readonly tag: string) {}
  get textContent(): string { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(t: string) { for (const c of this.children) c.parent = null; this.children = []; this.own = t; }
  has(c: string) { return this.className.split(/\s+/).includes(c); }
  get classList() { return { add: (c: string) => { if (!this.has(c)) this.className = (this.className + ' ' + c).trim(); }, remove: (c: string) => { this.className = this.className.split(/\s+/).filter((x) => x && x !== c).join(' '); }, contains: (c: string) => this.has(c), toggle: (c: string, f?: boolean) => { if (f ?? !this.has(c)) this.classList.add(c); else this.classList.remove(c); } }; }
  appendChild(c: N): N { c.parent?.drop(c); c.parent = this; this.children.push(c); return c; }
  drop(c: N) { this.children = this.children.filter((x) => x !== c); c.parent = null; }
  remove() { this.parent?.drop(this); }
  replaceChildren(...ns: N[]) { for (const c of this.children) c.parent = null; this.children = []; this.own = ''; for (const n of ns) this.appendChild(n); }
  hasChildNodes() { return this.children.length > 0 || this.own !== ''; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  addEventListener(t: string, f: () => void) { (this.on[t] ??= []).push(f); }
  click() { for (const f of this.on.click ?? []) f(); }
  all(): N[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const cut = () => Object.assign(new Error('link_cut'), { code: 503 });
const unset = () => Object.assign(new Error('db_not_configured'), { code: 503 });
const unread = () => new TypeError('Failed to fetch');

type Reads = { safety: () => Promise<unknown>; fleet: () => Promise<unknown>; leads: unknown; storm: unknown; stormAgain?: unknown; links?: string };
const SAFE_OK = { aerialBlocked: [], blindSpots: [], certProblems: [], nearMisses: [] };
const FLEET_OK = { units: [{ id: 'u1', name: 'Unit 1', status: 'up', schedulable: true }], down: 0, held: 0 };

function kit(r: Reads) {
  const ids = new Map<string, N>();
  const document = {
    createElement: (t: string) => new N(t),
    createTextNode: (t: string) => { const n = new N('#text'); n.textContent = t; return n; },
    getElementById: (id: string) => { if (!ids.has(id)) { const n = new N('div'); n.id = id; ids.set(id, n); } return ids.get(id)!; },
  };
  const opened: Array<[string, unknown]> = [];
  const paths: string[] = [];
  let stormCalls = 0;
  const api = async (path: string) => {
    paths.push(path);
    if (path === '/api/safety') return r.safety();
    if (path === '/api/fleet/units') return r.fleet();
    throw new Error('Before you roll read ' + path);
  };
  const consts = ['$', 'el', 'FEED_WORD', 'Cap', 'FEED_TAG', 'FEED_SAYS', 'RETRY', 'TONE', 'DESK_VIEW', 'UNIT_STATUS', 'ROLL_ROWS'];
  const helpers = ['readingLine', 'feedKind', 'chip', 'badge', 'plural'];
  const build = new Function('document', 'api', 'openPanel', 'stormBanner', 'linksIn', 'storeRead', `
    let LINKS = linksIn;
    const LINKS_READY = Promise.resolve(linksIn);
    let STORM_READ = null;
    ${consts.map(constSrc).join('\n')}
    ${helpers.map(fnSrc).join('\n')}
    ${fnSrc('beforeYouRoll')}
    return { beforeYouRoll, setStorm: (v) => { STORM_READ = v; } };`)(
    document, api, (view: string, target: unknown) => opened.push([view, target]),
    () => { stormCalls++; return Promise.resolve(null); }, r.links ?? 'readonly', null,
  ) as { beforeYouRoll: (emgP: Promise<unknown>, stormP: Promise<unknown>) => N; setStorm: (v: unknown) => void };
  const box = build.beforeYouRoll(Promise.resolve(r.leads), Promise.resolve(r.storm));
  return { box, opened, paths, stormCalls: () => stormCalls, setStorm: build.setStorm };
}
const rows = (box: N) => box.all().filter((n) => n.has('roll-row'));
const head = (box: N) => box.all().find((n) => n.has('roll-count'))?.textContent ?? '';

describe('Before you roll (P11)', () => {
  it('three real items: three rows, "3 to check", each opening its own panel', async () => {
    const k = kit({
      safety: async () => ({ ...SAFE_OK, aerialBlocked: ['c1'], certProblems: [{ crewMemberId: 'c1', crewMemberName: 'SIM-Alder', type: 'aerial_rescue', state: 'lapsed', blocksAerialWork: true }] }),
      fleet: async () => ({ units: [{ id: 'u3', name: 'Unit 3', status: 'held', schedulable: false, holdReason: 'brake/steering defect' }], down: 0, held: 1 }),
      leads: { list: [{ id: 'L9', name: 'SIM-Elm, Test', city: 'Norfolk' }] },
      storm: { alerts: 0, events: [] },
    });
    await flush();
    const rs = rows(k.box);
    expect(rs.map((r) => r.textContent)).toEqual([
      expect.stringContaining('SIM-Alder can’t go aerial'),
      expect.stringContaining('Unit 3 is HELD · brake/steering defect'),
      expect.stringContaining('SIM-Elm, Test'),
    ]);
    expect(head(k.box)).toBe('3 to check');
    for (const r of rs) { expect(r.tag).toBe('button'); r.click(); }
    expect(k.opened.map(([v]) => v)).toEqual(['followups', 'followups', 'today']); // DESK_VIEW.safety, DESK_VIEW.fleet, Today's emergency card
    expect(k.paths).toEqual(['/api/safety', '/api/fleet/units']); // leads and weather ride the reads Today already made
    expect(k.box.textContent).not.toContain('Nothing to check');
  });

  it('a blind spot is its own "⚠ CANNOT SEE" row, and keeps the clean line away', async () => {
    const k = kit({ safety: async () => ({ ...SAFE_OK, blindSpots: ['The roster could not be read for 1 crew member.'] }), fleet: async () => FLEET_OK, leads: { list: [] }, storm: { alerts: 0, events: [] } });
    await flush();
    expect(rows(k.box).map((r) => r.textContent)).toEqual([expect.stringContaining('⚠ CANNOT SEE')]);
    expect(head(k.box)).toBe('1 to check');
    expect(k.box.textContent).not.toContain('Nothing to check');
  });

  it('safety unreadable: a named row of its own, counted as couldn’t read — never the clean line (§1B)', async () => {
    const k = kit({ safety: () => Promise.reject(unread()), fleet: async () => FLEET_OK, leads: { list: [] }, storm: { alerts: 0, events: [] } });
    await flush();
    expect(k.box.textContent).toContain('Crew & safety: couldn’t read it — not the same as none.');
    expect(head(k.box)).toBe('1 couldn’t read');
    expect(k.box.textContent).not.toContain('Nothing to check');
    expect(rows(k.box)).toEqual([]); // a named gap is never a tappable row
  });

  it('all cut: one muted line names them, no clean line, no count', async () => {
    const k = kit({ safety: () => Promise.reject(cut()), fleet: () => Promise.reject(cut()), leads: { gap: cut() }, storm: { alerts: 0, events: [] } });
    await flush();
    const lines = k.box.all().filter((n) => n.has('roll-off'));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toBe('Crew & safety, Fleet and Emergency leads: cut on purpose.');
    expect(k.box.textContent).not.toContain('Nothing to check');
    expect(head(k.box)).toBe('');
  });

  it('cut and not set up share the one muted line, each with its own word', async () => {
    const k = kit({ safety: () => Promise.reject(cut()), fleet: () => Promise.reject(unset()), leads: { list: [] }, storm: { alerts: 0, events: [] } });
    await flush();
    const lines = k.box.all().filter((n) => n.has('roll-off'));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toBe('Crew & safety: cut on purpose. Fleet: not set up yet.');
  });

  it('every read and nothing to check: the clean line, and only then', async () => {
    const k = kit({ safety: async () => SAFE_OK, fleet: async () => FLEET_OK, leads: { list: [] }, storm: { alerts: 0, events: [] } });
    await flush();
    expect(k.box.textContent).toContain('Nothing to check before you roll.');
    expect(rows(k.box)).toEqual([]);
    expect(head(k.box)).toBe('');
  });

  it('weather unreadable: "couldn’t read it — not the same as none" with a ↻ that asks the weather again (only it)', async () => {
    const k = kit({ safety: async () => SAFE_OK, fleet: async () => FLEET_OK, leads: { list: [] }, storm: { error: unread() } });
    await flush();
    expect(k.box.textContent).toContain('Weather alerts: couldn’t read it — not the same as none.');
    expect(k.box.textContent).not.toContain('Nothing to check');
    const again = k.box.all().find((n) => n.tag === 'button' && n.has('roll-retry'))!;
    expect(again).toBeTruthy();
    k.setStorm({ alerts: 0, events: [] });
    again.click();
    await flush();
    expect(k.stormCalls()).toBe(1);
    expect(k.paths).toEqual(['/api/safety', '/api/fleet/units']); // the retry asks the weather only
    expect(k.box.textContent).toContain('Nothing to check before you roll.');
  });

  it('a weather alert is a row that opens the storm card', async () => {
    const k = kit({ safety: async () => SAFE_OK, fleet: async () => FLEET_OK, leads: { list: [] }, storm: { alerts: 1, events: ['Severe Thunderstorm Warning'] } });
    await flush();
    const rs = rows(k.box);
    expect(rs.map((r) => r.textContent)).toEqual([expect.stringContaining('Severe Thunderstorm Warning')]);
    rs[0]!.click();
    expect(k.opened).toEqual([['today', 'today-storm']]);
  });

  it('a 401 anywhere draws nothing and takes the card away — the key wall owns the screen', async () => {
    const slot = new N('div');
    const k = kit({ safety: () => Promise.reject(Object.assign(new Error('unauthorized'), { code: 401 })), fleet: async () => FLEET_OK, leads: null, storm: { alerts: 0, events: [] } });
    slot.appendChild(k.box);
    await flush();
    expect(k.box.textContent).toBe('');
    expect(slot.children).toEqual([]); // no empty card left in its slot
  });

  it('a body without its lists is a read that failed: named, never "Nothing to check"', async () => {
    const k = kit({ safety: async () => ({}), fleet: async () => ({ units: null }), leads: { list: [] }, storm: { alerts: 0, events: [] } });
    await flush();
    expect(k.box.textContent).toContain('Crew & safety: couldn’t read it — not the same as none.');
    expect(k.box.textContent).toContain('Fleet: couldn’t read it — not the same as none.');
    expect(head(k.box)).toBe('2 couldn’t read');
    expect(k.box.textContent).not.toContain('Nothing to check');
  });

  it.each([
    ['cut', cut, 'cut on purpose'],
    ['not set up', unset, 'not set up yet'],
    ['not simulated', () => Object.assign(new Error('not_simulated'), { code: 503 }), 'not in the practice data'],
    ['unread', unread, 'couldn’t read'],
  ])('a read that died (%s): named, no 0 beside a noun, no calm line', async (_k, err, word) => {
    const k = kit({ safety: () => Promise.reject(err()), fleet: () => Promise.reject(err()), leads: { gap: err() }, storm: { error: unread() }, links: _k === 'not simulated' ? 'simulation' : 'readonly' });
    await flush();
    const t = k.box.textContent;
    expect(t).toContain(word);
    expect(t).not.toMatch(/\b0\s+(?:to check|units?|crew|emergenc\w*|alerts?)\b/i);
    expect(t).not.toMatch(/Nothing to check|All clear|no weather alerts/i);
  });
});

describe('Before you roll sits under the hero and starts before the brief await (static)', () => {
  const today = fnSrc('renderToday');
  const brief = today.indexOf("api('/api/brief?from=");

  it('its slot is placed directly under the hero', () => {
    const hero = today.indexOf('v.appendChild(buildHero());');
    const slot = today.indexOf('v.appendChild(rollSlot);');
    expect(hero).toBeGreaterThan(-1);
    expect(slot).toBeGreaterThan(hero);
    expect(today.slice(hero, slot).split('\n').filter((l) => /v\.appendChild\(/.test(l))).toHaveLength(1); // nothing else between
  });

  it('it is filled and its reads start before the /api/brief await', () => {
    const call = today.indexOf('rollSlot.appendChild(beforeYouRoll(');
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(brief);
  });

  it('it is handed the emergency read and the weather outcome Today already has — the weather is read once', () => {
    expect(today).toMatch(/beforeYouRoll\(emgP, alerting\.then\(\(\) => STORM_READ\)\)/);
    expect(html.split("api('/api/storm')").length - 1).toBe(1);
    expect(html.split("api('/api/leads?limit=50')").length - 1).toBe(2); // Leads and emergencyLeads — Before you roll adds none
    expect(fnSrc('beforeYouRoll')).not.toContain("api('/api/leads");
    expect(fnSrc('beforeYouRoll')).not.toContain("api('/api/storm')");
  });

  it('no <details> on Today (a TIMED screen): nothing here can freeze the minute redraw', () => {
    expect(fnSrc('beforeYouRoll')).not.toContain("'details'");
  });

  it('every row is a ≥ 44 px button', () => {
    expect(html).toMatch(/\.roll-row\{[^}]*min-height:(4[4-9]|5\d)px/);
  });
});
