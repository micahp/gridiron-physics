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

// Only the statistical projection is bounded; the physical coordinate must
// describe a point on the field including its two ten-yard end zones.
// An actual interior spot cannot become a scoring/restart goal line merely
// because integer rounding would collapse it onto that line.
export function statFieldSpot(x, direction) {
  if (!Number.isFinite(x) || x < -10 || x > 110 || ![-1, 1].includes(direction)) {
    throw new RangeError('invalid physical football field coordinate or direction');
  }
  const relative = direction === 1 ? 100 - x : x;
  if (relative <= 0) return 0;
  if (relative >= 100) return 100;
  return Math.max(1, Math.min(99, roundYardline100(relative)));
}

// One wire representation shared by run and pass executors. Coordinates stay
// continuous in absolute field space; box-score yards are computed only after
// both endpoints are rounded in the snap-offense yardline_100 frame.
export function serializeReturnGeometry({ recoveryX, deadBallX, direction, carrierTeam }) {
  if (![recoveryX, deadBallX].every(Number.isFinite)
      || recoveryX < -10 || recoveryX > 110 || deadBallX < -10 || deadBallX > 110) {
    throw new RangeError('return geometry coordinates outside the physical field and end zones');
  }
  if (![direction].every((value) => value === -1 || value === 1)
      || !['O', 'D'].includes(carrierTeam)) {
    throw new TypeError('return geometry direction or carrier team is invalid');
  }
  const offenseFrame = (x) => statFieldSpot(x, direction);
  const advanceSign = carrierTeam === 'O' ? -1 : 1;
  return {
    return_yards: statReturnYards(offenseFrame(recoveryX), offenseFrame(deadBallX), advanceSign),
    return_displacement_yards: (deadBallX - recoveryX)
      * (carrierTeam === 'O' ? direction : -direction),
  };
}
