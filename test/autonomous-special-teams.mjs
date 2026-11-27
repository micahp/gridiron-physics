import assert from 'node:assert/strict';
import fs from 'node:fs';
import { simulateAutonomousSpecialTeams } from '../engine/autonomous/special-teams.js';
import { roundYardline100, statReturnYards, statFieldSpot } from '../engine/autonomous/field-geometry.js';

const ids = ['K', ...Array.from({ length: 10 }, (_, i) => `C${i}`), 'R',
  ...Array.from({ length: 10 }, (_, i) => `B${i}`)];

// Saved CHI–DET seed 300027: a live recovery at 1.62 s was previously
// interrupted by the seven-second kick-flight limit.
const recoveredKickCall = JSON.parse(fs.readFileSync(
  new URL('./fixtures/blocked-field-goal-seed-300027.json', import.meta.url), 'utf8'));
const recoveredKick = simulateAutonomousSpecialTeams(recoveredKickCall);
assert.equal(recoveredKick.status, 'complete');
assert.equal(recoveredKick.result.result, 'blocked');
assert.ok(recoveredKick.events.some((event) => event.type === 'kick_recovery'));
assert.ok(recoveredKick.result.elapsed_seconds > 7);
assert.equal(recoveredKick.result.scoring, 'touchdown');
assert.equal(recoveredKick.result.dead_ball_yardline_100, 0);

// Exact CHI–DET seed 300021: a muffed kickoff rolled through the end zone
// and previously remained live beyond the end line until the 36-second cap.
const muffedKickEndlineCall = JSON.parse(fs.readFileSync(
  new URL('./fixtures/muffed-kick-endline-seed-300021.json', import.meta.url), 'utf8'));
const muffedKickEndline = simulateAutonomousSpecialTeams(muffedKickEndlineCall);
assert.equal(muffedKickEndline.status, 'complete');
assert.equal(muffedKickEndline.result.result, 'touchback');
assert.ok(muffedKickEndline.result.elapsed_seconds < 36);
assert.ok(muffedKickEndline.events.some((event) => event.type === 'muff'));
assert.ok(muffedKickEndline.events.some((event) => event.type === 'loose_kick_end_line'));
assert.equal(muffedKickEndline.events.some((event) => event.type === 'fumble_recovery'), false,
  'the ball is dead at the end line before any out-of-bounds recovery can be awarded');
const looseStart = muffedKickEndline.events.find((event) => event.type === 'muff')?.t;
const looseChasers = muffedKickEndline.events.filter((event) => event.type === 'decision'
  && event.t >= looseStart && event.assignment === 'recover loose kick');
assert.equal(new Set(looseChasers.map((event) => event.player_id)).size, 22,
  'every player interrupts lane or block behavior to pursue the loose kick');

assert.equal(roundYardline100(32.499999), 32);
assert.equal(roundYardline100(32.5), 33, 'statistical spots use the shared half-up convention');
assert.equal(statReturnYards(45, 43, -1), 2, 'kicking-team advancement lowers yardline_100');
assert.equal(statReturnYards(45, 47, 1), 2, 'receiving-team advancement raises yardline_100');
assert.equal(statReturnYards(45, 47, -1), -2, 'the same convention preserves a loss');

function call({ kind = 'punt', seed = 42, cth = 78, kpw = 70, kac = 70, awr = 70, spd = 76,
  rush = 70, protect = 70, ratingOverrides = {} } = {}) {
  const profiles = Object.fromEntries(ids.map((id) => {
    const unit = id === 'R' ? 'returner' : id.startsWith('C') ? 'coverage'
      : id.startsWith('B') ? 'blocker' : 'specialist';
    const ratings = { SPD: id === 'R' ? spd : 76, ACC: 75, AGI: 75, STR: 68,
      AWR: id === 'R' ? awr : 70, PUR: 75, TAK: 70,
      BSH: id.startsWith('B') || id === 'R' ? rush : 70,
      RBK: 70, IBL: id.startsWith('C') ? protect : 70, CTH: id === 'R' ? cth : 78,
      CAR: 78, BCV: 75, ELU: 75, TRK: 65, PRC: 70,
      KPW: id === 'K' ? kpw : 70, KAC: id === 'K' ? kac : 70 };
    Object.assign(ratings, ratingOverrides[unit] ?? {});
    return [id, { ratings, physics: {} }];
  }));
  return {
    schema_version: 'gridiron.autonomous-special-teams.v1', kind, seed,
    kicking_team: 'A', receiving_team: 'B',
    yardline_100: kind === 'punt' ? 45 : kind === 'field_goal' ? 35 : 65,
    ball_lateral_yards: 26.67,
    lineups: {
      kicking: { [kind === 'punt' ? 'punter' : 'kicker']: 'K', coverage: ids.slice(1, 11) },
      receiving: { returner: 'R', blockers: ids.slice(12) },
    },
    player_profiles: profiles,
  };
}

