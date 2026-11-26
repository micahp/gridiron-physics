import assert from 'node:assert/strict';
import { hazardDeadline } from '../engine/autonomous/retro-cadence.js';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';
import { simulatePassPlay } from '../engine/autonomous/passing.js';

const deadline = hazardDeadline(0.25, 0.8, 0.42);
assert.ok(Math.abs(deadline - (0.25 - Math.log1p(-0.42) / 0.8)) < 1e-12);
for (const hz of [60, 120, 240]) {
  const firstTick = Math.ceil(deadline * hz) / hz;
  assert.ok(firstTick >= deadline && firstTick - deadline <= 1 / hz + 1e-12);
}
assert.throws(() => hazardDeadline(0, 0, 0.5), /hazard/);
for (const playerEvaluationMode of ['legacy_sequential', 'shared_snapshot']) for (const physicsHz of [60, 120, 240]) {
  const config = { seed: 'shed-clock', concept: 'assigned', assignments: exampleAssignments('slant_flat', 'zone'),
    front: 'nickel_over', coverage: 'cover_3', direction: 'right', resultOnly: true, physicsHz, playerEvaluationMode };
  const first = simulatePassPlay(config);
  const second = simulatePassPlay(config);
  assert.ok(first.events.some((event) => event.type === 'block_engage'), `${physicsHz}: live blocking occurs`);
  assert.deepEqual(first.events, second.events, `${physicsHz}: fixed-input replay remains deterministic`);
  assert.deepEqual(first.provenance.outcome_inputs, []);
}
console.log('continuous shed clock and timestep replays passed');
