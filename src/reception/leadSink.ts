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
// Live LeadSink — persists a qualified call into the CRM using the Phase 1
// repositories: creates/links the property twin + contact (with consent), then
// the lead. Out-of-area callers are pivoted before capture, so a property here
// is always in the service area.
//
// Phase 4 (§6B.1 step 1): the moment the property twin exists, the CBPA/RPA
// intake screen runs and its flag rides the lead. The screen is auxiliary —
// it can be PENDING (no GIS wired yet / GIS down) but it can never lose the
// lead; see intakeScreen.ts for the honesty rules.

import type { LeadSink } from './receptionist.js';
import { isServiceCity, type ServiceCity } from '../lib/address.js';
import { upsertProperty, createContact, linkContactToProperty, createLead, createPermit } from '../db/repositories.js';
import { runIntakeScreen, summarize, type PermitScreenSummary } from '../permitting/intakeScreen.js';
import type { GisProvider } from '../permitting/screening.js';

export interface LiveLeadSinkOptions {
  /**
   * The city GIS layers behind the §6B screen. Optional until the live layers
   * are wired at deploy — absent, every capture reports an honest
   * "screen pending", never a fabricated no-overlay result.
   */
  gis?: GisProvider | null;
}

export function createLiveLeadSink(options: LiveLeadSinkOptions = {}): LeadSink {
  return {
    async capture(input) {
      let propertyId: string | undefined;
      let permitScreen: PermitScreenSummary | undefined;

      if (input.address && input.city) {
        const property = await upsertProperty({ address: input.address, city: input.city });
        propertyId = property.id;

        // Screen every property at intake (§6B.1). Never throws; a failure
        // degrades to a named PENDING and the lead continues.
        //
        // A repeat capture on the same address deliberately screens AGAIN and
        // the new row (lifecycle 'needed') becomes the property's latest: new
        // contact = potentially new work = a fresh clearance cycle. A prior
        // approval stays on its job's own permit row; it never silently
        // extends to new work (fail-closed, §6B.3).
        // OWNER RULING R1 (docs/OWNER_RULINGS.md).
        // A city with NO permit ruleset must not be screened against another
        // city's rules — that produces a confident wrong answer, which is
        // worse than no answer. Suffolk (workable, off marketing focus) lands
        // here and is reported as unscreenable rather than screened (§1B).
        if (!isServiceCity(property.city)) {
          permitScreen = {
            screened: false,
            pendingReason: `No permit ruleset on file for ${property.city} — Arbo cannot screen this one. Verify with the city before any protected work.`,
          };
        } else {
          const outcome = await runIntakeScreen(
            {
              propertyId: property.id,
              city: property.city as ServiceCity,
              address: property.address,
              qualification: input.qualification,
            },
            options.gis,
            createPermit,
          );
          permitScreen = summarize(outcome);
        }
      }

      // A caller who phoned in has an established business relationship — capture
      // consent at creation (§4.1).
      const contact = await createContact({
        name: input.name,
        phones: input.phone ? [input.phone] : [],
        isFirstTimer: input.hadWorkBefore === undefined ? true : !input.hadWorkBefore,
        consentSource: 'inbound_call',
      });

      if (propertyId) await linkContactToProperty(contact.id, propertyId);

      const lead = await createLead({
        propertyId,
        contactId: contact.id,
        source: 'call',
        qualification: input.qualification,
        isEmergency: input.isEmergency,
      });

      return { leadId: lead.id, ...(permitScreen ? { permitScreen } : {}) };
    },
  };
}
