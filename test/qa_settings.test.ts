// Settings, pre-deploy QA round (package "settings"). vitest has no DOM, so
// these are source-string pins on renderSettings: each one holds a fix that
// QA confirmed on the Settings screen in simulation mode.
import { describe, it, expect } from 'vitest';
import { loadAppHtml } from '../src/server/appPage.js';

const html = loadAppHtml();
const start = html.indexOf('async function renderSettings()');
// renderSettings swaps in what buildSettings draws (QA round 2), so the slice
// runs from renderSettings to the first closing brace in column 0 after buildSettings.
const settings = html.slice(start, html.indexOf('\n}\n', html.indexOf('async function buildSettings(v, gen) {', start)) + 2);

describe('Settings screen (QA round)', () => {
  it('the slice really is renderSettings and the buildSettings it draws with', () => {
    expect(start).toBeGreaterThan(-1);
    expect(settings).toContain("$('view-settings')");
    expect(settings).toContain('async function buildSettings(v, gen) {');
    expect(settings).toContain("api('/api/webhooks')");
  });

  it('simulation is its own sentence, never worded as "Master switch CUT" (S-sim)', () => {
    expect(settings).toContain("dl.master === 'sim'");
    expect(settings).toContain('every screen is showing fake SIM- records, except the Calendar, which is always your live Google Calendar. No real database is connected; the real links below stay CUT.');
    // The live and cut sentences are kept; the live one carries the webhooks.test pin.
    expect(settings).toContain('A CUT link is a closed door, not empty data');
    expect(settings).toContain('every link is closed whatever its own setting. A closed door is not empty data.');
    expect(settings.indexOf("dl.master === 'sim'")).toBeLessThan(settings.indexOf("dl.master === 'live'"));
  });

  it('an unset work ZIP says so in words, with no real ZIP as a placeholder (S-zip)', () => {
    expect(settings).not.toContain("zin.placeholder = '23452'");
    // Pin moved (R27 Phase A, owner app c), meaning kept: the same placeholder and name, said through T.
    expect(settings).toContain("zin.placeholder = T('5-digit ZIP')");
    expect(settings).toContain("zin.setAttribute('aria-label', T('Today");
    expect(settings).toContain("zin.className = 'input'; zin.style.cssText = 'width:120px;flex:none';");
    expect(settings).toContain("tf('Set for today: {zip}', { zip: rz.workZip })"); // pin moved (R27 Phase A, owner app c): the ZIP a slot of its template
    // What an unset ZIP costs depends on Arbo's own phone line (QA round 2): never "no caller gets" while the line is cut.
    expect(settings).not.toContain('no caller gets the nearby-estimate offer.');
    expect(settings).toContain('callers near your work aren\\u2019t offered the nearby slot (near-home offers still apply).');
    expect(settings).toContain('Arbo\\u2019s phone line is off, so callers aren\\u2019t offered anything either way.');
    // A fresh office-phone ping is used ahead of the typed ZIP, so "no caller" is only said without one.
    expect(settings).toContain('const liveZip = rz.location && rz.location.zip;');
    expect(settings).toContain("box.className = 'input'; box.style.cssText = 'margin:10px 0;resize:vertical';");
  });

  it('the Google card names a setup gap as NOT SET UP, never a raw code or "unavailable" (S-google)', () => {
    expect(settings).toContain("el('div', 'panel-title', 'Google')");
    // R33 (Mike, 2026-10-20: "Connect Google as a read only"): no calendar holds any more.
    expect(settings).toContain('Gmail, the calendar and Drive lead logs \\u2014 read only.');
    expect(settings).not.toContain('Gmail, calendar holds and Drive lead logs.');
    expect(settings).not.toContain('Google (Gmail, calendar holds, Drive lead logs)');
    // google_client_missing is the route's only 503, and feedKind words it 'unset'. The code name
    // itself stays out of the page: appUi's §4.8 test forbids the substring it contains.
    expect(settings).toContain("if (feedKind(e) === 'unset')");
    expect(settings).toContain("chip(T('NOT SET UP'), 'watch')"); // pin moved (R27 Phase A, owner app c): the same word, through T
    // The variable names Mike must set, in full (QA round 2); the 'I' is a source escape for the §4.8 test.
    expect(settings).toContain('add GMAIL_OAUTH_CL\\u0049ENT_ID and GMAIL_OAUTH_CL\\u0049ENT_SECRET on Railway. Nothing is disconnected \\u2014 it was never set up.');
    expect(settings).not.toContain('This is not a disconnect.');
    expect(settings).toContain("feedLine(e, T('Google status'))"); // pin moved (R27 Phase A, owner app c): the same name, through T
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
    // R33: a webhook Arbo won't create while Quo is read-only is its own word, never FAILED.
    // Pin moved (R27 Phase A, owner app c), meaning kept: the same words in the same order, each through T.
    expect(settings).toContain("reg.state === 'failed' ? T('FAILED') : reg.state === 'pending' ? T('PENDING') : reg.state === 'read_only' ? T('HOOK MISSING') : T('NOT WIRED')");
    expect(settings).toContain("feedLine(e, T('Quo (Sona)'))");
  });

  it('a stale render stops appending, and a refused tap says so instead of redrawing (S-fail)', () => {
    expect(html).toContain('let settingsGen = 0;\nasync function renderSettings() {');
    expect(settings).toContain('const gen = ++settingsGen;');
    // Every read the render awaits is followed by the generation check.
    for (const read of ["'/api/settings/channels'", "'/api/inbox/intents'", "'/api/settings/route'", "'/api/reception/status'", "'/api/google/connect');", "'/api/links'", "'/api/webhooks'", "'/api/quo'"]) {
      const at = settings.indexOf('await api(' + read);
      expect(at, read).toBeGreaterThan(-1);
      expect(settings.slice(at, at + 160), read).toContain('if (gen !== settingsGen) return;');
    }
    // No tap swallows its failure and redraws over it.
    expect(settings).not.toMatch(/catch \(e\) \{\}\s*renderSettings\(\)/);
    // QA round 3: a refused tap also puts the switch's own label back (it read 'Saving…').
    // Pin moved (R27 Phase A, owner app c), meaning kept: a refused tap still puts the switch's own word back (ON/OFF through T) and says why.
    expect(settings).toContain("catch (e) { btn.disabled = false; btn.textContent = c.on ? T('ON') : T('OFF'); showSaveFail(cell, e); return; }");
    expect(settings).toContain("catch (e) { lbtn.disabled = false; lbtn.textContent = loc.enabled ? T('ON') : T('OFF'); showSaveFail(lcell, e); return; }");
    expect(settings).toContain('use a 5-digit Hampton Roads ZIP starting with 23.');
    expect(settings).toContain("e.message === 'bad_zip'");
    expect(settings).toContain('Your entry is still in the box.');
    expect(settings).toContain('zmsg.hidden = true;'); // no empty error gap until there is something to say
    expect(settings).toContain(': saveFailText(e);');
  });

  it('read-only states are chips by tone, not look-alike switches (S-status-tags)', () => {
    expect(settings).not.toContain("el('span', 'loc-toggle'");
    // R32 added a fourth link state: READ-ONLY reads, so it wears good like OPEN; CUT stays info.
    // Pin moved (R27 Phase A, owner app c), meaning kept: the same chips and tones, their words through T.
    expect(settings).toContain("chip(l.state === 'open' ? T('OPEN') : l.state === 'read-only' ? T('READ-ONLY') : T('CUT'), readable ? 'good' : 'info')");
    expect(settings).toContain("const readable = l.state === 'open' || l.state === 'read-only';");
    expect(settings).toContain("chip(T('CUT'), 'info')");
    expect(settings).toContain("chip(s.configured ? T('WIRED') : T('NOT WIRED'), s.configured ? 'good' : 'watch')");
    expect(settings).toContain("ok ? 'good' : reg.state === 'failed' ? 'stop' : 'watch'");
    // No legacy badge colour is left on this screen: every status chip has a tone.
    expect(settings).not.toMatch(/\bbadge\(/);
    expect(html).toContain('.loc-strip .badge{flex:none;min-width:92px;text-align:center;white-space:nowrap}');
  });

  it('no developer jargon, ruling codes or raw keys on the screen (S-copy)', () => {
    for (const gone of ['coded defaults', 'durable home comes', 'Where Mike is', 'In-memory:', 'resets on redeploy', '(R21)', '(R19).', 'since deploy', 'no fresh ping yet (phone posts', 'no secret on the server;', 'the GMAIL_OAUTH_ variables']) {
      expect(settings, gone).not.toContain(gone);
    }
    expect(settings).toContain("location: T('Saved location history')"); // pin moved (R27 Phase A, owner app c): the same name, through T
    expect(settings).toContain('(LINK_LABEL[l.link] || l.link)');
    // Pin moved (R27 Phase A, owner app c), meaning kept: the same names, through T.
    expect(settings).toContain("resend: T('Resend (website form copies)')");
    expect(settings).toContain("railway: T('Railway (deploy notices)')");
    expect(settings).toContain('const label = HOOK_LABEL[name] || name;');
    expect(settings).toContain('t count what it sent; this is not zero events');
    expect(settings).toContain("received since Arbo last restarted'"); // pin moved (R27 Phase A, owner app c): the row's own template
  });

  it('the inbox check behind the switches is named above them (S-inbox-state)', () => {
    const read = settings.indexOf("api('/api/inbox/intents')");
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(settings.indexOf('for (const c of s.channels)'));
    expect(settings).toContain("r === 'no Gmail credentials configured'");
    // Pin moved (R27 Phase A, owner app c), meaning kept: the same line and name, through T.
    expect(settings).toContain("'feed-state unset', T('Inbox check isn");
    expect(settings).toContain('These switches take effect once it is.');
    expect(settings).toContain("feedLine(e, T('Inbox check'))");
  });

  it('submit buttons are main buttons; the pill is only for real toggles (S-buttons)', () => {
    // Pin moved (R27 Phase A, owner app c), meaning kept: the same main buttons, their words through T.
    expect(settings).toContain("el('button', 'actbtn', T('Save'))");
    expect(settings).toContain("el('button', 'actbtn', T('Connect'))");
    expect(settings).not.toContain("'loc-toggle on', 'Save'");
    expect(settings).not.toContain("'loc-toggle', 'Connect'");
  });

  it('Appearance is on Settings too, even when the switches cannot load (S-appearance)', () => {
    expect(settings).toContain("el('div', 'panel-title', T('Appearance'))"); // pin moved (R27 Phase A, owner app c): the same title, through T
    expect(settings).toContain('const cur = themePref();');
    expect(settings).toContain('setTheme(val);');
    // Drawn on the failure path and at the end, never after a stale render.
    expect(settings.split('appearance();').length - 1).toBe(2);
    expect(settings.trimEnd().endsWith('appearance();\n}')).toBe(true);
  });
});
