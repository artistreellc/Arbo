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
// Date promises (golden rule no-date-guarantee; R26, Mike 2026-10-20: "a code
// guard that blocks a spoken or drafted date promise"). THE one copy of these
// patterns. guardReply runs them on every line Arbo would speak or draft, so
// inspectMessage (texts), Sona's slip check, the agents' brain and the sim
// judge all read this list through it. Before R26 they lived in two places
// (binder/policyEngine and sim/judge) and the voice guard had none.
//
// A promise is US committing to a day, a date or a clock time for work or a
// visit: "we'll be there Tuesday", "Mike can come out tomorrow at 3", "we can
// do it on the 14th", "this week for sure". Talk about time that commits to
// nothing is left alone: office hours, "Mike will call you back", asking the
// caller when they are free, a quiet-hours hold, or the caller's own day said
// back to them as a question.

// "a Saturday" / "any Saturday" is no particular day ("estimates after work or
// on a Saturday"), so a weekday counts only when it is not one of those.
const DAY = '(?:today|tomorrow|tonight|(?<!\\b(?:a|any|every|most)\\s)(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this (?:coming )?week(?:end)?|next week(?:end)?)';
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE = `(?:the \\d{1,2}(?:st|nd|rd|th)|${MONTH} \\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}/\\d{1,2})`;
// "at 3" / "at noon" / "at midday"; by, around, before or after only with an
// am/pm, noon or midday after it, so "booked out by 3 weeks" is not a time.
const TIME = '(?:at (?:\\d{1,2}(?::\\d{2})?(?:\\s?[ap]\\.?m\\b\\.?)?|noon|midday)|(?:by|around|before|after) (?:\\d{1,2}(?::\\d{2})?\\s?[ap]\\.?m\\b\\.?|noon|midday))';
/** A day, a calendar date or a clock time. */
const WHEN = `(?:${DAY}|${DATE}|${TIME})\\b`;

/** Who would be doing the coming: us, or the job itself ("it'll be done"). */
const WHO = '(?:we|i|mike|he|they|someone|somebody|the crew|our crew|the guys|it|that|the job|the work)';
const WILL = "(?:'ll|'re going to|'s going to|'m going to|\\s+(?:will|can|could|are going to|is going to|am going to))";
/** Showing up or doing the work. Calling, texting and confirming are not on this list. */
const VISIT = '(?:be (?:there|out|by|over|done|finished)|come(?: out| by| over)?|stop by|swing by|get (?:there|out|over|to (?:it|you|that))|get (?:it|that|the (?:job|work)) done|have (?:it|that|the (?:job|work)) (?:done|finished|taken care of|handled)|take care of (?:it|that)|make it(?: out)?|do (?:it|that|the (?:job|work|removal|trim)|you)|finish(?: it| up)?|start(?: it| the (?:job|work))?|fit you in|squeeze you in|get you (?:in|on the schedule|scheduled)|(?:get|send|have) (?:someone|somebody|a crew|the crew|a guy|the guys|a team|a truck)|(?:get|send|have) (?:mike|him) (?:out|over|by|there))';
/** Up to 25 characters between the visit and the day — never across a clause, and never through a callback. */
const GAP = '(?:(?!confirm|call|text|let you know)[^.!?,;—–]){0,25}?';

/** A promise in any sentence, question mark or not ("we'll be there Tuesday, okay?"). */
const PROMISES: RegExp[] = [
  // "if / whether he can come out Saturday" asks; it does not promise.
  new RegExp(`(?<!\\b(?:if|whether)\\s)\\b${WHO}${WILL}\\s+(?:definitely |for sure |probably )?${VISIT}\\b${GAP}\\b${WHEN}`, 'i'),
  // "Mike's coming out Tuesday" — the present tense said as the future. Coming
  // BACK to the caller is a callback, not a visit, and "that's coming
  // tomorrow" is the storm, not us.
  new RegExp(`(?<!\\b(?:if|whether)\\s)\\b(?!that\\b)${WHO}(?:'s|'re|'m|\\s+(?:is|are|am))\\s+(?:definitely |for sure )?(?:coming|stopping by|swinging by|heading)(?! back)(?: out| by| over| there)?\\b${GAP}\\b${WHEN}`, 'i'),
  new RegExp(`\\byou(?:'re| are)(?: all)? (?:booked|scheduled|set|confirmed|on the (?:schedule|calendar)) (?:for |on )?${WHEN}`, 'i'),
  // "I can't promise Tuesday" is the right answer, not a promise — and so is
  // "I don't want to promise" / "I'm not able to promise".
  new RegExp(`(?<!\\b(?:can'?t|cannot|not|never|won'?t|don'?t|couldn'?t|unable)\\s(?:(?:want|able|going)\\s)?(?:to\\s)?)\\b(?:promise|guarantee)[ds]?\\b[^.!?]{0,40}\\b${WHEN}`, 'i'),
  /\bguarantee[ds]? (?:you )?(?:a|the) (?:date|slot|time)\b/i,
  /\bI(?:'ve| have) booked you (?:in )?for\b/i,
  /\bI(?:'ve| have) (?:scheduled|put) you (?:in|on|down)\b/i,
];

/**
 * Agreeing to the caller's day. Only in a statement: "Tuesday works." is a
 * yes; "So Tuesday works for you?" is the caller's own words asked back. A
 * question shields only its last clause (findDatePromise).
 */
const AGREEMENTS: RegExp[] = [
  new RegExp(`(?<!\\b(?:if|whether|what|which|when)\\s)\\b${DAY} (?:works|is (?:fine|good|open|available|no problem))\\b`, 'i'),
  /(?<!\b(?:if|whether)\s)\bthat (?:day|time) works\b/i,
  // "Tomorrow, no problem." — but not a callback or a hand-off to Mike ("Mike
  // will call you back today for sure", "I'll get this to Mike today, no problem").
  new RegExp(`(?<!\\b(?:call|text|reach out|get back|let you know|to (?:mike|him))\\b[^.!?]{0,40})\\b${WHEN},? (?:for sure|guaranteed|no problem)\\b|\\b(?:definitely|for sure|guaranteed),? (?:by |on |this |next )?${WHEN}`, 'i'),
  /\b(?:done|finished) (?:before|by) (?:then|the (?:wedding|party|storm|hurricane))\b/i,
];

/** The words that promise a date, or null. Same text, same answer — no model. */
export function findDatePromise(text: string): string | null {
  // A typographic apostrophe (’ ‘ ʼ) reads as ' — "We’ll be there Tuesday" is
  // the same promise, and "can’t promise" the same negation. Only the copy
  // matched here changes; the caller still hears the reply as written.
  const t = text.replace(/[‘’ʼ]/g, "'");
  for (const re of PROMISES) {
    const m = t.match(re);
    if (m) return m[0];
  }
  for (const sentence of t.split(/(?<=[.!?])\s+|\n+/)) {
    const s = sentence.trim();
    // A question shields only its own last clause: "So Tuesday works for
    // you?" is asked back, but "Tuesday works — what's the address?" said yes
    // first. Everything before the last clause break is checked whole.
    const breaks = [...s.matchAll(/\s[—–-]\s|[,;]\s/g)];
    const said = s.endsWith('?') ? s.slice(0, breaks.at(-1)?.index ?? 0) : s;
    for (const re of AGREEMENTS) {
      const m = said.match(re);
      if (m) return m[0];
    }
  }
  return null;
}
