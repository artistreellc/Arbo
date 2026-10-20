// M11 (audit 2026-10-20): the crew door read the safety briefing ONCE. One
// dead spot at 6:30am showed "Briefing didn't come through … call the
// office" with no way to ask again — locked out until someone force-quit
// the app — and a phone resumed the next day kept "DAY UNLOCKED". Now the
// briefing is asked for again on Try again, on 'online', and when the app
// comes back to the screen while the day is still locked; a phone that wakes
// on a new Hampton Roads day reloads, so every day starts locked.
// The functions are run straight from the page, over small fakes.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');

interface Fake {
  tag: string; className: string; textContent: string; children: Fake[];
  appendChild(c: Fake): Fake; replaceChildren(): void; addEventListener(ev: string, fn: () => void): void; click(): void;
}
function el(tag: string, className = '', textContent = ''): Fake {
  let onClick: (() => void) | null = null;
  const f: Fake = {
    tag, className, textContent, children: [],
    appendChild(c) { f.children.push(c); return c; },
    replaceChildren() { f.children = []; },
    addEventListener(ev, fn) { if (ev === 'click') onClick = fn; },
    click() { onClick?.(); },
  };
  return f;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

/** The page's M11 block, run with fakes for everything it calls. */
function load(opts: { answers: Array<unknown>; day?: () => string }) {
  const block = html.slice(html.indexOf('let BRIEF_LOADING = false;'), html.indexOf('if (renderWhoAmI()) {'));
  const slot = el('div', 'gate-slot');
  const GATE: Record<string, unknown> = { content: null, unlocked: false };
  const calls: string[] = [];
  const reload = vi.fn();
  let n = 0;
  const api = vi.fn(async (path: string) => {
    calls.push(path);
    const a = opts.answers[Math.min(n, opts.answers.length - 1)];
    n += 1;
    if (a instanceof Error) throw a;
    return a;
  });
  const renderGate = vi.fn((b: unknown) => { GATE.content = b; });
  const renderDoorKey = vi.fn();
  const intl = opts.day
    ? { DateTimeFormat: function () { return { format: () => opts.day!() }; } }
    : Intl;
  const run = new Function(
    'GATE', 'api', 'renderGate', 'renderDoorKey', '$', 'el', 'LINKS_READY', 'crewWhy', 'document', 'location', 'Intl',
    `${block}\nreturn { loadBriefing, resumeDay };`,
  );
  const fns = run(
    GATE, api, renderGate, renderDoorKey, (id: string) => (id === 'gate-slot' ? slot : el('div')), el, Promise.resolve(),
    () => 'the office didn’t answer', { querySelector: () => ({ classList: { remove() {}, add() {} } }), createTextNode: (t: string) => el('#text', '', t) }, { reload }, intl,
  ) as { loadBriefing: () => void; resumeDay: () => void };
  return { ...fns, slot, GATE, calls, api, renderGate, renderDoorKey, reload };
}
const fail = (code: number, message = 'x') => Object.assign(new Error(message), { code });

describe('M11 — the crew door asks for the briefing again instead of locking the crew out', () => {
  it('a failed first read shows the stop-work box WITH a Try again button; tapping it reads again and opens the gate', async () => {
    const p = load({ answers: [new Error('Failed to fetch'), { body: 'SIM briefing' }] });
    p.loadBriefing();
    await flush(); await flush();
    const box = p.slot.children[0]!;
    expect(box.className).toBe('state err');
    expect(box.children.map((c) => c.textContent)).toContain('Do not start work \\u2014 call the office.'.replace('\\u2014', '—'));
    const retry = box.children.find((c) => c.className === 'retry')!;
    expect(retry.textContent).toBe('Try again');
    retry.click();
    await flush(); await flush();
    expect(p.calls).toEqual(['/api/crew/briefing', '/api/crew/briefing']);
    expect(p.renderGate).toHaveBeenCalledWith({ body: 'SIM briefing' });
  });

  it('"no briefing published yet" can be asked again too, and coming back online asks by itself — the old answer is replaced, never stacked', async () => {
    const p = load({ answers: [fail(404), fail(404), { body: 'SIM briefing' }] });
    p.loadBriefing();
    await flush(); await flush();
    expect(p.slot.children.map((c) => c.className)).toEqual(['state', 'retry']);
    p.resumeDay(); // 'online' / visible again
    await flush(); await flush();
    expect(p.slot.children.map((c) => c.className)).toEqual(['state', 'retry']);
    p.resumeDay();
    await flush(); await flush();
    expect(p.renderGate).toHaveBeenCalledTimes(1);
    expect(p.calls).toHaveLength(3);
  });

  it('a gate already on screen, an unlocked day, or a door waiting for its key is never re-read', async () => {
    const p = load({ answers: [{ body: 'SIM briefing' }] });
    p.loadBriefing();
    await flush();
    p.resumeDay();
    p.resumeDay();
    await flush();
    expect(p.calls).toHaveLength(1); // the countdown on screen is kept
    const k = load({ answers: [fail(401, 'crew_key_not_set')] });
    k.loadBriefing();
    await flush();
    k.resumeDay();
    await flush();
    expect(k.renderDoorKey).toHaveBeenCalledTimes(1);
    expect(k.calls).toHaveLength(1);
  });

  it('Lane A × M11: the gate’s 429 (too many wrong keys) reaches the door card with the server’s reason, and is never re-read on its own', async () => {
    const t = load({ answers: [fail(429, 'too_many_attempts'), { body: 'SIM briefing' }] });
    t.loadBriefing();
    await flush();
    expect(t.renderDoorKey).toHaveBeenCalledWith(false, 'too_many_attempts');
    t.resumeDay();
    t.loadBriefing();
    await flush();
    // Re-reading while throttled would only spend the one-a-minute check; the card's own button reloads.
    expect(t.calls).toHaveLength(1);
    expect(t.renderGate).not.toHaveBeenCalled();
  });

  it('a phone that wakes on a new ET day reloads — yesterday’s "DAY UNLOCKED" never carries over', () => {
    let day = '2026-10-20';
    const p = load({ answers: [{ body: 'SIM' }], day: () => day });
    p.GATE.unlocked = true;
    p.resumeDay();
    expect(p.reload).not.toHaveBeenCalled();
    day = '2026-10-21';
    p.resumeDay();
    expect(p.reload).toHaveBeenCalledTimes(1);
  });

  it('the boot wires the retries, and a second renderGate never starts a second ticking timer', () => {
    const boot = html.slice(html.indexOf('if (renderWhoAmI()) {'));
    expect(boot).toContain("window.addEventListener('online', resumeDay);");
    expect(boot).toContain("document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resumeDay(); });");
    expect(boot).toContain("window.addEventListener('pageshow', (ev) => { if (ev.persisted) resumeDay(); });");
    expect(html).toContain('if (!GATE.ticking) GATE.ticking = setInterval(refreshGate, 1000);');
    expect(html).not.toMatch(/\n {2}setInterval\(refreshGate, 1000\);/);
    expect(html).toContain("new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })");
  });
});
