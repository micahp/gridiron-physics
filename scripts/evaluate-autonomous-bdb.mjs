#!/usr/bin/env node
// Snap-only 22-player execution benchmark against the staged BDB 2022 cohort.
// The PFF/run fields select an evaluation subset only; the simulator receives
// a separately constructed object containing snap-time positions and history.
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { YD } from '../engine/constants.js';
import { simulateInsideZone } from '../engine/autonomous-run.js';
import { scoreAutonomousTracking } from '../engine/tracking-eval.js';

const [observationsPath, playsPath, outputPath] = process.argv.slice(2);
if (!observationsPath || !playsPath) {
  console.error('usage: node scripts/evaluate-autonomous-bdb.mjs <snap-all-player-observations-v2.jsonl.gz> <plays.csv> [output.json]');
  process.exit(2);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field.length === 0) quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') {
      row.push(field.replace(/\r$/, '')); field = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const [header, ...body] = rows;
  if (!header) throw new Error('plays.csv is empty');
  return body.map((values) => Object.fromEntries(header.map((key, i) => [key, values[i] ?? ''])));
}

function isDL(position) { return ['DE', 'DT', 'NT', 'DL', 'EDGE', 'LE', 'RE'].includes(position); }
function isLB(position) { return ['LB', 'ILB', 'OLB', 'MLB'].includes(position); }
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
function keyOf(gameId, playId) { return `${gameId}:${playId}`; }
function localL(player, dir, ballY) { return dir * (player.inputPositionsM.at(-1)[1] / YD - ballY); }
function positionAtSnap(player) {
  const [x, y] = player.inputPositionsM.at(-1);
  return { x: x / YD - 10, y: y / YD };
}
function velocityBeforeSnap(player, frameIds, snapFrame) {
  const times = frameIds.map((frame) => (frame - snapFrame) / 10);
  const meanT = times.reduce((sum, t) => sum + t, 0) / times.length;
  const denom = times.reduce((sum, t) => sum + (t - meanT) ** 2, 0);
  const result = {};
  for (const [axis, coord] of [['x', 0], ['y', 1]]) {
    const meanP = player.inputPositionsM.reduce((sum, p) => sum + p[coord], 0) / times.length;
    const slopeMps = times.reduce((sum, t, i) => sum + (t - meanT) * (player.inputPositionsM[i][coord] - meanP), 0) / denom;
    result[axis] = slopeMps / YD;
  }
  return result;
}

function offenseRoles(players, dir, ballY) {
  const byPos = (position) => players.filter((p) => p.position === position);
  const centers = byPos('C'), qbs = byPos('QB'), backs = byPos('RB');
  const guards = players.filter((p) => ['G', 'OG'].includes(p.position));
  const tackles = players.filter((p) => ['T', 'OT'].includes(p.position));
  const tightEnds = byPos('TE'), receivers = byPos('WR');
  if (centers.length !== 1 || qbs.length !== 1 || backs.length !== 1 || guards.length !== 2
      || tackles.length !== 2 || tightEnds.length !== 1 || receivers.length !== 3) return null;
  const byL = (a, b) => localL(b, dir, ballY) - localL(a, dir, ballY);
  const leftGuard = [...guards].sort(byL)[0], rightGuard = [...guards].sort(byL)[1];
  const leftTackle = [...tackles].sort(byL)[0], rightTackle = [...tackles].sort(byL)[1];
  const wide = [...receivers].sort(byL);
  return new Map([
    ['O.QB', qbs[0]], ['O.RB', backs[0]], ['O.LT', leftTackle], ['O.LG', leftGuard],
    ['O.C', centers[0]], ['O.RG', rightGuard], ['O.RT', rightTackle], ['O.TE', tightEnds[0]],
    ['O.WR1', wide[0]], ['O.WR2', wide[2]], ['O.WR3', wide[1]],
  ]);
}

