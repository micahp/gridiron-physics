// Assertions for the basketball skeleton. Run: node web/basketball/skeleton.test.mjs
// Each block is one aspect (see the court-rig-realism skill): geometry, feet,
// joint limits, hand touch point. Limits are human ranges; segment lengths are
// the football body's measured lengths.
import assert from 'node:assert/strict';
import { fk, D, LIMITS } from './skeleton.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const MM = 0.001;
let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`ok    ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

// seeded random so failures reproduce
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const rr = (lo, hi) => lo + (hi - lo) * rnd();
function randomPose() {
  return {
    hipR: [rr(-40, 60) * D, rr(-10, 20) * D, rr(-10, 10) * D],
    hipL: [rr(-40, 60) * D, rr(-10, 20) * D, rr(-10, 10) * D],
    knR: rr(0, 130) * D, knL: rr(0, 130) * D,
    shR: [rr(-60, 170) * D, rr(-20, 160) * D, rr(-60, 60) * D],
    shL: [rr(-60, 170) * D, rr(-20, 160) * D, rr(-60, 60) * D],
    elR: rr(0, 140) * D, elL: rr(0, 140) * D,
    prR: rr(-80, 80) * D, prL: rr(-80, 80) * D,
    wrR: [rr(-60, 70) * D, rr(-20, 20) * D], wrL: [rr(-60, 70) * D, rr(-20, 20) * D],
    spine: [rr(-10, 30) * D, rr(-5, 5) * D, rr(-20, 20) * D],
    chest: [rr(-5, 15) * D, 0, rr(-20, 20) * D],
    neck: [rr(-10, 10) * D, 0, 0],
  };
}

check('segment lengths match the football body (0.5 mm)', () => {
  const f = fk({});
  const pairs = {
    thigh: ['hipR', 'knR', 0.45], shin: ['knR', 'anR', 0.43],
    upperArm: ['shR', 'elR', 0.29], forearm: ['elR', 'prR', 0.26],
  };
  for (const [name, [a, b, want]] of Object.entries(pairs)) {
    const got = dist(f[a].p, f[b].p);
    assert.ok(Math.abs(got - want) < 0.5 * MM, `${name}: ${got.toFixed(4)} m, want ${want}`);
  }
});

check('standing rest: toe tips on the floor (within 1 mm)', () => {
  const f = fk({});
  assert.ok(Math.abs(f.toeR.p[1]) < MM, `toeR y ${f.toeR.p[1]}`);
  assert.ok(Math.abs(f.toeL.p[1]) < MM, `toeL y ${f.toeL.p[1]}`);
});

check('flat feet: foot stays level for any leg pose (toe-ankle height is -0.08 m)', () => {
  for (let i = 0; i < 300; i++) {
    const f = fk(randomPose());
    for (const s of ['R', 'L']) {
      const drop = f['toe' + s].p[1] - f['an' + s].p[1];
      assert.ok(Math.abs(drop + 0.08) < MM, `${s} foot tilt: toe ${drop.toFixed(4)} below ankle, want -0.08`);
    }
  }
});

check('no stretch: every bone keeps its rest length, every pose', () => {
  const rest = fk({});
  const len = (f, a, b) => dist(f[a].p, f[b].p);
  const pairs = [['hipR', 'knR'], ['knR', 'anR'], ['shR', 'elR'], ['elR', 'prR'], ['prR', 'wrR'], ['spine', 'chest'], ['chest', 'neck']];
  for (let i = 0; i < 300; i++) {
    const f = fk(randomPose());
    for (const [a, b] of pairs) {
      assert.ok(Math.abs(len(f, a, b) - len(rest, a, b)) < 1e-9, `${a}-${b} changed`);
    }
  }
});

check('elbow limits: the bend is clamped to -10..150 degrees', () => {
  for (const deg of [-60, 200]) {
    const f = fk({ elR: deg * D });
    const up = [f.elR.p[0] - f.shR.p[0], f.elR.p[1] - f.shR.p[1], f.elR.p[2] - f.shR.p[2]];
    const fo = [f.prR.p[0] - f.elR.p[0], f.prR.p[1] - f.elR.p[1], f.prR.p[2] - f.elR.p[2]];
    const cos = (up[0] * fo[0] + up[1] * fo[1] + up[2] * fo[2]) / (Math.hypot(...up) * Math.hypot(...fo));
    // the bend is the angle between the arms; its sign is whether the forearm points forward (+x)
    const bend = Math.sign(fo[0]) * Math.acos(Math.max(-1, Math.min(1, cos))) / D;
    const want = Math.min(LIMITS.elbowMax, Math.max(LIMITS.elbowMin, deg));
    assert.ok(Math.abs(bend - want) < 0.5, `elbow ${deg} gave a ${bend.toFixed(1)} deg bend, want ${want}`);
  }
});

check('palm touch point: 0.08 m from the wrist, every pose (no guessing at call sites)', () => {
  for (let i = 0; i < 200; i++) {
    const f = fk(randomPose());
    for (const s of ['R', 'L']) {
      const d = dist(f['palm' + s].p, f['wr' + s].p);
      assert.ok(Math.abs(d - Math.hypot(0.08, 0.02)) < MM, `${s} palm ${d.toFixed(4)} m from wrist`);
    }
  }
});

check('shoulder reaches the ball: arm straight out forward is 0.55 m shoulder to wrist', () => {
  const f = fk({ shR: [90 * D, 0, 0], elR: 0, prR: 0 });
  const d = dist(f.shR.p, f.wrR.p);
  assert.ok(Math.abs(d - 0.55) < MM, `arm ${d.toFixed(4)} m`);
});

console.log(failures ? `\n${failures} failing` : '\nall basketball skeleton checks passed');
process.exit(failures ? 1 : 0);
