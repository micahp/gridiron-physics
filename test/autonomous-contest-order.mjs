import assert from 'node:assert/strict';
import { World } from '../engine/world.js';
import { compareBallContact, simulatePassPlay } from '../engine/autonomous/passing.js';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';
import { YD } from '../engine/constants.js';

function run(defenderCloser) {
  const step = World.prototype.step;
  let injected = false;
  World.prototype.step = function (dt, brains, afterBrains) {
    if (!injected && this.ball.state === 'air' && this.ball.vz < 0 && this.ball.z < 2.3 && this.ball.z > 0.6) {
      const receiver = this.players.find((p) => p.roleKey === 'O.WR2');
      const defender = this.players.find((p) => p.roleKey === 'D.LCB');
      for (const player of this.players) if (player !== receiver && player !== defender) player.down = true;
      receiver.down = defender.down = false;
      receiver.p = { x: this.ball.x + (defenderCloser ? 0.8 : 0.15) * YD, y: this.ball.y };
      defender.p = { x: this.ball.x - (defenderCloser ? 0.15 : 0.8) * YD, y: this.ball.y };
      receiver.v = { x: 0, y: 0 };
      defender.v = { x: 0, y: 0 };
      injected = true;
    }
    return step.call(this, dt, brains, afterBrains);
  };
  try {
    const result = simulatePassPlay({ seed: 'contest-order', concept: 'assigned',
      assignments: exampleAssignments('slant_flat', 'zone'), front: 'nickel_over',
      coverage: 'cover_3', direction: 'right', resultOnly: true, contestDiagnostics: true });
    assert.ok(injected, 'fixture reached a descending pass');
    return result;
  } finally { World.prototype.step = step; }
}
const defenseFirst = run(true);
const offenseFirst = run(false);
const tiedA = { planar: 0.4, player: { id: 'a', team: 'O' } };
const tiedB = { planar: 0.4, player: { id: 'b', team: 'D' } };
assert.ok(compareBallContact(tiedA, tiedB) < 0 && compareBallContact(tiedB, tiedA) > 0,
  'equal-distance contact uses a stable player identity tie break');
assert.equal(defenseFirst.events.find((event) => event.type === 'catch_contest')?.team, 'D');
assert.equal(offenseFirst.events.find((event) => event.type === 'catch_contest')?.team, 'O');
for (const result of [defenseFirst, offenseFirst]) {
  for (const opportunity of result.diagnostics.pass_contests.throws.flatMap((row) => row.physical_opportunities)) {
    assert.ok(opportunity.probability_draws <= 1, 'one draw per uninterrupted player contact');
  }
}
console.log('simultaneous catch priority follows reach, not team order');
