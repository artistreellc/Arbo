// R26 (Mike, 2026-10-20): the Crew tile in More opens the crew's page as a
// LOOK-ONLY preview that cannot sign anything. Three doors keep it that way:
// the page's api() refuses every write before it leaves the phone, each
// control that would write is switched off with the reason beside it, and
// the server refuses a crew write that carries the preview header — whatever
// key came with it. vitest has no DOM, so the page's pieces are lifted out of
// crew.html and run on stand-ins; the server is run for real.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { loadAppHtml } from '../src/server/appPage.js';

const crew = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');
const app = loadAppHtml();
const WHY = 'Off in the preview — nothing here signs, files or clocks in.';
/** A practice crew code (CREW_PLAN C3): UUID-shaped and obviously fake. */
const CREW_CODE = '00000000-0000-4000-8000-0000000000c1';

/** One top-level function (closing "}" alone on its line), built with stand-ins. */
function pageFn<T>(src: string, name: string, deps: Record<string, unknown> = {}): T {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(src);
  if (!m) throw new Error(`no function ${name} in the page`);
  return new Function(...Object.keys(deps), `${m[0]}\nreturn ${name};`)(...Object.values(deps)) as T;
}

/** Just enough DOM for the crew page's builders. */
class FakeNode {
  kids: FakeNode[] = [];
  listeners: Record<string, unknown> = {};
  disabled = false;
  hidden = false;
  id = '';
  href = '';
  target = '';
  rel = '';
  type = '';
  placeholder = '';
  autocomplete = '';
  private classes = new Set<string>();
  classList = {
    add: (c: string) => { this.classes.add(c); },
    remove: (c: string) => { this.classes.delete(c); },
    contains: (c: string) => this.classes.has(c),
    toggle: (c: string, on?: boolean) => { if (on ?? !this.classes.has(c)) this.classes.add(c); else this.classes.delete(c); },
  };
  constructor(public tag: string, public className = '', public textContent = '') {}
  appendChild(k: FakeNode): FakeNode { this.kids.push(k); return k; }
  prepend(k: FakeNode): void { this.kids.unshift(k); }
  insertBefore(k: FakeNode, ref: FakeNode): FakeNode { this.kids.splice(this.kids.indexOf(ref), 0, k); return k; }
  replaceChildren(): void { this.kids = []; }
  addEventListener(type: string, fn: unknown): void { this.listeners[type] = fn; }
  setAttribute(): void {}
  /** Every node under this one, depth first. */
  all(): FakeNode[] { return this.kids.flatMap((k) => [k, ...k.all()]); }
}
const el = (tag: string, cls?: string, text?: string): FakeNode => new FakeNode(tag, cls ?? '', text ?? '');
const fakeDocument = (main = new FakeNode('main')) => ({
  createElement: (t: string) => new FakeNode(t),
  createTextNode: (t: string) => new FakeNode('#text', '', t),
  querySelector: () => main,
});

