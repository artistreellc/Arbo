// The door's refusals, on the two screens (audit 2026-10-20, Lane A: M1, M2).
// vitest has no DOM, so the page functions are lifted out and run on stand-ins.
//
// The office app: a refusal the server NAMES — "no app key is set on the
//   server" (M1) or "too many wrong keys from this connection" (M2, a 429) —
//   reaches the key screen in those words, never as "that key didn't work",
//   and a 429 is never mistaken for an accepted key (the key screen used to
//   treat any answer past the gate as "the key is good"). The LiDAR busy 429
//   is not about keys and stays its own refusal.
// The crew page: the same two states, in the crew's words.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadAppHtml } from '../src/server/appPage.js';

const app = loadAppHtml();
const crew = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');

function pageFn<T>(src: string, name: string, deps: Record<string, unknown> = {}): T {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(src);
  if (!m) throw new Error(`no function ${name} in the page`);
  return new Function(...Object.keys(deps), `${m[0]}\nreturn ${name};`)(...Object.values(deps)) as T;
}
const pageConst = (src: string, name: string): unknown => {
  const m = new RegExp(`^const ${name} = (\\{[\\s\\S]*?\\});$`, 'm').exec(src);
  if (!m) throw new Error(`no const ${name} in the page`);
  return new Function(`return ${m[1]};`)();
};

describe('the office app — api() sends the gate’s refusals to the key screen with the server’s reason', () => {
  const KEY_REFUSED = pageConst(app, 'KEY_REFUSED') as Record<string, string>;
  const call = async (status: number, body: unknown) => {
    const fetch = async () => ({ ok: status < 400, status, json: async () => { if (body === null) throw new Error('not json'); return body; } });
    const api = pageFn<(p: string) => Promise<unknown>>(app, 'api', {
      fetch, KEY: 'k', KEY_REFUSED, KEY_REFUSED_WHY: '', readOnlyToast: () => {}, READ_ONLY_LINE: '',
    });
    try { await api('/api/leads'); return null; } catch (e) { return e as Error & { code?: number; why?: string | null }; }
  };

  it('a 401 is the key screen’s, with the reason named', async () => {
    expect(await call(401, { error: 'no_app_key', message: '…' })).toMatchObject({ message: 'unauthorized', code: 401, why: 'no_app_key' });
    expect(await call(401, { error: 'unauthorized' })).toMatchObject({ code: 401, why: 'unauthorized' });
    expect(await call(401, null)).toMatchObject({ code: 401, why: null }); // the host's own non-JSON 401
  });

  it('the gate’s 429 goes to the key screen too — never read as "the key is good"', async () => {
    expect(await call(429, { error: 'too_many_attempts', message: '…', retryAfterSec: 60 })).toMatchObject({ code: 401, why: 'too_many_attempts' });
  });

  it('the LiDAR busy 429 is not about keys and stays its own refusal', async () => {
    expect(await call(429, { error: 'measuring_another_scan' })).toMatchObject({ message: 'measuring_another_scan', code: 429 });
  });

  it('the words: no app key on the server, and a connection that must wait', () => {
    expect(KEY_REFUSED.no_app_key).toContain('APP_ACCESS_KEY');
    expect(KEY_REFUSED.no_app_key).toContain('no key can open it yet');
    expect(KEY_REFUSED.too_many_attempts).toContain('Too many wrong keys from this connection');
    expect(KEY_REFUSED.too_many_attempts).toContain('Wait a minute');
    // The key screen opened by any screen's 401 shows the last reason the server gave.
    expect(app).toContain("$('keyerr').textContent = msg || KEY_REFUSED_WHY;");
  });
});

