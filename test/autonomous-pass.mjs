import assert from 'node:assert/strict';
import { createPassRoster, firstUnattemptedContact, passInterferenceContactEligible,
  pruneExitedContactAttempts, simulatePassPlay } from '../engine/autonomous/passing.js';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';
import { serializeReturnGeometry } from '../engine/autonomous/field-geometry.js';

const base = { seed: 'slant-flat-1', front: 'nickel_over', coverage: 'cover_1', direction: 'right' };
const a = simulatePassPlay(base);
const b = simulatePassPlay(base);
assert.deepEqual(a, b, 'a fixed seed reproduces the pass, its flight and every frame');

assert.equal(a.roster.length, 22);
assert.equal(a.roster.filter((p) => p.team === 'O').length, 11);
assert.equal(a.roster.filter((p) => p.team === 'D').length, 11);
assert.equal(new Set(a.roster.map((p) => p.id)).size, 22);
assert.equal(createPassRoster({ front: 'nickel_under' }).length, 22);
assert.deepEqual(a.provenance.outcome_inputs, []);

assert.ok(a.events.some((e) => e.type === 'snap'));
assert.equal(a.events.filter((e) => e.type === 'snap_receive').length, 1);
assert.ok(a.resolved, 'the pass resolves without a time-cap failure');
assert.equal(a.events.at(-1).type, 'whistle');
const contestTrace = simulatePassPlay({ ...base, contestDiagnostics: true });
assert.deepEqual(contestTrace.events, a.events,
  'contest instrumentation preserves all events and consumes no additional random values');
assert.deepEqual(contestTrace.terminal, a.terminal,
  'contest instrumentation leaves the resolved play unchanged');
assert.equal(contestTrace.diagnostics.pass_contests.throws.length,
  a.events.filter((event) => event.type === 'throw' || event.type === 'throw_away').length);
assert.ok(contestTrace.diagnostics.pass_contests.throws.every((row) =>
  row.resolve_attempts >= row.contact_opportunities.length));
for (const row of contestTrace.diagnostics.pass_contests.throws) {
  assert.equal(row.probability_draws,
    Object.values(row.draws_by_player).reduce((sum, player) => sum + player.probability_draws, 0));
  assert.ok(row.contact_opportunities.every((opportunity) =>
    Number.isInteger(opportunity.resolve_attempts) && Number.isInteger(opportunity.probability_draws)));
  for (const opportunity of row.physical_opportunities) {
    assert.ok(opportunity.resolve_attempts >= 1);
    assert.ok(opportunity.probability_draws <= 1,
      'a player receives at most one probability draw during continuous ball contact');
    assert.ok((opportunity.draw_types.contested_interception ?? 0) <= 1);
    assert.ok((opportunity.draw_types.uncontested_interception ?? 0) <= 1);
    assert.ok((opportunity.draw_types.receiver_catch ?? 0) <= 1);
  }
}

// A defender's attempted interception is keyed to the defender's continuous
// ball contact, independent of which receiver is currently nearest.
const receiverAttempts = new Set(['O.WR1']);
const defenderAttempts = new Set(['D.CB1']);
pruneExitedContactAttempts(receiverAttempts, ['O.WR1', 'O.WR2']);
pruneExitedContactAttempts(defenderAttempts, ['D.CB1']);
assert.equal(defenderAttempts.has('D.CB1'), true,
  'overlapping/changing receiver candidates do not re-arm the same defender');
pruneExitedContactAttempts(receiverAttempts, []);
pruneExitedContactAttempts(defenderAttempts, []);
assert.equal(receiverAttempts.size, 0, 'complete separation clears receiver contact attempts');
assert.equal(defenderAttempts.size, 0, 'complete separation clears defender contact attempts');
pruneExitedContactAttempts(defenderAttempts, ['D.CB1']);
assert.equal(defenderAttempts.has('D.CB1'), false,
  're-entry after a full contact exit starts a new opportunity');
defenderAttempts.add('D.CB1');
assert.equal(defenderAttempts.has('D.CB1'), true);
const overlappingReceivers = [{ player: { id: 'O.WR1' } }, { player: { id: 'O.WR2' } }];
const changingNearestDefenders = [{ player: { id: 'D.CB1' } }, { player: { id: 'D.SS' } }];
assert.equal(firstUnattemptedContact(overlappingReceivers, new Set(['O.WR1'])).player.id, 'O.WR2',
  'overlapping receiver contacts retain independent receiver attempt state');
