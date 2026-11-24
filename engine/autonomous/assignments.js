// A composable pre-snap assignment description. Validation alone does not
// mean a particular executor supports or executes these assignments.
import { assertNoOutcomeFields, OFFENSE_ROLES, DEFENSE_ROLES } from './schema.js';
import { routeOffsets } from '../routes.js';

export const ASSIGNMENT_SCHEMA = 'gridiron.assignments.v1';
const DEFENSE_KINDS = new Set(['man', 'zone', 'rush', 'read']);

export function validateAssignments(input, { executable = false } = {}) {
  assertNoOutcomeFields(input);
  if (!input || input.schema_version !== ASSIGNMENT_SCHEMA) throw new TypeError('unsupported assignment schema');
  if (!input.offense || !input.defense) throw new TypeError('both assignment sides are required');
  for (const [slot, task] of Object.entries(input.offense)) {
    if (!OFFENSE_ROLES.includes(slot) || !task || !['route', 'block', 'quarterback'].includes(task.kind)) {
      throw new TypeError(`unsupported offensive assignment: ${slot}`);
    }
    if (task.kind === 'route') routeOffsets(task.route, task.lateral ?? 1);
    if (task.check_release != null && typeof task.check_release !== 'boolean') throw new TypeError('check_release must be boolean');
  }
  if (executable) {
    for (const slot of OFFENSE_ROLES) if (!input.offense[slot]) throw new TypeError(`missing offensive assignment: ${slot}`);
    for (const slot of DEFENSE_ROLES) if (!input.defense[slot]) throw new TypeError(`missing defensive assignment: ${slot}`);
    if (input.offense.QB.kind !== 'quarterback') throw new TypeError('QB needs quarterback assignment');
    for (const [slot, task] of Object.entries(input.offense)) {
      const allowed = task.kind === 'route' ? ['kind', 'route', 'check_release'] :
        task.kind === 'quarterback' ? ['kind', 'decision_delay_seconds'] : ['kind'];
      if (Object.keys(task).some((key) => !allowed.includes(key))) throw new TypeError(`unsupported offensive assignment field: ${slot}`);
      if (task.decision_delay_seconds != null && (!Number.isFinite(task.decision_delay_seconds) || task.decision_delay_seconds < 0 || task.decision_delay_seconds > 4)) throw new RangeError('decision delay must be from 0 to 4 seconds');
    }
    for (const slot of ['LT', 'LG', 'C', 'RG', 'RT']) {
      if (input.offense[slot].kind !== 'block') throw new TypeError(`${slot} must block`);
    }
    for (const slot of ['RB', 'TE', 'WR1', 'WR2', 'WR3']) {
      if (!['route', 'block'].includes(input.offense[slot].kind)) throw new TypeError(`${slot} must run a route or block`);
    }
    if (!['RB', 'TE', 'WR1', 'WR2', 'WR3'].some((slot) => input.offense[slot].kind === 'route')) throw new TypeError('at least one eligible route required');
    for (const [slot, task] of Object.entries(input.defense)) {
      const allowed = task.kind === 'man' ? ['kind', 'target_slot'] : task.kind === 'zone' ? ['kind', 'bounds'] : ['kind'];
      if (Object.keys(task).some((key) => !allowed.includes(key))) throw new TypeError(`unsupported defensive assignment field: ${slot}`);
      if (task.kind === 'man' && input.offense[task.target_slot]?.kind !== 'route') throw new TypeError(`${slot} man target must run a route`);
    }
  }
  for (const [slot, task] of Object.entries(input.defense)) {
    if (!DEFENSE_ROLES.includes(slot) || !task || !DEFENSE_KINDS.has(task.kind)) {
      throw new TypeError(`unsupported defensive assignment: ${slot}`);
    }
    if (task.kind === 'man' && !OFFENSE_ROLES.includes(task.target_slot)) throw new TypeError(`invalid man assignment: ${slot}`);
    if (task.kind === 'zone' && (!Array.isArray(task.bounds) || task.bounds.length !== 4 || !task.bounds.every(Number.isFinite)
        || task.bounds[0] >= task.bounds[1] || task.bounds[2] >= task.bounds[3])) throw new TypeError(`invalid zone bounds: ${slot}`);
  }
  return input;
}
