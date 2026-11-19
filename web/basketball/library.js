// Constrained basketball action library, v1.
//
// The agent picks an action by name and a time (0..1). It never sets joints.
// Each action is a small, fixed set of constraints the runtime enforces:
//   - feet flat on the floor (the root is lowered until the lowest sole touches)
//   - elbow and knee within their human limits
//   - the palm reaches the ball at its named contact time, where one exists
// The three actions in v1: stance, dribble, swipe. Add an action only when its
// checks in library.test.mjs pass.
import { fk, D, LIMITS } from './skeleton.js';
import { swipe, STRIKE_T, SWIPE_SECONDS } from './actions.js';
import { REF as REF_JUMP_SHOT } from './refs/cmu_124_05_jumpshot.js';

const ease = (x) => x * x * (3 - 2 * x);
const key = (t, a, b) => a + (b - a) * ease(Math.min(1, Math.max(0, t)));

/** Stance: knees and hips bent, arms low and ready. Static. */
function stance() {
  return {
    hipR: [28 * D, 0, 0], hipL: [28 * D, 0, 0],
    knR: 50 * D, knL: 50 * D,
    chest: [10 * D, 0, 0], spine: [6 * D, 0, 0],
    shR: [10 * D, 12 * D, 0], elR: 95 * D, wrR: [0, 0],
    shL: [10 * D, 12 * D, 0], elL: 95 * D, wrL: [0, 0],
  };
}

/**
 * Dribble, right hand. The palm pushes the ball down and back up, between the
 * waist and the hip. The shoulder drives the push (flex 30 -> 10 over the down
 * stroke, 0..0.5, then back); the elbow holds at 60 and the wrist neutral.
 * With the stance, the palm runs from about 1.08 m (top) to 0.96 m (bottom).
 */
function dribble(t) {
  const down = t < 0.5;
  const u = down ? t / 0.5 : (t - 0.5) / 0.5;
  const flex = down ? key(u, 30, 10) : key(u, 10, 30);
  return {
    ...stance(),
    shR: [flex * D, 14 * D, 0], elR: 60 * D, wrR: [0, 0],
  };
}

/** Chest pass, two hands: held at the chest, then both arms extend out (0.5 .. 0.8). */
function chestPass(t) {
  const e = key((t - 0.5) / 0.3, 0, 1);
  const flex = (50 + 25 * e) * D, el = (110 - 95 * e) * D;
  return { ...stance(), shR: [flex, -30 * D, 0], elR: el, wrR: [0, 0], shL: [flex, -30 * D, 0], elL: el, wrL: [0, 0] };
}

/** Two-hand catch: hands out and low, then pulled in to the chest by t = 0.6. */
function catchBall(t) {
  const e = key(t / 0.6, 0, 1);
  const flex = (30 + 20 * e) * D, ab = (25 - 55 * e) * D, el = (60 + 50 * e) * D;
  return { ...stance(), shR: [flex, ab, 0], elR: el, wrR: [0, 0], shL: [flex, ab, 0], elL: el, wrL: [0, 0] };
}

/** Jump shot, right hand. Crouch and load, jump (lift added by airborne()), release at 0.6 with the elbow extending. */
function jumpShot(t) {
  const j = clampT((t - 0.2) / 0.4);
  const kn = (50 - 35 * Math.sin(Math.PI * j)) * D;
  const e = key((t - 0.3) / 0.3, 0, 1);
  return {
    ...stance(), knR: kn, knL: kn,
    shR: [(60 + 75 * e) * D, 8 * D, 0], elR: (110 - 75 * e) * D, wrR: [0, 0],
    shL: [50 * D, 20 * D, 0], elL: 90 * D, wrL: [0, 0],
  };
}
const clampT = (x) => Math.min(1, Math.max(0, x));

