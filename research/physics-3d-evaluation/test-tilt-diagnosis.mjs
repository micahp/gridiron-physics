import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const traces = JSON.parse(await readFile(new URL('./results/tilt-traces.json', import.meta.url), 'utf8'));
const sweep = JSON.parse(await readFile(new URL('./results-sweep.json', import.meta.url), 'utf8'));
const close = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
const clamp = (x) => Math.max(-1, Math.min(1, x));
const tilt = (upY) => Math.acos(clamp(upY)) * 180 / Math.PI;

function quaternionRotateVector([vx, vy, vz], [x, y, z, w]) {
  const norm = Math.hypot(x, y, z, w);
  x /= norm; y /= norm; z /= norm; w /= norm;
  const cross1 = [y * vz - z * vy, z * vx - x * vz, x * vy - y * vx];
  const t = cross1.map((v) => 2 * v);
  const cross2 = [y * t[2] - z * t[1], z * t[0] - x * t[2], x * t[1] - y * t[0]];
  return [vx + w * t[0] + cross2[0], vy + w * t[1] + cross2[1], vz + w * t[2] + cross2[2]];
}

assert.equal(traces.traces.length, 8, 'four requested sweep cells must be traced for both engines');
let maxJoltFormulaDeltaDeg = 0;
for (const trace of traces.traces) {
  assert.equal(trace.frames.length, 180, `${trace.engine} ${trace.approachAngleDeg}/${trace.closingSpeedMps} must contain 180 fixed steps`);
  const sweepCell = sweep.cells.find((cell) => cell.engine === trace.engine
    && cell.approachAngleDeg === trace.approachAngleDeg
    && cell.closingSpeedMps === trace.closingSpeedMps);
  assert.ok(sweepCell, 'trace must correspond to a committed sweep cell');

  for (const player of ['carrier', 'defender']) {
    let max = -Infinity;
    for (const [index, frame] of trace.frames.entries()) {
      assert.equal(frame.tick, index + 1, 'trace frame ticks must be contiguous from the first physics step');
      close(frame.timeSeconds, (index + 1) / 120, 1e-12, 'trace time must use the frozen 1/120 s step');
      const state = frame.players[player];
      const [x, , z, w] = state.rotation;
      const recordedFormulaTilt = tilt(1 - 2 * (x * x + z * z));
      const independentlyRotatedUp = quaternionRotateVector([0, 1, 0], state.rotation);
      const independentlyRotatedTilt = tilt(independentlyRotatedUp[1]);
      close(state.tiltDeg, recordedFormulaTilt, 1e-10, 'trace must preserve the frozen sweep quaternion formula');
      close(state.alternateTiltDeg, independentlyRotatedTilt, 1e-7, 'alternate angle must rotate local up with a normalized quaternion');
      close(state.tiltFormulaDeltaDeg, Math.abs(recordedFormulaTilt - independentlyRotatedTilt), 1e-7, 'stored formula delta must match recomputation');
      assert.ok([...state.position, ...state.rotation, ...state.velocity, ...state.angularVelocityRadPerSec,
        state.tiltDeg, state.alternateTiltDeg, state.tiltFormulaDeltaDeg].every(Number.isFinite), 'trace state must remain finite');
      if (trace.engine === 'jolt-physics-js') maxJoltFormulaDeltaDeg = Math.max(maxJoltFormulaDeltaDeg, state.tiltFormulaDeltaDeg);
      max = Math.max(max, recordedFormulaTilt);
    }
    close(max, sweepCell[player === 'carrier' ? 'carrierPeakTiltDeg' : 'defenderPeakTiltDeg'], 1e-8,
      `${player} quaternion trace peak must equal committed sweep peak`);
  }
  for (const colliderPeak of Object.values(trace.carrier.perColliderRigidBodyPeakTilt)) {
    close(colliderPeak.peakTiltDeg, trace.carrier.peakTiltDeg, 1e-10, 'rigidly attached collider peak must match its shared body');
    assert.equal(colliderPeak.rigidlySharedWithOtherParts, true);
  }
  assert.equal(trace.carrier.perColliderLongAxisPeakTilt.head.peakTiltDeg, null, 'spherical head has no long-axis angle');
}

assert.ok(maxJoltFormulaDeltaDeg < 0.00002, `Jolt quaternion tilt formulations diverged by ${maxJoltFormulaDeltaDeg} degrees`);
const jolt30x8 = traces.traces.find((trace) => trace.engine === 'jolt-physics-js' && trace.approachAngleDeg === 30 && trace.closingSpeedMps === 8);
assert.ok(jolt30x8.carrier.peakTiltDeg > 90, 'Jolt 30°/8 m/s carrier trace must capture past-flat rotation');
assert.equal(jolt30x8.carrier.groundContactAtPeak, false, 'Jolt carrier is airborne at the >90° peak');

const joltImpulseCurve = traces.singleBody.impulseResponses
  .filter((result) => result.engine === 'jolt-physics-js')
  .sort((a, b) => a.impulseNs - b.impulseNs);
assert.deepEqual(joltImpulseCurve.map((result) => result.impulseNs), [120, 180, 240, 300]);
for (let i = 1; i < joltImpulseCurve.length; i++) {
  assert.ok(joltImpulseCurve[i].peakTiltDeg >= joltImpulseCurve[i - 1].peakTiltDeg,
    'isolated Jolt off-center impulse response should remain monotone in the committed probe');
}

console.log(JSON.stringify({
  passed: true,
  tracedEngineCells: traces.traces.length,
  framesPerCell: traces.traces[0].frames.length,
  tracePeaksMatchFrozenSweep: true,
  maximumJoltQuaternionFormulaDeltaDeg: maxJoltFormulaDeltaDeg,
  jolt30Degree8MpsPeakTiltDeg: jolt30x8.carrier.peakTiltDeg,
  jolt30Degree8MpsGroundContactAtPeak: jolt30x8.carrier.groundContactAtPeak,
  joltSingleBodyImpulseResponseMonotone: true,
}, null, 2));
