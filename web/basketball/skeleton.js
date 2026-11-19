// Basketball player skeleton, built from scratch (no mocap, no retargeting).
//
// Body space: +x forward (facing), +y up, +z the player's right. Metres.
// Segment lengths are the football body's measured lengths (web/stack/skeleton.js)
// Arms are the CMU subject 124 measurements (upper arm 0.303 m, forearm 0.189 m, elbow to
// wrist joint). Legs and torso are the football body's: thigh 0.45, shin 0.43, hips to head 0.70.
//
// Joints a pose sets (radians unless noted):
//   root:   { pitch (+ forward), roll (+ right), yaw (+ right), lift, x, z }
//   spine/chest/neck/head: [flex (+ bend forward), lat (+ toward right), twist (+ turn right)]
//   shR/shL, hipR/hipL: [flex (+ forward), abd (+ out to the side), twist (+ internal)]
//   elR/elL:  elbow flex (+ forearm forward/up), 0 straight, 150 max
//   prR/prL:  forearm twist (pronation +), about the forearm's own length
//   wrR/wrL:  [flex (+ hand back), dev (+ thumb side)]
//   knR/knL:  knee flex (+ shin back), 0 straight, 150 max
//   anR/anL:  ankle, only used when feet are not flat
//   flatR/flatL: keep the foot level with the floor (default true)
//
// Two joints the animation and the contact code read:
//   palmR/palmL: centre of the open palm, 0.08 m along the hand from the wrist,
//                2 cm out of the palm side. Defined here, not guessed at call sites.
//   toeR/toeL:   the toe tip, so a flat foot can be checked (toe and heel level).

export const D = Math.PI / 180;