/** Block: both arms up and out, ready to contest. */
function block(t) {
  const e = key(t / 0.4, 0, 1);
  const flex = (60 + 80 * e) * D, el = (90 - 60 * e) * D;
  return { ...stance(), shR: [flex, 16 * D, 0], elR: el, wrR: [0, 0], shL: [flex, 16 * D, 0], elL: el, wrL: [0, 0] };
}

/** Upward lift of the root during an airborne action (m). Zero for grounded actions. */
function jumpLift(t) {
  const u = (t - 0.2) / 0.6;
  return { lift: u > 0 && u < 1 ? 0.25 * Math.sin(Math.PI * u) : 0, x: 0 };
}

const bump = (t, a, b) => { const u = (t - a) / (b - a); return u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0; };
const sinT = (t) => Math.sin(2 * Math.PI * t);

/** Defence in place: feet set, the right hand active (jabbing at the ball), left hand low. */
function defendInPlace(t) {
  return { ...stance(), shR: [(62 + 22 * sinT(t)) * D, 14 * D, 0], elR: (100 + 10 * sinT(t)) * D, wrR: [0, 0],
    shL: [40 * D, 12 * D, 0], elL: 110 * D, wrL: [0, 0] };
}

/** Defence sliding laterally: the root shifts side to side with the legs stepping, the right hand still active. */
function defendSlide(t) {
  return { ...defendInPlace(t), root: { z: 0.22 * sinT(t) },
    knR: 55 * D, knL: 55 * D };   // equal knees: both feet stay on the floor as the body shifts
}

/** Fadeaway: jump back and away from the defender, release high while falling. */
function fadeaway(t) {
  const e = key((t - 0.35) / 0.3, 0, 1);
  return { ...stance(), spine: [-8 * D, 0, 0], chest: [-8 * D, 0, 0],
    shR: [(60 + 95 * e) * D, 10 * D, 0], elR: (110 - 75 * e) * D, wrR: [0, 0],
    shL: [50 * D, 20 * D, 0], elL: 90 * D, wrL: [0, 0] };
}

/** Floater: one hand, a soft short hop, released at head height with a gentle flick. */
function floater(t) {
  const e = key((t - 0.4) / 0.3, 0, 1);
  return { ...stance(), shR: [(110 + 40 * e) * D, 5 * D, 0], elR: (45 - 25 * e) * D, wrR: [-10 * D * e, 0],
    shL: [40 * D, 12 * D, 0], elL: 100 * D, wrL: [0, 0] };
}

/** Low dribble: the push is kept below the waist. */
function lowDribble(t) {
  const down = t < 0.5, u = down ? t / 0.5 : (t - 0.5) / 0.5;
  const flex = down ? key(u, 20, 5) : key(u, 5, 20);
  return { ...stance(), shR: [flex * D, 14 * D, 0], elR: 35 * D, wrR: [0, 0] };
}

/** Crossover: the dribble carries across the body in the second half. */
function crossover(t) {
  const u = Math.min(1, Math.max(0, (t - 0.45) / 0.45));
  const across = key(u, 14, -10);
  const down = t < 0.5, v = down ? t / 0.5 : (t - 0.5) / 0.5;
  const flex = down ? key(v, 30, 10) : key(v, 10, 30);
  return { ...stance(), shR: [flex * D, across * D, 0], elR: 60 * D, wrR: [0, 0] };
}

/** Bounce pass: both hands from the chest, pushed down and out so the ball hits the floor. */
function bouncePass(t) {
  const e = key((t - 0.4) / 0.25, 0, 1);
  const flex = (50 - 20 * e) * D, el = (110 - 40 * e) * D;
  return { ...stance(), shR: [flex, -30 * D, 0], elR: el, wrR: [0, 0], shL: [flex, -30 * D, 0], elL: el, wrL: [0, 0] };
}

/** Overhead pass: both hands up over the head, then driven forward and down. */
function overheadPass(t) {
  const up = key(t / 0.25, 0, 1), fwd = key((t - 0.45) / 0.25, 0, 1);
  const flex = (150 - 70 * fwd) * D * up + (1 - up) * 40 * D;
  const el = (90 - 70 * fwd) * D;
  return { ...stance(), shR: [flex, -30 * D, 0], elR: el, wrR: [0, 0], shL: [flex, -30 * D, 0], elL: el, wrL: [0, 0] };
}

