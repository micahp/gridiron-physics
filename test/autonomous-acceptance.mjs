import assert from 'node:assert/strict';
import { DT } from '../engine/constants.js';
import { createInsideZoneRoster, simulateInsideZone } from '../engine/autonomous-run.js';
import { Player, World } from '../engine/world.js';
import { rng } from '../engine/rng.js';

const defenseRatings = (front, ratings) => Object.fromEntries(
  createInsideZoneRoster({ front }).filter((p) => p.team === 'D').map((p) => [p.roleKey, ratings]),
);
const strongOL = Object.fromEntries(['LT', 'LG', 'C', 'RG', 'RT', 'TE']
  .map((role) => [`O.${role}`, { RBK: 99, IBL: 99, STR: 99 }]));
const weakOL = Object.fromEntries(['LT', 'LG', 'C', 'RG', 'RT', 'TE']
  .map((role) => [`O.${role}`, { RBK: 40, IBL: 40, STR: 40 }]));
const openFront = (front) => ({
  ...strongOL,
  ...defenseRatings(front, { BSH: 40, TAK: 40, STR: 40 }),
});

const scenarios = [
  {
    name: 'open inside gap',
    config: { seed: 'open-gap-78', front: 'even', runSide: 'left', ratingOverrides: openFront('even') },
    verify: (run) => assert.ok(run.terminal.yards_gained >= 4 && run.terminal.yards_gained < 10),
  },
  {
    name: 'collapsed playside gap',
    config: {
      seed: 'accept-1', front: 'bear', runSide: 'left',
      ratingOverrides: { ...weakOL, ...defenseRatings('bear', { BSH: 99, TAK: 99, STR: 99 }) },
    },
    verify: (run) => assert.ok(run.terminal.yards_gained < 0),
  },
  {
    name: 'backside cutback',
    config: { seed: 'cutback-inside-80', front: 'even', runSide: 'left' },
    verify: (run) => {
      const lanes = run.events.filter((e) => e.type === 'lane_read').map((e) => e.lane_local_yards);
      assert.ok(lanes[0] > 1.5 && lanes.some((lane, i) => i > 0 && lane < -0.5));
    },
  },
  {
    name: 'unblocked linebacker',
    config: {
      seed: 'mike-1-42', runSide: 'left',
      initialPositions: { 'O.C': { x: 10, y: 15 }, 'D.MIKE': { x: 40.1, y: 26.667 } },
    },
    verify: (run) => {
      assert.ok(['D.WILL', 'D.MIKE', 'D.SAM'].includes(run.tackle_id));
      assert.ok(!run.events.some((e) => e.type === 'block_engage' && e.defender_id === run.tackle_id));
    },
  },
  {
    name: 'defender sheds a block',
    config: { seed: 'base-1', runSide: 'left' },
    verify: (run) => assert.ok(run.events.some((e) => e.type === 'shed')),
  },
  {
    name: 'tackle for loss',
    config: { seed: 'base-1', runSide: 'left' },
    verify: (run) => assert.ok(run.terminal.yards_gained < 0 && run.tackle_id),
  },
  {
    name: 'broken tackle',
    config: { seed: 'broken-3', runSide: 'left' },
    verify: (run) => assert.ok(run.events.some((e) => e.type === 'broken_tackle') && run.tackle_id),
  },
  {
    name: 'explosive run',
    config: {
      seed: 'breakout-inside-1', front: 'even', runSide: 'left', ratingOverrides: openFront('even'),
    },
    verify: (run) => assert.ok(run.terminal.yards_gained >= 10),
  },
  {
    name: 'out-of-bounds run',
    config: {
      seed: 'sideline-left-0', front: 'nickel', runSide: 'left', ballY: 1.3,
      ratingOverrides: openFront('nickel'),
    },
    verify: (run) => {
      assert.equal(run.terminal.reason, 'out_of_bounds');
      assert.equal(run.terminal.spot.y, 0, 'sideline spot is interpolated onto the boundary');
    },
  },
  {
    name: 'touchdown',
    config: {
      seed: 'goal-line-5', front: 'even', runSide: 'left', los: 98,
      ratingOverrides: openFront('even'),
    },
    verify: (run) => {
      assert.equal(run.terminal.reason, 'touchdown');
      assert.equal(run.terminal.spot.x, 100);
      assert.ok(run.events.findIndex((e) => e.type === 'touchdown') < run.events.findIndex((e) => e.type === 'whistle'));
    },
  },
];

