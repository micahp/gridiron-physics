// Headless benchmark: no viewer or raster rendering is invoked.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { performance } from 'node:perf_hooks';
import { buildSampleCall } from '../test/autonomous-fixtures.mjs';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';
const count = Number(process.argv[2] ?? 20);
if (!Number.isInteger(count) || count < 1 || count > 1000) throw new RangeError('count must be 1..1000');
const child = spawn(process.execPath, ['engine/autonomous/slc-server.js'], { stdio:['pipe','pipe','inherit'] });
const lines = createInterface({input:child.stdout})[Symbol.asyncIterator]();
const call = buildSampleCall({family:'pass',concept:'assigned',snap_type:'shotgun'});
call.assignments = exampleAssignments('slant_flat','zone');
async function play(i) { call.seed = String(300000+i); child.stdin.write(JSON.stringify({op:'play',id:i,call})+'\n'); const row=JSON.parse((await lines.next()).value); if(!row.ok || row.value.status !== 'complete') throw new Error(JSON.stringify(row.error ?? row.value.failure)); return row.engine_ms; }
try {
  await play(0); // warm process and JIT before timing
  let engineMs=0; const t0=performance.now();
  for(let i=1;i<=count;i++) engineMs += await play(i);
  const elapsedMs=performance.now()-t0;
  console.log(JSON.stringify({plays:count,warmup:1,wall_ms:elapsedMs,engine_ms:engineMs,plays_per_second:count*1000/elapsedMs,rendering:false}));
} finally { child.stdin.end(); }
