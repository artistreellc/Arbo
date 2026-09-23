// The orchestrator: watch hook → thread → corrections → fast path → model →
// surface store. Fakes for the model and the thread door; everything else real.
import { describe, expect, it } from 'vitest';
import { IntentWatch } from '../src/ops/intentWatch.js';
import { IntentRegistry } from '../src/ops/intentRegistry.js';
import { InboxSurfaceStore } from '../src/ops/inboxSurface.js';
import type { GmailThreadReader, IntentModel, ModelVerdict, ThreadMessage } from '../src/ops/inboxIntent.js';
import { watchInbox, SeenMessages, assertNoPii, type InboxMessage, type MessageOutcome } from '../src/ops/inboxWatch.js';
import { classifyLeadMail } from '../src/reception/leadMail.js';

const reg = () => new IntentRegistry({ version: 'test', approved: [] });

const msg = (over: Partial<InboxMessage> = {}): InboxMessage => ({
  id: 'm1',
  threadId: 't1',
  from: 'Pat Jones <pat@example.com>',
  subject: 'Re: your estimate',
  body: 'sounds good, go ahead with it',
  receivedAtIso: '2026-09-23T14:00:00Z',
  ...over,
});

const model = (v: ModelVerdict | Error, calls?: { n: number; lastExamples?: unknown }): IntentModel => ({
  async classify(_t, _i, examples) {
    if (calls) {
      calls.n++;
      calls.lastExamples = examples;
    }
    if (v instanceof Error) throw v;
    return v;
  },
});

const threads = (messages: ThreadMessage[]): GmailThreadReader => ({
  async thread() {
    return { ok: true, messages };
  },
});

const NOW = () => new Date('2026-09-23T14:05:00Z'); // Wed, 10:05 ET

