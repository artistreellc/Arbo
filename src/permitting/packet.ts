// Permit packet assembly (brief §6B.1 step 6, §5A #34): bundle the city form,
// the labeled site map, and the tree photos into ONE submission-ready packet
// and hand it to Mike. HARD LIMIT (§6B.3): ARBOR prepares and hands off — it
// never files with a city. There is no "submit" function in this module, and
// `neverAutoFiled` is the literal `true` (same pattern as verifyWithCity).
//
// The known friction this kills (§6B.4): duplicate PPRs, filings held up for
// one missing form, upload confusion. One clean packet, one record, nothing
// missing — and the checklist names exactly what's missing when it isn't ready.

import { scanForbidden } from '../lint/forbiddenStrings.js';
import type { ServiceCity } from '../lib/address.js';
import { rulesetFor } from './cities.js';
import type { ScreenStatus } from './screening.js';

// The contractor block every packet carries (hard-coded edition, §0A).
// Credentials per §2: licensed & insured, BBB A+ — nothing else, ever.
export const CONTRACTOR = {
  name: 'Art-is-Tree LLC',
  credentials: 'Licensed & insured · BBB A+',
} as const;

export interface PacketInput {
  city: ServiceCity;
  permit: {
    id: string;
    screenStatus: ScreenStatus;
    inRpa: boolean;
    /** City record # once assigned (e.g. VB PPR YYYY-DSC-######). */
    formRef?: string | null;
    /** Drive file id of the §6B.2 labeled site map. */
    labeledMapFile?: string | null;
  };
  property: { address: string; zip?: string | null };
  owner: { name?: string | null; phone?: string | null; email?: string | null };
  /** Photos of each tree to be removed (Drive file ids). */
  photos: Array<{ driveFileId: string; label?: string }>;
  /** City form names already filled out (must match the ruleset's form names). */
  preparedForms: string[];
  treeCount?: number;
}

export interface PacketItem {
  key: string;
  label: string;
  required: boolean;
  present: boolean;
  /** Reference (Drive file id / record #) when present. */
  ref?: string;
}

export interface PermitPacket {
  city: ServiceCity;
  permitId: string;
  items: PacketItem[];
  /** Labels of required items still missing — empty when ready. */
  missing: string[];
  status: 'READY_FOR_MIKE' | 'INCOMPLETE';
  /** Where and to whom MIKE submits — ARBOR never does (§6B.3). */
  handoff: {
    method: string; // the city's portal system (Accela, eBUILD, WQIA office…)
    portalUrl?: string;
    contact?: { name: string; role: string; email: string; phone?: string };
  };
  /** Surfaced up front on PERMIT_LIKELY removals (§6B.4 — don't bury it). */
  mitigationNote?: string;
  coverSummary: string;
  neverAutoFiled: true;
}

/** Assemble the packet checklist. Pure — no I/O, no sending, ever. */
export function assemblePacket(input: PacketInput): PermitPacket {
  const ruleset = rulesetFor(input.city);

  const items: PacketItem[] = [
    ...ruleset.forms.map((f) => ({
      key: `form:${f.name}`,
      label: f.name,
      required: true,
      present: input.preparedForms.includes(f.name),
      ...(input.permit.formRef ? { ref: input.permit.formRef } : {}),
    })),
    {
      key: 'site-map',
      label: 'Labeled site map (each tree marked remove/retain/replace)',
      required: true,
      present: Boolean(input.permit.labeledMapFile),
      ...(input.permit.labeledMapFile ? { ref: input.permit.labeledMapFile } : {}),
    },
    {
      key: 'photos',
      label: 'Clear photos of each tree to be removed',
      required: true,
      present: input.photos.length > 0,
      ...(input.photos[0] ? { ref: input.photos.map((p) => p.driveFileId).join(', ') } : {}),
    },
    {
      key: 'owner',
      label: 'Owner name + contact',
      required: true,
      present: Boolean(input.owner.name && (input.owner.phone || input.owner.email)),
    },
    {
      key: 'contractor',
      label: `Contractor block (${CONTRACTOR.name})`,
      required: true,
      present: true, // hard-coded edition — always known
    },
  ];

  const missing = items.filter((i) => i.required && !i.present).map((i) => i.label);

  const mitigationNote =
    input.permit.screenStatus === 'PERMIT_LIKELY' && ruleset.mitigation
      ? `${ruleset.mitigation.note}${
          input.treeCount != null
            ? ` This job: ~${Math.max(ruleset.mitigation.minReplacements, input.treeCount * ruleset.mitigation.ratioPerRemoval)} replacement trees.`
            : ''
        }`
      : undefined;

  const contact = ruleset.contacts[0];
  const summary =
    `${input.city} permit packet for ${input.property.address} — screen: ${input.permit.screenStatus} (verify with city). ` +
    (missing.length === 0
      ? `Complete: ${items.length} items. Hand off via ${ruleset.portalSystem}.`
      : `INCOMPLETE — still needs: ${missing.join('; ')}.`);

  // Belt & braces: a packet is customer/city-facing output — never Suffolk/TCIA.
  const hits = scanForbidden(summary, 'packet.coverSummary');
  if (hits.length > 0) throw new Error(`Forbidden term in packet: ${hits[0]!.term}`);

  return {
    city: input.city,
    permitId: input.permit.id,
    items,
    missing,
    status: missing.length === 0 ? 'READY_FOR_MIKE' : 'INCOMPLETE',
    handoff: {
      method: ruleset.portalSystem,
      ...(ruleset.portalUrl ? { portalUrl: ruleset.portalUrl } : {}),
      ...(contact && contact.email ? { contact: { name: contact.name, role: contact.role, email: contact.email, ...(contact.phone ? { phone: contact.phone } : {}) } } : {}),
    },
    ...(mitigationNote ? { mitigationNote } : {}),
    coverSummary: summary,
    neverAutoFiled: true,
  };
}
