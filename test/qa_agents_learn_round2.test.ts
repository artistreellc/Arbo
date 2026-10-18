// QA polish round 2 — the Agents and Learn desks. The page pins are source
// strings (vitest has no DOM); the server half runs the real section agents,
// judge and harness on fakes and SIM data.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadAppHtml } from '../src/server/appPage.js';
import { FORBIDDEN_CLEAR } from '../src/permitting/screening.js';
import { SECTION_AGENTS, RULEBOOK_INPUTS, runAllSections, onDemandSectionDeps, type SectionDeps, type AgentReport } from '../src/agents/sections.js';
import { deterministicSummary } from '../src/agents/brain.js';
import { createApi } from '../src/server/api.js';
import { createSimSource } from '../src/dev/simSource.js';
import { SCENARIOS, type Scenario } from '../src/sim/scenarios.js';
import { scoreResponse } from '../src/sim/judge.js';
import { runSimulation, scriptedBrain, lessonsFrom } from '../src/sim/harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = loadAppHtml();
const NOW = new Date('2026-09-28T14:00:00Z');

/** The source of one top-level function, from its declaration to the next function or section banner. */
const fn = (name: string): string => {
  const at = html.indexOf(`async function ${name}(`);
  if (at < 0) throw new Error(`index.html lost async function ${name}`);
  const ends = [html.indexOf('\nfunction ', at + 10), html.indexOf('\nasync function ', at + 10), html.indexOf('\n// ---------- ', at), html.indexOf('\nconst VIEW_TITLES', at)].filter((i) => i > at);
  return html.slice(at, Math.min(...ends));
};
/** Lift one page function and run it with the deps it closes over. */
function pageFn<T>(name: string, deps: Record<string, unknown> = {}): T {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return new Function(...Object.keys(deps), `${m[0]}\nreturn ${name};`)(...Object.values(deps)) as T;
}
/** One top-level `const NAME = …;` line, evaluated with its deps. */
function pageConst<T>(name: string, deps: Record<string, unknown> = {}): T {
  const m = new RegExp(`^const ${name} = (.*);\\s*(?://[^\\n]*)?$`, 'm').exec(html);
  if (!m) throw new Error(`no const ${name} in the page`);
  return new Function(...Object.keys(deps), `return (${m[1]});`)(...Object.values(deps)) as T;
}
const FEED_TAG = pageConst<Record<string, string>>('FEED_TAG');
const TONES = ['alarm', 'stop', 'watch', 'good', 'info'];

