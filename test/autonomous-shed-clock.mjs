import assert from 'node:assert/strict';
import { hazardDeadline } from '../engine/autonomous/retro-cadence.js';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';
import { simulatePassPlay } from '../engine/autonomous/passing.js';
import { World } from '../engine/world.js';

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
for (const playerEvaluationMode of ['legacy_sequential', 'shared_snapshot']) {
  const sheds = [];
  const originalStep = World.prototype.step;
  try {
    for (const physicsHz of [60, 120, 240]) {
      let injected = false;
      World.prototype.step = function (dt, brains, afterBrains) {
        if (!injected) {
          for (const player of this.players) player.down = true;
          const blocker = this.players.find((player) => player.roleKey === 'O.LT');
          const defender = this.players.find((player) => player.roleKey === 'D.LEDGE');
          blocker.down = false;
          defender.down = false;
          blocker.p = { x: 30, y: 20 };
          defender.p = { x: 31, y: 20 };
          blocker.ai.nextDecision = defender.ai.nextDecision = this.t;
          this.engage(blocker, defender);
          injected = true;
        }
        return originalStep.call(this, dt, brains, afterBrains);
      };
      const result = simulatePassPlay({ seed: 'controlled-shed', concept: 'assigned',
        assignments: exampleAssignments('slant_flat', 'zone'), front: 'nickel_over',
        coverage: 'cover_3', direction: 'right', resultOnly: true, physicsHz, playerEvaluationMode });
      const events = result.events.filter((event) => event.type === 'shed');
      assert.equal(events.length, 1, `${playerEvaluationMode} ${physicsHz} Hz: one draw resolves the controlled engagement once`);
      sheds.push(events[0].t);
    }
  } finally {
    World.prototype.step = originalStep;
  }
  assert.ok(Math.max(...sheds) - Math.min(...sheds) <= 1 / 30 + 1e-9,
    `${playerEvaluationMode}: shed deadline is stable within decision and physics-step quantization`);
}
console.log('continuous shed clock and timestep replays passed');
