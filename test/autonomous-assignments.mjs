import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';
import { exampleAssignments, exampleRunAssignments } from '../engine/autonomous/example-assignments.js';
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
const cover3 = exampleAssignments('slant_flat', 'zone').defense;
assert.deepEqual(['LEDGE', 'LDT', 'RDT', 'REDGE'].map((slot) => cover3[slot].kind), Array(4).fill('rush'));
assert.deepEqual(['LCB', 'FS', 'RCB'].map((slot) => cover3[slot].bounds),
  [[12, 30, 8, 27], [12, 30, -8, 8], [12, 30, -27, -8]], 'three deep thirds');
for (const slot of ['MLB', 'WLB', 'NB', 'SS']) {
  assert.equal(cover3[slot].kind, 'zone');
  assert.ok(cover3[slot].bounds[1] <= 12, `${slot} covers underneath`);
}
for (const concept of ['slant_flat', 'curls', 'four_verticals']) {
  for (const coverage of ['man', 'zone']) {
    const call = assigned(concept, coverage);
    const result = simulateAutonomousPlay(call);
    assert.equal(result.status, 'complete', `${concept} ${coverage}`);
    assert.deepEqual(result.call.assignments, call.assignments, 'record the executed assignments');
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
const detailed = assigned('curls', 'zone');
detailed.behavior_mode = 'detailed';
assert.equal(simulateAutonomousPlay(detailed).diagnostics.behavior_mode, 'detailed');
const slow = assigned('slant_flat', 'zone');
const fast = structuredClone(slow);
const receiver = slow.offense.lineup.WR2;
slow.player_profiles[receiver].ratings.SPD = 35;
fast.player_profiles[receiver].ratings.SPD = 99;
const slowRun = simulateAutonomousPlay(slow), fastRun = simulateAutonomousPlay(fast);
const wrIndex = slowRun.trajectory.roster.findIndex((p) => p.id === receiver);
assert.notDeepEqual([...slowRun.trajectory.frames[25].slice(wrIndex * 6, wrIndex * 6 + 2)],
  [...fastRun.trajectory.frames[25].slice(wrIndex * 6, wrIndex * 6 + 2)], 'speed changes route movement');

const runCall = buildSampleCall({ family: 'run', concept: 'inside_zone', direction: 'right' });
runCall.assignments = exampleRunAssignments('right');
const runResult = simulateAutonomousPlay(runCall);
assert.equal(runResult.status, 'complete');
assert.deepEqual(runResult.call.assignments, runCall.assignments);
assert.equal(runResult.diagnostics.reconciliation.ok, true);
const executed = runResult.events.filter((event) => event.type === 'assignment_executed');
assert.equal(executed.length, 22, 'each player receives one executable run assignment');
assert.deepEqual(new Set(executed.map((event) => event.role)), new Set(runResult.trajectory.roster.map((player) => player.roleKey)));
const atFrame = (record, role, frame = 36) => {
  const index = record.trajectory.roster.findIndex((player) => player.roleKey === role);
  return [...record.trajectory.frames[frame].slice(index * 6, index * 6 + 2)];
};
for (const [mutate, role, label] of [
  [(call) => { call.assignments.offense.RB.aiming_gap = 'backside_c'; }, 'O.RB', 'runner aiming gap'],
  [(call) => { call.assignments.offense.LT.track_gap = 'play_side_a'; }, 'O.LT', 'lineman track gap'],
  [(call) => { call.assignments.offense.WR1.target_slot = 'RCB'; }, 'O.WR1', 'perimeter block target'],
  [(call) => { call.assignments.defense.MLB.gap = 'play_side_c'; }, 'D.MIKE', 'linebacker gap fit'],
]) {
  const changed = structuredClone(runCall);
  mutate(changed);
  const changedResult = simulateAutonomousPlay(changed);
  assert.notDeepEqual(atFrame(changedResult, role), atFrame(runResult, role), `${label} changes assigned-player movement`);
}
console.log('assigned routes, three composed concepts, coverage response and legacy replay parity passed');
