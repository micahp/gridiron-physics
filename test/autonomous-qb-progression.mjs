import assert from 'node:assert/strict';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';
import { validateAssignments } from '../engine/autonomous/assignments.js';
import { simulatePassPlay } from '../engine/autonomous/passing.js';

function play(order) {
  const assignments = exampleAssignments('slant_flat', 'man');
  assignments.offense.QB.read_order = order;
  return simulatePassPlay({ seed: 1, concept: 'assigned', assignments, front: 'nickel_over',
    coverage: 'cover_1', direction: 'right', resultOnly: true });
}
const first = play(['WR2', 'WR3', 'WR1', 'RB']);
const second = play(['WR3', 'WR2', 'WR1', 'RB']);
const firstDecision = (result) => result.events.find((event) => ['qb_read', 'throw'].includes(event.type));
assert.equal(firstDecision(first).target_id, 'O.WR2');
assert.equal(firstDecision(second).target_id, 'O.WR3');
assert.ok(second.events.some((event) => event.type === 'throw' && event.target_id === 'O.WR3'),
  'an available short route can be the first throw');
const invalid = exampleAssignments('slant_flat', 'man');
invalid.offense.QB.read_order = ['WR2', 'WR2'];
assert.throws(() => validateAssignments(invalid, { executable: true }), /read order/);
console.log('play-specific quarterback progression passed');
