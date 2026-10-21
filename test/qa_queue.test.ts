// Pre-deploy QA, Queue and Numbers. The Queue used to be one dashed card
// whenever a single feed was missing, and Numbers showed a bare dash where
// it promised UNKNOWN. vitest has no DOM, so the screen is pinned by source,
// one function at a time; the line builders are tested by behaviour.
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';
import { buildAreaReport, buildCampaignReport, type AreaJobFact, type CampaignFact } from '../src/ops/areaPerformance.js';

const html = loadAppHtml();

/** The source between two anchors. Both must exist, so a rename fails here
 *  instead of slicing nothing and letting a not.toContain pass by accident. */
function between(start: string, end: string): string {
  const a = html.indexOf(start);
  expect(a, `anchor missing: ${start}`).toBeGreaterThan(-1);
  const b = html.indexOf(end, a);
  expect(b, `anchor missing: ${end}`).toBeGreaterThan(a);
  return html.slice(a, b);
}

const queue = () => between('async function renderFollowUps(', '// ---------- Shell');
const perf = () => between('async function renderPerformance(', 'function renderCampaignList(');
const campaigns = () => between('function renderCampaignList(', 'async function refreshCampaignList(');
const composer = () => between('function campaignComposer(', 'function areaCard(');
const area = () => between('function areaCard(', '// ---------- Vetting queue');

describe('Queue — one dead feed never blanks the screen (§1B)', () => {
  it('builds every panel before it reads the follow-ups', () => {
    const q = queue();
    const read = q.indexOf("await api('/api/followups')");
    expect(read).toBeGreaterThan(-1);
    // Direction B P13: Follow-ups holds the loops and the sends; the other desks are screens of their own.
    for (const panel of ["loopsSlot.id = 'queue-loops'", "api('/api/queue')", "'Recommended sends'", 'Arbo recommends']) {
      expect(q.indexOf(panel), `${panel} waits on the follow-ups read`).toBeGreaterThan(-1);
      expect(q.indexOf(panel), `${panel} waits on the follow-ups read`).toBeLessThan(read);
    }
    // …and each of those desks gives every panel its slot at once, before any read lands (deskView): none waits on another.
    const desk = between('async function deskView(', '// ---------- Shell');
    expect(desk).toContain('const runs = panels.map(([id, render]) => {');
    expect(desk.indexOf('return render(slot);')).toBeLessThan(desk.indexOf('await Promise.allSettled(runs);'));
    for (const panel of ["['queue-safety', renderSafety]", '[null, renderRoster]', '[null, renderTrainingBoard]', '[null, renderVetting]',
      '[null, renderLibraryDesk]', "['queue-money', renderMoney]", "['queue-fleet', renderFleet]"]) {
      expect(desk, panel).toContain(panel);
    }
  });

  it('names a dead follow-ups feed with the shared words, under Recommended sends only', () => {
    const q = queue();
    expect(q).toContain("feedState(e, 'Follow-ups', 'an empty queue')");
    expect(q).not.toContain('No follow-up queue yet');
    expect(q).not.toContain('Database not connected');
    expect(q).not.toContain('Pull refresh');
  });

  it('a newer render owns the screen, so two refreshes never stack two Queues', () => {
    const q = queue();
    expect(html).toContain('let FU_GEN = 0;');
    expect(q).toContain('const gen = ++FU_GEN;');
    // Checked first in the catch (before the keywall) and right after the read.
    expect(q).toContain('} catch (e) {\n    if (gen !== FU_GEN) return;\n    if (e.code === 401) return showKeywall();');
    expect(q).toContain("}\n  if (gen !== FU_GEN) return;");
  });

  it('a failed open-loops read is named, and a real empty list says so', () => {
    const q = queue();
    // One line, not a dashed card, so the safety stop stays on the first screen.
    expect(q).toContain("feedLine(e, 'Open loops', 'That is not a sign that nothing is open.')");
    expect(q).not.toContain("feedState(e, 'Open loops'");
    expect(q).not.toContain('.catch(() => {})');
    expect(q).toContain("'No open loops'");
  });

  it('never draws Queue clear over storm or coming-due nudges Arbo could not check', () => {
    const q = queue();
    expect(q).toContain('q.seasonalUnavailable');
    expect(q).toContain('q.growthUnavailable');
    expect(q).toContain("'feed-state unread', 'Arbo could not check '");
    expect(q).toContain('This is not a claim that none are due.');
    // The only way to reach 'Queue clear' is with nothing unread.
    expect(q).toContain("state(unread.length ? 'Nothing due from what Arbo could read' : 'Queue clear',");
    expect(html).not.toContain("state('Queue clear'");
  });

  it('no roster or library form is offered over a feed Arbo could not read', () => {
    // Building every panel first put both forms on the cut production Queue.
    // Same rule as the fleet and campaign composers: readable first, then the form.
    expect(html).toContain('if (await renderRosterList(listSlot)) slot.appendChild(rosterComposer(listSlot));');
    expect(html).toContain('if (await renderLibraryQueue(queueSlot)) slot.appendChild(libraryComposer(queueSlot));');
    const lists: Array<[string, string]> = [
      ['async function renderRosterList(', '// A one-way action asks twice'],
      ['async function renderLibraryQueue(', 'function libraryComposer('],
    ];
    for (const [start, end] of lists) {
      const body = between(start, end);
      expect(body.match(/return false;/g), start).toHaveLength(2); // 401 and a dead feed
      expect(body, start).toMatch(/return true;\n\}\n*$/);
    }
  });

  it('a save that fails says so, and a lost key opens the keywall', () => {
    // saveFailText (foundation) calls showKeywall() on a 401.
    const q = queue();
    expect(q).toContain('} catch (e) { btn.disabled = false; showSaveFail(c, e); }');
    expect(q).toContain("c.querySelector(':scope > .save-err')");
    const money = between('async function renderMoney(', 'function paidButton(');
    expect(money).toContain('} catch (e) { btn.disabled = false; showSaveFail(c, e); }');
    const paid = between('function paidButton(', '// ---------- Fleet');
    expect(paid).toContain('} catch (e) { btn.disabled = false; showSaveFail(btn.parentNode, e); }');
    for (const body of [q, money, paid]) expect(body).not.toContain('catch { btn.disabled = false; }');
  });

  it('every Queue and Numbers panel words a 503 with the shared vocabulary, not "Database not connected"', () => {
    const panels: Array<[string, string]> = [
      ['async function renderSafety(', '// ---------- Roster'],
      ['async function renderRosterList(', 'function certAdder('],
      ['async function renderTrainingBoard(', '// ---------- Performance'],
      ['async function renderPerformance(', 'function renderCampaignList('],
      ['async function renderVetting(', '// ---------- Reference library'],
      ['async function renderLibraryQueue(', 'function libraryComposer('],
      ['async function renderMoney(', 'function paidButton('],
      ['async function renderFleetList(', '// A part that fits this unit'],
    ];
    for (const [start, end] of panels) {
      const body = between(start, end);
      expect(body, start).toContain('e.code === 503\n      ? feedSays(e) + \' Arbo cannot ');
      expect(body, start).not.toContain('Database not connected');
    }
  });
});

