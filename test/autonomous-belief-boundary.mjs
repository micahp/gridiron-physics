import assert from 'node:assert/strict';
import { simulatePassPlay } from '../engine/autonomous/passing.js';

// A test-only start override must not reach the quarterback's belief about a defender he has not observed.
// Both plays share the seed. In the second, the free safety starts far downfield, out of the quarterback's view.
const base = { seed: 'boundary-1', front: 'nickel_over', coverage: 'cover_1', direction: 'right', dir: 1, los: 35, ballY: 26.667,
  concept: 'slant_flat', qbPolicy: 'belief', qbParts: ['openness', 'routeGate', 'progression', 'motion', 'gaze'] };
const plain = simulatePassPlay(base);
// A defender the quarterback never observes in the plain play, so the override is hidden from him.
const hiddenId = plain.events.filter((e) => e.type === 'visibility_probe').at(-1).rows
  .filter((r) => r.group === 'LB' || r.group === 'DB').find((r) => !plain.events.filter((e) => e.type === 'visibility_probe').some((p) => p.rows.some((x) => x.id === r.id && x.observed)))?.id;
assert.ok(hiddenId, 'a defender stayed unobserved in the plain play');
const moved = simulatePassPlay({ ...base, initialPositions: { [hiddenId]: { x: 30, y: 0 } } });

const rowsAt = (run, t) => run.events.find((e) => e.type === 'visibility_probe' && e.at_s === t)?.rows.find((r) => r.id === hiddenId);
let compared = 0;
for (const t of [0.5, 1.0, 1.5, 2.0]) {
  const a = rowsAt(plain, t), b = rowsAt(moved, t);
  assert.ok(a && b, `probe at ${t} s`);
  if (a.observed || b.observed) continue;   // once seen, the true position is legitimately observed
  compared++;
  assert.equal(b.estimate_x_yd, a.estimate_x_yd, `estimate x at ${t} s must not depend on the hidden override`);
  assert.equal(b.estimate_y_yd, a.estimate_y_yd, `estimate y at ${t} s must not depend on the hidden override`);
}
assert.ok(compared > 0, 'the safety was unobserved at some probe time, so the comparison ran');
console.log(`autonomous belief boundary ok: ${hiddenId}, ${compared} unobserved probe times compared; override did not change the estimate`);
