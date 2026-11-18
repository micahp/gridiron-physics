// Paired tackle animations, the way the PS2-era football games did it: the
// tackler and the ball carrier play one action together.
//
// The game decides the outcome (and the push direction, from the two players'
// momentum). This picks matching poses for both bodies:
//   style  'wrap'  form tackle, arms around the waist, drive and land on top
//          'dive'  low tackle, the tackler leaves his feet and takes the legs
//   fall   which way the carrier goes, in his own body frame:
//          'fwd' (hit from behind), 'back' (head-on), 'R' / 'L' (from the side)
//   hit    0..1 closing-speed intensity (lifts and throws the carrier on big hits)
//
// Phase 1 (struggle) runs from w.t0 to w.until while the game lets the carrier
// fight for yards; phase 2 (fall) starts at w.tFall and the end pose holds.
import { D, sampleKeys, fill } from '../stack/skeleton.js';
import { ACTIONS } from '../stack/actions.js';

const deg = (a) => a.map((x) => x * D);
const S = Math.sin, TAU = Math.PI * 2;
export const FALL_DUR = 0.72;

// ---- carrier
function carrierStruggle(w, s, t) {
  const p = fill(ACTIONS.carry.fn((t * 2.2) % 1));     // legs keep churning
  // shorten the stride: he is being held
  for (const k of ['hipR', 'hipL']) p[k] = [p[k][0] * 0.55 + 14 * D, p[k][1], p[k][2]];
  for (const k of ['knR', 'knL']) p[k] = p[k] * 0.7 + 18 * D;
  p.root = { ...p.root, lift: p.root.lift * 0.4 };
  p.gripR = 0.85;
  if (w.fall === 'fwd') {
    p.root.pitch = (14 + 14 * s) * D; p.spine = [12 * D, 0, 0];
    p.shL = deg([60 + 30 * s, 24, 0]); p.elL = 30 * D; p.gripL = 0.1;              // reaching to break the fall
  } else if (w.fall === 'back') {
    p.root.pitch = (10 - 18 * s - 14 * w.hit * s) * D; p.spine = [4 * D, 0, 0]; p.neck = [10 * D * s, 0, 0];
    p.shL = deg([74, 18, 10]); p.elL = 36 * D; p.gripL = 0.2;                      // hand on the tackler's shoulder pad
  } else {
    const d = w.fall === 'R' ? 1 : -1;
    p.root.roll = d * 12 * s * D; p.root.pitch = 12 * D; p.spine = [8 * D, d * 10 * s * D, 0];
    p.shL = deg([50, 40 + 20 * s, 0]); p.elL = 40 * D; p.gripL = 0.15;
  }
  return p;
}

const SIDE_FALL = (d) => [
  { t: 0, root: { pitch: 12 * D, roll: d * 12 * D }, hipR: deg([30, 8, 0]), knR: 40 * D, hipL: deg([30, 8, 0]), knL: 40 * D, ball: 'R', shR: deg([16, 12, 14]), elR: 118 * D, wrR: deg([-25, 0]), shL: deg([50, 50, 0]), elL: 40 * D },
  { t: 0.4, root: { pitch: 18 * D, roll: d * 38 * D }, spine: [10 * D, d * 12 * D, 0], hipR: deg([50, 12, 0]), knR: 70 * D, hipL: deg([40, 20, 0]), knL: 60 * D, ball: 'R', shR: deg([16, 12, 14]), elR: 118 * D, wrR: deg([-25, 0]), shL: deg([70, 70, 0]), elL: 30 * D, neck: [-10 * D, -d * 20 * D, 0] },
  { t: 0.75, root: { pitch: 16 * D, roll: d * 74 * D }, spine: [14 * D, d * 8 * D, 0], hipR: deg([56, 10, 0]), knR: 80 * D, hipL: deg([46, 14, 0]), knL: 70 * D, ball: 'R', shR: deg([16, 12, 14]), elR: 118 * D, wrR: deg([-25, 0]), shL: deg([90, 60, 0]), elL: 20 * D, neck: [-6 * D, -d * 30 * D, 0] },
  { t: 1, root: { pitch: 12 * D, roll: d * 88 * D }, spine: [16 * D, 0, 0], hipR: deg([58, 10, 0]), knR: 84 * D, hipL: deg([44, 12, 0]), knL: 64 * D, ball: 'R', shR: deg([16, 12, 14]), elR: 118 * D, wrR: deg([-25, 0]), shL: deg([60, 30, 0]), elL: 50 * D, neck: [-6 * D, -d * 36 * D, 0] },
];
const FALL_R = SIDE_FALL(1), FALL_L = SIDE_FALL(-1);

