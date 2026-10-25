import assert from 'node:assert/strict';
import { createInsideZoneRoster, simulateInsideZone } from '../engine/autonomous-run.js';
import { scoreAutonomousTracking } from '../engine/tracking-eval.js';

const base = { seed: 'inside-zone-1', front: 'even', runSide: 'left' };
const a = simulateInsideZone(base);
const b = simulateInsideZone(base);

assert.deepEqual(a, b, 'fixed seed and snap inputs reproduce the full play and every trajectory sample');
assert.equal(a.schema_version, 'gridiron.autonomous-inside-zone.v1');
assert.equal(a.mode, 'autonomous');
assert.equal(a.roster.length, 22);
assert.equal(a.roster.filter((p) => p.team === 'O').length, 11);
assert.equal(a.roster.filter((p) => p.team === 'D').length, 11);
assert.equal(new Set(a.roster.map((p) => p.id)).size, 22);
assert.equal(createInsideZoneRoster({ front: 'odd' }).length, 22);
assert.equal(createInsideZoneRoster({ massOverrides: { 'O.RB': 96 } }).find((p) => p.roleKey === 'O.RB').physics.mass, 96);
assert.ok(a.roster.every((p) => p.roleKey && p.slot));
assert.ok(a.roster.every((p) => a.trajectories[p.id].length === a.frames.length));
const start = Object.fromEntries(a.roster.map((p) => [p.roleKey, a.trajectories[p.id][0]]));
assert.ok(start['O.LT'].y > start['O.LG'].y && start['O.LG'].y > start['O.C'].y
  && start['O.C'].y > start['O.RG'].y && start['O.RG'].y > start['O.RT'].y,
'offensive line roles follow the engine’s offense-left lateral convention');
assert.ok(a.events.some((e) => e.type === 'handoff'));
assert.ok(a.events.some((e) => e.type === 'lane_read'));
assert.ok(a.terminal, 'baseline play resolves through a simulated whistle');
assert.ok(a.events.some((e) => e.type === 'tackle' && e.by === a.tackle_id));
assert.ok(Math.abs(a.terminal.yards_gained - (a.terminal.spot.x - a.line_of_scrimmage) * a.direction) < 1e-9);
assert.equal(a.provenance.outcome_inputs.length, 0);

for (const key of ['gain', 'endX', 'endY', 'tacklers', 'complete', 'touchdown', 'scoring', 'outcome']) {
  assert.throws(() => simulateInsideZone({ ...base, [key]: 3 }), /no realized outcome fields/);
}

const frontRuns = new Map();
for (const front of ['over', 'under', 'nickel', 'odd', 'bear']) {
  const run = simulateInsideZone({ ...base, front });
  assert.equal(run.roster.length, 22, `${front} front initializes all 22 players`);
  assert.notDeepEqual(run.trajectories['O.RB'], a.trajectories['O.RB'],
    `${front} front changes the carrier trajectory`);
  frontRuns.set(front, run);
}
assert.notEqual(frontRuns.get('bear').terminal.yards_gained, a.terminal.yards_gained,
  'a different defensive front changes the simulated dead-ball result');

const weakFront = Object.fromEntries(['LDE', 'LDT', 'RDT', 'RDE', 'WILL', 'MIKE', 'SAM']
  .map((role) => [`D.${role}`, { BSH: 40, TAK: 40, STR: 40 }]));
const strongFront = Object.fromEntries(['LDE', 'LDT', 'RDT', 'RDE', 'WILL', 'MIKE', 'SAM']
  .map((role) => [`D.${role}`, { BSH: 99, TAK: 99, STR: 99 }]));
const weakDef = simulateInsideZone({ ...base, ratingOverrides: weakFront });
const strongDef = simulateInsideZone({ ...base, ratingOverrides: strongFront });
assert.notEqual(weakDef.terminal.yards_gained, strongDef.terminal.yards_gained,
  'defensive block-shed and tackle ratings change the simulated spot');

const weakBlocking = Object.fromEntries(['LT', 'LG', 'C', 'RG', 'RT', 'TE', 'WR1', 'WR2', 'WR3']
  .map((role) => [`O.${role}`, { RBK: 40, IBL: 40, STR: 40 }]));
const strongBlocking = Object.fromEntries(['LT', 'LG', 'C', 'RG', 'RT', 'TE', 'WR1', 'WR2', 'WR3']
  .map((role) => [`O.${role}`, { RBK: 99, IBL: 99, STR: 99 }]));
const weakBlockRun = simulateInsideZone({ ...base, ratingOverrides: weakBlocking });
const strongBlockRun = simulateInsideZone({ ...base, ratingOverrides: strongBlocking });
assert.notEqual(weakBlockRun.terminal.yards_gained, strongBlockRun.terminal.yards_gained,
  'offensive blocking ratings change the simulated result');
assert.notEqual(weakBlockRun.blockers.filter((p) => p.won).length, strongBlockRun.blockers.filter((p) => p.won).length,
  'blocker wins are resolved from simulated engagement, shed, and penetration');

const observed = a.roster.flatMap((p) => [0.5, 1.0].map((t) => {
  const sample = a.trajectories[p.id].reduce((best, row) => Math.abs(row.t - t) < Math.abs(best.t - t) ? row : best);
  return { player_id: p.id, t, x: sample.x + 1, y: sample.y };
}));
const scored = scoreAutonomousTracking(a, observed);
assert.equal(scored.mode, 'evaluation_only');
assert.equal(scored.horizons['0.5s'].players_scored, 22);
assert.ok(Math.abs(scored.horizons['0.5s'].mean_xy_error_yards - 1) < 1e-5);
assert.ok(Math.abs(scored.horizons['1.0s'].mean_xy_error_yards - 1) < 1e-5);
assert.throws(() => scoreAutonomousTracking(a, [{ ...observed[0], t: 0 }]), /after snap/);
assert.throws(() => scoreAutonomousTracking(a, [{ ...observed[0], tackler_id: 'future-label' }]), /positions and time only/);

console.log(`autonomous inside-zone ok: ${a.terminal.reason} ${a.terminal.yards_gained.toFixed(2)} yd; `
  + `${a.blockers.filter((p) => p.won).length}/${a.blockers.length} blockers won; all fronts/ratings and tracking scorer exercised`);
