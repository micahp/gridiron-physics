import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_IDS, PHYSICS_MATERIALS, runScenario } from './simulation.mjs';
import { M4C_PRIORITY_IDS, instantiateM4CScenario } from './m4c-scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const RESULTS = path.join(HERE, 'results');
const profile = { id: 'm4c-contact-possession-v1', title: 'M4c · contact and possession', geometry: 'compound',
  description: 'M4c force-driven grip, two-point football cradle, rigid-body ball contact, and physical fall classification; fixed compound player proxies are not articulated.' };
const seed = Number(process.argv[2] ?? 41027);
if (!Number.isInteger(seed) || seed < 0) throw new Error(`Seed must be a nonnegative integer, got ${seed}`);
const packageJson = JSON.parse(await readFile(path.join(REPO, 'package.json'), 'utf8'));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
const commitKey = sourceCommit.slice(0, 10), seedKey = `seed-${seed}`;
const scenarioVersion = 'm4c-scenario-library-v4';
const outputDirectory = path.join(RESULTS, profile.id, commitKey, seedKey);
const stagingDirectory = path.join(RESULTS, `.m4c-staging-${commitKey}-${seedKey}`);
for (const directory of [outputDirectory, stagingDirectory]) {
  try { await access(directory); throw new Error(`Immutable archive path already exists: ${directory}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await mkdir(stagingDirectory, { recursive: true });

const startedAt = performance.now();
const records = [];
for (const engine of ENGINE_IDS) for (const scenarioId of M4C_PRIORITY_IDS) {
  const scenario = instantiateM4CScenario(scenarioId, seed);
  const result = await runScenario(engine, scenario, { behaviorVersion: 'm4c', playerGeometry: profile.geometry,
    recordFrames: true, recordStride: 1 });
  const solverVersion = engine === 'rapier3d-compat'
    ? packageJson.devDependencies['@dimforge/rapier3d-compat'] : packageJson.devDependencies['jolt-physics'];
  const initialState = { players: scenario.players, football: scenario.carriedBall ?? scenario.looseBall ?? null,
    recoveryPolicy: scenario.recoveryPolicy ?? null, physicalInputs: { durationSeconds: scenario.durationSeconds,
      carrierId: scenario.carrierId ?? null, ballOriginId: scenario.ballOriginId ?? null, snapTargetId: scenario.snapTargetId ?? null,
      snapVelocityMps: scenario.snapVelocityMps ?? null, throwAtSeconds: scenario.throwAtSeconds ?? null,
      throwVelocityMps: scenario.throwVelocityMps ?? null },
    physicsMaterials: PHYSICS_MATERIALS,
    solverConfiguration: { rapierSolverIterations: 8,
      joltCollisionSteps: 1, joltSolverIterations: 'package default; not exposed by tested JS wrapper' } };
  const archiveMetadata = { milestone: 'M4c contact resolution, secure possession, and completed football outcomes',
    simulationVersion: profile.id, sourceCommit, solverVersion, playerGeometry: profile.geometry,
    playerGeometryVersion: 'fixed-five-part-rigid-compound-v1', controllerVersion: 'm4c-balance-wrap-two-point-cradle-v1',
    scenarioVersion, seed, timestepSeconds: result.timestepSeconds, initialState,
    physicalParameters: result.physicsParameters, recordedFrameStrideTicks: result.recordedFrameStrideTicks,
    frameSampleRateHz: 120 / result.recordedFrameStrideTicks };
  const payload = { archiveMetadata, initialState, replay: result };
  const filename = `${scenarioId}-seed-${seed}.json.gz`;
  const relativeResultPath = `${profile.id}/${commitKey}/${seedKey}/${engine}/${filename}`;
  const resultPath = path.join(stagingDirectory, engine, filename);
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 }));
  records.push({ scenarioId, scenarioTitle: scenario.title, category: scenario.category, seed, engine,
    status: 'completed', simulationVersion: profile.id, sourceCommit, solverVersion, path: `../results/${relativeResultPath}`,
    replayRateHz: archiveMetadata.frameSampleRateHz, replayFrameCount: result.frames.length, archivedAtFullPhysicsRate: true,
    outcome: result.outcome, diagnostics: result.diagnostics, penetration: result.penetration,
    contactOpportunities: result.contactOpportunities, runtime: result.runtime, events: result.events, contacts: result.contacts });
  console.log(JSON.stringify({ engine, scenarioId, steps: result.stepsCompleted, frames: result.frames.length,
    contacts: result.contacts.length, contactOpportunities: result.contactOpportunities.rows.length,
    maxPenetrationM: result.penetration.maximumDepthM, runtimeMs: Math.round(result.runtime.wallTimeMs) }));
}

const summary = { schemaVersion: 1, milestone: 'M4c', simulationVersion: profile, sourceCommit, scenarioVersion, seed,
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model,
    logicalCpuCount: os.cpus().length, wallTimeMs: performance.now() - startedAt, processRssBytes: process.memoryUsage().rss },
  engines: ENGINE_IDS, scenarioIds: M4C_PRIORITY_IDS, recordCount: records.length, records };
await writeFile(path.join(stagingDirectory, 'summary.json'), `${JSON.stringify(summary)}\n`);
await mkdir(path.dirname(outputDirectory), { recursive: true });
await rename(stagingDirectory, outputDirectory);

const manifestPath = path.join(RESULTS, 'archive-index.json');
let previous;
try { previous = JSON.parse(await readFile(manifestPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; previous = { records: [], profiles: [], cameras: {
  all22: { title: 'All-22 overview', position: [0, 19, 25], target: [0, 0.4, 0] },
  sideline: { title: 'Sideline / broadcast', position: [0, 5.5, 17], target: [0, 0.85, 0] },
  closeup: { title: 'Close-up contact', position: [3.4, 3.2, 5.4], target: [0.1, 1, 0] },
} }; }
const rowByKey = new Map((previous.records ?? []).map((row) =>
  [`${row.scenarioId}|${row.engine}|${row.simulationVersion}|${row.seed}|${row.sourceCommit}`, row]));
for (const row of records) rowByKey.set(`${row.scenarioId}|${row.engine}|${row.simulationVersion}|${row.seed}|${row.sourceCommit}`, row);
const profiles = [...(previous.profiles ?? []).filter((row) => row.id !== profile.id), profile];
const manifest = { ...previous, schemaVersion: 1, milestone: 'M4b/M4c research replay archive', generatedAt: new Date().toISOString(),
  profiles, activeProfileCommits: { ...(previous.activeProfileCommits ?? {}), [profile.id]: sourceCommit },
  scenarioCatalog: [...new Map([...(previous.scenarioCatalog ?? []).map((row) => [row.id, row]),
    ...M4C_PRIORITY_IDS.map((id) => { const s = instantiateM4CScenario(id, seed);
      return [s.id, { ...s, playerCount: s.players.length, carriedBall: Boolean(s.carriedBall) }]; })]).values()],
  records: [...rowByKey.values()].sort((a, b) => a.scenarioId.localeCompare(b.scenarioId)
    || a.engine.localeCompare(b.engine) || a.simulationVersion.localeCompare(b.simulationVersion)
    || a.sourceCommit.localeCompare(b.sourceCommit)),
  viewer: 'Open research/physics-3d-evaluation/m4b/archive/index.html from a local static web server at the repository root.' };
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ archive: outputDirectory, manifest: manifestPath, sourceCommit, recordCount: records.length,
  wallTimeMs: summary.runtime.wallTimeMs }, null, 2));
