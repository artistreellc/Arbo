/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  Owner instruction from Mike, 2026-08-03. This is not decoration and it
  is not optional. It is here because this is the point in a build where
  things get broken by moving fast, and that already happened to him once
  on the website. It does not happen here.
  ═══════════════════════════════════════════════════════════════════════

  SLOW DOWN. DRASTICALLY. Then:

  1. READ EVERY LINE BEFORE YOU EDIT ONE. Every line, every letter,
     slowly. You are not skimming to find the spot to change — you are
     building a model of what this file already does. If you cannot say
     what the code above and below your edit does, you have not read it.

  2. AN AUDIT IS READ-ONLY. If you were asked to audit, you do not edit.
     You do not "fix it while you are in there." You do not refactor, or
     tidy, or rename. You READ, and you REPORT. Editing during an audit
     is disobeying the instruction, full stop.

  3. THINK BEFORE YOU TYPE. What does this already handle? What depends
     on it? What breaks downstream? Recognise the PATTERN before you call
     something a bug — most things in here that look wrong are a
     deliberate correction. Check docs/OWNER_RULINGS.md first. Use what
     you already know about this codebase instead of re-deciding it.

  4. BRING IT TO MIKE — DO NOT DECIDE IT. Anything that looks wrong,
     ambiguous, or outside what was asked: say it and WAIT. Flagging
     costs one sentence. Deciding on his behalf has cost real work and
     real money more than once.

  5. DO EXACTLY WHAT WAS ASKED. Not the adjacent thing. Not the bigger
     thing you thought of on the way. Not the cleanup. Exactly what was
     asked, and nothing else.

  If you are moving fast right now, you are already off the rails.

  Remember the marker: SLOW::ARBO
*/
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadCrewHtml, loadAppHtml } from '../src/server/appPage.js';

const html = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');

