#!/usr/bin/env node
// Physics-authority replay of BDB 2022 weeks 1-5 run plays. Each of the 22 players starts at his tracked snap position
// with his pre-snap velocity, then the engine's brains run with no outcome input. The engine never receives the play's
// yards, end spot or tackler: the run concept is a fixed pre-snap prior and the run side comes from the tight end's
// alignment. Tracked positions after the snap are read only by the scorer, after the simulation has finished.
//
//   node scripts/bdb-physics-replay.mjs <observations.jsonl.gz> <plays.csv> <league.json> <out.json> [--runs 8] [--trace gameId:playId]
import fs from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { YD } from '../engine/constants.js';
import { simulatePlay } from '../engine/play.js';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const [observationsPath, playsPath, leaguePath, outputPath] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!observationsPath || !playsPath || !leaguePath || !outputPath) {
  console.error('usage: node scripts/bdb-physics-replay.mjs <observations.jsonl.gz> <plays.csv> <league.json> <out.json> [--runs 8] [--trace gameId:playId]');
  process.exit(2);
}
const RUNS = Number(flag('--runs', 8));
const TRACE = flag('--trace');
const RUN_GAIN_PRIOR_YD = 3; // pre-snap run concept target; not the play's result
const WEEKS = [1, 2, 3, 4, 5]; // weeks 6-9 stay reserved as the holdout

const LEAGUE_GROUP = {
  QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE', C: 'OL', G: 'OL', OG: 'OL', T: 'OL', OT: 'OL',
  DE: 'DL', DT: 'DL', NT: 'DL', DL: 'DL', EDGE: 'DL', LB: 'LB', ILB: 'LB', OLB: 'LB', MLB: 'LB',
  CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', DB: 'DB',
};
const SLOT_GROUP = {
  C: 'OL', LG: 'OL', RG: 'OL', LT: 'OL', RT: 'OL', TE: 'skill', QB: 'skill', RB: 'skill', WR1: 'skill', WR2: 'skill', WR3: 'skill',
  LEDGE: 'DL', LDT: 'DL', RDT: 'DL', REDGE: 'DL', WLB: 'LB', MLB: 'LB', LCB: 'DB', RCB: 'DB', NB: 'DB', SS: 'DB', FS: 'DB',
};
const PHYSICS_KEYS = ['alat', 'drive', 'f0', 'radius', 'reach', 'tau', 'vmax'];

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));

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
  return body.map((values) => Object.fromEntries(header.map((key, i) => [key, values[i] ?? ''])));
}

// Position groups and ratings priors come from the 2026 league file. BDB 2022 players have no ratings of their own,
// so every player gets the median of his position group (labeled in the output as a prior).
function groupPriors(league) {
  const groups = new Map();
  for (const team of Object.values(league.teams)) {
    for (const p of team.roster) {
      if (!groups.has(p.position)) groups.set(p.position, []);
      groups.get(p.position).push(p);
    }
  }
  return Object.fromEntries([...groups].filter(([g]) => ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'].includes(g)).map(([g, players]) => {
    const keys = new Set(players.flatMap((p) => Object.keys(p.ratings)));
    const ratings = Object.fromEntries([...keys].map((k) => [k, median(players.map((p) => p.ratings[k]).filter(Number.isFinite))]));
    const physics = Object.fromEntries(PHYSICS_KEYS.map((k) => [k, median(players.map((p) => p.physics[k]).filter(Number.isFinite))]));
    return [g, { ratings, physics, players: players.length }];
  }));
}

const lastPos = (p) => p.inputPositionsM.at(-1);
const fieldX = (m) => m / YD - 10; // BDB metres to engine yards on the 0-100 field
const fieldY = (m) => m / YD;
const localL = (p, dir, ballY) => dir * (fieldY(lastPos(p)[1]) - ballY);
const depth = (p, dir, los) => dir * (fieldX(lastPos(p)[0]) - los);

