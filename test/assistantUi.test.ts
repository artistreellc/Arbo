// R28 — the assistant in the Arbo owner app (Mike, 2026-10-20: "Make it safe,
// then set it up" · "put it in the arbo app"). Every email, text, Drive write
// and Square invoice or charge waits in the app for his OK: a "Waiting for your
// OK" card on Today, a sheet to decide each one, and an Assistant desk under
// More. vitest has no DOM, so the pieces with logic are lifted out of the page
// and run against a small stand-in DOM and a faked server (the four
// /api/assistant routes of the shared contract); layout and wiring are source pins.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadAppHtml } from '../src/server/appPage.js';

const html = loadAppHtml();
const css = html.slice(0, html.indexOf('</style>'));
const sprite = readFileSync(new URL('../src/app/sprite.svg', import.meta.url), 'utf8');

/** One top-level function's source: from its declaration to the "}" alone on a line. */
function fnSrc(name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(html);
  if (!m) throw new Error(`no function ${name} in the page`);
  return m[0];
}
/** The same function, built with stand-ins for every outside name it reaches for. */
function pageFn<T>(name: string, deps: Record<string, unknown>, src = fnSrc(name)): T {
  return new Function(...Object.keys(deps), `${src}\nreturn ${name};`)(...Object.values(deps)) as T;
}
/** A top-level `const NAME = …;` evaluated with any page names it reads. */
function pageConst<T>(name: string, deps: Record<string, unknown> = {}): T {
  const m = new RegExp(`^const ${name} = ([\\s\\S]*?);$`, 'm').exec(html);
  if (!m) throw new Error(`no const ${name} in the page`);
  return new Function(...Object.keys(deps), `return ${m[1]}`)(...Object.values(deps)) as T;
}
/** The page line that starts with `start`. */
function oneLine(start: string): string {
  const at = html.indexOf('\n' + start);
  expect(at, start).toBeGreaterThan(-1);
  return html.slice(at + 1, html.indexOf('\n', at + 1));
}
const between = (from: string, to: string) => {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a + from.length);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(a);
  return html.slice(a, b);
};
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------- a stand-in DOM: just what these pieces touch ----------
class N {
  className = '';
  textContent = '';
  id = '';
  type = '';
  value = '';
  htmlFor = '';
  maxLength = 0;
  hidden = false;
  disabled = false;
  focused = false;
  children: N[] = [];
  parent: N | null = null;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  handlers: Array<() => unknown> = [];
  constructor(readonly tag: string) {}
  has(c: string): boolean { return this.className.split(' ').includes(c); }
  appendChild(n: N): N { n.parent?.drop(n); n.parent = this; this.children.push(n); return n; }
  prepend(n: N): void { n.parent?.drop(n); n.parent = this; this.children.unshift(n); }
  drop(n: N): void { this.children = this.children.filter((c) => c !== n); }
  remove(): void { this.parent?.drop(this); this.parent = null; }
  replaceChildren(...ns: N[]): void { for (const c of this.children) c.parent = null; this.children = []; for (const n of ns) this.appendChild(n); }
  replaceWith(n: N): void {
    const p = this.parent;
    if (!p) return;
    n.parent?.drop(n);
    p.children[p.children.indexOf(this)] = n;
    n.parent = p;
    this.parent = null;
  }
  hasChildNodes(): boolean { return this.children.length > 0; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  addEventListener(_t: string, f: () => unknown): void { this.handlers.push(f); }
  /** A tap: a disabled button does nothing, as in a browser. */
  async click(): Promise<void> { if (this.disabled) return; for (const h of [...this.handlers]) await h(); await flush(); }
  focus(): void { this.focused = true; }
  get classList() {
    return {
      add: (c: string) => { if (!this.has(c)) this.className = (this.className + ' ' + c).trim(); },
      remove: (c: string) => { this.className = this.className.split(' ').filter((x) => x && x !== c).join(' '); },
      contains: (c: string) => this.has(c),
      toggle: (c: string, on?: boolean) => { if (on ?? !this.has(c)) this.classList.add(c); else this.classList.remove(c); },
    };
  }
  all(): N[] { return [this, ...this.children.flatMap((c) => c.all())]; }
  querySelectorAll(sel: string): N[] {
    const match = sel.startsWith('.') ? (n: N) => n.has(sel.slice(1)) : (n: N) => n.tag === sel;
    return this.all().slice(1).filter(match);
  }
  querySelector(sel: string): N | null { return this.querySelectorAll(sel)[0] ?? null; }
  text(): string { return [this.textContent, ...this.children.map((c) => c.text())].filter(Boolean).join(' '); }
}
const el = (tag: string, cls?: string, text?: string): N => {
  const n = new N(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const chip = (text: string, tone: string): N => { const n = el('span', 'badge', text); n.dataset.tone = String(tone); return n; };
const chipsIn = (n: N) => n.all().filter((x) => x.has('badge')).map((x) => x.textContent + '=' + x.dataset.tone);
const fail = (code: number | undefined, message = 'error', line: string | null = null) => Object.assign(new Error(message), { code, line });
const fmtWhen = (v: string) => (v && v !== 'not a time' ? 'WHEN(' + v + ')' : ''); // '' for a time it cannot read, as the page's does

// The page's own shared words, so the lines asserted are the lines Mike reads.
const FEED_WORD = pageConst<Record<string, string>>('FEED_WORD');
const RETRY = pageConst<string>('RETRY');
const plural = pageFn<(n: number, one: string, many?: string) => string>('plural', {});
const feedKind = pageFn<(e: unknown) => string>('feedKind', { LINKS: 'live' });
const feedLine = pageFn<(e: unknown, what: string, tail?: string) => N>('feedLine', { el, feedKind, FEED_WORD, RETRY }, oneLine('function feedLine('));
// The page's own no-break helper: a phone number or code section never splits at its hyphen.
const nb = new Function(`return ${/const nb = (\(s\) => [^\n]+);/.exec(html)![1]}`)() as (s: string) => string;
const WJ = '\u2060';
const APPROVAL_KIND = pageConst<Record<string, [string, string]>>('APPROVAL_KIND');
const APPROVAL_NEXT = pageConst<Record<string, string>>('APPROVAL_NEXT');
const APPROVAL_BOX = pageConst<RegExp>('APPROVAL_BOX');
const ACTIVITY_CHIP = pageConst<Record<string, [string, string]>>('ACTIVITY_CHIP');
const ASSIST_STATE = pageConst<Record<string, [string, string]>>('ASSIST_STATE');
const approvalChip = pageFn<(k?: string) => N>('approvalChip', { APPROVAL_KIND, chip });
const approvalAnswered = pageFn<(a: { kind: string }, d: string, note?: string) => string>('approvalAnswered', { APPROVAL_NEXT });
const assistGap = pageFn<(e: unknown, what: string) => N>('assistGap', { el, FEED_WORD, feedLine });
const activityRow = pageFn<(it: Record<string, unknown>) => N>('activityRow', { el, chip, fmtWhen, ACTIVITY_CHIP, nb });
const assistStateLine = pageFn<(s: Record<string, unknown>) => string>('assistStateLine', { plural, fmtWhen });

type Approval = { id: string; sessionId: string; tool: string; kind: string; summary: string; details: Array<{ label: string; value: string }>; requestedAt: string };
const EMAIL: Approval = {
  id: 'sevt_email1', sessionId: 'sesn_1', tool: 'gmail.send_message', kind: 'email',
  summary: 'Email SIM-Brooks: Your proposal for 14 Simulation Row',
  details: [
    { label: 'To', value: 'sim-brooks@example.invalid' },
    { label: 'Subject', value: 'Your proposal for 14 Simulation Row' },
    { label: 'Body', value: 'Hi SIM-Brooks,\n\nAttached is the proposal we talked about.\n\nMike' },
  ],
  requestedAt: '2026-10-20T13:05:00Z',
};
const PAYMENT: Approval = {
  id: 'sevt_pay1', sessionId: 'sesn_2', tool: 'square.create_invoice', kind: 'payment',
  summary: 'Invoice SIM-Alder for the oak removal',
  details: [{ label: 'Customer', value: 'SIM-Alder' }, { label: 'Amount', value: '$450.00' }],
  requestedAt: '2026-10-20T13:10:00Z',
};

// ---------- the sheet, opened against a faked server ----------
// `answer` is what the POST answers: a value, an Error it throws, or a
// function returning either (for an answer that arrives late). The page's
// armTwice runs on a fake clock, so a test says how long Mike took between taps.
function sheet(answer: unknown = { ok: true }) {
  const nodes: Record<string, N> = { approval: el('div', 'sheet'), 'approval-title': el('div'), 'approval-body': el('div') };
  const sent: Array<{ path: string; body: unknown }> = [];
  const log: string[] = [];
  const clock = { t: 1_000_000 };
  const timedArm = pageFn<(btn: N, armed: string, run: () => unknown, minGap?: number) => void>('armTwice', { Date: { now: () => clock.t } });
  const open = pageFn<(a: unknown) => void>('openApproval', {
    $: (id: string) => nodes[id],
    el,
    document: { createElement: (t: string) => el(t) },
    sheetOpened: (id: string) => log.push('opened:' + id),
    closeSheet: (id: string) => log.push('closed:' + id),
    approvalChip, fmtWhen, armTwice: timedArm, approvalAnswered, APPROVAL_BOX, nb,
    api: async (path: string, opts: { method: string; body: unknown }) => {
      expect(opts.method).toBe('POST');
      sent.push({ path, body: opts.body });
      const a = typeof answer === 'function' ? await (answer as () => unknown)() : answer;
      if (a instanceof Error) throw a;
      return a;
    },
    assistantReread: () => log.push('reread'),
    showKeywall: () => log.push('keywall'),
    approvalDone: (id: string, line: string) => log.push('done:' + id + ':' + line),
  });
  const body = nodes['approval-body']!;
  const btn = (re: RegExp) => body.all().find((n) => n.tag === 'button' && re.test(n.textContent))!;
  /** Mike waits this long (ms) before his next tap. */
  const wait = (ms: number) => { clock.t += ms; };
  return { open, nodes, body, sent, log, btn, wait, out: () => body.querySelector('.errline')!, note: () => body.all().find((n) => n.tag === 'input')! };
}
/** What the server really sends for a Square call with no amount (describePayment always adds the Amount row). */
const NO_AMOUNT: Approval = {
  id: 'sevt_pay0', sessionId: 'sesn_2', tool: 'square.make_api_request', kind: 'payment',
  summary: 'Square: invoices publish',
  details: [
    { label: 'Square call', value: 'invoices · publish' },
    { label: 'Amount', value: 'No amount in this request.' },
    { label: 'Customer', value: 'Not named in this request.' },
    { label: 'Request', value: '{\n "invoice_id": "INVsim1",\n "version": 1\n}' },
  ],
  requestedAt: '2026-10-20T13:12:00Z',
};
const TEXT: Approval = {
  id: 'sevt_text1', sessionId: 'sesn_3', tool: 'quo.send-message', kind: 'text',
  summary: 'Text +17575550142: Hi, this is Art-is-Tree. Reply STOP to opt out.',
  details: [{ label: 'Number', value: '+17575550142' }, { label: 'Message', value: 'Hi, this is Art-is-Tree. Reply STOP to opt out.' }],
  requestedAt: '2026-10-21T02:30:00Z',
};

describe('R28 — what kind of ask it is: one chip per kind, through chip()', () => {
  it('payment wears the alarm tone, email and text amber, drive / calendar / other context', () => {
    expect(APPROVAL_KIND).toEqual({
      email: ['EMAIL', 'watch'], payment: ['PAYMENT', 'alarm'], text: ['TEXT', 'watch'],
      drive: ['DRIVE', 'info'], calendar: ['CALENDAR', 'info'], other: ['OTHER', 'info'],
    });
    const t = (k?: string) => { const n = approvalChip(k); return n.textContent + '=' + n.dataset.tone; };
    expect(['email', 'payment', 'text', 'drive', 'calendar', 'other'].map(t)).toEqual(['EMAIL=watch', 'PAYMENT=alarm', 'TEXT=watch', 'DRIVE=info', 'CALENDAR=info', 'OTHER=info']);
  });

  it('a kind the page does not know is still named, in amber — never blank, never calm', () => {
    expect(approvalChip('crm').textContent + '=' + approvalChip('crm').dataset.tone).toBe('CRM=watch');
    expect(approvalChip(undefined).textContent + '=' + approvalChip(undefined).dataset.tone).toBe('UNKNOWN=watch');
  });

  it('the canonical tone list names the new words', () => {
    const words = between('TONE WORDS (the canonical list)', 'const TONE = {');
    expect(words).toContain("the assistant's\n//     PAYMENT ask wears it too");
    for (const w of ["the assistant's EMAIL and TEXT asks", 'ASKED YOU', 'ON (the assistant), APPROVED', 'ERROR (the assistant)', "the assistant's DRIVE, CALENDAR and\n//     OTHER asks, OFF (the assistant), DENIED, DECIDED"]) {
      expect(words, w).toContain(w);
    }
  });

  it('every chip in the assistant code goes through chip(); no innerHTML; nothing from another host', () => {
    const code = between('// ---------- Your assistant (R28', '// ---------- Today (Morning Brief)');
    expect(code).not.toContain('badge(');
    expect(code).not.toContain('innerHTML');
    expect(code).not.toMatch(/https?:\/\//);
    expect(code).not.toMatch(/\bclass=/); // nodes are built with el(), text with textContent
  });
});

describe('R28 — one row per ask', () => {
  const opened: unknown[] = [];
  const row = pageFn<(a: unknown) => N>('approvalRow', { el, approvalChip, fmtWhen, nb, openApproval: (a: unknown) => opened.push(a) });

  it('its kind chip and time on the first line, the summary on the second; a tap opens the sheet', async () => {
    for (const [a, want] of [[EMAIL, 'EMAIL=watch'], [PAYMENT, 'PAYMENT=alarm'], [{ ...EMAIL, id: 'sevt_t', kind: 'text' }, 'TEXT=watch'],
      [{ ...EMAIL, id: 'sevt_d', kind: 'drive' }, 'DRIVE=info'], [{ ...EMAIL, id: 'sevt_c', kind: 'calendar' }, 'CALENDAR=info'], [{ ...EMAIL, id: 'sevt_o', kind: 'other' }, 'OTHER=info']] as const) {
      const r = row(a);
      expect(r.tag).toBe('button'); // a real button: a 56px thumb target (CSS below)
      expect(r.className).toBe('approw');
      expect(r.dataset.approval).toBe(a.id);
      expect(chipsIn(r)).toEqual([want]);
      expect(r.querySelector('.t')!.textContent).toBe('WHEN(' + a.requestedAt + ')');
      expect(r.querySelector('.sum')!.textContent).toBe(a.summary);
    }
    await row(EMAIL).click();
    expect(opened).toEqual([EMAIL]);
  });

  it('an ask with no summary is still said — by its tool, or in words — never a blank row', () => {
    expect(row({ ...EMAIL, summary: '' }).querySelector('.sum')!.textContent).toBe('gmail.send_message');
    expect(row({ ...EMAIL, summary: '', tool: '' }).querySelector('.sum')!.textContent).toBe('Arbo didn’t say what this is');
  });

  it('a phone number in the summary never splits at its hyphen on a narrow phone', () => {
    const r = row({ ...EMAIL, summary: 'Text SIM-Cedar (757) 555-0142: still want that estimate?' });
    expect(r.querySelector('.sum')!.textContent).toBe('Text SIM-Cedar (757) 555-' + WJ + '0142: still want that estimate?');
  });

  it('rows are 44px+ targets, and work at 320px: the summary wraps under the chip and time', () => {
    expect(css).toMatch(/\n\.approw\{display:grid;grid-template-columns:1fr auto;[^}]*min-height:56px;/);
    expect(css).toContain('.approw .sum{grid-column:1;font-size:15px;font-weight:600;line-height:1.35;overflow-wrap:anywhere}');
    expect(css).toContain(".approw::after{content:'\\203A';grid-column:2;grid-row:1 / span 2;");
  });
});

describe('R28 — the approval sheet', () => {
  it('is a sheet like the others: in SHEETS, so Back, Android back and the iPhone swipe close it', () => {
    expect(pageConst<string[]>('SHEETS')).toEqual(['twin', 'yard', 'bd', 'talk', 'approval']); // R30 Talk's sheet sits beside it (merged)
    expect(html).toContain('<div id="approval" class="sheet">\n  <div class="sheet-head">\n    <button id="approval-close" aria-label="Close"><svg class="hico" aria-hidden="true"><use href="#i-close"/></svg></button>\n    <div id="approval-title"></div>\n  </div>\n  <div id="approval-body"></div>\n</div>');
    expect(html).toContain("$('approval-close').addEventListener('click', () => closeSheet('approval'));");
    const src = fnSrc('openApproval');
    expect(src).toContain("$('approval').classList.add('show');");
    expect(src).toContain("sheetOpened('approval');");
  });

  it('title = summary; every detail as label: value; a body scrolls in its own box', () => {
    const s = sheet();
    s.open(EMAIL);
    expect(s.nodes.approval!.has('show')).toBe(true);
    expect(s.log).toEqual(['opened:approval']);
    expect(s.nodes['approval-title']!.textContent).toBe(EMAIL.summary);
    expect(chipsIn(s.body)).toEqual(['EMAIL=watch']);
    expect(s.body.text()).toContain('Asked WHEN(2026-10-20T13:05:00Z)');
    const rows = s.body.querySelectorAll('.adetail').map((r) => [r.children[0]!.textContent, r.children[1]!.textContent, r.children[1]!.className]);
    expect(rows).toEqual([
      ['To', 'sim-brooks@example.invalid', 'val'],
      ['Subject', 'Your proposal for 14 Simulation Row', 'val'],
      ['Body', EMAIL.details[2]!.value, 'val box'],
    ]);
    // Two big buttons, Approve first; the note waits behind Deny.
    expect(s.body.querySelector('.adecide')!.children.map((n) => n.tag + ':' + n.textContent + (n.hidden ? ':hidden' : ''))).toEqual(['button:Approve', 'div::hidden', 'button:Deny']);
  });

  it('a short value keeps a phone number whole; a body is shown exactly as it will go out; an empty one says so', () => {
    const s = sheet();
    s.open({ ...EMAIL, summary: 'Text (757) 555-0142', details: [{ label: 'To', value: '(757) 555-0142' }, { label: 'Message', value: 'Call 757-555-0199' }, { label: 'Body', value: '' }] });
    expect(s.nodes['approval-title']!.textContent).toBe('Text (757) 555-' + WJ + '0142');
    expect(s.body.querySelectorAll('.adetail').map((r) => r.children[1]!.textContent)).toEqual(['(757) 555-' + WJ + '0142', 'Call 757-555-0199', '(empty)']);
  });

  it('any long value scrolls in a box too, and long values wrap; the buttons are full-width 52px', () => {
    const s = sheet();
    s.open({ ...EMAIL, details: [{ label: 'Subject', value: 'x'.repeat(200) }, { label: 'Message', value: 'short' }] });
    expect(s.body.querySelectorAll('.adetail').map((r) => r.children[1]!.className)).toEqual(['val box', 'val box']);
    expect(css).toContain('.adetail .val{font-size:16px;line-height:1.45;color:var(--ink-1);white-space:pre-wrap;overflow-wrap:anywhere}');
    expect(css).toContain('.adetail .val.box{max-height:min(46vh,420px);overflow-y:auto;');
    expect(css).toContain('.adecide .actbtn{width:100%;margin-top:0}');
    expect(css).toContain('#approval-title{font-family:var(--serif);font-size:19px;font-weight:600;line-height:1.25;color:var(--ink-1);min-width:0;overflow-wrap:anywhere}');
  });

  it('Approve on an email is one tap: allow goes to Arbo, the sheet closes, the row gives way to a plain line', async () => {
    const s = sheet();
    s.open(EMAIL);
    await s.btn(/^Approve$/).click();
    expect(s.sent).toEqual([{ path: '/api/assistant/approvals/sevt_email1', body: { decision: 'allow' } }]);
    expect(s.log).toEqual(['opened:approval', 'closed:approval', 'done:sevt_email1:Approved — Arbo will send it now.']);
  });

  it('Approve on a PAYMENT needs two taps, with the amount on the button', async () => {
    const s = sheet();
    s.open(PAYMENT);
    const yes = s.btn(/^Approve/);
    expect(yes.textContent).toBe('Approve — charge $450.00');
    expect(yes.className).toBe('actbtn charge');
    await yes.click();
    expect(s.sent).toEqual([]); // the first tap only arms it
    expect(yes.textContent).toBe('Tap again to charge $450.00');
    expect(yes.has('armed')).toBe(true);
    s.wait(700); // long enough to have read the armed line
    await yes.click();
    expect(s.sent).toEqual([{ path: '/api/assistant/approvals/sevt_pay1', body: { decision: 'allow' } }]);
    expect(s.log.slice(1)).toEqual(['closed:approval', 'done:sevt_pay1:Approved — Arbo will charge it now.']);
    // The armed button turns the alarm colour, so the second tap is never by accident.
    expect(css).toContain('.actbtn.charge.armed{background:var(--emergency);color:var(--on-emergency)}');
    expect(fnSrc('openApproval')).toContain("if (pay) armTwice(yes, amount ? 'Tap again to charge ' + money : 'Tap again to approve', () => send('allow'), 600);");
  });

  it('a quick double-tap (a bump in the truck) never charges: the second tap must come 600 ms after the armed line shows', async () => {
    const s = sheet();
    s.open(PAYMENT);
    const yes = s.btn(/^Approve/);
    await yes.click();
    s.wait(80); // a double-tap
    await yes.click();
    expect(s.sent).toEqual([]);
    expect(yes.textContent).toBe('Tap again to charge $450.00'); // still armed, still saying what it will do
    expect(yes.has('armed')).toBe(true);
    s.wait(700);
    await yes.click();
    expect(s.sent).toEqual([{ path: '/api/assistant/approvals/sevt_pay1', body: { decision: 'allow' } }]);
    // Only the payment button waits: the roster and retire buttons keep their old behaviour.
    const plain = el('button', '', 'Retire');
    const ran: string[] = [];
    pageFn<(btn: N, armed: string, run: () => unknown, minGap?: number) => void>('armTwice', { Date: { now: () => 5 } })(plain, 'Tap again', () => ran.push('ran'));
    await plain.click(); await plain.click();
    expect(ran).toEqual(['ran']);
  });

  it('a bare number gets its dollar sign; a Square call with no amount says so plainly — a warning, never a garbled "charge"', async () => {
    const s1 = sheet();
    s1.open({ ...PAYMENT, details: [{ label: 'amount', value: '1200' }] });
    expect(s1.btn(/^Approve/).textContent).toBe('Approve — charge $1200');
    // The server's real shape: an Amount row that says there is none.
    const s = sheet();
    s.open(NO_AMOUNT);
    const yes = s.btn(/^Approve/);
    expect(yes.textContent).toBe('Approve — no amount in this request');
    expect(yes.textContent).not.toMatch(/charge No amount/i);
    expect(yes.disabled).toBe(false); // a Square read or an invoice publish carries no amount: Mike decides it, warned
    const warn = s.body.querySelector('.feed-state')!;
    expect(warn.className).toBe('feed-state unread');
    expect(warn.textContent).toBe('Arbo didn’t show an amount for this Square call. Read the details above before you allow it.');
    await yes.click();
    expect(yes.textContent).toBe('Tap again to approve'); // still asks twice
    expect(s.sent).toEqual([]);
    s.wait(700);
    await yes.click();
    expect(s.sent).toEqual([{ path: '/api/assistant/approvals/sevt_pay0', body: { decision: 'allow' } }]);
    expect(s.log).toContain('done:sevt_pay0:Approved — Arbo will do it now.'); // never "will charge it" when nothing says a charge
    // No Amount row at all is the same: no amount, warned, two taps.
    const bare = sheet();
    bare.open({ ...PAYMENT, details: [{ label: 'Customer', value: 'SIM-Alder' }] });
    expect(bare.btn(/^Approve/).textContent).toBe('Approve — no amount in this request');
    const d = sheet();
    d.open(NO_AMOUNT);
    await d.btn(/^Deny/).click(); await d.btn(/^Deny/).click();
    expect(d.sent).toEqual([{ path: '/api/assistant/approvals/sevt_pay0', body: { decision: 'deny' } }]);
  });

  it('a late answer for one ask never closes the sheet of another ask Mike has since opened', async () => {
    let release: (v: unknown) => void = () => {};
    const s = sheet(() => new Promise((r) => { release = r; }));
    s.open(EMAIL);
    const approveA = s.btn(/^Approve$/);
    const pending = approveA.click(); // slow signal: A's answer is still on its way…
    await flush();
    s.open(PAYMENT); // …Mike closes A and opens B
    expect(s.nodes.approval!.dataset.ask).toBe('sevt_pay1');
    release({ ok: true });
    await pending;
    expect(s.log).not.toContain('closed:approval'); // B stays open
    expect(s.log).toContain('done:sevt_email1:Approved — Arbo will send it now.'); // A's row still gives way
    // The sheet that still shows the ask closes as before.
    const same = sheet();
    same.open(EMAIL);
    expect(same.nodes.approval!.dataset.ask).toBe('sevt_email1');
    await same.btn(/^Approve$/).click();
    expect(same.log).toContain('closed:approval');
  });

  it('a text Allow held by quiet hours (409 quiet_hours) says the server’s line and keeps the ask open — never "Already decided"', async () => {
    const line = 'It is 10:30 PM ET — a text can go to a customer only from 8am to 9pm (TCPA quiet hours). Nothing was sent — it is still waiting: allow it after 8am, or deny it.';
    const s = sheet(fail(409, 'quiet_hours', line));
    s.open(TEXT);
    await s.btn(/^Approve$/).click();
    expect(s.out().textContent).toBe(line);
    expect(s.log).toEqual(['opened:approval']); // no re-read, no close, no done line
    expect(s.btn(/^Approve$/).disabled).toBe(false);
    expect(s.btn(/^Deny/).disabled).toBe(false);
  });

  it('an ask with no details is named, and never approved blind', () => {
    const s = sheet();
    s.open({ ...EMAIL, details: [] });
    expect(s.body.querySelectorAll('.adetail')).toHaveLength(0);
    expect(s.body.querySelector('.feed-state')!.className).toBe('feed-state unread');
    expect(s.body.querySelector('.feed-state')!.textContent).toContain('Arbo sent nothing to check for this one');
    expect(s.btn(/^Approve/).disabled).toBe(true);
    expect(s.btn(/^Deny/).disabled).toBe(false);
  });

  it('Deny opens an optional one-line note; the second tap sends it for Arbo', async () => {
    const s = sheet();
    s.open(EMAIL);
    const no = s.btn(/^Deny/);
    await no.click();
    expect(s.sent).toEqual([]);
    const wrap = s.note().parent!;
    expect(wrap.hidden).toBe(false);
    expect(wrap.querySelector('label')!.textContent).toBe('Why, for Arbo (optional)');
    expect(wrap.querySelector('label')!.htmlFor).toBe(s.note().id);
    expect(s.note().focused).toBe(true);
    expect(s.note().className).toBe('input'); // the shared 52px box, 16px+ so iPhone never zooms
    expect(no.textContent).toBe('Deny — tell Arbo');
    s.note().value = '  Wrong address — call him first  ';
    await no.click();
    expect(s.sent).toEqual([{ path: '/api/assistant/approvals/sevt_email1', body: { decision: 'deny', note: 'Wrong address — call him first' } }]);
    expect(s.log.slice(1)).toEqual(['closed:approval', 'done:sevt_email1:Denied — Arbo was told why.']);
  });

  it('a no with no note sends no note, and the line says only that Arbo was told no', async () => {
    const s = sheet();
    s.open(EMAIL);
    await s.btn(/^Deny/).click();
    await s.btn(/^Deny/).click();
    expect(s.sent).toEqual([{ path: '/api/assistant/approvals/sevt_email1', body: { decision: 'deny' } }]);
    expect(s.log.slice(1)).toEqual(['closed:approval', 'done:sevt_email1:Denied — Arbo was told no.']);
  });

  it('a 409 says Already decided and reads the lists again; the buttons stay off and the row is left to the re-read', async () => {
    const s = sheet(fail(409, 'already_decided'));
    s.open(EMAIL);
    await s.btn(/^Approve$/).click();
    expect(s.out().textContent).toBe('Already decided — reading the list again.');
    expect(s.log).toEqual(['opened:approval', 'reread']);
    expect(s.btn(/^Approve$/).disabled).toBe(true);
    expect(s.btn(/^Deny/).disabled).toBe(true);
    const gone = sheet(fail(404, 'not_found'));
    gone.open(EMAIL);
    await gone.btn(/^Approve$/).click();
    expect(gone.out().textContent).toBe('This one is no longer waiting — reading the list again.');
    expect(gone.log).toEqual(['opened:approval', 'reread']);
  });

  it('a 502 shows its own line and keeps the row: nothing closes, the buttons come back for another try', async () => {
    const s = sheet(fail(502, 'send_failed', 'Gmail refused the send — the address bounced. Nothing went out.'));
    s.open(PAYMENT);
    const yes = s.btn(/^Approve/);
    await yes.click(); s.wait(700); await yes.click();
    expect(s.out().textContent).toBe('Gmail refused the send — the address bounced. Nothing went out.');
    expect(s.log).toEqual(['opened:approval']); // no close, no done line
    expect(yes.disabled).toBe(false);
    expect(yes.textContent).toBe('Approve — charge $450.00'); // disarmed, so a retry asks twice again
    expect(s.btn(/^Deny/).disabled).toBe(false);
  });

  it('no signal, a refusal with no line, and a stale key each say so — and the ask stays waiting', async () => {
    const off = sheet(new TypeError('Failed to fetch'));
    off.open(EMAIL);
    await off.btn(/^Approve$/).click();
    expect(off.out().textContent).toBe('Couldn’t reach Arbo — your answer may not have arrived. Tap ↻ to see if it is still waiting.');
    const bad = sheet(fail(500));
    bad.open(EMAIL);
    await bad.btn(/^Approve$/).click();
    expect(bad.out().textContent).toBe('Arbo didn’t take your answer — it is still waiting. Try again.');
    const locked = sheet(fail(401, 'unauthorized'));
    locked.open(EMAIL);
    await locked.btn(/^Approve$/).click();
    expect(locked.out().textContent).toBe('Arbo needs the key again — nothing was decided.');
    expect(locked.log).toEqual(['opened:approval', 'keywall']);
    for (const s of [off, bad, locked]) expect(s.btn(/^Approve$/).disabled).toBe(false);
  });

  it('the plain line says what happens next, per kind', () => {
    expect(['email', 'text', 'payment', 'drive', 'calendar', 'other', 'crm'].map((k) => approvalAnswered({ kind: k }, 'allow'))).toEqual([
      'Approved — Arbo will send it now.', 'Approved — Arbo will send it now.', 'Approved — Arbo will charge it now.',
      'Approved — Arbo will save it now.', 'Approved — Arbo will book it now.', 'Approved — Arbo will do it now.', 'Approved — Arbo will do it now.',
    ]);
  });

  it('after an answer every row for that ask — on Today and on the desk — becomes that line; the others stay', () => {
    const today = el('div'); const desk = el('div');
    const mk = (id: string) => { const r = el('button', 'approw'); r.dataset.approval = id; return r; };
    today.appendChild(mk('A')); today.appendChild(mk('B'));
    const all = el('button', 'hudbtn approw-all', 'All 6 waiting →');
    all.dataset.ids = ['A', 'B', 'C', 'D', 'E', 'F'].join('\n');
    today.appendChild(all);
    desk.appendChild(mk('A'));
    const doc = el('div'); doc.appendChild(today); doc.appendChild(desk);
    const done = pageFn<(id: string, line: string) => void>('approvalDone', { el, document: doc });
    done('A', 'Approved — Arbo will send it now.');
    expect(today.children.map((n) => n.className + ':' + (n.dataset.approval || n.textContent))).toEqual(['storm-muted:Approved — Arbo will send it now.', 'approw:B', 'hudbtn approw-all:All 5 waiting →']);
    expect(desk.children.map((n) => n.className + ':' + n.textContent)).toEqual(['storm-muted:Approved — Arbo will send it now.']);
    done('B', 'Denied — Arbo was told no.');
    expect(all.textContent).toBe('All 4 waiting →'); // Today's count never says more than are waiting
    done('LATE', 'Approved — Arbo will send it now.'); // an ask that came in after Today's read: not one of its N
    expect(all.textContent).toBe('All 4 waiting →'); // …so it never undercounts either
    done('B', 'x');
    expect(all.textContent).toBe('All 4 waiting →');
    for (const id of ['C', 'D', 'E', 'F']) done(id, 'x');
    expect(all.textContent).toBe('All 0 waiting →');
    done('LATE2', 'x'); // nothing left to count: it stays at 0, never "All 1"
    expect(all.textContent).toBe('All 0 waiting →');
  });

  it('reading again refreshes Today’s card and a desk that is drawn — never a desk nobody opened', () => {
    const log: string[] = [];
    const slot = el('div');
    let drawn = false;
    const reread = pageFn<() => void>('assistantReread', {
      document: { getElementById: (id: string) => (id === 'today-assist' ? slot : null) },
      $: () => ({ hasChildNodes: () => drawn }),
      fillAssistToday: (s: N) => log.push(s === slot ? 'today' : 'other'),
      renderAssistant: () => log.push('desk'),
    });
    reread();
    expect(log).toEqual(['today']);
    drawn = true;
    reread();
    expect(log).toEqual(['today', 'today', 'desk']);
  });
});

// ---------- Today's card against a faked server ----------
type Answer = unknown | Error;
function today(status: Answer, approvals: Answer) {
  const slot = el('div', 'slot assist');
  const log: string[] = [];
  const fill = pageFn<(s: N) => Promise<void>>('fillAssistToday', {
    ASSIST_TODAY_GEN: 0, el, RETRY, feedLine,
    api: async (p: string) => {
      const a = p === '/api/assistant/status' ? status : p === '/api/assistant/approvals' ? approvals : fail(404);
      if (a instanceof Error) throw a;
      return a;
    },
    approvalRow: (a: Approval) => { const r = el('button', 'approw', a.summary); r.dataset.approval = a.id; return r; },
    switchTab: (t: string) => log.push('tab:' + t),
    renderAssistant: () => log.push('desk'),
  });
  return { slot, log, run: () => fill(slot) };
}
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...EMAIL, id: 'sevt_' + i, summary: 'Ask ' + i }));
const READY = { state: 'ready', missing: [], reason: null, sessionsOpen: 1, lastEventAt: '2026-10-20T13:00:00Z' };

describe('R28 — Today: "Waiting for your OK"', () => {
  it('sits under the storm alert, the emergency leads and the law flag, above the run — its place set before any read', () => {
    const t = fnSrc('renderToday');
    const at = (s: string) => { const i = t.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    expect(at('v.appendChild(stormSlot);')).toBeLessThan(at('v.appendChild(emgSlot);'));
    expect(at('v.appendChild(lawSlot);')).toBeLessThan(at("const assistSlot = el('div', 'slot assist');"));
    expect(at("assistSlot.id = 'today-assist';")).toBeLessThan(at('fillAssistToday(assistSlot);'));
    expect(at('fillAssistToday(assistSlot);')).toBeLessThan(at("const day = el('div');"));
    expect(css).toContain('\n.slot:empty{display:none}'); // nothing waiting: no empty card
    expect(css).toContain('@media (min-width:900px){#view-today .assist,#view-assistant .assist{grid-column:1 / -1}}');
  });

  it('one row per ask under the title', async () => {
    const t = today(READY, { approvals: many(2) });
    await t.run();
    expect(t.slot.children.map((n) => n.className + ':' + n.textContent)).toEqual(['panel-title:Waiting for your OK', 'approw:Ask 0', 'approw:Ask 1']);
  });

  it('more than 4: the first 4, then "All N waiting →" to the Assistant desk', async () => {
    const t = today(READY, { approvals: many(6) });
    await t.run();
    expect(t.slot.querySelectorAll('.approw')).toHaveLength(4);
    const all = t.slot.children[t.slot.children.length - 1]!;
    expect(all.className + ':' + all.textContent).toBe('hudbtn approw-all:All 6 waiting →');
    expect(all.dataset.ids).toBe(['sevt_0', 'sevt_1', 'sevt_2', 'sevt_3', 'sevt_4', 'sevt_5'].join('\n'));
    await all.click();
    expect(t.log).toEqual(['tab:assistant', 'desk']);
  });

  it('nothing at all on Today when the assistant is off or not set up — and nothing when nothing is waiting', async () => {
    for (const [st, ap] of [
      [{ ...READY, state: 'off' }, fail(503, 'assistant_off')],
      [{ ...READY, state: 'not_set_up', missing: ['ARBO_AGENT_ID'] }, fail(503, 'assistant_not_set_up')],
      [fail(undefined), fail(503, 'assistant_off')], // the status read failed, but the approvals say why: off
      [fail(undefined), fail(503, 'assistant_not_set_up')],
      [{ ...READY, state: 'off' }, { approvals: many(1) }], // a race: the status wins, off is off
      [READY, { approvals: [] }],
      [fail(401, 'unauthorized'), fail(401, 'unauthorized')], // the key wall is the brief's to show
    ] as const) {
      const t = today(st, ap);
      t.slot.appendChild(el('div', 'old')); // an earlier read's rows are cleared
      await t.run();
      expect(t.slot.children, JSON.stringify(st)).toHaveLength(0);
    }
  });

  it('a read that failed is ONE named line — never a quiet nothing (§1B)', async () => {
    for (const ap of [fail(503, 'unreadable'), fail(500), new TypeError('Failed to fetch'), {}, { approvals: null }]) {
      const t = today(READY, ap);
      await t.run();
      expect(t.slot.children.map((n) => n.className + ':' + n.textContent)).toEqual(['feed-state unread:Assistant: couldn’t read what’s waiting. ' + RETRY]);
    }
    const t = today(fail(undefined), fail(503, 'unreadable')); // both reads failed: still one line
    await t.run();
    expect(t.slot.children).toHaveLength(1);
  });

  it('a status read that failed is named too — an assistant in error never hides behind an empty list (§1B)', async () => {
    const line = 'feed-state unread:Assistant status: ' + FEED_WORD.unread + '. ' + RETRY;
    for (const st of [fail(500), new TypeError('Failed to fetch'), { nope: true }]) {
      const t = today(st, { approvals: [] });
      await t.run();
      expect(t.slot.children.map((n) => n.className + ':' + n.textContent), JSON.stringify(st)).toEqual([line]);
    }
    const rows = today(fail(500), { approvals: many(1) });
    await rows.run();
    expect(rows.slot.children.map((n) => n.className + ':' + n.textContent)).toEqual(['panel-title:Waiting for your OK', line, 'approw:Ask 0']);
    const key = today(fail(401, 'unauthorized'), { approvals: [] }); // the key wall says that one
    await key.run();
    expect(key.slot.children).toHaveLength(0);
  });

  it('the daily office check says where it stands on Today: done, running, or a day it could not run — named, in its own words', async () => {
    const said = async (state: string, line: string, approvals: Answer = { approvals: [] }) => {
      const t = today({ ...READY, officeCheck: { day: '2026-10-20', state, line } }, approvals);
      await t.run();
      return t.slot.children.map((n) => n.className + ':' + n.textContent);
    };
    expect(await said('done', 'Today’s office check is done — its report is in More → Assistant.')).toEqual(['storm-muted:Today’s office check is done — its report is in More → Assistant.']);
    expect(await said('working', 'Today’s office check is running.')).toEqual(['storm-muted:Today’s office check is running.']);
    expect(await said('missed', 'Today’s office check did not run.')).toEqual(['feed-state unread:Today’s office check did not run.']);
    expect(await said('error', 'Today’s office check could not start.')).toEqual(['feed-state unread:Today’s office check could not start.']);
    expect(await said('done', 'Done.', { approvals: many(1) })).toEqual(['panel-title:Waiting for your OK', 'approw:Ask 0', 'storm-muted:Done.']);
  });

  it('a done office check shows its report on Today, under its line, in its own words and line breaks', async () => {
    const report = 'Weather: rain Sunday.\nUnpaid invoices: one past due.';
    const t = today({ ...READY, officeCheck: { day: '2026-10-20', state: 'done', line: 'Today’s office check is done. Its report:', report: { at: '2026-10-20T11:20:00Z', text: report } } }, { approvals: [] });
    await t.run();
    expect(t.slot.children.map((n) => n.className + ':' + n.textContent)).toEqual(['storm-muted:Today’s office check is done. Its report:', 'asst-report:' + report]);
    // A report that is not words is left out — the line still says where it stands.
    const odd = today({ ...READY, officeCheck: { day: '2026-10-20', state: 'done', line: 'Done.', report: { text: 42 } } }, { approvals: [] });
    await odd.run();
    expect(odd.slot.children.map((n) => n.className)).toEqual(['storm-muted']);
    expect(css).toMatch(/\n\.asst-report\{[^}]*white-space:pre-wrap[^}]*\}/);
  });

  it('a problem the assistant reports is named on the card, with the rows still there to decide', async () => {
    const err = { ...READY, state: 'error', reason: 'Anthropic refused the API key.' };
    const t = today(err, { approvals: many(1) });
    await t.run();
    expect(t.slot.children.map((n) => n.className + ':' + n.textContent)).toEqual([
      'panel-title:Waiting for your OK',
      'feed-state unread:Assistant: Anthropic refused the API key. Open More → Assistant.',
      'approw:Ask 0',
    ]);
    const quiet = today({ ...err, reason: null }, { approvals: [] });
    await quiet.run();
    expect(quiet.slot.children.map((n) => n.textContent)).toEqual(['Assistant: something is wrong and Arbo didn’t say what. Open More → Assistant.']);
  });

  it('a newer read owns the card: a slow older one never draws over it', async () => {
    let release: (v: unknown) => void = () => {};
    const slow = new Promise((r) => { release = r; });
    let calls = 0;
    const slot = el('div');
    const fill = pageFn<(s: N) => Promise<void>>('fillAssistToday', {
      ASSIST_TODAY_GEN: 0, el, RETRY, switchTab: () => {}, renderAssistant: () => {},
      approvalRow: (a: Approval) => el('button', 'approw', a.summary),
      api: async (p: string) => {
        if (p === '/api/assistant/status') return READY;
        calls++;
        return calls === 1 ? slow : { approvals: many(1) };
      },
    });
    const first = fill(slot);
    await fill(slot);
    release({ approvals: many(3) });
    await first;
    expect(slot.querySelectorAll('.approw')).toHaveLength(1);
  });
});

