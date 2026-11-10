const value = (item) => item === undefined ? null : item;

export function explicitThreeDReplayAvailable(play) {
  const replay = play?.three_d_replay ?? play?.replay_3d;
  return replay?.available === true && Array.isArray(replay.frames) && replay.frames.length > 0;
}

export function projectPlay(record, drive, play) {
  const state = (input) => ({
    quarter: value(input.quarter),
    clock_seconds: value(input.clock_seconds),
    down: value(input.down),
    yards_to_go: value(input.yards_to_go),
    yardline_100: value(input.yardline_100),
    offense_team: value(input.offense_team),
    defense_team: value(input.defense_team),
    home_score: value(input.home_score),
    away_score: value(input.away_score),
    drive_index: value(input.drive_index),
  });
  return {
    game_mode: value(record.mode),
    final_points: { A: value(record.points?.A), B: value(record.points?.B) },
    drive_index: value(drive.index),
    play_sequence: value(play.sequence),
    play_id: value(play.id),
    event_type: value(play.event_type),
    outcome_yards_gained: value(play.outcome?.yards_gained),
    before: state(play.state_before),
    after: state(play.state_after),
    three_d_replay_available: explicitThreeDReplayAvailable(play),
  };
}

export function assertPlayProjectionMatchesRecord(record, drive, play, projection) {
  const expected = projectPlay(record, drive, play);
  for (const key of ["drive_index", "play_sequence", "play_id", "event_type", "outcome_yards_gained",
    "game_mode", "three_d_replay_available"]) {
    if (projection[key] !== expected[key]) throw new Error(`${key} differs from the LP record`);
  }
  for (const team of ["A", "B"]) {
    if (projection.final_points?.[team] !== expected.final_points[team]) {
      throw new Error(`final_points.${team} differs from the LP record`);
    }
  }
  for (const phase of ["before", "after"]) {
    for (const key of Object.keys(expected[phase])) {
      if (projection[phase]?.[key] !== expected[phase][key]) {
        throw new Error(`${phase}.${key} differs from the LP record`);
      }
    }
  }
  if (drive.index !== play.state_before.drive_index || drive.index !== play.state_after.drive_index) {
    throw new Error(`drive index mismatch: drive=${drive.index}, before=${play.state_before.drive_index}, after=${play.state_after.drive_index}`);
  }
  return true;
}