// Pre-snap velocity: least-squares slope over the six pre-snap frames, in yards per second.
function velocityBeforeSnap(player, frameIds, snapFrame) {
  const times = frameIds.map((frame) => (frame - snapFrame) / 10);
  const meanT = mean(times);
  const denom = times.reduce((sum, t) => sum + (t - meanT) ** 2, 0);
  const out = {};
  for (const [axis, coord] of [['x', 0], ['y', 1]]) {
    const meanP = mean(player.inputPositionsM.map((pt) => pt[coord]));
    const slope = times.reduce((sum, t, i) => sum + (t - meanT) * (player.inputPositionsM[i][coord] - meanP), 0) / denom;
    out[axis] = slope / YD;
  }
  return out;
}

// Offense: the eleven BDB players sorted into the engine's slots (1 C, 1 QB, 1 RB, 2 G, 2 T, 1 TE, 3 WR).
function mapOffense(players, dir, ballY) {
  const of = (...positions) => players.filter((p) => positions.includes(p.position));
  const counts = [of('C'), of('QB'), of('RB', 'FB'), of('G', 'OG'), of('T', 'OT'), of('TE'), of('WR')];
  if (counts.map((list) => list.length).join() !== '1,1,1,2,2,1,3') return null;
  const [[c], [qb], [rb], guards, tackles, [te], receivers] = counts;
  const byLeft = (a, b) => localL(b, dir, ballY) - localL(a, dir, ballY);
  const runSign = localL(te, dir, ballY) >= 0 ? 1 : -1;
  const wr3 = [...receivers].sort((a, b) => runSign * (localL(b, dir, ballY) - localL(a, dir, ballY)))[0];
  const interior = receivers.filter((p) => p !== wr3).sort(byLeft);
  const g = [...guards].sort(byLeft), t = [...tackles].sort(byLeft);
  return new Map([['QB', qb], ['RB', rb], ['LT', t[0]], ['LG', g[0]], ['C', c], ['RG', g[1]], ['RT', t[1]],
    ['TE', te], ['WR1', interior[0]], ['WR2', interior[1]], ['WR3', wr3]]);
}

// Defense: the 4-2-5 base the engine aligns. Other fronts are reported as unsupported, not forced into slots.
function mapDefense(players, dir, ballY, los) {
  const dl = players.filter((p) => LEAGUE_GROUP[p.position] === 'DL');
  const lb = players.filter((p) => LEAGUE_GROUP[p.position] === 'LB');
  const db = players.filter((p) => LEAGUE_GROUP[p.position] === 'DB');
  if (dl.length !== 4 || lb.length !== 2 || db.length !== 5) return null;
  const byLeft = (a, b) => localL(b, dir, ballY) - localL(a, dir, ballY);
  const map = new Map();
  [...dl].sort(byLeft).forEach((p, i) => map.set(['LEDGE', 'LDT', 'RDT', 'REDGE'][i], p));
  [...lb].sort((a, b) => localL(a, dir, ballY) - localL(b, dir, ballY)).forEach((p, i) => map.set(['WLB', 'MLB'][i], p));
  const corners = [...db].sort(byLeft);
  map.set('LCB', corners[0]);
  map.set('RCB', corners.at(-1));
  const safeties = corners.slice(1, -1).sort((a, b) => depth(a, dir, los) - depth(b, dir, los));
  map.set('NB', safeties[0]);
  const deep = safeties.slice(1).sort((a, b) => localL(a, dir, ballY) - localL(b, dir, ballY));
  map.set('SS', deep[0]);
  map.set('FS', deep[1]);
  return map;
}

function playerInfo(p, team, priors) {
  const prior = priors[LEAGUE_GROUP[p.position]];
  return {
    id: p.nflId, team, position: p.position, jersey: null,
    ratings: { ...prior.ratings },
    physics: { ...prior.physics, mass: Number(p.weightKg) },
  };
}