// ---------- the Assistant desk against a faked server ----------
function desk(status: Answer, approvals: Answer, activity: Answer) {
  const v = el('div');
  const log: string[] = [];
  const render = pageFn<() => Promise<void>>('renderAssistant', {
    ASSIST_GEN: 0, $: (id: string) => { expect(id).toBe('view-assistant'); return v; }, el, chip, feedLine, assistGap, activityRow,
    assistStateLine, ASSIST_STATE, showKeywall: () => log.push('keywall'),
    approvalRow: (a: Approval) => { const r = el('button', 'approw', a.summary); r.dataset.approval = a.id; return r; },
    api: async (p: string) => {
      const a = { '/api/assistant/status': status, '/api/assistant/approvals': approvals, '/api/assistant/activity': activity }[p];
      if (a === undefined) throw new Error('unexpected read ' + p);
      if (a instanceof Error) throw a;
      return a;
    },
  });
  return { v, log, run: render, slot: (title: string) => v.children.find((c) => c.children[0] && c.children[0].textContent === title)! };
}
const ITEMS = [
  { at: '2026-10-20T13:12:00Z', sessionId: 'sesn_2', kind: 'decided', text: 'You approved: Invoice SIM-Alder', permission: 'allow' },
  { at: '2026-10-20T13:10:00Z', sessionId: 'sesn_2', kind: 'waiting', text: 'Asked you: Invoice SIM-Alder', tool: 'square.create_invoice', permission: 'ask' },
  { at: '2026-10-20T13:08:00Z', sessionId: 'sesn_2', kind: 'tool', text: 'Read 3 texts from Quo', tool: 'quo.fetch-messages', permission: 'allow' },
  { at: '2026-10-20T13:01:00Z', sessionId: 'sesn_1', kind: 'error', text: 'The session stopped: budget reached' },
  { at: '2026-10-20T13:00:00Z', sessionId: 'sesn_1', kind: 'started', text: 'Started on a new text from SIM-Brooks' },
];

