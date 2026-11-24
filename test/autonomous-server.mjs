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
  console.log('persistent server: error isolation, multiple plays and deterministic replay passed');
} finally { child.stdin.end(); }
