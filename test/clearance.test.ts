/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  Owner instruction from Mike, 2026-08-03. This is not decoration and it
  is not optional. It is here because this is the point in a build where
  things get broken by moving fast, and that already happened to him once
  on the website. It does not happen here.
  ═══════════════════════════════════════════════════════════════════════

  SLOW DOWN. DRASTICALLY. Then:

  1. READ EVERY LINE BEFORE YOU EDIT ONE. Every line, every letter,
     slowly. You are not skimming to find the spot to change — you are
     building a model of what this file already does. If you cannot say
     what the code above and below your edit does, you have not read it.

  2. AN AUDIT IS READ-ONLY. If you were asked to audit, you do not edit.
     You do not "fix it while you are in there." You do not refactor, or
     tidy, or rename. You READ, and you REPORT. Editing during an audit
     is disobeying the instruction, full stop.

  3. THINK BEFORE YOU TYPE. What does this already handle? What depends
     on it? What breaks downstream? Recognise the PATTERN before you call
     something a bug — most things in here that look wrong are a
     deliberate correction. Check docs/OWNER_RULINGS.md first. Use what
     you already know about this codebase instead of re-deciding it.

  4. BRING IT TO MIKE — DO NOT DECIDE IT. Anything that looks wrong,
     ambiguous, or outside what was asked: say it and WAIT. Flagging
     costs one sentence. Deciding on his behalf has cost real work and
     real money more than once.

  5. DO EXACTLY WHAT WAS ASKED. Not the adjacent thing. Not the bigger
     thing you thought of on the way. Not the cleanup. Exactly what was
     asked, and nothing else.

  If you are moving fast right now, you are already off the rails.

  Remember the marker: SLOW::ARBO
*/
// §6B.3 — the human clearance step. The one path that can unblock a crew on
// protected work, so the tests are about EVIDENCE, not plumbing.

import { describe, it, expect } from 'vitest';
import {
  authorizeClearance,
  assertUnblockingSetMatchesGate,
  UNBLOCKING,
  type ClearanceRequest,
  type CityWord,
} from '../src/permitting/clearance.js';
import { crewMayStart, type PermitLifecycle } from '../src/permitting/permitRecord.js';
import { createApi, type DataSource } from '../src/server/api.js';
import { CoreEvents } from '../src/binder/eventBus.js';

const CITY: CityWord = {
  contactName: 'A. Planner',
  saidOnIso: '2026-08-01',
  reference: 'PPR-2026-0142',
  note: 'Approved for the two pines inside the RPA buffer; replanting plan on file.',
};

function req(over: Partial<ClearanceRequest> = {}): ClearanceRequest {
  return {
    permitId: 'p1',
    from: 'needed',
    to: 'approved',
    author: { kind: 'human', name: 'Mike Campbell' },
    cityWord: CITY,
    ...over,
  };
}

describe('clearance — the gate and the evidence bar cannot drift apart', () => {
  it('UNBLOCKING matches what crewMayStart actually opens', () => {
    // This is the structural one. If someone adds a third state that lets
    // work start, the hardest evidence bar in the system would silently stop
    // covering it.
    expect(() => assertUnblockingSetMatchesGate(crewMayStart)).not.toThrow();
  });

  it('catches a gate that opened a state the evidence bar does not cover', () => {
    const looseGate = (p: { status: PermitLifecycle }) => ({ mayStart: p.status !== 'needed' });
    expect(() => assertUnblockingSetMatchesGate(looseGate)).toThrow(/drifted/i);
  });

  it('the two unblocking states are exactly approved and not_required_verified', () => {
    expect([...UNBLOCKING].sort()).toEqual(['approved', 'not_required_verified']);
  });
});

