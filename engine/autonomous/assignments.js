// A composable pre-snap assignment description. Validation alone does not
// mean a particular executor supports or executes these assignments.
import { assertNoOutcomeFields, OFFENSE_ROLES, DEFENSE_ROLES } from './schema.js';
import { routeOffsets } from '../routes.js';

export const ASSIGNMENT_SCHEMA = 'gridiron.assignments.v1';
const DEFENSE_KINDS = new Set(['man', 'zone', 'rush', 'read']);
const RUN_GAPS = new Set(['backside_c', 'backside_b', 'backside_a', 'play_side_a', 'play_side_b', 'play_side_c']);
const RUN_SUPPORT = new Set(['force', 'alley', 'deep', 'corner']);

export function validateAssignments(input, { executable = false, family = 'pass' } = {}) {
  assertNoOutcomeFields(input);
  if (!input || input.schema_version !== ASSIGNMENT_SCHEMA) throw new TypeError('unsupported assignment schema');
  if (!input.offense || !input.defense) throw new TypeError('both assignment sides are required');
  for (const [slot, task] of Object.entries(input.offense)) {
    if (!OFFENSE_ROLES.includes(slot) || !task || !['route', 'block', 'quarterback', 'runner', 'zone_block'].includes(task.kind)) {
      throw new TypeError(`unsupported offensive assignment: ${slot}`);
    }
    if (task.kind === 'route') routeOffsets(task.route, task.lateral ?? 1);
    if (task.check_release != null && typeof task.check_release !== 'boolean') throw new TypeError('check_release must be boolean');
  }
  if (family !== 'pass' && family !== 'run') throw new RangeError('assignment family must be pass or run');
  if (executable) {
    for (const slot of OFFENSE_ROLES) if (!input.offense[slot]) throw new TypeError(`missing offensive assignment: ${slot}`);
    for (const slot of DEFENSE_ROLES) if (!input.defense[slot]) throw new TypeError(`missing defensive assignment: ${slot}`);
    if (family === 'run') {
      if (input.offense.QB.kind !== 'quarterback' || input.offense.QB.action !== 'handoff' || input.offense.QB.target_slot !== 'RB') {
        throw new TypeError('run QB must hand off to RB');
      }
      if (input.offense.RB.kind !== 'runner' || !RUN_GAPS.has(input.offense.RB.aiming_gap) || input.offense.RB.read !== 'daylight') {
        throw new TypeError('run RB needs a declared aiming gap and daylight read');
      }
      const qbKeys = ['kind', 'action', 'target_slot'];
      const rbKeys = ['kind', 'aiming_gap', 'read'];
      if (Object.keys(input.offense.QB).some((key) => !qbKeys.includes(key))) throw new TypeError('unsupported run QB assignment field');
      if (Object.keys(input.offense.RB).some((key) => !rbKeys.includes(key))) throw new TypeError('unsupported run RB assignment field');
      for (const slot of ['LT', 'LG', 'C', 'RG', 'RT']) {
        const task = input.offense[slot];
        if (task.kind !== 'zone_block' || !RUN_GAPS.has(task.track_gap)) throw new TypeError(`${slot} needs a zone-block track gap`);
        if (Object.keys(task).some((key) => !['kind', 'track_gap'].includes(key))) throw new TypeError(`unsupported ${slot} zone-block assignment field`);
      }
      for (const slot of ['TE', 'WR1', 'WR2', 'WR3']) {
        const task = input.offense[slot];
        if (task.kind !== 'block' || !DEFENSE_ROLES.includes(task.target_slot)) throw new TypeError(`${slot} needs a named run-block target`);
        if (Object.keys(task).some((key) => !['kind', 'target_slot'].includes(key))) throw new TypeError(`unsupported ${slot} run-block assignment field`);
      }
      for (const slot of ['LEDGE', 'LDT', 'RDT', 'REDGE', 'MLB', 'WLB']) {
        const task = input.defense[slot];
        if (task.kind !== 'gap_fit' || !RUN_GAPS.has(task.gap)) throw new TypeError(`${slot} needs a declared defensive gap fit`);
        if (Object.keys(task).some((key) => !['kind', 'gap'].includes(key))) throw new TypeError(`unsupported ${slot} gap-fit assignment field`);
      }
      for (const slot of ['NB', 'LCB', 'RCB', 'SS', 'FS']) {
        const task = input.defense[slot];
        if (task.kind !== 'run_support' || !RUN_SUPPORT.has(task.responsibility)) throw new TypeError(`${slot} needs a declared run-support responsibility`);
        if (Object.keys(task).some((key) => !['kind', 'responsibility'].includes(key))) throw new TypeError(`unsupported ${slot} run-support assignment field`);
      }
      for (const [slot, task] of Object.entries(input.offense)) {
        if (slot !== 'QB' && slot !== 'RB' && slot !== 'LT' && slot !== 'LG' && slot !== 'C' && slot !== 'RG' && slot !== 'RT'
            && slot !== 'TE' && slot !== 'WR1' && slot !== 'WR2' && slot !== 'WR3') throw new TypeError(`unsupported run assignment: ${slot}`);
        if (task.kind === 'route' || task.kind === 'runner' && slot !== 'RB' || task.kind === 'zone_block' && !['LT', 'LG', 'C', 'RG', 'RT'].includes(slot)) {
          throw new TypeError(`assignment kind does not fit run role: ${slot}`);
        }
      }
      for (const [slot, task] of Object.entries(input.defense)) {
        if (task.kind === 'gap_fit' && !['LEDGE', 'LDT', 'RDT', 'REDGE', 'MLB', 'WLB'].includes(slot)
            || task.kind === 'run_support' && !['NB', 'LCB', 'RCB', 'SS', 'FS'].includes(slot)
            || ['man', 'zone', 'rush', 'read'].includes(task.kind)) throw new TypeError(`assignment kind does not fit run role: ${slot}`);
      }
    } else {
    if (input.offense.QB.kind !== 'quarterback') throw new TypeError('QB needs quarterback assignment');
    for (const [slot, task] of Object.entries(input.offense)) {
      const allowed = task.kind === 'route' ? ['kind', 'route', 'check_release'] :
        task.kind === 'quarterback' ? ['kind', 'decision_delay_seconds', 'read_order'] : ['kind'];
      if (Object.keys(task).some((key) => !allowed.includes(key))) throw new TypeError(`unsupported offensive assignment field: ${slot}`);
      if (task.decision_delay_seconds != null && (!Number.isFinite(task.decision_delay_seconds) || task.decision_delay_seconds < 0 || task.decision_delay_seconds > 4)) throw new RangeError('decision delay must be from 0 to 4 seconds');
      if (task.read_order != null && (slot !== 'QB' || !Array.isArray(task.read_order)
          || task.read_order.length === 0 || new Set(task.read_order).size !== task.read_order.length
          || task.read_order.some((target) => input.offense[target]?.kind !== 'route')
          || task.read_order.length !== Object.values(input.offense).filter((item) => item.kind === 'route').length)) {
        throw new TypeError('QB read order must list each assigned route exactly once');
      }
    }
    for (const slot of ['LT', 'LG', 'C', 'RG', 'RT']) {
      if (input.offense[slot].kind !== 'block') throw new TypeError(`${slot} must block`);
    }
    for (const slot of ['RB', 'TE', 'WR1', 'WR2', 'WR3']) {
      if (!['route', 'block'].includes(input.offense[slot].kind)) throw new TypeError(`${slot} must run a route or block`);
    }
    if (!['RB', 'TE', 'WR1', 'WR2', 'WR3'].some((slot) => input.offense[slot].kind === 'route')) throw new TypeError('at least one eligible route required');
    for (const [slot, task] of Object.entries(input.defense)) {
      const allowed = task.kind === 'man' ? ['kind', 'target_slot'] : task.kind === 'zone' ? ['kind', 'bounds'] : task.kind === 'rush' ? ['kind', 'rush_lane'] : ['kind'];
      if (Object.keys(task).some((key) => !allowed.includes(key))) throw new TypeError(`unsupported defensive assignment field: ${slot}`);
      if (task.kind === 'man' && input.offense[task.target_slot]?.kind !== 'route') throw new TypeError(`${slot} man target must run a route`);
      if (task.rush_lane != null && !['outside', 'direct'].includes(task.rush_lane)) throw new TypeError(`invalid rush lane: ${slot}`);
    }
    }
  }
  for (const [slot, task] of Object.entries(input.defense)) {
    if (!DEFENSE_ROLES.includes(slot) || !task || !(DEFENSE_KINDS.has(task.kind) || task.kind === 'gap_fit' || task.kind === 'run_support')) {
      throw new TypeError(`unsupported defensive assignment: ${slot}`);
    }
    if (task.kind === 'man' && !OFFENSE_ROLES.includes(task.target_slot)) throw new TypeError(`invalid man assignment: ${slot}`);
    if (task.kind === 'zone' && (!Array.isArray(task.bounds) || task.bounds.length !== 4 || !task.bounds.every(Number.isFinite)
        || task.bounds[0] >= task.bounds[1] || task.bounds[2] >= task.bounds[3])) throw new TypeError(`invalid zone bounds: ${slot}`);
    if (task.kind === 'block' && task.target_slot != null && !DEFENSE_ROLES.includes(task.target_slot)) throw new TypeError(`invalid run-block target: ${slot}`);
    if (task.kind === 'gap_fit' && !RUN_GAPS.has(task.gap)) throw new TypeError(`invalid gap fit: ${slot}`);
    if (task.kind === 'run_support' && !RUN_SUPPORT.has(task.responsibility)) throw new TypeError(`invalid run-support responsibility: ${slot}`);
  }
  return input;
}
