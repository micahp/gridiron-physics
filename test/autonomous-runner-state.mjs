import assert from 'node:assert/strict';
import { exampleRunAssignments } from '../engine/autonomous/example-assignments.js';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';
import { buildSampleCall } from './autonomous-fixtures.mjs';

function run(gap) {
  const call = buildSampleCall({ family: 'run', concept: 'inside_zone', direction: 'right' });
  call.seed = '5';
  call.assignments = exampleRunAssignments('right');
  call.assignments.offense.RB.aiming_gap = gap;
  return simulateAutonomousPlay(call);
}
const playSide = run('play_side_a');
const backSide = run('backside_c');
const rb = playSide.trajectory.roster.findIndex((player) => player.roleKey === 'O.RB');
const frame = Math.round(0.8 * playSide.trajectory.hz);
assert.notEqual(playSide.trajectory.frames[frame][rb * 6 + 1], backSide.trajectory.frames[frame][rb * 6 + 1],
  'the declared gap changes the runner trajectory during the press');
const transition = playSide.events.find((event) => event.type === 'runner_state' && event.state === 'open_field');
assert.ok(transition, 'a runner who clears the line transitions to open field');
assert.ok(playSide.events.some((event) => event.type === 'decision' && event.t >= transition.t
  && event.assignment === 'run in open field'));
assert.equal(playSide.diagnostics.reconciliation.ok, true);
assert.deepEqual(playSide.diagnostics.outcome_inputs, []);
console.log('assigned gap press and open-field transition passed');
