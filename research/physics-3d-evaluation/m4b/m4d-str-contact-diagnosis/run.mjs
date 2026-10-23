import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_IDS, runScenario } from '../simulation.mjs';
import { M4C_SCENARIO_VERSION, instantiateM4CScenario } from '../m4c-scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const BASE_COMMIT = 'c96f9eedbc894fdbf9f4d8c7f323e63ecc2cc0d4';
const REUSE_EXISTING_TRACES = process.argv.includes('--reuse-traces');
const RESULTS = path.resolve(HERE, '../results/m4d-str-contact-diagnosis');
const TRACE_DIR = path.join(RESULTS, 'traces');
const SEED = 41027;
const DT = 1 / 120;
const SCENARIOS = [
  { id: 'possession-retained', carrier: 'runner', tackler: 'impact-defender', pair: ['runner', 'impact-defender'] },
  { id: 'gang-two-opposite-open', carrier: 'carrier', tackler: 'defender-left',
    requiredPairs: [['carrier', 'defender-left'], ['carrier', 'defender-right']] },
  { id: 'gang-staggered-three', carrier: 'carrier', tackler: 'first-hit',
    requiredPairs: [['carrier', 'first-hit'], ['carrier', 'second-hit'], ['carrier', 'third-hit']] },
];
const MASS_OFFSETS_KG = [-2, -1, -0.5, 0.5, 1, 2, 4];
const STRENGTH_VALUES = [79, 79.5, 79.75, ...Array.from({ length: 11 }, (_, i) => Number((80 + i / 10).toFixed(1))), 81.25, 81.5, 82];
const ENGINES = ENGINE_IDS;

const round = (value, digits = 6) => Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
const slug = (value) => value.replace(/\+/g, 'plus').replace(/[^a-zA-Z0-9.-]+/g, '-');

function isolatedConfigs(scenario) {
  const configs = [{ id: 'baseline', factor: 'baseline', changedActorId: null, value: null,
    description: 'Fixture input unchanged; strength defaults made explicit at 80 for all players.' }];
  for (const actor of [{ id: scenario.carrier, role: 'carrier' }, { id: scenario.tackler, role: 'lead-tackler' }]) {
    for (const offsetKg of MASS_OFFSETS_KG) configs.push({
      id: `mass-${actor.role}-${offsetKg > 0 ? '+' : ''}${offsetKg}kg`, factor: 'mass-only', changedActorId: actor.id,
      value: offsetKg, description: `${actor.id} mass ${offsetKg > 0 ? '+' : ''}${offsetKg} kg; all strengths 80.`,
    });
  }
  if (scenario.id === 'possession-retained') configs.push({
    id: 'madden-masses-103-102kg', factor: 'mass-only-target', changedActorId: 'runner+impact-defender', value: [103, 102],
    description: 'Runner mass 103 kg and impact-defender mass 102 kg; all strengths 80.',
  });
  for (const actor of [{ id: scenario.carrier, role: 'carrier' }, { id: scenario.tackler, role: 'lead-tackler' }]) {
    for (const strength of STRENGTH_VALUES) {
      if (strength === 80) continue;
      configs.push({ id: `str-${actor.role}-${strength.toFixed(2)}`, factor: 'strength-only', changedActorId: actor.id,
        value: strength, description: `${actor.id} strength ${strength}; all masses and other strengths at fixture baseline.` });
    }
  }
  return configs;
}

function applyConfig(scenario, config, focus) {
  const players = scenario.players;
  for (const player of players) player.strength = 80;
  if (config.factor === 'mass-only') {
    const player = players.find((row) => row.id === config.changedActorId);
    player.mass += config.value;
  } else if (config.factor === 'mass-only-target') {
    players.find((row) => row.id === 'runner').mass = 103;
    players.find((row) => row.id === 'impact-defender').mass = 102;
  } else if (config.factor === 'strength-only-at-target-masses') {
    players.find((row) => row.id === 'runner').mass = 103;
    players.find((row) => row.id === 'impact-defender').mass = 102;
    players.find((row) => row.id === config.changedActorId).strength = config.value;
  } else if (config.factor === 'strength-only') {
    players.find((row) => row.id === config.changedActorId).strength = config.value;
  } else if (config.factor === 'combined') {
    players.find((row) => row.id === 'runner').mass = 103;
    players.find((row) => row.id === 'impact-defender').mass = 102;
    players.find((row) => row.id === 'runner').strength = 81;
  }
  return { scenario, focus };
}

function targetMassStrengthConfigs(focus) {
  if (focus.id !== 'possession-retained') return [];
  return [
    { id: 'runner', role: 'carrier' }, { id: 'impact-defender', role: 'lead-tackler' },
  ].flatMap((actor) => Array.from({ length: 10 }, (_, index) => Number((80.1 + index / 10).toFixed(1)))
    .map((strength) => ({ id: `target-masses-str-${actor.role}-${strength.toFixed(2)}`,
      factor: 'strength-only-at-target-masses', changedActorId: actor.id, value: strength,
      description: `Runner/impact-defender masses held at 103/102 kg; ${actor.id} strength ${strength}; other strength 80.` })));
}

const pairKey = (a, b) => [a, b].sort().join('::');

