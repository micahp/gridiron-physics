// Football flight: 3D point mass with gravity and quadratic aerodynamic drag,
// F_d = -½ ρ C_d A |v| v. A spiralling pass flies nose-first (small A, low
// C_d ≈ 0.05–0.15); a kicked ball tumbles end over end (larger effective
// area and C_d). Bounces use a low, noisy restitution — a prolate spheroid
// bounces unpredictably, which we model with seeded randomness.
import { G, RHO_AIR, BALL_MASS, BALL_R } from './constants.js';

export const AERO = {
  spiral: { cd: 0.11, area: Math.PI * BALL_R * BALL_R },
  tumble: { cd: 0.32, area: Math.PI * BALL_R * 0.14 },
  wobble: { cd: 0.2, area: Math.PI * BALL_R * 0.11 },
};

export function dragK(aero) {
  return (0.5 * RHO_AIR * aero.cd * aero.area) / BALL_MASS;
}

/** Advance a flying ball one step (semi-implicit Euler). */
export function flyStep(b, dt, k) {
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  b.vx += -k * sp * b.vx * dt;
  b.vy += -k * sp * b.vy * dt;
  b.vz += (-G - k * sp * b.vz) * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
}

function simulate(p0, v, T, k, dt = 1 / 240) {
  const b = { x: p0.x, y: p0.y, z: p0.z, vx: v.x, vy: v.y, vz: v.z };
  const n = Math.max(1, Math.round(T / dt));
  const h = T / n;
  for (let i = 0; i < n; i++) flyStep(b, h, k);
  return b;
}

/**
 * Shooting method: find launch velocity so the ball is at `p1` after
 * exactly `T` seconds under drag. Newton iteration with a finite-difference
 * Jacobian; converges in 3–5 iterations for any football trajectory.
 */
export function solveLaunch(p0, p1, T, aero = AERO.spiral) {
  const k = dragK(aero);
  // vacuum solution as initial guess
  let v = { x: (p1.x - p0.x) / T, y: (p1.y - p0.y) / T, z: (p1.z - p0.z) / T + 0.5 * G * T };
  for (let it = 0; it < 8; it++) {
    const e = simulate(p0, v, T, k);
    const r = [p1.x - e.x, p1.y - e.y, p1.z - e.z];
    if (Math.hypot(...r) < 0.01) break;
    const J = [];
    const eps = 0.01;
    for (const key of ['x', 'y', 'z']) {
      const vv = { ...v, [key]: v[key] + eps };
      const ee = simulate(p0, vv, T, k);
      J.push([(ee.x - e.x) / eps, (ee.y - e.y) / eps, (ee.z - e.z) / eps]);
    }
    // J is column-major (J[c][r]); solve J d = r by Cramer's rule
    const a = [[J[0][0], J[1][0], J[2][0]], [J[0][1], J[1][1], J[2][1]], [J[0][2], J[1][2], J[2][2]]];
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(a);
    if (Math.abs(D) < 1e-12) break;
    const d = [0, 1, 2].map((c) => det(a.map((row, ri) => row.map((x, ci) => (ci === c ? r[ri] : x)))) / D);
    v = { x: v.x + d[0], y: v.y + d[1], z: v.z + d[2] };
  }
  return { vx: v.x, vy: v.y, vz: v.z, k };
}

/** Ground contact for a loose ball: bounce with seeded irregularity. */
export function bounce(b, rand) {
  if (b.z > 0.1 || b.vz > 0) return false;
  b.z = 0.1;
  const hard = Math.abs(b.vz);
  b.vz = hard > 1.2 ? hard * (0.25 + 0.3 * rand()) : 0;
  const keep = 0.55 + 0.25 * rand();
  const twist = (rand() - 0.5) * 1.2; // the spheroid kicks off at odd angles
  const c = Math.cos(twist), s = Math.sin(twist);
  const vx = b.vx * keep, vy = b.vy * keep;
  b.vx = vx * c - vy * s;
  b.vy = vx * s + vy * c;
  if (hard <= 1.2) {
    // rolling: ground friction
    b.vx *= 0.96;
    b.vy *= 0.96;
  }
  return true;
}
