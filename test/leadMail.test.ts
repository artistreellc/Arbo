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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { classifyLeadMail, SEASONAL_CHANNELS_OFF } from '../src/reception/leadMail.js';
import { buildFollowUpQueue, clampToQuietHours, type EstimateState, type JobState } from '../src/ops/followUps.js';
import { loadLegal } from '../src/config/loadConfig.js';

// Fixtures are SYNTHETIC, shaped exactly like the real notification formats
// mined 2026-08-01 (§4.3: no customer PII in the repo).

const GOOGLE_ADS_BODY = `Your Customer ID: 555-000-0000
Sign In

Google Ads

Lead form response received

You received a customer response on 07/31/2026 12:13 AM.

Campaign

Performance Max-2
[23350000000]

Contact information

First name
Testy

Last name
McTester

Phone number
+17575550100
Call <tel:+17575550100>

City
Norfolk

Street address
123 Synthetic Ave

Response

Brief description of tree works required (Optional)
Large oak too close to the house

The Google Ads Team`;

const CALLRAIL_BODY = `CallRail
------------------------------------------------------------

Hey, Art-is-Tree LLC (VA) received a call!

Call from Sample Caller via TSP
New Caller • Call lasted 4 minutes 55 seconds
Tagged as Schedule booked

Name: Sample Caller
Number: 757-555-0100
City:
Date: Jul 30 at 2:40 PM EDT
Duration: 4 min 55 sec

Number Name: TSP
Tracking Number: 757-555-0199

Referrer Domain: www.google.com
Landing Page: www.tree-services.pro/`;

describe('lead-mail classifier (§5A #12) — real provider formats', () => {
  it('parses a Google Ads lead form: name, phone, city, address, details, campaign', () => {
    const r = classifyLeadMail({
      from: 'ads-account-noreply@google.com',
      subject: 'Lead form response received',
      body: GOOGLE_ADS_BODY,
    });
    expect(r.provider).toBe('google_ads_lead_form');
    expect(r.lead.name).toBe('Testy McTester');
    expect(r.lead.phone).toBe('+17575550100');
    expect(r.lead.city).toBe('Norfolk');
    expect(r.lead.serviceCity).toBe('Norfolk');
    expect(r.lead.address).toBe('123 Synthetic Ave');
    expect(r.lead.details).toBe('Large oak too close to the house');
    expect(r.lead.source).toContain('Performance Max-2');
    expect(r.inServiceArea).toBe(true);
  });

  it('flags an out-of-area lead-form submission for review instead of dropping it', () => {
    const body = GOOGLE_ADS_BODY.replace('Norfolk', 'Apopa').replace('Large oak too close to the house', 'N/A');
    const r = classifyLeadMail({ from: 'ads-account-noreply@google.com', subject: 'Lead form response received', body });
    expect(r.isLeadNotification).toBe(true); // still surfaced — never silently dropped
    expect(r.inServiceArea).toBe(false);
    expect(r.lead.details).toBeUndefined(); // N/A → absent, not the string "N/A"
  });

  it('parses a CallRail alert: tracker source, duration, new-caller, tag', () => {
    const r = classifyLeadMail({
      from: 'no-reply@callrail.com',
      subject: 'Call from Sample Caller via TSP for Art-is-Tree LLC (VA)',
      body: CALLRAIL_BODY,
    });
    expect(r.provider).toBe('callrail_call');
    expect(r.lead.name).toBe('Sample Caller');
    expect(r.lead.phone).toBe('757-555-0100');
    expect(r.lead.source).toBe('TSP');
    expect(r.lead.callDurationSec).toBe(295);
    expect(r.lead.isRepeatCaller).toBe(false);
    expect(r.lead.taggedAs).toBe('Schedule booked');
  });

  it('reads a repeat caller from the ordinal counter', () => {
    const r = classifyLeadMail({
      from: 'no-reply@callrail.com',
      subject: 'Call from 757-555-0100 via TLT for Art-is-Tree LLC (VA)',
      body: CALLRAIL_BODY.replace('Tagged as Schedule booked', '4th call • Call lasted 1 minute 56 seconds'),
    });
    expect(r.lead.isRepeatCaller).toBe(true);
    expect(r.lead.source).toBe('TSP'); // Number Name wins over the subject tag
  });

  it('recognizes an LSA call notification', () => {
    const r = classifyLeadMail({
      from: 'localservices-noreply@google.com',
      subject: 'New call from a potential customer',
      body: 'A potential customer called you.',
    });
    expect(r.provider).toBe('lsa_call');
    expect(r.lead.source).toBe('LSA');
  });

  it('does NOT lead-ify CallRail marketing mail or random senders', () => {
    expect(
      classifyLeadMail({ from: 'learn@callrail.com', subject: 'Get notified when customers call or text', body: 'x' })
        .isLeadNotification,
    ).toBe(false);
    expect(classifyLeadMail({ from: 'random@spam.com', subject: 'Lead form response received', body: 'x' }).isLeadNotification).toBe(
      false,
    );
  });
});