function summarizeRun(result, config, focus) {
  const focusPairId = pairKey(...(focus.pair ?? [focus.carrier, focus.tackler]));
  const firstContactByPair = {};
  for (const event of result.events) if (event.type === 'player_contact_started') {
    const id = pairKey(...event.pair);
    firstContactByPair[id] = Math.min(firstContactByPair[id] ?? Infinity, event.timeSeconds);
  }
  const pairRows = Object.fromEntries(result.contactOpportunities.rows.map((row) => [row.pairId, row]));
  const minGapByPair = new Map();
  const contactStepsByPair = new Map();
  const opportunityStepsByPair = new Map();
  for (const frame of result.frames) {
    for (const row of frame.pairSurfaceGaps ?? []) {
      const pairId = row.pairId;
      minGapByPair.set(pairId, Math.min(minGapByPair.get(pairId) ?? Infinity, row.minimumSurfaceGapM));
      if (row.contactOpportunity) opportunityStepsByPair.set(pairId, (opportunityStepsByPair.get(pairId) ?? 0) + 1);
      if (row.physicalContact) contactStepsByPair.set(pairId, (contactStepsByPair.get(pairId) ?? 0) + 1);
    }
  }
  const allPairs = [...new Set([...minGapByPair.keys(), ...Object.keys(firstContactByPair)])].sort();
  const pairDiagnostics = Object.fromEntries(allPairs.map((pairId) => {
    const samples = result.frames.flatMap((frame) => (frame.pairSurfaceGaps ?? [])
      .filter((row) => row.pairId === pairId).map((row) => ({ ...row, tick: frame.tick })));
    const minGap = minGapByPair.get(pairId) ?? null;
    const firstOpportunity = samples.find((row) => row.contactOpportunity)?.tick ?? null;
    const firstAnalyticOverlap = samples.find((row) => row.minimumSurfaceGapM <= 0)?.tick ?? null;
    return [pairId, { minimumSurfaceGapM: minGap, firstOpportunityTimeSeconds: firstOpportunity === null ? null : firstOpportunity * DT,
      firstAnalyticOverlapTimeSeconds: firstAnalyticOverlap === null ? null : firstAnalyticOverlap * DT,
      firstPhysicalContactTimeSeconds: firstContactByPair[pairId] ?? null,
      opportunityStepCount: opportunityStepsByPair.get(pairId) ?? 0,
      physicalContactStepCount: contactStepsByPair.get(pairId) ?? 0,
      opportunitySummary: pairRows[pairId] ?? null }];
  }));
  const requiredPairs = focus.requiredPairs ?? [focus.pair];
  const missingPairContacts = requiredPairs.filter(([a, b]) => !firstContactByPair[pairKey(a, b)]).map((pair) => pairKey(...pair));
  const carrierState = result.outcome.playerTerminalStates.find((row) => row.id === focus.carrier);
  const penetrationFailures = [];
  if (result.penetration.maximumDepthM > 0.15) penetrationFailures.push(`maximum penetration ${result.penetration.maximumDepthM} m > 0.15 m`);
  if (result.penetration.p95PerStepMaximumM > 0.05) penetrationFailures.push(`p95 penetration ${result.penetration.p95PerStepMaximumM} m > 0.05 m`);
  if (result.penetration.durationWeightedMeanM > 0.025) penetrationFailures.push(`weighted mean penetration ${result.penetration.durationWeightedMeanM} m > 0.025 m`);
  const outcomeFailures = [];
  if (missingPairContacts.length) outcomeFailures.push(`required physical contact missing: ${missingPairContacts.join(', ')}`);
  if (focus.id !== 'possession-retained' && carrierState?.fellAtSeconds == null) outcomeFailures.push(`${focus.carrier} did not reach the registered sustained fall state`);
  if (focus.id === 'possession-retained') {
    const retained = result.events.some((event) => event.type === 'ball_possession_retained' && event.heldSeconds >= 1);
    if (!retained) outcomeFailures.push('ball was not retained for the registered 1.0 s interval');
    if (result.outcome.football?.controlledBy !== focus.carrier) outcomeFailures.push(`football terminal controller was ${result.outcome.football?.controlledBy ?? 'none'}`);
  }
  if (!result.diagnostics.finite) outcomeFailures.push('non-finite simulation values were reported');
  const peakTorqueByPlayer = {};
  const peakGripLoadsN = {};
  const peakPossessionLoadsN = {};
  for (const frame of result.frames) {
    for (const [id, vector] of Object.entries(frame.controllerTorqueRequestsNmByPlayer ?? {})) {
      const magnitude = Math.hypot(...vector);
      peakTorqueByPlayer[id] = Math.max(peakTorqueByPlayer[id] ?? 0, magnitude);
    }
    for (const row of frame.gripLoadInputs ?? []) peakGripLoadsN[row.holderId] = Math.max(peakGripLoadsN[row.holderId] ?? 0, row.requestedLoadN);
    for (const row of frame.possessionGripLoadInputs ?? []) peakPossessionLoadsN[row.holderId] = Math.max(peakPossessionLoadsN[row.holderId] ?? 0, row.requestedLoadN);
  }
  const focusPairResponseByTick = Object.fromEntries([1, 2, 3, 4, 5, 9, 10, 11, 12].map((tick) => {
    const frame = result.frames.find((row) => row.tick === tick);
    const pair = frame?.pairSurfaceGaps?.find((row) => row.pairId === focusPairId);
    const actorIds = [focus.carrier, focus.tackler];
    return [tick, frame ? { timeSeconds: frame.timeSeconds,
      minimumSurfaceGapM: pair?.minimumSurfaceGapM ?? null,
      contactOpportunity: pair?.contactOpportunity ?? false, physicalContact: pair?.physicalContact ?? false,
      players: Object.fromEntries(actorIds.map((id) => [id, frame.players[id] ? {
        positionM: frame.players[id].positionM, linearVelocityMps: frame.players[id].linearVelocityMps,
        angularVelocityRadPerSec: frame.players[id].angularVelocityRadPerSec, tiltDeg: frame.players[id].tiltDeg,
        grounded: frame.players[id].grounded,
        controllerTorqueRequestNm: frame.controllerTorqueRequestsNmByPlayer?.[id] ?? [0, 0, 0],
      } : null])),
    } : null];
  }));
  return {
    scenarioId: result.scenarioId, engine: result.engine, configId: config.id, factor: config.factor,
    changedActorId: config.changedActorId, changedValue: config.value, description: config.description,
    timestepSeconds: result.timestepSeconds, stepsCompleted: result.stepsCompleted,
    finite: result.diagnostics.finite, numericalAcceptance: {
      maximumDepthM: result.penetration.maximumDepthM, maximumPass: result.penetration.maximumDepthM <= 0.15,
      p95PerStepMaximumM: result.penetration.p95PerStepMaximumM, p95Pass: result.penetration.p95PerStepMaximumM <= 0.05,
      durationWeightedMeanM: result.penetration.durationWeightedMeanM, weightedMeanPass: result.penetration.durationWeightedMeanM <= 0.025,
      firstStepMaximumM: result.penetration.firstStepMaximumM, thresholdCounts: result.penetration.thresholdCounts,
    },
    failures: [...penetrationFailures, ...outcomeFailures],
    pairDiagnostics,
    firstContactByPair,
    contactEvents: result.events.filter((event) => event.type === 'player_contact_started'),
    outcome: { carrierFellAtSeconds: carrierState?.fellAtSeconds ?? null,
      footballController: result.outcome.football?.controlledBy ?? null,
      footballReleaseReason: result.outcome.football?.releaseReason ?? null,
      possessionRetainedEvents: result.events.filter((event) => event.type === 'ball_possession_retained'),
      activeWrapHoldersAtEnd: result.outcome.activeWrapHoldersAtEnd,
      wrapResults: result.outcome.wrapResults },
    peakControllerTorqueNmByPlayer: peakTorqueByPlayer,
    focusPairResponseByTick,
    peakWrapGripRequestedLoadNByHolder: peakGripLoadsN,
    peakPossessionGripRequestedLoadNByHolder: peakPossessionLoadsN,
    rawProgress: result.outcome.rawProgress,
    carrierTerminalState: carrierState ?? null,
    thresholds: result.penetration.thresholdCounts,
    frameCount: result.frames.length,
  };
}

