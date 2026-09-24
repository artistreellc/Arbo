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
// ElevenLabs Agents ↔ ARBOR bridge (D39). The ElevenLabs platform owns
// telephony/STT/TTS and calls THIS endpoint as its "custom LLM" — an
// OpenAI-chat-completions-compatible request per caller turn. Routing every
// turn through our Receptionist keeps the output guard as law: prices,
// diagnoses, and forbidden terms are blocked server-side no matter what the
// voice platform or model does.
//
// Deliberate tradeoff (D39): the reply is fully generated and GUARDED before
// anything is streamed back. We never token-stream the raw model — a guard
// that can only inspect completed text must see the whole reply first. Cost:
// a beat of extra latency. Benefit: the guard can never be bypassed by a
// stream that has already been spoken.
//
// Session state: ElevenLabs resends the whole transcript each turn, but the
// Receptionist is stateful (emergency/incident alerts fire ONCE per call, not
// once per turn), so calls are kept in an in-memory session map with a TTL.
// Keyed by the platform's conversation id when present, else by a stable hash
// of the call's first caller utterance.

import type { Guardrails } from '../config/guardrails.schema.js';
import type { LegalConfig } from '../config/legal.schema.js';
import { Receptionist, type Alerter, type Escalator, type LlmClient } from '../reception/receptionist.js';
import { extractVaZip, hintContextLine, proximityHint, type RouteAnchors } from '../reception/routingHint.js';
import { CallMemory, CallRecordStore, normalizeCallerId, repeatCallerNote } from '../reception/callMemory.js';
import { parseRequestedWindow, type RequestedWindow } from '../ops/requestedWindow.js';
import { colorFor } from '../scheduling/config.js';

/** The R18 calendar hold — everything the writer may create. One shot, one shape. */
export interface CallHold {
  summary: string;
  description: string;
  location?: string;
  /** Mike's real scheme (D34): the CITY color for estimate visits. */
  colorId?: string;
  startIso: string;
  endIso: string;
}

export const SESSION_TTL_MS = 30 * 60 * 1000; // a phone call is over well inside 30 min

/** Subset of the OpenAI chat-completions request ElevenLabs sends. */
export interface BridgeRequestBody {
  model?: string;
  stream?: boolean;
  messages?: Array<{ role?: string; content?: unknown }>;
  user?: string;
  conversation_id?: string;
  metadata?: { conversation_id?: string };
  elevenlabs_extra_body?: { conversation_id?: string };
  /** System tools the platform exposes (OpenAI function format) — end_call rides here. */
  tools?: Array<{ type?: string; function?: { name?: string } }>;
}

/**
 * The hang-up marker. The system prompt tells the model to END its final
 * reply with this token after the goodbyes; it is NEVER spoken — the bridge
 * strips it and, when the platform declared an end_call tool, emits the
 * OpenAI tool call that actually hangs up the line. Without this, "use the
 * end_call tool" was an instruction the wire could not carry: the bridge
 * streams text only, so the agent said "have a good one!" and then sat in
 * dead air until the caller gave up (Mike's test call, 2026-09-24).
 */
export const END_CALL_MARKER = '[[END_CALL]]';

/** True when the platform offered an end_call tool this request. */
function endCallToolOffered(body: BridgeRequestBody): boolean {
  return (body.tools ?? []).some((t) => t?.function?.name === 'end_call');
}

export interface BridgeResponse {
  status: number;
  /** JSON body (non-stream responses and every error). */
  json?: unknown;
  /** Ordered SSE frames, each already `data: `-prefixed, when streaming. */
  sse?: string[];
}

interface Session {
  receptionist: Receptionist;
  lastSeenMs: number;
  turns: number;
  /** TurnResult.emergency is sticky for the rest of a call — count the CALL once. */
  emergencyCounted: boolean;
  /** R15: first VA ZIP the caller has spoken this call, if any. */
  callerZip?: string;
  /** R18: the caller's number when the platform provided one. */
  callerId: string | null;
  /** R18: repeat-caller line, computed once at call start. */
  memoryNote: string | null;
  /** R18: last parseable "when" the caller asked for. */
  window?: RequestedWindow;
  /** The end-of-call finalize (memory + record + hold) runs exactly once. */
  finalized: boolean;
}