// Both formats below are the REAL 2026-08-02 messages, trimmed. They were
// invisible to the classifier until then: the web-form alert had no branch at
// all, and the LSA rule matched a sender address Google does not actually use.
const WEB_FORM_BODY = `CallRail

Hey, Art-is-Tree LLC (VA) received a raw form submission!

Source Details:
Form URL: https://www.tree-services.pro/
Source: Tree Service Pros
Referrer Domain: https://www.treeleadstoday.com/
Campaign: TSP National Lead Gen Facebook

Form Contents:
Name:: Stephen Kennedy
Email:: kencas1@cox.net
Phone Number:: (757) 408-1124
Zip Code:: 23454
Service Requested:: Tree Trimming & Pruning - tree is in backyard needs trimming / Address: 2620 Meckley Court`;

const LSA_BODY = `Local Services By
Google<https://c.gle/xxx>
Your Customer ID: 555-015-9684

New event

Potential Customer sent you a message

1000 works if possible
Name is Dave
9276 Buckman Ave
253-590-3328

To connect with this customer

Reply to this email Or Respond to this lead in the app`;

describe('CallRail WEB FORM (§5A #12) — the alert that had no branch', () => {
  const r = classifyLeadMail({
    from: 'no-reply@callrail.com',
    subject: 'Form Submission Alert for Art-is-Tree LLC (VA)',
    body: WEB_FORM_BODY,
  });

  it('is recognised as a lead', () => {
    expect(r.isLeadNotification).toBe(true);
    expect(r.provider).toBe('callrail_web_form');
  });

  it('pulls every field the double-colon layout carries', () => {
    expect(r.lead.name).toBe('Stephen Kennedy');
    expect(r.lead.phone).toBe('(757) 408-1124');
    expect(r.lead.email).toBe('kencas1@cox.net');
    expect(r.lead.zip).toBe('23454');
    expect(r.lead.source).toBe('Tree Service Pros');
  });

  it('splits the street address out of the service-request free text', () => {
    expect(r.lead.address).toBe('2620 Meckley Court');
    expect(r.lead.details).toBe('Tree Trimming & Pruning - tree is in backyard needs trimming');
    expect(r.lead.details).not.toMatch(/Address:/);
  });

  it('resolves the city from the ZIP when the form gives no city', () => {
    expect(r.lead.serviceCity).toBe('Virginia Beach');
    expect(r.inServiceArea).toBe(true);
  });

  it('an out-of-area ZIP is flagged for review, and an absent one is UNKNOWN', () => {
    const far = classifyLeadMail({
      from: 'no-reply@callrail.com',
      subject: 'Form Submission Alert for Art-is-Tree LLC (VA)',
      body: WEB_FORM_BODY.replace('23454', '90210'),
    });
    expect(far.inServiceArea).toBe(false);
    expect(far.isLeadNotification).toBe(true); // flagged, never dropped (§3.7)

    const none = classifyLeadMail({
      from: 'no-reply@callrail.com',
      subject: 'Form Submission Alert for Art-is-Tree LLC (VA)',
      body: WEB_FORM_BODY.replace('Zip Code:: 23454', ''),
    });
    expect(none.inServiceArea).toBeNull();
  });

  it('never claims Suffolk — a Suffolk ZIP does not resolve to a served city', () => {
    const suffolk = classifyLeadMail({
      from: 'no-reply@callrail.com',
      subject: 'Form Submission Alert for Art-is-Tree LLC (VA)',
      body: WEB_FORM_BODY.replace('23454', '23434'),
    });
    expect(suffolk.lead.serviceCity).toBeUndefined();
    expect(suffolk.inServiceArea).toBe(false);
  });

  it('the CallRail monthly summary is still not a lead', () => {
    const s = classifyLeadMail({
      from: 'no-reply@callrail.com',
      subject: "Art-is-Tree LLC's Monthly Summary for 7/1/26-7/31/26",
      body: 'CallRail Art-is-Tree LLC Monthly Report',
    });
    expect(s.isLeadNotification).toBe(false);
  });
});