function mapDefense(players, dir, ballY, los) {
  const line = players.filter((p) => isDL(p.position));
  const backers = players.filter((p) => isLB(p.position));
  const secondary = players.filter((p) => !isDL(p.position) && !isLB(p.position));
  const front = new Map([
    ['3:4:4', 'odd'], ['4:3:4', 'even'], ['4:2:5', 'nickel'], ['5:2:4', 'bear'],
  ]).get(`${line.length}:${backers.length}:${secondary.length}`);
  if (!front) return null;
  const byLeftToRight = (a, b) => localL(b, dir, ballY) - localL(a, dir, ballY);
  const dlRoles = front === 'odd' ? ['D.LDE', 'D.NT', 'D.RDE']
    : front === 'bear' ? ['D.LDE', 'D.LDT', 'D.NT', 'D.RDT', 'D.RDE']
      : ['D.LDE', 'D.LDT', 'D.RDT', 'D.RDE'];
  const lbRoles = front === 'odd' ? ['D.LOLB', 'D.WILL', 'D.MIKE', 'D.ROLB']
    : front === 'bear' || front === 'nickel' ? ['D.WILL', 'D.MIKE']
      : ['D.WILL', 'D.MIKE', 'D.SAM'];
  const mapped = new Map();
  [...line].sort(byLeftToRight).forEach((p, i) => mapped.set(dlRoles[i], p));
  [...backers].sort((a, b) => localL(a, dir, ballY) - localL(b, dir, ballY))
    .forEach((p, i) => mapped.set(lbRoles[i], p));

  const leftCorner = [...secondary].sort(byLeftToRight)[0];
  const rightCorner = [...secondary].sort(byLeftToRight).at(-1);
  mapped.set('D.LCB', leftCorner);
  mapped.set('D.RCB', rightCorner);
  const safeties = secondary.filter((p) => p !== leftCorner && p !== rightCorner)
    .sort((a, b) => dir * (positionAtSnap(a).x - los) - dir * (positionAtSnap(b).x - los));
  if (front === 'nickel') {
    mapped.set('D.NB', safeties[0]);
    mapped.set('D.SS', safeties[1]);
    mapped.set('D.FS', safeties[2]);
  } else {
    mapped.set('D.SS', safeties[0]);
    mapped.set('D.FS', safeties[1]);
  }
  return { front, mapped };
}

function snapOnlyScenario(record) {
  if (!['left', 'right'].includes(record.playDirection)) return { skip: 'missing_play_direction' };
  if (!Array.isArray(record.inputFrameIds) || record.inputFrameIds.length !== 6
      || record.inputFrameIds.at(-1) !== record.snapFrame) return { skip: 'invalid_snap_history' };
  if (!Array.isArray(record.players) || record.players.length !== 22) return { skip: 'not_22_players' };
  if (!Array.isArray(record.footballLabelsM?.[0]) || record.footballLabelsM[0].length !== 2) return { skip: 'missing_snap_ball_position' };
  const dir = record.playDirection === 'right' ? 1 : -1;
  const ballY = record.footballLabelsM[0][1] / YD;
  const ballX = record.footballLabelsM[0][0] / YD - 10;
  if (!Number.isFinite(ballX) || !Number.isFinite(ballY)) return { skip: 'invalid_snap_ball_position' };
  const offense = record.players.filter((p) => p.team === record.offenseTeam);
  const defense = record.players.filter((p) => p.team === record.defenseTeam);
  if (offense.length !== 11 || defense.length !== 11) return { skip: 'uneven_teams' };
  if (record.players.some((p) => !p.nflId || !Number.isFinite(p.weightKg)
      || !Array.isArray(p.inputPositionsM) || p.inputPositionsM.length !== 6
      || p.inputPositionsM.some((point) => !Array.isArray(point) || point.length !== 2 || point.some((v) => !Number.isFinite(v))))) {
    return { skip: 'invalid_player_snap_profile' };
  }
  const offMap = offenseRoles(offense, dir, ballY);
  if (!offMap || offMap.size !== 11) return { skip: 'unsupported_offensive_personnel' };
  const defenseMap = mapDefense(defense, dir, ballY, ballX);
  if (!defenseMap || defenseMap.mapped.size !== 11) return { skip: 'unsupported_defensive_front' };
  const roleMap = new Map([...offMap, ...defenseMap.mapped]);
  if (roleMap.size !== 22) return { skip: 'role_assignment_not_22_unique' };

  const center = roleMap.get('O.C');
  const teSide = localL(roleMap.get('O.TE'), dir, ballY);
  const runSide = teSide >= 0 ? 'left' : 'right';
  const playerIds = {}, initialPositions = {}, preSnapVelocity = {}, massOverrides = {};
  for (const [role, player] of roleMap) {
    playerIds[role] = player.nflId;
    initialPositions[role] = positionAtSnap(player);
    preSnapVelocity[role] = velocityBeforeSnap(player, record.inputFrameIds, record.snapFrame);
    massOverrides[role] = player.weightKg;
  }
  return {
    scenario: {
      seed: `${record.gameId}:${record.playId}`,
      front: defenseMap.front, runSide, dir, los: ballX, ballY,
      playerIds, initialPositions, preSnapVelocity, massOverrides,
    },
    audit: { front: defenseMap.front, runSide_source: 'pre-snap tight-end alignment', players: 22 },
  };
}

