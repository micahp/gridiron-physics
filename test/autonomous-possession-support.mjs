import assert from 'node:assert/strict';
import { exampleAssignments, exampleRunAssignments } from '../engine/autonomous/example-assignments.js';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';
import { buildSampleCall } from './autonomous-fixtures.mjs';

const call = buildSampleCall({ family: 'pass', concept: 'assigned', snap_type: 'shotgun', coverage: 'cover_3' });
call.seed = '0';
call.assignments = exampleAssignments('slant_flat', 'zone');
call.player_evaluation_mode = 'shared_snapshot';
const result = simulateAutonomousPlay(call);
const catchEvent = result.events.find((event) => event.type === 'catch');
assert.ok(catchEvent, 'fixture has a live catch');
const helpers = new Set(result.events.filter((event) => event.type === 'decision'
  && event.assignment === 'escort the carrier' && event.t >= catchEvent.t).map((event) => event.player_id));
const offense = new Set(Object.values(call.offense.lineup));
assert.equal(helpers.size, 10, 'every other offensive player transitions to support');
assert.ok([...helpers].every((id) => offense.has(id) && id !== catchEvent.player_id));
assert.ok(!result.events.some((event) => event.type === 'decision' && event.t > catchEvent.t
  && /^run .* route$/.test(event.assignment)), 'receivers stop running assigned routes after possession');
assert.equal(result.diagnostics.reconciliation.ok, true);
assert.deepEqual(result.diagnostics.outcome_inputs, []);

const interceptionCall = buildSampleCall({ family: 'pass', concept: 'assigned', snap_type: 'shotgun', coverage: 'cover_1' });
// Fixed positive interception witness found in CI 46163609227; old seed 15
// remains in the possession audit as a separate, now non-interception case.
interceptionCall.seed = '83';
interceptionCall.assignments = exampleAssignments('four_verticals', 'man');
interceptionCall.player_evaluation_mode = 'shared_snapshot';
for (const [id, profile] of Object.entries(interceptionCall.player_profiles)) {
  if (id.startsWith('chi-')) {
    profile.ratings.CTH = 99;
    profile.ratings.PRC = 99;
    profile.ratings.SPD = 99;
  } else {
    profile.ratings.CTH = 1;
  }
}
const turnover = simulateAutonomousPlay(interceptionCall);
const interception = turnover.events.find((event) => event.type === 'interception');
assert.ok(interception, 'fixture has a live interception');
const decisionsAtInterception = turnover.events.filter((event) => event.type === 'decision'
  && event.t === interception.t);
const returnHelpers = new Set(decisionsAtInterception.filter((event) => event.assignment === 'escort the carrier')
  .map((event) => event.player_id));
const defense = new Set(Object.values(interceptionCall.defense.lineup));
assert.equal(returnHelpers.size, 10, 'every other defender transitions to interceptor support');
assert.ok([...returnHelpers].every((id) => defense.has(id) && id !== interception.player_id));
const pursuingOffense = new Set(decisionsAtInterception.filter((event) =>
  event.assignment === 'locate the carrier' || event.assignment === 'shed the block')
  .map((event) => event.player_id));
assert.equal(pursuingOffense.size, 11, 'all offensive players transition to search or local contact at possession');
assert.ok(!decisionsAtInterception.some(event => event.assignment === 'pursue the returner'),
  'opponents cannot pursue from a new possession before a delivered observation');
assert.ok(turnover.events.some(event => event.assignment === 'pursue the returner' && event.t > interception.t),
  'at least one opponent acquires and acts on the returner after the interception');
assert.ok([...pursuingOffense].every((id) => Object.values(interceptionCall.offense.lineup).includes(id)));
assert.ok(!turnover.events.some((event) => event.type === 'decision' && event.t > interception.t
  && /^run .* route$/.test(event.assignment)), 'receivers stop running routes after the turnover');
assert.equal(turnover.diagnostics.reconciliation.ok, true);
assert.deepEqual(turnover.diagnostics.outcome_inputs, []);

const fumbleCall = buildSampleCall({ family: 'run', direction: 'right', front: 'nickel_over' });
fumbleCall.seed = '19';
fumbleCall.situation.yardline_100 = 40;
fumbleCall.assignments = exampleRunAssignments('right');
fumbleCall.player_evaluation_mode = 'shared_snapshot';
fumbleCall.player_profiles['ne-rb'].ratings.CAR = 1;
for (const id of Object.values(fumbleCall.defense.lineup)) {
  Object.assign(fumbleCall.player_profiles[id].ratings, { TAK: 99, STR: 99, PRC: 99 });
}
const fumbleReturn = simulateAutonomousPlay(fumbleCall);
const recovery = fumbleReturn.events.find((event) => event.type === 'fumble_recovery');
assert.ok(recovery && recovery.team === 'D', 'fixture has a defensive fumble recovery');
const recoveryDecisions = fumbleReturn.events.filter((event) => event.type === 'decision'
  && event.t === recovery.t);
const fumbleHelpers = new Set(recoveryDecisions.filter((event) => event.assignment === 'escort the fumble return')
  .map((event) => event.player_id));
assert.equal(fumbleHelpers.size, 10, 'every other defender transitions to recovered-ball support');
assert.ok([...fumbleHelpers].every((id) => Object.values(fumbleCall.defense.lineup).includes(id)));
const fumblePursuers = new Set(recoveryDecisions.filter((event) => event.assignment === 'pursue the fumble returner')
  .map((event) => event.player_id));
assert.equal(fumblePursuers.size, 11, 'all offensive players transition to fumble-return pursuit');
assert.ok([...fumblePursuers].every((id) => Object.values(fumbleCall.offense.lineup).includes(id)));
assert.equal(fumbleReturn.diagnostics.reconciliation.ok, true);
assert.deepEqual(fumbleReturn.diagnostics.outcome_inputs, []);
console.log('catch, interception, and fumble transitions enter live support and pursuit');
