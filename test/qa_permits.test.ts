// Pre-deploy QA round, Permit Desk + Measure desk (R25). vitest has no DOM, so
// the UI pins are source strings; the two pure helpers (nb, the LiDAR summary)
// are run for real. Every pin names the QA finding it holds shut.
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';
import { FACTS } from '../src/permitting/publicWorks/facts.js';
import { factById } from '../src/permitting/publicWorks/query.js';
import { summarizeTreeMeasurement, SIGN_OFF } from '../src/lidar/summary.js';
import { UNITS_WARNING, type TreeMeasurement } from '../src/lidar/measure.js';

const html = loadAppHtml();

/** The source between two anchors — one function or section of the page. */
function region(from: string, to: string): string {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a + 1);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(a);
  return html.slice(a, b);
}

const permits = region('async function renderPermits()', 'function checkCard(');
const cards = region('function checkCard(', '// ---------- Agents desk');
const measure = region('function renderMeasure()', 'function measureResult(');
const result = region('function measureResult(', '// ---------- Learn desk');

describe('Permit Desk — job check (QA round)', () => {
  it('an answer re-runs only the checklist; only a city change rebuilds the desk', () => {
    expect(permits.match(/renderPermits\(\);/g)).toHaveLength(1); // the call, not the declaration
    expect(permits).toContain("b.addEventListener('click', () => { PERMIT_CITY = c; renderPermits(); });");
    expect(permits).toContain("for (const x of seg.children) x.classList.toggle('on', x === b);");
    expect(permits).toContain("box.addEventListener('change', () => { PERMIT_ANS[key] = box.checked; runCheck(); });");
    expect(permits).toContain("out.style.minHeight = out.offsetHeight + 'px';");
    expect(permits).toContain('out.replaceChildren(...r.items.map(checkCard));');
  });

  it('a failed check replaces the old results in plain words — no raw error codes (§1B)', () => {
    expect(permits).not.toContain('e.message');
    expect(permits).toContain("Could not reach Arbo (no signal?).");
    expect(permits).toContain('Arbo could not build the checklist right now.');
    expect(permits).toContain('An empty list here is not an answer — Arbo could not check.');
    expect(permits).toContain('if (e.code === 401) showKeywall();');
  });

  it('the power-line CALL FIRST chip is the strongest tone (alarm, as EMERGENCY); an unknown status reads amber', () => {
    // QA round 2: [label, tone] on the shared chip table; checkCard keeps alarm for the power-line step only.
    expect(html).toContain("'CALL FIRST': ['CALL FIRST', 'alarm']");
    expect(cards).toContain("const st = PERMIT_STATUS[it.status] || [it.status, 'watch'];");
  });

  it('the intro says where the office to call is — and promises no office a rule does not carry', () => {
    expect(permits).toContain('is marked UNCONFIRMED — check it with the city before you tell a customer (the office to call is on the rule where we have one).');
  });

  it('cities sit in an even grid with whole names; the shared ON/OFF pill is untouched', () => {
    expect(permits).toContain("el('div', 'chips city-pick')");
    expect(html).toContain('.city-pick{display:grid;grid-template-columns:repeat(2,1fr)}.city-pick .loc-toggle{letter-spacing:0;font-size:14.5px}');
    expect(html).toContain('@media (min-width:600px) and (max-width:899px){.city-pick{grid-template-columns:repeat(4,1fr)}}');
    expect(html).toContain('.loc-toggle{min-height:44px;min-width:64px;');
  });

  it('night theme: the selected Yes / No / Don’t know is its own fill, in BOTH dark token blocks', () => {
    expect(html).toContain('.seg button.on{background:var(--seg-on,var(--card));color:var(--forest);box-shadow:0 1px 3px rgba(20,40,30,.14),inset 0 0 0 1px var(--border)}');
    expect(html.match(/--seg-on:#1F3B30;/g)).toHaveLength(2);
  });
});

describe('Permit Desk — result and rule cards (QA round)', () => {
  it('each result offers tap-to-call and a jump to its rule card (source and checked date)', () => {
    expect(cards).toContain('if (it.call) meta.appendChild(whoLine(it.call));');
    expect(cards).toContain("'Source & date checked ↓'");
    expect(cards).toContain("a.href = '#fact-' + it.factIds[0];");
    expect(cards).toContain("c.id = 'fact-' + f.id;");
    expect(html).toContain('.card.fact{scroll-margin-top:');
  });

  it('the separator sits outside the phone link, and the number goes through nb()', () => {
    expect(cards).not.toContain("el('a', '', ' · ' +");
    expect(cards).toContain("d.appendChild(document.createTextNode(' · '));");
    expect(cards).toContain("const a = el('a', '', nb(w.phone));");
    expect(cards).toContain('nb(it.step)');
    expect(cards).toContain('nb(f.title)');
  });

  it('nb() joins digit-hyphen-digit with an invisible word joiner and "§" to its number with a no-break space, and nothing else', () => {
    const src = /const nb = (\(s\) => [^\n]+);/.exec(html)?.[1];
    expect(src).toBe("(s) => String(s).replace(/(\\d)-(?=\\d)/g, '$1-\\u2060').replace(/§\\s+/g, '§\\u00a0')");
    const nb = new Function(`return ${src}`)() as (s: string) => string;
    expect(nb('757-385-6661')).toBe('757-\u2060385-\u20606661');
    expect(nb('City Code § 23-50.1')).toBe('City Code §\u00a023-\u206050.1');
    expect(nb('100-ft buffer, 3-to-1')).toBe('100-ft buffer, 3-to-1');
    expect(nb('757-385-6661').replace(/\u2060/g, '')).toBe('757-385-6661');
  });

  it('source links are named by their site, never numbered by position', () => {
    expect(cards).not.toContain("'source ' + (i + 1)");
    expect(cards).toContain("const siteOf = (u) => { try { const h = new URL(u).hostname.replace(/^www\\./, ''); return KNOWN_HOSTS[h] || h; } catch (e) { return 'source'; } };");
  });

  it('a note never shows a doubled INTERNAL: prefix', () => {
    expect(cards).toContain(".replace(/^INTERNAL:\\s*/i, '')");
  });

  it('the owner-facing notes carry no developer terms', () => {
    for (const f of FACTS) {
      const notes = f.notes ?? '';
      expect(notes, f.id).not.toMatch(/cities\.ts|snippet|mined correspondence|forbidden-strings|§12|\(R1\b|^INTERNAL:/i);
    }
    // The landfill note is still the one place its city is named (publicWorks.test).
    expect(factById('reg-spsa-landfill')?.notes).toMatch(/^The Regional Landfill is physically in Suffolk\./);
    expect(factById('va-dpor-classes')?.rule).not.toMatch(/fee line/);
  });
});

describe('Measure desk (QA round)', () => {
  it('the status line follows the result on every redraw — never "Nothing measured yet." above one', () => {
    expect(measure).not.toContain("el('div', 'storm-muted', 'Nothing measured yet.')");
    expect(measure).toContain("? 'Measured ' + LIDAR_LAST.file.points.toLocaleString() + ' points from ' + LIDAR_LAST.file.name + '.'");
    expect(measure).toContain(": (LIDAR_UP_CHANGED ? 'Up changed — open the scan file again to measure with it.' : 'Nothing measured yet.')");
  });

  it('changing Up drops the old-axis result, including one still being read', () => {
    expect(measure).toContain('if (LIDAR_UP === val) return;');
    expect(measure).toContain('if (LIDAR_LAST) LIDAR_UP_CHANGED = true;');
    expect(measure).toContain('LIDAR_LAST = null;');
    expect(measure).toContain('if (LIDAR_UP !== upSent) return;');
    expect(measure).toContain("[['', 'Auto'], ['y', 'Y is up'], ['z', 'Z is up']]");
  });

  it('the status line names the axis it was read with, in plain words (QA round 2: upWords)', () => {
    expect(html).toContain("' Read ' + ua.axis.toUpperCase() + ' as up — '");
    expect(measure).toContain('upWords(LIDAR_LAST.file.upAxis)');
    expect(measure).toContain('upWords(body.file.upAxis)');
    expect(result).not.toContain("'Read with '");
  });

  it('warnings (units first) sit above the tiles; the duplicate paragraph and trunk-fit line are gone', () => {
    const warn = result.indexOf("for (const w of m.warnings) wrap.appendChild(el('div', 'late', w));");
    expect(warn).toBeGreaterThan(-1);
    expect(warn).toBeLessThan(result.indexOf('wrap.appendChild(hud);'));
    expect(result).not.toContain("el('div', 'scope', r.summary)");
    expect(result).not.toContain('Trunk fit');
    expect(result).toContain("(k === 'dbh' && m.dbhFit ? '; scatter ' + round(m.dbhFit.rmseCm / 2.54, 2) + ' in (' + round(m.dbhFit.rmseCm, 1) + ' cm)' : '')");
  });

  it('tiles lead in inches and feet; the how-to agrees with the 4 m clean range', () => {
    expect(result).toContain("round(m.dbhCm / 2.54, 1), ' in', m.dbhCm === null ? '' : round(m.dbhCm, 1) + ' cm'");
    expect(result).toContain("Math.round(m.heightM * 3.281), ' ft'");
    expect(result).toContain("Math.round(m.crownSpreadM * 3.281), ' ft'");
    expect(measure).toContain('Stand 3–10 ft from the trunk');
    expect(measure).toContain('Phone LiDAR reads cleanly to about 13 ft (4 m).');
    expect(measure).not.toContain('4–5 m');
  });

  it('a refusal never ends in a double full stop', () => {
    expect(measure).toContain(".replace(/\\.\\s*$/, '') + '. No number is better than a wrong one.'");
  });

  it('the sign-off is readable: ink-3, balanced wrap', () => {
    expect(html).toContain('.internal-tag{font-size:11px;font-weight:700;letter-spacing:.12em;line-height:1.5;color:var(--ink-3);text-transform:uppercase;text-wrap:balance;margin-top:12px}');
  });
});

describe('LiDAR summary text (agent and crew copy)', () => {
  const m: TreeMeasurement = {
    heightM: 8.5,
    crownSpreadM: 4.7,
    crownAxesM: { major: 4.7, minor: 4.1 },
    dbhCm: 45.64,
    dbhFit: { inliers: 851, rmseCm: 0.4, arcCoverageDeg: 357 },
    leanDeg: 2.46,
    confidence: {
      height: { level: 'low', reason: 'r' },
      crown: { level: 'low', reason: 'r' },
      dbh: { level: 'good', reason: 'r' },
      lean: { level: 'good', reason: 'r' },
    },
    warnings: [UNITS_WARNING, 'Height is a minimum: the treetop is beyond what a phone scan reads cleanly, about 13 ft (4 m).'],
    units: 'unknown',
    upAxis: 'y',
    pointCount: 33000,
    measuredAt: '2026-09-28T12:00:00.000Z',
  };
  const s = summarizeTreeMeasurement(m);

  it('rounds trunk width and lean to one decimal, the same as the tiles', () => {
    // QA round 3: inches first, centimetres in brackets — the tiles' order.
    expect(s).toContain('about 18.0 in (45.6 cm)');
    expect(s).toContain('Trunk lean about 2.5°');
  });

  it('says "Check —", never "Check: Units not confirmed:"', () => {
    expect(s).toContain('Check — Units not confirmed: the file');
    expect(s).not.toMatch(/Check: /);
    expect(s.endsWith(SIGN_OFF)).toBe(true);
  });
});
