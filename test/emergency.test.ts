import { describe, it, expect } from 'vitest';
import { detectEmergency } from '../src/reception/emergency.js';

describe('emergency detection (§3.4)', () => {
  const emergencies = [
    'A tree just fell on my house!',
    "There's a tree on my car in the driveway",
    'A big limb came down on the garage',
    'a branch is tangled in the power line',
    'the power line is down across my yard',
    'someone is trapped under a fallen branch',
    'a tree is blocking my driveway completely',
    'This is an emergency, can someone come now?',
  ];
  for (const t of emergencies) {
    it(`flags: "${t}"`, () => {
      expect(detectEmergency(t).isEmergency).toBe(true);
    });
  }

  const routine = [
    "I'd like a quote to trim the oak near my house",
    'I want to remove a big tree in the backyard',
    'Can I get an estimate for stump grinding?',
    'The tree is leaning a bit, want it looked at',
    'Just some cleanup after a storm last month',
  ];
  for (const t of routine) {
    it(`does not flag: "${t}"`, () => {
      expect(detectEmergency(t).isEmergency).toBe(false);
    });
  }
});
