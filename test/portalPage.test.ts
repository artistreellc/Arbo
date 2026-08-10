// The customer door's page (task #35, cycle 11).
//
// This is the only HTML in Arbo a stranger can load, so the tests care about
// two things above prettiness: it must not reach outside itself, and it must
// not be able to touch Mike's half of the app.

import { describe, it, expect } from 'vitest';
import { loadPortalHtml } from '../src/server/appPage.js';

const html = loadPortalHtml();

describe('portal page — self-contained', () => {
  it('is a whole document', () => {
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('</html>');
    expect(html).toContain('name="viewport"');
  });

  it('loads nothing from anywhere else — no CDN, no font, no build step', () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+(stylesheet|font)/i);
    expect(html).not.toMatch(/@import/);
  });

  it('names no external host at all', () => {
    const hosts = [...html.matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1]!.toLowerCase());
    expect(hosts).toEqual([]);
  });
});

describe('portal page — it cannot reach the admin half', () => {
  it('never mentions the admin API key header', () => {
    // A customer page that knows this header name is one copy-paste away from
    // being handed a working one.
    expect(html).not.toContain('x-arbor-key');
  });

  it('calls only the three portal endpoints', () => {
    expect(html).toContain("'/portal/view'");
    expect(html).toContain("'/portal/signin'");
    expect(html).toContain("'/portal/signout'");
    // Nothing under /api/ — that surface is Mike's and is gated by his key.
    expect(html).not.toMatch(/['"]\/api\//);
    expect(html).not.toContain('/crew');
  });

  it('sends credentials same-origin and never cross-site', () => {
    expect(html).not.toMatch(/credentials:\s*['"]include['"]/);
    expect(html.match(/credentials:\s*'same-origin'/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('portal page — §1B, it never renders a failure as an empty property', () => {
  it('has a notice banner and speaks on the non-200 branch', () => {
    expect(html).toContain('id="notice"');
    // The catch-all after 200/401 — 503 and 404 both have to say something.
    expect(html).toMatch(/notice\(body\.line/);
  });

  it('treats a network failure as unreadable, not as empty', () => {
    expect(html).toMatch(/could not reach Arbo/i);
  });

  it('says an empty tree list is a fact about the records, not about the property', () => {
    expect(html).toMatch(/have not recorded any trees/i);
  });

  it('only ever follows an https payment link', () => {
    // Escaping stops an attribute breakout; it does NOT stop `javascript:` or
    // `data:`, and this is the one value on the page that becomes a URL the
    // browser will follow with money attached.
    expect(html).toContain('function safePayLink');
    expect(html).toContain("link.slice(0, 8).toLowerCase() === 'https:' + '//'");
    const payFn = html.slice(html.indexOf('function renderPayment'), html.indexOf('function renderTrees'));
    expect(payFn).toContain('safePayLink(pay.link)');
    // The href is built from the CHECKED value, never from the raw one.
    expect(payFn).toContain("esc(href)");
    expect(payFn).not.toMatch(/href="'\s*\+\s*esc\(pay\.link\)/);
  });

  it('renders no pay button when the server gave no link', () => {
    expect(html).toMatch(/no online payment link/i);
    // The button only exists inside the branch that has a link.
    const payFn = html.slice(html.indexOf('function renderPayment'), html.indexOf('function renderTrees'));
    expect(payFn).toContain('pay.link');
    expect(payFn.indexOf('PAY THIS INVOICE')).toBeGreaterThan(payFn.indexOf('pay.link'));
  });
});

describe('portal page — the styling carries the same state the sentence does', () => {
  // Both of these were found by LOOKING at a rendered screenshot, not by a
  // test. They are the same mistake twice: dressing a known fact in the
  // costume of an absence, which is the §1B lie running backwards.

  it('does not paint a recorded site fact as a warning', () => {
    // A water-meter location that IS on file is not a caution — it is simply
    // known. Reusing the amber `present` class for it said "watch out" about
    // a piece of ordinary information.
    expect(html).toContain('.dot.known{');
    const site = html.slice(html.indexOf('function renderSite'), html.indexOf('function render(view)'));
    expect(site).toContain("f.known ? 'known' : 'unknown'");
    expect(site).not.toContain("f.known ? 'present'");
  });

  it('greys a tree\'s ownership line only when nobody has checked', () => {
    const trees = html.slice(html.indexOf('function renderTrees'), html.indexOf('function renderFlagList'));
    expect(trees).toContain("t.ownership.state === 'unknown' ? ' absent' : ''");
    // The unconditional version is the bug: it greyed out "stands on your
    // land as recorded" exactly like "nobody has checked".
    expect(trees).not.toContain('"tline absent">\' + esc(t.ownership.line)');
  });

  it('draws an unknown as hollow, never as a confident filled mark', () => {
    expect(html).toMatch(/\.dot\.unknown\{background:transparent/);
  });
});

describe('portal page — it states no facts of its own', () => {
  it('renders the server sentences rather than inventing them', () => {
    for (const field of ['pay.line', 'view.project.line', 'f.line', 'f.value', 't.assessment', 't.scheduleLine']) {
      expect(html).toContain(field);
    }
  });

  it('never says a permit is clear', () => {
    // The permanent vocabulary rule. This page must not editorialise on top of
    // whatever propertyFlags.ts said.
    expect(html).not.toMatch(/you'?re clear/i);
    expect(html).not.toMatch(/permit[^<]{0,20}clear/i);
    expect(html).not.toMatch(/no permit needed/i);
  });
});

describe('portal page — escaping', () => {
  it('escapes before putting anything in innerHTML', () => {
    expect(html).toContain('function esc(');
    expect(html).toContain('.replace(/&/g,');
    expect(html).toContain("replace(/</g, '&lt;')");
    // Every innerHTML assignment that interpolates a value routes through esc()
    // or a literal. Spot-check the ones carrying free text from Mike's notes.
    const trees = html.slice(html.indexOf('function renderTrees'), html.indexOf('function renderFlagList'));
    expect(trees).toContain('esc(t.assessment)');
    expect(trees).toContain('esc(t.species)');
  });

  it('clears the password field after a successful sign-in', () => {
    expect(html).toContain("$('password').value = ''");
  });
});
