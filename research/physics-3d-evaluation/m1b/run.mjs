import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { BALANCE_CASES, DEMOS, ENGINE_IDS, TACKLE_VARIANTS, run22PlayerBenchmark, runBalanceScenario, runEnergyControls, runTackleScenario } from './simulation.mjs';

const resultPath = new URL('./results/m1b-results.json', import.meta.url);
await mkdir(new URL('./results/', import.meta.url), { recursive: true });
const started = performance.now();
const engines = [];
const scenarioWallTimes = {};

function summary(result) {
  return {
    engine: result.engine,
    scenario: result.scenario,
    outcome: result.outcome,
    contact: result.contact,
    grip: result.grip,
    balance: result.balance,
    distanceAfterContactM: result.distanceAfterContactM,
    distanceAfterAttemptM: result.distanceAfterAttemptM,
    events: result.events,
    finite: result.finite,
  };
}
function compactFrameValue(value) {
  if (typeof value === 'number') return Number(value.toFixed(5));
  if (Array.isArray(value)) return value.map(compactFrameValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compactFrameValue(item)]));
  return value;
}
function replayArtifact(result) {
  return { ...result, frames: result.frames.map(compactFrameValue) };
}

for (const engine of ENGINE_IDS) {
  const energy = await runEnergyControls(engine);
  if (!energy.airborne.passed) throw new Error(`${engine} airborne energy control exceeded integration-error tolerance`);
  const demos = [];
  for (const scenario of DEMOS) {
    const start = performance.now();
    const result = scenario.kind === 'tackle'
      ? await runTackleScenario(engine, scenario, { recordFrames: true })
      : await runBalanceScenario(engine, scenario, { recordFrames: true });
    scenarioWallTimes[`${engine}:${scenario.id}`] = performance.now() - start;
    demos.push(replayArtifact(result));
  }
  const balance = [];
  for (const scenario of BALANCE_CASES) {
    const start = performance.now();
    const result = await runBalanceScenario(engine, scenario, { recordFrames: true });
    scenarioWallTimes[`${engine}:${scenario.id}`] = performance.now() - start;
    balance.push(replayArtifact(result));
  }
  const variants = [];
  for (const scenario of TACKLE_VARIANTS) {
    const start = performance.now();
    const result = await runTackleScenario(engine, scenario, { recordFrames: false });
    scenarioWallTimes[`${engine}:${scenario.id}`] = performance.now() - start;
    variants.push(summary(result));
  }
  const repeatability = [];
  for (const scenario of DEMOS.filter((s) => s.kind === 'tackle')) {
    const runs = [];
    for (let repeat = 0; repeat < 3; repeat++) runs.push(summary(await runTackleScenario(engine, scenario, { recordFrames: false })));
    const signatures = runs.map((r) => JSON.stringify(r));
    repeatability.push({ scenario: scenario.id, repeats: runs.length, exactWithinProcess: signatures.every((v) => v === signatures[0]), signatures });
  }
  const benchmark22 = await run22PlayerBenchmark(engine, { steps: 12000, repeats: 3 });
  engines.push({ engine,
    energyControls: { ...energy,
      airborne: { ...energy.airborne, frames: energy.airborne.frames.map(compactFrameValue) },
      ground: { ...energy.ground, frames: energy.ground.frames.map(compactFrameValue) } },
    demos, balance, tackleVariants: variants, repeatability, benchmark22 });
}

const artifact = {
  schemaVersion: 1,
  milestone: 'M1b physical tackling, grip and balance',
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model, logicalCpuCount: os.cpus().length,
    totalWallTimeMs: performance.now() - started, perScenarioWallTimeMs: scenarioWallTimes },
  matchedSetup: {
    engines: ENGINE_IDS, fixedFootballTimestepSeconds: 1 / 120, gravityMps2: [0, -9.81, 0],
    playerGeometry: 'same five shapes: torso/pelvis/head/two arms; Rapier attaches five colliders; Jolt uses one compound shape containing equivalent parts',
    nominalPlayerMassKg: 'same input mass; Rapier collider mass shares total 1.0; Jolt sets equivalent compound body mass',
    materials: { playerFriction: 0.72, playerRestitution: 0.04, groundFriction: 0.82, groundRestitution: 0.04, linearDamping: 0.025, angularDamping: 0.06 },
    rapier: { solverIterations: 8, contactImpulseSource: 'solver manifold normal impulses', penetrationSource: 'solver contact distance' },
    jolt: { stepCallsPerFrame: 1, solverIterations: 'package defaults; JS wrapper does not expose the corresponding configuration in this harness', contactImpulseSource: 'no solver impulse accessor used; momentum-delta estimates remain separately labeled', penetrationSource: 'not exposed by the tested JS adapter' },
    balanceController: { orientationFromRigidBodyQuaternion: true, angularVelocityFeedback: true, centerOfMassOffsetFeedback: true, groundedOnly: true,
      gains: { proportionalNmPerRad: 1050, derivativeNmsPerRad: 220, centerOfMassNmPerM: 2600, maxTorqueNm: 2400 },
      strengthScaling: '(0.55 + strength/120) × balanceScale', bounded: true },
    gripController: { implementation: 'compliant point-to-point spring-damper using equal-and-opposite applied forces and torques',
      stiffnessNPerM: 1800, dampingNsPerM: 210, overloadFramesToRelease: 2, extensionLimitM: 0.58,
      loadSource: 'explicit controller force law; not reported as a solver constraint impulse' },
  },
  engines,
};
await writeFile(resultPath, `${JSON.stringify(artifact)}\n`);
console.log(JSON.stringify({
  resultFile: resultPath.pathname,
  totalWallTimeMs: artifact.runtime.totalWallTimeMs,
  engines: engines.map((row) => ({ engine: row.engine,
    demos: row.demos.map((d) => ({ scenario: d.scenario, outcome: d.outcome, finite: d.finite })),
    balance: row.balance.map((b) => ({ scenario: b.scenario, results: b.results.map((p) => ({ label: p.label, fellAtEnd: p.fellAtEnd, recoveredTick: p.recoveredTick })) })),
    airborneEnergyPassed: row.energyControls.airborne.passed,
    benchmark22: { medianMsPerSimulatedSecond: row.benchmark22.medianMsPerSimulatedSecond, finite: row.benchmark22.finite },
  })),
}, null, 2));
