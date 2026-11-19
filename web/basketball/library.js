// Constrained basketball action library, v1.
//
// The agent picks an action by name and a time (0..1). It never sets joints.
// Each action is a small, fixed set of constraints the runtime enforces:
//   - feet flat on the floor (the root is lowered until the lowest sole touches)
//   - elbow and knee within their human limits
//   - the palm reaches the ball at its named contact time, where one exists
// The three actions in v1: stance, dribble, swipe. Add an action only when its
// checks in library.test.mjs pass.
import { fk, D, LIMITS } from './skeleton.js';
import { swipe, STRIKE_T, SWIPE_SECONDS } from './actions.js';

const ease = (x) => x * x * (3 - 2 * x);
const key = (t, a, b) => a + (b - a) * ease(Math.min(1, Math.max(0, t)));

/** Stance: knees and hips bent, arms low and ready. Static. */
function stance() {
  return {
    hipR: [28 * D, 0, 0], hipL: [28 * D, 0, 0],
    knR: 50 * D, knL: 50 * D,
    chest: [10 * D, 0, 0], spine: [6 * D, 0, 0],
    shR: [10 * D, 12 * D, 0], elR: 95 * D, wrR: [0, 0],
    shL: [10 * D, 12 * D, 0], elL: 95 * D, wrL: [0, 0],
  };
}

/**
 * Dribble, right hand. The palm pushes the ball down and back up, between the
 * waist and the hip. The shoulder drives the push (flex 30 -> 10 over the down
 * stroke, 0..0.5, then back); the elbow holds at 60 and the wrist neutral.
 * With the stance, the palm runs from about 1.08 m (top) to 0.96 m (bottom).
 */
function dribble(t) {
  const down = t < 0.5;
  const u = down ? t / 0.5 : (t - 0.5) / 0.5;
  const flex = down ? key(u, 30, 10) : key(u, 10, 30);
  return {
    ...stance(),
    shR: [flex * D, 14 * D, 0], elR: 60 * D, wrR: [0, 0],
  };
}

export const LIBRARY = {
  stance: { seconds: 1, pose: () => stance(), contact: null },
  dribble: { seconds: 0.6, pose: dribble, contact: { t: 0, point: 'palmR' } },
  swipe: { seconds: SWIPE_SECONDS, pose: (t) => ({ ...stance(), ...swipe(t) }), contact: { t: STRIKE_T, point: 'palmR' } },
};

/**
 * The pose for an action at time t, with the root lowered so the lowest sole
 * touches the floor, and the joint limits applied (fk clamps them).
 */
export function poseOf(name, t) {
  const a = LIBRARY[name];
  if (!a) throw new Error(`unknown action "${name}"`);
  const raw = a.pose(Math.min(1, Math.max(0, t)));
  return grounded(raw);
}

/** Lower the root so the lowest toe or ankle sits on the floor. */
export function grounded(pose) {
  const f0 = fk({ ...pose, root: { ...(pose.root || {}), lift: 0 } });
  const low = Math.min(f0.anR.p[1], f0.anL.p[1], f0.toeR.p[1], f0.toeL.p[1]);
  return { ...pose, root: { ...(pose.root || {}), lift: -low } };
}

/** The forward kinematics for an action at time t. */
export function frame(name, t) {
  return fk(poseOf(name, t));
}

export { LIMITS, D };
