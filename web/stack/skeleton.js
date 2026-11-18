// Skeleton for the sprite-stacked player, built from scratch (no rig reuse).
//
// Body space: +x forward (facing), +y up, +z the player's right. Metres.
// A pose is plain numbers (radians) per joint; FK turns it into a rotation +
// position per joint. Joint angle meanings:
//   limbs  shR/shL, hipR/hipL: [flex (+ swings forward), abd (+ out to the side), twist (+ internal)]
//   elbows elR/elL: flex (+ forearm forward/up)     knees knR/knL: flex (+ shin back)
//   ankles anR/anL: flex (+ toes up)                 wrists wrR/wrL: [flex, dev]
//   trunk  spine/chest/neck/head: [flex (+ bend forward), lat (+ toward right), twist (+ turn right)]
//   root:  { pitch (+ forward), roll (+ right), yaw (+ right), lift, x, z }

export const D = Math.PI / 180;

// --- tiny 3x3 rotation + vec3 maths (column vectors, row-major arrays)
export const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];
export const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export const applyT = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
export const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const Rx = (t) => { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; };
export const Ry = (t) => { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
export const Rz = (t) => { const c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; };

export const PELVIS_H = 0.99;

// joint: parent, offset in the parent's frame, side (+1 right, -1 left, 0 centre)
export const JOINTS = {
  pelvis: { parent: null, off: [0, PELVIS_H, 0], side: 0 },
  spine: { parent: 'pelvis', off: [0, 0.1, 0], side: 0 },
  chest: { parent: 'spine', off: [0, 0.2, 0], side: 0 },
  neck: { parent: 'chest', off: [0, 0.31, 0], side: 0 },
  head: { parent: 'neck', off: [0.01, 0.09, 0], side: 0 },
  shR: { parent: 'chest', off: [-0.01, 0.235, 0.215], side: 1 },
  elR: { parent: 'shR', off: [0, -0.29, 0], side: 1 },
  wrR: { parent: 'elR', off: [0, -0.26, 0], side: 1 },
  shL: { parent: 'chest', off: [-0.01, 0.235, -0.215], side: -1 },
  elL: { parent: 'shL', off: [0, -0.29, 0], side: -1 },
  wrL: { parent: 'elL', off: [0, -0.26, 0], side: -1 },
  hipR: { parent: 'pelvis', off: [0, -0.03, 0.105], side: 1 },
  knR: { parent: 'hipR', off: [0, -0.45, 0], side: 1 },
  anR: { parent: 'knR', off: [0, -0.43, 0], side: 1 },
  hipL: { parent: 'pelvis', off: [0, -0.03, -0.105], side: -1 },
  knL: { parent: 'hipL', off: [0, -0.45, 0], side: -1 },
  anL: { parent: 'knL', off: [0, -0.43, 0], side: -1 },
  // hands: knuckles (all four fingers), middle joints, thumb. Curl comes from grip.
  fiR: { parent: 'wrR', off: [0, -0.098, 0], side: 1 },
  fi2R: { parent: 'fiR', off: [0, -0.046, 0], side: 1 },
  thR: { parent: 'wrR', off: [0.036, -0.03, -0.008], side: 1 },
  fiL: { parent: 'wrL', off: [0, -0.098, 0], side: -1 },
  fi2L: { parent: 'fiL', off: [0, -0.046, 0], side: -1 },
  thL: { parent: 'wrL', off: [0.036, -0.03, 0.008], side: -1 },
};
export const ORDER = Object.keys(JOINTS);

export const REST = {
  root: { pitch: 0, roll: 0, yaw: 0, lift: 0, x: 0, z: 0 },
  spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
  shR: [0, 12 * D, 0], elR: 15 * D, wrR: [0, 0], shL: [0, 12 * D, 0], elL: 15 * D, wrL: [0, 0],
  hipR: [0, 4 * D, 0], knR: 4 * D, anR: 0, hipL: [0, 4 * D, 0], knL: 4 * D, anL: 0,
  gripR: 0.35, gripL: 0.35,   // 0 open flat hand .. 1 tight fist
  ball: null,          // null | 'R' (tucked right) | 'L' | 'handR' | 'hands' | 'chest'
  flatR: false, flatL: false,   // force a foot level with the ground
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
    case 'elR': case 'elL': return Rz(p[name]);
    case 'wrR': case 'wrL': { const [f, d] = p[name]; return mul(Rz(f), Rx(-s * d)); }
    case 'knR': case 'knL': return Rz(-p[name]);
    case 'anR': case 'anL': return Rz(p[name]);
    // fingers curl toward the palm (the palm faces the body: -z on the right hand)
    case 'fiR': case 'fiL': return Rx(s * (p['grip' + name[2]] ?? 0.35) * 82 * D);
    case 'fi2R': case 'fi2L': return Rx(s * (p['grip' + name[3]] ?? 0.35) * 96 * D);
    case 'thR': case 'thL': { const g = p['grip' + name[2]] ?? 0.35; return mul(Ry(s * (12 + g * 52) * D), Rx(s * g * 30 * D)); }
  }
  return I3;
}