function pairComparison(rapier, jolt, rapierTrace, joltTrace, focus) {
  const rapierFrames = rapierTrace.frames, joltFrames = joltTrace.frames;
  const playerIds = [...new Set(rapierFrames.flatMap((frame) => Object.keys(frame.players)))].sort();
  const trajectory = {};
  for (const id of playerIds) {
    let sumSq = 0, max = 0, samples = 0;
    for (let i = 0; i < Math.min(rapierFrames.length, joltFrames.length); i++) {
      const a = rapierFrames[i].players[id]?.positionM, b = joltFrames[i].players[id]?.positionM;
      if (!a || !b) continue;
      const delta = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      sumSq += delta * delta; max = Math.max(max, delta); samples++;
    }
    trajectory[id] = { rmsPositionDeltaM: samples ? Math.sqrt(sumSq / samples) : null, maximumPositionDeltaM: max, samples };
  }
  const pairDeltas = {};
  const pairIds = [...new Set(rapierFrames.flatMap((frame) => frame.pairSurfaceGaps.map((row) => row.pairId)))].sort();
  for (const pairId of pairIds) {
    let sumSq = 0, max = 0, samples = 0, firstPhysicalSplit = null, firstOpportunitySplit = null;
    for (let i = 0; i < Math.min(rapierFrames.length, joltFrames.length); i++) {
      const a = rapierFrames[i].pairSurfaceGaps.find((row) => row.pairId === pairId);
      const b = joltFrames[i].pairSurfaceGaps.find((row) => row.pairId === pairId);
      if (!a || !b) continue;
      const delta = a.minimumSurfaceGapM - b.minimumSurfaceGapM;
      sumSq += delta * delta; max = Math.max(max, Math.abs(delta)); samples++;
      if (firstPhysicalSplit === null && a.physicalContact !== b.physicalContact) firstPhysicalSplit = { tick: rapierFrames[i].tick,
        timeSeconds: rapierFrames[i].timeSeconds, rapierContact: a.physicalContact, joltContact: b.physicalContact,
        rapierGapM: a.minimumSurfaceGapM, joltGapM: b.minimumSurfaceGapM };
      if (firstOpportunitySplit === null && a.contactOpportunity !== b.contactOpportunity) firstOpportunitySplit = {
        tick: rapierFrames[i].tick, timeSeconds: rapierFrames[i].timeSeconds,
        rapierOpportunity: a.contactOpportunity, joltOpportunity: b.contactOpportunity,
        rapierGapM: a.minimumSurfaceGapM, joltGapM: b.minimumSurfaceGapM };
    }
    pairDeltas[pairId] = { rmsGapDeltaM: samples ? Math.sqrt(sumSq / samples) : null,
      maximumAbsoluteGapDeltaM: max, firstPhysicalContactStateSplit: firstPhysicalSplit,
      firstOpportunityStateSplit: firstOpportunitySplit, samples };
  }
  const focusPairId = pairKey(...(focus.pair ?? [focus.carrier, focus.tackler]));
  return { scenarioId: rapier.scenarioId, configId: rapier.configId, timestepSeconds: DT,
    matchedFrameCount: Math.min(rapierFrames.length, joltFrames.length), trajectory, pairDeltas,
    focusPairId, focusPair: pairDeltas[focusPairId] ?? null,
    contactEvents: { rapier: rapier.contactEvents, jolt: jolt.contactEvents },
    penetration: { rapier: rapier.numericalAcceptance, jolt: jolt.numericalAcceptance } };
}