function carrierFall(w, f) {
  let p;
  if (w.fall === 'fwd') p = fill(ACTIONS.fallFwd.fn(f));
  else if (w.fall === 'back') {
    p = fill(ACTIONS.fallBack.fn(Math.min(1, f * (1 + w.hit * 0.4))));
    // big hit: he is lifted off his feet and put on his back
    p.root = { ...p.root, lift: (p.root.lift || 0) + w.hit * 0.3 * S(Math.PI * Math.min(1, f * 1.7)) };
  } else p = fill(sampleKeys(w.fall === 'R' ? FALL_R : FALL_L, f));
  p.gripR = 0.85;
  return p;
}

// ---- tackler
function wrapDrive(s, t) {
  const ph = (t * 2.4) % 1;
  return {
    root: { pitch: (34 + 8 * s) * D, lift: 0.01 * Math.max(0, S(TAU * ph * 2)), roll: 2 * D * S(TAU * ph) },
    spine: [10 * D, 0, 0], chest: [6 * D, 0, 8 * D], neck: [-30 * D, 0, -14 * D],          // head across the bow
    hipR: [(56 + 14 * S(TAU * ph)) * D, 12 * D, 0], knR: (74 + 18 * S(TAU * ph + 1)) * D, flatR: true,
    hipL: [(56 - 14 * S(TAU * ph)) * D, 12 * D, 0], knL: (74 - 18 * S(TAU * ph + 1)) * D, flatL: true,
    shR: deg([74, 30, 48]), elR: 78 * D, wrR: deg([-16, 0]), gripR: 0.9,
    shL: deg([74, 30, 48]), elL: 78 * D, wrL: deg([-16, 0]), gripL: 0.9,
  };
}
const WRAP_FALL = (onTop) => [
  { t: 0, ...wrapDrive(1, 0) },
  { t: 0.45, root: { pitch: 62 * D, lift: 0.02 }, spine: [10 * D, 0, 0], neck: [-40 * D, 0, -10 * D], hipR: deg([70, 10, 0]), knR: 100 * D, anR: -30 * D, hipL: deg([40, 10, 0]), knL: 70 * D, anL: -30 * D, shR: deg([96, 26, 44]), elR: 70 * D, shL: deg([96, 26, 44]), elL: 70 * D, gripR: 0.9, gripL: 0.9 },
  { t: 1, root: { pitch: 86 * D, x: -0.2, lift: onTop }, neck: [-55 * D, 0, -14 * D], spine: [-2 * D, 0, 0], hipR: deg([10, 10, 0]), knR: 40 * D, anR: -50 * D, hipL: deg([24, 10, 0]), knL: 60 * D, anL: -50 * D, shR: deg([130, 36, 40]), elR: 64 * D, shL: deg([130, 36, 40]), elL: 64 * D, gripR: 0.9, gripL: 0.9 },
];
const WRAP_FALLS = { fwd: WRAP_FALL(0.16), back: WRAP_FALL(0.2), R: WRAP_FALL(0.18), L: WRAP_FALL(0.18) };

function diveGrab(s) {
  const p = fill(ACTIONS.dive.fn(0.5 + 0.22 * s));
  p.shR = deg([150, 34, 30]); p.elR = 60 * D; p.shL = deg([150, 34, 30]); p.elL = 60 * D;
  p.gripR = p.gripL = 0.9;
  return p;
}
const DIVE_END = { ...ACTIONS.dive.fn(1), shR: deg([150, 34, 34]), elR: 64 * D, shL: deg([150, 34, 34]), elL: 64 * D, gripR: 0.9, gripL: 0.9 };

/** Pose for one side of a tackle pair at time t. */
export function tacklePose(w, role, t) {
  const falling = w.tFall != null && t >= w.tFall;
  const s = Math.min(1, Math.max(0, (t - w.t0) / Math.max(0.05, w.until - w.t0)));
  const f = falling ? Math.min(1, (t - w.tFall) / FALL_DUR) : 0;
  if (role === 'carrier') return falling ? carrierFall(w, f) : carrierStruggle(w, s, t);
  if (w.style === 'dive') return falling ? fill(sampleKeys([{ t: 0, ...diveGrab(1) }, { t: 1, ...DIVE_END }], f)) : diveGrab(s);
  return falling ? fill(sampleKeys(WRAP_FALLS[w.fall], f)) : fill(wrapDrive(s, t));
}

/** Tackler's distance behind the carrier along the push direction (yards). */
export const TACKLE_GAP = { wrap: 0.62, dive: 1.12 };
