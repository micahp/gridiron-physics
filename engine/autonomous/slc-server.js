// Long-lived newline-delimited JSON boundary. One response per request.
import { createInterface } from 'node:readline';
import { performance } from 'node:perf_hooks';
import { simulateAutonomousPlay } from './simulator.js';
import { simulateAutonomousSpecialTeams } from './special-teams.js';
import { exampleAssignments, exampleRunAssignments } from './example-assignments.js';

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  let request;
  try {
    request = JSON.parse(line);
    const start = performance.now();
    let value;
    if (request.op === 'play') value = simulateAutonomousPlay(request.call);
    else if (request.op === 'special_teams') value = simulateAutonomousSpecialTeams(request.call);
    else if (request.op === 'example_assignments') value = exampleAssignments(request.concept, request.coverage);
    else if (request.op === 'example_run_assignments') value = exampleRunAssignments(request.direction);
    else throw new RangeError('unsupported operation');
    const response = { id: request.id ?? null, ok: true, value, engine_ms: performance.now() - start };
    process.stdout.write(JSON.stringify(response, (_key, v) => ArrayBuffer.isView(v) ? Array.from(v) : v) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ id: request?.id ?? null, ok: false, error: { name: error.name, message: error.message } }) + '\n');
  }
}
