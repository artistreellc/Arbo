// QA round 3 — the crew door and the practice run. vitest has no DOM, so the
// page is pinned by its source, and the pieces that decide what a crew member
// sees (the GO button's colour, the header, the cut warnings) are lifted out
// of crew.html and run on stand-ins.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSimSource } from '../src/dev/simSource.js';

const crew = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');

/** One top-level function (closing "}" alone on its line), built with stand-ins. */
function pageFn<T>(src: string, name: string, deps: Record<string, unknown> = {}): T {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(src);
  if (!m) throw new Error(`no function ${name} in the page`);
  return new Function(...Object.keys(deps), `${m[0]}\nreturn ${name};`)(...Object.values(deps)) as T;
}

/** Just enough DOM for the crew cards. */
class FakeNode {
  kids: FakeNode[] = [];
  listeners: Record<string, unknown> = {};
  id = '';
  placeholder = '';
  autocomplete = '';
  constructor(public tag: string, public cls = '', public text = '') {}
  appendChild(k: FakeNode): FakeNode { this.kids.push(k); return k; }
  insertBefore(k: FakeNode, ref: FakeNode): FakeNode {
    const at = this.kids.indexOf(ref);
    if (at < 0) throw new Error('insertBefore: ref is not a child');
    this.kids.splice(at, 0, k);
    return k;
  }
  replaceChildren(): void { this.kids = []; }
  addEventListener(type: string, fn: unknown): void { this.listeners[type] = fn; }
}
const el = (tag: string, cls?: string, text?: string): FakeNode => new FakeNode(tag, cls ?? '', text ?? '');

describe('Practice run — each stop is its own customer (item 24)', () => {
  it('the two stops carry the names billing uses for the same jobs, and their own numbers', async () => {
    const sim = createSimSource();
    const stops = await sim.stopsBetween('', '');
    const billed = await sim.billableJobs!();
    expect(stops.map((s) => s.name)).toEqual(['SIM-Alder, Test', 'SIM-Birch, Test']);
    for (const s of stops) {
      expect(s.name).toBe(billed.find((b) => b.jobId === s.id)?.name);
      expect(s.phone).toMatch(/^757-555-01\d\d$/); // the reserved fictional block
    }
    expect(new Set(stops.map((s) => s.phone)).size).toBe(stops.length);
    expect(readFileSync(new URL('../src/dev/simSource.ts', import.meta.url), 'utf8')).not.toContain("'SIM-Test'");
  });

  it('the crew door still gets no customer name: the names live on the stop, not on SIM_JOBS', async () => {
    const jobs = await createSimSource().crewJobs!('', '');
    for (const j of jobs) expect(j).not.toHaveProperty('name');
  });
});