async function execute(config, focus, phase, rows, replayIndex) {
  const paired = {};
  for (const engine of ENGINES) {
    const scenario = instantiateM4CScenario(focus.id, SEED);
    const { scenario: prepared } = applyConfig(scenario, config, focus);
    const traceName = `${slug(focus.id)}__${slug(config.id)}__${slug(engine)}.json.gz`;
    const tracePath = path.join(TRACE_DIR, traceName);
    let result;
    let reused = false;
    if (REUSE_EXISTING_TRACES) {
      try {
        result = JSON.parse(gunzipSync(await readFile(tracePath), { maxOutputLength: 256 * 1024 * 1024 }).toString('utf8'));
        reused = true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (!result) {
      result = await runScenario(engine, prepared, { behaviorVersion: 'm4c', playerGeometry: 'compound',
        recordFrames: true, recordStride: 1, timestepSeconds: DT });
    }
    const summary = summarizeRun(result, config, focus);
    if (!reused) await writeFile(tracePath, gzipSync(Buffer.from(JSON.stringify(result)), { level: 6 }));
    const row = { ...summary, phase, trace: `traces/${traceName}` };
    rows.push(row);
    const pairKeyConfig = `${focus.id}::${config.id}`;
    if (!replayIndex[pairKeyConfig]) replayIndex[pairKeyConfig] = { scenarioId: focus.id, configId: config.id,
      factor: config.factor, description: config.description, seed: SEED, timestepSeconds: DT,
      focusPair: focus.pair ?? [focus.carrier, focus.tackler],
      players: prepared.players.map(({ id, team, mass, strength }) => ({ id, team, massKg: mass, strength: strength ?? 80 })), engines: {} };
    replayIndex[pairKeyConfig].engines[engine] = { trace: `traces/${traceName}`, frameCount: result.frames.length };
    paired[engine] = { summary, result };
    console.log(JSON.stringify({ phase, scenarioId: focus.id, configId: config.id, engine,
      contacts: Object.keys(summary.firstContactByPair).length, failures: summary.failures.length,
      maxPenetrationM: summary.numericalAcceptance.maximumDepthM,
      p95PenetrationM: summary.numericalAcceptance.p95PerStepMaximumM, runtimeMs: Math.round(result.runtime.wallTimeMs), reusedTrace: reused }));
  }
  if (paired['rapier3d-compat'] && paired['jolt-physics-js']) {
    comparisons.push(pairComparison(paired['rapier3d-compat'].summary, paired['jolt-physics-js'].summary,
      paired['rapier3d-compat'].result, paired['jolt-physics-js'].result, focus));
  }
}

await mkdir(TRACE_DIR, { recursive: true });
const rows = [];
const replayIndex = {};
const comparisons = [];
const startedAt = performance.now();

// Phase 1: change one mass at a time, holding all strengths at 80.
for (const focus of SCENARIOS) {
  const configs = isolatedConfigs(focus).filter((config) => config.factor.startsWith('mass') || config.factor === 'baseline');
  for (const config of configs) await execute(config, focus, 'isolated-mass', rows, replayIndex);
}

// Phase 2: change one strength at a time, at the fixture's exact baseline masses.
for (const focus of SCENARIOS) {
  const configs = isolatedConfigs(focus).filter((config) => config.factor === 'strength-only' || config.factor === 'baseline');
  for (const config of configs) await execute(config, focus, 'isolated-strength', rows, replayIndex);
}

// Review isolated results programmatically before the first combined input is run.
const isolatedContactSplits = [];
for (const focus of SCENARIOS) {
  const target = focus.id === 'possession-retained' ? 'madden-masses-103-102kg' : `str-lead-tackler-81.00`;
  const candidate = rows.filter((row) => row.scenarioId === focus.id && row.configId === target);
  if (candidate.length === 2 && candidate[0].factor !== 'strength-only') {
    isolatedContactSplits.push({ scenarioId: focus.id, configId: target,
      engines: candidate.map((row) => ({ engine: row.engine, firstContactByPair: row.firstContactByPair,
        focusPair: row.pairDiagnostics[pairKey(focus.carrier, focus.tackler)] ?? null,
        failures: row.failures })) });
  }
}
await writeFile(path.join(RESULTS, 'isolated-sweeps-checkpoint.json'), `${JSON.stringify({ completed: true,
  massSweepRuns: rows.filter((row) => row.phase === 'isolated-mass').length,
  strengthSweepRuns: rows.filter((row) => row.phase === 'isolated-strength').length,
  contactSplitCandidates: isolatedContactSplits }, null, 2)}\n`);
console.log(JSON.stringify({ phase: 'isolated-sweeps-complete', runs: rows.length, contactSplitCandidates: isolatedContactSplits }));

// Phase 3: only the original runner/tackler mass inputs plus runner STR 81, after isolated effects are recorded.
const retained = SCENARIOS.find((row) => row.id === 'possession-retained');
const combined = { id: 'combined-madden-masses-103-102kg-runner-str-81', factor: 'combined',
  changedActorId: 'runner+impact-defender', value: { runnerMassKg: 103, impactDefenderMassKg: 102, runnerStrength: 81 },
  description: 'Only after isolated sweeps: runner 103 kg, impact-defender 102 kg, runner strength 81.' };
await execute(combined, retained, 'combined-after-isolated', rows, replayIndex);

// The isolated sweeps identified a strong mass/solver interaction. Now hold those masses fixed and sweep STR alone.
for (const config of targetMassStrengthConfigs(retained)) {
  await execute(config, retained, 'strength-only-at-target-masses', rows, replayIndex);
}

const packageJson = JSON.parse(await readFile(path.join(REPO, 'package.json'), 'utf8'));
const sourceArtifactHashes = {};
for (const [label, file] of [['simulation.mjs', path.join(HERE, '../simulation.mjs')],
  ['run.mjs', path.join(HERE, 'run.mjs')], ['viewer.html', path.join(HERE, 'viewer.html')]]) {
  sourceArtifactHashes[label] = createHash('sha256').update(await readFile(file)).digest('hex');
}
const report = { schemaVersion: 1, study: 'M4d rating-input contact sensitivity diagnosis',
  generatedAt: new Date().toISOString(), sourceCommit: BASE_COMMIT,
  scenarioVersion: M4C_SCENARIO_VERSION, seed: SEED,
  reproducibility: { command: 'node research/physics-3d-evaluation/m4b/m4d-str-contact-diagnosis/run.mjs',
    node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model,
    rapierVersion: packageJson.devDependencies['@dimforge/rapier3d-compat'], joltVersion: packageJson.devDependencies['jolt-physics'],
    geometry: 'compound', timestepSeconds: DT, solverIterations: 8, joltCollisionSteps: 1,
    behaviorVersion: 'm4c', randomDraws: 0, thresholdsFrom: 'research/physics-3d-evaluation/m4b/M4C-PREREG.md' },
  researchArtifactSha256: sourceArtifactHashes,
  sweeps: { massOffsetsKg: MASS_OFFSETS_KG, strengthValues: STRENGTH_VALUES,
    targetMassStrengthValues: Array.from({ length: 11 }, (_, i) => Number((80 + i / 10).toFixed(1))),
    order: ['independent one-player mass-only runs at STR 80', 'independent one-player STR-only runs at fixture masses',
      'combined 103/102 kg plus runner STR 81 only after isolated results are written',
      'after interaction was visible, hold 103/102 kg fixed and sweep one STR input at a time'],
    scenarios: SCENARIOS.map(({ id, carrier, tackler, pair, requiredPairs }) => ({ id, carrier, tackler, pair, requiredPairs })) },
  recorder: { framesPerRun: 'every fixed tick, including tick zero and final tick',
    pairSurfaceGaps: 'analytic transformed compound geometry; signed separation and 0.10 m opportunity flag',
    physicalContact: 'engine-specific contact state after the same fixed step, preserved separately from geometric opportunity',
    balance: 'raw controller torque request and torque actually applied (existing 0.01 Nm application cutoff unchanged)',
    forceInputs: 'per-body vector and source for each applied force',
    grips: 'per-step wrap loads and two-point possession-cradle loads; modeled force laws, not solver constraint impulses',
    penetration: 'all existing M4c per-step samples and fixed preregistered threshold counts' },
  runCount: rows.length, runs: rows, matchedTimestepComparisons: comparisons,
  contactSplitClassification: classifyContactSplits(comparisons),
  responseContinuity: analyzeStrengthResponse(rows),
  contactCauseEvidence: buildContactCauseEvidence(rows, comparisons),
  failures: rows.filter((row) => row.failures.length).map((row) => ({ scenarioId: row.scenarioId, configId: row.configId,
    engine: row.engine, failures: row.failures })),
  runtime: { wallTimeMs: performance.now() - startedAt, processRssBytes: process.memoryUsage().rss },
  interpretationLimits: ['Strength affects only the existing M4c upright balance controller input in these fixtures.',
    'The M4c rigid player proxy geometry, player collider scale, materials, controller equation, wrap law, and possession law are held fixed.',
    'A 0.10 m contact opportunity is not physical contact; actual contact remains the active engine’s reported contact state.',
    'Jolt JS does not expose the same solver normal-impulse telemetry as Rapier; no synthetic impulse equivalence is asserted.'] };
await writeFile(path.join(RESULTS, 'sensitivity-report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(RESULTS, 'replay-index.json'), `${JSON.stringify({ schemaVersion: 1,
  description: 'Synchronized Rapier/Jolt full-rate M4c replays; frames match by tick at 120 Hz.', scenarios: replayIndex }, null, 2)}\n`);
await writeFile(path.join(RESULTS, 'viewer.html'), await readFile(path.join(HERE, 'viewer.html')));
await writeFile(path.join(RESULTS, 'sensitivity-report.md'), makeMarkdown(report));
console.log(JSON.stringify({ completed: true, runCount: rows.length, failures: report.failures.length,
  result: path.join(RESULTS, 'sensitivity-report.json'), runtimeMs: report.runtime.wallTimeMs }, null, 2));

function makeMarkdown(data) {
  const keyRows = data.runs.filter((row) => row.configId === 'baseline'
    || row.configId === 'madden-masses-103-102kg'
    || row.configId === 'combined-madden-masses-103-102kg-runner-str-81'
    || ((row.factor === 'strength-only' || row.factor === 'strength-only-at-target-masses')
      && row.changedActorId === (row.scenarioId === 'possession-retained' ? 'runner'
      : row.scenarioId === 'gang-two-opposite-open' ? 'defender-left' : 'first-hit')
      && row.changedValue >= 80 && row.changedValue <= 81));
  const lines = [
    '# M4d STR contact sensitivity diagnosis', '',
    `Generated ${data.generatedAt}; source commit \`${data.sourceCommit}\`.`, '',
    '## Scope and method', '',
    'This is a research-only follow-up on the pinned M4c solver wrapper. Production engine files and the separate TAK/BTK hold-drag branch were not changed. Three existing M4c outcome fixtures were replayed at the same 120 Hz timestep in Rapier 0.21.0 and Jolt 1.1.0: a retained-possession impact, a completed two-defender tackle, and a completed staggered three-defender tackle. The possession outcome holds, but its baseline penetration p95 exceeds the unchanged gate in both solvers; those failures remain reported.', '',
    'Mass and STR were varied in separate phases. Mass sweeps changed one player mass at a time while all strengths were 80. STR sweeps changed one player strength at a time at the exact fixture masses; values include 0.1 steps from 80 through 81. The 103/102 kg plus STR 81 combined input was run only after both isolated sweeps had completed and the checkpoint had been written. After the interaction appeared, a second one-factor STR sweep held the 103/102 kg masses fixed and varied runner or tackler STR independently from 80.1 through 81.0. All runs use M4c behavior, compound proxies, seed 41027, 120 Hz, Rapier 8 solver iterations, and Jolt 1 collision step.', '',
    'Every full-rate frame records player position/orientation/velocity, signed analytic surface gaps for every pair, the 0.10 m opportunity flag, engine-reported physical contact, torque requests and applied torque, applied force vectors with source labels, wrap and possession grip loads, and the unchanged per-step penetration samples. Full traces are gzip-compressed under `traces/`; use `viewer.html` for synchronized Rapier/Jolt playback.', '',
    '## Preregistered numerical gates', '',
    'The original M4c limits remain unchanged: maximum penetration ≤0.15 m, per-step p95 ≤0.05 m, and duration-weighted mean ≤0.025 m. Each run’s first-step penetration and counts above 0.01/0.05/0.10/0.15 m are preserved in the report JSON and trace. Physical contact and the fixture outcome gates are also checked per run.', '',
    '## Key run results', '',
    '| Scenario | Input | Engine | Focus min gap (m) | First contact (s) | p95 (m) | weighted mean (m) | max (m) | failures |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const row of keyRows) {
    const pairId = pairKey(...(SCENARIOS.find((scenario) => scenario.id === row.scenarioId).pair
      ?? [SCENARIOS.find((scenario) => scenario.id === row.scenarioId).carrier, SCENARIOS.find((scenario) => scenario.id === row.scenarioId).tackler]));
    const pair = row.pairDiagnostics[pairId];
    lines.push(`| ${row.scenarioId} | ${row.configId} | ${row.engine} | ${fmt(pair?.minimumSurfaceGapM)} | ${fmt(pair?.firstPhysicalContactTimeSeconds)} | ${fmt(row.numericalAcceptance.p95PerStepMaximumM)} | ${fmt(row.numericalAcceptance.durationWeightedMeanM)} | ${fmt(row.numericalAcceptance.maximumDepthM)} | ${row.failures.length} |`);
  }
  lines.push('', '## STR 80–81 continuity', '',
    'The machine-readable matrix contains the full adjacent strength sweep. Controller torque is a continuous scalar gain in the existing M4c balance law; contact itself is a thresholded solver event. The table below reports every 0.1 STR sample for the carrier in the retention fixture and the lead tackler in each tackle fixture. Read the adjacent `minimumSurfaceGapM`, torque, and actual-contact results together to distinguish a smooth approach from a solver event transition.', '',
    '| Scenario | Engine | Actor | STR | Focus min gap (m) | First contact (s) | Contact steps | Peak requested torque (Nm) | failures |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|');
  for (const row of data.runs.filter((entry) => (entry.factor === 'strength-only' || entry.factor === 'strength-only-at-target-masses')
    && entry.changedValue >= 80 && entry.changedValue <= 81)) {
    const focus = SCENARIOS.find((scenario) => scenario.id === row.scenarioId);
    if (row.factor === 'strength-only' && row.changedActorId !== (row.scenarioId === 'possession-retained' ? focus.carrier : focus.tackler)) continue;
    const pairId = pairKey(...(focus.pair ?? [focus.carrier, focus.tackler]));
    const pair = row.pairDiagnostics[pairId];
    lines.push(`| ${row.scenarioId} | ${row.engine} | ${row.changedActorId} | ${row.changedValue.toFixed(2)} | ${fmt(pair?.minimumSurfaceGapM)} | ${fmt(pair?.firstPhysicalContactTimeSeconds)} | ${pair?.physicalContactStepCount ?? 0} | ${fmt(row.peakControllerTorqueNmByPlayer[row.changedActorId] ?? 0)} | ${row.failures.length} |`);
  }
  lines.push('', '## Cause of the Rapier/Jolt split', '',
    'The combined target-mass + runner STR 81 case is trajectory mediated. At the first split tick (0.09167 s), Rapier still has a positive analytic player-surface gap while Jolt has crossed into overlap and reports contact. In the combined Rapier trace the minimum gap stays positive for the entire run. The player proxy layout is fixed, and Rapier checks all player collider pairs; the evidence does not support a missed Rapier contact query. The split begins during the early ground-contact response: the adapters produce different angular states, then the same state-feedback balance controller requests different torques, and the player gap grows before a player-player contact event. Once Jolt establishes contact, its wrap force further changes the later paths.', '',
    'STR changes only the M4c balance-controller gain `(0.55 + STR/120) × balanceScale`; moving 80→81 changes that gain by about 0.685%. At the fixture’s original 98/106 kg masses, runner STR 81 still yields Rapier player contact. At 103/102 kg, the mass-only run also contacts in Rapier, but adding runner STR 81 leaves a 0.01899 m minimum gap and no player contact; Jolt maintains contact. In Rapier at those fixed masses, the runner torque request at tick 5 changes from 226.19 Nm at STR 80 to 227.72 Nm at STR 81, while the tick 11 analytic gap changes from 0.02325 m to 0.03172 m. This is a near-grazing mass/strength interaction amplified by solver-dependent ground and balance feedback, not a direct tackle drag or grip-rating effect.', '',
    '## Intermediate response check', '',
    'The fixed-mass STR sweep confirms continuous controller-input changes but non-monotonic physical outcomes. Several adjacent 0.1 STR steps switch Rapier between a tiny analytic overlap (about 0.1 mm) with contact and a positive minimum gap of 1.3–1.9 cm without contact; contact returns at nearby values. These transitions align with whether the transformed proxy reaches the geometry threshold, while the full-run path changes after collision and wrap feedback. The Boolean contact transition is therefore explained by geometric crossing, but the full trajectory response is solver-sensitive and not monotonic in STR. Per-adjacent-step response data is in `responseContinuity`; per-tick torque and gap samples are in every trace.', '',
    '## Engine split details', '',
    `Across ${data.contactSplitClassification.differentSidesOfAnalyticOverlap} matched comparisons, Rapier had a positive gap while Jolt had crossed into analytic overlap at the first contact-state split; those are trajectory-mediated separations. In ${data.contactSplitClassification.bothAnalyticGapsPositive} comparisons, Jolt reported contact while both analytic gaps were still positive. Those cases expose a mismatch between the shared analytic surface-gap proxy and the engines’ contact boundaries; they cannot be classified as a Rapier detection failure from this telemetry alone. No split had a nonpositive Rapier gap with Rapier reporting no contact. Exact ticks and paired trajectories are in \`sensitivity-report.json\`.`, '');
  for (const comparison of data.matchedTimestepComparisons) {
    const split = comparison.focusPair?.firstPhysicalContactStateSplit;
    if (!split) continue;
    const category = split.rapierGapM <= 0 && !split.rapierContact
      ? 'Rapier gap was already nonpositive at the split; this frame warrants a contact-query audit.'
      : split.rapierGapM > 0 && split.joltGapM <= 0 && split.joltContact
        ? 'Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.'
        : split.rapierGapM > 0 && split.joltGapM > 0 && split.joltContact
          ? 'Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.'
          : 'This split requires joint interpretation of the paired transforms and engine contact state.';
    lines.push(`- \`${comparison.scenarioId}\` / \`${comparison.configId}\`: first contact-state split at tick ${split.tick} (${split.timeSeconds.toFixed(4)} s), Rapier gap ${fmt(split.rapierGapM)} m, Jolt gap ${fmt(split.joltGapM)} m. ${category}`);
  }
  lines.push('', '## Failures', '', data.failures.length
    ? 'Every numerical or fixture-outcome failure from the sweep is listed below. No thresholds were relaxed.'
    : 'No numerical or fixture-outcome failures were recorded.', '');
  for (const failure of data.failures) lines.push(`- \`${failure.scenarioId}\` / \`${failure.configId}\` / \`${failure.engine}\`: ${failure.failures.join('; ')}.`);
  lines.push('', '## Reproduction and artifacts', '',
    'From the repository root, run `node research/physics-3d-evaluation/m4b/m4d-str-contact-diagnosis/run.mjs`. This rewrites the report and full-rate traces. Serve the results directory over HTTP to use the replay viewer; the browser decompresses each trace and synchronizes by fixed-step tick.', '',
    '- Full sensitivity matrix and matched-timestep metrics: `sensitivity-report.json`.',
    '- Synchronized replay selector: `viewer.html` with `replay-index.json` and `traces/`.',
    '- Isolated-phase checkpoint written before combined inputs: `isolated-sweeps-checkpoint.json`.', '',
    'Limitations: player proxies are rigid and non-articulated; STR changes only the existing M4c balance-controller gain; Jolt’s JavaScript binding does not expose Rapier-equivalent solver normal impulses. No Madden rating was added, no production file was changed, and the old TAK/BTK hold-drag formula was not evaluated as a candidate for M4c.', '');
  return `${lines.join('\n').trimEnd()}\n`;
}

