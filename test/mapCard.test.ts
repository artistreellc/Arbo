// Maps wave B review round (D108): what Mike sees first, on a small phone.
// The UI review found that a way in (Calendar, Estimate, Leads, Fleet) turned
// its layer on, never another off, and SAVED the result — Today's lines sat on
// top and, after three ways in, all four layers stayed on, the Bouncie line
// 544 px down a 193 px notes card at 320; the lit chip was off screen; nothing
// said the card or the chip row scrolls; the Key scrolled its own button away
// and cut its last sentence; at 320 a lead list opened under the notes card;
// and in Night the Key's swatch did not match the shading on the map.
// The rules now: a way in shows Mike's own layers (the chips' choice) plus the
// one it names — its lines lead the card, its chip is scrolled into view —
// and saves nothing; the chips alone are remembered. The card and the chip row
// say when there is more. The Key opens under its own button. While a list is
// open the notes card and Route the day step aside. The swatch is DEQ's orange
// over the map's own ground, Day and Night.
import { describe, it, expect } from 'vitest';
import { loadMapHtml } from '../src/server/appPage.js';

const page = loadMapHtml();
const script = [...page.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)][0]![1]!;
const css = page.slice(page.indexOf('<style>'), page.indexOf('</style>'));
function srcOf(text: string, name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(text);
  if (!m) throw new Error(`no function ${name}`);
  return m[0];
}
function frameFn<T>(name: string, deps: Record<string, unknown> = {}): T {
  return new Function(...Object.keys(deps), `${srcOf(script, name)}\nreturn ${name};`)(...Object.values(deps)) as T;
}
const rule = (sel: string) => {
  const m = new RegExp(`(?:^|\\n|\\})${sel.replace(/[.#*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error('no CSS rule ' + sel);
  return m[1]!;
};
const LAYERS = ['today', 'permits', 'leads', 'trucks'];

describe('a way in shows its layer first and saves nothing; the chips alone are remembered (UI review #3)', () => {
  function harness(saved: Record<string, boolean>, on: Record<string, boolean>) {
    const did: string[] = [];
    const ON = { ...on };
    const SAVED = { ...saved };
    const VIEW = { focus: null as string | null };
    const card = { scrollTop: 120 };
    const deps = {
      LAYERS, ON, SAVED, VIEW,
      showLayer: (l: string, v: boolean) => { did.push(`${v ? 'on' : 'off'}:${l}`); ON[l] = v; },
      readLayer: (l: string) => did.push('read:' + l),
      saveLayers: () => did.push('save'),
      drawChips: () => did.push('chips'), chipIntoView: (l: string) => did.push('chip:' + l),
      drawStatus: () => {}, drawFacts: () => {}, drawLegend: () => {},
      $: (id: string) => (id === 'card' ? card : null),
    };
    const arrive = frameFn<(l: string) => void>('arrive', deps);
    return { arrive, did, ON, SAVED, VIEW, card };
  }

  it('from Fleet: Mike\'s saved layers plus Trucks; Trucks leads the card, its chip in view, the card at its top — nothing saved', () => {
    const h = harness({ today: true, permits: false, leads: false, trucks: false }, { today: true, permits: false, leads: false, trucks: false });
    h.arrive('trucks');
    expect(h.did).toContain('on:trucks');
    expect(h.did).not.toContain('save');
    expect(h.VIEW.focus).toBe('trucks');
    expect(h.did).toContain('chip:trucks');
    expect(h.card.scrollTop).toBe(0);
    expect(h.SAVED).toEqual({ today: true, permits: false, leads: false, trucks: false });
  });

  it('then from Leads: Trucks (on only from the last way in) goes off, Leads comes on — the layers never pile up', () => {
    const h = harness({ today: true, permits: false, leads: false, trucks: false }, { today: true, permits: false, leads: false, trucks: true });
    h.arrive('leads');
    expect(h.did).toContain('off:trucks');
    expect(h.did).toContain('on:leads');
    expect(h.ON).toEqual({ today: true, permits: false, leads: true, trucks: false });
  });

  it('a layer Mike saved on stays on; a way in to a layer already on reads it again', () => {
    const h = harness({ today: true, permits: true, leads: false, trucks: false }, { today: true, permits: true, leads: false, trucks: false });
    h.arrive('permits');
    expect(h.did.filter((d) => /^(on|off):/.test(d))).toEqual([]);
    expect(h.did).toContain('read:permits');
  });

  it('the message from the shell is a way in; a chip tap is Mike\'s own choice — saved, and its layer leads', () => {
    expect(srcOf(script, 'onShellMessage')).toContain('arrive(m.layer);');
    expect(srcOf(script, 'arrive')).not.toContain('saveLayers');
    const did: string[] = [];
    const ON = { today: true, permits: false, leads: false, trucks: true };
    const SAVED = { today: true, permits: false, leads: false, trucks: false };
    const VIEW = { focus: 'trucks' as string | null };
    const setLayer = frameFn<(l: string, v: boolean) => void>('setLayer', { LAYERS, ON, SAVED, VIEW, saveLayers: () => did.push('save'), showLayer: (l: string, v: boolean) => { ON[l as keyof typeof ON] = v; did.push(`${v ? 'on' : 'off'}:${l}`); } });
    setLayer('leads', true);
    expect(did).toEqual(['save', 'on:leads']);
    expect(SAVED).toEqual({ today: true, permits: false, leads: true, trucks: true }); // what is on when Mike taps is what he keeps
    expect(VIEW.focus).toBe('leads');
    setLayer('leads', false);
    expect(VIEW.focus).toBeNull();
  });

  it('the layer Mike came in for leads the card: its lines first, then the others in their order', () => {
    const layerOrder = (focus: string | null, on: Record<string, boolean>) => frameFn<() => string[]>('layerOrder', { LAYERS, VIEW: { focus }, ON: on })();
    expect(layerOrder('trucks', { trucks: true })).toEqual(['trucks', 'today', 'permits', 'leads']);
    expect(layerOrder(null, {})).toEqual(LAYERS);
    expect(layerOrder('trucks', { trucks: false })).toEqual(LAYERS);
    expect(srcOf(script, 'drawStatus')).toContain('layerOrder()');
    expect(srcOf(script, 'drawFacts')).toContain('layerOrder()');
  });
});

describe('the chip row and the notes card say when there is more (UI review #4, #7)', () => {
  it('the lit chip is scrolled into the row\'s view; the row fades at an edge with more beyond it', () => {
    expect(srcOf(script, 'chipIntoView')).toContain('scrollLeft');
    expect(srcOf(script, 'chipFade')).toContain("classList.toggle('fade-r'");
    expect(srcOf(script, 'chipFade')).toContain("classList.toggle('fade-l'");
    expect(rule('#chips.fade-r')).toContain('mask-image:linear-gradient');
    expect(rule('#chips.fade-l')).toContain('mask-image:linear-gradient');
    expect(script).toContain("$('chips').addEventListener('scroll', chipFade, { passive: true });");
  });
  it('a card with more below says so ("More ↓", over its bottom edge) and the cue goes when Mike reaches the end', () => {
    const card = page.slice(page.indexOf('<div id="card"'), page.indexOf('<button id="offview"'));
    expect(card).toMatch(/<div id="more" aria-hidden="true"><span>More ↓<\/span><\/div>/);
    expect(rule('#more')).toContain('position:sticky');
    expect(rule('#more')).toContain('height:0');
    const moreCue = (top: number) => {
      const more = { hidden: false };
      frameFn<() => void>('moreCue', { $: (id: string) => (id === 'card' ? { scrollHeight: 600, clientHeight: 193, scrollTop: top, hidden: false } : more) })();
      return more.hidden;
    };
    expect(moreCue(0)).toBe(false);
    expect(moreCue(600 - 193)).toBe(true);
    expect(script).toContain("$('card').addEventListener('scroll', moreCue, { passive: true });");
    expect(srcOf(script, 'syncCard')).toContain('moreCue();');
  });
});

describe('the Key opens under its own button, which stays in view (UI review #7)', () => {
  it('the legend is placed right after the row holding the Key button; the card grows while the Key is open', () => {
    const s = srcOf(script, 'drawFacts');
    expect(s).toContain('kb.parentElement.after(legend)');
    expect(s).toContain("classList.toggle('keyopen', KEY_OPEN && !!kb)");
    expect(rule('#card.keyopen')).toMatch(/max-height:calc\(100% - \d+px\)/);
  });
  it('opened, the card scrolls to the Key\'s own row — the button stays in view, the legend below it', () => {
    expect(srcOf(script, 'keyButton')).toContain("if (KEY_OPEN && kb) $('card').scrollTop = Math.max(0, kb.parentElement.offsetTop - 4);");
  });
  it('the card hides only when it says nothing — the legend parked in the facts never counts as something', () => {
    expect(srcOf(script, 'syncCard')).toContain("n.id !== 'legend'");
  });
});

describe('while a list is open, the notes card and Route the day step aside (UI review #5)', () => {
  it('the card, Route the day and the zoom buttons hide while a list is open; the list may use the whole map', () => {
    expect(css).toContain('#mapbox.popopen #card,#mapbox.popopen #hud,#mapbox.popopen .leaflet-control-zoom{visibility:hidden}');
    const s = srcOf(script, 'popRoom');
    expect(s).not.toContain('cardPad()');
    expect(s).not.toContain('hudPad()');
    expect(s).toContain('MAP.getSize().y - 90');
  });
  it('a name that opens Leads closes the list first, so Map comes back with its notes card (browser re-run)', () => {
    expect(srcOf(script, 'leadsNode')).toContain("b.addEventListener('click', () => { if (MAP) MAP.closePopup(); toShell({ type: 'lead', id: l.id }); });");
  });
});

describe('in Night the Key\'s swatch matches the shading on the map (UI review #6)', () => {
  // DEQ's symbol is orange (230,152,0) at 50%; the map shows it over the tiles — OSM's land (242,239,233) by Day,
  // the same land dimmed by the Night filter at night. The swatch shows it over that same ground.
  const parse = (r: string) => {
    const m = /linear-gradient\(rgba\((\d+),(\d+),(\d+),\.5\),rgba\(\d+,\d+,\d+,\.5\)\),#([0-9A-Fa-f]{6})/.exec(r)!;
    const base = [0, 2, 4].map((i) => parseInt(m[4]!.slice(i, i + 2), 16));
    return [1, 2, 3].map((i, k) => Math.round(0.5 * Number(m[i]) + 0.5 * base[k]!));
  };
  it('Night: the swatch reads as the ochre measured on the map (189,149,70), not the brown over the dark card (124,93,14)', () => {
    const night = parse(rule('html.night .swatch.rpa'));
    for (const [k, v] of [189, 149, 70].entries()) expect(Math.abs(night[k]! - v), `channel ${k}`).toBeLessThanOrEqual(8);
  });
  it('Day: DEQ\'s orange over OSM\'s land, as on the map', () => {
    const day = parse(rule('.swatch.rpa'));
    for (const [k, v] of [236, 196, 117].entries()) expect(Math.abs(day[k]! - v), `channel ${k}`).toBeLessThanOrEqual(4);
  });
});