describe('the crew door (§8C.1) — one app, two doors', () => {
  it('is a separate shell from the admin cockpit', () => {
    expect(loadCrewHtml()).not.toBe(loadAppHtml());
    expect(loadCrewHtml()).toContain('ARBO');
    expect(loadCrewHtml()).toContain('Crew');
  });

  it('is self-contained — no external scripts, styles, or fonts', () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+(stylesheet|font)/i);
    expect(html).not.toMatch(/@import/);
  });

  it('only ever calls crew endpoints — never an admin one', () => {
    const calls = [...html.matchAll(/api\('([^']+)'/g)].map((m) => m[1]!);
    expect(calls.length).toBeGreaterThan(0);
    // Deliberately updated (QA round 2): the one exception is GET /health, the
    // public status read (data links live or cut) that words a failed read the
    // way the office app does. It is not an admin route and carries no data.
    expect(calls.filter((c) => !c.startsWith('/api/crew/'))).toEqual(['/health']);
    for (const c of calls.filter((x) => x !== '/health')) {
      expect(c, `crew page called a non-crew endpoint: ${c}`).toMatch(/^\/api\/crew\//);
    }
    // R31: truck positions and trips are owner-only — the crew page never names their routes.
    for (const forbidden of ['/api/leads', '/api/properties', '/api/estimating', '/api/queue', '/api/followups', '/api/calendar', '/api/bouncie', '/api/fleet/positions', '/api/fleet/trips']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('never mentions price, tracking, or customer-contact concepts', () => {
    // Scan the markup + logic, NOT the stylesheet (CSS legitimately says
    // "margin"). Business terms must not appear anywhere a crew member reads.
    const withoutCss = html.replace(/<style>[\s\S]*?<\/style>/g, '').toLowerCase();
    for (const term of ['quoted', 'margin', 'invoice', 'bouncie', 'lead quality', 'price', 'customer phone']) {
      expect(withoutCss, `crew page references "${term}"`).not.toContain(term);
    }
    expect(withoutCss).not.toMatch(/\$\s?\d/);
  });

  it('keeps work orders behind the gate — the day cannot open unbriefed', () => {
    // The renderer refuses to draw work orders until GATE.unlocked is true.
    // Deliberately updated (R26, 2026-10-20): the one exception is the office's
    // look-only preview, which reads the day with every action switched off
    // (test/r26_crew-preview.test.ts). It runs only on the office key, so on a
    // crew phone ?preview=1 reads nothing and the gate still stands.
    expect(html).toMatch(/if \(!GATE\.unlocked && !PREVIEW\)/);
    expect(html).toContain('Your work orders unlock after the safety briefing');
  });

  it('treats the SERVER as the gate authority, not the page', () => {
    // The page posts its state and obeys the answer; it never self-unlocks.
    expect(html).toContain("/api/crew/briefing/ack");
    expect(html).toMatch(/if \(!res\.unlocked\)/);
  });

  it('requires all three gate conditions in the UI copy', () => {
    expect(html).toContain('scroll to the bottom');
    expect(html).toContain('tick the box');
    expect(html).toMatch(/read for/);
  });

  it('prompts the before/after photo law on every job (§1B)', () => {
    // Deliberately updated (CREW_PLAN C2, D107, Q9): the law still rides every
    // card, now without promising a close flow the app does not have.
    expect(html).toContain('Before + after photos are required');
  });

  it('cites standards by clause, never reproducing text (§6U.3)', () => {
    expect(html).toContain('Per ');
    expect(html).toContain('verify on site');
  });

  it('renders all server text via textContent (XSS-safe by construction)', () => {
    expect(html).not.toMatch(/innerHTML/);
  });

  it('never says "clear" or "cleared" anywhere on the crew door', () => {
    // On a crew phone "cleared" reads as permission to cut. Held-back and
    // unreadable days say "not confirmed", "on hold" or "do not start".
    expect(html).not.toMatch(/\bclear(ed)?\b/i);
    expect(loadCrewHtml()).not.toMatch(/\bclear(ed)?\b/i);
  });
});

describe('crew near-miss filing (§6V) — blameless and always reachable', () => {
  const html = loadCrewHtml();

  it('posts to the crew near-miss endpoint', () => {
    expect(html).toContain('/api/crew/near-miss');
  });

  it('is OUTSIDE the briefing gate — reportable before the day starts', () => {
    // renderNearMiss() runs on boot, not from renderWork(), which is the
    // gate-guarded path. A near miss that has to wait for a briefing is a
    // near miss that never gets filed.
    // M11: the briefing read is loadBriefing() (retried on resume), still called right after.
    expect(html).toMatch(/renderNearMiss\(\);\s*\n\s*loadBriefing\(\);/);
  });

  it('promises no blame in the copy, and asks for no name', () => {
    // Deliberately updated (QA, 2026-10-18): the old line promised "No names",
    // but every report is filed under the crew code. The copy now promises
    // only what is true; whether near misses go anonymous is Mike's call.
    // QA round 2: the intro was shortened to one sentence per idea.
    expect(html).toContain('nobody gets blamed or written up');
    expect(html).not.toContain('No names');
    expect(html).not.toMatch(/who was at fault|whose fault|who caused/i);
  });

  it('a failed filing is told to the crew, never swallowed', () => {
    expect(html).toContain('Did not save');
    expect(html).toContain('Tell the office directly');
  });
});

describe('clock-in question (§6M/§4.6) on the crew door', () => {
  const html = loadCrewHtml();

  it('asks the server for the questions and posts answers, never a score', () => {
    expect(html).toContain("'/api/crew/quiz?context=' + ctx");
    expect(html).toContain('/api/crew/quiz/complete');
    // The phone sends WHICH option it picked. It never asserts correctness —
    // the server grades against a key this page has never seen.
    expect(html).toContain('answers: QUIZ.answers');
    expect(html).not.toMatch(/correct:\s*\d/);
  });

  it('picks the Friday questionnaire by the Hampton Roads day, not UTC', () => {
    expect(html).toContain("timeZone: 'America/New_York', weekday: 'short'");
    expect(html).toContain('friday_questionnaire');
    expect(html).toContain('clock_in_gate');
  });

  it('shows progress and never dresses a short pool up as a full quiz (§1B)', () => {
    expect(html).toContain('answered');
    expect(html).toContain('This is not a short week');
  });

  it('shows the crew that the time is paid (§4.6)', () => {
    expect(html).toContain('paid time');
    expect(html).toContain('min paid');
  });

  it('a quiz that fails to load says so instead of silently skipping', () => {
    expect(html).toContain('do not skip it quietly');
    expect(html).toContain('not "no questions"');
  });

  it('the question only renders after the briefing gate unlocks', () => {
    expect(html).toMatch(/if \(!GATE\.unlocked \|\| QUIZ\.done\) return;/);
  });

  it('keeps field-sized targets', () => {
    expect(html).toMatch(/\.qopt\{[^}]*min-height:56px/);
  });
});

describe('reference library on the crew door (§6U)', () => {
  const html = loadCrewHtml();

  it('searches the crew-scoped library endpoint', () => {
    expect(html).toContain("'/api/crew/reference?q='");
    expect(html).toContain('How do I');
  });

  it('is OUTSIDE the briefing gate — reachable before the day starts', () => {
    // renderLibrary() runs on boot, not from renderWork(). Somebody who needs
    // to look a technique up is already standing at the trunk.
    expect(html).toMatch(/renderLibrary\(\);\s*\n\s*renderNearMiss\(\);/);
    expect(html).not.toMatch(/GATE\.unlocked[\s\S]{0,200}renderLibrary/);
  });

  it('cites the clause and never promises the standard itself (§6U.3)', () => {
    expect(html).toContain('never reprints the standard');
    expect(html).toContain('verify on site');
  });

  it('a library it could not read is NEVER drawn as an empty one (§1B)', () => {
    // QA round 2: the reason is the crew door's one wording for a failed read (crewWhy).
    expect(html).toContain("'Library: ' + crewWhy(e)");
    expect(html).toContain('cut on purpose');
    expect(html).toContain('not part of the practice data');
    expect(html).toContain('That is NOT "nothing on file"');
  });

  it('separates "nothing matched" from "nothing is in here" (§1B)', () => {
    expect(html).toContain('Nothing published matches that');
    expect(html).toContain('Nothing is published in the library yet');
  });

  it('names entries held back for want of a human sign-off (§4.7)', () => {
    expect(html).toContain('not yet signed off by a person');
  });

  it('a technique with no recorded limits is shown as incomplete, not as safe', () => {
    expect(html).toContain('e.limitsWarning');
    expect(html).toContain('When this does NOT work');
    // The absence renders in the loud box, same as a real limit would.
    expect(html).toMatch(/lib-limits[\s\S]{0,120}limitsWarning/);
  });

  it('an unknown skill level is stated, never treated as a sign-off', () => {
    expect(html).toContain('could not read your signed-off level');
    expect(html).toContain('That is not a sign-off');
    expect(html).toContain('do not run it until the office signs you off');
  });

  it('says when the search words were too short to actually search on (§1B)', () => {
    expect(html).toContain('too short to search on');
    expect(html).toContain('this is the whole library, not matches');
  });

  it('will not build an href out of anything but http(s)', () => {
    // The rest of the page is XSS-safe because it only ever sets textContent.
    // An href is the one exception, so a stored source link is filtered.
    expect(html).toMatch(/\/\^https\?:\\\/\\\/\/i\.test\(e\.sourceLink\)/);
    // And a rejected link is named, not silently dropped (§1B).
    expect(html).toContain('not a link Arbo will open');
  });

  it('keeps field-sized targets on the lookup', () => {
    expect(html).toMatch(/#lib-q\{[^}]*min-height:56px/);
    expect(html).toMatch(/#lib-go\{[^}]*min-height:56px/);
  });
});

describe('arrival record + change order on the job card (§6)', () => {
  const html = loadCrewHtml();

  it('logs arrival against the job and shows the GAPS, not a confirmation', () => {
    expect(html).toContain("'/api/crew/arrival'");
    expect(html).toContain('gapline');
    // The weaknesses render before the reassurance.
    expect(html.indexOf('res.lines')).toBeLessThan(html.indexOf('res.defensible'));
  });

  it('the crew records THAT work was agreed and WHO agreed — never a figure (§8C)', () => {
    expect(html).toContain("'/api/crew/change-order'");
    // Deliberately updated (CREW_PLAN C2, D107): the prompt() that asked "Who agreed
    // to it?" is gone; the sender kept for the form still carries who agreed, and
    // still names a missing name.
    expect(html).toContain('agreedBy: agreedBy.trim(),');
    expect(html).toContain('Needs the name of whoever agreed to it.');
    // No money crosses onto this surface at all. The office fills it in.
    expect(html).not.toMatch(/amount/i);
    expect(html).toContain('office fills the number in');
  });

  it('tells the crew it is not on the bill until the office confirms', () => {
    expect(html).toContain('office to confirm before it goes on the bill');
  });

  it('keeps field-sized targets on the new job actions', () => {
    expect(html).toMatch(/\.jobbtn\{[^}]*min-height:52px/);
  });
});

// ═══ CREW_PLAN C1 (D107) — name every failure on the crew door (§1B) ═══════
// Production runs ARBO_DATA_LINKS=readonly with the jobs link kept cut, so the
// crew door's failure lines are the lines a crew member actually reads. Every
// catch words its failure through crewWhy (the crew door's one vocabulary for
// a failed read), and the quiz names an empty pool instead of vanishing.
// vitest has no DOM: the page's own functions run over small stand-ins.
describe('C1 — the five catches name their failure through crewWhy', () => {
  /** One top-level function (closing "}" alone on its line). */
  const src = (name: string): string => {
    const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
    if (!m) throw new Error(`no function ${name} in the page`);
    return m[0];
  };

  // C2 (D107) moved the arrival and extra-work catches out of the (now switched-off)
  // buttons into sendArrival / sendChangeOrder, kept for the forms to come; the
  // pin follows them there with the same meaning.
  it('renderWork, submitQuiz, renderQuiz, sendArrival and sendChangeOrder wait for /health, then call crewWhy — no bare retry left', () => {
    for (const name of ['renderWork', 'submitQuiz', 'renderQuiz', 'sendArrival', 'sendChangeOrder']) {
      const s = src(name);
      expect(s, name).toContain('await LINKS_READY');
      expect(s, name).toContain('crewWhy(');
      expect(s, name).not.toContain('Try again.');
      expect(s, name).not.toContain('try once more');
      // A catch that drops the error cannot name it.
      expect(s, name).not.toMatch(/catch \{/);
    }
  });
});

/** Just enough DOM for the quiz and the work-order list. */
class Node1 {
  kids: Node1[] = [];
  listeners: Record<string, () => unknown> = {};
  disabled = false;
  id = '';
  href = '';
  target = '';
  rel = '';
  constructor(public tag: string, public className = '', public textContent = '') {}
  appendChild(k: Node1): Node1 { this.kids.push(k); return k; }
  replaceChildren(): void { this.kids = []; }
  addEventListener(type: string, fn: () => unknown): void { this.listeners[type] = fn; }
  setAttribute(): void {}
  querySelector(sel: string): Node1 | null { return this.all().find((n) => '.' + n.className === sel) ?? null; }
  all(): Node1[] { return this.kids.flatMap((k) => [k, ...k.all()]); }
  /** Everything a crew member would read in this node, in order. */
  text(): string { return [this.textContent, ...this.kids.map((k) => k.text())].filter(Boolean).join(' '); }
}
const el1 = (tag: string, cls?: string, text?: string): Node1 => new Node1(tag, cls ?? '', text ?? '');
const doc1 = { createElement: (t: string) => new Node1(t), createTextNode: (t: string) => new Node1('#text', '', t), querySelector: () => new Node1('main') };
const lift = <T,>(name: string, deps: Record<string, unknown>): T => {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return new Function(...Object.keys(deps), `${m[0]}\nreturn ${name};`)(...Object.values(deps)) as T;
};
const crewWhyAt = (links: string | null) => lift<(e: unknown) => string>('crewWhy', { LINKS: links });
const refused = (code: number, message: string) => async () => { throw Object.assign(new Error(message), { code }); };

describe('C1 — the clock-in question names an empty pool and a failed read', () => {
  const quiz = async (answer: () => Promise<unknown>, links: string | null = 'readonly') => {
    const v = new Node1('div');
    const renderQuiz = lift<(ctx?: string) => Promise<void>>('renderQuiz', {
      $: (id: string) => (id === 'quiz' ? v : v.all().find((n) => n.id === id) ?? null),
      el: el1, document: doc1, api: answer, GATE: { unlocked: true }, QUIZ: { done: false, items: [], answers: {} },
      QUIZ_TITLE: { clock_in_gate: 'Question before you roll', friday_questionnaire: 'Friday check' },
      isFridayEt: () => false, CREW_ID: 'x', submitQuiz: () => {}, LINKS_READY: Promise.resolve(), crewWhy: crewWhyAt(links),
    });
    await renderQuiz();
    return v;
  };
  const NAMED_EMPTY = 'The office hasn’t published any questions yet — nothing to answer today.';
  const GAP = 'That is the office’s gap, not a pass.';
  const lesson = { id: 'l1', topic: 'Drop zones', type: 'lesson', prompt: 'SIM lesson', options: [], readOnly: true };
  const question = { id: 'q1', topic: 'Rigging', type: 'quiz_question', prompt: 'SIM question?', options: ['A', 'B'], readOnly: false };

  it('an empty pool draws the named line — never a silent skip — and offers nothing to submit', async () => {
    const v = await quiz(async () => ({ itemsLoaded: true, items: [], shortfall: 1 }));
    expect(v.text()).toContain(NAMED_EMPTY);
    expect(v.text()).toContain(GAP);
    expect(v.all().some((n) => n.id === 'quiz-go')).toBe(false);
  });

  it('a pool with no quiz_question (a lesson only) draws the same named line', async () => {
    const v = await quiz(async () => ({ itemsLoaded: true, items: [lesson], shortfall: 0 }));
    expect(v.text()).toContain(NAMED_EMPTY);
    expect(v.all().some((n) => n.id === 'quiz-go')).toBe(false);
  });

  it('a pool with a question still asks it (the named line is only for a pool with none)', async () => {
    const v = await quiz(async () => ({ itemsLoaded: true, items: [question], shortfall: 0 }));
    expect(v.text()).not.toContain(NAMED_EMPTY);
    expect(v.text()).toContain('SIM question?');
    expect(v.all().some((n) => n.id === 'quiz-go')).toBe(true);
  });

  it('a failed load gives crewWhy’s reason in the warning box and still says carry on', async () => {
    const v = await quiz(refused(503, 'read_only'));
    const box = v.all().find((n) => n.className === 'state err')!;
    expect(box, 'a failed read wears the warning box, not the empty one').toBeDefined();
    expect(box.text()).toContain('Arbo is read-only right now — it can look but not save, so nothing was written');
    expect(box.text()).toContain('carry on');
    expect(v.text()).not.toContain(NAMED_EMPTY);
  });

  // Review D2 (D107): the route answered, but the questions themselves could not
  // be read (itemsLoaded false). §1B: that is never "none published" — it wears
  // the warning box and says it could not be loaded, and nothing is asked.
  it('questions the server could not read are named in the warning box — never "none published"', async () => {
    const v = await quiz(async () => ({ itemsLoaded: false, items: [], shortfall: 1 }));
    const box = v.all().find((n) => n.className === 'state err')!;
    expect(box, 'an unread pool wears the warning box, not the empty one').toBeDefined();
    expect(box.text()).toContain('could not be loaded');
    expect(box.text()).toContain('This is not "no questions"');
    expect(v.text()).not.toContain(NAMED_EMPTY);
    expect(v.text()).not.toContain(GAP);
    expect(v.all().some((n) => n.id === 'quiz-go')).toBe(false);
  });

  it('a rejected crew code is said as one — never "the office didn’t answer"', async () => {
    const v = await quiz(refused(400, 'bad_crew_id'));
    expect(v.text()).toMatch(/the office did not recognise your crew code/i);
    expect(v.text()).not.toMatch(/didn’t answer/i);
  });

  it('answers that did not save name why, and never invite a bare retry', async () => {
    const quizNode = new Node1('div');
    quizNode.appendChild(el1('div', 'errline', ''));
    const go = new Node1('button');
    const submitQuiz = lift<() => Promise<void>>('submitQuiz', {
      $: (id: string) => (id === 'quiz' ? quizNode : go), el: el1, api: refused(503, 'read_only'), CREW_ID: 'x',
      QUIZ: { context: 'clock_in_gate', items: [question], answers: { q1: 0 }, startedAt: '' },
      LINKS_READY: Promise.resolve(), crewWhy: crewWhyAt('readonly'),
    });
    await submitQuiz();
    const line = quizNode.querySelector('.errline')!.textContent;
    expect(line).toContain('Arbo is read-only right now');
    expect(line).not.toMatch(/try once more|Try again/);
  });
});

describe('C1 — the work-order list: a failed read is named; "Nothing scheduled" only over a read that succeeded', () => {
  const work = async (answer: () => Promise<unknown>, links: string | null = 'readonly') => {
    const v = new Node1('div');
    const renderWork = lift<() => Promise<void>>('renderWork', {
      $: () => v, el: el1, document: doc1, api: answer, GATE: { unlocked: true }, PREVIEW: false, PREVIEW_WHY: '',
      fmtTime: () => '9:00 AM', arrivalButton: () => el1('div'), changeOrderButton: () => el1('div'),
      crewMapsUrl: () => 'https://www.google.com/maps/dir/?api=1&destination=x',
      LINKS_READY: Promise.resolve(), crewWhy: crewWhyAt(links),
    });
    await renderWork();
    return v;
  };

  it('the jobs link kept cut (read-only) is named in the warning box, and is not an empty day', async () => {
    const v = await work(refused(503, 'link_cut'));
    const box = v.all().find((n) => n.className === 'state err')!;
    expect(box).toBeDefined();
    expect(box.text()).toContain('Could not load your work orders');
    expect(box.text()).toContain('The office data link is cut on purpose.');
    expect(box.text()).toContain('That is not an empty day — call the office.');
    expect(v.text()).not.toContain('Nothing scheduled');
  });

  it('a 429 names the wait, not "the office didn’t answer"', async () => {
    const v = await work(refused(429, 'too_many_attempts'));
    expect(v.text()).toContain('Too many wrong door keys from this connection');
  });

  it('"Nothing scheduled" is drawn only after a read that answered with nothing held', async () => {
    expect((await work(async () => ({ workOrders: [], notWorkOrders: 0, contractLookupFailed: false }))).text()).toContain('Nothing scheduled');
    for (const answer of [
      refused(503, 'read_only'), refused(500, 'error'), refused(0, 'Failed to fetch'),
      async () => ({ workOrders: [], notWorkOrders: 2, contractLookupFailed: true }),
      async () => ({ workOrders: [], notWorkOrders: 1, contractLookupFailed: false }),
    ]) expect((await work(answer)).text()).not.toContain('Nothing scheduled');
  });
});

// ═══ CREW_PLAN C2 (D107) — Navigate, no prompt(), the job actions off with why ═══
describe('C2 — one maps builder, one Navigate per card, opened straight from a tap', () => {
  const crewMapsUrl = (a: string, c: string) => lift<(a: string, c: string) => string>('crewMapsUrl', {})(a, c);
  const WO = (n: number, over: Record<string, unknown> = {}) => ({
    jobId: `sim-job-${n}`, routeOrder: n, address: `${n}01 Simulation Row`, city: 'Virginia Beach', timeIso: '2026-10-21T13:00:00Z',
    scope: 'SIMULATED — remove leaning pine', hazards: [], permitNote: null, photoRefs: [], briefingId: null, requiresBeforeAfterPhotos: true, ...over,
  });
  const render = async (orders: unknown[], preview = false, held = 0) => {
    const v = new Node1('div');
    const deps = { el: el1, PREVIEW: preview, api: async () => { throw new Error('a switched-off job action must not send'); }, CREW_ID: 'x' };
    await lift<() => Promise<void>>('renderWork', {
      $: () => v, el: el1, document: doc1, GATE: { unlocked: !preview }, PREVIEW: preview, PREVIEW_WHY: 'Off in the preview — nothing here signs, files or clocks in.',
      api: async () => ({ workOrders: orders, notWorkOrders: held, contractLookupFailed: false }), fmtTime: () => '9:00 AM',
      arrivalButton: lift('arrivalButton', deps), changeOrderButton: lift('changeOrderButton', deps), crewMapsUrl,
      LINKS_READY: Promise.resolve(), crewWhy: crewWhyAt('simulation'),
    })();
    return v;
  };

  it('builds Google Maps directions in the maps/dir/?api=1&destination= shape — and never routes a stop with no street to the bare city', () => {
    expect(crewMapsUrl('101 Simulation Row', 'Virginia Beach'))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=101%20Simulation%20Row%2C%20Virginia%20Beach%2C%20VA&travelmode=driving');
    expect(crewMapsUrl('202 Placeholder Way', '')).toBe('https://www.google.com/maps/dir/?api=1&destination=202%20Placeholder%20Way%2C%20VA&travelmode=driving');
    expect(crewMapsUrl('', 'Norfolk')).toBe('');
    expect(crewMapsUrl('  ', 'Norfolk')).toBe('');
  });

  it('the page has exactly one maps builder, and the old place-search link is gone', () => {
    expect(html.match(/function crewMapsUrl\(/g)).toHaveLength(1);
    expect(html.match(/google\.com\/maps/g)).toHaveLength(1);
    expect(html).not.toContain('maps.google.com');
  });

  it('every card carries exactly one Navigate, a link straight to Maps, and the address opens the same place', async () => {
    const v = await render([WO(1), WO(2, { city: 'Norfolk' })]);
    const cards = v.kids.filter((k) => k.className === 'wo');
    expect(cards).toHaveLength(2);
    for (const [i, card] of cards.entries()) {
      const navs = card.all().filter((n) => n.className === 'navbtn');
      expect(navs, `card ${i + 1}`).toHaveLength(1);
      const nav = navs[0]!;
      expect(nav.tag).toBe('a');
      expect(nav.textContent).toBe('Navigate');
      expect(nav.href).toBe(crewMapsUrl(`${i + 1}01 Simulation Row`, i === 0 ? 'Virginia Beach' : 'Norfolk'));
      expect(nav.target).toBe('_blank');
      expect(nav.rel).toBe('noopener');
      const addr = card.all().find((n) => n.tag === 'a' && n.className === '')!;
      expect(addr.href).toBe(nav.href);
    }
  });

  it('a stop with no street gets no route: Navigate is off and says why', async () => {
    const v = await render([WO(1, { address: '' })]);
    const card = v.kids.find((k) => k.className === 'wo')!;
    const nav = card.all().find((n) => n.className === 'navbtn')!;
    expect(nav.tag).toBe('button');
    expect(nav.disabled).toBe(true);
    expect(card.text()).toContain('No street on file — ask the office for the address.');
    expect(card.all().some((n) => n.tag === 'a')).toBe(false);
  });

  it('R26: in the preview Navigate is drawn but off, and the card carries the preview’s reason', async () => {
    const v = await render([WO(1)], true);
    const card = v.kids.find((k) => k.className === 'wo')!;
    const nav = card.all().find((n) => n.className === 'navbtn')!;
    expect(nav.tag).toBe('button');
    expect(nav.disabled).toBe(true);
    expect(nav.href).toBe('');
    expect(card.kids.filter((k) => k.className === 'preview-why').map((k) => k.textContent)).toEqual(['Off in the preview — nothing here signs, files or clocks in.']);
  });

  it('no sheet and no dialog: the page never asks "Open in Google Maps?" and calls no prompt(), confirm() or alert()', () => {
    expect(html).not.toContain('Open in Google Maps?');
    expect(html).not.toMatch(/\b(prompt|confirm|alert)\(/);
  });

  it('Navigate is a field-sized target', () => {
    expect(html).toMatch(/\.navbtn\{[^}]*min-height:52px/);
  });
});

describe('C2 — arrival and extra work are off until real job records exist, with the reason, on the phone and in the preview', () => {
  const crewMapsUrl = (a: string, c: string) => lift<(a: string, c: string) => string>('crewMapsUrl', {})(a, c);
  const REASON = 'No job record yet — tell the office what you found.';
  const WHY = 'Off in the preview — nothing here signs, files or clocks in.';
  const wo = { jobId: 'sim-job-1', routeOrder: 1, address: '101 Simulation Row', city: 'Virginia Beach', timeIso: null, scope: null, hazards: [], permitNote: null, photoRefs: [], briefingId: null, requiresBeforeAfterPhotos: true };
  const card = async (preview: boolean) => {
    const v = new Node1('div');
    let sent = 0;
    const deps = { el: el1, PREVIEW: preview, api: async () => { sent += 1; return {}; }, CREW_ID: 'x' };
    await lift<() => Promise<void>>('renderWork', {
      $: () => v, el: el1, document: doc1, GATE: { unlocked: !preview }, PREVIEW: preview, PREVIEW_WHY: WHY,
      api: async () => ({ workOrders: [wo], notWorkOrders: 0, contractLookupFailed: false }), fmtTime: () => '',
      arrivalButton: lift('arrivalButton', deps), changeOrderButton: lift('changeOrderButton', deps), crewMapsUrl,
      LINKS_READY: Promise.resolve(), crewWhy: crewWhyAt('simulation'),
    })();
    return { c: v.kids.find((k) => k.className === 'wo')!, sent: () => sent };
  };

  for (const preview of [false, true]) {
    it(`${preview ? 'preview' : 'crew phone'}: both buttons off, the reason once on the card${preview ? ', and the preview line' : ''}`, async () => {
      const { c, sent } = await card(preview);
      const jobs = c.all().filter((n) => n.className === 'jobbtn');
      expect(jobs.map((b) => b.textContent)).toEqual(['📷 Log arrival condition', '+ Extra work agreed']);
      expect(jobs.every((b) => b.disabled)).toBe(true);
      // Nothing is wired to a tap: a switched-off button cannot send.
      expect(jobs.every((b) => Object.keys(b.listeners).length === 0)).toBe(true);
      expect(c.kids.filter((k) => k.className === 'jobwhy').map((k) => k.textContent)).toEqual([REASON]);
      expect(c.kids.filter((k) => k.className === 'preview-why').map((k) => k.textContent)).toEqual(preview ? [WHY] : []);
      expect(sent()).toBe(0);
    });
  }

  it('the senders stay for the forms to come, and nothing calls them while the buttons are off', () => {
    for (const name of ['sendArrival', 'sendChangeOrder']) {
      expect(html.match(new RegExp(`\\b${name}\\(`, 'g')), name).toHaveLength(1); // its definition, nothing else
    }
  });

  it('the photo line promises no close flow the app lacks', () => {
    expect(html).toContain('Before + after photos are required — the app can’t take them yet; ask the office how to send them.');
    expect(html).not.toContain('required to close this job');
  });
});
