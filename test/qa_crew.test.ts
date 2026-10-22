// QA fix round (2026-10-18) on the crew door. vitest has no DOM, so these pin
// the page source: each block is a defect the field-mode review found, held
// shut so it cannot come back quietly.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../src/app/crew.html', import.meta.url), 'utf8');

/** The source of one top-level function, up to its closing brace. */
const fn = (name: string): string => {
  const start = html.search(new RegExp(`(async )?function ${name}\\(`));
  expect(start, `function ${name} not found`).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('\n}\n', start) + 2);
};
/** The body of one CSS rule, by its exact selector. */
const rule = (selector: string): string => {
  const start = html.indexOf(selector + '{');
  expect(start, `CSS rule ${selector} not found`).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('}', start));
};

describe('the briefing gate keeps the server’s answer on screen', () => {
  it('the 1-second refresh shows the server’s word before its own countdown', () => {
    expect(fn('refreshGate')).toContain('GATE.serverMsg || (need.length');
    expect(html).toMatch(/serverMsg: '',/);
  });

  it('a refusal and an error both land in serverMsg; a new tick or press clears it', () => {
    const submit = fn('submitGate');
    expect(submit).toMatch(/go\.disabled = true;\s*GATE\.serverMsg = '';/);
    // QA round 2: read time is left to the live countdown, so only the other codes are held.
    // D111 (pins moved, meaning kept): the same lines through tf/T; the 400 crew-code test is named first.
    expect(submit).toContain("GATE.serverMsg = other.length ? tf('Still needed: {list}'");
    expect(submit).toContain("const rejected = e.code === 400 && (e.message === 'unknown_crew' || e.message === 'bad_crew_id');");
    expect(submit).toMatch(/GATE\.serverMsg = rejected/);
    expect(submit).not.toContain("$('gate-status').textContent");
    expect(fn('renderGate')).toContain("GATE.checked = cb.checked; GATE.serverMsg = '';");
  });

  it('the server’s missing codes are read out in words, never as codes', () => {
    // D111 (pin moved, meaning kept): the same words, read through T each time they are said.
    expect(html).toContain("get scroll() { return T('scroll to the bottom'); },");
    expect(html).toContain("get checkbox() { return T('tick the box'); },");
    expect(html).toContain("get read_time() { return T('read for longer'); },");
    expect(fn('submitGate')).toContain('.map((m) => GATE_NEED[m]');
  });

  it('a failed sign-off says the day stays locked, never "not blocked"', () => {
    const submit = fn('submitGate');
    expect(html).not.toMatch(/not blocked/i);
    // D111 (pins moved, meaning kept): the stop-work order is its own sentence, said by refreshGate
    // after the reason as a safety line, whenever submitGate marks it (serverOrder).
    expect(fn('refreshGate')).toContain('Your work orders stay locked — do not start work; call the office to log your briefing.');
    expect(submit).toContain('GATE.serverOrder = !rejected && !retry && e.code !== 409;');
    // QA round 2: the reason comes from crewWhy, the crew door's one wording for a failed read.
    expect(submit).toContain("tf('Your sign-off could not be recorded ({why}).', { why: crewWhy(e) })");
    expect(fn('crewWhy')).toContain("if (m === 'not_simulated') return T('not part of the practice data');");
  });

  it('the acknowledgement box sits inside its label, one full-row target', () => {
    const gate = fn('renderGate');
    expect(gate).toContain('lab.prepend(cb);');
    expect(gate).not.toContain('htmlFor');
    expect(rule('.ackrow label')).toMatch(/display:flex.*min-height:52px.*width:100%/);
    expect(rule('.ackrow input')).toContain('width:28px;height:28px');
  });
});

