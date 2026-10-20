// Practice data for Quo photos (Mike, 2026-10-20: "Needs to be able to view
// photos on quo"). In simulation mode the Texts panel shows ONE practice text
// so the photo row and the full-screen viewer have something to render. It
// follows §3's simulation convention — a SIM- message, a 555-01xx number —
// and its photo is the SIM placeholder from the repo (src/app/sim-quo-photo.png),
// never a customer's. It is marked `practice` and the app labels it so.

import type { QuoMediaStore } from '../integrations/quoMedia.js';
import type { TextEntry } from '../ops/webhooks.js';

export function simQuoTexts(media: QuoMediaStore, nowMs: number): TextEntry[] {
  return [
    {
      at: new Date(nowMs - 25 * 60_000).toISOString(),
      line: 'quo',
      messageSid: 'SIM-MSG-PHOTO-1',
      from: '+17575550142',
      body: 'SIM- Here’s the oak leaning over the back fence. Can someone take a look?',
      // One photo the app can show, and one attachment it names but does not show.
      media: [media.mintSim('oak-1'), { mediaId: null, contentType: 'video/mp4', kind: 'video' }],
      practice: true,
    },
  ];
}
