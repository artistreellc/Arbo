// QA polish round 2 — Queue, Numbers and Book (package queue-numbers-book).
// vitest has no DOM, so copy and wiring are source pins, one function at a
// time. The pieces with real logic (the arm-twice button, the disclosure, the
// status tables, the server's blind-spot words, the line builders) are lifted
// out or called and run against plain stand-ins.
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';
import { createApi } from '../src/server/api.js';
import { createSimSource } from '../src/dev/simSource.js';
import { findCertProblems } from '../src/safety/certifications.js';
import { buildCampaignReport } from '../src/ops/areaPerformance.js';

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

// One top-level function out of the page (it closes with a "}" alone on its
// line), built with stand-ins for every outside name it reaches for.
function pageFn<T>(name: string, deps: Record<string, unknown> = {}): T {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return new Function(...Object.keys(deps), `${m[0]}\nreturn ${name};`)(...Object.values(deps)) as T;
}

/** A top-level `const NAME = { … };` table, evaluated. */
function pageTable(name: string): Record<string, [string, string]> {
  const m = new RegExp(`^const ${name} = (\\{[\\s\\S]*?^\\});`, 'm').exec(html);
  if (!m) throw new Error(`no table ${name} in the page`);
  return new Function(`return ${m[1]};`)() as Record<string, [string, string]>;
}

const prep = () => between('function estimatePrepPanel()', 'async function renderBook()');
const book = () => between('async function renderBook()', '// The twin sheet');
const twin = () => between('async function openTwin(', "$('twin-close')");
const safety = () => between('async function renderSafety(', '// ---------- Roster');
const roster = () => between('async function renderRosterList(', '// A one-way action asks twice');
const helpers = () => between('// A one-way action asks twice', 'function certAdder(');
const certAdder = () => between('function certAdder(', 'function rosterComposer(');
const rosterComposer = () => between('function rosterComposer(', '// ---------- Training board');
const training = () => between('async function renderTrainingBoard(', '// ---------- Performance');
const perf = () => between('async function renderPerformance(', 'function renderCampaignList(');
const campaigns = () => between('function renderCampaignList(', 'async function refreshCampaignList(');
const composer = () => between('function campaignComposer(', 'function areaCard(');
const area = () => between('function areaCard(', '// ---------- Vetting queue');
const vetting = () => between('async function renderVetting(', '// ---------- Reference library');
const libQueue = () => between('async function renderLibraryQueue(', 'function libraryComposer(');
const libComposer = () => between('function libraryComposer(', '// ---------- Money');
const money = () => between('async function renderMoney(', 'function paidButton(');
const fleet = () => between('async function renderFleetList(', '// A part that fits this unit');
const partAdder = () => between('function partAdder(', 'function fleetComposer(');
const fleetComposer = () => between('function fleetComposer(', 'let BREAKDOWN_UNIT = null;');
const breakdown = () => between('let BREAKDOWN_UNIT = null;', '// ---------- Follow-ups');
const queue = () => between('async function renderFollowUps(', '// ---------- Shell');

/** Every function this package owns on the page. */
const owned = () => [prep(), book(), twin(), safety(), roster(), helpers(), certAdder(), rosterComposer(), training(),
  perf(), campaigns(), composer(), area(), vetting(), libQueue(), libComposer(), money(), fleet(), partAdder(),
  fleetComposer(), breakdown(), queue()];