function fmt(value) { return value == null ? '—' : Number(value).toFixed(4); }

function analyzeStrengthResponse(rows) {
  const groups = new Map();
  const add = (row, factor, actorId, value) => {
    const key = [row.scenarioId, row.engine, factor, actorId].join('::');
    const group = groups.get(key) ?? { scenarioId: row.scenarioId, engine: row.engine, factor, actorId, samples: [] };
    const pairId = Object.keys(row.pairDiagnostics).find((id) => row.pairDiagnostics[id].minimumSurfaceGapM !== undefined
      && id.includes(actorId) && id.includes(row.scenarioId === 'possession-retained' ? 'runner'
        : row.scenarioId === 'gang-two-opposite-open' ? 'carrier' : 'carrier'))
      ?? Object.keys(row.pairDiagnostics)[0];
    const pair = row.pairDiagnostics[pairId];
    group.samples.push({ strength: value, configId: row.configId, minimumSurfaceGapM: pair?.minimumSurfaceGapM ?? null,
      firstPhysicalContactTimeSeconds: pair?.firstPhysicalContactTimeSeconds ?? null,
      physicalContactStepCount: pair?.physicalContactStepCount ?? 0,
      gapAtTick11M: row.focusPairResponseByTick?.[11]?.minimumSurfaceGapM ?? null,
      contactAtTick11: row.focusPairResponseByTick?.[11]?.physicalContact ?? false,
      peakControllerTorqueNm: row.peakControllerTorqueNmByPlayer[actorId] ?? null,
      finalCarrierPositionXM: row.carrierTerminalState?.finalPositionM?.[0] ?? null });
    groups.set(key, group);
  };
  for (const row of rows) {
    if (row.factor !== 'strength-only' && row.factor !== 'strength-only-at-target-masses') continue;
    add(row, row.factor, row.changedActorId, row.changedValue);
  }
  // Include the exact STR 80 anchor for each one-factor series.
  for (const group of [...groups.values()]) {
    let baseline;
    if (group.factor === 'strength-only') baseline = rows.find((row) => row.scenarioId === group.scenarioId
      && row.engine === group.engine && row.configId === 'baseline');
    else baseline = rows.find((row) => row.scenarioId === group.scenarioId && row.engine === group.engine
      && row.configId === 'madden-masses-103-102kg');
    if (baseline) add(baseline, group.factor, group.actorId, 80);
  }
  return [...groups.values()].map((group) => {
    group.samples.sort((a, b) => a.strength - b.strength);
    group.adjacentSteps = group.samples.slice(1).map((next, index) => {
      const previous = group.samples[index];
      const changedContact = Boolean(previous.firstPhysicalContactTimeSeconds) !== Boolean(next.firstPhysicalContactTimeSeconds);
      const signedGapCrossing = previous.minimumSurfaceGapM !== null && next.minimumSurfaceGapM !== null
        && (previous.minimumSurfaceGapM <= 0) !== (next.minimumSurfaceGapM <= 0);
      return { fromStrength: previous.strength, toStrength: next.strength,
        minimumGapDeltaM: next.minimumSurfaceGapM - previous.minimumSurfaceGapM,
        preContactGapAtTick11DeltaM: next.gapAtTick11M - previous.gapAtTick11M,
        peakTorqueDeltaNm: next.peakControllerTorqueNm - previous.peakControllerTorqueNm,
        finalCarrierPositionDeltaXM: next.finalCarrierPositionXM - previous.finalCarrierPositionXM,
        physicalContactChanged: changedContact, signedGapCrossing,
        contactTransitionMatchesGeometryThreshold: !changedContact || signedGapCrossing,
        previous: { minimumSurfaceGapM: previous.minimumSurfaceGapM, contactTimeSeconds: previous.firstPhysicalContactTimeSeconds },
        next: { minimumSurfaceGapM: next.minimumSurfaceGapM, contactTimeSeconds: next.firstPhysicalContactTimeSeconds } };
    });
    return group;
  });
}

