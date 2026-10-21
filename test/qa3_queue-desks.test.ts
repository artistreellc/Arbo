// QA round 3 — the queue-desks package: credential lines, the roster's armed
// button, the Agents desk (notes, proposals, the hourly-check rows), Measure
// wording and its status line, and the Learn run buttons. vitest has no DOM,
// so the page is pinned by its source; the server half runs the real
// certifications, section agents and LiDAR engine on SIM data and fakes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadAppHtml } from '../src/server/appPage.js';
import { findCertProblems } from '../src/safety/certifications.js';
import { runAllSections, onDemandSectionDeps, type SectionDeps } from '../src/agents/sections.js';
import { createApi } from '../src/server/api.js';
import { createSimSource } from '../src/dev/simSource.js';
import { hasDb } from '../src/db/client.js';
import { measureTree, type TreeMeasurement } from '../src/lidar/measure.js';
import { summarizeTreeMeasurement } from '../src/lidar/summary.js';

const html = loadAppHtml();
const sectionsSrc = readFileSync(new URL('../src/agents/sections.ts', import.meta.url), 'utf8');
const measureSrc = readFileSync(new URL('../src/lidar/measure.ts', import.meta.url), 'utf8');
const NOW = new Date('2026-10-18T14:00:00Z');

/** The source between two anchors. */
function region(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(a);
  return src.slice(a, b);
}

/** A page constant, evaluated: `const NAME = <value>;` (the value may span lines). */
function pageConst<T>(name: string): T {
  const m = new RegExp(`^const ${name} = ([\\s\\S]*?);$`, 'm').exec(html);
  if (!m) throw new Error(`no const ${name} in the page`);
  return new Function(`return ${m[1]}`)() as T;
}

const roster = region(html, 'async function renderRosterList(slot)', '// A one-way action asks twice');
const agents = region(html, 'async function renderAgents()', '// ---------- Measure desk');
const measure = region(html, 'function renderMeasure()', 'function measureResult(');
const result = region(html, 'function measureResult(', '// ---------- Learn desk');
const learn = region(html, 'async function renderLearn()', 'const VIEW_TITLES');

// ─── #10 — the unknown-role note is said once ───────────────────────────────

describe('#10 — an unknown role is named once, on the roster card', () => {
  const crew = [{ id: 'c1', name: 'SIM-Cedar', role: 'bucket op', active: true }];

  it('the credential lines carry no role note, and the strictest cards are still required', () => {
    const out = findCertProblems(crew, [], '2026-10-18');
    // Strictest = first aid, CPR and aerial rescue — a typo in a role never lightens the check.
    expect(out.map((f) => f.type).sort()).toEqual(['aerial_rescue', 'cpr', 'first_aid']);
    for (const f of out) {
      expect(f.line, f.type).not.toMatch(/not one Arbo knows|strictest/);
      expect(f.line, f.type).toMatch(/NO RECORD on file/);
    }
  });

  it('a lapsed card for an unknown role reads the same as for a known one', () => {
    const certs = [{ id: 'x', crewMemberId: 'c1', type: 'aerial_rescue' as const, expiresOn: '2026-09-28' }];
    const line = findCertProblems(crew, certs, '2026-10-18').find((f) => f.type === 'aerial_rescue')!.line;
    expect(line).toBe('Aerial rescue EXPIRED 20 days ago — this is not a reminder, it is a stop.');
  });

  it('the roster card on the same Queue screen still says it', () => {
    expect(roster).toContain("w.textContent = '⚠ Arbo does not know this role, so it applies the strictest card requirements to them.';");
  });
});

// ─── #11 — the armed roster button says only what happens ────────────────────

describe('#11 — taking someone off the roster promises nothing the code does not do', () => {
  it('the armed line names the boards and says the crew code still opens the door', () => {
    expect(roster).toContain("'Tap again to take ' + p.name + ' off the roster — the safety and training boards stop counting them. Their crew code still opens the crew door.'");
    expect(html).not.toContain('lose crew-door access');
  });
});