const punt = simulateAutonomousSpecialTeams(call({ kind: 'punt', seed: 42 }));
assert.equal(punt.status, 'complete');
assert.equal(punt.diagnostics.assignments_executed, 22);
assert.equal(punt.diagnostics.expected_assignments, 22);
assert.deepEqual(punt.diagnostics.outcome_inputs, []);
assert.equal(punt.trajectory.roster.length, 22);
assert.ok(punt.trajectory.frames.length > 20);
assert.equal(punt.events.at(-1).type, 'whistle');
assert.ok(punt.events.some((event) => event.type === 'catch' || event.type === 'muff'));
const observedKick = punt.events.find((event) => event.type === 'kick_observed');
assert.ok(observedKick && observedKick.player_id === 'R');
assert.ok(observedKick.observation_age_seconds >= 0.14 - 1e-9,
  'returner reacts to delayed observed flight');
assert.equal(punt.result.clock_runoff_seconds, Math.ceil(punt.result.elapsed_seconds),
  'scrimmage-kick clock time includes flight from the snap through the whistle');
const puntTouchback = simulateAutonomousSpecialTeams({ ...call({ kind: 'punt', seed: 0 }), yardline_100: 15 });
assert.equal(puntTouchback.result.result, 'touchback');
assert.equal(puntTouchback.result.clock_runoff_seconds, Math.ceil(puntTouchback.result.elapsed_seconds),
  'a scrimmage-kick touchback charges time from the snap');
assert.deepEqual(simulateAutonomousSpecialTeams(call({ kind: 'punt', seed: 42 })).result, punt.result,
  'same inputs reproduce kick and live return outcomes');

const kickoff = simulateAutonomousSpecialTeams(call({ kind: 'kickoff', seed: 42 }));
assert.equal(kickoff.status, 'complete');
assert.equal(kickoff.result.result, 'return');
assert.equal(kickoff.diagnostics.assignments_executed, 22);
assert.equal(kickoff.trajectory.roster.length, 22);
assert.ok(kickoff.events.some((event) => event.type === 'catch' || event.type === 'muff'
  || event.type === 'whistle' && event.reason === 'touchback'));

const fieldGoal = simulateAutonomousSpecialTeams(call({ kind: 'field_goal', seed: 42 }));
assert.equal(fieldGoal.status, 'complete');
assert.equal(fieldGoal.diagnostics.assignments_executed, 22);
assert.equal(fieldGoal.trajectory.roster.length, 22);
assert.ok(['made', 'missed', 'blocked'].includes(fieldGoal.result.result));
assert.ok(fieldGoal.events.some((event) => event.type === 'long_snap'));
assert.ok(fieldGoal.events.some((event) => event.type === 'field_goal_made'
  || event.type === 'field_goal_missed' || event.type === 'kick_blocked'));
const blockedFieldGoal = simulateAutonomousSpecialTeams(call({
  kind: 'field_goal', seed: 0, kpw: 1, kac: 1, rush: 99, protect: 1,
}));
assert.equal(blockedFieldGoal.result.result, 'blocked');
assert.equal(blockedFieldGoal.diagnostics.assignments_executed, 22);
assert.equal(blockedFieldGoal.trajectory.roster.length, 22);
assert.equal(blockedFieldGoal.events.filter((event) => event.type === 'kick_blocked').length, 1);
assert.ok(blockedFieldGoal.events.some((event) => event.type === 'kick_recovery'));
assert.ok(blockedFieldGoal.events.some((event) => event.type === 'loose_ball_recovery_attempt'),
  'blocked kick recovery records its contact opportunity');
assert.ok(blockedFieldGoal.events.some((event) => event.type === 'whistle'));
assert.equal(blockedFieldGoal.result.receiving_team_touched_beyond_line, false);
assert.ok(blockedFieldGoal.result.recoverer_id);
assert.ok(blockedFieldGoal.result.post_block_returner_id);
const recoveryEvent = blockedFieldGoal.events.find((event) => event.type === 'kick_recovery');
assert.ok(recoveryEvent?.recovery_at && Number.isFinite(recoveryEvent.recovery_at.x)
  && Number.isFinite(recoveryEvent.recovery_at.y));
