// The R18 calendar hold, filed EXACTLY the way Mike files his own estimates
// (his words, 2026-09-24, and his real events): summary "Name - 7575551234"
// (or "- no phone"), the address in the LOCATION field, the description
// opening "Estimate - ", and the CITY color from the learned D34 map
// (VB=4, Norfolk=10, Chesapeake=5, Portsmouth=6).
//
// One builder for every door a call can come through — Arbo's own voice
// bridge and Sona via Quo — so the two can never drift into two formats.

import type { QualState } from './qualification.js';
import type { RequestedWindow } from '../ops/requestedWindow.js';
import { colorFor } from '../scheduling/config.js';

/** The R18 calendar hold — everything the writer may create. One shot, one shape. */
export interface CallHold {
  summary: string;
  description: string;
  location?: string;
  /** Mike's real scheme (D34): the CITY color for estimate visits. */
  colorId?: string;
  startIso: string;
  endIso: string;
}

export interface EstimateHoldInput {
  state: QualState;
  callerId: string | null;
  zip?: string;
  window: RequestedWindow | null;
  nowMs: number;
  /** Who took the call, for the first description line. */
  bookedBy: string;
}

export function buildEstimateHold(input: EstimateHoldInput): CallHold {
  const { state, window: win, nowMs } = input;
  const start = win ? win.startIso : new Date(nowMs + 30 * 60 * 1000).toISOString();
  const end = win ? win.endIso : new Date(nowMs + 50 * 60 * 1000).toISOString();
  const digits = input.callerId ? input.callerId.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '') : '';
  const cityColor = colorFor('estimate', state.city);
  return {
    summary: `${state.name ?? 'Caller'} - ${digits || 'no phone'}`,
    ...(state.address
      ? {
          location:
            state.address +
            (state.city ? `, ${state.city}, VA` : '') +
            (input.zip ? ` ${input.zip}` : ''),
        }
      : {}),
    ...(cityColor ? { colorId: cityColor } : {}),
    description: [
      `Estimate - booked by ${input.bookedBy} on the call. UNCONFIRMED - Mike confirms the time.`,
      state.jobType ? `Job: ${state.jobType}` : null,
      state.treeInfo ? `Tree: ${state.treeInfo}` : null,
      state.proximityPowerLines ? `Power lines: ${state.proximityPowerLines}` : null,
      win ? `Caller asked for: ${win.label}` : 'No time given - schedule with the caller.',
    ]
      .filter((l): l is string => l !== null)
      .join('\n'),
    startIso: start,
    endIso: end,
  };
}
