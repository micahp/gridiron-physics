// Prospective quick-pass execution. All reads use current simulated positions;
// no historical result, completion label, target point or terminal spot is an input.
import { DT, FIELD_W_YD, REC_HZ, YD } from './constants.js';
import { rng } from './rng.js';
import { AERO, solveLaunch } from './ball.js';
import { createInsideZoneRoster } from './autonomous-run.js';
import { Player, POSE, World } from './world.js';

const MAX_SECONDS = 9;
const ARM_TACKLE_REACH = 0.12;
const CATCH_REACH = 1.05;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (x, y) => {
  const n = Math.hypot(x, y);
  return n > 1e-9 ? { x: x / n, y: y / n } : { x: 0, y: 0 };
};
const ALLOWED = new Set([
  'seed', 'los', 'dir', 'ballY', 'concept', 'coverage', 'down', 'toGo',
  'ratingOverrides', 'playerIds', 'initialPositions',
]);
const RATING_NAMES = new Set([
  'SPD', 'ACC', 'AGI', 'STR', 'AWR', 'RBK', 'IBL', 'PBK', 'BSH', 'PMV', 'FMV',
  'TAK', 'BTK', 'ELU', 'BCV', 'TRK', 'CAR', 'PRC', 'PUR', 'THP', 'SAC', 'MAC',
  'DAC', 'TUP', 'CTH', 'CIT', 'SPC', 'JMP', 'RTE', 'MCV', 'ZCV',
]);

function validateOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('scenario must be an object');
  for (const key of Object.keys(input)) {
    if (!ALLOWED.has(key)) throw new TypeError(`unsupported scenario input: ${key}; autonomous passing accepts no realized outcome fields`);
  }
  const cfg = {
    seed: input.seed ?? 'autonomous-pass-demo-1', los: input.los ?? 35, dir: input.dir ?? 1,
    ballY: input.ballY ?? FIELD_W_YD / 2, concept: input.concept ?? 'slant_flat_right',
    coverage: input.coverage ?? 'cover3', down: input.down ?? 1, toGo: input.toGo ?? 10,
    ratingOverrides: input.ratingOverrides ?? {}, playerIds: input.playerIds ?? {},
    initialPositions: input.initialPositions ?? {},
  };
  if (typeof cfg.seed !== 'string' && !Number.isInteger(cfg.seed)) throw new TypeError('seed must be a string or integer');
  if (!Number.isFinite(cfg.los) || cfg.los < 1 || cfg.los > 99) throw new RangeError('los must be between 1 and 99 yards');
  if (cfg.dir !== 1 && cfg.dir !== -1) throw new RangeError('dir must be 1 or -1');
  if (!Number.isFinite(cfg.ballY) || cfg.ballY < 1 || cfg.ballY > FIELD_W_YD - 1) throw new RangeError('ballY must be inside the field');
  if (!['slant_flat_left', 'slant_flat_right'].includes(cfg.concept)) throw new RangeError(`unsupported pass concept: ${cfg.concept}`);
  if (!['cover1', 'cover3'].includes(cfg.coverage)) throw new RangeError(`unsupported coverage: ${cfg.coverage}`);
  if (!Number.isInteger(cfg.down) || cfg.down < 1 || cfg.down > 4) throw new RangeError('down must be from 1 to 4');
  if (!Number.isFinite(cfg.toGo) || cfg.toGo < 1 || cfg.toGo > 99) throw new RangeError('toGo must be from 1 to 99 yards');
  for (const [label, value] of [['ratingOverrides', cfg.ratingOverrides], ['playerIds', cfg.playerIds], ['initialPositions', cfg.initialPositions]]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object keyed by role ID`);
  }
  const roleKeys = new Set(createInsideZoneRoster({ front: 'nickel' }).map((p) => p.roleKey));
  for (const label of ['ratingOverrides', 'playerIds', 'initialPositions']) {
    for (const key of Object.keys(cfg[label])) if (!roleKeys.has(key)) throw new TypeError(`${label} contains unknown role ID ${key}`);
  }
  for (const [key, patch] of Object.entries(cfg.ratingOverrides)) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError(`ratings for ${key} must be an object`);
    for (const [name, value] of Object.entries(patch)) {
      if (!RATING_NAMES.has(name)) throw new TypeError(`unsupported rating ${name} for ${key}`);
      if (!Number.isFinite(value) || value < 1 || value > 99) throw new RangeError(`${key}.${name} must be from 1 to 99`);
    }
  }
  for (const [key, id] of Object.entries(cfg.playerIds)) if (typeof id !== 'string' || !id.trim()) throw new TypeError(`playerIds.${key} must be a non-empty string`);
  if (new Set(Object.values(cfg.playerIds)).size !== Object.keys(cfg.playerIds).length) throw new TypeError('playerIds must be unique');
  for (const [key, pos] of Object.entries(cfg.initialPositions)) {
    if (!pos || typeof pos !== 'object' || Array.isArray(pos) || Object.keys(pos).some((k) => !['x', 'y'].includes(k))) throw new TypeError(`initialPositions.${key} must contain only x and y`);
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || pos.x < -10 || pos.x > 110 || pos.y < -2 || pos.y > FIELD_W_YD + 2) throw new RangeError(`initialPositions.${key} is outside the field`);
  }
  return cfg;
}

export function simulateAutonomousPass(options = {}) {
  const cfg = validateOptions(options);
  const rand = rng(cfg.seed);
  const runSide = cfg.concept.endsWith('_left') ? 1 : -1;
  const at = (forward, lateral) => ({
    x: (cfg.los + cfg.dir * forward) * YD,
    y: (cfg.ballY + cfg.dir * lateral) * YD,
  });
  const fOf = (p) => (p.p.x / YD - cfg.los) * cfg.dir;
  const lOf = (p) => (p.p.y / YD - cfg.ballY) * cfg.dir;
  const rosterInfo = createInsideZoneRoster({ front: 'nickel', ratingOverrides: cfg.ratingOverrides, playerIds: cfg.playerIds });
  const world = new World(rand);
  const players = new Map();
  const offense = [], defense = [];
  const alignments = {
    'O.QB': [-4.3, 0], 'O.RB': [-5.7, 0], 'O.LT': [0, 2.25], 'O.LG': [0, 1.12],
    'O.C': [0, 0], 'O.RG': [0, -1.12], 'O.RT': [0, -2.25],
    'O.TE': [0, runSide * 4.6], 'O.WR1': [0, runSide * 15],
    'O.WR2': [0, runSide * 7.2], 'O.WR3': [0, -runSide * 15],
    'D.LDE': [0.72, 4.55], 'D.LDT': [0.4, 1.2], 'D.RDT': [0.4, -1.2], 'D.RDE': [0.72, -4.55],
    'D.WILL': [3.05, -2.25], 'D.MIKE': [3.05, 0.3],
    'D.LCB': [6.2, 15.6], 'D.RCB': [6.2, -15.6], 'D.NB': [4.8, runSide * 5.5],
    'D.SS': [8.7, runSide * 5.5], 'D.FS': [11.2, -runSide * 2.5],
  };
  for (const info of rosterInfo) {
    const p = world.add(new Player(info, info.team, info.slot));
    p.roleKey = info.roleKey;
    const [forward, lateral] = alignments[info.roleKey];
    const pos = cfg.initialPositions[info.roleKey] ?? {
      x: cfg.los + cfg.dir * forward, y: cfg.ballY + cfg.dir * lateral,
    };
    p.p = { x: pos.x * YD, y: pos.y * YD };
    p.h = info.team === 'O' ? (cfg.dir > 0 ? 0 : Math.PI) : (cfg.dir > 0 ? Math.PI : 0);
    p.ai.assignment = 'align'; p.ai.decision = 'read the snap';
    (p.team === 'O' ? offense : defense).push(p);
    players.set(p.roleKey, p);
  }
  const get = (key) => players.get(key);
  const center = get('O.C'), qb = get('O.QB');
  const ballAtSnap = at(0, 0);
  Object.assign(world.ball, { x: ballAtSnap.x, y: ballAtSnap.y, z: 0.15, state: 'held', holder: center, hand: 'chest' });
  center.hasBall = true;

  const events = world.events;
  function event(type, details = {}) { world.event(type, details); }
  function setIntent(p, assignment, decision, target = null) {
    if (p.ai.assignment === assignment && p.ai.decision === decision && p.ai.blockOn === target) return;
    p.ai.assignment = assignment; p.ai.decision = decision;
    if (target !== undefined) p.ai.blockOn = target;
    event('decision', { player_id: p.id, role: p.roleKey, assignment, decision, target_id: target?.id ?? null });
  }
  function seek(p, target, fraction = 1, decel = 8) {
    const dx = target.x - p.p.x, dy = target.y - p.p.y, d = Math.hypot(dx, dy);
    if (d < 0.04) return { x: 0, y: 0 };
    const speed = Math.min(p.vmax * fraction, Math.sqrt(2 * decel * d));
    return { x: dx / d * speed, y: dy / d * speed };
  }
  function lead(target, time = 0.18) { return { x: target.p.x + target.v.x * time, y: target.p.y + target.v.y * time }; }
  function nearest(list, origin, filter = () => true) {
    return list.filter(filter).map((p) => [distance(origin.p, p.p), p]).sort((a, b) => a[0] - b[0] || a[1].id.localeCompare(b[1].id))[0]?.[1] ?? null;
  }
  function intentDistance(a, b) { return distance(a.p, b.p); }

  const originalDisengage = world.disengage.bind(world);
  world.disengage = (engagement, shedder) => {
    if (!engagement) return;
    const off = engagement.a.team === 'O' ? engagement.a : engagement.b.team === 'O' ? engagement.b : null;
    const def = off === engagement.a ? engagement.b : off === engagement.b ? engagement.a : null;
    event('block_release', { blocker_id: off?.id ?? null, defender_id: def?.id ?? null, by: shedder?.id ?? null });
    originalDisengage(engagement, shedder);
  };
  function engage(a, b, kind = 'pass_protect') {
    if (!a || !b || a.engaged || b.engaged || a.down || b.down) return;
    if (intentDistance(a, b) > a.r + b.r + 0.16) return;
    world.engage(a, b);
    if (a.engaged === b) {
      const blockingTeam = carrierTeam ?? 'O';
      const blocker = a.team === blockingTeam ? a : b;
      const defender = blocker === a ? b : a;
      event('block_engage', { blocker_id: blocker.id, defender_id: defender.id, phase: kind });
    }
  }
  function tryShed(defender) {
    const engagement = world.engagements.find((row) => row.a === defender || row.b === defender);
    if (!engagement) return;
    const blocker = engagement.a === defender ? engagement.b : engagement.a;
    const attack = defender.info.group === 'DL'
      ? Math.max(defender.R.PMV ?? 50, defender.R.FMV ?? 50, defender.R.BSH ?? 50)
      : defender.R.BSH ?? 50;
    const block = blocker.R.PBK ?? blocker.R.RBK ?? blocker.R.IBL ?? 50;
    const rate = clamp(0.12 * Math.exp((attack - block) / 24), 0.025, 1.6);
    if (rand() < rate * DT) {
      world.disengage(engagement, defender);
      event('shed', { by: defender.id, from: blocker.id });
    }
  }

  const routes = new Map();
  function route(role, steps) { routes.set('O.' + role, steps.map(([f, l, name]) => ({ f, l: l * runSide, name }))); }
  route('WR1', [[3.6, 15, 'slant stem'], [5.2, 8.5, 'inside slant break'], [12.5, 4, 'finish slant']]);
  route('WR2', [[1.4, 7.2, 'flat stem'], [2.0, 11, 'flat break'], [3.2, 15, 'finish flat']]);
  route('TE', [[2.0, 4.6, 'release'], [5.4, 3.8, 'settle in hook window'], [7.0, 3.8, 'show hands']]);
  route('RB', [[-3.4, 0, 'check protection'], [-1.0, 4.8, 'release to flat'], [1.5, 7.0, 'checkdown window']]);
  route('WR3', [[5.0, -15, 'clear-out stem'], [12.0, -15, 'stretch backside']]);

  const progression = ['O.WR1', 'O.WR2', 'O.TE', 'O.RB', 'O.WR3'];
  const coverageMatch = new Map();
  const outside = ['O.WR1', 'O.WR3'].map(get);
  coverageMatch.set('D.LCB', nearest(outside, get('D.LCB')));
  coverageMatch.set('D.RCB', nearest(outside, get('D.RCB')));
  coverageMatch.set('D.NB', get('O.WR2'));
  coverageMatch.set('D.SS', get('O.TE'));
  coverageMatch.set('D.MIKE', get('O.RB'));
  coverageMatch.set('D.WILL', get('O.TE'));
  const coverRoleDelays = { NB: 0.18, SS: 0.28, FS: 0.48, LCB: 0.34, RCB: 0.34 };
  for (const p of defense.filter((q) => q.info.group === 'DB')) {
    const reading = p.R.PRC ?? p.R.AWR ?? 60;
    p.ai.passReadDelay = clamp((coverRoleDelays[p.slot] ?? 0.38) + (68 - reading) * 0.003, 0.10, 0.55);
  }
  get('D.MIKE').ai.blitz = cfg.coverage === 'cover1';

  const stride = rosterInfo.length * 6 + 6;
  const frameRows = [], paths = new Map(rosterInfo.map((p) => [p.id, []]));
  function record() {
    const frame = new Float32Array(stride);
    let offset = 0;
    for (const p of world.players) {
      frame[offset++] = p.p.x / YD; frame[offset++] = p.p.y / YD; frame[offset++] = p.h;
      frame[offset++] = p.speed; frame[offset++] = p.down ? POSE.DOWN : p.pose; frame[offset++] = p.hasBall ? 1 : 0;
      const sample = {
        t: world.t, x: p.p.x / YD, y: p.p.y / YD, vx: p.v.x / YD, vy: p.v.y / YD,
        heading: p.h, speed: p.speed / YD, hasBall: p.hasBall,
        assignment: p.ai.assignment, decision: p.ai.decision,
        assignment_target: p.ai.blockOn?.roleKey ?? p.ai.cover?.roleKey ?? null,
        engaged_with: p.engaged?.roleKey ?? null,
        lane_local_yards: p.ai.lane ?? null, lane_locked: false,
      };
      const path = paths.get(p.id);
      if (path.length && Math.abs(path.at(-1).t - world.t) < 1e-7) path[path.length - 1] = sample;
      else path.push(sample);
    }
    frame[offset++] = world.ball.x / YD; frame[offset++] = world.ball.y / YD; frame[offset++] = world.ball.z;
    frame[offset++] = world.ball.spin;
    frame[offset++] = world.ball.state === 'air' || world.ball.state === 'snap'
      ? Math.atan2(world.ball.vy, world.ball.vx) : world.ball.rot || 0;
    frame[offset++] = world.ball.state === 'air' || world.ball.state === 'snap'
      ? Math.atan2(world.ball.vz, Math.hypot(world.ball.vx, world.ball.vy)) : 0;
    const last = frameRows.at(-1);
    if (last && Math.abs(last.t - world.t) < 1e-7) frameRows[frameRows.length - 1] = { t: world.t, frame };
    else frameRows.push({ t: world.t, frame });
  }

  let snapped = false, snapArrive = 0.12, carrier = null, carrierTeam = null;
  let passThrown = false, passTarget = null, passCompleted = false, interception = false;
  let passReleasedAt = null, estimatedFlight = null;
  let terminal = null, tackle = null, nextRecord = 0, recognitionAt = null;
  let progress = null, lastInBounds = { x: ballAtSnap.x, y: ballAtSnap.y }, returnStart = null;
  let routeReleased = false;

  function finish(reason, spot, extra = {}) {
    if (terminal) return;
    const offenseGain = carrierTeam === 'O' || (!carrier && (reason === 'incomplete' || reason === 'sack'))
      ? (spot.x / YD - cfg.los) * cfg.dir : null;
    const returnYards = interception && carrierTeam === 'D' && returnStart
      ? (spot.x - returnStart.x) / YD * -cfg.dir : null;
    terminal = {
      reason, spot: { x: spot.x / YD, y: clamp(spot.y / YD, 0, FIELD_W_YD) }, time: world.t,
      yards_gained: reason === 'incomplete' ? 0 : offenseGain,
      touchdown: reason === 'touchdown' || reason === 'interception_return_touchdown', possession_team: carrierTeam ?? 'O',
      pass_completed: passCompleted, turnover: interception,
      return_yards: returnYards, ...extra,
    };
    if (reason === 'tackle' || reason === 'sack' || reason === 'interception_return') {
      if (carrier) { carrier.down = true; carrier.pose = POSE.DOWN; carrier.downT = world.t; }
      if (tackle?.tackler) { tackle.tackler.down = true; tackle.tackler.pose = POSE.DOWN; tackle.tackler.downT = world.t; }
    }
    for (const engagement of [...world.engagements]) world.disengage(engagement);
    world.ball.holder = null; world.ball.state = 'held'; world.ball.x = spot.x; world.ball.y = spot.y; world.ball.z = 0.15;
    event('whistle', { reason, ball_spot: terminal.spot });
  }

  function startTackle(defender, source = 'body') {
    if (terminal || tackle || !carrier || defender.team === carrier.team || defender.engaged || defender.down) return;
    event('tackle_contact', { defender_id: defender.id, carrier_id: carrier.id, source, distance_meters: distance(defender.p, carrier.p) });
    const closing = Math.hypot(defender.v.x - carrier.v.x, defender.v.y - carrier.v.y) / YD;
    const tackleSkill = defender.R.TAK ?? 60;
    const carrierSkill = Math.max(carrier.R.BTK ?? 55, carrier.R.ELU ?? 55);
    const strength = (defender.R.STR ?? 55) - (carrier.R.STR ?? 55);
    const finishChance = clamp(0.43 + (tackleSkill - carrierSkill) * 0.006 + strength * 0.0015 + closing * 0.027, 0.08, 0.92);
    if (rand() < finishChance) {
      tackle = { tackler: defender, t0: world.t };
      defender.pose = POSE.WRAP; carrier.pose = POSE.WRAP;
      world.wrap(defender, carrier, { fall: 0.48, keepCarrier: 0.22 });
      event(carrier === qb && !passThrown ? 'sack_contact' : 'tackle_start', { by: defender.id, on: carrier.id });
      setIntent(defender, 'finish tackle', 'wrap the live carrier and drive through contact');
      setIntent(carrier, 'protect football', 'fight through contact and keep forward progress');
    } else {
      defender.stumble = 0.24; defender.ai.missUntil = world.t + 1.0; carrier.stumble = 0.10;
      event('broken_tackle', { defender_id: defender.id, carrier_id: carrier.id, closing_speed: closing });
      setIntent(defender, 'recover pursuit angle', 'regain balance after the carrier escaped contact');
    }
  }

  world.onTouch = (a, b) => {
    if (terminal || tackle) return;
    if (!carrier && !passThrown && world.ball.holder === qb && (a === qb || b === qb)) {
      carrier = qb; carrierTeam = 'O';
      event('qb_contact', { quarterback_id: qb.id });
    }
    if (!carrier || (a !== carrier && b !== carrier)) return;
    const d = a === carrier ? b : a;
    if (d.team !== carrier.team && (d.ai.missUntil ?? 0) <= world.t) startTackle(d);
  };
  world.onBallGround = (ball) => {
    if (!terminal && passThrown && !carrier && ball.state === 'air') {
      event('incomplete_pass', { spot: { x: cfg.los, y: cfg.ballY } });
      finish('incomplete', ballAtSnap);
    }
  };

  function nearestThreat(p, list = defense) { return nearest(list, p, (q) => !q.down); }
  function pressureAtQuarterback() {
    let pressure = 0;
    for (const d of defense) {
      if (d.down) continue;
      const r = distance(d.p, qb.p);
      if (r < 4.2) pressure += (d.engaged ? 0.25 : 1) * clamp((4.2 - r) / 2.8, 0, 1);
    }
    return pressure;
  }
  function receiverUtility(receiver) {
    const cover = nearest(defense, receiver);
    const separationYards = cover ? distance(receiver.p, cover.p) / YD : 20;
    const targetDistance = distance(qb.p, receiver.p) / YD;
    const window = clamp((separationYards - 0.9) / 3.4, 0, 1);
    const progress = clamp(fOf(receiver) - 1.2, -5, 15);
    const undercut = cover && fOf(cover) > fOf(receiver) - 0.6 && distance(receiver.p, cover.p) / YD < 2.3 ? 0.75 : 0;
    const difficulty = Math.max(0, targetDistance - 12) * 0.055 + targetDistance * 0.012;
    const pressure = pressureAtQuarterback();
    const risk = undercut + (separationYards < 1.2 ? 0.55 : separationYards < 2.0 ? 0.2 : 0);
    const value = window * 1.55 + progress * 0.035 - risk * 0.85 - difficulty - pressure * 0.34;
    return { value, separation_yards: separationYards, distance_yards: targetDistance, risk, pressure };
  }

  function throwTo(receiver, metrics) {
    if (passThrown || !receiver || world.ball.holder !== qb) return;
    const throwDistance = distance(qb.p, receiver.p) / YD;
    const power = qb.R.THP ?? 75;
    const speed = clamp(18 + power * 0.055, 20, 25);
    const flight = clamp(0.20 + throwDistance * YD / speed, 0.28, 1.15);
    const aim = { x: receiver.p.x + receiver.v.x * flight, y: receiver.p.y + receiver.v.y * flight, z: 1.35 };
    const accuracy = throwDistance <= 12 ? (qb.R.SAC ?? 70) : (qb.R.MAC ?? 65);
    const pressureSpread = metrics.pressure * 0.12;
    const spread = clamp(0.72 - accuracy * 0.006 + pressureSpread, 0.12, 0.9);
    aim.x += (rand() * 2 - 1) * spread;
    aim.y += (rand() * 2 - 1) * spread;
    const from = { x: world.ball.x, y: world.ball.y, z: world.ball.z };
    const launch = solveLaunch(from, aim, flight, AERO.spiral);
    Object.assign(world.ball, { state: 'air', holder: null, ...launch });
    qb.hasBall = false; qb.pose = POSE.THROW;
    passThrown = true; passTarget = receiver;
    passReleasedAt = world.t; estimatedFlight = flight;
    passTarget.ai.catchAttempts = new Set();
    event('throw', {
      by: qb.id, target_id: receiver.id, estimated_flight_seconds: flight,
      observed_separation_yards: metrics.separation_yards, read_value: metrics.value,
      release_position: { x: from.x / YD, y: from.y / YD }, aim_point: { x: aim.x / YD, y: aim.y / YD },
    });
    setIntent(qb, 'throw to live window', `release to ${receiver.slot} using the observed route and current pressure`, receiver);
  }

  function readSignal() {
    if (recognitionAt == null && world.ball.holder === qb && fOf(qb) < -0.45) recognitionAt = world.t;
    if (recognitionAt == null) return;
    for (const d of defense.filter((p) => p.info.group === 'DB')) {
      if (d.ai.passRecognized || world.t - recognitionAt < d.ai.passReadDelay) continue;
      d.ai.passRecognized = true;
      event('defensive_pass_read', { player_id: d.id, role: d.roleKey, observed_at: recognitionAt, reaction_delay_seconds: d.ai.passReadDelay });
    }
  }

  function qbBrain(p) {
    if (p === carrier) { carrierBrain(p); return; }
    if (world.ball.holder !== qb || passThrown) { p.dv = { x: 0, y: 0 }; return; }
    const pressure = pressureAtQuarterback();
    p.face = cfg.dir > 0 ? 0 : Math.PI;
    if (p.ai.readIndex == null) { p.ai.readIndex = 0; p.ai.nextRead = 0.48; }
    // The QB climbs or slides inside the pocket using observed rush leverage.
    const rush = nearestThreat(p);
    let pocketTarget = at(-3.15, 0);
    if (rush && distance(rush.p, p.p) < 5.2 * YD) {
      const away = unit(p.p.x - rush.p.x, p.p.y - rush.p.y);
      pocketTarget = { x: p.p.x + away.x * 0.7, y: p.p.y + away.y * 0.55 };
    }
    p.dv = seek(p, pocketTarget, 0.76, 6.5);
    if (world.t < p.ai.nextRead) {
      setIntent(p, 'drop back and scan', 'set the pocket depth while reading current coverage');
      return;
    }
    if (p.ai.readIndex < progression.length) {
      const role = progression[p.ai.readIndex++];
      const receiver = get(role);
      const metrics = receiverUtility(receiver);
      event('qb_read', { quarterback_id: p.id, target_id: receiver.id, progression: p.ai.readIndex, ...metrics });
      setIntent(p, `read ${receiver.slot}`, `evaluate separation, leverage, throw distance and pressure from live positions`, receiver);
      p.ai.nextRead = world.t + 0.22;
      const threshold = cfg.down === 4 && cfg.toGo > 8 ? 0.38 : 0.23;
      if (metrics.value >= threshold && metrics.pressure < 2.2) {
        throwTo(receiver, metrics);
        return;
      }
      return;
    }
    const options = progression.map((role) => ({ receiver: get(role), metrics: receiverUtility(get(role)) }))
      .sort((a, b) => b.metrics.value - a.metrics.value || a.receiver.id.localeCompare(b.receiver.id));
    if (options[0]?.metrics.value > 0.38 && pressure < 1.7) {
      throwTo(options[0].receiver, options[0].metrics);
      return;
    }
    if (pressure > 0.55 || world.t > 2.45) {
      carrier = qb; carrierTeam = 'O'; progress = null;
      qb.hasBall = true; world.ball.holder = qb; world.ball.state = 'held';
      event('qb_scramble', { quarterback_id: qb.id, pressure, reason: pressure > 0.55 ? 'pocket_pressure' : 'reads_exhausted' });
      setIntent(qb, 'scramble from pressure', 'secure the ball and attack the open space beyond the pocket');
      carrierBrain(qb);
      return;
    }
    p.ai.nextRead = world.t + 0.2;
    setIntent(p, 'move within pocket', 'keep eyes up while waiting for a live window');
  }

  function runLane(p) {
    const opponents = world.players.filter((q) => q.team !== p.team && !q.down);
    const lanes = [-2.65, -1.68, -0.58, 0.58, 1.68, 2.65];
    const scores = lanes.map((lane) => {
      let threat = 0;
      for (const d of opponents.filter((q) => !q.engaged)) {
        const forward = (d.p.x - p.p.x) / YD * (carrierTeam === 'O' ? cfg.dir : -cfg.dir);
        const lateral = Math.abs(lOf(d) - lane);
        if (forward > -0.8 && forward < 5 && lateral < 2.5) threat += (1 - lateral / 2.5) * (1 - Math.max(0, forward - 2.5) / 4.5);
      }
      const switchCost = p.ai.lane == null ? 0 : Math.abs(p.ai.lane - lane) * 0.13;
      return { lane, score: threat + switchCost };
    }).sort((a, b) => a.score - b.score);
    const next = scores[0]?.lane ?? runSide * 0.58;
    if (p.ai.lane == null || (Math.abs(next - p.ai.lane) > 1.0 && world.t >= (p.ai.laneHoldUntil ?? 0))) {
      p.ai.lane = next; p.ai.laneHoldUntil = world.t + 0.22;
      event('lane_read', { carrier_id: p.id, lane_local_yards: next, time: world.t });
    }
    const forwardDir = carrierTeam === 'O' ? cfg.dir : -cfg.dir;
    const target = { x: p.p.x + forwardDir * 1.9 * YD, y: (cfg.ballY + cfg.dir * p.ai.lane) * YD };
    const toward = unit(target.x - p.p.x, target.y - p.p.y);
    const threat = nearest(opponents, p);
    if (threat && distance(threat.p, p.p) < 1.9 * YD) {
      const away = unit(p.p.x - threat.p.x, p.p.y - threat.p.y);
      toward.x = toward.x * 0.7 + away.x * 0.3; toward.y = toward.y * 0.7 + away.y * 0.3;
    }
    const move = unit(toward.x, toward.y);
    p.dv = { x: move.x * p.vmax * 0.96, y: move.y * p.vmax * 0.96 };
    p.face = Math.atan2(move.y, move.x);
    setIntent(p, 'run after catch', `press the open return lane at ${p.ai.lane.toFixed(1)} yards`, threat);
  }

  function choosePassBlock(blocker) {
    const inside = ['O.C', 'O.LG', 'O.RG'].includes(blocker.roleKey);
    const preferred = defense.filter((d) => !d.down && (!d.engaged || d.engaged === blocker)
      && (d.info.group === 'DL' || d.ai.blitz));
    if (!preferred.length) return null;
    return preferred.map((d) => {
      const latPenalty = inside ? Math.max(0, Math.abs(lOf(d)) - 2.8) * 0.65 : Math.max(0, 1.8 - Math.abs(lOf(d))) * 0.45;
      const backPenalty = Math.max(0, fOf(d) - 3.5) * 0.4;
      return [distance(blocker.p, d.p) / YD + latPenalty + backPenalty, d];
    }).sort((a, b) => a[0] - b[0] || a[1].id.localeCompare(b[1].id))[0][1];
  }

  function offenseBlock(p, returnPhase = false) {
    const opponents = world.players.filter((q) => q.team !== p.team);
    if (p.engaged) {
      const defender = p.engaged;
      const dirOut = unit(defender.p.x - p.p.x, defender.p.y - p.p.y);
      p.dv = { x: dirOut.x * 1.5, y: dirOut.y * 1.5 };
      p.face = Math.atan2(dirOut.y, dirOut.x); p.pose = POSE.BLOCK;
      setIntent(p, 'maintain pass protection', `anchor ${defender.slot} and preserve the pocket`, defender);
      return;
    }
    if (p.ai.nextBlockAt == null || world.t >= p.ai.nextBlockAt || !p.ai.blockOn || p.ai.blockOn.down || p.ai.blockOn.engaged) {
      p.ai.blockOn = returnPhase
        ? nearest(opponents, p, (q) => !q.down && !q.engaged)
        : choosePassBlock(p);
      p.ai.nextBlockAt = world.t + 0.12;
    }
    const target = p.ai.blockOn;
    if (!target) { p.dv = { x: 0, y: 0 }; return; }
    const aim = lead(target, 0.1);
    p.dv = seek(p, aim, 0.78, 8);
    p.face = Math.atan2(target.p.y - p.p.y, target.p.x - p.p.x);
    p.pose = POSE.BLOCK;
    setIntent(p, returnPhase ? 'clear pursuit lane' : 'pass protect', `pick up ${target.slot} by current inside leverage`, target);
    engage(p, target, returnPhase ? 'return_block' : 'pass_protect');
  }

  function receiverBrain(p) {
    if (carrier === p) { carrierBrain(p); return; }
    if (passThrown && world.ball.state === 'air' && (p === passTarget || p.ai.route?.name === 'checkdown')) {
      const aim = { x: world.ball.x + world.ball.vx * 0.12, y: world.ball.y + world.ball.vy * 0.12 };
      p.dv = seek(p, aim, 0.97, 12); p.face = Math.atan2(world.ball.y - p.p.y, world.ball.x - p.p.x);
      setIntent(p, 'adjust to live pass', 'track the ball in flight and attempt a reachable catch');
      return;
    }
    if (passCompleted || interception) { offenseBlock(p, true); return; }
    const steps = routes.get(p.roleKey);
    if (!steps) { p.dv = { x: 0, y: 0 }; return; }
    const index = p.ai.routeIndex ?? 0;
    const step = steps[index];
    const goal = at(step.f, step.l);
    if (distance(p.p, goal) < 0.52 * YD && index < steps.length - 1) {
      p.ai.routeIndex = index + 1;
      p.ai.route = steps[index + 1];
      event('route_break', { receiver_id: p.id, route: p.ai.route.name, landmark: { forward_yards: p.ai.route.f, lateral_yards: p.ai.route.l } });
    } else p.ai.route = step;
    const active = p.ai.route ?? step;
    p.dv = seek(p, at(active.f, active.l), 0.97, 10.5);
    p.face = Math.atan2(p.dv.y, p.dv.x);
    setIntent(p, `run ${active.name}`, 'follow the assigned landmark and react to current coverage');
  }

  function carrierBrain(p) {
    if (tackle) { p.dv = { x: p.v.x, y: p.v.y }; return; }
    if (p === qb && world.ball.holder === qb) {
      const rush = nearestThreat(p);
      const away = rush ? unit(p.p.x - rush.p.x, p.p.y - rush.p.y) : { x: cfg.dir, y: runSide };
      p.dv = { x: away.x * p.vmax * 0.86, y: away.y * p.vmax * 0.86 };
      p.face = Math.atan2(away.y, away.x);
      setIntent(p, 'scramble with ball', 'escape the live rush and protect possession');
      return;
    }
    runLane(p);
  }

  function offensiveBrain(p) {
    if (carrier) {
      if (p === carrier) carrierBrain(p);
      else if (p.team === carrier.team) offenseBlock(p, true);
      else pursueCarrier(p);
      return;
    }
    if (p === qb) { qbBrain(p); return; }
    if (p === carrier) { carrierBrain(p); return; }
    if (['LT', 'LG', 'C', 'RG', 'RT'].includes(p.slot)) {
      offenseBlock(p, !!carrier); return;
    }
    receiverBrain(p);
  }

  function defensiveBrain(p) {
    if (!snapped) { p.dv = { x: 0, y: 0 }; return; }
    if (p === carrier) { carrierBrain(p); return; }
    if (p.engaged) {
      tryShed(p);
      if (p.engaged) {
        const target = carrier ?? qb;
        const toward = unit(target.p.x - p.p.x, target.p.y - p.p.y);
        p.dv = { x: toward.x * 1.5, y: toward.y * 1.5 };
        p.pose = POSE.BLOCK;
        setIntent(p, `shed block from ${p.engaged.slot}`, 'work free and locate the live ball');
        return;
      }
    }
    if (carrier) {
      if (p.team === carrier.team) offenseBlock(p, true);
      else pursueCarrier(p);
      return;
    }
    if (passThrown && world.ball.state === 'air') {
      const aim = { x: world.ball.x + world.ball.vx * 0.12, y: world.ball.y + world.ball.vy * 0.12 };
      p.dv = seek(p, aim, 0.95, 12); p.face = Math.atan2(world.ball.y - p.p.y, world.ball.x - p.p.x);
      setIntent(p, 'play the airborne ball', 'react to the current ball position and contest a reachable pass');
      return;
    }
    const role = p.roleKey;
    if (p.info.group === 'DL') {
      const edge = ['D.LDE', 'D.RDE'].includes(role);
      const target = edge && !carrier ? at(1.1, lOf(p) * 1.25) : qb.p;
      p.dv = seek(p, target, 0.94, 16);
      p.face = Math.atan2(qb.p.y - p.p.y, qb.p.x - p.p.x);
      setIntent(p, edge ? 'bend edge toward QB' : 'rush interior protection', 'attack the live pocket through the current blocking matchup');
      return;
    }
    if (p.info.group === 'LB') {
      const blitz = cfg.coverage === 'cover1' && role === 'D.MIKE';
      p.ai.blitz = blitz;
      if (blitz) {
        p.dv = seek(p, qb.p, 0.88, 13);
        setIntent(p, 'green-dog pressure', 'trigger through the inside gap while the back releases');
      } else if (cfg.coverage === 'cover1') {
        const assigned = coverageMatch.get(role) ?? get('O.TE');
        p.dv = seek(p, lead(assigned, 0.12), 0.86, 9);
        p.ai.cover = assigned;
        setIntent(p, 'man-match underneath', `carry ${assigned.slot} from current leverage`, assigned);
      } else {
        const home = role === 'D.MIKE' ? [4.2, 0] : [4.0, runSide * 5.0];
        p.dv = seek(p, at(home[0], home[1]), 0.58, 7);
        setIntent(p, 'drop to hook zone', 'read QB shoulders and protect the underneath window');
      }
      return;
    }
    if (cfg.coverage === 'cover1') {
      const assigned = coverageMatch.get(role);
      if (role === 'D.FS') {
        const deep = nearest(outside, p);
        p.dv = seek(p, at(13.5, (lOf(deep) > 0 ? 1 : -1) * 7), 0.64, 8);
        setIntent(p, 'single-high help', 'stay over the deepest route and read the QB');
      } else if (assigned) {
        p.ai.cover = assigned;
        p.dv = seek(p, lead(assigned, 0.16), 0.9, 10);
        p.face = Math.atan2(assigned.p.y - p.p.y, assigned.p.x - p.p.x);
        setIntent(p, `man cover ${assigned.slot}`, 'maintain leverage while matching the receiver route', assigned);
      }
      return;
    }
    const zone = role === 'D.FS' ? [14.5, 0]
      : role === 'D.LCB' ? [12.5, 12.5]
        : role === 'D.RCB' ? [12.5, -12.5]
          : role === 'D.SS' ? [6.2, -runSide * 7]
            : [5.8, runSide * 6.5];
    p.dv = seek(p, at(zone[0], zone[1]), role === 'D.FS' ? 0.55 : 0.68, 8);
    setIntent(p, role === 'D.FS' ? 'middle-third safety' : role.includes('CB') ? 'outside-third zone' : 'hook-curl zone',
      'hold zone leverage and break on the observed throw');
  }

  function pursueCarrier(p) {
    const vector = unit(carrier.p.x - p.p.x, carrier.p.y - p.p.y);
    p.dv = { x: vector.x * p.vmax * 0.97, y: vector.y * p.vmax * 0.97 };
    p.face = Math.atan2(vector.y, vector.x);
    setIntent(p, 'pursue live carrier', 'close from current position and preserve a tackle angle');
  }

  function setCarrier(p, team, reason, spot = null) {
    if (carrier) carrier.hasBall = false;
    carrier = p; carrierTeam = team; p.hasBall = true; world.ball.state = 'held'; world.ball.holder = p; world.ball.hand = 'carry';
    p.mode = 'carry'; p.pose = POSE.RUN;
    if (team === 'D') { interception = true; returnStart = { x: spot?.x ?? world.ball.x, y: spot?.y ?? world.ball.y }; }
    else if (p !== qb) passCompleted = true;
    progress = null; lastInBounds = { x: world.ball.x, y: world.ball.y };
    event(reason, { player_id: p.id, possession_team: team, spot: { x: world.ball.x / YD, y: world.ball.y / YD } });
    setIntent(p, team === 'O' ? 'secure completion' : 'secure interception', 'transition from catch to live-ball movement');
  }

  function resolveCatch() {
    if (!passThrown || world.ball.state !== 'air' || world.ball.z < 0.55 || world.ball.z > 2.65) return;
    const elapsed = world.t - passReleasedAt;
    if (elapsed < Math.min(0.14, estimatedFlight * 0.5)) return;
    const candidates = world.players.filter((p) => !p.down && p !== qb
      && (p.team === 'O' ? ['WR', 'TE', 'RB'].includes(p.info.group) : ['DB', 'LB'].includes(p.info.group))
      && !p.ai.catchTried
      && distance(p.p, world.ball) <= CATCH_REACH + p.r)
      .sort((a, b) => distance(a.p, world.ball) - distance(b.p, world.ball) || a.id.localeCompare(b.id));
    const nearestDistance = candidates.length ? distance(candidates[0].p, world.ball) : Infinity;
    const contestGroup = candidates.filter((p) => distance(p.p, world.ball) <= nearestDistance + 0.22);
    const ability = (p) => p.team === 'O'
      ? (p.R.CTH ?? 65) + (p.R.SPC ?? 65) * 0.22 + (p.R.CIT ?? 65) * 0.12 + (p.R.JMP ?? 65) * 0.12
      : (p.R.MCV ?? p.R.ZCV ?? 60) * 0.62 + (p.R.ZCV ?? 60) * 0.18 + (p.R.CTH ?? 60) * 0.10 + (p.R.JMP ?? 65) * 0.10;
    const candidate = contestGroup.sort((a, b) => ability(b) - ability(a)
      || distance(a.p, world.ball) - distance(b.p, world.ball) || a.id.localeCompare(b.id))[0];
    if (!candidate) return;
    candidate.ai.catchTried = true;
    const receiverSkill = candidate.team === 'O' ? candidate.R.CTH ?? 65 : candidate.R.MCV ?? candidate.R.ZCV ?? 60;
    const jump = candidate.R.JMP ?? 65;
    const facing = Math.atan2(world.ball.y - candidate.p.y, world.ball.x - candidate.p.x);
    const angle = Math.abs(Math.atan2(Math.sin(facing - candidate.h), Math.cos(facing - candidate.h)));
    const facingBonus = angle < Math.PI / 2 ? 0.06 : -0.08;
    const nearbyOpponents = world.players.filter((p) => p.team !== candidate.team && !p.down
      && distance(p.p, candidate.p) <= 1.25);
    const opponentsNear = nearbyOpponents.length;
    const bestOpponent = nearbyOpponents.sort((a, b) => ability(b) - ability(a))[0];
    const contestEdge = bestOpponent ? (ability(candidate) - ability(bestOpponent)) * 0.004 : 0;
    const probability = clamp((candidate.team === 'O' ? 0.58 : 0.38)
      + (receiverSkill - 65) * 0.006 + (jump - 65) * 0.002 + facingBonus
      + contestEdge - opponentsNear * 0.06, 0.08, 0.94);
    event('catch_attempt', {
      player_id: candidate.id, target_id: passTarget?.id ?? null,
      distance_meters: distance(candidate.p, world.ball), probability,
      contested: !!bestOpponent, contesting_player_id: bestOpponent?.id ?? null,
    });
    if (rand() < probability) {
      const spot = { x: world.ball.x, y: world.ball.y };
      setCarrier(candidate, candidate.team, candidate.team === 'O' ? 'catch' : 'interception', spot);
      return;
    }
    event('pass_deflection', { by: candidate.id, target_id: passTarget?.id ?? null });
    world.ball.vx *= 0.88;
    world.ball.vy += (rand() - 0.5) * 2.0;
    world.ball.vz = Math.max(0.6, world.ball.vz + 0.8);
  }

  function updateProgressAndTerminals() {
    if (!carrier || world.ball.holder !== carrier || terminal) return;
    const forwardDir = carrierTeam === 'O' ? cfg.dir : -cfg.dir;
    const forward = world.ball.x / YD * forwardDir;
    if (!progress || forward > progress.forward) progress = { forward, x: world.ball.x, y: world.ball.y };
    const x = world.ball.x / YD;
    if ((carrierTeam === 'O' && cfg.dir > 0 && x >= 100) || (carrierTeam === 'O' && cfg.dir < 0 && x <= 0)) {
      event('touchdown', { carrier_id: carrier.id, possession_team: carrierTeam });
      finish('touchdown', { x: (cfg.dir > 0 ? 100 : 0) * YD, y: world.ball.y }); return;
    }
    if ((carrierTeam === 'D' && cfg.dir > 0 && x <= 0) || (carrierTeam === 'D' && cfg.dir < 0 && x >= 100)) {
      event('interception_return_touchdown', { carrier_id: carrier.id });
      finish('interception_return_touchdown', { x: (cfg.dir > 0 ? 0 : 100) * YD, y: world.ball.y }); return;
    }
    if (world.ball.y < 0 || world.ball.y > FIELD_W_YD * YD) {
      const edge = world.ball.y < 0 ? 0 : FIELD_W_YD * YD;
      const dy = world.ball.y - lastInBounds.y;
      const alpha = Math.abs(dy) > 1e-9 ? clamp((edge - lastInBounds.y) / dy, 0, 1) : 0;
      finish('out_of_bounds', { x: lastInBounds.x + (world.ball.x - lastInBounds.x) * alpha, y: edge }); return;
    }
    lastInBounds = { x: world.ball.x, y: world.ball.y };
    if (world.ball.x < 0 || world.ball.x > 100 * YD) finish('safety', { x: world.ball.x, y: world.ball.y });
  }

  function startPlay() {
    snapped = true;
    const from = { x: world.ball.x, y: world.ball.y, z: 0.35 };
    const to = { x: qb.p.x + Math.cos(qb.h) * 0.55, y: qb.p.y + Math.sin(qb.h) * 0.55, z: 1.0 };
    const launch = solveLaunch(from, to, snapArrive, AERO.spiral);
    Object.assign(world.ball, { state: 'snap', holder: null, ...launch });
    center.hasBall = false;
    for (const p of offense.filter((q) => routes.has(q.roleKey))) p.ai.routeIndex = 0;
    event('snap', { play_call: cfg.concept, coverage: cfg.coverage, from: center.id, to: qb.id });
    event('pass_protection_set', { scheme: 'slide to call side with inside leverage' });
  }

  record(); nextRecord = 1 / REC_HZ;
  while (world.t < MAX_SECONDS && !terminal) {
    if (!snapped) startPlay();
    if (world.ball.state === 'snap' && world.t >= snapArrive) {
      world.ball.state = 'held'; world.ball.holder = qb; world.ball.hand = 'chest'; qb.hasBall = true;
      event('snap_receive', { quarterback_id: qb.id });
      setIntent(qb, 'receive snap', 'secure the ball and begin the drop');
    }
    readSignal();
    if (!routeReleased && world.t >= snapArrive) {
      routeReleased = true;
      for (const p of offense.filter((q) => routes.has(q.roleKey))) {
        const first = routes.get(p.roleKey)[0];
        p.ai.route = first;
        event('route_release', { receiver_id: p.id, route: first.name });
      }
    }
    world.step(DT, (p) => p.team === 'O' ? offensiveBrain(p) : defensiveBrain(p));
    if (!carrier && passThrown && world.ball.state === 'air') resolveCatch();
    updateProgressAndTerminals();
    if (!carrier && !passThrown && world.ball.holder === qb) {
      const qbDefender = world.players.filter((p) => p.team === 'D' && !p.down && !p.engaged
        && distance(p.p, qb.p) <= p.r + qb.r + ARM_TACKLE_REACH)
        .sort((a, b) => distance(a.p, qb.p) - distance(b.p, qb.p))[0];
      if (qbDefender) { carrier = qb; carrierTeam = 'O'; event('qb_contact', { quarterback_id: qb.id }); startTackle(qbDefender, 'arm_reach'); }
    }
    if (!terminal && !tackle && carrier) {
      for (const defender of world.players.filter((p) => p.team !== carrier.team)) {
        if (defender.down || defender.engaged || (defender.ai.missUntil ?? 0) > world.t) continue;
        if (distance(defender.p, carrier.p) <= defender.r + carrier.r + ARM_TACKLE_REACH) {
          startTackle(defender, 'arm_reach');
          if (tackle) break;
        }
      }
    }
    if (!terminal && tackle && world.t - tackle.t0 >= 0.48) {
      const reason = carrier === qb && !passThrown && fOf(qb) < 0 ? 'sack'
        : carrierTeam === 'D' ? 'interception_return' : 'tackle';
      finish(reason, progress ?? { x: world.ball.x, y: world.ball.y });
    }
    if (!terminal && passThrown && world.ball.state === 'air'
      && (world.ball.y < 0 || world.ball.y > FIELD_W_YD * YD)) {
      event('pass_out_of_bounds', { spot: { x: world.ball.x / YD, y: world.ball.y / YD } });
      event('incomplete_pass', { spot: { x: cfg.los, y: cfg.ballY } });
      finish('incomplete', ballAtSnap);
    }
    if (!terminal && world.t >= nextRecord - 1e-9) { record(); nextRecord += 1 / REC_HZ; }
  }

  if (!terminal) {
    for (const engagement of [...world.engagements]) world.disengage(engagement);
    event('simulation_failure', { reason: 'simulation_time_cap', time_limit_seconds: MAX_SECONDS });
    record();
  }
  if (frameRows.length === 0 || world.t - frameRows.at(-1).t > 1e-6) record();
  const frameObjects = frameRows.map((row) => row.frame);
  const trajectories = Object.fromEntries(paths);
  const participantRows = rosterInfo.map((p) => ({ id: p.id, team: p.team, slot: p.slot, roleKey: p.roleKey }));
  const blockRows = events.filter((e) => e.type === 'block_engage').map((start) => {
    const release = events.find((e) => e.type === 'block_release'
      && e.blocker_id === start.blocker_id && e.defender_id === start.defender_id && e.t >= start.t);
    const endTime = release?.t ?? terminal?.time ?? world.t;
    return {
      player_id: start.blocker_id, defender_id: start.defender_id,
      duration_seconds: Math.max(0, endTime - start.t),
      won: endTime - start.t >= 0.3 && (!release || release.by !== start.defender_id),
    };
  });
  const blockParticipants = offense.filter((p) => ['OL', 'TE', 'WR', 'RB'].includes(p.info.group)).map((p) => {
    const best = blockRows.filter((row) => row.player_id === p.id)
      .sort((a, b) => Number(b.won) - Number(a.won) || b.duration_seconds - a.duration_seconds)[0] ?? null;
    return { player_id: p.id, role: p.roleKey, won: !!best?.won, engagement: best };
  });
  return {
    schema_version: 'gridiron.autonomous-pass.v1', mode: 'autonomous', play_call: cfg.concept,
    defense_call: cfg.coverage, seed: String(cfg.seed), front: 'nickel', run_side: cfg.concept.endsWith('_left') ? 'left' : 'right',
    direction: cfg.dir, line_of_scrimmage: cfg.los, ball_y: cfg.ballY, down: cfg.down, to_go: cfg.toGo,
    roster: participantRows, hz: REC_HZ, t0: 0, stride, frames: frameObjects, trajectories,
    events, terminal, resolved: !!terminal, failure: terminal ? null : { reason: 'simulation_time_cap', time_limit_seconds: MAX_SECONDS },
    carrier_id: carrier?.id ?? null, carrier_team: carrierTeam, tackle_id: terminal?.reason === 'sack' || terminal?.reason === 'tackle' || terminal?.reason === 'interception_return' ? tackle?.tackler.id ?? null : null,
    blockers: blockParticipants, topSpeed: world.players.reduce((best, p) => p.topSpeed > best.speed ? { player_id: p.id, speed_mps: p.topSpeed } : best, { player_id: null, speed_mps: 0 }),
    provenance: {
      execution: 'snap-to-whistle observations, route landmarks, ball flight and physical contact',
      allowed_decision_inputs: ['declared quick-pass concept and coverage', 'down, distance and starting field position', 'player roles, physical profiles, ratings and snap positions', 'current simulated player and ball state'],
      outcome_inputs: [],
      result_provenance: 'generated_from_agent_actions_and_physics',
    },
  };
}
