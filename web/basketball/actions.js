// Basketball actions, authored for the basketball skeleton (skeleton.js).
// A swipe is driven by the shoulder: the arm swings about the shoulder joint
// while the elbow and wrist hold their shape, and the trunk turns with it.
// Times are 0..1 over the swipe (SWIPE_SECONDS).
import { D } from './skeleton.js';

export const SWIPE_SECONDS = 0.5;
/** Time (0..1) at which the palm reaches the ball. */
export const STRIKE_T = 0.45;

const ease = (x) => x * x * (3 - 2 * x);
const key = (t, a, b) => a + (b - a) * ease(Math.min(1, Math.max(0, t)));

/** Right-hand swipe at a ball in front of and to the right of the defender. */
export function swipe(t) {
  // shoulder: load with the arm raised out (flex 60, abd 30) -> strike down and
  // forward through the ball (flex 0, abd 15; palm at about hip height, 1.19 m)
  // -> follow-through (flex -10, abd 5) -> held at the end.
  // The ball sits where the palm is at the strike (see BALL_STRIKE below).
  const load = t < 0.2;
  const strike = t >= 0.2 && t < 0.45;
  let flex, abd;
  if (load) { flex = 60; abd = 30; }
  else if (strike) { const u = (t - 0.2) / 0.25; flex = key(u, 60, 0); abd = key(u, 30, 15); }
  else { const u = (t - 0.45) / 0.55; flex = key(u, 0, -10); abd = key(u, 15, 5); }
  const trunk = key((t - 0.2) / 0.3, 0, 1) * (1 - key((t - 0.6) / 0.4, 0, 1));
  return {
    shR: [flex * D, abd * D, 0],
    elR: 80 * D,          // held: the elbow does not swing the palm
    prR: 0,
    wrR: [0, 0],          // held: the wrist does not swing the palm
    chest: [4 * D, 0, 18 * D * trunk],
    spine: [6 * D, 0, 6 * D * trunk],
  };
}