describe('R26 crew preview — how the page knows it is a preview, and whose key it uses', () => {
  it('only ?preview=1 turns it on; it reads the office app’s key and no crew code', () => {
    expect(crew).toContain("const PREVIEW = new URLSearchParams(location.search).get('preview') === '1';");
    expect(crew).toContain("let KEY = PREVIEW ? load('arborKey') : load('arboCrewKey');");
    expect(crew).toContain("let CREW_ID = PREVIEW ? '' : load('arboCrewId');");
  });

  it('the banner is fixed on screen, says exactly what Mike approved, and carries the way back', () => {
    expect(crew).toContain("const PREVIEW_BANNER = 'Preview — this is what the crew sees. Nothing here signs, files or clocks in.';");
    expect(crew).toContain(`const PREVIEW_WHY = '${WHY}';`);
    expect(crew).toMatch(/\.preview-bar\{position:fixed;left:0;right:0;bottom:0;/);
    // The page's last item keeps clear of the bar.
    expect(crew).toMatch(/body\.preview\{padding-bottom:calc\(\d+px \+ env\(safe-area-inset-bottom\)\)\}/);
    const boot = crew.slice(crew.indexOf('// R26: the preview says what it is on every screen'), crew.indexOf('if (renderWhoAmI()) {'));
    expect(boot).toMatch(/^\/\/ R26[^\n]*\nif \(PREVIEW\) \{/);
    expect(boot).toContain("el('div', '', PREVIEW_BANNER)");
    expect(boot).toContain("back.href = '/app#more';");
    // Back steps back to the office app as it was left; a fresh visit replaces the page (no app → preview → app loop).
    expect(boot).toContain("if (history.length > 1 && document.referrer.indexOf('/app') !== -1) history.back();");
    expect(boot).toContain("else location.replace('/app#more');");
  });

  it('the switched-off controls are drawn after their panels, inside the boot block', () => {
    const boot = crew.slice(crew.indexOf('if (renderWhoAmI()) {'));
    expect(boot.indexOf('  if (PREVIEW) previewLock();')).toBeGreaterThan(boot.indexOf('  loadBriefing();'));
    expect(boot.indexOf('  if (PREVIEW) previewLock();')).toBeGreaterThan(boot.indexOf('renderNearMiss();'));
  });
});

describe('R26 crew preview — api() refuses every write before it leaves the phone', () => {
  const make = (preview: boolean) => {
    const sent: Array<{ path: string; init: { method: string; headers: Record<string, string> } }> = [];
    const fetch = async (path: string, init: { method: string; headers: Record<string, string> }) => {
      sent.push({ path, init });
      return { ok: true, status: 200, json: async () => ({ fine: true }) };
    };
    const api = pageFn<(p: string, o?: { method?: string; body?: unknown }) => Promise<unknown>>(crew, 'api', { PREVIEW: preview, KEY: 'k', fetch });
    return { api, sent };
  };

  it('in the preview a POST (or any other write) is refused 403 preview_read_only and nothing is sent', async () => {
    const { api, sent } = make(true);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      await expect(api('/api/crew/briefing/ack', { method, body: { crewMemberId: 'x' } })).rejects.toMatchObject({ code: 403, message: 'preview_read_only' });
    }
    expect(sent).toEqual([]);
  });

  it('in the preview a read goes out with the key and the preview header', async () => {
    const { api, sent } = make(true);
    expect(await api('/api/crew/briefing')).toEqual({ fine: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.init.method).toBe('GET');
    expect(sent[0]!.init.headers).toMatchObject({ 'x-arbor-key': 'k', 'x-arbo-preview': '1' });
  });

  it('on a crew phone nothing changes: a POST goes out, with no preview header', async () => {
    const { api, sent } = make(false);
    await api('/api/crew/near-miss', { method: 'POST', body: { description: 'x' } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.init.method).toBe('POST');
    expect(sent[0]!.init.headers).not.toHaveProperty('x-arbo-preview');
  });
});

describe('R26 crew preview — GO never arms, and never signs', () => {
  const refresh = (preview: string) => {
    const go = { disabled: false, className: '' };
    const status = { textContent: '', classList: { toggle: () => {} } };
    const els: Record<string, unknown> = { 'gate-status': status, gobtn: go };
    // Every condition met: on a crew phone this is a green GO.
    const GATE = { unlocked: false, scrolled: true, checked: true, requiredSeconds: 10, serverMsg: '', serverErr: false, serverHold: false, preview };
    pageFn<() => void>(crew, 'refreshGate', { GATE, $: (id: string) => els[id], secondsOnScreen: () => 99 })();
    return { go, status };
  };

  it('in the preview GO stays off and grey with the reason on its line, even with all three conditions met', () => {
    const { go, status } = refresh(WHY);
    expect(go).toEqual({ disabled: true, className: '' });
    expect(status.textContent).toBe(WHY);
  });

  it('on a crew phone (preview is the empty string) GO arms exactly as before', () => {
    const { go, status } = refresh('');
    expect(go).toEqual({ disabled: false, className: 'ready' });
    expect(status.textContent).toBe('Ready — press GO.');
  });

  it('GATE carries the reason only in the preview', () => {
    expect(crew).toContain("preview: PREVIEW ? PREVIEW_WHY : '',");
  });

  it('a press in the preview sends nothing at all', async () => {
    let calls = 0;
    const go = { disabled: false, textContent: 'GO', className: '' };
    const GATE = { content: {}, startedAt: '', scrolled: true, checked: true, openedMs: 0, unlocked: false, serverMsg: '', serverErr: false, serverHold: false, preview: WHY };
    const submitGate = pageFn<() => Promise<void>>(crew, 'submitGate', {
      $: () => go, GATE, api: async () => { calls += 1; return { unlocked: true }; }, CREW_ID: '', secondsOnScreen: () => 20,
      GATE_NEED: {}, refreshGate: () => {}, renderQuiz: () => {}, renderWork: () => {},
      document: { querySelector: () => ({}) }, LINKS_READY: Promise.resolve(), crewWhy: () => '',
    });
    await submitGate();
    expect(calls).toBe(0);
    expect(GATE.unlocked).toBe(false);
    expect(go).toEqual({ disabled: false, textContent: 'GO', className: '' });
  });
});

describe('R26 crew preview — work orders render read-only', () => {
  const wo = {
    jobId: 'j1', routeOrder: 1, address: '1 SIM Way', city: 'Norfolk', timeIso: '2026-10-20T13:00:00Z',
    scope: 'Raise the canopy', hazards: ['POWER LINES — call first'], permitNote: null, requiresBeforeAfterPhotos: true,
  };
  const render = async (preview: boolean, unlocked = false) => {
    const work = new FakeNode('div');
    const asked: Array<[string, unknown]> = [];
    const api = async (path: string, opts?: unknown) => { asked.push([path, opts]); return { workOrders: [wo], notWorkOrders: 0, contractLookupFailed: false }; };
    const prompt = () => { throw new Error('a switched-off button must not ask anything'); };
    const arrivalButton = pageFn<(id: string) => FakeNode>(crew, 'arrivalButton', { el, api, CREW_ID: '', PREVIEW: preview, prompt });
    const changeOrderButton = pageFn<(id: string) => FakeNode>(crew, 'changeOrderButton', { el, api, PREVIEW: preview, prompt });
    // C2 (D107): the card's address link and Navigate come from the page's one maps builder.
    const crewMapsUrl = pageFn<(a: string, c: string) => string>(crew, 'crewMapsUrl');
    // CREW_PLAN C4 (D109): a crew phone's read carries its crew code (CREW_ID); the preview's stays bare.
    await pageFn<() => Promise<void>>(crew, 'renderWork', {
      $: () => work, el, GATE: { unlocked }, PREVIEW: preview, PREVIEW_WHY: WHY, api, fmtTime: () => '9:00 AM',
      arrivalButton, changeOrderButton, crewMapsUrl, document: fakeDocument(), CREW_ID: preview ? '' : CREW_CODE,
    })();
    return { work, asked };
  };

  // Deliberately rewritten (CREW_PLAN C4, D109; plan names this pin): it pins
  // BOTH calls now — the preview's read is bare (Mike's own key is the one
  // exemption from the sign-off lock), the crew phone's carries its code (the
  // server opens its work orders only on a signed-today ack). Meaning kept: one
  // read, nothing else, and the preview reads the day without a sign-off.
  it('the preview reads the day without a sign-off, and every job button is off with the reason on the card', async () => {
    const { work, asked } = await render(true);
    expect(asked).toEqual([['/api/crew/workorders', undefined]]); // one bare read, nothing else
    const card = work.kids.find((k) => k.className === 'wo')!;
    expect(card).toBeDefined();
    const buttons = card.all().filter((n) => n.tag === 'button');
    // C2 (D107): Navigate is a new control, so in the preview it too is drawn as a switched-off button.
    expect(buttons.map((b) => b.textContent)).toEqual(['Navigate', '📷 Log arrival condition', '+ Extra work agreed']);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    const why = card.kids.filter((k) => k.className === 'preview-why');
    expect(why.map((k) => k.textContent)).toEqual([WHY]);
    // C2 (D107): what the crew sees too — why the job buttons are off on their phone.
    expect(card.kids.filter((k) => k.className === 'jobwhy').map((k) => k.textContent)).toEqual(['No job record yet — tell the office what you found.']);
    // The card still shows the crew everything else it shows them.
    expect(card.all().some((n) => n.className === 'hz power')).toBe(true);
    expect(card.all().some((n) => n.className === 'photos')).toBe(true);
  });

  // Review round (D109, UI 5): the address became a live 44px link to Maps
  // right above a Navigate the preview draws switched off — two controls for
  // one route disagreeing. In the preview the address is plain text, so Maps
  // opens from neither; on a crew phone both still come from the one builder.
  it('in the preview the address is plain text — Maps opens from neither it nor Navigate', async () => {
    const { work } = await render(true);
    const card = work.kids.find((k) => k.className === 'wo')!;
    expect(card.all().filter((n) => n.tag === 'a')).toEqual([]);
    expect(card.all().filter((n) => n.href)).toEqual([]);
    const addr = card.kids.find((k) => k.className === 'addr')!;
    expect(addr.textContent).toBe('1 SIM Way, Norfolk');
    const crewPhone = (await render(false, true)).work.kids.find((k) => k.className === 'wo')!;
    const links = crewPhone.all().filter((n) => n.tag === 'a');
    expect(links.map((n) => n.textContent)).toEqual(['1 SIM Way, Norfolk', 'Navigate']);
    expect(links[0]!.href).toBe(links[1]!.href);
  });

  it('on a crew phone the day stays locked until the briefing, and nothing is read', async () => {
    const { work, asked } = await render(false);
    expect(asked).toEqual([]);
    expect(work.kids.map((k) => k.className)).toEqual(['locked-note']);
  });

  // Deliberately rewritten (CREW_PLAN C2, D107): arrival and extra work need a
  // real job record (site_condition_record.job_id references job), and none
  // reaches a crew phone yet — so on the crew phone too both buttons are off,
  // with the job-record reason instead of a prompt(). The meaning kept: the
  // preview's line is the preview's alone, and a crew phone never shows it.
  it('on a crew phone after the briefing the job buttons are off for want of a job record, and carry no preview line', async () => {
    const { work, asked } = await render(false, true);
    expect(asked).toEqual([[`/api/crew/workorders?crewMemberId=${CREW_CODE}`, undefined]]); // C4: the crew phone's read carries its code
    const card = work.kids.find((k) => k.className === 'wo')!;
    const buttons = card.all().filter((n) => n.tag === 'button');
    expect(buttons.map((b) => b.textContent)).toEqual(['📷 Log arrival condition', '+ Extra work agreed']);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(card.kids.filter((k) => k.className === 'jobwhy').map((k) => k.textContent)).toEqual(['No job record yet — tell the office what you found.']);
    expect(card.all().some((n) => n.className === 'preview-why')).toBe(false);
  });
});

describe('R26 crew preview — never asks for a crew code or the crew door key', () => {
  it('who-am-I: no crew-code field, the card is hidden, and the day goes on', () => {
    const box = new FakeNode('div');
    const ok = pageFn<() => boolean>(crew, 'renderWhoAmI', {
      $: () => box, el, document: fakeDocument(), PREVIEW: true, CREW_ID: '', STORAGE_BLOCKED: '', location: { reload: () => {} },
    })();
    expect(ok).toBe(true);
    expect(box.hidden).toBe(true);
    expect(box.all()).toEqual([]);
  });

  it('a key the server will not take: the office-key card, never the door-key field — and the panels stay hidden', () => {
    for (const notSet of [false, true]) {
      const box = new FakeNode('div');
      box.hidden = true;
      const main = new FakeNode('main');
      pageFn<(n: boolean) => void>(crew, 'renderDoorKey', {
        $: () => box, el, document: fakeDocument(main), PREVIEW: true, KEY: '', STORAGE_BLOCKED: '', location: { reload: () => {} },
      })(notSet);
      expect(main.classList.contains('door-locked')).toBe(true);
      expect(box.hidden).toBe(false);
      expect(box.all().map((n) => n.tag)).toEqual(['h2', 'p']);
      expect(box.kids[0]!.textContent).toBe('Office key needed');
      expect(box.all().some((n) => n.tag === 'input')).toBe(false);
      expect(box.all().map((n) => n.textContent).join(' ')).not.toMatch(/crew door key/i);
    }
  });

  it('on a crew phone the door-key card is unchanged', () => {
    const box = new FakeNode('div');
    pageFn<(n: boolean) => void>(crew, 'renderDoorKey', {
      $: () => box, el, document: fakeDocument(), PREVIEW: false, KEY: '', STORAGE_BLOCKED: '', location: { reload: () => {} },
    })(false);
    expect(box.kids[0]!.textContent).toBe('Crew door key');
    expect(box.all().some((n) => n.tag === 'input')).toBe(true);
  });
});

describe('R26 crew preview — library lookup, near-miss filing and the clock-in question are off, with the reason', () => {
  const lock = (friday = false) => {
    const nodes: Record<string, FakeNode> = {};
    for (const id of ['lib-q', 'lib-go', 'lib-out', 'nm-desc', 'nm-go', 'nm-out', 'quiz']) nodes[id] = new FakeNode(id.endsWith('-q') ? 'input' : id === 'nm-desc' ? 'textarea' : 'div');
    nodes.quiz!.appendChild(new FakeNode('div', 'stale'));
    pageFn<() => void>(crew, 'previewLock', {
      $: (id: string) => nodes[id], el, PREVIEW_WHY: WHY,
      QUIZ_TITLE: { clock_in_gate: 'Question before you roll', friday_questionnaire: 'Friday check' }, isFridayEt: () => friday,
    })();
    return nodes;
  };

  it('the lookup and the filing are switched off — box and button — with the reason under each', () => {
    const n = lock();
    for (const id of ['lib-q', 'lib-go', 'nm-desc', 'nm-go']) expect(n[id]!.disabled, id).toBe(true);
    for (const id of ['lib-out', 'nm-out']) expect(n[id]!.kids.map((k) => [k.className, k.textContent]), id).toEqual([['preview-why', WHY]]);
  });

  it('the clock-in question is drawn as the preview’s gap — never as "no questions" — with Submit off', () => {
    const q = lock().quiz!;
    expect(q.kids.map((k) => k.className)).toEqual(['panel-title', 'state', 'gate-go', 'preview-why']);
    expect(q.kids[0]!.textContent).toBe('Question before you roll');
    expect(q.kids[1]!.textContent).toContain('The preview has no crew member, so nothing is drawn');
    expect(q.kids[1]!.textContent).toContain('that is not “no questions”');
    expect(q.kids[2]!.disabled).toBe(true);
    expect(q.kids[3]!.textContent).toBe(WHY);
    expect(lock(true).quiz!.kids[0]!.textContent).toBe('Friday check');
  });

  it('the preview words keep the crew door’s law: no "clear", no price words', () => {
    const words = crew.slice(crew.indexOf('// R26 (Mike, 2026-10-20)'), crew.indexOf("let KEY = PREVIEW"));
    expect(words).not.toMatch(/\bclear(ed)?\b/i);
    expect(words.toLowerCase()).not.toMatch(/price|invoice|quoted|margin/);
  });
});

describe('R26 crew preview — the Crew tile in More', () => {
  it('opens the look-only preview in this same tab', () => {
    expect(app).toContain("tile('i-crew', 'Crew', 'What the crew sees', () => { location.href = '/crew?preview=1'; });");
    expect(app).not.toContain("window.open('/crew'");
  });
});

// ---- The server: a preview write is refused whatever key comes with it.
const saved = { ...process.env };
afterAll(() => { process.env = { ...saved }; vi.resetModules(); });

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

describe('R26 crew preview — the server refuses a preview write on /api/crew/* (defence in depth)', () => {
  const ack = { crewMemberId: '55555555-5555-4555-8555-555555555555', content: { id: '33333333-3333-3333-3333-333333333333', body: 'Watch the drop zone.' }, state: { scrolledToBottom: true, checkboxTicked: true, secondsOnScreen: 20 }, startedAtIso: '2026-10-20T10:00:00Z', completedAtIso: '2026-10-20T10:00:20Z' };
  const call = (base: string, method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  it('a preview POST to /api/crew/briefing/ack is 403 preview_read_only even with the owner key — and with the crew key', async () => {
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', ARBO_DATA_LINKS: undefined });
    try {
      for (const key of ['admin-k', 'crew-k']) {
        const r = await call(base, 'POST', '/api/crew/briefing/ack', { 'x-arbor-key': key, 'x-arbo-preview': '1' }, ack);
        expect(r.status, key).toBe(403);
        expect(await r.json()).toEqual({ error: 'preview_read_only' });
      }
    } finally { srv.close(); }
  });

  it('a normal crew POST still reaches its handler and gets the handler’s own answer', async () => {
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', ARBO_DATA_LINKS: undefined });
    try {
      for (const key of ['crew-k', 'admin-k']) {
        const r = await call(base, 'POST', '/api/crew/briefing/ack', { 'x-arbor-key': key }, ack);
        // The links are cut here, so the sign-off handler answers 503 by name —
        // exactly what it answered before R26. Not the preview's 403.
        expect(r.status, key).toBe(503);
        expect(await r.json()).toEqual({ error: 'db_not_configured' });
      }
      // A malformed body is still the handler-path's 400, not a 403.
      const bad = await fetch(base + '/api/crew/near-miss', { method: 'POST', headers: { 'x-arbor-key': 'crew-k' }, body: '{nope' });
      expect(bad.status).toBe(400);
    } finally { srv.close(); }
  });

  it('every crew write is refused under the preview header; a preview read still reads', async () => {
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', ARBO_DATA_LINKS: undefined });
    try {
      const h = { 'x-arbor-key': 'admin-k', 'x-arbo-preview': '1' };
      for (const p of ['/api/crew/briefing/ack', '/api/crew/near-miss', '/api/crew/arrival', '/api/crew/change-order', '/api/crew/quiz/complete']) {
        const r = await call(base, 'POST', p, h, {});
        expect(r.status, p).toBe(403);
        expect(await r.json(), p).toEqual({ error: 'preview_read_only' });
      }
      expect((await call(base, 'PUT', '/api/crew/briefing', h, {})).status).toBe(403);
      // Reads go through to their handlers (cut links: a named 503, never the preview's 403).
      for (const p of ['/api/crew/briefing', '/api/crew/workorders']) {
        const r = await call(base, 'GET', p, h);
        expect(r.status, p).toBe(503);
        expect(await r.json(), p).toEqual({ error: 'db_not_configured' });
      }
    } finally { srv.close(); }
  });

  it('the key gate still comes first: a preview request with no key or a wrong key is 401', async () => {
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', ARBO_DATA_LINKS: undefined });
    try {
      expect((await call(base, 'POST', '/api/crew/briefing/ack', { 'x-arbo-preview': '1' }, ack)).status).toBe(401);
      expect((await call(base, 'POST', '/api/crew/briefing/ack', { 'x-arbor-key': 'wrong', 'x-arbo-preview': '1' }, ack)).status).toBe(401);
    } finally { srv.close(); }
  });
});
