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
// The in-app inbox watch (Mike, 2026-08-03: "Arbo can address the form
// submitted on website via Gmail access no need for site and it needs to run
// a sweep every 5 mins").
//
// WHY THIS EXISTS AND NOT A SCHEDULED ROUTINE. The platform's scheduler has a
// one-hour floor — `*/5 * * * *` is rejected server-side — and a routine I
// create carries no Gmail connector, so it would have polled blind forever.
// A poller inside ARBO has no interval floor and no connector problem. The
// reader is injected, exactly like the GIS provider, so the whole engine is
// testable offline.
//
// What it still needs is NOT just a config value, and saying so plainly
// because the temptation is to write "drop in credentials": it needs a
// consumer-Gmail OAuth token with user consent. The service-account keys
// already in env cannot reach a personal mailbox. See src/integrations/
// gmail.ts and backlog #36 — that is Mike's call to make.
//
// ═══ THIS IS READ-ONLY, STRUCTURALLY (Ruling R4) ═══
// Scheduled sweeps scan, report, and write NOTHING — no lead rows, no Gmail
// labels, no calendar edits. That is not enforced here by discipline; it is
// enforced by the shape of `GmailReader`, which has exactly ONE method and it
// reads. There is no label call to forget to remove, because there is no
// label call. Same trick as `MarkingRender` having exactly one member.
//
// ═══ AND IT STORES NOTHING (§3, §4.3) ═══
// The data links are cut and leads are Mike's. This watch holds message IDS
// in memory to avoid re-reporting the same mail, and reports PRESENCE flags —
// "this lead has a phone number" — never the number itself. `assertNoPii()`
// runs on the real return path, so a future edit that widens the result into
// customer data fails loudly instead of quietly leaking into a log line.

import { classifyLeadMail, channelIsOff, type LeadMailProvider } from '../reception/leadMail.js';
import { classifyPermitMail, type PermitMailKind } from '../permitting/permitMail.js';
import type { ServiceCity } from '../lib/address.js';

/**
 * One message, as ARBO needs to see it. Nothing here is stored; the shape
 * exists so a Gmail client, a test fixture, and an .eml file on disk all
 * arrive at the classifier looking the same.
 */
export interface InboxMessage {
  /** Provider message id. The dedupe key, and the ONLY id that gets logged. */
  id: string;
  threadId?: string;
  from: string;
  subject: string;
  /**
   * The best body available. HTML when that is what the message carries —
   * the FormSubmit notification has NO plaintext part at all, so a reader
   * that only forwards text/plain would hand the classifier an empty string
   * and every website lead would parse to a blank row.
   */
  body: string;
  receivedAtIso: string;
}

/**
 * WHAT THE READER RETURNS. `ok: false` is not an empty inbox — §1B: a feed we
 * could not read is NAMED. Every downstream surface branches on this, and
 * there is deliberately no `messages: []` on the failure arm so nobody can
 * accidentally treat a dead reader as a quiet morning.
 */
export type InboxRead =
  | {
      ok: true;
      messages: InboxMessage[];
      /**
       * Mailboxes the reader could not see this pass — SPAM has been
       * unreadable through the connector on every sweep so far, and a lead
       * filed as spam is invisible to all of them. Named, every time.
       */
      unreadable: string[];
    }
  | { ok: false; reason: string };

/**
 * The whole Gmail surface ARBO is allowed. One method. It reads.
 *
 * Do not add `label()`, `send()`, `archive()`, or `modify()` to this
 * interface. "Never send email. Ever." is a hard boundary, and R4 makes the
 * sweep read-only; an interface that cannot express a write cannot drift into
 * one during a refactor.
 */
export interface GmailReader {
  /**
   * Messages received at or after `sinceIso`, capped at `limit`.
   *
   * Order is NOT specified, because nothing here depends on it and a contract
   * no implementation is checked against is a lie waiting to be believed.
   */
  recent(sinceIso: string, limit: number): Promise<InboxRead>;
}

/**
 * A lead we saw, described without describing the customer.
 *
 * PRESENCE, NOT CONTENT (§4.3). Mike gets "07:12, website form, in area, has
 * a phone number" and opens Gmail. That is enough to know something needs
 * him and not enough to leak a customer into a log file or a chat reply.
 */
