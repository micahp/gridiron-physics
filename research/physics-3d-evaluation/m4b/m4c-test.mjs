import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_IDS, compareSignatures, runScenario } from './simulation.mjs';
import { M4C_SCENARIO_VERSION, instantiateM4CScenario } from './m4c-scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const RESULTS = path.join(HERE, 'results');
const seeds = [41027, 91573];
const configs = [
  { id: 'registered-baseline', options: {} },
  { id: 'higher-traction-mass-drive-grip', options: { playerMassScale: 1.05, playerDriveScale: 1.05,
    gripStrengthScale: 1.05, gripStiffnessScale: 0.95,
    materialOverrides: { playerFriction: 0.86, groundFriction: 0.88 } } },
];
const required = [
  'gang-two-opposite-open', 'gang-staggered-three', 'sack-simultaneous-two', 'sack-throw-window',
  'possession-retained', 'possession-force-fumble', 'recovery-failed', 'recovery-secure', 'recovery-contested',
  'tush-push-eight', 'fumble-eight-pile-live-ball', 'grip-escape-one-held', 'grip-break-multiple-forward',
];

function hasContact(result, a, b) {
  const pair = [a, b].sort().join('::');
  return result.contacts.some((row) => row.pairId === pair);
}

function validateOutcome(id, result) {
  const events = result.events;
  const typed = (type) => events.filter((event) => event.type === type);
  const fallback = () => {
    const player = result.outcome.playerTerminalStates.find((row) => row.id === 'carrier');
    assert.ok(player, `${id}: carrier terminal record exists`);
    return player;
  };
  if (id === 'gang-two-opposite-open') {
    assert.ok(hasContact(result, 'carrier', 'defender-left'), `${id}: left defender made solver contact`);
    assert.ok(hasContact(result, 'carrier', 'defender-right'), `${id}: right defender made solver contact`);
    assert.notEqual(fallback().fellAtSeconds, null, `${id}: runner reached a sustained physical fall state`);
    assert.ok(result.outcome.defenderContributionLedger.filter((row) => row.contactPairSamples > 0).length >= 2,
      `${id}: both defenders have contribution records`);
  } else if (id === 'grip-escape-one-held') {
    assert.ok(hasContact(result, 'carrier', 'defender-left') && hasContact(result, 'carrier', 'defender-right'),
      `${id}: both defenders physically contacted the runner`);
    assert.equal(result.outcome.wrapResults.find((row) => row.holderId === 'defender-left').released, true,
      `${id}: the weaker grip physically released`);
    assert.equal(result.outcome.wrapResults.find((row) => row.holderId === 'defender-right').released, false,
      `${id}: the second grip remained engaged`);
    assert.ok(result.outcome.activeWrapHoldersAtEnd.includes('defender-right'), `${id}: one defender still holds the runner`);
  } else if (id === 'grip-break-multiple-forward') {
    assert.ok(hasContact(result, 'carrier', 'defender-left') && hasContact(result, 'carrier', 'defender-right'),
      `${id}: both defenders physically contacted the runner`);
    assert.ok(result.outcome.wrapResults.length >= 2 && result.outcome.wrapResults.every((row) => row.released),
      `${id}: both force-limited grips physically released`);
    assert.equal(fallback().fellAtSeconds, null, `${id}: runner remained upright after escaping both grips`);
    assert.ok(result.outcome.rawProgress.finalCarrierPositionXM > 0.5,
      `${id}: runner continued forward under the configured drive after release`);
  } else if (id === 'gang-staggered-three') {
    for (const defender of ['first-hit', 'second-hit', 'third-hit']) assert.ok(hasContact(result, 'carrier', defender), `${id}: ${defender} physically contacted carrier`);
    assert.notEqual(fallback().fellAtSeconds, null, `${id}: runner reached a sustained physical fall state`);
  } else if (id === 'sack-simultaneous-two') {
    const takedown = typed('physical_sack_takedown')[0];
    assert.ok(takedown, `${id}: quarterback satisfied the physical down condition`);
    assert.ok(takedown.physicalContributors.length >= 2, `${id}: both rushers contributed before takedown`);
    assert.ok(result.outcome.defenderContributionLedger.filter((row) => row.contactPairSamples > 0).length >= 2,
      `${id}: both rushers appear in the physical ledger`);
  } else if (id === 'sack-throw-window') {
    assert.ok(hasContact(result, 'quarterback', 'rusher-a'), `${id}: rusher physically contacted quarterback`);
    const release = typed('quarterback_pass_release')[0];
    assert.ok(release, `${id}: quarterback released the ball`);
    assert.ok(!typed('physical_sack_takedown').some((row) => row.timeSeconds <= release.timeSeconds),
      `${id}: release preceded any physical takedown`);
  } else if (id === 'possession-retained') {
    assert.ok(hasContact(result, 'runner', 'impact-defender'), `${id}: runner absorbed solver contact`);
    assert.ok(typed('ball_possession_retained').some((event) => event.heldSeconds >= 1), `${id}: possession persisted for one second`);
    assert.equal(result.outcome.football.controlledBy, 'runner', `${id}: runner retained active control`);
  } else if (id === 'possession-force-fumble') {
    const strike = typed('carried_ball_body_contact').find((event) => event.player === 'ball-striker');
    const overload = typed('possession_grip_overloaded')[0];
    const release = typed('ball_released')[0];
    assert.ok(strike && overload && release, `${id}: impact, overload, and solver-resolved release were recorded`);
    assert.ok(overload.timeSeconds >= strike.timeSeconds && overload.overloadTicks >= 2,
      `${id}: grip exceeded capacity for at least two fixed steps after ball impact`);
    assert.equal(result.outcome.football.releaseReason, 'grip_overload', `${id}: release came from physical cradle overload`);
  } else if (id === 'recovery-failed') {
    assert.ok(typed('loose_ball_physical_contact').length > 0, `${id}: player physically touched the loose ball`);
    assert.equal(typed('secure_ball_recovery').length, 0, `${id}: no secure recovery was recorded`);
    assert.equal(result.outcome.football.controlledBy, null, `${id}: no player retained control`);
    assert.ok(result.durationSeconds - typed('loose_ball_physical_contact')[0].timeSeconds >= 0.25,
      `${id}: uncontrolled interval exceeded the registered quarter second`);
  } else if (id === 'recovery-secure') {
    assert.ok(typed('loose_ball_physical_contact').length > 0, `${id}: actual football/player contact preceded control`);
    assert.ok(typed('ball_control_candidate').length > 0, `${id}: physical capture gate was met`);
    assert.ok(typed('secure_ball_recovery').some((event) => event.heldSeconds >= 0.5 && event.competingControllers === 0),
      `${id}: two-point control persisted for half a second without a competitor`);
    assert.equal(result.outcome.football.controlledBy, 'recoverer', `${id}: recovery remains active at the end`);
  } else if (id === 'recovery-contested') {
    const candidates = [...new Set(typed('ball_control_candidate').map((event) => event.player))];
    assert.ok(hasContact(result, 'recoverer-a', 'recoverer-b'), `${id}: opponents physically contact one another`);
    assert.ok(candidates.includes('recoverer-a') && candidates.includes('recoverer-b'),
      `${id}: both opponents make physical football contact and attempt a cradle`);
    assert.equal(result.outcome.football.controlledBy, null, `${id}: contested attempts do not assign a winner by proximity`);
  } else if (id === 'tush-push-eight') {
    assert.ok(typed('loose_ball_physical_contact').some((event) => event.player === 'quarterback'), `${id}: quarterback physically contacted the snap`);
    assert.ok(typed('snap_reception_completed').some((event) => event.player === 'quarterback' && event.heldSeconds >= 0.25),
      `${id}: quarterback maintained two-point possession for the registered interval`);
    assert.equal(result.outcome.football.controlledBy, 'quarterback', `${id}: quarterback has active possession`);
    assert.ok(result.outcome.rawProgress.finalCarrierPositionXM !== result.outcome.rawProgress.finalFootballPositionXM,
      `${id}: player and football progress are measured independently`);
  } else if (id === 'fumble-eight-pile-live-ball') {
    const release = typed('ball_released')[0], secure = typed('secure_ball_recovery')[0];
    assert.ok(release && release.reason === 'holding cradle exceeded its force or extension limit', `${id}: physical overload released the ball`);
    assert.ok(typed('loose_ball_physical_contact').length && secure && secure.timeSeconds > release.timeSeconds,
      `${id}: a later physical contact established sustained recovery control`);
  }
}

