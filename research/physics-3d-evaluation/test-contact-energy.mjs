import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const result = JSON.parse(await readFile(new URL('./results/contact-energy.json', import.meta.url), 'utf8'));
const tiltTraces = JSON.parse(await readFile(new URL('./results/tilt-traces.json', import.meta.url), 'utf8'));
const close = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${label}: ${actual} differs from ${expected} by more than ${tolerance}`);

function assertFiniteTree(value, path = 'root') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} must be finite`);
  else if (Array.isArray(value)) value.forEach((child, index) => assertFiniteTree(child, `${path}[${index}]`));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) assertFiniteTree(child, `${path}.${key}`);
  }
}

assert.equal(result.schemaVersion, 1);
assert.equal(result.cells.length, 4, 'only the two requested angle/speed cells for both engines are included');
assertFiniteTree(result);

const cellKeys = new Set();
let totalFrames = 0;
let strictNoContactFrames = 0;
for (const cell of result.cells) {
  const key = `${cell.engine}:${cell.approachAngleDeg}:${cell.closingSpeedMps}`;
  assert.ok(!cellKeys.has(key), `duplicate cell ${key}`);
  cellKeys.add(key);
  assert.ok(['rapier3d-compat', 'jolt-physics-js'].includes(cell.engine));
  for (const modeName of ['dynamic', 'kinematic']) {
    const mode = cell.modes[modeName];
    assert.ok(mode);
    assert.equal(mode.frames.length, 180, `${key} ${modeName} must have 180 frames`);
    assert.equal(mode.energySummary.strictNoContactFrameCount,
      mode.frames.filter((frame) => !frame.contactStep).length);
    assert.equal(mode.energySummary.nonTackleFrameCount,
      mode.frames.filter((frame) => !frame.tackleContactStep).length);
    totalFrames += mode.frames.length;

    let previousPosition = mode.initial.carrier.worldCenterOfMassM;
    for (const [index, frame] of mode.frames.entries()) {
      assert.equal(frame.tick, index + 1);
      close(frame.timeSeconds, frame.tick / 120, 1e-12, `${key} ${modeName} time`);
      for (const role of ['carrier', 'defender']) {
        const body = frame.bodies[role];
        assert.equal(body.worldCenterOfMassM.length, 3);
        assert.equal(body.linearVelocityMps.length, 3);
        assert.equal(body.angularVelocityRadPerSec.length, 3);
        for (const energyKey of ['linearKEJ', 'rotationalKEJ', 'gravitationalPEJ', 'totalMechanicalEnergyJ']) {
          assert.ok(Number.isFinite(body[energyKey]), `${key} ${modeName} tick ${frame.tick} ${role}.${energyKey}`);
        }
        close(body.totalMechanicalEnergyJ,
          body.linearKEJ + body.rotationalKEJ + body.gravitationalPEJ,
          1e-7, `${key} ${modeName} ${role} mechanical energy`);
      }
      close(frame.deltaTotalMechanicalEnergyJ,
        frame.deltaKineticEnergyJ + frame.deltaPotentialEnergyJ,
        1e-6, `${key} ${modeName} tick ${frame.tick} energy-component delta`);
      close(frame.carrierIntegrationResidualM,
        Math.hypot(...frame.carrierIntegrationResidualVectorM), 1e-9,
        `${key} ${modeName} tick ${frame.tick} carrier integration residual`);
      const displacement = bodyPositionDelta(frame.bodies.carrier.worldCenterOfMassM, previousPosition);
      const integrated = frame.bodies.carrier.linearVelocityMps.map((velocity) => velocity / 120);
      const integrationResidual = displacement.map((value, axis) => value - integrated[axis]);
      close(frame.carrierIntegrationResidualM, Math.hypot(...integrationResidual), 1e-7,
        `${key} ${modeName} tick ${frame.tick} recomputed carrier velocity integration`);
      assert.ok(frame.carrierIntegrationResidualM <= result.acceptanceBounds.maximumCarrierIntegrationResidualM,
        `${key} ${modeName} carrier velocity integration exceeds the stated bound`);

      // This tests every strictly contact-free gravity-only frame available in
      // the frozen scene. The test reports zero coverage when the ground
      // support contact leaves no such frames; it does not relabel tackle-free
      // steps as contact-free.
      if (!frame.contactStep) {
        strictNoContactFrames++;
        assert.ok(Math.abs(frame.deltaTotalMechanicalEnergyJ)
          <= result.acceptanceBounds.maximumStrictNoContactEnergyDriftJPerStep,
        `${key} ${modeName} contact-free mechanical-energy drift exceeded the stated bound`);
      }
      if (frame.contactStep) {
        close(frame.contactEnergyChangeJ, frame.deltaTotalMechanicalEnergyJ, 1e-9,
          `${key} ${modeName} contact-step attribution`);
        assert.equal(frame.nonContactEnergyChangeJ, null);
      } else {
        close(frame.nonContactEnergyChangeJ, frame.deltaTotalMechanicalEnergyJ, 1e-9,
          `${key} ${modeName} non-contact-step attribution`);
      }
      previousPosition = frame.bodies.carrier.worldCenterOfMassM;
    }
    const finalPosition = mode.frames.at(-1).bodies.carrier.worldCenterOfMassM;
    assert.ok(finalPosition.every(Number.isFinite));
    assert.ok(previousPosition.every(Number.isFinite));
  }
}

