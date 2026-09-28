// R25 sim findings (D90): four detector misses, each pinned so it stays fixed.
import { describe, it, expect } from 'vitest';
import { detectEmergency } from '../src/reception/emergency.js';
import { categoriseHazard } from '../src/safety/nearMiss.js';
import { screenFinancialCommitment } from '../src/reception/judgment.js';
import { answerBasicQuestion } from '../src/reception/knowledgeBase.js';

describe('detectors the simulations caught', () => {
  it('a line down is an emergency even without the word "power"', () => {
    expect(detectEmergency('there is a line down across my yard').isEmergency).toBe(true);
    expect(detectEmergency('wires are sparking by the fence').isEmergency).toBe(true);
    expect(detectEmergency('a downed line in the street').isEmergency).toBe(true);
  });
  it('a person who fell or is not moving is an emergency', () => {
    expect(detectEmergency("one of your guys fell out of the tree and he's not moving").isEmergency).toBe(true);
  });
  it('plural hazards and "coming down" are categorised, not left uncategorised', () => {
    expect(categoriseHazard('ground-nesting wasps stung the groundie')).toBe('environmental');
    expect(categoriseHazard('a piece was coming down toward the groundie')).toBe('struck_by');
  });
  it('the cabling definition no longer trips the discount guard', () => {
    const a = answerBasicQuestion('What is cabling?');
    expect(a.answer).toMatch(/cable/i);
    expect(screenFinancialCommitment(a.answer).blocked).toBe(false);
  });
});

// R25 review findings, pinned.
import { parsePointCloud } from '../src/lidar/parse.js';
import { onDemandSectionDeps } from '../src/agents/sections.js';

describe('review fixes', () => {
  it('a PLY with a negative list count is refused at once, never spun on', () => {
    // The list element sits BEFORE the vertices, so the parser must walk it.
    const header = 'ply\nformat binary_little_endian 1.0\nelement face 3000000000\nproperty list char uchar idx\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n';
    const bytes = new Uint8Array([...Buffer.from(header), 0xff, ...new Uint8Array(new Float32Array([1, 2, 3]).buffer)]);
    const t = Date.now();
    const r = parsePointCloud(bytes, 'evil.ply');
    expect(Date.now() - t).toBeLessThan(1000);
    expect(r.ok).toBe(false);
  });

  it('the on-demand agent run wires none of the six writing agents and records nothing', async () => {
    const d = onDemandSectionDeps({} as never, { fetchAlerts: async () => [] } as never);
    for (const k of ['weather', 'booking', 'collections', 'safety', 'permitting', 'ownerBriefing'] as const) expect(d[k]).toBeUndefined();
    const run = await d.startRun!({ agent: 'section:test' });
    expect(run.id).toBeNull();
  });
});
