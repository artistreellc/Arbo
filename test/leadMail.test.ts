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
