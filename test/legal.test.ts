import { describe, it, expect } from 'vitest';
import { loadLegal } from '../src/config/loadConfig.js';

describe('legal / compliance config (§4)', () => {
  const l = loadLegal();

  it('requires consent for automated outbound', () => {
    expect(l.tcpa.consentRequired).toBe(true);
    expect(l.tcpa.businessIdentityInFirstMessage).toBe('Art-is-Tree');
  });

  it('enforces STOP opt-out honored permanently and system-wide', () => {
    expect(l.tcpa.optOut.keyword).toBe('STOP');
    expect(l.tcpa.optOut.suppressionListRespectedSystemWide).toBe(true);
    expect(l.tcpa.optOut.honor.toLowerCase()).toContain('permanent');
  });

  it('sets quiet hours to 8:00 AM – 9:00 PM local', () => {
    expect(l.tcpa.quietHours.earliestHour).toBe(8);
    expect(l.tcpa.quietHours.latestHour).toBe(21);
    expect(l.tcpa.quietHours.timezone).toBe('America/New_York');
  });

  it('requires an AI/recording disclosure at call start', () => {
    expect(l.callRecordingAndAiDisclosure.disclosureRequiredAtCallStart).toBe(true);
    expect(l.callRecordingAndAiDisclosure.disclosureLine.length).toBeGreaterThan(0);
  });

  it('mandates PII encryption and no customer data in logs', () => {
    expect(l.dataPrivacy.encryptAtRest).toBe(true);
    expect(l.dataPrivacy.encryptInTransit).toBe(true);
    expect(l.dataPrivacy.noCustomerDataInLogs).toBe(true);
  });

  it('outbound gate includes consent, quiet-hours, and suppression checks', () => {
    for (const check of ['consent', 'quietHours', 'notSuppressed']) {
      expect(l.outboundGate.checks).toContain(check);
    }
  });
});