const startedAt = performance.now();
const runs = [];
for (const scenarioId of required) for (const engine of ENGINE_IDS) for (const seed of seeds) for (const config of configs) {
  const scenario = instantiateM4CScenario(scenarioId, seed);
  const result = await runScenario(engine, scenario, { behaviorVersion: 'm4c', ...config.options });
  validateOutcome(scenarioId, result);
  runs.push({ scenarioId, engine, seed, inputConfiguration: config.id, physicsParameters: result.physicsParameters,
    finite: result.diagnostics.finite, contactOpportunityCount: result.contactOpportunities.rows.length,
    physicalContactPairCount: result.contacts.length, contactOpportunities: result.contactOpportunities.rows,
    contacts: result.contacts, outcome: result.outcome, events: result.events,
    penetration: result.penetration, runtime: result.runtime, stepsCompleted: result.stepsCompleted });
  console.log(JSON.stringify({ scenarioId, engine, seed, inputConfiguration: config.id,
    physicalContacts: result.contacts.length, maxPenetrationM: result.penetration.maximumDepthM,
    p95PenetrationM: result.penetration.p95PerStepMaximumM, outcome: 'passed' }));
}

const repeat = [];
for (const engine of ENGINE_IDS) {
  const scenario = instantiateM4CScenario('gang-two-opposite-open', seeds[0]);
  const first = await runScenario(engine, scenario, { behaviorVersion: 'm4c', recordFrames: false });
  const second = await runScenario(engine, scenario, { behaviorVersion: 'm4c', recordFrames: false });
  const exact = compareSignatures(first, second);
  assert.ok(exact, `${engine}: repeated two-defender outcome is deterministic within this process`);
  repeat.push({ engine, scenarioId: scenario.id, seed: scenario.seed, repeats: 2, exactWithinProcess: exact });
}

