import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/three.module.js';
import { stablePhase, composeBindRelativeQuaternion, splitUniformGeometry } from '../web/rigged-player.js';

function quaternionClose(actual, expected, epsilon = 1e-8) {
  assert.ok(actual.angleTo(expected) < epsilon, `quaternions differ by ${actual.angleTo(expected)} radians`);
}

test('stablePhase is repeatable for a player and seed and varies across identities', () => {
  const first = stablePhase('player-1', 'week7-seed-1042');
  assert.equal(first, stablePhase('player-1', 'week7-seed-1042'));
  assert.notEqual(first, stablePhase('player-2', 'week7-seed-1042'));
  assert.notEqual(first, stablePhase('player-1', 'week7-seed-2048'));
  assert.ok(first >= 0 && first < Math.PI * 2);
});

test('bind-relative rotations compose flexion and abduction before applying the bind pose', () => {
  const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.1, 0.35));
  const parent = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0.4, 0.1));
  const flexion = { axis: new THREE.Vector3(0, 0, 1), angle: 0.65 };
  const abduction = { axis: new THREE.Vector3(1, 0, 0), angle: -0.42 };
  const worldDelta = new THREE.Quaternion().setFromAxisAngle(abduction.axis, abduction.angle)
    .multiply(new THREE.Quaternion().setFromAxisAngle(flexion.axis, flexion.angle));
  const expected = parent.clone().invert().multiply(worldDelta).multiply(parent).multiply(rest);
  quaternionClose(composeBindRelativeQuaternion(rest, parent, [flexion, abduction]), expected);

  const overwritten = parent.clone().invert()
    .multiply(new THREE.Quaternion().setFromAxisAngle(abduction.axis, abduction.angle))
    .multiply(parent).multiply(rest);
  assert.ok(expected.angleTo(overwritten) > 0.1, 'test setup must distinguish composition from overwrite');
});

test('uniform triangles split into distinct pants and jersey material groups by bind height', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0.4, 0, 1, 0.5, 0, 0, 0.6, 0,
    0, 1.1, 0, 1, 1.2, 0, 0, 1.3, 0,
  ], 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  const result = splitUniformGeometry(geometry, 0.9);
  assert.equal(result.pantsIndexCount, 3);
  assert.equal(result.jerseyIndexCount, 3);
  assert.deepEqual(geometry.groups.map(({ start, count, materialIndex }) => ({ start, count, materialIndex })), [
    { start: 0, count: 3, materialIndex: 0 },
    { start: 3, count: 3, materialIndex: 1 },
  ]);
});