function bodyPositionDelta(position, previous) {
  return position.map((value, axis) => value - previous[axis]);
}

assert.deepEqual([...cellKeys].sort(), [
  'jolt-physics-js:30:8', 'jolt-physics-js:60:6',
  'rapier3d-compat:30:8', 'rapier3d-compat:60:6',
].sort());
assert.equal(totalFrames, 4 * 2 * 180);
assert.equal(result.method.timestepSeconds, 1 / 120);
assert.equal(strictNoContactFrames,
  result.cells.reduce((sum, cell) => sum + Object.values(cell.modes)
    .reduce((modeSum, mode) => modeSum + mode.energySummary.strictNoContactFrameCount, 0), 0));

for (const cell of result.cells.filter((entry) => entry.modes.dynamic)) {
  const trace = tiltTraces.traces.find((entry) => entry.engine === cell.engine
    && entry.approachAngleDeg === cell.approachAngleDeg && entry.closingSpeedMps === cell.closingSpeedMps);
  const mode = cell.modes.dynamic;
  close(mode.peakTiltDeg, trace.carrier.peakTiltDeg, 1e-7, `${cell.engine} ${cell.approachAngleDeg}/${cell.closingSpeedMps} trace peak`);
  assert.equal(mode.peakTick, trace.carrier.peakTick);
}

function verdictFor(mode) {
  const peak = mode.frames.find((frame) => frame.tick === mode.peakTick);
  const first = mode.frames[0];
  const kineticIncrease = Math.max(0,
    peak.bodies.defender.linearKEJ + peak.bodies.defender.rotationalKEJ
      - first.bodies.defender.linearKEJ - first.bodies.defender.rotationalKEJ);
  const potentialRelease = Math.max(0,
    first.bodies.defender.gravitationalPEJ - peak.bodies.defender.gravitationalPEJ);
  const motionActivity = kineticIncrease + potentialRelease;
  const residual = Math.abs(mode.energySummary.summedEnergyResidualAfterNormalImpulseJ);
  return {
    motionActivity,
    residual,
    verdict: motionActivity > residual ? 'energy_diverted_into_defender_motion' : 'nonphysical_energy_change_at_contact',
  };
}

const joltTarget = result.cells.find((cell) => cell.engine === 'jolt-physics-js'
  && cell.approachAngleDeg === 60 && cell.closingSpeedMps === 6);
const recomputed = verdictFor(joltTarget.modes.dynamic);
assert.equal(result.centralVerdict.verdict, recomputed.verdict,
  'the central pass/fail verdict must be calculated from the serialized energy and work ledger');
close(result.centralVerdict.peakEnergyJ.defenderMotionEnergyActivityJ,
  recomputed.motionActivity, 1e-7, 'central verdict defender-motion comparison');
close(result.centralVerdict.wholeSystemLedgerJ.residualAfterNormalImpulseWork,
  joltTarget.modes.dynamic.energySummary.summedEnergyResidualAfterNormalImpulseJ,
  1e-7, 'central verdict residual');
assert.ok(['energy_diverted_into_defender_motion', 'nonphysical_energy_change_at_contact']
  .includes(result.centralVerdict.verdict));

console.log(JSON.stringify({
  passed: true,
  cells: result.cells.length,
  modes: 8,
  frames: totalFrames,
  carrierVelocityIntegrationBoundM: result.acceptanceBounds.maximumCarrierIntegrationResidualM,
  strictNoContactGravityOnlyFrames: strictNoContactFrames,
  strictNoContactConservation: strictNoContactFrames
    ? 'checked_within_stated_bound'
    : 'not_exercised_ground_support_contact_in_every_frame',
  jolt60Degree6MpsVerdict: result.centralVerdict.verdict,
}, null, 2));