export interface BridgeDeps {
  guardrails: Guardrails;
  legal: LegalConfig;
  llm: LlmClient;
  alerter: Alerter;
  escalator?: Escalator;
  /** Secret WE minted; the ElevenLabs agent sends it as a Bearer token. */
  bridgeSecret: string | undefined;
  /**
   * §5A #29 review-loop sink: persist each turn for the human-in-the-loop
   * backlog. Best-effort — a logging failure must NEVER drop a live call, so
   * the bridge fires it and swallows errors.
   */
  logTurn?: (sessionKey: string, turn: { at: string; caller: string; reply: string; flags: string[] }) => Promise<void>;
  /** R15: Mike's route anchors (work/home ZIP). The model only ever sees the conclusion. */
  routeAnchors?: () => RouteAnchors;
  /** R18: cross-call learning — conversation and pattern recognition ONLY. */
  callMemory?: CallMemory;
  /** R18: the call record store, keywall-served. */
  callRecords?: CallRecordStore;
  /**
   * R18: creates the unconfirmed calendar hold during the call. ONE method by
   * type — the bridge structurally cannot edit or delete anything on the
   * calendar. null/undefined = no writer configured, recorded as such.
   */
  calendarHold?: ((hold: CallHold) => Promise<void>) | null;
  now?: () => number;
}

/** Text of a chat message whether content is a string or an array of parts. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
      .join(' ')
      .trim();
  }
  return '';
}

/** Stable non-crypto hash (djb2) — session fallback key only, never security. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function deriveSessionKey(body: BridgeRequestBody): string {
  const explicit =
    body.elevenlabs_extra_body?.conversation_id ?? body.conversation_id ?? body.metadata?.conversation_id ?? body.user;
  if (explicit && explicit.trim() !== '') return `id:${explicit.trim()}`;
  const firstUser = (body.messages ?? []).find((m) => m.role === 'user');
  return `h:${hash(contentText(firstUser?.content))}`;
}

export interface ElevenLabsBridge {
  handle(authorization: string | undefined, body: BridgeRequestBody): Promise<BridgeResponse>;
  /** Live (unexpired) session count — for tests and ops visibility. */
  sessionCount(): number;
  /** Dashboard instrument (§1B): counts and timestamps only — no slot for caller content (§4.3). */
  status(): BridgeStatus;
}

/**
 * In-memory since boot, so a redeploy resets it — the cockpit labels it
 * "since deploy" for exactly that reason. `lastTurnAt: null` means NO turns
 * yet, which must never render as a confident zero-activity claim.
 * `unauthorizedSinceBoot` is the repoint tripwire: a wrong bearer on the
 * ElevenLabs side otherwise fails silently into the platform's fallback.
 */
export interface BridgeStatus {
  configured: boolean;
  bootedAt: string;
  activeSessions: number;
  callsSinceBoot: number;
  turnsSinceBoot: number;
  lastTurnAt: string | null;
  emergencyCallsSinceBoot: number;
  guardBlockedTurnsSinceBoot: number;
  unauthorizedSinceBoot: number;
}