describe('the work-order list never draws an unreadable or held-back day as empty (§1B)', () => {
  it('reads the server’s flag and count, and never shows its note raw', () => {
    const work = fn('renderWork');
    expect(work).toContain('data.contractLookupFailed');
    expect(work).toContain('data.notWorkOrders');
    expect(work).not.toContain('boundaryNote');
  });

  it('"Nothing scheduled" is reached only after the unreadable check, and only with nothing held', () => {
    const work = fn('renderWork');
    expect(work.indexOf('data.contractLookupFailed')).toBeLessThan(work.indexOf("'Nothing scheduled'"));
    // D111 (pin moved, meaning kept): the same choice, through T.
    expect(work).toContain("held ? T('Nothing confirmed to start') : T('Nothing scheduled')");
    expect(work).toContain("Can’t confirm today’s jobs");
  });

  it('the held count is named with a real plural, above the list when some jobs did go out', () => {
    const work = fn('renderWork');
    // D111 (pin moved, meaning kept): the real plural is tn's one/many pair, each a whole sentence.
    expect(work).toContain("tn(held, '{n} job on today’s sheet is on hold — no signed contract yet. Check with the office.',");
    expect(work).toContain("'{n} jobs on today’s sheet are on hold — no signed contract yet. Check with the office.');");
    expect(work).toContain("if (held) v.appendChild(el('div', 'shortfall', heldLine));");
    expect(work.indexOf("'shortfall', heldLine")).toBeLessThan(work.indexOf('for (const wo of data.workOrders)'));
  });

  it('a failed load is not an empty day, and promises no gesture the app lacks', () => {
    expect(html).not.toContain('Pull to refresh');
    // Deliberately updated (CREW_PLAN C1, D107): the failure box now also names WHY in
    // crewWhy's words; it is still the warning box and still not an empty day.
    const work = fn('renderWork');
    expect(work).toContain("const s = el('div', 'state err');");
    // D111 (pins moved, meaning kept): the same lines, through T.
    expect(work).toContain("s.appendChild(el('b', '', T('Could not load your work orders')));");
    expect(work).toContain('const why = crewWhy(e);');
    expect(work).toContain("s.appendChild(el('div', '', T('That is not an empty day — call the office.')));");
  });
});

