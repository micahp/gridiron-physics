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
console.log('catch transitions offensive teammates to carrier support');
