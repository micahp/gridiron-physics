import assert from 'node:assert/strict';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';
import { reconcileResult } from '../engine/autonomous/results.js';
import { RESULT_SCHEMA } from '../engine/autonomous/schema.js';
import { buildSampleCall } from './autonomous-fixtures.mjs';

const call = buildSampleCall();
const a = simulateAutonomousPlay(call);
const b = simulateAutonomousPlay(call);
assert.equal(a.schema_version, RESULT_SCHEMA);
assert.equal(a.mode, 'autonomous_from_snap');
assert.equal(a.play_id, call.play_id);
assert.equal(a.seed, '1042');
assert.equal(a.status, 'complete', `expected a completed play, got ${JSON.stringify(a.failure)}`);
assert.equal(a.diagnostics.valid_full_game, false, 'Stage One never claims a full game');
assert.deepEqual(a.diagnostics.outcome_inputs, []);
assert.equal(a.diagnostics.result_provenance, 'generated_from_agent_actions_and_physics');

// Determinism covers the whole record, including every recorded frame.
assert.equal(a.result.event, b.result.event);
assert.equal(a.result.yards_gained, b.result.yards_gained);
assert.equal(a.result.elapsed_seconds, b.result.elapsed_seconds);
assert.deepEqual(a.participants, b.participants);
assert.equal(a.events.length, b.events.length);
assert.deepEqual(a.trajectory.roster, b.trajectory.roster);
assert.equal(a.trajectory.frames.length, b.trajectory.frames.length);
for (let i = 0; i < a.trajectory.frames.length; i++) {
  assert.deepEqual([...a.trajectory.frames[i]], [...b.trajectory.frames[i]], `frame ${i} differs between identical seeds`);
}
assert.deepEqual(a.diagnostics.agent_decisions, b.diagnostics.agent_decisions);

// The record reconciles against its own frames and events.
assert.equal(a.diagnostics.reconciliation.ok, true, a.diagnostics.reconciliation.problems.join('; '));
assert.equal(a.trajectory.stride, 22 * 6 + 6);
assert.equal(a.trajectory.hz, 30);
assert.equal(a.trajectory.roster.length, 22);
assert.ok(Math.abs(a.result.final_ball_spot.x_yards - (a.situation.yardline_100 + a.result.yards_gained * a.situation.offense_direction)) < 1e-2);

// The invariant: an unrelated historical outcome cannot change the execution.
const withHistory = { ...call, historical_record: { game_id: '2024-09-NE-CHI', yards: 99, endX: 99 } };
assert.throws(() => simulateAutonomousPlay(withHistory), /prohibited outcome field/,
  'a historical outcome attached to the execution payload is refused, not silently ignored');

// A different seed must be able to change contested actions.
const variants = new Set();
for (const seed of ['1042', '1043', '1044', '1045', '1046', '1047']) {
  const run = simulateAutonomousPlay({ ...call, seed });
  assert.equal(run.status, 'complete');
  variants.add(`${run.result.event}:${run.result.yards_gained}:${run.participants.tacklers.join(',')}`);
}
assert.ok(variants.size > 1, `seeds produced identical results: ${[...variants]}`);

// A failed execution reports the cause and invents nothing.
const broken = buildSampleCall();
delete broken.player_profiles[broken.offense.lineup.QB];
assert.throws(() => simulateAutonomousPlay(broken), /required for every declared player/);

// Both play families flow through the same contract.
const pass = simulateAutonomousPlay(buildSampleCall({ family: 'pass', concept: 'slant_flat', snap_type: 'shotgun', coverage: 'cover_1' }));
assert.equal(pass.schema_version, RESULT_SCHEMA);
assert.equal(pass.call.family, 'pass');
assert.ok(['complete', 'failed'].includes(pass.status));
if (pass.status === 'complete') {
  assert.ok(['catch', 'incomplete', 'interception', 'sack', 'tackle', 'out_of_bounds', 'touchdown'].includes(pass.result.event),
    `unexpected pass terminal ${pass.result.event}`);
  assert.equal(pass.diagnostics.reconciliation.ok, true, pass.diagnostics.reconciliation.problems.join('; '));
}

console.log(`autonomous results ok: ${a.result.event} ${a.result.yards_gained} yd, `
  + `${a.participants.tacklers.length} tackler(s), ${variants.size} distinct results over 6 seeds, pass=${pass.result?.event}`);