describe('Q0 — chips speak one tone table', () => {
  it('no legacy badge(…, b-*) call is left in Queue, Numbers or Book', () => {
    for (const body of owned()) {
      expect(body).not.toMatch(/\bbadge\(/);
      expect(body).not.toMatch(/'b-(emg|flag|warm|hot|src|cool|verify|pending|repeat|permit-likely|review|est|job|first)'/);
    }
  });

  it('every status table maps to a tone, never a b-* class', () => {
    const tones = new Set(['alarm', 'stop', 'watch', 'good', 'info']);
    const expected: Record<string, Record<string, [string, string]>> = {
      CERT_STATE: {
        lapsed: ['EXPIRED', 'stop'], missing: ['NO RECORD', 'stop'], unknown: ['NO EXPIRY DATE', 'watch'],
        urgent: ['EXPIRES SOON', 'watch'], upcoming: ['RENEWAL DUE', 'info'],
      },
      VERDICT_LABEL: {
        above: ['ABOVE AVERAGE', 'good'], at: ['AT AVERAGE', 'info'], below: ['BELOW AVERAGE', 'watch'],
        not_enough_data: ['NOT ENOUGH DATA', 'info'],
      },
      STAGE_LABEL: {
        reminder: ['PAST DUE', 'watch'], second_notice: ['SECOND NOTICE', 'watch'], final_notice: ['FINAL — CALL THEM', 'stop'],
      },
      // R26: HELD (brake/steering, off the schedule until Mike signs it back on) is a stop, like DOWN.
      UNIT_STATUS: { up: ['UP', 'good'], down: ['DOWN', 'stop'], maintenance: ['NEEDS ATTENTION', 'watch'], held: ['HELD', 'stop'] },
      FU_LABEL: {
        estimate_follow_up: ['FOLLOW-UP', 'watch'], review_request: ['REVIEW ASK', 'info'], no_show_saver: ['NO-SHOW SAVE', 'watch'],
        seasonal_outreach: ['SEASONAL', 'info'], growth_outreach: ['COMING DUE', 'info'],
      },
    };
    for (const [name, table] of Object.entries(expected)) {
      const got = pageTable(name);
      expect(got, name).toEqual(table);
      for (const [, tone] of Object.values(got)) expect(tones.has(tone), `${name}: ${tone}`).toBe(true);
    }
  });

  it('life-safety chips are the alarm tone, and nothing else here is', () => {
    // Pins moved (R27 Phase A, owner app b), meaning kept: the same words and tones, now said through the runtime (T/tf/tn, and esSay for a safety label).
    expect(safety()).toContain("esSay(chip('', 'alarm'), 'NO AERIAL WORK')");
    expect(book()).toContain("esSay(chip('', 'alarm'), 'POWER LINES')");
    expect(twin()).toContain("esSay(chip('', 'alarm'), 'POWER LINES')");
    expect(book()).toContain("esSay(chip('', 'stop'), 'STRUCTURES')");
    expect(twin()).toContain("esSay(chip('', 'stop'), 'STRUCTURES')");
    const alarms = owned().join('\n').match(/'alarm'\)/g) ?? [];
    expect(alarms).toHaveLength(3); // NO AERIAL WORK, POWER LINES on the list and on the twin sheet
  });

  it('the rest of the chips carry the tone the word list gives them', () => {
    // Pins moved (R27 Phase A, owner app b), meaning kept: the same words and tones, now said through the runtime (T/tf/tn, and esSay for a safety label).
    for (const pin of ["chip(T('NEVER TESTED'), 'stop')", "chip(T('WEEK UNKNOWN'), 'watch')", "chip(T('WEEK DONE'), 'good')",
      "chip(T('OWES THIS WEEK'), 'watch')"]) expect(training()).toContain(pin);
    expect(roster()).toContain("chip(role(p.role).toUpperCase(), CREW_ROLES.indexOf(p.role) === -1 ? 'watch' : 'info')");
    expect(roster()).toContain("chip(T('OFF ROSTER'), 'info')");
    expect(roster()).toContain("p.certCount === null ? 'watch' : 'info'");
    expect(area()).toContain("chip(mix, 'info')");
    expect(money()).toContain("chip(money(inv.amount), 'info')");
    expect(money()).toContain("chip(tf('+{fee} LATE FEE ({pct}% CAP)', { fee: money(inv.lateFeeOwed), pct: inv.lateFeePct }), 'watch')");
    for (const pin of ["chip(T('NOT SCHEDULABLE'), 'stop')", "chip(tn(u.openTasks, '{n} open task', '{n} open tasks'), 'watch')",
      "chip(T('SIZE UNKNOWN — ROUTED CONSERVATIVELY'), 'watch')"]) expect(fleet()).toContain(pin);
    expect(queue()).toContain("chip(T('+ PROOF OF INSURANCE'), 'info')");
    expect(book()).toContain("chip(d.state === 'overdue' ? T('OVERDUE') : T('DUE NOW'), 'watch')");
    expect(book()).toContain("chip(p.due.state === 'overdue' ? T('OVERDUE') : T('COMING DUE'), 'watch')");
    // R26 (qa-x6): the twin's permit chip is the one label per permit state (PERMIT_STATE via permitChip) — said through
    // the safety pair (permitLabel, R27).
    for (const pin of ['b.appendChild(permitLabel(permitChip(pr.screen_status)));', "chip(T('IN RPA'), 'watch')"]) expect(twin()).toContain(pin);
    expect(twin()).not.toContain("chip('REVIEW NEEDED'");
  });
});

