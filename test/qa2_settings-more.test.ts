// QA round 2 — Settings and More (package "settings-more"). vitest has no DOM,
// so the screen's logic is lifted out of the page and run against plain
// stand-ins for what it touches; copy and CSS are source pins.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadAppHtml } from '../src/server/appPage.js';

const html = loadAppHtml();
const sprite = readFileSync(new URL('../src/app/sprite.svg', import.meta.url), 'utf8');

// One top-level function out of the page (it closes with a "}" alone on its
// line), built with stand-ins for every outside name it reaches for.
function pageFn<T>(name: string, deps: Record<string, unknown> = {}): T {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return new Function(...Object.keys(deps), `${m[0]}\nreturn ${name};`)(...Object.values(deps)) as T;
}

// A node with just enough of an element for the Settings builder.
type N = {
  tag: string; className: string; textContent: string; tone?: string; children: N[];
  style: Record<string, string>; [k: string]: unknown;
  appendChild(c: N): N;
};
function node(tag = 'div', cls = '', text = ''): N {
  const n: N = {
    tag, className: cls, textContent: text, children: [], style: {},
    appendChild(c: N) { n.children.push(c); return c; },
    setAttribute() {}, addEventListener() {}, classList: { toggle() {} },
  };
  return n;
}
const all = (n: N): N[] => [n, ...n.children.flatMap(all)];
const texts = (n: N) => all(n).map((x) => x.textContent).filter(Boolean);
const withText = (n: N, s: string) => all(n).find((x) => x.textContent.includes(s));

type Route = unknown | { fail: { code?: number; message?: string } };
function apiFrom(routes: Record<string, Route>) {
  return async (path: string) => {
    if (!(path in routes)) throw Object.assign(new Error('error'), { code: 500 });
    const r = routes[path] as { fail?: { code?: number; message?: string } };
    if (r && typeof r === 'object' && 'fail' in r && r.fail) throw Object.assign(new Error(r.fail.message || 'error'), { code: r.fail.code });
    return r;
  };
}
const OK_ROUTES: Record<string, Route> = {
  '/api/settings/channels': { channels: [{ id: 'gmail', label: 'Gmail leads', on: true }, { id: 'lsa', label: 'Google LSA', on: false }] },
  '/api/inbox/intents': { pipeline: 'live' },
  '/api/settings/route': { workZip: null, location: { enabled: false, zip: null, ageMinutes: null } },
  '/api/reception/status': { linkCut: false },
  '/api/google/connect': { token: { stored: true, where: 'disk', savedAt: null }, consentUrl: 'https://example.invalid/consent' },
  '/api/links': { master: 'cut', links: [{ link: 'leads', state: 'cut' }] },
  '/api/webhooks': { sources: { resend: { configured: false, received: 0 }, railway: { configured: true, received: 0 } }, cut: [] },
  '/api/quo': { status: { registration: { state: 'ok' }, received: 0 } },
};
async function build(over: Record<string, Route> = {}) {
  const v = node();
  const keywall = vi.fn();
  const buildSettings = pageFn<(v: N, gen: number) => Promise<void>>('buildSettings', {
    settingsGen: 1,
    api: apiFrom({ ...OK_ROUTES, ...over }),
    el: (tag: string, cls?: string, text?: string) => node(tag, cls || '', text || ''),
    document: { createElement: (tag: string) => node(tag) },
    state: (title: string, msg: string) => node('div', 'state', title + ' | ' + msg),
    feedLine: (_e: unknown, what: string, tail?: string) => node('div', 'feed-state', what + (tail ? ' ' + tail : '')),
    chip: (text: string, tone: string) => Object.assign(node('span', 'badge', text), { tone }),
    feedKind: (e: { code?: number }) => (e && e.code === 503 ? 'unset' : 'unread'),
    FEED_WORD: { cut: 'cut on purpose', sim: 'not in the practice data', unset: 'not set up yet', unread: 'couldn’t read it' },
    LINKS_READY: Promise.resolve('cut'),
    showKeywall: keywall,
    showSaveFail: () => {}, saveFailText: () => '', fmtTime: () => '', renderSettings: () => {},
    themePref: () => 'auto', setTheme: () => {},
  });
  await buildSettings(v, 1);
  return { v, keywall };
}

