// Direction B, P4 (docs/DIRECTION_B.md follow-up answers): Mike renamed the
// old receptionist page "Phone line (off while Sona answers)". "Talk" now
// means only the R30 header button. The page, its Today button (removed while
// the line is cut, R21) and its More tile all say "Phone line"; the 503 page
// /talk serves while the line is cut says "Phone line is off".
import { describe, it, expect, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { loadAppHtml, loadTalkHtml } from '../src/server/appPage.js';

const html = loadAppHtml();
const code = html.replace(/^\s*\/\/.*$/gm, ''); // what runs, not what the comments remember

function fnSrc(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
function pageFn<T>(name: string, deps: Record<string, unknown>): T {
  return new Function(...Object.keys(deps), `${fnSrc(name)}\nreturn ${name};`)(...Object.values(deps)) as T;
}

class FNode {
  className = ''; textContent = ''; disabled = false;
  children: FNode[] = [];
  attrs: Record<string, string> = {};
  handlers: Array<() => unknown> = [];
  constructor(readonly tag: string) {}
  appendChild(c: FNode): FNode { this.children.push(c); return c; }
  replaceChildren(): void { this.children = []; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  addEventListener(_t: string, f: () => unknown): void { this.handlers.push(f); }
  all(): FNode[] { return [this, ...this.children.flatMap((c) => c.all())]; }
  querySelector(sel: string): FNode | null {
    const m = /^\.?([\w-]+)$/.exec(sel)!;
    return this.all().slice(1).find((n) => (sel.startsWith('.') ? n.className.split(' ').includes(m[1]!) : n.tag === m[1])) ?? null;
  }
}
const el = (tag: string, cls?: string, text?: string) => { const n = new FNode(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const flush = () => new Promise((r) => setTimeout(r, 0));

async function moreTiles(linkCut: boolean) {
  const v = el('div');
  const opened: unknown[][] = [];
  pageFn<() => void>('renderMore', {
    $: () => v, el, icon: (id: string) => el('svg', 'ico', id),
    api: async (p: string) => (p === '/api/reception/status' ? { linkCut } : { approvals: [] }),
    switchTab: () => {}, renderAssistant: () => {}, renderAgents: () => {}, renderLearn: () => {}, renderMeasure: () => {}, renderPermits: () => {},
    themePref: () => 'auto', setTheme: () => {}, installCard: () => el('div'), location: {}, window: { open: (...a: unknown[]) => opened.push(a) },
    officeHub: () => ({ el: el('div') }), // Direction B P14: Office's desks draw above the grid (directionB_office)
  })();
  await flush();
  const tiles = v.all().filter((n) => n.className === 'gtile');
  const titled = (t: string) => tiles.find((x) => x.querySelector('b')!.textContent === t);
  return { tiles, titled, opened };
}

describe('the old receptionist page is "Phone line" (P4)', () => {
  it('More: the tile says Phone line; while the line is cut it is off and says why', async () => {
    const cut = await moreTiles(true);
    const tile = cut.titled('Phone line')!;
    expect(tile).toBeDefined();
    expect(tile.querySelector('small')!.textContent).toBe('Off while Sona answers calls');
    expect(tile.disabled).toBe(true);
    expect(cut.titled('Talk')).toBeUndefined(); // "Talk" is only the header button now
  });

  it('More: with the line live, the tile opens the page, named as Arbo’s receptionist', async () => {
    const live = await moreTiles(false);
    const tile = live.titled('Phone line')!;
    expect(tile.querySelector('small')!.textContent).toBe('Arbo’s receptionist');
    expect(tile.disabled).toBe(false);
    await tile.handlers[0]!();
    expect(live.opened).toEqual([['/talk', '_blank', 'noopener']]);
  });

  it('Today: the button says Phone line, keeps its id (removed while the line is cut) and stays above the brief read', () => {
    const today = fnSrc('renderToday');
    expect(today).toContain("const talkBtn = el('button', 'hudbtn', 'Phone line');");
    expect(today).toContain("talkBtn.id = 'talk-btn';");
    expect(today).toContain("talkBtn.addEventListener('click', () => window.open('/talk', '_blank', 'noopener'));");
    expect(today.indexOf("el('button', 'hudbtn', 'Phone line')")).toBeLessThan(today.indexOf("api('/api/brief"));
    // R21: the cut line still takes the button away.
    expect(fnSrc('receptionStrip')).toContain("const tb = document.getElementById('talk-btn');");
  });

  it('nothing the app shows still says "Talk to Arbo" or "Voice with Arbo"', () => {
    expect(code).not.toContain('Talk to Arbo');
    expect(code).not.toContain('Voice with Arbo');
  });

  it('the R30 header Talk button is untouched', () => {
    expect(html).toContain('<button id="talk-open" class="iconbtn talk-open" title="Talk" aria-label="Talk — ask Arbo out loud"><svg class="hico" aria-hidden="true"><use href="#i-mic"/></svg><span>Talk</span></button>');
  });

  it('the page itself is titled Phone line', () => {
    expect(loadTalkHtml()).toContain('<title>Phone line — Art-is-Tree</title>');
  });

  it('PHONE_SETUP.md names the page by its new name', () => {
    const doc = readFileSync(new URL('../docs/PHONE_SETUP.md', import.meta.url), 'utf8');
    expect(doc).toContain('the Phone line page (`/talk`)');
    // The old name only in the one line that says it was renamed.
    expect(doc.match(/Talk to Arbo/g)).toHaveLength(1);
    expect(doc).toContain('was "Talk to Arbo" until Mike renamed it on 2026-10-20');
  });

  describe('the /talk page while the line is cut (R21)', () => {
    const saved = { ...process.env };
    afterAll(() => { process.env = { ...saved }; vi.resetModules(); });
    it('says "Phone line is off" in its title and heading, never "Talk"', async () => {
      vi.resetModules();
      delete process.env.ARBO_LINK_ELEVENLABS;
      const { createArborRequestHandler } = await import('../src/server.js');
      const srv = createServer(createArborRequestHandler());
      await new Promise<void>((r) => srv.listen(0, r));
      try {
        const res = await fetch(`http://127.0.0.1:${(srv.address() as { port: number }).port}/talk`);
        expect(res.status).toBe(503);
        const page = await res.text();
        expect(page).toContain('<title>Arbo — Phone line is off</title>');
        expect(page).toContain('<h1>Phone line is off</h1>');
        expect(page).not.toMatch(/Talk/);
        expect(page).toContain('Nothing was deleted');
      } finally { srv.close(); }
    });
  });
});

describe('the rulings doc no longer calls the rename open (review UI 4)', () => {
  const rulings = readFileSync(new URL('../docs/OWNER_RULINGS.md', import.meta.url), 'utf8');
  it('R30\'s "two things are called Talk" item is closed by Mike\'s rename, which P4 built', () => {
    const at = rulings.indexOf('**two things are called "Talk"**');
    expect(at).toBeGreaterThan(-1);
    const item = rulings.slice(at, rulings.indexOf('\n\n', at));
    expect(item).toContain('Closed 2026-10-20');
    expect(item).toContain('docs/DIRECTION_B.md');
    expect(item).toContain('"Phone line (off while Sona answers)"');
    expect(item).toContain('Direction B P4');
    expect(rulings.slice(at - 200, at)).not.toMatch(/Open — Mike's call, not a build's: $/);
  });
});