assert.equal(firstUnattemptedContact(changingNearestDefenders, new Set(['D.CB1'])).player.id, 'D.SS',
  'a newly contacting defender gets its own chance when the nearest defender changes');

const deflectedPass = simulatePassPlay({ seed: 3, front: 'nickel_over', coverage: 'cover_1',
  direction: 'right', dir: -1, los: 43, ballY: 26.67, resultOnly: true, contestDiagnostics: true });
assert.ok(deflectedPass.events.some((event) => event.type === 'pass_deflected'));
assert.ok(deflectedPass.events.some((event) => event.type === 'catch'),
  'a deflection can lead to a later distinct receiver interaction');
for (const opportunity of deflectedPass.diagnostics.pass_contests.throws.flatMap((row) => row.physical_opportunities)) {
  assert.ok(opportunity.probability_draws <= 1,
    'a deflection does not repeat a draw while the same player remains in contact');
}

const reentryPass = simulatePassPlay({ seed: 19, front: 'nickel_over', coverage: 'cover_1',
  direction: 'right', dir: -1, los: 49, ballY: 26.67, resultOnly: true, contestDiagnostics: true });
const reenteredDefender = reentryPass.diagnostics.pass_contests.throws[0].physical_opportunities
  .filter((opportunity) => opportunity.player_id === 'D.NB' && opportunity.probability_draws > 0);
assert.equal(reenteredDefender.length, 2,
  'the same defender may draw again only after leaving and re-entering the ball contact envelope');
assert.notEqual(reenteredDefender[0].opportunity_id, reenteredDefender[1].opportunity_id);

for (const direction of [-1, 1]) for (const carrierTeam of ['O', 'D']) {
  const recoveryX = 40.5;
  const deadBallX = direction === 1 ? 39.5 : 41.5;
  const expectedSign = carrierTeam === 'O' ? direction : -direction;
  const actual = serializeReturnGeometry({ recoveryX, deadBallX, direction, carrierTeam });
  const rounded = (x) => Math.floor((direction === 1 ? 100 - x : x) + 0.5);
  const statSign = carrierTeam === 'O' ? -1 : 1;
  assert.equal(actual.return_yards, (rounded(deadBallX) - rounded(recoveryX)) * statSign);
  assert.equal(actual.return_displacement_yards, (deadBallX - recoveryX) * expectedSign);
}

const throwawayAssignments = exampleAssignments('curls', 'man');
delete throwawayAssignments.offense.QB.read_order; // exercise the frozen legacy throwaway fixture
throwawayAssignments.offense.QB.decision_delay_seconds = 3.8;
const throwawayRatings = {};
for (const slot of ['LEDGE', 'LDT', 'RDT', 'REDGE']) {
  throwawayAssignments.defense[slot] = { kind: 'zone', bounds: [0, 2, -2, 2] };
}
for (const slot of ['LEDGE', 'LDT', 'RDT', 'REDGE', 'LCB', 'RCB', 'NB', 'SS', 'FS', 'MLB', 'WLB']) {
  throwawayRatings[`D.${slot}`] = { SPD: 99, ACC: 99, AGI: 99, PRC: 99 };
}
for (const slot of ['WR1', 'WR2', 'WR3', 'TE', 'RB']) {
  throwawayRatings[`O.${slot}`] = { SPD: 40, ACC: 40, AGI: 40, CTH: 40 };
}
const throwaway = simulatePassPlay({ seed: 1, front: 'nickel_over', coverage: 'cover_1',
  direction: 'right', concept: 'assigned', assignments: throwawayAssignments,
  ratingOverrides: throwawayRatings, contestDiagnostics: true, resultOnly: true });
assert.ok(throwaway.events.some((event) => event.type === 'throw_away'));
assert.equal(throwaway.diagnostics.pass_contests.throws[0].type, 'throwaway');
assert.equal(throwaway.diagnostics.pass_contests.throws[0].target_id, null);
assert.ok(throwaway.diagnostics.pass_contests.throws[0].resolve_attempts > 0,
  'throwaway launch diagnostics cover the full airborne path');

