// Every action the football game needs, authored from scratch for the voxel
// skeleton: gaits are procedural curves, one-shots are keyframes. Each action
// is sampled into a small number of baked frames; the sprite stack can then be
// drawn at any facing, so every action works in every direction.
//
//   loop actions: t is the cycle phase 0..1; dur is seconds per cycle
//   one-shots:    t runs 0..1 over dur seconds
import { D, curve, sampleKeys, fill, fk } from './skeleton.js';
import { reachLeg } from '../mesh/footlock.js';

const deg = (a) => a.map((x) => (typeof x === 'number' ? x * D : x));
const S = Math.sin, TAU = Math.PI * 2;
const bump = (x, c, w) => Math.exp(-((((x - c + 1.5) % 1) - 0.5) ** 2) / (2 * w * w));

// ---------------------------------------------------------------- run gait
const HIP = curve([[0, 34], [0.14, 12], [0.3, -24], [0.5, 10], [0.7, 62], [0.86, 52]]);
const KNEE = curve([[0, 22], [0.12, 42], [0.3, 24], [0.46, 88], [0.58, 118], [0.75, 66], [0.9, 26]]);
const ANK = curve([[0, 6], [0.12, 18], [0.3, -30], [0.5, -12], [0.7, 12], [0.9, 8]]);

export function run(ph, o = {}) {
  const amp = o.amp ?? 1, lean = o.lean ?? 10;
  const leg = (q) => ({ hip: HIP(q) * amp + (1 - amp) * 12 * D, kn: KNEE(q) * (0.55 + 0.45 * amp), an: ANK(q) * amp });
  const R = leg(ph), L = leg(ph + 0.5);
  const arm = (hipOther) => -(hipOther - 18 * D) * 1.35 * (o.armAmp ?? 1) + 8 * D;
  const p = {
    root: { pitch: (lean * 0.55) * D, yaw: -6 * D * S(TAU * ph) * amp, lift: 0.04 * amp * (bump(ph, 0.4, 0.06) + bump(ph, 0.9, 0.06)), roll: 2 * D * S(TAU * ph) },
    spine: [lean * 0.45 * D, 0, 0], chest: [2 * D, 0, 9 * D * S(TAU * ph) * amp], neck: [-(lean * 0.7) * D, 0, -3 * D * S(TAU * ph)],
    hipR: [R.hip, 5 * D, 0], knR: R.kn, anR: R.an,
    hipL: [L.hip, 5 * D, 0], knL: L.kn, anL: L.an,
    shR: [arm(L.hip), 10 * D, 18 * D], elR: (82 + 14 * S(TAU * ph)) * D, wrR: [-10 * D, 0],
    shL: [arm(R.hip), 10 * D, 18 * D], elL: (82 - 14 * S(TAU * ph)) * D, wrL: [-10 * D, 0],
    gripR: 0.55, gripL: 0.55,
  };
  if (o.carry === 'R') { p.shR = deg([16, 12, 14]); p.elR = 118 * D; p.wrR = deg([-25, 0]); p.ball = 'R'; p.gripR = 0.85; p.chest[2] -= 5 * D; }
  if (o.carry === 'L') { p.shL = deg([16, 12, 14]); p.elL = 118 * D; p.wrL = deg([-25, 0]); p.ball = 'L'; p.gripL = 0.85; p.chest[2] += 5 * D; }
  if (o.stiff === 'L') { p.shL = deg([82, 28, -10]); p.elL = 6 * D; p.wrL = deg([72, 0]); p.gripL = 0.02; p.chest[2] = -14 * D; p.spine[1] = -6 * D; }
  if (o.stiff === 'R') { p.shR = deg([82, 28, -10]); p.elR = 6 * D; p.wrR = deg([72, 0]); p.gripR = 0.02; p.chest[2] = 14 * D; p.spine[1] = 6 * D; }
  return p;
}

