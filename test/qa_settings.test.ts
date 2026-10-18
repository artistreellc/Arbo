// Settings, pre-deploy QA round (package "settings"). vitest has no DOM, so
// these are source-string pins on renderSettings: each one holds a fix that
// QA confirmed on the Settings screen in simulation mode.
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';

const html = loadAppHtml();
const start = html.indexOf('async function renderSettings()');
// The function ends at the first closing brace in column 0 after it.
const settings = html.slice(start, html.indexOf('\n}\n', start) + 2);

describe('Settings screen (QA round)', () => {
  it('the slice really is renderSettings', () => {
    expect(start).toBeGreaterThan(-1);
    expect(settings).toContain("$('view-settings')");
    expect(settings).toContain("api('/api/webhooks')");
  });

  it('simulation is its own sentence, never worded as "Master switch CUT" (S-sim)', () => {
    expect(settings).toContain("dl.master === 'sim'");
    expect(settings).toContain('every screen is showing fake SIM- records. No real database is connected; the real links below stay CUT.');
    // The live and cut sentences are kept; the live one carries the webhooks.test pin.
    expect(settings).toContain('A CUT link is a closed door, not empty data');
    expect(settings).toContain('every link is closed whatever its own setting. A closed door is not empty data.');
    expect(settings.indexOf("dl.master === 'sim'")).toBeLessThan(settings.indexOf("dl.master === 'live'"));
  });

  it('an unset work ZIP says so in words, with no real ZIP as a placeholder (S-zip)', () => {
    expect(settings).not.toContain("zin.placeholder = '23452'");
    expect(settings).toContain("zin.placeholder = '5-digit ZIP'");
    expect(settings).toContain("zin.setAttribute('aria-label', 'Today");
    expect(settings).toContain("zin.className = 'input'; zin.style.cssText = 'width:120px;flex:none';");
    expect(settings).toContain("'Set for today: ' + rz.workZip");
    expect(settings).toContain('no caller gets the nearby-estimate offer.');
    // A fresh office-phone ping is used ahead of the typed ZIP, so "no caller" is only said without one.
    expect(settings).toContain('const liveZip = rz.location && rz.location.zip;');
    expect(settings).toContain("box.className = 'input'; box.style.cssText = 'margin:10px 0;resize:vertical';");
  });

  it('the Google card names a setup gap as NOT SET UP, never a raw code or "unavailable" (S-google)', () => {
    expect(settings).toContain("el('div', 'panel-title', 'Google')");
    expect(settings).toContain('Gmail, calendar holds and Drive lead logs.');
    expect(settings).not.toContain('Google (Gmail, calendar holds, Drive lead logs)');
    // google_client_missing is the route's only 503, and feedKind words it 'unset'. The code name
    // itself stays out of the page: appUi's §4.8 test forbids the substring it contains.
    expect(settings).toContain("if (feedKind(e) === 'unset')");
    expect(settings).toContain("badge('NOT SET UP', 'b-src')");
    expect(settings).toContain('add the Gmail sign-in ID and secret (the GMAIL_OAUTH_ variables) on Railway. This is not a disconnect.');
    expect(settings).toContain("feedLine(e, 'Google status')");
    expect(settings).not.toContain('Google reconnect: unavailable right now');
    // An unknown Connect refusal is said in words, never printed as its code.
    expect(settings).toContain('Arbo could not finish it. Tap Open Google and try again.');
    expect(settings).not.toMatch(/'that paste has no Google code in it\. Copy the whole address\.' : e\.message\)/);
  });

  it('the Webhooks card carries a Quo (Sona) row from its own read (S-quo-row)', () => {
    const hooks = settings.indexOf("api('/api/webhooks')");
    const quo = settings.indexOf("api('/api/quo')");
    expect(quo).toBeGreaterThan(hooks);
    expect(settings).toContain('Quo (Sona calls & texts)');
    expect(settings).toContain("reg.state === 'failed' ? 'FAILED' : reg.state === 'pending' ? 'PENDING' : 'NOT WIRED'");
    expect(settings).toContain("feedLine(e, 'Quo (Sona)')");
  });

  it('a stale render stops appending, and a refused tap says so instead of redrawing (S-fail)', () => {
    expect(html).toContain('let settingsGen = 0;\nasync function renderSettings() {');
    expect(settings).toContain('const gen = ++settingsGen;');
    // Every read the render awaits is followed by the generation check.
    for (const read of ["'/api/settings/channels'", "'/api/inbox/intents'", "'/api/settings/route'", "'/api/google/connect');", "'/api/links'", "'/api/webhooks'", "'/api/quo'"]) {
      const at = settings.indexOf('await api(' + read);
      expect(at, read).toBeGreaterThan(-1);
      expect(settings.slice(at, at + 160), read).toContain('if (gen !== settingsGen) return;');
    }
    // No tap swallows its failure and redraws over it.
    expect(settings).not.toMatch(/catch \(e\) \{\}\s*renderSettings\(\)/);
    expect(settings).toContain('catch (e) { btn.disabled = false; showSaveFail(cell, e); return; }');
    expect(settings).toContain('catch (e) { lbtn.disabled = false; showSaveFail(lcell, e); return; }');
    expect(settings).toContain('use a 5-digit Hampton Roads ZIP starting with 23.');
    expect(settings).toContain("e.message === 'bad_zip'");
    expect(settings).toContain('Your entry is still in the box.');
    expect(settings).toContain('zmsg.hidden = true;'); // no empty error gap until there is something to say
    expect(settings).toContain(': saveFailText(e);');
  });

  it('read-only states are badges, not look-alike switches (S-status-tags)', () => {
    expect(settings).not.toContain("el('span', 'loc-toggle'");
    expect(settings).toContain("badge(l.state === 'open' ? 'OPEN' : 'CUT', l.state === 'open' ? 'b-job' : 'b-repeat')");
    expect(settings).toContain("badge('CUT', 'b-repeat')");
    expect(settings).toContain("badge(s.configured ? 'WIRED' : 'NOT WIRED', s.configured ? 'b-job' : 'b-src')");
    expect(html).toContain('.loc-strip .badge{flex:none;min-width:92px;text-align:center;white-space:nowrap}');
  });

  it('no developer jargon, ruling codes or raw keys on the screen (S-copy)', () => {
    for (const gone of ['coded defaults', 'durable home comes', 'Where Mike is', 'In-memory:', 'resets on redeploy', '(R21)', 'no fresh ping yet (phone posts', 'no secret on the server;']) {
      expect(settings, gone).not.toContain(gone);
    }
    expect(settings).toContain("location: 'Saved location history'");
    expect(settings).toContain('(LINK_LABEL[l.link] || l.link)');
    expect(settings).toContain("resend: 'Resend (website form copies)'");
    expect(settings).toContain('const label = HOOK_LABEL[name] || name;');
    expect(settings).toContain('t count what it sent; this is not zero events');
  });

  it('the inbox check behind the switches is named above them (S-inbox-state)', () => {
    const read = settings.indexOf("api('/api/inbox/intents')");
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(settings.indexOf('for (const c of s.channels)'));
    expect(settings).toContain("r === 'no Gmail credentials configured'");
    expect(settings).toContain("'feed-state unset', 'Inbox check isn");
    expect(settings).toContain('These switches take effect once it is.');
    expect(settings).toContain("feedLine(e, 'Inbox check')");
  });

  it('submit buttons are main buttons; the pill is only for real toggles (S-buttons)', () => {
    expect(settings).toContain("el('button', 'actbtn', 'Save')");
    expect(settings).toContain("el('button', 'actbtn', 'Connect')");
    expect(settings).not.toContain("'loc-toggle on', 'Save'");
    expect(settings).not.toContain("'loc-toggle', 'Connect'");
  });

  it('Appearance is on Settings too, even when the switches cannot load (S-appearance)', () => {
    expect(settings).toContain("el('div', 'panel-title', 'Appearance')");
    expect(settings).toContain('const cur = themePref();');
    expect(settings).toContain('setTheme(val);');
    // Drawn on the failure path and at the end, never after a stale render.
    expect(settings.split('appearance();').length - 1).toBe(2);
    expect(settings.trimEnd().endsWith('appearance();\n}')).toBe(true);
  });
});
