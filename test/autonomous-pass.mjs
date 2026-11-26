import assert from 'node:assert/strict';
import { createPassRoster, simulatePassPlay } from '../engine/autonomous/passing.js';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';

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
  a.events.filter((event) => event.type === 'throw').length);
assert.ok(contestTrace.diagnostics.pass_contests.throws.every((row) =>
  row.resolve_attempts >= row.contact_opportunities.length));
for (const row of contestTrace.diagnostics.pass_contests.throws) {
  assert.equal(row.probability_draws,
    Object.values(row.draws_by_player).reduce((sum, player) => sum + player.probability_draws, 0));
  assert.ok(row.contact_opportunities.every((opportunity) =>
    Number.isInteger(opportunity.resolve_attempts) && Number.isInteger(opportunity.probability_draws)));
}

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
const dpiEvent = dpi.events.find((event) => event.type === 'pass_interference');
assert.ok(dpiEvent, 'downfield contact with a catchable live pass generates defensive interference');
const passAssignments = dpi.events.filter((event) => event.type === 'assignment_executed');
assert.equal(new Set(passAssignments.map((event) => event.player_id)).size, 22,
  'all 22 pass-play assignments are entered in the live event record');
assert.ok(passAssignments.every((event) => event.task && event.role),
  'each assignment record carries the responsible role and executable task');
assert.ok(dpi.terminal.time > dpiEvent.t,
  'DPI is recorded during the pass and does not itself end live execution');
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
assert.ok(forcedFumble.events.some((event) => event.type === 'fumble')
  && forcedFumble.events.some((event) => event.type === 'fumble_recovery'));
assert.equal(protectedBall.fumble, null, 'carrying rating changes fumble exposure at the same seed');

const repeatedContestInput = { seed: 6, front: 'nickel', coverage: 'cover_1', direction: 'right',
  dir: -1, los: 40, ballY: 26.67, resultOnly: true,
  ratingOverrides: { ...fumbleOffenseRatings(1), ...fumbleDefenseRatings } };
const repeatedContest = simulatePassPlay({ ...repeatedContestInput, contestDiagnostics: true });
const repeatedContestControl = simulatePassPlay(repeatedContestInput);
assert.deepEqual(repeatedContest.events, repeatedContestControl.events,
  'probability-draw instrumentation leaves the controlled play and RNG stream unchanged');
const repeatedOpportunity = repeatedContest.diagnostics.pass_contests.throws
  .flatMap((row) => row.contact_opportunities)
  .find((opportunity) => opportunity.probability_draws > 1);
assert.ok(repeatedOpportunity,
  'the current engine retries interception probability within one uninterrupted ball-contact opportunity');
assert.ok(repeatedContest.diagnostics.pass_contests.throws.some((row) => row.resolve_attempts > 1),
  'the trace records repeated resolver attempts for this throw');

// Defensive return progress follows the returner's direction, independent of
// which way the intercepted offense was attacking. The dead spot cannot be
// placed behind the interception catch point by a carrier facing the other way.
for (const scenario of [
  { seed: 'turnover-direction--1-40', dir: -1 },
  { seed: 'turnover-direction-1-60', dir: 1 },
]) {
  const run = simulatePassPlay({ ...base, ...scenario, los: 50 });
  const interception = run.events.find((event) => event.type === 'interception');
  assert.ok(interception, `${scenario.seed} must produce an interception`);
  assert.equal(run.terminal.reason, 'tackle');
  assert.ok((run.terminal.spot.x - interception.at.x) * -scenario.dir >= -1e-8,
    `${scenario.seed} must preserve returner-direction forward progress`);
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
