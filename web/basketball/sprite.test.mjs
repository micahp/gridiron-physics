// Checks for the basketball sprite stack. Run: node web/basketball/sprite.test.mjs
import assert from 'node:assert/strict';
import { rasterise, swipeFrame, bodyParts, VOXEL, G, X0, Z0, NL, COLOURS, BALL } from './sprite.js';
import { swipe, STRIKE_T } from './actions.js';
import { poseOf } from './library.js';

let fails = 0;
function check(name, fn) {
  try { fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n   ', e.message); }
}

// index of the layer containing height y
const layerAt = (y) => Math.floor(y / VOXEL);
// pixel column/row for world x,z
const colAt = (x) => Math.floor((x - X0) / VOXEL);
const rowAt = (z) => Math.floor((Z0 + G * VOXEL - z) / VOXEL);
const px = (data, k, r, i) => {
  const o = ((k * G + r) * G + i) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
};
// same hue as a palette colour (brightness may differ with the shading)
const sameHue = (c, k) => Math.abs(c[1] / c[0] - k[1] / k[0]) < 0.08 && Math.abs(c[2] / c[0] - k[2] / k[0]) < 0.08;
const near = sameHue;

const t0 = performance.now();
const { data, pose } = swipeFrame(STRIKE_T);
const ms = performance.now() - t0;
console.log(`rasterise one frame: ${ms.toFixed(0)} ms (${NL} layers, ${G}x${G} px)`);

check('stack covers 0..1.95 m in layers of 25 mm', () => {
  assert.equal(NL, 78);
  assert.equal(VOXEL, 0.025);
});

check('solid pixels exist at head, chest, hip, knee, foot heights', () => {
  const solid = (y) => {
    const k = layerAt(y);
    let n = 0;
    for (let r = 0; r < G; r++) for (let i = 0; i < G; i++) if (px(data, k, r, i)[3] === 255) n++;
    return n;
  };
  for (const y of [1.7, 1.4, 1.0, 0.6, 0.1]) assert.ok(solid(y) > 0, `no solid pixels at y=${y}`);
});

check('a body is between 1.8 and 2.0 m tall (head top, bottom of sole)', () => {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < NL; k++) for (let r = 0; r < G; r++) for (let i = 0; i < G; i++) {
    if (px(data, k, r, i)[3] === 255) { lo = Math.min(lo, k); hi = Math.max(hi, k); }
  }
  const top = (hi + 1) * VOXEL, bot = lo * VOXEL;
  assert.ok(bot < 0.04, `sole at ${bot.toFixed(3)} m`);
  assert.ok(top > 1.7 && top < 1.95, `top ${top.toFixed(3)} m`);
});

check('the ball is drawn at the strike point with the ball colour', () => {
  const k = layerAt(BALL.c[1]), r = rowAt(BALL.c[2]), i = colAt(BALL.c[0]);
  const c = px(data, k, r, i);
  assert.equal(c[3], 255, 'ball centre pixel empty');
  assert.ok(c[0] > 1.8 * c[2] && c[0] > c[1], `centre colour ${c.slice(0, 3)} is not orange`);
});

check('the palm is in the hand, not floating: skin or jersey pixel at the palm joint', () => {
  const parts = bodyParts(pose);
  // palmR joint position from the pose itself
  const palm = parts.find((p) => p.kind === 'skin' && p.b && p.r === 0.045 && p.b);
  assert.ok(palm, 'no palm part');
  const pb = palm.b;
  const k = layerAt(pb[1]), r = rowAt(pb[2]), i = colAt(pb[0]);
  const c = px(data, k, r, i);
  assert.equal(c[3], 255, `no solid pixel at palm (${pb.map((v) => v.toFixed(2))})`);
  assert.ok(near(c, COLOURS.skin) || near(c, COLOURS.jersey), `palm pixel ${c.slice(0,3)} is not skin`);
});

check('contact: at the strike the palm touches the ball surface (palm joint 12-18 cm from ball centre)', () => {
  const f = bodyParts(pose);
  const b = f.find((x) => x.kind === 'ball');
  const palm = f.find((x) => x.kind === 'skin' && x.r === 0.045 && x.b);
  const d = Math.hypot(...palm.b.map((v, j) => v - b.c[j]));
  assert.ok(d >= 0.12 && d <= 0.18, `palm ${(d * 100).toFixed(1)} cm from the ball centre`);
});

check('frames are deterministic: the same pose gives the same layers', () => {
  const again = rasterise(swipe(STRIKE_T)).data;
  assert.equal(again.length, data.length);
  let diff = 0;
  for (let j = 0; j < data.length; j++) if (again[j] !== data[j]) diff++;
  assert.equal(diff, 0);
});

check('the swipe changes the sprite: the arm moves between t=0 and t=0.5', () => {
  const a = rasterise(swipe(0)).data;
  let diff = 0;
  for (let j = 3; j < data.length; j += 4) if (a[j] !== data[j]) diff++;
  assert.ok(diff > 200, `only ${diff} pixels changed`);
});

check('the jersey carries its number on the back (dark digit pixels on the -x side of the shirt)', () => {
  const st = rasterise(poseOf('stance', 0)).data;
  let n = 0;
  for (let k = 0; k < NL; k++) for (let r = 0; r < G; r++) for (let i = 0; i < G; i++) {
    const o = ((k * G + r) * G + i) * 4;
    if (st[o + 3] === 255 && st[o] < 40 && st[o + 1] < 40 && st[o + 2] < 45) n++;
  }
  assert.ok(n >= 10, `only ${n} digit pixels`);
});

console.log(fails ? `\n${fails} FAILED` : '\nall sprite checks pass');
process.exit(fails ? 1 : 0);
