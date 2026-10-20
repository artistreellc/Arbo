// R28: what Mike sees before he allows one action. A paused tool call is
// turned into an Approval card — a kind, one plain-English line, and the
// details he needs to decide: the REAL recipient, subject and body of an
// email, the number and words of a text, the amount and customer of a Square
// call, the file and folder of a Drive write, the time of a calendar event.
//
// Nothing in a card is invented. Every value is read from the tool call's own
// input; a field the call does not carry (a reply's recipient, a saved
// draft's text) is NAMED as not shown, never left to look complete (§1B).
// Every input field the builder does not lay out itself is still listed, so
// a card can never hide part of what will happen.
//
// Cards carry customer contact by ruling (R17: the keywalled app may show
// it). They never reach a log — the watcher logs counts and ids only.

import type { AgentEvent } from './client.js';

export type ApprovalKind = 'email' | 'payment' | 'text' | 'drive' | 'calendar' | 'other';

export interface ApprovalDetail {
  label: string;
  value: string;
}

/** Long bodies are cut here, with a mark that says so. */
export const BODY_LIMIT = 4000;

export function clip(s: string, limit = BODY_LIMIT): string {
  return s.length > limit ? `${s.slice(0, limit)} … [truncated — ${s.length - limit} more characters not shown]` : s;
}

type Family = 'gmail' | 'square' | 'quo' | 'drive' | 'calendar' | null;

/** Which service an MCP server is, from the name Mike gave it in the agent config. */
export function familyOf(server: string | undefined): Family {
  const s = (server ?? '').toLowerCase();
  if (!s) return null;
  if (/gmail|mail/.test(s)) return 'gmail';
  if (/square/.test(s)) return 'square';
  if (/quo|openphone/.test(s)) return 'quo';
  if (/drive/.test(s)) return 'drive';
  if (/calendar|gcal/.test(s)) return 'calendar';
  return null;
}

const norm = (name: string): string => name.toLowerCase().replace(/-/g, '_');

/** e.g. 'gmail.send_message'; a built-in agent tool is just its name ('bash'). */
export function toolLabel(ev: Pick<AgentEvent, 'name' | 'mcp_server_name'>): string {
  const name = ev.name ?? 'unknown_tool';
  return ev.mcp_server_name ? `${ev.mcp_server_name}.${name}` : name;
}

