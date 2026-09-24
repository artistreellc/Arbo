// R19: the Gmail copy of the website form now comes from the site's own
// Resend sender (api/contact.js), not FormSubmit. Same subject shape, new
// body shape ('Label: value' lines + a Message block). The FormSubmit parser
// stays for the older mail already in the inbox.
import { describe, it, expect } from 'vitest';
import { classifyLeadMail } from '../src/reception/leadMail.js';

const TEXT_BODY = [
  'New website inquiry — Art-is-Tree LLC',
  '',
  'Name: Dana Site-Test',
  'Phone: 757-555-0142',
  'Email: dana@example.com',
  'Property Address: 4500 Medford Ct',
  'Service Needed: large oak removal',
  'Timeline: Not specified',
  '',
  'Message:',
  'The big oak in the back is leaning after the storm.',
].join('\n');

describe('Resend-sent website form (R19)', () => {
  it('classifies the verified-domain sender as website_form and extracts the fields', () => {
    const r = classifyLeadMail({
      from: 'Art-is-Tree Website <no-reply@artistreevabeach.com>',
      subject: 'New estimate request from Dana Site-Test — large oak removal',
      body: TEXT_BODY,
    });
    expect(r.isLeadNotification).toBe(true);
    expect(r.provider).toBe('website_form');
    expect(r.lead.name).toBe('Dana Site-Test');
    expect(r.lead.phone).toBe('757-555-0142');
    expect(r.lead.email).toBe('dana@example.com');
    expect(r.lead.address).toBe('4500 Medford Ct');
    expect(r.lead.serviceRequested).toBe('large oak removal');
    // 'Not specified' is the form's own filler, not a customer answer.
    expect(r.lead.urgency).toBeUndefined();
    // The customer's words reach Mike verbatim inside details.
    expect(r.lead.details).toContain('leaning after the storm');
    // The form carries no city/ZIP: unknown is NULL, never false (§1B).
    expect(r.inServiceArea).toBeNull();
  });

  it('accepts the resend.dev testing sender too', () => {
    const r = classifyLeadMail({
      from: 'Art-is-Tree Website <onboarding@resend.dev>',
      subject: 'New estimate request from Sam Caller — stump grinding',
      body: 'Name: Sam Caller\nPhone: 757-555-0100\nEmail: s@example.com\nMessage:\nTwo stumps.',
    });
    expect(r.provider).toBe('website_form');
    expect(r.lead.name).toBe('Sam Caller');
  });

  it('falls back to the subject when the body shape is missing — a real lead is never a blank row', () => {
    const r = classifyLeadMail({
      from: 'no-reply@artistreevabeach.com',
      subject: 'New estimate request from Pat Fallback — crepe myrtle trim',
      body: '(body unavailable)',
    });
    expect(r.isLeadNotification).toBe(true);
    expect(r.lead.name).toBe('Pat Fallback');
    expect(r.lead.serviceRequested).toBe('crepe myrtle trim');
  });

  it('other mail from these senders never becomes a phantom lead', () => {
    const r = classifyLeadMail({
      from: 'no-reply@artistreevabeach.com',
      subject: 'Weekly delivery report',
      body: 'Your emails were delivered. Please request a quote for our premium plan.',
    });
    expect(r.isLeadNotification).toBe(false);
  });
});
