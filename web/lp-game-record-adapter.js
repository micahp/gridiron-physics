// Read-only adapter for the versioned LP E2 game envelope. It validates the source, freezes a copy, and adds only display
// indexes; source event IDs and outcomes are never rewritten.
export const GAME_PAYLOAD_NAME = 'gridiron.lp-full-game-payload';
export const GAME_PAYLOAD_VERSION = '1.0.0';
export const GAME_DISPLAY_LABEL = 'RETROSPECTIVE STATISTICAL GAME · NOT A FORECAST · LP OUTCOMES UNCHANGED';

const TEAM_KEYS = ['A', 'B'];
const STATE_KEYS = ['quarter', 'clock_seconds', 'offense_team', 'defense_team', 'down', 'yards_to_go', 'yardline_100',
  'home_score', 'away_score', 'home_timeouts', 'away_timeouts', 'drive_index'];
const OUTCOME_FLAGS = ['touchdown', 'turnover', 'punt', 'field_goal_attempt', 'safety', 'quarter_change',
  'clock_clamped_to_zero', 'clock_only_terminal'];

function fail(message) {
  throw new TypeError(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, label) {
  if (!isObject(value)) fail(`${label} must be an object`);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string`);
}

function requireInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} must be an integer from ${min} to ${max}`);
}

function requireHash(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) fail(`${label} must be a SHA-256 hex digest`);
}

