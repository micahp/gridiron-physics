// Independent football-state checks for LP E2 records. This module deliberately
// does not read or import LP's rules_matrix: each check uses only record fields.
const SIDES = ['A', 'B'];
const QUARTER_SECONDS = 900;

function opposite(team) {
  return team === 'A' ? 'B' : team === 'B' ? 'A' : null;
}

function statePath(driveOffset, playOffset, stateName) {
  return `record.drives[${driveOffset}].plays[${playOffset}].${stateName}`;
}

function stateOf(play, key) {
  return play?.[key] && typeof play[key] === 'object' ? play[key] : {};
}

function numberIn(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function result(findings) {
  const counts = {};
  for (const finding of findings) counts[finding.code] = (counts[finding.code] ?? 0) + 1;
  return { passed: findings.length === 0, finding_count: findings.length, counts, findings };
}

/** Audit football sequencing and state without trusting producer-authored rules results. */
export function auditFootballState(input) {
  const record = input?.record ?? input;
  const findings = [];
  const add = (code, path, message, details = {}) => findings.push({ code, path, message, ...details });
  if (!record || typeof record !== 'object' || !Array.isArray(record.drives)) {
    add('record_missing', 'record.drives', 'Record must contain a drive array.');
    return result(findings);
  }

  const allPlays = [];
  const pointsByTeam = { A: 0, B: 0 };
  const previousDriveEnds = [];
  const driveIndices = new Set();

  for (const [driveOffset, drive] of record.drives.entries()) {
    const index = driveOffset + 1;
    const drivePath = `record.drives[${driveOffset}]`;
    if (!drive || typeof drive !== 'object') {
      add('drive_malformed', drivePath, 'Drive must be an object.');
      continue;
    }
    if (drive.index !== index) {
      add('drive_order_invalid', `${drivePath}.index`, 'Drive indexes must be contiguous, one-based, and chronological.',
        { observed: drive.index, expected: index });
    }
    driveIndices.add(drive.index);
    if (!SIDES.includes(drive.offense_team)) {
      add('drive_offense_invalid', `${drivePath}.offense_team`, 'Drive offense must name side A or B.',
        { observed: drive.offense_team });
    }
    if (!Array.isArray(drive.plays) || drive.plays.length === 0) {
      add('drive_empty', `${drivePath}.plays`, 'Every emitted drive must carry its plays.');
      continue;
    }

    const indexMismatches = [];
    for (const [playOffset, play] of drive.plays.entries()) {
      const before = stateOf(play, 'state_before');
      const after = stateOf(play, 'state_after');
      if (before.drive_index !== drive.index || after.drive_index !== drive.index) {
        indexMismatches.push({
          play_id: play?.id ?? null,
          sequence: play?.sequence ?? null,
          state_before: before.drive_index ?? null,
          state_after: after.drive_index ?? null,
        });
      }
      allPlays.push({ drive, driveOffset, play, playOffset, before, after });
    }
    if (indexMismatches.length) {
      add('drive_index_mismatch', `${drivePath}.plays[*].state_before/after.drive_index`,
        `Embedded play states disagree with game-level drive ${drive.index}.`, {
          expected: drive.index,
          mismatch_count: indexMismatches.length,
          plays: indexMismatches,
        });
    }

    const first = drive.plays[0];
    const last = drive.plays.at(-1);
    if (first?.state_before?.quarter !== drive.quarter_start
        || first?.state_before?.clock_seconds !== drive.clock_start) {
      add('drive_start_metadata_mismatch', `${drivePath}.quarter_start/clock_start`,
        'Drive start metadata must equal its first play pre-state.');
    }
    if (last?.state_after?.quarter !== drive.end_quarter || last?.state_after?.clock_seconds !== drive.end_clock) {
      add('drive_end_metadata_mismatch', `${drivePath}.end_quarter/end_clock`,
        'Drive end metadata must equal its final play post-state.');
    }

    const scoring = drive.points_scored_on_drive;
    if (scoring != null) {
      if (!SIDES.includes(scoring.team) || !numberIn(scoring.points, 1, 8)) {
        add('score_ledger_invalid', `${drivePath}.points_scored_on_drive`,
          'Drive scoring must identify A/B and award an integer from one to eight.', { observed: scoring });
      } else {
        pointsByTeam[scoring.team] += scoring.points;
      }
    }
    previousDriveEnds.push({ drive, driveOffset, last });
  }

  // Validate each football state and the transition within every play.
  const flattenedStates = [];
  for (const item of allPlays) {
    const { drive, driveOffset, play, playOffset, before, after } = item;
    const label = `drive ${drive.index}, play ${play.sequence ?? playOffset + 1}`;
    const bPath = statePath(driveOffset, playOffset, 'state_before');
    const aPath = statePath(driveOffset, playOffset, 'state_after');
    const outcome = play?.outcome && typeof play.outcome === 'object' ? play.outcome : {};
    flattenedStates.push({ state: before, path: bPath, phase: 'before', play, drive });
    flattenedStates.push({ state: after, path: aPath, phase: 'after', play, drive });

    for (const [phase, state, path] of [['before', before, bPath], ['after', after, aPath]]) {
      const terminalAfter = phase === 'after' && (outcome.touchdown || outcome.safety || outcome.punt
        || outcome.turnover || outcome.field_goal_attempt || outcome.clock_only_terminal);
      if (!SIDES.includes(state.offense_team) || !SIDES.includes(state.defense_team)
          || state.offense_team === state.defense_team) {
        add('possession_state_invalid', `${path}.offense_team/defense_team`,
          `${label}: offense and defense must be distinct A/B sides.`,
          { observed: { offense_team: state.offense_team ?? null, defense_team: state.defense_team ?? null } });
      }
      if (phase === 'before' && state.offense_team !== drive.offense_team) {
        add('drive_possession_invalid', `${path}.offense_team`,
          `${label}: pre-play possession differs from the drive offense.`,
          { observed: state.offense_team, expected: drive.offense_team });
      }
      if (!numberIn(state.quarter, 1, 4) || !numberIn(state.clock_seconds, 0, QUARTER_SECONDS)) {
        add('clock_state_invalid', `${path}.quarter/clock_seconds`,
          `${label}: quarter and clock must be within regulation ranges.`,
          { observed: { quarter: state.quarter ?? null, clock_seconds: state.clock_seconds ?? null } });
      }
      if (state.yardline_100 != null && !numberIn(state.yardline_100, 0, 100)) {
        add('field_position_invalid', `${path}.yardline_100`,
          `${label}: offense-relative field position must be from 0 to 100.`, { observed: state.yardline_100 });
      }
      if (state.down == null ? !(phase === 'after' && terminalAfter) : !numberIn(state.down, 1, 4)) {
        add('down_state_invalid', `${path}.down`,
          `${label}: down must be 1–4 except when the play ends a possession/period.`,
          { observed: state.down ?? null });
      }
      if (state.yards_to_go == null ? !(phase === 'after' && terminalAfter)
        : !numberIn(state.yards_to_go, 1, 100)) {
        add('distance_state_invalid', `${path}.yards_to_go`,
          `${label}: yards to go must be 1–100 except after a terminal play.`,
          { observed: state.yards_to_go ?? null });
      }
      for (const scoreField of ['home_score', 'away_score']) {
        if (!Number.isInteger(state[scoreField]) || state[scoreField] < 0) {
          add('score_state_missing', `${path}.${scoreField}`,
            `${label}: score snapshot is absent or invalid; monotonic score auditing is unavailable.`,
            { observed: state[scoreField] ?? null });
        }
      }
      for (const timeoutField of ['home_timeouts', 'away_timeouts']) {
        if (!Number.isInteger(state[timeoutField])) {
          add('timeout_state_missing', `${path}.${timeoutField}`,
            `${label}: timeout count is absent; timeout legality cannot be audited.`,
            { observed: state[timeoutField] ?? null });
        } else if (!numberIn(state[timeoutField], 0, 3)) {
          add('timeout_state_invalid', `${path}.${timeoutField}`,
            `${label}: each team has zero to three timeouts in a half.`,
            { observed: state[timeoutField] });
        }
      }
    }

    if (outcome.turnover || outcome.punt) {
      const expectedPossession = opposite(before.offense_team);
      if (after.offense_team !== expectedPossession) {
        add('possession_transition_invalid', `${aPath}.offense_team`,
          `${label}: turnover or punt must transfer possession to the other side.`,
          { observed: after.offense_team, expected: expectedPossession });
      }
    } else if (!outcome.touchdown && !outcome.safety && !outcome.field_goal_attempt
        && !outcome.clock_only_terminal && after.offense_team !== before.offense_team) {
      add('possession_transition_invalid', `${aPath}.offense_team`,
        `${label}: possession changed without a terminal turnover or punt.`,
        { observed: after.offense_team, expected: before.offense_team });
    }

    const samePossessionNonterminal = after.offense_team === before.offense_team
      && !outcome.touchdown && !outcome.safety && !outcome.punt && !outcome.turnover
      && !outcome.field_goal_attempt && !outcome.clock_only_terminal;
    if (samePossessionNonterminal && Number.isInteger(before.yardline_100)
        && Number.isInteger(after.yardline_100) && Number.isInteger(outcome.yards_gained)) {
      const expectedSpot = Math.max(0, before.yardline_100 - outcome.yards_gained);
      if (after.yardline_100 !== expectedSpot) {
        add('field_position_transition_invalid', `${aPath}.yardline_100`,
          `${label}: post-play spot does not match offense-relative gain.`,
          { observed: after.yardline_100, expected: expectedSpot, yards_gained: outcome.yards_gained });
      }
    }
    if (samePossessionNonterminal && numberIn(before.down, 1, 4)
        && numberIn(before.yards_to_go, 1, 100) && Number.isInteger(outcome.yards_gained)
        && Number.isInteger(after.down)) {
      const expectedDown = outcome.yards_gained >= before.yards_to_go ? 1 : before.down + 1;
      if (after.down !== expectedDown) {
        add('down_progression_invalid', `${aPath}.down`,
          `${label}: down does not reflect a first down or the next scrimmage down.`,
          { observed: after.down, expected: expectedDown, before_down: before.down,
            yards_to_go: before.yards_to_go, yards_gained: outcome.yards_gained });
      }
      if (after.yards_to_go != null && outcome.yards_gained >= before.yards_to_go
          && Number.isInteger(after.yardline_100)) {
        const expectedDistance = Math.max(1, Math.min(10, after.yardline_100));
        if (after.yards_to_go !== expectedDistance) {
          add('distance_progression_invalid', `${aPath}.yards_to_go`,
            `${label}: a new series must set distance from the new line of scrimmage.`,
            { observed: after.yards_to_go, expected: expectedDistance });
        }
      }
    }

    const quarterDelta = after.quarter - before.quarter;
    if (!Number.isInteger(quarterDelta) || quarterDelta < 0 || quarterDelta > 1
        || (quarterDelta === 1 && (![1, 3].includes(before.quarter)
          || after.clock_seconds !== QUARTER_SECONDS || outcome.quarter_change !== true))
        || (quarterDelta === 0 && outcome.quarter_change === true)) {
      add('quarter_transition_invalid', `${aPath}.quarter/clock_seconds`,
        `${label}: period changes must be a Q1/Q3 end with a 15:00 reset and explicit boundary flag.`,
        { before_quarter: before.quarter ?? null, after_quarter: after.quarter ?? null,
          after_clock_seconds: after.clock_seconds ?? null, quarter_change: outcome.quarter_change ?? null });
    }
    if (quarterDelta === 0 && Number.isInteger(before.clock_seconds) && Number.isInteger(after.clock_seconds)
        && after.clock_seconds > before.clock_seconds) {
      add('clock_increased_within_quarter', `${aPath}.clock_seconds`,
        `${label}: game clock cannot increase within a quarter.`,
        { observed: after.clock_seconds, previous: before.clock_seconds });
    }
    const fieldBefore = play.field?.before;
    const fieldAfter = play.field?.after;
    const stadiumLos = (state, field) => field?.dir === -1
      ? state.yardline_100
      : field?.dir === 1 ? 100 - state.yardline_100 : null;
    if (fieldBefore && before.yardline_100 != null
        && (fieldBefore.los !== stadiumLos(before, fieldBefore) || ![-1, 1].includes(fieldBefore.dir))) {
      add('field_assignment_mismatch', `${statePath(driveOffset, playOffset, 'field')}.before`,
        `${label}: authored field assignment must map offense-relative position to stadium coordinates.`,
        { observed: fieldBefore, state_yardline_100: before.yardline_100 });
    }
    if (fieldAfter && after.yardline_100 != null
        && (fieldAfter.los !== stadiumLos(after, fieldAfter) || ![-1, 1].includes(fieldAfter.dir))) {
      add('field_assignment_mismatch', `${statePath(driveOffset, playOffset, 'field')}.after`,
        `${label}: authored field assignment must map offense-relative position to stadium coordinates.`,
        { observed: fieldAfter, state_yardline_100: after.yardline_100 });
    }
  }

  // Monotonic score and timeout transitions across adjacent state snapshots.
  for (let i = 1; i < flattenedStates.length; i += 1) {
    const prior = flattenedStates[i - 1];
    const current = flattenedStates[i];
    for (const field of ['home_score', 'away_score']) {
      if (Number.isInteger(prior.state[field]) && Number.isInteger(current.state[field])
          && current.state[field] < prior.state[field]) {
        add('score_decreased', `${current.path}.${field}`,
          'A team score cannot decrease over a game-state transition.',
          { observed: current.state[field], previous: prior.state[field] });
      }
    }
    for (const field of ['home_timeouts', 'away_timeouts']) {
      const crossedHalf = prior.state.quarter === 2 && current.state.quarter === 3;
      if (!crossedHalf && Number.isInteger(prior.state[field]) && Number.isInteger(current.state[field])
          && current.state[field] > prior.state[field]) {
        add('timeout_count_increased', `${current.path}.${field}`,
          'Timeouts may reset at halftime, but cannot increase within one half.',
          { observed: current.state[field], previous: prior.state[field] });
      }
    }
  }

  // Reconcile the per-play home/away snapshots to the independent A/B drive
  // score ledger. Pick the side mapping only when the final score identifies it.
  const finalState = allPlays.at(-1)?.after;
  const scoreMappings = [
    { A: 'home_score', B: 'away_score' },
    { A: 'away_score', B: 'home_score' },
  ].filter((mapping) => Number.isInteger(finalState?.[mapping.A]) && Number.isInteger(finalState?.[mapping.B])
    && finalState[mapping.A] === record.points?.A && finalState[mapping.B] === record.points?.B);
  if (scoreMappings.length === 0 && Number.isInteger(finalState?.home_score) && Number.isInteger(finalState?.away_score)) {
    add('final_score_mapping_invalid', 'record.drives[last].plays[last].state_after',
      'Final home/away score does not match either A/B mapping in the record points ledger.',
      { home_score: finalState.home_score, away_score: finalState.away_score,
        points_A: record.points?.A ?? null, points_B: record.points?.B ?? null });
  } else if (scoreMappings.length > 0) {
    const scoreMismatchCount = (mapping) => {
      const cumulative = { A: 0, B: 0 };
      let mismatchCount = 0;
      for (const item of allPlays) {
        const before = item.before;
        if (Number.isInteger(before.home_score) && Number.isInteger(before.away_score)) {
          const expectedHome = cumulative[mapping.A === 'home_score' ? 'A' : 'B'];
          const expectedAway = cumulative[mapping.A === 'away_score' ? 'A' : 'B'];
          if (before.home_score !== expectedHome || before.away_score !== expectedAway) mismatchCount += 1;
        }
        if (item.playOffset === item.drive.plays.length - 1 && item.drive.points_scored_on_drive
            && SIDES.includes(item.drive.points_scored_on_drive.team)
            && numberIn(item.drive.points_scored_on_drive.points, 1, 8)) {
          cumulative[item.drive.points_scored_on_drive.team] += item.drive.points_scored_on_drive.points;
        }
        const after = item.after;
        if (Number.isInteger(after.home_score) && Number.isInteger(after.away_score)) {
          const expectedHome = cumulative[mapping.A === 'home_score' ? 'A' : 'B'];
          const expectedAway = cumulative[mapping.A === 'away_score' ? 'A' : 'B'];
          if (after.home_score !== expectedHome || after.away_score !== expectedAway) mismatchCount += 1;
        }
      }
      return mismatchCount;
    };
    const mapping = [...scoreMappings].sort((a, b) => scoreMismatchCount(a) - scoreMismatchCount(b))[0];
    const cumulative = { A: 0, B: 0 };
    for (const item of allPlays) {
      const beforePath = statePath(item.driveOffset, item.playOffset, 'state_before');
      const afterPath = statePath(item.driveOffset, item.playOffset, 'state_after');
      if (Number.isInteger(item.before.home_score) && Number.isInteger(item.before.away_score)) {
        const expectedHome = cumulative[mapping.A === 'home_score' ? 'A' : 'B'];
        const expectedAway = cumulative[mapping.A === 'away_score' ? 'A' : 'B'];
        if (item.before.home_score !== expectedHome || item.before.away_score !== expectedAway) {
          add('score_state_ledger_mismatch', `${beforePath}.home_score/away_score`,
            `Play ${item.play.sequence}: score snapshot disagrees with accumulated drive scoring before the play.`,
            { observed: { home_score: item.before.home_score, away_score: item.before.away_score },
              expected: { home_score: expectedHome, away_score: expectedAway } });
        }
      }
      if (item.playOffset === item.drive.plays.length - 1 && item.drive.points_scored_on_drive
          && SIDES.includes(item.drive.points_scored_on_drive.team)
          && numberIn(item.drive.points_scored_on_drive.points, 1, 8)) {
        cumulative[item.drive.points_scored_on_drive.team] += item.drive.points_scored_on_drive.points;
      }
      if (Number.isInteger(item.after.home_score) && Number.isInteger(item.after.away_score)) {
        const expectedHome = cumulative[mapping.A === 'home_score' ? 'A' : 'B'];
        const expectedAway = cumulative[mapping.A === 'away_score' ? 'A' : 'B'];
        if (item.after.home_score !== expectedHome || item.after.away_score !== expectedAway) {
          add('score_state_ledger_mismatch', `${afterPath}.home_score/away_score`,
            `Play ${item.play.sequence}: score snapshot disagrees with accumulated drive scoring after the play.`,
            { observed: { home_score: item.after.home_score, away_score: item.after.away_score },
              expected: { home_score: expectedHome, away_score: expectedAway } });
        }
      }
    }
  }

  // Independently reconcile drive possession changes, restart ledger, and half boundaries.
  const kickoffs = Array.isArray(record.kickoffs) ? record.kickoffs : [];
  const boundaries = Array.isArray(record.boundaries) ? record.boundaries : [];
  const halftimeBoundaries = boundaries.filter((boundary) => boundary?.kind === 'halftime');
  const kickByDrive = new Map();
  for (const [kickOffset, kick] of kickoffs.entries()) {
    const path = `record.kickoffs[${kickOffset}]`;
    if (!kick || typeof kick !== 'object') {
      add('kick_restart_invalid', path, 'Kick restart must be an object.');
      continue;
    }
    if (!SIDES.includes(kick.kicking_team) || !SIDES.includes(kick.receiving_team)
        || kick.kicking_team === kick.receiving_team) {
      add('kick_restart_invalid', `${path}.kicking_team/receiving_team`,
        'Kick restart must name distinct kicking and receiving teams.',
        { kicking_team: kick.kicking_team ?? null, receiving_team: kick.receiving_team ?? null });
    }
    if (!numberIn(kick.after_drive, 0, record.drives.length) || !numberIn(kick.quarter, 1, 4)) {
      add('kick_restart_invalid', path, 'Kick restart must link to a valid drive boundary and quarter.',
        { after_drive: kick.after_drive ?? null, quarter: kick.quarter ?? null });
      continue;
    }
    if (!kickByDrive.has(kick.after_drive)) kickByDrive.set(kick.after_drive, []);
    kickByDrive.get(kick.after_drive).push(kick);
    const nextDrive = record.drives[kick.after_drive];
    const q3HalfStart = kickoffs.find((nextKick) => nextKick.kind === 'half_start' && nextKick.quarter === 3
      && nextKick.after_drive === kick.after_drive);
    const halftimeHandoff = kick.quarter === 2 && kick.clock_expired_during_kickoff === true
      && halftimeBoundaries.some((boundary) => boundary.drive_index === kick.after_drive) && q3HalfStart;
    if (kick.kind === 'safety_free_kick') {
      add('safety_kick_outcome_unverified', `${path}.source`,
        'A safety free kick requires a separately observed safety-kick outcome table; the E2 record has no such evidence.');
    }
    if (nextDrive && !halftimeHandoff && nextDrive.offense_team !== kick.receiving_team) {
      add('kick_restart_possession_mismatch', `${path}.receiving_team`,
        'The next drive offense must be the recorded kick receiver.',
        { observed: kick.receiving_team, expected: nextDrive.offense_team, after_drive: kick.after_drive });
    }
    if (!numberIn(kick.clock_before, 0, QUARTER_SECONDS) || !numberIn(kick.runoff_seconds, 0, QUARTER_SECONDS)) {
      add('kick_restart_clock_invalid', `${path}.clock_before/runoff_seconds`,
        'Kick restart clock and runoff must be non-negative regulation seconds.',
        { clock_before: kick.clock_before ?? null, runoff_seconds: kick.runoff_seconds ?? null });
    } else if (nextDrive) {
      const expired = kick.runoff_seconds >= kick.clock_before;
      const expectedQuarter = expired && [1, 3].includes(kick.quarter) ? kick.quarter + 1 : kick.quarter;
      const expectedClock = expired ? QUARTER_SECONDS : kick.clock_before - kick.runoff_seconds;
      if (expired !== (kick.clock_expired_during_kickoff === true)) {
        add('kick_restart_expiry_invalid', `${path}.clock_expired_during_kickoff`,
          'Kickoff expiry marker must agree with the observed runoff and clock.',
          { observed: kick.clock_expired_during_kickoff ?? null, expected: expired });
      }
      if (!halftimeHandoff && nextDrive.quarter_start !== expectedQuarter) {
        add('kick_restart_quarter_mismatch', `${path}.quarter`,
          'The next drive quarter must reflect a quarter-ending kickoff return.',
          { observed: nextDrive.quarter_start, expected: expectedQuarter });
      }
      if (!halftimeHandoff && nextDrive.clock_start !== expectedClock) {
        add('kick_restart_clock_mismatch', `${path}.clock_before/runoff_seconds`,
          'The next drive clock must reflect the recorded runoff and quarter reset.',
          { observed: nextDrive.clock_start, expected: expectedClock, after_drive: kick.after_drive });
      }
    }
  }

  const ledger = record.ledger;
  if (ledger && SIDES.includes(ledger.winner) && SIDES.includes(ledger.loser)
      && ['receive', 'defer'].includes(ledger.winner_choice)) {
    const firstReceiver = ledger.winner_choice === 'receive' ? ledger.winner : ledger.loser;
    const secondReceiver = ledger.winner_choice === 'receive' ? ledger.loser : ledger.winner;
    for (const [quarter, receiver, afterDrive] of [[1, firstReceiver, 0]]) {
      const found = kickoffs.filter((kick) => kick.kind === 'half_start' && kick.quarter === quarter);
      if (found.length !== 1 || found[0]?.receiving_team !== receiver || found[0]?.after_drive !== afterDrive) {
        add('half_start_kickoff_invalid', `record.kickoffs[quarter=${quarter}]`,
          'Opening kickoff must match the coin-toss choice and open drive one.',
          { count: found.length, expected_receiver: receiver, expected_after_drive: afterDrive });
      }
    }
    const q3Kick = kickoffs.filter((kick) => kick.kind === 'half_start' && kick.quarter === 3);
    const reachedSecondHalf = q3Kick.length > 0 || halftimeBoundaries.length > 0
      || record.drives.some((drive) => drive.quarter_start >= 3 || drive.end_quarter >= 3)
      || record.final_quarter >= 3 || record.regulation_end_reached === true;
    if (reachedSecondHalf) {
      const halfEnd = halftimeBoundaries.length === 1 ? halftimeBoundaries[0] : null;
      const driveIndex = halfEnd?.drive_index;
      const precedingDrive = Number.isInteger(driveIndex) && driveIndex > 0 ? record.drives[driveIndex - 1] : null;
      const q2ExpiredKick = kickoffs.some((kick) => kick.after_drive === driveIndex && kick.quarter === 2
        && kick.clock_expired_during_kickoff === true);
      const skippedScoreKick = boundaries.some((boundary) => boundary.kind === 'skipped_post_score_kick'
        && boundary.drive_index === driveIndex);
      const boundarySupported = precedingDrive?.end_quarter === 2
        && (precedingDrive.end_clock === 0 || q2ExpiredKick || skippedScoreKick);
      if (!halfEnd || halfEnd.from_quarter !== 2 || halfEnd.to_quarter !== 3 || halfEnd.clock_before !== 0
          || !Number.isInteger(driveIndex) || driveIndex < 1 || driveIndex > record.drives.length
          || !boundarySupported || q3Kick.length !== 1 || q3Kick[0]?.receiving_team !== secondReceiver
          || q3Kick[0]?.kicking_team !== opposite(secondReceiver) || q3Kick[0]?.after_drive !== driveIndex) {
        add('halftime_restart_invalid', 'record.boundaries/record.kickoffs[quarter=3]',
          'Halftime boundary and Q3 half-start must link to the completed Q2 state and toss-ledger receiver.',
          { halftime_boundary_count: halftimeBoundaries.length, halftime_drive: driveIndex ?? null,
            q3_kick_count: q3Kick.length, observed_receiver: q3Kick[0]?.receiving_team ?? null,
            expected_receiver: secondReceiver });
      }
    } else if (halftimeBoundaries.length || q3Kick.length) {
      add('halftime_restart_invalid', 'record.boundaries/record.kickoffs[quarter=3]',
        'A Q3 restart requires a corresponding Q2-to-Q3 halftime boundary.');
    }
    if (q3Kick.length === 1 && Number.isInteger(q3Kick[0].after_drive)) {
      const nextDrive = record.drives[q3Kick[0].after_drive];
      if (nextDrive && nextDrive.offense_team !== q3Kick[0].receiving_team) {
        add('halftime_restart_possession_invalid', `record.drives[${q3Kick[0].after_drive}].offense_team`,
          'The first drive after halftime must belong to the Q3 half-start receiver.',
          { observed: nextDrive.offense_team, expected: q3Kick[0].receiving_team });
      }
    }
  }

  for (const { drive, driveOffset, last } of previousDriveEnds) {
    const next = record.drives[driveOffset + 1];
    if (!next) continue;
    const terminal = drive.terminal;
    const restart = kickByDrive.get(drive.index) ?? [];
    if (['punt', 'turnover', 'turnover_on_downs'].includes(terminal)) {
      const expected = opposite(drive.offense_team);
      if (next.offense_team !== expected) {
        add('drive_possession_transition_invalid', `record.drives[${driveOffset + 1}].offense_team`,
          `Drive ${drive.index} ended by ${terminal}; next drive must belong to the other side.`,
          { observed: next.offense_team, expected });
      }
    } else if (terminal === 'field_goal_attempt' && drive.points_scored_on_drive == null
        && next.offense_team !== opposite(drive.offense_team)) {
      add('drive_possession_transition_invalid', `record.drives[${driveOffset + 1}].offense_team`,
        `Drive ${drive.index} missed its field goal; the opponent must receive possession.`,
        { observed: next.offense_team, expected: opposite(drive.offense_team) });
    } else if (drive.points_scored_on_drive && ['touchdown', 'field_goal_attempt', 'safety'].includes(terminal)) {
      const scoringTeam = drive.points_scored_on_drive.team;
      const safety = terminal === 'safety';
      const expectedKicker = safety ? drive.offense_team : scoringTeam;
      const expectedReceiver = safety ? scoringTeam : opposite(scoringTeam);
      const expectedKind = terminal === 'field_goal_attempt' ? 'post_field_goal'
        : safety ? 'safety_free_kick' : 'post_score';
      const matching = restart.filter((kick) => kick.kind === expectedKind);
      const skippedAtHalftime = boundaries.some((boundary) => boundary.kind === 'skipped_post_score_kick'
        && boundary.drive_index === drive.index);
      const invalidScoringRestart = matching.length > 1 || (!skippedAtHalftime && matching.length !== 1)
        || (matching.length === 1 && (matching[0].kicking_team !== expectedKicker
          || matching[0].receiving_team !== expectedReceiver));
      if (invalidScoringRestart) {
        add('scoring_kick_restart_invalid', `record.kickoffs[after_drive=${drive.index}]`,
          `Drive ${drive.index} scoring event lacks its correctly linked restart.`,
          { terminal, matching_count: matching.length, expected_kind: expectedKind,
            expected_kicker: expectedKicker, expected_receiver: expectedReceiver });
      }
      const restartSupersededAtHalftime = matching.length === 1 && matching[0].quarter === 2
        && matching[0].clock_expired_during_kickoff === true
        && halftimeBoundaries.some((boundary) => boundary.drive_index === drive.index)
        && kickoffs.some((kick) => kick.kind === 'half_start' && kick.quarter === 3
          && kick.after_drive === drive.index);
      if (!skippedAtHalftime && !restartSupersededAtHalftime && next.offense_team !== expectedReceiver) {
        add('scoring_restart_possession_invalid', `record.drives[${driveOffset + 1}].offense_team`,
          `Drive ${drive.index} next possession disagrees with its scoring restart.`,
          { observed: next.offense_team, expected: expectedReceiver });
      }
    }
  }

  for (const team of SIDES) {
    if (Number.isInteger(record.points?.[team]) && pointsByTeam[team] !== record.points[team]) {
      add('score_ledger_mismatch', `record.points.${team}`,
        'Final points must equal the sum of that team’s non-negative drive scoring.',
        { observed: record.points[team], expected: pointsByTeam[team] });
    }
  }

  const driveQuarters = record.drives;
  for (let i = 1; i < driveQuarters.length; i += 1) {
    const prior = driveQuarters[i - 1];
    const current = driveQuarters[i];
    const priorEnd = prior.plays?.at(-1)?.state_after;
    const qDelta = current.quarter_start - priorEnd?.quarter;
    if (!numberIn(current.quarter_start, 1, 4) || qDelta < 0 || qDelta > 1) {
      add('drive_quarter_order_invalid', `record.drives[${i}].quarter_start`,
        'Drive quarters must remain ordered and cannot skip a period.',
        { previous_quarter: priorEnd?.quarter ?? null, observed: current.quarter_start });
    }
    const quarterKick = (kickByDrive.get(prior.index) ?? []).find((kick) => kick.quarter === current.quarter_start);
    const expectedQuarterClock = quarterKick && Number.isInteger(quarterKick.clock_before)
      && Number.isInteger(quarterKick.runoff_seconds)
      ? Math.max(0, quarterKick.clock_before - quarterKick.runoff_seconds)
      : QUARTER_SECONDS;
    if (qDelta === 1 && current.clock_start !== expectedQuarterClock) {
      add('quarter_start_clock_invalid', `record.drives[${i}].clock_start`,
        'A new quarter starts at 15:00, then any linked kickoff runoff is applied.',
        { observed: current.clock_start, expected: expectedQuarterClock });
    }
  }

  const finalDrive = record.drives.at(-1);
  const finalPlay = finalDrive?.plays?.at(-1);
  if (record.complete_regulation === true) {
    if (record.status !== 'complete_regulation' || record.final_quarter !== 4
        || record.final_clock_seconds !== 0 || finalDrive?.terminal !== 'end_of_regulation'
        || finalPlay?.state_after?.quarter !== 4 || finalPlay?.state_after?.clock_seconds !== 0
        || finalPlay?.outcome?.clock_only_terminal !== true) {
      add('termination_invalid', 'record.status/final_quarter/final_clock_seconds',
        'A complete regulation record must terminate once at Q4 0:00 on an end-of-regulation event.',
        { status: record.status ?? null, final_quarter: record.final_quarter ?? null,
          final_clock_seconds: record.final_clock_seconds ?? null, terminal: finalDrive?.terminal ?? null });
    }
  } else if (record.status === 'complete_regulation') {
    add('termination_invalid', 'record.complete_regulation',
      'Complete-regulation status cannot be set when the completion flag is false.');
  }
  if (record.valid_full_game === true && Array.isArray(record.unsupported_rules)
      && record.unsupported_rules.length > 0) {
    add('full_game_validity_overclaim', 'record.valid_full_game',
      'A record with declared unsupported rules cannot claim valid_full_game=true.',
      { unsupported_rules: record.unsupported_rules });
  }

  return result(findings);
}

/** Returns the grouped hard-reject findings used by the read-only E2 adapter. */
export function auditDriveIndex(record) {
  return auditFootballState(record).findings.filter((finding) => finding.code === 'drive_index_mismatch');
}