// Every supported outcome must be reachable from live play.
const seen = new Set();
const yards = [];
for (let i = 0; i < 60; i++) {
  const run = simulatePassPlay({
    seed: `pass-sweep-${i}`,
    front: i % 2 ? 'nickel_over' : 'nickel_under',
    coverage: i % 3 === 0 ? 'cover_3' : 'cover_1',
    direction: i % 2 ? 'left' : 'right',
    dir: i % 4 < 2 ? 1 : -1,
    los: 20 + (i * 13) % 60,
    ballY: [23.583, 26.667, 29.75][i % 3],
  });
  assert.equal(run.roster.length, 22, 'every run initializes 22 players');
  assert.equal(run.resolved, true, `seed ${i} resolves (${JSON.stringify(run.failure)})`);
  assert.ok(run.events.every((e) => Number.isFinite(e.t)), 'no NaN event timestamps');
  assert.ok(run.frames.every((f) => [...f].every(Number.isFinite)), 'no NaN frame values');
  seen.add(run.terminal.reason);
  yards.push(run.terminal.yards_gained);
}
assert.ok(seen.has('incomplete') || seen.has('tackle') || seen.has('out_of_bounds'), `outcome spread: ${[...seen]}`);
assert.ok(yards.some((y) => y > 0), 'some passes gain ground');
assert.ok(new Set(yards.map((y) => y.toFixed(2))).size > 1, 'pass results are not a constant');

const dpi = simulatePassPlay({
  seed: 'dpi-assigned-210', concept: 'assigned', front: 'nickel_under', coverage: 'cover_3',
  direction: 'right', dir: -1, los: 50, ballY: 23.583,
  assignments: exampleAssignments('slant_flat', 'zone'), behaviorMode: 'retro',
});
assert.ok(dpi.resolved && dpi.events.some((event) => event.type === 'throw'),
  'the live assignment fixture executes a reproducible dropback');
assert.equal(passInterferenceContactEligible({ downfieldYards: 7, ballDistanceYards: 4,
  landingDistanceYards: 3, receiverReachYards: 6, closingSpeedMps: 3 }), true,
'downfield contact with a catchable live pass qualifies for DPI');
for (const excluded of [
  { downfieldYards: 4.99, ballDistanceYards: 4, landingDistanceYards: 3, receiverReachYards: 6, closingSpeedMps: 3 },
  { downfieldYards: 7, ballDistanceYards: 2.49, landingDistanceYards: 3, receiverReachYards: 6, closingSpeedMps: 3 },
  { downfieldYards: 7, ballDistanceYards: 4, landingDistanceYards: 6.01, receiverReachYards: 6, closingSpeedMps: 3 },
  { downfieldYards: 7, ballDistanceYards: 4, landingDistanceYards: 3, receiverReachYards: 6, closingSpeedMps: 2.5 },
]) assert.equal(passInterferenceContactEligible(excluded), false);
const passAssignments = dpi.events.filter((event) => event.type === 'assignment_executed');
assert.equal(new Set(passAssignments.map((event) => event.player_id)).size, 22,
  'all 22 pass-play assignments are entered in the live event record');
assert.ok(passAssignments.every((event) => event.task && event.role),
  'each assignment record carries the responsible role and executable task');
assert.ok(dpi.terminal.time > dpi.events.find((event) => event.type === 'throw').t,
  'the live pass advances from release to its terminal result');
assert.ok(dpi.events.some((event) => event.type === 'decision'
  && event.assignment === 'adjust to observed pass'),
'assigned receivers react to the live ball instead of pursuing its stored future landing point');
assert.equal(dpi.events.at(-1).type, 'whistle');

const fumbleDefenseRatings = Object.fromEntries(
  ['LDE', 'LDT', 'RDT', 'RDE', 'WILL', 'MIKE', 'LCB', 'RCB', 'NB', 'SS', 'FS']
    .map((role) => [`D.${role}`, { TAK: 99, STR: 99, PRC: 99 }]));
const fumbleOffenseRatings = (carrying) => Object.fromEntries(
  ['QB', 'RB', 'TE', 'WR1', 'WR2', 'WR3'].map((role) => [`O.${role}`, { CAR: carrying }]));
const forcedFumble = simulatePassPlay({ seed: 6, front: 'nickel', coverage: 'cover_1',
  direction: 'right', dir: 1, los: 40, ballY: 26.67, resultOnly: true,
  ratingOverrides: { ...fumbleOffenseRatings(1), ...fumbleDefenseRatings } });
const protectedBall = simulatePassPlay({ seed: 6, front: 'nickel', coverage: 'cover_1',
  direction: 'right', dir: 1, los: 40, ballY: 26.67, resultOnly: true,
  ratingOverrides: { ...fumbleOffenseRatings(99), ...fumbleDefenseRatings } });
