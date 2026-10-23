import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulatePlay } from '../engine/play.js';
import { YD } from '../engine/constants.js';
import { createDemoScenario } from '../web/prototype-model.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TEAM_IDS = ['NE', 'CHI'];
const SAMPLE_SIZE = 200;
const PRESSURE_RADIUS_M = 2;
const RUN_CLOSE_RADIUS_M = 3;
const DEFENSIVE_FRONT = new Set(['LEDGE', 'LDT', 'RDT', 'REDGE']);
const ATTEMPT_EVENT_TYPES = new Set(['wrapped', 'broken_tackle']);
const TERMINAL_PASS_OUTCOMES = [
  'catch', 'drop', 'breakup', 'other_incomplete', 'sack', 'interception',
];

function loadFreshInputs() {
  // simulatePlay/Player may mutate nested rating and physics objects. Reload all
  // JSON inputs for every snap so no trial can contaminate a later seed.
  const teams = JSON.parse(readFileSync(`${ROOT}/data/teams/matchup-2026-10-22.json`, 'utf8')).teams;
  const playbooks = Object.fromEntries(TEAM_IDS.map((id) => [id,
    JSON.parse(readFileSync(`${ROOT}/data/playbooks/${id}-2025.json`, 'utf8'))]));
  return { teams, playbooks };
}

function quantile(values, probability) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = (ordered.length - 1) * probability;
  const lower = Math.floor(index), upper = Math.ceil(index);
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower);
}

function distribution(values) {
  return {
    n: values.length,
    p10: quantile(values, 0.1),
    median: quantile(values, 0.5),
    p90: quantile(values, 0.9),
  };
}

function scenarioFor(offenseId, kind, index) {
  const defenseId = offenseId === 'NE' ? 'CHI' : 'NE';
  const { teams, playbooks } = loadFreshInputs();
  const candidates = playbooks[offenseId].offense.play_candidates[kind].candidates;
  assert.ok(candidates.length, `${offenseId} has no ${kind} candidates`);
  const formation = candidates[0].attributes.formation;
  const seed = `${kind === 'pass' ? 'pressure' : 'tail-run'}-${index}`;
  const scenario = createDemoScenario({
    offenseId, defenseId, teams, playbooks, kind, formation, seed, los: 45, dir: 1,
  });
  assert.equal(scenario.play.outcome_mode, 'free');
  for (const key of ['gain', 'end', 'endX', 'tacklers', 'defender', 'interceptor', 'catchX', 'td', 'scoring']) {
    assert.ok(!(key in scenario.play), `free scenario contains outcome constraint ${key}`);
  }
  return { scenario, offenseId, defenseId, formation, seed };
}

function execute({ scenario, offenseId, defenseId, formation, seed, kind }) {
  const result = simulatePlay({ players: scenario.players }, scenario.play);
  assert.ok(result && result.end.reason !== 'timeout_sim', `${offenseId} ${kind} ${seed} failed execution`);
  assert.equal(result.roster.length, 22, 'probe play must have 22 participants');
  return { result, offenseId, defenseId, formation, seed, kind, scenario };
}

function frameTime(result, index) {
  return result.t0 + index / result.hz;
}

function fieldPosition(result, frameIndex, rosterIndex) {
  const frame = result.frames[frameIndex];
  const offset = rosterIndex * 6;
  return { x: frame[offset], y: frame[offset + 1] };
}

function distanceMeters(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) * YD;
}

function liveFrameSamples(result, startTime, endTime) {
  const samples = [];
  for (let index = 0; index < result.frames.length; index++) {
    const time = frameTime(result, index);
    if (time + 1e-9 < startTime || time - 1e-9 > endTime) continue;
    samples.push({ index, time });
  }
  return samples;
}

function passOutcome(result) {
  const types = new Set(result.events.map((event) => event.type));
  if (types.has('catch')) return 'catch';
  if (types.has('interception')) return 'interception';
  if (result.end.reason === 'sack' || types.has('sack')) return 'sack';
  if (types.has('pass_breakup')) return 'breakup';
  if (types.has('drop')) return 'drop';
  return 'other_incomplete';
}

function passLiveEndTime(result) {
  const snapEnd = result.events
    .filter((event) => event.type === 'throw' || event.type === 'sack')
    .map((event) => event.t)
    .filter(Number.isFinite);
  if (Number.isFinite(result.end.t)) snapEnd.push(result.end.t);
  if (!snapEnd.length) return frameTime(result, result.frames.length - 1);
  return Math.max(0, Math.min(...snapEnd));
}

