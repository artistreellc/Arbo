// The receptionist "brain" (brief §5A #1–8). Orchestrates a call: greets under
// disclosure, answers within the guardrails (enforced by the output guard),
// qualifies the lead, escalates emergencies to Mike, and hands a clean lead to
// the CRM. All external edges (LLM, alerting, persistence) are injected, so the
// brain is fully testable offline and the same code runs under Vapi in prod.

import type { Guardrails } from '../config/guardrails.schema.js';
import type { LegalConfig } from '../config/legal.schema.js';
import { buildReceptionistSystemPrompt } from './systemPrompt.js';
import { guardReply, type GuardResult } from './outputGuard.js';
import { detectEmergency } from './emergency.js';
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
  }): Promise<{ leadId: string }>;
}

export interface TurnResult {
  reply: string;
  guard: GuardResult;
  emergency: boolean;
}

export class Receptionist {
  private readonly system: string;
  private readonly messages: ChatMessage[] = [];
  private state: QualState = {};
  private emergencyAlerted = false;
  private lastEmergencyReason: string | null = null;

  constructor(
    private readonly deps: { g: Guardrails; legal: LegalConfig; llm: LlmClient; alerter: Alerter },
  ) {
    this.system = buildReceptionistSystemPrompt(deps.g, deps.legal);
  }

  get systemPrompt(): string {
    return this.system;
  }

  /** Handle one caller utterance. Detects emergencies, then returns a guarded reply. */
  async handleUserTurn(text: string): Promise<TurnResult> {
    // Emergency detection runs on the caller's words, before anything else (§3.4).
    const em = detectEmergency(text);
    if (em.isEmergency && !this.emergencyAlerted) {
      this.lastEmergencyReason = em.reason;
      await this.deps.alerter.emergency({ reason: em.reason ?? 'emergency', callerText: text, state: this.state });
      this.emergencyAlerted = true;
    }

    this.messages.push({ role: 'user', content: text });
    const candidate = await this.deps.llm.complete(this.system, this.messages);

    // The guard is law: any price/diagnosis/forbidden term is blocked here even
    // if the model produced it.
    const guard = guardReply(candidate, this.deps.g);
    this.messages.push({ role: 'assistant', content: guard.reply });

    return { reply: guard.reply, guard, emergency: this.emergencyAlerted };
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

  /** Persist the qualified lead into the CRM. */
  async finalize(sink: LeadSink): Promise<{ leadId: string }> {
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
