import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SEED, VERSION_PROFILES } from './scenarios.mjs';
import { compareSignatures, ENGINE_IDS, runScenario } from './simulation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const RESULTS = path.join(HERE, 'results', 'sweeps');
const profileId = process.argv[2] ?? 'proxy-v1-single-capsule';
const profile = VERSION_PROFILES[profileId];
if (!profile) throw new Error(`Unknown simulation version: ${profileId}`);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
const commitKey = sourceCommit.slice(0, 10);
const seed = Number(process.argv[3] ?? DEFAULT_SEED);
const seedKey = `seed-${seed}`;
const outputDirectory = path.join(RESULTS, profileId, commitKey, seedKey);
const outputPath = path.join(outputDirectory, 'stress-sweep.json');
try { await access(outputPath); throw new Error(`Refusing to overwrite immutable sweep archive: ${outputPath}`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

function twoBodyFixture(id, title, configure = () => {}) {
  const scenario = {
    id: `sweep-${id}`, category: 'extreme-condition-sweep', title, seed, durationSeconds: 2.5,
    players: [
      { id: 'carrier', team: 'offense', p: [-0.9, 0.845, 0], v: [2, 0, 0], mass: 96, friction: 0.72, balanceScale: 0.8 },
      { id: 'defender', team: 'defense', p: [0.9, 0.845, 0], v: [-2, 0, 0], mass: 108, friction: 0.72, balanceScale: 0.8,
        yawRad: Math.PI, wrap: { enabled: true, capacityN: 1500, springNPerM: 4200, damperNsPerM: 440 } },
    ],
  };
  configure(scenario);
  return scenario;
}

const cases = [];
for (const angleDeg of [0, 30, 60, 90]) cases.push(twoBodyFixture(`angle-${angleDeg}`, `Controlled contact angle ${angleDeg} degrees`, (scenario) => {
  const rad = angleDeg * Math.PI / 180;
  scenario.players[0].p = [0, 0.845, 0]; scenario.players[0].v = [0, 0, 0];
  scenario.players[1].p = [1.5 * Math.cos(rad), 0.845, 1.5 * Math.sin(rad)];
  scenario.players[1].v = [-3.2 * Math.cos(rad), 0, -3.2 * Math.sin(rad)];
  scenario.inputSweep = { parameter: 'contact-angle-degrees', value: angleDeg };
}));
for (const closingSpeedMps of [2, 4, 8, 12]) cases.push(twoBodyFixture(`speed-${closingSpeedMps}`, `Closing velocity ${closingSpeedMps} m/s`, (scenario) => {
  scenario.players[0].v = [closingSpeedMps / 2, 0, 0]; scenario.players[1].v = [-closingSpeedMps / 2, 0, 0];
  scenario.inputSweep = { parameter: 'closing-velocity-m/s', value: closingSpeedMps };
}));
for (const massKg of [60, 96, 135, 180]) cases.push(twoBodyFixture(`mass-${massKg}`, `Carrier mass ${massKg} kg`, (scenario) => {
  scenario.players[0].mass = massKg; scenario.inputSweep = { parameter: 'carrier-mass-kg', value: massKg };
}));
for (const driveN of [0, 500, 1500, 4500]) cases.push(twoBodyFixture(`drive-${driveN}`, `Carrier drive ${driveN} N`, (scenario) => {
  scenario.players[0].drive = { forceN: [driveN, 0, 0], startSeconds: 0.4, endSeconds: 1.8 };
  scenario.inputSweep = { parameter: 'carrier-drive-force-n', value: driveN };
}));
for (const friction of [0.12, 0.4, 0.72, 1.15]) cases.push(twoBodyFixture(`traction-${friction}`, `Player/ground friction ${friction}`, (scenario) => {
  scenario.players[0].friction = friction; scenario.players[1].friction = friction;
  scenario.groundMaterial = { friction };
  scenario.inputSweep = { parameter: 'traction-friction-coefficient', value: friction };
}));
for (const balanceScale of [0, 0.5, 1, 2.5]) cases.push(twoBodyFixture(`balance-${balanceScale}`, `Balance controller scale ${balanceScale}`, (scenario) => {
  scenario.players[0].balanceScale = balanceScale; scenario.players[1].balanceScale = balanceScale;
  scenario.inputSweep = { parameter: 'balance-controller-scale', value: balanceScale };
}));
for (const strength of [40, 70, 100, 140]) cases.push(twoBodyFixture(`strength-${strength}`, `Strength input ${strength}`, (scenario) => {
  scenario.players[0].strength = strength; scenario.players[1].strength = strength;
  scenario.inputSweep = { parameter: 'strength-input', value: strength };
}));
for (const capacityN of [100, 500, 1500, 5000]) cases.push(twoBodyFixture(`grip-${capacityN}`, `Wrap proxy capacity ${capacityN} N`, (scenario) => {
  scenario.players[1].wrap.capacityN = capacityN;
  scenario.inputSweep = { parameter: 'wrap-capacity-n', value: capacityN };
}));

for (const delaySeconds of [0, 0.2, 0.45]) {
  const scenario = twoBodyFixture(`stagger-${delaySeconds}`, `Second defender activation delay ${delaySeconds} s`);
  scenario.players.push({ id: 'defender-2', team: 'defense', p: [2.8, 0.845, 0.72], v: [0, 0, 0], mass: 92, friction: 0.72,
    yawRad: Math.PI, balanceScale: 0.8, wrap: { enabled: true, capacityN: 1200 },
    drive: { forceN: [-650, 0, -180], startSeconds: delaySeconds, endSeconds: 2.3 } });
  scenario.inputSweep = { parameter: 'second-contact-delay-seconds', value: delaySeconds };
  cases.push(scenario);
}

for (const count of [2, 3, 4, 8, 12, 22]) {
  const players = [{ id: 'carrier', team: 'offense', p: [0, 0.845, 0], v: [0.8, 0, 0], mass: 96, friction: 0.72, balanceScale: 0.8 }];
  const radius = Math.max(1.35, count * 0.12);
  for (let i = 0; i < count - 1; i++) {
    const angle = (2 * Math.PI * i) / (count - 1);
    players.push({ id: `defender-${i + 1}`, team: 'defense', p: [Math.cos(angle) * radius, 0.845, Math.sin(angle) * radius],
      v: [-1.8 * Math.cos(angle), 0, -1.8 * Math.sin(angle)], mass: 88 + (i % 5) * 8,
      friction: 0.72, balanceScale: 0.8, yawRad: angle + Math.PI,
    });
  }
  cases.push({ id: `count-${count}`, category: 'extreme-condition-sweep', title: `${count}-player convergence`, seed, durationSeconds: 2.5,
    players, inputSweep: { parameter: 'player-count', value: count } });
}

const startedAt = performance.now();
const rows = [];
const repeatability = [];
for (const engine of ENGINE_IDS) for (const scenario of cases) {
  let result;
  try { result = await runScenario(engine, structuredClone(scenario), { playerGeometry: profile.geometry, recordFrames: true, recordStride: 30 }); }
  catch (error) {
    rows.push({ scenarioId: scenario.id, title: scenario.title, inputSweep: scenario.inputSweep, engine,
      simulationVersion: profile.id, sourceCommit, seed, status: 'failed', initialState: scenario.players,
      failure: { name: error.name, message: error.message, stack: error.stack } });
    console.log(JSON.stringify({ engine, scenarioId: scenario.id, status: 'failed', error: error.message }));
    continue;
  }
  const contactStarts = result.events.filter((event) => event.type === 'player_contact_started');
  rows.push({ scenarioId: result.scenarioId, title: result.scenarioTitle, inputSweep: scenario.inputSweep,
    engine, simulationVersion: profile.id, sourceCommit, seed, status: 'completed', durationSeconds: result.durationSeconds,
    initialState: { players: scenario.players, football: scenario.carriedBall ?? null, durationSeconds: scenario.durationSeconds },
    players: result.diagnostics.playerCount, contactPairs: result.contacts.length, contactEpisodes: contactStarts.length,
    maxPenetrationDepthM: result.diagnostics.maximumPenetrationDepthM,
    finite: result.diagnostics.finite, nonFinitePaths: result.diagnostics.nonFinitePaths,
    outcome: result.outcome, events: result.events, contacts: result.contacts, runtime: result.runtime,
    sampledTransforms: result.frames.map((frame) => ({ tick: frame.tick, timeSeconds: frame.timeSeconds,
      players: Object.fromEntries(Object.entries(frame.players).map(([id, state]) => [id, { positionM: state.positionM,
        rotation: state.rotation, linearVelocityMps: state.linearVelocityMps, angularVelocityRadPerSec: state.angularVelocityRadPerSec }])),
      football: frame.football ? { positionM: frame.football.positionM, rotation: frame.football.rotation,
        linearVelocityMps: frame.football.linearVelocityMps, angularVelocityRadPerSec: frame.football.angularVelocityRadPerSec,
        status: frame.football.status, controlledBy: frame.football.controlledBy } : null, diagnostics: frame.diagnostics,
      forcesNByPlayer: frame.forcesNByPlayer, torquesNmByPlayer: frame.torquesNmByPlayer, groundContacts: frame.groundContacts })),
    memoryHeapAfterBytes: result.diagnostics.memoryHeapAfterBytes });
  console.log(JSON.stringify({ engine, scenarioId: result.scenarioId, players: result.diagnostics.playerCount,
    contacts: result.contacts.length, finite: result.diagnostics.finite, runtimeMs: Number(result.runtime.wallTimeMs.toFixed(1)) }));

  if (scenario.id === 'sweep-speed-4') {
    try {
      const repeated = await runScenario(engine, structuredClone(scenario), { playerGeometry: profile.geometry, recordFrames: true, recordStride: 30 });
      repeatability.push({ engine, scenarioId: scenario.id, exactWithinProcess: compareSignatures(result, repeated), repeats: 2 });
    } catch (error) { repeatability.push({ engine, scenarioId: scenario.id, exactWithinProcess: false, failure: error.message }); }
  }
}

const sweep = { schemaVersion: 1, milestone: 'M4b extreme-condition contact sweep', simulationVersion: profile,
  sourceCommit, seed, timestepSeconds: 1 / 120, durationSeconds: 2.5,
  sweepDimensions: ['player count', 'contact angle', 'closing velocity', 'player mass', 'drive force', 'strength', 'traction',
    'balance control scale', 'wrap capacity', 'simultaneous/staggered contact timing'],
  inputCount: cases.length, runs: rows.length, repeatability,
  method: { stochasticOutcomeDraw: false, numericalReproducibility: 'same process, same fixture, exact result signature for 4 m/s control cell',
    impulseEstimates: 'contact impulses use solver reporting when available; otherwise relative-velocity estimates explicitly retain multi-contact and external-force confounds',
    energy: 'full scenario replays store per-body kinetic/potential energy and applied-force traces; sweep outputs store events and system stability summaries' },
  runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model,
    wallTimeMs: performance.now() - startedAt, rssBytes: process.memoryUsage().rss },
  results: rows };
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(sweep)}\n`, { flag: 'wx' });
const manifestPath = path.join(HERE, 'results', 'archive-index.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const stressSweeps = new Map((manifest.stressSweeps ?? []).map((row) => [`${row.simulationVersion}|${row.sourceCommit}|${row.seed}`, row]));
stressSweeps.set(`${profile.id}|${sourceCommit}|${seed}`, { simulationVersion: profile.id, sourceCommit, seed,
  path: `../results/sweeps/${profile.id}/${commitKey}/${seedKey}/stress-sweep.json`, cases: cases.length, engineRuns: rows.length,
  finiteRuns: rows.filter((row) => row.finite).length, repeatability, status: 'completed' });
manifest.stressSweeps = [...stressSweeps.values()];
manifest.generatedAt = new Date().toISOString();
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, inputCount: cases.length, runCount: rows.length,
  nonFiniteRuns: rows.filter((row) => !row.finite).length, repeatability, wallTimeMs: sweep.runtime.wallTimeMs }, null, 2));
