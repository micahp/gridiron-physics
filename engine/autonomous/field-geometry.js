// Cross-repository statistical field spots use nonnegative half-up rounding,
// matching Python floor(value + 0.5) and JavaScript Math.round on this domain.
export function roundYardline100(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError('yardline spot must be finite and between 0 and 100');
  }
  return Math.floor(value + 0.5);
}

// advanceSign is +1 when forward progress increases yardline_100 and -1 when
// forward progress decreases it. Geometry remains continuous until this stat
// boundary is reached.
export function statReturnYards(recoveryYardline, deadBallYardline, advanceSign) {
  if (![recoveryYardline, deadBallYardline].every(Number.isFinite)
      || ![advanceSign].every((value) => value === -1 || value === 1)) {
    throw new TypeError('return-yard endpoints or advance direction are invalid');
  }
  const yards = (deadBallYardline - recoveryYardline) * advanceSign;
  return yards === 0 ? 0 : yards;
}
