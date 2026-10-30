import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { simulateInsideZone } from '../engine/autonomous-run.js';
import { simulatePassPlay } from '../engine/autonomous/passing.js';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';
import { reconcileResult } from '../engine/autonomous/results.js';
import { buildSampleCall } from './autonomous-fixtures.mjs';
import { assertFootballInvariant } from './football-assertion.mjs';

const FIELD_W = 53.33;
const ENDINGS = new Set(['tackle', 'touchdown', 'out_of_bounds', 'safety', 'incomplete', 'sack']);
const SOURCE_HASHES = Object.fromEntries([
  ['autonomous-run.js', new URL('../engine/autonomous-run.js', import.meta.url)],
  ['passing.js', new URL('../engine/autonomous/passing.js', import.meta.url)],
  ['play.js', new URL('../engine/play.js', import.meta.url)],
].map(([name, path]) => [name, createHash('sha256').update(readFileSync(path)).digest('hex')]));

for (let i = 0; i < 40; i++) {
  const config = i % 2
    ? { seed: `rules-run-${i}`, front: ['even', 'over', 'under', 'nickel', 'odd', 'bear'][i % 6],
      runSide: i % 4 < 2 ? 'right' : 'left', dir: i % 4 < 2 ? 1 : -1, los: 15 + (i * 13) % 70 }
    : { seed: `rules-pass-${i}`, front: i % 4 ? 'nickel_over' : 'nickel_under',
      coverage: i % 3 ? 'cover_1' : 'cover_3', direction: i % 4 < 2 ? 'right' : 'left',
      dir: i % 8 < 4 ? 1 : -1, los: 15 + (i * 13) % 70 };
  const run = i % 2 ? simulateInsideZone(config) : simulatePassPlay(config);

  const t = run.terminal;
  const dir = run.dir ?? (typeof run.direction === 'number' ? run.direction
    : run.direction === 'left' ? -1 : 1);
  const evidence = (violated_assertion) => ({
    failure_class: 'ILLEGAL_STATE', game_id: `synthetic-autonomous-rules-${i}`,
    seed: run.seed, play_index: 1,
    state_before: { line_of_scrimmage_x: run.line_of_scrimmage,
      offense_direction: dir, play_type: i % 2 ? 'inside_zone' : 'pass' },
    decision: { play_type: i % 2 ? 'inside_zone' : 'pass', ...config },
    outcome: { terminal: t ?? null, events: run.events },
    state_after: t ?? 'no_terminal', violated_assertion, source_artifact_hashes: SOURCE_HASHES,
  });
  const verify = (condition, violated_assertion) =>
    assertFootballInvariant(condition, evidence(violated_assertion));

  verify(!!t, 'the play must produce a football result instead of a technical stop');
  verify(ENDINGS.has(t.reason), `the terminal reason ${t.reason} must be supported`);
  verify(Number.isFinite(t.time) && t.time > 0, 'a terminal play must consume positive time');
  verify(Number.isFinite(t.spot.x) && Number.isFinite(t.spot.y), 'the dead-ball spot must be finite');
  verify(t.spot.x >= -1e-6 && t.spot.x <= 100 + 1e-6, 'the spot must remain between the goal lines');
  verify(t.spot.y >= -1e-6 && t.spot.y <= FIELD_W + 1e-6, 'the spot must remain between the sidelines');

  const expected = (t.spot.x - run.line_of_scrimmage) * dir;
  verify(Math.abs(t.yards_gained - expected) < 0.51,
    'credited yards must follow the dead-ball spot and play direction');

  if (t.reason === 'touchdown') {
    verify(dir > 0 ? Math.abs(t.spot.x - 100) < 1e-6 : Math.abs(t.spot.x) < 1e-6,
      'a touchdown must be spotted on the opponent goal line');
  }
  if (t.reason === 'out_of_bounds') {
    verify(t.spot.y <= 1e-6 || Math.abs(t.spot.y - FIELD_W) <= 1e-6,
      'an out-of-bounds carrier must be spotted on the sideline');
  }
  if (t.reason === 'safety') {
    verify(dir > 0 ? t.spot.x <= 1e-6 : t.spot.x >= 100 - 1e-6,
      'a safety must be spotted behind the carrier own goal line');
  }
  if (t.reason === 'incomplete') {
    verify(run.possession_team === 'O', 'an incomplete pass must keep possession with the offense');
    verify(Object.is(t.yards_gained, 0) || Math.abs(t.yards_gained) < 1e-9,
      'an incomplete pass must have zero yards gained');
  }
  if (t.reason === 'tackle') {
    verify(!!run.tackle_id, 'a tackle must identify its tackler');
    const tackler = run.roster.find((p) => p.id === run.tackle_id);
    const expectedTeam = run.interception_id ? 'O' : 'D';
    verify(tackler?.team === expectedTeam, 'the team without possession must make the tackle');
  }

  // The recorded play ends when the whistle blows; nothing happens afterwards.
  const whistle = run.events.at(-1);
  verify(whistle.type === 'whistle', 'the event log must end at the whistle');
  verify(Math.abs(whistle.t - t.time) < 1e-6, 'the whistle time must equal the terminal time');
  const lastFrame = Math.max(...Object.values(run.trajectories).map((path) => path.at(-1).t));
  verify(lastFrame <= t.time + 1e-6, 'no player trajectory may extend beyond the whistle');
}

// Forward progress survives a tackle that carries the runner backward after
// the ball has already reached its furthest forward spot.
const progressRun = simulateInsideZone({ seed: 'base-1', runSide: 'left' });
const handoff = progressRun.events.find((event) => event.type === 'handoff'
  && event.to === progressRun.carrier_id);
