// A composable pre-snap assignment description. Validation alone does not
// mean a particular executor supports or executes these assignments.
import { assertNoOutcomeFields, OFFENSE_ROLES, DEFENSE_ROLES } from './schema.js';
import { routeOffsets } from '../routes.js';

export const ASSIGNMENT_SCHEMA = 'gridiron.assignments.v1';
const DEFENSE_KINDS = new Set(['man', 'zone', 'rush', 'read']);

export function validateAssignments(input) {
  assertNoOutcomeFields(input);
  if (!input || input.schema_version !== ASSIGNMENT_SCHEMA) throw new TypeError('unsupported assignment schema');
  if (!input.offense || !input.defense) throw new TypeError('both assignment sides are required');
  for (const [slot, task] of Object.entries(input.offense)) {
    if (!OFFENSE_ROLES.includes(slot) || !task || !['route', 'block', 'quarterback'].includes(task.kind)) {
      throw new TypeError(`unsupported offensive assignment: ${slot}`);
    }
    if (task.kind === 'route') routeOffsets(task.route, task.lateral ?? 1);
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
