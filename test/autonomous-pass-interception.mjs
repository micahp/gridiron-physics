import assert from 'node:assert/strict';
import { simulatePassPlay } from '../engine/autonomous/passing.js';

// Deterministic interception: a defender placed in the throwing window takes the ball from inside reach.
// Seed int-7 with D.NB starting six yards downfield on the ball line is pinned from a seed search.
const run = simulatePassPlay({
  seed: 'int-7', front: 'nickel_over', coverage: 'cover_3', los: 50, dir: 1, ballY: 26.667, direction: 'right',
  initialPositions: { 'D.NB': { x: 56, y: 26.667 } },
});
assert.ok(run.resolved, 'the interception play resolves');
assert.equal(run.interception_id, 'D.NB', 'the placed defender intercepts');
assert.equal(run.possession_team, 'D', 'possession changes on the interception');
const interception = run.events.find((e) => e.type === 'interception');
assert.ok(interception, 'an interception event is logged');
assert.ok(interception.reach_yards <= 1.6, `the interception came from ${interception.reach_yards} yd, outside reach`);
assert.equal(run.events.filter((e) => e.type === 'whistle').length, 1, 'one whistle ends the play');
console.log(`autonomous interception ok: ${interception.player_id} took the ball from ${interception.reach_yards} yd; possession to ${run.possession_team}`);
