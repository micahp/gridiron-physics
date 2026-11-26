import assert from 'node:assert/strict';
import { coverageBallOpportunity } from '../engine/autonomous/passing.js';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';
import { buildSampleCall } from './autonomous-fixtures.mjs';

const yd = 0.9144;
const zone = { kind: 'zone', bounds: [12, 30, -8, 8] };
const args = { task: zone, position: { x: 60 * yd, y: 26 * yd }, los: 40,
  ballY: 26, direction: 1, speed: 8,
  estimate: { x: 61 * yd, y: 27 * yd, flightSeconds: 0.8 } };
assert.equal(coverageBallOpportunity(args), true);
assert.equal(coverageBallOpportunity({ ...args, estimate: null }), false);
assert.equal(coverageBallOpportunity({ ...args, estimate: { ...args.estimate, y: 40 * yd } }), false);
assert.equal(coverageBallOpportunity({ ...args, position: { x: 40 * yd, y: 26 * yd } }), false);
assert.equal(coverageBallOpportunity({ ...args, task: { kind: 'rush' } }), false);
assert.equal(coverageBallOpportunity({ ...args, task: { kind: 'man', target_slot: 'WR1' } }), true);
const mirrored = { ...args, los: 60, direction: -1,
  position: { x: 40 * yd, y: 26 * yd }, estimate: { ...args.estimate, x: 39 * yd, y: 25 * yd } };
assert.equal(coverageBallOpportunity(mirrored), true);

const assignments = exampleAssignments('slant_flat', 'zone');
for (const slot of ['LCB', 'FS', 'RCB']) assert.equal(assignments.defense[slot].bounds[0], 12);
for (const slot of ['MLB', 'WLB', 'NB', 'SS']) assert.equal(assignments.defense[slot].bounds[1], 12);
const call = buildSampleCall({ family: 'pass', concept: 'assigned', snap_type: 'shotgun', coverage: 'cover_3' });
call.assignments = assignments;
const result = simulateAutonomousPlay(call);
assert.equal(result.status, 'complete');
assert.equal(result.diagnostics.reconciliation.ok, true);
assert.equal(new Set(result.events.filter((e) => e.type === 'assignment_executed').map((e) => e.player_id)).size, 22);
const snapAt = result.events.find((event) => event.type === 'snap')?.t ?? 0;
assert.equal(new Set(result.events.filter((event) => event.type === 'decision' && event.t > snapAt)
  .map((event) => event.player_id)).size, 22, 'every player takes part in live decisions after the snap');
assert.deepEqual(result.diagnostics.outcome_inputs, []);
const throwEvent = result.events.find((e) => e.type === 'throw');
const breaks = result.events.filter((e) => e.type === 'decision'
  && e.assignment === 'break on the thrown ball' && e.decision === 'attack the reachable ball from an observed trajectory');
assert.ok(throwEvent && breaks.length, 'the live fixture produces an observed throw and coverage reaction');
assert.ok(breaks.every((e) => e.t >= throwEvent.t + 0.14), 'reactions follow observation delay');
assert.ok(new Set(breaks.map((e) => e.player_id)).size < 7, 'coverage does not converge all seven defenders');
for (const concept of ['slant_flat', 'curls', 'four_verticals']) for (const coverage of ['man', 'zone']) {
  const right = exampleAssignments(concept, coverage, 'right');
  const left = exampleAssignments(concept, coverage, 'left');
  for (const [slot, task] of Object.entries(right.defense)) {
    if (task.kind === 'zone') assert.deepEqual(left.defense[slot].bounds,
      [task.bounds[0], task.bounds[1], -task.bounds[3], -task.bounds[2]], `${concept} ${coverage} ${slot} mirrors`);
    else assert.deepEqual(left.defense[slot], task, `${concept} ${coverage} ${slot} retains its assignment`);
  }
  const leftCall = buildSampleCall({ family: 'pass', concept: 'assigned', snap_type: 'shotgun', coverage: coverage === 'man' ? 'cover_1' : 'cover_3', direction: 'left' });
  leftCall.assignments = left;
  leftCall.player_evaluation_mode = 'shared_snapshot';
  const live = simulateAutonomousPlay(leftCall);
  assert.equal(live.status, 'complete');
  assert.equal(new Set(live.events.filter((event) => event.type === 'assignment_executed').map((event) => event.player_id)).size, 22);
  assert.equal(live.diagnostics.reconciliation.ok, true);
}
console.log('coverage responsibilities and observed-ball opportunity passed');
