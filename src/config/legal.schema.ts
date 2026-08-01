import { z } from 'zod';

// Schema for legal/compliance.json (brief §4). These gates are law; the schema
// pins the invariants (quiet-hours window, STOP handling, required checks).

export const LegalSchema = z
  .object({
    version: z.string().min(1),
    disclaimer: z.string().min(1),
    tcpa: z.object({
      consentRequired: z.literal(true),
      consentModel: z.string().min(1),
      businessIdentityInFirstMessage: z.string().min(1),
      optOut: z.object({
        keyword: z.literal('STOP'),
        instructionText: z.string().min(1),
        honor: z.string().min(1),
        suppressionListRespectedSystemWide: z.literal(true),
      }),
      quietHours: z.object({
        timezone: z.string().min(1),
        // §4.1: no automated messages before 8:00 AM or after 9:00 PM local.
        earliestHour: z.literal(8),
        latestHour: z.literal(21),
        rule: z.string().min(1),
        appliesTo: z.array(z.string()).min(1),
      }),
      throttle: z.string().min(1),
    }),
    callRecordingAndAiDisclosure: z.object({
      state: z.string().min(1),
      recordingConsent: z.string().min(1),
      disclosureLine: z.string().min(1),
      disclosureRequiredAtCallStart: z.literal(true),
    }),
    dataPrivacy: z.object({
      classification: z.string().min(1),
      encryptAtRest: z.literal(true),
      encryptInTransit: z.literal(true),
      leastPrivilegeAccess: z.literal(true),
      noCustomerDataInLogs: z.literal(true),
      consentAndOptOutRecordKept: z.literal(true),
    }),
    ownerLocation: z.object({
      principle: z.string().min(1),
      requirement: z.string().min(1),
    }),
    contractsAndCredentials: z.object({
      signedContractPhotos: z.string().min(1),
      proofOfInsurance: z.string().min(1),
    }),
    outboundGate: z.object({
      description: z.string().min(1),
      checks: z
        .array(z.string())
        .refine(
          (c) => ['consent', 'quietHours', 'notSuppressed'].every((x) => c.includes(x)),
          'outbound gate must include consent, quietHours, and notSuppressed checks',
        ),
    }),
  })
  .strict();

export type LegalConfig = z.infer<typeof LegalSchema>;