function eventSummary(run) {
  return run.events.filter((event) => [
    'snap', 'snap_receive', 'handoff', 'lane_read', 'block_engage', 'block_release',
    'shed', 'broken_tackle', 'tackle', 'touchdown', 'whistle',
  ].includes(event.type)).map((event) => {
    if (event.type === 'block_engage') return `${event.type}:${event.blocker_id}>${event.defender_id}`;
    if (event.type === 'lane_read') return `${event.type}:${event.lane_local_yards.toFixed(1)}`;
    if (event.type === 'tackle') return `${event.type}:${event.by}>${event.on}`;
    return event.type;
  });
}

for (const scenario of scenarios) {
  const run = simulateInsideZone(scenario.config);
  assert.equal(run.resolved, true, `${scenario.name} should end with a football terminal event`);
  assert.equal(run.roster.length, 22);
  assert.equal(run.roster.filter((p) => p.team === 'O').length, 11);
  assert.equal(run.roster.filter((p) => p.team === 'D').length, 11);
  assert.ok(run.events.some((e) => e.type === 'snap') && run.events.some((e) => e.type === 'handoff'));
  assert.equal(run.events.filter((e) => e.type === 'snap_receive').length, 1);
  assert.equal(run.events.filter((e) => e.type === 'handoff').length, 1);
  assert.equal(run.carrier_id, 'O.RB');
  assert.equal(run.events.at(-1).type, 'whistle');
  assert.ok(Math.abs(run.terminal.yards_gained - (run.terminal.spot.x - run.line_of_scrimmage) * run.direction) < 1e-9);
  assert.equal(run.events.filter((e) => e.type === 'block_engage').length,
    run.events.filter((e) => e.type === 'block_release').length,
    'all engagements release at the whistle');
  assert.equal(run.events.filter((e) => e.type === 'whistle').length, 1);
  assert.equal(run.events.find((e) => e.type === 'whistle').reason, run.terminal.reason);
  assert.ok(run.roster.every((p) => run.trajectories[p.id].at(-1).engaged_with == null));
  assert.ok(run.events.every((e) => e.t <= run.terminal.time + 1e-8));
  for (const player of run.roster) {
    const path = run.trajectories[player.id];
    for (let i = 1; i < path.length; i++) {
      assert.ok(Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y) < 1,
        `${player.roleKey} has no recorded teleport between frames`);
    }
  }
  scenario.verify(run);
  const lastBrokenAttempt = new Map();
  for (const event of run.events.filter((e) => e.type === 'broken_tackle')) {
    const previous = lastBrokenAttempt.get(event.defender_id);
    if (previous != null) assert.ok(event.t - previous >= 1 - 1e-8, 'one defender cannot immediately reattempt a broken tackle');
    lastBrokenAttempt.set(event.defender_id, event.t);
  }
  const result = `${run.terminal.reason} ${run.terminal.yards_gained >= 0 ? '+' : ''}${run.terminal.yards_gained.toFixed(2)} yd`;
  console.log(`${scenario.name} | seed=${scenario.config.seed} | ${result} | ${eventSummary(run).join(' > ')}`);
}

// Ratings and snap-time geometry affect choices, pursuit and contact under an unchanged seed.
const baseConfig = { seed: 'sensitivity-17', front: 'even', runSide: 'left' };
const base = simulateInsideZone(baseConfig);
const perimeterRead = simulateInsideZone({ seed: 'wr-target-audit', front: 'even', runSide: 'left' });
for (const role of ['O.WR1', 'O.WR2', 'O.WR3']) {
  const sample = perimeterRead.trajectories[role].find((row) => row.t >= 0.2 && row.assignment_target);
  assert.ok(sample, `${role} should acquire a live perimeter target`);
  const target = createInsideZoneRoster({ front: 'even' }).find((player) => player.roleKey === sample.assignment_target);
  assert.ok(['DB', 'LB'].includes(target?.group), `${role} should stalk a perimeter defender, not chase a DL across the box`);
}
assert.ok(perimeterRead.trajectories['O.WR1'].find((row) => row.t >= 1).y > 39.8,
  'the outside receiver should retain leverage toward the corner instead of sprinting inside toward a lineman');
