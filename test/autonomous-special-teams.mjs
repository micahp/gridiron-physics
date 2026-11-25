import assert from 'node:assert/strict';
import { simulateAutonomousSpecialTeams } from '../engine/autonomous/special-teams.js';

const ids = ['K', ...Array.from({ length: 10 }, (_, i) => `C${i}`), 'R',
  ...Array.from({ length: 10 }, (_, i) => `B${i}`)];

function call({ kind = 'punt', seed = 42, cth = 78, kpw = 70, kac = 70, awr = 70, spd = 76 } = {}) {
  const profiles = Object.fromEntries(ids.map((id) => [id, {
    ratings: { SPD: id === 'R' ? spd : 76, ACC: 75, AGI: 75, STR: 68, AWR: id === 'R' ? awr : 70,
      PUR: 75, TAK: 70, BSH: 70, RBK: 70, IBL: 70, CTH: id === 'R' ? cth : 78,
      CAR: 78, BCV: 75, ELU: 75, TRK: 65, PRC: 70,
      KPW: id === 'K' ? kpw : 70, KAC: id === 'K' ? kac : 70 },
    physics: {},
  }]));
  return {
    schema_version: 'gridiron.autonomous-special-teams.v1', kind, seed,
    kicking_team: 'A', receiving_team: 'B', yardline_100: kind === 'punt' ? 45 : 65,
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
assert.deepEqual(simulateAutonomousSpecialTeams(call({ kind: 'punt', seed: 42 })).result, punt.result,
  'same inputs reproduce kick and live return outcomes');

const kickoff = simulateAutonomousSpecialTeams(call({ kind: 'kickoff', seed: 42 }));
assert.equal(kickoff.status, 'complete');
assert.equal(kickoff.diagnostics.assignments_executed, 22);
assert.equal(kickoff.trajectory.roster.length, 22);
assert.ok(kickoff.events.some((event) => event.type === 'catch' || event.type === 'muff'
  || event.type === 'whistle' && event.reason === 'touchback'));

const poorHands = simulateAutonomousSpecialTeams(call({ kind: 'kickoff', seed: 2, cth: 1 }));
const sureHands = simulateAutonomousSpecialTeams(call({ kind: 'kickoff', seed: 2, cth: 99 }));
assert.ok(poorHands.events.some((event) => event.type === 'muff'));
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
assert.equal(fairCatch.result.fair_catch, true);
assert.equal(fairCatch.result.return_yards, 0);
assert.ok(fairCatch.events.some((event) => event.type === 'fair_catch'));
const negativeReturn = simulateAutonomousSpecialTeams(call({ kind: 'punt', seed: 1, cth: 99, awr: 99, spd: 99 }));
assert.equal(negativeReturn.result.return_yards, -1);
assert.ok(negativeReturn.result.clock_runoff_seconds > 27);
const outOfBoundsPunt = simulateAutonomousSpecialTeams(call({ kind: 'punt', seed: 5 }));
assert.equal(Boolean(outOfBoundsPunt.result.out_of_bounds), false,
  'the centered deterministic kick stays in bounds');
const outOfBoundsInput = call({ kind: 'punt', seed: 5 });
outOfBoundsInput.ball_lateral_yards = 1.01;
const outOfBounds = simulateAutonomousSpecialTeams(outOfBoundsInput);
assert.equal(outOfBounds.result.out_of_bounds, true);
assert.equal(outOfBounds.result.returner_id, null);
const kickback = simulateAutonomousSpecialTeams(call({ kind: 'kickoff', seed: 12 }));
assert.equal(kickback.result.result, 'touchback');
assert.equal(kickback.result.clock_runoff_seconds, 0);
assert.equal(kickback.result.dead_ball_yardline_100, 35);
const safetyFreeTouchback = simulateAutonomousSpecialTeams({
  ...call({ kind: 'kickoff', seed: 12 }), yardline_100: 80,
});
assert.equal(safetyFreeTouchback.result.result, 'touchback');
assert.equal(safetyFreeTouchback.result.dead_ball_yardline_100, 20);
const missingRatings = call({ kind: 'punt', seed: 42 });
delete missingRatings.player_profiles.K.ratings.KPW;
assert.throws(() => simulateAutonomousSpecialTeams(missingRatings), /K\.ratings_missing:KPW/);
console.log('autonomous punts and kickoffs execute 22 assignments, resolve live catches/muffs/returns, and map ratings to behavior');
