// Prints the quarterback's decision trace for one dropback: what he knew at each decision,
// the options he weighed, and the action he took. Diagnostic only; the engine never reads
// pressure_actual_yards when deciding.
// Usage: node scripts/pass-decision-trace.mjs <engine root> <seed> [qbPolicy] [priorMode]
import { pathToFileURL } from 'node:url';

const [root, seed, qbPolicy = 'stage_one', priorMode = 'exact'] = process.argv.slice(2);
if (!root || !seed) throw new Error('usage: pass-decision-trace.mjs <engine root> <seed> [qbPolicy] [priorMode]');
const { simulatePassPlay } = await import(pathToFileURL(`${root}/engine/autonomous/passing.js`).href);

const run = simulatePassPlay({
  seed, front: 'nickel_over', coverage: 'cover_1', direction: 'right', dir: 1, los: 35, ballY: 26.667,
  concept: 'slant_flat', qbPolicy, priorMode,
});
for (const e of run.events.filter((x) => x.type === 'decision_trace')) console.log(JSON.stringify(e));
console.log(JSON.stringify({
  outcome: run.terminal.reason,
  yards_gained: run.terminal.yards_gained,
  interception: Boolean(run.interception_id),
}));