// ─── #17 — the notes above the desks ────────────────────────────────────────

describe('#17 — one help line under the Run button, and a short AI-off line', () => {
  it('the time rides on the help line; stale, it is a warning line of its own', () => {
    expect(agents).toContain('const ranAt = AGENT_RUN && AGENT_RUN.ranAt;');
    expect(agents).toContain("const stale = !!ranAt && Date.now() - Date.parse(ranAt) > 15 * 60 * 1000;");
    expect(agents).toContain("v.appendChild(el('div', 'storm-muted', (ranAt && !stale ? 'Ran ' + fmtWhen(ranAt) + '. ' : '') + 'Run only looks — it never changes anything.'));");
  });

  it('the hourly sentence is gone from the notes (each NOT RUN row says it), and AI off is one short line', () => {
    expect(agents).not.toContain('Booking, collections, safety, permits and the morning briefing');
    expect(agents).toContain("el('div', 'feed-state unset', 'AI off — plain counts only, no AI key yet.')");
    // Still a named gap (§1B), never a help tip.
    expect(agents).not.toContain("el('div', 'storm-muted', 'AI off");
  });

  it('every note still keeps its gap under the Run button', () => {
    expect(html).toContain('.wide-btn + .storm-muted{margin-top:14px}');
    expect(html).toContain('#view-agents .wide-btn + .feed-state{margin-top:14px}');
  });
});

// ─── #18 — proposals say where to act, and take you there ───────────────────

describe('#18 — a proposal points at a real screen', () => {
  const simDeps = (): SectionDeps => {
    const base = onDemandSectionDeps(createApi(createSimSource(), { dataLinksSim: true }), { activeAlerts: async () => [] }, NOW);
    return { ...base, hasDb: () => true, linkOpen: () => true };
  };

  it('the Yard Boss names the Fleet cards on the Fleet screen, never a breakdown plan nobody can open', async () => {
    expect(sectionsSrc).not.toContain('Review the breakdown plan');
    const reports = await runAllSections(simDeps());
    const yard = reports.find((r) => r.agentId === 'yard-boss')!;
    const p = yard.proposals.find((x) => x.kind === 'parts_review')!;
    // Direction B P13: the Queue was split; the units are on the Fleet screen.
    expect(p.text).toMatch(/^Decide on the repair for (the DOWN unit|the \d+ DOWN units) on the Fleet screen\. Arbo never orders parts — a human buys/);
    expect(p.text).not.toMatch(/\(s\)|breakdown plan/);
  });

  it('every proposal kind with a screen gets a button to it; the rest stay plain text', () => {
    const go = pageConst<Record<string, [string, string]>>('PROPOSAL_GO');
    const kinds = [...new Set([...sectionsSrc.matchAll(/propose\('([a-z_]+)'/g)].map((m) => m[1]!))];
    // Every mapped kind is one the desks really propose.
    for (const k of Object.keys(go)) expect(kinds, k).toContain(k);
    // Only these two have no screen to open (permits needs its own render; nobody can stand a crew down here).
    expect(kinds.filter((k) => !go[k]).sort()).toEqual(['run_screen', 'stand_down_review']);
    // Each target is a view switchTab knows and the timed refresh already draws.
    const timed = /const TIMED = \{([^}]*)\}/.exec(html)![1]!;
    for (const [k, [label, tab]] of Object.entries(go)) {
      expect(label, k).toMatch(/→$/);
      expect(timed, k).toContain(tab + ':');
    }
    expect(go.parts_review).toEqual(['Open Fleet →', 'fleet']); // Direction B P13: the Fleet desk
    expect(go.area_review).toEqual(['Open Numbers →', 'perf']);
  });

  it('the button rides inside the proposal note and only switches the tab', () => {
    expect(agents).toContain("const note = el('div', 'due-note', 'Proposal for you: ' + noRefs(p.text));");
    expect(agents).toContain('const go = PROPOSAL_GO[p.kind];');
    expect(agents).toContain("b.addEventListener('click', () => switchTab(go[1]));");
  });
});