describe('Google LSA (§5A #12) — the sender address the old rule never matched', () => {
  const r = classifyLeadMail({
    from: 'customer-request-6487787313@awexpress.google.com',
    subject: "Potential Customer's new request",
    body: LSA_BODY,
  });

  it('recognises the per-lead awexpress sender', () => {
    expect(r.isLeadNotification).toBe(true);
    expect(r.provider).toBe('lsa_call');
    expect(r.lead.source).toBe('LSA');
  });

  it('keeps the customer\'s own words — the budget lives in them', () => {
    expect(r.lead.details).toMatch(/1000 works if possible/);
  });

  it('extracts the hand-typed name, phone, and street', () => {
    expect(r.lead.name).toBe('Dave');
    expect(r.lead.phone).toBe('253-590-3328');
    expect(r.lead.address).toBe('9276 Buckman Ave');
  });

  it('never mistakes a budget line for a street address', () => {
    // "1000 works if possible" starts with a number; only a real street
    // suffix may qualify, or the address stays undefined.
    expect(r.lead.address).not.toMatch(/works if possible/);
    const noStreet = classifyLeadMail({
      from: 'customer-request-1@awexpress.google.com',
      subject: "Potential Customer's new request",
      body: LSA_BODY.replace('9276 Buckman Ave\n', ''),
    });
    expect(noStreet.lead.address).toBeUndefined();
  });

  it('does not CLAIM in-area when no location is on the wire (§1B)', () => {
    expect(r.inServiceArea).toBeNull();
  });

  it('still accepts the older localservices-noreply sender', () => {
    const old = classifyLeadMail({
      from: 'localservices-noreply@google.com',
      subject: 'New call from a potential customer',
      body: 'New event',
    });
    expect(old.isLeadNotification).toBe(true);
    expect(old.provider).toBe('lsa_call');
  });
});

// Both shapes are the REAL 2026-08-01/02 messages. The read-only sweep found
// NINE lead-shaped emails in two days matching no rule; HomeAdvisor and Yelp
// were two entire channels Arbo could not see.
const HA_BODY = `A homeowner in Norfolk needs a pro for Trees - Trim.

There's a new Opportunity near you
Respond quickly if you're interested.

Trees - Trim
Norfolk, VA
Lead #: 327955820
View all details`;

const YELP_BODY = `Job Requested
Landscaping
Postal Code
23456
Bi-weekly lawn mowing service for a small yard. Include edging and weed control.`;

