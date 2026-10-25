import assert from 'node:assert/strict';
import { simulatePassPlay } from '../engine/autonomous/passing.js';

// Protection breakdown: a defensive tackle aligned in the pocket, half a yard in front of the quarterback,
// reaches him while he still holds the ball, and the play ends in a sack. Seed sack-0 is pinned from a placement
// search. The quarterback starts about 7.6 yd behind the line of scrimmage.
const los = 50;
const quarterbackX = los - 7.6;
const run = simulatePassPlay({
  seed: 'sack-0', front: 'nickel_over', coverage: 'cover_1', los, dir: 1, ballY: 26.667, direction: 'right',
  initialPositions: { 'D.LDT': { x: quarterbackX + 0.5, y: 26.667 - 1.5 } },
});
assert.ok(run.resolved, 'the sack play resolves');
assert.equal(run.terminal.reason, 'sack', 'the rusher gets to a quarterback who still holds the ball');
const sack = run.events.find((e) => e.type === 'sack');
assert.ok(sack, 'a sack event is logged');
assert.equal(sack.defender_id, 'D.LDT', 'the placed tackle takes the sack');
assert.ok(!run.events.some((e) => e.type === 'throw' && e.time < sack.time), 'the quarterback had not thrown before the sack');
console.log(`autonomous pocket ok: ${sack.defender_id} sacks the quarterback at ${sack.time.toFixed(2)} s with the ball still in hand`);
