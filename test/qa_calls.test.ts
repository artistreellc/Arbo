// Pre-deploy QA, Calls screen and the shared Quo panels (study, outreach,
// Sona). vitest has no DOM, so the screens are pinned as source strings,
// each one inside the function that renders it. §1B throughout: a feed Arbo
// could not read is NAMED, a link cut on purpose (R21) is not "not set up",
// and neither one is ever worded as zero.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createArborRequestHandler } from '../src/server.js';

const html = readFileSync(new URL('../src/app/index.html', import.meta.url), 'utf8');
/** One top-level function's source, from its declaration to its closing brace. */
const fn = (name: string): string => {
  const start = html.indexOf('async function ' + name + '(');
  if (start === -1) throw new Error('no function ' + name + ' in index.html');
  return html.slice(start, html.indexOf('\n}\n', start));
};

describe('the shared Quo panels name why they cannot read', () => {
  it('customer notes keep their title and say Quo is not connected — never "unavailable right now"', () => {
    const study = fn('studyPanel');
    const caught = study.slice(study.indexOf('catch (e)'), study.indexOf('const st = d.status'));
    expect(caught).toContain("el('div', 'panel-title', 'Where each customer stands')");
    expect(caught).toContain("e.message === 'quo_not_configured'");
    expect(caught).toContain('Arbo can\\u2019t read your customer threads. That doesn\\u2019t mean there are none.');
    expect(caught).toContain("feedLine(e, 'Customer notes', 'That doesn\\u2019t mean there are none.')");
    expect(caught).toContain("if (quoOff) w.dataset.quoOff = '1';");
    expect(html).not.toContain('Customer notes: unavailable right now');
  });

  it('one cause, one wording: Quo isn’t connected, and no env var on Today or Calls', async () => {
    const outreach = fn('outreachPanel');
    expect(outreach).toContain('Waiting on Quo — nothing can be texted.');
    expect(outreach).not.toContain('This is not zero candidates');
    expect(fn('sonaPanel')).toContain('Waiting on Quo — Sona’s calls are not reaching Arbo.');
    expect(outreach).toContain("feedLine(e, 'Text outreach')");
    expect(fn('sonaPanel')).toContain("feedLine(e, 'Sona (Quo)')");
    expect(html).not.toContain('QUO_API_KEY');
    expect(html).not.toContain('Quo is not configured on the server');
    // The Sona card renders the intake's own detail, so the word is fixed there.
    const srv = createServer(createArborRequestHandler());
    await new Promise<void>((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const q = (await (await fetch(`${base}/api/quo`)).json()) as { status: { registration: { detail: string } } };
    srv.close();
    expect(q.status.registration.detail).toContain('Quo isn’t connected to Arbo yet');
    expect(q.status.registration.detail).not.toContain('QUO_API_KEY');
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(server).toContain('Arbo has no public web address to give Quo');
    expect(server).toContain("console.error('[quo] DISABLED — no QUO_API_KEY."); // the variable stays in the boot log
  });

  it('outreach buttons re-render the screen they are on, not always Today', () => {
    const outreach = fn('outreachPanel');
    expect(outreach).toContain('const rerender = () => (full ? renderCalls() : renderToday());');
    expect(outreach).toContain('setTimeout(rerender, 2500)');
    expect(outreach).not.toContain('setTimeout(() => renderToday(), 2500)');
    expect(outreach).not.toMatch(/catch \(e\) \{\} renderToday\(\);/);
  });
});

describe('the Calls screen', () => {
  const calls = fn('renderCalls');

  it('R21: the cut lines say cut, ahead of "not set up", and claim no coverage that does not exist', () => {
    expect(calls.match(/if \(t\.linkCut\)/g)).toHaveLength(2);
    expect(calls).toContain('Arbo line (757-821-6983): disconnected while Sona handles calls — this is not zero texts. Nothing was deleted.');
    // QA round 2: the transcript line drops the honesty tag — the call log in
    // the same card carries that card's one "not zero calls".
    expect(calls).toContain('Call transcripts: disconnected while Sona handles calls. Sona’s calls are in the Quo card above.');
    expect(calls.indexOf('if (t.linkCut)')).toBeLessThan(calls.indexOf('!t.wired'));
    expect(html).not.toContain('The in-call records still capture every call');
    // No shouted NOT, no "wire" in the status lines.
    expect(calls).not.toContain('NOT connected');
    expect(calls).not.toContain('wire NOT');
  });

  it('a call log Arbo could not read never heads itself with a zero', () => {
    // QA round 2: one feed line inside the own-line card, not a dashed state card.
    expect(calls).toContain("ownSlot.appendChild(feedLine(e, 'Call log', 'This is not zero calls.'))");
    expect(calls).not.toContain('feedState(');
    expect(calls).toContain('await LINKS_READY');
    expect(html).not.toContain('No calls logged yet');
    expect(calls).not.toContain('Pull refresh');
    // "No calls yet" is kept for a real read that came back empty.
    expect(calls.indexOf("state('No calls yet'")).toBeGreaterThan(calls.indexOf('if (!data.conversations.length)'));
  });

  it('a failed "Mark reviewed" says so instead of failing silently', () => {
    expect(calls).toContain('catch (e) { btn.disabled = false; showSaveFail(c, e); }');
    expect(calls).not.toContain('catch { btn.disabled = false; }');
  });

  it('the panels sit in cards like Today, and the call items have their own heading', () => {
    for (const slot of ['studyFull', 'outreachFull', 'sonaCallsSlot', 'cnSlot', 'ownSlot']) {
      expect(calls, slot).toContain('const ' + slot + " = el('div', 'slot');");
    }
    expect(calls).toContain("const txSlot = el('div', 'slot texts');"); // QA round 3: '.texts' lines up its two phone lines
    // QA round 2: Arbo's own line is a card like the rest, titled so it never reads as Sona.
    expect(html).not.toContain("'Receptionist calls'");
    const heading = calls.indexOf("ownSlot.appendChild(el('div', 'panel-title', 'Arbo’s own line'))");
    expect(heading).toBeGreaterThan(calls.indexOf('const ownSlot'));
    expect(heading).toBeLessThan(calls.indexOf('const trSlot'));
    expect(calls).toContain("const trSlot = el('div');\n  ownSlot.appendChild(trSlot);");
    // The transcripts' own title is a sub-heading now, so two titles never stack.
    expect(calls).not.toContain("el('div', 'panel-title', 'Call transcripts");
    expect(calls).toContain("el('div', 'sect', 'Call transcripts (pushed after each call)')");
  });

  it('a texts read that failed keeps its title and names the failure', () => {
    expect(calls).toContain("txSlot.appendChild(el('div', 'panel-title', 'Texts')); txSlot.appendChild(feedLine(e, 'Texts'));");
    expect(html).not.toContain('Texts: status unavailable right now');
  });
});
