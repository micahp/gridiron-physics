import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CONTACT_SWEEP_ANGLES_DEG, CONTACT_SWEEP_SPEEDS_MPS, DT, contactSweepScenario } from './scenarios.js';
import { runRapierTackle } from './rapier-sim.js';
import { runJoltTackle } from './jolt-sim.js';

const SEED = 20261022;
const ENGINE_RUNNERS = {
  'rapier3d-compat': runRapierTackle,
  'jolt-physics-js': runJoltTackle,
};
const NO_CONTACT_SCENARIO = {
  id: 'no-contact-control',
  duration: 1.5,
  carrier: { p: [60, 0.845, 0], v: [0, 0, 0], mass: 96, strength: 80 },
  defender: { p: [0, 0.845, 0], v: [0, 0, 0], mass: 108, strength: 88 },
};

const isFiniteTree = (value) => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isFiniteTree);
  if (value && typeof value === 'object') return Object.values(value).every(isFiniteTree);
  return true;
};

async function engineVersions() {
  const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  return {
    'rapier3d-compat': lock.packages['node_modules/@dimforge/rapier3d-compat'].version,
    'jolt-physics-js': lock.packages['node_modules/jolt-physics'].version,
  };
}

export async function runContactSweepCell(engine, approachAngleDeg, closingSpeedMps, versions = null) {
  const runner = ENGINE_RUNNERS[engine];
  if (!runner) throw new Error(`Unknown physics engine: ${engine}`);
  const source = contactSweepScenario(approachAngleDeg, closingSpeedMps);
  const physicsResult = await runner(source, SEED);
  const contact = physicsResult.contact;
  const maxTiltDeg = physicsResult.maxTiltDeg;
  const finite = isFiniteTree(physicsResult)
    && Number.isFinite(contact.timeSeconds ?? 0)
    && Number.isFinite(maxTiltDeg.carrier)
    && Number.isFinite(maxTiltDeg.defender);
  return {
    engine,
    ...(versions ? { engineVersion: versions[engine] } : {}),
    scenarioId: source.id,
    seed: SEED,
    approachAngleDeg,
    closingSpeedMps,
    carrierMassKg: source.carrier.mass,
    defenderMassKg: source.defender.mass,
    contactOccurred: contact.occurred,
    contactTimeSeconds: contact.timeSeconds ?? null,
    contactPoint: contact.position ?? contact.positionEstimate ?? null,
    impulseEstimateNs: contact.contactImpulseEstimateNs ?? contact.impulseEstimateNs ?? null,
    carrierPeakTiltDeg: maxTiltDeg.carrier,
    defenderPeakTiltDeg: maxTiltDeg.defender,
    carrierFellAt55Deg: physicsResult.falling.carrier,
    defenderFellAt55Deg: physicsResult.falling.defender,
    finite,
    physicsResult,
  };
}

export async function runNoContactControl(versions) {
  const results = [];
  for (const [engine, runner] of Object.entries(ENGINE_RUNNERS)) {
    const physicsResult = await runner(NO_CONTACT_SCENARIO, SEED);
    results.push({
      engine,
      engineVersion: versions[engine],
      contactOccurred: physicsResult.contact.occurred,
      carrierPeakTiltDeg: physicsResult.maxTiltDeg.carrier,
      defenderPeakTiltDeg: physicsResult.maxTiltDeg.defender,
      carrierFellAt55Deg: physicsResult.falling.carrier,
      defenderFellAt55Deg: physicsResult.falling.defender,
      finite: physicsResult.finite,
      physicsResult,
    });
  }
  return {
    label: 'No-contact control: stationary players on the same ground plane and collision proxy; controlled research input, not a tackle model or NFL validation.',
    scenarioId: NO_CONTACT_SCENARIO.id,
    seed: SEED,
    durationSeconds: NO_CONTACT_SCENARIO.duration,
    fixedTimestepSeconds: DT,
    carrier: { position: NO_CONTACT_SCENARIO.carrier.p, velocity: NO_CONTACT_SCENARIO.carrier.v, massKg: NO_CONTACT_SCENARIO.carrier.mass },
    defender: { position: NO_CONTACT_SCENARIO.defender.p, velocity: NO_CONTACT_SCENARIO.defender.v, massKg: NO_CONTACT_SCENARIO.defender.mass },
    fallingThresholdDeg: 55,
    results,
  };
}

export async function runContactSweep() {
  const versions = await engineVersions();
  const cells = [];
  for (const engine of Object.keys(ENGINE_RUNNERS)) {
    for (const approachAngleDeg of CONTACT_SWEEP_ANGLES_DEG) {
      for (const closingSpeedMps of CONTACT_SWEEP_SPEEDS_MPS) {
        cells.push(await runContactSweepCell(engine, approachAngleDeg, closingSpeedMps, versions));
      }
    }
  }
  const pairedCells = CONTACT_SWEEP_ANGLES_DEG.flatMap((approachAngleDeg) => CONTACT_SWEEP_SPEEDS_MPS.map((closingSpeedMps) => {
    const pair = Object.fromEntries(Object.keys(ENGINE_RUNNERS).map((engine) => [
      engine,
      cells.find((cell) => cell.engine === engine && cell.approachAngleDeg === approachAngleDeg && cell.closingSpeedMps === closingSpeedMps),
    ]));
    return { approachAngleDeg, closingSpeedMps, pair };
  }));
  const disagreement = (fallField) => {
    const disagreeingCells = pairedCells
      .filter(({ pair }) => pair['rapier3d-compat'][fallField] !== pair['jolt-physics-js'][fallField])
      .map(({ approachAngleDeg, closingSpeedMps }) => ({ approachAngleDeg, closingSpeedMps }));
    return {
      count: disagreeingCells.length,
      totalCells: pairedCells.length,
      share: disagreeingCells.length / pairedCells.length,
      cells: disagreeingCells,
    };
  };
  const control = await runNoContactControl(versions);
  return {
    generatedAt: new Date().toISOString(),
    label: 'Controlled research inputs with a five-collider collision proxy; not a tackle model, not a prediction, and not validation against NFL data.',
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model,
      engineVersions: versions,
    },
    method: {
      approachAngleDefinition: 'Carrier travel heading relative to the stationary defender forward axis; 0 degrees is head-on and 90 degrees is side-on. The carrier is yaw-aligned with its velocity and begins 2 m from the defender.',
      anglesDeg: CONTACT_SWEEP_ANGLES_DEG,
      closingSpeedsMps: CONTACT_SWEEP_SPEEDS_MPS,
      carrierClosingOnStationaryDefender: true,
      carrierMassKg: 96,
      defenderMassKg: 108,
      fixedTimestepSeconds: DT,
      durationSeconds: 1.5,
      collidersPerPlayer: 5,
      fallingThresholdDeg: 55,
      outcomeRandomDraw: false,
      policy: 'Initial approach velocity only; no post-contact motor, tackle-success draw, or forced fall.',
      cellCountPerEngine: CONTACT_SWEEP_ANGLES_DEG.length * CONTACT_SWEEP_SPEEDS_MPS.length,
      cellCountTotal: cells.length,
    },
    fallDisagreement: {
      carrier: disagreement('carrierFellAt55Deg'),
      defender: disagreement('defenderFellAt55Deg'),
    },
    control,
    cells,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifact = await runContactSweep();
  await writeFile(new URL('./results-sweep.json', import.meta.url), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${artifact.cells.length} controlled contact sweep cells to research/physics-3d-evaluation/results-sweep.json`);
}
