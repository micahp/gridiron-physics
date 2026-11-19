// Run: node web/basketball/actions.test.mjs
// The swipe must come from the shoulder: the shoulder sweeps a real arc while
// the elbow and wrist hold, and the palm follows the shoulder (not the wrist).
import assert from 'node:assert/strict';
import { fk, D } from './skeleton.js';
import { swipe } from './actions.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const N = 200;
let maxPalmStep = 0, prev = null, ankleLift = 0;
for (let i = 0; i <= N; i++) {
  const f = fk(swipe(i / N));
  if (prev) maxPalmStep = Math.max(maxPalmStep, dist(f.palmR.p, prev.palmR.p));
  prev = f;
  ankleLift = Math.max(ankleLift, Math.abs(f.toeR.p[1]), Math.abs(f.toeL.p[1]));
}
// shoulder sweep: total change in the upper arm's direction, degrees
const dirOf = (t) => {
  const f = fk(swipe(t));
  const v = [f.elR.p[0] - f.shR.p[0], f.elR.p[1] - f.shR.p[1], f.elR.p[2] - f.shR.p[2]];
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / D;
let upperSweep = 0;
for (let i = 1; i <= N; i++) upperSweep += angle(dirOf((i - 1) / N), dirOf(i / N));

// forearm direction relative to the upper arm (the elbow's hinge angle) and the hand's, per frame
const forearmOf = (t) => { const f = fk(swipe(t)); const v = [f.prR.p[0] - f.elR.p[0], f.prR.p[1] - f.elR.p[1], f.prR.p[2] - f.elR.p[2]]; const n = Math.hypot(...v); return v.map((x) => x / n); };
let forearmSweep = 0;
for (let i = 1; i <= N; i++) forearmSweep += angle(forearmOf((i - 1) / N), forearmOf(i / N));

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`ok    ${name}`); } catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); } };

check('shoulder does the work: the upper arm sweeps at least 40 degrees over the swipe', () => {
  assert.ok(upperSweep >= 40, `upper arm swept ${upperSweep.toFixed(1)} deg`);
});
check('elbow holds: the bend between upper arm and forearm stays within 2 deg through the swipe', () => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= N; i++) {
    const u = dirOf(i / N), w = forearmOf(i / N);
    const a = angle([-u[0], -u[1], -u[2]], w);   // bend = angle between the arm pointing back and the forearm
    lo = Math.min(lo, a); hi = Math.max(hi, a);
  }
  assert.ok(hi - lo < 2, `elbow bend varied ${(hi - lo).toFixed(1)} deg`);
});
console.log(`      info: forearm world sweep ${forearmSweep.toFixed(1)} deg vs upper arm ${upperSweep.toFixed(1)} deg (the shoulder carries the whole arm)`);
check('palm moves with the shoulder: no single frame moves the palm more than 4 cm', () => {
  assert.ok(maxPalmStep < 0.04, `palm stepped ${(maxPalmStep * 100).toFixed(1)} cm in one frame`);
});
check('feet stay flat through the swipe (toe tips within 1 mm of the floor)', () => {
  assert.ok(ankleLift < 0.001, `toe lifted ${(ankleLift * 1000).toFixed(2)} mm`);
});

console.log(failures ? `\n${failures} failing` : '\nall basketball action checks passed');
process.exit(failures ? 1 : 0);
