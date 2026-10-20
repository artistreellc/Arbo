// §1B on the wire: a feed Arbo cannot read says WHY, in one of three words.
// "The link is cut", "the practice data has no such feed" and "the live
// source does not wire it yet" are different facts. One error name for all
// three is what made the app word a simulated gap as a cut link.
import { describe, it, expect } from 'vitest';
import { createApi, type ApiResult, type DataSource } from '../src/server/api.js';
import { createSimSource } from '../src/dev/simSource.js';

// stopsBetween/newLeads are the two required members; everything else is
// absent unless a test passes it in, which is exactly the gap being probed.
const bare = (ready: boolean, extra: Partial<DataSource> = {}): DataSource => ({
  ready: () => ready,
  async stopsBetween() { return []; },
  async newLeads() { return []; },
  ...extra,
});

const why = (res: ApiResult) => (res.body as { error?: string }).error;

describe('feed gaps are named three ways, never one', () => {
  it('a simulated source answers not_simulated for feeds the practice data lacks', async () => {
    const api = createApi(createSimSource(), { dataLinksSim: true });
    for (const res of [await api.queue(), await api.properties(), await api.followUps(), await api.reviewBacklog()]) {
      expect(res.status).toBe(503);
      expect(why(res)).toBe('not_simulated');
    }
  });

  it('a simulated feed that IS there still answers — the gap word is only for gaps', async () => {
    const res = await createApi(createSimSource(), { dataLinksSim: true }).fleetUnits();
    expect(res.status).toBe(200);
  });

  it('no database (or a cut link) is db_not_configured, whatever the source wires', async () => {
    const api = createApi(bare(false, { loopSnapshot: async () => ({}) as never }));
    expect(why(await api.queue())).toBe('db_not_configured');
    expect(why(await api.permitBoard())).toBe('db_not_configured');
    expect(why(await api.money())).toBe('db_not_configured');
    // The ready()-only guards were left exactly as they were.
    expect(why(await api.brief('2026-10-18T00:00:00Z', '2026-10-19T00:00:00Z'))).toBe('db_not_configured');
    expect(why(await api.safety())).toBe('db_not_configured');
  });

  it('a live source missing the method is not_built, not a cut link', async () => {
    const api = createApi(bare(true));
    for (const res of [await api.queue(), await api.properties(), await api.followUps(), await api.reviewBacklog()]) {
      expect(res.status).toBe(503);
      expect(why(res)).toBe('not_built');
    }
  });

  it('a multi-method guard is not_built when only ONE of its methods is missing', async () => {
    const api = createApi(bare(true, { billableJobs: async () => [] }));
    expect(why(await api.money())).toBe('not_built');
    expect(why(await api.createInvoice({ jobId: 'j1' }))).toBe('not_built');
  });

  it('the sim flag decides the word only when the source is ready', async () => {
    // A sim flag over a source that is not ready is still a closed door.
    expect(why(await createApi(bare(false), { dataLinksSim: true }).queue())).toBe('db_not_configured');
    expect(why(await createApi(bare(true), { dataLinksSim: true }).queue())).toBe('not_simulated');
  });
});
