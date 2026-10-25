// Stage One entry point: one validated pre-snap call in, one inspectable
// result record out. Nothing in this path can read a realized outcome; the
// historical director (engine/play.js) is never imported here.
import { roleKeysForFront, simulateInsideZone } from '../autonomous-run.js';
import { simulatePassPlay } from './passing.js';
import { validatePlayInput } from './schema.js';
import { toResultRecord, reconcileResult } from './results.js';

// Contract defensive slots -> the shared roster's alignment slots.
const DEFENSE_SLOT_TO_ROSTER = { LEDGE: 'LDE', REDGE: 'RDE', MLB: 'MIKE', WLB: 'WILL' };
const OFFENSE_SLOTS = ['QB', 'RB', 'LT', 'LG', 'C', 'RG', 'RT', 'TE', 'WR1', 'WR2', 'WR3'];
const DEFENSE_SLOTS = ['LEDGE', 'LDT', 'RDT', 'REDGE', 'MLB', 'WLB', 'NB', 'LCB', 'RCB', 'SS', 'FS'];
// The shared roster aligns nickel personnel for both nickel over and under.
const RUSH_FRONT = { nickel_over: 'nickel', nickel_under: 'nickel', nickel: 'nickel', over: 'over', under: 'under', even: 'even', odd: 'odd', bear: 'bear' };

function translation(map, toRoster) {
  if (!toRoster) return map;
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    const [team, slot] = key.split('.');
    out[`${team}.${team === 'D' ? (DEFENSE_SLOT_TO_ROSTER[slot] ?? slot) : slot}`] = value;
  }
  return out;
}

/**
 * Build the physics-facing scenario from a validated contract input.
 *
 * Per-player inputs are collected under the contract's slot names and then
 * translated to whatever the chosen front actually aligns, so a front without
 * a nickel back cannot receive a nickel-back profile.
 */
export function scenarioFromCall(call) {
  const ratingOverrides = {};
  const massOverrides = {};
  const playerIds = {};
  for (const [team, slots, lineup] of [
    ['O', OFFENSE_SLOTS, call.offense.lineup],
    ['D', DEFENSE_SLOTS, call.defense.lineup],
  ]) {
    for (const slot of slots) {
      const id = lineup[slot];
      const key = `${team}.${slot}`;
      playerIds[key] = id;
      const profile = call.profiles.get(id);
      if (profile && Object.keys(profile.ratings).length) ratingOverrides[key] = profile.ratings;
      if (profile?.physics?.mass != null) massOverrides[key] = profile.physics.mass;
    }
  }
  const rosterFront = RUSH_FRONT[call.defense.front];
  const allowed = roleKeysForFront(rosterFront);
  const keep = (map) => Object.fromEntries(Object.entries(map).filter(([key]) => allowed.has(key)));
  // yardline_100 counts toward the goal the offense attacks; the engine takes the absolute x of the line.
  const dir = call.situation.offense_direction;
  const common = {
    seed: call.seed,
    los: dir === 1 ? 100 - call.situation.yardline_100 : call.situation.yardline_100,
    dir,
    ballY: call.situation.ball_lateral_yards,
    ratingOverrides,
    massOverrides,
    playerIds,
  };
  if (call.offense.family === 'run') {
    return {
      kind: 'run',
      config: {
        ...common,
        runSide: call.offense.direction,
        front: rosterFront,
        ratingOverrides: keep(translation(ratingOverrides, true)),
        massOverrides: keep(translation(massOverrides, true)),
        playerIds: keep(translation(playerIds, true)),
      },
    };
  }
  // The passing executor accepts contract slot names and translates them.
  return {
    kind: 'pass',
    config: {
      ...common,
      direction: call.offense.direction,
      concept: call.offense.concept,
      front: call.defense.front,
      coverage: call.defense.coverage,
      offenseTeam: call.offense.team,
      defenseTeam: call.defense.team,
    },
  };
}

/**
 * Run one autonomous snap.
 * @param {object} input gridiron.autonomous-play.v1 payload
 * @returns gridiron.autonomous-result.v1 record
 */
export function simulateAutonomousPlay(input) {
  const call = validatePlayInput(input);
  const scenario = scenarioFromCall(call);
  const run = scenario.kind === 'run' ? simulateInsideZone(scenario.config) : simulatePassPlay(scenario.config);
  const record = toResultRecord(call, run);
  record.diagnostics.reconciliation = reconcileResult(record);
  return record;
}
