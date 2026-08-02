import { describe, it, expect } from 'vitest';
import { classifyLeadMail } from '../src/reception/leadMail.js';
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

describe('HomeAdvisor (§5A #12) — a whole channel Arbo could not see', () => {
  const r = classifyLeadMail({
    from: 'newlead@homeadvisor.com',
    subject: 'New Opportunity: Trees - Trim',
    body: HA_BODY,
  });

  it('is recognised, with the service and the city', () => {
    expect(r.isLeadNotification).toBe(true);
    expect(r.provider).toBe('home_advisor');
    expect(r.lead.serviceRequested).toBe('Trees - Trim');
    expect(r.lead.serviceCity).toBe('Norfolk');
    expect(r.inServiceArea).toBe(true);
  });

  it('keeps HomeAdvisor\'s own lead number so Mike can find it in their app', () => {
    expect(r.lead.externalRef).toBe('327955820');
    expect(r.lead.details).toMatch(/HomeAdvisor app/);
  });

  it('does NOT invent a name or phone it was never given', () => {
    expect(r.lead.name).toBeUndefined();
    expect(r.lead.phone).toBeUndefined();
  });

  it('an out-of-area city is flagged for review, not dropped (§3.7)', () => {
    const far = classifyLeadMail({
      from: 'newlead@homeadvisor.com',
      subject: 'New Opportunity: Trees - Trim',
      body: HA_BODY.replace(/Norfolk/g, 'Richmond'),
    });
    expect(far.isLeadNotification).toBe(true);
    expect(far.inServiceArea).toBe(false);
  });

  it('HomeAdvisor marketing mail is not a lead', () => {
    expect(classifyLeadMail({
      from: 'news@homeadvisor.com',
      subject: 'Your monthly pro report',
      body: 'stats',
    }).isLeadNotification).toBe(false);
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

// The real 2026-08-02 website submission, table flattened to text.
const FS_BODY = `Someone just submitted your form on https://artistreevabeach.com/.
Here's what they had to say:
Name Value
name
Barbara Pratt
phone
7576509472
email
barbpratt55@gmail.com
address
2216 Russet Leaf Lane
serviceNeeded
Tree Removal
urgency
Within a week
message
I also have two smaller stumps to remove. I can work with your schedule.`;

describe('FormSubmit (§5A #12) — the website contact page', () => {
  const r = classifyLeadMail({
    from: 'submissions@formsubmit.co',
    subject: 'New estimate request from Barbara Pratt — Tree Removal',
    body: FS_BODY,
  });

  it('is recognised and pulls the contact fields', () => {
    expect(r.isLeadNotification).toBe(true);
    expect(r.provider).toBe('form_submit');
    expect(r.lead.name).toBe('Barbara Pratt');
    expect(r.lead.phone).toBe('7576509472');
    expect(r.lead.email).toBe('barbpratt55@gmail.com');
    expect(r.lead.address).toBe('2216 Russet Leaf Lane');
  });

  it('keeps the service, the urgency, and what they actually wrote', () => {
    expect(r.lead.serviceRequested).toBe('Tree Removal');
    expect(r.lead.urgency).toBe('Within a week');
    expect(r.lead.details).toMatch(/two smaller stumps/);
  });

  it('§1B — no city on the form means UNKNOWN, never assumed local', () => {
    // A public web form takes submissions from anywhere; that is exactly how
    // the out-of-area spam arrived before.
    expect(r.inServiceArea).toBeNull();
    expect(r.lead.serviceCity).toBeUndefined();
  });

  it('resolves the city when the address actually names one', () => {
    const withCity = classifyLeadMail({
      from: 'submissions@formsubmit.co',
      subject: 'New estimate request from B P — Tree Removal',
      body: FS_BODY.replace('2216 Russet Leaf Lane', '2216 Russet Leaf Lane, Virginia Beach, VA 23456'),
    });
    expect(withCity.lead.serviceCity).toBe('Virginia Beach');
    expect(withCity.inServiceArea).toBe(true);
  });

  it('falls back to the subject when a field is missing', () => {
    const bare = classifyLeadMail({
      from: 'submissions@formsubmit.co',
      subject: 'New estimate request from Jane Doe — Tree Trimming & Pruning',
      body: 'Someone just submitted your form on https://artistreevabeach.com/.',
    });
    expect(bare.lead.name).toBe('Jane Doe');
    expect(bare.lead.serviceRequested).toBe('Tree Trimming & Pruning');
  });

  it('flags a non-tree request from the website too', () => {
    const mow = classifyLeadMail({
      from: 'submissions@formsubmit.co',
      subject: 'New estimate request from A B — Lawn Mowing',
      body: FS_BODY.replace('Tree Removal', 'Lawn Mowing'),
    });
    expect(mow.lead.serviceOffScope).toBe(true);
    expect(mow.isLeadNotification).toBe(true);
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