describe('HomeAdvisor / Angi — SWITCHED OFF (Mike, 2026-08-03)', () => {
  // "Not worried about Angi or homeadivsor we are not going after them
  // currently so don't add them to Arbo I'll let you know when as we use them
  // seasonally". Off, not deleted — he will turn it back on.
  const ha = (over: Partial<{ from: string; subject: string; body: string }> = {}) => classifyLeadMail({
    from: 'newlead@homeadvisor.com',
    subject: 'New Opportunity: Trees - Trim',
    body: HA_BODY,
    ...over,
  });

  it('is recognised but NOT treated as a lead', () => {
    const r = ha();
    expect(r.isLeadNotification).toBe(false);
    // Recognised, so the sweep can say what it ignored and how much of it.
    expect(r.provider).toBe('home_advisor');
    expect(r.channelOff).toBe('home_advisor');
  });

  it('extracts nothing while the channel is off', () => {
    // No point parsing a channel we are not working. Empty lead, and the
    // reason is on the result rather than implied by the emptiness.
    expect(ha().lead).toEqual({});
  });

  it('covers Angi too — same company, both domains', () => {
    for (const from of ['newlead@angi.com', 'leads@angieslist.com']) {
      const r = ha({ from });
      expect(r.channelOff, from).toBe('home_advisor');
    }
  });

  it('"off" is a stated fact, never a silent drop (§3.7)', () => {
    // The distinction that matters: unrecognised mail has provider null;
    // a switched-off channel names itself. A sweep must be able to report
    // "4 HomeAdvisor, channel off" rather than showing nothing at all.
    const off = ha();
    const unknown = classifyLeadMail({ from: 'someone@nowhere.test', subject: 'hello', body: '' });
    expect(off.provider).not.toBeNull();
    expect(unknown.provider).toBeNull();
    expect(unknown.channelOff).toBeUndefined();
  });

  it('their marketing mail is still not a lead, off or on', () => {
    expect(ha({ from: 'news@homeadvisor.com', subject: 'Your monthly pro report', body: 'stats' })
      .isLeadNotification).toBe(false);
  });
});

describe('HomeAdvisor parser still works for the day Mike switches it back on', () => {
  // The parser is dormant, not deleted. These tests keep it from rotting
  // while the channel is off — rebuilding a lead parser from memory months
  // later is how a channel comes back subtly wrong.
  let restore: string[];
  beforeEach(() => {
    restore = [...SEASONAL_CHANNELS_OFF];
    SEASONAL_CHANNELS_OFF.length = 0;
  });
  afterEach(() => {
    SEASONAL_CHANNELS_OFF.length = 0;
    SEASONAL_CHANNELS_OFF.push(...(restore as typeof SEASONAL_CHANNELS_OFF));
  });

  const on = (body = HA_BODY) => classifyLeadMail({
    from: 'newlead@homeadvisor.com', subject: 'New Opportunity: Trees - Trim', body,
  });

  it('reads the service and the city', () => {
    const r = on();
    expect(r.isLeadNotification).toBe(true);
    expect(r.channelOff).toBeUndefined();
    expect(r.lead.serviceRequested).toBe('Trees - Trim');
    expect(r.lead.serviceCity).toBe('Norfolk');
    expect(r.inServiceArea).toBe(true);
  });

  it('keeps their lead number so Mike can find it in their app', () => {
    expect(on().lead.externalRef).toBe('327955820');
    expect(on().lead.details).toMatch(/HomeAdvisor app/);
  });

  it('does NOT invent a name or phone it was never given', () => {
    expect(on().lead.name).toBeUndefined();
    expect(on().lead.phone).toBeUndefined();
  });

  it('an out-of-area city is flagged for review, not dropped (§3.7)', () => {
    const far = on(HA_BODY.replace(/Norfolk/g, 'Richmond'));
    expect(far.isLeadNotification).toBe(true);
    expect(far.inServiceArea).toBe(false);
  });
});