assert.deepEqual(blockedFieldGoal.result.recovery_at, recoveryEvent.recovery_at,
  'the reported recovery coordinates come from the immutable recovery event');
assert.equal(blockedFieldGoal.result.recovery_yardline_100,
  Math.round(100 - recoveryEvent.recovery_at.x),
  'recovery spot is derived from the ball coordinates at recovery, not the recoverer’s final position');
const recovererIndex = blockedFieldGoal.trajectory.roster.findIndex(
  (player) => player.id === blockedFieldGoal.result.recoverer_id);
const finalFrame = blockedFieldGoal.trajectory.frames.at(-1);
assert.ok(Math.hypot(finalFrame[recovererIndex * 6] - recoveryEvent.recovery_at.x,
  finalFrame[recovererIndex * 6 + 1] - recoveryEvent.recovery_at.y) > 0.1,
  'the recovering player moves after the immutable ball-recovery coordinates are captured');
assert.equal(Number.isInteger(blockedFieldGoal.result.return_yards), true,
  'blocked field goal reports the recovery-to-dead-ball leg in the recovery team frame');
const weakFieldGoal = simulateAutonomousSpecialTeams(call({ kind: 'field_goal', seed: 42, kpw: 1 }));
const strongFieldGoal = simulateAutonomousSpecialTeams(call({ kind: 'field_goal', seed: 42, kpw: 99 }));
assert.ok(strongFieldGoal.diagnostics.kick_model.power_limit_mps
  > weakFieldGoal.diagnostics.kick_model.power_limit_mps);
const lowAccuracyFieldGoal = simulateAutonomousSpecialTeams(call({ kind: 'field_goal', seed: 42, kac: 1 }));
const highAccuracyFieldGoal = simulateAutonomousSpecialTeams(call({ kind: 'field_goal', seed: 42, kac: 99 }));
assert.ok(highAccuracyFieldGoal.diagnostics.kick_model.horizontal_sigma_meters
  < lowAccuracyFieldGoal.diagnostics.kick_model.horizontal_sigma_meters);

const poorHands = simulateAutonomousSpecialTeams(call({ kind: 'kickoff', seed: 2, cth: 1 }));
const sureHands = simulateAutonomousSpecialTeams(call({ kind: 'kickoff', seed: 2, cth: 99 }));
assert.ok(poorHands.events.some((event) => event.type === 'muff'));
assert.equal(poorHands.result.result, 'muff');
assert.equal(poorHands.result.recovery_team, 'receiving_team');
assert.ok(poorHands.result.recoverer_id);
const muffRecoveryEvent = poorHands.events.find((event) => event.type === 'kick_recovery');
assert.ok(poorHands.events.some((event) => event.type === 'loose_ball_recovery_attempt'),
  'muff recovery records its contact opportunity');
assert.deepEqual(poorHands.result.recovery_at,
  { ...muffRecoveryEvent.at, time: muffRecoveryEvent.time },
  'muff return spot keeps the ball coordinates and time from the recovery event');
const kickingTeamMuff = simulateAutonomousSpecialTeams(call({ kind: 'punt', seed: 0, cth: 1, awr: 1 }));
assert.equal(kickingTeamMuff.status, 'complete');
assert.equal(kickingTeamMuff.result.recovery_team, 'kicking_team');
assert.equal(kickingTeamMuff.result.return_yards,
  kickingTeamMuff.result.recovery_yardline_100 - kickingTeamMuff.result.dead_ball_yardline_100,
  'a kicking-team muff recovery uses its own advancement direction');
assert.equal(kickingTeamMuff.result.return_yards, 0,
  'a kicking-team scrimmage-kick recovery beyond the line is dead at recovery');
assert.ok(kickingTeamMuff.events.some((event) => event.type === 'kick_recovery_dead_ball'));
// The original fixture was labelled an end-zone recovery, but the immutable
// ball recovery is actually at x=98.98, inside the field. A carrier's center
// at the goal line did not justify a touchback at that instant.
const muffedNearGoalRecovery = simulateAutonomousSpecialTeams(call({ kind: 'kickoff', seed: 5, cth: 1 }));
assert.equal(muffedNearGoalRecovery.status, 'complete');
assert.equal(muffedNearGoalRecovery.result.result, 'muff');
assert.ok(muffedNearGoalRecovery.result.recovery_at.x < 100);
assert.equal(Boolean(muffedNearGoalRecovery.result.touchback), false);
assert.equal(muffedNearGoalRecovery.result.possession_after, 'receiving_team');
assert.equal(muffedNearGoalRecovery.result.return_yards,
  statFieldSpot(muffedNearGoalRecovery.result.dead_ball_at.x, 1)
    - statFieldSpot(muffedNearGoalRecovery.result.recovery_at.x, 1));
