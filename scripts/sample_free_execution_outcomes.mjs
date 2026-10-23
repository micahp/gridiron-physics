import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulatePlay } from '../engine/play.js';
import { createDemoScenario } from '../web/prototype-model.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TEAM_IDS = ['NE', 'CHI'];
const KINDS = ['run', 'pass'];
const RUN_FRONT = new Set(['LEDGE', 'LDT', 'RDT', 'REDGE']);
const teams = JSON.parse(readFileSync(`${ROOT}/data/teams/matchup-2026-10-22.json`, 'utf8')).teams;
const playbooks = Object.fromEntries(TEAM_IDS.map((id) => [id,
  JSON.parse(readFileSync(`${ROOT}/data/playbooks/${id}-2025.json`, 'utf8'))]));

function quantile(values, probability) {
  const ordered = [...values].sort((a, b) => a - b);
  const index = (ordered.length - 1) * probability;
  const lower = Math.floor(index), upper = Math.ceil(index);
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower);
}

function gainSummary(values) {
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: quantile(values, 0.5),
    p10: quantile(values, 0.1),
    p90: quantile(values, 0.9),
  };
}

function blockActiveAt(events, defenderId, time) {
  let engaged = false;
  for (const event of events) {
    if (event.t > time) break;
    if (event.defender_id !== defenderId) continue;
    if (event.type === 'run_block_engage') engaged = true;
    if (event.type === 'run_block_release') engaged = false;
  }
  return engaged;
}

function earlyUnblockedFrontCrossings(result, play) {
  let count = 0;
  const front = result.roster.map((player, index) => ({ ...player, index }))
    .filter((player) => player.team === play.def && RUN_FRONT.has(player.slot));
  for (const defender of front) {
    let crossed = false;
    for (let frameIndex = 0; frameIndex < result.frames.length; frameIndex++) {
      const time = result.t0 + frameIndex / result.hz;
      if (time < 0 || time > 0.6) continue;
      const frame = result.frames[frameIndex];
      const downfield = (frame[defender.index * 6] - play.los) * play.dir;
      if (downfield < 0 && !blockActiveAt(result.events, defender.id, time)) {
        crossed = true;
        break;
      }
    }
    if (crossed) count++;
  }
  return count;
}

function passOutcome(result) {
  const types = new Set(result.events.map((event) => event.type));
  if (types.has('catch')) return 'catch';
  if (types.has('interception')) return 'interception';
  if (result.end.reason === 'sack') return 'sack';
  if (types.has('pass_breakup')) return 'breakup';
  if (types.has('drop')) return 'drop';
  return 'other_incomplete';
}

