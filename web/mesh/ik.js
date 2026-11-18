// Contact IK for paired interactions: the whole arm, not just the palm.
//
// Each arm (shoulder flex/abduction/twist, elbow) is solved with damped least
// squares over three kinds of residual:
//   palm     the palm on its contact target (the spec's contact constraint)
//   clear    upper arm, elbow and forearm kept outside the other body (capsules)
//   stay     close to the authored pose, so the solve adapts the motion instead of inventing one
// Contact runs as states over the interaction (contactState):
//   reach    align window: the hands travel to the body
//   wrap     the hold: both palms on, elbows clear
//   release  start of the fall: palms let go as the bodies rotate
//   protect  rest of the fall: no palm target, arms only kept clear
import { fk } from '../stack/skeleton.js';
import { FALL_DUR } from './tackles.js';
import { placeToWorld } from './contact.js';

const D = Math.PI / 180;
const tw = (R, p, l) => [p[0] + R[0] * l[0] + R[1] * l[1] + R[2] * l[2], p[1] + R[3] * l[0] + R[4] * l[1] + R[5] * l[2], p[2] + R[6] * l[0] + R[7] * l[1] + R[8] * l[2]];
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const LO = [-60 * D, -30 * D, -80 * D, 0], HI = [185 * D, 130 * D, 80 * D, 150 * D];
const W_PALM = 1, W_CLEAR = 3, W_STAY = 0.06;
// clearance is measured from the arm's centre line, so it includes the arm's own thickness
const ARM_R = [0.072, 0.066, 0.06, 0.054, 0.05, 0.046, 0.035];   // along the arm (upper arm .. forearm), then the palm
const MARGIN = 0.02;

/** Palm centre (on the palm side) of a hand, body space. */
export function palmPoint(J, side) {
  const s = side === 'R' ? 1 : -1, j = J['wr' + side];
  return tw(j.R, j.p, [0.002, -0.06, -s * 0.024]);
}

/** Contact state at time t and how strongly the palm target holds. */
export function contactState(w, t) {
  const A = w.spec?.phases?.align?.duration_s ?? 0.12;
  if (w.tFall == null || t < w.tFall) return t - w.t0 < A ? { state: 'reach', palm: smooth((t - w.t0) / A) } : { state: 'wrap', palm: 1 };
  const f = (t - w.tFall) / FALL_DUR;
  if (f < 0.3) return { state: 'release', palm: 1 - smooth(f / 0.3) };
  return { state: 'protect', palm: 0 };
}

// signed distance from a world point to a set of capsules
function capDist(p, caps) {
  let best = 1e9;
  for (const c of caps) {
    const ab = [c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]];
    const ap = [p[0] - c.a[0], p[1] - c.a[1], p[2] - c.a[2]];
    const L = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const h = L > 1e-9 ? Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L)) : 0;
    const d = Math.hypot(ap[0] - ab[0] * h, ap[1] - ab[1] * h, ap[2] - ab[2] * h) - c.r;
    if (d < best) best = d;
  }
  return best;
}

/** Arm points that must stay clear: upper-arm middle, elbow, forearm middle (+ the palm when it has no target). */
function armPoints(J, side, withPalm) {
  const sh = J['sh' + side], el = J['el' + side];
  // every ~7 cm along the upper arm and forearm, so nothing slips between samples
  const pts = [tw(sh.R, sh.p, [0, -0.08, 0]), tw(sh.R, sh.p, [0, -0.17, 0]), el.p, tw(el.R, el.p, [0, -0.07, 0]), tw(el.R, el.p, [0, -0.14, 0]), tw(el.R, el.p, [0, -0.21, 0])];
  if (withPalm) pts.push(palmPoint(J, side));
  return pts;
}

/**
 * Solve one arm. goal: { target (body space) | null, palmW, caps (world), place (attacker) }.
 * Returns the arm angles and the final clearance (min signed distance of the arm points).
 */
export function solveArm(pose, side, goal, iters = 8) {
  const sh = 'sh' + side, el = 'el' + side;
  const x0 = [...pose[sh], pose[el]];
  let x = x0.slice();
  const res = (y) => {
    const J = fk({ ...pose, [sh]: y.slice(0, 3), [el]: y[3] });
    const r = [];
    if (goal.target && goal.palmW > 0) {
      const p = palmPoint(J, side);
      for (let i = 0; i < 3; i++) r.push(W_PALM * goal.palmW * (p[i] - goal.target[i]));
    }
    if (goal.caps) armPoints(J, side, !goal.target || goal.palmW <= 0).forEach((p, i) => {
      const d = goal.dist(placeToWorld(goal.place, p)) - ARM_R[i];
      r.push(W_CLEAR * Math.max(0, MARGIN - d));
    });
    for (let k = 0; k < 4; k++) r.push((goal.stay ?? W_STAY) * (y[k] - x0[k]));
    return r;
  };
  for (let it = 0; it < iters; it++) {
    const r = res(x);
    let e = 0; for (const v of r) e += v * v;
    if (e < 1e-6) break;
    const cols = [];
    for (let k = 0; k < 4; k++) { const y = x.slice(); y[k] += 0.008; const r2 = res(y); cols.push(r2.map((v, i) => (v - r[i]) / 0.008)); }
    // (J^T J + l I) dx = J^T r
    const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], g = [0, 0, 0, 0];
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) { let s = 0; for (let i = 0; i < r.length; i++) s += cols[a][i] * cols[b][i]; A[a][b] = s + (a === b ? 0.002 : 0); }
      let s = 0; for (let i = 0; i < r.length; i++) s += cols[a][i] * r[i]; g[a] = s;
    }
    const dx = solve4(A, g);
    for (let k = 0; k < 4; k++) x[k] = Math.min(HI[k], Math.max(LO[k], x[k] - dx[k]));
  }
  let clear = 1e9;
  if (goal.caps) { const J = fk({ ...pose, [sh]: x.slice(0, 3), [el]: x[3] }); armPoints(J, side, false).forEach((p, i) => { clear = Math.min(clear, goal.dist(placeToWorld(goal.place, p)) - ARM_R[i]); }); }
  return { [sh]: x.slice(0, 3), [el]: x[3], clear };
}

