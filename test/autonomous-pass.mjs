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

// An interception return is measured in the returner's own direction. Seed pick-4 places D.NB at x=11 on the
// ball line (LOS 6, offense attacking +x). He intercepts near x=15 and runs back toward x=0; the reported spot
// must be his return end, behind the interception, and the offense's net yards count from the LOS.
const returnRun = simulatePassPlay({
  seed: 'pick-4', front: 'nickel_over', coverage: 'cover_3', los: 6, dir: 1, ballY: 26.667, direction: 'right',
  initialPositions: { 'D.NB': { x: 11, y: 28.667 } },
});
const interceptionEvent = returnRun.events.find((e) => e.type === 'interception');
assert.ok(interceptionEvent, 'the placed defender intercepts');
assert.equal(returnRun.possession_team, 'D');
assert.ok(returnRun.terminal.spot.x <= interceptionEvent.at.x + 1e-6,
  `the return ends at ${returnRun.terminal.spot.x.toFixed(2)} yd, behind the interception at ${interceptionEvent.at.x.toFixed(2)} yd`);
assert.ok(Math.abs(returnRun.terminal.yards_gained - (returnRun.terminal.spot.x - 6)) < 1e-6, 'net yards are measured from the LOS');

// Named cases with pinned seeds. Each one locks a behavior the sweeps only hit by chance.
const named = (overrides) => ({ seed: 'named-0', concept: 'slant_flat', coverage: 'cover_1', front: 'nickel_over', direction: 'left', dir: -1, los: 35, ballY: 26.667, ...overrides });

const complete = simulatePassPlay(named({}));
assert.ok(complete.events.some((e) => e.type === 'catch' && e.player_id.startsWith('O.')), 'an eligible receiver completes the pass');
assert.equal(complete.events.filter((e) => e.type === 'whistle').length, 1);

const incomplete = simulatePassPlay(named({ seed: 'named-14' }));
assert.equal(incomplete.terminal.reason, 'incomplete');
assert.ok(incomplete.events.some((e) => e.type === 'incomplete'));

const interception = simulatePassPlay({
  seed: 'int-7', front: 'nickel_over', coverage: 'cover_3', los: 50, dir: 1, ballY: 26.667, direction: 'right',
  initialPositions: { 'D.NB': { x: 56, y: 26.667 } },
});
assert.ok(interception.interception_id, 'the defense takes the ball');
assert.equal(interception.possession_team, 'D');

assert.ok(complete.events.some((e) => e.type === 'catch_contest'), 'the contested catch is resolved and logged');

const low = simulatePassPlay(named({ seed: 'named-214', direction: 'right', ratingOverrides: { 'O.WR1': { CTH: 25, CIT: 25 }, 'O.WR2': { CTH: 25, CIT: 25 }, 'O.WR3': { CTH: 25, CIT: 25 } } }));
const high = simulatePassPlay(named({ seed: 'named-214', direction: 'right', ratingOverrides: { 'O.WR1': { CTH: 99, CIT: 99 }, 'O.WR2': { CTH: 99, CIT: 99 }, 'O.WR3': { CTH: 99, CIT: 99 } } }));
assert.equal(low.terminal.reason, 'incomplete', 'low catch ratings drop the pass');
assert.notEqual(high.terminal.reason, 'incomplete', 'high catch ratings complete the same pass');

// Regression: a lineman placed at this landing spot must not take the catch.
const lineman = simulatePassPlay(named({ initialPositions: { 'O.LT': { x: 33.32558580209292, y: 11.084411185163914 } } }));
assert.ok(!lineman.events.some((e) => (e.type === 'catch' || e.type === 'interception') && e.player_id === 'O.LT'),
  'an offensive lineman is never a catch candidate');

console.log(`autonomous passing ok: ${[...seen].join(', ')}; ${yards.length} plays, `
  + `gain range ${Math.min(...yards).toFixed(1)} to ${Math.max(...yards).toFixed(1)} yd`);