/** One-hand pass: the right arm reaches out, the left hand guides. */
function oneHandPass(t) {
  const e = key((t - 0.45) / 0.3, 0, 1);
  return { ...stance(), shR: [(80 + 10 * e) * D, 8 * D, 0], elR: (110 - 100 * e) * D, wrR: [0, 0],
    shL: [40 * D, 14 * D, 0], elL: 100 * D, wrL: [0, 0] };
}

/** Sample a retargeted reference clip at normalised time t (0..1). Angles and lift are linear. */
export function sampleRef(frames, t) {
  const x = Math.min(1, Math.max(0, t)) * (frames.length - 1);
  const a = Math.floor(x), b = Math.min(frames.length - 1, a + 1), w = x - a;
  const lerp = (u, v) => u + (v - u) * w;
  const A = frames[a], B = frames[b];
  const out = {};
  for (const k of Object.keys(A)) {
    if (k === 't') continue;
    const va = A[k], vb = B[k];
    if (typeof va === 'number') out[k] = lerp(va, vb);
    else if (Array.isArray(va)) out[k] = va.map((v, i) => lerp(v, vb[i]));
    else if (va && typeof va === 'object') out[k] = Object.fromEntries(Object.keys(va).map((q) => [q, lerp(va[q], vb[q])]));
  }
  return out;
}

export const BALL_R = 0.12;      // ball radius, m
const PALM_R = 0.045;            // palm joint sphere, m
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/**
 * Where the ball's centre sits when a hand (or both hands) holds it, so the
 * ball's surface touches the palm joint(s). attach 'palmR': one palm, centred
 * out along the hand's direction. attach 'mid': both palms, ball forward of the
 * palm line. Without this the ball could float between the hands.
 */
