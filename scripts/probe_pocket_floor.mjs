import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulatePlay } from '../engine/play.js';
import { World } from '../engine/world.js';
import { DT, REC_HZ, YD } from '../engine/constants.js';
import { createDemoScenario } from '../web/prototype-model.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TEAM_IDS = ['NE', 'CHI'];
const SAMPLE_SIZE = 200;
const FRONT_SLOTS = new Set(['LEDGE', 'LDT', 'RDT', 'REDGE']);
const SHED_DISTANCE_M = 0.3;
let activeCapture = null;

function quantile(values, probability) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = (ordered.length - 1) * probability;
  const lower = Math.floor(index), upper = Math.ceil(index);
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower);
}

function distribution(values) {
  const finite = values.filter(Number.isFinite);
  return {
    n: finite.length,
    min: finite.length ? Math.min(...finite) : null,
    p10: quantile(finite, 0.1),
    median: quantile(finite, 0.5),
    p90: quantile(finite, 0.9),
  };
}

function loadFreshInputs() {
  const teams = JSON.parse(readFileSync(`${ROOT}/data/teams/matchup-2026-10-22.json`, 'utf8')).teams;
  const playbooks = Object.fromEntries(TEAM_IDS.map((id) => [id,
    JSON.parse(readFileSync(`${ROOT}/data/playbooks/${id}-2025.json`, 'utf8'))]));
  return { teams, playbooks };
}

function installWorldTelemetry() {
  const originalStep = World.prototype.step;
  const originalEngage = World.prototype.engage;
  const originalDisengage = World.prototype.disengage;
  const originalCollide = World.prototype.collide;

  World.prototype.step = function observedStep(dt, brains) {
    const capture = activeCapture;
    const observeBrain = (player) => {
      if (capture && capture.rusherIds.has(player.id) && player.mode === 'rush' && player.engaged) {
        capture.shedTrials.push({
          time_seconds_after_snap: this.t,
          rusher_id: player.id,
          blocker_id: player.engaged.id,
        });
      }
      return brains(player);
    };
    const result = originalStep.call(this, dt, observeBrain);
    if (capture) {
      const players = {};
      for (const player of this.players) {
        if (!capture.playerIds.has(player.id)) continue;
        players[player.id] = {
          x_m: player.p.x,
          y_m: player.p.y,
          engaged_id: player.engaged?.id ?? null,
          down: player.down,
          slot: player.slot,
          radius_m: player.r,
        };
      }
      capture.steps.push({ time_seconds_after_step: this.t, players });
    }
    return result;
  };

  World.prototype.engage = function observedEngage(blocker, defender) {
    const hadPair = blocker.engaged || defender.engaged;
    const result = originalEngage.call(this, blocker, defender);
    if (activeCapture && !hadPair && blocker.engaged === defender) {
      const rusher = activeCapture.rusherIds.has(blocker.id) ? blocker :
        activeCapture.rusherIds.has(defender.id) ? defender : null;
      const offensiveBlocker = rusher === blocker ? defender : rusher === defender ? blocker : null;
      if (rusher && offensiveBlocker?.team === activeCapture.offenseId) {
        const engagement = this.engagements.at(-1);
        const entry = {
          start_seconds_after_snap: this.t,
          end_seconds_after_snap: null,
          rusher_id: rusher.id,
          blocker_id: offensiveBlocker.id,
          disengaged_by_id: null,
        };
        activeCapture.engagements.set(engagement, entry);
        activeCapture.engagementRecords.push(entry);
      }
    }
    return result;
  };

  World.prototype.disengage = function observedDisengage(engagement, shedder) {
    const entry = activeCapture?.engagements.get(engagement);
    if (entry && entry.end_seconds_after_snap == null) {
      entry.end_seconds_after_snap = this.t;
      entry.disengaged_by_id = shedder?.id ?? null;
    }
    return originalDisengage.call(this, engagement, shedder);
  };

  World.prototype.collide = function observedCollide(...args) {
    const capture = activeCapture;
    const originalOnTouch = this.onTouch;
    if (capture) {
      const qb = this.players.find((player) => player.id === capture.qbId);
      if (qb) {
        for (const rusherId of capture.rusherIds) {
          const rusher = this.players.find((player) => player.id === rusherId);
          if (!rusher) continue;
          const gap = Math.hypot(qb.p.x - rusher.p.x, qb.p.y - rusher.p.y);
          const radii = qb.r + rusher.r;
          if (gap <= radii + SHED_DISTANCE_M) {
            capture.reachOpportunitySteps.push({ time_seconds_after_snap: this.t, rusher_id: rusherId, gap_m: gap });
          }
          if (gap < radii) {
            capture.colliderOverlapSteps.push({ time_seconds_after_snap: this.t, rusher_id: rusherId, gap_m: gap });
          }
        }
      }
    }
    if (capture && originalOnTouch) {
      const world = this;
      this.onTouch = function observedTouch(a, b, contact) {
        const defender = a.id === capture.qbId ? b : b.id === capture.qbId ? a : null;
        if (defender && capture.rusherIds.has(defender.id)) {
          capture.qbRusherContactCallbacks.push({
            time_seconds_after_snap: world.t,
            rusher_id: defender.id,
            distance_m: Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y),
            closing_speed_m_s: contact?.closingSpeed ?? null,
          });
        }
        return originalOnTouch.call(this, a, b, contact);
      };
    }
    try {
      return originalCollide.apply(this, args);
    } finally {
      if (capture && originalOnTouch) this.onTouch = originalOnTouch;
    }
  };

  return () => {
    World.prototype.step = originalStep;
    World.prototype.engage = originalEngage;
    World.prototype.disengage = originalDisengage;
    World.prototype.collide = originalCollide;
    activeCapture = null;
  };
}