assert.equal(muffedNearGoalRecovery.result.clock_runoff_seconds,
  Math.ceil(muffedNearGoalRecovery.result.elapsed_seconds
    - muffedNearGoalRecovery.result.catch_elapsed_seconds));
assert.equal(muffedNearGoalRecovery.result.fumbler_id, 'R');
assert.ok(muffedNearGoalRecovery.result.recoverer_id);
assert.ok(muffedNearGoalRecovery.result.post_recovery_returner_id);
assert.ok(sureHands.events.some((event) => event.type === 'catch'));

const weakLeg = simulateAutonomousSpecialTeams(call({ kind: 'punt', seed: 2, kpw: 1 }));
const strongLeg = simulateAutonomousSpecialTeams(call({ kind: 'punt', seed: 2, kpw: 99 }));
assert.ok(strongLeg.diagnostics.kick_model.generated_distance_yards > weakLeg.diagnostics.kick_model.generated_distance_yards);
const poorAccuracy = simulateAutonomousSpecialTeams(call({ kind: 'punt', seed: 2, kac: 1 }));
const strongAccuracy = simulateAutonomousSpecialTeams(call({ kind: 'punt', seed: 2, kac: 99 }));
assert.ok(strongAccuracy.diagnostics.kick_model.lateral_sigma_yards < poorAccuracy.diagnostics.kick_model.lateral_sigma_yards);

const lowAwareness = simulateAutonomousSpecialTeams(call({ kind: 'punt', seed: 2, awr: 1 }));
const highAwareness = simulateAutonomousSpecialTeams(call({ kind: 'punt', seed: 2, awr: 99 }));
assert.ok(highAwareness.diagnostics.decision_counts.R > lowAwareness.diagnostics.decision_counts.R);

assert.throws(() => simulateAutonomousSpecialTeams({ ...call(), final_ball_spot: 81 }), /outcome field/);
const fairCatch = simulateAutonomousSpecialTeams(call({ kind: 'punt', seed: 0, cth: 99, awr: 99, spd: 99 }));
assert.equal(fairCatch.result.result, 'fair_catch');
assert.equal(fairCatch.result.fair_catch, true);
assert.equal(fairCatch.result.return_yards, null);
assert.ok(fairCatch.events.some((event) => event.type === 'fair_catch'));
const negativeReturn = simulateAutonomousSpecialTeams(call({ kind: 'punt', seed: 1, cth: 99, awr: 99, spd: 99 }));
assert.ok(negativeReturn.result.return_yards < 0);
assert.equal(negativeReturn.result.return_yards,
  statFieldSpot(negativeReturn.result.dead_ball_at.x, 1)
  - statFieldSpot(negativeReturn.result.return_start_at.x, 1));
assert.equal(negativeReturn.result.clock_runoff_seconds,
  Math.ceil(negativeReturn.result.elapsed_seconds));
const outOfBoundsPunt = simulateAutonomousSpecialTeams(call({ kind: 'punt', seed: 5 }));
assert.equal(Boolean(outOfBoundsPunt.result.out_of_bounds), false,
  'the centered deterministic kick stays in bounds');
const outOfBoundsInput = call({ kind: 'punt', seed: 5 });
outOfBoundsInput.ball_lateral_yards = 1.01;
const outOfBounds = simulateAutonomousSpecialTeams(outOfBoundsInput);
assert.equal(outOfBounds.result.result, 'out_of_bounds');
assert.equal(outOfBounds.result.out_of_bounds, true);
assert.equal(outOfBounds.result.returner_id, null);
assert.equal(outOfBounds.result.return_yards, null);
assert.equal(outOfBounds.result.clock_runoff_seconds, Math.ceil(outOfBounds.result.elapsed_seconds),
  'a punt that goes out of bounds charges flight time from the snap');
assert.equal(outOfBounds.result.out_of_bounds_spot_yardline_100,
  outOfBounds.result.dead_ball_yardline_100);