// Returns the engine inputs for one BDB run play, or the reason it cannot be replayed.
function buildRun(record, priors) {
  if (!['left', 'right'].includes(record.playDirection)) return { skip: 'missing_play_direction' };
  if (!Array.isArray(record.players) || record.players.length !== 22) return { skip: 'not_22_players' };
  const dir = record.playDirection === 'right' ? 1 : -1;
  const ballX = fieldX(record.footballLabelsM[0][0]);
  const ballY = fieldY(record.footballLabelsM[0][1]);
  const offense = record.players.filter((p) => p.team === record.offenseTeam);
  const defense = record.players.filter((p) => p.team === record.defenseTeam);
  if (offense.length !== 11 || defense.length !== 11) return { skip: 'uneven_teams' };
  const offMap = mapOffense(offense, dir, ballY);
  if (!offMap) return { skip: 'unsupported_offensive_personnel' };
  const defMap = mapDefense(defense, dir, ballY, ballX);
  if (!defMap) return { skip: 'unsupported_defensive_personnel' };
  const unknown = record.players.find((p) => !LEAGUE_GROUP[p.position] || !priors[LEAGUE_GROUP[p.position]]);
  if (unknown) return { skip: `unmapped_position_${unknown.position}` };

  const offLineup = Object.fromEntries([...offMap].map(([slot, p]) => [slot, p.nflId]));
  const defLineup = Object.fromEntries([...defMap].map(([slot, p]) => [slot, p.nflId]));
  const te = offMap.get('TE');
  const P = {};
  for (const p of offense) P[p.nflId] = playerInfo(p, record.offenseTeam, priors);
  for (const p of defense) P[p.nflId] = playerInfo(p, record.defenseTeam, priors);
  const snapState = {};
  for (const p of record.players) {
    const [x, y] = lastPos(p);
    const v = velocityBeforeSnap(p, record.inputFrameIds, record.snapFrame);
    snapState[p.nflId] = { x: fieldX(x), y: fieldY(y), vx: v.x, vy: v.y };
  }
  const S = {
    id: `${record.gameId}:${record.playId}`, off: record.offenseTeam, def: record.defenseTeam, dir, los: ballX,
    lineup: { [record.offenseTeam]: offLineup, [record.defenseTeam]: defLineup },
    text: record.metadata?.offenseFormation ?? '', shotgun: /SHOTGUN|PISTOL|EMPTY/.test(record.metadata?.offenseFormation ?? ''),
    kind: 'run', kindGroup: 'run', carrier: offLineup.RB, gain: RUN_GAIN_PRIOR_YD, gap: 'guard',
    loc: localL(te, dir, ballY) >= 0 ? 'left' : 'right',
  };
  return { S, ctx: { authority: 'physics', ballY, snapState }, P, dir, ballX, offLineup, defLineup, offMap, defMap };
}

// Engine frames are 30 Hz, t=0 at the snap. Linear interpolation between recorded frames.
function simAt(out, index, t) {
  const f = (t - out.t0) * out.hz;
  if (f < 0 || f > out.frames.length - 1) return null;
  const i = Math.floor(f), j = Math.min(out.frames.length - 1, i + 1), u = f - i;
  const a = out.frames[i], b = out.frames[j];
  return { x: a[index * 6] + (b[index * 6] - a[index * 6]) * u, y: a[index * 6 + 1] + (b[index * 6 + 1] - a[index * 6 + 1]) * u };
}