describe('R28 — the Assistant desk', () => {
  it('heading: Front office / Your assistant / one line — then status, the two rule lists, the waiting list and the feed', async () => {
    const d = desk(READY, { approvals: many(2) }, { items: ITEMS });
    await d.run();
    const head = d.v.children[0]!;
    expect(head.className).toBe('viewhead');
    expect(head.children.map((c) => c.tag + ':' + c.className + ':' + c.textContent)).toEqual([
      'div:eyebrow:Front office', 'h1::Your assistant',
      'p::It works your texts, email, calendar, Drive and Square — and asks you first before anything goes out or gets charged.',
    ]);
    expect(d.v.children.slice(1).map((c) => c.children[0]!.textContent)).toEqual(['Status', 'What it asks you first', 'What it does on its own', 'Waiting for your OK', 'What it did']);
    expect(d.v.children[1]!.className).toBe('slot assist'); // the status spans both columns on a wide screen
  });

  it('what it asks you first, and what it does on its own, in plain words', async () => {
    const d = desk(READY, { approvals: [] }, { items: [] });
    await d.run();
    const lines = (t: string) => d.slot(t).querySelectorAll('li').map((l) => l.textContent);
    expect(lines('What it asks you first')).toEqual([
      'Every email, before it goes out.',
      'Every text, before it goes out. Texts to customers also need their consent, stop for good on STOP, and only go 8am–9pm ET.',
      'Every calendar booking. A guest is named loudly — Google emails them an invite.',
      'Every Drive write. It never deletes or shares a file.',
      'Every Square invoice or charge.',
    ]);
    expect(lines('What it does on its own')).toEqual([
      'Reads your inbox, texts and calls.',
      'Drafts — nothing a draft says goes out without your OK.',
      'One office check a day, 7am Monday to Saturday: weather for today’s and tomorrow’s jobs, unpaid invoices, equipment due, what waits on you. It reports here; anything it wants to send still asks.',
      'Never edits, moves or deletes an event.',
    ]);
    expect(d.slot('What it does on its own').querySelector('ul')!.className).toBe('asst-list own');
  });

  it('status, each state: ready is a green On; off names the Railway switch; not set up names what is missing; error says why', async () => {
    const line = async (st: unknown) => {
      const d = desk(st, { approvals: [] }, { items: [] });
      await d.run();
      const s = d.slot('Status');
      return chipsIn(s).join(',') + ' | ' + s.querySelector('.asst-state')!.children[1]!.textContent;
    };
    expect(await line(READY)).toBe('ON=good | On — working on 1 thing · last heard from WHEN(2026-10-20T13:00:00Z)');
    expect(await line({ ...READY, sessionsOpen: 0, lastEventAt: null })).toBe('ON=good | On — nothing in progress · not heard from yet');
    expect(await line({ ...READY, lastEventAt: 'not a time' })).toBe('ON=good | On — working on 1 thing'); // unreadable, so left out — never "not heard from yet"
    expect(await line({ ...READY, sessionsOpen: undefined })).toBe('ON=good | On — Arbo didn’t say what it is working on · last heard from WHEN(2026-10-20T13:00:00Z)');
    expect(await line({ ...READY, state: 'off' })).toBe('OFF=info | Off — Railway switch ARBO_AGENT is not live');
    expect(await line({ ...READY, state: 'not_set_up', missing: ['ARBO_AGENT_ID', 'ARBO_AGENT_VAULT_ID'] })).toBe('NOT SET UP=watch | Not set up — missing: ARBO_AGENT_ID, ARBO_AGENT_VAULT_ID');
    expect(await line({ ...READY, state: 'not_set_up', missing: [] })).toBe('NOT SET UP=watch | Not set up — missing: Arbo didn’t say what');
    expect(await line({ ...READY, state: 'error', reason: 'Anthropic refused the API key.' })).toBe('ERROR=stop | Anthropic refused the API key.');
    expect(await line({ ...READY, state: 'starting' })).toBe('STARTING=watch | Arbo reported “starting”, a state this page doesn’t know');
    // At 320px the line drops under its chip, so a variable name never breaks mid-word.
    expect(css).toContain('.asst-state{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;');
    expect(css).toContain('.asst-state span:last-child{flex:1 1 220px;min-width:0;overflow-wrap:anywhere}');
  });

  it('the status block carries today’s office check line under the state, in its own words', async () => {
    const d = desk({ ...READY, officeCheck: { day: '2026-10-20', state: 'missed', line: 'Today’s office check did not run.' } }, { approvals: [] }, { items: [] });
    await d.run();
    expect(d.slot('Status').children.map((n) => n.className).slice(1)).toEqual(['asst-state', 'feed-state unread']);
    expect(d.slot('Status').children[2]!.textContent).toBe('Today’s office check did not run.');
    const ok = desk({ ...READY, officeCheck: { day: '2026-10-20', state: 'done', line: 'Done.' } }, { approvals: [] }, { items: [] });
    await ok.run();
    expect(ok.slot('Status').children[2]!.className + ':' + ok.slot('Status').children[2]!.textContent).toBe('storm-muted:Done.');
    const none = desk(READY, { approvals: [] }, { items: [] });
    await none.run();
    expect(none.slot('Status').children).toHaveLength(2); // nothing due today: no line
    const rep = desk({ ...READY, officeCheck: { day: '2026-10-20', state: 'done', line: 'Done. Its report:', report: { at: '2026-10-20T11:20:00Z', text: 'Weather: clear.' } } }, { approvals: [] }, { items: [] });
    await rep.run();
    expect(rep.slot('Status').children.slice(2).map((n) => n.className + ':' + n.textContent)).toEqual(['storm-muted:Done. Its report:', 'asst-report:Weather: clear.']);
  });

  it('a status Arbo could not read is named, never drawn as off (§1B)', async () => {
    for (const st of [fail(500), new TypeError('Failed to fetch'), { nope: true }, { ...READY, state: '' }]) {
      const d = desk(st, { approvals: [] }, { items: [] });
      await d.run();
      const s = d.slot('Status');
      expect(s.children.map((n) => n.className + ':' + n.textContent)).toEqual(['panel-title:Status', 'feed-state unread:Assistant status: ' + FEED_WORD.unread + '. ' + RETRY]);
    }
  });

  it('the waiting list: every ask as a row; a real empty is said as one; off, not set up and unreadable each in their own words', async () => {
    const rows = desk(READY, { approvals: many(6) }, { items: [] });
    await rows.run();
    expect(rows.slot('Waiting for your OK').querySelectorAll('.approw')).toHaveLength(6); // the desk shows them all
    const said = async (ap: Answer) => {
      const d = desk(READY, ap, { items: [] });
      await d.run();
      const n = d.slot('Waiting for your OK').children[1]!;
      return n.className + ':' + n.textContent;
    };
    expect(await said({ approvals: [] })).toBe('storm-muted:Nothing is waiting for your OK.');
    expect(await said(fail(503, 'assistant_off'))).toBe('feed-state cut:Waiting for your OK: off on purpose — nothing shows here while the assistant is off.');
    expect(await said(fail(503, 'assistant_not_set_up'))).toBe('feed-state unset:Waiting for your OK: not set up yet — nothing shows here until the assistant is set up.');
    expect(await said(fail(503, 'unreadable'))).toBe('feed-state unread:Waiting for your OK: couldn’t read it. ' + RETRY);
    expect(await said({})).toBe('feed-state unread:Waiting for your OK: couldn’t read it. ' + RETRY);
  });

  it('the activity feed: newest first as sent, time + text, a chip for an ask, an answer and a problem', async () => {
    const d = desk(READY, { approvals: [] }, { items: ITEMS });
    await d.run();
    const feed = d.slot('What it did').querySelectorAll('.actrow');
    expect(feed.map((r) => r.querySelector('.t')!.textContent + ' | ' + chipsIn(r).join(',') + ' | ' + r.querySelector('.txt')!.textContent.split(WJ).join(''))).toEqual([
      'WHEN(2026-10-20T13:12:00Z) | APPROVED=good | You approved: Invoice SIM-Alder',
      'WHEN(2026-10-20T13:10:00Z) | ASKED YOU=watch | Asked you: Invoice SIM-Alder',
      'WHEN(2026-10-20T13:08:00Z) |  | Read 3 texts from Quo',
      'WHEN(2026-10-20T13:01:00Z) | ERROR=stop | The session stopped: budget reached',
      'WHEN(2026-10-20T13:00:00Z) |  | Started on a new text from SIM-Brooks',
    ]);
  });

  it('activity chips: denied and an answer with no word are context; a row with no text is never blank', () => {
    const c = (it: Record<string, unknown>) => chipsIn(activityRow({ at: 'x', text: 't', ...it })).join(',');
    expect(c({ kind: 'decided', permission: 'deny' })).toBe('DENIED=info');
    expect(c({ kind: 'decided' })).toBe('DECIDED=info');
    expect(c({ kind: 'message' })).toBe('');
    expect(c({ kind: 'done' })).toBe('');
    expect(activityRow({ at: 'x', kind: 'tool', tool: 'gmail.search_threads' }).querySelector('.txt')!.textContent).toBe('gmail.search_threads');
    expect(activityRow({ at: 'x', kind: 'tool' }).querySelector('.txt')!.textContent).toBe('Arbo didn’t say');
  });

  it('a long feed shows 30, and the rest is one tap away', async () => {
    const items = Array.from({ length: 41 }, (_, i) => ({ at: 't' + i, sessionId: 's', kind: 'message', text: 'Line ' + i }));
    const d = desk(READY, { approvals: [] }, { items });
    await d.run();
    const slot = d.slot('What it did');
    expect(slot.querySelectorAll('.actrow')).toHaveLength(30);
    const all = slot.all().find((n) => n.tag === 'button')!;
    expect(all.textContent).toBe('Show all 41');
    expect(all.className).toBe('minibtn'); // a 48px target
    await all.click();
    expect(slot.querySelectorAll('.actrow')).toHaveLength(41);
    expect(slot.all().some((n) => n.tag === 'button')).toBe(false);
  });

  it('the feed’s own gaps: empty is said as empty; off, not set up and unreadable named', async () => {
    const said = async (act: Answer) => {
      const d = desk(READY, { approvals: [] }, act);
      await d.run();
      const n = d.slot('What it did').children[1]!;
      return n.className + ':' + n.textContent;
    };
    expect(await said({ items: [] })).toBe('storm-muted:Nothing on record yet.');
    expect(await said(fail(503, 'assistant_off'))).toBe('feed-state cut:What it did: off on purpose — nothing shows here while the assistant is off.');
    expect(await said(fail(503, 'assistant_not_set_up'))).toBe('feed-state unset:What it did: not set up yet — nothing shows here until the assistant is set up.');
    expect(await said(new TypeError('Failed to fetch'))).toBe('feed-state unread:What it did: couldn’t read it. ' + RETRY);
  });

  it('a stale key goes to the key wall; a newer render owns the desk', async () => {
    const d = desk(fail(401, 'unauthorized'), fail(401, 'unauthorized'), fail(401, 'unauthorized'));
    await d.run();
    expect(d.log).toEqual(['keywall']);
    expect(fnSrc('renderAssistant')).toContain('if (gen !== ASSIST_GEN) return; // a newer render owns the desk');
  });

  it('the gap words: off is grey (on purpose), not set up amber, anything else a read that failed', () => {
    expect(assistGap(fail(503, 'assistant_off'), 'X').className).toBe('feed-state cut');
    expect(assistGap(fail(503, 'assistant_not_set_up'), 'X').className).toBe('feed-state unset');
    expect(assistGap(fail(503, 'unreadable'), 'X').className).toBe('feed-state unread');
    expect(assistGap(null, 'X').className).toBe('feed-state unread');
  });

  it('the state line for an unknown state never claims on or off', () => {
    expect(assistStateLine({ state: 'paused' })).toBe('Arbo reported “paused”, a state this page doesn’t know');
    expect(ASSIST_STATE).toEqual({ ready: ['ON', 'good'], off: ['OFF', 'info'], not_set_up: ['NOT SET UP', 'watch'], error: ['ERROR', 'stop'] });
  });
});

