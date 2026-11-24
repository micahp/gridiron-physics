// Authored football gameplay cadence. NHL 95 research motivated per-player
// countdowns; these bounds are not copied from that game's coefficients.
export function retroDecisionInterval(rating) {
  if (!Number.isFinite(rating) || rating < 1 || rating > 99) throw new RangeError('awareness must be 1..99');
  return 0.22 - (rating - 1) * (0.14 / 98);
}
