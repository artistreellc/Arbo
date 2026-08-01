// Emergency detection (brief §3.4). A tree on a house/car/structure/power line,
// or anyone in danger, must NOT be slotted as a normal estimate — it fast-tracks
// an alert to Mike. Deterministic so it can't be missed. Biased toward catching:
// a false ping to Mike is acceptable; a missed emergency is not.

export interface EmergencyResult {
  isEmergency: boolean;
  reason: string | null;
}

const STRUCTURE = '(roof|car|house|home|garage|shed|vehicle|truck|deck|fence|structure|building|porch)';

// Unambiguous emergencies.
const HARD: Array<{ re: RegExp; reason: string }> = [
  { re: new RegExp(`\\b(fell|fallen|falling|came down|crashed|collapsed|landed|toppled|smashed)\\b[^.]{0,40}\\b${STRUCTURE}\\b`, 'i'), reason: 'tree down on a structure/vehicle' },
  { re: /\b(power ?line|powerline|electrical wire)\b[^.]{0,30}\b(down|touching|on it|tangled|arcing|sparking)\b/i, reason: 'power line involved' },
  { re: /\b(down|touching|tangled|arcing|sparking|on)\b[^.]{0,30}\b(power ?line|powerline|electrical wire)\b/i, reason: 'power line involved' },
  { re: /\b(someone|somebody|person|kid|child|anyone|neighbor)\b[^.]{0,30}\b(hurt|injured|trapped|stuck|pinned|in danger)\b/i, reason: 'person in danger' },
  { re: /\bblock(ing|ed)?\b[^.]{0,20}\b(driveway|road|street|exit|door)\b/i, reason: 'access blocked' },
  { re: /\bemergency\b/i, reason: 'caller said emergency' },
];

// A tree resting on a structure — emergency unless the call is clearly routine.
const REST_ON = new RegExp(`\\btree\\b[^.]{0,20}\\bon (my|the|a|top of)\\b[^.]{0,20}${STRUCTURE}`, 'i');
const ROUTINE = /\b(trim|prune|trimmed|pruned|cut back|hedge|quote|estimate|schedule|appointment)\b/i;

export function detectEmergency(text: string): EmergencyResult {
  for (const { re, reason } of HARD) {
    if (re.test(text)) return { isEmergency: true, reason };
  }
  if (REST_ON.test(text) && !ROUTINE.test(text)) {
    return { isEmergency: true, reason: 'tree on a structure/vehicle' };
  }
  return { isEmergency: false, reason: null };
}