export interface LeadSighting {
  messageId: string;
  provider: LeadMailProvider;
  receivedAtIso: string;
  kind?: 'call' | 'voicemail' | 'missed' | 'abandoned' | 'text';
  /**
   * THREE STATES, and the third one matters. `true` in area, `false` out of
   * area, `null` NOBODY COULD TELL — the FormSubmit form carries no city or
   * ZIP, so most website leads land here. Rendering null as "out of area"
   * would bin real work.
   */
  inServiceArea: boolean | null;
  /** The customer's own urgency pick, verbatim. Not a triage decision. */
  urgency?: string;
  /** Classifier's flag that the request is not tree work. Review, never drop. */
  serviceOffScope?: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  hasAddress: boolean;
}

export interface InboxWatchResult {
  ranAtIso: string;
  /**
   * 'ok'          — read the inbox, saw everything it expected to see
   * 'degraded'    — read it, but a mailbox was unreadable or mail was
   *                 unrecognised. Something is missing and we know it.
   * 'unavailable' — could not read at all. NOT zero leads.
   */
  status: 'ok' | 'degraded' | 'unavailable';
  /** Set on 'unavailable'. Says which door was shut, never a count. */
  reason?: string;
  /** Messages examined this pass (already-seen ones excluded). */
  scanned: number;
  /** Messages skipped because a previous pass already reported them. */
  alreadySeen: number;
  leads: LeadSighting[];
  /**
   * Recognised, deliberately not treated as leads (HomeAdvisor / Angi are
   * off). Counted by channel so a surface can say "3 HomeAdvisor, channel
   * off" — "off" is a stated fact, not a blind spot (§3.7).
   */
  channelOff: Partial<Record<LeadMailProvider, number>>;
  /**
   * ═══ THE BUCKET THAT MATTERS ═══
   * Mail FROM A CHANNEL WE KNOW that the classifier could not parse.
   *
   * Three times in one day a lead channel turned out to be described in the
   * runbook and unreachable in code — the CallRail web form, the Angi
   * subdomains, four of the five CallRail event subjects. Every one of them
   * arrived from a sender we recognise, failed to match, and was counted as
   * noise. This bucket is that failure, made loud: it degrades the pass.
   *
   * Ids only. Subjects and senders carry customer names (§4.3).
   */
  unparsedKnownSenderIds: string[];
  /**
   * Everything else in the window — newsletters, suppliers, Mike's mother.
   * Counted so the arithmetic closes (scanned = leads + off + unparsed +
   * other) and NOT treated as a fault: a general inbox is full of mail that
   * is not a lead, and marking every pass degraded over it would bury the
   * bucket above under noise. Not knowing what a newsletter is is fine. Not
   * knowing what a CallRail mail is, is not.
   */
  otherMail: number;
  /**
   * City permit correspondence (§6B / §5A #35). REPORTED, NEVER STORED — R4
   * makes the sweep read-only and §3 forbids importing permit mail while the
   * build is unfinished, so this says "Virginia Beach wrote, it looks like an
   * intake request, here are the case refs" and stops there.
   *
   * Without this, a letter from vbgov.com would land in `otherMail` and be
   * indistinguishable from a newsletter — and an intake request is the city
   * WAITING ON MIKE.
   *
   * No address, no city-officer email. Case refs are city record numbers, not
   * customer data; the address in the subject line is a customer's home
   * (§4.3), so it does not cross into this report.
   */
  cityMail: CityMailSighting[];
  /** Mailboxes the reader could not open. Named every pass, never smoothed. */
  unreadable: string[];
}

/** A city letter, described without describing the property. */
export interface CityMailSighting {
  messageId: string;
  city: ServiceCity;
  kind: PermitMailKind | null;
  caseRefs: string[];
  receivedAtIso: string;
}

/**
 * Senders ARBO claims to understand. Used for one thing: deciding whether a
 * message the classifier rejected is boring or alarming.
 *
 * Kept in sync with the sender tests in `classifyLeadMail` by hand, and that
 * is a real cost — but the alternative is exporting the classifier's internals
 * so this file can re-run them, which couples two things that change for
 * different reasons. If a channel is added there and forgotten here, the
 * failure is a missed alarm, not a wrong answer.
 *
 * OFF channels are deliberately ABSENT. HomeAdvisor and Angi send marketing
 * from the same domains as their leads; with the channel switched off, that
 * mail is expected noise and must not light up the alarm bucket every pass.
 */
