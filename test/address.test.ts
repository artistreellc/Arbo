import { describe, it, expect } from 'vitest';
import { normalizeAddress, resolveServiceCity, isServiceCity, extractZip, parseAddress } from '../src/lib/address.js';

describe('address normalization (§7, §12 — no double twins)', () => {
  it('collapses equivalent spellings to the same key', () => {
    const a = normalizeAddress('123 Oak Street');
    const b = normalizeAddress('123 oak st.');
    const c = normalizeAddress('  123   Oak   ST  ');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('standardizes directions and unit designators', () => {
    expect(normalizeAddress('45 North Main Avenue Apt 2')).toBe('45 n main ave unit 2');
    expect(normalizeAddress('45 N Main Ave #2')).toBe('45 n main ave unit 2');
  });

  it('distinguishes genuinely different addresses', () => {
    expect(normalizeAddress('123 Oak St')).not.toBe(normalizeAddress('125 Oak St'));
  });
});

describe('service area (§2 — four cities, Suffolk excluded)', () => {
  it('resolves the four served cities case-insensitively', () => {
    expect(resolveServiceCity('virginia beach')).toBe('Virginia Beach');
    expect(resolveServiceCity('NORFOLK')).toBe('Norfolk');
    expect(resolveServiceCity('Chesapeake')).toBe('Chesapeake');
    expect(resolveServiceCity('portsmouth')).toBe('Portsmouth');
  });

  it('rejects Suffolk and anywhere else', () => {
    expect(isServiceCity('Suffolk')).toBe(false);
    expect(resolveServiceCity('Suffolk')).toBeNull();
    expect(isServiceCity('Richmond')).toBe(false);
  });
});

describe('zip + parse', () => {
  it('extracts a 5-digit zip', () => {
    expect(extractZip('123 Oak St, Norfolk, VA 23508')).toBe('23508');
    expect(extractZip('123 Oak St, Norfolk VA 23508-1234')).toBe('23508');
    expect(extractZip('no zip here')).toBeNull();
  });

  it('parses city from the string when no hint is given', () => {
    const p = parseAddress('123 Oak St, Chesapeake, VA 23320');
    expect(p.city).toBe('Chesapeake');
    expect(p.zip).toBe('23320');
    expect(p.inServiceArea).toBe(true);
  });

  it('flags an out-of-area address', () => {
    const p = parseAddress('9 Elm St, Suffolk, VA 23434');
    expect(p.inServiceArea).toBe(false);
    expect(p.city).toBeNull();
  });
});