describe('Settings swaps in one go after the first visit (ST1)', () => {
  function harness(firstChild: unknown) {
    const live = { firstChild, replaceChildren: vi.fn() };
    const builds: Array<{ v: unknown; gen: number; done: () => void }> = [];
    const render = pageFn<() => Promise<void>>('renderSettings', {
      settingsGen: 0,
      $: (id: string) => (id === 'view-settings' ? live : null),
      el: () => ({ childNodes: ['built-a', 'built-b'] }),
      buildSettings: (v: unknown, gen: number) => new Promise<void>((r) => builds.push({ v, gen, done: r })),
    });
    return { live, builds, render };
  }

  it('the first visit fills the live view itself and never swaps', async () => {
    const { live, builds, render } = harness(null);
    const p = render();
    expect(builds).toHaveLength(1);
    expect(builds[0]!.v).toBe(live);
    builds[0]!.done();
    await p;
    expect(live.replaceChildren).not.toHaveBeenCalled();
  });

  it('a later render builds off screen and calls replaceChildren once on the live view', async () => {
    const { live, builds, render } = harness({});
    const p = render();
    expect(builds[0]!.v).not.toBe(live);
    expect(live.replaceChildren).not.toHaveBeenCalled(); // the old page stays up while it builds
    builds[0]!.done();
    await p;
    expect(live.replaceChildren).toHaveBeenCalledTimes(1);
    expect(live.replaceChildren).toHaveBeenCalledWith('built-a', 'built-b');
  });

  it('a stale build never swaps over a newer one', async () => {
    const { live, builds, render } = harness({});
    const a = render();
    const b = render();
    expect(builds.map((x) => x.gen)).toEqual([1, 2]);
    builds[0]!.done(); // the older read lands last-but-one: it must not swap
    await a;
    expect(live.replaceChildren).not.toHaveBeenCalled();
    builds[1]!.done();
    await b;
    expect(live.replaceChildren).toHaveBeenCalledTimes(1);
  });

  it('the old body moved whole into buildSettings, and the three taps still re-render', () => {
    const body = html.slice(html.indexOf('async function buildSettings(v, gen) {'));
    const fn = body.slice(0, body.indexOf('\n}\n'));
    expect(fn).not.toContain('replaceChildren'); // it writes only to v
    expect(fn).not.toContain("$('view-settings')");
    expect(fn.split('renderSettings();').length - 1).toBe(3); // channel switch, ZIP Save, location toggle
  });
});

describe('Settings in the shared vocabulary (ST0, ST4)', () => {
  it('a dead switches feed is a dashed state in the feed words, and Appearance still draws', async () => {
    const { v } = await build({ '/api/settings/channels': { fail: { code: 502 } } });
    expect(texts(v)).toContain('Channel switches — couldn’t read it | Nothing was changed.');
    expect(withText(v, 'Channel switches')!.className).toBe('state');
    expect(texts(v)).toContain('Appearance');
  });

  it('chips carry tones: link OPEN good / CUT info; webhook WIRED good / NOT WIRED watch / CUT info; Quo FAILED stop', async () => {
    const { v } = await build({
      '/api/links': { master: 'live', links: [{ link: 'leads', state: 'open' }, { link: 'jobs', state: 'cut' }] },
      '/api/webhooks': { sources: { resend: { configured: true, received: 2 }, railway: { configured: false }, twilio: { configured: false } }, cut: ['twilio'] },
      '/api/quo': { status: { registration: { state: 'failed', detail: 'Quo registration failed (timeout).' } } },
    });
    const chips = all(v).filter((n) => n.tone).map((n) => n.textContent + ':' + n.tone);
    expect(chips).toEqual(['OPEN:good', 'CUT:info', 'WIRED:good', 'NOT WIRED:watch', 'CUT:info', 'FAILED:stop']);
    expect(texts(v)).toContain('Resend (website form copies) — 2 received since Arbo last restarted');
    expect(texts(v)).toContain('Railway (deploy notices) — no signing secret set on Railway, so Arbo can’t count what it sent; this is not zero events');
    expect(texts(v)).toContain('Quo (Sona calls & texts) — Quo registration failed (timeout).');
  });

  it('the Quo row names Quo once when it is not connected, and PENDING is a watch chip', async () => {
    const nc = await build({ '/api/quo': { status: { registration: { state: 'not_configured', detail: 'Quo isn’t connected to Arbo yet — the intake’s own words.' } } } });
    expect(texts(nc.v)).toContain('Quo (Sona calls & texts) — not connected to Arbo yet, so Sona’s calls aren’t reaching Arbo');
    expect(all(nc.v).filter((n) => n.textContent === 'NOT WIRED').pop()!.tone).toBe('watch'); // the last one is Quo's (Resend's comes first)
    const pend = await build({ '/api/quo': { status: { registration: { state: 'pending', detail: 'Registering with Quo…' } } } });
    expect(all(pend.v).find((n) => n.textContent === 'PENDING')!.tone).toBe('watch');
  });

  it('the master line: SIMULATION and CUT wear the feed-state look, LIVE stays help text with no ruling code', async () => {
    const sim = await build({ '/api/links': { master: 'sim', links: [] } });
    const simLine = withText(sim.v, 'SIMULATION')!;
    expect(simLine.className).toBe('feed-state sim');
    expect(simLine.textContent).toBe('SIMULATION — every screen is showing fake SIM- records, except the Calendar, which is always your live Google Calendar. No real database is connected; the real links below stay CUT.');
    expect(withText((await build()).v, 'Master switch CUT')!.className).toBe('feed-state cut');
    const liveLine = withText((await build({ '/api/links': { master: 'live', links: [] } })).v, 'Master switch LIVE')!;
    expect(liveLine.className).toBe('storm-muted');
    expect(liveLine.textContent).toBe('Master switch LIVE. A CUT link is a closed door, not empty data — each opens after its verification.');
  });

  it('Google not set up names the two variables Mike sets, with a watch chip', async () => {
    const { v } = await build({ '/api/google/connect': { fail: { code: 503, message: 'not_built' } } });
    expect(all(v).find((n) => n.textContent === 'NOT SET UP')!.tone).toBe('watch');
    expect(texts(v)).toContain('Google sign-in isn’t set up on the server — add GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET on Railway. Nothing is disconnected — it was never set up.');
  });
});

