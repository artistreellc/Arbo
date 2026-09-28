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
// PLAIN-ENGLISH SUMMARY OF A LIDAR TREE MEASUREMENT — owner ruling R25 (Mike,
// 2026-09-28); research docs/research/R25_permits_lidar_pwa.md part B.
//
// One paragraph for Mike and the crew. Every figure carries its confidence
// word; a metric the scan could not give is said out loud as "could not be
// read" (§1B), never shown as zero. Geometry only: no prices (§3 / R3), no
// health or condition words (never diagnose). It always ends with the
// sign-off line — a person confirms before any of it is used.

import type { MetricConfidence, TreeMeasurement } from './measure.js';
import { BREAST_HEIGHT_M } from './measure.js';

export const SIGN_OFF = 'Decision support — a person confirms before it\'s used.';

const M_TO_FT = 3.28084;
const CM_TO_IN = 0.393701;

function conf(c: MetricConfidence): string {
  return `${c.level} confidence (${c.reason})`;
}

function missing(what: string, c: MetricConfidence): string {
  return `${what} could not be read (${c.reason}).`;
}

export function summarizeTreeMeasurement(m: TreeMeasurement): string {
  const parts: string[] = [
    `Phone LiDAR scan, measured from the exported point cloud (${m.pointCount.toLocaleString('en-US')} points).`,
  ];

  if (m.heightM !== null) {
    parts.push(
      `Height about ${m.heightM.toFixed(1)} m (${(m.heightM * M_TO_FT).toFixed(0)} ft), ${conf(m.confidence.height)}.`,
    );
  } else {
    parts.push(missing('Height', m.confidence.height));
  }

  if (m.crownSpreadM !== null && m.crownAxesM) {
    parts.push(
      `Crown spread about ${m.crownSpreadM.toFixed(1)} m (${(m.crownSpreadM * M_TO_FT).toFixed(0)} ft) at its widest and ` +
        `${m.crownAxesM.minor.toFixed(1)} m the other way, ${conf(m.confidence.crown)}.`,
    );
  } else {
    parts.push(missing('Crown spread', m.confidence.crown));
  }

  const bhFt = (BREAST_HEIGHT_M * M_TO_FT).toFixed(1);
  if (m.dbhCm !== null) {
    parts.push(
      `Trunk diameter at breast height (${BREAST_HEIGHT_M} m / ${bhFt} ft) about ${m.dbhCm.toFixed(0)} cm ` +
        `(${(m.dbhCm * CM_TO_IN).toFixed(1)} in), ${conf(m.confidence.dbh)}` +
        (m.dbhFit ? `; ${m.dbhFit.rmseCm.toFixed(1)} cm scatter.` : '.'),
    );
  } else {
    parts.push(missing('Trunk diameter at breast height', m.confidence.dbh));
  }

  if (m.leanDeg !== null) {
    parts.push(`Trunk lean about ${m.leanDeg.toFixed(0)}° from vertical, ${conf(m.confidence.lean)}.`);
  } else {
    parts.push(missing('Trunk lean', m.confidence.lean));
  }

  if (m.warnings.length > 0) parts.push(`Check: ${m.warnings.map((w) => w.replace(/\.$/, '')).join('; ')}.`);
  parts.push(SIGN_OFF);
  return parts.join(' ');
}
