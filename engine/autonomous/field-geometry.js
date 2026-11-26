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

// One wire representation shared by run and pass executors. Coordinates stay
// continuous in absolute field space; box-score yards are computed only after
// both endpoints are rounded in the snap-offense yardline_100 frame.
export function serializeReturnGeometry({ recoveryX, deadBallX, direction, carrierTeam }) {
  if (![recoveryX, deadBallX].every(Number.isFinite)
      || recoveryX < 0 || recoveryX > 100 || deadBallX < 0 || deadBallX > 100) {
    throw new RangeError('return geometry coordinates must be between 0 and 100 yards');
  }
  if (![direction].every((value) => value === -1 || value === 1)
      || !['O', 'D'].includes(carrierTeam)) {
    throw new TypeError('return geometry direction or carrier team is invalid');
  }
  const offenseFrame = (x) => roundYardline100(direction === 1 ? 100 - x : x);
  const advanceSign = carrierTeam === 'O' ? -1 : 1;
  return {
    return_yards: statReturnYards(offenseFrame(recoveryX), offenseFrame(deadBallX), advanceSign),
    return_displacement_yards: (deadBallX - recoveryX)
      * (carrierTeam === 'O' ? direction : -direction),
  };
}