function equal(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateState(state, label) {
  requireObject(state, label);
  requireInteger(state.quarter, `${label}.quarter`, 1, 4);
  requireInteger(state.clock_seconds, `${label}.clock_seconds`, 0, 900);
  requireString(state.offense_team, `${label}.offense_team`);
  requireString(state.defense_team, `${label}.defense_team`);
  requireInteger(state.drive_index, `${label}.drive_index`, 1, Number.MAX_SAFE_INTEGER);
  for (const key of ['down', 'yards_to_go', 'yardline_100', 'home_score', 'away_score', 'home_timeouts', 'away_timeouts']) {
    if (state[key] !== null && state[key] !== undefined && !Number.isInteger(state[key])) {
      fail(`${label}.${key} must be an integer or remain null/absent`);
    }
  }
}

function validatePlay(play, label, drive, gameSequence, driveOffset, ids, simulationId, findings) {
  requireObject(play, label);
  if (play.sequence !== gameSequence) fail(`${label}.sequence must be ${gameSequence} across the game`);
  requireString(play.id, `${label}.id`);
  if (play.id !== `${simulationId}:${gameSequence}`) fail(`${label}.id must be ${simulationId}:${gameSequence}`);
  if (ids.has(play.id)) fail(`duplicate source play ID ${play.id}`);
  ids.add(play.id);
  requireString(play.event_type, `${label}.event_type`);
  validateState(play.state_before, `${label}.state_before`);
  validateState(play.state_after, `${label}.state_after`);
  if (play.state_before.drive_index !== drive.index || play.state_after.drive_index !== drive.index) {
    findings.add(`Drive ${drive.index}: source play state uses drive_index ${play.state_before.drive_index}/${play.state_after.drive_index}.`);
  }
  if (play.state_before.offense_team !== drive.offense_team) {
    findings.add(`Drive ${drive.index}: source play offense disagrees with the drive offense.`);
  }
  requireObject(play.outcome, `${label}.outcome`);
  if (play.outcome.yards_gained !== null && !Number.isInteger(play.outcome.yards_gained)) {
    fail(`${label}.outcome.yards_gained must be an integer or null`);
  }
  for (const key of OUTCOME_FLAGS) {
    if (typeof play.outcome[key] !== 'boolean') fail(`${label}.outcome.${key} must be a boolean`);
  }
  requireObject(play.participants, `${label}.participants`);
  requireString(play.participants.attribution, `${label}.participants.attribution`);
  if (play.outcome.sampled_from !== undefined && play.participants.sampled_from !== undefined
      && !equal(play.outcome.sampled_from, play.participants.sampled_from)) {
    fail(`${label} participant source must match the outcome source`);
  }
  if (driveOffset > 0) {
    const previous = drive.plays[driveOffset - 1].state_after;
    for (const key of STATE_KEYS) {
      if (!equal(play.state_before[key] ?? null, previous[key] ?? null)) {
        fail(`${label}.state_before.${key} must equal the previous play's state_after`);
      }
    }
  }
}

function validateLedger(record, findings) {
  const ledger = record.ledger;
  requireObject(ledger, 'record.ledger');
  if (!TEAM_KEYS.includes(ledger.winner) || !TEAM_KEYS.includes(ledger.loser) || ledger.winner === ledger.loser) {
    fail('record.ledger must identify distinct winner and loser teams A/B');
  }
  if (!['receive', 'defer'].includes(ledger.winner_choice)) fail('record.ledger.winner_choice must be receive or defer');
  const firstChooser = ledger.winner_choice === 'defer' ? ledger.loser : ledger.winner;
  const secondChooser = ledger.winner_choice === 'defer' ? ledger.winner : ledger.loser;
  if (ledger.first_half_chooser !== firstChooser || ledger.second_half_chooser !== secondChooser) {
    findings.add('Coin-toss chooser fields disagree with the winner choice.');
  }
  const half = record.kickoffs.filter((kick) => kick.kind === 'half_start');
  if (half.length > 2) findings.add('Record has more than two half-start kickoffs.');
  const byQuarter = new Map(half.map((kick) => [kick.quarter, kick]));
  const expected = [
    { quarter: 1, receiver: firstChooser },
    { quarter: 3, receiver: secondChooser },
  ];
  for (const item of expected) {
    const got = byQuarter.get(item.quarter);
    if (!got) {
      if (item.quarter === 1 || record.complete_regulation) findings.add(`Missing Q${item.quarter} half-start kickoff.`);
      continue;
    }
    if (got.receiving_team !== item.receiver || got.kicking_team !== (item.receiver === 'A' ? 'B' : 'A')) {
      findings.add(`Q${item.quarter} half-start kickoff disagrees with the coin-toss ledger.`);
    }
  }
  if (record.complete_regulation && half.length !== 2) findings.add('Complete regulation requires both half-start kickoffs.');
}

function validateRecord(record, { requireCompleteRegulation }) {
  const findings = new Set();
  requireObject(record, 'record');
  if (record.mode !== 'legal_game_state_first_piece') fail('record.mode is not the supported LP E2 mode');
  requireInteger(record.seed, 'record.seed', 0, Number.MAX_SAFE_INTEGER);
  requireString(record.simulation_id, 'record.simulation_id');
  requireString(record.status, 'record.status');
  if (typeof record.complete_regulation !== 'boolean' || typeof record.valid_full_game !== 'boolean') {
    fail('record completion flags must be booleans');
  }
  requireInteger(record.final_quarter, 'record.final_quarter', 1, 4);
  requireInteger(record.final_clock_seconds, 'record.final_clock_seconds', 0, 900);
  if (record.complete_regulation && (record.status !== 'complete_regulation' || record.final_quarter !== 4
      || record.final_clock_seconds !== 0)) {
    findings.add('Complete-regulation flag, status, and final Q4 clock disagree.');
  }
  if (requireCompleteRegulation && !record.complete_regulation) fail('viewer requires a complete regulation record');
  requireObject(record.points, 'record.points');
  for (const team of TEAM_KEYS) requireInteger(record.points[team], `record.points.${team}`, 0, Number.MAX_SAFE_INTEGER);
  if (!Array.isArray(record.drives) || record.drives.length === 0) fail('record.drives must be a non-empty array');
  if (!Array.isArray(record.kickoffs)) fail('record.kickoffs must be an array');
  if (!Array.isArray(record.unsupported_rules) || !Array.isArray(record.gaps)) fail('record limitations must be explicit arrays');

  validateLedger(record, findings);
  const ids = new Set();
  const pointsByTeam = { A: 0, B: 0 };
  let gameSequence = 1;
  let previousDrive = null;
  for (let driveOffset = 0; driveOffset < record.drives.length; driveOffset += 1) {
    const drive = record.drives[driveOffset];
    const label = `record.drives[${driveOffset}]`;
    requireObject(drive, label);
    const expectedIndex = driveOffset + 1;
    if (drive.index !== expectedIndex) fail(`${label}.index must be ${expectedIndex}`);
    requireString(drive.offense_team, `${label}.offense_team`);
    requireInteger(drive.quarter_start, `${label}.quarter_start`, 1, 4);
    requireInteger(drive.clock_start, `${label}.clock_start`, 0, 900);
    requireInteger(drive.end_quarter, `${label}.end_quarter`, drive.quarter_start, 4);
    requireInteger(drive.end_clock, `${label}.end_clock`, 0, 900);
    requireString(drive.terminal, `${label}.terminal`);
    if (!Array.isArray(drive.plays) || drive.plays.length === 0) fail(`${label}.plays must contain the source plays`);
    for (let playOffset = 0; playOffset < drive.plays.length; playOffset += 1) {
      validatePlay(drive.plays[playOffset], `${label}.plays[${playOffset}]`, drive, gameSequence, playOffset,
        ids, record.simulation_id, findings);
      gameSequence += 1;
    }
    const first = drive.plays[0].state_before;
    const last = drive.plays.at(-1).state_after;
    if (first.quarter !== drive.quarter_start || first.clock_seconds !== drive.clock_start) {
      findings.add(`Drive ${drive.index}: start metadata disagrees with its first play.`);
    }
    if (first.offense_team !== drive.offense_team) findings.add(`Drive ${drive.index}: offense disagrees with its first play.`);
    if (last.quarter !== drive.end_quarter || last.clock_seconds !== drive.end_clock) {
      findings.add(`Drive ${drive.index}: end metadata disagrees with its last play.`);
    }
    const scoring = drive.points_scored_on_drive;
    if (scoring !== null) {
      requireObject(scoring, `${label}.points_scored_on_drive`);
      if (!TEAM_KEYS.includes(scoring.team)) fail(`${label} scoring team must be A or B`);
      requireInteger(scoring.points, `${label}.points_scored_on_drive.points`, 1, 8);
      pointsByTeam[scoring.team] += scoring.points;
    }
    if (drive.field_goal_made !== null && typeof drive.field_goal_made !== 'boolean') {
      fail(`${label}.field_goal_made must be boolean or null`);
    }
    if (previousDrive) {
      const previousLast = previousDrive.plays.at(-1).state_after;
      if (drive.quarter_start < previousLast.quarter) findings.add(`Drive ${drive.index} starts before the prior drive ended.`);
      if (drive.quarter_start === previousLast.quarter && drive.clock_start > previousLast.clock_seconds) {
        findings.add(`Drive ${drive.index} clock moves backward within a quarter.`);
      }
    }
    previousDrive = drive;
  }
  for (const team of TEAM_KEYS) {
    if (pointsByTeam[team] !== record.points[team]) findings.add(`Team ${team} game points disagree with drive scoring.`);
    const teamStats = record.stats?.team?.[team];
    if (teamStats && teamStats.points !== record.points[team]) findings.add(`Team ${team} stat points disagree with game score.`);
  }
  for (let i = 0; i < record.kickoffs.length; i += 1) {
    const kick = record.kickoffs[i];
    requireObject(kick, `record.kickoffs[${i}]`);
    requireString(kick.kind, `record.kickoffs[${i}].kind`);
    if (!TEAM_KEYS.includes(kick.kicking_team) || !TEAM_KEYS.includes(kick.receiving_team)
        || kick.kicking_team === kick.receiving_team) findings.add(`Kickoff ${i + 1} has invalid team linkage.`);
    requireInteger(kick.quarter, `record.kickoffs[${i}].quarter`, 1, 4);
    if (!Number.isInteger(kick.after_drive) || kick.after_drive < 0 || kick.after_drive > record.drives.length) {
      findings.add(`Kickoff ${i + 1} has an invalid after_drive link.`);
    } else if (kick.after_drive < record.drives.length
        && record.drives[kick.after_drive].offense_team !== kick.receiving_team) {
      findings.add(`Kickoff ${i + 1} receiver disagrees with the next drive offense.`);
    }
  }
  for (const drive of record.drives) {
    const nextDrive = record.drives[drive.index];
    if (!nextDrive) continue;
    const lastPlay = drive.plays.at(-1);
    const terminal = drive.terminal;
    if (terminal === 'punt' || terminal === 'turnover' || terminal === 'turnover_on_downs') {
      if (nextDrive.offense_team !== lastPlay.state_after.offense_team) {
        findings.add(`Drive ${drive.index}: next offense disagrees with the recorded possession change.`);
      }
    } else if (terminal === 'field_goal_attempt' && drive.field_goal_made === false) {
      if (nextDrive.offense_team === drive.offense_team) findings.add(`Drive ${drive.index}: missed field goal did not change possession.`);
    } else if (terminal === 'halftime') {
      const expectedReceiver = record.ledger.winner_choice === 'defer' ? record.ledger.winner : record.ledger.loser;
      if (nextDrive.offense_team !== expectedReceiver) findings.add(`Drive ${drive.index}: Q3 offense disagrees with the coin-toss ledger.`);
    } else if (terminal === 'touchdown' || terminal === 'safety'
        || (terminal === 'field_goal_attempt' && drive.field_goal_made === true)) {
      const restart = record.kickoffs.find((kick) => kick.after_drive === drive.index);
      if (!restart) findings.add(`Drive ${drive.index}: scoring restart is missing from the kickoff ledger.`);
      else if (nextDrive.offense_team !== restart.receiving_team) {
        findings.add(`Drive ${drive.index}: next offense disagrees with its scoring restart receiver.`);
      }
    }
  }
  return { sourcePlayCount: ids.size, findings: [...findings] };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function sharedV1Audit(record) {
  const violations = [];
  if (record.mode !== 'pregame_full_game') violations.push('mode is not pregame_full_game');
  if (!record.game_id) violations.push('missing stable game_id');
  if (!record.model_version) violations.push('missing model_version');
  if (!record.rules_version) violations.push('missing rules_version');
  if (!record.provenance?.as_of_utc) violations.push('missing pregame as_of provenance');
  if (!record.teams?.home || !record.teams?.away) violations.push('missing real home/away team identities');
  if (!record.roster_snapshot_id) violations.push('missing eligible roster snapshot');
  if (record.drives.some((drive) => drive.plays.some((play) => play.state_before.home_score == null
      || play.state_before.away_score == null))) violations.push('play states do not carry home/away score');
  if (record.drives.some((drive) => drive.plays.some((play) => play.state_before.home_timeouts == null
      || play.state_before.away_timeouts == null))) violations.push('play states do not carry timeout counts');
  if (record.valid_full_game !== true) violations.push('record.valid_full_game is not true');
  return { conforms: violations.length === 0, violations };
}

export function adaptLpGamePayload(payload, { requireCompleteRegulation = true } = {}) {
  requireObject(payload, 'payload');
  if (payload.contract?.name !== GAME_PAYLOAD_NAME || payload.contract?.version !== GAME_PAYLOAD_VERSION) {
    fail(`unsupported payload contract; expected ${GAME_PAYLOAD_NAME} ${GAME_PAYLOAD_VERSION}`);
  }
  requireObject(payload.source, 'payload.source');
  requireString(payload.source.repository, 'payload.source.repository');
  requireString(payload.source.branch, 'payload.source.branch');
  if (typeof payload.source.producer_worktree_dirty !== 'boolean') fail('payload.source.producer_worktree_dirty must be boolean');
  requireObject(payload.source.producer_file_sha256, 'payload.source.producer_file_sha256');
  for (const [path, hash] of Object.entries(payload.source.producer_file_sha256)) {
    requireString(path, 'payload.source.producer_file_sha256 path');
    requireHash(hash, `payload.source.producer_file_sha256.${path}`);
  }
  const { sourcePlayCount, findings } = validateRecord(payload.record, { requireCompleteRegulation });
  const record = deepFreeze(structuredClone(payload.record));
  const drives = record.drives.map((drive) => ({
    index: drive.index,
    offenseTeam: drive.offense_team,
    quarterStart: drive.quarter_start,
    clockStart: drive.clock_start,
    terminal: drive.terminal,
    source: drive,
    plays: drive.plays.map((play, localOffset) => ({
      gamePlayIndex: play.sequence,
      sourceSequence: play.sequence,
      sourceId: play.id,
      source: play,
    })),
  }));
  const audit = sharedV1Audit(record);
  return Object.freeze({
    contractName: GAME_PAYLOAD_NAME,
    contractVersion: GAME_PAYLOAD_VERSION,
    displayLabel: GAME_DISPLAY_LABEL,
    source: deepFreeze(structuredClone(payload.source)),
    record,
    drives: deepFreeze(drives),
    sourcePlayCount,
    validation: deepFreeze({ passed: findings.length === 0, findings }),
    sharedV1Audit: deepFreeze(audit),
  });
}
