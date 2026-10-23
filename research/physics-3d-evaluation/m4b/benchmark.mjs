import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SEED, SCENARIOS, VERSION_PROFILES, instantiateScenario } from './scenarios.mjs';
import { compareSignatures, ENGINE_IDS, PHYSICS_MATERIALS, runScenario } from './simulation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const RESULTS = path.join(HERE, 'results');
const packageJson = JSON.parse(await readFile(path.join(REPO, 'package.json'), 'utf8'));
const profileId = process.argv[2] ?? 'proxy-v1-single-capsule';
const profile = VERSION_PROFILES[profileId];
if (!profile) throw new Error(`Unknown simulation version: ${profileId}`);
const seed = Number(process.argv[3] ?? DEFAULT_SEED);
if (!Number.isInteger(seed) || seed < 0) throw new Error(`Seed must be a nonnegative integer, got ${seed}`);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
const commitKey = sourceCommit.slice(0, 10);
const scenarioVersion = 'm4b-scenario-library-v2';
const archivedScenarioIds = new Set(['gang-two-opposite-open', 'sack-simultaneous-two', 'fumble-eight-pile-live-ball', 'tush-push-eight']);
const outputDirectory = path.join(RESULTS, profileId, commitKey);
const stagingDirectory = path.join(RESULTS, `.m4b-staging-${profileId}-${commitKey}`);
try { await access(outputDirectory); throw new Error(`Immutable archive already exists at ${outputDirectory}`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
try { await access(stagingDirectory); throw new Error(`Interrupted staging archive exists at ${stagingDirectory}; inspect it before rerunning.`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(stagingDirectory, { recursive: true });

const startedAt = performance.now();
const rows = [];
const failures = [];
const repeatability = [];
for (const engine of ENGINE_IDS) {
  for (const scenarioDefinition of SCENARIOS) {
    const scenario = instantiateScenario(scenarioDefinition.id, seed);
    const fullRate = archivedScenarioIds.has(scenario.id);
    const solverVersion = engine === 'rapier3d-compat'
      ? packageJson.devDependencies['@dimforge/rapier3d-compat'] : packageJson.devDependencies['jolt-physics'];
    let result;
    try {
      result = await runScenario(engine, scenario, { playerGeometry: profile.geometry, recordFrames: true, recordStride: fullRate ? 1 : 6 });
    } catch (error) {
      const filename = `${scenario.id}-seed-${seed}-failure.json.gz`;
      const relativeResultPath = `${profile.id}/${commitKey}/${engine}/${filename}`;
      const failurePath = path.join(stagingDirectory, engine, filename);
      const archiveMetadata = { milestone: 'M4b', simulationVersion: profile.id, playerGeometry: profile.geometry, sourceCommit, solverVersion, seed,
        scenarioVersion, timestepSeconds: 1 / 120, initialState: { players: scenario.players, football: scenario.carriedBall ?? null },
        ratingsSnapshot: 'fixture-only explicit masses and force inputs; no external ratings snapshot' };
      const failure = { name: error.name, message: error.message, stack: error.stack };
      await mkdir(path.dirname(failurePath), { recursive: true });
      await writeFile(failurePath, gzipSync(Buffer.from(JSON.stringify({ archiveMetadata, initialState: archiveMetadata.initialState, failure })), { level: 9 }));
      failures.push({ scenarioId: scenario.id, scenarioTitle: scenario.title, category: scenario.category, seed, engine,
        simulationVersion: profile.id, sourceCommit, solverVersion, status: 'failed', path: `../results/${relativeResultPath}`, failure });
      console.log(JSON.stringify({ simulationVersion: profile.id, engine, scenarioId: scenario.id, status: 'failed', error: error.message }));
      continue;
    }
    const archiveMetadata = {
      milestone: 'M4b multi-player contact stress tests and visual regression archive',
      simulationVersion: profile.id, playerGeometry: profile.geometry, sourceCommit, solverVersion, seed,
      scenarioVersion, timestepSeconds: result.timestepSeconds,
      ratingsSnapshot: scenario.ratingsSnapshot ?? 'fixture-only explicit masses and force inputs; no external ratings snapshot',
      initialState: { players: scenario.players, football: scenario.carriedBall ?? null,
        physicsMaterials: { ...PHYSICS_MATERIALS, ...(scenario.groundMaterial?.friction !== undefined ? { groundFriction: scenario.groundMaterial.friction } : {}) },
        solverConfiguration: { rapierIterations: 8, joltIterations: 'package default; JavaScript wrapper does not expose this setting' },
        carrierId: scenario.carrierId ?? scenario.players.find((player) => player.id === 'carrier')?.id ?? scenario.sackTargetId ?? 'quarterback',
        ballOriginId: scenario.ballOriginId ?? null,
        ballReleasePolicy: { fumbleOnFirstContact: Boolean(scenario.fumbleOnFirstContact), throwAtSeconds: scenario.throwAtSeconds ?? null,
          snapAtSeconds: scenario.snapAtSeconds ?? null, snapTargetId: scenario.snapTargetId ?? null },
      },
      frameStrideTicks: result.recordedFrameStrideTicks,
      frameSampleRateHz: 120 / result.recordedFrameStrideTicks,
    };
    const payload = { archiveMetadata, initialState: archiveMetadata.initialState, replay: result };
    const filename = `${scenario.id}-seed-${seed}.json.gz`;
    const relativeResultPath = `${profile.id}/${commitKey}/${engine}/${filename}`;
    const resultPath = path.join(stagingDirectory, engine, filename);
    await mkdir(path.dirname(resultPath), { recursive: true });
    await writeFile(resultPath, gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 }));
    rows.push({ scenarioId: scenario.id, scenarioTitle: scenario.title, category: scenario.category, seed, engine, status: 'completed',
      simulationVersion: profile.id, sourceCommit, solverVersion, path: `../results/${relativeResultPath}`,
      replayRateHz: archiveMetadata.frameSampleRateHz, replayFrameCount: result.frames.length,
      archivedAtFullPhysicsRate: fullRate,
      outcome: result.outcome, diagnostics: result.diagnostics, runtime: result.runtime, events: result.events,
      contacts: result.contacts });
    console.log(JSON.stringify({ simulationVersion: profile.id, engine, scenarioId: scenario.id, steps: result.stepsCompleted,
      frames: result.frames.length, contacts: result.contacts.length, runtimeMs: Number(result.runtime.wallTimeMs.toFixed(1)),
      finite: result.diagnostics.finite }));

    if (scenario.id === 'gang-two-opposite-open') {
      const repeat = await runScenario(engine, instantiateScenario(scenario.id, seed), {
        playerGeometry: profile.geometry, recordFrames: true, recordStride: 30,
      });
      repeatability.push({ scenarioId: scenario.id, engine, simulationVersion: profile.id,
        exactWithinProcess: compareSignatures(result, repeat), repeats: 2,
        comparisonSampling: 'full event stream plus transforms every 0.25 seconds and final state' });
    }
  }
}

const summary = {
  schemaVersion: 1, milestone: 'M4b', simulationVersion: profile,
  sourceCommit, seed, scenarioVersion, timestepSeconds: 1 / 120, gravityMps2: [0, -9.81, 0],
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model,
    logicalCpuCount: os.cpus().length, wallTimeMs: performance.now() - startedAt, processRssBytes: process.memoryUsage().rss },
  setup: { engines: ENGINE_IDS, playerGeometry: profile.description, baseMaterials: PHYSICS_MATERIALS,
    fixedTimestepSeconds: 1 / 120, durationSeconds: 7.5, solverIterations: { rapier: 8, jolt: 'package default; JS wrapper setting not exposed in this harness' },
    forceModels: 'bounded balance torques, configured player drive forces, torso-anchor compliant wrap forces, and a carry-cradle force pair are separately recorded.',
    outcomeRandomDraw: false,
    football: 'rounded-box rigid-body proxy; carry is a force-based fixture, loose-ball contacts are real rigid-body contacts, secure recovery is unresolved without articulated hands.',
    playerArticulation: 'single capsule or five-part rigid compound; neither model has articulated limbs.' },
  scenarioResults: [...rows, ...failures],
  repeatability, failureCount: failures.length,
};
await writeFile(path.join(stagingDirectory, 'summary.json'), `${JSON.stringify(summary)}\n`);
await mkdir(path.dirname(outputDirectory), { recursive: true });
await rename(stagingDirectory, outputDirectory);

const manifestPath = path.join(RESULTS, 'archive-index.json');
let previous = { records: [] };
try { previous = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const rowsByKey = new Map((previous.records ?? []).map((row) => [`${row.scenarioId}|${row.engine}|${row.simulationVersion}|${row.seed}|${row.sourceCommit}`, row]));
for (const row of rows) rowsByKey.set(`${row.scenarioId}|${row.engine}|${row.simulationVersion}|${row.seed}|${row.sourceCommit}`, {
  ...rowsByKey.get(`${row.scenarioId}|${row.engine}|${row.simulationVersion}|${row.seed}|${row.sourceCommit}`), ...row,
});
const failuresByKey = new Map((previous.failures ?? []).map((row) => [`${row.scenarioId}|${row.engine}|${row.simulationVersion}|${row.seed}|${row.sourceCommit}`, row]));
for (const row of failures) failuresByKey.set(`${row.scenarioId}|${row.engine}|${row.simulationVersion}|${row.seed}|${row.sourceCommit}`, row);
const profiles = Object.values(VERSION_PROFILES);
const cameras = {
  all22: { title: 'All-22 overview', position: [0, 19, 25], target: [0, 0.4, 0] },
  sideline: { title: 'Sideline / broadcast', position: [0, 5.5, 17], target: [0, 0.85, 0] },
  closeup: { title: 'Close-up contact', position: [3.4, 3.2, 5.4], target: [0.1, 1, 0] },
};
const manifest = {
  schemaVersion: 1, milestone: 'M4b', generatedAt: new Date().toISOString(), timestepSeconds: 1 / 120,
  profiles, cameras,
  scenarioCatalog: SCENARIOS.map(({ players, carriedBall, ...scenario }) => ({ ...scenario, playerCount: players.length, carriedBall: Boolean(carriedBall) })),
  activeProfileCommits: { ...(previous.activeProfileCommits ?? {}), [profile.id]: sourceCommit },
  stressSweeps: previous.stressSweeps ?? [],
  failures: [...failuresByKey.values()],
  records: [...rowsByKey.values()].sort((a, b) => a.scenarioId.localeCompare(b.scenarioId) || a.engine.localeCompare(b.engine)
    || a.simulationVersion.localeCompare(b.simulationVersion) || a.sourceCommit.localeCompare(b.sourceCommit)),
  viewer: 'Open research/physics-3d-evaluation/m4b/archive/index.html from a local static web server at the repository root.',
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ summaryPath: path.join(outputDirectory, 'summary.json'), manifestPath,
  simulationVersion: profile.id, sourceCommit, scenarioRuns: rows.length + failures.length, failedRuns: failures.length,
  repeatability, wallTimeMs: summary.runtime.wallTimeMs }, null, 2));