describe('clearance — a move needs a human and the city', () => {
  it('accepts a properly evidenced approval', () => {
    const out = authorizeClearance(req());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.move.to).toBe('approved');
    expect(out.move.patch.formRef).toBe('PPR-2026-0142');
    // The stored note is the chain of custody: six months on, "approved" by
    // itself is not evidence of anything.
    expect(out.move.patch.notes).toContain('Mike Campbell');
    expect(out.move.patch.notes).toContain('A. Planner');
    expect(out.move.patch.notes).toContain('2026-08-01');
  });

  it('refuses an unsigned move', () => {
    const out = authorizeClearance(req({ author: { kind: 'human', name: '   ' } }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusals.join(' ')).toMatch(/nobody is named/i);
  });

  it('refuses a clearance with no city word at all', () => {
    const out = authorizeClearance(req({ cityWord: undefined }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusals.join(' ')).toMatch(/who said it, when, and what/i);
  });

  it('refuses a department instead of a person', () => {
    const out = authorizeClearance(req({ cityWord: { ...CITY, contactName: '' } }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusals.join(' ')).toMatch(/a department is not a person/i);
  });

  it('refuses a blank reference — a blank is not the same as "none given"', () => {
    const out = authorizeClearance(req({ cityWord: { ...CITY, reference: null } }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusals.join(' ')).toMatch(/none given/i);
  });

  it('accepts "they issued no reference" when it is said explicitly', () => {
    const out = authorizeClearance(
      req({ cityWord: { ...CITY, reference: null, noReferenceIssued: true } }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.move.patch.formRef).toBeUndefined();
    expect(out.move.patch.notes).toContain('none issued');
  });

  it('refuses an undated city word', () => {
    const out = authorizeClearance(req({ cityWord: { ...CITY, saidOnIso: 'last week' } }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusals.join(' ')).toMatch(/date the city said it/i);
  });

  it('refuses a move to a state that does not exist', () => {
    const out = authorizeClearance(req({ to: 'cleared' as PermitLifecycle }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusals.join(' ')).toMatch(/not a permit state/i);
  });

  it('refuses a move to the state it is already in', () => {
    const out = authorizeClearance(req({ from: 'approved', to: 'approved' }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusals.join(' ')).toMatch(/already/i);
  });

  it('collects every refusal at once — one round trip, not five', () => {
    const out = authorizeClearance(
      req({ author: { kind: 'human', name: '' }, cityWord: { ...CITY, contactName: '', reference: null } }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusals.length).toBeGreaterThanOrEqual(3);
  });
});

describe('clearance — "not required" is the hardest thing to say', () => {
  it('needs the same evidence as an approval, because it unblocks the same crew', () => {
    const out = authorizeClearance(req({ to: 'not_required_verified', cityWord: undefined }));
    expect(out.ok).toBe(false);
  });

  it('is reachable when a human actually did the work', () => {
    const out = authorizeClearance(
      req({
        to: 'not_required_verified',
        cityWord: { ...CITY, note: 'Confirmed the parcel is outside the RPA; no permit needed for this work.' },
      }),
    );
    expect(out.ok).toBe(true);
  });

  it('the screen alone can never produce it — only this path writes it', () => {
    // Belt and braces on §6B.3: screenToPermitRecord starts every track at
    // 'needed'. If that ever changes, this test is the tripwire.
    const out = authorizeClearance(req({ from: 'needed', to: 'not_required_verified', cityWord: undefined }));
    expect(out.ok).toBe(false);
  });
});

describe('clearance — walking backwards off a clearance', () => {
  it('is allowed, because permits really do get pulled', () => {
    const out = authorizeClearance(
      req({ from: 'approved', to: 'needed', cityWord: { ...CITY, note: 'City rescinded — revised plan required.' } }),
    );
    expect(out.ok).toBe(true);
  });

  it('is never silent — the crew may have been cleared on the old state', () => {
    const out = authorizeClearance(req({ from: 'approved', to: 'needed', cityWord: undefined }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusals.join(' ')).toMatch(/needs a note saying why/i);
  });
});

// ── The API path. The tests above prove the rules; this proves the app
// actually calls them, which is the failure mode this codebase keeps hitting:
// a tested function nothing invokes.
describe('POST /api/permits/status', () => {
  const PERMIT_ID = '11111111-2222-4333-8444-555555555555';

  // Typed as DataSource on purpose — vitest does not typecheck, so a bare
  // literal would let an optional-member mismatch through to `npm run check`.
  const source = (
    state: { status: PermitLifecycle; notes: string | null } | null,
    moves: Array<{ permitId: string; to: PermitLifecycle; patch: { formRef?: string; notes: string } }>,
    ready = true,
  ): DataSource => ({
    ready: () => ready,
    async stopsBetween() { return []; },
    async newLeads() { return []; },
    ...(ready
      ? {
          permitState: async () => state,
          movePermitStatus: async (m: { permitId: string; to: PermitLifecycle; patch: { formRef?: string; notes: string } }) => {
            moves.push(m);
          },
        }
      : {}),
  });

  const goodBody = {
    permitId: PERMIT_ID,
    to: 'approved',
    recordedBy: 'Mike Campbell',
    cityWord: {
      contactName: 'A. Planner',
      saidOnIso: '2026-08-01',
      reference: 'PPR-2026-0142',
      note: 'Approved for the two pines inside the RPA buffer.',
    },
  };

  it('503s when the data links are cut — it does not pretend to have moved anything', async () => {
    const moves: never[] = [];
    const res = await createApi(source(null, moves, false)).movePermit(goodBody);
    expect(res.status).toBe(503);
    expect(moves).toHaveLength(0);
  });

  it('moves a permit when the evidence is there', async () => {
    const moves: Array<{ permitId: string; to: PermitLifecycle; patch: { formRef?: string; notes: string } }> = [];
    const res = await createApi(source({ status: 'needed', notes: null }, moves)).movePermit(goodBody);
    expect(res.status).toBe(200);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.to).toBe('approved');
    expect(moves[0]!.patch.notes).toContain('A. Planner');
  });

  it('refuses on the merits with 422 and sentences, not "bad_request"', async () => {
    const moves: never[] = [];
    const res = await createApi(source({ status: 'needed', notes: null }, moves)).movePermit({ ...goodBody, cityWord: undefined });
    expect(res.status).toBe(422);
    const body = res.body as { error: string; refusals: string[] };
    expect(body.error).toBe('clearance_refused');
    expect(body.refusals.join(' ')).toMatch(/who said it, when, and what/i);
    // Nothing was written. A refused move must not half-happen.
    expect(moves).toHaveLength(0);
  });

  it('reads `from` off the DATABASE, so a stale tab cannot walk a clearance back silently', async () => {
    const moves: never[] = [];
    // The permit is approved on file. The caller does not say so — and must
    // not be able to dodge the "why are you removing the clearance" rule by
    // omitting it.
    const res = await createApi(source({ status: 'approved', notes: null }, moves)).movePermit({
      permitId: PERMIT_ID,
      to: 'needed',
      recordedBy: 'Mike Campbell',
    });
    expect(res.status).toBe(422);
    expect((res.body as { refusals: string[] }).refusals.join(' ')).toMatch(/needs a note saying why/i);
    expect(moves).toHaveLength(0);
  });

  it('404s on a permit that does not exist rather than inventing one', async () => {
    const res = await createApi(source(null, [])).movePermit(goodBody);
    expect(res.status).toBe(404);
  });

  it('rejects a non-UUID id before it reaches the database', async () => {
    const res = await createApi(source({ status: 'needed', notes: null }, [])).movePermit({ ...goodBody, permitId: 'p1' });
    expect(res.status).toBe(400);
  });

  it('the caller cannot declare itself something other than a human', async () => {
    // §6B.3: only a human clears protected work. The handler builds the
    // author itself — an `author` in the body is simply not read.
    const moves: Array<{ permitId: string; to: PermitLifecycle; patch: { formRef?: string; notes: string } }> = [];
    const res = await createApi(source({ status: 'needed', notes: null }, moves)).movePermit({
      ...goodBody,
      author: { kind: 'agent', name: 'permitting agent' },
      recordedBy: 'Mike Campbell',
    });
    expect(res.status).toBe(200);
    expect(moves[0]!.patch.notes).toContain('Mike Campbell');
    expect(moves[0]!.patch.notes).not.toContain('agent');
  });

  it('lands on the binder — the write that unblocks a crew leaves a trace', async () => {
    const moves: Array<{ permitId: string; to: PermitLifecycle; patch: { formRef?: string; notes: string } }> = [];
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const base = source({ status: 'needed', notes: null }, moves);
    const res = await createApi({
      ...base,
      emit: async (type, payload) => {
        events.push({ type, payload });
        return true;
      },
    }).movePermit(goodBody);
    expect(res.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe(CoreEvents.permitStatusMoved);
    expect(events[0]!.payload).toMatchObject({ from: 'needed', to: 'approved', recordedBy: 'Mike Campbell' });
  });

  it('APPENDS to the notes — a second clearance never erases the first', async () => {
    const moves: Array<{ permitId: string; to: PermitLifecycle; patch: { formRef?: string; notes: string } }> = [];
    const prior = 'applied — recorded by Office. City: A. Planner on 2026-07-20. Ref: PPR-2026-0142. "Submitted."';
    const res = await createApi(source({ status: 'applied', notes: prior }, moves)).movePermit(goodBody);
    expect(res.status).toBe(200);
    // The crew worked under the old state; the evidence for it must survive.
    expect(moves[0]!.patch.notes).toContain(prior);
    // Newest first — the note explaining the CURRENT state reads at the top.
    expect(moves[0]!.patch.notes.indexOf('approved —')).toBeLessThan(moves[0]!.patch.notes.indexOf(prior));
  });

  it('an unsigned move is refused — no anonymous clearances', async () => {
    const moves: never[] = [];
    const res = await createApi(source({ status: 'needed', notes: null }, moves)).movePermit({ ...goodBody, recordedBy: '' });
    expect(res.status).toBe(422);
    expect(moves).toHaveLength(0);
  });
});
