#!/usr/bin/env node
// Repeatable completion audit over ordinary, supported inside-zone snap inputs.
import { simulateInsideZone } from '../engine/autonomous-run.js';

const FRONT = ['even', 'over', 'under', 'nickel', 'odd', 'bear'];
const TOTAL = 240;
const counts = { attempted: TOTAL, completed: 0, technical_failures: 0, exceptions: 0, terminal_reasons: {} };
const failures = [];

for (let i = 0; i < TOTAL; i++) {
  const config = {
    seed: `autonomous-batch-${String(i + 1).padStart(3, '0')}`,
    front: FRONT[i % FRONT.length],
    runSide: i % 2 ? 'right' : 'left',
    dir: i % 4 < 2 ? 1 : -1,
    los: 20 + (i * 17 % 61),
    ballY: [23.583, 26.667, 29.75][i % 3],
  };
  try {
    const run = simulateInsideZone(config);
    if (!run.resolved || !run.terminal) {
      counts.technical_failures++;
      failures.push({ seed: config.seed, front: config.front, failure: run.failure });
    } else {
      counts.completed++;
      counts.terminal_reasons[run.terminal.reason] = (counts.terminal_reasons[run.terminal.reason] || 0) + 1;
    }
  } catch (error) {
    counts.exceptions++;
    failures.push({ seed: config.seed, front: config.front, error: String(error) });
  }
}

process.stdout.write(`${JSON.stringify({ ...counts, failures }, null, 2)}\n`);
if (counts.completed + counts.technical_failures + counts.exceptions !== TOTAL) process.exitCode = 1;