// ─── #19 — "runs on the hourly check" only when it does ─────────────────────

describe('#19 — a NOT RUN row says the hourly check only when it is armed', () => {
  const HOURLY = ["tomorrow's booked stops", 'owner briefing', 'permit screens for recent leads', 'crew certifications & near-miss log', 'open invoices'];
  const fakeDeps = (hourlySweep: boolean | undefined): SectionDeps => ({
    now: NOW, hasDb: () => true, linkOpen: () => true, hourlySweep,
    startRun: async () => ({ id: null, finish: async () => {} }),
  });
  const details = async (d: SectionDeps) => {
    const inputs = (await runAllSections(d)).flatMap((r) => r.inputs);
    return HOURLY.map((n) => inputs.find((i) => i.name === n)!);
  };

  it('off: the row says the check is off until its data is connected', async () => {
    for (const i of await details(fakeDeps(false))) {
      expect(i, i.name).toMatchObject({ state: 'notrun', detail: 'left to the hourly check, which is off until its data is connected' });
    }
  });

  it('armed (or not said): the row says it runs on the hourly check', async () => {
    for (const d of [fakeDeps(true), fakeDeps(undefined)]) {
      for (const i of await details(d)) {
        expect(i, i.name).toMatchObject({ state: 'notrun', detail: 'runs on the hourly check, not from this button' });
      }
    }
  });

  it('on demand it reads the REAL switch, and the practice-data override does not touch it', () => {
    const base = onDemandSectionDeps({} as never, { activeAlerts: async () => [] }, NOW);
    expect(base.hourlySweep).toBe(hasDb());
    // The route spreads base and overrides only hasDb and linkOpen (server.ts) — hourlySweep survives.
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(server).toContain('const deps = dataLinksSim() ? { ...base, hasDb: () => true, linkOpen: () => true } : base;');
    expect({ ...base, hasDb: () => true, linkOpen: () => true }.hourlySweep).toBe(base.hourlySweep);
  });
});

// ─── #20 — feet first, and no engine code on screen ─────────────────────────