describe('the office app — the key screen', () => {
  async function open(answer: unknown) {
    const els = { keygo: { disabled: false, textContent: 'Open' }, keyinput: { value: 'typed-key' }, keyerr: { textContent: '' } };
    const log: string[] = [];
    const saved: string[] = [];
    const unlock = pageFn<() => Promise<void>>(app, 'unlockWithKey', {
      $: (id: keyof typeof els) => els[id],
      api: async () => { if (answer) throw answer; return {}; },
      showKeywall: (msg: string) => { log.push('wall: ' + msg); },
      hideKeywall: () => { log.push('hide'); },
      refreshAll: () => {},
      refreshActiveMoreView: () => {},
      localStorage: { setItem: (k: string, v: string) => { saved.push(k + '=' + v); } },
      KEY: '',
      KEY_REFUSED: pageConst(app, 'KEY_REFUSED'),
    });
    await unlock();
    return { log, saved };
  }
  const refused = (why: string | null) => Object.assign(new Error('unauthorized'), { code: 401, why });

  it('no app key on the server: says so, saves nothing — never "that key didn’t work"', async () => {
    const r = await open(refused('no_app_key'));
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toContain('APP_ACCESS_KEY');
    expect(r.log[0]).not.toContain('didn’t work');
    expect(r.saved).toEqual([]);
  });

  it('a throttled connection: says to wait, saves nothing, does not open the app', async () => {
    const r = await open(refused('too_many_attempts'));
    expect(r.log).toEqual(['wall: ' + (pageConst(app, 'KEY_REFUSED') as Record<string, string>).too_many_attempts]);
    expect(r.saved).toEqual([]);
  });

  it('a plain wrong key still reads as before', async () => {
    expect((await open(refused('unauthorized'))).log).toEqual(['wall: That key didn’t work — check it and try again.']);
  });
});

describe('the crew page — the door card names the two server states', () => {
  class Node {
    kids: Node[] = [];
    hidden = false;
    id = ''; type = ''; placeholder = ''; autocomplete = ''; autocapitalize = ''; spellcheck = true; enterKeyHint = '';
    private cls = new Set<string>();
    classList = { add: (c: string) => { this.cls.add(c); }, contains: (c: string) => this.cls.has(c) };
    constructor(public tag: string, public className = '', public textContent = '') {}
    appendChild(k: Node): Node { this.kids.push(k); return k; }
    replaceChildren(): void { this.kids = []; }
    addEventListener(): void {}
    setAttribute(): void {}
    all(): Node[] { return this.kids.flatMap((k) => [k, ...k.all()]); }
  }
  const el = (t: string, c?: string, x?: string) => new Node(t, c ?? '', x ?? '');
  const render = (preview: boolean, notSet: boolean, why?: string) => {
    const box = new Node('div');
    const main = new Node('main');
    pageFn<(n: boolean, w?: string) => void>(crew, 'renderDoorKey', {
      $: () => box, el, PREVIEW: preview, KEY: 'k', STORAGE_BLOCKED: '', location: { reload: () => {} },
      document: { createElement: (t: string) => new Node(t), querySelector: () => main },
    })(notSet, why);
    return { box, main, text: box.all().map((n) => n.textContent).join(' '), hasField: box.all().some((n) => n.tag === 'input') };
  };

  it('the briefing’s 401 and the gate’s 429 both reach the door card, with the server’s reason', () => {
    expect(crew).toContain("if (e.code === 401 || e.code === 429) return renderDoorKey(e.message === 'crew_key_not_set', e.message);");
  });

  it('no app key on the server: locked on the server, no field to type into', () => {
    const r = render(false, false, 'no_app_key');
    expect(r.main.classList.contains('door-locked')).toBe(true);
    expect(r.hasField).toBe(false);
    expect(r.text).toContain('locked on the server');
  });

  it('too many wrong keys: the field stays, and the line says to wait', () => {
    const r = render(false, false, 'too_many_attempts');
    expect(r.hasField).toBe(true);
    expect(r.text).toContain('Too many wrong keys from this connection');
    expect(r.text).not.toContain('That key did not open the door');
  });

  it('the preview names both states too, and never asks for the crew door key', () => {
    const locked = render(true, false, 'no_app_key');
    expect(locked.text).toContain('APP_ACCESS_KEY');
    expect(locked.hasField).toBe(false);
    const slow = render(true, false, 'too_many_attempts');
    expect(slow.text).toContain('Too many wrong keys from this connection');
    expect(slow.text).not.toMatch(/crew door key/i);
    expect(slow.hasField).toBe(false);
  });

  it('a plain wrong key on a crew phone reads as before', () => {
    const r = render(false, false, 'unauthorized');
    expect(r.text).toContain('That key did not open the door');
    expect(r.hasField).toBe(true);
  });
});
