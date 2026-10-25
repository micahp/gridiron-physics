import assert from 'node:assert/strict';
import { simulateInsideZone } from '../engine/autonomous-run.js';
import { simulatePassPlay } from '../engine/autonomous/passing.js';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';
import { reconcileResult } from '../engine/autonomous/results.js';
import { buildSampleCall } from './autonomous-fixtures.mjs';

const FIELD_W = 53.33;
const ENDINGS = new Set(['tackle', 'touchdown', 'out_of_bounds', 'safety', 'incomplete', 'sack']);

for (let i = 0; i < 40; i++) {
  const run = i % 2
    ? simulateInsideZone({ seed: `rules-run-${i}`, front: ['even', 'over', 'under', 'nickel', 'odd', 'bear'][i % 6], runSide: i % 4 < 2 ? 'right' : 'left', dir: i % 4 < 2 ? 1 : -1, los: 15 + (i * 13) % 70 })
    : simulatePassPlay({ seed: `rules-pass-${i}`, front: i % 4 ? 'nickel_over' : 'nickel_under', coverage: i % 3 ? 'cover_1' : 'cover_3', direction: i % 4 < 2 ? 'right' : 'left', dir: i % 8 < 4 ? 1 : -1, los: 15 + (i * 13) % 70 });

  const t = run.terminal;
  assert.ok(t, `${run.seed} produces a football result, not a technical stop`);
  assert.ok(ENDINGS.has(t.reason), `${run.seed}: ${t.reason} is a supported ending`);
  assert.ok(Number.isFinite(t.time) && t.time > 0, `${run.seed}: the play took positive time`);
  assert.ok(Number.isFinite(t.spot.x) && Number.isFinite(t.spot.y), `${run.seed}: the dead-ball spot is finite`);
  assert.ok(t.spot.x >= -1e-6 && t.spot.x <= 100 + 1e-6, `${run.seed}: the spot is between the goal lines (${t.spot.x})`);
  assert.ok(t.spot.y >= -1e-6 && t.spot.y <= FIELD_W + 1e-6, `${run.seed}: the spot is between the sidelines (${t.spot.y})`);

  const dir = run.dir ?? (typeof run.direction === 'number' ? run.direction
    : run.direction === 'left' ? -1 : 1);
  const expected = (t.spot.x - run.line_of_scrimmage) * dir;
  assert.ok(Math.abs(t.yards_gained - expected) < 0.51, `${run.seed}: yards gained (${t.yards_gained.toFixed(2)}) follows the spot and the play direction`);

  if (t.reason === 'touchdown') {
    assert.ok(dir > 0 ? Math.abs(t.spot.x - 100) < 1e-6 : Math.abs(t.spot.x) < 1e-6, `${run.seed}: a touchdown is spotted on the goal line`);
  }
  if (t.reason === 'out_of_bounds') {
    assert.ok(t.spot.y <= 1e-6 || Math.abs(t.spot.y - FIELD_W) <= 1e-6, `${run.seed}: out of bounds is spotted on the boundary`);
  }
  if (t.reason === 'safety') {
    assert.ok(dir > 0 ? t.spot.x <= 1e-6 : t.spot.x >= 100 - 1e-6, `${run.seed}: a safety is spotted behind the carrier's own goal line`);
  }
  if (t.reason === 'incomplete') {
    assert.equal(run.possession_team, 'O', `${run.seed}: an incomplete pass stays with the offense on the next snap`);
    assert.ok(Object.is(t.yards_gained, 0) || Math.abs(t.yards_gained) < 1e-9, `${run.seed}: an incomplete pass gains nothing`);
  }
  if (t.reason === 'tackle') {
    assert.ok(run.tackle_id, `${run.seed}: a tackle names its tackler`);
    const tackler = run.roster.find((p) => p.id === run.tackle_id);
    const expectedTeam = run.interception_id ? 'O' : 'D';
    assert.equal(tackler.team, expectedTeam, `${run.seed}: the team without the ball makes the tackle`);
  }

  // The recorded play ends when the whistle blows; nothing happens afterwards.
  const whistle = run.events.at(-1);
  assert.equal(whistle.type, 'whistle', `${run.seed}: the event log ends at the whistle`);
  assert.ok(Math.abs(whistle.t - t.time) < 1e-6, `${run.seed}: the whistle time is the terminal time`);
  const lastFrame = Math.max(...Object.values(run.trajectories).map((path) => path.at(-1).t));
  assert.ok(lastFrame <= t.time + 1e-6, `${run.seed}: no player is recorded after the whistle`);
}

// The adapter keeps the outcome out of the input and labels the record honestly.
const call = buildSampleCall({});
const record = simulateAutonomousPlay(call);
reconcileResult(record);
assert.equal(record.status, 'complete');
assert.equal(record.diagnostics.result_provenance, 'generated_from_agent_actions_and_physics');
assert.deepEqual(record.diagnostics.outcome_inputs, []);
assert.equal(record.diagnostics.valid_full_game, false);
assert.ok(record.result.event, 'the record carries the simulated ending');
assert.ok(!('gain' in call.situation));
assert.ok(!('outcome' in call));

console.log('autonomous rules ok: supported endings, in-bounds spots, whistle terminal, no game-level claims');
