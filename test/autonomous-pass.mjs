import assert from 'node:assert/strict';
import { simulateAutonomousPass } from '../engine/autonomous-pass.js';

const completeCase = {
  seed: 'pass-search-cover3-0', concept: 'slant_flat_right', coverage: 'cover3',
};
const complete = simulateAutonomousPass(completeCase);
assert.equal(complete.play_call, 'slant_flat_right');
assert.equal(complete.roster.length, 22);
assert.equal(complete.terminal.reason, 'tackle');
assert.equal(complete.terminal.pass_completed, true);
assert.ok(complete.terminal.yards_gained > 0);
assert.equal(complete.carrier_id, 'O.WR2');
assert.ok(complete.tackle_id);
assert.equal(complete.events.filter((event) => event.type === 'whistle').length, 1);
assert.deepEqual(simulateAutonomousPass(completeCase), complete, 'same seed reproduces all frames and events');

for (const player of complete.roster) {
  const path = complete.trajectories[player.id];
  assert.ok(path.length > 2, `${player.roleKey} has a trajectory`);
  assert.equal(path.length, complete.frames.length, `${player.roleKey} frames align`);
  for (const sample of path) assert.ok([sample.t, sample.x, sample.y, sample.vx, sample.vy].every(Number.isFinite));
}
for (let frame = 0; frame < complete.frames.length; frame++) {
  const holders = complete.roster.filter((p) => complete.trajectories[p.id][frame].hasBall);
  assert.ok(holders.length <= 1, `at most one ball holder at frame ${frame}`);
}
for (const [key, value] of Object.entries({
  gain: 20, endX: 42, endY: 27, tacklers: ['D.MIKE'], complete: true, touchdown: false,
})) {
  assert.throws(() => simulateAutonomousPass({ ...completeCase, [key]: value }), /no realized outcome fields/);
}
assert.throws(() => simulateAutonomousPass({ ...completeCase, target: 'O.WR1' }), /no realized outcome fields/);

const incomplete = simulateAutonomousPass({
  seed: 'catch-rating-O.WR2-5', concept: 'slant_flat_left', coverage: 'cover3',
  ratingOverrides: { 'O.WR2': { CTH: 1, SPC: 1, CIT: 1, JMP: 1 } },
});
assert.equal(incomplete.terminal.reason, 'incomplete');
assert.equal(incomplete.terminal.yards_gained, 0);
assert.ok(incomplete.events.some((event) => event.type === 'incomplete_pass'));
assert.equal(incomplete.events.filter((event) => event.type === 'whistle').length, 1);

const interception = simulateAutonomousPass({
  seed: 'pass-search-cover1-7', concept: 'slant_flat_left', coverage: 'cover1',
});
assert.equal(interception.terminal.reason, 'interception_return');
assert.equal(interception.terminal.possession_team, 'D');
assert.equal(interception.terminal.yards_gained, null);
assert.equal(interception.carrier_team, 'D');
assert.ok(interception.tackle_id);

const contested = simulateAutonomousPass({
  seed: 'contested-search-cover1-415', concept: 'slant_flat_left', coverage: 'cover1',
});
assert.equal(contested.terminal.pass_completed, true);
assert.ok(contested.events.some((event) => event.type === 'catch_attempt' && event.contested && event.contesting_player_id));

const checkdown = simulateAutonomousPass({
  seed: 'covered-checkdown-1', concept: 'slant_flat_left', coverage: 'cover1',
  initialPositions: {
    'D.LCB': { x: 35, y: 41.667 }, 'D.NB': { x: 35, y: 33.867 }, 'D.SS': { x: 35, y: 31.267 },
  },
});
const readRoles = checkdown.events.filter((event) => event.type === 'qb_read').map((event) => event.target_id);
assert.deepEqual(readRoles.slice(0, 4), ['O.WR1', 'O.WR2', 'O.TE', 'O.RB']);
assert.equal(checkdown.events.find((event) => event.type === 'throw').target_id, 'O.RB');

const pressurePositions = Object.fromEntries(
  ['D.LDE', 'D.LDT', 'D.RDT', 'D.RDE', 'D.MIKE'].map((role, i) => [role, { x: 30.2 + i * 0.1, y: 25.5 + i * 0.2 }]),
);
const weakProtection = simulateAutonomousPass({
  seed: 'pressure-test-1', concept: 'slant_flat_right', coverage: 'cover1',
  ratingOverrides: Object.fromEntries(['O.LT', 'O.LG', 'O.C', 'O.RG', 'O.RT'].map((role) => [role, { PBK: 1, RBK: 1, STR: 40 }])),
  initialPositions: pressurePositions,
});
assert.equal(weakProtection.terminal.reason, 'sack');
assert.ok(weakProtection.events.some((event) => event.type === 'sack_contact'));
assert.ok(weakProtection.tackle_id);

const protectionBase = { seed: 'pressure-test-1', concept: 'slant_flat_right', coverage: 'cover1' };
const ordinaryLine = simulateAutonomousPass(protectionBase);
const lowRatedLine = simulateAutonomousPass({
  ...protectionBase,
  ratingOverrides: Object.fromEntries(['O.LT', 'O.LG', 'O.C', 'O.RG', 'O.RT'].map((role) => [role, { PBK: 1, RBK: 50, STR: 50 }])),
});
assert.notDeepEqual(
  ordinaryLine.events.filter((event) => ['block_engage', 'block_release'].includes(event.type)),
  lowRatedLine.events.filter((event) => ['block_engage', 'block_release'].includes(event.type)),
  'pass protection ratings change engagement and release behavior',
);

const receiverRatingCase = { seed: 'catch-rating-O.WR2-5', concept: 'slant_flat_left', coverage: 'cover3' };
const highRatedReceiver = simulateAutonomousPass({
  ...receiverRatingCase, ratingOverrides: { 'O.WR2': { CTH: 99, SPC: 99, CIT: 99, JMP: 99 } },
});
const lowRatedReceiver = simulateAutonomousPass({
  ...receiverRatingCase, ratingOverrides: { 'O.WR2': { CTH: 1, SPC: 1, CIT: 1, JMP: 1 } },
});
const highCatch = highRatedReceiver.events.find((event) => event.type === 'catch_attempt' && event.player_id === 'O.WR2');
const lowCatch = lowRatedReceiver.events.find((event) => event.type === 'catch_attempt' && event.player_id === 'O.WR2');
assert.ok(highCatch.probability > lowCatch.probability);
assert.equal(highRatedReceiver.terminal.pass_completed, true);
assert.equal(lowRatedReceiver.terminal.reason, 'incomplete');

const cover1 = simulateAutonomousPass({ seed: 'cover-change-1', concept: 'slant_flat_left', coverage: 'cover1' });
const cover3 = simulateAutonomousPass({ seed: 'cover-change-1', concept: 'slant_flat_left', coverage: 'cover3' });
assert.notDeepEqual(cover1.trajectories['D.NB'], cover3.trajectories['D.NB'], 'coverage changes nickel response');

const movedSafety = simulateAutonomousPass({
  ...completeCase, initialPositions: { 'D.SS': { x: 38, y: 14 } },
});
assert.notDeepEqual(complete.trajectories['D.SS'], movedSafety.trajectories['D.SS'], 'snap position changes pursuit');
assert.notEqual(complete.terminal.yards_gained, movedSafety.terminal.yards_gained, 'snap position changes the play result');

console.log('PASS autonomous passing: completion, incomplete, interception, contested catch, checkdown, sack, deterministic replay and live-input perturbations');
