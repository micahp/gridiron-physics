import { rng } from '../rng.js';

// Authored football gameplay cadence. NHL 95 research motivated per-player
// countdowns; these bounds are not copied from that game's coefficients.
export function retroDecisionInterval(rating) {
  if (!Number.isFinite(rating) || rating < 1 || rating > 99) throw new RangeError('awareness must be 1..99');
  return 0.22 - (rating - 1) * (0.14 / 98);
}

// A constant-rate hazard is sampled once for an engagement. The deadline is
// independent of how many physics steps or decision callbacks occur.
export function hazardDeadline(start, rate, uniform) {
  if (!Number.isFinite(start) || !Number.isFinite(rate) || rate <= 0
      || !Number.isFinite(uniform) || uniform < 0 || uniform >= 1) {
    throw new RangeError('invalid hazard clock inputs');
  }
  return start - Math.log1p(-uniform) / rate;
}
// Give each engagement its own deterministic hazard stream so changing the
// physics step cannot consume extra draws from the play's shared RNG stream.
export function engagementHazardUniform(seed, pairKey, ordinal = 0) {
  if (typeof pairKey !== 'string' || !pairKey || !Number.isInteger(ordinal) || ordinal < 0) {
    throw new RangeError('invalid engagement hazard identity');
  }
  return rng(`engagement-hazard:${String(seed)}:${pairKey}:${ordinal}`)();
}