function scenarioFor(offenseId, index) {
  const defenseId = offenseId === 'NE' ? 'CHI' : 'NE';
  const { teams, playbooks } = loadFreshInputs();
  const candidates = playbooks[offenseId].offense.play_candidates.pass.candidates;
  assert.ok(candidates.length, `${offenseId} has no pass candidates`);
  const formation = candidates[0].attributes.formation;
  const seed = `pressure-${index}`;
  const scenario = createDemoScenario({
    offenseId, defenseId, teams, playbooks, kind: 'pass', formation, seed, los: 45, dir: 1,
  });
  assert.equal(scenario.play.outcome_mode, 'free');
  for (const key of ['gain', 'end', 'endX', 'tacklers', 'defender', 'interceptor', 'catchX', 'td', 'scoring']) {
    assert.ok(!(key in scenario.play), `free pocket-floor scenario contains outcome anchor ${key}`);
  }
  return { scenario, offenseId, defenseId, formation, seed };
}

function frameTime(result, index) {
  return result.t0 + index / result.hz;
}

function positionAt(result, frameIndex, rosterIndex) {
  const offset = rosterIndex * 6;
  const frame = result.frames[frameIndex];
  return { x_m: frame[offset] * YD, y_m: frame[offset + 1] * YD };
}

function distanceMeters(a, b) {
  return Math.hypot(a.x_m - b.x_m, a.y_m - b.y_m);
}

function liveFrameSamples(result, endTime) {
  const samples = [];
  for (let index = 0; index < result.frames.length; index++) {
    const time = frameTime(result, index);
    if (time >= -1e-9 && time <= endTime + 1e-9) samples.push({ index, time: Math.max(0, time) });
  }
  return samples;
}

function passLiveEndTime(result) {
  const ends = result.events
    .filter((event) => event.type === 'throw' || event.type === 'sack')
    .map((event) => event.t)
    .filter(Number.isFinite);
  if (Number.isFinite(result.end.t)) ends.push(result.end.t);
  return ends.length ? Math.max(0, Math.min(...ends)) : frameTime(result, result.frames.length - 1);
}

function nearestStep(capture, recordedFrameTime) {
  const wanted = recordedFrameTime;
  let low = 0, high = capture.steps.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (capture.steps[mid].time_seconds_after_step < wanted) low = mid + 1;
    else high = mid;
  }
  const candidates = [capture.steps[low], capture.steps[Math.max(0, low - 1)]].filter(Boolean);
  return candidates.reduce((best, step) =>
    Math.abs(step.time_seconds_after_step - wanted) < Math.abs(best.time_seconds_after_step - wanted) ? step : best);
}

function angleDegrees(origin, pointA, pointB) {
  const ax = pointA.x_m - origin.x_m, ay = pointA.y_m - origin.y_m;
  const bx = pointB.x_m - origin.x_m, by = pointB.y_m - origin.y_m;
  const denom = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (!denom) return null;
  const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / denom));
  return Math.acos(cosine) * 180 / Math.PI;
}

