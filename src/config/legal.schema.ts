/*
  ═══════════════════════════════════════════════════════════════════════
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
*/
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
