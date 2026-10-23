import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONTACT_SWEEP_ANGLES_DEG, CONTACT_SWEEP_SPEEDS_MPS, DT } from './scenarios.js';
import { buildContactEnergyFullGrid } from './contact-energy-full-grid.mjs';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const artifact = await readJson('./results/contact-energy-full-grid.json');
const sweep = await readJson('./results-sweep.json');
const stressArtifact = await readJson('./results/contact-energy-horizon.json');
const finiteTree = (value, path = 'root') => {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is not finite`);
  else if (Array.isArray(value)) value.forEach((item, index) => finiteTree(item, `${path}[${index}]`));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) finiteTree(child, `${path}.${key}`);
  }
};

assert.equal(artifact.schemaVersion, 1);
finiteTree(artifact);
assert.equal(artifact.method.horizonTicks, 900);
assert.equal(artifact.method.timestepSeconds, DT);
assert.deepEqual(artifact.method.anglesDeg, CONTACT_SWEEP_ANGLES_DEG);
assert.deepEqual(artifact.method.closingSpeedsMps, CONTACT_SWEEP_SPEEDS_MPS);
assert.equal(artifact.cells.length, 24);
assert.equal(sweep.cells.length, 24);
assert.equal(artifact.method.defenderMode, 'dynamic');
assert.match(artifact.method.peakProvenance, /frozen sweep stores no peak tick/i);

const ids = new Set();
for (const cell of artifact.cells) {
  const id = `${cell.engine}:${cell.approachAngleDeg}:${cell.closingSpeedMps}`;
  assert.ok(!ids.has(id), `duplicate full-grid cell ${id}`);
  ids.add(id);
  const source = sweep.cells.find((entry) => entry.engine === cell.engine
    && entry.approachAngleDeg === cell.approachAngleDeg && entry.closingSpeedMps === cell.closingSpeedMps);
  assert.ok(source, `no frozen source sweep cell for ${id}`);
  assert.equal(cell.horizonTicks, 900, `${id} horizon`);
  assert.equal(cell.defenderMode, 'dynamic', `${id} defender mode`);
  assert.equal(cell.carrierTiltTraceDeg.length, 900, `${id} tilt trace length`);
  const tracePeak = cell.carrierTiltTraceDeg.reduce((best, tilt, index) => tilt > best.tiltDeg
    ? { tiltDeg: tilt, tick: index + 1 } : best, { tiltDeg: 0, tick: 0 });
  const first180Peak = cell.carrierTiltTraceDeg.slice(0, 180).reduce((best, tilt, index) => tilt > best.tiltDeg
    ? { tiltDeg: tilt, tick: index + 1 } : best, { tiltDeg: cell.carrierTiltTraceDeg[0], tick: 1 });
  assert.deepEqual(cell.peakWithinTicks1To180, first180Peak, `${id} first-180 peak and tick match trace`);
  assert.equal(cell.peakWithinTicks1To180.tiltDeg, source.carrierPeakTiltDeg,
    `${id} first-180 peak must exactly equal the frozen sweep peak angle`);
  assert.equal(cell.frozenSweepPeakTiltDeg, source.carrierPeakTiltDeg, `${id} copied frozen peak angle`);
  assert.equal(cell.observedMaximum.tiltDeg, tracePeak.tiltDeg, `${id} full-horizon peak angle`);
  assert.equal(cell.observedMaximum.tick, tracePeak.tick, `${id} full-horizon peak tick`);
  assert.equal(cell.observedMaximum.atHorizonBoundary, tracePeak.tick === 900, `${id} boundary flag`);
  assert.equal(cell.tiltAtTicksDeg[180], cell.carrierTiltTraceDeg[179], `${id} tick 180 tilt`);
  assert.equal(cell.tiltAtTicksDeg[900], cell.carrierTiltTraceDeg[899], `${id} tick 900 tilt`);
  const terminalDelta = cell.carrierTiltTraceDeg[899] - cell.carrierTiltTraceDeg[799];
  assert.equal(cell.terminalSaturation.finalWindowDeltaDeg, terminalDelta, `${id} saturation delta`);
  assert.equal(cell.terminalSaturation.saturated, Math.abs(terminalDelta) < 0.05, `${id} saturation rule`);
}
assert.equal(ids.size, 24);

for (const engine of ['rapier3d-compat', 'jolt-physics-js']) {
  const engineCells = artifact.cells.filter((cell) => cell.engine === engine);
  assert.equal(engineCells.length, 12, `${engine} full-grid cells`);
}

const comparisons = artifact.closingSpeedComparisonAtTick900.byEngineAndAngle;
assert.equal(comparisons.length, 8);
for (const comparison of comparisons) {
  assert.deepEqual(comparison.speedSeriesDeg.map((entry) => entry.closingSpeedMps), CONTACT_SWEEP_SPEEDS_MPS);
  const values = comparison.speedSeriesDeg.map((entry) => entry.carrierTiltAtTick900Deg);
  const nondecreasing = values.every((value, index) => index === 0 || value >= values[index - 1]);
  const nonincreasing = values.every((value, index) => index === 0 || value <= values[index - 1]);
  assert.equal(comparison.nonMonotonicInClosingSpeedAtTick900, !nondecreasing && !nonincreasing);
}
for (const engine of ['rapier3d-compat', 'jolt-physics-js']) {
  const count = comparisons.filter((entry) => entry.engine === engine && entry.nonMonotonicInClosingSpeedAtTick900).length;
  assert.equal(artifact.closingSpeedComparisonAtTick900.classificationCountByEngine[engine].nonMonotonicAngleCount, count);
  assert.equal(artifact.closingSpeedComparisonAtTick900.classificationCountByEngine[engine].totalAngles, 4);
}

const tackleScale = artifact.gravityOnlyControls.tackleScale;
assert.equal(tackleScale.byEngine['rapier3d-compat'].runs.length, 2);
assert.equal(tackleScale.byEngine['jolt-physics-js'].runs.length, 2);
for (const engine of ['rapier3d-compat', 'jolt-physics-js']) {
  const entry = tackleScale.byEngine[engine];
  const bound = tackleScale.empiricalBounds[engine];
  assert.ok(entry.runs.some((run) => run.dropHeightM === 0.5));
  assert.ok(entry.runs.some((run) => run.dropHeightM === 2));
  for (const run of entry.runs) {
    assert.equal(run.contactCount, 0);
    assert.ok(run.ticks > 0 && run.ticks < 120);
    assert.ok(run.maximumAngularSpeedRadPerSec < 1e-8);
    assert.ok(run.actualDropM >= run.dropHeightM, `${engine} did not complete ${run.dropHeightM} m drop`);
    assert.ok(run.maximumAbsolutePerStepDriftJ <= bound.maximumAbsolutePerStepDriftBoundJ);
    assert.ok(run.maximumAbsoluteCumulativeDriftJ <= bound.maximumAbsoluteCumulativeDriftBoundJ);
  }
  assert.equal(entry.maximumAbsolutePerStepDriftJ,
    Math.max(...entry.runs.map((run) => run.maximumAbsolutePerStepDriftJ)));
  assert.equal(entry.maximumAbsoluteCumulativeDriftJ,
    Math.max(...entry.runs.map((run) => run.maximumAbsoluteCumulativeDriftJ)));
  assert.equal(tackleScale.supportsPrior0_05JPerStepClaim[engine], entry.maximumAbsolutePerStepDriftJ < 0.05);
}

for (const engine of ['rapier3d-compat', 'jolt-physics-js']) {
  const oldRun = stressArtifact.gravityOnlyControl.runs.find((run) => run.engine === engine);
  const copied = artifact.gravityOnlyControls.existingHighSpeedStressControl[engine];
  assert.equal(copied.maximumAbsolutePerStepDriftJ, oldRun.maximumAbsolutePerStepDriftJ);
  assert.equal(copied.maximumAbsoluteCumulativeDriftJ, oldRun.maximumAbsoluteCumulativeDriftJ);
  assert.equal(copied.contactCount, oldRun.contactCount);
}

const freshBuild = await buildContactEnergyFullGrid();
const withoutRuntimeFields = ({ generatedAt, runtime, ...rest }) => rest;
assert.deepEqual(withoutRuntimeFields(freshBuild), withoutRuntimeFields(artifact),
  'fresh full-grid replay must reproduce the committed artifact apart from timestamp/runtime metadata');

console.log(JSON.stringify({
  passed: true,
  cells: artifact.cells.length,
  exactFirst180PeakAngleMatches: artifact.cells.length,
  deterministicFreshReplayMatchesArtifact: true,
  sourceSweepPeakTickAvailable: false,
  nonMonotonicAngleCountsAt900Ticks: artifact.closingSpeedComparisonAtTick900.classificationCountByEngine,
  tackleScale: Object.fromEntries(Object.entries(tackleScale.byEngine).map(([engine, entry]) => [engine, {
    maximumAbsolutePerStepDriftJ: entry.maximumAbsolutePerStepDriftJ,
    maximumAbsoluteCumulativeDriftJ: entry.maximumAbsoluteCumulativeDriftJ,
    maximumSpeedMps: entry.maximumSpeedMps,
    belowPrior0_05JPerStepClaim: tackleScale.supportsPrior0_05JPerStepClaim[engine],
  }])),
}, null, 2));