/** Forward kinematics: { joint: { R (world rot), p (world pos) } }. */
export function fk(pose) {
  const p = fill(pose);
  // level the feet if asked: the foot's pitch is the sum of z rotations down the leg
  for (const s of ['R', 'L']) {
    if (!p['flat' + s]) continue;
    const sum = -p.root.pitch + p['hip' + s][0] - p['kn' + s];
    p['an' + s] = -sum;
  }
  const out = {};
  for (const name of ORDER) {
    const j = JOINTS[name];
    const lr = localRot(name, p);
    if (!j.parent) {
      out[name] = { R: lr, p: [j.off[0] + p.root.x, j.off[1], j.off[2] + p.root.z] };
    } else {
      const par = out[j.parent];
      const o = apply(par.R, j.off);
      out[name] = { R: mul(par.R, lr), p: [par.p[0] + o[0], par.p[1] + o[1], par.p[2] + o[2]] };
    }
  }
  out._pose = p;
  return out;
}

/** Copy a partial pose over the rest pose (deep enough for our shape). */
export function fill(pose) {
  const p = {};
  for (const k in REST) {
    const v = pose[k] !== undefined ? pose[k] : REST[k];
    p[k] = Array.isArray(v) ? v.slice() : (v && typeof v === 'object') ? { ...REST[k], ...v } : v;
  }
  return p;
}

// --- keyframe interpolation (Catmull-Rom on every numeric channel)
function lerpVal(a, b, t) {
  if (Array.isArray(a)) return a.map((x, i) => x + (b[i] - x) * t);
  if (a && typeof a === 'object') { const o = {}; for (const k in a) o[k] = a[k] + ((b[k] ?? a[k]) - a[k]) * t; return o; }
  if (typeof a === 'number') return a + (b - a) * t;
  return t < 0.5 ? a : b;
}
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function crVal(a, b, c, d, t) {
  if (Array.isArray(b)) return b.map((_, i) => cr(a[i], b[i], c[i], d[i], t));
  if (b && typeof b === 'object') { const o = {}; for (const k in b) o[k] = cr(a[k], b[k], c[k], d[k], t); return o; }
  if (typeof b === 'number') return cr(a, b, c, d, t);
  return t < 0.5 ? b : c;
}

/**
 * Sample keys [{t, ...partialPose}] at time t (0..1). Each key is filled from
 * `base` (then REST). loop=true wraps around.
 */
export function sampleKeys(keys, t, { loop = false, base = {} } = {}) {
  const full = keys.map((k) => ({ t: k.t, p: fill({ ...base, ...k, root: { ...(base.root || {}), ...(k.root || {}) } }) }));
  const n = full.length;
  if (n === 1) return full[0].p;
  if (loop) t = ((t % 1) + 1) % 1; else t = Math.min(1, Math.max(0, t));
  let i = n - 1;
  for (let k = 0; k < n - 1; k++) if (t >= full[k].t && t < full[k + 1].t) { i = k; break; }
  if (!loop && t >= full[n - 1].t) return full[n - 1].p;
  if (!loop && t < full[0].t) return full[0].p;
  const at = (k) => full[((k % n) + n) % n];
  const a = at(i), b = loop ? at(i + 1) : full[Math.min(n - 1, i + 1)];
  let span = b.t - a.t; if (span <= 0) span += 1;
  let u = (t - a.t); if (u < 0) u += 1; u /= span;
  const p0 = loop ? at(i - 1).p : full[Math.max(0, i - 1)].p;
  const p3 = loop ? at(i + 2).p : full[Math.min(n - 1, i + 2)].p;
  const out = {};
  for (const k in a.p) out[k] = crVal(p0[k], a.p[k], b.p[k], p3[k], u);
  return out;
}

/** Periodic curve through [phase, value] points (phase 0..1, value degrees), smooth. */
export function curve(pts) {
  return (ph) => {
    ph = ((ph % 1) + 1) % 1;
    const n = pts.length;
    let i = n - 1;
    for (let k = 0; k < n; k++) if (ph >= pts[k][0] && (k === n - 1 || ph < pts[k + 1][0])) { i = k; break; }
    const at = (k) => pts[((k % n) + n) % n];
    const a = at(i), b = at(i + 1);
    let span = b[0] - a[0]; if (span <= 0) span += 1;
    let u = ph - a[0]; if (u < 0) u += 1; u /= span;
    return cr(at(i - 1)[1], a[1], b[1], at(i + 2)[1], u) * D;
  };
}

export { lerpVal };
