// Stride calibration: how far the body travels per gait cycle if the standing
// foot is not to skate. Measured from the animation itself: while a foot is the
// lowest point (on the ground), its backward speed in the body frame per unit of
// phase is the stride. Playing the cycle at speed / stride keeps it planted.
import { fk } from '../stack/skeleton.js';

const SOLE = [0.05, -0.075, 0];
const soleOf = (J, s) => { const j = J['an' + s]; return [j.p[0] + j.R[0] * SOLE[0] + j.R[1] * SOLE[1], j.p[1] + j.R[3] * SOLE[0] + j.R[4] * SOLE[1], j.p[2] + j.R[6] * SOLE[0] + j.R[7] * SOLE[1]]; };
const cache = new Map();

/** Metres per cycle for a gait function fn(phase) -> pose. */
export function strideOf(key, fn, N = 120) {
  if (cache.has(key)) return cache.get(key);
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const J = fk(fn(i / N));
    pts.push({ R: soleOf(J, 'R'), L: soleOf(J, 'L') });
  }
  let sum = 0, n = 0;
  for (let i = 0; i < N; i++) for (const s of ['R', 'L']) {
    const a = pts[i][s], b = pts[i + 1][s], o = pts[i][s === 'R' ? 'L' : 'R'];
    if (a[1] > o[1] + 0.005 || a[1] > Math.min(...pts.map((p) => Math.min(p.R[1], p.L[1]))) + 0.03) continue;   // not the standing foot
    sum += Math.hypot(b[0] - a[0], b[2] - a[2]) * N; n++;          // any direction: run, backpedal, shuffle
  }
  const stride = n ? Math.max(0.3, sum / n) : 2;
  cache.set(key, stride);
  return stride;
}