function analyzePressure({ result, offenseId, defenseId, formation, seed, scenario }) {
  const qbId = scenario.play.lineup[offenseId].QB;
  const qbIndex = result.roster.findIndex((player) => player.id === qbId && player.slot === 'QB');
  assert.ok(qbIndex >= 0, `missing QB body for ${seed}`);
  const defenderIndexes = result.roster
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => player.team === defenseId);
  const rushSlots = new Set(DEFENSIVE_FRONT);
  const distanceToGoal = scenario.play.dir > 0 ? 100 - scenario.play.los : scenario.play.los;
  const heavy = /Run formation|Jumbo/.test(scenario.play.text) || distanceToGoal <= 3;
  if (heavy) rushSlots.add('NB');
  const frontIds = new Set(defenderIndexes
    .filter(({ player }) => rushSlots.has(player.slot))
    .map(({ player }) => player.id));
  const liveEndTime = passLiveEndTime(result);
  const frames = liveFrameSamples(result, 0, liveEndTime);
  let minimum = null;
  let firstPressure = null;
  for (const sample of frames) {
    const qb = fieldPosition(result, sample.index, qbIndex);
    for (const { player, index } of defenderIndexes) {
      const distance = distanceMeters(qb, fieldPosition(result, sample.index, index));
      if (!minimum || distance < minimum.distance_m) {
        minimum = { distance_m: distance, time_seconds_after_snap: sample.time, defender_id: player.id, defender_slot: player.slot };
      }
      if (distance <= PRESSURE_RADIUS_M && (!firstPressure
        || sample.time < firstPressure.time_seconds_after_snap
        || (sample.time === firstPressure.time_seconds_after_snap && distance < firstPressure.distance_m))) {
        firstPressure = { time_seconds_after_snap: sample.time, defender_id: player.id, defender_slot: player.slot, distance_m: distance };
      }
    }
  }

  const pressureCutoff = firstPressure?.time_seconds_after_snap ?? liveEndTime;
  const sheds = result.events.filter((event) => event.type === 'shed'
    && frontIds.has(event.by)
    && event.t >= 0
    && event.t < pressureCutoff - 1e-9);
  const outcome = passOutcome(result);
  return {
    seed,
    offense_team_id: offenseId,
    defense_team_id: defenseId,
    formation,
    selected_candidate_id: scenario.selection.playbook_entry.candidate_id,
    qb_id: qbId,
    terminal_outcome: outcome,
    terminal_reason: result.end.reason,
    live_window_end_seconds_after_snap: liveEndTime,
    minimum_defender_to_qb_distance_m: minimum?.distance_m ?? null,
    minimum_distance_time_seconds_after_snap: minimum?.time_seconds_after_snap ?? null,
    closest_defender_at_minimum: minimum ? { id: minimum.defender_id, slot: minimum.defender_slot } : null,
    pressured_within_2m: firstPressure !== null,
    time_to_first_defender_within_2m_seconds: firstPressure?.time_seconds_after_snap ?? null,
    first_defender_within_2m: firstPressure ? { id: firstPressure.defender_id, slot: firstPressure.defender_slot, distance_m: firstPressure.distance_m } : null,
    rusher_shed_block_before_pressure: firstPressure ? sheds.length > 0 : null,
    rusher_shed_during_unpressured_live_window: firstPressure ? null : sheds.length > 0,
    rusher_shed_events_before_pressure: sheds.map(({ t, by, from }) => ({ time_seconds_after_snap: t, rusher_id: by, blocker_id: from })),
    explicit_pressure_events: result.events.filter((event) => event.type === 'pressure').length,
    sack_events: result.events.filter((event) => event.type === 'sack').length,
  };
}

