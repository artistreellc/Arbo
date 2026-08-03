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
// BASIC arboriculture answers for the phone (VA brief §3.16, guardrails
// personality.education). Mike: "the knowledge base needs to be basic."
//
// So it is a short list of the questions people actually ask, with a spoken
// answer for each. No retrieval, no embeddings, no scoring — a keyword match
// over a dozen entries. If it ever needs to be cleverer than this, that is a
// conversation with Mike, not a refactor.
//
// TWO LINES THAT MATTER, and the only complicated thing in here:
//
//   1. General tree-care education  → answer it.
//      "What's wrong with MY tree"  → do not answer. Pivot to the in-person look.
//
//   2. CERTIFIED-ARBORIST TERRITORY → do not answer either. Mike, 2026-08-03:
//      "it is not to do certifed arborist questions releated knowlede
//      questions." Species identification, diseases and pests, treatment,
//      soil, cabling and bracing, risk assessment — these are an arborist's
//      job, not a receptionist's, and a confident wrong answer about a
//      disease is worse than no answer. Deflect to Mike.
//
// What is left is deliberately small: the three topics the guardrails
// explicitly sanction (topping, pruning season, storm prep) plus plain
// company logistics. That is the whole scope.
//
// Those two can be one word apart. "Is topping bad for a tree?" is education.
// "Is my tree dead?" is a diagnosis, and §3 forbids it absolutely. So the
// possessive check runs BEFORE any answer is looked up, and wins.

export interface KbEntry {
  /** Words that mean the caller is asking this. Lowercase. */
  triggers: string[];
  /** The spoken answer. 1–3 sentences, no lists — this is a phone call. */
  answer: string;
}

/**
 * The pivot. Every diagnosis question gets this, and it is deliberately the
 * same line the no-diagnosis golden rule uses, so the caller hears one
 * consistent company rather than two different refusals.
 */
export const ARBORIST_DEFLECTION =
  "That's more of an arborist question than I should answer off the top of my head — Mike's the one to ask, and he can look at it while he's out.";

export const DIAGNOSIS_PIVOT =
  "That's really something we'd want to see in person. I can get you on the schedule for a free estimate.";

/**
 * Signals that the caller is asking about THEIR tree rather than trees. Any
 * of these next to a condition word turns the question into a diagnosis.
 */
const POSSESSIVE = /\b(my|our|this|that|the)\s+(?:\w+\s+){0,2}(tree|oak|pine|maple|limb|branch|stump|trunk)\b|\bit\b/i;
const CONDITION = /\b(dead|dying|sick|diseased|rotten|rotting|hollow|safe|dangerous|fall|falling|come down|hazard|split|leaning|save|saved|savable)\b/i;

/**
 * True when this is "what's wrong with MY tree" rather than a general
 * question. Checked before the knowledge base, and it wins.
 */
export function isDiagnosisQuestion(text: string): boolean {
  return POSSESSIVE.test(text) && CONDITION.test(text);
}

/**
 * Certified-arborist territory. Not a diagnosis of one tree — the general
 * expert questions a receptionist still has no business answering.
 */
const ARBORIST_LEVEL = /\b(what (?:kind|species|type) of tree|identify|species|fungus|fungal|blight|canker|borer|beetle|insect|pest|disease|infest|treatment|treat it|inject|spray|soil (?:test|ph|compact)|cabling|bracing|guy(?:ing|-wire| wire)|root prun|risk assess\w*|tomograph\w*|resistograph\w*|decay\w*|girdl\w*)/i;

export function isArboristLevelQuestion(text: string): boolean {
  return ARBORIST_LEVEL.test(text);
}


/**
 * BASIC TREE-CARE TERMS. Mike: "it needs to know basic tree care terms."
 *
 * This is vocabulary, not advice. Knowing what "crown reduction" means lets
 * ARBO understand a caller who uses the word and say it back correctly. It is
 * NOT permission to recommend one — that is still the in-person look.
 *
 * The difference the code enforces:
 *   "What is cabling?"        → a definition. Answer it.
 *   "Should I cable my tree?" → a recommendation about their tree. Do not.
 */
