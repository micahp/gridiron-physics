import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_IDS, runScenario } from './simulation.mjs';
import { instantiateM4CScenario } from './m4c-scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const RESULTS = path.join(HERE, 'results');
const seed = 41027;
const variants = [
  { id: 'baseline', scenario: 'gang-two-opposite-open', options: {} },
  { id: 'spawn-gap-plus-0.10m', scenario: 'gang-two-opposite-open', separationM: 0.10, options: {} },
  { id: 'collider-scale-0.95', scenario: 'gang-two-opposite-open', options: { playerScale: 0.95 } },
  { id: 'collider-scale-1.05', scenario: 'gang-two-opposite-open', options: { playerScale: 1.05 } },
  { id: 'rapier-contact-skin-0.01m', scenario: 'gang-two-opposite-open', engineOnly: 'rapier3d-compat', options: { rapierContactSkinM: 0.01 } },
  { id: 'rapier-iterations-4', scenario: 'gang-two-opposite-open', engineOnly: 'rapier3d-compat', options: { solverIterations: 4 } },
  { id: 'rapier-iterations-16', scenario: 'gang-two-opposite-open', engineOnly: 'rapier3d-compat', options: { solverIterations: 16 } },
  { id: 'jolt-collision-steps-2', scenario: 'gang-two-opposite-open', engineOnly: 'jolt-physics-js', options: { joltCollisionSteps: 2 } },
  { id: 'jolt-collision-steps-4', scenario: 'gang-two-opposite-open', engineOnly: 'jolt-physics-js', options: { joltCollisionSteps: 4 } },
  { id: 'fixed-step-1-over-60', scenario: 'gang-two-opposite-open', options: { timestepSeconds: 1 / 60 } },
  { id: 'fixed-step-1-over-240', scenario: 'gang-two-opposite-open', options: { timestepSeconds: 1 / 240 } },
  { id: 'wrap-cradle-stiffness-half', scenario: 'gang-two-opposite-open', options: { gripStiffnessScale: 0.5 } },
  { id: 'wrap-cradle-stiffness-one-point-five', scenario: 'gang-two-opposite-open', options: { gripStiffnessScale: 1.5 } },
  { id: 'player-drive-0.75', scenario: 'gang-two-opposite-open', options: { playerDriveScale: 0.75 } },
  { id: 'player-drive-1.25', scenario: 'gang-two-opposite-open', options: { playerDriveScale: 1.25 } },
  { id: 'balance-controller-off', scenario: 'gang-two-opposite-open', options: { balanceControllerEnabled: false } },
  { id: 'balance-torque-double', scenario: 'gang-two-opposite-open', options: { balanceTorqueScale: 2 } },
  { id: 'low-traction', scenario: 'gang-two-opposite-open', options: { materialOverrides: { playerFriction: 0.35, groundFriction: 0.40 } } },
  { id: 'high-traction', scenario: 'gang-two-opposite-open', options: { materialOverrides: { playerFriction: 1.10, groundFriction: 1.10 } } },
  { id: 'player-mass-0.9', scenario: 'gang-two-opposite-open', options: { playerMassScale: 0.9 } },
  { id: 'player-mass-1.1', scenario: 'gang-two-opposite-open', options: { playerMassScale: 1.1 } },
  { id: 'carrier-light-defender-heavy', scenario: 'gang-two-opposite-open', options: { playerTeamMassScales: { offense: 0.85, defense: 1.15 } } },
  { id: 'carrier-heavy-defender-light', scenario: 'gang-two-opposite-open', options: { playerTeamMassScales: { offense: 1.15, defense: 0.85 } } },
  { id: 'grip-strength-low', scenario: 'grip-escape-one-held', options: { gripStrengthScale: 0.5 } },
  { id: 'grip-strength-high', scenario: 'grip-escape-one-held', options: { gripStrengthScale: 8.0 } },
  { id: 'one-defender', scenario: 'gang-two-opposite-open', defenderCount: 1, options: {} },
  { id: 'two-defenders', scenario: 'gang-two-opposite-open', defenderCount: 2, options: {} },
  { id: 'football-control-off', scenario: 'possession-retained', options: { ballControlEnabled: false } },
  { id: 'football-control-on', scenario: 'possession-retained', options: { ballControlEnabled: true } },
  { id: 'eight-player-contact-count', scenario: 'fumble-eight-pile-live-ball', options: {} },
  { id: '22-player-contact-count', scenario: 'short-yardage-22-player', options: {} },
];