function solve4(A, b) {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 4; c++) {
    let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const v = M[c][c] || 1e-9;
    for (let r = 0; r < 4; r++) if (r !== c) { const f = M[r][c] / v; for (let k = c; k < 5; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[4] / (M[i][i] || 1e-9));
}

/**
 * Both arms of the tackler, by contact state. ctx:
 *   place      tackler placement (metres, after body separation)
 *   recvJ      carrier joints, recvPlace carrier placement, recvCaps carrier capsules (world)
 */
export function applyContactIK(pose, w, t, ctx) {
  const cs = contactState(w, t);
  w.contactState = cs.state;
  const J = ctx.recvJ, a = ctx.place, k = a.scale || 1, g = a.ground || 0;
  const cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
  let targets = [null, null];
  if (cs.palm > 0) {
    // contact targets on the carrier: waist sides for a wrap, thighs for a dive
    // wrap: two points on the waist, either side of the line from the carrier to
    // the tackler and a little past it (arms around the body, not through it)
    const rp = ctx.recvPlace, ry = rp.yaw;
    const bx = (a.x - rp.x) * Math.cos(ry) + (a.z - rp.z) * Math.sin(ry), bz = -(a.x - rp.x) * Math.sin(ry) + (a.z - rp.z) * Math.cos(ry);
    const phi = Math.atan2(bz, bx), WR = [0.15, 0.185];      // waist half-depth, half-width (+ a little air)
    const around = (s) => { const q = phi + s * 1.78; return [WR[0] * Math.cos(q), 0.1, WR[1] * Math.sin(q)]; };
    const pts = w.style === 'dive'
      ? [tw(J.hipR.R, J.hipR.p, [0.02, -0.3, 0.0]), tw(J.hipL.R, J.hipL.p, [0.02, -0.3, 0.0])]
      : [tw(J.spine.R, J.spine.p, around(1)), tw(J.spine.R, J.spine.p, around(-1))];
    targets = pts.map((p) => {
      const wp = placeToWorld(ctx.recvPlace, p);
      const rx = wp[0] - a.x, rz = wp[2] - a.z;
      return [(rx * cy + rz * sy) / k, wp[1] / k - g, (-rx * sy + rz * cy) / k];
    }).sort((p, q) => q[2] - p[2]);                       // his right hand takes the target on his right
  }
  const out = { ...pose };
  w.armClear = 1e9;
  for (const [side, tgt] of [['R', targets[0]], ['L', targets[1]]]) {
    const sol = solveArm(pose, side, { target: tgt, palmW: cs.palm, caps: true, dist: ctx.recvDist, place: a, stay: cs.state === 'protect' ? 0.25 : W_STAY });
    out['sh' + side] = sol['sh' + side]; out['el' + side] = sol['el' + side];
    w.armClear = Math.min(w.armClear, sol.clear);
  }
  return out;
}

/**
 * The carrier's free (left) arm: during the hold a head-on carrier puts his hand
 * on the tackler's near shoulder pad; otherwise (and in the fall) the arm is only
 * kept clear of the tackler's body. ctx: place (carrier), attJ, attPlace, attCaps.
 */
export function applyCarrierArm(pose, w, t, ctx) {
  const cs = contactState(w, t);
  const a = ctx.place, k = a.scale || 1, g = a.ground || 0, cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
  let target = null;
  if (cs.state === 'wrap' && w.fall === 'back') {
    const J = ctx.attJ;
    const cands = [tw(J.chest.R, J.chest.p, [0.02, 0.3, 0.2]), tw(J.chest.R, J.chest.p, [0.02, 0.3, -0.2])].map((p) => {
      const wp = placeToWorld(ctx.attPlace, p), rx = wp[0] - a.x, rz = wp[2] - a.z;
      return [(rx * cy + rz * sy) / k, wp[1] / k - g, (-rx * sy + rz * cy) / k];
    });
    target = cands.sort((p, q) => p[2] - q[2])[0];          // the pad on his left side
  }
  const sol = solveArm(pose, 'L', { target, palmW: target ? 0.6 : 0, caps: true, dist: ctx.attDist, place: a });
  w.carrierClear = sol.clear;
  return { ...pose, shL: sol.shL, elL: sol.elL };
}