describe('Yelp (§5A #12) — per-thread reply sender, and often not tree work', () => {
  const r = classifyLeadMail({
    from: 'reply+1666185633f144e281d3b9529549db55@messaging.yelp.com',
    subject: 'Message from Chase C. for Art-Is-Tree',
    body: YELP_BODY,
  });

  it('matches on the yelp messaging domain, not a fixed address', () => {
    expect(r.isLeadNotification).toBe(true);
    expect(r.provider).toBe('yelp');
    expect(r.lead.name).toBe('Chase C.');
  });

  it('resolves the city from the postal code', () => {
    expect(r.lead.zip).toBe('23456');
    expect(r.lead.serviceCity).toBe('Virginia Beach');
  });

  it('FLAGS a request that is not tree work rather than booking it as one', () => {
    expect(r.lead.serviceRequested).toBe('Landscaping');
    expect(r.lead.serviceOffScope).toBe(true);
    // Still a lead — flagged for review, never silently dropped (§3.7).
    expect(r.isLeadNotification).toBe(true);
  });

  it('does not flag real tree work as off-scope', () => {
    const tree = classifyLeadMail({
      from: 'reply+abc@messaging.yelp.com',
      subject: 'Message from A B. for Art-Is-Tree',
      body: YELP_BODY.replace('Landscaping', 'Tree Removal'),
    });
    expect(tree.lead.serviceOffScope).toBe(false);
  });

  it('does not flag a mixed request that includes tree work', () => {
    const mixed = classifyLeadMail({
      from: 'reply+abc@messaging.yelp.com',
      subject: 'Message from A B. for Art-Is-Tree',
      body: YELP_BODY.replace('Landscaping', 'Lawn care and tree trimming'),
    });
    expect(mixed.lead.serviceOffScope).toBe(false);
  });

  it('says plainly that Yelp gives no phone number', () => {
    expect(r.lead.phone).toBeUndefined();
    expect(r.lead.details).toMatch(/Reply inside Yelp/);
  });
});

describe('follow-up engine (§5A #16–20) — recommend-only, legally gated', () => {
  const legal = loadLegal();
  // A "now" squarely inside quiet hours: 15:00 EDT on a Wednesday.
  const NOW = new Date('2026-07-29T19:00:00Z');

  const est = (over: Partial<EstimateState> = {}): EstimateState => ({
    id: 'e1',
    name: 'Testy',
    visitedAt: '2026-07-26T15:00:00Z',
    consentOnFile: true,
    ...over,
  });

  it('queues a 2-day follow-up, proof of insurance riding the FIRST one (#16/#17)', () => {
    const q = buildFollowUpQueue(legal, [est()], [], NOW);
    expect(q.due).toHaveLength(1);
    expect(q.due[0]!.type).toBe('estimate_follow_up');
    expect(q.due[0]!.includeProofOfInsurance).toBe(true);
    expect(q.due[0]!.recommendOnly).toBe(true);
  });

  it('later follow-ups do not re-attach insurance and respect the cadence anchor', () => {
    const q = buildFollowUpQueue(
      legal,
      [est({ lastFollowUpAt: '2026-07-28T15:00:00Z', followUpCount: 1 })],
      [],
      NOW,
    );
    expect(q.due).toHaveLength(0); // last follow-up was yesterday — next one isn't due yet
    const q2 = buildFollowUpQueue(legal, [est({ lastFollowUpAt: '2026-07-26T15:00:00Z', followUpCount: 1 })], [], NOW);
    expect(q2.due[0]!.includeProofOfInsurance).toBe(false);
  });

  it('a resolved estimate gets NO follow-up — won or lost, the cadence stops (§5B: no chasing)', () => {
    expect(buildFollowUpQueue(legal, [est({ resolved: true })], [], NOW).due).toHaveLength(0);
  });

  it('no consent → suppressed WITH a named reason, never silently dropped (§4.1)', () => {
    const q = buildFollowUpQueue(legal, [est({ consentOnFile: false })], [], NOW);
    expect(q.due).toHaveLength(0);
    expect(q.suppressed[0]).toMatchObject({ reason: 'no_consent', targetId: 'e1' });
  });

  it('STOP suppression beats everything (§4.2)', () => {
    const q = buildFollowUpQueue(legal, [est({ suppressed: true })], [], NOW);
    expect(q.suppressed[0]!.reason).toBe('stop_suppressed');
  });

  it('no-show saver fires same day the window is missed (#20)', () => {
    const q = buildFollowUpQueue(
      legal,
      [est({ visitedAt: undefined, noShow: true, windowEndsAt: '2026-07-29T18:00:00Z' })],
      [],
      NOW,
    );
    expect(q.due[0]!.type).toBe('no_show_saver');
  });

  it('review request 1 day after completed AND paid, exactly once (#18)', () => {
    const paid: JobState = { id: 'j1', completedAt: '2026-07-27T20:00:00Z', paidAt: '2026-07-28T10:00:00Z', consentOnFile: true };
    const q = buildFollowUpQueue(legal, [], [paid], NOW);
    expect(q.due[0]!.type).toBe('review_request');
    expect(buildFollowUpQueue(legal, [], [{ ...paid, reviewRequestedAt: '2026-07-29T14:00:00Z' }], NOW).due).toHaveLength(0);
    expect(buildFollowUpQueue(legal, [], [{ ...paid, paidAt: undefined }], NOW).due).toHaveLength(0);
  });

  it('quiet hours are enforced in CODE: a 2 AM due-time schedules for 8 AM, never now (§4.2)', () => {
    const twoAmEt = new Date('2026-07-29T06:00:00Z'); // 2:00 AM EDT
    const clamped = clampToQuietHours(legal, twoAmEt);
    const hour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(clamped),
    );
    expect(hour).toBeGreaterThanOrEqual(8);
    const q = buildFollowUpQueue(legal, [est()], [], twoAmEt);
    expect(new Date(q.due[0]!.scheduledFor).getTime()).toBeGreaterThan(twoAmEt.getTime());
  });

  it('every action in the queue is recommend-only — nothing is ever auto-sent (§5B #1)', () => {
    const q = buildFollowUpQueue(
      legal,
      [est(), est({ id: 'e2', visitedAt: undefined, noShow: true, windowEndsAt: '2026-07-29T18:00:00Z' })],
      [{ id: 'j1', completedAt: '2026-07-27T20:00:00Z', paidAt: '2026-07-28T10:00:00Z', consentOnFile: true }],
      NOW,
    );
    expect(q.due.length).toBeGreaterThanOrEqual(3);
    expect(q.due.every((a) => a.recommendOnly === true)).toBe(true);
  });
});

