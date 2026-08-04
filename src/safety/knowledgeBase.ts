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
// THE SAFETY KNOWLEDGE BASE — the training centre's library.
//
// ═══ WHY THIS FILE EXISTS. READ THIS BEFORE CHANGING ANYTHING IN IT. ═══
// Mike, 2026-08-04, asked why any of this matters:
//
//   "tree work is one of the most dangerous jobs and what if we can help
//    change that man thats the goal. helping to easily train people and
//    educate safety with hopes to stop the stupid deaths that happen, while
//    adding profits to the company owners bottom line by reducing fuck ups
//    and mishaps that should never happen."
//
// That is the point of the whole module and it is not decoration. Three
// things follow from it, and they are design constraints, not sentiment:
//
// 1. SAFETY AND PROFIT ARE THE SAME FEATURE HERE. Every serious injury in
//    this trade has a trail of small preventable things behind it, and every
//    one of those also cost money — the rework, the dropped limb through a
//    fence, the day lost, the premium. So `safe` and `fast` are not opposing
//    bars to balance. Reducing mishaps IS the margin. Anything built here
//    that treats them as a trade-off has misunderstood the job.
//
// 2. "EASILY TRAIN" IS A HARD REQUIREMENT. A training system a tired crew
//    will not open on a Tuesday morning prevents nothing. Friction is not a
//    UX preference on this surface — it is the difference between the
//    material being read and not being read, and therefore between the
//    lesson landing and not landing.
//
// 3. AND IT IS WHY THIS FILE REFUSES TO SAY "SAFE". A system built to stop
//    deaths that reassures somebody wrongly is worse than no system, because
//    it spends the trust it was given on a guess. The never-certify rule
//    below is not caution for its own sake — it is the only way a tool with
//    this purpose can be honest about what a photograph can and cannot show.
//
// MIKE, 2026-08-04: "i want that agent to be able to learn with strict
// regards towards job site safety and only related materials... links to
// reputable or industry leading sponsor video clips... exact clips of highly
// skilled and highly trained industry leaders in climbing and safe tree crew
// production work... it can for instance receive a photo of a job and know
// what position the crew member is at and recommend a piece of on the site
// training or helpful tips."
//
// ═══ THE ONE RULE THIS FILE EXISTS TO ENFORCE ═══
// A training library can point at material. It can NEVER say a position is
// safe. `CoachingPointer` has no field that could carry a verdict, and
// `assertNeverCertifiesSafe` runs on the real path. This is the §6B.3
// never-clear discipline moved onto a surface where being wrong puts someone
// on the ground: the permit engine cannot say "you're clear", and this cannot
// say "that's safe". Both say the same thing instead — here is what to check,
// and here is the qualified human who decides.
//
// Why so hard a line: a photo shows one frame. It cannot show the tie-in
// above the frame, the cut already made, the groundie out of shot, the rope
// angle, or what the climber knows that the camera does not. A system that
// said "your position looks good" from that would be guessing about a life.
//
// ═══ SCOPE IS NARROW ON PURPOSE ═══
// "only related materials". `SafetyTopic` is a closed list of job-site safety
// subjects. There is no 'general' and no 'other' — a piece of material that
// does not belong to one of these does not enter the library. That is the
// same shape as the reception guardrail against wandering off-topic, applied
// to what the trainer is allowed to learn from.

import { scanForbidden } from '../lint/forbiddenStrings.js';

/**
 * Every subject the trainer may hold material on. CLOSED LIST — adding a
 * member is a deliberate act, and there is deliberately no catch-all.
 */
export type SafetyTopic =
  | 'climbing_srt' // stationary/single rope technique
  | 'climbing_ddrt' // doubled rope, moving rope
  | 'climbing_ascent' // footlock, knee ascender, spikeless ascent
  | 'work_positioning' // lanyards, redirects, being tied in twice
  | 'aerial_rescue' // getting an injured climber down
  | 'rigging' // lowering, speedlines, negative rigging, friction devices
  | 'felling' // notches, hinges, back cuts, escape routes
  | 'chainsaw' // handling, kickback, bore cuts, PPE for saw work
  | 'chipper' // feed, the pull-in hazard, the bar
  | 'aerial_lift' // bucket, MEWP, boom
  | 'electrical_hazard' // proximity, minimum approach distance, qualified line clearance
  | 'ppe' // helmet, saw trousers, eye and hearing protection
  | 'drop_zone' // ground crew position, communication, exclusion
  | 'storm_damage' // loaded limbs, spring poles, compromised stems
  | 'traffic_control'; // working a road edge

export const SAFETY_TOPICS: SafetyTopic[] = [
  'climbing_srt', 'climbing_ddrt', 'climbing_ascent', 'work_positioning',
  'aerial_rescue', 'rigging', 'felling', 'chainsaw', 'chipper', 'aerial_lift',
  'electrical_hazard', 'ppe', 'drop_zone', 'storm_damage', 'traffic_control',
];