const KNOWN_LEAD_SENDERS: RegExp[] = [
  /@callrail\.com(?:>|\s|$)/i,
  /@formsubmit\.co(?:>|\s|$)/i,
  /@messaging\.yelp\.com(?:>|\s|$)/i,
  /ads-account-noreply@google\.com/i,
  /customer-request-\d+@awexpress\.google\.com/i,
  /localservices-noreply@google\.com/i,
];

function isKnownLeadSender(from: string): boolean {
  const f = from.trim();
  return KNOWN_LEAD_SENDERS.some((re) => re.test(f));
}

/**
 * Scrub anything customer-shaped out of a string that came from OUTSIDE this
 * module — a reader's error text, a mailbox name.
 *
 * This exists because `assertNoPii` throwing on the unavailable path would be
 * the worst of both worlds: a Gmail 403 that happens to quote an address
 * would turn an honest "UNAVAILABLE — 403" into a generic crashed pass, and
 * §1B would be lost to a guard meant to protect §4.3. Redact, then report.
 */
export function redact(s: string): string {
  let out = s;
  for (const { re, as } of PII_SHAPES) out = out.replace(new RegExp(re.source, 'gi'), as);
  return out;
}

/**
 * ONE definition of "customer-shaped", used by BOTH the redactor and the
 * assertion below.
 *
 * They were two separate lists for about ten minutes and had already drifted:
 * the redactor did not know about street addresses and wanted four digits
 * after a `(757)` where the assertion wanted three. A Gmail error quoting an
 * address would have slipped past the redactor, tripped the assertion, and
 * turned an honest UNAVAILABLE into a crashed pass — the guard defeating the
 * thing it guards. If it is worth catching it is worth scrubbing, and the way
 * to guarantee that is to write it down once.
 */
const PII_SHAPES: { re: RegExp; as: string; name: string }[] = [
  { re: /[\w.+-]+@[\w-]+\.[a-z]{2,}/, as: '[redacted-email]', name: 'email address' },
  // Deliberately strict so an ISO timestamp (2026-08-03T12:00:00Z) cannot
  // trip it: a phone needs 3 digits, a separator, 3 digits, a separator, 4.
  { re: /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/, as: '[redacted-phone]', name: 'phone number' },
  { re: /\(\d{3}\)\s*\d{3}/, as: '[redacted-phone]', name: 'phone number' },
  {
    re: /\d+\s+\w+\s+(st|street|ave|avenue|rd|road|ln|lane|dr|drive|blvd|ct|court|way)\b/,
    as: '[redacted-address]',
    name: 'street address',
  },
];

/**
 * The dedupe memory. In-process and bounded — NOT a database table. §3 cuts
 * the data links, and remembering "I already mentioned this message" is not
 * ingesting a lead. A restart re-reports the last window once, which is the
 * right failure: telling Mike twice beats telling him never.
 */
export class SeenMessages {
  private readonly order: string[] = [];
  private readonly set = new Set<string>();

  constructor(private readonly limit = 2000) {}

  has(id: string): boolean {
    return this.set.has(id);
  }

  remember(id: string): void {
    if (this.set.has(id)) return;
    this.set.add(id);
    this.order.push(id);
    // Bounded so a long-lived process cannot grow this without end. Oldest
    // out first: the oldest id is the least likely to come back in a window.
    while (this.order.length > this.limit) {
      const dropped = this.order.shift();
      if (dropped !== undefined) this.set.delete(dropped);
    }
  }

  get size(): number {
    return this.set.size;
  }
}

/**
 * STRUCTURAL §4.3 GUARD, on the real path — not only in a test.
 *
 * Serialises the result and refuses to hand back anything that looks like a
 * phone number, an email address, or a street address. The point is not that
 * today's code leaks; it is that tomorrow's edit cannot. The same reasoning
 * as `assertNeverClear` — the promise lives in the code, not in a comment
 * asking future-me to be careful.
 */
export function assertNoPii(result: InboxWatchResult): void {
  const json = JSON.stringify(result);
  for (const { re, name } of PII_SHAPES) {
    if (new RegExp(re.source, 'i').test(json)) {
      throw new Error(`inboxWatch: result carries something shaped like a ${name} (§4.3)`);
    }
  }
}

export interface WatchOptions {
  /** How far back to ask for. Wider than the interval, so a slow pass cannot skip mail. */
  lookbackMinutes?: number;
  /** Cap on messages per pass — a reader that returns the world must not stall the loop. */
  limit?: number;
}

