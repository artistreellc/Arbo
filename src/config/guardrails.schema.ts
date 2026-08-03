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
    // The exact call-open flow — name before disclosure (§3.10).
    callOpen: z.object({
      principle: z.string().min(1),
      beats: z.array(z.string()).min(3),
      nameAskLine: z.string().min(1),
      example: z.string().min(1),
    }),
    // How the call ENDS. Dialed in on the live agent before this existed in
    // code: recap, thank them by name, hang up rather than sit on dead air.
    // A call that trails off leaves the caller unsure anything was booked.
    // OWNER RULING R8, 2026-08-03. Mike: payment plans are allowed, and ARBO
    // "can gladly pass our financing option and where the app is."
    // The LINKS are nullable on purpose: ARBO offers the option either way,
    // but it must never invent a URL or a lender. §1.4 — never say something
    // Mike then has to lie to defend.
    financing: z.object({
      available: z.boolean(),
      /** What ARBO may say. Never terms, rates, or amounts — §3 blocks those. */
      offerLine: z.string().min(1),
      /** Where to apply. Null until Mike supplies it; ARBO then defers. */
      applyLink: z.string().url().nullable(),
      /** Where the customer app lives. Null until Mike supplies it. */
      appLink: z.string().url().nullable(),
      /** Said instead when a link is missing, so ARBO never guesses one. */
      linkPendingLine: z.string().min(1),
    }),
    callWrapUp: z.object({
      instruction: z.string().min(1),
      /** Spoken-length ceiling. A phone call is not a document. */
      maxSentences: z.number().int().min(1).max(5),
    }),
  })
  .strict();

export type Guardrails = z.infer<typeof GuardrailsSchema>;