function makeCapture({ scenario, offenseId, defenseId, seed }) {
  const offenseLineup = scenario.play.lineup[offenseId];
  const defenseLineup = scenario.play.lineup[defenseId];
  const distanceToGoal = scenario.play.dir > 0 ? 100 - scenario.play.los : scenario.play.los;
  const heavy = /Run formation|Jumbo/.test(scenario.play.text) || distanceToGoal <= 3;
  const rusherSlots = new Set(FRONT_SLOTS);
  if (heavy) rusherSlots.add('NB');
  const rushers = Object.entries(defenseLineup)
    .filter(([slot, id]) => rusherSlots.has(slot) && id)
    .map(([slot, id]) => ({ id, slot }));
  const qbId = offenseLineup.QB;
  const allIds = new Set([...Object.values(offenseLineup), ...Object.values(defenseLineup)].filter(Boolean));
  return {
    offenseId,
    defenseId,
    seed,
    qbId,
    heavy,
    rushers,
    rusherIds: new Set(rushers.map(({ id }) => id)),
    playerIds: allIds,
    steps: [],
    engagements: new Map(),
    engagementRecords: [],
    shedTrials: [],
    qbRusherContactCallbacks: [],
    reachOpportunitySteps: [],
    colliderOverlapSteps: [],
  };
}

function execute(input) {
  const { scenario, offenseId, defenseId, formation, seed } = input;
  const capture = makeCapture(input);
  activeCapture = capture;
  let result;
  try {
    result = simulatePlay({ players: scenario.players }, scenario.play);
  } finally {
    activeCapture = null;
  }
  assert.ok(result && result.end.reason !== 'timeout_sim', `${offenseId} ${seed} failed execution`);
  assert.equal(result.roster.length, 22);
  return { result, capture, scenario, offenseId, defenseId, formation, seed };
}

