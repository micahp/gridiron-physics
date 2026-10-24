// Read-only adapter for LP E1 drive records (mode drive_statistical_demo).
// Separate from lp-play-record-adapter.js, which accepts only the E0a single-play envelope. Nothing here changes an
// LP record: the input is validated, copied, and returned as a deeply frozen display model.
import { collectNullPaths, convertYardlineToLos } from './lp-play-record-adapter.js';

export const DRIVE_MODE = 'drive_statistical_demo';
export const DRIVE_SCHEMA_VERSIONS = Object.freeze(['1.0', '1.1']);
export const DRIVE_FIELD_VERSION = 'e1-field-end-v2';
export const DRIVE_FIELD_SOURCE = 'authored_demo_orientation';
export const DRIVE_EVENT_TYPES = Object.freeze([
  'run', 'pass_complete', 'pass_incomplete', 'sack', 'interception', 'fumble_lost', 'punt', 'field_goal_attempt',
]);
export const DRIVE_TERMINAL_TEXT = Object.freeze({
  touchdown: 'Touchdown. Points are not computed, and no PAT or kickoff is generated.',
  turnover: "Turnover. The other offense starts at the published next-snap spot. The return is not generated.",
  turnover_on_downs: 'Turnover on downs. The other offense starts at the complementary spot, and the direction flips.',
  punt: "Punt. The receiving team starts at its published next-snap spot. The kick and return are not generated.",
  field_goal_attempt: 'Field-goal attempt. Outcome unknown: made or missed is not in the source. No points and no next possession are shown.',
  safety: 'Safety. No two-point or free-kick restart is modelled.',
  halftime: 'Halftime. The first-half drive ends. No half-start kickoff is modelled.',
  end_of_regulation: 'End of regulation (Q4 expired). No winner, overtime or game result is generated.',
});
export const DRIVE_REJECTED_TERMINALS = Object.freeze({
  end_of_period: 'end_of_period is superseded and is not an E1 terminal; Q1 and Q3 ends are quarter changes',
});
export const DRIVE_DISPLAY_LABEL = 'RETROSPECTIVE RESEARCH DRIVE · NOT A LEGAL GAME · NO SECOND-HALF KICKOFF MODELLED';
const QUARTER_LENGTH = 900;
const FLIP_AFTER = [1, 3];
const KICK_EVENTS = ['punt', 'field_goal_attempt'];
const SUMMARY_KEYS = [
  'plays', 'yards', 'first_downs', 'terminal', 'touchdown', 'turnovers', 'punts', 'field_goal_attempts',
  'quarter_changes', 'clock_runoff_total_seconds', 'plays_with_negative_yards',
];

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
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a nonempty string`);
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be a boolean`);
}

function requireInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} must be an integer from ${min} to ${max}`);
}

function requireNullOr(value, label, check) {
  if (value === null) return;
  check(value, label);
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

function flipsBetween(startQuarter, quarter) {
  return FLIP_AFTER.filter((boundary) => startQuarter <= boundary && boundary < quarter).length;
}

function expectedDirection(startState, team, quarter) {
  const base = startState.dir * ((flipsBetween(startState.quarter, quarter) % 2) === 0 ? 1 : -1);
  return team === startState.offense ? base : -base;
}

function validateStartState(start) {
  requireObject(start, 'start_state');
  requireString(start.source, 'start_state.source');
  if (!start.source.includes('authored')) fail('start_state.source must label the start as authored');
  requireInteger(start.quarter, 'start_state.quarter', 1, 4);
  requireInteger(start.clock, 'start_state.clock', 0, QUARTER_LENGTH);
  requireString(start.offense, 'start_state.offense');
  requireString(start.defense, 'start_state.defense');
  requireInteger(start.yl, 'start_state.yl', 1, 99);
  requireInteger(start.down, 'start_state.down', 1, 4);
  requireInteger(start.togo, 'start_state.togo', 1, 99);
  if (start.dir !== 1 && start.dir !== -1) fail('start_state.dir must be 1 or -1');
}

function validateState(state, label) {
  requireObject(state, label);
  requireInteger(state.quarter, `${label}.quarter`, 1, 4);
  requireInteger(state.clock_seconds, `${label}.clock_seconds`, 0, QUARTER_LENGTH);
  requireString(state.offense_team, `${label}.offense_team`);
  requireString(state.defense_team, `${label}.defense_team`);
  requireNullOr(state.down, `${label}.down`, (v, l) => requireInteger(v, l, 1, 4));
  requireNullOr(state.yards_to_go, `${label}.yards_to_go`, (v, l) => requireInteger(v, l, 1, 99));
  requireNullOr(state.yardline_100, `${label}.yardline_100`, (v, l) => requireInteger(v, l, 1, 99));
  requireInteger(state.drive_index, `${label}.drive_index`, 1, Number.MAX_SAFE_INTEGER);
  for (const key of ['home_score', 'away_score', 'home_timeouts', 'away_timeouts']) {
    if (state[key] !== null) fail(`${label}.${key} must be null: E1 does not provide it`);
  }
}

function validateOutcome(outcome, event, label) {
  requireObject(outcome, label);
  for (const key of ['touchdown', 'turnover', 'punt', 'field_goal_attempt', 'safety', 'clock_clamped_to_zero',
    'quarter_change', 'clock_only_terminal', 'sampled_touchdown_flag']) {
    requireBoolean(outcome[key], `${label}.${key}`);
  }
  requireInteger(outcome.clock_runoff_seconds, `${label}.clock_runoff_seconds`, 0, Number.MAX_SAFE_INTEGER);
  if (KICK_EVENTS.includes(event)) {
    if (outcome.yards_gained !== null) fail(`${label}.yards_gained must be null for ${event}`);
  } else {
    requireInteger(outcome.yards_gained, `${label}.yards_gained`, -99, 99);
  }
  requireNullOr(outcome.final_play_yardline_100, `${label}.final_play_yardline_100`, (v, l) => requireInteger(v, l, 1, 99));
  for (const key of ['passer_id', 'receiver_id', 'rusher_id']) {
    if (outcome[key] !== null) fail(`${label}.${key} must be null: no participant identities are supplied`);
  }
  requireObject(outcome.sampled_from, `${label}.sampled_from`);
  requireString(outcome.sampled_from.game_id, `${label}.sampled_from.game_id`);
  requireString(outcome.sampled_from.game_date, `${label}.sampled_from.game_date`);
}

function validateField(field, state, label) {
  requireObject(field, label);
  if (field.assignment_version !== DRIVE_FIELD_VERSION) {
    fail(`${label}.assignment_version must be ${DRIVE_FIELD_VERSION}, got ${field.assignment_version ?? 'none'}`);
  }
  if (field.source !== DRIVE_FIELD_SOURCE) fail(`${label}.source must be ${DRIVE_FIELD_SOURCE}`);
  for (const side of ['before', 'after']) {
    const endpoint = field[side];
    if (endpoint === null) fail(`${label}.${side} must be an object whose dir and los may be null`);
    requireObject(endpoint, `${label}.${side}`);
  }
}

function checkEndpoint(endpoint, yardline, label) {
  if (yardline === null) {
    if (endpoint.dir !== null || endpoint.los !== null) fail(`${label} must be null when the field position is null`);
    return;
  }
  if (endpoint.dir !== 1 && endpoint.dir !== -1) fail(`${label}.dir must be 1 or -1`);
  if (endpoint.los !== convertYardlineToLos(endpoint.dir, yardline)) {
    fail(`${label}.los does not match the stated dir and yardline_100`);
  }
}

function terminalOf(play) {
  return play.state_after.end_of_drive ?? null;
}

function checkTerminal(play, terminal, label) {
  if (terminal === null) return;
  if (Object.hasOwn(DRIVE_REJECTED_TERMINALS, terminal)) fail(`${label}: ${DRIVE_REJECTED_TERMINALS[terminal]}`);
  if (!Object.hasOwn(DRIVE_TERMINAL_TEXT, terminal)) fail(`${label}: unsupported terminal ${terminal}`);
  const { outcome, state_after: after, state_before: before } = play;
  const expected = {
    touchdown: outcome.touchdown, punt: outcome.punt, field_goal_attempt: outcome.field_goal_attempt,
    safety: outcome.safety, turnover: outcome.turnover, turnover_on_downs: outcome.turnover,
  };
  if (Object.hasOwn(expected, terminal) && expected[terminal] !== true) {
    fail(`${label}: terminal ${terminal} is not supported by its outcome flags`);
  }
  if (terminal === 'turnover_on_downs' && play.outcome.touchdown) fail(`${label}: touchdown cannot be a turnover on downs`);
  if (['touchdown', 'safety', 'field_goal_attempt', 'halftime', 'end_of_regulation'].includes(terminal)) {
    if (after.down !== null || after.yards_to_go !== null || after.yardline_100 !== null) {
      fail(`${label}: ${terminal} must not carry a scrimmage state`);
    }
  }
  if (terminal === 'field_goal_attempt' && after.offense_team !== before.offense_team) {
    fail(`${label}: a field-goal attempt must not show a next possession`);
  }
  if (terminal === 'halftime' && (after.quarter !== 2 || after.clock_seconds !== 0)) {
    fail(`${label}: halftime must sit at the end of Q2 with clock 0`);
  }
  if (terminal === 'end_of_regulation' && (after.quarter !== 4 || after.clock_seconds !== 0)) {
    fail(`${label}: end_of_regulation must sit at the end of Q4 with clock 0`);
  }
  if (['turnover', 'turnover_on_downs', 'punt'].includes(terminal)) {
    if (after.offense_team === before.offense_team) fail(`${label}: ${terminal} must change the offense`);
    if (after.down !== 1 || after.yardline_100 === null) fail(`${label}: ${terminal} must start the new offense at a spot`);
  }
}

function recomputeSummary(plays, terminal) {
  const first = plays.filter((play) => play.state_before.offense_team === play.state_after.offense_team
    && play.state_after.end_of_drive === undefined && play.state_after.down === 1
    && play.outcome.yards_gained !== null && play.outcome.yards_gained >= play.state_before.yards_to_go).length;
  return {
    plays: plays.length,
    yards: plays.reduce((sum, play) => sum + (play.outcome.yards_gained ?? 0), 0),
    first_downs: first,
    terminal,
    touchdown: plays[plays.length - 1].outcome.touchdown,
    turnovers: plays.filter((play) => play.outcome.turnover).length,
    punts: plays.filter((play) => play.outcome.punt).length,
    field_goal_attempts: plays.filter((play) => play.outcome.field_goal_attempt).length,
    quarter_changes: plays.filter((play) => play.outcome.quarter_change).length,
    clock_clamped_plays: plays.filter((play) => play.outcome.clock_clamped_to_zero).length,
    clock_runoff_total_seconds: plays.reduce((sum, play) => sum + play.outcome.clock_runoff_seconds, 0),
    plays_with_negative_yards: plays.filter((play) => (play.outcome.yards_gained ?? 0) < 0).length,
  };
}

/** Validate and expose an LP E1 drive record for read-only presentation. Throws TypeError on any violation. */
export function adaptLpDriveRecord(record) {
  requireObject(record, 'record');
  if (!DRIVE_SCHEMA_VERSIONS.includes(record.schema_version)) {
    fail(`unsupported schema_version: ${record.schema_version ?? 'not provided'}; supported ${DRIVE_SCHEMA_VERSIONS.join(', ')}`);
  }
  if (record.mode !== DRIVE_MODE) {
    fail(`unsupported mode: ${record.mode ?? 'not provided'}; this viewer accepts only ${DRIVE_MODE}`);
  }
  requireBoolean(record.valid_full_game, 'valid_full_game');
  if (record.valid_full_game) fail('drive_statistical_demo cannot claim valid_full_game=true');
  requireString(record.simulation_id, 'simulation_id');
  requireInteger(record.seed, 'seed', 0, Number.MAX_SAFE_INTEGER);
  requireString(record.model_version, 'model_version');
  requireString(record.rules_version, 'rules_version');
  validateStartState(record.start_state);
  requireObject(record.provenance, 'provenance');
  requireString(record.provenance.outcomes, 'provenance.outcomes');
  if (record.provenance.sources_as_of_verified !== false) fail('provenance.sources_as_of_verified must be false');
  requireObject(record.outcome_pool, 'outcome_pool');
  requireObject(record.outcome_pool.temporal_eligibility, 'outcome_pool.temporal_eligibility');
  if (record.outcome_pool.temporal_eligibility.status !== 'retrospective') {
    fail('outcome_pool.temporal_eligibility.status must be retrospective');
  }
  if (!Array.isArray(record.gaps) || record.gaps.some((gap) => typeof gap !== 'string')) {
    fail('gaps must be an array of strings');
  }
  if (!Array.isArray(record.plays) || record.plays.length === 0) fail('plays must be a nonempty array');

  const ids = new Set();
  record.plays.forEach((play, index) => {
    const label = `plays[${index}]`;
    requireObject(play, label);
    if (play.sequence !== index + 1) fail(`${label}.sequence must be ${index + 1}; plays must be consecutive from 1`);
    if (ids.has(play.id)) fail(`duplicate play id: ${play.id}`);
    ids.add(play.id);
    if (play.id !== `${record.simulation_id}:${play.sequence}`) {
      fail(`${label}.id must be ${record.simulation_id}:${play.sequence}`);
    }
    requireString(play.event_type, `${label}.event_type`);
    if (!DRIVE_EVENT_TYPES.includes(play.event_type)) fail(`${label}.event_type is unsupported: ${play.event_type}`);
    validateState(play.state_before, `${label}.state_before`);
    validateState(play.state_after, `${label}.state_after`);
    requireObject(play.decision, `${label}.decision`);
    validateOutcome(play.outcome, play.event_type, `${label}.outcome`);
    validateField(play.field, play, `${label}.field`);
    const terminal = terminalOf(play);
    if (terminal !== null && index !== record.plays.length - 1) fail(`${label}: only the last play may end the drive`);
    if (play.outcome.quarter_change && terminal !== null) fail(`${label}: a quarter change cannot end the drive`);
    if (play.outcome.quarter_change) {
      if (![1, 3].includes(play.state_before.quarter)) fail(`${label}: quarter changes occur only after Q1 and Q3`);
      if (play.state_after.quarter !== play.state_before.quarter + 1 || play.state_after.clock_seconds !== QUARTER_LENGTH) {
        fail(`${label}: quarter change must move one quarter forward and reset the clock to ${QUARTER_LENGTH}`);
      }
    } else if (play.state_after.quarter !== play.state_before.quarter) {
      fail(`${label}: quarter changed without a quarter_change flag`);
    } else if (play.state_after.clock_seconds > play.state_before.clock_seconds) {
      fail(`${label}: clock increased within a quarter`);
    }
    if (play.state_after.clock_seconds < 0) fail(`${label}: negative clock`);
    checkTerminal(play, terminal, label);
    const changed = play.state_before.offense_team !== play.state_after.offense_team;
    if (changed !== (play.outcome.turnover || play.outcome.punt)) {
      fail(`${label}: possession change does not match the turnover or punt flag`);
    }
    if (play.outcome.touchdown !== (terminal === 'touchdown')) fail(`${label}: touchdown flag and terminal disagree`);
    if (play.outcome.field_goal_attempt !== (terminal === 'field_goal_attempt')) {
      fail(`${label}: field-goal flag and terminal disagree`);
    }
    if (index > 0) {
      const prior = record.plays[index - 1].state_after;
      if (prior.end_of_drive !== undefined) fail(`${label}: a play follows a drive terminal`);
      for (const key of ['quarter', 'offense_team', 'defense_team', 'down', 'yards_to_go', 'yardline_100', 'clock_seconds']) {
        if (play.state_before[key] !== prior[key]) fail(`${label}.state_before.${key} does not match the prior state_after`);
      }
    }
  });
  record.plays.forEach((play, index) => {
    const label = `plays[${index}]`;
    const { state_before: before, state_after: after, field } = play;
    if (index === 0) {
      const start = record.start_state;
      if (before.quarter !== start.quarter || before.clock_seconds !== start.clock
        || before.offense_team !== start.offense || before.defense_team !== start.defense
        || before.yardline_100 !== start.yl || before.down !== start.down || before.yards_to_go !== start.togo) {
        fail(`${label}.state_before does not match start_state`);
      }
    }
    checkEndpoint(field.before, before.yardline_100, `${label}.field.before`);
    if (field.before.dir !== expectedDirection(record.start_state, before.offense_team, before.quarter)) {
      fail(`${label}.field.before.dir is inconsistent with the authored start and quarter changes`);
    }
    if (after.yardline_100 === null) {
      // No scrimmage state: the field endpoint must be null. A half or regulation end keeps its final play position in
      // outcome.final_play_yardline_100, which is not a scrimmage state (LP schema 1.1).
      if (field.after.dir !== null || field.after.los !== null) {
        fail(`${label}.field.after must be null when the state has no position`);
      }
    } else {
      checkEndpoint(field.after, after.yardline_100, `${label}.field.after`);
      if (field.after.dir !== expectedDirection(record.start_state, after.offense_team, after.quarter)) {
        fail(`${label}.field.after.dir is inconsistent with the authored start and quarter changes`);
      }
    }
  });

  const plays = record.plays;
  const terminal = terminalOf(plays[plays.length - 1]);
  if (terminal === null) fail('the last play must end the drive');
  const recomputed = recomputeSummary(plays, terminal);
  requireObject(record.drive, 'drive');
  for (const key of SUMMARY_KEYS) {
    if (record.drive[key] !== recomputed[key]) fail(`drive.${key} does not match the recomputed value ${recomputed[key]}`);
  }
  if ('clock_clamped_plays' in record.drive && record.drive.clock_clamped_plays !== recomputed.clock_clamped_plays) {
    fail(`drive.clock_clamped_plays does not match the recomputed value ${recomputed.clock_clamped_plays}`);
  }

  // Work on a detached, frozen copy so display code cannot mutate LP's payload.
  const source = structuredClone(record);
  return freezeDeep({
    status: 'accepted_for_read_only_display',
    mode: source.mode,
    schemaVersion: source.schema_version,
    validFullGame: source.valid_full_game,
    displayLabel: DRIVE_DISPLAY_LABEL,
    simulationId: source.simulation_id,
    seed: source.seed,
    modelVersion: source.model_version,
    rulesVersion: source.rules_version,
    startState: source.start_state,
    provenance: source.provenance,
    temporalEligibility: source.outcome_pool.temporal_eligibility,
    poolDigest: source.outcome_pool.pool_sha256 ?? null,
    drive: { recorded: source.drive, recomputed, terminal, terminalText: DRIVE_TERMINAL_TEXT[terminal] },
    gaps: source.gaps,
    plays: source.plays.map((play) => {
      const terminalHere = terminalOf(play);
      return {
        id: play.id,
        sequence: play.sequence,
        eventType: play.event_type,
        quarterChange: play.outcome.quarter_change,
        terminal: terminalHere,
        terminalText: terminalHere === null ? null : DRIVE_TERMINAL_TEXT[terminalHere],
        stateBefore: play.state_before,
        stateAfter: play.state_after,
        decision: play.decision,
        outcome: play.outcome,
        field: play.field,
        nullPaths: collectNullPaths({ state_before: play.state_before, state_after: play.state_after,
          outcome: play.outcome, field: play.field }),
      };
    }),
    replay: { status: 'not_attempted', reason: 'E1 drive viewer shows the LP record as a table and timeline. No 3D players or kickoff choreography are generated.' },
  });
}
