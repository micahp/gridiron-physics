const RECEIVING_20_YARDLINE_100 = 80;

function requireYardline(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new TypeError(`${fieldName} must be a finite number from 0 through 100`);
  }
}

/** Require producer-owned versions; never synthesize versions from local state. */
export function requireProducerVersions(record) {
  for (const field of ['model_version', 'rules_version']) {
    if (typeof record?.[field] !== 'string' || record[field].trim() === '') {
      throw new TypeError(`producer must supply non-empty ${field}`);
    }
  }
  return { model_version: record.model_version, rules_version: record.rules_version };
}

/**
 * Resolve a missed field goal using its actual kick spot.
 * kick_spot_yardline_100 is offense-relative at the instant of the kick;
 * state_before.yardline_100 remains the snap position and is never a fallback.
 */
export function consumeMissedFieldGoalDrive(drive) {
  if (drive?.terminal !== 'field_goal_attempt' || drive?.field_goal_made !== false) {
    throw new TypeError('expected a producer-labeled missed field_goal_attempt drive');
  }

  const play = drive.plays?.at(-1);
  if (play?.event_type !== 'field_goal_attempt') {
    throw new TypeError('missed field goal drive must end with a field_goal_attempt play');
  }
  const kickSpot = play.outcome.kick_spot_yardline_100;
  if (kickSpot == null) {
    throw new TypeError('missed field goal requires producer-supplied final play outcome.kick_spot_yardline_100; state_before.yardline_100 is only the snap position');
  }
  requireYardline(kickSpot, 'outcome.kick_spot_yardline_100');

  const receivingTeam = play.state_before?.defense_team;
  if (typeof receivingTeam !== 'string' || receivingTeam.trim() === '') {
    throw new TypeError('missed field goal requires state_before.defense_team as the receiving team');
  }

  const receivingOwnGoalDistance = Math.max(20, kickSpot);
  return {
    offense_team: receivingTeam,
    yardline_100: 100 - receivingOwnGoalDistance,
    kick_spot_yardline_100: kickSpot,
    receiving_20_exception_applied: kickSpot < 20,
    spot_source: 'producer_outcome.kick_spot_yardline_100',
  };
}