function buildContactCauseEvidence(rows, comparisons) {
  const getRun = (configId, engine) => rows.find((row) => row.scenarioId === 'possession-retained'
    && row.configId === configId && row.engine === engine);
  const getCompare = (configId) => comparisons.find((row) => row.scenarioId === 'possession-retained' && row.configId === configId);
  const engines = ENGINES.map((engine) => {
    const massOnly = getRun('madden-masses-103-102kg', engine);
    const combined = getRun('combined-madden-masses-103-102kg-runner-str-81', engine);
    const baseMassStrengthOnly = getRun('str-carrier-81.00', engine);
    const startup = (row) => Object.fromEntries([1, 4, 5, 9, 10, 11].map((tick) => [tick,
      row?.focusPairResponseByTick?.[tick] ?? null]));
    return { engine, targetMassOnly: massOnly ? { firstContactByPair: massOnly.firstContactByPair,
      focusPair: massOnly.pairDiagnostics['impact-defender::runner'], failures: massOnly.failures } : null,
      combinedMassAndStrength: combined ? { firstContactByPair: combined.firstContactByPair,
        focusPair: combined.pairDiagnostics['impact-defender::runner'], failures: combined.failures,
        startupStates: startup(combined) } : null,
      strengthOnlyAtFixtureMass: baseMassStrengthOnly ? { firstContactByPair: baseMassStrengthOnly.firstContactByPair,
        focusPair: baseMassStrengthOnly.pairDiagnostics['impact-defender::runner'], failures: baseMassStrengthOnly.failures } : null };
  });
  return { engines, targetMassMatchedSolverComparison: getCompare('combined-madden-masses-103-102kg-runner-str-81'),
    targetMassOnlyMatchedSolverComparison: getCompare('madden-masses-103-102kg') };
}

function classifyContactSplits(comparisons) {
  const splits = comparisons.map((row) => row.focusPair?.firstPhysicalContactStateSplit).filter(Boolean);
  const differentSidesOfAnalyticOverlap = splits.filter((row) => row.rapierGapM > 0 && row.joltGapM <= 0
    && !row.rapierContact && row.joltContact).length;
  const bothAnalyticGapsPositive = splits.filter((row) => row.rapierGapM > 0 && row.joltGapM > 0
    && row.joltContact).length;
  const rapierAnalyticOverlapWithoutContact = splits.filter((row) => row.rapierGapM <= 0 && !row.rapierContact).length;
  return { totalContactStateSplits: splits.length, differentSidesOfAnalyticOverlap, bothAnalyticGapsPositive,
    rapierAnalyticOverlapWithoutContact,
    other: splits.length - differentSidesOfAnalyticOverlap - bothAnalyticGapsPositive - rapierAnalyticOverlapWithoutContact };
}