describe('the website contact form (FormSubmit) — Mike, 2026-08-03', () => {
  // Built from the REAL message shape read out of Mike's inbox on 2026-08-03,
  // not from a tidied-up idea of it. The two things that matter: the body is
  // HTML-ONLY (no plaintext part at all), and the address carries no city.
  const htmlBody = (rows: Array<[string, string]>) => `<!doctype html><html><body>
<p>Someone just submitted your form on https://artistreevabeach.com/.</p>
<table>
  <tr><th>Name</th><th>Value</th></tr>
  ${rows.map(([k, v]) => `<tr>
      <td style="border: 1px solid #ddd; padding: 8px;"><strong>${k}</strong></td>
      <td style="border: 1px solid #ddd; padding: 8px;">
        <pre style="margin: 0;white-space: pre-wrap">${v}</pre>
      </td>
    </tr>`).join('\n')}
</table></body></html>`;

  const realShape = {
    from: 'submissions@formsubmit.co',
    subject: 'New estimate request from SIM Customer — Tree Removal',
    body: htmlBody([
      ['name', 'SIM Customer'],
      ['phone', '(555) 010-1234'],
      ['email', 'sim@example.com'],
      ['address', '101 Simulation Row'],
      ['serviceNeeded', 'Tree Removal'],
      ['urgency', 'Just getting a quote'],
      ['message', 'Pine in the back, I believe it&#039;s dead or dying. Quote to remove it and it&#039;s stump.'],
    ]),
  };

  it('classifies the real message shape as a website form lead', () => {
    const r = classifyLeadMail(realShape);
    expect(r.isLeadNotification).toBe(true);
    expect(r.provider).toBe('website_form');
  });

  it('pulls every field out of the HTML table — there is no plaintext to read', () => {
    // This is the whole point. The runbook tells the sweep to read
    // plaintextBody; FormSubmit sends none, so a plaintext-only parser
    // records a lead with no name, no phone and no address — §1B, absence of
    // data rendering as absence of a customer.
    const { lead } = classifyLeadMail(realShape);
    expect(lead.name).toBe('SIM Customer');
    expect(lead.phone).toBe('(555) 010-1234');
    expect(lead.email).toBe('sim@example.com');
    expect(lead.address).toBe('101 Simulation Row');
    expect(lead.serviceRequested).toBe('Tree Removal');
    expect(lead.urgency).toBe('Just getting a quote');
  });

  it('decodes HTML entities so the customer’s words read as they typed them', () => {
    expect(classifyLeadMail(realShape).lead.details).toContain("it's dead or dying");
    expect(classifyLeadMail(realShape).lead.details).not.toContain('&#039;');
  });

  it('keeps the customer’s own description verbatim in the details', () => {
    // "I believe it's dead or dying" is the CUSTOMER describing their tree.
    // It must reach Mike unedited — Arbo neither strips it nor repeats it as
    // a finding of its own.
    const { lead } = classifyLeadMail(realShape);
    expect(lead.details).toContain('Pine in the back');
    expect(lead.details).toContain('Urgency: Just getting a quote');
  });

  it('leaves service area UNKNOWN — the form carries no city, state or ZIP', () => {
    // NULL, never false. Same rule as LSA: a form with no city is not an
    // out-of-area form, and storing it as one would silently bin a real lead.
    const r = classifyLeadMail(realShape);
    expect(r.inServiceArea).toBeNull();
    expect(r.lead.serviceCity).toBeUndefined();
  });

  it('falls back to the subject when the table shape changes', () => {
    // FormSubmit controls this template and can change it. If the table stops
    // parsing, the subject still carries name and service, so a real lead is
    // never reduced to a blank row.
    const r = classifyLeadMail({ ...realShape, body: '<html><body>something else entirely</body></html>' });
    expect(r.isLeadNotification).toBe(true);
    expect(r.lead.name).toBe('SIM Customer');
    expect(r.lead.serviceRequested).toBe('Tree Removal');
  });

  it('flags an off-scope request rather than booking it as tree work', () => {
    const r = classifyLeadMail({
      ...realShape,
      subject: 'New estimate request from SIM Customer — Lawn Mowing',
      body: htmlBody([['name', 'SIM Customer'], ['serviceNeeded', 'Lawn Mowing']]),
    });
    expect(r.lead.serviceOffScope).toBe(true);
    expect(r.isLeadNotification).toBe(true);
  });

  it('does not flag tree work that merely mentions an off-scope word', () => {
    const r = classifyLeadMail({
      ...realShape,
      body: htmlBody([['name', 'SIM'], ['serviceNeeded', 'Tree removal near the fence line']]),
    });
    expect(r.lead.serviceOffScope).toBeUndefined();
  });

  it('ignores FormSubmit mail that is not a submission', () => {
    // Their sponsor/marketing mail comes from the same domain.
    expect(classifyLeadMail({
      from: 'noreply@formsubmit.co',
      subject: 'Upgrade your FormSubmit plan',
      body: '<html><body>promo</body></html>',
    }).isLeadNotification).toBe(false);
  });

  it('handles an en dash or hyphen in the subject, not just the em dash', () => {
    for (const dash of ['—', '–', '-']) {
      const r = classifyLeadMail({
        ...realShape,
        subject: `New estimate request from SIM Customer ${dash} Tree Removal`,
        body: '<html><body>no table</body></html>',
      });
      expect(r.lead.name, dash).toBe('SIM Customer');
    }
  });
});

