// Today screen, pre-deploy QA round: source pins (vitest has no DOM). Each
// block names the QA fix it holds in place.
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';

const html = loadAppHtml();
const between = (from: string, to: string) => {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  expect(a, `missing anchor ${from}`).toBeGreaterThan(-1);
  expect(b, `missing anchor ${to}`).toBeGreaterThan(a);
  return html.slice(a, b);
};
const today = between('async function renderToday()', '// ---------- Open loops');
const briefFetch = today.indexOf("api('/api/brief?from=");

describe('Today: run order and the Yard check (T-order, T-hud, T-yard)', () => {
  it('the run and the instruments get their place before any fetch, under the storm alert', () => {
    const storm = today.indexOf('stormBanner().then');
    const day = today.indexOf("day.style.display = 'contents'");
    const instr = today.indexOf("instr.style.display = 'contents'");
    expect(storm).toBeGreaterThan(-1);
    // The red storm alert stays ABOVE the day's run and the tiles.
    expect(storm).toBeLessThan(day);
    expect(day).toBeLessThan(instr);
    expect(instr).toBeLessThan(today.indexOf('locationStrip().then'));
    expect(instr).toBeLessThan(briefFetch);
  });

  // Direction B P15 (R29 #4): the Yard check moved from Today to Estimate. Its rule holds there: drawn before
  // any read (a cut feed never hides it), with the SVG icon, never a gear glyph.
  it('the Yard check renders before any read on Estimate, with the SVG icon, not a gear glyph — and Today has none', () => {
    expect(today).not.toContain('openYard');
    const est = html.slice(html.indexOf('async function renderEstimate()'), html.indexOf('\n}\n', html.indexOf('async function renderEstimate()')));
    expect(est.indexOf('openYard()')).toBeGreaterThan(-1);
    expect(est.indexOf('openYard()')).toBeLessThan(est.indexOf("api('/api/properties')"));
    expect(html).toMatch(/key: 'yard', [^}]*icon: 'i-numbers'/);
    expect(html).not.toContain('⚙ Yard check');
  });

  it('the stops and the HUD land in their containers, tiles first, then Yard, then loops', () => {
    expect(today).toContain('instr.prepend(hud)');
    expect(today).toContain('instr.appendChild(loopsPanel)');
    expect(today).toContain('day.appendChild(c)');
    expect(today).not.toContain('v.appendChild(hud)');
    expect(today).toContain("'Today’s run'");
  });
});

describe('Today: a dead schedule is named, never an empty day (T-schedule-state, T-loops)', () => {
  it('uses the shared feed-state words and offers the real calendar', () => {
    expect(today).toContain("feedState(e, T('Schedule'), T('an empty day'))");
    expect(today).toContain('Open the Calendar tab');
    expect(html).not.toContain('No schedule yet');
    expect(html).not.toContain('shows up the moment it is');
    expect(today).toContain("tf('schedule {why}', { why })"); // R27 Phase A (es-owner-a): one template, the shared tag as a value
  });

  it('loops say which gap it is, never "cut" for every 503', () => {
    const loops = between('function heroLoops()', '// ---------- More:');
    expect(loops).toContain('FEED_TAG[k]');
    expect(loops).toContain("tf('loops {why}', { why })");
    expect(html).not.toContain("e.code === 503 ? 'cut' : 'unreadable'");
  });
});

describe('Today: the tiles (T-hud, T-money)', () => {
  it('no stops or open-loops tile repeats the hero', () => {
    expect(today).not.toContain("tile(s.totalStops, 'stops'");
    expect(today).not.toContain("tile('–', 'open loops')");
  });

  it('overdue is past-due invoices only; unbilled work is its own tile; an undatable one is named', () => {
    // Direction B P14: the counts live in moneyCounts, which Office's Money tile reads too, so the two agree.
    const counts = html.slice(html.indexOf('function moneyCounts('), html.indexOf('\n}', html.indexOf('function moneyCounts(')));
    expect(counts).toContain('over: m.collections.length + (m.suppressed || []).length');
    expect(counts).toContain('bill: m.drafts.length');
    expect(counts).toContain('noFigure: (m.blocked || []).length');
    expect(counts).not.toContain('m.collections.length + m.drafts.length');
    expect(counts).not.toContain('m.drafts.length + (m.blocked || []).length');
    expect(today).toContain('const mc = moneyCounts(m);');
    expect(today).toContain("tile('–', T('to bill'))");
    // To bill counts drafts; a job with no agreed figure is named beside it and keeps the tile amber.
    expect(today).toContain("setTile(billTile, mc.bill, (mc.bill || mc.noFigure) ? 'warn' : 'ok-t');");
    expect(today).toContain("billTile.appendChild(el('small', '', tf('+{n} no agreed figure', { n: mc.noFigure })))"); // R27 Phase A (es-owner-a)
    expect(today).toContain(' can’t tell');
  });

  it('a dead tile keeps its dash and says why — no silent catches', () => {
    expect(today).toContain('const tileWhy = (t, why) =>');
    expect(today).toContain("tileWhy(dueTile, T('forecast unreadable'))");
    for (const t of ['dueTile', 'agentTile', 'owedTile', 'billTile']) {
      expect(today, `${t} never names its dead feed`).toContain(`tileWhy(${t}, FEED_TAG[feedKind(e)])`);
    }
    expect(html).toContain('.tile small{');
    expect(html).toContain('#view-today .hud{grid-template-columns:repeat(6,1fr)}');
  });

  it('the stops legend names the next stop by the clock, not finished stops', () => {
    expect(today).toContain("tf('next {when}', { when: fmtWhen(next.timeIso) })"); // R27 Phase A (es-owner-a)
    expect(today).toContain("T('all times passed')");
    expect(today).not.toContain("passed + ' of ' + s.totalStops + ' past'");
  });
});

