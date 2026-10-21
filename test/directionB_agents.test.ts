// Direction B, P6 (docs/DIRECTION_B_PLAN.md; spec quick fix "Agents lists its
// proposals at the top"). After a run, every desk's proposals sit in one list
// above the first desk card, in the roster's order, each with a button that
// opens the screen where Mike acts on it (PROPOSAL_GO). The stale-run line and
// "The run did not complete…" sit above the list. With no run the list says
// "Run all eight first" — never "no proposals". After a run that proposed
// nothing, a bare "none" only when every desk read fully; otherwise the desks
// that couldn't read everything are counted (§1B). The per-card notes stay.
import { describe, it, expect, vi } from 'vitest';
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

// ---------- a stand-in DOM that can be clicked ----------
class FNode {
  className = ''; title = ''; id = ''; type = ''; disabled = false;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FNode[] = [];
  parent: FNode | null = null;
  on: Record<string, Array<() => void>> = {};
  private own = '';
  constructor(readonly tag: string) {}
  get textContent(): string { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(t: string) { for (const c of this.children) c.parent = null; this.children = []; this.own = t; }
  private names(): string[] { return this.className.split(/\s+/).filter(Boolean); }
  has(c: string): boolean { return this.names().includes(c); }
  get classList() {
    return {
      add: (c: string) => { if (!this.has(c)) this.className = [...this.names(), c].join(' '); },
      remove: (c: string) => { this.className = this.names().filter((x) => x !== c).join(' '); },
      contains: (c: string) => this.has(c),
      toggle: (c: string, f?: boolean) => { if (f ?? !this.has(c)) this.classList.add(c); else this.classList.remove(c); },
    };
  }
  appendChild(c: FNode): FNode { c.parent?.drop(c); c.parent = this; this.children.push(c); return c; }
  drop(c: FNode): void { this.children = this.children.filter((x) => x !== c); c.parent = null; }
  remove(): void { this.parent?.drop(this); }
  replaceWith(...ns: FNode[]): void { const p = this.parent!; const at = p.children.indexOf(this); for (const n of ns) { n.parent?.drop(n); n.parent = p; } p.children.splice(at, 1, ...ns); this.parent = null; }
  replaceChildren(...ns: FNode[]): void { for (const c of this.children) c.parent = null; this.children = []; this.own = ''; for (const n of ns) this.appendChild(n); }
  hasChildNodes(): boolean { return this.children.length > 0 || this.own !== ''; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  getAttribute(k: string): string | null { return this.attrs[k] ?? null; }
  addEventListener(ev: string, f: () => void): void { (this.on[ev] ??= []).push(f); }
  click(): void { for (const f of this.on.click ?? []) f(); }
  all(): FNode[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}

// ---------- the run and the roster, as the server sends them ----------
const ROSTER = {
  brain: 'offline',
  agents: [
    { id: 'front-desk', name: 'Front Desk', section: 'Calls', roles: [], reads: ['calls'], can: [], cannot: [] },
    { id: 'yard-boss', name: 'Yard Boss', section: 'Fleet', roles: [], reads: ['units'], can: [], cannot: [] },
    { id: 'crew-chief', name: 'Crew Chief', section: 'Crew', roles: [], reads: ['roster'], can: [], cannot: [] },
    { id: 'analyst', name: 'Analyst', section: 'Numbers', roles: [], reads: ['areas'], can: [], cannot: [] },
  ],
};
type Prop = { kind: string; text: string };
const report = (agentId: string, status: string, proposals: Prop[] = [], name = agentId) => ({
  agentId, name, section: 'x', ranAt: new Date().toISOString(), status,
  inputs: [{ name: 'feed', state: status === 'ok' ? 'read' : 'unreadable', detail: 'd' }], findings: [], proposals, wrapped: [],
  ...(status === 'blocked' ? { error: 'section agent failed — boom' } : {}),
});
const ranNow = () => new Date().toISOString();

/** renderAgents with the page's own helpers over one stand-in document. */
function kit(run: unknown) {
  const ids = new Map<string, FNode>();
  const document = {
    createElement: (t: string) => new FNode(t),
    createTextNode: (t: string) => { const n = new FNode('#text'); n.textContent = t; return n; },
    getElementById: (id: string) => { if (!ids.has(id)) { const n = new FNode('div'); n.id = id; ids.set(id, n); } return ids.get(id)!; },
  };
  const went: string[] = [];
  const consts = ['$', 'el', 'FEED_WORD', 'Cap', 'FEED_TAG', 'FEED_SAYS', 'RETRY', 'TONE', 'AGENT_ICONS', 'INPUT_STATE', 'REPORT_STATUS', 'noRefs', 'PROPOSAL_GO'];
  if (/^const PROPOSAL_AT = /m.test(html)) consts.push('PROPOSAL_AT'); // P14 review: where each proposal lands
  const helpers = ['readingLine', 'state', 'feedKind', 'feedSays', 'feedLine', 'feedState', 'chip', 'badge', 'plural', 'fmtWhen', 'agentProposals', 'proposalRow'];
  const render = new Function('document', 'api', 'switchTab', 'icon', 'runIn', `
    let LINKS = 'readonly';
    let AGENT_GEN = 0;
    let AGENT_RUN = runIn;
    const showKeywall = () => { throw new Error('no key wall here'); };
    const openPanel = (view) => switchTab(view); // P14 review: a proposal lands on its panel; the stand-in records the screen
    ${consts.map(constSrc).join('\n')}
    ${helpers.map(fnSrc).join('\n')}
    ${fnSrc('renderAgents')}
    return renderAgents;`)(document, async () => ROSTER, (t: string) => went.push(t), () => new FNode('svg'), run) as () => Promise<void>;
  return { render, view: () => document.getElementById('view-agents'), went };
}
const lift = <T,>(name: string, consts: string[] = []) =>
  new Function(`${consts.map(constSrc).join('\n')}\n${fnSrc(name)}\nreturn ${name};`)() as T;

describe('agentProposals: one list, in the roster\'s order, through noRefs', () => {
  type P = { desk: string; text: string; kind: string };
  const agentProposals = lift<(run: unknown, roster?: unknown) => P[]>('agentProposals', ['noRefs']);

  it('no run, or a run that did not complete, has no list (the screen says why, never "none")', () => {
    expect(agentProposals(null, ROSTER.agents)).toEqual([]);
    expect(agentProposals({ error: 'error' }, ROSTER.agents)).toEqual([]);
  });

  it('lists every proposal in roster order, with the desk that made it, brief numbering stripped', () => {
    const run = { ranAt: ranNow(), reports: [
      report('analyst', 'ok', [{ kind: 'area_review', text: 'Look at the area rated below the company average before spending there.' }], 'Analyst'),
      report('front-desk', 'ok', [{ kind: 'call_review', text: 'Review 2 logged conversations (§29).' }], 'Front Desk'),
      report('yard-boss', 'degraded', [{ kind: 'parts_review', text: 'Review the breakdown plan.' }, { kind: 'signback_review', text: 'Sign Unit 3 back on.' }], 'Yard Boss'),
    ] };
    expect(agentProposals(run, ROSTER.agents)).toEqual([
      { desk: 'Front Desk', text: 'Review 2 logged conversations.', kind: 'call_review' },
      { desk: 'Yard Boss', text: 'Review the breakdown plan.', kind: 'parts_review' },
      { desk: 'Yard Boss', text: 'Sign Unit 3 back on.', kind: 'signback_review' },
      { desk: 'Analyst', text: 'Look at the area rated below the company average before spending there.', kind: 'area_review' },
    ]);
  });

  it('a desk the roster does not name is still listed (last), and with no roster the run\'s own order and names are used', () => {
    const run = { ranAt: ranNow(), reports: [
      report('permit-desk', 'ok', [{ kind: 'run_screen', text: 'Run the permit screen for 2 properties.' }], 'Permit Desk'),
      report('front-desk', 'ok', [{ kind: 'call_review', text: 'Review 1 logged conversation.' }], 'Front Desk'),
    ] };
    expect(agentProposals(run, ROSTER.agents).map((p) => p.desk)).toEqual(['Front Desk', 'Permit Desk']);
    expect(agentProposals(run).map((p) => p.desk)).toEqual(['Permit Desk', 'Front Desk']);
  });
});

describe('renderAgents: proposals at the top', () => {
  const panel = (v: FNode) => v.children.find((c) => c.has('proposals'));
  const firstCard = (v: FNode) => v.children.findIndex((c) => c.has('card') && c.has('agent'));

  it('after a run, "Proposals for you (N)" sits above the first desk card, and each button opens its screen', async () => {
    const run = { ranAt: ranNow(), reports: [
      report('front-desk', 'ok', [{ kind: 'call_review', text: 'Review 2 logged conversations.' }], 'Front Desk'),
      report('yard-boss', 'ok', [{ kind: 'signback_review', text: 'Sign Unit 3 back on.' }, { kind: 'no_screen_kind', text: 'A proposal with no screen.' }], 'Yard Boss'),
      report('crew-chief', 'ok', [], 'Crew Chief'), report('analyst', 'ok', [], 'Analyst'),
    ] };
    const k = kit(run);
    await k.render();
    const v = k.view();
    const p = panel(v)!;
    expect(p, 'a proposals panel').toBeTruthy();
    expect(v.children.indexOf(p)).toBeLessThan(firstCard(v));
    expect(firstCard(v)).toBeGreaterThan(-1);
    expect(p.textContent).toContain('Proposals for you (3)');
    for (const t of ['Front Desk', 'Review 2 logged conversations.', 'Yard Boss', 'Sign Unit 3 back on.', 'A proposal with no screen.']) expect(p.textContent).toContain(t);
    const buttons = p.all().filter((n) => n.tag === 'button');
    // Direction B P13: signing a unit back on is on the Fleet desk now (the Queue was split).
    expect(buttons.map((b) => b.textContent)).toEqual(['Open Calls →', 'Open Fleet →']); // a kind with no screen stays plain text
    buttons[0]!.click(); buttons[1]!.click();
    expect(k.went).toEqual(['calls', 'fleet']);
    // The per-card notes stay.
    expect(v.textContent).toContain('Proposal for you: Sign Unit 3 back on.');
  });

  it('with no run this launch: "Run all eight first" — never "no proposals"', async () => {
    const k = kit(null);
    await k.render();
    const p = panel(k.view())!;
    expect(p, 'the panel still draws').toBeTruthy();
    expect(p.textContent).toContain('Run all eight first');
    expect(p.textContent).not.toMatch(/no proposals/i);
    expect(k.view().children.indexOf(p)).toBeLessThan(firstCard(k.view()));
  });

  it('a run that did not complete says so above the list, and the list never says "no proposals"', async () => {
    const k = kit({ error: 'HTTP 500' });
    await k.render();
    const v = k.view();
    const p = panel(v)!;
    const err = v.children.findIndex((c) => c.textContent.startsWith('The run did not complete'));
    expect(err).toBeGreaterThan(-1);
    expect(err).toBeLessThan(v.children.indexOf(p));
    expect(p.textContent).not.toMatch(/no proposals/i);
  });

  it('a stale run: the "over 15 minutes old" line sits above the list', async () => {
    const old = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const k = kit({ ranAt: old, reports: [report('front-desk', 'ok', [{ kind: 'call_review', text: 'Review 1 logged conversation.' }], 'Front Desk')] });
    await k.render();
    const v = k.view();
    const stale = v.children.findIndex((c) => c.textContent.includes('over 15 minutes old'));
    expect(stale).toBeGreaterThan(-1);
    expect(stale).toBeLessThan(v.children.indexOf(panel(v)!));
  });

  // Review (b-wave-1b, correctness 2): the warning was worked out only when the screen
  // was drawn. Agents is off the minute timer, and Today's "agent runs" tile and the
  // header Back show it as drawn — so a run gone stale since came back as "Ran 5:36 AM."
  // over "Proposals for you (4)", no warning. The line now turns on its own.
  it('a run that goes stale while Agents sits drawn turns its line into the warning, above the list, on its own', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
      const k = kit({ ranAt: '2026-10-21T09:50:00.000Z', reports: [report('front-desk', 'ok', [{ kind: 'call_review', text: 'Review 1 logged conversation.' }], 'Front Desk')] });
      await k.render();
      const v = k.view();
      expect(v.textContent).not.toContain('over 15 minutes old');
      expect(v.textContent).toMatch(/Ran .+\. Run only looks/);
      vi.advanceTimersByTime(4 * 60 * 1000);
      expect(v.textContent, 'still fresh at 14 minutes').not.toContain('over 15 minutes old');
      vi.advanceTimersByTime(2 * 60 * 1000);
      const stale = v.children.findIndex((c) => c.textContent.includes('over 15 minutes old'));
      expect(stale, 'the warning came up by itself').toBeGreaterThan(-1);
      expect(stale).toBeLessThan(v.children.indexOf(panel(v)!));
      expect(v.textContent).not.toMatch(/Ran [^—]+\. Run only looks/); // the calm "Ran …" is gone with it
      expect(v.textContent.split('over 15 minutes old').length - 1).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it('a redraw before the run goes stale owns the screen: the first draw\'s timer adds nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
      const k = kit({ ranAt: '2026-10-21T09:50:00.000Z', reports: [report('front-desk', 'ok')] });
      await k.render();
      await k.render();
      vi.advanceTimersByTime(6 * 60 * 1000);
      expect(k.view().textContent.split('over 15 minutes old').length - 1).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it('nothing proposed but desks could not read everything: the gap is counted, never a bare "none" (§1B)', async () => {
    const k = kit({ ranAt: ranNow(), reports: [report('front-desk', 'ok'), report('yard-boss', 'degraded'), report('crew-chief', 'blocked'), report('analyst', 'ok')] });
    await k.render();
    const p = panel(k.view())!;
    expect(p.textContent).toContain('No proposals — 2 desks couldn’t read everything');
    expect(p.textContent).not.toContain('No proposals from this run.');
  });

  it('a desk on the roster with no report counts as not read fully', async () => {
    const k = kit({ ranAt: ranNow(), reports: [report('front-desk', 'ok'), report('yard-boss', 'ok'), report('crew-chief', 'ok')] });
    await k.render();
    expect(panel(k.view())!.textContent).toContain('No proposals — 1 desk couldn’t read everything');
  });

  it('nothing proposed and every desk read fully: the bare "none"', async () => {
    const k = kit({ ranAt: ranNow(), reports: ROSTER.agents.map((a) => report(a.id, 'ok')) });
    await k.render();
    const p = panel(k.view())!;
    expect(p.textContent).toContain('No proposals from this run.');
    expect(p.textContent).not.toContain('couldn’t read');
  });

  it('proposals from a run where some desks could not read everything say the list may be short', async () => {
    const k = kit({ ranAt: ranNow(), reports: [report('front-desk', 'ok', [{ kind: 'call_review', text: 'Review 1 logged conversation.' }], 'Front Desk'), report('yard-boss', 'degraded'), report('crew-chief', 'ok'), report('analyst', 'ok')] });
    await k.render();
    const p = panel(k.view())!;
    expect(p.textContent).toContain('Proposals for you (1)');
    expect(p.textContent).toContain('1 desk couldn’t read everything');
  });

  it('every proposal button is a full tap target (≥ 44 px), and the panel spans the row on a wide screen', () => {
    expect(html).toMatch(/\.minibtn\{min-height:48px;/);
    expect(fnSrc('proposalRow')).toContain("el('button', 'minibtn'");
    const wide = html.slice(html.indexOf('@media (min-width:900px){'));
    expect(wide).toMatch(/\.view \.proposals[,{]/);
  });
});