export const TREE_TERMS: Record<string, string> = {
  'crown reduction': 'Crown reduction means shortening the overall height and spread by cutting back to healthy side branches — it keeps the tree\'s shape, unlike topping.',
  'crown thinning': 'Crown thinning is selectively taking out some interior branches so light and wind pass through, without changing the overall size.',
  'crown raising': 'Crown raising means removing the lowest branches to get clearance over a driveway, a roof, or a walkway.',
  'crown lifting': 'Crown lifting is the same as crown raising — taking the lowest limbs off for clearance underneath.',
  'deadwooding': 'Deadwooding is going through the canopy and taking out the dead branches, which are the ones most likely to come down on their own.',
  topping: 'Topping is cutting the top off a tree indiscriminately. It is bad practice — it forces weak regrowth and shortens the tree\'s life. Crown reduction is the proper alternative.',
  felling: 'Felling is taking a tree down in one piece, when there is room to drop it safely.',
  'sectional removal': 'Sectional removal is taking a tree down in pieces, rigged down bit by bit — that is what you do when there is no room to fell it.',
  rigging: 'Rigging is using ropes and friction to lower cut pieces under control instead of letting them drop.',
  'drop zone': 'The drop zone is the area kept clear underneath, where the pieces are coming down. Nobody stands in it.',
  canopy: 'The canopy is the leafy top of the tree — all the branches and foliage above the trunk.',
  'root flare': 'The root flare is where the trunk widens out into the roots at ground level. It should be visible, not buried under soil or mulch.',
  'water sprout': 'Water sprouts are the fast, weak vertical shoots that pop up along branches, often after heavy pruning.',
  sucker: 'Suckers are the shoots that come up from the base or the roots rather than the trunk.',
  hanger: 'A hanger is a broken limb caught up in the canopy that has not come down yet. They are a common storm hazard.',
  'widow maker': 'A widow maker is a hanging or broken limb overhead that can fall without warning — one of the things we look for first.',
  cabling: 'Cabling is installing a support cable between limbs to take strain off a weak union. Whether a tree needs it is a call for someone looking at it.',
  bracing: 'Bracing is a rod through a weak union to hold it together, usually alongside a cable.',
  union: 'A union is where two limbs or a limb and the trunk join. A tight, V-shaped union with bark trapped in it is weaker than a wide one.',
  'included bark': 'Included bark is bark trapped inside a tight union — it stops the two sides growing together properly and makes the union weak.',
  leader: 'The leader is the main upward stem. Some trees have one, some have several co-dominant leaders.',
  dbh: 'DBH just means diameter at breast height — the width of the trunk measured about four and a half feet up.',
  chipping: 'Chipping is running the brush through the chipper so it hauls away as chips instead of whole limbs.',
  'stump grinding': 'Stump grinding takes the stump down below ground level with a grinder, leaving grindings behind rather than a hole.',
};