describe('Today: hero, ring and chips (T-ring, T-weather-sub, T-systems, T-desktop)', () => {
  it('an unreadable ring is evenly spaced neutral dots, never the data colour', () => {
    expect(html).toContain('.dayring .unk{stroke:rgba(244,239,224,.45)}');
    expect(html).not.toContain('stroke-dasharray:2 5');
    expect(html).toContain("'stroke-dasharray', '0 ' + (a.len / Math.round(a.len / 11))");
  });

  it('the hero subline never strands a separator at a line end', () => {
    expect(html).toContain('.hero .sub span{display:block;white-space:nowrap}');
    expect(html).not.toContain("(i ? '· ' : '') + p");
    expect(html).not.toContain("parts.join(' · ')");
  });

  it('a dead weather feed is named once in the hero and chip, with no loose second line', () => {
    expect(html).not.toContain('Storm watch: weather feed unavailable');
    expect(between('async function stormBanner()', '// ---------- Location strip')).toContain("tf('weather {why}', { why: FEED_TAG[k] })"); // R27 Phase A (es-owner-a)
  });

  it('the systems strip wraps, worst chip first, instead of hiding chips off screen', () => {
    expect(html).toContain('.systems{display:flex;flex-wrap:wrap;');
    expect(html).not.toContain('.systems::-webkit-scrollbar');
    expect(html).toContain('.sys.down{order:-2}.sys.warn{order:-1}');
  });

  it('desktop cards stretch to equal height and the hero texture is anchored in px', () => {
    expect(html).toContain('.slot{margin-bottom:0;align-self:stretch}');
    expect(html).toContain('.hero::before{top:-75px;right:-73px}');
  });

  it('the reception note is a card of its own', () => {
    expect(today).toContain("const recSlot = el('div', 'slot');");
  });
});

describe('Today: plain words and one dead-feed style (T-copy, T-adopt, T-location)', () => {
  it('the inbox card speaks plainly and never shows the raw server reason', () => {
    const inbox = between('async function inboxIntentPanel()', '// ---------- Where each customer stands');
    expect(inbox).toContain("'panel-title', T('Inbox'))");
    expect(inbox).not.toContain('d.gmailReason || \'no pass yet\'');
    expect(html).not.toContain('the intent engine cannot look');
    expect(inbox).toContain('Gmail isn’t connected, so Arbo can’t check your inbox.');
    expect(inbox).toContain("feedLine(e, T('Inbox'))");
    expect(inbox).toContain('That doesn’t mean no mail came in.');
  });

  it('the forms card drops the jargon and no longer claims a sweep catches forms', () => {
    const forms = between('async function websiteFormsPanel()', '// ---------- Reception strip');
    expect(forms).toContain('Website forms aren’t connected to Arbo yet. They still arrive in your Gmail inbox.');
    expect(html).not.toContain('Direct wire from Resend NOT connected');
    expect(forms).not.toContain('the sweep');
    expect(forms).toContain("feedLine(e, T('Website forms'))");
  });

  it('the links chip says cut on purpose, not a section number', () => {
    expect(html).not.toContain('cut (by design, §3)');
    expect(between('function buildSystems()', 'function sysSet(')).toContain("'cut on purpose'");
  });

  it('location tracking never vanishes on a failed read, and a failed switch says so', () => {
    const loc = between('async function locationStrip()', '// ---------- Inbox intents');
    expect(loc).toContain("feedLine(e, T('Location tracking')");
    expect(loc).toContain('It may still be on.');
    expect(loc).toContain('showSaveFail(wrap, e)');
    expect(loc).not.toContain('catch (e) { return null; }');
  });

  it('Today’s dead-feed lines use the feed-state row, not the help-tip bullet', () => {
    const rec = between('async function receptionStrip()', '// ---------- Today (Morning Brief)');
    expect(rec).toContain("el('div', 'feed-state ' + feedKind(e), T('Reception: status unavailable right now.'))");
    expect(html).not.toContain('Inbox intents: status unavailable right now.');
    expect(html).not.toContain('Website forms: status unavailable right now.');
  });
});
