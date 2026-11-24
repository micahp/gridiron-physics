// Authored demonstration calls assembled from shared route primitives.
// These are not team playbooks or historical team tendencies.
import { ASSIGNMENT_SCHEMA } from './assignments.js';

export function exampleAssignments(concept, coverage) {
  const routes = {
    slant_flat: { WR1: 'go', WR2: 'slant', WR3: 'flat', RB: 'check' },
    curls: { WR1: 'curl', WR2: 'curl', WR3: 'out', RB: 'check' },
    four_verticals: { WR1: 'go', WR2: 'go', WR3: 'seam', TE: 'seam' },
  }[concept];
  if (!routes) throw new RangeError(`unsupported example concept: ${concept}`);
  if (!['man', 'zone'].includes(coverage)) throw new RangeError(`unsupported example coverage: ${coverage}`);
  const offense = { QB: { kind: 'quarterback' } };
  for (const slot of ['LT', 'LG', 'C', 'RG', 'RT', 'RB', 'TE', 'WR1', 'WR2', 'WR3']) {
    offense[slot] = routes[slot] ? { kind: 'route', route: routes[slot], ...(slot === 'RB' ? { check_release: true } : {}) } : { kind: 'block' };
  }
  const defense = Object.fromEntries(['LEDGE', 'LDT', 'RDT', 'REDGE'].map((slot) => [slot, { kind: 'rush' }]));
  const zones = { MLB: [3, 10, -4, 4], WLB: [3, 10, 5, 14], NB: [3, 10, -14, -4],
    LCB: [8, 18, 8, 25], RCB: [8, 18, -25, -8], SS: [6, 14, -8, 0], FS: [13, 25, -8, 8] };
  const man = { LCB: 'WR1', RCB: 'WR2', NB: 'WR3', MLB: 'RB', WLB: 'TE' };
  for (const [slot, bounds] of Object.entries(zones)) {
    const target = man[slot];
    defense[slot] = coverage === 'man' && target && offense[target].kind === 'route'
      ? { kind: 'man', target_slot: target } : { kind: 'zone', bounds };
  }
  return { schema_version: ASSIGNMENT_SCHEMA, offense, defense };
}
