// Prospective, snap-to-whistle inside-zone execution. This module deliberately
// does not import the historical play director or Week 7 outcome sampler.
// Controllers read only the current World state plus declared pre-snap setup.
import { DT, FIELD_W_YD, REC_HZ, YD } from './constants.js';
import { rng } from './rng.js';
import { AERO, solveLaunch } from './ball.js';
import { Player, POSE, World } from './world.js';

const MAX_SECONDS = 12;
const ARM_TACKLE_REACH = 0.12;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (x, y) => {
  const n = Math.hypot(x, y);
  return n > 1e-9 ? { x: x / n, y: y / n } : { x: 0, y: 0 };
};
const ALLOWED = new Set([
  'seed', 'los', 'dir', 'ballY', 'runSide', 'front', 'ratingOverrides',
  'playerIds', 'initialPositions', 'preSnapVelocity', 'massOverrides',
]);
const RATING_NAMES = new Set([
  'SPD', 'ACC', 'AGI', 'STR', 'AWR', 'RBK', 'IBL', 'PBK', 'BSH', 'PMV',
  'FMV', 'TAK', 'BTK', 'ELU', 'BCV', 'TRK', 'PUR', 'CAR', 'PRC',
  'THP', 'SAC', 'MAC', 'DAC', 'TUP', 'CTH', 'CIT', 'SPC', 'JMP', 'RTE', 'MCV', 'ZCV',
]);

const OFFENSE = [
  ['QB', 'QB'], ['RB', 'RB'], ['LT', 'OL'], ['LG', 'OL'], ['C', 'OL'],
  ['RG', 'OL'], ['RT', 'OL'], ['TE', 'TE'], ['WR1', 'WR'], ['WR2', 'WR'],
  ['WR3', 'WR'],
];

const DEFENSE = {
  even: [
    ['LDE', 'DL'], ['LDT', 'DL'], ['RDT', 'DL'], ['RDE', 'DL'],
    ['WILL', 'LB'], ['MIKE', 'LB'], ['SAM', 'LB'],
    ['LCB', 'DB'], ['RCB', 'DB'], ['SS', 'DB'], ['FS', 'DB'],
  ],
  over: [
    ['LDE', 'DL'], ['LDT', 'DL'], ['RDT', 'DL'], ['RDE', 'DL'],
    ['WILL', 'LB'], ['MIKE', 'LB'], ['SAM', 'LB'],
    ['LCB', 'DB'], ['RCB', 'DB'], ['SS', 'DB'], ['FS', 'DB'],
  ],
  under: [
    ['LDE', 'DL'], ['LDT', 'DL'], ['RDT', 'DL'], ['RDE', 'DL'],
    ['WILL', 'LB'], ['MIKE', 'LB'], ['SAM', 'LB'],
    ['LCB', 'DB'], ['RCB', 'DB'], ['SS', 'DB'], ['FS', 'DB'],
  ],
  nickel: [
    ['LDE', 'DL'], ['LDT', 'DL'], ['RDT', 'DL'], ['RDE', 'DL'],
    ['WILL', 'LB'], ['MIKE', 'LB'],
    ['LCB', 'DB'], ['RCB', 'DB'], ['NB', 'DB'], ['SS', 'DB'], ['FS', 'DB'],
  ],
  odd: [
    ['LDE', 'DL'], ['NT', 'DL'], ['RDE', 'DL'],
    ['LOLB', 'LB'], ['ROLB', 'LB'], ['WILL', 'LB'], ['MIKE', 'LB'],
    ['LCB', 'DB'], ['RCB', 'DB'], ['SS', 'DB'], ['FS', 'DB'],
  ],
  bear: [
    ['LDE', 'DL'], ['LDT', 'DL'], ['NT', 'DL'], ['RDT', 'DL'], ['RDE', 'DL'],
    ['WILL', 'LB'], ['MIKE', 'LB'],
    ['LCB', 'DB'], ['RCB', 'DB'], ['SS', 'DB'], ['FS', 'DB'],
  ],
};

const ARCH = {
  QB:  { mass: 101, height: 1.88, radius: 0.315, vmax: 8.55, f0: 1040, drive: 690, alat: 7.25, reach: 3.18 },
  RB:  { mass: 96, height: 1.80, radius: 0.306, vmax: 9.30, f0: 1080, drive: 670, alat: 8.65, reach: 3.14 },
  OL:  { mass: 137, height: 1.96, radius: 0.350, vmax: 7.55, f0: 1210, drive: 1010, alat: 5.95, reach: 3.27 },
  TE:  { mass: 112, height: 1.93, radius: 0.326, vmax: 8.72, f0: 1190, drive: 850, alat: 7.15, reach: 3.22 },
  WR:  { mass: 91, height: 1.84, radius: 0.302, vmax: 9.48, f0: 1040, drive: 630, alat: 8.35, reach: 3.13 },
  DL:  { mass: 131, height: 1.91, radius: 0.346, vmax: 8.06, f0: 1250, drive: 1040, alat: 6.05, reach: 3.25 },
  LB:  { mass: 109, height: 1.87, radius: 0.322, vmax: 9.02, f0: 1160, drive: 790, alat: 7.45, reach: 3.20 },
  DB:  { mass: 91, height: 1.83, radius: 0.303, vmax: 9.55, f0: 1030, drive: 640, alat: 8.30, reach: 3.12 },
};

const BASE_RATINGS = {
  QB: { SPD: 68, ACC: 68, AGI: 70, STR: 58, AWR: 72, RBK: 42, TAK: 42, BTK: 58, ELU: 64, THP: 88, SAC: 75, MAC: 70, DAC: 65, TUP: 70 },
  RB: { SPD: 83, ACC: 82, AGI: 84, STR: 66, AWR: 68, BCV: 78, CAR: 78, RBK: 50, BTK: 72, ELU: 79, TRK: 66, CTH: 65, CIT: 55, SPC: 60, JMP: 60, RTE: 65 },
  OL: { SPD: 55, ACC: 58, AGI: 58, STR: 79, AWR: 68, RBK: 76, IBL: 77, TAK: 42, BTK: 42, ELU: 42 },
  TE: { SPD: 72, ACC: 72, AGI: 70, STR: 69, AWR: 66, RBK: 73, IBL: 72, TAK: 48, BTK: 61, ELU: 59, CTH: 74, CIT: 75, SPC: 70, JMP: 72, RTE: 72 },
  WR: { SPD: 82, ACC: 82, AGI: 84, STR: 53, AWR: 63, RBK: 52, IBL: 50, TAK: 45, BTK: 50, ELU: 65, CTH: 78, CIT: 70, SPC: 75, JMP: 75, RTE: 80 },
  DL: { SPD: 70, ACC: 68, AGI: 65, STR: 80, AWR: 68, BSH: 75, PMV: 72, FMV: 72, TAK: 74, RBK: 42, BTK: 42, ELU: 42 },
  LB: { SPD: 76, ACC: 76, AGI: 76, STR: 67, AWR: 72, BSH: 68, TAK: 73, PUR: 74, RBK: 42, BTK: 42, ELU: 42, JMP: 68, MCV: 60, ZCV: 68 },
  DB: { SPD: 84, ACC: 82, AGI: 84, STR: 55, AWR: 67, BSH: 58, TAK: 66, PUR: 73, RBK: 42, BTK: 42, ELU: 42, JMP: 72, MCV: 74, ZCV: 74, CTH: 62, CIT: 66 },
};

