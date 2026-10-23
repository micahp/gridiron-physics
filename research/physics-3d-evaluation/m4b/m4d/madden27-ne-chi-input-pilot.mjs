import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_IDS, runScenario } from '../simulation.mjs';
import { instantiateM4CScenario } from '../m4c-scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const snapshot = JSON.parse(await readFile(path.join(HERE, 'madden27-ne-chi-profiles.json'), 'utf8'));
const [runnerProfile, defenderProfile] = snapshot.profiles;
const CONFIGS = [
  { id: 'm4c-generic-control', weights: false, strengthRatings: false },
  { id: 'ea-listed-weights', weights: true, strengthRatings: false },
  { id: 'ea-listed-weights-and-str', weights: true, strengthRatings: true },
];

function makeScenario(config) {
  const scenario = instantiateM4CScenario('possession-retained', 41027);
  scenario.id = `m4d-ne-chi-${config.id}`;
  scenario.title = `${runnerProfile.name} versus ${defenderProfile.name}: ${config.id}`;
  scenario.ratingsSnapshot = `EA SPORTS ${snapshot.game} ${snapshot.ratingsSnapshot}; accessed ${snapshot.accessedAt}`;
  const runner = scenario.players.find((player) => player.id === 'runner');
  const defender = scenario.players.find((player) => player.id === 'impact-defender');
  assert.ok(runner && defender, 'source M4c fixture has the expected runner and tackler');

  const applied = { massKg: { runner: runner.mass, defender: defender.mass }, strength: { runner: 80, defender: 80 } };
  if (config.weights) {
    runner.mass = runnerProfile.weightKgDisplayed;
    defender.mass = defenderProfile.weightKgDisplayed;
    applied.massKg = { runner: runner.mass, defender: defender.mass };
  }
  if (config.strengthRatings) {
    runner.strength = runnerProfile.ratings.STR;
    defender.strength = defenderProfile.ratings.STR;
    applied.strength = { runner: runner.strength, defender: defender.strength };
  }
  scenario.appliedMaddenInputs = applied;
  return scenario;
}

function summarize(configId, repeat, scenario, result) {
  const pairId = ['runner', 'impact-defender'].sort().join('::');
  const contact = result.contacts.find((row) => row.pairId === pairId) ?? null;
  const runnerState = result.outcome.playerTerminalStates.find((row) => row.id === 'runner');
  const defenderState = result.outcome.playerTerminalStates.find((row) => row.id === 'impact-defender');
  const wrap = result.outcome.wrapResults.find((row) => row.holderId === 'impact-defender') ?? null;
  assert.ok(runnerState && defenderState, `${configId}/${result.engine}: both players have terminal states`);
  return {
    configuration: configId,
    repeat,
    scenarioId: scenario.id,
    engine: result.engine,
    seed: result.seed,
    appliedInputs: scenario.appliedMaddenInputs,
    physicalContact: contact !== null,
    firstContactTimeSeconds: contact?.firstTimeSeconds ?? null,
    wrap: wrap && { released: wrap.released, capacityN: wrap.capacityN,
      maximumRequestedLoadN: wrap.maximumRequestedLoadN, maximumAppliedLoadN: wrap.maximumAppliedLoadN,
      terminalSeparationM: wrap.terminalSeparationM },
    retainedPossessionAfterContact: contact !== null && result.outcome.football.controlledBy === 'runner',
    footballControllerAtEnd: result.outcome.football.controlledBy,
    runner: { massKg: scenario.players.find((row) => row.id === 'runner').mass,
      maxTiltDeg: runnerState.maxTiltDeg, fellAtSeconds: runnerState.fellAtSeconds,
      finalPositionXM: runnerState.finalPositionM[0] },
    defender: { massKg: scenario.players.find((row) => row.id === 'impact-defender').mass,
      maxTiltDeg: defenderState.maxTiltDeg, fellAtSeconds: defenderState.fellAtSeconds,
      finalPositionXM: defenderState.finalPositionM[0] },
    penetration: { maximumDepthM: result.penetration.maximumDepthM,
      p95PerStepMaximumM: result.penetration.p95PerStepMaximumM,
      durationWeightedMeanM: result.penetration.durationWeightedMeanM },
  };
}

const results = [];
for (const config of CONFIGS) for (const engine of ENGINE_IDS) {
  const signatures = [];
  for (let repeat = 1; repeat <= 2; repeat++) {
    const scenario = makeScenario(config);
    const result = await runScenario(engine, scenario, {
      behaviorVersion: 'm4c', playerGeometry: 'compound', recordFrames: false,
    });
    assert.equal(result.diagnostics.finite, true, `${config.id}/${engine}: finite simulation output`);
    const summary = summarize(config.id, repeat, scenario, result);
    signatures.push({ ...summary, repeat: undefined });
    results.push(summary);
  }
  assert.deepEqual(signatures[0], signatures[1], `${config.id}/${engine}: exact repeatability`);
}

const output = {
  schemaVersion: 1,
  experiment: 'M4d Madden 27 Patriots–Bears player-input pilot',
  sourceCommit: 'M4c baseline 8ead484e08de6acdc934f33fe279347713dc289e',
  sourceScenario: 'possession-retained from m4c-scenario-library-v5',
  ratingsSnapshot: snapshot,
  mapping: {
    weight: 'Use the rounded kilogram value displayed on the official EA player page as rigid-body mass.',
    strength: 'Pass Madden STR unchanged into the existing simulation strength field, which affects the balance controller.',
    unusedRatings: 'BTK, TRK, CAR, TKL, and HTP are captured but not mapped by this M4c pilot.',
    caveat: 'This is an input-sensitivity pilot. EA does not publish a conversion from ratings to rigid-body forces or grip parameters; the STR mapping is uncalibrated.',
  },
  results,
};
const outputPath = path.join(HERE, 'madden27-ne-chi-input-pilot-results.json');
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, runs: results.length, results }, null, 2));