function summarizePressure(records) {
  const outcomes = Object.fromEntries(TERMINAL_PASS_OUTCOMES.map((name) => [name, {
    pressured: { count: 0, denominator: 0, rate: 0 },
    unpressured: { count: 0, denominator: 0, rate: 0 },
  }]));
  for (const record of records) {
    const bucket = outcomes[record.terminal_outcome][record.pressured_within_2m ? 'pressured' : 'unpressured'];
    bucket.count++;
  }
  for (const row of Object.values(outcomes)) {
    for (const key of ['pressured', 'unpressured']) {
      row[key].denominator = records.filter((record) => record.pressured_within_2m === (key === 'pressured')).length;
      row[key].rate = row[key].denominator ? row[key].count / row[key].denominator : null;
    }
  }
  const times = records.map((record) => record.time_to_first_defender_within_2m_seconds).filter(Number.isFinite);
  return {
    n: records.length,
    terminal_outcome_counts: Object.fromEntries(TERMINAL_PASS_OUTCOMES.map((name) => [name,
      records.filter((record) => record.terminal_outcome === name).length])),
    pressured_count: records.filter((record) => record.pressured_within_2m).length,
    unpressured_count: records.filter((record) => !record.pressured_within_2m).length,
    joint_terminal_outcome_by_pressure: outcomes,
    time_to_pressure_seconds_among_pressured: distribution(times),
    right_censored_no_pressure_count: records.length - times.length,
    minimum_defender_to_qb_distance_m: distribution(records.map((record) => record.minimum_defender_to_qb_distance_m).filter(Number.isFinite)),
    pressured_dropbacks_with_rusher_shed_before_pressure: records.filter((record) => record.rusher_shed_block_before_pressure === true).length,
    unpressured_dropbacks_with_rusher_shed_before_live_window_end: records.filter((record) => record.rusher_shed_during_unpressured_live_window === true).length,
    explicit_pressure_event_count: records.reduce((sum, record) => sum + record.explicit_pressure_events, 0),
    sack_event_count: records.reduce((sum, record) => sum + record.sack_events, 0),
    records,
  };
}

function runLiveEndTime(result, handoffTime) {
  const endTime = Number.isFinite(result.end.t) ? result.end.t : frameTime(result, result.frames.length - 1);
  return Math.max(handoffTime, endTime);
}

function analyzeLongRun({ result, offenseId, defenseId, formation, seed, scenario }) {
  const carrierId = scenario.play.carrier;
  const carrierIndex = result.roster.findIndex((player) => player.id === carrierId);
  assert.ok(carrierIndex >= 0, `missing run carrier body for ${seed}`);
  const defenderIndexes = result.roster
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => player.team === defenseId);
  const handoff = result.events.find((event) => event.type === 'handoff' && event.to === carrierId);
  const handoffTime = handoff?.t ?? 0;
  const liveEndTime = runLiveEndTime(result, handoffTime);
  const frames = liveFrameSamples(result, handoffTime, liveEndTime);
  let minDistance = null, firstClose = null;
  for (const sample of frames) {
    const carrier = fieldPosition(result, sample.index, carrierIndex);
    for (const { player, index } of defenderIndexes) {
      const distance = distanceMeters(carrier, fieldPosition(result, sample.index, index));
      if (minDistance === null || distance < minDistance.distance_m) {
        minDistance = { distance_m: distance, time_seconds: sample.time, defender_id: player.id, defender_slot: player.slot };
      }
      if (distance <= RUN_CLOSE_RADIUS_M && firstClose === null) {
        firstClose = { time_seconds: sample.time, defender_id: player.id, defender_slot: player.slot, distance_m: distance };
      }
    }
  }

  const attempts = result.events.filter((event) => ATTEMPT_EVENT_TYPES.has(event.type)
    && event.t >= handoffTime - 1e-9 && event.t <= liveEndTime + 1e-9)
    .sort((a, b) => a.t - b.t);
  const segments = [];
  let segmentStart = handoffTime;
  for (const event of attempts) {
    segments.push({ start_seconds: segmentStart, end_seconds: event.t, end_event: event.type });
    segmentStart = event.t;
  }
  segments.push({ start_seconds: segmentStart, end_seconds: liveEndTime, end_event: 'terminal' });
  const longest = segments.reduce((best, item) =>
    item.end_seconds - item.start_seconds > best.end_seconds - best.start_seconds ? item : best, segments[0]);
  const sampleAtEnd = [...frames].reverse().find((sample) => sample.time <= longest.end_seconds + 1e-9) || frames[0] || null;
  const nearbyDefenders = [];
  if (sampleAtEnd) {
    const carrier = fieldPosition(result, sampleAtEnd.index, carrierIndex);
    for (const { player, index } of defenderIndexes) {
      const distance = distanceMeters(carrier, fieldPosition(result, sampleAtEnd.index, index));
      if (distance <= RUN_CLOSE_RADIUS_M) nearbyDefenders.push({ id: player.id, slot: player.slot, distance_m: distance });
    }
  }
  const wraps = result.events.filter((event) => event.type === 'wrapped' && event.on === carrierId && event.t >= handoffTime)
    .sort((a, b) => a.t - b.t);
  const brokenTackles = result.events.filter((event) => event.type === 'broken_tackle' && event.by === carrierId && event.t >= handoffTime);
  const attemptsGenerated = attempts.length > 0;
  let explanation;
  if (brokenTackles.length) explanation = 'broken_tackle_event';
  else if (attemptsGenerated) explanation = 'wrapped_without_broken_tackle';
  else if (minDistance === null || minDistance.distance_m > RUN_CLOSE_RADIUS_M) explanation = 'no_defender_ever_within_3m';
  else explanation = 'defender_within_3m_but_no_tackle_attempt_event';

  const gainYards = (result.end.x - scenario.play.los) * scenario.play.dir;
  return {
    seed,
    offense_team_id: offenseId,
    defense_team_id: defenseId,
    formation,
    selected_candidate_id: scenario.selection.playbook_entry.candidate_id,
    carrier_id: carrierId,
    gain_yards: gainYards,
    terminal_reason: result.end.reason,
    handoff_time_seconds: handoff?.t ?? null,
    tackle_attempt_generated: attemptsGenerated,
    tackle_attempt_event_count: attempts.length,
    broken_tackle_event_count: brokenTackles.length,
    long_run_classification: explanation,
    minimum_defender_distance_m: minDistance?.distance_m ?? null,
    time_first_defender_within_3m_seconds: firstClose?.time_seconds ?? null,
    longest_uninterrupted_stretch: {
      duration_seconds: Math.max(0, longest.end_seconds - longest.start_seconds),
      start_seconds: longest.start_seconds,
      end_seconds: longest.end_seconds,
      end_event: longest.end_event,
      sampled_frame_time_seconds: sampleAtEnd?.time ?? null,
      defenders_within_3m_count: nearbyDefenders.length,
      defenders_within_3m: nearbyDefenders,
    },
    final_wrap_time_from_handoff_seconds: wraps.length && handoff ? wraps.at(-1).t - handoff.t : null,
    final_wrap_time_seconds_after_snap: wraps.at(-1)?.t ?? null,
  };
}

