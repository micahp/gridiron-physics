// Body-to-body collision for paired interactions. Each body is a handful of
// capsules hung on the skeleton; the runtime pushes the attacker out of the
// receiver along the contact normal (back while standing, up when he lands on
// top), smoothed over frames. Arms are left out: they are the contact effectors.
const CAPS = [
  // joint, from (local), to (local), radius (m)
  ['pelvis', [0, 0.03, -0.12], [0, 0.03, 0.12], 0.14],
  ['spine', [0, 0.02, 0], [0, 0.2, 0], 0.15],
  ['chest', [0, 0.02, 0], [0, 0.24, 0], 0.17],
  ['chest', [-0.01, 0.25, -0.24], [-0.01, 0.25, 0.24], 0.1],     // shoulder pads
  ['head', [0, 0.1, 0], [0.02, 0.1, 0], 0.14],
  ['hipR', [0, -0.02, 0], [0, -0.42, 0], 0.085], ['hipL', [0, -0.02, 0], [0, -0.42, 0], 0.085],
  ['knR', [0, 0, 0], [0, -0.4, 0], 0.06], ['knL', [0, 0, 0], [0, -0.4, 0], 0.06],
];
// upper arms: the attacker's elbows must stay out too (palms and forearms are the contact effectors)
const ARMS = [['shR', [0, -0.03, 0], [0, -0.3, 0], 0.065], ['shL', [0, -0.03, 0], [0, -0.3, 0], 0.065]];
const MARGIN = 0.015;   // capsules are a little fatter than the mesh so the mesh stays clear
const tw = (R, p, l) => [p[0] + R[0] * l[0] + R[1] * l[1] + R[2] * l[2], p[1] + R[3] * l[0] + R[4] * l[1] + R[5] * l[2], p[2] + R[6] * l[0] + R[7] * l[1] + R[8] * l[2]];

/** World capsules of a posed body. place: { x, z, yaw, scale, ground } (world units = metres). */
export function capsules(J, place, { arms = false } = {}) {
  const c = Math.cos(place.yaw), s = Math.sin(place.yaw), k = place.scale || 1, g = place.ground || 0;
  const W = (b) => [place.x + k * (b[0] * c - b[2] * s), k * (b[1] + g), place.z + k * (b[0] * s + b[2] * c)];
  return (arms ? CAPS.concat(ARMS) : CAPS).map(([j, a, b, r]) => ({ a: W(tw(J[j].R, J[j].p, a)), b: W(tw(J[j].R, J[j].p, b)), r: (r + MARGIN) * k }));
}

// closest points between segments p1-q1 and p2-q2
function segSeg(p1, q1, p2, q2) {
  const d1 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]], d2 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]];
  const r = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  if (a < 1e-9 && e < 1e-9) { s = t = 0; }
  else if (a < 1e-9) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = dot(d1, r);
    if (e < 1e-9) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const c1 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s], c2 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  return [c1, c2];
}

/** Push vector (world) that moves body A out of body B, from the deepest capsule overlap. */
export function separation(capsA, capsB) {
  let best = 0, push = [0, 0, 0];
  for (const A of capsA) for (const B of capsB) {
    const [ca, cb] = segSeg(A.a, A.b, B.a, B.b);
    const dx = ca[0] - cb[0], dy = ca[1] - cb[1], dz = ca[2] - cb[2], d = Math.hypot(dx, dy, dz);
    const pen = A.r + B.r - d;
    if (pen <= best) continue;
    best = pen;
    if (d > 1e-5) push = [dx / d * pen, dy / d * pen, dz / d * pen];
    else push = [0, pen, 0];
  }
  return { depth: best, push };
}

/**
 * Smoothed separation for one interaction: accumulate the push on w.sep (world
 * x, y, z), never below the ground, easing off when the bodies are apart.
 */
export function resolveContact(w, capsA, capsB, dt) {
  const sep = w.sep || (w.sep = [0, 0, 0]);
  if (!(dt > 0)) return w.lastDepth || 0;          // paused frame
  // a few relaxation passes: push out of the deepest overlap, re-test from there
  const moved = [0, 0, 0];
  let first = 0;
  for (let it = 0; it < 4; it++) {
    const shifted = capsA.map((c) => ({ a: [c.a[0] + moved[0], c.a[1] + moved[1], c.a[2] + moved[2]], b: [c.b[0] + moved[0], c.b[1] + moved[1], c.b[2] + moved[2]], r: c.r }));
    const { depth, push } = separation(shifted, capsB);
    if (it === 0) first = depth;
    if (depth < 0.003) break;
    moved[0] += push[0]; moved[1] += Math.max(0, push[1]) + (push[1] < 0 ? 0 : 0); moved[2] += push[2];
  }
  if (first > 0.003) {
    // the push is a body being shoved, not a teleport: speed at most 5 m/s across
    // and 2 m/s up, built up no faster than a hard collision (150 m/s^2, ~15 g)
    const v = w.sepV || (w.sepV = [0, 0, 0]);
    const want = [moved[0] / dt, moved[1] / dt, moved[2] / dt];
    const h = Math.hypot(want[0], want[2]);
    if (h > 5) { want[0] *= 5 / h; want[2] *= 5 / h; }
    want[1] = Math.min(want[1], 2);
    const dv = [want[0] - v[0], want[1] - v[1], want[2] - v[2]], dl = Math.hypot(...dv), am = 150 * dt;
    if (dl > am) for (let i = 0; i < 3; i++) dv[i] *= am / dl;
    for (let i = 0; i < 3; i++) { v[i] += dv[i]; sep[i] += v[i] * dt; }
  } else if (w.sepV) w.sepV = [0, 0, 0];
  else { const r = Math.exp(-dt * 1.5); sep[0] *= r; sep[1] *= r; sep[2] *= r; }   // ease back once clear
  sep[1] = Math.max(0, sep[1]);
  return first;
}

/** Body-space point (fk frame) -> world (metres) for a placed body. */
export function placeToWorld(place, b) {
  const c = Math.cos(place.yaw), s = Math.sin(place.yaw), k = place.scale || 1, g = place.ground || 0;
  return [place.x + k * (b[0] * c - b[2] * s), k * (b[1] + g), place.z + k * (b[0] * s + b[2] * c)];
}

// ---- the real body, for limb clearance (the same shapes the mesh is built from)
import { PARTS } from '../stack/body.js';
const SOLID = PARTS.filter((p) => !p.thin || p.hand);
/** Signed distance (metres) from a world point to a placed, posed body. */
export function bodyDistance(J, place, w) {
  const c = Math.cos(place.yaw), s = Math.sin(place.yaw), k = place.scale || 1;
  const dx = w[0] - place.x, dz = w[2] - place.z;
  const b = [(dx * c + dz * s) / k, w[1] / k - (place.ground || 0), (-dx * s + dz * c) / k];
  let d = 1;
  for (const pt of SOLID) {
    const j = J[pt.joint], R = j.R, x = b[0] - j.p[0], y = b[1] - j.p[1], z = b[2] - j.p[2];
    const q = [R[0] * x + R[3] * y + R[6] * z, R[1] * x + R[4] * y + R[7] * z, R[2] * x + R[5] * y + R[8] * z];
    if (Math.abs(q[0]) > 0.6 || Math.abs(q[1]) > 0.7 || Math.abs(q[2]) > 0.6) continue;
    const e = pt.sdf(q);
    if (e < d) d = e;
  }
  return d * k;
}
