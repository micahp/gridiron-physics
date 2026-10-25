// Quarterback perception for the quick-pass engine.
//
// The quarterback reads what he can see, not the world. He sees players inside
// a bounded forward field of view, after a reaction delay, and not through
// another player's body. Anyone he last saw is remembered at that position and
// velocity, with uncertainty that grows with age. Contact is always felt.
// The world keeps ground truth; the quarterback reads only what perceive() returns.
import { YD } from '../constants.js';

const FOV_HALF = (70 * Math.PI) / 180;
const SIGHT_M = 30 * YD;
const REACTION_S = 0.25;
const CONTACT_M = 1.2;
const GAZE_RATE = 5; // rad/s
const EYE_H = 1.85;
const CHEST_H = 1.4;
const MAX_PREDICT_S = 1.0;
const SEEN_M = 0.5; // uncertainty of a player seen just now
const PRIOR_M = 2.5; // uncertainty of an alignment the quarterback has not confirmed
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Linemen stand taller than the quarterback's sightline; everyone else is roughly eye height.
const bodyHeight = (o) => (o.info.group === 'OL' || o.info.group === 'DL' ? 1.95 : 1.8);

export function createQbEyes(qb) {
  return { qb, gaze: qb.h, seenSince: new Map(), memory: new Map() };
}

// Before the snap the called formation is known: each defender's alignment is the prior
// until he is actually seen. An unseen defender is never treated as absent.
export function expectFormation(eyes, players, t) {
  for (const q of players) {
    if (!eyes.memory.has(q.id)) eyes.memory.set(q.id, { x: q.p.x, y: q.p.y, vx: 0, vy: 0, t, prior: true });
  }
}

function inSightline(eyes, q, players) {
  const { qb } = eyes;
  const dx = q.p.x - qb.p.x, dy = q.p.y - qb.p.y;
  const d = Math.hypot(dx, dy);
  if (d > SIGHT_M) return false;
  if (Math.abs(wrap(Math.atan2(dy, dx) - eyes.gaze)) > FOV_HALF) return false;
  for (const o of players) {
    if (o === q || o === qb) continue;
    const ox = o.p.x - qb.p.x, oy = o.p.y - qb.p.y;
    const along = (ox * dx + oy * dy) / (d * d);
    if (along <= 0.02 || along >= 0.98) continue;
    if (Math.abs(ox * dy - oy * dx) / d > o.r) continue;
    // The line rises from eye height to chest height; a body taller than the line hides the target.
    if (bodyHeight(o) > EYE_H + (CHEST_H - EYE_H) * along) return false;
  }
  return true;
}

// Called every physics step. Gaze turns toward the attention point at a bounded rate.
export function observe(eyes, players, t, dt, attention) {
  const { qb } = eyes;
  if (attention) {
    const turn = wrap(Math.atan2(attention.y - qb.p.y, attention.x - qb.p.x) - eyes.gaze);
    eyes.gaze = wrap(eyes.gaze + clamp(turn, -GAZE_RATE * dt, GAZE_RATE * dt));
  }
  for (const q of players) {
    if (q === qb) continue;
    const near = Math.hypot(q.p.x - qb.p.x, q.p.y - qb.p.y) <= CONTACT_M;
    if (!near && !inSightline(eyes, q, players)) {
      eyes.seenSince.delete(q.id);
      continue;
    }
    if (!eyes.seenSince.has(q.id)) eyes.seenSince.set(q.id, t);
    if (near || t - eyes.seenSince.get(q.id) >= REACTION_S) {
      eyes.memory.set(q.id, { x: q.p.x, y: q.p.y, vx: q.v.x, vy: q.v.y, t });
    }
  }
}

// The quarterback's estimate of a player, or null if he has never seen or expected him.
// Carries the last-seen position forward for up to a second, then holds it.
export function perceive(eyes, q, t) {
  const m = eyes.memory.get(q.id);
  if (!m) return null;
  const age = Math.max(0, t - m.t);
  const h = Math.min(age, MAX_PREDICT_S);
  const base = m.prior ? PRIOR_M : SEEN_M;
  return { x: m.x + m.vx * h, y: m.y + m.vy * h, vx: m.vx, vy: m.vy, age, uncertainty: base + 1.2 * age };
}
