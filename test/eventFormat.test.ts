import { describe, it, expect } from 'vitest';
import { buildEventTitle, buildEventDescription, normalizeSourceTag, tenDigitPhone, SOURCE_TAGS } from '../src/scheduling/eventFormat.js';

describe('calendar event formatting (§3.22 — looks exactly like Mike types)', () => {
  it('builds the observed title format: Name SOURCE 10-digit-phone (space-separated, D34)', () => {
    // Matches the live calendar ("Peter Simmons TT 7578193493"), not the
    // brief's hyphenated draft.
    expect(buildEventTitle({ name: 'Kathy Arnett', source: 'WEB', phone: '757-427-3361' })).toBe(
      'Kathy Arnett WEB 7574273361',
    );
  });

  it('normalizes channels to Mike’s real source tags', () => {
    expect(normalizeSourceTag('website')).toBe('WEB');
    expect(normalizeSourceTag('Google Ads')).toBe('GG');
    expect(normalizeSourceTag('local services')).toBe('LSA');
    expect(normalizeSourceTag('referral')).toBe('REFERAL');
    expect(normalizeSourceTag('LSA')).toBe('LSA');
    expect(SOURCE_TAGS).toContain(normalizeSourceTag('anything unknown'));
  });

  it('extracts a clean 10-digit phone', () => {
    expect(tenDigitPhone('+1 (757) 427-3361')).toBe('7574273361');
    expect(tenDigitPhone('757.427.3361')).toBe('7574273361');
    expect(tenDigitPhone('12345')).toBeNull();
  });

  it('puts scope/access detail in the description, never the title', () => {
    const desc = buildEventDescription({
      serviceType: 'removal',
      treeInfo: 'two oaks in the back near the fence',
      access: 'can a truck get to the back?',
      urgency: 'before I sell',
    });
    expect(desc).toContain('Service: removal');
    expect(desc).toContain('Access: can a truck get to the back?');
    // title stays clean
    expect(buildEventTitle({ name: 'Joe', source: 'WEB', phone: '7574273361' })).not.toContain('removal');
  });
});