/** "What is X", "what does X mean", "what's a X" — a definition request. */
const DEFINITION_ASK = /\b(what(?:'s| is| are| does)|define|meaning of|mean by|tell me about)\b/i;

/**
 * Look up a term the caller used. Returns null when nothing matches.
 * Longest term first, so "crown reduction" wins over a bare "crown".
 */
export function lookupTerm(text: string): { term: string; definition: string } | null {
  const t = text.toLowerCase();
  const terms = Object.keys(TREE_TERMS).sort((a, b) => b.length - a.length);
  for (const term of terms) {
    if (t.includes(term)) return { term, definition: TREE_TERMS[term]! };
  }
  return null;
}

/** The basics. Mike said basic, so this stays short. */
export const KNOWLEDGE_BASE: KbEntry[] = [
  {
    triggers: ['topping', 'top the tree', 'cut the top off', 'hat rack'],
    answer: "Topping is one of the worst things you can do to a tree — it forces weak regrowth that's more likely to fail later, and it usually shortens the tree's life. Proper crown reduction gets you the height you want without that.",
  },
  {
    triggers: ['best time', 'when should i prune', 'when to prune', 'what season', 'right time of year'],
    answer: 'Late winter into early spring is usually best for most trees here — the tree is dormant and it heals fast once it wakes up. Dead or dangerous wood can come out any time of year.',
  },
  {
    triggers: ['storm prep', 'hurricane', 'before a storm', 'storm season', 'prepare for a storm'],
    answer: "Storm prep is mostly thinning the canopy so wind passes through instead of pushing the whole tree, and getting deadwood out before it becomes a projectile. It's worth doing before the season, not during it.",
  },
  {
    triggers: ['stump grinding', 'stump grind', 'what happens to the stump', 'grind the stump'],
    answer: 'Stump grinding takes the stump down below grade and leaves you a pile of grindings you can use as fill or haul off. It is separate from the removal itself, so tell Mike if you want it done.',
  },
  {
    triggers: ['how long does it take', 'how long will it take', 'how long for a removal'],
    answer: "It depends entirely on the tree and what's around it — a clear back-yard removal is a different day from one over a roof. Mike will tell you when he sees it.",
  },
  {
    triggers: ['cleanup', 'clean up', 'mess', 'debris', 'do you haul'],
    answer: 'We clean up after ourselves — brush chipped and hauled, and the area raked out before we leave. If you want the wood left for firewood, just say so.',
  },
  {
    triggers: ['insurance', 'insured', 'licensed', 'bonded'],
    answer: "We're fully licensed and insured, and BBB A+ rated. Mike can bring proof of insurance out with him if you'd like a copy.",
  },
  {
    triggers: ['permit', 'do i need a permit', 'city permit'],
    answer: "Some properties need a permit depending on where the tree sits, and some don't — it comes down to the location and the overlay. Mike checks that as part of the estimate rather than guessing at it.",
  },
];

export interface KbResult {
  /** The line to say. */
  answer: string;
  /** How it was decided, for the call log. */
  source: 'knowledge_base' | 'term_definition' | 'diagnosis_pivot' | 'arborist_level' | 'no_match';
  /** True when Arbo genuinely had an answer — never inferred from a pivot. */
  answered: boolean;
}

/**
 * Answer a general tree question, or refuse to diagnose.
 *
 * Returns source 'no_match' when there is no vetted answer. That is NOT a
 * failure to hide: §1B — the caller gets the honest "Mike will know", never a
 * confident guess about somebody's tree. Making something up here is exactly
 * the §1.4 failure the VA brief calls the master rule.
 */
export function answerBasicQuestion(text: string): KbResult {
  // Diagnosis check FIRST. "Is topping bad" and "is my tree bad" are one word
  // apart, and only one of them is answerable.
  if (isDiagnosisQuestion(text)) {
    return { answer: DIAGNOSIS_PIVOT, source: 'diagnosis_pivot', answered: false };
  }
  // A plain "what does X mean" is vocabulary, and answering it is safe even
  // when the term itself is arborist territory — defining "cabling" is not
  // recommending it. This sits ABOVE the deflection for that reason, and
  // BELOW the diagnosis check, which always wins.
  if (DEFINITION_ASK.test(text)) {
    const hit = lookupTerm(text);
    if (hit) return { answer: hit.definition, source: 'term_definition', answered: true };
  }
  // Then arborist territory. Checked before the lookup too, so a question that
  // happens to contain a sanctioned keyword ("should I top it to stop the
  // borers?") still deflects rather than half-answering.
  if (isArboristLevelQuestion(text)) {
    return { answer: ARBORIST_DEFLECTION, source: 'arborist_level', answered: false };
  }
  const t = text.toLowerCase();
  for (const entry of KNOWLEDGE_BASE) {
    if (entry.triggers.some((k) => t.includes(k))) {
      return { answer: entry.answer, source: 'knowledge_base', answered: true };
    }
  }
  return {
    answer: "That's a good question — I'd rather have Mike answer that one properly than guess at it. He can go over it when he's out.",
    source: 'no_match',
    answered: false,
  };
}