describe('Angi subdomain senders (caught by the 15:21Z sweep)', () => {
  // `angi@em.angi.com` is a real sender on Mike's inbox and an `@angi.com`
  // substring test misses it completely. When the channel comes back on that
  // would have meant Angi leads arriving and never being recognised.
  it('matches the domain SUFFIX, so subdomains are covered', () => {
    for (const from of ['angi@em.angi.com', 'leads@mail.angieslist.com', 'newlead@homeadvisor.com']) {
      const r = classifyLeadMail({ from, subject: 'New Opportunity: Trees - Trim', body: HA_BODY });
      expect(r.provider, from).toBe('home_advisor');
      expect(r.channelOff, from).toBe('home_advisor');
    }
  });

  it('a wider sender match does NOT turn their marketing into a lead', () => {
    // The subject gate is what keeps this safe — widening the sender alone
    // would otherwise let promo mail from the same domains through.
    const r = classifyLeadMail({
      from: 'angi@em.angi.com', subject: 'Save 20% on your Angi membership', body: 'promo',
    });
    expect(r.isLeadNotification).toBe(false);
    expect(r.provider).toBeNull();
    expect(r.channelOff).toBeUndefined();
  });

  it('does not match a lookalike domain', () => {
    const r = classifyLeadMail({
      from: 'newlead@angi.com.evil.test', subject: 'New Opportunity: Trees - Trim', body: HA_BODY,
    });
    expect(r.provider).toBeNull();
  });
});