describe('Crew door — GO is never green under a line a retry cannot fix (item 27)', () => {
  type Gate = Record<string, unknown>;
  const goAfter = (gate: Gate) => {
    const go = { disabled: true, className: '' };
    const status = { textContent: '', classList: { toggle: () => {} } };
    const els: Record<string, unknown> = { 'gate-status': status, gobtn: go };
    const GATE: Gate = { unlocked: false, scrolled: true, checked: true, requiredSeconds: 10, ...gate };
    pageFn<() => void>(crew, 'refreshGate', { GATE, $: (id: string) => els[id], secondsOnScreen: () => 99 })();
    return go;
  };

  it('held: still tappable, not green; not held: green', () => {
    expect(goAfter({ serverMsg: 'Your sign-off could not be recorded', serverErr: true, serverHold: true })).toEqual({ disabled: false, className: '' });
    expect(goAfter({ serverMsg: 'Could not record that — try once more.', serverErr: true, serverHold: false })).toEqual({ disabled: false, className: 'ready' });
    expect(goAfter({ serverMsg: '', serverErr: false, serverHold: false })).toEqual({ disabled: false, className: 'ready' });
    expect(crew).toContain("go.className = ready && !GATE.serverHold ? 'ready' : '';");
  });

  // submitGate lifted with stand-ins. By default the gate starts held, so a run that ends
  // un-held proves the press reset it; the hold cases start un-held, so they prove it is set.
  const run = async (answer: () => Promise<unknown>, startHeld = true) => {
    const GATE: Gate = { content: {}, startedAt: '', scrolled: true, checked: true, openedMs: 0, unlocked: false, serverMsg: 'old', serverErr: true, serverHold: startHeld };
    const go = { disabled: false, textContent: '', className: '' };
    const submitGate = pageFn<() => Promise<void>>(crew, 'submitGate', {
      $: () => go, GATE, api: answer, CREW_ID: 'x', secondsOnScreen: () => 20,
      GATE_NEED: {}, refreshGate: () => {}, renderQuiz: () => {}, renderWork: () => {},
      document: { querySelector: () => ({}) }, LINKS_READY: Promise.resolve(), crewWhy: () => 'not part of the practice data',
    });
    await submitGate();
    return GATE;
  };
  const fail = (code: number | undefined, msg = 'x') => async () => { throw Object.assign(new Error(msg), { code }); };

  it('a 503 (cut, practice data, not set up) and a 400 (wrong crew code) hold GO', async () => {
    expect((await run(fail(503, 'not_simulated'), false)).serverHold).toBe(true);
    expect((await run(fail(400, 'bad_crew_id'), false)).serverHold).toBe(true);
  });

  it('only the generic failure leaves GO green, and its line still invites the retry', async () => {
    const g500 = await run(fail(500));
    expect(g500.serverHold).toBe(false);
    expect(g500.serverMsg).toBe('Could not record that — try once more.');
    expect((await run(fail(undefined, 'Failed to fetch'))).serverHold).toBe(false);
  });

  it('a press clears the hold before it asks again; a refusal is not a hold', async () => {
    const g = await run(async () => ({ unlocked: false, missing: ['checkbox'], requiredSeconds: 10 }));
    expect(g.serverHold).toBe(false);
    expect(crew).toMatch(/GATE\.serverMsg = '';\s*GATE\.serverErr = false;\s*GATE\.serverHold = false;\s*try \{/);
  });

  it('ticking the box again clears the hold with the message, and the flag starts false', () => {
    expect(crew).toContain("GATE.serverMsg = ''; GATE.serverErr = false; GATE.serverHold = false; refreshGate(); });");
    expect(crew).toContain('serverHold: false,');
  });
});

describe('Crew door — the header says SIMULATION on practice data (item 28)', () => {
  const line = /^LINKS_READY\.then\(\(\) => \{ if \(LINKS === 'simulation'\)[^\n]*;$/m.exec(crew)?.[0];

  const header = async (links: string | null) => {
    const dateline = { textContent: 'Sunday, October 18' };
    const run = new Function('$', 'LINKS', 'LINKS_READY', `return ${line!.replace(/;$/, '')}`) as
      (...a: unknown[]) => Promise<void>;
    await run(() => dateline, links, Promise.resolve());
    return dateline.textContent;
  };

  it('prefixes the date as the office app does, only when /health says simulation', async () => {
    expect(line).toBeDefined();
    expect(await header('simulation')).toBe('SIMULATION · Sunday, October 18');
    for (const links of ['live', 'cut', 'unknown', null]) expect(await header(links)).toBe('Sunday, October 18');
  });

  it('runs after the date is written, before the panels', () => {
    const at = crew.indexOf(line!);
    expect(crew.indexOf("$('dateline').textContent = new Date()")).toBeLessThan(at);
    expect(crew.indexOf('if (renderWhoAmI()) {')).toBeGreaterThan(at);
  });
});

describe('Crew door — library and near miss say "cut" before anyone types (item 29)', () => {
  const render = async (name: 'renderLibrary' | 'renderNearMiss', links: string | null) => {
    const box = new FakeNode('div');
    const ready = Promise.resolve();
    pageFn<() => void>(crew, name, {
      $: () => box, el, document: { createElement: (t: string) => new FakeNode(t) },
      LINKS_READY: ready, LINKS: links, libSearch: () => {}, CREW_ID: 'x', api: () => {},
    })();
    await ready.then(() => {}); // the page's own .then was queued first, so it has run
    return box.kids[1]!; // [panel-title, card]
  };
  const shape = (card: FakeNode) => card.kids.map((k) => k.cls || k.tag);

  it('cut: the library card names it above the box', async () => {
    const card = await render('renderLibrary', 'cut');
    expect(shape(card)).toEqual(['why', 'lib-warn', 'input', 'button', 'div']);
    expect(card.kids[1]!.text).toBe('Off while the office data link is cut on purpose — ask the office.');
  });

  it('cut: the near-miss card names it above the box', async () => {
    const card = await render('renderNearMiss', 'cut');
    expect(shape(card)).toEqual(['why', 'lib-warn', 'textarea', 'button', 'div']);
    expect(card.kids[1]!.text).toBe('Filing is off while the office data link is cut on purpose — tell the office directly.');
  });

  it('live, simulation, or a /health with no answer: no warning (an unanswered read is not a cut)', async () => {
    for (const links of ['live', 'simulation', 'unknown', null]) {
      expect(shape(await render('renderLibrary', links)), String(links)).toEqual(['why', 'input', 'button', 'div']);
      expect(shape(await render('renderNearMiss', links)), String(links)).toEqual(['why', 'textarea', 'button', 'div']);
    }
  });

  it('the after-the-tap wording stays as the backstop', () => {
    // D111 (pins moved, meaning kept): the same backstop lines, each one template with the crewWhy reason in it.
    expect(crew).toContain("tf('Library: {why}.', { why: crewWhy(e) }) + ' ' + T('That is NOT \"nothing on file\" — ask the office.')");
    expect(crew).toContain("tf('Did not save — {why}.', { why: crewWhy(e) })");
  });
});