function roleKey(team, role) { return `${team}.${role}`; }
function blockSkill(rating) { return 0.75 + (0.5 * ((rating ?? 60) - 50)) / 50; }

function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('scenario must be an object');
  for (const key of Object.keys(input)) {
    if (!ALLOWED.has(key)) throw new TypeError(`unsupported scenario input: ${key}; autonomous plays accept no realized outcome fields`);
  }
  const cfg = {
    seed: input.seed ?? 'inside-zone-demo-1',
    los: input.los ?? 35,
    dir: input.dir ?? 1,
    ballY: input.ballY ?? FIELD_W_YD / 2,
    runSide: input.runSide ?? 'left',
    front: input.front ?? 'even',
    ratingOverrides: input.ratingOverrides ?? {},
    playerIds: input.playerIds ?? {},
    initialPositions: input.initialPositions ?? {},
    preSnapVelocity: input.preSnapVelocity ?? {},
    massOverrides: input.massOverrides ?? {},
  };
  if (!Number.isFinite(cfg.los) || cfg.los < 1 || cfg.los > 99) throw new RangeError('los must be between 1 and 99 yards');
  if (cfg.dir !== 1 && cfg.dir !== -1) throw new RangeError('dir must be 1 or -1');
  if (!Number.isFinite(cfg.ballY) || cfg.ballY < 1 || cfg.ballY > FIELD_W_YD - 1) throw new RangeError('ballY must be inside the field');
  if (!['left', 'right'].includes(cfg.runSide)) throw new RangeError('runSide must be left or right');
  if (!Object.hasOwn(DEFENSE, cfg.front)) throw new RangeError(`unsupported defensive front: ${cfg.front}`);
  if (typeof cfg.seed !== 'string' && !Number.isInteger(cfg.seed)) throw new TypeError('seed must be a string or integer');
  for (const [label, value] of [['ratingOverrides', cfg.ratingOverrides], ['playerIds', cfg.playerIds], ['initialPositions', cfg.initialPositions], ['preSnapVelocity', cfg.preSnapVelocity], ['massOverrides', cfg.massOverrides]]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object keyed by role ID`);
  }
  const roles = allRoleKeys(cfg.front);
  for (const label of ['ratingOverrides', 'playerIds', 'initialPositions', 'preSnapVelocity', 'massOverrides']) {
    for (const key of Object.keys(cfg[label])) if (!roles.has(key)) throw new TypeError(`${label} contains unknown role ID ${key}`);
  }
  for (const [key, patch] of Object.entries(cfg.ratingOverrides)) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError(`ratings for ${key} must be an object`);
    for (const [name, value] of Object.entries(patch)) {
      if (!RATING_NAMES.has(name)) throw new TypeError(`unsupported rating ${name} for ${key}`);
      if (!Number.isFinite(value) || value < 1 || value > 99) throw new RangeError(`${key}.${name} must be from 1 to 99`);
    }
  }
  for (const [key, id] of Object.entries(cfg.playerIds)) if (typeof id !== 'string' || !id.trim()) throw new TypeError(`playerIds.${key} must be a non-empty string`);
  const ids = Object.values(cfg.playerIds);
  if (new Set(ids).size !== ids.length) throw new TypeError('playerIds must be unique');
  for (const [key, p] of Object.entries(cfg.initialPositions)) {
    if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some((v) => !['x', 'y'].includes(v))) throw new TypeError(`initialPositions.${key} must contain only x and y`);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < -10 || p.x > 110 || p.y < -2 || p.y > FIELD_W_YD + 2) throw new RangeError(`initialPositions.${key} is outside the field`);
  }
  for (const [key, v] of Object.entries(cfg.preSnapVelocity)) {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((name) => !['x', 'y'].includes(name))) throw new TypeError(`preSnapVelocity.${key} must contain only x and y`);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || Math.hypot(v.x, v.y) > 12) throw new RangeError(`preSnapVelocity.${key} must be finite and no faster than 12 yd/s`);
  }
  for (const [key, mass] of Object.entries(cfg.massOverrides)) {
    if (!Number.isFinite(mass) || mass < 50 || mass > 200) throw new RangeError(`${key} mass must be between 50 and 200 kg`);
  }
  return cfg;
}

function allRoleKeys(front) {
  return new Set([
    ...OFFENSE.map(([role]) => roleKey('O', role)),
    ...DEFENSE[front].map(([role]) => roleKey('D', role)),
  ]);
}

function makeSpecs(cfg) {
  const side = cfg.runSide === 'left' ? 1 : -1;
  const specs = [];
  const add = (team, role, archetype, f, l, group) => specs.push({
    id: cfg.playerIds[roleKey(team, role)] || roleKey(team, role), team, role,
    roleKey: roleKey(team, role), archetype, group, f, l,
  });
  // Positive local lateral is the offense's left, matching play.js.
  const ol = { LT: 2.25, LG: 1.12, C: 0, RG: -1.12, RT: -2.25 };
  for (const [role, archetype] of OFFENSE) {
    let f = -0.28, l = ol[role] ?? 0;
    if (role === 'QB') f = -1.85;
    if (role === 'RB') { f = -4.25; l = -side * 1.35; }
    if (role === 'TE') { f = -0.35; l = side * 4.1; }
    if (role === 'WR1') { f = -0.65; l = 16; }
    if (role === 'WR2') { f = -0.65; l = -16; }
    if (role === 'WR3') { f = -0.65; l = side * 22; }
    add('O', role, archetype, f, l, archetype);
  }
  for (const [role, group] of DEFENSE[cfg.front]) {
    const pos = defensePosition(role, group, cfg.front, side);
    add('D', role, group, pos.f, pos.l, group);
  }
  return specs;
}

function defensePosition(role, group, front, side) {
  if (group === 'DL') {
    if (front === 'odd') {
      return { f: role === 'NT' ? 0.48 : 0.38, l: role === 'NT' ? 0 : role === 'LDE' ? 1.65 : -1.65 };
    }
    if (front === 'bear') {
      const l = { LDE: 4.45, LDT: 2.15, NT: 0, RDT: -2.15, RDE: -4.45 }[role];
      return { f: role.endsWith('DE') ? 0.75 : 0.42, l };
    }
    let left = 1.2, right = -1.2;
    if (front === 'over') { left = side > 0 ? 0.6 : 1.75; right = side > 0 ? -1.75 : -0.6; }
    if (front === 'under') { left = side > 0 ? 1.75 : 0.6; right = side > 0 ? -0.6 : -1.75; }
    const l = { LDE: 4.55, LDT: left, RDT: right, RDE: -4.55 }[role];
    return { f: role.endsWith('DE') ? 0.72 : 0.40, l };
  }
  if (group === 'LB') {
    const slots = front === 'odd'
      ? { LOLB: [-4.1, 3.0], ROLB: [4.1, 3.0], WILL: [-1.35, 3.1], MIKE: [1.15, 3.0] }
      : front === 'bear'
        ? { WILL: [-2.2, 3.0], MIKE: [2.2, 3.0] }
        : front === 'nickel'
          ? { WILL: [-2.25, 3.0], MIKE: [1.75, 3.0] }
          : { WILL: [-2.4, 3.05], MIKE: [0, 3.05], SAM: [2.4, 3.05] };
    const [l, f] = slots[role];
    return { f, l };
  }
  if (role === 'LCB') return { f: 6.2, l: 15.6 };
  if (role === 'RCB') return { f: 6.2, l: -15.6 };
  if (role === 'NB') return { f: 4.8, l: 5.5 * side };
  if (role === 'SS') return { f: 8.7, l: 5.5 * side };
  return { f: 11.2, l: -2.5 * side };
}

function ratingProfile(spec, cfg) {
  const r = { ...BASE_RATINGS[spec.archetype], ...(cfg.ratingOverrides[spec.roleKey] || {}) };
  // Ratings shape capacity as bounded archetype adjustments. These values are
  // authored sandbox inputs, not claimed as measured forces or calibrated NFL physics.
  const base = ARCH[spec.archetype];
  const physics = {
    ...base,
    mass: cfg.massOverrides[spec.roleKey] ?? base.mass,
    vmax: base.vmax * (0.84 + 0.0032 * (r.SPD ?? 60)),
    f0: base.f0 * (0.80 + 0.0040 * (r.ACC ?? 60)),
    drive: base.drive * (0.78 + 0.0044 * (r.STR ?? 60)),
    alat: base.alat * (0.82 + 0.0036 * (r.AGI ?? 60)),
  };
  return { r, physics };
}

export function createInsideZoneRoster(options = {}) {
  const cfg = validateConfig(options);
  return makeSpecs(cfg).map((spec, index) => {
    const { r, physics } = ratingProfile(spec, cfg);
    return {
      id: spec.id, roleKey: spec.roleKey, team: spec.team, slot: spec.role,
      role: spec.archetype, group: spec.group,
      name: `${spec.team === 'O' ? 'Offense' : 'Defense'} ${spec.role}`,
      jersey: String((index * 7 + (spec.team === 'O' ? 10 : 20)) % 99 + 1),
      ratings: r, physics,
    };
  });
}

export function simulateInsideZone(options = {}) {
  const cfg = validateConfig(options);
  const rand = rng(cfg.seed);
  const rosterInfo = createInsideZoneRoster(cfg);
  const W = new World(rand);
  const dir = cfg.dir;
  const side = cfg.runSide === 'left' ? 1 : -1;
  const at = (f, l) => ({ x: (cfg.los + dir * f) * YD, y: (cfg.ballY + dir * l) * YD });
  const fOf = (p) => (p.p.x / YD - cfg.los) * dir;
  const lOf = (p) => (p.p.y / YD - cfg.ballY) * dir;
  const d2 = (a, b) => dist(a.p, b.p);
  const byRole = new Map();
  const offense = [], defense = [];
  const roster = [];
  const specsByRole = new Map(makeSpecs(cfg).map((spec) => [spec.roleKey, spec]));
  for (const info of rosterInfo) {
    const p = W.add(new Player(info, info.team, info.slot));
    p.roleKey = info.roleKey;
    const spec = specsByRole.get(info.roleKey);
    const pos = cfg.initialPositions[info.roleKey] || { x: cfg.los + dir * spec.f, y: cfg.ballY + dir * spec.l };
    p.p = { x: pos.x * YD, y: pos.y * YD };
    const vel = cfg.preSnapVelocity[info.roleKey] || { x: 0, y: 0 };
    p.v = { x: vel.x * YD, y: vel.y * YD };
    p.h = info.team === 'O' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI : 0);
    const blockRating = info.team === 'O' ? (p.R.RBK ?? p.R.IBL) : (p.R.BSH ?? Math.max(p.R.PMV ?? 50, p.R.FMV ?? 50));
    p.engageMul = blockSkill(blockRating) * (0.8 + 0.2 * (p.R.STR ?? 60) / 80);
    p.pose = ['LT', 'LG', 'C', 'RG', 'RT', 'LDE', 'LDT', 'RDT', 'RDE', 'NT'].includes(info.slot) ? POSE.STANCE : POSE.RUN;
    p.ai.assignment = 'align';
    p.ai.decision = 'read snap';
    byRole.set(info.roleKey, p);
    (info.team === 'O' ? offense : defense).push(p);
    roster.push({ id: p.id, team: p.team, slot: p.slot, roleKey: p.roleKey });
  }
  const get = (key) => byRole.get(key);
  const center = get('O.C'), qb = get('O.QB'), rb = get('O.RB');
  const ballAtSnap = at(0, 0);
  Object.assign(W.ball, { x: ballAtSnap.x, y: ballAtSnap.y, z: 0.15, state: 'held', holder: center, hand: 'chest' });
  center.hasBall = true;

  const setIntent = (p, assignment, decision) => {
    if (p.ai.assignment === assignment && p.ai.decision === decision) return;
    p.ai.assignment = assignment;
    p.ai.decision = decision;
    W.event('decision', { player_id: p.id, role: p.roleKey, assignment, decision });
  };
  const pointAhead = (p, yards, lateral = 0) => ({ x: p.p.x + dir * yards * YD, y: p.p.y + dir * lateral * YD });
  const seek = (p, target, fraction = 1, decel = 7) => {
    const dx = target.x - p.p.x, dy = target.y - p.p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.04) return { x: 0, y: 0 };
    const speed = Math.min(p.vmax * fraction, Math.sqrt(2 * decel * d));
    return { x: dx / d * speed, y: dy / d * speed };
  };
  const lead = (p, q, scale = 0.32) => ({ x: q.p.x + q.v.x * scale, y: q.p.y + q.v.y * scale });
  const blockRows = [];
  const activeBlock = new Map();
  const originalEngage = W.engage.bind(W);
  const originalDisengage = W.disengage.bind(W);
  W.engage = (a, b) => {
    const before = a.engaged || b.engaged;
    originalEngage(a, b);
    if (!before && a.engaged === b && a.team !== b.team) {
      const blocker = a.team === 'O' ? a : b;
      const target = blocker === a ? b : a;
      W.event('contact', { player_id: blocker.id, opponent_id: target.id });
      if (['OL', 'TE', 'WR'].includes(blocker.info.group)) {
        const row = { blocker, defender: target, start: W.t, end: null, minDefF: fOf(target), maxDefF: fOf(target) };
        blockRows.push(row);
        activeBlock.set(blocker.id, row);
        W.event('block_engage', { blocker_id: blocker.id, defender_id: target.id });
      }
    }
  };
  W.disengage = (e, shedder) => {
    if (!e) return;
    const blocker = e.a.team === 'O' ? e.a : e.b.team === 'O' ? e.b : null;
    const row = blocker ? activeBlock.get(blocker.id) : null;
    if (row && row.end == null) {
      row.end = W.t;
      activeBlock.delete(blocker.id);
      W.event('block_release', { blocker_id: blocker.id, defender_id: row.defender.id, by: shedder?.id ?? null });
    }
    originalDisengage(e, shedder);
  };

  for (const p of offense) {
    if (['LT', 'LG', 'C', 'RG', 'RT'].includes(p.slot)) {
      p.ai.zoneL = ({ LT: 2.25, LG: 1.12, C: 0, RG: -1.12, RT: -2.25 })[p.slot];
      setIntent(p, `inside-zone ${p.slot} track`, 'step laterally and identify first-level threat');
    } else if (p === rb) setIntent(p, 'press inside-zone aiming point', 'meet the quarterback at the mesh');
    else if (p === qb) setIntent(p, 'secure snap and handoff', 'receive snap, then sell backside keep');
    else if (p.slot === 'TE') setIntent(p, 'seal the play-side edge', 'read edge defender leverage');
    else setIntent(p, 'stalk assigned perimeter defender', 'close space without looking past the live defender');
  }
  for (const p of defense) {
    if (p.info.group === 'DL') {
      p.ai.gapL = lOf(p);
      setIntent(p, `attack ${gapName(p.ai.gapL, side)} gap`, 'read the backfield and control assigned gap');
    } else if (p.info.group === 'LB') {
      p.ai.gapL = ({ WILL: -2.1, MIKE: 0, SAM: 2.1, LOLB: -3.5, ROLB: 3.5 })[p.slot] ?? 0;
      setIntent(p, `fit ${gapName(p.ai.gapL, side)} gap`, 'key the guard and stay square');
    } else {
      setIntent(p, p.slot === 'FS' ? 'deep run support' : p.slot === 'SS' ? 'alley run support' : 'outside contain', 'read receiver, then fit the run');
    }
  }

  const qbMesh = at(-3.05, side * 0.18);
  const rbMesh = at(-2.72, -side * 0.12);
  let snapped = false, snapArrive = null, handed = false, carrier = null, carrierSince = null;
  let tackle = null, terminal = null;
  let lastInBounds = { x: ballAtSnap.x, y: ballAtSnap.y };
  let maxForward = null;
  const samples = new Map(roster.map((r) => [r.id, []]));
  const frames = [];
  let nextRecord = 0;

  function record() {
    const f = new Float32Array(roster.length * 6 + 6);
    let o = 0;
    for (const p of W.players) {
      f[o++] = p.p.x / YD; f[o++] = p.p.y / YD; f[o++] = p.h;
      f[o++] = p.speed; f[o++] = p.down ? POSE.DOWN : p.pose; f[o++] = p.hasBall ? 1 : 0;
      samples.get(p.id).push({
        t: W.t, x: p.p.x / YD, y: p.p.y / YD, vx: p.v.x / YD, vy: p.v.y / YD,
        heading: p.h, speed: p.speed / YD, hasBall: p.hasBall,
        assignment: p.ai.assignment, decision: p.ai.decision,
        assignment_target: p.ai.blockOn?.roleKey ?? null,
        engaged_with: p.engaged?.roleKey ?? null,
        lane_local_yards: p === rb ? p.ai.lane ?? null : null,
        lane_locked: p === rb ? !!p.ai.laneLocked : false,
      });
    }
    f[o++] = W.ball.x / YD; f[o++] = W.ball.y / YD; f[o++] = W.ball.z;
    f[o++] = W.ball.spin;
    f[o++] = W.ball.state === 'air' || W.ball.state === 'snap' ? Math.atan2(W.ball.vy, W.ball.vx) : W.ball.rot || 0;
    f[o++] = W.ball.state === 'air' || W.ball.state === 'snap' ? Math.atan2(W.ball.vz, Math.hypot(W.ball.vx, W.ball.vy)) : 0;
    frames.push(f);
  }

  function closest(list, from, filter = () => true) {
    let best = null, bestD = Infinity;
    for (const q of list) {
      if (!filter(q)) continue;
      const d = d2(from, q);
      if (d < bestD || (d === bestD && q.id < best?.id)) { best = q; bestD = d; }
    }
    return best;
  }

  for (const p of defense.filter((player) => player.info.group === 'DB')) {
    p.ai.snapL = lOf(p);
    p.ai.outsideSign = Math.sign(p.ai.snapL) || (p.slot === 'LCB' || p.slot === 'NB' ? 1 : -1);
    if (p.slot === 'LCB' || p.slot === 'RCB') {
      p.ai.coveredWR = closest(offense, p, (q) => q.info.group === 'WR');
    }
    const baseDelay = p.slot === 'NB' ? 0.18 : p.slot === 'SS' ? 0.28
      : p.slot === 'FS' ? 0.48 : 0.34;
    const recognition = p.R.PRC ?? p.R.AWR ?? 60;
    p.ai.runReadDelay = clamp(baseDelay + (68 - recognition) * 0.003, baseDelay - 0.08, baseDelay + 0.14);
  }

  function chooseBlockTarget(p) {
    const lane = p.slot === 'TE' ? side * 4.3 : p.slot.startsWith('WR') ? lOf(p) : p.ai.zoneL + side * 0.18;
    const current = p.ai.blockOn;
    const perimeterBlocker = p.info.group === 'WR';
    const targetScore = (q) => {
      const lateral = Math.abs(lOf(q) - lane);
      const forward = Math.abs(fOf(q) - 0.45);
      if (perimeterBlocker) {
        // Receivers stalk the leverage defender outside the box. Sending them
        // after the nearest free lineman creates a long, unrealistic inward
        // sprint and leaves the perimeter support defender untouched.
        const groupPenalty = q.info.group === 'DB' ? 0 : 1.15;
        const depthPenalty = ['FS', 'SS'].includes(q.slot) ? 0.45 : 0;
        return Math.hypot(lateral, forward * 0.62) + groupPenalty + depthPenalty;
      }
      return lateral + forward * 0.24;
    };
    if (current && !current.down && (!current.engaged || current.engaged === p)) {
      const currentScore = targetScore(current);
      if (currentScore < 3.2) return current;
    }
    if (perimeterBlocker) {
      const perimeter = defense.filter((q) => ['DB', 'LB'].includes(q.info.group)
        && !q.down && (!q.engaged || q.engaged === p)
        && fOf(q) > -2.5 && fOf(q) < 12
        && Math.abs(lOf(q) - lane) < 10);
      if (perimeter.length) {
        return perimeter.map((q) => [targetScore(q), q])
          .sort((a, b) => a[0] - b[0] || a[1].id.localeCompare(b[1].id))[0][1];
      }
      return null;
    }
    const freeDL = defense.filter((q) => q.info.group === 'DL' && !q.down && !q.engaged && fOf(q) > -2.5 && fOf(q) < 3.7);
    const freeLB = defense.filter((q) => q.info.group === 'LB' && !q.down && !q.engaged && fOf(q) > -1.5 && fOf(q) < 5.0);
    const pool = freeDL.length ? freeDL : freeLB.length ? freeLB : defense.filter((q) => !q.down && !q.engaged);
    if (!pool.length) return null;
    const scored = pool.map((q) => {
      let score = Math.abs(lOf(q) - lane) + Math.abs(fOf(q) - 0.45) * 0.28;
      if (q.info.group === 'LB') score += freeDL.length ? 2.2 : 0.1;
      if (q.slot === 'FS') score += 0.7;
      return [score, q];
    }).sort((a, b) => a[0] - b[0] || a[1].id.localeCompare(b[1].id));
    return scored[0][1];
  }

  function engageBlocker(p, d) {
    if (!d || p.engaged || d.engaged || p.down || d.down) return;
    if (d2(p, d) <= p.r + d.r + 0.15) W.engage(p, d);
  }

  function tryShed(d) {
    const e = W.engagements.find((x) => x.a === d || x.b === d);
    if (!e) return;
    const blocker = e.a === d ? e.b : e.a;
    const attack = d.info.group === 'DL' ? Math.max(d.R.PMV ?? 50, d.R.FMV ?? 50, d.R.BSH ?? 50) : d.R.BSH ?? 50;
    const block = blocker.R.RBK ?? blocker.R.IBL ?? 50;
    const rate = clamp(0.12 * Math.exp((attack - block) / 24), 0.025, 1.6);
    if (rand() < rate * DT) W.disengage(e, d);
  }

  function laneScores() {
    const currentL = lOf(rb);
    // Read the spaces between linemen (A/B/C tracks), not the blocker centers.
    const lanes = [-2.65, -1.68, -0.58, 0.58, 1.68, 2.65];
    const scored = lanes.map((lane) => {
      let threat = 0, support = 0;
      for (const q of defense) {
        if (q.down) continue;
        const forward = fOf(q) - fOf(rb);
        if (forward < -0.65 || forward > 4.4) continue;
        const lateral = Math.abs(lOf(q) - lane);
        if (lateral > 2.2) continue;
        const blockFactor = q.engaged?.team === 'O' ? 0.24 : 1;
        threat += Math.max(0, 1 - lateral / 2.2) * Math.max(0.18, 1 - Math.max(0, forward - 2.2) / 3.8) * blockFactor;
      }
      for (const q of offense) {
        if (q === rb || q === qb || !q.engaged || q.engaged.team !== 'D') continue;
        const forward = fOf(q) - fOf(rb);
        if (forward >= -0.5 && forward <= 3.5 && Math.abs(lOf(q) - lane) < 2.0) support += 1;
      }
      const cutCost = Math.abs(lane - currentL) * (0.60 - (rb.R.AGI ?? 60) * 0.0021);
      const readSkill = 0.78 + (rb.R.BCV ?? 60) * 0.003;
      const playsideBias = -side * lane * 0.16;
      return { lane, score: threat * 1.9 * readSkill - support * 0.58 + cutCost + playsideBias };
    }).sort((a, b) => a.score - b.score || Math.abs(a.lane - side * 1.15) - Math.abs(b.lane - side * 1.15));
    return scored;
  }

  function pickLane() {
    return laneScores()[0]?.lane ?? side * 1.15;
  }

  function laneSwitchHasAdvantage(nextLane, threshold = 0.55) {
    if (rb.ai.lane == null || nextLane === rb.ai.lane) return true;
    const scores = laneScores();
    const current = scores.find((row) => row.lane === rb.ai.lane);
    const next = scores.find((row) => row.lane === nextLane);
    return !!current && !!next && current.score - next.score >= threshold;
  }

  function startTackle(d, contactSource = 'body') {
    if (terminal || tackle || !carrier || d.team === carrier.team || d.engaged) return;
    W.event('tackle_contact', {
      defender_id: d.id, carrier_id: carrier.id, source: contactSource,
      distance_meters: d2(d, carrier),
    });
    const closing = Math.hypot(d.v.x - carrier.v.x, d.v.y - carrier.v.y) / YD;
    const tak = d.R.TAK ?? 60;
    const btk = Math.max(carrier.R.BTK ?? 55, carrier.R.ELU ?? 55);
    const strength = (d.R.STR ?? 55) - (carrier.R.STR ?? 55);
    const finish = clamp(0.43 + (tak - btk) * 0.006 + strength * 0.0015 + closing * 0.027, 0.08, 0.92);
    d.ai.lastTackleAttempt = W.t;
    if (rand() < finish) {
      tackle = { tackler: d, carrier, t0: W.t };
      d.mode = 'tackling'; carrier.mode = 'tackled';
      d.pose = POSE.WRAP; carrier.pose = POSE.WRAP;
      W.wrap(d, carrier, { fall: 0.48, keepCarrier: 0.22 });
      setIntent(d, 'finish tackle', 'wrap the carrier and drive through contact');
      setIntent(carrier, 'protect football', 'fight through contact and keep forward progress');
    } else {
      d.stumble = 0.24;
      d.ai.missUntil = W.t + 1.0;
      carrier.stumble = 0.10;
      W.event('broken_tackle', { defender_id: d.id, carrier_id: carrier.id, closing_speed: closing });
      setIntent(d, 'recover pursuit angle', 'regain balance after the carrier escaped contact');
    }
  }

  W.onTouch = (a, b) => {
    if (!carrier || tackle || terminal || (a !== carrier && b !== carrier)) return;
    const d = a === carrier ? b : a;
    if (d.team !== carrier.team && !d.down && !d.engaged && (d.ai.missUntil ?? 0) <= W.t) startTackle(d);
  };

  function rbBrain(p) {
    if (!handed) {
      p.dv = seek(p, rbMesh, 0.82, 8);
      p.face = Math.atan2(rbMesh.y - p.p.y, rbMesh.x - p.p.x);
      setIntent(p, 'press inside-zone aiming point', 'cross to the mesh point and secure the handoff');
      return;
    }
    if (tackle) {
      p.dv = { x: p.v.x, y: p.v.y };
      return;
    }
    const forward = fOf(p);
    if (p.ai.nextRead == null || W.t >= p.ai.nextRead) {
      const next = pickLane();
      if (p.ai.lane == null || (!p.ai.laneLocked && W.t >= (p.ai.laneHoldUntil ?? 0)
          && Math.abs(next - p.ai.lane) > 0.8 && laneSwitchHasAdvantage(next))) {
        p.ai.lane = next;
        p.ai.laneHoldUntil = W.t + 0.18;
        W.event('lane_read', { carrier_id: p.id, lane_local_yards: next, time: W.t });
      }
      if (forward >= 0.8) p.ai.laneLocked = true;
      const readInterval = clamp(0.19 - (p.R.AWR ?? 60) * 0.0011, 0.075, 0.16);
      p.ai.nextRead = W.t + (forward < 0.7 ? readInterval : readInterval * 1.25);
    }
    const press = forward < 0.65 && W.t - carrierSince < 0.55;
    const lane = press ? side * 0.58 : (p.ai.lane ?? side * 0.58);
    const target = { x: p.p.x + dir * (press ? 1.25 : 2.1) * YD, y: (cfg.ballY + dir * lane) * YD };
    let dv = seek(p, target, 1, 6.6);
    // React to defenders already in the near collision envelope. The lane read
    // is re-scored from live positions rather than following a pre-written path.
    const threat = closest(defense, p, (q) => !q.down && fOf(q) >= forward - 0.6 && fOf(q) <= forward + 1.8 && Math.abs(lOf(q) - lOf(p)) < 2.0);
    if (threat && d2(threat, p) < 1.1 && forward > 0.2 && !p.ai.laneLocked && W.t >= (p.ai.laneHoldUntil ?? 0)) {
      const alternate = pickLane();
      if (alternate !== p.ai.lane && Math.abs(alternate - lOf(p)) < 2.8 && laneSwitchHasAdvantage(alternate, 0.3)) {
        p.ai.lane = alternate;
        p.ai.laneHoldUntil = W.t + 0.18;
        W.event('lane_read', { carrier_id: p.id, lane_local_yards: alternate, time: W.t, trigger: 'near defender' });
      }
    }
    p.dv = dv;
    setIntent(p, 'run through selected inside-zone lane', `press ${laneLabel(p.ai.lane ?? lane, side)} and react to the nearest fit`);
  }

  function offenseBrain(p) {
    if (!snapped) { p.dv = { x: 0, y: 0 }; p.face = dir > 0 ? 0 : Math.PI; return; }
    if (p === rb) { rbBrain(p); return; }
    if (p === qb) {
      if (!handed) {
        if (W.ball.holder !== qb) { p.dv = { x: 0, y: 0 }; return; }
        p.dv = seek(p, qbMesh, 0.75, 7);
        p.face = Math.atan2(rb.p.y - p.p.y, rb.p.x - p.p.x);
        setIntent(p, 'secure snap and handoff', 'move to the mesh while tracking the running back');
      } else {
        const fake = at(-4.2, -side * 3.1);
        p.dv = seek(p, fake, 0.55, 5);
        p.face = dir > 0 ? 0 : Math.PI;
        setIntent(p, 'sell backside keep', 'carry out the fake while watching backside pursuit');
      }
      return;
    }
    if (['LT', 'LG', 'C', 'RG', 'RT', 'TE', 'WR1', 'WR2', 'WR3'].includes(p.slot)) {
      if (p.engaged) {
        const d = p.engaged;
        const lane = rb.ai.lane ?? side * 0.58;
        const awayFromLane = lOf(p) < lane ? -1 : 1;
        const push = unit(dir * 0.86, dir * awayFromLane * 0.55);
        p.dv = { x: push.x * 2.0, y: push.y * 2.0 };
        p.face = Math.atan2(d.p.y - p.p.y, d.p.x - p.p.x);
        p.pose = POSE.BLOCK;
        setIntent(p, p.ai.assignment, `drive ${d.slot} away from the declared track`);
        return;
      }
      if (p.ai.nextTargetAt == null || W.t >= p.ai.nextTargetAt || !p.ai.blockOn || p.ai.blockOn.down || p.ai.blockOn.engaged) {
        p.ai.blockOn = chooseBlockTarget(p);
        p.ai.nextTargetAt = W.t + 0.12;
      }
      const d = p.ai.blockOn;
      if (!d) {
        const tgt = pointAhead(p, 1.4, p.slot === 'TE' ? side * 3 : (p.ai.zoneL ?? 0) * 0.5);
        p.dv = seek(p, tgt, 0.68, 7);
        setIntent(p, p.ai.assignment, 'climb to the nearest unblocked level defender');
        return;
      }
      p.ai.assignment = p.slot === 'TE' ? 'seal the play-side edge' : p.info.group === 'WR' ? 'stalk perimeter support' : `zone step ${p.slot}`;
      p.ai.blockOn = d;
      p.dv = seek(p, lead(p, d), p.info.group === 'WR' ? 0.92 : 0.82, 10);
      p.face = Math.atan2(d.p.y - p.p.y, d.p.x - p.p.x);
      setIntent(p, p.ai.assignment, `target live ${d.slot} at current leverage`);
      engageBlocker(p, d);
    }
  }

  function defenseBrain(p) {
    if (!snapped) { p.dv = { x: 0, y: 0 }; p.face = dir > 0 ? Math.PI : 0; return; }
    if (p.engaged) {
      const blocker = p.engaged;
      tryShed(p);
      if (p.engaged) {
        const target = carrier || qb;
        const toward = unit(target.p.x - p.p.x, target.p.y - p.p.y);
        p.dv = { x: toward.x * 1.65, y: toward.y * 1.65 };
        p.face = Math.atan2(toward.y, toward.x);
        p.pose = POSE.BLOCK;
        setIntent(p, `shed block from ${blocker.slot}`, 'work hands free and locate the live ball carrier');
        return;
      }
    }
    if (p.info.group === 'DL') {
      if (carrier) {
        p.dv = seek(p, lead(p, carrier, 0.34), 0.98, 20);
        setIntent(p, `close ${gapName(p.ai.gapL, side)} gap`, `redirect from the mesh to carrier ${carrier.slot}`);
      } else {
        const gap = p.ai.gapL;
        const target = at(0.45, gap);
        p.dv = seek(p, target, 0.82, 12);
        setIntent(p, `attack ${gapName(gap, side)} gap`, 'read the backfield and keep shoulders square');
      }
    } else if (p.info.group === 'LB') {
      const readTime = clamp(0.40 - (p.R.PRC ?? p.R.AWR ?? 60) * 0.003, 0.16, 0.35);
      if (!carrier && W.t < readTime) {
        p.dv = seek(p, at(0.85, p.ai.gapL), 0.42, 6);
        setIntent(p, `fit ${gapName(p.ai.gapL, side)} gap`, 'read the mesh before committing downhill');
      } else {
        const target = carrier ? lead(p, carrier, 0.32) : at(0.55, p.ai.gapL);
        p.dv = seek(p, target, 0.98, 19);
        setIntent(p, `fit ${gapName(p.ai.gapL, side)} gap`, carrier ? 'flow downhill to the observed carrier path' : 'close the line of scrimmage and read the mesh');
      }
    } else {
      const isDeep = p.slot === 'FS';
      const isOutside = p.slot === 'LCB' || p.slot === 'RCB';
      const assignedWR = p.ai.coveredWR;
      const visibleRunCue = W.ball.state === 'held' && W.ball.holder === rb && rb.hasBall
        && (rb.speed / YD > 0.35 || offense.some((q) => q.info.group === 'OL' && fOf(q) > 0.05 && q.speed / YD > 0.45));
      if (visibleRunCue) p.ai.runCueAt ??= W.t;
      if (!p.ai.runRecognized && p.ai.runCueAt != null && W.t - p.ai.runCueAt >= p.ai.runReadDelay) {
        p.ai.runRecognized = true;
        W.event('defensive_run_read', {
          player_id: p.id, role: p.roleKey, observed_at: p.ai.runCueAt,
          reaction_delay_seconds: p.ai.runReadDelay,
        });
      }

      if (!p.ai.runRecognized) {
        if (isOutside && assignedWR && !assignedWR.down) {
          const f = fOf(assignedWR) - 0.45;
          const l = lOf(assignedWR) + p.ai.outsideSign * 0.7;
          p.dv = seek(p, at(f, l), 0.52, 7);
          p.face = Math.atan2(assignedWR.p.y - p.p.y, assignedWR.p.x - p.p.x);
          setIntent(p, 'preserve corner leverage', `key ${assignedWR.slot}; stay outside and read the backfield`);
        } else if (isDeep) {
          p.dv = seek(p, at(8.2, p.ai.snapL * 0.8), 0.30, 5);
          setIntent(p, 'hold safety depth', 'stay high while reading the mesh and offensive line flow');
        } else {
          const supportL = p.slot === 'NB' ? p.ai.snapL * 0.72 : p.ai.snapL * 0.8;
          p.dv = seek(p, at(2.0, supportL), p.slot === 'NB' ? 0.48 : 0.34, 6);
          setIntent(p, 'read run from support alignment', 'key the backfield before triggering downhill');
        }
        return;
      }

      const carrierF = fOf(rb), carrierL = lOf(rb);
      const separationYards = d2(p, rb) / YD;
      const leverage = clamp((separationYards - 0.55) / 3.4, 0, 1);
      const leadScale = (isDeep ? 0.42 : p.slot === 'NB' ? 0.25 : 0.34) * leverage;
      const pursuit = lead(p, rb, leadScale);
      const leadF = (pursuit.x / YD - cfg.los) * dir;
      const leadL = (pursuit.y / YD - cfg.ballY) * dir;
      let targetF, targetL, fraction, assignment, decision;
      if (isOutside) {
        const onRunSide = p.ai.outsideSign * carrierL > 0;
        const ahead = onRunSide ? 0.9 : 2.4;
        const leverageL = onRunSide ? p.ai.outsideSign * 3.4
          : carrierL * 0.55 + p.ai.outsideSign * 0.8 - carrierL;
        targetF = Math.max(carrierF + ahead * leverage, leadF);
        targetL = carrierL + leverageL * leverage;
        fraction = (onRunSide ? 0.78 : 0.62) + 0.25 * (1 - leverage);
        assignment = onRunSide ? 'outside force and contain' : 'backside cutback contain';
        decision = onRunSide
          ? 'close from outside-in and keep the runner inside'
          : 'stay high and preserve backside leverage on the observed path';
      } else if (isDeep) {
        targetF = Math.max(carrierF + 3.0 * leverage, leadF);
        targetL = carrierL + (carrierL * 0.42 + p.ai.snapL * 0.18 - carrierL) * leverage;
        fraction = 0.72 + 0.25 * (1 - leverage);
        assignment = 'top-down safety pursuit';
        decision = 'maintain depth and close the alley from above the runner';
      } else if (p.slot === 'SS') {
        const onRunSide = p.ai.outsideSign * carrierL > 0;
        const ahead = onRunSide ? 0.65 : 1.8;
        const leverageL = onRunSide ? p.ai.outsideSign * 1.9 : carrierL * 0.72 - carrierL;
        targetF = Math.max(carrierF + ahead * leverage, leadF);
        targetL = carrierL + leverageL * leverage;
        fraction = 0.82 + 0.17 * (1 - leverage);
        assignment = onRunSide ? 'strong safety alley fill' : 'strong safety cutback fit';
        decision = onRunSide
          ? 'fit inside the corner force and square to the runner'
          : 'scrape across while preserving the cutback angle';
      } else {
        targetF = Math.max(carrierF + 0.45 * leverage, leadF);
        targetL = carrierL + p.ai.outsideSign * leverage;
        fraction = 0.90 + 0.09 * (1 - leverage);
        assignment = 'nickel force and alley support';
        decision = 'trigger from slot leverage and close the near-side run lane';
      }
      if (leverage < 0.18) {
        assignment = 'close and attempt tackle';
        decision = 'collapse the leverage angle and make contact with the live carrier';
        const toward = unit(rb.p.x - p.p.x, rb.p.y - p.p.y);
        p.dv = { x: toward.x * p.vmax * 0.99, y: toward.y * p.vmax * 0.99 };
        p.face = Math.atan2(rb.p.y - p.p.y, rb.p.x - p.p.x);
        setIntent(p, assignment, decision);
        return;
      }
      p.dv = seek(p, at(targetF, targetL), fraction, isDeep ? 11 : 16);
      p.face = Math.atan2(rb.p.y - p.p.y, rb.p.x - p.p.x);
      setIntent(p, assignment, decision);
    }
  }

  function finish(reason, spot) {
    if (terminal) return;
    terminal = { reason, spot: { x: spot.x / YD, y: clamp(spot.y / YD, 0, FIELD_W_YD) }, time: W.t };
    if (reason === 'tackle' && tackle) {
      carrier.down = true; carrier.pose = POSE.DOWN; carrier.downT = W.t;
      tackle.tackler.down = true; tackle.tackler.pose = POSE.DOWN; tackle.tackler.downT = W.t;
    }
    for (const engagement of [...W.engagements]) W.disengage(engagement);
    if (W.ball.holder) W.ball.holder = null;
    W.ball.state = 'held'; W.ball.x = spot.x; W.ball.y = spot.y; W.ball.z = 0.15;
    W.event('whistle', { reason, ball_spot: terminal.spot });
  }

  function trackForwardProgress() {
    if (!carrier || W.ball.holder !== carrier) return;
    const f = (W.ball.x / YD - cfg.los) * dir;
    if (!maxForward || f > maxForward.f) maxForward = { f, x: W.ball.x, y: W.ball.y };
    const x = W.ball.x / YD;
    if ((dir > 0 && x >= 100) || (dir < 0 && x <= 0)) {
      const goalX = (dir > 0 ? 100 : 0) * YD;
      const spot = { x: goalX, y: W.ball.y };
      W.event('touchdown', { carrier_id: carrier.id, spot: { x: spot.x / YD, y: spot.y / YD } });
      finish('touchdown', spot);
      return;
    }
    if (W.ball.y < 0 || W.ball.y > FIELD_W_YD * YD) {
      const boundaryY = W.ball.y < 0 ? 0 : FIELD_W_YD * YD;
      const dy = W.ball.y - lastInBounds.y;
      const fraction = Math.abs(dy) > 1e-9 ? clamp((boundaryY - lastInBounds.y) / dy, 0, 1) : 0;
      finish('out_of_bounds', {
        x: lastInBounds.x + (W.ball.x - lastInBounds.x) * fraction,
        y: boundaryY,
      });
      return;
    }
    lastInBounds = { x: W.ball.x, y: W.ball.y };
    if ((dir > 0 && x < 0) || (dir < 0 && x > 100)) {
      finish('safety', { x: W.ball.x, y: W.ball.y });
    }
  }

  record();
  nextRecord = 1 / REC_HZ;
  while (W.t < MAX_SECONDS && !terminal) {
    if (!snapped) {
      snapped = true;
      for (const p of W.players) if (p.pose === POSE.STANCE) p.pose = POSE.RUN;
      const from = { x: W.ball.x, y: W.ball.y, z: 0.35 };
      const to = { x: qb.p.x + Math.cos(qb.h) * 0.55, y: qb.p.y + Math.sin(qb.h) * 0.55, z: 1.0 };
      const flight = solveLaunch(from, to, 0.12, AERO.spiral);
      Object.assign(W.ball, {
        state: 'snap', holder: null, x: from.x, y: from.y, z: from.z,
        vx: flight.vx, vy: flight.vy, vz: flight.vz, k: flight.k,
      });
      snapArrive = W.t + 0.12;
      W.event('snap', { play_call: 'inside_zone', front: cfg.front, run_side: cfg.runSide, to: qb.id });
    }
    if (W.ball.state === 'snap' && W.t >= snapArrive) {
      W.ball.state = 'held';
      W.ball.holder = qb;
      W.ball.hand = 'chest';
      center.hasBall = false;
      qb.hasBall = true;
      W.event('snap_receive', { quarterback_id: qb.id });
    }
    if (!handed && W.ball.holder === qb && W.t > 0.12 && d2(qb, rb) < 1.28) {
      handed = true; carrier = rb; carrierSince = W.t;
      qb.hasBall = false; rb.hasBall = true; rb.mode = 'carry';
      W.ball.holder = rb; W.ball.hand = 'carry';
      W.event('handoff', { from: qb.id, to: rb.id });
      setIntent(rb, 'press inside-zone aiming point', 'secure handoff and read the first-level front');
    }
    W.step(DT, (p) => p.team === 'O' ? offenseBrain(p) : defenseBrain(p));
    for (const row of activeBlock.values()) {
      row.minDefF = Math.min(row.minDefF, fOf(row.defender));
      row.maxDefF = Math.max(row.maxDefF, fOf(row.defender));
    }
    trackForwardProgress();
    if (!terminal && !tackle && carrier) {
      for (const defender of defense) {
        if (defender.down || defender.engaged || (defender.ai.missUntil ?? 0) > W.t) continue;
        if (d2(defender, carrier) <= defender.r + carrier.r + ARM_TACKLE_REACH) {
          startTackle(defender, 'arm_reach');
          if (tackle) break;
        }
      }
    }
    if (!terminal && tackle && W.t - tackle.t0 >= 0.48) {
      const spot = maxForward || { x: W.ball.x, y: W.ball.y };
      finish('tackle', spot);
    }
    if (!terminal && W.t >= nextRecord - 1e-9) {
      record();
      nextRecord += 1 / REC_HZ;
    }
  }

  if (!terminal) {
    for (const engagement of [...W.engagements]) W.disengage(engagement);
    W.event('simulation_failure', { reason: 'simulation_time_cap', time_limit_seconds: MAX_SECONDS });
  }
  if (frames.length === 0 || W.t - ((frames.length - 1) / REC_HZ) > 1e-6) record();
  for (const row of activeBlock.values()) row.end = W.t;
  const spot = terminal?.spot ?? null;
  const yardsGained = spot ? (spot.x - cfg.los) * dir : null;
  const blockers = offense.filter((p) => ['OL', 'TE', 'WR'].includes(p.info.group)).map((p) => {
    const rows = blockRows.filter((row) => row.blocker === p);
    const best = rows.map((row) => ({
      defender_id: row.defender.id,
      engaged_seconds: Math.max(0, (row.end ?? W.t) - row.start),
      defender_min_yards_from_los: row.minDefF,
      won: (row.end ?? W.t) - row.start >= 0.24 && row.minDefF >= -0.8,
    })).sort((a, b) => Number(b.won) - Number(a.won) || b.engaged_seconds - a.engaged_seconds)[0] ?? null;
    return { player_id: p.id, role: p.roleKey, won: !!best?.won, engagement: best };
  });
  const trajectories = Object.fromEntries([...samples].map(([id, path]) => [id, path]));
  const topSpeed = W.players.reduce((best, p) => p.topSpeed > best.speed ? { player_id: p.id, speed_mps: p.topSpeed } : best, { player_id: null, speed_mps: 0 });
  return {
    schema_version: 'gridiron.autonomous-inside-zone.v1', mode: 'autonomous', play_call: 'inside_zone',
    seed: String(cfg.seed), front: cfg.front, run_side: cfg.runSide, direction: dir,
    line_of_scrimmage: cfg.los, ball_y: cfg.ballY, roster, hz: REC_HZ, t0: 0,
    stride: roster.length * 6 + 6, frames, trajectories,
    events: W.events,
    terminal: terminal ? { ...terminal, yards_gained: yardsGained, touchdown: terminal.reason === 'touchdown' } : null,
    resolved: !!terminal, carrier_id: carrier?.id ?? null,
    failure: terminal ? null : { reason: 'simulation_time_cap', time_limit_seconds: MAX_SECONDS },
    tackle_id: terminal?.reason === 'tackle' ? tackle?.tackler.id ?? null : null,
    blockers, topSpeed,
    provenance: {
      execution: 'snap-to-whistle player decisions and ball spot generated by the simulation',
      initial_profiles: 'authored physical archetypes adjusted by declared ratings',
      allowed_decision_inputs: ['declared formation and play call', 'declared front and direction', 'player roles, physical profiles, ratings and snap positions', 'current simulated player and ball state', 'past-only pre-snap velocity'],
      outcome_inputs: [],
    },
  };
}

function gapName(lateral, side = 1) {
  const relative = lateral * side;
  if (relative < -1.45) return 'backside C';
  if (relative < -0.45) return 'backside A';
  if (relative <= 0.45) return 'play-side A';
  if (relative <= 1.45) return 'play-side B';
  return 'play-side C';
}
function laneLabel(lateral, side = 1) {
  const relative = lateral * side;
  if (relative < -1.6) return 'backside C';
  if (relative < -0.5) return 'backside A';
  if (relative <= 0.5) return 'play-side A';
  if (relative <= 1.6) return 'play-side B';
  return 'play-side C';
}