describe('IntentWatch', () => {
  it('a CallRail lead surfaces as callrail even when the model disagrees non-approvingly', async () => {
    const c = classifyLeadMail({
      from: 'no-reply@callrail.com',
      subject: 'Call from Sample Caller via TSP for Art-is-Tree LLC (VA)',
      body: 'Call lasted 2 minutes 5 seconds',
    });
    expect(c.provider).toBe('callrail_call');
    const w = new IntentWatch(
      model({ intent: 'quote_request', confidence: 0.95, matters: true, reason: 'r' }),
      null,
      reg(),
      new InboxSurfaceStore(),
      NOW,
    );
    w.observer(msg({ from: 'notifications@callrail.com' }), { kind: 'lead', classification: c });
    await w.idle();
    const s = w.store.snapshot(NOW());
    expect(s.surfaced).toHaveLength(1);
    expect(s.surfaced[0]!.intent).toBe('callrail');
    expect(s.surfaced[0]!.gmailLink).toContain('t1');
  });

  it("a casual 'go ahead' reply becomes contract_approval with the thread in view", async () => {
    const thread: ThreadMessage[] = [
      { from: 'mike@artistree.example', subject: 'Estimate — oak removal', body: 'Estimate attached.', receivedAtIso: '2026-09-20T10:00:00Z' },
      { from: 'Pat Jones <pat@example.com>', subject: 'Re: Estimate — oak removal', body: 'sounds good, go ahead with it', receivedAtIso: '2026-09-23T14:00:00Z' },
    ];
    const w = new IntentWatch(
      model({ intent: 'contract_approval', confidence: 0.92, matters: true, reason: 'reply approves quoted work' }),
      threads(thread),
      reg(),
      new InboxSurfaceStore(),
      NOW,
    );
    w.observer(msg(), { kind: 'other' });
    await w.idle();
    const s = w.store.snapshot(NOW());
    expect(s.surfaced).toHaveLength(1);
    expect(s.surfaced[0]!.intent).toBe('contract_approval');
    expect(s.surfaced[0]!.contractApproval).toBe(true);
    expect(s.surfaced[0]!.subjectHint).toContain('estimate');
  });

  it('a newsletter is read, not surfaced — logged ignored with the reason', async () => {
    const w = new IntentWatch(
      model({ intent: null, confidence: 0.1, matters: false, reason: 'vendor newsletter' }),
      null,
      reg(),
      new InboxSurfaceStore(),
      NOW,
    );
    w.observer(msg({ id: 'n1', threadId: 'tn' }), { kind: 'other' });
    await w.idle();
    const s = w.store.snapshot(NOW());
    expect(s.surfaced).toHaveLength(0);
    expect(s.ignored).toHaveLength(1);
    expect(s.ignored[0]!.reason).toContain('newsletter');
    expect(s.today).toMatchObject({ read: 1, surfaced: 0, ignored: 1 });
  });

  it('middle confidence lands in the maybe lane, never dropped, never asserted', async () => {
    const w = new IntentWatch(
      model({ intent: 'quote_request', confidence: 0.6, matters: true, reason: 'r' }),
      null,
      reg(),
      new InboxSurfaceStore(),
      NOW,
    );
    w.observer(msg(), { kind: 'other' });
    await w.idle();
    const s = w.store.snapshot(NOW());
    expect(s.maybe).toHaveLength(1);
    expect(s.maybe[0]!.confidence).toBe('maybe');
  });

  it('model failure: a known-format lead STILL surfaces, marked pattern-only; counters tick', async () => {
    const c = classifyLeadMail({
      from: 'no-reply@callrail.com',
      subject: 'Voicemail from Sample Caller via TSP for Art-is-Tree LLC (VA)',
      body: 'New voicemail',
    });
    expect(c.provider).toBe('callrail_call');
    const w = new IntentWatch(model(new Error('529')), null, reg(), new InboxSurfaceStore(), NOW);
    w.observer(msg(), { kind: 'lead', classification: c });
    await w.idle();
    const s = w.store.snapshot(NOW());
    expect(s.surfaced).toHaveLength(1);
    expect(s.surfaced[0]!.modelUnavailable).toBe(true);
    const st = w.snapshotStatus();
    expect(st.modelFailures).toBe(1);
    expect(st.consecutiveModelFailures).toBe(1);
  });

  it('matters-but-nameless mail seeds a proposal; two threads make it visible', async () => {
    const v: ModelVerdict = { intent: null, confidence: 0.7, matters: true, reason: 'r', proposedLabel: 'insurance adjuster' };
    const w = new IntentWatch(model(v), null, reg(), new InboxSurfaceStore(), NOW);
    w.observer(msg({ id: 'a', threadId: 'ta' }), { kind: 'other' });
    w.observer(msg({ id: 'b', threadId: 'tb' }), { kind: 'other' });
    await w.idle();
    expect(w.registry.pendingProposals()).toHaveLength(1);
    // and both sightings are visible in the maybe lane meanwhile
    expect(w.store.snapshot(NOW()).maybe).toHaveLength(2);
  });

  it('relabel sticks: card pulled, correction wins the rerun, example fed back redacted', async () => {
    const calls = { n: 0, lastExamples: undefined as unknown };
    const w = new IntentWatch(
      model({ intent: 'quote_request', confidence: 0.9, matters: true, reason: 'r' }, calls),
      threads([{ from: 'Pat <pat@example.com>', subject: 'Re: estimate', body: 'call me at 757-555-0142', receivedAtIso: '2026-09-23T14:00:00Z' }]),
      reg(),
      new InboxSurfaceStore(),
      NOW,
    );
    w.observer(msg(), { kind: 'other' });
    await w.idle();
    expect(w.store.snapshot(NOW()).surfaced).toHaveLength(1);

    expect(await w.relabel('t1', 'contract_approval')).toBe(true);
    expect(w.store.snapshot(NOW()).surfaced).toHaveLength(0);
    const ex = w.registry.examples();
    expect(ex).toHaveLength(1);
    expect(ex[0]!.intent).toBe('contract_approval');
    expect(ex[0]!.snippetRedacted).not.toContain('757-555-0142');

    // same thread again: the correction answers, the model is not asked
    const before = calls.n;
    w.observer(msg({ id: 'm2' }), { kind: 'other' });
    await w.idle();
    expect(calls.n).toBe(before);
    const s = w.store.snapshot(NOW());
    expect(s.surfaced).toHaveLength(1);
    expect(s.surfaced[0]!.intent).toBe('contract_approval');
  });

  it('relabel refuses an unknown intent', async () => {
    const w = new IntentWatch(null, null, reg(), new InboxSurfaceStore(), NOW);
    expect(await w.relabel('t1', 'nonsense')).toBe(false);
  });

  it('a switched-off channel is logged, and Opus is not spent on it', async () => {
    const calls = { n: 0 };
    const w = new IntentWatch(
      model({ intent: 'quote_request', confidence: 0.9, matters: true, reason: 'r' }, calls),
      null,
      reg(),
      new InboxSurfaceStore(),
      NOW,
    );
    w.observer(msg(), { kind: 'channel_off', provider: 'home_advisor' });
    await w.idle();
    expect(calls.n).toBe(0);
    const s = w.store.snapshot(NOW());
    expect(s.ignored[0]!.reason).toContain('switched off');
  });

  it('always gather the ZIP: a VA zip in the body reaches the card', async () => {
    const w = new IntentWatch(
      model({ intent: 'quote_request', confidence: 0.9, matters: true, reason: 'r' }),
      null,
      reg(),
      new InboxSurfaceStore(),
      NOW,
    );
    w.observer(msg({ body: 'need an estimate, I am in 23452 off Holland Rd' }), { kind: 'other' });
    await w.idle();
    expect(w.store.snapshot(NOW()).surfaced[0]!.zip).toBe('23452');
  });

  it('no model configured: pattern-only, and status says so', async () => {
    const w = new IntentWatch(null, null, reg(), new InboxSurfaceStore(), NOW);
    w.observer(msg(), { kind: 'other' });
    await w.idle();
    expect(w.snapshotStatus().modelConfigured).toBe(false);
    const s = w.store.snapshot(NOW());
    expect(s.ignored).toHaveLength(1);
    expect(s.ignored[0]!.reason).toMatch(/model unavailable/i);
  });
});

describe('watchInbox + observer', () => {
  it("the observer sees raw mail; the watch's own report stays PII-clean", async () => {
    const seen: { m: InboxMessage; o: MessageOutcome }[] = [];
    const reader = {
      async recent() {
        return {
          ok: true as const,
          messages: [
            msg({ id: 'w1', from: 'Pat Jones <pat@example.com>', body: 'estimate please, 757-555-0142, 123 Oak St' }),
          ],
          unreadable: [],
        };
      },
    };
    const result = await watchInbox(reader, new SeenMessages(), new Date('2026-09-23T14:00:00Z'), {
      onMessage: (m, o) => seen.push({ m, o }),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.m.body).toContain('757-555-0142'); // raw for the observer…
    expect(() => assertNoPii(result)).not.toThrow(); // …never in the report
  });

  it('an observer that throws cannot take the pass down', async () => {
    const reader = {
      async recent() {
        return { ok: true as const, messages: [msg({ id: 'w2' })], unreadable: [] };
      },
    };
    const result = await watchInbox(reader, new SeenMessages(), new Date(), {
      onMessage: () => {
        throw new Error('observer bug');
      },
    });
    expect(result.status).not.toBe('unavailable');
    expect(result.scanned).toBe(1);
  });
});
