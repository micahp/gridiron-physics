// Source-preserving adapter for the lightweight 2D event viewer.
// A source state is a simulated football outcome, not player tracking.
const EVENT_LABELS = Object.freeze({
  run: 'Run', qb_scramble: 'QB scramble', pass_complete: 'Completed pass',
  pass_incomplete: 'Incomplete pass', interception: 'Interception',
  sack: 'Sack', fumble: 'Fumble', fumble_lost: 'Lost fumble',
  punt: 'Punt', field_goal: 'Field goal', field_goal_attempt: 'Field goal attempt',
  kickoff: 'Kickoff', safety: 'Safety', kneel: 'Kneel', spike: 'Spike',
  extra_point: 'Extra point', two_point_try: 'Two-point try',
  penalty: 'Penalty', period_end: 'End of period', game_end: 'End of game',
});

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function recordFrom(input) {
  if (!object(input)) throw new TypeError('Input must be a JSON object');
  // run_slc_game.py writes {result: record}; E2 exports use {record: record}.
  if (object(input.result) && Array.isArray(input.result.drives)) return input.result;
  if (object(input.record) && Array.isArray(input.record.drives)) return input.record;
  if (object(input.record?.record) && Array.isArray(input.record.record.drives)) return input.record.record;
  if (Array.isArray(input.drives)) return input;
  throw new TypeError('No ordered drives found. Aggregate 10K batch reports and box scores do not contain replayable plays. Export a selected single-seed full record.');
}

function numeric(value, minimum = -Infinity, maximum = Infinity) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function teamLabels(record) {
  const identity = object(record.team_identity) ? record.team_identity : {};
  const teams = object(record.teams) ? record.teams : {};
  const home = identity.A?.team ?? teams.home ?? null;
  const away = identity.B?.team ?? teams.away ?? null;
  // A/B are documented LP side identifiers, not guessed franchise identities.
  return { A: home || 'A (unidentified)', B: away || 'B (unidentified)', home, away };
}

function spot(state) {
  const yardline = numeric(state?.yardline_100, 0, 100);
  return yardline === null ? null : 100 - yardline;
}

function plainState(state) {
  if (!object(state)) return null;
  return {
    quarter: numeric(state.quarter, 1),
    clock_seconds: numeric(state.clock_seconds, 0),
    offense_team: typeof state.offense_team === 'string' ? state.offense_team : null,
    defense_team: typeof state.defense_team === 'string' ? state.defense_team : null,
    down: numeric(state.down, 1, 4),
    yards_to_go: numeric(state.yards_to_go, 0, 100),
    yardline_100: numeric(state.yardline_100, 0, 100),
    home_score: numeric(state.home_score, 0),
    away_score: numeric(state.away_score, 0),
    drive_index: numeric(state.drive_index, 1),
  };
}

function description(play) {
  const name = EVENT_LABELS[play.event_type] || ('Unsupported event: ' + String(play.event_type));
  const yards = numeric(play.outcome?.yards_gained);
  return yards === null ? name : name + (yards >= 0 ? ' +' : ' ') + yards + ' yd';
}

export function adaptSequence(input) {
  const source = recordFrom(input);
  const drives = source.drives;
  if (!drives.length) throw new TypeError('No plays available in this record');
  const labels = teamLabels(source);
  const seen = new Set();
  const plays = [];
  let lastSequence = 0;
  drives.forEach((drive, driveOffset) => {
    if (!object(drive) || !Array.isArray(drive.plays)) throw new TypeError('Invalid drive at index ' + (driveOffset + 1));
    drive.plays.forEach((play) => {
      if (!object(play)) throw new TypeError('Invalid play in drive ' + (driveOffset + 1));
      if (!Number.isInteger(play.sequence) || play.sequence <= lastSequence) {
        throw new TypeError('Play sequence missing, repeated or out of order at drive ' + (driveOffset + 1));
      }
      if (typeof play.id !== 'string' || !play.id || seen.has(play.id)) {
        throw new TypeError('Missing or duplicate canonical play id at sequence ' + play.sequence);
      }
      seen.add(play.id);
      lastSequence = play.sequence;
      const before = plainState(play.state_before);
      const after = plainState(play.state_after);
      const startX = spot(before);
      // Only depict a displacement when source coordinates share the same offense
      // and period. Turnovers, kickoffs and quarter changes have no invented path.
      const compatible = !!(before && after && before.quarter === after.quarter &&
        before.offense_team === after.offense_team && startX !== null && spot(after) !== null);
      const endX = compatible ? spot(after) : null;
      const lineToGain = before?.yards_to_go === null || startX === null
        ? null : Math.min(100, startX + before.yards_to_go);
      plays.push({
        index: plays.length, id: play.id, sequence: play.sequence,
        driveIndex: drive.index ?? driveOffset + 1, eventType: play.event_type,
        supportedLabel: Object.hasOwn(EVENT_LABELS, play.event_type),
        title: description(play), before, after, startX, endX, lineToGain,
        sourcePlay: play, // read only: never mutate source record
        schematic: true,
      });
    });
  });
  if (!plays.length) throw new TypeError('There are no play records to display');
  return {
    schema: 'gridiron.sequence-2d-view.v1',
    source, sourceEnvelope: input, plays, labels,
    gameId: source.game_id ?? null, simulationId: source.simulation_id ?? null,
    seed: source.seed ?? null, status: source.status ?? 'unknown',
    finalPoints: source.points ?? null,
    validFullGame: source.valid_full_game === true,
    mode: source.mode ?? 'unknown',
    blocker: source.blocker ?? null,
    origin: source.mode === 'pregame_full_game' ? 'Hypothetical pregame simulation' :
      'Research record (historical / unverified provenance)',
    limitation: 'SCHEMATIC BALL-STATE TRANSITIONS ONLY. No participant coordinates, routes, tracking frames, or verified play timing are present in this record.',
  };
}

export function clockLabel(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return 'clock unknown';
  const value = Math.max(0, Math.floor(seconds));
  return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
}
