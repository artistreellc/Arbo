// Direction B, P7 (docs/DIRECTION_B_PLAN.md; spec quick fix "Stops get a big
// Navigate button"). Each stop card on Today's run gets a full-width Navigate
// button that asks first through R35's own sheet (openMapsStop — "Open in Google
// Maps?"), never a second sheet and never a second Maps link builder: mapsDirUrl
// is the page's only one. A stop with no address gets no button. The address
// link and "Route the day" are kept. R35's Calendar rows are untouched.
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';
import { codeStrings } from './support/pageCode.js';

const html = loadAppHtml();
function fnSrc(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
function pageFn<T>(name: string, deps: Record<string, unknown>): T {
  return new Function(...Object.keys(deps), `${fnSrc(name)}\nreturn ${name};`)(...Object.values(deps)) as T;
}

class N {
  className = ''; textContent = ''; type = ''; href = ''; target = ''; rel = '';
  children: N[] = [];
  handlers: Array<() => void> = [];
  attrs: Record<string, string> = {};
  constructor(readonly tag: string) {}
  appendChild(c: N): N { this.children.push(c); return c; }
  prepend(c: N): void { this.children.unshift(c); }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  addEventListener(_t: string, f: () => void): void { this.handlers.push(f); }
  click(): void { for (const h of this.handlers) h(); }
  text(): string { return [this.textContent, ...this.children.map((c) => c.text())].join(''); }
}
const el = (tag: string, cls?: string, text?: string) => { const n = new N(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

const STOP = { id: 'e1', kind: 'estimate', order: 1, name: 'SIM-Alder, Test', address: '101 Simulation Row', city: 'Virginia Beach', zip: '23451', redFlags: [], tags: [] };

describe('Navigate on each stop (P7)', () => {
  const asked: Array<{ title: string; address: string }> = [];
  const stopAddress = pageFn<(s: typeof STOP) => string>('stopAddress', {});
  const navigateBtn = pageFn<(s: typeof STOP) => N | null>('navigateBtn', {
    el, icon: (id: string) => el('svg', id), stopAddress, openMapsStop: (s: { title: string; address: string }) => asked.push(s),
  });

  it('a stop with an address: a full-width Navigate button with the route icon, that asks first through R35\'s sheet with the full address', () => {
    asked.length = 0;
    const b = navigateBtn(STOP)!;
    expect(b.tag).toBe('button');
    expect(b.type).toBe('button');
    expect(b.className.split(' ')).toEqual(expect.arrayContaining(['routebtn', 'navbtn']));
    expect(b.children[0]!.className).toBe('i-route');
    expect(b.text()).toBe('Navigate');
    expect(b.href, 'no link of its own — the sheet asks first').toBe('');
    b.click();
    expect(asked).toEqual([{ title: 'SIM-Alder, Test', address: '101 Simulation Row, Virginia Beach, VA 23451' }]);
  });

  it('no address, no button', () => {
    expect(navigateBtn({ ...STOP, address: '' })).toBeNull();
    expect(stopAddress({ ...STOP, address: '' })).toBe('');
  });

  it('a stop with no ZIP still has its street and city', () => {
    expect(stopAddress({ ...STOP, zip: undefined as unknown as string })).toBe('101 Simulation Row, Virginia Beach, VA');
  });

  it('every stop card on Today\'s run gets exactly one, after the address; the address link and Route the day are kept', () => {
    const today = fnSrc('renderToday');
    const loop = today.slice(today.indexOf('for (const stop of brief.stops) {'));
    expect(loop.match(/navigateBtn\(/g)).toHaveLength(1);
    expect(loop).toContain('const nav = navigateBtn(stop);');
    expect(loop).toContain('if (nav) c.appendChild(nav);');
    expect(loop.indexOf('addr.appendChild(mapsLink(stop.address, stop.city));')).toBeLessThan(loop.indexOf('navigateBtn(stop)'));
    expect(loop.indexOf('navigateBtn(stop)')).toBeLessThan(loop.indexOf('day.appendChild(c);'));
    expect(today).toContain("'Route the day (' + plural(addrs.length, 'stop') + ')'");
    // R35's Calendar rows keep their own "Maps ›" tap.
    expect(fnSrc('todayStopRow')).toContain("row.addEventListener('click', () => openMapsStop(s));");
    expect(fnSrc('todayStopRow')).not.toContain('navigateBtn');
  });

  it('the page has exactly one Google Maps URL builder: mapsDirUrl', () => {
    const builders = codeStrings(html).filter((s) => /google\.com\/maps|maps\.google\.com|maps\.apple\.com|comgooglemaps:/i.test(s.text));
    expect(builders.map((s) => s.fn)).toEqual(['mapsDirUrl']);
    // The address link and Route the day hand their addresses to it.
    expect(fnSrc('mapsLink')).toContain('mapsDirUrl([');
    expect(fnSrc('renderToday')).toContain('r.href = mapsDirUrl(addrs);');
  });

  it('Route the day routes only stops that have an address', () => {
    expect(fnSrc('renderToday')).toContain('const addrs = brief.stops.map(stopAddress).filter(Boolean);');
  });

  it('the button is at least 48 px tall and spans the card', () => {
    expect(html).toMatch(/\.navbtn\{[^}]*width:100%/);
    expect(html).toMatch(/\.navbtn\{[^}]*min-height:52px/);
  });
});