/**
 * One pass. Pure apart from the injected reader: same messages in, same
 * report out, no writes anywhere.
 */
export async function watchInbox(
  reader: GmailReader,
  seen: SeenMessages,
  now = new Date(),
  opts: WatchOptions = {},
): Promise<InboxWatchResult> {
  const lookbackMinutes = opts.lookbackMinutes ?? 15;
  const limit = opts.limit ?? 50;
  const ranAtIso = now.toISOString();
  const sinceIso = new Date(now.getTime() - lookbackMinutes * 60_000).toISOString();

  let read: InboxRead;
  try {
    read = await reader.recent(sinceIso, limit);
  } catch (err) {
    // A reader that THREW is the same fact as a reader that said no: we
    // cannot see. It is never an empty inbox.
    read = { ok: false, reason: err instanceof Error ? err.message : 'reader threw' };
  }

  if (!read.ok) return unavailablePass(ranAtIso, read.reason);

  const leads: LeadSighting[] = [];
  const channelOff: Partial<Record<LeadMailProvider, number>> = {};
  const unparsedKnownSenderIds: string[] = [];
  const cityMail: CityMailSighting[] = [];
  let otherMail = 0;
  let scanned = 0;
  let alreadySeen = 0;

  for (const msg of read.messages) {
    if (seen.has(msg.id)) {
      alreadySeen++;
      continue;
    }
    seen.remember(msg.id);
    scanned++;

    // One bad message never kills the pass — but it lands in the alarm
    // bucket if it came from a sender we claim to understand, so a parser
    // that starts throwing cannot hide behind a caught exception.
    let c: ReturnType<typeof classifyLeadMail>;
    try {
      c = classifyLeadMail({ from: msg.from, subject: msg.subject, body: msg.body });
    } catch {
      if (isKnownLeadSender(msg.from)) unparsedKnownSenderIds.push(msg.id);
      else otherMail++;
      continue;
    }

    if (c.channelOff) {
      channelOff[c.channelOff] = (channelOff[c.channelOff] ?? 0) + 1;
      continue;
    }
    if (!c.isLeadNotification || c.provider === null) {
      if (isKnownLeadSender(msg.from)) {
        unparsedKnownSenderIds.push(msg.id);
        continue;
      }
      // Not a lead — but a letter from a city is not noise either. Checked
      // here rather than before the lead classifier because a city never
      // sends lead-notification mail, so the order cannot matter and this
      // keeps the common path first.
      const pm = classifyPermitMail({ from: msg.from, subject: msg.subject, body: msg.body });
      if (pm.isCityCorrespondence && pm.city) {
        cityMail.push({
          messageId: msg.id,
          city: pm.city,
          kind: pm.kind,
          caseRefs: pm.caseRefs,
          receivedAtIso: msg.receivedAtIso,
        });
        continue;
      }
      otherMail++;
      continue;
    }
    // Belt and braces: a channel switched off must never reach the lead list
    // even if a parser someday returns isLeadNotification for it.
    if (channelIsOff(c.provider)) {
      channelOff[c.provider] = (channelOff[c.provider] ?? 0) + 1;
      continue;
    }

    leads.push({
      messageId: msg.id,
      provider: c.provider,
      receivedAtIso: msg.receivedAtIso,
      kind: c.lead.kind,
      inServiceArea: c.inServiceArea,
      // The ONLY customer-authored string that crosses into this report, and
      // it is scrubbed on the way. Today the website form's urgency is a
      // picker, so this is a no-op — but "today it is a picker" is a fact
      // about Mike's form, not about this code, and the day it becomes a text
      // box an unscrubbed value would trip `assertNoPii` and take the whole
      // pass down with it.
      urgency: c.lead.urgency === undefined ? undefined : redact(c.lead.urgency),
      serviceOffScope: c.lead.serviceOffScope,
      hasPhone: Boolean(c.lead.phone),
      hasEmail: Boolean(c.lead.email),
      hasAddress: Boolean(c.lead.address),
    });
  }

  const unreadable = read.unreadable.map(redact);
  const status: InboxWatchResult['status'] =
    unreadable.length > 0 || unparsedKnownSenderIds.length > 0 ? 'degraded' : 'ok';

  const out: InboxWatchResult = {
    ranAtIso,
    status,
    scanned,
    alreadySeen,
    leads,
    channelOff,
    unparsedKnownSenderIds,
    otherMail,
    cityMail,
    unreadable,
  };
  assertNoPii(out);
  return out;
}

