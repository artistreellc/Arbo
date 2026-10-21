// M11 follow-up (lane B verification, 2026-10-20): once the crew door could
// ask for the briefing again (Try again, back online, back on screen), the
// briefing could land long after the page loaded — but the read clock
// (GATE.openedMs) and the acknowledgment's start (GATE.startedAt) were still
// set once, at page load. A crew that opened the app at 6:00 to "No briefing
// published", then got it at 6:40, had the 10–15 second reading floor
// already met: GO armed as soon as they scrolled and ticked, and the logged
// acknowledgment — the OSHA record, and its paid minutes — ran from 6:00.
// Now the clock starts when the briefing is on screen.
// The gate's own functions are run straight from the page, over small fakes.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');

type Fake = Record<string, unknown> & { children: Fake[] };
function harness() {
  const byId = new Map<string, Fake>();
  const make = (tag: string, className = '', textContent = ''): Fake => {
    const f: Fake = {
      tag, className, textContent, children: [], disabled: false,
      classList: { remove() {}, add() {}, toggle() {} },
      appendChild(c: Fake) { f.children.push(c); return c; },
      prepend(c: Fake) { f.children.unshift(c); },
      replaceChildren() { f.children = []; },
      addEventListener() {},
      setAttribute(k: string, v: string) { if (k === 'id') byId.set(v, f); },
    };
    Object.defineProperty(f, 'id', { set(v: string) { byId.set(v, f); }, get() { return undefined; } });
    return f;
  };
  const slot = make('div');
  byId.set('gate-slot', slot);
  const block = html.slice(html.indexOf('const GATE = {'), html.indexOf('async function submitGate('));
  // C1 (D107): renderGate reads /health's answer (LINKS) to say read-only above GO; this harness is not read-only.
  const run = new Function(
    'PREVIEW', 'PREVIEW_WHY', 'document', '$', 'el', 'setInterval', 'submitGate', 'LINKS_READY', 'LINKS',
    `${block}\nreturn { GATE, renderGate, secondsOnScreen, refreshGate };`,
  );
  const page = run(
    false, '', { querySelector: () => make('main'), createElement: (t: string) => make(t) },
    (id: string) => byId.get(id) ?? null, make, () => 1, () => {}, Promise.resolve(), 'live',
  ) as { GATE: Record<string, unknown>; renderGate: (b: unknown) => void; secondsOnScreen: () => number; refreshGate: () => void };
  return { ...page, byId };
}

const BRIEF = { id: 'SIM-brief', body: 'SIM briefing. Hard hats on. Check the chipper guard.', standardRefs: [], requiredSeconds: 10 };
const T = (hhmm: string) => new Date(`2026-10-20T${hhmm}:00-04:00`);

afterEach(() => vi.useRealTimers());

describe('M11 follow-up — the read clock starts when the briefing is on screen, not when the page loaded', () => {
  it('opened at 6:00 to no briefing, briefing arrives at 6:40: the reading floor still has to be read', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T('06:00')); // the page loads; "No briefing published for today yet"
    const p = harness();
    vi.setSystemTime(T('06:40')); // Try again / back on screen: the briefing comes through
    p.renderGate(BRIEF);
    expect(p.secondsOnScreen()).toBeLessThan(BRIEF.requiredSeconds);
    // The crew scrolls and ticks at once — GO must NOT arm before the floor.
    p.GATE.scrolled = true;
    p.GATE.checked = true;
    p.refreshGate();
    expect((p.byId.get('gobtn') as Fake).disabled).toBe(true);
    expect(String((p.byId.get('gate-status') as Fake).textContent)).toContain('read for 10s more');
    vi.setSystemTime(new Date(T('06:40').getTime() + 10_000));
    p.refreshGate();
    expect(p.secondsOnScreen()).toBe(10);
    expect((p.byId.get('gobtn') as Fake).disabled).toBe(false);
  });

  it('the acknowledgment starts at 6:40 — the paid minutes and the OSHA record never run from page load', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T('06:00'));
    const p = harness();
    vi.setSystemTime(T('06:40'));
    p.renderGate(BRIEF);
    expect(p.GATE.startedAt).toBe(T('06:40').toISOString());
  });

  it('nothing from before the briefing arrived counts toward it: scrolled and ticked start false', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T('06:00'));
    const p = harness();
    p.GATE.scrolled = true;
    p.GATE.checked = true;
    vi.setSystemTime(T('06:40'));
    p.renderGate(BRIEF);
    expect(p.GATE.checked).toBe(false); // the box on screen is a new, unticked one
    expect(p.GATE.scrolled).toBe(false); // (a short body that needs no scroll is marked scrolled by renderGate itself)
  });
});