describe('Q1 — a failed read has one title shape: "X — <feed word>"', () => {
  it('no "… unavailable" state title is left in these functions', () => {
    for (const body of owned()) expect(body).not.toMatch(/state\('[^']*unavailable'/);
    for (const gone of ['Fleet status unknown', 'Campaign data unavailable', 'Could not load this property']) {
      expect(html).not.toContain(gone);
    }
  });

  it('each panel title names the gap with the shared feed word, after /health answers', () => {
    const titled: Array<[() => string, string]> = [
      [safety, 'Safety board'], [roster, 'Roster'], [training, 'Training board'], [perf, 'Numbers'],
      [vetting, 'Draft queue'], [libQueue, 'Library drafts'], [money, 'Ledger'], [fleet, 'Fleet'],
    ];
    for (const [body, what] of titled) {
      const b = body();
      expect(b, what).toContain(`state('${what} — ' + FEED_WORD[feedKind(e)], e.code === 503\n      ? feedSays(e) + ' Arbo cannot `);
      // 'cut' or 'not set up' depends on the links, so the title waits for them.
      expect(b.indexOf('await LINKS_READY;'), what).toBeGreaterThan(-1);
      expect(b.indexOf('await LINKS_READY;'), what).toBeLessThan(b.indexOf(`'${what} — '`));
    }
    // Pin moved (R27 Phase A, owner app c), meaning kept: the same title shape, "Campaigns — <feed word>", one template.
    expect(campaigns()).toContain("state(tf('Campaigns — {state}', { state: FEED_WORD.unread }),");
  });

  it('the twin sheet names a failed read in the shared words and sends a lost key to the keywall', () => {
    const t = twin();
    // The sheet is a back step (Mike, 2026-10-20): a lost key steps back past it, then the keywall.
    expect(t).toContain("if (e.code === 401) { closeSheet('twin'); return showKeywall(); }");
    // Pin moved (D113), meaning kept: es-owner-a translated the shared §1B words, so the same call now keys its words (T).
    expect(t).toContain("feedState(e, T('This property'), T('a property with no history'), T('Close this and tap the property again.'))");
    expect(t.indexOf('await LINKS_READY;')).toBeLessThan(t.indexOf("feedState(e, T('This property')"));
  });
});

describe('Q2 — the safety board has its own heading and words its blind spots', () => {
  it('a heading leads the board, and it never doubles the clean-board title', () => {
    const s = safety();
    // Pin moved (R27 Phase A, owner app b), meaning kept: the same heading, said through the runtime.
    const head = "if (s.blindSpots.length || s.aerialBlocked.length) slot.appendChild(el('div', 'panel-title', s.aerialBlocked.length ? tf('Safety — {n} cannot go aerial', { n: s.aerialBlocked.length }) : T('Safety')));";
    expect(s).toContain(head);
    expect(s.indexOf(head)).toBeLessThan(s.indexOf('for (const b of s.blindSpots) {'));
    // The clean title only draws with no blind spots (and no cert problems, which aerialBlocked implies).
    expect(s).toContain("if (!s.blindSpots.length && !s.certProblems.length && !openNm.length) {");
    expect(s).toContain("tn(s.aerialBlocked.length, '{n} crew member cannot be put on aerial work', '{n} crew members cannot be put on aerial work')");
    expect(s).not.toContain('crew member(s)');
  });

  it('in the practice data a missing feed is "not in the practice data", never machine text', async () => {
    const api = createApi(createSimSource(), { dataLinksSim: true });
    const res = await api.safety();
    expect(res.status).toBe(200);
    const spots = (res.body as { blindSpots: string[] }).blindSpots;
    expect(spots.length).toBeGreaterThan(0);
    for (const b of spots) {
      expect(b).toMatch(/not in the practice data/);
      expect(b).not.toMatch(/no source wired|near_miss|certifications:/);
    }
    expect(spots.join(' ')).toMatch(/^Near misses — not in the practice data\. Arbo cannot check whether every incident has a lesson\.$/m);
  });

  it('outside the practice data an absent source is "not connected yet", and a failed read says so', async () => {
    const bare = { ready: () => true } as unknown as Parameters<typeof createApi>[0];
    const spots = ((await createApi(bare).safety()).body as { blindSpots: string[] }).blindSpots;
    expect(spots).toEqual([
      'Certifications — not connected yet. Arbo cannot check who is current.',
      'Near misses — not connected yet. Arbo cannot check whether every incident has a lesson.',
    ]);
    const failing = {
      ready: () => true,
      activeCrew: async () => { throw new Error('db down'); },
      certifications: async () => [],
      recentNearMisses: async () => { throw new Error('db down'); },
    } as unknown as Parameters<typeof createApi>[0];
    const failed = ((await createApi(failing).safety()).body as { blindSpots: string[] }).blindSpots;
    for (const b of failed) {
      expect(b).toMatch(/^(Certifications|Near misses) — could not read /);
      expect(b).not.toMatch(/near_miss|certifications:/);
    }
  });

  it('the training board words a missing completions source the same way', async () => {
    const src = { ready: () => true, crewProfiles: async () => [] } as unknown as Parameters<typeof createApi>[0];
    const spots = async (sim: boolean) =>
      ((await createApi(src, { dataLinksSim: sim }).trainingBoard()).body as { blindSpots: string[] }).blindSpots;
    expect(await spots(true)).toContain('Weekly completions — not in the practice data. Arbo cannot tell who finished this week.');
    expect(await spots(false)).toContain('Weekly completions — not connected yet. Arbo cannot tell who finished this week.');
    for (const b of [...await spots(true), ...await spots(false)]) expect(b).not.toMatch(/no source wired/);
  });

  it('a dead open-loops feed is one line, so the safety stop leads the first screen', () => {
    const q = queue();
    // Pin moved (R27 Phase A, owner app b; again in D113), meaning kept: the same one line — the shared feed words are in the
    // page's language now (es-owner-a), so its words are keyed and nothing is marked English.
    expect(q).toContain("loopsSlot.appendChild(feedLine(e, T('Open loops'), T('That is not a sign that nothing is open.')));");
    expect(q).not.toContain("feedState(e, 'Open loops'");
  });
});

describe('Q3 — an invoice Arbo cannot date says whose and how much', () => {
  it('unknowns get their own heading, the customer and the amount', () => {
    const m = money();
    // Pins moved (R27 Phase A, owner app b), meaning kept: the same heading and name, said through the runtime.
    expect(m).toContain("slot.appendChild(el('div', 'panel-title', tf('Can’t tell if overdue — {n}', { n: m.unknown.length })));");
    expect(m).toContain('const inv = m.invoices.find((i) => i.id === u.invoiceId);');
    expect(m).toContain("top.appendChild(el('div', 'who', (inv && inv.name) || T('Unknown')));");
    expect(m).toContain("if (inv) top.appendChild(el('div', 'when', money(inv.amount)));");
    // Filed apart from 'Cannot bill yet', after it.
    expect(m.indexOf("'Can’t tell if overdue — {n}'")).toBeGreaterThan(m.indexOf("'Cannot bill yet — {n}'"));
  });

  it('a blocked job shows its customer as the serif name, not a grey kicker', () => {
    const m = money();
    const blocked = m.slice(m.indexOf('for (const x of m.blocked)'), m.indexOf("'Can’t tell if overdue — {n}'"));
    expect(blocked).toContain("top.appendChild(el('div', 'who', x.name || T('Unknown')));"); // pin moved (R27): the fallback through T
    expect(blocked).not.toContain("'loop-kind', x.name");
  });
});

describe('Q4 — one-way actions look different and ask twice', () => {
  it('the danger style sits right after the done style', () => {
    const done = html.indexOf('.actbtn.done{');
    const danger = html.indexOf('.actbtn.danger{background:var(--card);color:var(--emergency);border:1px solid color-mix(in srgb,var(--emergency) 45%,transparent);box-shadow:none}');
    expect(danger).toBeGreaterThan(done);
    expect(html.slice(done, danger).split('\n')).toHaveLength(2); // the very next line
    expect(html).toContain('.actbtn.danger.armed{background:var(--emergency-bg)}');
  });

  type Btn = { textContent: string; cls: Set<string>; classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean }; addEventListener(t: string, fn: () => void): void; click(): void };
  const makeBtn = (text: string): Btn => {
    const cls = new Set<string>();
    let handler: () => void = () => {};
    return {
      textContent: text, cls,
      classList: { add: (c) => cls.add(c), remove: (c) => { cls.delete(c); }, contains: (c) => cls.has(c) },
      addEventListener: (_t, fn) => { handler = fn; },
      click: () => handler(),
    };
  };
  const clock = () => {
    const timers = new Map<number, () => void>();
    let next = 1;
    return {
      timers,
      setTimeout: (fn: () => void) => { timers.set(next, fn); return next++; },
      clearTimeout: (id: number) => { timers.delete(id); },
    };
  };

  it('the first tap arms and says what it will do; the second does it and restores the label', () => {
    const c = clock();
    const armTwice = pageFn<(b: Btn, armed: string, run: () => void) => void>('armTwice', { setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
    const btn = makeBtn('Retire this unit');
    let ran = 0;
    armTwice(btn, 'Tap again to retire SIM Chipper', () => { ran++; });
    btn.click();
    expect(ran).toBe(0);
    expect(btn.cls.has('armed')).toBe(true);
    expect(btn.textContent).toBe('Tap again to retire SIM Chipper');
    btn.click();
    expect(ran).toBe(1);
    expect(btn.cls.has('armed')).toBe(false);
    expect(btn.textContent).toBe('Retire this unit');
    expect(c.timers.size).toBe(0); // the disarm timer was cancelled
  });

  it('left alone, it disarms and the next tap only arms again', () => {
    const c = clock();
    const armTwice = pageFn<(b: Btn, armed: string, run: () => void) => void>('armTwice', { setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
    const btn = makeBtn('Take off the roster');
    let ran = 0;
    armTwice(btn, 'Tap again', () => { ran++; });
    btn.click();
    for (const fn of c.timers.values()) fn(); // 4 seconds pass
    expect(btn.cls.has('armed')).toBe(false);
    expect(btn.textContent).toBe('Take off the roster');
    btn.click();
    expect(ran).toBe(0);
    expect(btn.cls.has('armed')).toBe(true);
    expect(helpers()).toContain('}, 4000);');
  });

  it('take off the roster and retire this unit use it, in the danger style', () => {
    const r = roster();
    // Pins moved (R27 Phase A, owner app b), meaning kept: the same words and style, said through the runtime.
    expect(r).toContain("const off = el('button', 'actbtn danger', T('Take off the roster'));");
    // QA round 3: the armed line never promises the door closes. Deliberately
    // updated (CREW_PLAN C3, D109): the paid crew routes now check the roster, so
    // "Their crew code still opens the crew door." is gone — and no closed door is promised.
    expect(r).toContain("armTwice(off, tf('Tap again to take {name} off the roster — the safety and training boards stop counting them.', { name: p.name }), async () => {");
    expect(r).not.toMatch(/lose crew-door access|can no longer open/);
    const f = fleet();
    expect(f).toContain("const off = el('button', 'actbtn danger', T('Retire this unit'));");
    expect(f).toContain("armTwice(off, tf('Tap again to retire {name}', { name: u.name }), async () => {");
    for (const body of [r, f]) expect(body).not.toContain("off.addEventListener('click'");
  });
});

describe('Q5 — admin forms fold away, and the sends come right after safety', () => {
  it('disclose wraps a node under one summary line with the shared chevron', () => {
    const made: Array<{ tag: string; cls: string; text?: string; kids: unknown[]; appendChild(n: unknown): unknown }> = [];
    const el = (tag: string, cls: string, text?: string) => {
      const n = { tag, cls, text, kids: [] as unknown[], appendChild(k: unknown) { this.kids.push(k); return k; } };
      made.push(n);
      return n;
    };
    const disclose = pageFn<(label: string, node: unknown) => typeof made[number]>('disclose', { el });
    const inner = { form: true };
    const d = disclose('Add a unit to the fleet', inner);
    expect(d.tag).toBe('details');
    expect(d.cls).toBe('agent-law');
    expect(d.kids[0]).toMatchObject({ tag: 'summary', text: 'Add a unit to the fleet' });
    expect(d.kids[1]).toBe(inner);
  });

  it('every per-card form and composer returns folded, so the pinned callers stay as they are', () => {
    // Pins moved (R27 Phase A, owner app b), meaning kept: each still folds under its name, said through T.
    expect(certAdder()).toContain("return disclose(T('Record / renew a card'), wrap);");
    expect(partAdder()).toContain("return disclose(T('Add a part that fits this unit'), wrap);");
    expect(rosterComposer()).toContain("return disclose(T('Add someone to the roster'), c);");
    expect(libComposer()).toContain("return disclose(T('Write a new library entry'), c);");
    expect(fleetComposer()).toContain("return disclose(T('Add a unit to the fleet'), c);");
    // The summary is the form's name now; no second kicker repeats it inside.
    for (const gone of ["'loop-kind', 'Add somebody to the roster'", "'loop-kind', 'Write a new entry'", "'loop-kind', 'Add a unit to the fleet'"]) {
      expect(html).not.toContain(gone);
    }
  });

  it('the card date says which date it wants, and placeholders fit their box', () => {
    const c = certAdder();
    // Pins moved (R27 Phase A, owner app b), meaning kept: the same words, said through T.
    expect(c).toContain("exp.setAttribute('aria-label', T('Expires on'));");
    expect(c).toContain("const expLabel = el('label', '', T('Expires on'));");
    expect(c).toContain('expLabel.htmlFor = exp.id;');
    expect(c.indexOf('wrap.appendChild(expLabel);')).toBeLessThan(c.indexOf('wrap.appendChild(exp);'));
    expect(partAdder()).toContain("fit.placeholder = T('Also fits (optional)');");
    expect(libComposer()).toContain("add('standardRefs', T('Clause refs, e.g. Z133 §8.1'));");
    expect(html).not.toContain('Clause citations, comma separated');
    expect(html).not.toContain('Also fits — e.g. both chippers');
  });

  it('recommended sends get their own slot right after the open loops (Direction B P13: safety leads its own desk)', () => {
    const q = queue();
    const loopsAt = q.indexOf('v.appendChild(loopsSlot);');
    const slotAt = q.indexOf("const fuSlot = el('div');\n  v.appendChild(fuSlot);");
    expect(loopsAt).toBeGreaterThan(-1);
    expect(slotAt).toBeGreaterThan(loopsAt);
    // The safety board still leads, on Crew & safety: its first panel, before the roster.
    const safety = html.slice(html.indexOf('function renderSafetyView('), html.indexOf('// ---------- Shell'));
    expect(safety.indexOf("['queue-safety', renderSafety]")).toBeGreaterThan(-1);
    expect(safety.indexOf("['queue-safety', renderSafety]")).toBeLessThan(safety.indexOf('[null, renderRoster]'));
    // Pins moved (R27 Phase A, owner app b), meaning kept: the same slot and heading (said through T), the same dead-feed card
    // (marked "en inglés" in Spanish — the shared feed words).
    const sends = q.slice(q.indexOf("fuSlot.appendChild(el('div', 'panel-title', T('Recommended sends')));"));
    expect(sends.length).toBeGreaterThan(0);
    expect(sends.startsWith("fuSlot.appendChild(el('div', 'panel-title', T('Recommended sends')));")).toBe(true);
    // Pin moved (D113): the same dead-feed card, its words keyed — the shared feed words are in the page's language now.
    expect(sends).toContain("fuSlot.appendChild(feedState(e, T('Follow-ups'), T('an empty queue')));");
    expect(sends).not.toContain('v.appendChild(');
    // Every stale-render guard is still there.
    expect(q.match(/gen !== FU_GEN/g)).toHaveLength(2);
  });
});

describe('Q6 — counts and dates read like a person wrote them', () => {
  it('no "(s)" count, spec code or "lvl" left in the copy', () => {
    for (const body of owned()) {
      const copy = body.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
      // A word with '(s)' stuck on ('day(s) ago'), not a call like appendChild(s); 'http(s)' is a scheme.
      expect(copy.replace(/http\(s\)/g, '')).not.toMatch(/[A-Za-z]\(s\)[ .,'’]/);
      expect(copy).not.toMatch(/\(§\d|'lvl /);
    }
    // Pins moved (R27 Phase A, owner app b), meaning kept: a level and a count said as one keyed sentence, a real plural each.
    expect(roster()).toContain("tf('level {n}', { n: p.competencyLevel })");
    expect(roster()).toContain("plural(p.certCount, 'card') + ' on file'");
    expect(roster()).toContain("tn(p.certCount, '{n} card on file', '{n} cards on file')");
    expect(libComposer()).toContain("tn(res.refsDropped, '{n} citation was dropped for not being a clause reference.', '{n} citations were dropped for not being a clause reference.')");
    expect(breakdown()).toContain("'Arbo never places the order and holds no card — you click, you buy.'");
  });

  it('the fleet heading counts in words, and a unit off the schedule leads the list', () => {
    const f = fleet();
    // R26: DOWN and HELD both count against "all units schedulable".
    // Pins moved (R27 Phase A, owner app b), meaning kept: down and held each counted in words, both said together, and
    // "all units schedulable" only when neither is on the list — one keyed sentence per case.
    expect(f).toContain("const down = f.down > 0 ? tn(f.down, '{n} unit down', '{n} units down') : '';");
    expect(f).toContain("const held = f.held > 0 ? tn(f.held, '{n} unit held', '{n} units held') : '';");
    expect(f).toContain("down && held ? tf('Fleet — {down}, {held}', { down, held }) : down || held ? tf('Fleet — {off}', { off: down || held }) : T('Fleet — all units schedulable')");
    expect(f).toContain('for (const u of [...f.units].sort((a, b) => (!b.schedulable) - (!a.schedulable))) {');
    const units = [{ n: 'a', schedulable: true }, { n: 'b', schedulable: false }, { n: 'c', schedulable: true }, { n: 'd', schedulable: false }];
    const sorted = [...units].sort((a, b) => Number(!b.schedulable) - Number(!a.schedulable)).map((u) => u.n);
    expect(sorted).toEqual(['b', 'd', 'a', 'c']); // stable: server order kept inside each group
  });

  it('a lapsed card says how long ago, in the stop colour', () => {
    const s = safety();
    expect(s).toContain("lapsed ? tn(-f.daysUntil, '{n} day ago', '{n} days ago') : tf('{n}d', { n: f.daysUntil })"); // pin moved (R27)
    expect(s).toContain("if (lapsed) when.style.color = 'var(--emergency)';");
    expect(s).toContain("top.appendChild(el('div', 'when', fmtWhen(n.occurredOn)));");
  });

  it('the credential lines count days properly', () => {
    const crew = [{ id: 'c1', name: 'SIM-A', role: 'groundie', active: true }];
    const certs = (first: string, cpr: string) => [
      { id: 'x1', crewMemberId: 'c1', type: 'first_aid' as const, expiresOn: first },
      { id: 'x2', crewMemberId: 'c1', type: 'cpr' as const, expiresOn: cpr },
    ];
    const lines = (a: string, b: string) => findCertProblems(crew, certs(a, b), '2026-10-18').map((f) => f.line);
    expect(lines('2026-10-17', '2026-09-29')).toEqual([
      'CPR EXPIRED 19 days ago — this is not a reminder, it is a stop.',
      'First aid EXPIRED 1 day ago — this is not a reminder, it is a stop.',
    ]);
    expect(lines('2026-10-19', '2026-11-30')).toEqual([
      'First aid expires in 1 day — book the renewal now.',
      'CPR expires in 43 days.',
    ]);
    for (const l of lines('2026-10-17', '2026-10-25')) expect(l).not.toContain('(s)');
  });

  it('the twin sheet shows dates the one human way', () => {
    const t = twin();
    expect(t).not.toContain('toLocaleDateString');
    // Pins moved (R27 Phase A, owner app b), meaning kept: the same day, the value of one keyed sentence each.
    expect(t).toContain("(it.when ? fmtWhen(it.when) || String(it.when) : T('unscheduled'))");
    expect(t).toContain("const day = (v) => (/^\\d{4}-\\d{2}-\\d{2}$/.test(String(v)) ? fmtWhen(v) : v);");
    expect(t).toContain("tf('Last serviced {day}', { day: day(tr.last_service_date) })");
    expect(t).toContain("tf('Typically ready for another look around {day}', { day: day(tr.next_due_forecast) })");
  });
});

describe('Q7 — the Book never dresses a dead screen as a help tip', () => {
  it('a missing address is an error line, and a failed prep read is a named feed', () => {
    const p = prep();
    // Pins moved (R27 Phase A, owner app b), meaning kept: the same lines and looks, said through T.
    expect(p).toContain("out.replaceChildren(el('div', 'errline', T('Address is required.')))");
    expect(p).toContain("out.appendChild(el('div', 'feed-state ' + feedKind(e), T('Prep sheet unavailable right now — nothing was screened.')));");
    expect(p).not.toContain("'storm-muted', 'Prep sheet unavailable");
    const c = p.slice(p.indexOf('} catch (e) {'));
    expect(c.indexOf("go.disabled = false; go.textContent = T('Build prep sheet');")).toBeLessThan(c.indexOf('if (e.code === 401) return showKeywall();'));
    expect(c.indexOf('if (e.code === 401) return showKeywall();')).toBeLessThan(c.indexOf('await LINKS_READY;'));
    expect(c.indexOf('await LINKS_READY;')).toBeLessThan(c.indexOf("'feed-state ' + feedKind(e)"));
    // The intro stays a help tip, and the Book's own dead feed stays the dashed card.
    // Direction B P15 review: the intro is Estimate's head line now (said once, above the form), still plain help text;
    // the Book is "Properties on file", and its dead feed says that name.
    // Pin moved (R27 Phase A, owner app b), meaning kept: the same two sentences in one plain help line — the first names 811,
    // so it is said through the safety pair (esSay), the second through T.
    const est = between('async function renderEstimate()', 'function estimatePrepPanel()');
    expect(est).toContain("const lede = head.appendChild(esSay(el('p'), 'Start with the address: permit, drive time, 811 and access.'));");
    expect(est).toContain("lede.appendChild(document.createTextNode(' ' + T('Never a price, never a booking.')));");
    expect(p).not.toContain("'feed-state', 'Permit check");
    // Pin moved (D113), meaning kept: es-owner-a translated the shared §1B words, so the same call now keys its words (T).
    expect(book()).toContain("feedState(e, VIEW_TITLES.book, T('an empty list'))");
  });

  it('the property counts read as real plurals', () => {
    // Pin moved (R27 Phase A, owner app b), meaning kept: three real plurals, each its own count.
    expect(book()).toContain("chip(tn(j, '{n} job', '{n} jobs') + ' · ' + tn(est, '{n} estimate', '{n} estimates') + ' · ' + tn(tr, '{n} tree', '{n} trees'), 'info')");
  });
});

describe('Q8 — Numbers polish', () => {
  it('a campaign label is tied to its box', () => {
    const k = composer();
    expect(k).toContain("n.id = 'cmp-' + label.toLowerCase().replace(/\\W+/g, '-');");
    expect(k).toContain("const lab = el('label', '', label);");
    expect(k).toContain('lab.htmlFor = n.id;');
    expect(k).toContain("n.setAttribute('aria-label', label);");
  });

  it('an unrated card keeps its title on one line: no sample suffix on the rate', () => {
    const a = area();
    expect(a).not.toContain('-job sample');
    // Pin moved (R27 Phase A, owner app c), meaning kept: the rate with no sample suffix, the amount a slot of its template.
    expect(a).toContain("tf('{amount}/crew-hr', { amount: dollars(a.normalizedRatePerCrewHour) }));");
  });

  it('the campaign line does not repeat the per-job headline', () => {
    const r = buildCampaignReport([{ id: 'c1', type: 'flyer', cost: 400, bookedJobs: 2, attributionWired: true }])[0]!;
    expect(r.line).toBe('$400 spent · 2 booked jobs.');
    expect(r.line).not.toContain('$200');
    expect(r.costPerBookedJob).toBe(200);
    // Pin moved (R27 Phase A, owner app c), meaning kept: the per-job headline once, the amount a slot of its template.
    expect(campaigns()).toContain("tf('{amount} per booked job', { amount: dollars(c.costPerBookedJob) })");
  });

  it('explanation lines are help text, and the window line is one sentence with no separators', () => {
    const p = perf();
    expect(p).not.toContain("'zip-run'");
    // Pin moved (R27 Phase A, owner app c), meaning kept: the same help-text lines through T; the window line is still one
    // sentence, now one template per case — the count (one or many), the window and when it was checked are slots.
    for (const line of ["el('div', 'storm-muted', p.windowDays === 365",
      "el('div', 'storm-muted', T('Ranked by revenue per crew-hour",
      "el('div', 'storm-muted', T('These are unmeasured, not underperforming"]) expect(p).toContain(line);
    expect(p).toContain("tn(counted, 'Paid, completed jobs in the last {days} days: {n} job.', 'Paid, completed jobs in the last {days} days: {n} jobs.', { days: p.windowDays })");
    expect(p).toContain("const when = p.checkedAtIso ? fmtWhen(p.checkedAtIso) : '';");
    expect(p).toContain("'Paid, completed jobs in the last 12 months: {n} job, checked {when}.'");
    const window = p.slice(p.indexOf("const when = p.checkedAtIso"), p.indexOf('// §1B: what the numbers cannot see'));
    expect(window).toContain('Paid, completed jobs in the');
    expect(window).not.toContain('\\u00b7');
    expect(window).not.toContain('·');
  });
});
