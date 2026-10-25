// Adapter from an executed play to the Stage One result contract.
//
// The adapter only reads what the simulation produced: the recorded frames,
// the event log and the terminal football situation. It never consults a
// historical record and never adjusts a spot toward an intended gain.
import { FIELD_W_YD } from '../constants.js';
import { RESULT_SCHEMA } from './schema.js';

const TURNOVER_EVENTS = new Set(['interception', 'fumble']);

/** Map an executed play onto gridiron.autonomous-result.v1. */
export function toResultRecord(call, run) {
  const completed = !!run.resolved && !!run.terminal;
  const reason = run.terminal?.reason ?? null;
  const spot = run.terminal?.spot ?? null;
  const possessionTeam = run.possession_team === 'D' ? call.defense.team : call.offense.team;
  const turnover = TURNOVER_EVENTS.has(reason) || (run.possession_team === 'D' && call.offense.family === 'pass');
  const result = completed ? {
    event: reason,
    possession_team: possessionTeam,
    carrier_id: run.carrier_id ?? null,
    yards_gained: round(run.terminal.yards_gained),
    is_touchdown: reason === 'touchdown',
    turnover,
    final_ball_spot: { x_yards: round(spot.x), y_yards: round(spot.y) },
    elapsed_seconds: round(run.terminal.time),
  } : null;

  const tacklers = [];
  if (reason === 'tackle' || reason === 'sack') {
    const id = run.tackle_id;
    if (id) tacklers.push(id);
  }
  for (const extra of run.events) {
    if (extra.type === 'assist' && extra.defender_id && !tacklers.includes(extra.defender_id)) tacklers.push(extra.defender_id);
  }

  return {
    schema_version: RESULT_SCHEMA,
    mode: 'autonomous_from_snap',
    play_id: call.play_id,
    seed: call.seed,
    status: completed ? 'complete' : 'failed',
    failure: completed ? null : (run.failure ?? { reason: 'unresolved' }),
    call: {
      offense: call.offense.team,
      defense: call.defense.team,
      family: call.offense.family,
      concept: call.offense.concept,
      direction: call.offense.direction,
      snap_type: call.offense.snap_type,
      front: call.defense.front,
      coverage: call.defense.coverage,
    },
    situation: call.situation,
    result,
    participants: {
      tacklers,
      blockers: (run.blockers ?? []).map((b) => b.player_id),
      carrier_id: run.carrier_id ?? null,
      sackers: reason === 'sack' && run.sack_id ? [run.sack_id] : [],
      interceptor: run.interception_id ?? null,
    },
    events: run.events,
    trajectory: {
      roster: run.roster,
      frames: run.frames,
      stride: run.stride,
      t0: run.t0,
      hz: run.hz,
    },
    diagnostics: {
      agent_decisions: run.events.filter((e) => e.type === 'decision').map((e) => ({
        t: e.t, player_id: e.player_id, role: e.role, assignment: e.assignment, decision: e.decision,
      })),
      physical_warnings: physicalWarnings(run),
      ball_spots: ballSpots(run),
      result_provenance: 'generated_from_agent_actions_and_physics',
      outcome_inputs: [],
      valid_full_game: false,
    },
  };
}

/** Anything that would make the recorded play physically implausible. */
function physicalWarnings(run) {
  const warnings = [];
  for (const player of run.roster) {
    const path = run.trajectories?.[player.id];
    if (!path?.length) { warnings.push({ player_id: player.id, kind: 'missing_trajectory' }); continue; }
    for (let i = 0; i < path.length; i++) {
      const row = path[i];
      for (const key of ['x', 'y', 'speed']) {
        if (!Number.isFinite(row[key])) warnings.push({ player_id: player.id, kind: 'non_finite', field: key, index: i });
      }
      if (i > 0) {
        const jump = Math.hypot(row.x - path[i - 1].x, row.y - path[i - 1].y);
        if (jump > 1.2) warnings.push({ player_id: player.id, kind: 'discontinuity', yards: round(jump), t: round(row.t) });
      }
    }
  }
  for (const frame of run.frames) {
    for (let i = 0; i < frame.length; i++) {
      if (!Number.isFinite(frame[i])) { warnings.push({ kind: 'non_finite_frame', index: i }); break; }
    }
  }
  return warnings;
}

function ballSpots(run) {
  return run.events
    .filter((e) => e.type === 'whistle' || e.type === 'touchdown' || e.type === 'catch' || e.type === 'interception')
    .map((e) => ({ t: round(e.t), type: e.type, spot: e.ball_spot ?? e.spot ?? e.at ?? null }));
}

/** Reconcile a result record against its own frames and events. */
export function reconcileResult(record) {
  const problems = [];
  const { result, events, trajectory } = record;
  if (record.status !== 'complete') return { ok: events.at(-1)?.type === 'simulation_failure', problems };
  if (!result) problems.push('complete record without a result');
  const whistles = events.filter((e) => e.type === 'whistle');
  if (whistles.length !== 1) problems.push(`expected one whistle, found ${whistles.length}`);
  if (events.at(-1)?.type !== 'whistle') problems.push('event log does not end at the whistle');
  if (result && whistles[0] && whistles[0].reason !== result.event) problems.push('whistle reason disagrees with the result event');
  if (result && (result.final_ball_spot.y_yards < 0 || result.final_ball_spot.y_yards > FIELD_W_YD)) {
    problems.push('final spot is outside the field of play');
  }
  const frames = trajectory.frames.length;
  if (frames === 0) problems.push('no recorded frames');
  const last = trajectory.roster.map((p) => ({ id: p.id }));
  if (last.length !== 22) problems.push(`expected 22 recorded players, found ${last.length}`);
  for (const frame of trajectory.frames) {
    if (frame.length !== trajectory.stride) { problems.push(`frame stride ${frame.length} != ${trajectory.stride}`); break; }
  }
  if (result) {
    const lastT = (frames - 1) / trajectory.hz + trajectory.t0;
    if (Math.abs(lastT - result.elapsed_seconds) > 0.5) problems.push('play duration disagrees with the recorded frames');
  }
  const tackles = events.filter((e) => e.type === 'tackle');
  if (result?.event === 'tackle' && tackles.length === 0) problems.push('tackle result without a tackle event');
  if (result?.event === 'tackle' && tackles.length && !(result.carrier_id && tackles[0].on === result.carrier_id)) {
    problems.push('tackle event carrier disagrees with the result carrier');
  }
  // Never more than one holder in any frame.
  for (const frame of trajectory.frames) {
    let holders = 0;
    for (let i = 0; i < trajectory.roster.length; i++) if (frame[i * 6 + 5] === 1) holders++;
    if (holders > 1) { problems.push('more than one player holds the ball in a frame'); break; }
  }
  return { ok: problems.length === 0, problems };
}

function round(x) {
  return x == null ? null : Math.round(x * 1000) / 1000;
}
