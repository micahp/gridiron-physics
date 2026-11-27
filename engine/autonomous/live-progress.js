// State progress is accumulated in physical space, not measured against
// an arbitrary per-tick speed threshold. Do not turn a timeout into a whistle.
export function makeLiveProgressTracker({ time, x, y, phase, distance }) {
  if (!Number.isFinite(distance) || distance <= 0) throw new Error('invalid progress distance');
  let anchor = { x, y }, lastPhase = phase, lastProgress = time;
  return {
    observe(next) {
      if (next.phase !== lastPhase || Math.hypot(next.x - anchor.x, next.y - anchor.y) >= distance) {
        anchor = { x: next.x, y: next.y };
        lastPhase = next.phase;
        lastProgress = next.time;
      }
      return next.time - lastProgress;
    }
  };
}
