// The registry: human-in-the-loop only, ids only, honest about durability.
import { describe, expect, it } from 'vitest';
import { IntentRegistry, PROPOSAL_MIN_SIGHTINGS, loadDurableIntents } from '../src/ops/intentRegistry.js';

const fresh = () => new IntentRegistry({ version: 'test', approved: [] });

describe('IntentRegistry', () => {
  it('serves core intents as durable', () => {
    const r = fresh();
    const ids = r.intents().map((i) => i.id);
    expect(ids).toContain('quote_request');
    expect(ids).toContain('contract_approval');
    expect(r.intents().every((i) => i.durable)).toBe(true);
  });

  it('policy-file intents join the list', () => {
    const r = new IntentRegistry({
      version: 'test',
      approved: [{ id: 'permit_mail', label: 'Permit mail', description: 'd' }],
    });
    expect(r.intents().some((i) => i.id === 'permit_mail' && i.durable)).toBe(true);
  });

  it('the committed policy file parses', () => {
    expect(loadDurableIntents().version).toBeTruthy();
  });

  it('a proposal needs distinct threads before Mike sees it', () => {
    const r = fresh();
    r.observe('Insurance adjuster', 't1', '2026-09-23T12:00:00Z');
    expect(r.pendingProposals()).toHaveLength(0);
    r.observe('insurance adjuster', 't1', '2026-09-23T12:01:00Z'); // same thread
    expect(r.pendingProposals()).toHaveLength(0);
    r.observe('Insurance Adjuster', 't2', '2026-09-23T12:02:00Z');
    const p = r.pendingProposals();
    expect(p).toHaveLength(1);
    expect(p[0]!.exampleThreadIds).toEqual(['t1', 't2']);
    expect(p[0]!.exampleThreadIds.length).toBeGreaterThanOrEqual(PROPOSAL_MIN_SIGHTINGS);
    expect(p[0]!.sightings).toBe(3);
  });

  it('observing never creates an intent — only approval does, marked non-durable', () => {
    const r = fresh();
    r.observe('storm damage claim', 't1', '2026-09-23T12:00:00Z');
    r.observe('storm damage claim', 't2', '2026-09-23T12:01:00Z');
    expect(r.intents().some((i) => i.id === 'storm_damage_claim')).toBe(false);
    const def = r.approve('storm_damage_claim');
    expect(def?.durable).toBe(false);
    expect(r.intents().some((i) => i.id === 'storm_damage_claim')).toBe(true);
    expect(r.pendingProposals()).toHaveLength(0);
    expect(r.exportPending().approvedPendingCommit).toHaveLength(1);
  });

  it('approve can rename; rejecting a label stops it being proposed again', () => {
    const r = fresh();
    r.observe('vendor invoice', 't1', '2026-09-23T12:00:00Z');
    r.observe('vendor invoice', 't2', '2026-09-23T12:00:00Z');
    expect(r.reject('vendor_invoice')).toBe(true);
    r.observe('vendor invoice', 't3', '2026-09-23T12:05:00Z');
    r.observe('vendor invoice', 't4', '2026-09-23T12:06:00Z');
    expect(r.pendingProposals()).toHaveLength(0);

    r.observe('crane rental', 'a', '2026-09-23T12:00:00Z');
    r.observe('crane rental', 'b', '2026-09-23T12:00:00Z');
    const def = r.approve('crane_rental', 'Crane sub-rental');
    expect(def?.label).toBe('Crane sub-rental');
  });

  it('relabel refuses an unknown intent instead of minting one', () => {
    const r = fresh();
    expect(r.relabel('t1', 'made_up_intent')).toBe(false);
    expect(r.correctionFor('t1')).toBeNull();
    expect(r.relabel('t1', 'quote_request')).toBe(true);
    expect(r.correctionFor('t1')).toBe('quote_request');
    expect(r.relabel('t1', 'ignored')).toBe(true);
    expect(r.correctionFor('t1')).toBe('ignored');
  });

  it('an approved runtime intent is immediately valid for relabel', () => {
    const r = fresh();
    r.observe('permit letter', 't1', '2026-09-23T12:00:00Z');
    r.observe('permit letter', 't2', '2026-09-23T12:00:00Z');
    r.approve('permit_letter');
    expect(r.relabel('t9', 'permit_letter')).toBe(true);
  });

  it('exportPending carries corrections as ids only', () => {
    const r = fresh();
    r.relabel('thread-1', 'callrail');
    const out = r.exportPending();
    expect(out.corrections).toEqual([{ threadId: 'thread-1', intent: 'callrail' }]);
  });
});