function evaluationRows(record) {
  const rows = [];
  for (const player of record.players) {
    for (let i = 1; i < record.labelFrameIds.length; i++) {
      const point = player.labelPositionsM?.[i];
      if (!Array.isArray(point) || point.length !== 2 || point.some((v) => !Number.isFinite(v))) continue;
      rows.push({
        player_id: player.nflId,
        t: (record.labelFrameIds[i] - record.snapFrame) / 10,
        x: point[0] / YD - 10,
        y: point[1] / YD,
      });
    }
  }
  return rows;
}

function addSummary(target, source) {
  if (!source?.players_scored || !Number.isFinite(source.mean_xy_error_meters)) return;
  target.samples += source.players_scored;
  target.errorSum += source.mean_xy_error_meters * source.players_scored;
  for (const [key, value] of Object.entries({ ...source.by_team, ...source.by_role })) {
    if (!target.groups.has(key)) target.groups.set(key, { samples: 0, errorSum: 0 });
    const g = target.groups.get(key);
    g.samples += value.samples;
    g.errorSum += value.mean_error_meters * value.samples;
  }
}

function summarize(target) {
  return {
    player_samples: target.samples,
    mean_xy_error_meters: target.samples ? target.errorSum / target.samples : null,
    by_team_and_role: Object.fromEntries([...target.groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, {
      player_samples: value.samples,
      mean_xy_error_meters: value.samples ? value.errorSum / value.samples : null,
    }])),
  };
}

const playsText = await readFile(playsPath, 'utf8');
const playRows = parseCsv(playsText);
const playById = new Map(playRows.map((p) => [keyOf(p.gameId, p.playId), p]));
const playHash = createHash('sha256').update(playsText).digest('hex');
const observationHash = createHash('sha256');
for await (const chunk of createReadStream(observationsPath)) observationHash.update(chunk);
const observationSha = observationHash.digest('hex');

