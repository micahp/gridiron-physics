import assert from 'node:assert/strict';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';
import { buildSampleCall } from './autonomous-fixtures.mjs';

const call = buildSampleCall({ family: 'pass', concept: 'assigned', snap_type: 'shotgun', coverage: 'cover_3' });
call.seed = '7';
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
interceptionCall.seed = '18';
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
  event.assignment === 'pursue the returner' || event.assignment === 'shed the block')
  .map((event) => event.player_id));
assert.equal(pursuingOffense.size, 11, 'all offensive players transition to turnover pursuit');
assert.ok([...pursuingOffense].every((id) => Object.values(interceptionCall.offense.lineup).includes(id)));
assert.ok(!turnover.events.some((event) => event.type === 'decision' && event.t > interception.t
  && /^run .* route$/.test(event.assignment)), 'receivers stop running routes after the turnover');
assert.equal(turnover.diagnostics.reconciliation.ok, true);
assert.deepEqual(turnover.diagnostics.outcome_inputs, []);
console.log('catch and interception transition teammates to support and pursuit');