const WALK_BASE = {
  root: { pitch: 2 * D }, spine: [2 * D, 0, 0],
  hipR: deg([12, 4, 0]), knR: 14 * D, flatR: true, hipL: deg([12, 4, 0]), knL: 14 * D, flatL: true,
};
function walk(ph) {
  // foot-path walk (footGait): planted feet stay put at any walking speed
  const p = footGait(ph, WALK_BASE, { axis: [1, 0], half: 0.36, lift: 0.08, duty: 0.62, strike: 12, toeoff: -30 });
  p.root = { ...p.root, yaw: -4 * D * Math.cos(TAU * ph), roll: 1.5 * D * S(TAU * ph) };
  p.chest = [0, 0, 5 * D * Math.cos(TAU * ph)];
  p.shR = [-14 * D * Math.cos(TAU * ph), 10 * D, 0]; p.elR = 22 * D;
  p.shL = [14 * D * Math.cos(TAU * ph), 10 * D, 0]; p.elL = 22 * D;
  return p;
}

/**
 * Foot-path gait, in the player's own frame. Each foot cycles through
 *   touchdown  first 12% of stance: the foot flattens from heel- or toe-first contact
 *   stance     planted: it moves back under the body in a straight line at the
 *              body's speed, so in the world it stays put (validator: foot slide)
 *   toe-off    last 18% of stance: the heel lifts, the foot rolls onto the toes
 *   swing      it travels forward along `axis` (the direction of travel) with a lift
 * Leg IK places each ankle on its path; the ankle angle is the levelled-foot
 * angle plus the phase's roll. Stride per cycle = 2 * half / duty.
 *   strike: foot angle at touchdown (deg, + toes up), toeoff: at toe-off (deg, - toes down)
 */
function footGait(ph, base, { axis = [1, 0], half = 0.25, lift = 0.09, duty = 0.6, strike = 10, toeoff = -28 }) {
  const p = fill(base);
  const J0 = fk(p);
  for (const [s, off] of [['R', 0], ['L', 0.5]]) {
    const a0 = J0['an' + s].p;
    const q = (((ph + off) % 1) + 1) % 1;
    let u, y = 0, roll = 0;
    if (q < duty) {
      u = 1 - (2 * q) / duty;                                   // planted: front to back
      const qs = q / duty;
      if (qs < 0.12) roll = strike * (1 - qs / 0.12);           // touchdown
      else if (qs > 0.82) roll = toeoff * ((qs - 0.82) / 0.18);   // toe-off
    } else {
      const k = (q - duty) / (1 - duty);
      u = -1 + 2 * k * k * (3 - 2 * k); y = lift * Math.sin(Math.PI * k);
      roll = toeoff * (1 - k) + strike * k;                      // swing: from toe-off back to the strike angle
    }
    Object.assign(p, reachLeg(p, s, [a0[0] + axis[0] * half * u, a0[1] + y, a0[2] + axis[1] * half * u], 8));
    const flat = -(-(p.root?.pitch || 0) + p['hip' + s][0] - p['kn' + s]);
    p['an' + s] = flat + roll * D; p['flat' + s] = false;
  }
  return p;
}

const BACKPEDAL_BASE = {
  root: { pitch: 24 * D }, spine: [6 * D, 0, 0], neck: [-26 * D, 0, 0],
  hipR: deg([46, 9, 0]), knR: 70 * D, flatR: true, hipL: deg([46, 9, 0]), knL: 70 * D, flatL: true,
};
function backpedal(ph) {
  // moving backward: the planted foot travels forward under him
  const p = footGait(ph, BACKPEDAL_BASE, { axis: [-1, 0], half: 0.3, lift: 0.1, duty: 0.58, strike: -14, toeoff: -22 });   // toes land first going backward
  p.root = { ...p.root, roll: 3 * D * S(TAU * ph) };
  p.chest = [0, 0, 4 * D * S(TAU * ph)];
  p.shR = [(20 - 30 * S(TAU * ph)) * D, 16 * D, 12 * D]; p.elR = 88 * D;
  p.shL = [(20 + 30 * S(TAU * ph)) * D, 16 * D, 12 * D]; p.elL = 88 * D;
  return p;
}