function scorePlay(record, built, out) {
  const index = new Map(out.roster.map((p, i) => [p.id, i]));
  const slotOf = new Map([...built.offMap, ...built.defMap].map(([slot, p]) => [p.nflId, slot]));
  const rows = [];
  let snapErrorM = 0;
  for (const p of record.players) {
    const k = index.get(p.nflId);
    if (k === undefined) throw new Error(`engine roster is missing ${p.nflId}`);
    const start = { x: fieldX(lastPos(p)[0]), y: fieldY(lastPos(p)[1]) };
    const v = velocityBeforeSnap(p, record.inputFrameIds, record.snapFrame);
    const at0 = simAt(out, k, 0);
    const obs0 = p.labelPositionsM[0];
    snapErrorM = Math.max(snapErrorM, Math.hypot(at0.x - fieldX(obs0[0]), at0.y - fieldY(obs0[1])) * YD);
    for (let j = 1; j < record.labelFrameIds.length; j++) {
      const t = (record.labelFrameIds[j] - record.snapFrame) / 10;
      const sim = simAt(out, k, t);
      const obs = { x: fieldX(p.labelPositionsM[j][0]), y: fieldY(p.labelPositionsM[j][1]) };
      const cv = { x: start.x + v.x * t, y: start.y + v.y * t };
      rows.push({
        id: p.nflId, slot: slotOf.get(p.nflId), t,
        err_m: Math.hypot(sim.x - obs.x, sim.y - obs.y) * YD,
        cv_m: Math.hypot(cv.x - obs.x, cv.y - obs.y) * YD,
      });
    }
  }
  const at = (t) => rows.filter((r) => Math.abs(r.t - t) < 1e-6);
  const stop = out.events.find((e) => e.type === 'tackle');
  const stopT = stop ? stop.t : out.t0 + (out.frames.length - 1) / out.hz;
  const carrierIndex = index.get(built.S.carrier);
  // gain from the snap spot (the line of scrimmage), the origin PBP run yards use; the carrier starts behind the line
  const carrierStart = built.ballX;
  const carrierStop = simAt(out, carrierIndex, stopT).x;
  const carrierRows = rows.filter((r) => r.id === built.S.carrier);
  const pbp = built.pbp;
  return {
    snap_check_max_error_m: round(snapErrorM, 3),
    error_0_5s_mean_m: round(mean(at(0.5).map((r) => r.err_m))),
    cv_0_5s_mean_m: round(mean(at(0.5).map((r) => r.cv_m))),
    error_1_0s_mean_m: round(mean(at(1).map((r) => r.err_m))),
    cv_1_0s_mean_m: round(mean(at(1).map((r) => r.cv_m))),
    carrier_error_1_0s_m: round(carrierRows.find((r) => r.t === 1)?.err_m),
    carrier_cv_1_0s_m: round(carrierRows.find((r) => r.t === 1)?.cv_m),
    slot_error_1_0s_m: Object.fromEntries(['OL', 'skill', 'DL', 'LB', 'DB'].map((group) => {
      const hits = at(1).filter((r) => SLOT_GROUP[r.slot] === group);
      return [group, { sim: round(mean(hits.map((r) => r.err_m))), cv: round(mean(hits.map((r) => r.cv_m))) }];
    })),
    physics_gain_yd: round(built.dir * (carrierStop - carrierStart), 1),
    pbp_gain_yd: pbp ? Number(pbp.yardsGained) : null,
    stop: { t: round(stopT), by: stop ? 'tackle' : 'record_end' },
    engine_events: out.events.length,
  };
}

const league = JSON.parse(fs.readFileSync(leaguePath, 'utf8'));
const priors = groupPriors(league);
const playsText = fs.readFileSync(playsPath, 'utf8');
const playById = new Map(parseCsv(playsText).map((p) => [`${p.gameId}:${p.playId}`, p]));

