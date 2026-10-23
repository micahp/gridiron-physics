import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import { PASS_DEFLECTION_SCENARIO, TACKLE_SCENARIOS } from './scenarios.js';
import { runRapierTackle, runRapierPass, runRapier22PlayerBenchmark } from './rapier-sim.js';
import { runJoltTackle, runJoltPass, runJolt22PlayerBenchmark } from './jolt-sim.js';

const simulations = Number(process.argv[2] ?? 1000);
const stepsPerSimulation = Number(process.argv[3] ?? 30);
if (!Number.isInteger(simulations) || simulations < 1 || !Number.isInteger(stepsPerSimulation) || stepsPerSimulation < 1) throw new Error('Usage: node benchmark.mjs [simulation-count>=1] [steps-per-simulation>=1]');
const enginePairs = [
  { name: 'rapier3d-compat', tackle: runRapierTackle, pass: runRapierPass, bench: runRapier22PlayerBenchmark },
  { name: 'jolt-physics-js', tackle: runJoltTackle, pass: runJoltPass, bench: runJolt22PlayerBenchmark },
];
const results = [];
for (const engine of enginePairs) {
  const tackles = [];
  for (const scenario of TACKLE_SCENARIOS) tackles.push(await engine.tackle(scenario, 20261022));
  const passes = [await engine.pass(20261022), await engine.pass(20261022, PASS_DEFLECTION_SCENARIO)];
  const bench = await engine.bench({ simulations, stepsPerSimulation });
  results.push({ engine: engine.name, tackles, passes, benchmark22: bench });
  console.log(`${engine.name}: ${bench.simulations} x 22-player scenes, ${bench.elapsedMs.toFixed(1)} ms (${bench.msPerSimulation.toFixed(3)} ms/scene)`);
}
const artifact = {
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, logicalCpuCount: os.cpus().length },
  benchmarkMethod: { simulations, stepsPerSimulation, fixedTimestepSeconds: 1 / 120, simulatedSecondsPerEpisode: stepsPerSimulation / 120, warmupSimulations: 20, periodicFiniteStateCheckEvery: 100, players: 22, collidersPerPlayer: 5, setupAndWasmInitExcludedFromTimedLoops: true },
  results,
};
await writeFile(new URL('./results.json', import.meta.url), `${JSON.stringify(artifact, null, 2)}\n`);
console.log('Wrote research/physics-3d-evaluation/results.json');