describe('the switches never look live over a dead inbox check (ST2)', () => {
  const onBtn = (v: N) => all(v).find((n) => n.tag === 'button' && n.textContent === 'ON')!;

  it('a check that is not running mutes the ON look and the note says when the choice is used', async () => {
    for (const intents of [
      { pipeline: 'no_gmail', gmailReason: 'no Gmail credentials configured' },
      { pipeline: 'no_gmail', gmailReason: 'gmail said 500' },
      { fail: { code: 502 } },
    ]) {
      const { v } = await build({ '/api/inbox/intents': intents });
      expect(onBtn(v).className).toBe('loc-toggle on idle');
      expect(texts(v)).toContain('Your choices are saved now and used as soon as the inbox check runs. They go back to the standard set whenever Arbo restarts or is updated.');
      expect(texts(v).join(' ')).not.toContain('right away');
    }
  });

  it('a running check (or a first pass still under way) keeps solid ON and "right away"', async () => {
    for (const intents of [{ pipeline: 'live' }, { pipeline: 'no_gmail', gmailReason: 'inbox watch has not completed a pass' }]) {
      const { v } = await build({ '/api/inbox/intents': intents });
      expect(onBtn(v).className).toBe('loc-toggle on');
      expect(texts(v)).toContain('Switches apply to the inbox check right away. They go back to the standard set whenever Arbo restarts or is updated.');
    }
    const off = all((await build({ '/api/inbox/intents': { fail: { code: 502 } } })).v).find((n) => n.tag === 'button' && n.textContent === 'OFF')!;
    expect(off.className).toBe('loc-toggle'); // OFF is never marked idle
  });

  it('the muted ON style sits right after the solid one', () => {
    expect(html).toContain('.loc-toggle.on{background:var(--forest);border-color:var(--forest);color:var(--paper)}\n.loc-toggle.on.idle{background:var(--card);color:var(--forest);border-color:var(--forest);opacity:.75}');
  });
});