const kickback = simulateAutonomousSpecialTeams(call({ kind: 'kickoff', seed: 12 }));
assert.equal(kickback.result.result, 'touchback');
assert.equal(kickback.result.clock_runoff_seconds, 0);
assert.equal(kickback.result.dead_ball_yardline_100, 35);
const midfieldKickTouchback = simulateAutonomousSpecialTeams({
  ...call({ kind: 'kickoff', seed: 12 }), yardline_100: 50,
});
assert.equal(midfieldKickTouchback.result.result, 'touchback');
assert.equal(midfieldKickTouchback.result.dead_ball_yardline_100, 20,
  'a kickoff from midfield has the rule-specific 20-yard touchback spot');
const safetyFreeTouchback = simulateAutonomousSpecialTeams({
  ...call({ kind: 'kickoff', seed: 12 }), yardline_100: 80,
});
assert.equal(safetyFreeTouchback.result.result, 'touchback');
assert.equal(safetyFreeTouchback.result.dead_ball_yardline_100, 20);
const longKickoffReturn = simulateAutonomousSpecialTeams(call({ kind: 'kickoff', seed: 29 }));
assert.equal(longKickoffReturn.status, 'complete');
assert.ok(longKickoffReturn.result.return_yards > 50);
assert.equal(longKickoffReturn.result.return_yards,
  statFieldSpot(longKickoffReturn.result.dead_ball_at.x, 1)
  - statFieldSpot(longKickoffReturn.result.return_start_at.x, 1));
assert.ok(longKickoffReturn.result.elapsed_seconds > 18,
  'a long live kickoff return completes beyond the former 18-second cap');
assert.equal(longKickoffReturn.result.clock_runoff_seconds,
  Math.ceil(longKickoffReturn.result.elapsed_seconds - longKickoffReturn.result.catch_elapsed_seconds),
  'free-kick clock time starts at the receiving team touch');
assert.equal(longKickoffReturn.events.at(-1).type, 'whistle');
assert.equal(longKickoffReturn.diagnostics.assignments_executed, 22);
const eliteReturnRatings = {
  returner: { SPD: 99, ACC: 99, AGI: 99, STR: 90, AWR: 99, BSH: 99,
    CTH: 99, CAR: 99, BCV: 99, ELU: 99, TRK: 99, PRC: 99 },
  coverage: { SPD: 50, ACC: 50, AGI: 50, STR: 45, PUR: 50, TAK: 45, BSH: 45 },
  blocker: { SPD: 88, ACC: 88, AGI: 88, STR: 99, BSH: 99, RBK: 99, IBL: 99 },
};
const kickoffReturnTouchdown = simulateAutonomousSpecialTeams(call({ kind: 'kickoff', seed: 2,
  ratingOverrides: eliteReturnRatings }));
assert.equal(kickoffReturnTouchdown.result.result, 'return');
assert.equal(kickoffReturnTouchdown.result.scoring, 'touchdown');
assert.equal(kickoffReturnTouchdown.result.scoring_team, 'receiving_team');
assert.equal(kickoffReturnTouchdown.result.returner_id, 'R');
const muffReturnTouchdown = simulateAutonomousSpecialTeams(call({ kind: 'kickoff', seed: 4,
  ratingOverrides: eliteReturnRatings }));
assert.equal(muffReturnTouchdown.result.result, 'muff');
assert.equal(muffReturnTouchdown.result.scoring, 'touchdown');
assert.equal(muffReturnTouchdown.result.scoring_team, 'receiving_team');
assert.equal(muffReturnTouchdown.result.fumbler_id, 'R');
assert.ok(muffReturnTouchdown.result.recoverer_id);
// This seed used to produce a zero-live-time safety simply because the
// player's center was within 0.55 yards of the goal line at the catch.
// The kick is caught in the field of play; continue to a real dead ball.
const nearGoalReturn = simulateAutonomousSpecialTeams(call({ kind: 'kickoff', seed: 5,
  ratingOverrides: eliteReturnRatings }));
assert.equal(nearGoalReturn.result.result, 'return');
assert.ok(nearGoalReturn.result.return_start_at.x < 100);
assert.equal(nearGoalReturn.result.scoring, null);
assert.ok(nearGoalReturn.result.live_elapsed_seconds > 0);
const missingRatings = call({ kind: 'punt', seed: 42 });
delete missingRatings.player_profiles.K.ratings.KPW;
assert.throws(() => simulateAutonomousSpecialTeams(missingRatings), /K\.ratings_missing:KPW/);
console.log('autonomous punts, kickoffs, and field goals execute 22 assignments, resolve live outcomes, and map ratings to behavior');
