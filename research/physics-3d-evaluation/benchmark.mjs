import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import { PASS_DEFLECTION_SCENARIO, TACKLE_SCENARIOS } from './scenarios.js';
import { runRapierTackle, runRapierPass, runRapier22PlayerBenchmark } from './rapier-sim.js';
import { runJoltTackle, runJoltPass, runJolt22PlayerBenchmark } from './jolt-sim.js';

const simulations = Number(process.argv[2] ?? 1000);
const stepsPerSimulation = Number(process.argv[3] ?? 30);
const repeatCount = 5;
if (!Number.isInteger(simulations) || simulations < 1 || !Number.isInteger(stepsPerSimulation) || stepsPerSimulation < 1) throw new Error('Usage: node benchmark.mjs [simulation-count>=1] [steps-per-simulation>=1]');
const enginePairs = [
  { name: 'rapier3d-compat', tackle: runRapierTackle, pass: runRapierPass, bench: runRapier22PlayerBenchmark },
  { name: 'jolt-physics-js', tackle: runJoltTackle, pass: runJoltPass, bench: runJolt22PlayerBenchmark },
];
const results = [];
function percentile(sorted, p) {
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

function summarizeRuns(runs) {
  const values = runs.map((run) => run.msPerSimulation).sort((a, b) => a - b);
  const q1 = percentile(values, 0.25), median = percentile(values, 0.5), q3 = percentile(values, 0.75);
  return {
    repeatCount: runs.length,
    medianMsPerSimulation: median,
    minMsPerSimulation: values[0],
    maxMsPerSimulation: values.at(-1),
    q1MsPerSimulation: q1,
    q3MsPerSimulation: q3,
    iqrMsPerSimulation: q3 - q1,
  };
}

for (const engine of enginePairs) {
  const tackles = [];
  for (const scenario of TACKLE_SCENARIOS) tackles.push(await engine.tackle(scenario, 20261022));
  const passes = [await engine.pass(20261022), await engine.pass(20261022, PASS_DEFLECTION_SCENARIO)];
  const benchmark22Repeats = [];
  for (let repeat = 0; repeat < repeatCount; repeat++) {
    // Each adapter runs its 20-episode warmup before starting its timed loop.
    const run = await engine.bench({ simulations, stepsPerSimulation });
    if (!run.finite) throw new Error(`${engine.name} benchmark repeat ${repeat + 1} had non-finite state`);
    benchmark22Repeats.push({ repeat: repeat + 1, ...run });
  }
  const benchmark22Summary = summarizeRuns(benchmark22Repeats);
  results.push({ engine: engine.name, tackles, passes, benchmark22Repeats, benchmark22Summary });
  console.log(`${engine.name}: ${repeatCount} runs; median ${benchmark22Summary.medianMsPerSimulation.toFixed(3)} ms/scene, range ${benchmark22Summary.minMsPerSimulation.toFixed(3)}–${benchmark22Summary.maxMsPerSimulation.toFixed(3)}, IQR ${benchmark22Summary.iqrMsPerSimulation.toFixed(3)}`);
}
const artifact = {
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, logicalCpuCount: os.cpus().length },
  benchmarkMethod: { simulations, stepsPerSimulation, repeatCount, fixedTimestepSeconds: 1 / 120, simulatedSecondsPerEpisode: stepsPerSimulation / 120, warmupSimulationsBeforeEveryTimedRun: 20, periodicFiniteStateCheckEvery: 100, players: 22, collidersPerPlayer: 5, setupAndWasmInitExcludedFromTimedLoops: true, repeatsShareOneNodeProcessAndHost: true, slowestRunRetained: true },
  results,
};
await writeFile(new URL('./results.json', import.meta.url), `${JSON.stringify(artifact, null, 2)}\n`);
console.log('Wrote research/physics-3d-evaluation/results.json');