function analyzeDropback({ result, capture, scenario, offenseId, defenseId, formation, seed }) {
  const liveEndTime = passLiveEndTime(result);
  const samples = liveFrameSamples(result, liveEndTime);
  const rosterById = new Map(result.roster.map((player, index) => [player.id, { ...player, index }]));
  const qbIndex = rosterById.get(capture.qbId)?.index;
  assert.ok(Number.isInteger(qbIndex), `missing QB in ${seed}`);
  const front = capture.rushers.map((rusher) => ({
    ...rusher,
    index: rosterById.get(rusher.id)?.index,
    profile: scenario.players[rusher.id],
  })).filter((rusher) => Number.isInteger(rusher.index));
  assert.ok(front.length >= 4, `expected at least four front rushers in ${seed}`);

  const rusherGaps = new Map(front.map((rusher) => [rusher.id, []]));
  let closestRusher = null;
  let closestAnyDefender = null;
  const samplesByRusher = new Map(front.map((rusher) => [rusher.id, []]));
  for (const sample of samples) {
    const qb = positionAt(result, sample.index, qbIndex);
    for (const rusher of front) {
      const gap = distanceMeters(qb, positionAt(result, sample.index, rusher.index));
      rusherGaps.get(rusher.id).push(gap);
      samplesByRusher.get(rusher.id).push(sample);
      if (!closestRusher || gap < closestRusher.gap_m) {
        closestRusher = { rusher, gap_m: gap, frame_index: sample.index, elapsed_seconds: sample.time };
      }
    }
    for (const { id, index } of result.roster
      .map((player, index) => ({ ...player, index }))
      .filter((player) => player.team === defenseId)) {
      const gap = distanceMeters(qb, positionAt(result, sample.index, index));
      if (!closestAnyDefender || gap < closestAnyDefender.gap_m) {
        closestAnyDefender = { id, slot: result.roster[index].slot, gap_m: gap, frame_index: sample.index, elapsed_seconds: sample.time };
      }
    }
  }
  assert.ok(closestRusher && samples.length, `no live rusher samples for ${seed}`);

  const closestSnapshot = nearestStep(capture, frameTime(result, closestRusher.frame_index));
  const rusherState = closestSnapshot.players[closestRusher.rusher.id];
  const blockerId = rusherState?.engaged_id ?? null;
  const blockerState = blockerId ? closestSnapshot.players[blockerId] : null;
  const qbState = closestSnapshot.players[capture.qbId];
  const triangle = blockerState && rusherState && qbState ? {
    rusher_to_blocker_gap_m: Math.hypot(rusherState.x_m - blockerState.x_m, rusherState.y_m - blockerState.y_m),
    blocker_to_qb_gap_m: Math.hypot(blockerState.x_m - qbState.x_m, blockerState.y_m - qbState.y_m),
    rusher_to_qb_gap_m: Math.hypot(rusherState.x_m - qbState.x_m, rusherState.y_m - qbState.y_m),
    angle_at_rusher_degrees: angleDegrees(rusherState, blockerState, qbState),
  } : null;
  const anyDefenderSnapshot = nearestStep(capture, frameTime(result, closestAnyDefender.frame_index));
  const anyDefenderState = anyDefenderSnapshot.players[closestAnyDefender.id];
  const anyBlockerId = anyDefenderState?.engaged_id ?? null;
  const anyBlockerState = anyBlockerId ? anyDefenderSnapshot.players[anyBlockerId] : null;
  closestAnyDefender = {
    ...closestAnyDefender,
    engaged_at_frame: Boolean(anyBlockerId),
    blocker_id: anyBlockerId,
    blocker_slot: anyBlockerState?.slot ?? null,
    triangle_at_frame: anyBlockerState && anyDefenderState && anyDefenderSnapshot.players[capture.qbId] ? {
      rusher_to_blocker_gap_m: Math.hypot(anyDefenderState.x_m - anyBlockerState.x_m, anyDefenderState.y_m - anyBlockerState.y_m),
      blocker_to_qb_gap_m: Math.hypot(anyBlockerState.x_m - anyDefenderSnapshot.players[capture.qbId].x_m, anyBlockerState.y_m - anyDefenderSnapshot.players[capture.qbId].y_m),
      rusher_to_qb_gap_m: Math.hypot(anyDefenderState.x_m - anyDefenderSnapshot.players[capture.qbId].x_m, anyDefenderState.y_m - anyDefenderSnapshot.players[capture.qbId].y_m),
      angle_at_rusher_degrees: angleDegrees(anyDefenderState, anyBlockerState, anyDefenderSnapshot.players[capture.qbId]),
    } : null,
  };

  const filteredEngagements = capture.engagementRecords
    .filter((entry) => capture.rusherIds.has(entry.rusher_id))
    .map((entry) => ({
      ...entry,
      exposure_end_seconds_after_snap: Math.min(entry.end_seconds_after_snap ?? liveEndTime, liveEndTime),
      exposure_start_seconds_after_snap: Math.max(0, entry.start_seconds_after_snap),
    }))
    .filter((entry) => entry.exposure_end_seconds_after_snap > entry.exposure_start_seconds_after_snap);
  const shedEvents = result.events
    .filter((event) => event.type === 'shed' && capture.rusherIds.has(event.by)
      && event.t >= 0 && event.t <= liveEndTime + 1e-9)
    .map((event) => ({ time_seconds_after_snap: event.t, rusher_id: event.by, blocker_id: event.from }));
  const disengagements = filteredEngagements
    .filter((entry) => entry.end_seconds_after_snap != null
      && entry.end_seconds_after_snap >= 0 && entry.end_seconds_after_snap <= liveEndTime + 1e-9)
    .map((entry) => ({
      time_seconds_after_snap: entry.end_seconds_after_snap,
      rusher_id: entry.rusher_id,
      blocker_id: entry.blocker_id,
      shedder_id: entry.disengaged_by_id,
      was_shed: entry.disengaged_by_id === entry.rusher_id,
    }));

  const trialGroups = new Map();
  for (const trial of capture.shedTrials) {
    if (trial.time_seconds_after_snap < 0 || trial.time_seconds_after_snap > liveEndTime + 1e-9) continue;
    const key = `${trial.rusher_id}\u0000${trial.blocker_id}`;
    const group = trialGroups.get(key) || { rusher_id: trial.rusher_id, blocker_id: trial.blocker_id, calls: 0 };
    group.calls++;
    trialGroups.set(key, group);
  }
  const exposureByPair = [...trialGroups.values()].map((group) => {
    const rusher = scenario.players[group.rusher_id];
    const blocker = scenario.players[group.blocker_id];
    const passRushMove = Math.max(rusher.ratings.PMV ?? 40, rusher.ratings.FMV ?? 40);
    const blockerPassBlock = blocker.ratings.PBK ?? 50;
    const lambdaPerSecond = 0.1 * Math.exp((passRushMove - blockerPassBlock) / 15);
    const exposureSeconds = group.calls * DT;
    const hazard = lambdaPerSecond * exposureSeconds;
    return {
      rusher_id: group.rusher_id,
      blocker_id: group.blocker_id,
      observed_maybe_shed_calls: group.calls,
      measured_engagement_exposure_seconds: exposureSeconds,
      lambda_per_second: lambdaPerSecond,
      integrated_hazard: hazard,
    };
  });
  const totalHazard = exposureByPair.reduce((sum, item) => sum + item.integrated_hazard, 0);
  const predictedNoShedProbability = Math.exp(-totalHazard);
  const observedShed = shedEvents.length > 0;

  return {
    seed,
    offense_team_id: offenseId,
    defense_team_id: defenseId,
    formation,
    selected_candidate_id: scenario.selection.playbook_entry.candidate_id,
    live_window_end_seconds_after_snap: liveEndTime,
    live_frame_count_30hz: samples.length,
    gap_series_start_seconds_after_snap: samples[0]?.time ?? null,
    gap_series_interval_seconds: 1 / REC_HZ,
    rusher_gap_series_m: front.map((rusher) => ({ id: rusher.id, slot: rusher.slot, gap_m: rusherGaps.get(rusher.id) })),
    front_rusher_minimum_gaps: front.map((rusher) => {
      const gaps = rusherGaps.get(rusher.id);
      const minIndex = gaps.indexOf(Math.min(...gaps));
      const minSample = samplesByRusher.get(rusher.id)[minIndex];
      const state = nearestStep(capture, frameTime(result, minSample.index)).players[rusher.id];
      return {
        id: rusher.id,
        slot: rusher.slot,
        minimum_gap_m: gaps[minIndex],
        elapsed_seconds_after_snap: minSample.time,
        engaged_at_own_minimum: Boolean(state?.engaged_id),
        blocker_id_at_own_minimum: state?.engaged_id ?? null,
      };
    }),
    closest_front_rusher: {
      id: closestRusher.rusher.id,
      slot: closestRusher.rusher.slot,
      minimum_gap_m: closestRusher.gap_m,
      frame_index: closestRusher.frame_index,
      elapsed_seconds_after_snap: closestRusher.elapsed_seconds,
      engaged_at_frame: Boolean(blockerId),
      blocker_id: blockerId,
      blocker_slot: blockerState?.slot ?? null,
      triangle_at_frame: triangle,
      telemetry_step_time_seconds_after_snap: closestSnapshot?.time_seconds_after_step ?? null,
    },
    closest_any_defender: closestAnyDefender,
    engagement_intervals: filteredEngagements,
    first_disengage_time_seconds_after_snap: disengagements.length
      ? Math.min(...disengagements.map((entry) => entry.time_seconds_after_snap)) : null,
    first_shed_time_seconds_after_snap: shedEvents.length
      ? Math.min(...shedEvents.map((event) => event.time_seconds_after_snap)) : null,
    shed_event_count: shedEvents.length,
    shed_events: shedEvents,
    disengagements,
    shed_probability: {
      measured_engagement_maybe_shed_calls: exposureByPair.reduce((sum, item) => sum + item.observed_maybe_shed_calls, 0),
      measured_engagement_exposure_seconds: exposureByPair.reduce((sum, item) => sum + item.measured_engagement_exposure_seconds, 0),
      integrated_hazard: totalHazard,
      predicted_no_shed_probability: predictedNoShedProbability,
      predicted_any_shed_probability: 1 - predictedNoShedProbability,
      observed_any_shed: observedShed,
      exposure_by_rusher_blocker_pair: exposureByPair,
    },
    qb_rusher_contact_callbacks: capture.qbRusherContactCallbacks
      .filter((event) => event.time_seconds_after_snap >= 0 && event.time_seconds_after_snap <= liveEndTime + 1e-9),
    sack_events: result.events.filter((event) => event.type === 'sack').length,
    explicit_pressure_events: result.events.filter((event) => event.type === 'pressure').length,
  };
}

