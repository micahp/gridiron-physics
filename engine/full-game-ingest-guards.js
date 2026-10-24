const CONVERSION_RESULT = {
  extra_point: {
    field: 'extra_point_result',
    points: { good: 1, failed: 0, blocked: 0 },
  },
  two_point_try: {
    field: 'two_point_conv_result',
    points: { success: 2, failure: 0 },
  },
};

function requireIndex(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
}

/** Reject a play whose before/after drive IDs disagree with one another or its enclosing drive. */
export function validateDriveIndices(record) {
  if (!Array.isArray(record?.drives)) throw new TypeError('record.drives must be an array');
  let checkedPlays = 0;

  for (const drive of record.drives) {
    const gameLevelIndex = drive?.index;
    requireIndex(gameLevelIndex, 'drive.index');
    if (!Array.isArray(drive.plays)) throw new TypeError(`drive ${gameLevelIndex}.plays must be an array`);

    for (const play of drive.plays) {
      const before = play?.state_before?.drive_index;
      const after = play?.state_after?.drive_index;
      if (before !== after || before !== gameLevelIndex || after !== gameLevelIndex) {
        const id = play?.id ?? play?.sequence ?? '(unknown play)';
        throw new Error(`drive-index mismatch at ${id}: state_before=${before}, state_after=${after}, game-level=${gameLevelIndex}`);
      }
      checkedPlays += 1;
    }
  }
  return { drives_checked: record.drives.length, plays_checked: checkedPlays };
}

function conversionPoints(attempt, path, kindOverride) {
  const rawKind = kindOverride ?? attempt?.kind;
  const kind = rawKind === 'two_point' ? 'two_point_try' : rawKind;
  const definition = CONVERSION_RESULT[kind];
  if (!definition) throw new TypeError(`${path}.kind must be extra_point or two_point_try`);

  const sourceResult = attempt[definition.field];
  if (!Object.hasOwn(definition.points, sourceResult)) {
    throw new TypeError(`${path}.${definition.field} must be supplied by the producer; EPA success is not a result source`);
  }
  const pointsScored = definition.points[sourceResult];

  if (attempt.made !== undefined && attempt.made !== (pointsScored > 0)) {
    throw new Error(`${path}.made conflicts with producer ${definition.field}=${sourceResult}`);
  }
  if (attempt.points_scored !== undefined && attempt.points_scored !== pointsScored) {
    throw new Error(`${path}.points_scored conflicts with producer ${definition.field}=${sourceResult}`);
  }

  return { kind, source_field: definition.field, source_result: sourceResult, points_scored: pointsScored };
}

/** Validate all conversion scoring attached to an LP-style game record. */
export function validateConversionSources(record) {
  if (!Array.isArray(record?.drives)) throw new TypeError('record.drives must be an array');
  const validated = [];

  for (const drive of record.drives) {
    const tryRecord = drive?.points_scored_on_drive?.try;
    if (drive?.terminal === 'touchdown' && tryRecord == null) {
      throw new TypeError(`drive ${drive.index}.points_scored_on_drive.try must contain the producer conversion result`);
    }
    if (tryRecord != null) {
      validated.push(conversionPoints(tryRecord, `drive ${drive.index}.points_scored_on_drive.try`));
    }

    for (const play of drive.plays ?? []) {
      if (play?.event_type === 'extra_point' || play?.event_type === 'two_point_try') {
        validated.push(conversionPoints(play.outcome, `play ${play.id ?? play.sequence ?? '(unknown)'}.outcome`, play.event_type));
      }
    }
  }
  return validated;
}

export function validateFullGameIngest(record) {
  const driveIndexAudit = validateDriveIndices(record);
  const conversionAudit = validateConversionSources(record);
  return { ...driveIndexAudit, conversion_scoring: conversionAudit };
}
