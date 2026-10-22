// CREW_PLAN C3 (D109) — sign in without typing a UUID. The office's roster
// hands each person a link, <origin>/crew#crew=<crew code>, that carries the
// crew code only (Q6) — never the door key. The page reads the code from the
// fragment, keeps the fragment in a browser tab (so Add to Home Screen carries
// it) and takes it out once the page runs as the installed app (iOS gives that
// app its own storage, so it must read the code itself). A bad link is said as
// one; the installed app has a paste box as the fallback. vitest has no DOM:
// the page's own functions run over small stand-ins.
import { describe, it, expect, vi, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';

const crew = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');

/** One top-level function's source, from its declaration to the "}" alone on a line. */
const fnSrc = (name: string): string => {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(crew);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
};
/** A one-line top-level const of the page. */
const constLine = (name: string): string => {
  const m = new RegExp(`^const ${name} = [^\\n]*;$`, 'm').exec(crew);
  if (!m) throw new Error(`no const ${name} in the page`);
  return m[0];
};
const lift = <T,>(name: string, deps: Record<string, unknown>, extra = ''): T =>
  new Function(...Object.keys(deps), `${extra}\n${fnSrc(name)}\nreturn ${name};`)(...Object.values(deps)) as T;

const CODE = '00000000-0000-4000-8000-0000000000c1';
const BAD_LINK = 'That sign-in link is broken — ask the office for a new one.';

const crewCodeFrom = lift<(t: unknown) => string>('crewCodeFrom', {}, constLine('CREW_CODE_RE'));

describe('C3 — the crew code is read from the link, the fragment, or the bare code', () => {
  it('reads the whole link, its #crew= part, and a bare code — lower-cased', () => {
    expect(crewCodeFrom(`https://arbor-server-production.up.railway.app/crew#crew=${CODE}`)).toBe(CODE);
    expect(crewCodeFrom(`#crew=${CODE}`)).toBe(CODE);
    expect(crewCodeFrom(`  ${CODE.toUpperCase()}  `)).toBe(CODE);
    expect(crewCodeFrom(`/crew#crew=${encodeURIComponent(CODE)}&x=1`)).toBe(CODE);
  });

  it('anything that is not a crew code shape is no code at all — never half a code', () => {
    for (const bad of ['', '   ', '#crew=', '#crew=not-a-code', `#crew=${CODE.slice(0, 30)}`, 'https://example.com/crew', 'Rudy', '#crew=%E0%A4%A', null, undefined]) {
      expect(crewCodeFrom(bad), String(bad)).toBe('');
    }
  });

  // UI review (D109): copying a whole message bubble on an iPhone brings the
  // punctuation after the link with it. The code ends at the first character
  // that cannot be part of one — never a longer run cut down to fit.
  it('a link with punctuation after it (copied out of a text) still reads the code', () => {
    const link = `https://arbor-server-production.up.railway.app/crew#crew=${CODE}`;
    for (const pasted of [`${link}.`, `(${link})`, `${link}, see you at 7`, `${link}!`, `"${link}"`, `Your link: ${link}.`, `${CODE}.`]) {
      expect(crewCodeFrom(pasted), pasted).toBe(CODE);
    }
  });

  // Review round (D109, UI 8): in the monospace of the old code field the hint
  // needed 235px of a 224px box at 320 ("Paste your sign-in lin"). The box
  // now takes a link, so it reads in the page's own type, as the door key does.
  it('the paste box reads in the page’s own type, so its whole hint fits a 320px phone', () => {
    expect(crew).toContain('#whoami #crewcode{font-family:inherit}');
  });

  it('a code run on into more code characters is no code — never a 36-character slice of something longer', () => {
    for (const bad of [`#crew=${CODE}0`, `#crew=${CODE}-1`, `#crew=a${CODE}`, `${CODE}abc`]) {
      expect(crewCodeFrom(bad), bad).toBe('');
    }
  });
});

// ── The boot: the link opened on this phone ───────────────────────────────
type Boot = { r: { code?: string; broken?: boolean; kept?: boolean; app?: boolean } | null; CREW_ID: string; stored: Record<string, string>; replaced: string[] };
const boot = (o: { hash: string; app?: boolean; storage?: 'ok' | 'blocked'; crewId?: string }): Boot => {
  const stored: Record<string, string> = {};
  const replaced: string[] = [];
  const localStorage = {
    setItem: (k: string, v: string) => { if (o.storage === 'blocked') throw new Error('QuotaExceededError'); stored[k] = v; },
  };
  const location = { hash: o.hash, pathname: '/crew', search: '' };
  const history = { replaceState: (_s: unknown, _t: string, url: string) => { replaced.push(url); location.hash = ''; } };
  const window = { matchMedia: (q: string) => ({ matches: q === '(display-mode: standalone)' && o.app === true }) };
  const navigator = {};
  const run = new Function('localStorage', 'location', 'history', 'window', 'navigator',
    `let CREW_ID = ${JSON.stringify(o.crewId ?? '')};\n${constLine('CREW_CODE_RE')}\n${fnSrc('crewCodeFrom')}\n${fnSrc('installedApp')}\n${fnSrc('takeSignInLink')}\nconst r = takeSignInLink();\nreturn { r, CREW_ID };`);
  const out = run(localStorage, location, history, window, navigator) as { r: Boot['r']; CREW_ID: string };
  return { ...out, stored, replaced };
};

describe('C3 — opening the sign-in link', () => {
  it('in a browser tab: the code is stored and used, and the fragment stays in the address for Add to Home Screen', () => {
    const b = boot({ hash: `#crew=${CODE}` });
    expect(b.r).toEqual({ code: CODE, kept: true, app: false });
    expect(b.CREW_ID).toBe(CODE);
    expect(b.stored).toEqual({ arboCrewId: CODE });
    expect(b.replaced).toEqual([]);
  });

  it('as the installed app: the code is stored and the fragment is taken out of the address', () => {
    const b = boot({ hash: `#crew=${CODE}`, app: true });
    expect(b.r).toEqual({ code: CODE, kept: true, app: true });
    expect(b.stored).toEqual({ arboCrewId: CODE });
    expect(b.replaced).toEqual(['/crew']);
  });

  it('iOS: navigator.standalone counts as the installed app too', () => {
    const run = new Function('window', 'navigator', `${fnSrc('installedApp')}\nreturn installedApp();`);
    expect(run({ matchMedia: () => ({ matches: false }) }, { standalone: true })).toBe(true);
    expect(run({ matchMedia: () => ({ matches: false }) }, {})).toBe(false);
    expect(run({}, {})).toBe(false); // no matchMedia at all: a browser tab, never a throw
  });

  it('a link replaces a different code already on the phone — the office’s link is the word', () => {
    expect(boot({ hash: `#crew=${CODE}`, crewId: '11111111-1111-4111-8111-111111111111' }).CREW_ID).toBe(CODE);
  });

  it('a broken link is named, stores nothing, and leaves the code on the phone alone', () => {
    const b = boot({ hash: '#crew=Rudy', crewId: 'kept' });
    expect(b.r).toEqual({ broken: true, app: false });
    expect(b.stored).toEqual({});
    expect(b.CREW_ID).toBe('kept');
  });

  it('no link: nothing happens', () => {
    for (const hash of ['', '#', '#more']) expect(boot({ hash }).r, hash).toBeNull();
  });

  it('storage refused: the code is still used now, and the page knows it was not kept', () => {
    const b = boot({ hash: `#crew=${CODE}`, storage: 'blocked' });
    expect(b.CREW_ID).toBe(CODE);
    expect(b.r).toEqual({ code: CODE, kept: false, app: false });
  });

  it('runs only off the preview, right after the stored code is read', () => {
    const at = crew.indexOf("let CREW_ID = PREVIEW ? '' : load('arboCrewId');");
    const line = crew.indexOf('const SIGN_IN = PREVIEW ? null : takeSignInLink();');
    expect(at).toBeGreaterThan(-1);
    expect(line).toBeGreaterThan(at);
  });

  it('the fragment never reaches the server: only takeSignInLink reads location.hash, and no request carries it', () => {
    const reads = crew.split('\n').filter((l) => l.includes('location.hash') && !l.trim().startsWith('//'));
    expect(reads.every((l) => /takeSignInLink|const h = String\(location\.hash|if \(location\.hash\)/.test(l)), reads.join('\n')).toBe(true);
    expect(crew).not.toMatch(/api\([^)]*location\.hash/);
    expect(crew).not.toMatch(/api\([^)]*SIGN_IN/);
  });

  it('the crew app installs at /crew, in its own scope, and the manifest carries no crew code', async () => {
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(server).toContain("start_url: crew ? '/crew' : '/app',");
    expect(server).toContain("scope: crew ? '/crew' : '/',");
  });
});

// ── Who is on this phone ──────────────────────────────────────────────────
class N {
  kids: N[] = [];
  handlers: Record<string, () => unknown> = {};
  hidden = false;
  id = '';
  placeholder = '';
  value = '';
  autocomplete = '';
  autocapitalize = '';
  spellcheck = true;
  constructor(public tag: string, public className = '', public textContent = '') {}
  appendChild(k: N): N { this.kids.push(k); return k; }
  replaceChildren(): void { this.kids = []; }
  addEventListener(t: string, f: () => unknown): void { this.handlers[t] = f; }
  setAttribute(): void {}
  all(): N[] { return this.kids.flatMap((k) => [k, ...k.all()]); }
  text(): string { return [this.textContent, ...this.kids.map((k) => k.text())].filter(Boolean).join(' '); }
}
const el = (tag: string, cls?: string, text?: string): N => new N(tag, cls ?? '', text ?? '');
const STORAGE_BLOCKED = 'This phone’s browser is blocking saved data (private browsing or site data off). Turn that off, then try again.';
const flush = () => new Promise((r) => setTimeout(r, 0));

const who = (o: { crewId?: string; signIn?: unknown; me?: () => Promise<unknown>; storage?: 'ok' | 'blocked'; links?: string; hash?: string; app?: boolean }) => {
  const box = new N('div');
  const stored: Record<string, string | null> = {};
  const reloads: number[] = [];
  const replaced: string[] = [];
  const asked: string[] = [];
  const localStorage = {
    setItem: (k: string, v: string) => { if (o.storage === 'blocked') throw new Error('blocked'); stored[k] = v; },
    removeItem: (k: string) => { if (o.storage === 'blocked') throw new Error('blocked'); stored[k] = null; },
  };
  const location = { hash: o.hash ?? '', pathname: '/crew', search: '', reload: () => { reloads.push(1); } };
  const history = { replaceState: (_s: unknown, _t: string, url: string) => { replaced.push(url); location.hash = ''; } };
  const api = async (path: string) => { asked.push(path); return o.me ? o.me() : { firstName: 'Rudy', active: true }; };
  const crewWhy = lift<(e: unknown) => string>('crewWhy', { LINKS: o.links ?? 'live' });
  const checkWho = lift<(a: N, b: N) => Promise<void>>('checkWho', { api, CREW_ID: o.crewId ?? '', LINKS_READY: Promise.resolve(), crewWhy });
  const renderWhoAmI = lift<() => boolean>('renderWhoAmI', {
    $: () => box, el, document: { createElement: (t: string) => new N(t) }, PREVIEW: false, CREW_ID: o.crewId ?? '',
    SIGN_IN: o.signIn ?? null, BAD_LINK, STORAGE_BLOCKED, localStorage, location, history, checkWho,
    crewCodeFrom: lift('crewCodeFrom', {}, constLine('CREW_CODE_RE')), installedApp: () => o.app === true,
  });
  const ok = renderWhoAmI();
  return { ok, box, stored, reloads, replaced, asked };
};

describe('C3 — the name line: "On this phone: Rudy — Not you?"', () => {
  it('the roster names the person; until it answers the line claims only the stored code', async () => {
    const w = who({ crewId: CODE });
    expect(w.ok).toBe(true);
    const row = w.box.kids.find((k) => k.className === 'signed')!;
    expect(row.kids[0]!.textContent).toBe('Crew code on this phone · 00000000');
    expect(w.asked).toEqual([`/api/crew/me?crewMemberId=${encodeURIComponent(CODE)}`]);
    await flush();
    expect(row.kids[0]!.textContent).toBe('On this phone: Rudy —');
    expect(row.kids[1]!.textContent).toBe('Not you?');
    expect(w.box.text()).not.toMatch(/Signed in/);
  });

  it('"Not you?" forgets the code, takes a link out of the address so it cannot sign the same code back in, and reloads', async () => {
    const w = who({ crewId: CODE, hash: `#crew=${CODE}` });
    const row = w.box.kids.find((k) => k.className === 'signed')!;
    await row.kids[1]!.handlers.click!();
    expect(w.stored).toEqual({ arboCrewId: null });
    expect(w.replaced).toEqual(['/crew']);
    expect(w.reloads).toHaveLength(1);
  });

  it('"Not you?" with storage refused says so and does not reload into the same screen', async () => {
    const w = who({ crewId: CODE, storage: 'blocked' });
    const row = w.box.kids.find((k) => k.className === 'signed')!;
    await row.kids[1]!.handlers.click!();
    expect(w.reloads).toHaveLength(0);
    expect(w.box.text()).toContain(STORAGE_BLOCKED);
  });

  it('off the roster, an unknown code, an unreadable roster: each is named — never a pass, never a name', async () => {
    const cases: Array<[number, string, RegExp]> = [
      [403, 'off_roster', /^This crew code is off the roster — check with the office\.$/],
      [400, 'unknown_crew', /^The office doesn’t know this crew code — check it with the office\.$/],
      [503, 'roster_unreadable', /^Name not checked — Arbo couldn’t read the roster just now\.$/],
      [503, 'link_cut', /^Name not checked — the office data link is cut on purpose\.$/],
      [500, 'server_error', /^Name not checked — the office didn’t answer\.$/],
    ];
    for (const [code, message, line] of cases) {
      const w = who({ crewId: CODE, me: async () => { throw Object.assign(new Error(message), { code }); } });
      await flush(); await flush();
      const row = w.box.kids.find((k) => k.className === 'signed')!;
      expect(row.kids[0]!.textContent, message).toBe('Crew code on this phone · 00000000');
      const note = w.box.kids.find((k) => k.className.startsWith('whonote'))!;
      expect(note.textContent, message).toMatch(line);
      expect(note.className, message).toBe('whonote err');
    }
  });

  it('a locked door (401) or the throttle (429) leaves the line alone — the door-key card says that', async () => {
    for (const code of [401, 429]) {
      const w = who({ crewId: CODE, me: async () => { throw Object.assign(new Error('unauthorized'), { code }); } });
      await flush(); await flush();
      expect(w.box.kids.find((k) => k.className.startsWith('whonote'))!.textContent).toBe('');
    }
  });

  it('in a browser tab, a link just opened says to add the app to the home screen first', () => {
    const tab = who({ crewId: CODE, signIn: { code: CODE, kept: true, app: false } });
    expect(tab.box.text()).toContain('Add to Home Screen now, then open Arbo from there.');
    const app = who({ crewId: CODE, signIn: { code: CODE, kept: true, app: true } });
    expect(app.box.text()).not.toContain('Add to Home Screen');
    const plain = who({ crewId: CODE });
    expect(plain.box.text()).not.toContain('Add to Home Screen');
  });

  it('a link whose code could not be kept says so — it works now, not after a relaunch', () => {
    const w = who({ crewId: CODE, signIn: { code: CODE, kept: false, app: false } });
    expect(w.box.text()).toContain(STORAGE_BLOCKED);
  });
});

describe('C3 — the bad-link line and the paste box', () => {
  it('a broken link is said at the top of the card, and the paste box is offered', () => {
    const w = who({ signIn: { broken: true, app: true } });
    expect(w.ok).toBe(false);
    expect(w.box.kids[0]!.textContent).toBe(BAD_LINK);
    expect(w.box.all().some((n) => n.id === 'crewcode')).toBe(true);
  });

  it('the paste box asks for the link, and a pasted link signs in', async () => {
    const w = who({});
    const input = w.box.all().find((n) => n.id === 'crewcode')!;
    expect(input.placeholder).toBe('Paste your sign-in link');
    const go = w.box.all().find((n) => n.tag === 'button')!;
    expect(go.textContent).toBe('Start my day');
    input.value = `  https://arbo.example/crew#crew=${CODE}  `;
    await go.handlers.click!();
    expect(w.stored).toEqual({ arboCrewId: CODE });
    expect(w.reloads).toHaveLength(1);
  });

  it('a bare code still works (the roster shows it under each person)', async () => {
    const w = who({});
    w.box.all().find((n) => n.id === 'crewcode')!.value = CODE;
    await w.box.all().find((n) => n.tag === 'button')!.handlers.click!();
    expect(w.stored).toEqual({ arboCrewId: CODE });
  });

  it('a pasted link with no code in it is the bad-link line — nothing stored, no reload', async () => {
    const w = who({});
    w.box.all().find((n) => n.id === 'crewcode')!.value = 'https://arbo.example/crew#crew=Rudy';
    await w.box.all().find((n) => n.tag === 'button')!.handlers.click!();
    expect(w.stored).toEqual({});
    expect(w.reloads).toHaveLength(0);
    expect(w.box.text()).toContain(BAD_LINK);
  });

  it('an empty box asks for the link', async () => {
    const w = who({});
    await w.box.all().find((n) => n.tag === 'button')!.handlers.click!();
    expect(w.box.text()).toContain('Paste the link from the office.');
    expect(w.reloads).toHaveLength(0);
  });

  // Review round (D109): a tab opened on a broken link kept "#crew=not-a-code"
  // through the paste's reload, so the broken-link line stood over the name.
  // The paste now puts the pasted code's own link in the address, as if it had
  // been opened: in a tab the reload says Add to Home Screen (the fragment
  // carries the code there); the installed app keeps no fragment at all.
  it('a paste in a browser tab puts the pasted code’s link in the address — the broken one is gone', async () => {
    const w = who({ signIn: { broken: true, app: false }, hash: '#crew=not-a-code' });
    w.box.all().find((n) => n.id === 'crewcode')!.value = `https://arbo.example/crew#crew=${CODE}.`;
    await w.box.all().find((n) => n.tag === 'button')!.handlers.click!();
    expect(w.stored).toEqual({ arboCrewId: CODE });
    expect(w.replaced).toEqual([`/crew#crew=${CODE}`]);
    expect(w.reloads).toHaveLength(1);
  });

  it('a paste in the installed app leaves no fragment in the address', async () => {
    const w = who({ signIn: { broken: true, app: true }, app: true });
    w.box.all().find((n) => n.id === 'crewcode')!.value = CODE;
    await w.box.all().find((n) => n.tag === 'button')!.handlers.click!();
    expect(w.replaced).toEqual(['/crew']);
    expect(w.reloads).toHaveLength(1);
  });

  it('a paste whose code could not be stored changes nothing in the address and does not reload', async () => {
    const w = who({ hash: '#crew=not-a-code', storage: 'blocked' });
    w.box.all().find((n) => n.id === 'crewcode')!.value = CODE;
    await w.box.all().find((n) => n.tag === 'button')!.handlers.click!();
    expect(w.replaced).toEqual([]);
    expect(w.reloads).toHaveLength(0);
    expect(w.box.text()).toContain(STORAGE_BLOCKED);
  });
});

// ── GET /api/crew/me through the real handler ─────────────────────────────
const savedEnv = { ...process.env };
afterAll(() => { process.env = { ...savedEnv }; vi.resetModules(); });
async function serve(env: Record<string, string | undefined>): Promise<{ base: string; srv: Server }> {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { createArborRequestHandler } = await import('../src/server.js');
  const srv = createServer(createArborRequestHandler());
  await new Promise<void>((r) => srv.listen(0, r));
  const addr = srv.address();
  return { base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, srv };
}

describe('C3 — GET /api/crew/me on the server: behind the crew door, a read', () => {
  it('practice data: the crew key reads the name; no key is the door’s 401; a bad or unknown code is named', async () => {
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', ARBO_DATA_LINKS: 'sim' });
    try {
      const ok = await fetch(`${base}/api/crew/me?crewMemberId=${CODE}`, { headers: { 'x-arbor-key': 'crew-k' } });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ firstName: 'Test', active: true });
      const none = await fetch(`${base}/api/crew/me?crewMemberId=${CODE}`);
      expect(none.status).toBe(401);
      const bad = await fetch(`${base}/api/crew/me?crewMemberId=Rudy`, { headers: { 'x-arbor-key': 'crew-k' } });
      expect(await bad.json()).toEqual({ error: 'bad_crew_id' });
      const unknown = await fetch(`${base}/api/crew/me?crewMemberId=11111111-1111-4111-8111-111111111111`, { headers: { 'x-arbor-key': 'crew-k' } });
      expect(unknown.status).toBe(400);
      expect(await unknown.json()).toEqual({ error: 'unknown_crew' });
    } finally { srv.close(); }
  });

  it('links cut: a named 503, never a name and never a pass', async () => {
    const { base, srv } = await serve({ APP_ACCESS_KEY: 'admin-k', CREW_ACCESS_KEY: 'crew-k', ARBO_DATA_LINKS: undefined });
    try {
      const r = await fetch(`${base}/api/crew/me?crewMemberId=${CODE}`, { headers: { 'x-arbor-key': 'crew-k' } });
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ error: 'db_not_configured' });
    } finally { srv.close(); }
  });

  it('it is a GET only — no new crew POST (the POST snapshot is unchanged)', () => {
    expect(crew).toContain("api('/api/crew/me?crewMemberId=' + encodeURIComponent(CREW_ID))");
    expect(crew).not.toMatch(/api\('\/api\/crew\/me[^)]*method/);
  });
});
