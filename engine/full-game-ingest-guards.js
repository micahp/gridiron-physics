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

function gameRecord(payload) {
  return payload?.record && typeof payload.record === 'object' ? payload.record : payload;
}

function declaresLegalCompleteGame(payload) {
  return payload?.valid_full_game === true || gameRecord(payload)?.valid_full_game === true;
}

function playRows(record) {
  return (record?.drives ?? []).flatMap((drive) => drive.plays ?? []);
}

/** Reject a play whose before/after drive IDs disagree with one another or its enclosing drive. */
export function validateDriveIndices(record) {
  record = gameRecord(record);
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
  record = gameRecord(record);
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

function activeMarker(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return !['', '0', 'false', 'no', 'none', 'null', 'no penalty'].includes(value.trim().toLowerCase());
  if (Array.isArray(value)) return value.length > 0;
  return value != null && typeof value === 'object' && Object.keys(value).length > 0;
}

function findPlayRuleMarker(play) {
  const penaltyKeys = new Set(['penalty', 'penalty_flag', 'penalty_called', 'penalty_applied', 'penalty_transition', 'penalty_yards']);
  const warningKeys = new Set(['two_minute_warning', 'two_minute_warning_flag', 'two_minute_warning_event', 'two_minute_warning_transition']);
  const warningValues = new Set(['two_minute_warning', 'two_minute_warning_transition']);
  const stack = [{ value: play, path: 'play' }];

  while (stack.length) {
    const { value, path } = stack.pop();
    if (Array.isArray(value)) {
      value.forEach((child, index) => stack.push({ value: child, path: `${path}[${index}]` }));
      continue;
    }
    if (!value || typeof value !== 'object') continue;

    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
      const childPath = `${path}.${key}`;
      if (normalizedKey === 'event_type' && typeof child === 'string') {
        const event = child.toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
        if (event === 'penalty' || event === 'penalty_transition') return { rule: 'penalties', path: childPath };
        if (warningValues.has(event)) return { rule: 'two_minute_warning', path: childPath };
      }
      if (penaltyKeys.has(normalizedKey) && activeMarker(child)) return { rule: 'penalties', path: childPath };
      if (warningKeys.has(normalizedKey) && activeMarker(child)) return { rule: 'two_minute_warning', path: childPath };
      if (['clock_event', 'clock_transition', 'stoppage_type', 'transition_type'].includes(normalizedKey)
          && typeof child === 'string' && warningValues.has(child.toLowerCase().replaceAll('-', '_').replaceAll(' ', '_'))) {
        return { rule: 'two_minute_warning', path: childPath };
      }
      if (child && typeof child === 'object') stack.push({ value: child, path: childPath });
    }
  }
  return null;
}

/** A record can contain these events as research data, but cannot claim legal full-game validity. */
export function validateLegalCompleteUnmodelledTransitions(payload) {
  if (!declaresLegalCompleteGame(payload)) return { checked: false, rejected_transitions: 0 };
  const record = gameRecord(payload);
  for (const play of playRows(record)) {
    const marker = findPlayRuleMarker(play);
    if (marker) {
      const id = play?.id ?? play?.sequence ?? '(unknown play)';
      throw new Error(`valid_full_game cannot be true: play ${id} carries unmodelled ${marker.rule} transition at ${marker.path}`);
    }
  }
  return { checked: true, rejected_transitions: 0 };
}

function hasOvertimeQuarter(record) {
  const playRows = new Set();
  const markers = [];
  for (const drive of record?.drives ?? []) {
    for (const field of ['quarter_start', 'end_quarter']) {
      if (Number(drive[field]) > 4) markers.push(`drive ${drive.index}.${field}`);
    }
    for (const play of drive.plays ?? []) {
      for (const state of ['state_before', 'state_after']) {
        if (Number(play?.[state]?.quarter) > 4) {
          const id = play?.id ?? play?.sequence ?? '(unknown play)';
          playRows.add(id);
          markers.push(`play ${id}.${state}`);
        }
      }
    }
  }
  for (const event of record?.kickoffs ?? []) {
    if (Number(event.quarter) > 4) markers.push(`kickoff quarter ${event.quarter}`);
  }
  for (const boundary of record?.boundaries ?? []) {
    if (Number(boundary.from_quarter) > 4 || Number(boundary.to_quarter) > 4) markers.push('overtime boundary');
  }
  if (Number(record?.final_quarter) > 4) markers.push(`final quarter ${record.final_quarter}`);
  return { playRows, markers };
}

/** Overtime rows from a regulation-only pool must remain visibly scoped and incomplete. */
export function validateOvertimePoolScope(payload) {
  const record = gameRecord(payload);
  const { playRows: overtimePlayRows, markers } = hasOvertimeQuarter(record);
  if (markers.length === 0) return { overtime_play_rows: 0, overtime_markers: 0, regulation_only: null };

  const scope = payload?.pool_scope ?? payload?.sources?.pool_scope ?? record?.pool_scope ?? record?.sources?.pool_scope;
  if (scope?.regulation_only !== true) {
    throw new Error(`overtime rows require producer pool_scope.regulation_only=true; found ${markers[0]}`);
  }
  if (declaresLegalCompleteGame(payload)) {
    throw new Error('a regulation-only pool cannot be declared a legal complete overtime game; valid_full_game must remain false');
  }
  return {
    overtime_play_rows: overtimePlayRows.size,
    overtime_markers: markers.length,
    regulation_only: true,
    gameplay_scope: 'regulation_only_not_overtime_simulation',
  };
}

export function validateFullGameIngest(record) {
  const driveIndexAudit = validateDriveIndices(record);
  const conversionAudit = validateConversionSources(record);
  const legalCompleteAudit = validateLegalCompleteUnmodelledTransitions(record);
  const overtimeAudit = validateOvertimePoolScope(record);
  return { ...driveIndexAudit, conversion_scoring: conversionAudit, legal_complete_transitions: legalCompleteAudit, overtime_scope: overtimeAudit };
}
