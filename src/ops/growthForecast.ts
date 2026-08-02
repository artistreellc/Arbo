// §6 Predictive Property Intelligence — the growth-cycle forecasting layer
// over the property twin. This is the piece that manufactures repeat business:
// general tree maintenance cycles applied to each tree's LAST REAL SERVICE
// date, so ARBOR can say "the leylands trimmed 18 months ago are hitting
// overgrown right about now" and queue a Mike-approved nudge BEFORE the
// customer thinks to call.
//
// Honesty rules (same spine as permits/storm/location):
//   - Forecasts come from published horticultural norms, not from inspecting
//     the tree — every output is a "worth a look", NEVER a diagnosis (§3).
//   - No service date on record → no forecast. The twin never invents history.
//   - Outreach is recommend-only and rides the same §4 gates as every other
//     nudge: consent on file, STOP honored, quiet hours clamped.

import type { LegalConfig } from '../config/legal.schema.js';
import { clampToQuietHours, type FollowUpAction, type FollowUpQueue, type SuppressedAction } from './followUps.js';

export interface TreeRecord {
  id: string;
  species: string | null;
  size: string | null;
  lastServiceIso: string | null;
}

/**
 * Maintenance cycles in months, by species pattern. Ranges are the general
 * horticultural norms for Hampton Roads yard trees — deliberately WIDE, and
 * order matters (first match wins: "leyland cypress" must hit the hedge row,
 * not the conifer row). Unknown species get the conservative default.
 */
const CYCLES: Array<{ match: RegExp; label: string; minMonths: number; maxMonths: number }> = [
  { match: /leyland|arborvitae|privet|photinia|ligustrum|hedge/i, label: 'hedge/screen trim', minMonths: 12, maxMonths: 18 },
  { match: /crape\s*myrtle|crepe\s*myrtle/i, label: 'late-winter prune', minMonths: 12, maxMonths: 14 },
  { match: /apple|pear|peach|cherry|plum|fig|persimmon/i, label: 'fruit-tree prune', minMonths: 12, maxMonths: 14 },
  { match: /bradford|silver\s*maple|willow|mimosa|poplar/i, label: 'fast-grower check', minMonths: 24, maxMonths: 36 },
  { match: /oak|maple|elm|sycamore|hickory|gum|beech|ash|pecan/i, label: 'canopy/deadwood check', minMonths: 36, maxMonths: 60 },
  { match: /pine|cedar|cypress|magnolia|holly(?!\s*hedge)/i, label: 'evergreen check', minMonths: 36, maxMonths: 60 },
];
const DEFAULT_CYCLE = { label: 'general maintenance check', minMonths: 24, maxMonths: 36 };

const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;

export interface TreeForecast {
  treeId: string;
  species: string | null;
  cycleLabel: string;
  /** Start/end of the "coming due" window, from the last real service. */
  dueFromIso: string;
  dueToIso: string;
  state: 'not_yet' | 'upcoming' | 'due' | 'overdue';
  monthsSinceService: number;
}

/** Forecast one tree. No service history → null: the twin never invents a date. */
export function forecastTree(tree: TreeRecord, now: Date): TreeForecast | null {
  if (!tree.lastServiceIso) return null;
  const last = Date.parse(tree.lastServiceIso);
  if (Number.isNaN(last)) return null;
  const cycle = (tree.species && CYCLES.find((c) => c.match.test(tree.species!))) || DEFAULT_CYCLE;
  const dueFrom = last + cycle.minMonths * MONTH_MS;
  const dueTo = last + cycle.maxMonths * MONTH_MS;
  const t = now.getTime();
  const state = t > dueTo ? 'overdue' : t >= dueFrom ? 'due' : t >= dueFrom - 2 * MONTH_MS ? 'upcoming' : 'not_yet';
  return {
    treeId: tree.id,
    species: tree.species,
    cycleLabel: cycle.label,
    dueFromIso: new Date(dueFrom).toISOString(),
    dueToIso: new Date(dueTo).toISOString(),
    state,
    monthsSinceService: Math.floor((t - last) / MONTH_MS),
  };
}

export interface GrowthTarget {
  propertyId: string;
  address: string;
  city: string | null;
  contactId: string | null;
  name?: string;
  consentOnFile?: boolean;
  suppressed?: boolean;
  trees: TreeRecord[];
}

export interface PropertyDue {
  propertyId: string;
  address: string;
  city: string | null;
  contactId: string | null;
  name?: string;
  /** Worst state on the lot drives the priority. */
  state: 'due' | 'overdue';
  forecasts: TreeForecast[];
  /** One warm internal line for the queue/app — a "worth a look", never a diagnosis. */
  note: string;
}

/** One human line per property, e.g. "Leyland (hedge/screen trim) last done 18 mo ago — typically ready for another pass." */
function dueNote(f: TreeForecast[]): string {
  const lead = [...f].sort((a, b) => b.monthsSinceService - a.monthsSinceService)[0]!;
  const what = lead.species ? lead.species : 'trees on file';
  const extra = f.length > 1 ? ` (+${f.length - 1} more tree${f.length > 2 ? 's' : ''} on the lot)` : '';
  return `${what} — ${lead.cycleLabel} last done ~${lead.monthsSinceService} mo ago; typically ready for another look${extra}. Offer a free look, never a diagnosis.`;
}

/** All properties with at least one tree in its due/overdue window. */
export function buildDueProperties(targets: GrowthTarget[], now: Date): PropertyDue[] {
  const out: PropertyDue[] = [];
  for (const t of targets) {
    const due = t.trees
      .map((tree) => forecastTree(tree, now))
      .filter((f): f is TreeForecast => f !== null && (f.state === 'due' || f.state === 'overdue'));
    if (due.length === 0) continue;
    out.push({
      propertyId: t.propertyId,
      address: t.address,
      city: t.city,
      contactId: t.contactId,
      ...(t.name !== undefined ? { name: t.name } : {}),
      state: due.some((f) => f.state === 'overdue') ? 'overdue' : 'due',
      forecasts: due,
      note: dueNote(due),
    });
  }
  return out.sort((a, b) => (a.state === b.state ? 0 : a.state === 'overdue' ? -1 : 1));
}

/**
 * §6 outreach: one recommend-only nudge per due property, through the same
 * §4 gates as everything else. No contact on file → nothing to send (the due
 * list still shows it in the app; ARBOR just can't and won't cold-reach).
 */
export function buildGrowthOutreach(legal: LegalConfig, targets: GrowthTarget[], now: Date): FollowUpQueue {
  const due: FollowUpAction[] = [];
  const suppressed: SuppressedAction[] = [];
  const scheduledFor = clampToQuietHours(legal, now).toISOString();
  for (const p of buildDueProperties(targets, now)) {
    if (!p.contactId) continue;
    const target = targets.find((t) => t.propertyId === p.propertyId)!;
    if (target.suppressed) {
      suppressed.push({ type: 'growth_outreach', targetId: p.contactId, reason: 'stop_suppressed' });
      continue;
    }
    if (target.consentOnFile === false) {
      suppressed.push({ type: 'growth_outreach', targetId: p.contactId, reason: 'no_consent' });
      continue;
    }
    due.push({
      type: 'growth_outreach',
      targetId: p.contactId,
      ...(p.name !== undefined ? { name: p.name } : {}),
      note: p.note,
      scheduledFor,
      recommendOnly: true,
    });
  }
  return { due, suppressed };
}