function summarizeLongRuns(records) {
  const classifications = [
    'broken_tackle_event',
    'wrapped_without_broken_tackle',
    'no_defender_ever_within_3m',
    'defender_within_3m_but_no_tackle_attempt_event',
  ];
  return {
    n: records.length,
    gain_threshold_yards: 10,
    long_run_count: records.length,
    tackle_attempt_generated_count: records.filter((record) => record.tackle_attempt_generated).length,
    classification_counts: Object.fromEntries(classifications.map((name) => [name,
      records.filter((record) => record.long_run_classification === name).length])),
    total_broken_tackle_events: records.reduce((sum, record) => sum + record.broken_tackle_event_count, 0),
    longest_uninterrupted_stretch_seconds: distribution(records.map((record) => record.longest_uninterrupted_stretch.duration_seconds)),
    defenders_within_3m_at_longest_stretch_end: distribution(records.map((record) => record.longest_uninterrupted_stretch.defenders_within_3m_count)),
    handoff_to_final_wrap_seconds: distribution(records.map((record) => record.final_wrap_time_from_handoff_seconds).filter(Number.isFinite)),
    no_final_wrap_count: records.filter((record) => record.final_wrap_time_from_handoff_seconds === null).length,
    records,
  };
}

function exactZeroEventUpperBound(n, confidence = 0.95) {
  return 1 - (1 - confidence) ** (1 / n);
}

function trialsToPutUpperBoundBelow(rate, confidence = 0.95) {
  let n = 1;
  while (exactZeroEventUpperBound(n, confidence) >= rate) n++;
  return n;
}

