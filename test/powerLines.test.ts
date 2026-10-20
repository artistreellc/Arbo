// The POWER LINES red flag reaches a Today stop. buildMorningBrief has always
// raised it from `nearPowerLines`, but neither source passed the property's
// hazard through, so the leaning-pine stop showed no hazard at all. Only TRUE
// raises the flag; false stays silent — never a "no hazard" or a clear.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createApi } from '../src/server/api.js';
import { createSimSource } from '../src/dev/simSource.js';
import type { MorningBrief } from '../src/ops/morningBrief.js';

const todayWindow = () => {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0); // the sim schedules its jobs on today's UTC date
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return [from.toISOString(), to.toISOString()] as const;
};

describe('POWER LINES red flag on the Today brief', () => {
  it('the simulated power-line stop carries the red flag, and the summary counts it', async () => {
    const [from, to] = todayWindow();
    const res = await createApi(createSimSource(), { dataLinksSim: true }).brief(from, to);
    expect(res.status).toBe(200);
    const brief = res.body as MorningBrief;
    const pine = brief.stops.find((s) => s.address === '101 Simulation Row');
    expect(pine, 'the leaning-pine stop is on today').toBeDefined();
    expect(pine!.redFlags).toContain('POWER LINES');
    expect(brief.summary.redFlagCount).toBeGreaterThanOrEqual(1);
  });

  it('a stop whose property has no power-line hazard stays silent', async () => {
    const [from, to] = todayWindow();
    const brief = (await createApi(createSimSource(), { dataLinksSim: true }).brief(from, to)).body as MorningBrief;
    const other = brief.stops.find((s) => s.address === '202 Placeholder Way');
    expect(other).toBeDefined();
    expect(other!.redFlags).not.toContain('POWER LINES');
  });

  it('the live path selects the hazard and passes it through (source pins)', () => {
    const repo = readFileSync(new URL('../src/db/repositories.ts', import.meta.url), 'utf8');
    const list = repo.slice(repo.indexOf('export async function listStopsBetween'), repo.indexOf('// Follow-up queue inputs'));
    // Both selects — estimates and jobs — join the property's hazard column.
    expect(list.split('property:property_id(address, city, zip, hazard_power_lines)').length - 1).toBe(2);
    expect(list).toContain('nearPowerLines: r.property?.hazard_power_lines ?? null');
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    const stops = server.slice(server.indexOf('async stopsBetween(fromIso, toIso)'), server.indexOf('async newLeads(limit)'));
    expect(stops).toContain('nearPowerLines: r.nearPowerLines ?? undefined');
  });
});