/**
 * The one shape for "we could not look". Built in one place so the poller and
 * the pass cannot drift into two different stories about the same fact — and
 * so `unreadable` is never empty here, because an unavailable pass is the
 * biggest blind spot there is.
 */
export function unavailablePass(ranAtIso: string, reason: string): InboxWatchResult {
  const out: InboxWatchResult = {
    ranAtIso,
    status: 'unavailable',
    reason: redact(reason),
    scanned: 0,
    alreadySeen: 0,
    leads: [],
    channelOff: {},
    unparsedKnownSenderIds: [],
    otherMail: 0,
    cityMail: [],
    unreadable: ['inbox unreadable'],
  };
  assertNoPii(out);
  return out;
}

/**
 * The operator line. Counts and ids only — this goes to a log, and §4.3 says
 * a log never carries a customer. It also never says "ok" over a hole.
 */
export function watchLogLine(r: InboxWatchResult): string {
  if (r.status === 'unavailable') {
    return `[inbox] UNAVAILABLE — ${r.reason ?? 'no reason given'} (this is not zero leads)`;
  }
  const off = Object.entries(r.channelOff).map(([k, n]) => `${k}=${n}`).join(',');
  const base =
    `scanned=${r.scanned} leads=${r.leads.length} city_mail=${r.cityMail.length} ` +
    `seen_before=${r.alreadySeen} other=${r.otherMail}` +
    (off ? ` channel_off=[${off}]` : '');
  if (r.status === 'ok') return `[inbox] ok — ${base}`;
  return (
    `[inbox] DEGRADED — ${base}` +
    (r.unparsedKnownSenderIds.length ? ` UNPARSED_KNOWN_SENDER=${r.unparsedKnownSenderIds.length}` : '') +
    (r.unreadable.length ? ` unreadable=[${r.unreadable.join('|')}]` : '')
  );
}

/** Mike asked for five minutes. This is that number, in one place. */
export const WATCH_INTERVAL_MS = 5 * 60_000;

export interface InboxWatchHandle {
  stop(): void;
  /** Exposed so a surface can render the last pass without triggering one. */
  last(): InboxWatchResult | null;
}

/**
 * The five-minute loop. Never overlaps itself, never keeps a dying process
 * alive, and never swallows a failed pass into silence.
 *
 * `reader` is nullable ON PURPOSE. With no credentials configured the loop
 * still runs and still reports — as UNAVAILABLE, every pass. The failure mode
 * this avoids is the expensive one: a screen that says "no new leads" when
 * the truth is that nothing has been able to look since the day we shipped.
 */
export function startInboxWatch(
  reader: GmailReader | null,
  opts: WatchOptions & { intervalMs?: number; onPass?: (r: InboxWatchResult) => void } = {},
): InboxWatchHandle {
  const seen = new SeenMessages();
  let running = false;
  let lastResult: InboxWatchResult | null = null;
  // An unavailable reader would otherwise print the same line 288 times a
  // day. Say it on the first pass and then hourly — quieter, still never
  // silent, and still never "ok".
  let lastUnavailableLogMs = 0;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = reader
        ? await watchInbox(reader, seen, new Date(), opts)
        : unavailablePass(new Date().toISOString(), 'no Gmail credentials configured');
      lastResult = result;
      opts.onPass?.(result);

      if (result.status === 'unavailable') {
        const nowMs = Date.parse(result.ranAtIso);
        if (lastUnavailableLogMs === 0 || nowMs - lastUnavailableLogMs >= 60 * 60_000) {
          lastUnavailableLogMs = nowMs;
          console.error(watchLogLine(result));
        }
      } else if (result.status === 'degraded') {
        console.error(watchLogLine(result));
      } else {
        console.log(watchLogLine(result));
      }
    } catch (err) {
      console.error('[inbox] pass failed:', err instanceof Error ? err.message : 'error');
    } finally {
      running = false;
    }
  };

  void tick(); // proof of life at boot — a watch that never ran is worth knowing about
  const handle = setInterval(tick, opts.intervalMs ?? WATCH_INTERVAL_MS);
  handle.unref?.();
  return {
    stop: () => clearInterval(handle),
    last: () => lastResult,
  };
}