export function createElevenLabsBridge(deps: BridgeDeps): ElevenLabsBridge {
  const sessions = new Map<string, Session>();
  const now = deps.now ?? Date.now;
  const bootedAtMs = now();
  const counters = { calls: 0, turns: 0, lastTurnMs: null as number | null, emergencyCalls: 0, guardBlockedTurns: 0, unauthorized: 0 };

  function sweep(nowMs: number): void {
    for (const [key, s] of sessions) {
      if (nowMs - s.lastSeenMs > SESSION_TTL_MS) sessions.delete(key);
    }
  }

  return {
    sessionCount: () => sessions.size,

    status: () => ({
      configured: Boolean(deps.bridgeSecret),
      bootedAt: new Date(bootedAtMs).toISOString(),
      activeSessions: sessions.size,
      callsSinceBoot: counters.calls,
      turnsSinceBoot: counters.turns,
      lastTurnAt: counters.lastTurnMs === null ? null : new Date(counters.lastTurnMs).toISOString(),
      emergencyCallsSinceBoot: counters.emergencyCalls,
      guardBlockedTurnsSinceBoot: counters.guardBlockedTurns,
      unauthorizedSinceBoot: counters.unauthorized,
    }),

    async handle(authorization, body) {
      // Fail closed: without a configured secret the bridge refuses everything.
      if (!deps.bridgeSecret) return { status: 503, json: { error: 'bridge_not_configured' } };
      if (authorization !== `Bearer ${deps.bridgeSecret}`) {
        counters.unauthorized += 1; // repoint tripwire: a wrong ElevenLabs key must be VISIBLE, not silent
        return { status: 401, json: { error: 'unauthorized' } };
      }

      const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
      const text = contentText(lastUser?.content);
      if (text === '') return { status: 400, json: { error: 'no_user_message' } };

      const nowMs = now();
      sweep(nowMs);
      const key = deriveSessionKey(body);
      let session = sessions.get(key);
      if (!session) {
        const callerId = normalizeCallerId(body.user);
        session = {
          receptionist: new Receptionist({
            g: deps.guardrails,
            legal: deps.legal,
            llm: deps.llm,
            alerter: deps.alerter,
            ...(deps.escalator ? { escalator: deps.escalator } : {}),
          }),
          lastSeenMs: nowMs,
          turns: 0,
          emergencyCounted: false,
          callerId,
          // R18 learning: a known number gets its on-file facts as a note the
          // model CONFIRMS with the caller — computed once, at call start.
          memoryNote: repeatCallerNote(deps.callMemory?.recall(callerId) ?? null),
          finalized: false,
        };
        sessions.set(key, session);
        counters.calls += 1;
        // A redeploy or TTL sweep mid-call must not lobotomise a live caller
        // (it did, once: the first test call crossed a deploy and the caller
        // was asked for a number they had already given). The platform
        // resends the full transcript every turn, so a session MISS arriving
        // with history is rebuilt from it — minus the final user message,
        // which handleUserTurn consumes as the live turn.
        const msgs = body.messages ?? [];
        const lastUserIdx = msgs.length - 1 - [...msgs].reverse().findIndex((m) => m.role === 'user');
        const prior = msgs
          .slice(0, lastUserIdx)
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: contentText(m.content) }))
          .filter((m) => m.content !== '');
        if (prior.length > 0) {
          session.receptionist.seedHistory(prior);
          // R15: a ZIP spoken before the restart still anchors the hint.
          for (const m of prior) {
            if (m.role !== 'user') continue;
            const z = extractVaZip(m.content);
            if (z) session.callerZip = z;
          }
        }
      }
      session.lastSeenMs = nowMs;
      session.turns += 1;

      // R15: proximity is computed HERE, server-side; only the conclusion
      // line ever reaches the model. No anchors or no caller ZIP → no note.
      // R18 rides the same note channel: repeat-caller facts + proximity are
      // one combined context line, recomposed every turn.
      const noteParts: string[] = [];
      if (session.memoryNote) noteParts.push(session.memoryNote);
      if (deps.routeAnchors) {
        const z = extractVaZip(text);
        if (z) session.callerZip = z;
        if (session.callerZip) {
          const line = hintContextLine(proximityHint(session.callerZip, deps.routeAnchors()));
          if (line) noteParts.push(line);
        }
      }
      if (noteParts.length > 0) session.receptionist.setContextNote(noteParts.join(' '));

      // R18: remember the last parseable "when" the caller asked for — it
      // becomes the calendar hold's slot at wrap-up.
      const w = parseRequestedWindow(text, new Date(nowMs));
      if (w) session.window = w;

      const turn = await session.receptionist.handleUserTurn(text);

      counters.turns += 1;
      counters.lastTurnMs = nowMs;
      if (turn.emergency && !session.emergencyCounted) {
        session.emergencyCounted = true;
        counters.emergencyCalls += 1;
      }
      if (!turn.guard.safe) counters.guardBlockedTurns += 1;

      if (deps.logTurn) {
        const flags = [
          `intent:${turn.intent}`,
          ...(turn.emergency ? ['emergency'] : []),
          ...(turn.guard.safe ? [] : turn.guard.violations.map((v) => `guard_blocked:${v.rule}`)),
        ];
        // awaited so serverless doesn't freeze the write mid-flight; failures
        // are swallowed — the review log never costs a caller their reply.
        try {
          await deps.logTurn(key, { at: new Date(nowMs).toISOString(), caller: text, reply: turn.reply, flags });
        } catch {
          console.error('[voice] review log write failed'); // reason only, no PII (§4.3)
        }
      }

      const id = `arbor-${key}-${session.turns}`;
      const created = Math.floor(nowMs / 1000);
      const model = body.model ?? 'arbo-receptionist';

      // The hang-up: the model marks "goodbyes are done" with END_CALL_MARKER.
      // The marker is stripped WHEREVER it appears (a mid-reply one must never
      // be spoken either), but it only ends the call when the platform offered
      // the tool — otherwise the reply degrades to today's behavior: goodbye
      // said, line left open, nothing broken.
      const wantsEndCall = turn.reply.includes(END_CALL_MARKER);
      const reply = wantsEndCall
        ? turn.reply.split(END_CALL_MARKER).join('').replace(/\s+$/, '').trim()
        : turn.reply;
      const endCall = wantsEndCall && endCallToolOffered(body);

      // ═══ R18 finalize — runs once, at the goodbye ═══
      // Learning remembers the caller, the record is kept, and the calendar
      // hold goes up WHILE the call is still connected (this turn IS the
      // goodbye turn). All fire-and-forget: nothing here may delay or drop
      // the spoken reply, and a failed hold is a named log line, never
      // silence and never a crash.
      if (wantsEndCall && !session.finalized) {
        session.finalized = true;
        const state = session.receptionist.qualificationState();
        const atIso = new Date(nowMs).toISOString();
        deps.callMemory?.remember(
          session.callerId,
          {
            state,
            ...(session.callerZip ? { zip: session.callerZip } : {}),
            outcomeNote: `intent:${turn.intent}${turn.emergency ? ' emergency' : ''}`,
          },
          atIso,
        );
        let holdOutcome: 'attempted' | 'no_writer' = 'no_writer';
        if (deps.calendarHold) {
          const win = session.window;
          const start = win ? win.startIso : new Date(nowMs + 30 * 60 * 1000).toISOString();
          const end = win ? win.endIso : new Date(nowMs + 50 * 60 * 1000).toISOString();
          // Filed EXACTLY the way Mike files his own estimates (his words,
          // 2026-09-24, and his real events): summary "Name - 7575551234"
          // (or "- no phone"), the address in the LOCATION field, the
          // description opening "Estimate - ", and the CITY color from the
          // learned D34 map (VB=4, Norfolk=10, Chesapeake=5, Portsmouth=6).
          const digits = session.callerId ? session.callerId.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '') : '';
          const cityColor = colorFor('estimate', state.city);
          const hold: CallHold = {
            summary: `${state.name ?? 'Caller'} - ${digits || 'no phone'}`,
            ...(state.address
              ? {
                  location:
                    state.address +
                    (state.city ? `, ${state.city}, VA` : '') +
                    (session.callerZip ? ` ${session.callerZip}` : ''),
                }
              : {}),
            ...(cityColor ? { colorId: cityColor } : {}),
            description: [
              `Estimate - booked by Arbo on the call. UNCONFIRMED - Mike confirms the time.`,
              state.jobType ? `Job: ${state.jobType}` : null,
              state.treeInfo ? `Tree: ${state.treeInfo}` : null,
              state.proximityPowerLines ? `Power lines: ${state.proximityPowerLines}` : null,
              win ? `Caller asked for: ${win.label}` : 'No time given - schedule with the caller.',
            ]
              .filter((l): l is string => l !== null)
              .join('\n'),
            startIso: start,
            endIso: end,
          };
          holdOutcome = 'attempted';
          void deps.calendarHold(hold).catch((err) => {
            // Status/reason only — an error that quoted the event would put
            // a customer in the logs (§4.3).
            console.error('[calendar] hold failed:', err instanceof Error ? err.message : 'error');
          });
        }
        deps.callRecords?.add({
          atIso,
          callerId: session.callerId,
          state,
          ...(session.callerZip ? { zip: session.callerZip } : {}),
          intent: turn.intent,
          emergency: session.emergencyCounted,
          turns: session.turns,
          ...(session.window ? { requestedWindow: session.window.label } : {}),
          calendarHold: holdOutcome,
        });
      }
      const toolCalls = [
        { index: 0, id: `call_${id}`, type: 'function', function: { name: 'end_call', arguments: '{}' } },
      ];

      if (body.stream) {
        // One content chunk carrying the already-guarded reply (see header note).
        const chunk = (delta: Record<string, unknown>, finish: string | null) =>
          `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}`;
        return {
          status: 200,
          sse: [
            chunk({ role: 'assistant' }, null),
            chunk({ content: reply }, null),
            // The goodbye is spoken, THEN the platform hangs up — content and
            // tool call ride the same completion, standard OpenAI shape.
            ...(endCall ? [chunk({ tool_calls: toolCalls }, null)] : []),
            chunk({}, endCall ? 'tool_calls' : 'stop'),
            'data: [DONE]',
          ],
        };
      }

      return {
        status: 200,
        json: {
          id,
          object: 'chat.completion',
          created,
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: reply,
                ...(endCall ? { tool_calls: toolCalls } : {}),
              },
              finish_reason: endCall ? 'tool_calls' : 'stop',
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        },
      };
    },
  };
}
