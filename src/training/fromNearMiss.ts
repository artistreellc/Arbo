// Near miss → lesson (brief §6V, §6M, §4.7). This is the loop that makes a
// near-miss programme worth running: an incident the crew survived becomes a
// lesson the next crew sees before they meet it.
//
// Two hard rules:
//   §4.7 — a life-safety training item can NEVER auto-publish. Everything this
//     module produces is a DRAFT (published: false). The DB CHECK
//     (training_item_vetted_before_publish) is the floor; this is the ceiling.
//     Arbo drafts, a named human vets, only then does a crew read it.
//   §4.3 — the generated item must not carry contact PII. Obvious identifiers
//     (phone, email, street address) are stripped mechanically. NAMES are not
//     machine-detectable with any honesty, so they are not silently "handled":
//     the draft is flagged so the human vetter is told to check, and the
//     publish gate is what stops a name reaching the crew.

import type { HazardCategory } from '../safety/nearMiss.js';

export interface NearMissSource {
  id: string;
  description: string;
  hazardCategory: HazardCategory;
  occurredOn: string;
}

export interface LessonDraft {
  type: 'lesson';
  topic: string;
  body: {
    headline: string;
    whatHappened: string;
    whatToDoDifferently: string[];
    standardRefs: string[];
  };
  difficulty: number;
  source: 'event_generated';
  originNearMissId: string;
  /** ALWAYS false. There is no path in this module that publishes (§4.7). */
  published: false;
  /** Told to the vetter, not to the crew. */
  vetterNotes: string[];
}

/** Category → the lesson scaffold and the clause it hangs on. */
const SCAFFOLD: Record<HazardCategory, {
  topic: string; headline: string; actions: string[]; refs: string[];
}> = {
  electrical: {
    topic: 'Electrical hazards',
    headline: 'A conductor came into play on a live job',
    actions: [
      'Identify every conductor on the lot before the first cut, out loud, as a crew.',
      'Set and call the minimum approach distance for the voltage present.',
      'If any part of the plan brings a person, tool, or limb inside that distance, the plan changes — not the distance.',
    ],
    refs: ['Z133 §4.1', 'Z133 §4.2'],
  },
  fall: {
    topic: 'Fall protection',
    headline: 'A climber lost or nearly lost their attachment',
    actions: [
      'Two points of attachment before moving through the canopy.',
      'Inspect the lanyard and saddle at the tailgate, not at height.',
      'Call the move before making it so the ground knows where you are going.',
    ],
    refs: ['Z133 §8.1'],
  },
  struck_by: {
    topic: 'Drop zone discipline',
    headline: 'Something came down that the ground was not ready for',
    actions: [
      'The drop zone is named and cleared before the cut, every cut.',
      'Nobody enters the drop zone without the climber acknowledging it.',
      'Call the cut. Wait for the answer. Then cut.',
    ],
    refs: ['Z133 §8.1', 'Z133 §5.1'],
  },
  cutting: {
    topic: 'Saw handling',
    headline: 'A saw did something the operator did not intend',
    actions: [
      'Check the chain brake and bar before the first start of the day.',
      'Plan the escape path before the cut, not during it.',
      'Never cut above shoulder height with the tip unsupported.',
    ],
    refs: ['Z133 §5.1'],
  },
  rigging: {
    topic: 'Rigging',
    headline: 'A rigged piece behaved differently than planned',
    actions: [
      'Size the rigging to the piece, and say the number out loud before it flies.',
      'Nobody stands in line with a loaded rope.',
      'When the piece is bigger than the plan, take it in two.',
    ],
    refs: ['Z133 §8.5'],
  },
  vehicle: {
    topic: 'Vehicles and traffic',
    headline: 'A vehicle movement created a hazard',
    actions: [
      'A spotter walks every backing movement — no spotter, no backing.',
      'Set cones and the work-zone taper before the first tool comes out.',
      'Never assume a driver on the road has seen you.',
    ],
    refs: ['Z133 §3.3'],
  },
  environmental: {
    topic: 'Site and environment',
    headline: 'Conditions on the lot created a hazard',
    actions: [
      'Walk the lot for footing, stinging insects, and overhead debris before setting up.',
      'Heat and dehydration degrade judgment before they degrade the body — water on schedule, not on thirst.',
      'If the wind or the light has changed since the plan, the plan gets re-said.',
    ],
    refs: ['Z133 §3.1'],
  },
  uncategorised: {
    topic: 'General safety',
    headline: 'A near miss was reported that does not fit a standard category',
    actions: [
      'Read what was reported and decide as a crew what would have prevented it.',
      'If this repeats, it needs its own category and its own lesson.',
    ],
    refs: [],
  },
};

/** Obvious contact identifiers. Names are NOT in here — see the header. */
const PII_PATTERNS: Array<{ re: RegExp; token: string }> = [
  { re: /\b(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, token: '[phone removed]' },
  { re: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g, token: '[email removed]' },
  { re: /\b\d{1,6}\s+[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*)*\s+(?:ave|avenue|st|street|rd|road|dr|drive|ln|lane|ct|court|blvd|way|cir|circle|pl|place|ter|trl|pkwy|hwy)\b\.?/gi, token: '[address removed]' },
];

export function redactObviousPii(text: string): { text: string; removed: string[] } {
  let out = text;
  const removed: string[] = [];
  for (const { re, token } of PII_PATTERNS) {
    if (re.test(out)) {
      removed.push(token.replace(/[[\]]|removed/g, '').trim());
      out = out.replace(re, token);
    }
    re.lastIndex = 0;
  }
  return { text: out, removed };
}

/**
 * Draft a lesson from a near miss. Never publishes, never guesses at a
 * category it was not given, and always tells the vetter what to check.
 */
export function buildLessonDraft(nm: NearMissSource): LessonDraft {
  const scaffold = SCAFFOLD[nm.hazardCategory] ?? SCAFFOLD.uncategorised;
  const { text, removed } = redactObviousPii(nm.description);

  const vetterNotes: string[] = [
    'Check this text for anyone\'s name before publishing — Arbo cannot detect names reliably and did not try.',
  ];
  if (removed.length) vetterNotes.push(`Automatically removed: ${removed.join(', ')}.`);
  if (nm.hazardCategory === 'uncategorised') {
    vetterNotes.push('This near miss matched no known hazard pattern — pick the right topic and refs by hand.');
  }

  return {
    type: 'lesson',
    topic: scaffold.topic,
    body: {
      headline: scaffold.headline,
      // The crew reads what actually happened, in the reporter's words, minus
      // the contact identifiers. A sanitised abstraction teaches nothing.
      whatHappened: text,
      whatToDoDifferently: scaffold.actions,
      standardRefs: scaffold.refs,
    },
    // Electrical and fall incidents lead the rotation.
    difficulty: nm.hazardCategory === 'electrical' || nm.hazardCategory === 'fall' ? 3 : 2,
    source: 'event_generated',
    originNearMissId: nm.id,
    published: false,
    vetterNotes,
  };
}
