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
    const required = REQUIRED_BY_ROLE[m.role.toLowerCase()] ?? REQUIRED_BY_ROLE.groundie!;

    for (const type of required) {
      // The NEWEST row for this type is the one that governs — an old expired
      // card must not outvote this year's renewal.
      const rows = held.filter((h) => h.type === type);
      const governing = rows.length
        ? rows.reduce((best, r) =>
            (r.expiresOn ?? '') > (best.expiresOn ?? '') ? r : best)
        : null;

      if (!governing) {
        out.push({
          crewMemberId: m.id, crewMemberName: m.name, type, state: 'missing', daysUntil: null,
          line: `${LABEL[type]} — NO RECORD on file. Arbo cannot confirm this credential; do not assume it exists.`,
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
        crewMemberId: m.id, crewMemberName: m.name, type, state, daysUntil, line,
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
