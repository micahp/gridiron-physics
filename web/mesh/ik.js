// Contact IK for paired interactions: bend the attacker's arms so the palms land
// on the receiver's body (the spec's contact constraints), instead of trusting
// the authored pose to line up for every angle, speed and body size.
// Damped least squares over each arm's 4 angles (shoulder flex/abd/twist, elbow).
import { fk } from '../stack/skeleton.js';
import { FALL_DUR } from './tackles.js';

const D = Math.PI / 180;
const toWorld = (R, p, l) => [p[0] + R[0] * l[0] + R[1] * l[1] + R[2] * l[2], p[1] + R[3] * l[0] + R[4] * l[1] + R[5] * l[2], p[2] + R[6] * l[0] + R[7] * l[1] + R[8] * l[2]];
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const LO = [-60 * D, -30 * D, -80 * D, 0], HI = [185 * D, 130 * D, 80 * D, 150 * D];

/** Palm centre (on the palm side) of a hand, body space. */
export function palmPoint(J, side) {
  const s = side === 'R' ? 1 : -1, j = J['wr' + side];
  return toWorld(j.R, j.p, [0.002, -0.06, -s * 0.024]);
}

/** Solve one arm so its palm reaches target (body space). Returns { shX, elX }. */
export function reachArm(pose, side, target, iters = 10) {
  const sh = 'sh' + side, el = 'el' + side;
  let x = [...pose[sh], pose[el]];
  const err = (y) => { const p = palmPoint(fk({ ...pose, [sh]: y.slice(0, 3), [el]: y[3] }), side); return [p[0] - target[0], p[1] - target[1], p[2] - target[2]]; };
  for (let it = 0; it < iters; it++) {
    const r = err(x);
    if (Math.hypot(r[0], r[1], r[2]) < 0.004) break;
    const cols = [];
    for (let k = 0; k < 4; k++) { const y = x.slice(); y[k] += 0.01; const r2 = err(y); cols.push([(r2[0] - r[0]) / 0.01, (r2[1] - r[1]) / 0.01, (r2[2] - r[2]) / 0.01]); }
    // damped least squares: dx = J^T (J J^T + l^2 I)^-1 r
    const l2 = 0.0025;
    const A = [[l2, 0, 0], [0, l2, 0], [0, 0, l2]];
    for (const c of cols) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) A[i][j] += c[i] * c[j];
    const y = solve3(A, r);
    for (let k = 0; k < 4; k++) x[k] = Math.min(HI[k], Math.max(LO[k], x[k] - (cols[k][0] * y[0] + cols[k][1] * y[1] + cols[k][2] * y[2])));
  }
  return { [sh]: x.slice(0, 3), [el]: x[3] };
}

function solve3(A, b) {
  const [a, bb, c] = A[0], [d, e, f] = A[1], [g, h, i] = A[2];
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  const inv = [
    [(e * i - f * h) / det, (c * h - bb * i) / det, (bb * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (bb * g - a * h) / det, (a * e - bb * d) / det],
  ];
  return inv.map((row) => row[0] * b[0] + row[1] * b[1] + row[2] * b[2]);
}

/** How strongly the contact constraint holds at time t: on through the hold, released mid-fall. */
export function contactWeight(w, t) {
  if (w.tFall == null || t < w.tFall) return smooth((t - w.t0) / 0.1);
  const f = (t - w.tFall) / FALL_DUR;
  return 1 - smooth((f - 0.1) / 0.3);
}

/**
 * Put the tackler's palms on the carrier. ctx:
 *   attacker { x, z, yaw }, attScale, attGround (inner y offset, last frame)
 *   recvJ    carrier's fk joints this frame, recvWorld(p) carrier body point -> world
 */
export function applyTackleIK(pose, w, t, ctx) {
  const k = contactWeight(w, t);
  if (k <= 0.001) return pose;
  const J = ctx.recvJ;
  // contact targets on the carrier: waist sides for a wrap, thighs for a dive
  const pts = w.style === 'dive'
    ? [toWorld(J.hipR.R, J.hipR.p, [0.02, -0.3, 0]), toWorld(J.hipL.R, J.hipL.p, [0.02, -0.3, 0])]
    : [toWorld(J.spine.R, J.spine.p, [0, 0.1, 0.17]), toWorld(J.spine.R, J.spine.p, [0, 0.1, -0.17])];
  const a = ctx.attacker, s = ctx.attScale || 1, g = ctx.attGround || 0;
  const cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
  const body = pts.map((p) => {
    const wp = ctx.recvWorld(p);
    // wrap around: reach a little past the near surface, away from the attacker
    const dx = wp[0] - a.x, dz = wp[2] - a.z, dl = Math.hypot(dx, dz) || 1;
    const px = wp[0] + (dx / dl) * 0.01, pz = wp[2] + (dz / dl) * 0.01;
    const rx = px - a.x, rz = pz - a.z;
    return [(rx * cy + rz * sy) / s, wp[1] / s - g, (-rx * sy + rz * cy) / s];
  });
  // the attacker's right hand takes the target on his right (+z)
  body.sort((p, q) => q[2] - p[2]);
  const out = { ...pose };
  for (const [side, tgt] of [['R', body[0]], ['L', body[1]]]) {
    const sol = reachArm(pose, side, tgt);
    const sh = 'sh' + side, el = 'el' + side;
    out[sh] = pose[sh].map((v, i) => v + (sol[sh][i] - v) * k);
    out[el] = pose[el] + (sol[el] - pose[el]) * k;
  }
  return out;
}
