import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/three.module.js';
import { stablePhase, composeBindRelativeQuaternion, splitUniformGeometry, recolorKitAtlas, kitAtlasKey, paintJerseyNumber, bodyLean } from '../web/rigged-player.js';

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

test('recolorKitAtlas paints jersey, pants and trim regions and covers the baked number', () => {
  const size = 1024;
  const data = new Uint8ClampedArray(size * size * 4);
  const put = (x, y, v) => { const i = (y * size + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, 28);   // dark fabric everywhere
  put(900, 300, 250);                                                             // white panel pixel on the jersey
  put(770, 460, 250);                                                             // baked number pixel (front)
  const kit = { jersey: '#ff0000', pants: '#0000ff', trim: '#ffff00', number: '#ffffff' };
  recolorKitAtlas(data, size, kit);
  const at = (x, y) => { const i = (y * size + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const [jr, jg, jb] = at(800, 250);   // jersey area
  assert.ok(jr > 150 && jg < 30 && jb < 30, `jersey should be red, got ${at(800, 250)}`);
  const [pr, pg, pb] = at(100, 600);   // pants area
  assert.ok(pb > 150 && pr < 30 && pg < 30, `pants should be blue, got ${at(100, 600)}`);
  const [tr, tg, tb] = at(900, 300);   // white panel takes the trim colour
  assert.ok(tr > 180 && tg > 180 && tb < 40, `trim should be yellow, got ${at(900, 300)}`);
  const num = at(770, 460);            // number pixel is now plain jersey, not white
  assert.ok(num[0] > 100 && num[1] < 30, `baked number should be covered, got ${num}`);
});

test('kitAtlasKey differs per team colours and is stable', () => {
  const a = { jersey: '#111', pants: '#222', trim: '#333', number: '#fff' };
  assert.equal(kitAtlasKey(a), kitAtlasKey({ ...a }));
  assert.notEqual(kitAtlasKey(a), kitAtlasKey({ ...a, jersey: '#112' }));
});

test('paintJerseyNumber writes the number once on the front panel and once on the back, scaled to the atlas size', () => {
  const calls = [];
  const g = {
    save() {}, restore() {}, scale(x, y) { calls.push(['scale', x, y]); },
    strokeText(t, x, y) { calls.push(['stroke', t, x, y]); }, fillText(t, x, y) { calls.push(['fill', t, x, y]); },
  };
  paintJerseyNumber(g, 512, '66', { trim: '#111', number: '#fff' });
  const fills = calls.filter((c) => c[0] === 'fill');
  assert.equal(fills.length, 2, 'front and back');
  assert.ok(fills.every((c) => c[1] === '66'));
  assert.deepEqual(calls.find((c) => c[0] === 'scale'), ['scale', 0.5, 0.5], 'coordinates are in 1024-atlas space and scaled to the canvas');
  assert.ok(fills[0][2] < fills[1][2] + 100 && fills[0][3] < fills[1][3], 'front panel is above the back panel in the atlas');
  // a blank number paints nothing (a player with no jersey number must not show "undefined")
  calls.length = 0;
  paintJerseyNumber(g, 512, undefined, { trim: '#111', number: '#fff' });
  paintJerseyNumber(g, 512, '  ', { trim: '#111', number: '#fff' });
  assert.equal(calls.length, 0);
});

test('bodyLean: leans forward when accelerating, back when braking, into a turn, and holds still when paused or seeking', () => {
  const st = {};
  // heading +x. Prime with a standing sample, then accelerate at 5 m/s^2 for half a second
  bodyLean(st, { vx: 0, vy: 0, yaw: 0, time: 0 });
  let L;
  for (let i = 1; i <= 15; i++) L = bodyLean(st, { vx: 5 * (i / 30), vy: 0, yaw: 0, time: i / 30 });
  assert.ok(L.pitch > 0.15 && L.pitch <= 0.26 + 1e-9, `forward lean ${L.pitch}`);
  assert.ok(Math.abs(L.roll) < 0.02, 'straight-line acceleration does not roll');
  // paused (same time): the pose is held, not decayed or jumped
  const held = bodyLean(st, { vx: 2.5, vy: 0, yaw: 0, time: 15 / 30 });
  assert.equal(held.pitch, L.pitch);
  // brake hard: rocks back
  for (let i = 16; i <= 40; i++) L = bodyLean(st, { vx: Math.max(0, 2.5 - 8 * ((i - 15) / 30)), vy: 0, yaw: 0, time: i / 30 });
  assert.ok(L.pitch < 0, `braking should lean back, got ${L.pitch}`);
  // a turn to the left (heading +x, left = (sin 0, -cos 0) = -y): velocity gains -y while speed stays
  const t = {};
  bodyLean(t, { vx: 6, vy: 0, yaw: 0, time: 0 });
  for (let i = 1; i <= 20; i++) L = bodyLean(t, { vx: 6, vy: -4 * (i / 30), yaw: 0, time: i / 30 });
  assert.ok(L.roll > 0.15, `leaning into a left turn, got roll ${L.roll}`);
  // a seek backwards in time or a long gap resets: no stale lean
  const r = bodyLean(t, { vx: 6, vy: 0, yaw: 0, time: 0.1 });
  assert.deepEqual(r, { pitch: 0, roll: 0 });
});
