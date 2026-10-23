import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { CONTACT_SWEEP_ANGLES_DEG, CONTACT_SWEEP_SPEEDS_MPS, DT } from './scenarios.js';
import { runContactEnergyHorizonCell, runTackleScaleGravityControls } from './contact-energy-horizon.mjs';

const ENGINES = ['rapier3d-compat', 'jolt-physics-js'];
const HORIZON_TICKS = 900;
const SATURATION_DELTA_DEG = 0.05;

function peakWithin(trace, endTick, initialTiltDeg) {
  let best = { tiltDeg: initialTiltDeg, tick: 0 };
  for (let index = 0; index < endTick; index++) {
    if (trace[index] > best.tiltDeg) best = { tiltDeg: trace[index], tick: index + 1 };
  }
  return best;
}

function cellId(engine, angleDeg, speedMps) {
  return `${engine}:${angleDeg}:${speedMps}`;
}

function isNonMonotonic(values) {
  const nondecreasing = values.every((value, index) => index === 0 || value >= values[index - 1]);
  const nonincreasing = values.every((value, index) => index === 0 || value <= values[index - 1]);
  return !nondecreasing && !nonincreasing;
}

export async function buildContactEnergyFullGrid() {
  const sweep = JSON.parse(await readFile(new URL('./results-sweep.json', import.meta.url), 'utf8'));
  const stress = JSON.parse(await readFile(new URL('./results/contact-energy-horizon.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  const versions = {
    'rapier3d-compat': lock.packages['node_modules/@dimforge/rapier3d-compat'].version,
    'jolt-physics-js': lock.packages['node_modules/jolt-physics'].version,
  };
  const cells = [];
  for (const engine of ENGINES) {
    for (const angleDeg of CONTACT_SWEEP_ANGLES_DEG) {
      for (const speedMps of CONTACT_SWEEP_SPEEDS_MPS) {
        const replay = await runContactEnergyHorizonCell(engine, angleDeg, speedMps, 'dynamic');
        const source = sweep.cells.find((entry) => entry.engine === engine
          && entry.approachAngleDeg === angleDeg && entry.closingSpeedMps === speedMps);
        assert.ok(source, `Missing frozen sweep source for ${cellId(engine, angleDeg, speedMps)}`);
        const peak180 = peakWithin(replay.traces.carrierTiltDeg, 180, replay.tick0.carrierTiltDeg);
        assert.equal(peak180.tiltDeg, source.carrierPeakTiltDeg,
          `${cellId(engine, angleDeg, speedMps)} first-180-tick carrier peak must exactly match frozen results-sweep.json`);
        cells.push({
          engine,
          engineVersion: versions[engine],
          approachAngleDeg: angleDeg,
          closingSpeedMps: speedMps,
          defenderMode: 'dynamic',
          horizonTicks: HORIZON_TICKS,
          horizonSeconds: HORIZON_TICKS * DT,
          tiltAtTicksDeg: { 180: replay.tiltAtTicksDeg[180], 900: replay.tiltAtTicksDeg[900] },
          peakWithinTicks1To180: peak180,
          frozenSweepPeakTiltDeg: source.carrierPeakTiltDeg,
          observedMaximum: replay.observedMaximum,
          terminalSaturation: replay.terminalSaturation,
          carrierTiltTraceDeg: replay.traces.carrierTiltDeg,
        });
      }
    }
  }

  const speedComparisons = ENGINES.flatMap((engine) => CONTACT_SWEEP_ANGLES_DEG.map((angleDeg) => {
    const speedSeriesDeg = CONTACT_SWEEP_SPEEDS_MPS.map((speedMps) => ({
      closingSpeedMps: speedMps,
      carrierTiltAtTick900Deg: cells.find((cell) => cell.engine === engine
        && cell.approachAngleDeg === angleDeg && cell.closingSpeedMps === speedMps).tiltAtTicksDeg[900],
    }));
    const tiltValues = speedSeriesDeg.map(({ carrierTiltAtTick900Deg }) => carrierTiltAtTick900Deg);
    return {
      engine,
      approachAngleDeg: angleDeg,
      speedSeriesDeg,
      nonMonotonicInClosingSpeedAtTick900: isNonMonotonic(tiltValues),
    };
  }));

  const tackleScaleRuns = await runTackleScaleGravityControls();
  const tackleScaleSummary = Object.fromEntries(ENGINES.map((engine) => {
    const runs = tackleScaleRuns.filter((run) => run.engine === engine);
    return [engine, {
      runs,
      maximumAbsolutePerStepDriftJ: Math.max(...runs.map((run) => run.maximumAbsolutePerStepDriftJ)),
      maximumAbsoluteCumulativeDriftJ: Math.max(...runs.map((run) => run.maximumAbsoluteCumulativeDriftJ)),
      maximumSpeedMps: Math.max(...runs.map((run) => run.maximumSpeedMps)),
    }];
  }));

  const stressControl = Object.fromEntries(ENGINES.map((engine) => {
    const run = stress.gravityOnlyControl.runs.find((entry) => entry.engine === engine);
    return [engine, {
      sourceArtifact: 'results/contact-energy-horizon.json; copied without rerunning or changing the 100 m / 120 m stress control',
      scenario: run.scenario,
      maximumAbsolutePerStepDriftJ: run.maximumAbsolutePerStepDriftJ,
      maximumAbsoluteCumulativeDriftJ: run.maximumAbsoluteCumulativeDriftJ,
      maximumAngularSpeedRadPerSec: run.maximumAngularSpeedRadPerSec,
      contactCount: run.contactCount,
    }];
  }));

  const tackleEmpiricalBounds = Object.fromEntries(ENGINES.map((engine) => {
    const perStep = tackleScaleSummary[engine].maximumAbsolutePerStepDriftJ;
    const cumulative = tackleScaleSummary[engine].maximumAbsoluteCumulativeDriftJ;
    return [engine, {
      maximumAbsolutePerStepDriftBoundJ: Math.ceil(perStep * 1e6) / 1e6,
      maximumAbsoluteCumulativeDriftBoundJ: Math.ceil(cumulative * 1e6) / 1e6,
      basis: 'Empirical envelope rounded upward to the next 0.000001 J from the maximum of the measured 0.5 m and 2.0 m trials; applies only to these proxies, speeds, engines, and fixed-step controls.',
    }];
  }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model },
    method: {
      anglesDeg: CONTACT_SWEEP_ANGLES_DEG,
      closingSpeedsMps: CONTACT_SWEEP_SPEEDS_MPS,
      engines: ENGINES,
      defenderMode: 'dynamic',
      horizonTicks: HORIZON_TICKS,
      timestepSeconds: DT,
      saturationRule: `terminal saturation means absolute carrier tilt change from tick 800 to tick 900 is below ${SATURATION_DELTA_DEG} degrees`,
      geometryAndSolver: 'Reuses runContactEnergyHorizonCell from contact-energy-horizon.mjs and its frozen contactSweepScenario, BODY_LAYOUT, masses, ground geometry, friction, damping, CCD, and solver settings. No scenario or solver fork.',
      outcomeRandomDraw: false,
      peakProvenance: 'Every recorded ticks 1–180 carrier peak angle is checked for exact numeric equality against the matching frozen results-sweep.json carrierPeakTiltDeg. The frozen sweep stores no peak tick; the replay peak tick is derived and validated against the full 900-tick trace, but cannot be independently compared to a historical tick field.',
      nonMonotonicityRule: 'At a fixed angle and engine, raw tick-900 values for 4, 6, and 8 m/s are non-monotonic when they are neither nondecreasing nor nonincreasing; ties are allowed. No smoothing or tolerance is applied.',
    },
    cells,
    closingSpeedComparisonAtTick900: {
      question: 'Is carrier tilt non-monotonic in closing speed at each angle for Jolt, and does Rapier show the same pattern?',
      classificationCountByEngine: Object.fromEntries(ENGINES.map((engine) => [engine, {
        nonMonotonicAngleCount: speedComparisons.filter((entry) => entry.engine === engine && entry.nonMonotonicInClosingSpeedAtTick900).length,
        totalAngles: CONTACT_SWEEP_ANGLES_DEG.length,
      }])),
      byEngineAndAngle: speedComparisons,
      mechanismClaim: 'None; the comparison classifies measured output only.',
    },
    gravityOnlyControls: {
      tackleScale: {
        method: 'One isolated five-collider player proxy per trial; no ground collider, no damping, gravity only. Trial A starts at 0.5 m COM height from rest and runs through a 0.5 m fall. Trial B starts at 2.0 m COM height with 3.2 m/s downward initial speed and runs through a 2.0 m fall, covering the ledger-scale speed range up to approximately 7 m/s. No body-body contacts are possible.',
        empiricalBounds: tackleEmpiricalBounds,
        supportsPrior0_05JPerStepClaim: Object.fromEntries(ENGINES.map((engine) => [engine,
          tackleScaleSummary[engine].maximumAbsolutePerStepDriftJ < 0.05])),
        interpretation: 'These measured envelopes describe finite-step energy drift for the stated free-fall controls. They are not a guarantee for contact, damping, ground response, other speeds, other geometries, or other scenes; they do not establish energy conservation or attribution in the tackle ledger.',
        byEngine: tackleScaleSummary,
      },
      existingHighSpeedStressControl: stressControl,
    },
  };
}

if (process.argv[1]?.endsWith('/contact-energy-full-grid.mjs')) {
  const result = await buildContactEnergyFullGrid();
  const path = new URL('./results/contact-energy-full-grid.json', import.meta.url);
  await mkdir(new URL('./results/', import.meta.url), { recursive: true });
  await writeFile(path, `${JSON.stringify(result)}\n`);
  console.log(JSON.stringify({
    output: path.pathname,
    cells: result.cells.length,
    exact180PeakMatches: result.cells.length,
    nonMonotonicAngleCounts: result.closingSpeedComparisonAtTick900.classificationCountByEngine,
    tackleScaleDrift: Object.fromEntries(Object.entries(result.gravityOnlyControls.tackleScale.byEngine)
      .map(([engine, value]) => [engine, {
        maximumAbsolutePerStepDriftJ: value.maximumAbsolutePerStepDriftJ,
        maximumAbsoluteCumulativeDriftJ: value.maximumAbsoluteCumulativeDriftJ,
        maximumSpeedMps: value.maximumSpeedMps,
      }])),
  }, null, 2));
}
