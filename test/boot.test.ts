import { describe, it, expect } from 'vitest';
import { boot } from '../src/index.js';

describe('boot (§Phase 0 acceptance)', () => {
  it('boots, loading and validating both configs', () => {
    const s = boot();
    expect(s.ok).toBe(true);
    expect(s.appName).toBeTruthy();
    expect(s.guardrailsVersion).toBeTruthy();
    expect(s.legalVersion).toBeTruthy();
  });

  it('reports integration status as booleans (no secret values)', () => {
    const s = boot();
    expect(s.integrations).toHaveProperty('supabase');
    expect(s.integrations).toHaveProperty('vapi');
    for (const v of Object.values(s.integrations)) expect(typeof v).toBe('boolean');
  });
});