const progressPath = progressRun.trajectories[progressRun.carrier_id]
  .filter((frame) => frame.t >= handoff.t - 1e-9);
const progressDir = progressRun.dir ?? 1;
const maxForwardYards = Math.max(...progressPath.map(
  (frame) => (frame.x - progressRun.line_of_scrimmage) * progressDir));
const terminalYards = (progressRun.terminal.spot.x - progressRun.line_of_scrimmage) * progressDir;
const progressEvidence = (outcome, state_after, violated_assertion) => ({
  failure_class: 'ILLEGAL_STATE', game_id: 'synthetic-forward-progress',
  seed: progressRun.seed, play_index: 1,
  state_before: { line_of_scrimmage_x: progressRun.line_of_scrimmage,
    offense_direction: progressDir, carrier_id: progressRun.carrier_id, handoff_time: handoff.t },
  decision: { play_type: 'inside_zone', run_side: 'left', carrier_id: progressRun.carrier_id },
  outcome, state_after, violated_assertion, source_artifact_hashes: SOURCE_HASHES,
});
assertFootballInvariant(progressRun.terminal.reason === 'tackle' && handoff
  && terminalYards + 0.1 >= maxForwardYards,
progressEvidence({ terminal: progressRun.terminal, max_forward_yards: maxForwardYards },
  { ball_spot_x: progressRun.terminal.spot.x },
  'a tackle spot must preserve established forward progress'));

const mutatedTerminalYards = terminalYards - 1;
let progressMutationFailure = null;
try {
  assertFootballInvariant(mutatedTerminalYards + 0.1 >= maxForwardYards,
    progressEvidence({ terminal_yards: mutatedTerminalYards, max_forward_yards: maxForwardYards },
      { ball_spot_x: progressRun.line_of_scrimmage + progressDir * mutatedTerminalYards },
      'a tackle spot must preserve established forward progress'));
} catch (error) {
  progressMutationFailure = error;
}
assertFootballInvariant(progressMutationFailure?.name === 'FootballInvariantError'
  && progressMutationFailure.failure?.failure_class === 'ILLEGAL_STATE'
  && progressMutationFailure.failure?.game_id === 'synthetic-forward-progress'
  && progressMutationFailure.failure?.seed === 'base-1'
  && progressMutationFailure.failure?.play_index === 1
  && progressMutationFailure.failure?.outcome?.max_forward_yards === maxForwardYards
  && progressMutationFailure.failure?.source_artifact_hashes?.['autonomous-run.js'],
progressEvidence(progressMutationFailure?.failure ?? { error_name: progressMutationFailure?.name ?? null },
  { ball_spot_x: progressRun.terminal.spot.x },
  'a backward-spot mutation must fail with full football assertion evidence'));

// The adapter keeps the outcome out of the input and labels the record honestly.
const call = buildSampleCall({});
const record = simulateAutonomousPlay(call);
reconcileResult(record);
const adapterEvidence = (violated_assertion) => ({
  failure_class: 'ILLEGAL_STATE', game_id: call.play_id, seed: call.seed, play_index: 1,
  state_before: call.situation, decision: call.offense, outcome: record.result,
  state_after: record.diagnostics, violated_assertion,
  source_artifact_hashes: SOURCE_HASHES,
});
const verifyAdapter = (condition, violated_assertion) =>
  assertFootballInvariant(condition, adapterEvidence(violated_assertion));
verifyAdapter(record.status === 'complete', 'the adapter must retain a resolved play');
verifyAdapter(record.diagnostics.result_provenance === 'generated_from_agent_actions_and_physics',
  'the adapter must label the physics-generated result');
verifyAdapter(record.diagnostics.outcome_inputs.length === 0,
  'the adapter must not feed the outcome into the play call');
verifyAdapter(record.diagnostics.valid_full_game === false,
  'a single play must not claim full-game validity');
verifyAdapter(!!record.result.event, 'the adapted record must carry the simulated ending');
verifyAdapter(!('gain' in call.situation), 'the play call must not contain realized yardage');
verifyAdapter(!('outcome' in call), 'the play call must not contain its realized outcome');

// Deliberately inject an impossible touchdown result and verify the failure
// keeps the complete machine-readable context required by the suite.
let injectedFailure = null;
try {
  assertFootballInvariant(false, {
    failure_class: 'ILLEGAL_STATE', game_id: 'mutation-autonomous-rules',
    seed: 'mutation-seed-1', play_index: 3,
    state_before: { line_of_scrimmage_x: 99, offense_direction: 1 },
    decision: { play_type: 'run', carrier_id: 'RB1' },
    outcome: { terminal: 'touchdown', credited_yards: 8 },
    state_after: { ball_spot_x: 100 },
    violated_assertion: 'a touchdown cannot award yards beyond the goal line',
    source_artifact_hashes: SOURCE_HASHES,
  });
} catch (error) {
  injectedFailure = error;
}
verifyAdapter(injectedFailure?.name === 'FootballInvariantError'
  && injectedFailure.failure?.failure_class === 'ILLEGAL_STATE'
  && injectedFailure.failure?.game_id === 'mutation-autonomous-rules'
  && injectedFailure.failure?.seed === 'mutation-seed-1'
  && injectedFailure.failure?.play_index === 3
  && injectedFailure.failure?.state_before?.line_of_scrimmage_x === 99
  && injectedFailure.failure?.decision?.carrier_id === 'RB1'
  && injectedFailure.failure?.outcome?.credited_yards === 8
  && injectedFailure.failure?.state_after?.ball_spot_x === 100
  && injectedFailure.failure?.source_artifact_hashes?.['play.js'],
  'an injected illegal result must fail with the complete assertion evidence envelope');

console.log('autonomous rules ok: supported endings, in-bounds spots, whistle terminal, no game-level claims');