describe('the work ZIP and Live location (ST3)', () => {
  it('a failed read is named for both sections, and Live location keeps its heading', async () => {
    const { v, keywall } = await build({ '/api/settings/route': { fail: { code: 503, message: 'db_not_configured' } } });
    const t = texts(v);
    expect(t).toContain('Work ZIP Nothing was changed.');
    expect(t).toContain('Live location (office phone)');
    expect(t).toContain('Live location That doesn’t mean location is off.');
    expect(t.indexOf('Live location (office phone)')).toBeLessThan(t.indexOf('Live location That doesn’t mean location is off.'));
    expect(t.join(' ')).not.toContain('unavailable right now');
    expect(keywall).not.toHaveBeenCalled();
    expect(t).toContain('Google'); // the rest of the screen still draws
  });

  it('a 401 on the ZIP read asks for the key instead of naming a dead feed', async () => {
    const { v, keywall } = await build({ '/api/settings/route': { fail: { code: 401 } } });
    expect(keywall).toHaveBeenCalledTimes(1);
    expect(texts(v).join(' ')).not.toContain('Work ZIP');
  });

  it("while Arbo's own line is cut, no caller offer is promised", async () => {
    const { v } = await build({ '/api/reception/status': { linkCut: true } });
    const intro = withText(v, 'Where you’re working today')!.textContent;
    expect(intro).toContain('sets where your route and estimate prep sheets start');
    expect(intro).toContain('no caller is offered the nearby estimate right now');
    expect(intro).not.toContain('get offered an easy weekday estimate');
    const unset = withText(v, 'Not set today')!;
    expect(unset.className).toBe('feed-state unset');
    expect(unset.textContent).toBe('Not set today — route and prep sheets have no starting ZIP. Arbo’s phone line is off, so callers aren’t offered anything either way.');
  });

  it('with the line on, the unset line says what callers lose — and that near-home offers still apply', async () => {
    const { v } = await build();
    expect(withText(v, 'Where you’re working today')!.textContent).toContain('callers in or near this ZIP get offered an easy weekday estimate, and your route and prep sheets start here.');
    expect(withText(v, 'Not set today')!.textContent).toBe('Not set today — callers near your work aren’t offered the nearby slot (near-home offers still apply).');
  });

  it('an unreadable phone-line status is said, not guessed', async () => {
    const { v } = await build({ '/api/reception/status': { fail: { code: 502 } } });
    expect(withText(v, 'Not set today')!.textContent).toBe('Not set today — route and prep sheets have no starting ZIP. (Arbo couldn’t read whether its phone line is on.)');
  });

  it('a set ZIP or a fresh office-phone ping is plain help text, not a gap', async () => {
    const set = await build({ '/api/settings/route': { workZip: '23451', location: { enabled: true, zip: null, ageMinutes: null } } });
    expect(withText(set.v, 'Set for today: 23451')!.className).toBe('storm-muted');
    const ping = await build({ '/api/settings/route': { workZip: null, location: { enabled: true, zip: '23462', ageMinutes: 3 } } });
    expect(withText(ping.v, 'Not set today — the office phone’s live ZIP (23462)')!.className).toBe('storm-muted');
  });
});

describe('More: the disabled Talk tile and the hard hat (ST5)', () => {
  it('a disabled tile fades its icon and title only — the reason line stays full ink', () => {
    expect(html).toContain('.gtile:disabled{box-shadow:none;background:color-mix(in srgb,var(--card) 60%,transparent)}.gtile:disabled .ico,.gtile:disabled b{opacity:.5}');
    expect(html).not.toMatch(/\.gtile:disabled\{[^}]*opacity/);
    expect(html).not.toMatch(/\.gtile:disabled small\{[^}]*opacity/);
  });

  it('the hard hat fills the same 24-unit box as its row-mates (about y 5 to 17.25), with no knob', () => {
    const at = sprite.indexOf('<symbol id="i-crew"');
    const sym = sprite.slice(at, sprite.indexOf('</symbol>', at));
    expect(sym).toContain('viewBox="0 0 24 24"');
    expect(sym).toContain('<path d="M4.5 15v-2.5a7.5 7.5 0 0 1 15 0V15"/>');
    expect(sym).toContain('<path d="M10 5.6V10M14 5.6V10"/>');
    expect(sym).toContain('<path d="M2.75 15h18.5a1 1 0 0 1 1 1v.25a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1V16a1 1 0 0 1 1-1z"/>');
    expect(sym.match(/<path /g)).toHaveLength(3);
    expect(sym).not.toContain('M10.5 9.5V6.75h3v2.75'); // the old bell's knob
  });

  it('the Crew tile keeps its label and target (held for Mike, X1)', () => {
    expect(html).toContain("tile('i-crew', 'Crew', 'What the crew sees', () => window.open('/crew', '_blank', 'noopener'));");
  });
});
