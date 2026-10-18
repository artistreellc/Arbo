// QA round 2 — the shared vocabulary every screen draws from (package shared):
// one status -> colour table for chips, a dead feed that never looks like a
// help tip (§1B), feed-state cards that say each fact once, and one plural.
// vitest has no DOM, so CSS and copy are source pins; the helpers with logic
// are lifted out of the page and run against plain stand-ins.
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';

const html = loadAppHtml();
const between = (from: string, to: string) => {
  const at = html.indexOf(from);
  expect(at, `page lost "${from}"`).toBeGreaterThan(-1);
  const end = html.indexOf(to, at + from.length);
  expect(end, `no "${to}" after "${from}"`).toBeGreaterThan(-1);
  return html.slice(at, end);
};
// One CSS rule's body, by the selector that starts its line.
const rule = (sel: string) => between('\n' + sel + '{', '}');

// One top-level function out of the page (it closes with a "}" alone on its
// line), built with stand-ins for every outside name it reaches for.
function pageFn<T>(name: string, deps: Record<string, unknown> = {}): T {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return new Function(...Object.keys(deps), `${m[0]}\nreturn ${name};`)(...Object.values(deps)) as T;
}
// One top-level one-line `const NAME = { … };` out of the page, evaluated.
function pageConst<T>(name: string): T {
  const m = new RegExp(`^const ${name} = (\\{.*\\});`, 'm').exec(html);
  if (!m) throw new Error(`no const ${name} in the page`);
  return new Function(`return ${m[1]};`)() as T;
}
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe('S1: one status -> colour table for every chip on every screen', () => {
  it('the alarm chip keeps strong contrast at night: --on-emergency in all three token blocks', () => {
    const light = between(':root{\n  color-scheme:light;', '\n}');
    const night = between('@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){', '}}');
    const pinned = between(':root[data-theme="dark"]{', '\n}');
    expect(light).toContain('--on-emergency:#FFFFFF;');
    expect(night).toContain('--on-emergency:#2B0D0A;');
    expect(pinned).toContain('--on-emergency:#2B0D0A;');
    // Each sits with the emergency colours it is read against.
    expect(light.indexOf('--on-emergency')).toBeGreaterThan(light.indexOf('--emergency-bg'));
  });

  it('five tones, one rule each, straight after the legacy chips (which stay until every caller moves)', () => {
    for (const r of [
      '.t-alarm{background:var(--emergency);color:var(--on-emergency);border-color:var(--emergency);box-shadow:0 0 0 2px color-mix(in srgb,var(--emergency) 22%,transparent)}',
      '.t-stop{background:var(--emergency-bg);color:var(--emergency);border-color:color-mix(in srgb,var(--emergency) 50%,transparent)}',
      '.t-watch{background:var(--warning-bg);color:color-mix(in srgb,var(--warning) 78%,var(--ink-1));border-color:color-mix(in srgb,var(--warning) 45%,transparent)}',
      '.t-good{background:var(--ok-bg);color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent)}',
      '.t-info{background:var(--paper-2);color:var(--ink-3);border-color:var(--hairline)}',
    ]) expect(html, r).toContain('\n' + r + '\n');
    const pending = html.indexOf('.b-pending{background:var(--paper-2);color:var(--ink-3);border-color:var(--hairline)}');
    const table = html.indexOf('/* ONE status -> colour table for every chip on every screen');
    expect(pending).toBeGreaterThan(-1);
    expect(table).toBeGreaterThan(pending);
    expect(html.indexOf('\n.t-alarm{')).toBeGreaterThan(table);
    // The legacy chips are still there: callers move off them one package at a time.
    for (const legacy of ['.b-emg{', '.b-flag{', '.b-warm{', '.b-review{', '.b-verify{', '.b-src{']) expect(html).toContain('\n' + legacy);
  });

  it('TONE names the five classes; a feed state maps to grey (a gap on purpose) or amber (unknown)', () => {
    expect(html).toContain("const TONE = { alarm: 't-alarm', stop: 't-stop', watch: 't-watch', good: 't-good', info: 't-info' };");
    expect(html).toContain("const FEED_TONE = { cut: 'info', sim: 'info', unset: 'watch', unread: 'watch' };");
    const TONE = pageConst<Record<string, string>>('TONE');
    for (const cls of Object.values(TONE)) expect(html, cls).toContain('\n.' + cls + '{');
    // Every feed kind the vocabulary knows has a tone, and every tone is a real one.
    const FEED_TONE = pageConst<Record<string, string>>('FEED_TONE');
    expect(Object.keys(FEED_TONE).sort()).toEqual(Object.keys(pageConst<Record<string, string>>('FEED_WORD')).sort());
    for (const tone of Object.values(FEED_TONE)) expect(Object.keys(TONE)).toContain(tone);
  });

  it('chip() wears its tone, and a tone it does not know reads "needs a look" — never calm or good', () => {
    const TONE = pageConst<Record<string, string>>('TONE');
    const chip = pageFn<(t: string, tone?: string) => { t: string; c: string }>('chip', { badge: (t: string, c: string) => ({ t, c }), TONE });
    expect(chip('CALL FIRST', 'alarm')).toEqual({ t: 'CALL FIRST', c: 't-alarm' });
    expect(chip('BLOCKED', 'stop').c).toBe('t-stop');
    expect(chip('SOURCED', 'good').c).toBe('t-good');
    expect(chip('CUT', 'info').c).toBe('t-info');
    expect(chip('???', 'urgentish').c).toBe('t-watch');
    expect(chip('???').c).toBe('t-watch');
  });

  it('the canonical word list sits above TONE, and the power-line CALL FIRST is the strongest chip', () => {
    const words = between('TONE WORDS (the canonical list)', 'const TONE = {');
    expect(words).toMatch(/alarm = EMERGENCY, POWER LINES, the power-line CALL FIRST, NO AERIAL WORK \(nothing is stronger\)/);
    for (const w of ['stop = BLOCKED', 'watch = WARM, PERMIT LIKELY, REVIEW NEEDED', 'UNREADABLE', 'good = READ, OK, GOOD, SOURCED', 'info = CUT / LINK CUT, NOT SIMULATED, NOT RUN, NOT BUILT, NO OVERLAY — VERIFY W/ CITY']) {
      expect(words, w).toContain(w);
    }
    // alarm is the only tone with a solid fill and a halo.
    expect(rule('.t-alarm')).toContain('box-shadow:0 0 0 2px');
    for (const t of ['.t-stop', '.t-watch', '.t-good', '.t-info']) expect(rule(t), t).not.toContain('box-shadow');
  });

  it('the helpers sit between showSaveFail and the card-time format, in one block', () => {
    const at = (s: string) => { const i = html.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    const order = ['function showSaveFail(', 'const TONE = {', 'const FEED_TONE = {', 'function chip(', 'function plural(', 'function fmtWhen(', 'function fmtTime('];
    order.reduce((prev, s) => { const i = at(s); expect(i, s).toBeGreaterThan(prev); return i; }, -1);
  });
});

describe('S2: a dead feed never looks like a help tip', () => {
  it('a help tip has no marker; a failed read keeps its weight and its dot', () => {
    expect(html).not.toContain('.storm-muted::before');
    expect(html).toContain('\n.storm-muted{color:var(--ink-3);font-size:13.5px;line-height:1.55;margin-bottom:12px;text-wrap:pretty}\n');
    expect(html).toContain('.wide-btn + .storm-muted{margin-top:14px}');
    expect(rule('.feed-state')).toContain('font-weight:600');
    expect(rule('.feed-state')).toContain('text-wrap:pretty');
    expect(html).toContain('.view .feed-state,');
  });

  it('the dot follows FEED_TONE: amber for not set up, grey for cut / not simulated, a hollow amber ring for a failed read', () => {
    expect(rule('.feed-state::before')).toContain('background:var(--warning)');
    // The ring's border is inside the 8px dot, so it lines up with the filled ones.
    expect(rule('.feed-state::before')).toContain('box-sizing:border-box');
    expect(html).toContain('.feed-state.cut::before,.feed-state.sim::before{background:var(--ink-4)}');
    expect(html).toContain('.feed-state.unread::before{background:none;border:2px solid var(--warning)}');
    // A read that failed is unknown, not danger.
    expect(html).not.toContain('.feed-state.unread::before{background:var(--emergency)}');
  });

  it('the callout vocabulary is written down once, straight above .storm', () => {
    expect(html).toContain('/* .storm = red alarm · .late = amber warning · .feed-state = one line naming a feed Arbo could not read · dashed .state = a whole primary feed it could not read (or a real empty) · .storm-muted = help text only */\n.storm{');
  });

  it('a dashed state card clears the card below, and its headline never strands a word', () => {
    expect(rule('.state')).toContain('margin-bottom:12px');
    expect(rule('.state')).toContain('border:1px dashed var(--border)');
    expect(rule('.state b')).toContain('text-wrap:balance');
  });

  it('an empty error line takes no room in a view or a sheet; the key screen keeps its reserve', () => {
    expect(html).toContain('#keywall .errline{color:#FFB3A6}\n.view .errline:empty,.sheet .errline:empty{display:none}\n');
    expect(rule('.errline')).toContain('min-height:24px'); // #keyerr: no layout jump when a message lands
  });
});

describe('S3: a feed-state card says each fact once', () => {
  const FEED_WORD = pageConst<Record<string, string>>('FEED_WORD');
  const FEED_SAYS = pageConst<Record<string, string>>('FEED_SAYS');

  it('the body adds to the headline instead of repeating it', () => {
    expect(Object.keys(FEED_SAYS).sort()).toEqual(Object.keys(FEED_WORD).sort());
    for (const k of Object.keys(FEED_WORD)) expect(FEED_SAYS[k], k).not.toContain(FEED_WORD[k]);
    expect(FEED_SAYS.sim).not.toContain('practice data');
    expect(FEED_SAYS.cut).not.toContain('cut on purpose');
    expect(FEED_SAYS.unset).not.toContain('not set up');
    expect(FEED_SAYS.cut).toContain('Nothing was deleted');
    expect(FEED_SAYS.sim).toBe('Nothing was read.');
  });

  it('feedState names the gap once, offers a retry only for a failed read, and carries one honesty tag', () => {
    const RETRY = 'Tap ↻ at the top to try again.';
    const feedState = pageFn<(e: unknown, what: string, notWhat?: string, retry?: string) => { t: string; m: string }>('feedState', {
      feedKind: (e: { k: string }) => e.k, FEED_WORD, FEED_SAYS, RETRY, state: (t: string, m: string) => ({ t, m }),
    });
    for (const [k, word] of Object.entries(FEED_WORD)) {
      const card = feedState({ k }, 'The Book', 'an empty Book');
      const all = card.t + ' ' + card.m;
      expect(card.t, k).toBe('The Book — ' + word);
      expect(count(all, word), k).toBe(1);
      expect(count(all, 'This is not '), k).toBe(1);
      expect(card.m.endsWith(' This is not an empty Book.'), k).toBe(true);
      expect(card.m.includes(RETRY), k).toBe(k === 'unread');
    }
    expect(feedState({ k: 'sim' }, 'The Book', 'an empty Book').m).toBe('Nothing was read. This is not an empty Book.');
  });
});

describe('plural: counts read like a person wrote them', () => {
  const plural = pageFn<(n: number, one: string, many?: string) => string>('plural');
  it('never "stop(s)"', () => {
    expect(plural(1, 'stop')).toBe('1 stop');
    expect(plural(2, 'stop')).toBe('2 stops');
    expect(plural(0, 'stop')).toBe('0 stops');
    expect(plural(1, 'emergency', 'emergencies')).toBe('1 emergency');
    expect(plural(3, 'emergency', 'emergencies')).toBe('3 emergencies');
  });
});