describe('Numbers — the benchmark reads as what it is (§1B/§6N.3)', () => {
  it('is the company average, never a "fleet" figure (fleet means trucks here)', () => {
    expect(perf()).toContain("'company avg per crew-hour'");
    for (const chip of ["'ABOVE AVERAGE'", "'AT AVERAGE'", "'BELOW AVERAGE'"]) expect(html).toContain(chip);
    expect(html).not.toMatch(/fleet \$\/crew-hr|FLEET RATE/);
  });

  it('says which jobs and which window it covers, and when it was checked', () => {
    const p = perf();
    expect(p).toContain("'Paid, completed jobs in the '");
    expect(p).toContain('p.windowDays');
    expect(p).toContain('p.checkedAtIso');
    // Right under the tiles, before anything is judged against it.
    expect(p.indexOf('p.windowDays')).toBeGreaterThan(p.indexOf('v.appendChild(hud)'));
    expect(p.indexOf('p.windowDays')).toBeLessThan(p.indexOf('for (const b of p.blindSpots)'));
  });

  it('two tiles under the hero, and unrated is not dressed as a warning', () => {
    expect(html).toContain('#view-perf .hud{grid-template-columns:repeat(2,1fr)}');
    expect(perf()).toContain("hud.appendChild(tile(p.withheld.length, 'unrated'));");
  });

  it('every figure is whole dollars through one helper, and money() is not duplicated', () => {
    expect(html).toContain("function dollars(n) { return '$' + Math.round(n).toLocaleString('en-US'); }");
    expect(html.match(/function money\(/g)).toHaveLength(1);
    expect(perf()).toContain('dollars(p.fleetRatePerCrewHour)');
    expect(area()).toContain('dollars(a.normalizedRatePerCrewHour)');
    expect(campaigns()).toContain('dollars(c.costPerBookedJob)');
    for (const body of [perf(), area(), campaigns()]) expect(body).not.toContain("'$' + ");
  });

  it('an unrated rate is never a headline, and a below-average area is not an emergency', () => {
    const a = area();
    expect(a).toContain("const unjudged = a.verdict === 'not_enough_data';");
    // The job count is the line under the title; the rate slot never repeats it.
    expect(a).not.toContain("'-job sample'");
    expect(a).toContain("rate.style.cssText = 'color:var(--ink-3);font-weight:500'");
    expect(a).not.toContain('emergency\'');
  });

  it('section headings are short titles with the explanation underneath', () => {
    const p = perf();
    expect(p).toContain("'Rated areas \\u2014 ' + judged.length");
    expect(p).toContain('Ranked by revenue per crew-hour, not per job');
    expect(p).not.toContain('Do not read them as either');
    expect(html).toContain(".panel-title::after{content:'';flex:1;min-width:24px;");
  });
});

describe('Numbers — campaigns', () => {
  it('a card is titled the way the form names it, and its value says what it is', () => {
    const c = campaigns();
    expect(c).toContain('CAMPAIGN_TYPES.find(([k]) => k === c.type)');
    expect(c).toContain("' per booked job'");
    // UNKNOWN for an untracked campaign, as the form promises — never a bare dash.
    expect(c).toContain("c.bookedJobs === null ? 'Unknown'");
    expect(c).not.toContain("'\\u2013'");
    expect(c).toContain("if (!figure) val.style.color = 'var(--ink-3)';");
  });

  it('the composer labels every control and opens the number keyboard for the cost', () => {
    const k = composer();
    for (const label of ["'Type'", "'What it cost ($)'", "'Tracking number (optional)'", "'Date it went out'"]) {
      expect(k).toContain('field(' + label);
    }
    expect(k).toContain("n.setAttribute('aria-label', label);");
    expect(k).toContain("cost.inputMode = 'decimal';");
    // Still a text box, so a typo reaches the server's bad_cost answer.
    expect(k).toContain("n.type = 'text'");
    expect(k).toContain("e.message === 'bad_cost'");
  });

  const camp = (over: Partial<CampaignFact> = {}): CampaignFact => ({
    id: 'c1', type: 'flyer', cost: 400, bookedJobs: 2, attributionWired: true, ...over,
  });

  it('a measured campaign line carries the spend and the count; the per-job figure is the headline only', () => {
    expect(buildCampaignReport([camp()])[0]!.line).toBe('$400 spent · 2 booked jobs.');
    expect(buildCampaignReport([camp({ cost: 1250, bookedJobs: 1 })])[0]!.line)
      .toBe('$1,250 spent · 1 booked job.');
    expect(buildCampaignReport([camp()])[0]!.costPerBookedJob).toBe(200);
  });

  it('an untracked campaign shows what was spent and stays unknown, not failed', () => {
    const tracked = buildCampaignReport([camp({ cost: 750, attributionWired: false })])[0]!;
    expect(tracked.line).toMatch(/^\$750 spent · no tracking on this one/);
    expect(tracked.line).toMatch(/not the same as it failing/);
    const noCost = buildCampaignReport([camp({ cost: null, attributionWired: false })])[0]!;
    expect(noCost.line).not.toContain('$');
    expect(noCost.line).toMatch(/not the same as it failing/);
  });

  it('a campaign with no cost on file counts its jobs properly', () => {
    expect(buildCampaignReport([camp({ cost: null, bookedJobs: 1 })])[0]!.line)
      .toBe('1 booked job, but no cost on file — cost per job is unknown.');
  });
});

describe('Numbers — area lines count properly and name the company average', () => {
  const job = (over: Partial<AreaJobFact> = {}): AreaJobFact => ({
    jobId: 'j', areaKey: 'a', hours: 4, crewSize: 3, revenue: 3600, jobType: 'removal', ...over,
  });
  const many = (key: string, n: number, revenue: number) =>
    Array.from({ length: n }, (_, i) => job({ jobId: `${key}-${i}`, areaKey: key, revenue }));

  it('never says job(s) when the count is known', () => {
    const r = buildAreaReport([...many('one', 1, 1200), ...many('two', 2, 1200), job({ jobId: 'z', hours: 0 })]);
    expect(r.areas.find((a) => a.areaKey === 'one')!.line).toMatch(/^1 job — too few to rate\./);
    expect(r.areas.find((a) => a.areaKey === 'two')!.line).toMatch(/^2 jobs — too few to rate\./);
    expect(r.blindSpots[0]).toMatch(/^1 job had no hours .* it is excluded, not counted as zero\.$/);
    for (const line of [...r.areas.map((a) => a.line), ...r.blindSpots]) expect(line).not.toContain('(s)');
  });

  it('measures above, at and below against the company average', () => {
    const r = buildAreaReport([...many('hot', 6, 2400), ...many('cold', 6, 1200), ...many('mid', 6, 1800)]);
    expect(r.areas.find((a) => a.areaKey === 'hot')!.line).toMatch(/% above the company average per crew-hour\.$/);
    expect(r.areas.find((a) => a.areaKey === 'cold')!.line).toMatch(/% below the company average per crew-hour\.$/);
    expect(r.areas.find((a) => a.areaKey === 'mid')!.line).toBe('6 jobs, in line with the company average.');
    for (const a of r.areas) expect(a.line).not.toMatch(/fleet/i);
  });
});
