// Authored demonstration calls assembled from shared route primitives.
// These are not team playbooks or historical team tendencies.
import { ASSIGNMENT_SCHEMA } from './assignments.js';

export function exampleAssignments(concept, coverage, direction = 'right') {
  const routes = {
    slant_flat: { WR1: 'go', WR2: 'slant', WR3: 'flat', RB: 'check' },
    curls: { WR1: 'curl', WR2: 'curl', WR3: 'out', RB: 'check' },
    four_verticals: { WR1: 'go', WR2: 'go', WR3: 'seam', TE: 'seam' },
  }[concept];
  if (!routes) throw new RangeError(`unsupported example concept: ${concept}`);
  if (!['man', 'zone'].includes(coverage)) throw new RangeError(`unsupported example coverage: ${coverage}`);
  if (!['left', 'right'].includes(direction)) throw new RangeError(`unsupported example direction: ${direction}`);
  const readOrder = {
    slant_flat: ['WR2', 'WR3', 'WR1', 'RB'],
    curls: ['WR2', 'WR1', 'WR3', 'RB'],
    four_verticals: ['WR3', 'TE', 'WR1', 'WR2'],
  }[concept];
  const offense = { QB: { kind: 'quarterback', read_order: readOrder } };
  for (const slot of ['LT', 'LG', 'C', 'RG', 'RT', 'RB', 'TE', 'WR1', 'WR2', 'WR3']) {
    offense[slot] = routes[slot] ? { kind: 'route', route: routes[slot], ...(slot === 'RB' ? { check_release: true } : {}) } : { kind: 'block' };
  }
  const protectionAreas = { LT: [0.8, 7], LG: [-0.3, 3], C: [-1.4, 1.4], RG: [-3, 0.3], RT: [-7, -0.8] };
  for (const [slot, protection_area] of Object.entries(protectionAreas)) offense[slot].protection_area = protection_area;
  const defense = Object.fromEntries(['LEDGE', 'LDT', 'RDT', 'REDGE'].map((slot) => [slot, { kind: 'rush' }]));
  defense.LEDGE.rush_lane = 'outside';
  defense.REDGE.rush_lane = 'outside';
  // Cover 3: three deep thirds and four underneath zones. Coordinates are
  // forward and lateral yards relative to the offense's line of scrimmage.
  const zones = { MLB: [3, 12, -2, 8], WLB: [3, 12, 8, 26], NB: [3, 12, -26, -8],
    SS: [3, 12, -8, 2], LCB: [12, 30, 8, 27], RCB: [12, 30, -27, -8],
    FS: [12, 30, -8, 8] };
  const man = { LCB: 'WR1', RCB: 'WR2', NB: 'WR3', MLB: 'RB', WLB: 'TE' };
  for (const [slot, originalBounds] of Object.entries(zones)) {
    const bounds = direction === 'left'
      ? [originalBounds[0], originalBounds[1], -originalBounds[3], -originalBounds[2]] : originalBounds;
    const target = man[slot];
    defense[slot] = coverage === 'man' && target && offense[target].kind === 'route'
      ? { kind: 'man', target_slot: target } : { kind: 'zone', bounds };
  }
  return { schema_version: ASSIGNMENT_SCHEMA, offense, defense };
}

const MIRROR_GAP = {
  backside_c: 'play_side_c', backside_b: 'play_side_b', backside_a: 'play_side_a',
  play_side_a: 'backside_a', play_side_b: 'backside_b', play_side_c: 'backside_c',
};

/**
 * An authored executable inside-zone diagram. Its assignments are a V1
 * implementation choice and make no claim about a particular team's calls.
 */
export function exampleRunAssignments(direction = 'right') {
  if (!['left', 'right'].includes(direction)) throw new RangeError(`unsupported run direction: ${direction}`);
  const left = direction === 'left';
  const track = left
    ? { LT: 'play_side_c', LG: 'play_side_b', C: 'play_side_a', RG: 'backside_a', RT: 'backside_c' }
    : { LT: 'backside_c', LG: 'backside_a', C: 'play_side_a', RG: 'play_side_b', RT: 'play_side_c' };
  const offense = {
    QB: { kind: 'quarterback', action: 'handoff', target_slot: 'RB' },
    RB: { kind: 'runner', aiming_gap: 'play_side_a', read: 'daylight' },
  };
  for (const [slot, gap] of Object.entries(track)) offense[slot] = { kind: 'zone_block', track_gap: gap };
  offense.TE = { kind: 'block', target_slot: left ? 'LEDGE' : 'REDGE' };
  offense.WR1 = { kind: 'block', target_slot: 'LCB' };
  offense.WR2 = { kind: 'block', target_slot: 'RCB' };
  offense.WR3 = { kind: 'block', target_slot: 'NB' };

  const baseGaps = {
    LEDGE: 'backside_c', LDT: 'backside_a', RDT: 'play_side_a', REDGE: 'play_side_c',
    MLB: 'play_side_a', WLB: 'backside_b',
  };
  const defense = Object.fromEntries(Object.entries(baseGaps).map(([slot, gap]) => [slot,
    { kind: 'gap_fit', gap: left ? MIRROR_GAP[gap] : gap }]));
  for (const [slot, responsibility] of Object.entries({
    NB: 'force', LCB: 'corner', RCB: 'corner', SS: 'alley', FS: 'deep',
  })) defense[slot] = { kind: 'run_support', responsibility };
  return { schema_version: ASSIGNMENT_SCHEMA, offense, defense };
}