export function holdCentre(f, attach) {
  const R = BALL_R + PALM_R;
  if (attach === 'palmR') {
    const p = f.palmR.p, w = f.wrR.p;
    const d = unit([p[0] - w[0], p[1] - w[1], p[2] - w[2]]);
    return [p[0] + R * d[0], p[1] + R * d[1], p[2] + R * d[2]];
  }
  const a = f.palmR.p, b = f.palmL.p;
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const dAB = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const v = unit([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
  const fwd = [1, 0, 0];
  const k = fwd[0] * v[0] + fwd[1] * v[1] + fwd[2] * v[2];
  const pu = unit([fwd[0] - k * v[0], fwd[1] - k * v[1], fwd[2] - k * v[2]]);
  const h = Math.sqrt(Math.max(0, R * R - (dAB / 2) * (dAB / 2)));
  return [m[0] + h * pu[0], m[1] + h * pu[1], m[2] + h * pu[2]];
}

export const LIBRARY = {
  // Reference-derived: CMU mocap subject 124 trial 5, a basketball jump shot, retargeted by
  // tools/basketball/bvh_retarget.mjs. Not a hand-set pose: the joint angles come from the recording.
  refJumpShot: {
    seconds: REF_JUMP_SHOT.frames[REF_JUMP_SHOT.frames.length - 1].t, reference: true,
    source: 'CMU mocap 124_05 (basketball jump shot)',
    pose: (t) => sampleRef(REF_JUMP_SHOT.frames, t), contact: null,
    ball: { attach: 'palmR', release: REF_JUMP_SHOT.release.fraction, kind: 'arc', to: 'hoop', dt: 0.8 },
  },
  defendInPlace: { source: 'hand-authored', seconds: 1.0, pose: defendInPlace, contact: null },
  defendSlide: { source: 'hand-authored', seconds: 1.0, pose: defendSlide, contact: null },
  fadeaway: { source: 'hand-authored', seconds: 1.4, pose: fadeaway, contact: null, airborne: (t) => ({ lift: 0.2 * bump(t, 0.2, 0.8), x: -0.22 * bump(t, 0.2, 0.8) }),
    ball: { attach: 'palmR', release: 0.6, kind: 'arc', to: 'hoop', dt: 0.9 } },
  floater: { source: 'hand-authored', seconds: 1.2, pose: floater, contact: null, airborne: (t) => ({ lift: 0.12 * bump(t, 0.2, 0.7), x: 0 }),
    ball: { attach: 'palmR', release: 0.5, kind: 'arc', to: 'hoop', dt: 0.7, short: true } },
  lowDribble: { source: 'hand-authored', seconds: 0.6, pose: lowDribble, contact: null, ball: { kind: 'dribble' } },
  crossover: { source: 'hand-authored', seconds: 0.9, pose: crossover, contact: null, ball: { kind: 'dribble' } },
  bouncePass: { source: 'hand-authored', seconds: 1.2, pose: bouncePass, contact: null,
    ball: { attach: 'mid', release: 0.6, kind: 'bounce', vel: [3.0, -1.0, 0] } },
  overheadPass: { source: 'hand-authored', seconds: 1.2, pose: overheadPass, contact: null,
    ball: { attach: 'mid', release: 0.6, kind: 'pass', vel: [4.5, -0.8, 0] } },
  oneHandPass: { source: 'hand-authored', seconds: 1.0, pose: oneHandPass, contact: null,
    ball: { attach: 'palmR', release: 0.6, kind: 'pass', vel: [5.0, 0.0, 0] } },
  chestPass: { source: 'hand-authored', seconds: 1.2, pose: chestPass, contact: null, ball: { attach: 'mid', release: 0.6, kind: 'pass', vel: [4.0, 0, 0] } },
  catch: { source: 'hand-authored', seconds: 1.0, pose: catchBall, contact: null, ball: { kind: 'catch' } },
  shot: { source: 'hand-authored', seconds: 1.4, pose: jumpShot, contact: null, airborne: jumpLift,
    ball: { attach: 'palmR', release: 0.55, kind: 'arc', to: 'hoop', dt: 0.8 } },
  block: { source: 'hand-authored', seconds: 1.0, pose: block, contact: null },
  stance: { source: 'hand-authored', seconds: 1, pose: () => stance(), contact: null },
  dribble: { source: 'hand-authored', seconds: 0.6, pose: dribble, contact: { t: 0, point: 'palmR' }, ball: { kind: 'dribble' } },
  swipe: { source: 'hand-authored', seconds: SWIPE_SECONDS, pose: (t) => ({ ...stance(), ...swipe(t) }), contact: { t: STRIKE_T, point: 'palmR' } },
};

/**
 * The pose for an action at time t, with the root lowered so the lowest sole
 * touches the floor, and the joint limits applied (fk clamps them).
 */
export function poseOf(name, t) {
  const a = LIBRARY[name];
  if (!a) throw new Error(`unknown action "${name}"`);
  const tt = Math.min(1, Math.max(0, t));
  if (a.reference) return a.pose(tt);       // reference clips carry their own root height
  const g = grounded(a.pose(tt));
  if (a.airborne) { const o = a.airborne(tt); g.root = { ...g.root, lift: g.root.lift + (o.lift || 0), x: (g.root.x || 0) + (o.x || 0) }; }
  return g;
}

/** Lower the root so the lowest toe or ankle sits on the floor. */
export function grounded(pose) {
  const f0 = fk({ ...pose, root: { ...(pose.root || {}), lift: 0 } });
  const low = Math.min(f0.anR.p[1], f0.anL.p[1], f0.toeR.p[1], f0.toeL.p[1]);
  return { ...pose, root: { ...(pose.root || {}), lift: -low } };
}

/** The forward kinematics for an action at time t. */
export function frame(name, t) {
  return fk(poseOf(name, t));
}

export { LIMITS, D };