const SHUFFLE_BASE = {
  root: { pitch: 18 * D }, spine: [10 * D, 0, 0], neck: [-26 * D, 0, 0],
  hipR: deg([46, 20, 0]), knR: 64 * D, flatR: true, hipL: deg([46, 20, 0]), knL: 64 * D, flatL: true,
  shR: deg([38, 20, 14]), elR: 84 * D, shL: deg([38, 20, 14]), elL: 84 * D,
};
/** Lateral shuffle toward dir (+1 the player's right, -1 left), square to the line; the feet never cross. */
function shuffle(ph, dir) {
  const p = footGait(ph, SHUFFLE_BASE, { axis: [0, dir], half: 0.16, lift: 0.07, duty: 0.62, strike: 0, toeoff: -16 });
  p.spine = [10 * D, -dir * 3 * D, 0];
  return p;
}

// ---------------------------------------------------------------- stances
const STANCE2 = {
  root: { pitch: 20 * D }, spine: [8 * D, 0, 0], neck: [-18 * D, 0, 0],
  hipL: deg([42, 6, 0]), knL: 48 * D, flatL: true, hipR: deg([4, 8, 0]), knR: 36 * D, flatR: true,
  shR: deg([24, 12, 10]), elR: 42 * D, shL: deg([30, 12, 10]), elL: 46 * D,
};
const STANCE3 = {
  root: { pitch: 66 * D }, spine: [8 * D, 0, 0], chest: [4 * D, 0, 0], neck: [-64 * D, 0, 0],
  hipR: deg([104, 16, 0]), knR: 84 * D, flatR: true, hipL: deg([116, 14, 0]), knL: 96 * D, flatL: true,
  shR: deg([84, 8, 0]), elR: 4 * D, wrR: deg([-60, 0]), gripR: 0.12, shL: deg([46, 14, 10]), elL: 72 * D,
};
const SHOTGUN = {
  root: { pitch: 12 * D }, spine: [5 * D, 0, 0], neck: [-8 * D, 0, 0],
  hipR: deg([30, 10, 0]), knR: 40 * D, flatR: true, hipL: deg([30, 10, 0]), knL: 40 * D, flatL: true,
  shR: deg([44, 8, 30]), elR: 96 * D, shL: deg([44, 8, 30]), elL: 96 * D,
};
const READY = {
  root: { pitch: 24 * D }, spine: [10 * D, 0, 0], neck: [-22 * D, 0, 0],
  hipR: deg([48, 15, 0]), knR: 62 * D, flatR: true, hipL: deg([48, 15, 0]), knL: 62 * D, flatL: true,
  shR: deg([34, 16, 18]), elR: 82 * D, shL: deg([34, 16, 18]), elL: 82 * D,
};
const breathe = (base) => (ph) => {
  const p = fill(base);
  p.chest = p.chest.slice(); p.chest[0] += 1.5 * D * S(TAU * ph);
  p.root = { ...p.root, lift: 0 };
  return p;
};

// ---------------------------------------------------------------- blocking
function block(ph) {
  const hip = (q) => (52 + 10 * S(TAU * q)) * D, kn = (q) => (72 + 14 * S(TAU * q + 1)) * D;
  return {
    root: { pitch: 34 * D, lift: 0.01 * Math.max(0, S(TAU * ph * 2)) }, spine: [8 * D, 0, 0], neck: [-34 * D, 0, 0],
    hipR: [hip(ph), 14 * D, 0], knR: kn(ph), flatR: true, hipL: [hip(ph + 0.5), 14 * D, 0], knL: kn(ph + 0.5), flatL: true,
    shR: deg([80, 16, 16]), elR: 34 * D, wrR: deg([-48, 0]), shL: deg([80, 16, 16]), elL: 34 * D, wrL: deg([-48, 0]),
    gripR: 0.25, gripL: 0.25,
  };
}
function passPro(ph) {
  const punch = Math.max(0, S(TAU * ph));
  return {
    root: { pitch: 14 * D, lift: 0.012 * Math.max(0, -S(TAU * ph)) }, spine: [6 * D, 0, 0], neck: [-14 * D, 0, 0],
    hipR: [(42 - 8 * S(TAU * ph)) * D, (18 + 8 * S(TAU * ph)) * D, 0], knR: 62 * D, flatR: true,
    hipL: [(42 + 6 * S(TAU * ph)) * D, 16 * D, 0], knL: 60 * D, flatL: true,
    shR: [(58 + 14 * punch) * D, 14 * D, 22 * D], elR: (96 - 52 * punch) * D, wrR: [-40 * D * punch, 0],
    shL: [(58 + 14 * punch) * D, 14 * D, 22 * D], elL: (96 - 52 * punch) * D, wrL: [-40 * D * punch, 0],
    gripR: 0.3, gripL: 0.3,
  };
}

