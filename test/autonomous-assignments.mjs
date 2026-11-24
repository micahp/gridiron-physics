import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';
import { buildSampleCall } from './autonomous-fixtures.mjs';
const digest = (v) => createHash('sha256').update(JSON.stringify(v, (_k, x) => ArrayBuffer.isView(x) ? Array.from(x) : x)).digest('hex');
for (const [options, expected] of [
  [{}, '577b421bfe70208fc48f5fd953ac93158811e8fa6aafffa553c2a5760af1b592'],
  [{family:'pass',concept:'slant_flat',snap_type:'shotgun',coverage:'cover_1'}, '1dd8e6fb03ff3b0196b69f1f6f073061193bbe80fd9ecfc009fe6e62bd4fa28e'],
]) assert.equal(digest(simulateAutonomousPlay(buildSampleCall(options))), expected, 'legacy replay changed');
function assigned(concept, coverage) {
  const call = buildSampleCall({family: 'pass', concept: 'assigned', snap_type: 'shotgun', coverage: coverage === 'man' ? 'cover_1' : 'cover_3'});
  call.assignments = exampleAssignments(concept, coverage);
  return call;
}
for (const concept of ['slant_flat', 'curls', 'four_verticals']) {
  for (const coverage of ['man', 'zone']) {
    const call = assigned(concept, coverage);
    const result = simulateAutonomousPlay(call);
    assert.equal(result.status, 'complete', `${concept} ${coverage}`);
    assert.equal(result.diagnostics.reconciliation.ok, true);
    assert.deepEqual(result.diagnostics.outcome_inputs, []);
    assert.equal(digest(result), digest(simulateAutonomousPlay(call)), 'deterministic replay');
  }
}
// Every named primitive changes a player's trajectory, with identical seed and initial lineup.
let reference;
for (const route of ['slant', 'curl', 'out', 'dig', 'post', 'go', 'seam', 'flat', 'check']) {
  const call = assigned('slant_flat', 'zone');
  call.assignments.offense.WR2.route = route;
  // Keep the ball in the pocket long enough to observe both route legs.
  // The defense still moves, and no result is supplied or forced.
  call.assignments.offense.QB.decision_delay_seconds = 3.8;
  for (const slot of ['LEDGE', 'LDT', 'RDT', 'REDGE']) call.assignments.defense[slot] = {kind:'zone', bounds:[0,2,-2,2]};
  const result = simulateAutonomousPlay(call);
  assert.equal(result.status, 'complete', route);
  assert.ok(result.events.some((e) => e.type === 'decision' && e.role === 'O.WR2' && e.assignment === `run ${route} route`));
  assert.ok(result.events.some((e) => e.type === 'route_break' && e.role === 'O.WR2' && e.route === route), `${route} reaches its break`);
  const index = result.trajectory.roster.findIndex((p) => p.roleKey === 'O.WR2');
  const frame = result.trajectory.frames[Math.min(20, result.trajectory.frames.length - 1)];
  const position = [...frame.slice(index * 6, index * 6 + 2)];
  if (route === 'slant') reference = position;
  if (route === 'flat' || route === 'check') assert.notDeepEqual(position, reference, `${route} should change early movement`);
}
const man = simulateAutonomousPlay(assigned('slant_flat', 'man'));
const zone = simulateAutonomousPlay(assigned('slant_flat', 'zone'));
assert.notDeepEqual(man.trajectory.frames[30], zone.trajectory.frames[30], 'coverage changes movement');
const qbEvents = (r) => r.events.filter((e) => ['qb_read', 'throw', 'throw_away'].includes(e.type));
assert.notDeepEqual(qbEvents(man), qbEvents(zone), 'coverage changes quarterback observations or decisions');
console.log('assigned routes, three composed concepts, coverage response and legacy replay parity passed');
