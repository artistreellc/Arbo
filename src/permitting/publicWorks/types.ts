// Public works & permits knowledge base — types (R25, Mike 2026-09-28:
// "a public works and permits handcrafted data base").
//
// Hand-entered, sourced facts for the four service cities plus the regional
// and state rules that sit over them. Sources: docs/research/R25_permits_lidar_pwa.md
// and src/permitting/cities.ts (running code — this DB sits alongside it and
// never overrides it).
//
// Vocabulary law (§6B.3, §12): nothing here ever says a job is "clear". An
// UNCONFIRMED fact says so in its own `confidence`, and the reason is in `notes`.

import type { ServiceCity } from '../../lib/address.js';

/** Where a fact applies: one service city, the Hampton Roads region, or all of Virginia. */
export type FactScope = ServiceCity | 'Regional' | 'Virginia';

export const TOPICS = [
  'private_tree_cbpa',
  'street_tree_row',
  'row_work_mot',
  'historic',
  'wetlands',
  'disposal',
  'burning',
  'utility_811',
  'power_lines',
  'licensing',
  'hazard_order',
  'eagle_wildlife',
] as const;
export type Topic = (typeof TOPICS)[number];

/**
 * SOURCED — a source states it directly.
 * UNCONFIRMED — sources conflict, or none states it directly. `notes` says why.
 * Either way, verify with the office before it goes into a customer script.
 */
export type Confidence = 'SOURCED' | 'UNCONFIRMED';

export interface WhoToCall {
  office: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface FactForm {
  name: string;
  url?: string;
}

export interface Fact {
  /** Stable id, e.g. "vb-rpa-buffer". Checklist items point at these. */
  id: string;
  city: FactScope;
  topic: Topic;
  title: string;
  /** Plain English, short. Never a price, never "clear". */
  rule: string;
  whoToCall?: WhoToCall;
  form?: FactForm;
  /**
   * Government-set money figures only (city fees, fines, license thresholds).
   * The ONLY field that may hold a dollar figure — never an Art-is-Tree price.
   */
  fee?: string;
  leadTime?: string;
  /**
   * Public URLs, or `arbo:src/permitting/cities.ts` for facts cities.ts already
   * carries (learned from Mike's own permit correspondence, no public page).
   */
  sourceUrls: string[];
  confidence: Confidence;
  /** ISO date the fact was last checked against its source. */
  verifiedOn: string;
  /** INTERNAL. Never read to a customer. Holds the reason for UNCONFIRMED. */
  notes?: string;
}