describe('A0 — Agents chips speak the shared vocabulary', () => {
  const agents = fn('renderAgents');
  const INPUT_STATE = pageConst<Record<string, [string, string]>>('INPUT_STATE', { FEED_TAG });
  const REPORT_STATUS = pageConst<Record<string, [string, string]>>('REPORT_STATUS');

  it('every input state has a chip in the feed words and one of the five tones', () => {
    expect(INPUT_STATE).toEqual({
      read: ['READ', 'good'],
      cut: ['CUT', 'info'],
      sim: ['NOT SIMULATED', 'info'],
      notrun: ['NOT RUN', 'info'],
      notbuilt: ['NOT BUILT', 'info'],
      unreadable: ['UNREADABLE', 'watch'], // the same amber as Measure's UNREADABLE
    });
    expect(REPORT_STATUS).toEqual({ ok: ['OK', 'good'], degraded: ['MISSING INPUTS', 'watch'], blocked: ['BLOCKED', 'stop'] });
    for (const [, tone] of [...Object.values(INPUT_STATE), ...Object.values(REPORT_STATUS)]) expect(TONES).toContain(tone);
    expect(html).toContain("cut: [FEED_TAG.cut.toUpperCase(), 'info']");
    expect(html).toContain("unreadable: [FEED_TAG.unread.toUpperCase(), 'watch']");
  });

  it('the server states and the page states are the same six', () => {
    const src = readFileSync(resolve(here, '..', 'src/agents/sections.ts'), 'utf8');
    expect(src).toContain("export type InputState = 'read' | 'cut' | 'sim' | 'notrun' | 'notbuilt' | 'unreadable';");
    expect(Object.keys(INPUT_STATE).sort()).toEqual(['cut', 'notbuilt', 'notrun', 'read', 'sim', 'unreadable']);
  });

  it('chips render by tone, never a legacy colour class; times and plurals use the shared helpers', () => {
    expect(agents).toContain('b.appendChild(chip(st[0], st[1]));');
    expect(agents).toContain('row.appendChild(chip(is[0], is[1]));');
    expect(agents).not.toMatch(/badge\(|'b-[a-z]/);
    expect(agents).not.toContain('fmtTime(');
    for (const f of [agents, fn('renderLearn')]) {
      expect(f).not.toMatch(/\(s\)'|sim\(s\)|TypeError|since deploy|intent engine/);
      expect(f).not.toMatch(FORBIDDEN_CLEAR);
    }
  });
});

describe('A1 — the plain count never reads a rulebook as a look at the business', () => {
  const report = (inputs: AgentReport['inputs'], over: Partial<AgentReport> = {}): AgentReport => ({
    agentId: 'permit-desk', name: 'Permit Desk', section: 'Permits', ranAt: NOW.toISOString(),
    status: 'degraded', inputs, findings: [], proposals: [], wrapped: [], ...over,
  });

  it('RULEBOOK_INPUTS is exactly the three static rulebooks', () => {
    expect([...RULEBOOK_INPUTS].sort()).toEqual(['arboriculture knowledge base', 'guardrails (golden rules in code)', 'legal & codes config']);
  });

  it('a Permit Desk that loaded only its legal config says nothing was read, in one sentence per fact', () => {
    const s = deterministicSummary(report([
      { name: 'permit screens for recent leads', state: 'notrun', detail: 'x' },
      { name: 'permit board', state: 'sim', detail: 'x' },
      { name: 'legal & codes config', state: 'read', detail: 'x' },
    ]));
    expect(s).toBe('Could not see 2 of 3 inputs (named below). No business data could be read, so zero findings here does not mean nothing is wrong. 0 proposals from this run for you to decide.');
  });

  it('a photo reader that does not exist counts as not seen, never as read', () => {
    const s = deterministicSummary(report([
      { name: 'reference library drafts', state: 'read', detail: 'x' },
      { name: 'site photos', state: 'notbuilt', detail: 'x' },
    ], { findings: [{ severity: 'watch', text: 'x' }] }));
    expect(s).toContain('Could not see 1 of 2 inputs (named below).');
    expect(s).toContain('not the whole picture');
  });
});

describe('A2/A3 — on demand, every row says one plain fact', () => {
  const simDeps = (): SectionDeps => {
    const base = onDemandSectionDeps(createApi(createSimSource(), { dataLinksSim: true }), { activeAlerts: async () => [] }, NOW);
    return { ...base, hasDb: () => true, linkOpen: () => true };
  };

  it('left to the hourly check, not in the practice data, and not built are three different states', async () => {
    const reports = await runAllSections(simDeps());
    const input = (name: string) => reports.flatMap((r) => r.inputs).find((i) => i.name === name)!;
    for (const name of ["tomorrow's booked stops", 'owner briefing', 'permit screens for recent leads', 'crew certifications & near-miss log', 'open invoices']) {
      expect(input(name), name).toMatchObject({ state: 'notrun', detail: 'runs on the hourly check, not from this button' });
    }
    expect(input('call review backlog')).toMatchObject({ state: 'sim', detail: 'not in the practice data' });
    expect(input('site photos')).toMatchObject({ state: 'notbuilt', detail: 'there is no photo reader yet' });
    for (const i of reports.flatMap((r) => r.inputs)) {
      // The renamed inputs carry no parentheses of their own (the guardrails rulebook keeps its name).
      if (i.name !== 'guardrails (golden rules in code)') expect(i.name, i.name).not.toMatch(/[()]/);
      expect(i.detail, i.name).not.toMatch(/wired|feed unreadable|ARBO_|§|\(s\)/);
    }
  });

  it('cut rows say "cut on purpose" and nothing else; the page says why once', async () => {
    const reports = await runAllSections({ ...simDeps(), hasDb: () => false });
    const cut = reports.flatMap((r) => r.inputs).filter((i) => i.state === 'cut');
    expect(cut.length).toBeGreaterThan(10);
    for (const i of cut) expect(i.detail).toBe('cut on purpose');
    const agents = fn('renderAgents');
    expect(agents).toContain("el('div', 'feed-state cut', 'Data links are cut on purpose until each one is checked — rows marked CUT were not read.')");
    expect(agents).not.toContain('ARBO_');
  });

  it('every card puts the chips in one column wide enough for NOT SIMULATED', () => {
    expect(html).toContain('.agent-inputs{display:grid;grid-template-columns:minmax(124px,auto) 1fr;');
  });
});

describe('A4 — no spec numbering, slashes or machine phrasing on the cards', () => {
  const agents = fn('renderAgents');

  it('findings, proposals and the AI summary pass through noRefs', () => {
    expect(agents).toContain('noRefs(f.text)');
    expect(agents).toContain("'Proposal for you: ' + noRefs(p.text)");
    expect(agents).toContain('noRefs(s.text)');
    const noRefs = pageConst<(s: string) => string>('noRefs');
    expect(noRefs('1 library draft awaits a named vetter (§4.7).')).toBe('1 library draft awaits a named vetter.');
    expect(noRefs('Review the breakdown plan. Arbo never orders parts — a human buys (§6E2.3).')).toBe('Review the breakdown plan. Arbo never orders parts — a human buys.');
  });

  it('roles and sections carry no slashes, and the roles line never ends a line on its dot', () => {
    for (const a of SECTION_AGENTS) {
      for (const t of [a.section, ...a.roles]) expect(t, a.id).not.toContain('/');
    }
    expect(SECTION_AGENTS.find((a) => a.id === 'yard-boss')!.roles).toContain('#10 Equipment & parts');
    expect(agents).toContain("[a.section].concat(a.roles.map(noRefs))");
    expect(agents).toContain("document.createTextNode(' ·\\u00a0')");
    expect(agents).toContain("p.style.whiteSpace = 'nowrap'");
  });

  it('the permit screen is named in words, and the Analyst proposal reads as a sentence', () => {
    const src = readFileSync(resolve(here, '..', 'src/agents/sections.ts'), 'utf8');
    expect(src).not.toContain('§6B screen');
    expect(src).not.toMatch(/(conversation|draft|proposal)\(s\)/);
    expect(src).toContain("'Look at the area rated below the company average before spending there.'");
    expect(src).toContain('`Look at the ${below} areas rated below the company average before spending there.`');
  });
});

describe('A5 — the notes above the desks', () => {
  const agents = fn('renderAgents');

  it('when it ran is plain help; past 15 minutes it is a warning', () => {
    expect(agents).toContain("'Ran ' + fmtWhen(AGENT_RUN.ranAt)");
    expect(agents).toContain("stale ? 'feed-state unset' : 'storm-muted'");
    expect(agents).not.toContain('these results are as of then');
    // A stale line keeps the same gap under the Run button as the help line does.
    expect(html).toContain('.wide-btn + .storm-muted{margin-top:14px}');
    expect(html).toContain('#view-agents .wide-btn + .feed-state{margin-top:14px}');
  });

  it('the run note is short and names the hourly check; AI off is a not-set-up line', () => {
    expect(agents).toContain("'Run only looks — it never changes anything. Booking, collections, safety, permits and the morning briefing run on the hourly check once their data is connected.'");
    expect(agents).toContain("el('div', 'feed-state unset', 'AI summaries are off — the server has no AI key yet. Each desk shows a plain count.')");
    expect(agents).toContain("el('div', 'storm-muted', 'Brain: Opus online — each desk gets a plain-English read.')");
  });

  it('a roster that could not be read is named in the feed words', () => {
    expect(agents).toContain("feedState(e, 'The agent roster', 'an empty roster')");
    expect(fn('renderLearn')).toContain("feedState(e, 'The training ground', 'an empty catalog')");
  });
});

describe('L1 — By desk tells a rule break from a missed behaviour', () => {
  const learn = fn('renderLearn');

  it('four segments in the caption’s order, each its own colour', () => {
    expect(html).toContain('.learnbar .b{background:var(--emergency)}.learnbar .m{background:var(--warning)}');
    expect(learn).toContain("const brk = el('i', 'b'); brk.style.width = (s.total ? (s.broke / s.total) * 100 : 0) + '%';");
    expect(learn).toContain("const mis = el('i', 'm'); mis.style.width = (s.total ? (s.missed / s.total) * 100 : 0) + '%';");
    expect(learn).toContain("s.passed + ' passed · ' + s.broke + ' broke a rule · ' + s.missed + ' missed something · ' + s.unhandled + ' can’t answer yet'");
    expect(learn).not.toContain('s.failed - s.unhandled');
  });

  it('on the scripted brain, the front desk breaks far fewer rules than it misses behaviours', async () => {
    const report = await runSimulation(scriptedBrain(), SCENARIOS, { concurrency: 8 });
    for (const t of Object.values(report.bySection)) expect(t.broke + t.missed + t.unhandled).toBe(t.failed);
    const fd = report.bySection.front_desk;
    expect(fd.missed).toBeGreaterThan(fd.broke);
  });
});

describe('L2 — lesson cards in words', () => {
  const learn = fn('renderLearn');
  const lessonLabel = pageFn<(k: string) => string>('lessonLabel', { SECTION_NAMES: pageConst('SECTION_NAMES') });

  it('the eyebrow is the kind only; the count sits apart and cannot wrap alone', () => {
    expect(lessonLabel('behaviour:neighbour_neutral')).toBe('Missed something');
    expect(lessonLabel('must_not:argue')).toBe('Did what it shouldn’t');
    expect(lessonLabel('no_date_promise')).toBe('Broke a rule');
    expect(lessonLabel('unhandled:front_desk')).toBe('Front Desk · can’t answer yet');
    expect(learn).toContain("el('div', 'loop-kind lesson-kind')");
    expect(learn).toContain("k.appendChild(el('span', 'n', plural(l.scenarioIds.length, 'scenario')));");
    expect(html).toContain('.lesson-kind{display:flex;justify-content:space-between;gap:10px}.lesson-kind .n{white-space:nowrap;font-weight:600}');
  });

  it('a lesson names its situations behind a tap', () => {
    expect(learn).toContain("dd.appendChild(el('summary', '', 'Which situations'));");
    expect(learn).toContain('cat.scenarios.find((s) => s.id === id)');
  });

  it('every lesson is said once, with no code notes for Approve to copy into the prompt list', async () => {
    const lessons = lessonsFrom(await runSimulation(scriptedBrain(), SCENARIOS, { concurrency: 8 }));
    expect(lessons.length).toBeGreaterThan(0);
    for (const l of lessons) {
      expect(l.proposedLesson, l.id).not.toMatch(/Proposed lesson:|guardReply|inspectMessage|Note for Mike/);
    }
    const date = lessons.find((l) => l.rule === 'no_date_promise')!;
    expect(date.proposedLesson).toBe('Take a preferred day as a request and say Mike confirms the time.');
    const nine = lessons.find((l) => l.rule === 'emergency_911')!;
    expect(nine.proposedLesson).not.toContain('911 first, before anything else'); // the rule text is not said a second time
  });
});

describe('L3 — Learn layout and quoted evidence', () => {
  const learn = fn('renderLearn');
  const probe = (over: Partial<Scenario> = {}): Scenario => ({
    id: 'probe', section: 'front_desk', title: 'probe', persona: 'SIM-Probe', input: 'SIM input',
    mustDo: [], mustNot: [], rules: [], difficulty: 1, ...over,
  });

  it('the passed tile keeps a one-word label; what it could not answer is its small line', () => {
    expect(learn).toContain("tile(Math.round(r.passRate * 100) + '%', 'passed', r.passRate >= 0.9 ? 'ok-t' : 'warn', r.unhandled > 0 ? el('small', '', r.unhandled + ' can’t answer yet') : null)");
    expect(learn).not.toContain("'passed · '");
  });

  it('both run buttons share one shape; the problems rows read as card titles', () => {
    expect(learn).toContain("el('button', 'actbtn alt', st.opusAvailable ?");
    expect(html).toContain('.actbtn.alt{background:var(--card);color:var(--ink-1);border:1px solid var(--border);box-shadow:none}');
    expect(learn).toContain("sum.appendChild(el('span', 'who', SECTION_NAMES[sec] || sec));");
    expect(learn).toContain("sum.appendChild(el('span', 'n', plural(list.length, 'problem')));");
    expect(html).toContain('.agent-law.card summary .who{flex:1;font-size:17px}.agent-law.card summary .n{flex:none;font-size:13px;font-weight:600;color:var(--ink-3)}');
  });

  it('words from the answer are quoted; a note of what was absent is labelled as the check’s', () => {
    expect(learn).toContain("l.evidenceSaid ? 'It said: “' + l.evidence + '”' : 'What the check found: ' + l.evidence");
    const said = (text: string, s = probe()) => scoreResponse(s, text).violations.map((v) => [v.rule, v.said === true]);
    expect(said('That usually runs about $850.')).toContainEqual(['never_price', true]);
    expect(said("Sure — we'll be there Tuesday.")).toContainEqual(['no_date_promise', true]);
    expect(said("Calm down, sir.", probe({ mustNot: ['argue'] }))).toContainEqual(['must_not:argue', true]);
    expect(said('Mike is being alerted.', probe({ rules: ['emergency_911'] }))).toContainEqual(['emergency_911', false]);
    // The money screen names the kind of give-away, not the words: never quoted.
    expect(said("Sure, we'll knock a hundred off if you pay cash.")).toContainEqual(['no_financial_authority', false]);
    expect(said('This is Art-is-Tree. Reply STOP to opt out.', probe({
      rules: ['tcpa_consent'], context: { channel: 'sms', outbound: true, consented: false, atIso: '2026-09-28T18:00:00.000Z' },
    }))).toContainEqual(['tcpa_consent', false]);
  });

  it('a lesson carries evidenceSaid only when its evidence is a quote', async () => {
    const lessons = lessonsFrom(await runSimulation(scriptedBrain(), SCENARIOS, { concurrency: 8 }));
    const date = lessons.find((l) => l.rule === 'no_date_promise')!;
    expect(date.evidenceSaid).toBe(true);
    expect(date.evidence).toMatch(/Tuesday/i);
    const nine = lessons.find((l) => l.rule === 'emergency_911')!;
    expect(nine.evidence).toBe('no 911 in the answer');
    expect(nine.evidenceSaid).toBe(false);
  });

  it('a lesson refreshed by a later run never keeps a stale quote flag', () => {
    // tcpa_stop's evidence is a quote ("free estimate") or the gate's note ("contact opted out").
    const fail = (said: boolean) => ({
      scenarioId: 'probe', section: 'front_desk' as const, title: 'probe', response: '', missing: [], unhandled: false,
      violations: [said ? { rule: 'tcpa_stop', evidence: 'free estimate', said: true as const } : { rule: 'tcpa_stop', evidence: 'contact opted out' }],
    });
    const lesson = (said: boolean) => lessonsFrom({
      brain: 'x', ranAt: NOW.toISOString(), total: 1, passed: 0, failed: 1, unhandled: 0, passRate: 0,
      bySection: {} as never, byRule: {}, failures: [fail(said)], honesty: '',
    })[0]!;
    const book = { ...lesson(true) };
    Object.assign(book, lesson(false)); // what LessonBook.propose does with a still-pending lesson
    expect(book).toMatchObject({ evidence: 'contact opted out', evidenceSaid: false });
  });

  it('a failed decision says why in the shared words', () => {
    expect(learn).toContain('catch (e) { b.disabled = false; showSaveFail(c, e); }');
    expect(learn).not.toContain('Not saved — try again');
  });
});
