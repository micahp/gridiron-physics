const EVENT_TYPES = new Set([
  'run', 'pass_complete', 'pass_incomplete', 'interception', 'sack', 'qb_scramble',
  'punt', 'field_goal', 'extra_point', 'two_point_try', 'kickoff', 'kneel', 'spike',
  'fumble', 'penalty', 'safety', 'period_end', 'game_end',
]);

const SINGLE_PLAY_MODE = 'single_play_statistical_demo';
const FIELD_ASSIGNMENT_VERSION = 'e0-field-end-v1';
const FIELD_ASSIGNMENT_SOURCE = 'authored_demo_convention';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, label) {
  if (!isObject(value)) throw new TypeError(`${label} must be an object`);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a nonempty string`);
  }
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

function validateFieldEndpoint(endpoint, state, label) {
  requireObject(endpoint, label);
  if (endpoint.dir !== 1 && endpoint.dir !== -1) {
    throw new TypeError(`${label}.dir must be 1 or -1`);
  }
  if (Number.isInteger(state.quarter) && state.quarter >= 1 && state.quarter <= 4) {
    const expectedDir = state.quarter <= 2 ? 1 : -1;
    if (endpoint.dir !== expectedDir) {
      throw new TypeError(`${label}.dir conflicts with the authored quarter convention`);
    }
  }
  if (!Number.isFinite(endpoint.los) || endpoint.los < 0 || endpoint.los > 100) {
    throw new TypeError(`${label}.los must be between 0 and 100`);
  }
  if (Number.isFinite(state.yardline_100)) {
    const expectedLos = endpoint.dir === 1 ? 100 - state.yardline_100 : state.yardline_100;
    if (endpoint.los !== expectedLos) {
      throw new TypeError(`${label}.los does not match the stated dir and yardline_100`);
    }
  }
}

function validatePlay(play, index, ids, sequences) {
  const label = `plays[${index}]`;
  requireObject(play, label);
  if (!Number.isInteger(play.sequence) || play.sequence < 1) {
    throw new TypeError(`${label}.sequence must be a positive integer`);
  }
  requireString(play.id, `${label}.id`);
  requireString(play.event_type, `${label}.event_type`);
  if (!EVENT_TYPES.has(play.event_type)) {
    throw new TypeError(`${label}.event_type is unsupported: ${play.event_type}`);
  }
  if (ids.has(play.id)) throw new TypeError(`duplicate play id: ${play.id}`);
  if (sequences.has(play.sequence)) throw new TypeError(`duplicate play sequence: ${play.sequence}`);
  ids.add(play.id);
  sequences.add(play.sequence);
  requireObject(play.state_before, `${label}.state_before`);
  requireObject(play.state_after, `${label}.state_after`);
  requireObject(play.decision, `${label}.decision`);
  requireObject(play.outcome, `${label}.outcome`);
  requireObject(play.outcome.sampled_from, `${label}.outcome.sampled_from`);
  requireObject(play.field, `${label}.field`);
  if (play.field.assignment_version !== FIELD_ASSIGNMENT_VERSION) {
    throw new TypeError(`${label}.field.assignment_version is unsupported: ${play.field.assignment_version ?? 'not provided'}`);
  }
  if (play.field.source !== FIELD_ASSIGNMENT_SOURCE) {
    throw new TypeError(`${label}.field.source is unsupported: ${play.field.source ?? 'not provided'}`);
  }
  validateFieldEndpoint(play.field.before, play.state_before, `${label}.field.before`);
  if (play.field.after !== null) {
    validateFieldEndpoint(play.field.after, play.state_after, `${label}.field.after`);
  }
}

export function collectNullPaths(value, prefix = '') {
  if (value === null) return [prefix || '$'];
  if (!isObject(value) && !Array.isArray(value)) return [];
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  return entries.flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return collectNullPaths(child, path);
  });
}

/** Validate and expose an LP v1 record for read-only presentation. */
export function adaptLpPlayRecord(record) {
  requireObject(record, 'record');
  if (record.schema_version !== '1.0') {
    throw new TypeError(`unsupported schema_version: ${record.schema_version ?? 'not provided'}`);
  }
  if (record.mode !== SINGLE_PLAY_MODE) {
    throw new TypeError(`unsupported mode: ${record.mode ?? 'not provided'}`);
  }
  if (typeof record.valid_full_game !== 'boolean') {
    throw new TypeError('valid_full_game must be a boolean');
  }
  if (record.mode === SINGLE_PLAY_MODE && record.valid_full_game) {
    throw new TypeError('single_play_statistical_demo cannot claim valid_full_game=true');
  }
  requireString(record.simulation_id, 'simulation_id');
  requireString(record.game_id, 'game_id');
  requireString(record.model_version, 'model_version');
  requireString(record.rules_version, 'rules_version');
  if (!Number.isInteger(record.seed)) throw new TypeError('seed must be an integer');
  requireObject(record.teams, 'teams');
  requireString(record.teams.home, 'teams.home');
  requireString(record.teams.away, 'teams.away');
  requireObject(record.provenance, 'provenance');
  requireString(record.provenance.outcomes, 'provenance.outcomes');
  if (typeof record.provenance.sources_as_of_verified !== 'boolean') {
    throw new TypeError('provenance.sources_as_of_verified must be a boolean');
  }
  requireObject(record.summary, 'summary');
  if (record.summary.valid_full_game !== record.valid_full_game) {
    throw new TypeError('summary.valid_full_game must match valid_full_game');
  }
  requireString(record.start_state_source, 'start_state_source');
  if (!Array.isArray(record.gaps) || record.gaps.some((gap) => typeof gap !== 'string')) {
    throw new TypeError('gaps must be an array of strings');
  }
  requireObject(record.excluded_from_pool, 'excluded_from_pool');
  requireObject(record.outcome_pool, 'outcome_pool');
  requireObject(record.outcome_pool.temporal_eligibility, 'outcome_pool.temporal_eligibility');
  requireString(record.outcome_pool.temporal_eligibility.status, 'outcome_pool.temporal_eligibility.status');
  const { cell_rows_dated_after_start: futureRows, cell_rows_total: totalRows } = record.outcome_pool.temporal_eligibility;
  if (!Number.isInteger(futureRows) || !Number.isInteger(totalRows) || futureRows < 0 || totalRows < 1 || futureRows > totalRows) {
    throw new TypeError('temporal eligibility row counts must be valid nonnegative integers');
  }
  if (!Array.isArray(record.plays) || record.plays.length === 0) {
    throw new TypeError('plays must be a nonempty array');
  }
  const ids = new Set();
  const sequences = new Set();
  record.plays.forEach((play, index) => validatePlay(play, index, ids, sequences));
  if (record.plays.length !== 1) {
    throw new TypeError('single_play_statistical_demo must contain exactly one play');
  }
  if (record.plays[0].id !== `${record.simulation_id}:${record.plays[0].sequence}`) {
    throw new TypeError('single-play id must match simulation_id:sequence');
  }
  const ordered = [...record.plays].sort((a, b) => a.sequence - b.sequence);
  if (ordered.some((play, index) => play !== record.plays[index])) {
    throw new TypeError('plays must be ordered by sequence');
  }

  // Work on a detached, frozen copy so display code cannot mutate LP's payload.
  const source = structuredClone(record);
  const temporal = source.outcome_pool.temporal_eligibility;
  const retrospective = temporal?.status === 'retrospective';
  const playCards = source.plays.map((play) => ({
    id: play.id,
    sequence: play.sequence,
    eventType: play.event_type,
    stateBefore: play.state_before,
    decision: play.decision,
    outcome: play.outcome,
    field: play.field,
    stateAfter: play.state_after,
    nullPaths: collectNullPaths({
      state_before: play.state_before,
      decision: play.decision,
      outcome: play.outcome,
      field: play.field,
      state_after: play.state_after,
    }),
  }));

  return freezeDeep({
    status: 'accepted_for_read_only_display',
    schemaVersion: source.schema_version,
    mode: source.mode,
    validFullGame: source.valid_full_game,
    displayLabel: retrospective
      ? 'RETROSPECTIVE STATISTICAL DEMONSTRATION · NOT A PREGAME SIMULATION'
      : 'SINGLE-PLAY STATISTICAL DEMONSTRATION · NOT A FULL GAME',
    temporalEligibility: temporal,
    simulationId: source.simulation_id,
    gameId: source.game_id,
    modelVersion: source.model_version,
    rulesVersion: source.rules_version,
    seed: source.seed,
    teams: source.teams,
    provenance: source.provenance,
    summary: source.summary,
    startStateSource: source.start_state_source,
    gaps: source.gaps,
    excludedFromPool: source.excluded_from_pool,
    outcomePool: source.outcome_pool,
    plays: playCards,
    replay: {
      status: 'not_attempted',
      reason: 'E0a displays the LP record only. Participant and direction inputs for a 3D replay are handled by the joint E0b gate.',
    },
  });
}

export function displayRecordValue(value) {
  if (value === null) return 'Not modelled';
  if (value === undefined) return 'Not provided';
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