export function buildPressureAndRunTailProbe({ n = SAMPLE_SIZE } = {}) {
  assert.equal(n, SAMPLE_SIZE, 'this probe is pinned to the requested n=200 per team/action cell');
  const pressureCells = {};
  const runTailCells = {};
  for (const offenseId of TEAM_IDS) {
    const passRecords = [];
    const runTailRecords = [];
    for (let i = 0; i < n; i++) {
      const passInput = scenarioFor(offenseId, 'pass', i);
      passRecords.push(analyzePressure(execute({ ...passInput, kind: 'pass' })));
      const runInput = scenarioFor(offenseId, 'run', i);
      const run = execute({ ...runInput, kind: 'run' });
      const gainYards = (run.result.end.x - run.scenario.play.los) * run.scenario.play.dir;
      if (gainYards >= 10) runTailRecords.push(analyzeLongRun(run));
    }
    pressureCells[offenseId] = summarizePressure(passRecords);
    runTailCells[offenseId] = summarizeLongRuns(runTailRecords);
  }

  return {
    schema_version: 'gridiron-free-execution-pressure-run-tail-probe.v1',
    status: 'unvalidated_smoke_diagnostic_not_calibration_or_prediction',
    sample_size_per_team_action_cell: n,
    seed_scheme: 'pressure-{i} for passes and tail-run-{i} for runs; i=0..199; same indices across NE and CHI',
    setup: {
      offense_defense: { NE: 'NE offense vs CHI defense', CHI: 'CHI offense vs NE defense' },
      formation: 'first candidate formation for that offense and action, matching the existing sampler',
      play_selection: 'createDemoScenario without candidateId; seeded weighted draw within the first formation',
      fresh_inputs: 'team roster snapshot and both team playbook JSON files are reparsed from disk for each snap to prevent nested rating/physics mutation leaking across trials',
      outcome_mode: 'free; no historical gain, end spot, tackler, receiver result, or catch-point anchors',
      roster_snapshot: 'data/teams/matchup-2026-10-22.json (frozen pregame snapshot)',
    },
    pressure_method: {
      pressured_definition: 'at least one defender within 2.0 m horizontally of the QB in a recorded live frame from snap to first throw, sack event, or whistle, whichever occurs first',
      distance_unit_basis: 'recorded x/y field coordinates in yards converted to meters with YD=0.9144; body height is excluded because the simulator uses planar player pursuit/contact geometry',
      min_distance: 'minimum defender-to-QB horizontal distance over the same live-frame window',
      time_to_pressure: 'first recorded frame at or within 2.0 m, seconds after snap; unpressured plays are right-censored and excluded from quantiles',
      shed_definition: 'a recorded shed event by a configured pass-rush slot (LEDGE/LDT/RDT/REDGE; add NB only when setupPass uses its heavy-set rule) strictly before the first 2 m frame; if no 2 m frame occurs, before the live-window endpoint',
      outcome_categories: TERMINAL_PASS_OUTCOMES,
    },
    sack_inference: {
      free_pass_sack_branch_reachable: true,
      basis: 'engine/play.js free-pass World.onTouch path can emit sack on QB contact before throw; the existing committed 200-seed outcome sample also contains 5 CHI sacks, so the branch is observed reachable',
      ne_zero_sacks_one_sided_95_percent_exact_upper_rate: exactZeroEventUpperBound(n),
      zero_sacks_trials_required_for_one_sided_95_percent_upper_below_3_percent: trialsToPutUpperBoundBelow(0.03),
      confidence_method: 'exact zero-success binomial upper bound: 1 - (1 - confidence)^(1/n)',
    },
    run_tail_method: {
      long_run_threshold_yards: 10,
      tackle_attempt_definition: 'a wrapped or broken_tackle event for the run carrier; these are emitted after the engine passes its close/alignment/closing-contact checks',
      longest_uninterrupted_stretch: 'longest elapsed-time interval from handoff to a tackle-attempt event, between attempt events, or from the last attempt to terminal play time; defender proximity is sampled at the interval endpoint using the latest recorded frame at or before it',
      nearby_defender_definition: 'any defensive player within 3.0 m horizontally of the runner at that sampled frame',
      no_defender_ever_within_3m: 'no recorded live frame from handoff through terminal play time has a defender within 3.0 m',
      final_wrap_time: 'last wrapped event time minus handoff event time; null when no wrap occurs',
    },
    cells: { pressure: pressureCells, run_tail: runTailCells },
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const artifact = buildPressureAndRunTailProbe();
  const output = `${ROOT}/results/pressure_run_tail_probe.json`;
  writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({
    output,
    pressure: Object.fromEntries(TEAM_IDS.map((id) => [id, {
      pressured: artifact.cells.pressure[id].pressured_count,
      sacks: artifact.cells.pressure[id].sack_event_count,
      outcomes: artifact.cells.pressure[id].terminal_outcome_counts,
    }])),
    longRuns: Object.fromEntries(TEAM_IDS.map((id) => [id, {
      count: artifact.cells.run_tail[id].long_run_count,
      classifications: artifact.cells.run_tail[id].classification_counts,
    }])),
  }, null, 2));
}
