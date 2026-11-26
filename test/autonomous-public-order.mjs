import assert from 'node:assert/strict';
import { World } from '../engine/world.js';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';
import { buildSampleCall } from './autonomous-fixtures.mjs';

const call = buildSampleCall({ family: 'pass', concept: 'assigned', snap_type: 'shotgun', coverage: 'cover_3' });
call.assignments = exampleAssignments('slant_flat', 'zone');
call.player_evaluation_mode = 'shared_snapshot';
const normal = simulateAutonomousPlay(call);
const original = World.prototype.step;
World.prototype.step = function (dt, brain, afterBrains) {
  const pending = [];
  return original.call(this, dt, (player) => {
    pending.push(player);
    if (pending.length === this.players.length) for (const candidate of pending.reverse()) brain(candidate);
  }, afterBrains);
};
try {
  const reversed = simulateAutonomousPlay(call);
  assert.deepEqual(reversed.result, normal.result);
  assert.deepEqual(reversed.events, normal.events);
  assert.equal(reversed.diagnostics.reconciliation.ok, true);
} finally { World.prototype.step = original; }
console.log('public assigned-pass callback order passed');