function summarizeCell(records) {
  const gapsBySlot = new Map();
  const gapsByRusher = new Map();
  const gapsByTime = new Map();
  const engagementGroups = { engaged: [], unengaged: [] };
  const anyDefenderEngagementGroups = { engaged: [], unengaged: [] };
  const individualMinimumByEngagement = { engaged: [], unengaged: [] };
  const individualMinimumBySlotAndEngagement = {};
  for (const record of records) {
    for (const rusher of record.front_rusher_minimum_gaps) {
      const slot = gapsBySlot.get(rusher.slot) || [];
      slot.push(rusher.minimum_gap_m);
      gapsBySlot.set(rusher.slot, slot);
      const byId = gapsByRusher.get(rusher.id) || { slot: rusher.slot, values: [] };
      byId.values.push(rusher.minimum_gap_m);
      gapsByRusher.set(rusher.id, byId);
      const state = rusher.engaged_at_own_minimum ? 'engaged' : 'unengaged';
      individualMinimumByEngagement[state].push(rusher.minimum_gap_m);
      const slotGroups = individualMinimumBySlotAndEngagement[rusher.slot] ||= { engaged: [], unengaged: [] };
      slotGroups[state].push(rusher.minimum_gap_m);
    }
    const group = record.closest_front_rusher.engaged_at_frame ? 'engaged' : 'unengaged';
    engagementGroups[group].push(record.closest_front_rusher.minimum_gap_m);
    const anyGroup = record.closest_any_defender.engaged_at_frame ? 'engaged' : 'unengaged';
    anyDefenderEngagementGroups[anyGroup].push(record.closest_any_defender.gap_m);
    for (const rusher of record.rusher_gap_series_m) {
      for (let index = 0; index < rusher.gap_m.length; index++) {
        const time = Number((index / REC_HZ).toFixed(8));
        const bin = gapsByTime.get(time) || { all: [], by_slot: {} };
        bin.all.push(rusher.gap_m[index]);
        (bin.by_slot[rusher.slot] ||= []).push(rusher.gap_m[index]);
        gapsByTime.set(time, bin);
      }
    }
  }

  const shedPlays = records.filter((record) => record.shed_event_count > 0);
  const exposurePlays = records.filter((record) => record.shed_probability.measured_engagement_maybe_shed_calls > 0);
  const predictedAnyShed = records.map((record) => record.shed_probability.predicted_any_shed_probability);
  const actualShedFraction = shedPlays.length / records.length;
  const contactCallbacks = records.flatMap((record) => record.qb_rusher_contact_callbacks);
  const sackDraws = records.reduce((sum, record) => sum + record.sack_events + record.explicit_pressure_events, 0);

  const slotRows = Object.fromEntries([...gapsBySlot.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([slot, values]) => [slot, distribution(values)]));
  const rusherRows = Object.fromEntries([...gapsByRusher.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([id, value]) => [id, { slot: value.slot, ...distribution(value.values) }]));
  const gapByElapsed = [...gapsByTime.entries()].sort(([a], [b]) => a - b).map(([time, value]) => ({
    elapsed_seconds_after_snap: time,
    n_rusher_frame_gaps: value.all.length,
    median_gap_m: quantile(value.all, 0.5),
    median_gap_m_by_slot: Object.fromEntries(Object.entries(value.by_slot)
      .sort(([a], [b]) => a.localeCompare(b)).map(([slot, gaps]) => [slot, quantile(gaps, 0.5)])),
  }));
  const meanPredictedShed = predictedAnyShed.reduce((sum, value) => sum + value, 0) / records.length;
  const meanPredictedNoShed = 1 - meanPredictedShed;
  const expectedShedCount = predictedAnyShed.reduce((sum, value) => sum + value, 0);
  const predictedShedCountSd = Math.sqrt(predictedAnyShed.reduce((sum, value) => sum + value * (1 - value), 0));
  const reachFramesByPlay = records.map((record) => record.reach_frame_count);
  const bodyFramesByPlay = records.map((record) => record.body_contact_frame_count);

  return {
    n_dropbacks: records.length,
    median_rusher_qb_gap_by_elapsed_time_30hz: gapByElapsed,
    per_slot_minimum_gap_distribution_m: slotRows,
    per_rusher_minimum_gap_distribution_m: rusherRows,
    individual_rusher_minimum_gap_by_engagement_state_m: {
      all_slots: Object.fromEntries(Object.entries(individualMinimumByEngagement)
        .map(([state, values]) => [state, distribution(values)])),
      by_slot: Object.fromEntries(Object.entries(individualMinimumBySlotAndEngagement)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([slot, groups]) => [slot, Object.fromEntries(Object.entries(groups)
          .map(([state, values]) => [state, distribution(values)]))])),
    },
    closest_front_rusher_at_minimum_gap: {
      engaged_count: engagementGroups.engaged.length,
      unengaged_count: engagementGroups.unengaged.length,
      minimum_gap_by_engagement_state_m: {
        engaged: distribution(engagementGroups.engaged),
        unengaged: distribution(engagementGroups.unengaged),
      },
    },
    closest_any_defender_at_minimum_gap: {
      engaged_count: anyDefenderEngagementGroups.engaged.length,
      unengaged_count: anyDefenderEngagementGroups.unengaged.length,
      gap_by_engagement_state_m: {
        engaged: distribution(anyDefenderEngagementGroups.engaged),
        unengaged: distribution(anyDefenderEngagementGroups.unengaged),
      },
    },
    shed_accounting: {
      plays_with_any_shed: shedPlays.length,
      dropback_shed_fraction: actualShedFraction,
      plays_with_shed_exposure: exposurePlays.length,
      shed_fraction_among_exposed_plays: exposurePlays.length
        ? shedPlays.filter((record) => record.shed_probability.measured_engagement_maybe_shed_calls > 0).length / exposurePlays.length : null,
      total_shed_events: records.reduce((sum, record) => sum + record.shed_event_count, 0),
      median_first_shed_time_seconds_after_snap: quantile(shedPlays
        .map((record) => record.first_shed_time_seconds_after_snap).filter(Number.isFinite), 0.5),
      plays_with_any_disengagement: records.filter((record) => record.disengagements.length > 0).length,
      plays_with_any_shed_before_live_window_end: shedPlays.length,
      mean_predicted_any_shed_probability_across_dropbacks: meanPredictedShed,
      mean_predicted_no_shed_probability_across_dropbacks: meanPredictedNoShed,
      predicted_expected_plays_with_any_shed: expectedShedCount,
      predicted_poisson_binomial_sd_plays_with_shed: predictedShedCountSd,
      observed_minus_predicted_expected_shed_count_sd: predictedShedCountSd
        ? (shedPlays.length - expectedShedCount) / predictedShedCountSd : null,
      predicted_minus_observed_shed_fraction: meanPredictedShed - actualShedFraction,
      probability_model: 'per-rusher/blocker hazard λ=0.1×exp((max(PMV,FMV)-PBK)/15); exposure is counted at each actual maybeShed invocation while engaged, integrated hazard is Σ(λ×DT), P(no shed)=exp(-integrated hazard)',
    },
    contact_opportunity_census: {
      engagement_reach_constant_m: SHED_DISTANCE_M,
      threshold_definition: 'front rusher radius + QB radius + 0.3 m engagement reach, measured immediately before each 120 Hz collision solve',
      plays_with_any_engagement_reach_frame: records.filter((record) => record.plays_with_engagement_reach_frame).length,
      engagement_reach_frame_count: reachFramesByPlay.reduce((sum, count) => sum + count, 0),
      body_contact_threshold_definition: 'front rusher radius + QB radius (actual player collider overlap), measured immediately before each 120 Hz collision solve',
      plays_with_any_body_contact_frame: records.filter((record) => record.plays_with_body_contact_frame).length,
      body_contact_frame_count: bodyFramesByPlay.reduce((sum, count) => sum + count, 0),
      actual_qb_rusher_on_touch_callback_count: contactCallbacks.length,
      plays_with_actual_qb_rusher_on_touch_callback: records.filter((record) => record.qb_rusher_contact_callbacks.length > 0).length,
      sack_or_pressure_draw_count: sackDraws,
      interpretation: 'World.collide invokes onTouch only for actual collider overlap; the +0.3 m rule is an engagement-reach proxy, not the collision radius.',
    },
    records,
  };
}