describe('#20 — every Measure reason reads feet first', () => {
  it('the reasons a failed or small-tree scan shows carry feet before metres', () => {
    for (const s of [
      'no trunk-like column of points about 1–8 ft (0.3–2.5 m) above ground',
      'too few trunk points at about 4.2–4.8 ft (breast height) to fit a circle',
      'nothing in the scan rises more than about 1 ft (0.3 m) above ground',
      'within about 40 ft (${NEIGHBOURHOOD_M} m) of the stem',
      'diameter over about 8 ft (2.5 m) is outside what a phone scan resolves',
    ]) expect(measureSrc, s).toContain(s);
    for (const old of ['points 0.3–2.5 m above', 'at 1.27–1.47 m to fit', 'more than 0.3 m above', 'within ${NEIGHBOURHOOD_M} m of', "'diameter over 2.5 m"]) {
      expect(measureSrc, old).not.toContain(old);
    }
  });

  it('a scan with only ground keeps its engine codes in the API, and the page strips them for display', () => {
    const pts: number[] = [];
    for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) pts.push(i * 0.05, j * 0.05, 0);
    const m = measureTree(Float32Array.from(pts), { upAxis: 'z', units: 'm' });
    expect(m.confidence.dbh.reason).toMatch(/^stem_not_found: /);
    expect(m.confidence.height.reason).toMatch(/^no_height: /);
    expect(result).toContain("const why = (s) => String(s || '').replace(/^[a-z_]+: /, '');");
    const why = (s: string) => String(s || '').replace(/^[a-z_]+: /, '');
    for (const k of ['dbh', 'lean', 'height', 'crown'] as const) {
      const shown = why(m.confidence[k].reason);
      expect(shown, k).not.toMatch(/^[a-z_]+: |_/);
      expect(shown, k).toMatch(/\bft\b/);
    }
    // A plain reason (no code word) passes through untouched.
    expect(why('no validated phone-LiDAR crown method; counts everything')).toBe('no validated phone-LiDAR crown method; counts everything');
    expect(result).toContain('b.title = why(conf.reason);');
    expect(result).toContain("k.toUpperCase() + ' — ' + c.level + ': ' + why(c.reason)");
  });

  it('the agent and crew summary leads with feet and inches too', () => {
    const m: TreeMeasurement = {
      heightM: 8.5, crownSpreadM: 4.7, crownAxesM: { major: 4.7, minor: 4.1 }, dbhCm: 45.64,
      dbhFit: { inliers: 851, rmseCm: 0.4, arcCoverageDeg: 357 }, leanDeg: 2.46,
      confidence: { height: { level: 'low', reason: 'r' }, crown: { level: 'low', reason: 'r' }, dbh: { level: 'good', reason: 'r' }, lean: { level: 'good', reason: 'r' } },
      warnings: [], units: 'm', upAxis: 'y', pointCount: 33000, measuredAt: '2026-10-18T12:00:00.000Z',
    };
    const s = summarizeTreeMeasurement(m);
    expect(s).toContain('Height about 28 ft (8.5 m)');
    expect(s).toContain('Crown spread about 15 ft (4.7 m) at its widest and 13 ft (4.1 m) the other way');
    expect(s).toContain('Trunk diameter at breast height (4.5 ft / 1.37 m) about 18.0 in (45.6 cm)');
    expect(s).toContain('; 0.16 in (0.4 cm) scatter.');
    // No figure leads with metres any more.
    expect(s).not.toMatch(/about \d+(\.\d)? m\b/);
  });
});

// ─── #21 — the scan status is set apart from the tip ────────────────────────

describe('#21 — the Measure status line does not look like the help tip above it', () => {
  it('only the pick slot’s own fact line takes the status look', () => {
    expect(html).toContain('#view-measure .slot > .factmeta{color:var(--ink-1);font-weight:600;border-top:1px solid var(--hairline);padding-top:10px}');
    // The status line is a direct child of the pick slot; the per-figure lines sit inside a .card.
    expect(measure).toContain("const pick = el('div', 'slot');");
    expect(measure).toContain('pick.appendChild(status);');
    expect(result).toContain("const card = el('div', 'card');");
    expect(result).not.toContain("wrap.appendChild(el('div', 'factmeta'");
  });
});

// ─── #22 — the Learn run buttons share one row ──────────────────────────────

describe('#22 — short run buttons, and the why in the lines under them', () => {
  it('the Opus button keeps one short label and stays disabled with no key', () => {
    expect(learn).toContain("const b2 = el('button', 'actbtn alt', 'Run with Opus');");
    expect(learn).toContain("b2.disabled = !st.opusAvailable || st.status === 'running';");
    expect(learn).not.toContain("st.opusAvailable ? 'Run with Opus (");
  });

  it('the cost and the missing key are said under the buttons, the key as a not-set-up line', () => {
    expect(learn).toContain("Opus: answers all ' + plural(cat.total, 'scenario') + ' the way it would on a real call — one model call each.'");
    expect(learn).toContain("if (!st.opusAvailable) v.appendChild(el('div', 'feed-state unset', 'Opus practice is off — no AI key on the server yet.'));");
  });

  it('the line under the buttons keeps its distance, on Learn only', () => {
    expect(html).toContain('#view-learn .actions + .storm-muted{margin-top:12px}');
    expect(html).not.toMatch(/\n\.actions \+ \.storm-muted\{/);
  });
});
