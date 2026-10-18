// Pre-deploy QA round — the Agents and Learn desks. vitest has no DOM, so
// these are source-string pins on the one app file: each names the fix it
// keeps from being undone.
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';
import { FORBIDDEN_CLEAR } from '../src/permitting/screening.js';

const html = loadAppHtml();
/** The source of one top-level function, from its declaration to the next. */
const fn = (name: string): string => {
  const at = html.indexOf(`async function ${name}(`);
  if (at < 0) throw new Error(`index.html lost async function ${name}`);
  const next = html.indexOf('\nfunction ', at + 10);
  const nextAsync = html.indexOf('\nasync function ', at + 10);
  const ends = [next, nextAsync, html.indexOf('\nconst VIEW_TITLES', at)].filter((i) => i > at);
  return html.slice(at, Math.min(...ends));
};

describe('Agents desk', () => {
  const agents = fn('renderAgents');

  it('a feed left out on purpose is NOT RUN, and a desk missing inputs says so in words', () => {
    expect(html).toContain("notrun: ['NOT RUN', 'info']");
    expect(html).toContain("degraded: ['MISSING INPUTS', 'watch']");
    expect(html).not.toContain("'DEGRADED'");
  });

  it('the intro note promises no label, and the offline note says the AI is off without an env var name', () => {
    expect(agents).toContain('Run only looks — it never changes anything.');
    expect(agents).not.toContain('not wired in this run');
    expect(agents).not.toContain('hourly sweep');
    expect(agents).toContain("el('div', 'feed-state unset', 'AI summaries are off — the server has no AI key yet. Each desk shows a plain count.')");
    expect(agents).not.toContain('ANTHROPIC_API_KEY');
  });

  it('brief numbering stays off the screen: roles and the rules pass through noRefs', () => {
    expect(html).toContain("const noRefs = (s) => s.replace(/^#\\d+\\s*/, '').replace(/\\s*\\((?:R\\d+|§)[^)]*\\)/g, '');");
    expect(agents).toContain('a.roles.map(noRefs)');
    expect(agents).toContain('a.cannot.map(noRefs)');
  });

  it('a kept result says when it ran, and warns only once it is stale', () => {
    expect(agents).toContain("'Ran ' + fmtWhen(AGENT_RUN.ranAt) + (stale ? ' — over 15 minutes old. Run again for a current read.' : '.')");
    expect(agents).toContain("stale ? 'feed-state unset' : 'storm-muted'");
    expect(agents).not.toContain('not live');
  });

  it('input rows line up in one column and the rules drawer shows it opens', () => {
    expect(html).toContain('.agent-inputs{display:grid;grid-template-columns:minmax(124px,auto) 1fr;');
    expect(html).toContain('.agent-in{display:contents}');
    expect(html).toContain('.wide-btn + .storm-muted{margin-top:14px}');
    expect(html).toContain('.agent-law summary::after{');
    expect(html).toContain('.agent-law[open] summary::after{transform:rotate(-135deg)}');
    expect(html).toContain('.agent-law summary::-webkit-details-marker{display:none}');
  });
});

describe('Learn desk', () => {
  const learn = fn('renderLearn');

  it('the headline tiles count what was checked, not the catalog, and name the unanswered', () => {
    expect(learn).toContain("tile(exercised + '/' + ruleIds.length, 'rules checked')");
    expect(learn).toContain("tile(ruleIds.length, 'rules on file')");
    expect(learn).not.toContain('rules tested');
    expect(learn).toContain("el('small', '', r.unhandled + ' can’t answer yet')");
    expect(html).toContain("const BRAIN_LABEL = { scripted: 'rule check', opus: 'Opus' };");
    expect(learn).toContain("'. Clears when the app is redeployed.'");
    expect(learn).not.toContain('r.honesty');
  });

  it('every waiting lesson is accounted for: rule breaks first, and the rest named', () => {
    expect(learn).toContain(".sort((a, b) => lessonTier(a) - lessonTier(b) || b.scenarioIds.length - a.scenarioIds.length)");
    expect(learn).toContain("'Showing 25 of ' + lessons.length");
  });

  it('lesson cards are headed in words, and the evidence is labelled as the check’s note', () => {
    expect(html).toContain('function lessonLabel(k)');
    for (const word of ["'Missed something'", "'Did what it shouldn’t'", "'Broke a rule'"]) expect(html).toContain(word);
    expect(learn).toContain('lessonLabel(l.rule)');
    expect(learn).not.toContain("l.rule.replace(/_/g, ' ')");
    expect(learn).toContain("'What the check found: '");
    expect(learn).not.toContain('What it said');
  });

  it('a desk with no handler is never an Approve/Reject card or an approved lesson', () => {
    expect(learn).toContain("l.status === 'proposed' && !l.rule.startsWith('unhandled:')");
    expect(learn).toContain("l.status === 'approved' && !l.rule.startsWith('unhandled:')");
  });

  it('the disabled Opus button looks disabled and says why in plain words', () => {
    expect(html).toContain('.minibtn:disabled{opacity:.5;box-shadow:none;background:var(--paper)}');
    expect(learn).toContain('Opus practice is off — no AI key on the server');
    expect(learn).not.toContain('needs a model key');
  });

  it('by-desk bars run in the caption’s order, and a rule break is the loud colour', () => {
    expect(html).toContain('.learnbar .b{background:var(--emergency)}');
    expect(learn).toContain('bar.appendChild(pass); bar.appendChild(brk); bar.appendChild(mis); bar.appendChild(un);');
    expect(learn).toContain("' can’t answer yet'");
  });

  it('nothing on either desk says "clear"', () => {
    expect(fn('renderAgents')).not.toMatch(FORBIDDEN_CLEAR);
    expect(learn).not.toMatch(FORBIDDEN_CLEAR);
  });
});