// pass 1: every run play in the development weeks that maps onto the engine
const eligible = [];
const skipped = {};
const considered = { week_1_5_records: 0, run_plays: 0 };
const input = createInterface({ input: fs.createReadStream(observationsPath).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of input) {
  if (!line) continue;
  const record = JSON.parse(line);
  if (!WEEKS.includes(Number(record.week))) continue;
  considered.week_1_5_records++;
  const pbp = playById.get(`${record.gameId}:${record.playId}`);
  if (!pbp || pbp.passResult || pbp.isDropback !== 'FALSE') continue;
  considered.run_plays++;
  const built = buildRun(record, priors);
  if (built.skip) {
    skipped[built.skip] = (skipped[built.skip] || 0) + 1;
    continue;
  }
  eligible.push({ record, built: { ...built, pbp } });
}

// pass 2: spread the sample evenly across the eligible plays so it is not all from week 1
const picks = Array.from({ length: Math.min(RUNS, eligible.length) }, (_, i) => eligible[Math.floor(i * eligible.length / Math.min(RUNS, eligible.length))]);
const perPlay = [];
const failures = [];
const traces = [];
for (const { record, built } of picks) {
  const id = `${record.gameId}:${record.playId}`;
  let out, scored;
  try {
    out = simulatePlay({ players: built.P }, built.S, built.ctx);
    if (!out) throw new Error('physics director returned no record');
    scored = scorePlay(record, built, out);
  } catch (error) {
    failures.push({ id, message: error.message });
    continue;
  }
  perPlay.push({
    id, week: Number(record.week), offense: record.offenseTeam, defense: record.defenseTeam, dir: built.dir,
    formation: record.metadata?.offenseFormation, carrier_slot: 'RB', ...scored,
  });
  if (TRACE === id) {
    traces.push({
      id, dir: built.dir, ball_yd: { x: built.ballX, y: built.ctx.ballY },
      players: record.players.map((p) => {
        const k = out.roster.findIndex((r) => r.id === p.nflId);
        const sim = [];
        for (let t = -0.5; t <= 3.0 + 1e-9; t += 0.1) {
          const s = simAt(out, k, Math.round(t * 100) / 100);
          if (s) sim.push([round(s.x, 3), round(s.y, 3), Math.round(t * 10) / 10]);
        }
        return {
          id: p.nflId, team: p.team, position: p.position, slot: [...built.offMap, ...built.defMap].find(([, q]) => q.nflId === p.nflId)?.[0],
          observed_yd: p.labelPositionsM.map((pt) => [round(fieldX(pt[0]), 3), round(fieldY(pt[1]), 3)]),
          simulated_yd: sim,
        };
      }),
    });
  }
}

const sample = (key) => perPlay.map((r) => r[key]).filter((v) => v != null);
const summary = {
  plays_replayed: perPlay.length,
  plays_failed: failures.length,
  error_0_5s_mean_m: round(mean(sample('error_0_5s_mean_m'))),
  cv_0_5s_mean_m: round(mean(sample('cv_0_5s_mean_m'))),
  error_1_0s_mean_m: round(mean(sample('error_1_0s_mean_m'))),
  cv_1_0s_mean_m: round(mean(sample('cv_1_0s_mean_m'))),
  carrier_error_1_0s_mean_m: round(mean(sample('carrier_error_1_0s_m'))),
  carrier_cv_1_0s_mean_m: round(mean(sample('carrier_cv_1_0s_m'))),
  snap_check_max_error_m: round(Math.max(...sample('snap_check_max_error_m')), 3),
  physics_gain_yd_mean: round(mean(sample('physics_gain_yd')), 1),
  pbp_gain_yd_mean: round(mean(sample('pbp_gain_yd')), 1),
};
const output = {
  schema_version: 'gridiron.bdb-physics-replay.v1',
  authority: 'physics',
  evaluation_only: true,
  source: {
    observations: observationsPath.split('/').at(-1), plays: playsPath.split('/').at(-1), league: leaguePath.split('/').at(-1),
    weeks: WEEKS, holdout_weeks_excluded: [6, 7, 8, 9],
  },
  engine_inputs: [
    'pre-snap 22-player positions and pre-snap velocity (frames -5 to 0)',
    'pre-snap formation, personnel, play direction and ball spot',
    'position-group ratings prior from the 2026 league file; mass from BDB weight',
    `run concept prior ${RUN_GAIN_PRIOR_YD} yd; run side from tight-end alignment`,
  ],
  engine_never_receives: ['play result yards', 'end spot', 'tackler', 'post-snap positions', 'PBP run location'],
  coverage: { ...considered, eligible_runs: eligible.length, skipped },
  summary,
  failures,
  per_play: perPlay,
};
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
if (traces.length) fs.writeFileSync(outputPath.replace(/\.json$/, '') + '-trace.json', JSON.stringify(traces[0]));
console.log(JSON.stringify(summary, null, 1));
for (const r of perPlay) {
  console.log(`${r.id} ${r.offense}-${r.defense} dir=${r.dir} err0.5=${r.error_0_5s_mean_m} cv0.5=${r.cv_0_5s_mean_m} err1.0=${r.error_1_0s_mean_m} cv1.0=${r.cv_1_0s_mean_m} carrier1.0=${r.carrier_error_1_0s_m} phys=${r.physics_gain_yd} pbp=${r.pbp_gain_yd} stop=${r.stop.t}s snap=${r.snap_check_max_error_m}`);
}
if (failures.length) console.log('failures', JSON.stringify(failures));
