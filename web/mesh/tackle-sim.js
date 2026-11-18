// The tackle runtime shared by the game, the tackle lab and the validator, so
// all three run the same code. Positions are scene units; `u` is scene units per
// yard (1 in the game, 0.9144 in metre scenes). Players are { x, z, vx, vz, yaw }.
import { TACKLE_GAP } from './tackles.js';
import { SPECS } from './interactions.js';

export const PILE_DECAY = 2.6;      // 1/s: how fast a falling pile loses its slide
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const CANON = { fwd: 0, back: Math.PI, R: Math.PI / 2, L: -Math.PI / 2 };

/**
 * Start a tackle between carrier c and defender d. Sets both velocities to the
 * pair's combined momentum and returns the interaction record w.
 */
export function makeTackle({ c, d, mc = 95, md = 100, t, u = 1, style: forced = null, controlled = false, rng = Math.random, snap = false }) {
  const vrx = d.vx - c.vx, vrz = d.vz - c.vz, vr = Math.hypot(vrx, vrz) / u;      // closing speed, yd/s
  const real = vr > 1.5 ? Math.atan2(vrz, vrx) : Math.atan2(c.z - d.z, c.x - d.x);
  const th = wrap(real - c.yaw), ath = Math.abs(th);
  const fall = ath < Math.PI * 0.3 ? 'fwd' : ath > Math.PI * 0.7 ? 'back' : th > 0 ? 'R' : 'L';
  // the falls are blended by the real hit angle (tackles.js), so the pair is
  // not swung round to a canonical angle: the push direction is the real one
  // alignment axis: the line the tackler is actually on (contact normal); the
  // hit direction (relative velocity) only chooses how the carrier falls
  const normal = Math.atan2(c.z - d.z, c.x - d.x);
  const ang = snap ? c.yaw + CANON[fall] : normal;
  const ex = Math.cos(ang), ez = Math.sin(ang);
  const closing = Math.max(0, vrx * ex + vrz * ez);          // scene units/s along the push
  const dist = Math.hypot(c.x - d.x, c.z - d.z) / u, dsp = Math.hypot(d.vx, d.vz) / u;
  const style = forced || (dist > 1.05 || (fall === 'fwd' && dsp > 6.2 && rng() < 0.5) ? 'dive' : 'wrap');
  const V = { x: (mc * c.vx + md * d.vx) / (mc + md), z: (mc * c.vz + md * d.vz) / (mc + md) };
  const hit = clamp((vr - 4.5) / 4.5, 0, 1);
  const hold = hit > 0.6 && fall === 'back' ? 0.14 : style === 'dive' ? 0.22 : controlled ? 0.55 : 0.35;
  c.vx = d.vx = V.x; c.vz = d.vz = V.z;
  return {
    spec: SPECS[style], t0: t, until: t + hold, tFall: null, ang, real, fall, theta: snap ? null : th, style, V, hit, tries: 0, front: fall === 'back',
    closing, age: 0, phC: 0.15, phD: 0.25,
    start: { dx: d.x, dz: d.z, dyaw: d.yaw, cx: c.x, cz: c.z },
  };
}

/** One step of the struggle: the hit's momentum bleeds into the fight for yards; the tackler settles into the clip's spot. */
export function stepStruggle(w, c, d, dt, u = 1) {
  w.age += dt;
  const hx = Math.cos(c.yaw), hz = Math.sin(c.yaw), ex = Math.cos(w.ang), ez = Math.sin(w.ang);
  const gx = (hx * 1.5 + ex * 0.9) * u, gz = (hz * 1.5 + ez * 0.9) * u;
  const k = 1 - Math.exp(-dt * 4);
  c.vx += (gx - c.vx) * k; c.vz += (gz - c.vz) * k;
  const gap = (TACKLE_GAP[w.style] || 0.62) * u;
  // the tackler closes the last of the gap at his own closing speed (his
  // momentum does the work); only what is left over is corrected
  const along = (c.x - d.x) * ex + (c.z - d.z) * ez;
  const close = Math.max(0, Math.min(w.closing, (along - gap) / dt));
  d.vx = c.vx + ex * close; d.vz = c.vz + ez * close;
  const k2 = 1 - Math.exp(-dt * 12);
  const nx = d.x + d.vx * dt, nz = d.z + d.vz * dt;           // where his own motion takes him
  const tx = c.x + c.vx * dt - ex * Math.max(gap, along - close * dt), tz = c.z + c.vz * dt - ez * Math.max(gap, along - close * dt);
  const sx = (tx - nx) * k2, sz = (tz - nz) * k2, sy = wrap(w.ang - d.yaw) * k2;
  d.x += sx; d.z += sz; d.yaw += sy;
  // legs churn at the pace the pile really moves, so planted feet don't skate
  const spd = Math.hypot(c.vx, c.vz) / u * 0.9144;
  // stride shrinks as the pile slows (gait amplitude), cadence follows speed
  w.amp = Math.min(1, Math.max(0.35, spd / 6));
  w.phC += Math.max(0.5, spd / (4.1 * w.amp)) * dt;
  w.phD += Math.max(0.5, spd / (4.3 * w.amp)) * dt;
  return { shift: Math.hypot(sx, sz), turn: Math.abs(sy) };   // correction this step, beyond his own motion
}

/** One step of the fall: the pile slides on what momentum is left. */
export function stepFall(c, d, dt) {
  const dec = Math.exp(-dt * PILE_DECAY);
  c.vx *= dec; c.vz *= dec; d.vx = c.vx; d.vz = c.vz;
}

/** Where the ball ends up along x when the pile stops (for the spot). */
export function pileSpot(w, c, u = 1) {
  const reach = { fwd: 0.55, back: -0.35, R: 0.05, L: 0.05 }[w.fall] * u;
  return c.x + c.vx / PILE_DECAY + Math.cos(w.ang) * reach;
}