const changedFront = simulateInsideZone({ ...baseConfig, front: 'bear' });
assert.notDeepEqual(
  base.events.filter((e) => e.type === 'block_engage').map((e) => [e.blocker_id, e.defender_id]),
  changedFront.events.filter((e) => e.type === 'block_engage').map((e) => [e.blocker_id, e.defender_id]),
  'a changed front alters live block targets',
);
const removedBlocker = simulateInsideZone({ ...baseConfig, initialPositions: { 'O.LG': { x: 10, y: 30 } } });
assert.ok(!removedBlocker.events.some((e) => e.type === 'block_engage' && e.blocker_id === 'O.LG'));
assert.notDeepEqual(base.trajectories['O.RB'], removedBlocker.trajectories['O.RB']);
const movedDefender = simulateInsideZone({ ...baseConfig, initialPositions: { 'D.MIKE': { x: 40.1, y: 26.667 } } });
assert.notDeepEqual(base.trajectories['D.MIKE'], movedDefender.trajectories['D.MIKE']);
const lowVision = simulateInsideZone({ ...baseConfig, ratingOverrides: { 'O.RB': { BCV: 40, AWR: 40, AGI: 40 } } });
const highVision = simulateInsideZone({ ...baseConfig, ratingOverrides: { 'O.RB': { BCV: 99, AWR: 99, AGI: 99 } } });
assert.notDeepEqual(
  lowVision.events.filter((e) => e.type === 'lane_read').map((e) => e.lane_local_yards),
  highVision.events.filter((e) => e.type === 'lane_read').map((e) => e.lane_local_yards),
  'carrier vision, awareness and agility change lane decisions',
);
const slowMike = simulateInsideZone({ ...baseConfig, ratingOverrides: { 'D.MIKE': { SPD: 40, ACC: 40, PUR: 40 } } });
const fastMike = simulateInsideZone({ ...baseConfig, ratingOverrides: { 'D.MIKE': { SPD: 99, ACC: 99, PUR: 99 } } });
assert.notDeepEqual(slowMike.trajectories['D.MIKE'], fastMike.trajectories['D.MIKE'], 'pursuit ratings change movement');
const weakTackler = simulateInsideZone({ ...baseConfig, ratingOverrides: { 'D.LDT': { TAK: 1, STR: 40 } } });
const strongTackler = simulateInsideZone({ ...baseConfig, ratingOverrides: { 'D.LDT': { TAK: 99, STR: 99 } } });
assert.notEqual(weakTackler.tackle_id, strongTackler.tackle_id, 'tackle ratings change contact resolution');

// A deliberately unreachable mesh demonstrates that the cap reports failure and no yards.
const capped = simulateInsideZone({ seed: 'timeout-100', initialPositions: { 'O.RB': { x: 100, y: 2 } } });
assert.equal(capped.terminal, null);
assert.equal(capped.resolved, false);
assert.deepEqual(capped.failure, { reason: 'simulation_time_cap', time_limit_seconds: 9 });
assert.equal(capped.events.some((e) => e.type === 'whistle'), false);
assert.equal(capped.events.some((e) => e.type === 'handoff'), false);
assert.equal(capped.events.at(-1).type, 'simulation_failure');

// Opposing players cross at sprint velocity within one video frame; the 120 Hz
// world substeps still resolve a real body collision instead of tunneling.
const roster = createInsideZoneRoster();
const offenseInfo = roster.find((p) => p.roleKey === 'O.RB');
const defenseInfo = roster.find((p) => p.roleKey === 'D.MIKE');
const world = new World(rng('collision-no-tunnel'));
const runner = world.add(new Player(offenseInfo, 'O', 'RB'));
const defender = world.add(new Player(defenseInfo, 'D', 'MIKE'));
runner.p = { x: -0.75, y: 0 };
defender.p = { x: 0.75, y: 0 };
runner.v = runner.dv = { x: 8, y: 0 };
defender.v = defender.dv = { x: -8, y: 0 };
runner.h = 0;
defender.h = Math.PI;
let collisionContacts = 0;
world.onTouch = () => { collisionContacts++; };
for (let i = 0; i < 120; i++) world.step(DT, () => {});
assert.ok(collisionContacts > 0, 'continuous opposing movement produces contact');
assert.ok(runner.p.x < defender.p.x, 'the players did not pass through each other');

console.log('PASS autonomy perturbations: fronts, blocker, defender location, RB vision, pursuit, tackle ratings, and explicit time-cap failure');