/**
 * A written source. Clause citations only for the standards — §6U.3 and
 * `NEVER_REPRODUCE` already forbid reproducing ANSI text, and that holds here.
 */
export interface SafetySource {
  id: string;
  topic: SafetyTopic;
  /** e.g. "ANSI Z133-2017 §8.1.9", "29 CFR 1910.269", "VOSH tree care packet" */
  citation: string;
  publisher: string;
  year: number;
  url: string | null;
  /** Paraphrase of the requirement in plain words. Never the standard's text. */
  plainWords: string;
}

/**
 * A VIDEO CLIP the trainer may point a crew member at.
 *
 * ═══ WHY `verifiedBy` IS NOT OPTIONAL ═══
 * ARBO cannot watch a video. It can hold a URL and a description, and a
 * description is a claim about content it has never seen. Recommending an
 * unwatched clip as safety training is the §1B failure in its worst place:
 * confidently pointing a climber at footage that might demonstrate the exact
 * thing you do not want copied.
 *
 * So a clip is not usable until a named human has watched it and said what it
 * shows. `verifiedBy: null` is a legitimate stored state — it means "queued,
 * nobody has watched it" — and `usableClips()` refuses to return those. They
 * are surfaced for review, never served as training.
 *
 * LINKS ONLY, NEVER COPIES. No field here holds video data. The library
 * points at the publisher's own hosting so the creator keeps their view,
 * their attribution, and their control — and so Art-is-Tree is never
 * redistributing somebody else's footage.
 */
export interface TrainingClip {
  id: string;
  topic: SafetyTopic;
  /** The organisation or instructor. Attribution is not optional. */
  publisher: string;
  /** Canonical URL on the publisher's own channel or site. */
  url: string;
  /** What a viewer is meant to take from it, in the verifier's words. */
  demonstrates: string;
  /** Optional in-clip range, seconds. Null = the whole thing. */
  startSec: number | null;
  endSec: number | null;
  /**
   * WHO APPROVED IT — not merely who watched it.
   *
   * Mike, 2026-08-04: "i want every single piece gone through and flagged for
   * approval. if it doesnt meet my safety or knowledge standards" it does not
   * get in. My first pass recorded "a named human watched this", which is a
   * weaker rule and would have served a clip somebody pressed play on and
   * disliked. Approval is a judgement against his two standards; watching is
   * not. See src/safety/curation.ts for the full gate, including the second
   * one — the clip's SOURCE must also be an approved professional.
   */
  verifiedBy: string | null;
  verifiedOnIso: string | null;
  /**
   * Set when the clip shows something that must NOT be copied — an unsafe
   * practice included as a counter-example. A trainer that served this
   * without the warning would be teaching the hazard.
   */
  counterExample?: string;
}

/**
 * Only clips that cleared review. Kept as the topic-layer filter; the
 * authoritative two-gate check (approved piece AND approved source) lives in
 * src/safety/curation.ts — this one cannot see sources.
 */
export function usableClips(all: TrainingClip[]): TrainingClip[] {
  return all.filter((c) => Boolean(c.verifiedBy && c.verifiedOnIso));
}

/** Clips waiting on a human to watch them. Surfaced, never served. */
export function unverifiedClips(all: TrainingClip[]): TrainingClip[] {
  return all.filter((c) => !(c.verifiedBy && c.verifiedOnIso));
}

/**
 * WHAT THE TRAINER IS ALLOWED TO SAY BACK.
 *
 * Note what is absent and cannot be added without changing this type: there
 * is no `safe`, no `compliant`, no `pass`, no `score`, no `verdict`. The
 * shape itself is the guarantee.
 */
export interface CoachingPointer {
  /** What the situation appears to involve. APPEARS — see `confidence`. */
  topic: SafetyTopic;
  /**
   * Always a question or a check, never a judgement. "Is the second tie-in
   * point set?" not "the second tie-in point is missing".
   */
  checks: string[];
  sources: SafetySource[];
  clips: TrainingClip[];
  /**
   * THREE STATES and the third is the honest one. A photo is one frame; most
   * of what decides whether a position is sound is out of shot.
   */
  confidence: 'topic_is_clear' | 'topic_is_a_guess' | 'cannot_tell';
  /** Who actually decides. Never ARBO. */
  decidedBy: string;
  line: string;
}

/** The words this surface may never say about a person's position. */
export const FORBIDDEN_SAFETY_VERDICTS = [
  "you're safe", 'you are safe', 'looks safe', 'that is safe', "that's safe",
  'safe to proceed', 'good to go', 'all clear', 'compliant', 'passes',
  'correctly tied in', 'properly rigged', 'no hazard', 'nothing wrong',
] as const;

/**
 * STRUCTURAL CHECK ON THE REAL PATH. If a future edit makes the trainer
 * certify a position — through a template, an LLM paraphrase, or a well-meant
 * summary line — this throws instead of telling a climber they are fine.
 */
