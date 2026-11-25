import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { buildSampleCall } from './autonomous-fixtures.mjs';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';
const child = spawn(process.execPath, ['engine/autonomous/slc-server.js'], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
async function request(v) {
  child.stdin.write(JSON.stringify(v) + '\n');
  const r = await lines.next();
  assert.equal(r.done, false);
  return JSON.parse(r.value);
}
try {
  const bad = await request({id: 1, op: 'unknown'});
  assert.equal(bad.ok, false);
  const call = buildSampleCall({family:'pass',concept:'assigned',snap_type:'shotgun'});
  call.assignments = exampleAssignments('curls', 'zone');
  const first = await request({id: 2, op: 'play', call});
  const second = await request({id: 3, op: 'play', call});
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  assert.deepEqual(first.value, second.value);
  assert.equal(first.id, 2); assert.equal(second.id, 3);
  const examples = await request({id: 4, op: 'example_assignments', concept:'four_verticals', coverage:'man'});
  assert.deepEqual(examples.value, exampleAssignments('four_verticals', 'man'));
  const ids = ['K', ...Array.from({length: 10}, (_, i) => `C${i}`), 'R',
    ...Array.from({length: 10}, (_, i) => `B${i}`)];
  const specialTeams = {
    schema_version: 'gridiron.autonomous-special-teams.v1', kind: 'punt', seed: 42,
    kicking_team: 'A', receiving_team: 'B', yardline_100: 45,
    lineups: { kicking: { punter: 'K', coverage: ids.slice(1, 11) },
      receiving: { returner: 'R', blockers: ids.slice(12) } },
    player_profiles: Object.fromEntries(ids.map((id) => [id, {ratings: {SPD: 76, ACC: 75,
      AGI: 75, STR: 68, AWR: 70, PUR: 75, TAK: 70, BSH: 70, RBK: 70, IBL: 70,
      CTH: 78, CAR: 78, BCV: 75, ELU: 75, TRK: 65, PRC: 70, KPW: 70, KAC: 70}}])),
  };
  const special = await request({id: 5, op: 'special_teams', call: specialTeams});
  assert.equal(special.ok, true);
  assert.equal(special.value.status, 'complete');
  assert.equal(special.value.diagnostics.assignments_executed, 22);
  assert.equal(special.value.trajectory.roster.length, 22);
  console.log('persistent server: error isolation, scrimmage replay and autonomous special teams passed');
} finally { child.stdin.end(); }
