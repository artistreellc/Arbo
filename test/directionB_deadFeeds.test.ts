// Direction B, P1 (docs/DIRECTION_B_PLAN.md): §1B is the spine — a dead feed
// is NAMED, never a confident zero. Before any screen moves, the panels the
// hubs will be built from are run with their read failing four ways:
//   503 link_cut                          → "cut on purpose"
//   503 db_not_configured, LINKS readonly → "not set up yet"
//   503 not_simulated                     → "not in the practice data"
//   no answer at all (network)            → "couldn’t read it"
// and each must say its feed word, put no 0 beside the feed's noun, and draw
// no calm line. The page's own helpers (feedKind, feedState, feedLine, state,
// leadsTabBadge, …) are lifted with the renderers, so the words are the page's.
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';

const html = loadAppHtml();

// ---------- lifting ----------
/** A top-level function's source — one line, or to the "}" alone on a line. */
function fnSrc(name: string): string {
  const one = new RegExp(`^(?:async )?function ${name}\\(.*$`, 'm').exec(html);
  if (!one) throw new Error(`no function ${name} in the page`);
  const line = one[0];
  if ((line.match(/\{/g) ?? []).length === (line.match(/\}/g) ?? []).length) return line;
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
/** A top-level const — one line, or a block to the "};" alone on a line. */
function constSrc(name: string): string {
  const one = new RegExp(`^const ${name.replace(/\$/g, '\\$')} = (.*);\\s*(?://.*)?$`, 'm').exec(html);
  if (one) return `const ${name} = ${one[1]};`;
  const at = html.indexOf(`\nconst ${name} = `);
  if (at < 0) throw new Error(`no const ${name} in the page`);
  const lineEnd = html.indexOf('\n', at + 1);
  const close = html[lineEnd - 1] === '[' ? '\n];' : '\n};'; // an array table or a block
  return html.slice(at + 1, html.indexOf(close, at) + 3);
}

// ---------- a stand-in DOM: enough for the panels' failure paths ----------
class FNode {
  className = '';
  title = '';
  hidden = false;
  disabled = false;
  id = '';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FNode[] = [];
  parent: FNode | null = null;
  private own = '';
  constructor(readonly tag: string) {}
  get textContent(): string { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(t: string) { for (const c of this.children) c.parent = null; this.children = []; this.own = t; }
  private names(): string[] { return this.className.split(/\s+/).filter(Boolean); }
  get classList() {
    return {
      add: (c: string) => { if (!this.names().includes(c)) this.className = [...this.names(), c].join(' '); },
      remove: (c: string) => { this.className = this.names().filter((x) => x !== c).join(' '); },
      contains: (c: string) => this.names().includes(c),
      toggle: (c: string, f?: boolean) => { const on = f ?? !this.names().includes(c); if (on) this.classList.add(c); else this.classList.remove(c); },
    };
  }
  appendChild(c: FNode): FNode { c.parent?.drop(c); c.parent = this; this.children.push(c); return c; }
  drop(c: FNode): void { this.children = this.children.filter((x) => x !== c); c.parent = null; }
  remove(): void { this.parent?.drop(this); }
  // Direction B P14: an Office desk tile swaps its "Reading…" for the count (or the dash) in place.
  replaceWith(...ns: FNode[]): void { const p = this.parent!; const at = p.children.indexOf(this); for (const n of ns) { n.parent?.drop(n); n.parent = p; } p.children.splice(p.children.indexOf(this) < 0 ? at : p.children.indexOf(this), 1, ...ns); this.parent = null; }
  replaceChildren(...ns: FNode[]): void { for (const c of this.children) c.parent = null; this.children = []; this.own = ''; for (const n of ns) this.appendChild(n); }
  hasChildNodes(): boolean { return this.children.length > 0 || this.own !== ''; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  removeAttribute(k: string): void { delete this.attrs[k]; }
  getAttribute(k: string): string | null { return this.attrs[k] ?? null; }
  addEventListener(): void {}
  get isConnected(): boolean { return true; }
  // The feeds card lists its feeds in the screen's order (P12 review): 4 when o follows this node.
  compareDocumentPosition(o: FNode): number { const top = (n: FNode): FNode => (n.parent ? top(n.parent) : n); const all = top(this).all(); return all.indexOf(o) > all.indexOf(this) ? 4 : 2; }
  all(): FNode[] { return [this, ...this.children.flatMap((c) => c.all())]; }
  private match(sel: string): (n: FNode) => boolean {
    const cls = /^(?::scope > )?\.([\w-]+)$/.exec(sel);
    if (cls) return (n) => n.names().includes(cls[1]!);
    if (/^[a-z][a-z0-9]*$/.test(sel)) return (n) => n.tag === sel;
    throw new Error('stand-in DOM does not do ' + sel);
  }
  querySelectorAll(sel: string): FNode[] {
    const f = this.match(sel);
    const pool = sel.startsWith(':scope > ') ? this.children : this.all().slice(1);
    return pool.filter(f);
  }
  querySelector(sel: string): FNode | null { return this.querySelectorAll(sel)[0] ?? null; }
}

// ---------- the four ways a read dies ----------
type Kind = 'cut' | 'unset' | 'sim' | 'unread';
const FAILS: Array<{ kind: Kind; links: string; err: () => Error }> = [
  { kind: 'cut', links: 'readonly', err: () => Object.assign(new Error('link_cut'), { code: 503 }) },
  { kind: 'unset', links: 'readonly', err: () => Object.assign(new Error('db_not_configured'), { code: 503 }) },
  { kind: 'sim', links: 'simulation', err: () => Object.assign(new Error('not_simulated'), { code: 503 }) },
  { kind: 'unread', links: 'readonly', err: () => new TypeError('Failed to fetch') },
];
const constVal = <T,>(name: string): T => new Function(`${constSrc(name)}\nreturn ${name};`)() as T;
const FEED_WORD = constVal<Record<Kind, string>>('FEED_WORD');
const FEED_TAG = constVal<Record<Kind, string>>('FEED_TAG');

// A dead feed's noun with a confident zero beside it: "0 leads", "0 open loops", "0 units", …
const ZERO_BESIDE_NOUN = /\b0\s+(?:new\s+|open\s+|emergency\s+|weather\s+|sona\s+)?(?:leads?|emergenc\w*|calls?|alerts?|units?|trucks?|crew|loops?|invoices?|owed|past due|near misses)\b/i;
// The calm lines a dead feed must never draw.
const CALM = [/No new leads/, /Nothing waiting/, /all units schedulable/, /no weather alerts/i, /no alerts/i, /No Sona calls/, /No units on file/,
  /All clear/i, /Nothing holding/, /Nothing needs you/, /Nothing to check/, /Nothing due/, /Everyone is current/, /nothing (?:is )?owed/i, /\ball paid\b/i];

type Panels = {
  renderLeads: () => Promise<void>; emergencyLeads: () => Promise<unknown>; sonaPanel: (limit: number, full: boolean) => Promise<unknown>;
  renderSafety: (slot: FNode) => Promise<void>; renderFleetList: (slot: FNode) => Promise<boolean>; renderMoney: (slot: FNode) => Promise<void>;
  stormBanner: () => Promise<unknown>; heroLoops: () => void;
  beforeYouRoll?: (emgP: Promise<unknown>, stormP: Promise<unknown>) => FNode;
  // Direction B P12: the Today panels the feeds card folds, and the card itself.
  inboxIntentPanel?: () => Promise<FNode | null>; websiteFormsPanel?: () => Promise<FNode | null>;
  studyPanel?: (limit: number) => Promise<FNode | null>; outreachPanel?: (full: boolean) => Promise<FNode | null>;
  feedsCard?: (key: string) => { el: FNode; place: (slot: FNode, x: unknown) => Promise<void> };
  // Direction B P13: the Queue's four desks, each a screen of its own.
  renderMoneyView?: () => Promise<void>; renderFleetView?: () => Promise<void>; renderSafetyView?: () => Promise<void>; renderFollowUps?: () => Promise<void>;
  // Direction B P14: Office (view-more), its counted desk tiles and their reads.
  renderMore?: () => void;
  // Direction B P15: Estimate, and Properties on file (the Book, renamed).
  renderEstimate?: () => Promise<void>; renderBook?: () => Promise<void>;
  // Direction B P16: the Leads hub's head (its own reads, the badge's two halves) and Calls & texts.
  renderLeadsHead?: () => Promise<void>; renderCalls?: () => Promise<void>;
};
/** The page's helpers and the panels under test, built together with one stand-in document. */
function kit(fail: (typeof FAILS)[number]) {
  const ids = new Map<string, FNode>();
  const document = {
    createElement: (t: string) => new FNode(t),
    createTextNode: (t: string) => { const n = new FNode('#text'); n.textContent = t; return n; },
    getElementById: (id: string) => { if (!ids.has(id)) { const n = new FNode('div'); n.id = id; ids.set(id, n); } return ids.get(id)!; },
    querySelectorAll: () => [],
  };
  const hero: Array<{ key: string; value: unknown; label: string }> = [];
  const HERO = {
    stat: (key: string, value: unknown, _cls: string, label: string) => hero.push({ key, value, label }),
    ring: () => {}, legend: () => {},
  };
  const sys: string[] = [];
  const paths: string[] = [];
  const api = async (path: string) => { paths.push(path); throw fail.err(); };
  const consts = ['$', 'el', 'FEED_WORD', 'Cap', 'FEED_TAG', 'FEED_SAYS', 'RETRY', 'TONE', 'FEED_TONE', 'PERMIT_STATE', 'CERT_STATE', 'CERT_TYPES'];
  const helpers = ['state', 'feedKind', 'feedSays', 'feedLine', 'feedState', 'chip', 'badge', 'plural', 'fmtWhen', 'fmtTime', 'leadsTabBadge', 'permitChip', 'permitBadge', 'slipRuleLabel'];
  // P3 adds a "Reading…" helper; the harness lifts it when the page has it.
  if (/^function readingLine\(/m.test(html)) helpers.push('readingLine');
  // The P3 review's tap guard (keepsPage) and what it reads; a read here is never tapped.
  if (/^function keepsPage\(/m.test(html)) helpers.push('tapCount', 'keepsPage', 'holdsTyping');
  const targets = ['renderLeads', 'emergencyLeads', 'sonaPanel', 'renderSafety', 'renderFleetList', 'renderMoney', 'stormBanner', 'heroLoops'];
  // Direction B P11: Before you roll, with the tables it reads.
  if (/^function beforeYouRoll\(/m.test(html)) { consts.push('DESK_VIEW', 'UNIT_STATUS', 'ROLL_ROWS'); targets.push('beforeYouRoll'); }
  // Direction B P12: the panels Today folds into its feeds card, and the card.
  if (/^function feedsCard\(/m.test(html)) {
    consts.push('FEEDS_SAID', 'FEEDS_OPEN', 'FEEDS_BOX', 'FEEDS_GEN');
    if (!helpers.includes('readingLine')) helpers.push('readingLine');
    targets.push('inboxIntentPanel', 'websiteFormsPanel', 'studyPanel', 'outreachPanel', 'feedsCard');
  }
  // Direction B P13: the four desk screens, with every panel the Queue held (and what the Fleet's Bouncie line reads).
  if (/^async function deskView\(/m.test(html)) {
    consts.push('VIEW_TITLES', 'DESK_LINE', 'DESK_GEN', 'FU_LABEL', 'LOOP_LABEL', 'TRACK_SAYS');
    helpers.push('loopCard', 'loadTrack', 'agoWords', 'truckWords', 'trackWords', 'fleetTrackLine', 'fillTrack');
    targets.push('deskView', 'renderMoneyView', 'renderFleetView', 'renderSafetyView', 'renderFollowUps', 'renderFleet',
      'renderRoster', 'renderRosterList', 'renderTrainingBoard', 'renderVetting', 'renderLibraryDesk', 'renderLibraryQueue');
  }
  // Direction B P14: Office — its proposals, its counted desks (every read they make) and the rest of Arbo.
  const office = /^function officeHub\(/m.test(html);
  if (office) {
    consts.push('VIEW_TITLES', 'DESK_LINE', 'OFFICE_DESKS', 'PROPOSAL_GO', 'noRefs');
    helpers.push('moneyCounts', 'lessonsWaiting', 'agentProposals', 'proposalRow', 'runAllEight', 'dollars');
    if (/^function officeRunAge\(/m.test(html)) helpers.push('officeRunAge'); // P14 review: what the proposals card shows
    targets.push('officeDesk', 'officeProposals', 'officeHub', 'renderMore');
  }
  // Direction B P15: Estimate (its tools and the prep form) and Properties on file.
  const estimate = /^async function renderEstimate\(/m.test(html);
  if (estimate) {
    consts.push('VIEW_TITLES', 'ESTIMATE_TOOLS');
    targets.push('estimatePrepPanel', 'renderEstimate', 'renderBook');
  }
  // Direction B P16: the Leads hub's head and Calls & texts (the old Calls screen, its cut lines through the feeds card).
  const hub = /^async function renderLeadsHead\(/m.test(html);
  if (hub) {
    consts.push('VIEW_TITLES', 'LEADS_FILTERS');
    helpers.push('sonaSlipBox', 'quoOffLine', 'sonaTabBadge', 'leadsHeadOn', 'leadsFilter', 'fillQuoSlots');
    targets.push('renderLeadsHead', 'renderCalls');
  }
  const built = new Function('document', 'api', 'HERO', 'sysSet', 'showKeywall', 'linksIn', `
    let LINKS = linksIn;
    let TIMER_REDRAW = false;
    let FU_GEN = 0; // P13: Follow-ups' own newest-draw guard
    let TRACK = null; // P13: the Fleet's last Bouncie read
    const LINKS_READY = Promise.resolve(linksIn);
    let STORM_READ = null; // Direction B P11: stormBanner keeps its outcome for Before you roll
    let ROLL_BOX = null; // P11 review: the card a redraw keeps up, and the draw that owns it
    let ROLL_GEN = 0;
    ${office ? `let AGENT_RUN = null; const NAV_DRAW = {}; const icon = () => document.createElement('svg'); const switchTab = () => {};
      const renderAssistant = () => {}, renderAgents = () => {}, renderMeasure = () => {}, renderPermits = () => {}, renderLearn = () => {};
      const themePref = () => 'auto', setTheme = () => {}, installCard = () => document.createElement('div'), location = {}, window = {};` : ''}
    ${hub ? `let LH_GEN = 0; let LEADS_FILTER = 'all'; let CUR_TAB = 'leads'; const openSonaCall = () => {}; const photoStrip = () => document.createElement('div');
      const showSaveFail = () => {};${office ? '' : ' const switchTab = () => {};'}` : ''}
    ${estimate ? `let EST_GEN = 0; let EST_BOOK = null; let PERMIT_CITY = 'Virginia Beach'; let PREP_LEAD = null; const openYard = () => {};
      const Option = function (t, val) { const o = document.createElement('option'); o.textContent = t; o.value = val; return o; };` : ''}
    ${[...new Set(consts)].map(constSrc).join('\n')}
    ${[...new Set([...helpers, ...targets])].map(fnSrc).join('\n')}
    return { ${targets.join(', ')} };`)(
    document, api, HERO, (k: string, lvl: string, t: string) => sys.push(k + ':' + lvl + ':' + t), () => { throw new Error('a 503 must never open the key wall'); }, fail.links,
  ) as Panels;
  return { ...built, $: (id: string) => document.getElementById(id), hero, sys, paths };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

function expectNamed(text: string, kind: Kind, what: string) {
  expect(text, what + ' names the feed').toContain(FEED_WORD[kind]);
  expect(text, what + ' puts no 0 beside the noun').not.toMatch(ZERO_BESIDE_NOUN);
  for (const c of CALM) expect(text, what + ' draws no calm line').not.toMatch(c);
}

describe.each(FAILS)('a read that died: $kind', (fail) => {
  it('Leads: the screen names the feed, and so does the tab badge (never "No new leads")', async () => {
    const k = kit(fail);
    await k.renderLeads();
    expectNamed(k.$('view-leads').textContent, fail.kind, 'Leads');
    expect(k.$('tab-leads').title).toContain(FEED_WORD[fail.kind]);
    expect(k.$('tab-leads').title).toContain('not zero');
    expect(k.paths).toEqual(['/api/leads?limit=50']);
  });

  it('Today\'s emergency read hands back the gap, never an empty list, and the badge says so', async () => {
    const k = kit(fail);
    const r = await k.emergencyLeads() as { gap?: unknown; list?: unknown[] };
    expect(r.list).toBeUndefined();
    expect(r.gap).toBeTruthy();
    expectNamed(k.$('tab-leads').title, fail.kind, 'Leads badge');
    const dot = k.$('tab-leads').querySelector('.dot')!;
    expect(dot.className).toContain('gap ' + fail.kind);
    expect(dot.textContent).toBe(''); // no digit on a gap
  });

  // Direction B P16: the head reads the leads and Quo itself; each segment and the flag's place name the feed.
  it('Leads hub head: each read is named — in the h1, the segment and the flag\'s place — never a 0 or a calm line', async () => {
    const k = kit(fail);
    await k.renderLeadsHead!();
    const head = k.$('leads-head');
    expectNamed(head.textContent, fail.kind, 'Leads head');
    expect(head.querySelectorAll('.lcount').map((n) => n.textContent)).toEqual(['–', '–']);
    expect(head.querySelectorAll('.lchip')).toEqual([]);
    expect([...k.paths].sort()).toEqual(['/api/leads?limit=50', '/api/quo']);
    // The badge: both halves unknown — the gap dot, no digit, both named.
    const dot = k.$('tab-leads').querySelector('.dot')!;
    expect(dot.textContent).toBe('');
    expect(k.$('tab-leads').title).toContain('Emergency leads unknown — not zero.');
    expect(k.$('tab-leads').title).toContain('Sona calls unknown — not zero');
  });

  it('Calls & texts: every read named, in its place or in the feeds card — never "no calls", never a 0', async () => {
    const k = kit(fail);
    await k.renderCalls!();
    await flush(); await flush(); await flush();
    const v = k.$('view-calls');
    expectNamed(v.textContent, fail.kind, 'Calls & texts');
    // The call log keeps its "not zero calls" whether it folded into the card or stayed in its own-line card.
    expect(v.textContent).toContain('Call log: ' + FEED_WORD[fail.kind] + '.');
    expect(v.textContent).toContain('This is not zero calls.');
    const card = v.querySelector('.feeds')!;
    // Off on purpose (cut, not simulated, not set up) folds into the card; one Arbo couldn't read stays where it shows.
    if (fail.kind === 'unread') expect(card.querySelector('.feeds-head')!.textContent).toContain('couldn’t read');
    else expect(card.querySelectorAll('.feeds-item').length).toBeGreaterThan(0);
  });

  it('Sona (Quo): named, never "No Sona calls"', async () => {
    const k = kit(fail);
    const w = await k.sonaPanel(3, false) as FNode;
    expectNamed(w.textContent, fail.kind, 'Sona');
  });

  it('Safety board: named, never a clean board', async () => {
    const k = kit(fail);
    const slot = new FNode('div');
    await k.renderSafety(slot);
    expectNamed(slot.textContent, fail.kind, 'Safety');
  });

  it('Fleet: named, never "all units schedulable", and no composer offered over it', async () => {
    const k = kit(fail);
    const slot = new FNode('div');
    expect(await k.renderFleetList(slot)).toBe(false);
    expectNamed(slot.textContent, fail.kind, 'Fleet');
  });

  it('Money: named, never "nothing owed"', async () => {
    const k = kit(fail);
    const slot = new FNode('div');
    await k.renderMoney(slot);
    expectNamed(slot.textContent, fail.kind, 'Money');
  });

  it('Weather (the hero stat): a dash and the feed tag, never 0 alerts, and no banner', async () => {
    const k = kit(fail);
    expect(await k.stormBanner()).toBeNull();
    const s = k.hero.find((h) => h.key === 'alerts')!;
    expect(s.value).toBe('–');
    expect(s.label).toContain(FEED_TAG[fail.kind]);
    expect(s.label).not.toMatch(CALM[3]!);
  });

  it('Before you roll (P11): every dead read named, no 0 beside a noun, never "Nothing to check"', async () => {
    const k = kit(fail);
    // The weather comes from stormBanner's own read (its outcome), the leads from emergencyLeads'.
    const box = k.beforeYouRoll!(k.emergencyLeads(), Promise.resolve({ error: fail.err() }));
    for (let i = 0; i < 8; i++) await flush();
    expectNamed(box.textContent, fail.kind, 'Before you roll');
    expect(box.textContent).not.toMatch(/\b0 to check\b/);
    expect(k.paths.filter((p) => p === '/api/safety' || p === '/api/fleet/units')).toEqual(['/api/safety', '/api/fleet/units']);
  });

  // Direction B P12: the Today panels the feeds card folds — each names its feed, and marks its
  // wrapper with the kind and the feed's name, so the card can count it and name it.
  it.each([
    ['inboxIntentPanel', 'Inbox', []], ['websiteFormsPanel', 'Website forms', []],
    ['studyPanel', 'Customer notes', [5]], ['outreachPanel', 'Text outreach', [false]], ['sonaPanel', 'Sona calls', [3, false]],
  ] as const)('%s (P12): named, marked off with its kind, never a calm line', async (name, feed, args) => {
    const k = kit(fail);
    const run = (k as unknown as Record<string, (...a: unknown[]) => Promise<FNode | null>>)[name]!;
    const w = (await run(...args))!;
    expectNamed(w.textContent, fail.kind, name);
    expect(w.dataset.off, name).toBe(fail.kind);
    expect(w.dataset.feedName, name).toBe(feed);
  });

  it('the feeds card (P12): every dead panel counted under its own word and named — never a calm line, never a 0', async () => {
    const k = kit(fail);
    const card = k.feedsCard!('today');
    const panels = [k.inboxIntentPanel!(), k.websiteFormsPanel!(), k.studyPanel!(5), k.outreachPanel!(false), k.sonaPanel(3, false)];
    const slots = panels.map(() => new FNode('div'));
    panels.forEach((p, i) => card.place(slots[i]!, p));
    for (let i = 0; i < 8; i++) await flush();
    const said = { cut: 'cut on purpose', sim: 'not in the practice data', unset: 'not set up', unread: 'couldn’t read' }[fail.kind];
    expect(card.el.textContent).toContain('5 feeds off: 5 ' + said);
    // Every feed named with its state word — "Name — word" over its folded words, or its own line "Name: word…" (P12 review: never both).
    for (const n of ['Inbox', 'Website forms', 'Customer notes', 'Text outreach', 'Sona calls']) expect(card.el.textContent).toMatch(new RegExp(n + '(?: — |: )' + FEED_WORD[fail.kind]));
    expectNamed(card.el.textContent, fail.kind, 'the feeds card');
    // Folded (cut, not simulated, not set up): their slots are empty. Unread: each stays where it would show.
    expect(slots.every((s) => s.children.length === (fail.kind === 'unread' ? 1 : 0))).toBe(true);
  });

  // Direction B P13: the Queue's four desks. Each draws its desk head first; every panel on it names its feed.
  it.each([
    ['renderMoneyView', 'view-money', 'Yard Boss', 'Money'], ['renderFleetView', 'view-fleet', 'Yard Boss', 'Fleet'],
    ['renderSafetyView', 'view-safety', 'Crew Chief', 'Crew & safety'], ['renderFollowUps', 'view-followups', 'Chief of Staff', 'Follow-ups'],
  ] as const)('%s (P13): its desk head, then every panel names its feed — never a calm line, never a 0', async (name, view, line, title) => {
    const k = kit(fail);
    await (k as unknown as Record<string, () => Promise<void>>)[name]!();
    for (let i = 0; i < 8; i++) await flush();
    const v = k.$(view);
    expect(v.children[0]!.className).toBe('viewhead');
    expect(v.children[0]!.children[0]!.textContent).toBe(line);
    expect(v.children[0]!.children[1]!.textContent).toBe(title);
    expectNamed(v.textContent, fail.kind, name);
    expect(v.textContent, name + ': nothing still says Reading…').not.toContain('Reading…');
  });

  it('Crew & safety (P13): the safety board, roster, training, lessons and library each name their own dead feed', async () => {
    const k = kit(fail);
    await k.renderSafetyView!();
    for (let i = 0; i < 8; i++) await flush();
    const t = k.$('view-safety').textContent;
    for (const what of ['Safety board — ', 'Roster — ', 'Training board — ', 'Draft queue — ', 'Library drafts — ']) expect(t, what).toContain(what + FEED_WORD[fail.kind]);
    expect(k.paths.sort()).toEqual(['/api/reference/drafts', '/api/roster', '/api/safety', '/api/training/board', '/api/training/drafts']);
  });

  // Direction B P14: Office — every desk tile whose read died is dashed, worded and opens nothing; the head never reads calm.
  it('Office (P14): every dead desk is a dash with its feed word — never a 0, never "No desk needs you"', async () => {
    const k = kit(fail);
    k.renderMore!();
    for (let i = 0; i < 12; i++) await flush();
    const v = k.$('view-more');
    expectNamed(v.textContent, fail.kind, 'Office');
    expect(v.textContent).not.toContain('No desk needs you');
    const tiles = v.querySelectorAll('.otile');
    expect(tiles).toHaveLength(6);
    for (const t of tiles) {
      expect(t.classList.contains('gap'), t.dataset.desk).toBe(true);
      expect(t.getAttribute('aria-disabled'), t.dataset.desk).toBe('true');
      expect(t.querySelector('.ocount')!.textContent, t.dataset.desk).toBe('–');
      expect(t.textContent.toLowerCase(), t.dataset.desk).toContain(FEED_WORD[fail.kind].toLowerCase());
      expect(t.textContent, t.dataset.desk).not.toContain('Reading…');
    }
    // P14 review: "could not be read" only of reads that failed; desks off on purpose or not set up were not counted (§1B).
    expect(v.querySelector('h1')!.textContent).toBe(fail.kind === 'unread' ? 'No desk could be read · 6 couldn’t be read' : 'No desk counted · 6 off');
    expect([...new Set(k.paths)].sort()).toEqual(['/api/assistant/approvals', '/api/fleet/units', '/api/followups', '/api/money', '/api/performance',
      '/api/queue', '/api/reception/status', '/api/safety', '/api/sim/state']);
  });

  // Direction B P15: Estimate — its head and prep form stand; Properties on file names its dead feed and opens nothing.
  it('Estimate (P15): the head and the prep form stand, and Properties on file names its dead feed — never "0 on file"', async () => {
    const k = kit(fail);
    await k.renderEstimate!();
    for (let i = 0; i < 6; i++) await flush();
    const v = k.$('view-estimate');
    expect(v.children[0]!.className).toBe('viewhead');
    expect(v.textContent).toContain('Build prep sheet'); // P15 review: the form card has no title of its own; the head names the sheet
    const row = v.querySelectorAll('.est-tool').find((t) => t.dataset.tool === 'book')!;
    expect(row.textContent).toContain('Not counted — ' + FEED_WORD[fail.kind]);
    expect(row.textContent).not.toMatch(/\b0 (?:on file|coming due)/);
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(v.textContent).not.toContain('Reading…');
    expectNamed(v.textContent, fail.kind, 'Estimate');
    expect(k.paths).toEqual(['/api/properties']);
  });

  it('Properties on file (P15, the Book): its head, then its dead feed named — never "No properties yet"', async () => {
    const k = kit(fail);
    await k.renderBook!();
    const v = k.$('view-book');
    expect(v.children[0]!.className).toBe('viewhead');
    expect(v.children[0]!.textContent).toContain('Properties on file');
    expectNamed(v.textContent, fail.kind, 'Properties on file');
    expect(v.textContent).not.toContain('No properties yet');
    expect(v.textContent).not.toContain('Reading…');
  });

  it('Open loops (the hero stat): a dash and the feed tag, never 0 open', async () => {
    const k = kit(fail);
    k.heroLoops();
    await flush(); await flush();
    const s = k.hero.find((h) => h.key === 'loops')!;
    expect(s.value).toBe('–');
    expect(s.label).toContain(FEED_TAG[fail.kind]);
    expect(s.label).not.toMatch(ZERO_BESIDE_NOUN);
  });
});

// Every render*/…Panel function in the page is listed here: covered above, or
// exempt with the reason. A new one (each later package) must join one list.
describe('the dead-feed harness knows every panel in the page', () => {
  const COVERED = ['renderLeads', 'sonaPanel', 'renderSafety', 'renderFleetList', 'renderMoney',
    'inboxIntentPanel', 'studyPanel', 'outreachPanel', 'websiteFormsPanel', // P12 joined the four Today panels
    'renderMoneyView', 'renderFleetView', 'renderSafetyView', 'renderFollowUps', // P13: the Queue's four desks …
    'renderRosterList', 'renderTrainingBoard', 'renderVetting', 'renderLibraryQueue', // … and the panels Crew & safety holds
    'renderMore', // P14: Office, its desks counted
    'renderEstimate', 'renderBook', // P15: Estimate, and Properties on file (the Book)
    'renderLeadsHead', 'renderCalls']; // P16: the Leads hub's head, and Calls & texts (joined, as P1 said it would)
  const EXEMPT: Record<string, string> = {
    renderToday: 'a page of panels; its dead-feed lines are pinned in qa_today, qa2_today and qa3_today-rest (emergencyLeads, stormBanner, heroLoops are covered above)',
    renderAssistant: 'R28 desk; its gaps are pinned in assistantUi',
    renderTodayStops: 'R35 (TomTom) — B never edits it; pinned in todayStopsUi',
    routePlannerPanel: 'R35 planner form — no read until a tap; B never edits it',
    renderCalendar: 'R2: the calendar is an iframe — Arbo reads nothing there itself (today\'s stops are renderTodayStops)',
    estimatePrepPanel: 'a form — reads only on Build; its failure line is pinned in estimatePrep',
    renderRoster: 'wrapper of renderRosterList',
    renderPerformance: 'not seeded in P1; pinned in qa2_queue-numbers-book',
    renderCampaignList: 'draws a list it is handed — no read of its own',
    renderLibraryDesk: 'wrapper of renderLibraryQueue',
    renderFleet: 'wrapper of renderFleetList (covered) and the Bouncie line (bouncie.test)',
    renderSettings: 'not seeded in P1; pinned in qa_settings and qa2_settings-more',
    renderPermits: 'not seeded in P1; pinned in qa_permits and qa2_permits-measure-crew',
    renderAgents: 'not seeded in P1; pinned in qa_agents (joins with P6)',
    renderMeasure: 'a form — reads only on a file; pinned in qa2_permits-measure-crew',
    renderLearn: 'not seeded in P1; pinned in qa_agents_learn_round2',
    openPanel: 'P10 navigation, not a panel: it opens a screen and lands on one of its panels — no read of its own (directionB_todayTaps)',
  };
  it('every render* and *Panel function is covered or exempt with a reason — never both', () => {
    const names = [...html.matchAll(/^(?:async )?function (\w+)\(/gm)].map((m) => m[1]!).filter((n) => /^render[A-Z]/.test(n) || /Panel$/.test(n));
    expect(names.length).toBeGreaterThan(25);
    for (const n of names) expect(COVERED.includes(n) || n in EXEMPT, n + ' is in neither list').toBe(true);
    for (const n of COVERED) expect(n in EXEMPT, n + ' is in both').toBe(false);
    for (const n of [...COVERED, ...Object.keys(EXEMPT)]) expect(names, n + ' is no longer in the page').toContain(n);
    for (const [n, why] of Object.entries(EXEMPT)) expect(why.length, n).toBeGreaterThan(10);
  });
});
