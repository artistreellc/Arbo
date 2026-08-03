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
// Certification expiry (brief §4, §6V). A lapsed cert is not a paperwork
// problem — it is a man on a rope whose aerial-rescue card ran out. So this
// answers BEFORE the day is assigned, and it answers honestly.
//
// The §1B rule applied to credentials, which is where it matters most:
//   - a cert row with no expiry date is UNKNOWN, not "current"
//   - a required cert with NO row at all is MISSING, not "not applicable"
//   - Arbo never claims a credential the company does not hold: there is no
//     path here that outputs "qualified", only "no expiry problem found".

export type CertType = 'first_aid' | 'cpr' | 'aerial_rescue' | 'tree_rescue' | 'cdl' | 'other';

export type CertState =
  | 'current'    // expires comfortably in the future
  | 'upcoming'   // inside the 60-day window
  | 'urgent'     // inside the 14-day window
  | 'lapsed'     // expiry has passed
  | 'unknown'    // a row exists but carries no expiry date
  | 'missing';   // required for this role, no row at all

export interface CertRow {
  id: string;
  crewMemberId: string;
  type: CertType;
  expiresOn: string | null; // ISO date
}

export interface CrewMemberRef {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

export interface CertFinding {
  crewMemberId: string;
  crewMemberName: string;
  type: CertType;
  state: CertState;
  /** Days until expiry; negative when lapsed, null when unknowable. */
  daysUntil: number | null;
  /** Admin-surface line. Never says anyone IS qualified. */
  line: string;
  /** Blocks assignment: a climber with no valid aerial rescue does not fly. */
  blocksAerialWork: boolean;
}

export const URGENT_DAYS = 14;
export const UPCOMING_DAYS = 60;

/**
 * Certs each role must hold. Absence of a row for one of these is MISSING —
 * the loudest possible answer — because "we never recorded it" and "he doesn't
 * have it" are indistinguishable from here, and safety takes the pessimistic
 * reading (§1B, §3.7).
 */
const REQUIRED_BY_ROLE: Record<string, CertType[]> = {
  climber: ['first_aid', 'cpr', 'aerial_rescue'],
  foreman: ['first_aid', 'cpr', 'aerial_rescue'],
  groundie: ['first_aid', 'cpr'],
  driver: ['first_aid', 'cpr', 'cdl'],
};

/**
 * An UNRECOGNISED role gets the STRICTEST requirements, not the lightest.
 * Falling back to 'groundie' would mean a typo in a role name quietly
 * exempts someone from the aerial-rescue check — the pessimistic reading is
 * the only safe one here, and a false alarm costs a phone call while the
 * other direction costs a rescue nobody can perform.
 */
const STRICTEST: CertType[] = ['first_aid', 'cpr', 'aerial_rescue'];

function requiredFor(role: string): { certs: CertType[]; roleRecognised: boolean } {
  const known = REQUIRED_BY_ROLE[role.trim().toLowerCase()];
  return known ? { certs: known, roleRecognised: true } : { certs: STRICTEST, roleRecognised: false };
}

/** Certs whose absence or lapse grounds aerial work specifically. */
const AERIAL_CRITICAL: CertType[] = ['aerial_rescue', 'first_aid', 'cpr'];

const DAY = 86_400_000;

function daysBetween(fromIsoDate: string, toIsoDate: string): number | null {
  const a = Date.parse(`${fromIsoDate}T00:00:00Z`);
  const b = Date.parse(`${toIsoDate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY);
}

export function certState(expiresOn: string | null, todayEt: string): { state: CertState; daysUntil: number | null } {
  if (!expiresOn) return { state: 'unknown', daysUntil: null };
  const d = daysBetween(todayEt, expiresOn);
  if (d === null) return { state: 'unknown', daysUntil: null };
  if (d < 0) return { state: 'lapsed', daysUntil: d };
  if (d <= URGENT_DAYS) return { state: 'urgent', daysUntil: d };
  if (d <= UPCOMING_DAYS) return { state: 'upcoming', daysUntil: d };
  return { state: 'current', daysUntil: d };
}

const LABEL: Record<CertType, string> = {
  first_aid: 'First aid',
  cpr: 'CPR',
  aerial_rescue: 'Aerial rescue',
  tree_rescue: 'Tree rescue',
  cdl: 'CDL',
  other: 'Certification',
};

/**
 * Every expiry problem across the crew, worst first. Only problems are
 * returned: this function has no vocabulary for declaring anyone cleared.
 */
export function findCertProblems(
  crew: CrewMemberRef[],
  certs: CertRow[],
  todayEt: string,
): CertFinding[] {
  const out: CertFinding[] = [];
  const byMember = new Map<string, CertRow[]>();
  for (const c of certs) {
    const list = byMember.get(c.crewMemberId) ?? [];
    list.push(c);
    byMember.set(c.crewMemberId, list);
  }

  for (const m of crew) {
    if (!m.active) continue; // an inactive member is not on the schedule
    const held = byMember.get(m.id) ?? [];
    const { certs: required, roleRecognised } = requiredFor(m.role);

    for (const type of required) {
      // The NEWEST row for this type is the one that governs — an old expired
      // card must not outvote this year's renewal.
      const rows = held.filter((h) => h.type === type);
      const governing = rows.length
        ? rows.reduce((best, r) =>
            (r.expiresOn ?? '') > (best.expiresOn ?? '') ? r : best)
        : null;

      const roleNote = roleRecognised
        ? ''
        : ` (role "${m.role}" is not one Arbo knows, so it was checked against the strictest requirements)`;

      if (!governing) {
        out.push({
          crewMemberId: m.id, crewMemberName: m.name, type, state: 'missing', daysUntil: null,
          line: `${LABEL[type]} — NO RECORD on file. Arbo cannot confirm this credential; do not assume it exists.${roleNote}`,
          blocksAerialWork: AERIAL_CRITICAL.includes(type),
        });
        continue;
      }

      const { state, daysUntil } = certState(governing.expiresOn, todayEt);
      if (state === 'current') continue;

      const line =
        state === 'lapsed'
          ? `${LABEL[type]} EXPIRED ${Math.abs(daysUntil!)} day(s) ago — this is not a reminder, it is a stop.`
          : state === 'urgent'
            ? `${LABEL[type]} expires in ${daysUntil} day(s) — book the renewal now.`
            : state === 'upcoming'
              ? `${LABEL[type]} expires in ${daysUntil} day(s).`
              : `${LABEL[type]} has no expiry date on file — Arbo cannot tell whether it is valid.`;

      out.push({
        crewMemberId: m.id, crewMemberName: m.name, type, state, daysUntil,
        line: line + roleNote,
        blocksAerialWork: AERIAL_CRITICAL.includes(type) && (state === 'lapsed' || state === 'unknown'),
      });
    }
  }

  const RANK: Record<CertState, number> = {
    lapsed: 0, missing: 1, unknown: 2, urgent: 3, upcoming: 4, current: 5,
  };
  return out.sort((a, b) =>
    RANK[a.state] - RANK[b.state] || (a.daysUntil ?? 0) - (b.daysUntil ?? 0));
}

/** Can this crew member be put on aerial work today? Never a bare "yes". */
export function aerialBlockers(findings: CertFinding[], crewMemberId: string): CertFinding[] {
  return findings.filter((f) => f.crewMemberId === crewMemberId && f.blocksAerialWork);
}