export function buildPocketFloorProbe({ n = SAMPLE_SIZE } = {}) {
  assert.equal(n, SAMPLE_SIZE, 'the pocket-floor diagnostic is pinned to n=200 per offense');
  const restoreTelemetry = installWorldTelemetry();
  const cells = {};
  try {
    for (const offenseId of TEAM_IDS) {
      const records = [];
      for (let index = 0; index < n; index++) {
        const input = scenarioFor(offenseId, index);
        const executed = execute(input);
        const analyzed = analyzeDropback(executed);
        const liveEnd = analyzed.live_window_end_seconds_after_snap;
        const reachFrames = executed.capture.reachOpportunitySteps
          .filter((item) => item.time_seconds_after_snap >= 0 && item.time_seconds_after_snap <= liveEnd + 1e-9);
        const colliderFrames = executed.capture.colliderOverlapSteps
          .filter((item) => item.time_seconds_after_snap >= 0 && item.time_seconds_after_snap <= liveEnd + 1e-9);
        const withWindow = {
          ...analyzed,
          reach_frame_count: reachFrames.length,
          plays_with_engagement_reach_frame: reachFrames.length > 0,
          body_contact_frame_count: colliderFrames.length,
          plays_with_body_contact_frame: colliderFrames.length > 0,
        };
        records.push(withWindow);
      }
      cells[offenseId] = summarizeCell(records);
    }
  } finally {
    restoreTelemetry();
  }

  return {
    schema_version: 'gridiron-free-execution-pocket-floor-probe.v1',
    status: 'unvalidated_smoke_diagnostic_not_calibration_or_prediction',
    population: {
      dropbacks_per_cell: n,
      offenses: { NE: 'NE offense vs CHI defense', CHI: 'CHI offense vs NE defense' },
      seed_scheme: 'pressure-{i}, i=0..199; same indices across NE and CHI',
      first_charted_formation: true,
      line_of_scrimmage_yards: 45,
      direction: 1,
      outcome_mode: 'free; no historical outcome anchors',
      frozen_roster_snapshot: 'data/teams/matchup-2026-10-22.json',
      inputs_reloaded_per_play: true,
    },
    measurement: {
      recorded_gap_series_hz: REC_HZ,
      physics_step_seconds: DT,
      frame_gap: 'horizontal field-plane distance converted to meters; each per-play series covers snap through first throw, sack, or whistle',
      rusher_slots: [...FRONT_SLOTS],
      plus_nb_rule: 'include NB when pass setup heavy rule applies: Run formation/Jumbo text or goal distance <=3 yards',
      engagement_state: 'observed from live Player.engaged references using temporary World method wrappers; engine files are unmodified',
      contact_radii: 'Player.physics.radius values from the frozen team roster snapshot',
      limitation: 'horizontal circles; no vertical reach, body orientation, or continuous 3D contact inference',
    },
    shed_model: {
      code_path: 'rush brain calls maybeShed(p) only while engaged; a free pass uses default boost=1 and passPlay=true',
      lambda_per_second: '0.1 * exp((max(PMV, FMV) - blocker.PBK) / 15)',
      p_no_shed: 'exp(-sum(lambda * measured_maybeShed_call_count * DT))',
      observed_event: 'shed events emitted by World.disengage when called with a shedder; run_block_release is only instrumented for free run blocking and is not emitted by this pass path',
      forced_shed_at: 'the scripted kind === sack setup path sets p.ai.shedAt; this free mode uses kind === pass and cannot enter that branch',
    },
    contact_logic: {
      engagement_reach_extra_m: SHED_DISTANCE_M,
      actual_body_contact_rule: 'World.collide requires center distance less than the sum of Player.r radii before invoking onTouch',
      sack_draw_chain: 'without a QB/front-rusher onTouch contact, the free-pass sackOdds expression is not evaluated; with contact, the callback may emit sack or pressure',
      sack_odds_expression: 'clamp(0.5 + (PMV - QB.PBK) * 0.006, 0.25, 0.78)',
      placeholder_rating_audit: 'not re-derived here; see research/rating-audit-2026-10-22 at c9d4e6f',
    },
    counterfactual: {
      status: 'skipped_no_supported_per_player_ai_hook',
      finding: 'simulatePlay accepts ctx but only reads ctx.ballY; play-local ai.shedAt is set internally only by the scripted kind === sack path. No external per-player override hook exists for free kind === pass.',
    },
    cells,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const output = `${ROOT}/results/pocket_floor_probe.json`;
  const artifact = buildPocketFloorProbe();
  writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({
    output,
    cells: Object.fromEntries(TEAM_IDS.map((id) => [id, {
      n: artifact.cells[id].n_dropbacks,
      closestRusherEngaged: artifact.cells[id].closest_front_rusher_at_minimum_gap.engaged_count,
      shed: artifact.cells[id].shed_accounting,
      contacts: artifact.cells[id].contact_opportunity_census,
    }])),
  }, null, 2));
}
