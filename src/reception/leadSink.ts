// Live LeadSink — persists a qualified call into the CRM using the Phase 1
// repositories: creates/links the property twin + contact (with consent), then
// the lead. Out-of-area callers are pivoted before capture, so a property here
// is always in the service area.

import type { LeadSink } from './receptionist.js';
import { upsertProperty, createContact, linkContactToProperty, createLead } from '../db/repositories.js';

export function createLiveLeadSink(): LeadSink {
  return {
    async capture(input) {
      let propertyId: string | undefined;
      if (input.address && input.city) {
        const property = await upsertProperty({ address: input.address, city: input.city });
        propertyId = property.id;
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

      return { leadId: lead.id };
    },
  };
}