const counters = { cohort_records: 0, pff_inside_zone: 0, designed_inside_zone_run: 0, simple_inside_zone: 0, simulated: 0, skipped: {} };
const horizonTotals = { '0.5s': { samples: 0, errorSum: 0, groups: new Map() }, '1.0s': { samples: 0, errorSum: 0, groups: new Map() } };
const perPlay = [];
const input = createInterface({ input: createReadStream(observationsPath).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of input) {
  if (!line) continue;
  const record = JSON.parse(line);
  if (record.week < 1 || record.week > 5) continue;
  counters.cohort_records++;
  const play = playById.get(keyOf(record.gameId, record.playId));
  if (!play || play.pff_runConceptPrimary !== 'INSIDE ZONE') continue;
  counters.pff_inside_zone++;
  // These retrospective chart fields select the benchmark population only.
  // They are never copied into the scenario or passed to a player controller.
  if (play.passResult || play.isDropback !== 'FALSE') continue;
  counters.designed_inside_zone_run++;
  if (play.pff_runConceptSecondary !== 'NA') continue;
  counters.simple_inside_zone++;

  const built = snapOnlyScenario(record);
  if (built.skip) {
    counters.skipped[built.skip] = (counters.skipped[built.skip] || 0) + 1;
    continue;
  }
  const simulation = simulateInsideZone(built.scenario);
  counters.simulated++;
  // Future coordinates are accessed only after the complete forward rollout.
  const scored = scoreAutonomousTracking(simulation, evaluationRows(record));
  for (const horizon of ['0.5s', '1.0s']) addSummary(horizonTotals[horizon], scored.horizons[horizon]);
  perPlay.push({
    week: record.week,
    game_id: record.gameId,
    play_id: record.playId,
    front: built.audit.front,
    run_side_source: built.audit.runSide_source,
    scored_players_0_5s: scored.horizons['0.5s'].players_scored,
    mean_xy_error_meters_0_5s: scored.horizons['0.5s'].mean_xy_error_meters,
    scored_players_1_0s: scored.horizons['1.0s'].players_scored,
    mean_xy_error_meters_1_0s: scored.horizons['1.0s'].mean_xy_error_meters,
  });
}

const output = {
  schema_version: 'gridiron.autonomous-inside-zone-bdb-evaluation.v1',
  evaluation_only: true,
  source: {
    dataset: 'NFL Big Data Bowl 2025 tracking mirror; 2022 season',
    tracking_observation_sha256: observationSha,
    plays_csv_sha256: playHash,
    source_commit: 'e28d3b25725799ef2213680016db5325f6f90014',
    weeks: [1, 2, 3, 4, 5],
  },
  selection: {
    evaluator_only_filter: "2022 weeks 1-5; pff_runConceptPrimary=INSIDE ZONE; passResult empty; isDropback=FALSE; pff_runConceptSecondary=NA; supported 11-player offensive personnel and supported defensive front",
    historical_chart_fields_are_not_simulation_inputs: true,
    excluded_from_decisions: ['PFF run concept fields', 'pass result', 'rush location', 'tracking observations at t>0', 'credited tacklers', 'realized yards and terminal result'],
  },
  input_contract: {
    simulator_inputs: ['play direction at snap', '22 player IDs and positions', 'reported player mass', 'last six pre-snap/snap positions', 'pre-snap velocity fit', 'snap ball position'],
    run_side_proxy: 'tight-end side inferred from snap alignment; not read from the retrospective run-location label',
    trajectory_targets_read_after_simulation: true,
    coordinate_transform: 'BDB meters to yards; subtract 10 yards from raw x to map the 100-yard goal-to-goal field; preserve y across the 53.33-yard width',
    target_frames: 'BDB 10 Hz labels at +0.5s and +1.0s; observed future coordinates are evaluation-only',
  },
  coverage: counters,
  horizon_coverage: Object.fromEntries(Object.entries(horizonTotals).map(([horizon, total]) => [horizon, {
    available_player_targets: counters.simulated * 22,
    scored_player_samples: total.samples,
    unscored_after_simulated_terminal: counters.simulated * 22 - total.samples,
  }])),
  metrics: Object.fromEntries(Object.entries(horizonTotals).map(([horizon, total]) => [horizon, summarize(total)])),
  per_play: perPlay,
};
const json = JSON.stringify(output, null, 2) + '\n';
if (outputPath) await writeFile(outputPath, json);
else process.stdout.write(json);