export function buildSample({ n = 200 } = {}) {
  assert.ok(Number.isInteger(n) && n >= 200, 'sample size must be an integer of at least 200');
  const cells = {};
  for (const teamId of TEAM_IDS) {
    const defenseId = teamId === 'NE' ? 'CHI' : 'NE';
    cells[teamId] = {};
    for (const kind of KINDS) {
      const candidates = playbooks[teamId].offense.play_candidates[kind].candidates;
      assert.ok(candidates.length, `no ${kind} candidates for ${teamId}`);
      const formation = candidates[0].attributes.formation;
      const gains = [];
      const earlyTackles = [];
      let earlyFrontCrossings = 0;
      const passOutcomes = Object.fromEntries([
        'catch', 'drop', 'breakup', 'other_incomplete', 'sack', 'interception',
      ].map((name) => [name, 0]));

      for (let i = 0; i < n; i++) {
        const seed = `dist-${kind}-${i}`;
        const scenario = createDemoScenario({
          offenseId: teamId, defenseId, teams, playbooks, kind, formation, seed, los: 45, dir: 1,
        });
        assert.equal(scenario.play.outcome_mode, 'free');
        for (const key of ['gain', 'end', 'endX', 'tacklers', 'defender', 'interceptor', 'catchX', 'td', 'scoring']) {
          assert.ok(!(key in scenario.play), `free scenario contains outcome constraint ${key}`);
        }
        const result = simulatePlay({ players: scenario.players }, scenario.play);
        assert.ok(result && result.end.reason !== 'timeout_sim', `${teamId} ${kind} ${seed} failed execution`);

        if (kind === 'run') {
          gains.push((result.end.x - scenario.play.los) * scenario.play.dir);
          const handoff = result.events.find((event) => event.type === 'handoff');
          const wrap = result.events.find((event) => event.type === 'wrapped');
          if (handoff && wrap && wrap.t - handoff.t <= 0.9) earlyTackles.push(wrap.t - handoff.t);
          const assigned = new Set(result.events
            .filter((event) => event.type === 'run_block_assignment')
            .map((event) => event.defender_id));
          for (const defender of result.roster.filter((player) => player.team === defenseId && RUN_FRONT.has(player.slot))) {
            assert.ok(assigned.has(defender.id), `${teamId} run left ${defender.slot} without an assigned blocker (${seed})`);
          }
          earlyFrontCrossings += earlyUnblockedFrontCrossings(result, scenario.play);
        } else {
          const outcome = passOutcome(result);
          passOutcomes[outcome]++;
          const gain = outcome === 'catch' || outcome === 'sack'
            ? (result.end.x - scenario.play.los) * scenario.play.dir : 0;
          gains.push(gain);
        }
      }

      const cell = { n, gain_yards: gainSummary(gains) };
      if (kind === 'run') {
        const nonpositive = gains.filter((gain) => gain <= 0).length;
        cell.run = {
          nonpositive_gain_count: nonpositive,
          share_gaining_zero_or_less: nonpositive / n,
          tackle_within_0_9s_after_handoff: {
            count: earlyTackles.length, denominator: n, share: earlyTackles.length / n,
          },
          unblocked_front_crossings_by_0_6s: {
            count: earlyFrontCrossings, denominator: n * RUN_FRONT.size,
          },
        };
      } else {
        cell.pass = {
          completion_rate: passOutcomes.catch / n,
          outcomes: passOutcomes,
        };
      }
      cells[teamId][kind] = cell;
    }
  }

  return {
    schema_version: 'gridiron-free-execution-outcome-sample.v1',
    status: 'unvalidated_smoke_distribution_not_calibration_or_prediction',
    sample_size_per_cell: n,
    seed_scheme: 'dist-{run|pass}-{i}, i=0..n-1; the same seeds are used for both teams',
    setup: {
      line_of_scrimmage_yards: 45,
      field_direction: 1,
      offense_defense: { NE: 'NE offense vs CHI defense', CHI: 'CHI offense vs NE defense' },
      formation: 'first candidate formation for that offense and action',
      selection: 'createDemoScenario without candidateId; seeded weighted draw from observed_2025 entries in that formation',
      outcome_mode: 'free; no historical gain, end spot, tackler, receiver result, or catch-point anchors',
      roster_snapshot: 'data/teams/matchup-2026-10-22.json (frozen pregame snapshot)',
    },
    gain_definition: {
      run: 'final play spot minus line of scrimmage, in offense direction',
      pass: 'completed catch spot or sack spot minus line of scrimmage; incomplete passes and interceptions contribute 0 yards',
      quantiles: 'linear interpolation at type-7 positions: (n-1)*p',
    },
    criteria: {
      run_median_min_yards: 0,
      run_share_gaining_zero_or_less_max: 0.5,
      run_tackle_within_0_9s_after_handoff_max_share: 0.4,
      unblocked_front_crossings_at_or_before_0_6s_max: 0,
      pass_completion_rate_target: [0.4, 0.55],
      pass_completion_target_rationale: 'A simplified one-target synthetic route/coverage path should avoid the prior ~24% completion rate; 40–55% is a smoke target, not an NFL-rate calibration.',
    },
    cells,
  };
}

export function assertSample(sample) {
  assert.equal(sample.status, 'unvalidated_smoke_distribution_not_calibration_or_prediction');
  assert.ok(sample.sample_size_per_cell >= 200);
  for (const teamId of TEAM_IDS) {
    const run = sample.cells[teamId].run;
    assert.ok(run.gain_yards.median >= sample.criteria.run_median_min_yards,
      `${teamId} free-run median is deeply negative: ${run.gain_yards.median}`);
    assert.ok(run.run.share_gaining_zero_or_less <= sample.criteria.run_share_gaining_zero_or_less_max,
      `${teamId} free-run nonpositive share is too high: ${run.run.share_gaining_zero_or_less}`);
    assert.ok(run.run.tackle_within_0_9s_after_handoff.share <= sample.criteria.run_tackle_within_0_9s_after_handoff_max_share,
      `${teamId} free-run early tackle share is too high: ${run.run.tackle_within_0_9s_after_handoff.share}`);
    assert.equal(run.run.unblocked_front_crossings_by_0_6s.count,
      sample.criteria.unblocked_front_crossings_at_or_before_0_6s_max,
      `${teamId} front defender crossed unblocked within 0.6 seconds`);
    const pass = sample.cells[teamId].pass;
    const [minCompletion, maxCompletion] = sample.criteria.pass_completion_rate_target;
    assert.ok(pass.pass.completion_rate >= minCompletion && pass.pass.completion_rate <= maxCompletion,
      `${teamId} pass completion rate outside smoke target: ${pass.pass.completion_rate}`);
    assert.equal(Object.values(pass.pass.outcomes).reduce((sum, count) => sum + count, 0), pass.n);
  }
  return true;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const sample = buildSample();
  assertSample(sample);
  const output = `${ROOT}/results/free_execution_outcome_sample.json`;
  writeFileSync(output, `${JSON.stringify(sample, null, 2)}\n`);
  console.log(`wrote ${output}`);
}
