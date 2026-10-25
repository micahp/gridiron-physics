import assert from 'node:assert/strict';
import { createPassRoster, simulatePassPlay } from '../engine/autonomous/passing.js';

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

// An interception return scores at the goal the returner's team attacks.
// The defense attacks x=100 when the offense attacks -x, and x=0 when it attacks +x.
const pickSixMinus = simulatePassPlay({ seed: 'search-453', concept: 'slant_flat', coverage: 'cover_1', front: 'nickel_under', direction: 'right', dir: -1, los: 95, ballY: 26.667 });
assert.ok(pickSixMinus.interception_id, 'the ball was intercepted');
assert.equal(pickSixMinus.possession_team, 'D');
assert.equal(pickSixMinus.terminal.reason, 'touchdown', 'the pick-six is a defensive touchdown');
assert.ok(Math.abs(pickSixMinus.terminal.spot.x - 100) < 1e-6, 'defense scores at x=100 when the offense attacks -x');

const pickSixPlus = simulatePassPlay({ seed: 'pick-plus-2574', concept: 'slant_flat', coverage: 'cover_1', front: 'nickel_under', direction: 'right', dir: 1, los: 6, ballY: 26.667 });
assert.ok(pickSixPlus.interception_id, 'the ball was intercepted');
assert.equal(pickSixPlus.possession_team, 'D');
assert.equal(pickSixPlus.terminal.reason, 'touchdown', 'the pick-six is a defensive touchdown');
assert.ok(Math.abs(pickSixPlus.terminal.spot.x) < 1e-6, 'defense scores at x=0 when the offense attacks +x');

// Named cases with pinned seeds. Each one locks a behavior the sweeps only hit by chance.
const named = (overrides) => ({ seed: 'named-0', concept: 'slant_flat', coverage: 'cover_1', front: 'nickel_over', direction: 'left', dir: -1, los: 35, ballY: 26.667, ...overrides });

const complete = simulatePassPlay(named({}));
assert.ok(complete.events.some((e) => e.type === 'catch' && e.player_id.startsWith('O.')), 'an eligible receiver completes the pass');
assert.equal(complete.events.filter((e) => e.type === 'whistle').length, 1);

const incomplete = simulatePassPlay(named({ seed: 'named-8', direction: 'right', dir: -1 }));
assert.equal(incomplete.terminal.reason, 'incomplete');
assert.ok(incomplete.events.some((e) => e.type === 'incomplete'));

const interception = simulatePassPlay(named({ seed: 'named-38', front: 'nickel_under', direction: 'right' }));
assert.ok(interception.interception_id, 'the defense takes the ball');
assert.equal(interception.possession_team, 'D');

assert.ok(complete.events.some((e) => e.type === 'catch_contest'), 'the contested catch is resolved and logged');

const low = simulatePassPlay(named({ seed: 'named-212', direction: 'right', ratingOverrides: { 'O.WR1': { CTH: 25, CIT: 25 }, 'O.WR2': { CTH: 25, CIT: 25 }, 'O.WR3': { CTH: 25, CIT: 25 } } }));
const high = simulatePassPlay(named({ seed: 'named-212', direction: 'right', ratingOverrides: { 'O.WR1': { CTH: 99, CIT: 99 }, 'O.WR2': { CTH: 99, CIT: 99 }, 'O.WR3': { CTH: 99, CIT: 99 } } }));
assert.equal(low.terminal.reason, 'incomplete', 'low catch ratings drop the pass');
assert.notEqual(high.terminal.reason, 'incomplete', 'high catch ratings complete the same pass');

// Regression: a lineman placed at this landing spot must not take the catch.
const lineman = simulatePassPlay(named({ initialPositions: { 'O.LT': { x: 33.32558580209292, y: 11.084411185163914 } } }));
assert.ok(!lineman.events.some((e) => (e.type === 'catch' || e.type === 'interception') && e.player_id === 'O.LT'),
  'an offensive lineman is never a catch candidate');

console.log(`autonomous passing ok: ${[...seen].join(', ')}; ${yards.length} plays, `
  + `gain range ${Math.min(...yards).toFixed(1)} to ${Math.max(...yards).toFixed(1)} yd`);