// --- 3x3 rotation maths (row-major arrays, column vectors)
export const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];
export const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const Rx = (t) => { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; };
export const Ry = (t) => { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
export const Rz = (t) => { const c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; };

/** Human limits, shared with the court tests (degrees). */
export const LIMITS = {
  elbowMin: -10, elbowMax: 150, kneeMin: 0, kneeMax: 150,
  wristFlexMax: 80, pronationMax: 90,
};

export const PELVIS_H = 0.99;

// joint: parent, offset in the parent's frame (metres), side (+1 right, -1 left, 0 centre)
export const JOINTS = {
  pelvis: { parent: null, off: [0, PELVIS_H, 0], side: 0 },
  spine: { parent: 'pelvis', off: [0, 0.10, 0], side: 0 },
  chest: { parent: 'spine', off: [0, 0.20, 0], side: 0 },
  neck: { parent: 'chest', off: [0, 0.31, 0], side: 0 },
  head: { parent: 'neck', off: [0.01, 0.09, 0], side: 0 },
  shR: { parent: 'chest', off: [-0.01, 0.235, 0.215], side: 1 },
  elR: { parent: 'shR', off: [0, -0.303, 0], side: 1 },
  prR: { parent: 'elR', off: [0, -0.189, 0], side: 1 },   // forearm twist sits at the wrist's parent
  wrR: { parent: 'prR', off: [0, 0, 0], side: 1 },
  palmR: { parent: 'wrR', off: [0, -0.08, 0.02], side: 1 },
  shL: { parent: 'chest', off: [-0.01, 0.235, -0.215], side: -1 },
  elL: { parent: 'shL', off: [0, -0.303, 0], side: -1 },
  prL: { parent: 'elL', off: [0, -0.189, 0], side: -1 },
  wrL: { parent: 'prL', off: [0, 0, 0], side: -1 },
  palmL: { parent: 'wrL', off: [0, -0.08, -0.02], side: -1 },
  hipR: { parent: 'pelvis', off: [0, -0.03, 0.105], side: 1 },
  knR: { parent: 'hipR', off: [0, -0.45, 0], side: 1 },
  anR: { parent: 'knR', off: [0, -0.43, 0], side: 1 },
  toeR: { parent: 'anR', off: [0.20, -0.08, 0], side: 1 },
  hipL: { parent: 'pelvis', off: [0, -0.03, -0.105], side: -1 },
  knL: { parent: 'hipL', off: [0, -0.45, 0], side: -1 },
  anL: { parent: 'knL', off: [0, -0.43, 0], side: -1 },
  toeL: { parent: 'anL', off: [0.20, -0.08, 0], side: -1 },
};
export const ORDER = Object.keys(JOINTS);

export const REST = {
  root: { pitch: 0, roll: 0, yaw: 0, lift: 0, x: 0, z: 0 },
  spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
  shR: [0, 0, 0], elR: 0, prR: 0, wrR: [0, 0],
  shL: [0, 0, 0], elL: 0, prL: 0, wrL: [0, 0],
  hipR: [0, 0, 0], knR: 0, anR: 0,
  hipL: [0, 0, 0], knL: 0, anL: 0,
  flatR: true, flatL: true,
};

function localRot(name, p) {
  const j = JOINTS[name], s = j.side;
  switch (name) {
    case 'pelvis': { const r = p.root; return mul(Ry(-r.yaw), mul(Rz(-r.pitch), Rx(r.roll))); }
    case 'spine': case 'chest': case 'neck': case 'head': {
      const [f, l, t] = p[name]; return mul(Ry(-t), mul(Rz(-f), Rx(l)));
    }
    case 'shR': case 'shL': case 'hipR': case 'hipL': {
      const [f, a, t] = p[name]; return mul(Rz(f), mul(Rx(-s * a), Ry(s * t)));
    }
    case 'elR': case 'elL': return Rz(clampDeg(p[name], LIMITS.elbowMin, LIMITS.elbowMax));
    case 'prR': case 'prL': return Ry(-s * p[name]);  // about the forearm's own axis (its -y)
    case 'wrR': case 'wrL': { const [f, d] = p[name]; return mul(Rz(f), Rx(-s * d)); }
    case 'knR': case 'knL': return Rz(-clampDeg(p[name], LIMITS.kneeMin, LIMITS.kneeMax));
    case 'anR': case 'anL': return Rz(p[name]);
  }
  return I3;
}

function clampDeg(rad, lo, hi) {
  return Math.min(hi * D, Math.max(lo * D, rad));
}

/** Copy a partial pose over the rest pose. */
export function fill(pose) {
  const p = {};
  for (const k in REST) {
    const v = pose[k] !== undefined ? pose[k] : REST[k];
    p[k] = Array.isArray(v) ? v.slice() : (v && typeof v === 'object') ? { ...REST[k], ...v } : v;
  }
  return p;
}

/**
 * Forward kinematics: { joint: { R (world rotation), p (world position) } }.
 * With flat feet (the default), the ankle is set so the sole stays level with
 * the floor: the foot's pitch is the sum of the leg's pitch, so the toe cannot
 * lift and the player cannot stand on his toes unless the pose asks for it.
 */
export function fk(pose) {
  const p = fill(pose);
  // Flat feet: solve the ankle so the toe sits exactly 0.08 m below the ankle
  // (the foot level). Newton steps on the toe's height against the ankle angle.
  for (const s of ['R', 'L']) {
    if (!p['flat' + s]) continue;
    const drop = (q) => { const o = kinematics(q); return o['toe' + s].p[1] - o['an' + s].p[1]; };
    // start from the planar answer (exact when the hip has no sideways swing), then refine
    p['an' + s] = -(-p.root.pitch + p['hip' + s][0] - p['kn' + s]);
    for (let it = 0; it < 12; it++) {
      const e = drop(p) + 0.08;
      if (Math.abs(e) < 1e-7) break;
      const q = { ...p, ['an' + s]: p['an' + s] + 1e-4 };
      const slope = (drop(q) - drop(p)) / 1e-4;
      if (Math.abs(slope) < 1e-6) break;
      p['an' + s] -= e / slope;
    }
  }
  return kinematics(p);
}

function kinematics(p) {
  const out = {};
  for (const name of ORDER) {
    const j = JOINTS[name];
    const lr = localRot(name, p);
    if (!j.parent) {
      out[name] = { R: lr, p: [j.off[0] + p.root.x, j.off[1] + p.root.lift, j.off[2] + p.root.z] };
    } else {
      const par = out[j.parent];
      const o = apply(par.R, j.off);
      out[name] = { R: mul(par.R, lr), p: [par.p[0] + o[0], par.p[1] + o[1], par.p[2] + o[2]] };
    }
  }
  out._pose = p;
  return out;
}
