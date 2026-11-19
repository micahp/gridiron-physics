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
  if (!LIBRARY[name].airborne && !LIBRARY[name].reference) check(`${name}: both feet on the floor in every frame (toes within 1 mm)`, () => {
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
  // swipe: a fast arm strike (5 to 8 m/s); pass, catch, shot, block: 4 m/s; dribble and stance: 2.5 m/s
  // refJumpShot: 1.5 x the reference's own peak hand speed (5.1 m/s in CMU 124_05)
  const SPEED_LIMIT = name === 'refJumpShot' ? 7.7 : name === 'swipe' ? 8 : ['dribble', 'lowDribble', 'crossover', 'stance', 'defendInPlace', 'defendSlide'].includes(name) ? 2.5 : ['overheadPass', 'oneHandPass', 'bouncePass'].includes(name) ? 6 : 4;
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

// --- v1 expansion
const range = (fs, fn) => { const v = fs.map(fn); return Math.max(...v) - Math.min(...v); };
check('defend in place: the right hand is active (palm travels at least 15 cm over the clip)', () => {
  const r = range(all.defendInPlace, (fr) => fr.f.palmR.p[0]) + range(all.defendInPlace, (fr) => fr.f.palmR.p[1]);
  assert.ok(r >= 0.15, `palm range ${(r * 100).toFixed(1)} cm`);
});
check('defend sliding: the body moves laterally (root shifts at least 30 cm across the clip)', () => {
  const r = range(all.defendSlide, (fr) => fr.pose.root.z);
  assert.ok(r >= 0.3, `root travelled ${(r * 100).toFixed(1)} cm`);
});
check('defend sliding: the arm stays active too (palm moves at least 15 cm)', () => {
  const r = range(all.defendSlide, (fr) => fr.f.palmR.p[1]) + range(all.defendSlide, (fr) => fr.f.palmR.p[0]);
  assert.ok(r >= 0.15, `palm range ${(r * 100).toFixed(1)} cm`);
});
// height of the lowest sole above the floor, per frame: how far the body is off the ground
const soleUp = (fs) => Math.max(...fs.map((fr) => Math.min(fr.f.toeR.p[1], fr.f.toeL.p[1])));
check('fadeaway: the body leaves the floor and moves back (feet at least 15 cm up, root at least 15 cm back)', () => {
  assert.ok(soleUp(all.fadeaway) >= 0.15, `feet ${soleUp(all.fadeaway).toFixed(2)} m up`);
  const back = Math.min(...all.fadeaway.map((fr) => fr.pose.root.x));
  assert.ok(back <= -0.15, `root ${back.toFixed(2)} m`);
});
check('floater: a small hop (6 to 15 cm up)', () => {
  const up = soleUp(all.floater);
  assert.ok(up >= 0.06 && up <= 0.15, `hop ${up.toFixed(2)} m`);
});
check('low dribble: the push stays between 0.8 and 0.95 m (below the waist)', () => {
  const ys = all.lowDribble.map((fr) => fr.f.palmR.p[1]);
  assert.ok(Math.min(...ys) >= 0.8 && Math.max(...ys) <= 0.95, `palm ${Math.min(...ys).toFixed(2)} to ${Math.max(...ys).toFixed(2)} m`);
});
check('crossover: the hand travels across the midline (shoulder abduction goes negative)', () => {
  const min = Math.min(...all.crossover.map((fr) => fr.pose.shR[1]));
  assert.ok(min < 0, `abduction minimum ${(min / D).toFixed(1)} deg`);
});

// --- a hand-held ball must touch the hands
import { holdCentre, BALL_R } from './library.js';
const PALM = 0.045;
for (const name of Object.keys(LIBRARY)) {
  const ball = LIBRARY[name].ball;
  if (!ball || !ball.attach) continue;
  const holdUntil = ball.release ?? 1;
  check(`${name}: while the ball is held, its surface touches the hand${ball.attach === 'mid' ? 's' : ''} (gap under 2 cm)`, () => {
    let worst = 0;
    for (const fr of all[name]) {
      if (fr.t >= holdUntil) break;
      const c = holdCentre(fr.f, ball.attach);
      worst = Math.max(worst, Math.abs(dist(c, fr.f.palmR.p) - (BALL_R + PALM)));
      if (ball.attach === 'mid') worst = Math.max(worst, Math.abs(dist(c, fr.f.palmL.p) - (BALL_R + PALM)));
    }
    assert.ok(worst < 0.02, `worst gap ${(worst * 100).toFixed(1)} cm`);
  });
}

// --- the reference jump shot: feet on the floor while it is grounded (load, and after landing)
// The reference's shot stance is weighted on one foot: the other toe sits 7 to 12 mm up in the recording.
// So: the lowest foot is on the floor (under 3 mm), and the other is no more than 2.5 cm up.
check('refJumpShot: while grounded (load and after landing) one foot is on the floor and the other is within 2.5 cm', () => {
  const grounded = all.refJumpShot.filter((fr) => fr.t < 0.2 || fr.t > 0.92);
  let lowest = 0, other = 0;
  for (const fr of grounded) {
    const a = Math.abs(fr.f.toeR.p[1]), b = Math.abs(fr.f.toeL.p[1]);
    lowest = Math.max(lowest, Math.min(a, b));
    other = Math.max(other, Math.max(a, b));
  }
  // 3 mm: the 5-frame smoothing and the frame-to-frame interpolation leave ~2 mm
  assert.ok(lowest < 0.003, `the lower foot was ${(lowest * 1000).toFixed(2)} mm off the floor`);
  assert.ok(other < 0.025, `the other foot was ${(other * 1000).toFixed(1)} mm off the floor`);
});
check('refJumpShot: the jump is real (feet leave the floor by at least 15 cm at the top)', () => {
  const up = Math.max(...all.refJumpShot.map((fr) => Math.min(fr.f.toeR.p[1], fr.f.toeL.p[1])));
  assert.ok(up >= 0.15, `feet ${(up * 100).toFixed(1)} cm up`);
});
// --- a jump shot is a sequence, not just a pose: load, takeoff, release near the top, landing
{
  const S = LIBRARY.refJumpShot.seconds, N = 260;
  let load = [-1, 0], wrist = [-1e9, 0], peak = [-1, 0], takeoff = -1, landing = -1;
  for (let i = 0; i <= N; i++) {
    const t = i / N, s = t * S;
    const k = LIBRARY.refJumpShot.pose(t).knR;
    if (k > load[0]) load = [k, s];
    const f = frame('refJumpShot', t);
    const sole = Math.min(f.toeR.p[1], f.toeL.p[1]);
    if (sole > 0.02 && takeoff < 0) takeoff = s;
    if (sole > 0.02) landing = s;
    if (f.wrR.p[1] > wrist[0]) wrist = [f.wrR.p[1], s];
    if (sole > peak[0]) peak = [sole, s];
  }
  check('jump shot: the load (deepest knee bend) comes before takeoff', () => {
    assert.ok(load[1] < takeoff, `load at ${load[1].toFixed(2)} s, takeoff at ${takeoff.toFixed(2)} s`);
  });
  check('jump shot: takeoff comes before the release (highest wrist)', () => {
    assert.ok(takeoff < wrist[1], `takeoff ${takeoff.toFixed(2)} s, release ${wrist[1].toFixed(2)} s`);
  });
  check('jump shot: the release is within 0.15 s of the body peak (the shot is released near the top)', () => {
    assert.ok(Math.abs(wrist[1] - peak[1]) < 0.15, `release ${wrist[1].toFixed(2)} s, peak ${peak[1].toFixed(2)} s`);
  });
  check('jump shot: the feet land after the release, within 0.35 s of it', () => {
    assert.ok(landing > wrist[1] && landing - wrist[1] < 0.35, `release ${wrist[1].toFixed(2)} s, landing ${landing.toFixed(2)} s`);
  });
}

check('unknown action names are refused', () => {
  assert.throws(() => poseOf('layup', 0), /unknown action/);
});

console.log(failures ? `\n${failures} failing` : '\nall library checks passed');
process.exit(failures ? 1 : 0);