describe('R28 — the desk in the shell: More tile, title, Back, ↻ and start-up', () => {
  it('a view of its own, titled Assistant, behind More: Back lands on More; Back redraws it only if never drawn', () => {
    expect(html).toContain('  <div id="view-learn" class="view"></div>\n  <div id="view-assistant" class="view"></div>\n</main>');
    expect(pageConst<Record<string, string>>('VIEW_TITLES').assistant).toBe('Assistant');
    expect(pageConst<Record<string, string>>('NAV_PARENT').assistant).toBe('more');
    expect(oneLine('const NAV_DRAW = {')).toContain('assistant: () => renderAssistant()');
    const sw = fnSrc('switchTab');
    expect(sw).toContain("'measure', 'learn', 'assistant']) {");
    expect(sw).toContain("['book', 'followups', 'perf', 'more', 'permits', 'agents', 'measure', 'learn', 'assistant'].indexOf(which) !== -1");
    expect(fnSrc('refreshActiveMoreView')).toContain('assistant: renderAssistant');
    expect(html).toContain("    if (want === 'learn') renderLearn();\n    if (want === 'assistant') renderAssistant();\n");
  });

  it('navBack closes the approval sheet before anything else', () => {
    const calls: string[] = [];
    const back = pageFn<() => void>('navBack', {
      SHEETS: pageConst<string[]>('SHEETS'),
      $: (id: string) => ({ classList: { contains: () => id === 'approval' } }),
      closeSheet: (id: string) => calls.push('close:' + id),
      history: { state: { v: 'assistant', d: 2 }, back: () => calls.push('back') },
      CUR_TAB: 'assistant', NAV_PARENT: {}, navShow: () => calls.push('show'),
    });
    back();
    expect(calls).toEqual(['close:approval']);
  });

  // renderMore against stand-ins; `approvals` is what the assistant's read answers.
  async function more(approvals: Answer) {
    const v = el('div');
    const go: string[] = [];
    const render = pageFn<() => void>('renderMore', {
      $: () => v, el, icon: (id: string) => el('svg', 'ico', id),
      api: async (p: string) => {
        if (p === '/api/reception/status') return { linkCut: false };
        expect(p).toBe('/api/assistant/approvals');
        if (approvals instanceof Error) throw approvals;
        return approvals;
      },
      switchTab: (t: string) => go.push('tab:' + t), renderAssistant: () => go.push('desk'),
      renderAgents: () => {}, renderLearn: () => {}, renderMeasure: () => {}, renderPermits: () => {},
      themePref: () => 'auto', setTheme: () => {}, installCard: () => el('div'), location: {}, window: {},
    });
    render();
    await flush();
    const tile = v.querySelector('.grid-tiles')!.children[0]!;
    return { tile, go };
  }

  it('More: an Assistant tile leads the grid, with the shield icon and a count badge when asks wait', async () => {
    expect(sprite).toContain('<symbol id="i-shield"');
    const { tile, go } = await more({ approvals: many(3) });
    expect(tile.querySelector('svg')!.textContent).toBe('i-shield');
    expect(tile.querySelector('b')!.textContent).toBe('Assistant');
    expect(tile.querySelector('small')!.textContent).toBe('Asks you first');
    const count = tile.querySelector('.count')!;
    expect(count.textContent).toBe('3');
    expect(count.attrs['aria-hidden']).toBe('true');
    expect(tile.attrs['aria-label']).toBe('Assistant: 3 waiting for your OK');
    await tile.click();
    expect(go).toEqual(['tab:assistant', 'desk']);
    expect(css).toContain('.grid-tiles .gtile{position:relative}');
    expect(css).toMatch(/\n\.gtile \.count\{position:absolute;top:10px;right:10px;[^}]*background:var\(--gold-5\);color:#221A02;/);
  });

  it('More: nothing waiting is no badge; off, not set up and a failed read are said on the tile in words (§1B)', async () => {
    const none = await more({ approvals: [] });
    expect(none.tile.querySelector('.count')).toBeNull();
    expect(none.tile.attrs['aria-label']).toBeUndefined();
    const small = async (a: Answer) => (await more(a)).tile.querySelector('small')!.textContent;
    expect(await small(fail(503, 'assistant_off'))).toBe('Switched off');
    expect(await small(fail(503, 'assistant_not_set_up'))).toBe('Not set up yet');
    expect(await small(fail(503, 'unreadable'))).toBe('Couldn’t read what’s waiting');
    expect(await small(new TypeError('Failed to fetch'))).toBe('Couldn’t read what’s waiting');
    expect(await small({})).toBe('Couldn’t read what’s waiting');
    expect(await small(fail(401, 'unauthorized'))).toBe('Asks you first'); // the key wall says that one
  });
});