export function classify(server: string | undefined, name: string): ApprovalKind {
  const n = norm(name);
  switch (familyOf(server)) {
    case 'gmail':
      return /^(send_message|send_email|send_draft|send|reply|reply_all|forward)$/.test(n) ? 'email' : 'other';
    case 'square':
      return 'payment';
    case 'quo':
      // send-message / send-bulk-messages / send-group-message. Contact, note
      // and task writes are 'other'.
      return /(^|_)send(_|$)/.test(n) ? 'text' : 'other';
    case 'drive':
      return 'drive';
    case 'calendar':
      return 'calendar';
    default:
      return 'other';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

/** A value as Mike reads it: lists joined, objects as JSON, binary named and not dumped. */
function show(key: string, v: unknown): string {
  if (v == null) return '';
  if (/^base64content$|^content_base64$/i.test(key) && typeof v === 'string') return `[file content, ${v.length} characters of base64 — not shown]`;
  if (key === 'attachments' && Array.isArray(v)) {
    return v.map((a) => (isRecord(a) && typeof a.filename === 'string' && a.filename ? a.filename : '(attachment with no name)')).join(', ');
  }
  if (key === 'attendees' && Array.isArray(v)) {
    return v.map((a) => (isRecord(a) ? str(a.email) || str(a.displayName) : str(a))).filter(Boolean).join(', ');
  }
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.join(', ');
  return JSON.stringify(v);
}

/** HTML mail shown as its words. A reading aid only — never sent anywhere. */
function textOfHtml(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Builds the card: laid-out fields first, then every input field not yet shown. */
class Card {
  readonly details: ApprovalDetail[] = [];
  private readonly used = new Set<string>();
  constructor(private readonly input: Record<string, unknown>) {}
  get(key: string): unknown {
    this.used.add(key);
    return this.input[key];
  }
  text(key: string): string {
    return show(key, this.get(key));
  }
  add(label: string, value: string): void {
    if (value.trim() !== '') this.details.push({ label, value: clip(value) });
  }
  field(label: string, key: string): string {
    const v = this.text(key);
    this.add(label, v);
    return v;
  }
  finish(): ApprovalDetail[] {
    for (const [k, v] of Object.entries(this.input)) {
      if (this.used.has(k)) continue;
      this.add(k, show(k, v));
    }
    return this.details;
  }
}

/** A dollar figure in words going to a customer — R3 / R14 still hold under R28. */
const MONEY = /\$\s?\d/;
const MONEY_HEADS_UP = 'Mentions a dollar amount. Arbo never tells a customer a price, the $500 minimum, or any dollar figure (R3, R14) — allow it only if that number is yours to send.';

/**
 * The words of an email, both versions when both are sent: the plain body,
 * and the HTML one as most mail apps show it (as text). Returns all of it,
 * for the dollar-figure check.
 */
function emailBody(c: Card, label: string, plainKey: string, emptyNote: string): string {
  const plain = c.text(plainKey);
  const html = textOfHtml(c.text('htmlBody'));
  if (plain) c.add(label, plain);
  if (html && html !== plain.trim()) c.add(plain ? `${label} (HTML version, as most mail apps show it)` : label, html);
  if (!plain && !html && emptyNote) c.add(label, emptyNote);
  return `${plain}\n${html}`;
}

function describeEmail(c: Card, name: string): string {
  const n = norm(name);
  if (n === 'reply' || n === 'reply_all') {
    const messageId = c.text('messageId');
    const to = c.field('To', 'to');
    if (!to) c.add('To', `The sender of message ${messageId || '(no id given)'} — Gmail fills in the address; open the thread to see who.`);
    const all = c.get('replyAll') === true || n === 'reply_all';
    if (all) c.add('Reply all', 'Yes — everyone on the thread gets it.');
    c.field('Cc', 'cc');
    c.field('Bcc', 'bcc');
    const body = emailBody(c, 'Body', 'body', '(empty)');
    c.add('Replying to message', messageId);
    c.field('Attachments', 'attachments');
    if (MONEY.test(body)) c.add('Heads-up', MONEY_HEADS_UP);
    return `Reply${all ? ' all' : ''} to email ${messageId || '(no id)'}${to ? ` → ${to}` : ''}`;
  }
  if (n === 'forward') {
    const messageId = c.text('messageId');
    const to = c.field('To', 'to');
    c.field('Cc', 'cc');
    c.field('Bcc', 'bcc');
    const note = emailBody(c, 'Note added', 'forwardText', '');
    c.add('Forwarding message', `${messageId || '(no id given)'} — the whole original email goes with it.`);
    c.field('Attachments', 'attachments');
    if (MONEY.test(note)) c.add('Heads-up', MONEY_HEADS_UP);
    return `Forward email ${messageId || '(no id)'} to ${to || '(no recipient given)'}`;
  }
  const draftId = c.text('draftId');
  const to = c.field('To', 'to');
  c.field('Cc', 'cc');
  c.field('Bcc', 'bcc');
  const subject = c.field('Subject', 'subject');
  if (draftId) {
    c.add('Saved draft', draftId);
    c.add('Heads-up', 'This sends a draft already saved in Gmail — its words are NOT in this request. Open Gmail → Drafts and read it before you allow.');
    if (!to) return `Send saved Gmail draft ${draftId}`;
  }
  const body = emailBody(c, 'Body', 'body', draftId ? '' : '(empty)');
  c.field('Attachments', 'attachments');
  c.field('In thread', 'replyThreadId');
  c.field('Replying to message', 'replyToMessageId');
  if (MONEY.test(body) || MONEY.test(subject)) c.add('Heads-up', MONEY_HEADS_UP);
  return `Email ${to || '(no recipient given)'}: ${subject || '(no subject)'}`;
}

function describeText(c: Card, name: string): string {
  const to = c.field('Number', 'to') || c.field('Numbers', 'recipients') || c.field('Numbers', 'to_numbers');
  c.field('From', 'from');
  const message = c.field('Message', 'content') || c.field('Message', 'text') || c.field('Message', 'body') || c.field('Message', 'message');
  if (MONEY.test(message)) c.add('Heads-up', MONEY_HEADS_UP);
  const preview = message.length > 80 ? `${message.slice(0, 80)}…` : message;
  return `${norm(name).includes('bulk') ? 'Bulk text' : norm(name).includes('group') ? 'Group text' : 'Text'} ${to || '(no number given)'}${preview ? `: ${preview}` : ''}`;
}

/** Square money is in the smallest unit (cents for USD). */
function amountsIn(v: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || out.length >= 5) return out;
  if (Array.isArray(v)) {
    for (const x of v) amountsIn(x, out, depth + 1);
    return out;
  }
  if (!isRecord(v)) return out;
  const amt = v.amount;
  const cur = typeof v.currency === 'string' ? v.currency : null;
  if (cur && (typeof amt === 'number' || (typeof amt === 'string' && /^\d+$/.test(amt)))) {
    const n = Number(amt);
    out.push(cur === 'USD' ? `$${(n / 100).toFixed(2)}` : `${n} (smallest unit) ${cur}`);
  }
  for (const x of Object.values(v)) amountsIn(x, out, depth + 1);
  return out;
}

function firstKey(v: unknown, keys: string[], depth = 0): string {
  if (depth > 8) return '';
  if (Array.isArray(v)) {
    for (const x of v) {
      const f = firstKey(x, keys, depth + 1);
      if (f) return f;
    }
    return '';
  }
  if (!isRecord(v)) return '';
  for (const k of keys) if (typeof v[k] === 'string' && v[k]) return v[k] as string;
  for (const x of Object.values(v)) {
    const f = firstKey(x, keys, depth + 1);
    if (f) return f;
  }
  return '';
}

function describePayment(c: Card, name: string, input: Record<string, unknown>): string {
  const service = c.text('service');
  const method = c.text('method');
  const amounts = amountsIn(input);
  const customer = firstKey(input, ['customer_id', 'buyer_email_address', 'email_address', 'recipient_email']);
  c.add('Square call', [service, method].filter(Boolean).join(' · ') || name);
  c.add('Amount', amounts.length ? amounts.join(', ') : 'No amount in this request.');
  c.add('Customer', customer || 'Not named in this request.');
  const request = c.get('request');
  if (request !== undefined) c.add('Request', JSON.stringify(request, null, 1));
  return `Square: ${[service, method].filter(Boolean).join(' ') || name}${amounts.length ? ` — ${amounts[0]}` : ''}`;
}

function describeDrive(c: Card, name: string): string {
  const n = norm(name);
  if (/share|trash|delete|remove|permission/.test(n)) {
    c.add('Heads-up', 'R28 default: Arbo never deletes or shares Drive files. Deny this unless you mean it.');
  }
  if (n === 'create_file') {
    const title = c.field('File', 'title');
    c.field('Folder', 'parentId');
    c.field('Text', 'textContent');
    c.field('Type', 'contentMimeType');
    return `Drive: create “${title || '(no name)'}”`;
  }
  const fileId = c.field('File', 'fileId');
  return `Drive: ${name.replace(/_/g, ' ')}${fileId ? ` ${fileId}` : ''}`;
}

function describeCalendar(c: Card, name: string): string {
  const n = norm(name);
  if (/update|delete|move|patch|remove/.test(n)) {
    c.add('Heads-up', 'Arbo never edits, moves or deletes an existing calendar event (R18, R28). Deny this.');
  }
  // Guests come first, and loud: Google EMAILS each one an invitation with
  // the title, time, place and description — an email Mike approves here.
  // Both of the tool's guest fields count (attendeeEmails is deprecated, not gone).
  const guests = [show('attendees', c.get('attendees')), show('attendeeEmails', c.get('attendeeEmails'))].filter(Boolean).join(', ');
  if (guests) {
    c.add('Heads-up', `Google will EMAIL an invitation to ${guests} — with this title, time, place and description. Arbo's rule is no guests: deny unless you mean to invite them.`);
    c.add('Guests — Google emails each one an invite', guests);
  }
  const invites = guests ? ` — EMAILS AN INVITE TO ${guests}` : '';
  const title = c.field('Title', 'summary');
  const start = c.field('Start', 'startTime');
  c.field('End', 'endTime');
  c.field('Time zone', 'timeZone');
  c.field('Where', 'location');
  c.field('Description', 'description');
  c.field('Calendar', 'calendarId');
  const eventId = c.field('Event', 'eventId');
  if (n === 'create_event') return `Calendar: ${title || '(no title)'}${start ? ` — ${start}` : ''}${invites}`;
  return `Calendar: ${name.replace(/_/g, ' ')}${eventId ? ` ${eventId}` : ''}${title ? ` “${title}”` : ''}${invites}`;
}

/**
 * The draft id on a Gmail send, or null. Gmail sends a saved draft AS SAVED
 * and ignores the To, Subject and Body in the same call — so a card could
 * never show what would really go out. Arbo refuses these at once (R28).
 */
export function draftIdOf(ev: Pick<AgentEvent, 'name' | 'mcp_server_name' | 'input'>): string | null {
  if (classify(ev.mcp_server_name, ev.name ?? '') !== 'email' || !isRecord(ev.input)) return null;
  for (const k of ['draftId', 'draft_id']) {
    const v = ev.input[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** A text's recipients as the call names them. An unknown shape gives none — and none is never exempt from quiet hours. */
export function textRecipients(input: unknown): string[] {
  if (!isRecord(input)) return [];
  const out: string[] = [];
  for (const k of ['to', 'recipients', 'to_numbers']) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && x.trim()) out.push(x.trim());
  }
  return out;
}

export interface DescribedCall {
  tool: string;
  kind: ApprovalKind;
  summary: string;
  details: ApprovalDetail[];
}

/** One paused tool call → the card Mike decides on. */
export function describeToolCall(ev: Pick<AgentEvent, 'name' | 'mcp_server_name' | 'input'>): DescribedCall {
  const name = ev.name ?? 'unknown_tool';
  const input = isRecord(ev.input) ? ev.input : {};
  const kind = classify(ev.mcp_server_name, name);
  const tool = toolLabel(ev);
  const c = new Card(input);
  let summary: string;
  switch (kind) {
    case 'email':
      summary = describeEmail(c, name);
      break;
    case 'text':
      summary = describeText(c, name);
      break;
    case 'payment':
      summary = describePayment(c, name, input);
      break;
    case 'drive':
      summary = describeDrive(c, name);
      break;
    case 'calendar':
      summary = describeCalendar(c, name);
      break;
    default:
      summary = `${tool}${Object.keys(input).length ? '' : ' (no input)'}`;
  }
  return { tool, kind, summary: clip(summary.replace(/\s+/g, ' ').trim(), 300), details: c.finish() };
}