// ---------------------------------------------------------------- one-shots
const RUNPOSE = run(0.15, { amp: 0.9 });
const CARRY = run(0.15, { amp: 0.9, carry: 'R' });
const PRONE = {
  root: { pitch: 90 * D, x: -0.25 }, neck: [-55 * D, 0, 0], spine: [-4 * D, 0, 0],
  hipR: deg([4, 10, 0]), knR: 16 * D, anR: -50 * D, hipL: deg([4, 10, 0]), knL: 22 * D, anL: -50 * D,
  shR: deg([150, 30, 0]), elR: 40 * D, shL: deg([150, 30, 0]), elL: 40 * D,
};
const SUPINE = {
  root: { pitch: -90 * D, x: 0.25 }, neck: [40 * D, 0, 0],
  hipR: deg([18, 12, 0]), knR: 40 * D, anR: 0, hipL: deg([6, 10, 0]), knL: 14 * D, anL: 0,
  shR: deg([20, 60, 0]), elR: 30 * D, shL: deg([20, 60, 0]), elL: 30 * D,
};

const keys = (list, base = {}) => (t) => sampleKeys(list, t, { base });

export const ACTIONS = {
  // locomotion (loops); every one can be drawn at any facing
  walk: { loop: true, dur: 1.1, frames: 12, fn: walk },
  jog: { loop: true, dur: 0.74, frames: 12, fn: (t) => run(t, { amp: 0.7, lean: 6 }) },
  sprint: { loop: true, dur: 0.6, frames: 12, fn: (t) => run(t, { amp: 1, lean: 14 }) },
  carry: { loop: true, dur: 0.62, frames: 12, fn: (t) => run(t, { amp: 1, lean: 13, carry: 'R' }) },
  carryL: { loop: true, dur: 0.62, frames: 12, fn: (t) => run(t, { amp: 1, lean: 13, carry: 'L' }) },
  stiffL: { loop: true, dur: 0.62, frames: 12, fn: (t) => run(t, { amp: 0.95, lean: 16, carry: 'R', stiff: 'L' }) },
  stiffR: { loop: true, dur: 0.62, frames: 12, fn: (t) => run(t, { amp: 0.95, lean: 16, carry: 'L', stiff: 'R' }) },
  backpedal: { loop: true, dur: 0.5, frames: 10, fn: backpedal },
  shuffleR: { loop: true, dur: 0.42, frames: 8, fn: (t) => shuffle(t, 1) },
  shuffleL: { loop: true, dur: 0.42, frames: 8, fn: (t) => shuffle(t, -1) },
  block: { loop: true, dur: 0.5, frames: 8, fn: block },
  passPro: { loop: true, dur: 0.6, frames: 8, fn: passPro },
  celebrate: {
    loop: true, dur: 1.0, frames: 12, fn: keys([
      { t: 0, root: { pitch: 20 * D }, hipR: deg([50, 8, 0]), knR: 70 * D, hipL: deg([50, 8, 0]), knL: 70 * D, flatR: true, flatL: true, shR: deg([20, 20, 0]), elR: 60 * D, shL: deg([20, 20, 0]), elL: 60 * D },
      { t: 0.3, root: { lift: 0.32, pitch: -4 * D }, hipR: deg([10, 8, 0]), knR: 30 * D, anR: -30 * D, hipL: deg([10, 8, 0]), knL: 30 * D, anL: -30 * D, shR: deg([168, 22, 0]), elR: 10 * D, shL: deg([168, 22, 0]), elL: 10 * D, neck: [-20 * D, 0, 0] },
      { t: 0.55, root: { lift: 0.05 }, hipR: deg([30, 8, 0]), knR: 50 * D, hipL: deg([30, 8, 0]), knL: 50 * D, flatR: true, flatL: true, shR: deg([150, 25, 0]), elR: 30 * D, shL: deg([150, 25, 0]), elL: 30 * D },
      { t: 0.8, root: { pitch: 6 * D }, hipR: deg([20, 8, 0]), knR: 26 * D, hipL: deg([20, 8, 0]), knL: 26 * D, flatR: true, flatL: true, shR: deg([110, 30, 0]), elR: 120 * D, shL: deg([40, 20, 0]), elL: 90 * D },
    ]),
  },
  // stances (gentle breathing loop)
  stance2: { loop: true, dur: 2.4, frames: 4, fn: breathe(STANCE2) },
  stance3: { loop: true, dur: 2.4, frames: 4, fn: breathe(STANCE3) },
  shotgun: { loop: true, dur: 2.4, frames: 4, fn: breathe(SHOTGUN) },
  ready: { loop: true, dur: 2.4, frames: 4, fn: breathe(READY) },
  prone: { loop: true, dur: 2, frames: 1, fn: () => PRONE },
  supine: { loop: true, dur: 2, frames: 1, fn: () => SUPINE },

  // one-shots
  swim: {
    dur: 0.55, frames: 10, fn: keys([
      { t: 0, ...block(0) },
      { t: 0.35, root: { pitch: 30 * D }, chest: [6 * D, 0, -28 * D], shR: deg([168, 34, 0]), elR: 30 * D, shL: deg([70, 20, 10]), elL: 40 * D, hipR: deg([48, 12, 0]), knR: 70 * D, hipL: deg([30, 12, 0]), knL: 50 * D, flatL: true },
      { t: 0.65, root: { pitch: 26 * D }, chest: [6 * D, 0, -12 * D], shR: deg([110, -8, 0]), elR: 50 * D, shL: deg([20, 12, 10]), elL: 80 * D, hipR: deg([20, 8, 0]), knR: 40 * D, hipL: deg([58, 8, 0]), knL: 80 * D },
      { t: 1, ...run(0.1, { amp: 0.9, lean: 16 }) },
    ]),
  },
  rip: {
    dur: 0.5, frames: 10, fn: keys([
      { t: 0, ...block(0) },
      { t: 0.35, root: { pitch: 40 * D }, chest: [6 * D, 0, 20 * D], shR: deg([-30, 12, 0]), elR: 100 * D, shL: deg([60, 20, 10]), elL: 40 * D },
      { t: 0.65, root: { pitch: 30 * D }, chest: [4 * D, 0, -10 * D], shR: deg([120, 6, 0]), elR: 80 * D, shL: deg([20, 12, 10]), elL: 80 * D },
      { t: 1, ...run(0.1, { amp: 0.9, lean: 16 }) },
    ]),
  },
  wrap: {
    dur: 0.6, frames: 10, fn: keys([
      { t: 0, ...RUNPOSE },
      { t: 0.35, root: { pitch: 34 * D }, neck: [-30 * D, 0, 0], hipR: deg([76, 12, 0]), knR: 88 * D, hipL: deg([60, 12, 0]), knL: 80 * D, flatR: true, flatL: true, shR: deg([68, 40, 0]), elR: 60 * D, shL: deg([68, 40, 0]), elL: 60 * D },
      { t: 0.7, root: { pitch: 50 * D }, neck: [-40 * D, 0, 0], hipR: deg([50, 10, 0]), knR: 50 * D, hipL: deg([80, 10, 0]), knL: 80 * D, flatL: true, shR: deg([84, 8, 44]), elR: 82 * D, shL: deg([84, 8, 44]), elL: 82 * D },
      { t: 1, root: { pitch: 62 * D }, neck: [-44 * D, 0, 0], hipR: deg([30, 10, 0]), knR: 30 * D, anR: -30 * D, hipL: deg([70, 10, 0]), knL: 70 * D, flatL: true, shR: deg([88, 4, 50]), elR: 90 * D, shL: deg([88, 4, 50]), elL: 90 * D },
    ]),
  },
  dive: {
    dur: 0.85, frames: 12, fn: keys([
      { t: 0, ...RUNPOSE },
      { t: 0.22, root: { pitch: 42 * D }, hipR: deg([84, 10, 0]), knR: 96 * D, hipL: deg([60, 10, 0]), knL: 80 * D, flatR: true, flatL: true, shR: deg([-30, 15, 0]), elR: 40 * D, shL: deg([-30, 15, 0]), elL: 40 * D },
      { t: 0.5, root: { pitch: 78 * D, lift: 0.4, x: -0.1 }, neck: [-40 * D, 0, 0], hipR: deg([4, 8, 0]), knR: 12 * D, anR: -40 * D, hipL: deg([20, 8, 0]), knL: 30 * D, anL: -40 * D, shR: deg([165, 18, 0]), elR: 12 * D, shL: deg([165, 18, 0]), elL: 12 * D },
      { t: 0.75, root: { pitch: 88 * D, lift: 0.12, x: -0.2 }, neck: [-50 * D, 0, 0], hipR: deg([2, 8, 0]), knR: 12 * D, anR: -50 * D, hipL: deg([6, 8, 0]), knL: 18 * D, anL: -50 * D, shR: deg([168, 22, 30]), elR: 30 * D, shL: deg([168, 22, 30]), elL: 30 * D },
      { t: 1, ...PRONE, shR: deg([160, 26, 40]), elR: 50 * D, shL: deg([160, 26, 40]), elL: 50 * D },
    ]),
  },
  fallFwd: {
    dur: 0.9, frames: 12, fn: keys([
      { t: 0, ...CARRY },
      { t: 0.3, ...CARRY, root: { pitch: 30 * D }, hipR: deg([40, 8, 0]), knR: 70 * D, hipL: deg([10, 8, 0]), knL: 40 * D, shL: deg([60, 30, 0]), elL: 30 * D },
      { t: 0.62, ...CARRY, root: { pitch: 56 * D }, hipR: deg([84, 10, 0]), knR: 118 * D, anR: -40 * D, hipL: deg([70, 10, 0]), knL: 112 * D, anL: -40 * D, shL: deg([100, 30, 0]), elL: 20 * D },
      { t: 1, ...PRONE, shR: deg([30, 10, 40]), elR: 120 * D, ball: 'R' },
    ]),
  },
  fallBack: {
    dur: 0.9, frames: 12, fn: keys([
      { t: 0, ...CARRY },
      { t: 0.35, ...CARRY, root: { pitch: -16 * D }, hipR: deg([70, 10, 0]), knR: 80 * D, hipL: deg([60, 10, 0]), knL: 70 * D, shL: deg([40, 50, 0]), elL: 30 * D },
      { t: 0.65, ...CARRY, root: { pitch: -44 * D }, hipR: deg([96, 12, 0]), knR: 70 * D, hipL: deg([90, 12, 0]), knL: 60 * D, shL: deg([-30, 30, 0]), elL: 10 * D, neck: [30 * D, 0, 0] },
      { t: 1, ...SUPINE, shR: deg([30, 10, 40]), elR: 120 * D, ball: 'R' },
    ]),
  },
  getUp: {
    dur: 1.0, frames: 12, fn: keys([
      { t: 0, ...PRONE, shR: deg([20, 30, 0]), elR: 120 * D, shL: deg([20, 30, 0]), elL: 120 * D },
      { t: 0.3, root: { pitch: 72 * D, x: -0.15 }, neck: [-40 * D, 0, 0], shR: deg([86, 14, 0]), elR: 10 * D, wrR: deg([-70, 0]), shL: deg([86, 14, 0]), elL: 10 * D, wrL: deg([-70, 0]), hipR: deg([30, 10, 0]), knR: 60 * D, anR: -50 * D, hipL: deg([30, 10, 0]), knL: 60 * D, anL: -50 * D },
      { t: 0.6, root: { pitch: 36 * D }, neck: [-20 * D, 0, 0], shR: deg([50, 14, 0]), elR: 20 * D, shL: deg([50, 14, 0]), elL: 20 * D, hipR: deg([96, 10, 0]), knR: 120 * D, anR: -50 * D, hipL: deg([96, 10, 0]), knL: 120 * D, anL: -50 * D },
      { t: 0.82, root: { pitch: 26 * D }, shR: deg([30, 14, 0]), elR: 40 * D, shL: deg([30, 14, 0]), elL: 40 * D, hipR: deg([96, 10, 0]), knR: 96 * D, flatR: true, hipL: deg([30, 10, 0]), knL: 100 * D, anL: -50 * D },
      { t: 1, root: { pitch: 4 * D }, hipR: deg([8, 6, 0]), knR: 10 * D, flatR: true, hipL: deg([8, 6, 0]), knL: 10 * D, flatL: true },
    ]),
  },
  throw: {
    dur: 0.8, frames: 12, fn: keys([
      { t: 0, ...SHOTGUN, ball: 'chest', shR: deg([40, 10, 34]), elR: 110 * D, shL: deg([40, 10, 34]), elL: 110 * D, gripR: 0.6, gripL: 0.6 },
      { t: 0.28, root: { pitch: 6 * D, yaw: 20 * D }, chest: [0, -4 * D, 32 * D], ball: 'handR', gripR: 0.7, gripL: 0.3, shR: deg([24, 84, -40]), elR: 104 * D, wrR: deg([-20, 0]), shL: deg([60, 30, 20]), elL: 60 * D, hipR: deg([20, 12, 0]), knR: 40 * D, flatR: true, hipL: deg([16, 8, 0]), knL: 26 * D, flatL: true },
      { t: 0.38, root: { pitch: 14 * D, yaw: -8 * D }, chest: [6 * D, 6 * D, -28 * D], ball: 'handR', gripR: 0.6, shR: deg([104, 70, 10]), elR: 30 * D, wrR: deg([20, 0]), shL: deg([10, 30, 20]), elL: 90 * D, hipR: deg([-10, 12, 0]), knR: 30 * D, hipL: deg([34, 8, 0]), knL: 24 * D, flatL: true },
      { t: 0.44, root: { pitch: 16 * D, yaw: -12 * D }, chest: [8 * D, 6 * D, -34 * D], ball: null, gripR: 0.15, shR: deg([96, 44, 30]), elR: 24 * D, shL: deg([0, 30, 20]), elL: 90 * D, hipR: deg([-12, 12, 0]), knR: 34 * D, hipL: deg([34, 8, 0]), knL: 26 * D, flatL: true },
      { t: 0.78, root: { pitch: 18 * D, yaw: -16 * D }, chest: [10 * D, 4 * D, -40 * D], ball: null, shR: deg([60, 18, 64]), elR: 40 * D, shL: deg([-10, 20, 10]), elL: 80 * D, hipR: deg([-4, 12, 0]), knR: 50 * D, anR: -30 * D, hipL: deg([30, 8, 0]), knL: 28 * D, flatL: true },
      { t: 1, ...SHOTGUN, ball: null },
    ]),
  },
  catch: {
    dur: 0.55, frames: 10, fn: keys([
      { t: 0, ...run(0.2, { amp: 0.95 }), ball: null },
      { t: 0.4, ...run(0.5, { amp: 0.9 }), shR: deg([118, 14, 30]), elR: 34 * D, wrR: deg([-30, 0]), shL: deg([118, 14, 30]), elL: 34 * D, wrL: deg([-30, 0]), ball: null, neck: [-10 * D, 0, 0], gripR: 0.04, gripL: 0.04 },
      { t: 0.58, ...run(0.7, { amp: 0.9 }), shR: deg([96, 14, 34]), elR: 58 * D, shL: deg([96, 14, 34]), elL: 58 * D, ball: 'hands', gripR: 0.5, gripL: 0.5 },
      { t: 1, ...run(0.95, { amp: 0.95, carry: 'R' }) },
    ]),
  },
  catchHigh: {
    dur: 0.7, frames: 12, fn: keys([
      { t: 0, ...run(0.2, { amp: 0.95 }), ball: null },
      { t: 0.3, root: { pitch: 4 * D }, hipR: deg([60, 8, 0]), knR: 80 * D, hipL: deg([20, 8, 0]), knL: 50 * D, shR: deg([60, 14, 0]), elR: 50 * D, shL: deg([60, 14, 0]), elL: 50 * D, gripR: 0.05, gripL: 0.05 },
      { t: 0.52, root: { lift: 0.45, pitch: -6 * D }, neck: [-30 * D, 0, 0], hipR: deg([40, 8, 0]), knR: 60 * D, anR: -30 * D, hipL: deg([6, 8, 0]), knL: 20 * D, anL: -40 * D, shR: deg([170, 10, 20]), elR: 14 * D, shL: deg([170, 10, 20]), elL: 14 * D, ball: 'hands', gripR: 0.5, gripL: 0.5 },
      { t: 0.75, root: { lift: 0.12, pitch: 4 * D }, hipR: deg([30, 8, 0]), knR: 40 * D, hipL: deg([20, 8, 0]), knL: 30 * D, shR: deg([90, 14, 30]), elR: 80 * D, shL: deg([90, 14, 30]), elL: 80 * D, ball: 'chest', gripR: 0.6, gripL: 0.6 },
      { t: 1, ...run(0.1, { amp: 0.85, carry: 'R' }) },
    ]),
  },
  handoffGive: {
    dur: 0.7, frames: 10, fn: keys([
      { t: 0, ...SHOTGUN, ball: 'chest' },
      { t: 0.4, ...SHOTGUN, root: { pitch: 14 * D, yaw: 30 * D }, chest: [4 * D, 0, 30 * D], ball: 'handR', shR: deg([40, 44, 10]), elR: 22 * D, shL: deg([40, 20, 20]), elL: 70 * D },
      { t: 0.62, ...SHOTGUN, root: { pitch: 14 * D, yaw: 30 * D }, chest: [4 * D, 0, 30 * D], ball: null, shR: deg([34, 40, 10]), elR: 30 * D, shL: deg([30, 20, 20]), elL: 80 * D },
      { t: 1, ...run(0.2, { amp: 0.6 }), shR: deg([24, 8, 40]), elR: 110 * D, shL: deg([24, 8, 40]), elL: 110 * D },
    ]),
  },
  handoffTake: {
    dur: 0.7, frames: 10, fn: keys([
      { t: 0, ...run(0.0, { amp: 0.8 }) },
      { t: 0.35, ...run(0.5, { amp: 0.8 }), shL: deg([92, 22, 44]), elL: 104 * D, shR: deg([8, 16, 40]), elR: 92 * D, ball: null, gripR: 0.1, gripL: 0.1 },
      { t: 0.6, ...run(0.9, { amp: 0.8 }), shL: deg([80, 22, 44]), elL: 110 * D, shR: deg([8, 16, 40]), elR: 92 * D, ball: 'chest', gripR: 0.6, gripL: 0.6 },
      { t: 1, ...run(0.4, { amp: 0.9, carry: 'R' }) },
    ]),
  },
  jukeR: { dur: 0.45, frames: 10, fn: juke(1) },
  jukeL: { dur: 0.45, frames: 10, fn: juke(-1) },
};

function juke(dir) {
  const plant = dir > 0 ? 'L' : 'R', push = dir > 0 ? 'R' : 'L';
  return keys([
    { t: 0, ...CARRY },
    {
      t: 0.4, ...CARRY, root: { pitch: 14 * D, roll: dir * 14 * D }, spine: [10 * D, dir * 10 * D, 0],
      ['hip' + plant]: deg([30, 34, 0]), ['kn' + plant]: 66 * D, ['flat' + plant]: true,
      ['hip' + push]: deg([40, 2, 0]), ['kn' + push]: 50 * D,
    },
    {
      t: 0.72, ...CARRY, root: { pitch: 12 * D, roll: dir * 18 * D }, spine: [8 * D, dir * 6 * D, 0],
      ['hip' + plant]: deg([-6, 20, 0]), ['kn' + plant]: 30 * D, ['an' + plant]: -30 * D,
      ['hip' + push]: deg([46, 30, 0]), ['kn' + push]: 64 * D,
    },
    { t: 1, ...CARRY },
  ]);
}

export const ACTION_KEYS = Object.keys(ACTIONS);