const initialSeparation = (scenario, amount) => {
  if (!amount) return;
  for (const player of scenario.players) {
    const speed = Math.hypot(player.v?.[0] ?? 0, player.v?.[1] ?? 0, player.v?.[2] ?? 0);
    if (!speed) continue;
    player.p = player.p.map((coordinate, axis) => coordinate - (player.v[axis] / speed) * amount);
  }
};
const summarize = (result) => ({ scenarioId: result.scenarioId, engine: result.engine, seed: result.seed,
  physicsParameters: result.physicsParameters, finite: result.diagnostics.finite, playerCount: result.diagnostics.playerCount,
  initialPlayerGeometryEstimateM: result.penetration.initialPlayerGeometryEstimateM,
  firstStepMaximumM: result.penetration.firstStepMaximumM, maximumPenetrationM: result.penetration.maximumDepthM,
  p50PerStepMaximumM: result.penetration.p50PerStepMaximumM, p95PerStepMaximumM: result.penetration.p95PerStepMaximumM,
  durationWeightedMeanM: result.penetration.durationWeightedMeanM, maximumAfterFirstStepM: result.penetration.maximumAfterFirstStepM,
  thresholdCounts: result.penetration.thresholdCounts, contactOpportunityCount: result.contactOpportunities.rows.length,
  physicalContactPairCount: result.contacts.length, contributionLedger: result.outcome.defenderContributionLedger,
  playerTerminalStates: result.outcome.playerTerminalStates, football: result.outcome.football,
  rawProgress: result.outcome.rawProgress, events: result.events.map(({ type, timeSeconds, pair, player, quarterback, reason }) =>
    ({ type, timeSeconds, pair, player, quarterback, reason })), runtime: result.runtime });

const startedAt = performance.now();
const runs = [];
for (const variant of variants) for (const engine of ENGINE_IDS) {
  if (variant.engineOnly && variant.engineOnly !== engine) continue;
  const scenario = instantiateM4CScenario(variant.scenario, seed);
  scenario.durationSeconds = Math.min(scenario.durationSeconds, 2.4);
  if (variant.separationM) initialSeparation(scenario, variant.separationM);
  if (variant.defenderCount) scenario.players = [scenario.players[0], ...scenario.players.slice(1, 1 + variant.defenderCount)];
  const result = await runScenario(engine, scenario, { behaviorVersion: 'm4c', recordFrames: false, ...variant.options });
  if (variant.id === 'grip-strength-low' || variant.id === 'grip-strength-high') {
    const weakGrip = result.outcome.wrapResults.find((row) => row.holderId === 'defender-left');
    assert.equal(weakGrip.released, variant.id === 'grip-strength-low', `${engine}: grip strength changes the overload outcome`);
  }
  const row = { variantId: variant.id, input: { scenarioId: variant.scenario, seed,
    initialPlayers: scenario.players, scenarioBall: scenario.carriedBall ?? scenario.looseBall ?? null,
    spawnSeparationAdjustmentM: variant.separationM ?? 0, defenderCount: variant.defenderCount ?? null,
    engineSpecificSettings: variant.engineOnly ?? null }, ...summarize(result) };
  runs.push(row);
  console.log(JSON.stringify({ variantId: variant.id, engine, players: row.playerCount,
    maxPenetrationM: row.maximumPenetrationM, p95PenetrationM: row.p95PerStepMaximumM,
    physicalContactPairs: row.physicalContactPairCount, runtimeMs: Math.round(result.runtime.wallTimeMs) }));
}

const packageJson = JSON.parse(await readFile(path.join(REPO, 'package.json'), 'utf8'));
const report = { schemaVersion: 1, milestone: 'M4c controlled sensitivity and causal ablation runs',
  generatedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(),
  reproducibility: { command: 'npm run eval:m4c:sensitivity', node: process.version,
    rapierVersion: packageJson.devDependencies['@dimforge/rapier3d-compat'], joltVersion: packageJson.devDependencies['jolt-physics'],
    fixedSeed: seed, noRandomDraws: true, baseScenarioDurationSeconds: 2.4 },
  instrumentLimits: { solverContactStiffness: 'not directly exposed in the tested JS APIs; spring-damper controller stiffness and solver iteration/collision-step controls are varied separately',
    rapierContactSkin: 'Rapier exposes setContactSkin; Jolt shape API tested here does not expose the equivalent convex margin',
    solverEquivalence: 'Rapier numSolverIterations and Jolt Step collisionSteps are distinct settings and are not treated as equivalent.' },
  runtime: { wallTimeMs: performance.now() - startedAt, processRssBytes: process.memoryUsage().rss,
    platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model },
  variedMechanisms: variants.map(({ id }) => id), runCount: runs.length, runs };
await mkdir(RESULTS, { recursive: true });
await writeFile(path.join(RESULTS, 'm4c-sensitivity.json'), `${JSON.stringify(report)}\n`);
console.log(JSON.stringify({ passed: runs.every((row) => row.finite), runCount: runs.length,
  result: path.join(RESULTS, 'm4c-sensitivity.json'), wallTimeMs: report.runtime.wallTimeMs }, null, 2));
