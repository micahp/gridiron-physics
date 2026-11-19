// Checks for the constrained v1 action library. Run: node web/basketball/library.test.mjs
// Every action is sampled at 200 frames a second and checked frame by frame.
import assert from 'node:assert/strict';
import { LIBRARY, poseOf, frame, LIMITS, D } from './library.js';
import { BALL } from './sprite.js';

const FPS = 200;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`ok    ${name}`); } catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); } };

/** Every frame of an action: { t, pose (grounded), f (fk) }. */
function frames(name) {
  const n = Math.round(LIBRARY[name].seconds * FPS);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const pose = poseOf(name, t);
    out.push({ t, pose, f: frame(name, t) });
  }
  return out;
}

const actions = Object.keys(LIBRARY);
const all = Object.fromEntries(actions.map((a) => [a, frames(a)]));

// --- rules every action must pass
for (const name of actions) {
  check(`${name}: both feet on the floor in every frame (toes within 1 mm)`, () => {
    let worst = 0;
    for (const fr of all[name]) worst = Math.max(worst, Math.abs(fr.f.toeR.p[1]), Math.abs(fr.f.toeL.p[1]));
    assert.ok(worst < 0.001, `a toe was ${(worst * 1000).toFixed(2)} mm off the floor`);
  });

  check(`${name}: no joint leaves its human limit (elbow -10..150, knee 0..150)`, () => {
    for (const fr of all[name]) {
      for (const k of ['elR', 'elL']) {
        const deg = fr.pose[k] / D;
        assert.ok(deg >= LIMITS.elbowMin - 1e-6 && deg <= LIMITS.elbowMax + 1e-6, `${k} ${deg.toFixed(1)} deg at t ${fr.t.toFixed(2)}`);
      }
      for (const k of ['knR', 'knL']) {
        const deg = fr.pose[k] / D;
        assert.ok(deg >= LIMITS.kneeMin - 1e-6 && deg <= LIMITS.kneeMax + 1e-6, `${k} ${deg.toFixed(1)} deg at t ${fr.t.toFixed(2)}`);
      }
    }
  });

  // A fast arm strike peaks near 5 to 8 m/s; a dribble push is far slower.
  const SPEED_LIMIT = name === 'swipe' ? 8 : 2.5;
  check(`${name}: the palm never moves faster than ${SPEED_LIMIT} m/s`, () => {
    const dt = 1 / FPS;
    let worst = 0;
    const fs = all[name];
    for (let i = 1; i < fs.length; i++) worst = Math.max(worst, dist(fs[i].f.palmR.p, fs[i - 1].f.palmR.p) / dt);
    assert.ok(worst < SPEED_LIMIT, `palm peaked at ${worst.toFixed(2)} m/s`);
  });
}

// --- per action
check('stance: static (the palm does not move through the stance)', () => {
  const fs = all.stance;
  let travel = 0;
  for (let i = 1; i < fs.length; i++) travel = Math.max(travel, dist(fs[i].f.palmR.p, fs[0].f.palmR.p));
  assert.ok(travel < 0.001, `palm moved ${(travel * 1000).toFixed(1)} mm during the stance`);
});

check('dribble: the palm pushes the ball at a waist-to-hip height (0.9 to 1.2 m) at the top of the push', () => {
  const top = all.dribble[0].f.palmR.p[1];
  assert.ok(top >= 0.9 && top <= 1.2, `push point at ${top.toFixed(2)} m`);
});

check('dribble: the push goes down 8 cm or more, and not below the hip (0.85 m)', () => {
  const fs = all.dribble;
  const top = fs[0].f.palmR.p[1];
  const low = Math.min(...fs.map((fr) => fr.f.palmR.p[1]));
  assert.ok(top - low >= 0.08, `push depth ${((top - low) * 100).toFixed(1)} cm`);
  assert.ok(low >= 0.85, `lowest palm ${low.toFixed(2)} m`);
});

check('dribble: the arm stays in reach of the shoulder (palm within 0.80 m of it, every frame)', () => {
  let worst = 0;
  for (const fr of all.dribble) worst = Math.max(worst, dist(fr.f.palmR.p, fr.f.shR.p));
  assert.ok(worst <= 0.82, `palm ${worst.toFixed(2)} m from the shoulder`);
});

check('swipe: at the strike the palm is 12 to 18 cm from the ball centre', () => {
  const k = Math.round(LIBRARY.swipe.contact.t * LIBRARY.swipe.seconds * FPS);
  const fr = all.swipe[k];
  const d = dist(fr.f.palmR.p, BALL.c);
  assert.ok(d >= 0.12 && d <= 0.18, `palm ${(d * 100).toFixed(1)} cm from the ball centre`);
});

check('swipe: the shoulder drives it (the upper arm sweeps at least 40 degrees)', () => {
  const dirOf = (fr) => { const v = [fr.f.elR.p[0] - fr.f.shR.p[0], fr.f.elR.p[1] - fr.f.shR.p[1], fr.f.elR.p[2] - fr.f.shR.p[2]]; const n = Math.hypot(...v); return v.map((x) => x / n); };
  let sweep = 0;
  for (let i = 1; i < all.swipe.length; i++) {
    const a = dirOf(all.swipe[i - 1]), b = dirOf(all.swipe[i]);
    sweep += Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / D;
  }
  assert.ok(sweep >= 40, `upper arm swept ${sweep.toFixed(1)} deg`);
});

check('swipe: the elbow bend stays within 2 degrees (the elbow holds)', () => {
  let lo = Infinity, hi = -Infinity;
  for (const fr of all.swipe) {
    const u = [fr.f.shR.p[0] - fr.f.elR.p[0], fr.f.shR.p[1] - fr.f.elR.p[1], fr.f.shR.p[2] - fr.f.elR.p[2]];
    const w = [fr.f.prR.p[0] - fr.f.elR.p[0], fr.f.prR.p[1] - fr.f.elR.p[1], fr.f.prR.p[2] - fr.f.elR.p[2]];
    const cos = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (Math.hypot(...u) * Math.hypot(...w));
    const a = Math.acos(Math.max(-1, Math.min(1, cos))) / D;
    lo = Math.min(lo, a); hi = Math.max(hi, a);
  }
  assert.ok(hi - lo < 2, `elbow bend varied ${(hi - lo).toFixed(2)} deg`);
});

check('unknown action names are refused', () => {
  assert.throws(() => poseOf('layup', 0), /unknown action/);
});

console.log(failures ? `\n${failures} failing` : '\nall library checks passed');
process.exit(failures ? 1 : 0);