describe('a failure looks like a failure (§1B)', () => {
  it('the error box is its own style, and the cards keep their spacing', () => {
    expect(rule('.state.err')).toContain('border:1.5px solid var(--warning)');
    expect(html).toMatch(/\.state\{[^}]*margin-bottom:16px/);
    expect(html).toContain('.errline:empty{display:none}');
  });

  it('only a real 404 gets the plain "no briefing" box; an unreadable one is the stop-work box', () => {
    // C4 (D109): the read now carries the crew code, so the slice starts at the call itself.
    const boot = html.slice(html.indexOf("api('/api/crew/briefing' + (CREW_ID"));
    expect(boot.length).toBeLessThan(html.length);
    // D111 (pin moved, meaning kept): the same plain box, its line through T.
    expect(boot).toMatch(/if \(e\.code === 404\) \{\s*\$\('gate-slot'\)\.appendChild\(el\('div', 'state', T\('No briefing published/);
    expect(boot).toContain("const s = el('div', 'state err');");
    expect(boot).toContain("Briefing didn\\u2019t come through");
    expect(boot).toContain('Do not start work');
  });
});

describe('near-miss filing tells the crew the truth', () => {
  it('a failed filing is told in words, never as the server’s code', () => {
    // D111 (pin followed, meaning kept): the card's answer is drawn by nmSay — after File it, and again
    // after a language change — so the failure's words live there.
    expect(fn('renderNearMiss')).toContain('nmSay(out, NM.last);');
    const nm = `${fn('renderNearMiss')}\n${fn('nmSay')}`;
    expect(nm).not.toContain("'Did not save ('");
    expect(nm).not.toMatch(/\+ \(?e\.message/);
    // QA round 2: every other failure is worded by crewWhy ('not part of the practice data', 'cut on purpose', …).
    expect(nm).toContain("tf('Did not save — {why}.', { why: crewWhy(e) })");
    expect(nm).toContain('the office did not recognise your crew code');
  });

  it('the copy says it is filed under the crew code and becomes a lesson, not "straight into training"', () => {
    const nm = fn('renderNearMiss');
    expect(nm).toContain('It’s filed under your crew code');
    expect(nm).toContain('turns it ');
    expect(nm).not.toContain('straight into training');
  });
});

describe('identity and the door key', () => {
  it('claims no sign-in the page has not checked', () => {
    expect(html).not.toContain("'Signed in");
    // D111 (pin moved, meaning kept): the same stored-code line, one template through tf.
    expect(fn('renderWhoAmI')).toContain("tf('Crew code on this phone \\u00b7 {code}', { code: CREW_ID.slice(0, 8) })");
  });

  it('"Not you?" is a 48px target', () => {
    expect(rule('#whoami .signed button')).toContain('min-height:48px');
  });

  it('with no crew key on the server, the card says so and offers no field', () => {
    expect(html).toContain("renderDoorKey(e.message === 'crew_key_not_set', e.message)");
    const door = fn('renderDoorKey');
    const notSet = door.slice(door.indexOf('if (notSet) {'), door.indexOf('return;', door.indexOf('if (notSet) {')));
    expect(notSet).toContain('No crew door key has been set up yet');
    expect(notSet).not.toContain('createElement');
  });

  it('the normal card says the key is not the crew code, and lets the crew see what they typed', () => {
    const door = fn('renderDoorKey');
    expect(door).toContain('It is not your crew code');
    // D111 (pin moved, meaning kept): the same button, its words through T.
    expect(door).toContain("el('button', 'keyshow', T('Show key'))");
    expect(door).toContain("show.type = 'button'");
    expect(door).toContain('input.spellcheck = false');
    expect(html).toContain('#whoami #doorkey{font-family:inherit}');
    expect(html).toMatch(/#whoami button\.keyshow\{[^}]*min-height:44px/);
  });

  it('blocked browser storage is said, never a silent reload or a dead page', () => {
    // Every read goes through the guarded helper.
    expect(html.match(/localStorage\.getItem\(/g)).toHaveLength(1);
    expect(html).toContain("const load = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };");
    // Every write is guarded, and a failure stops before the reload.
    // Deliberately updated (CREW_PLAN C3 + C4, D109): two writes come before no
    // reload. The sign-in link's (takeSignInLink) runs at boot, before any card
    // exists: it records the failure (kept = false) and the who-am-I card says
    // STORAGE_BLOCKED. The sign-off's kept start (keptGateStart) falls back to
    // a fresh start — the server's own "already signed today" check stays the
    // guard. Every write is still a one-line try/catch; every write before a
    // reload still says STORAGE_BLOCKED and stops.
    const writes = html.split('\n').filter((l) => /localStorage\.(setItem|removeItem)\(/.test(l));
    expect(writes).toHaveLength(5);
    const noReload = ["  try { localStorage.setItem('arboCrewId', code); } catch (e) { kept = false; }", '    try { localStorage.setItem(k, now); } catch (e) { return now; }'];
    expect(writes.filter((l) => noReload.includes(l))).toEqual(noReload);
    const beforeReload = writes.filter((l) => !noReload.includes(l));
    expect(beforeReload).toHaveLength(3);
    for (const l of beforeReload) expect(l).toMatch(/try \{ localStorage\.\w+\([^)]*\); \} catch \(e\) \{ err\.textContent = STORAGE_BLOCKED; return; \}/);
    expect(html).toContain('if (SIGN_IN && SIGN_IN.code && !SIGN_IN.kept) err.textContent = STORAGE_BLOCKED;');
  });
});

describe('one primary button style, one card style', () => {
  it('"Look it up" and "File it" use the dark gradient like every other primary', () => {
    expect(rule('#lib-go')).toContain('background:var(--go)');
    expect(rule('#nm-go')).toContain('background:var(--go)');
    expect(rule('.wo .num')).toContain('background:#2F7560');
  });

  it('the lower cards match the upper ones, and the near-miss box has a real background', () => {
    for (const card of ['#lib-card', '#nm-card']) {
      expect(rule(card)).toContain('border-radius:var(--r-lg)');
      expect(rule(card)).toContain('box-shadow:var(--shadow-card)');
    }
    expect(html).not.toContain('var(--bg)');
    expect(rule('#nm-desc')).toContain('background:var(--surface-alt)');
    expect(rule('#nm-desc')).toContain('resize:none');
  });
});

describe('the library note', () => {
  it('the whole clause follows the count', () => {
    // D111 (pins moved, meaning kept): the whole clause still follows the count — tn's one/many pair.
    expect(fn('libSearch')).toContain("'{n} more entry is written but not yet signed off by a person, so it is held back.'");
    expect(fn('libSearch')).toContain("'{n} more entries are written but not yet signed off by a person, so they are held back.'");
  });
});
