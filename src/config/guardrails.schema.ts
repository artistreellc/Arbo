import { z } from 'zod';

// Schema for policy/guardrails.json (brief §3). Validation is the runtime guard
// AND the type source — if the config drifts from the spec, boot fails loudly.

export const GuardrailsSchema = z
  .object({
    version: z.string().min(1),
    business: z.object({
      name: z.string().min(1),
      legalName: z.string().min(1),
      owner: z.string().min(1),
      region: z.string().min(1),
    }),
    serviceArea: z.object({
      // EXACTLY the four served cities — no more, no fewer (§2).
      cities: z
        .array(z.string())
        .length(4)
        .refine(
          (c) =>
            ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Portsmouth'].every((x) => c.includes(x)),
          'serviceArea.cities must be exactly the four served cities',
        ),
      excludedCities: z.array(z.string()).refine((c) => c.includes('Suffolk'), 'Suffolk must be listed as excluded'),
      outOfAreaPivot: z.string().min(1),
    }),
    credentials: z.object({
      allowedClaims: z
        .array(z.string())
        .refine((a) => a.includes('licensed and insured') && a.includes('BBB A+'), 'allowed credentials must be licensed and insured + BBB A+'),
      forbiddenClaims: z.array(z.string()).refine((f) => f.some((x) => x.includes('TCIA')), 'TCIA must be a forbidden claim'),
    }),
    goldenRules: z
      .array(
        z.object({
          id: z.string().min(1),
          rule: z.string().min(1),
          approvedLine: z.string().min(1),
          forbiddenPatterns: z.array(z.string()).optional(),
        }),
      )
      .refine((rules) => {
        const ids = new Set(rules.map((r) => r.id));
        return ['no-price', 'no-diagnosis', 'no-date-guarantee', 'credential-accuracy', 'on-topic'].every((id) => ids.has(id));
      }, 'all five golden rules must be present'),
    personality: z.object({
      traits: z.array(z.string()).min(1),
      voice: z.string().min(1),
      education: z.object({ allowed: z.string().min(1), boundary: z.string().min(1) }),
      askedHadWorkBefore: z.object({
        question: z.string().min(1),
        firstTimer: z.string().min(1),
        repeat: z.string().min(1),
      }),
    }),
    leadQualification: z.object({
      captureConversationally: z.array(z.string()).min(1),
      questions: z.array(z.string()).min(1),
      powerLineIsRedFlag: z.literal(true),
      confirmInServiceArea: z.literal(true),
      photoCapture: z.object({
        enabled: z.boolean(),
        method: z.string().min(1),
        feedsPropertyRecord: z.boolean(),
      }),
    }),
    emergency: z.object({
      triggers: z.array(z.string()).min(1),
      handling: z.string().min(1),
      neverQuoteEmergencyPricing: z.literal(true),
    }),
    afterHoursAndOverflow: z.object({
      afterHours: z.string().min(1),
      overflow: z.string().min(1),
      missedCallTextBack: z.string().min(1),
    }),
    // Call routing beyond the normal lead path (§3.7–3.9, §3.21, §3.26).
    callRouting: z.object({
      wantsHuman: z.object({
        triggers: z.array(z.string()).min(1),
        action: z.string().min(1),
        approvedLine: z.string().min(1),
      }),
      incident: z.object({
        description: z.string().min(1),
        triggers: z.object({
          angry: z.array(z.string()).min(1),
          damage: z.array(z.string()).min(1),
          injury: z.array(z.string()).min(1),
        }),
        neverAdmitFault: z.literal(true),
        neverQuoteRepairCost: z.literal(true),
        approvedLine: z.string().min(1),
      }),
      spam: z.object({
        description: z.string().min(1),
        solicitorTriggers: z.array(z.string()).min(1),
        biasTowardCustomer: z.literal(true),
        approvedLine: z.string().min(1),
      }),
    }),
  })
  .strict();

export type Guardrails = z.infer<typeof GuardrailsSchema>;
