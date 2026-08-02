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
