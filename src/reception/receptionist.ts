// The receptionist "brain" (brief §5A #1–8). Orchestrates a call: greets under
// disclosure, answers within the guardrails (enforced by the output guard),
// qualifies the lead, escalates emergencies to Mike, and hands a clean lead to
// the CRM. All external edges (LLM, alerting, persistence) are injected, so the
// brain is fully testable offline and the same code runs under Vapi in prod.

import type { Guardrails } from '../config/guardrails.schema.js';
import type { LegalConfig } from '../config/legal.schema.js';
import type { PermitScreenSummary } from '../permitting/intakeScreen.js';
import { buildReceptionistSystemPrompt } from './systemPrompt.js';
import { guardReply, type GuardResult } from './outputGuard.js';
import { detectIntent, type CallIntent, type IncidentType } from './intent.js';
import { capture, nextQuestion, isComplete, toQualificationJson, type QualField, type QualState } from './qualification.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** The LLM behind the receptionist (Anthropic in prod, a fake in tests). */
export interface LlmClient {
  complete(system: string, messages: ChatMessage[]): Promise<string>;
}

/** Fast-track alert to Mike for emergencies (Twilio push+SMS in prod). */
export interface Alerter {
  emergency(payload: { reason: string; callerText: string; state: QualState }): Promise<void>;
}

/**
 * Relationship/incident routing (§3.8, §3.9). In prod: attempts a live warm
 * transfer to Mike's personal cell for incidents, and fires URGENT/priority
 * alerts. Optional — reception still works without it (falls back to alerter).
 */
export interface Escalator {
  incident(payload: { incidentType: IncidentType; reason: string; callerText: string; state: QualState }): Promise<void>;
  wantsHuman(payload: { reason: string; callerText: string; state: QualState }): Promise<void>;
}

/** Persists a qualified lead (wraps the Phase 1 repositories in prod). */
export interface LeadSink {
  capture(input: {
    name?: string;
    phone?: string;
    address?: string;
    city?: string;
    qualification: Record<string, unknown>;
    isEmergency: boolean;
    hadWorkBefore?: boolean;
  }): Promise<{
    leadId: string;
    /** Intake permit screen (§6B.1) — attached by the live sink when a property was captured. */
    permitScreen?: PermitScreenSummary;
  }>;
}

export interface TurnResult {
  reply: string;
  guard: GuardResult;
  emergency: boolean;
  intent: CallIntent;
  incidentType?: IncidentType;
}

export class Receptionist {
  private readonly system: string;
  private readonly messages: ChatMessage[] = [];
  private state: QualState = {};
  private emergencyAlerted = false;
  private incidentFired = false;
  private incidentTypeSeen: IncidentType | null = null;
  private wantsHumanFlag = false;
  private screened = false;

  constructor(
    private readonly deps: { g: Guardrails; legal: LegalConfig; llm: LlmClient; alerter: Alerter; escalator?: Escalator },
  ) {
    this.system = buildReceptionistSystemPrompt(deps.g, deps.legal);
  }

  get systemPrompt(): string {
    return this.system;
  }

  /**
   * Handle one caller utterance. Classifies intent first (safety-first), routes
   * emergencies/incidents/wants-human/spam, then returns a guarded reply. For
   * the critical routed cases the reply is the deterministic policy line, so the
   * right thing is said regardless of what the model produced.
   */
  async handleUserTurn(text: string): Promise<TurnResult> {
    const routing = this.deps.g.callRouting;
    const intent = detectIntent(text, this.deps.g);
    this.messages.push({ role: 'user', content: text });

    // Route the safety-critical / non-lead paths.
    if (intent.intent === 'emergency' && !this.emergencyAlerted) {
      await this.deps.alerter.emergency({ reason: intent.reason, callerText: text, state: this.state });
      this.emergencyAlerted = true;
    } else if (intent.intent === 'incident' && intent.incidentType && !this.incidentFired) {
      this.incidentFired = true;
      this.incidentTypeSeen = intent.incidentType;
      // Injuries also follow the emergency path — speed over everything (§3.9).
      if (intent.incidentType === 'injury') this.emergencyAlerted = true;
      if (this.deps.escalator) {
        await this.deps.escalator.incident({ incidentType: intent.incidentType, reason: intent.reason, callerText: text, state: this.state });
      } else {
        await this.deps.alerter.emergency({ reason: `INCIDENT (${intent.incidentType}): ${intent.reason}`, callerText: text, state: this.state });
      }
    } else if (intent.intent === 'wants_human' && !this.wantsHumanFlag) {
      this.wantsHumanFlag = true;
      if (this.deps.escalator) {
        await this.deps.escalator.wantsHuman({ reason: intent.reason, callerText: text, state: this.state });
      }
    } else if (intent.intent === 'spam') {
      this.screened = true; // do NOT create a lead (§3.7/§3.26)
    }

    // For the routed cases, say the deterministic policy line (never left to the
    // model). Normal + emergency use the model's reply, guarded.
    let reply: string;
    let guard: GuardResult;
    if (intent.intent === 'incident') {
      guard = guardReply(routing.incident.approvedLine, this.deps.g);
      reply = guard.reply;
    } else if (intent.intent === 'wants_human') {
      guard = guardReply(routing.wantsHuman.approvedLine, this.deps.g);
      reply = guard.reply;
    } else if (intent.intent === 'spam') {
      guard = guardReply(routing.spam.approvedLine, this.deps.g);
      reply = guard.reply;
    } else {
      const candidate = await this.deps.llm.complete(this.system, this.messages);
      // The guard is law: any price/diagnosis/forbidden term is blocked here.
      guard = guardReply(candidate, this.deps.g);
      reply = guard.reply;
    }

    this.messages.push({ role: 'assistant', content: reply });
    return { reply, guard, emergency: this.emergencyAlerted, intent: intent.intent, incidentType: intent.incidentType ?? undefined };
  }

  captureField(key: QualField, value: string | boolean): void {
    this.state = capture(this.state, key, value);
  }

  nextQuestion(): string | null {
    return nextQuestion(this.state);
  }

  isQualified(): boolean {
    return isComplete(this.state);
  }

  get isEmergency(): boolean {
    return this.emergencyAlerted;
  }

  get isIncident(): boolean {
    return this.incidentFired;
  }

  get incidentType(): IncidentType | null {
    return this.incidentTypeSeen;
  }

  get wantsHuman(): boolean {
    return this.wantsHumanFlag;
  }

  /** True when the call was screened as spam/solicitation — must NOT become a lead. */
  get isScreened(): boolean {
    return this.screened;
  }

  /** Persist the qualified lead into the CRM. Refuses on a screened (spam) call. */
  async finalize(sink: LeadSink): Promise<{ leadId: string }> {
    if (this.screened) throw new Error('Refusing to create a lead from a screened (spam) call');
    return sink.capture({
      name: this.state.name,
      phone: this.state.phone,
      address: this.state.address,
      city: this.state.city,
      qualification: toQualificationJson(this.state),
      isEmergency: this.emergencyAlerted,
      hadWorkBefore: this.state.hadWorkBefore,
    });
  }
}
