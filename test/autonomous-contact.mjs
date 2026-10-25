import assert from 'node:assert/strict';
import { simulateInsideZone } from '../engine/autonomous-run.js';
import { simulatePassPlay } from '../engine/autonomous/passing.js';

const runs = [];
for (let i = 0; i < 24; i++) {
  runs.push(simulateInsideZone({
    seed: `contact-run-${i}`,
    front: ['even', 'over', 'under', 'nickel', 'odd', 'bear'][i % 6],
    runSide: i % 2 ? 'left' : 'right',
    dir: i % 4 < 2 ? 1 : -1,
    los: 20 + (i * 17) % 60,
  }));
}
for (let i = 0; i < 24; i++) {
  runs.push(simulatePassPlay({
    seed: `contact-pass-${i}`,
    front: i % 2 ? 'nickel_over' : 'nickel_under',
    coverage: i % 3 === 0 ? 'cover_3' : 'cover_1',
    direction: i % 2 ? 'left' : 'right',
    dir: i % 4 < 2 ? 1 : -1,
    los: 20 + (i * 11) % 60,
  }));
}

const teamOf = (run) => new Map(run.roster.map((p) => [p.id, p.team]));

for (const run of runs) {
  assert.ok(run.resolved, `${run.seed} resolves (${JSON.stringify(run.failure)})`);
  const teams = teamOf(run);
  const engagedPairs = new Set();
  const engagementOf = new Map(); // defender id -> current blocker ids

  for (const event of run.events) {
    if (event.type === 'block_engage') {
      assert.notEqual(event.blocker_id, event.defender_id, `${run.seed}: nobody blocks himself`);
      assert.notEqual(teams.get(event.blocker_id), teams.get(event.defender_id), `${run.seed}: blockers and rushers are opponents`);
      assert.ok(run.trajectories[event.blocker_id] && run.trajectories[event.defender_id], `${run.seed}: engagement names two real players`);
      engagedPairs.add(`${event.blocker_id}|${event.defender_id}`);
      if (!engagementOf.has(event.defender_id)) engagementOf.set(event.defender_id, new Set());
      engagementOf.get(event.defender_id).add(event.blocker_id);
    }
    if (event.type === 'shed') {
      assert.ok(engagedPairs.has(`${event.from}|${event.by}`) || engagedPairs.has(`${event.by}|${event.from}`),
        `${run.seed}: a shed only frees a player from an existing block`);
      assert.notEqual(teams.get(event.by), teams.get(event.from), `${run.seed}: a shed comes from an opponent`);
    }
    if (event.type === 'block_release') {
      assert.ok(engagedPairs.has(`${event.blocker_id}|${event.defender_id}`), `${run.seed}: a release ends a real engagement`);
    }
    if (event.type === 'tackle') {
      assert.equal(event.on, run.carrier_id, `${run.seed}: the tackled player is the carrier`);
      assert.notEqual(teams.get(event.by), teams.get(event.on), `${run.seed}: a tackler is an opponent`);
    }
    if (event.type === 'broken_tackle') {
      assert.equal(event.carrier_id, run.carrier_id, `${run.seed}: only the carrier breaks tackles`);
      assert.notEqual(teams.get(event.defender_id), teams.get(event.carrier_id), `${run.seed}: a broken tackle comes from an opponent`);
    }
    if (event.type === 'sack') {
      assert.notEqual(event.defender_id, event.quarterback_id, `${run.seed}: the sacker is an opponent`);
    }
    assert.ok(Number.isFinite(event.t), `${run.seed}: every event has a finite time`);
  }

  // Holds: exactly one body may own the ball in any recorded frame.
  for (const [id, path] of Object.entries(run.trajectories)) {
    assert.ok(Array.isArray(path) && path.length > 1, `${run.seed}: ${id} has a trajectory`);
    for (const sample of path) {
      assert.ok(Number.isFinite(sample.x) && Number.isFinite(sample.y) && Number.isFinite(sample.speed),
        `${run.seed}: ${id} never has a non-finite sample`);
    }
  }
  const ids = run.roster.map((p) => p.id);
  const frames = Math.min(...ids.map((id) => run.trajectories[id].length));
  for (let f = 0; f < frames; f++) {
    const holders = ids.filter((id) => run.trajectories[id][f]?.hasBall);
    assert.ok(holders.length <= 1, `${run.seed}: frame ${f} has ${holders.length} ball holders`);
  }

  const tackles = run.events.filter((e) => e.type === 'tackle');
  assert.equal(tackles.length <= 1, true, `${run.seed}: at most one tackle is recorded`);
  assert.equal(run.events.filter((e) => e.type === 'whistle').length, 1, `${run.seed}: exactly one whistle`);
  if (tackles.length) {
    const whistle = run.events.find((e) => e.type === 'whistle');
    assert.ok(whistle.t >= tackles[0].t, `${run.seed}: the whistle follows the tackle`);
  }

  // Force is applied through engagements, not teleportation.
  for (const id of ids) {
    const path = run.trajectories[id];
    let maxStep = 0;
    for (let i = 1; i < path.length; i++) {
      maxStep = Math.max(maxStep, Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
    }
    assert.ok(maxStep < 1.2, `${run.seed}: ${id} moves ${maxStep.toFixed(2)} yd between recorded frames`);
  }
}

console.log(`autonomous contact ok: ${runs.length} plays, engagements/sheds/tackles only between opponents, one ball holder`);
