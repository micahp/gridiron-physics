// Foot locking: once the animation puts a foot on the ground, pin it to that
// spot in the world and bend the leg (hip flex/abduction, knee) to keep it there
// until the animation lifts it again. Removes skating from every gait, and from
// paired interactions where the bodies are pushed around by the runtime.
import { fk } from '../stack/skeleton.js';

const D = Math.PI / 180;
const LO = [-50 * D, -25 * D, 0], HI = [135 * D, 70 * D, 155 * D];
const PLANT_Y = 0.05, MAX_STRETCH = 0.35;

function toBody(place, w) {
  const c = Math.cos(place.yaw), s = Math.sin(place.yaw), k = place.scale || 1;
  const dx = w[0] - place.x, dz = w[2] - place.z;
  return [(dx * c + dz * s) / k, w[1] / k - (place.ground || 0), (-dx * s + dz * c) / k];
}
function toWorld(place, b) {
  const c = Math.cos(place.yaw), s = Math.sin(place.yaw), k = place.scale || 1;
  return [place.x + k * (b[0] * c - b[2] * s), k * (b[1] + (place.ground || 0)), place.z + k * (b[0] * s + b[2] * c)];
}
const sole = (J, side) => { const j = J['an' + side]; const l = [0.05, -0.075, 0]; return [j.p[0] + j.R[0] * l[0] + j.R[1] * l[1], j.p[1] + j.R[3] * l[0] + j.R[4] * l[1], j.p[2] + j.R[6] * l[0] + j.R[7] * l[1]]; };

/** Bend one leg so its ankle reaches target (body space). */
export function reachLeg(pose, side, target, iters = 6) {
  const hip = 'hip' + side, kn = 'kn' + side;
  let x = [pose[hip][0], pose[hip][1], pose[kn]];
  const err = (y) => { const J = fk({ ...pose, [hip]: [y[0], y[1], pose[hip][2]], [kn]: y[2] }); const a = J['an' + side].p; return [a[0] - target[0], a[1] - target[1], a[2] - target[2]]; };
  for (let it = 0; it < iters; it++) {
    const r = err(x);
    if (Math.hypot(r[0], r[1], r[2]) < 0.003) break;
    const cols = [];
    for (let k = 0; k < 3; k++) { const y = x.slice(); y[k] += 0.01; const r2 = err(y); cols.push([(r2[0] - r[0]) / 0.01, (r2[1] - r[1]) / 0.01, (r2[2] - r[2]) / 0.01]); }
    // damped least squares, 3x3: dx = (J^T J + l^2 I)^-1 J^T r
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0], l2 = 0.002;
    for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) A[i][j] = cols[i][0] * cols[j][0] + cols[i][1] * cols[j][1] + cols[i][2] * cols[j][2] + (i === j ? l2 : 0); g[i] = cols[i][0] * r[0] + cols[i][1] * r[1] + cols[i][2] * r[2]; }
    const d = solve3(A, g);
    for (let k = 0; k < 3; k++) x[k] = Math.min(HI[k], Math.max(LO[k], x[k] - d[k]));
  }
  return { [hip]: [x[0], x[1], pose[hip][2]], [kn]: x[2] };
}
function solve3(A, b) {
  const [a, bb, c] = A[0], [d, e, f] = A[1], [g, h, i] = A[2];
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g) || 1e-9;
  return [
    ((e * i - f * h) * b[0] + (c * h - bb * i) * b[1] + (bb * f - c * e) * b[2]) / det,
    ((f * g - d * i) * b[0] + (a * i - c * g) * b[1] + (c * d - a * f) * b[2]) / det,
    ((d * h - e * g) * b[0] + (bb * g - a * h) * b[1] + (a * e - bb * d) * b[2]) / det,
  ];
}

export class FootLock {
  constructor() { this.lock = { R: null, L: null }; this.prev = { R: null, L: null }; this.last = null; }
  reset() { this.lock = { R: null, L: null }; this.prev = { R: null, L: null }; }

  /**
   * place: { x, z, yaw, scale, ground } in metres (ground = last frame's grounding offset).
   * A foot locks when the animation has it on the turf and nearly still in the
   * world; the lock blends in over 50 ms and out over 100 ms, so nothing snaps.
   */
  apply(pose, place, dt, enabled = true) {
    if (this.last && Math.hypot(place.x - this.last.x, place.z - this.last.z) > 1.5) this.reset();   // teleported (new play)
    this.last = { x: place.x, z: place.z };
    if (!enabled) { this.reset(); return pose; }
    const J = fk(pose);
    let out = pose;
    for (const side of ['R', 'L']) {
      const sw = toWorld(place, sole(J, side));
      const pv = this.prev[side];
      const speed = pv ? Math.hypot(sw[0] - pv[0], sw[2] - pv[2]) / Math.max(dt, 1e-3) : 99;
      this.prev[side] = sw;
      const planted = sw[1] < PLANT_Y && speed < 1.2;
      let L = this.lock[side];
      const ankle = J['an' + side].p;
      if (!L && planted) L = this.lock[side] = { at: toWorld(place, ankle), w: 0 };
      if (!L) continue;
      L.w = planted ? Math.min(1, L.w + dt / 0.05) : L.w - dt / 0.1;
      if (L.w <= 0) { this.lock[side] = null; continue; }
      const tgt = toBody(place, L.at);
      if (Math.hypot(tgt[0] - ankle[0], tgt[2] - ankle[2]) > MAX_STRETCH) { this.lock[side] = null; continue; }
      tgt[1] = ankle[1];                                                  // height stays the animation's
      const sol = reachLeg(out, side, tgt);
      const hip = 'hip' + side, kn = 'kn' + side, k = L.w * L.w * (3 - 2 * L.w);
      out = { ...out, [hip]: out[hip].map((v, i) => v + (sol[hip][i] - v) * k), [kn]: out[kn] + (sol[kn] - out[kn]) * k };
    }
    return out;
  }
}