const packageJson = JSON.parse(await readFile(path.join(REPO, 'package.json'), 'utf8'));
const summary = { schemaVersion: 1, milestone: 'M4c', preregistration: 'research/physics-3d-evaluation/m4b/M4C-PREREG.md',
  generatedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(),
  reproducibility: { command: 'npm run eval:m4c:test', node: process.version, platform: process.platform, architecture: process.arch,
    cpu: os.cpus()[0]?.model, packages: { rapier: packageJson.devDependencies['@dimforge/rapier3d-compat'], jolt: packageJson.devDependencies['jolt-physics'] },
    scenarioVersion: M4C_SCENARIO_VERSION, fixedTimestepSeconds: 1 / 120, seeds,
    inputConfigurations: configs.map(({ id, options }) => ({ id, options })),
    randomDraws: 0, contactOpportunityGapM: 0.10 },
  acceptedDemonstrations: required, runCount: runs.length, runs, repeatability: repeat,
  runtime: { wallTimeMs: performance.now() - startedAt, processRssBytes: process.memoryUsage().rss },
  limitations: ['Seeds are metadata only; fixtures do not draw randomness.', 'Player proxies are rigid, non-articulated geometry.',
    'NFL possession, down-by-contact, first-down, touchdown, and sack-credit rules are not applied.'] };
await mkdir(RESULTS, { recursive: true });
await writeFile(path.join(RESULTS, 'm4c-validation.json'), `${JSON.stringify(summary)}\n`);
console.log(JSON.stringify({ passed: true, runCount: summary.runCount, repeatability: repeat,
  result: path.join(RESULTS, 'm4c-validation.json'), wallTimeMs: summary.runtime.wallTimeMs }, null, 2));