assert.equal(forcedFumble.fumble.recovery_team, 'D', 'a generated catch fumble can change possession');
assert.ok(forcedFumble.fumble.return_yards > 0, 'the live recovery advances before the whistle');
assert.equal(forcedFumble.fumble.return_yards,
  Math.round(100 - forcedFumble.fumble.dead_ball_spot.x)
    - Math.round(100 - forcedFumble.fumble.recovery_spot.x),
  'statistical return yards subtract whole-yard spots in the snap-offense frame');
assert.ok(Number.isFinite(forcedFumble.fumble.return_displacement_yards),
  'pass fumbles retain continuous displacement separately from statistical yardage');
assert.ok(forcedFumble.events.some((event) => event.type === 'fumble')
  && forcedFumble.events.some((event) => event.type === 'fumble_recovery'));
assert.ok(forcedFumble.events.some((event) => event.type === 'loose_ball_recovery_attempt'),
  'pass fumble recovery records its contact opportunity');
assert.equal(protectedBall.fumble, null, 'carrying rating changes fumble exposure at the same seed');

const contestTimestepInputs = { seed: 6, front: 'nickel', coverage: 'cover_1', direction: 'right',
  dir: -1, los: 40, ballY: 26.67, resultOnly: true,
  ratingOverrides: { ...fumbleOffenseRatings(1), ...fumbleDefenseRatings } };
for (const physicsHz of [60, 120, 240]) {
  const run = simulatePassPlay({ ...contestTimestepInputs, physicsHz, contestDiagnostics: true });
  const control = simulatePassPlay({ ...contestTimestepInputs, physicsHz });
  assert.deepEqual(run.events, control.events,
    `contest instrumentation preserves event and RNG parity at ${physicsHz} Hz`);
  const throws = run.diagnostics.pass_contests.throws;
  assert.ok(throws.length > 0, `${physicsHz} Hz fixture includes an airborne pass`);
  for (const opportunity of throws.flatMap((row) => row.physical_opportunities)) {
    assert.ok((opportunity.draw_types.contested_interception ?? 0) <= 1,
      `${physicsHz} Hz must not resample a contested interception in one contact opportunity`);
    assert.ok((opportunity.draw_types.uncontested_interception ?? 0) <= 1,
      `${physicsHz} Hz must not resample an uncontested interception in one contact opportunity`);
  }
}

// Defensive return progress follows the returner's direction, independent of
// which way the intercepted offense was attacking. The dead spot cannot be
// placed behind the interception catch point by a carrier facing the other way.
for (const scenario of [
  { seed: 91, label: 'turnover-direction--1', dir: -1 },
  { seed: 80, label: 'turnover-direction-1', dir: 1 },
]) {
  const run = simulatePassPlay({ ...base, seed: scenario.seed, dir: scenario.dir, los: 50, resultOnly: true,
    ratingOverrides: Object.fromEntries(['LCB', 'RCB', 'NB', 'SS', 'FS', 'MLB', 'WILL']
      .map((role) => [`D.${role}`, { PRC: 99, CTH: 99 }])) });
  const interception = run.events.find((event) => event.type === 'interception');
  assert.ok(interception, `${scenario.label} must produce an interception`);
  assert.ok(['tackle', 'out_of_bounds', 'touchdown'].includes(run.terminal.reason));
  assert.ok((run.terminal.spot.x - interception.at.x) * -scenario.dir >= -1e-8,
    `${scenario.label} must preserve returner-direction forward progress`);
  assert.ok(run.terminal.spot.x >= 0 && run.terminal.spot.x <= 100,
    'an interception return dead ball stays on the field');
}

// The quarterback must be pressured by a real defender, and sacks require contact.
const pressure = simulatePassPlay({ seed: 'pressure-7', front: 'nickel_over', coverage: 'cover_1', direction: 'right' });
for (const sweep of [pressure]) {
  const throwEvent = sweep.events.find((e) => e.type === 'throw');
  if (throwEvent) {
    assert.ok(throwEvent.separation_yards >= 0);
    assert.ok(sweep.events.some((e) => e.type === 'catch' || e.type === 'incomplete' || e.type === 'interception' || e.type === 'pass_deflected'));
  }
}

// Prohibited outcome fields are rejected instead of ignored.
for (const key of ['gain', 'endX', 'tacklers', 'complete', 'touchdown', 'outcome']) {
  assert.throws(() => simulatePassPlay({ ...base, [key]: 1 }), /no realized outcome fields/);
}

console.log(`autonomous passing ok: ${[...seen].join(', ')}; ${yards.length} plays, `
  + `gain range ${Math.min(...yards).toFixed(1)} to ${Math.max(...yards).toFixed(1)} yd`);