describe('CallRail: all five event subjects, not just "Call from"', () => {
  // Found by the 18:40Z sweep. A real caller rang and then texted; both mails
  // fell through to NOT_A_LEAD because the gate only matched "Call from".
  // The runbook has specified all five since day one — the code implemented
  // one. These are the two highest-intent events in the whole feed.
  const cr = (subject: string) => classifyLeadMail({
    from: 'no-reply@callrail.com', subject, body: CALLRAIL_BODY,
  });
  const S = (head: string) => `${head} from SIM Customer via TSP for Art-is-Tree LLC (VA)`;

  it('recognises every event kind the runbook lists', () => {
    for (const head of ['Call', 'Voicemail', 'Missed call', 'Abandoned call', 'TXT']) {
      const r = cr(S(head));
      expect(r.isLeadNotification, head).toBe(true);
      expect(r.provider, head).toBe('callrail_call');
    }
  });

  it('maps each subject to the kind the callback flag reads', () => {
    // src/server.ts and api.ts compute needsCallback from
    // qualification.kind ∈ missed/abandoned/voicemail. Nothing set `kind`
    // before this, so the flag built for an abandoned call could never fire.
    expect(cr(S('Call')).lead.kind).toBe('call');
    expect(cr(S('Voicemail')).lead.kind).toBe('voicemail');
    expect(cr(S('Missed call')).lead.kind).toBe('missed');
    expect(cr(S('Abandoned call')).lead.kind).toBe('abandoned');
    expect(cr(S('TXT')).lead.kind).toBe('text');
  });

  it('the three callback kinds are exactly the ones downstream acts on', () => {
    const needsCallback = (k?: string) => ['missed', 'abandoned', 'voicemail'].includes(String(k));
    expect(needsCallback(cr(S('Abandoned call')).lead.kind)).toBe(true);
    expect(needsCallback(cr(S('Missed call')).lead.kind)).toBe(true);
    expect(needsCallback(cr(S('Voicemail')).lead.kind)).toBe(true);
    // A connected call and a text do not need chasing — someone got through.
    expect(needsCallback(cr(S('Call')).lead.kind)).toBe(false);
    expect(needsCallback(cr(S('TXT')).lead.kind)).toBe(false);
  });

  it('"Missed call" and "Abandoned call" are not swallowed by bare "Call"', () => {
    // Alternation order is load-bearing: `^Call` would shadow both.
    expect(cr(S('Missed call')).lead.kind).not.toBe('call');
    expect(cr(S('Abandoned call')).lead.kind).not.toBe('call');
  });

  it('still refuses the summary mails that are not events', () => {
    for (const subject of [
      'Monthly Summary for Art-is-Tree LLC (VA)',
      'Weekly Summary for Art-is-Tree LLC (VA)',
      'Your CallRail recommendations were auto-applied',
    ]) {
      expect(cr(subject).isLeadNotification, subject).toBe(false);
    }
  });

  it('still refuses marketing from the wrong CallRail sender', () => {
    expect(classifyLeadMail({
      from: 'learn@callrail.com', subject: S('Call'), body: CALLRAIL_BODY,
    }).isLeadNotification).toBe(false);
  });
});