export function assertNeverCertifiesSafe(p: CoachingPointer): void {
  const text = [p.line, ...p.checks].join(' ').toLowerCase();
  for (const v of FORBIDDEN_SAFETY_VERDICTS) {
    if (text.includes(v)) {
      throw new Error(
        `safety trainer: refused to say "${v}" about a crew member's position. ` +
        'This surface points at training material; it never certifies that anyone is safe.',
      );
    }
  }
  if (p.checks.length === 0) {
    throw new Error('safety trainer: a pointer with no checks is an empty reassurance — refuse it.');
  }
  const hits = scanForbidden(text, 'safety.coachingPointer');
  if (hits.length > 0) {
    throw new Error(`safety trainer: forbidden term "${hits[0]!.term}" in coaching output.`);
  }
}

/**
 * Build the pointer. Pure: what goes in decides what comes out, and nothing
 * here reads a photo — vision happens upstream and hands us a topic guess.
 *
 * `cannot_tell` is a first-class outcome. When the caller cannot name a
 * topic, the honest answer is "I cannot tell what this is showing" plus the
 * standing checks, NOT a confident guess at the most likely hazard.
 */
export function coachOn(input: {
  topic: SafetyTopic | null;
  confidence: CoachingPointer['confidence'];
  sources: SafetySource[];
  clips: TrainingClip[];
  /** Who on this crew makes the call. Named, never a role alone. */
  decidedBy: string;
}): CoachingPointer {
  const topic = input.topic ?? 'work_positioning';
  const clips = usableClips(input.clips).filter((c) => c.topic === topic);
  const sources = input.sources.filter((s) => s.topic === topic);

  const checks = input.confidence === 'cannot_tell'
    ? [
      'What is the climber tied in to, and is there a second point?',
      'Where is the drop zone, and is anyone standing in it?',
      'How far is the nearest conductor?',
    ]
    : CHECKS_BY_TOPIC[topic];

  const line = input.confidence === 'cannot_tell'
    ? `I cannot tell what this photo is showing. These are the standing checks — ${input.decidedBy} makes the call on site.`
    : input.confidence === 'topic_is_a_guess'
      ? `This LOOKS like ${topic.replace(/_/g, ' ')}, and I may have it wrong. Training material below; ${input.decidedBy} makes the call on site.`
      : `${topic.replace(/_/g, ' ')} — training material below. ${input.decidedBy} makes the call on site.`;

  const pointer: CoachingPointer = {
    topic,
    checks,
    sources,
    clips,
    confidence: input.confidence,
    decidedBy: input.decidedBy,
    line,
  };
  assertNeverCertifiesSafe(pointer);
  return pointer;
}

/**
 * The standing checks per topic. Every one is a QUESTION — phrased so that
 * answering it is the crew member's job, not ARBO's. A statement here would
 * be a diagnosis of a photo.
 */
export const CHECKS_BY_TOPIC: Record<SafetyTopic, string[]> = {
  climbing_srt: ['Is the anchor point sound and above the work?', 'Is the system redirected away from sharp unions?', 'Is a second point available before the cut?'],
  climbing_ddrt: ['Is the friction hitch dressed and set?', 'Is the tie-in point above the work position?'],
  climbing_ascent: ['Is the ascent line isolated to a single union?', 'Is there a backup on the ascent system?'],
  work_positioning: ['Is the climber tied in twice before making a cut?', 'Does the lanyard clear the cutting path?'],
  aerial_rescue: ['Who is the designated aerial rescuer today, and are they on site?', 'Is the rescue kit reachable from the ground?'],
  rigging: ['What is the estimated load against the weakest component?', 'Is anyone inside the fall or swing path?', 'Is the rigging point above the piece?'],
  felling: ['Is the hinge intact and the notch open enough for the lean?', 'Are both escape routes cleared and agreed out loud?'],
  chainsaw: ['Is the chain brake set when moving?', 'Is the cut planned to avoid the kickback quadrant?'],
  chipper: ['Is anyone reaching past the feed table?', 'Is the bottom feed bar reachable from where the feeder stands?'],
  aerial_lift: ['Is the harness clipped to the boom anchor, not the rail?', 'Are the outriggers set on pads and level?'],
  electrical_hazard: ['How far is the nearest conductor, and has anyone measured rather than eyeballed?', 'Is this line-clearance work, and is a qualified line-clearance arborist required?'],
  ppe: ['Helmet, eye and hearing protection on everyone inside the drop zone?', 'Saw trousers on whoever is running the saw?'],
  drop_zone: ['Is the drop zone marked and is everyone outside it?', 'Is there an agreed call for "clear" and does everyone know it?'],
  storm_damage: ['Is anything under spring load, and has the release direction been talked through?', 'Is the stem compromised above the work point?'],
  traffic_control: ['Are cones and signage set for the approach speed?', 'Is a spotter watching traffic rather than the tree?'],
};
