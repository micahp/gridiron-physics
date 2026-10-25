// Autonomous quick passing: slant-flat against Cover 1 and Cover 3.
//
// Same rules as the rushing executor: the play call names routes, protection
// and coverage, but nothing about the result. The quarterback reads live
// separation, throwing lanes and pressure; the ball is launched with the real
// flight model; receivers and defenders contest it from their simulated
// positions. Nothing here imports the historical play director.
import { DT, FIELD_W_YD, G, REC_HZ, YD } from '../constants.js';
import { rng } from '../rng.js';
import { AERO, solveLaunch } from '../ball.js';
import { Player, POSE, World } from '../world.js';
import { createInsideZoneRoster } from '../autonomous-run.js';

const MAX_SECONDS = 12;
const DECISION_HZ = 10;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (x, y) => {
  const n = Math.hypot(x, y);
  return n > 1e-9 ? { x: x / n, y: y / n } : { x: 0, y: 0 };
};

// Contract defensive slots -> the roster slots the physics front knows.
const DEFENSE_SLOT_MAP = { LEDGE: 'LDE', REDGE: 'RDE', MLB: 'MIKE', WLB: 'WILL' };
const FRONT_TO_ROSTER = { nickel_over: 'nickel', nickel_under: 'nickel', nickel: 'nickel' };

const ALLOWED = new Set([
  'seed', 'los', 'dir', 'ballY', 'concept', 'direction', 'front', 'coverage',
  'ratingOverrides', 'playerIds', 'massOverrides', 'offenseTeam', 'defenseTeam',
  // Test-only: lets a regression test start a named player at a point (yards).
  'initialPositions',
]);

function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('scenario must be an object');
  for (const key of Object.keys(input)) {
    if (!ALLOWED.has(key)) throw new TypeError(`unsupported scenario input: ${key}; autonomous plays accept no realized outcome fields`);
  }
  const cfg = {
    seed: input.seed ?? 'slant-flat-demo-1',
    los: input.los ?? 35,
    dir: input.dir ?? 1,
    ballY: input.ballY ?? FIELD_W_YD / 2,
    concept: input.concept ?? 'slant_flat',
    direction: input.direction ?? 'right',
    front: input.front ?? 'nickel_over',
    coverage: input.coverage ?? 'cover_1',
    ratingOverrides: input.ratingOverrides ?? {},
    playerIds: input.playerIds ?? {},
    massOverrides: input.massOverrides ?? {},
    offenseTeam: input.offenseTeam ?? 'OFF',
    defenseTeam: input.defenseTeam ?? 'DEF',
    initialPositions: input.initialPositions ?? {},
  };
  for (const [key, pos] of Object.entries(cfg.initialPositions)) {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) throw new TypeError(`initialPositions.${key} needs finite x and y in yards`);
  }
  if (cfg.concept !== 'slant_flat') throw new RangeError(`unsupported passing concept: ${cfg.concept}`);
  if (cfg.direction !== 'left' && cfg.direction !== 'right') throw new RangeError('direction must be left or right');
  if (!FRONT_TO_ROSTER[cfg.front]) throw new RangeError(`unsupported passing front: ${cfg.front}`);
  if (cfg.coverage !== 'cover_1' && cfg.coverage !== 'cover_3') throw new RangeError(`unsupported coverage: ${cfg.coverage}`);
  if (!Number.isFinite(cfg.los) || cfg.los < 1 || cfg.los > 99) throw new RangeError('los must be between 1 and 99 yards');
  if (cfg.dir !== 1 && cfg.dir !== -1) throw new RangeError('dir must be 1 or -1');
  if (!Number.isFinite(cfg.ballY) || cfg.ballY < 1 || cfg.ballY > FIELD_W_YD - 1) throw new RangeError('ballY must be inside the field');
  return cfg;
}

// The passing contract names defensive slots LEDGE/REDGE/MLB/WLB; the shared
// physics roster aligns LDE/RDE/MIKE/WILL. Translate any per-slot input so the
// caller keeps using one vocabulary.
function toRosterKeys(map) {
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    const [team, slot] = key.split('.');
    if (team === 'D') {
      out[`D.${DEFENSE_SLOT_MAP[slot] ?? slot}`] = value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function createPassRoster(options = {}) {
  const cfg = validateConfig(options);
  const rosterFront = FRONT_TO_ROSTER[cfg.front];
  const roster = createInsideZoneRoster({
    seed: cfg.seed, front: rosterFront, runSide: cfg.direction,
    ratingOverrides: toRosterKeys(cfg.ratingOverrides), massOverrides: toRosterKeys(cfg.massOverrides),
    playerIds: toRosterKeys(cfg.playerIds),
  });
  // Re-key defensive identities onto the contract slots (LEDGE, MLB, ...).
  const inverse = Object.fromEntries(Object.entries(DEFENSE_SLOT_MAP).map(([contract, rosterSlot]) => [rosterSlot, contract]));
  return roster.map((info) => {
    const slot = info.team === 'D' ? (inverse[info.slot] ?? info.slot) : info.slot;
    const roleKey = `${info.team}.${slot}`;
    return { ...info, slot, roleKey, name: `${info.team === 'O' ? cfg.offenseTeam : cfg.defenseTeam} ${slot}` };
  });
}

/**
 * Simulate one quick-pass snap. Returns the same prospective record shape as
 * the rushing executor so the Stage One result adapter treats both identically.
 */
export function simulatePassPlay(options = {}) {
  const cfg = validateConfig(options);
  const rand = rng(cfg.seed);
  const rosterInfo = createPassRoster(cfg);
  const W = new World(rand);
  const dir = cfg.dir;
  const side = cfg.direction === 'left' ? 1 : -1; // concept side in local lateral yards
  const at = (f, l) => ({ x: (cfg.los + dir * f) * YD, y: (cfg.ballY + dir * l) * YD });
  const fOf = (p) => (p.p.x / YD - cfg.los) * dir;
  const lOf = (p) => (p.p.y / YD - cfg.ballY) * dir;
  const d2 = (a, b) => dist(a.p, b.p);

  const formation = (info) => {
    const slot = info.slot;
    if (info.team === 'O') {
      if (slot === 'QB') return { f: -5.2, l: 0 };
      if (slot === 'RB') return { f: -5.6, l: -side * 1.5 };
      if (slot === 'LT') return { f: -0.28, l: 2.25 };
      if (slot === 'LG') return { f: -0.28, l: 1.12 };
      if (slot === 'C') return { f: -0.28, l: 0 };
      if (slot === 'RG') return { f: -0.28, l: -1.12 };
      if (slot === 'RT') return { f: -0.28, l: -2.25 };
      if (slot === 'TE') return { f: -0.35, l: side * 3.6 };
      if (slot === 'WR1') return { f: -0.65, l: -side * 17 };
      if (slot === 'WR2') return { f: -0.65, l: side * 17 };
      return { f: -0.65, l: side * 6.6 }; // WR3 slot
    }
    const rosterSlot = info.slot;
    if (['LDE', 'REDGE', 'LEDGE'].includes(rosterSlot)) return { f: 0.72, l: rosterSlot === 'LEDGE' || rosterSlot === 'LDE' ? -side * 3.6 : side * 3.6 };
    if (rosterSlot === 'LDT') return { f: 0.4, l: 1.15 };
    if (rosterSlot === 'RDT') return { f: 0.4, l: -1.15 };
    if (rosterSlot === 'MIKE' || rosterSlot === 'MLB') return { f: 4.4, l: 0 };
    if (rosterSlot === 'WILL' || rosterSlot === 'WLB') return { f: 4.2, l: -side * 3.2 };
    if (rosterSlot === 'NB') return { f: 5.4, l: side * 6.6 };
    if (rosterSlot === 'LCB') return { f: 6.6, l: -side * 17 };
    if (rosterSlot === 'RCB') return { f: 6.6, l: side * 17 };
    if (rosterSlot === 'SS') return { f: 8.4, l: -side * 2.5 };
    if (rosterSlot === 'FS') return { f: 13.2, l: side * 1.5 };
    throw new Error(`unsupported defensive slot in the pass formation: ${rosterSlot}`);
  };

  const offense = [];
  const defense = [];
  const roster = [];
  const byRole = new Map();
  for (const info of rosterInfo) {
    const p = W.add(new Player(info, info.team, info.slot));
    p.roleKey = info.roleKey;
    const spot = formation(info);
    const override = cfg.initialPositions[info.roleKey];
    p.p = override ? { x: override.x * YD, y: override.y * YD } : { x: at(spot.f, spot.l).x, y: at(spot.f, spot.l).y };
    p.h = info.team === 'O' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI : 0);
    const blockRating = info.team === 'O' ? (p.R.PBK ?? p.R.RBK ?? 60) : (p.R.BSH ?? Math.max(p.R.PMV ?? 50, p.R.FMV ?? 50));
    p.engageMul = (0.75 + (0.5 * ((blockRating ?? 60) - 50)) / 50) * (0.8 + 0.2 * (p.R.STR ?? 60) / 80);
    p.ai.assignment = 'align';
    p.ai.decision = 'read snap';
    p.ai.nextDecision = 0;
    byRole.set(info.roleKey, p);
    (info.team === 'O' ? offense : defense).push(p);
    roster.push({ id: p.id, team: p.team, slot: p.slot, roleKey: p.roleKey });
  }
  const get = (key) => byRole.get(key);
  const qb = get('O.QB'), rb = get('O.RB'), te = get('O.TE');
  const z = get('O.WR2') ?? get('O.WR3');
  const slotRec = get('O.WR3') ?? get('O.WR2');
  const xRec = get('O.WR1');
  const center = get('O.C');
  const ballAtSnap = at(0, 0);
  Object.assign(W.ball, { x: ballAtSnap.x, y: ballAtSnap.y, z: 0.15, state: 'held', holder: center, hand: 'chest' });
  center.hasBall = true;

  const setIntent = (p, assignment, decision) => {
    if (p.ai.assignment === assignment && p.ai.decision === decision) return;
    p.ai.assignment = assignment;
    p.ai.decision = decision;
    W.event('decision', { player_id: p.id, role: p.roleKey, assignment, decision });
  };
  const seek = (p, target, fraction = 1, decel = 8) => {
    const dx = target.x - p.p.x, dy = target.y - p.p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.04) return { x: 0, y: 0 };
    const speed = Math.min(p.vmax * fraction, Math.sqrt(2 * decel * d));
    return { x: dx / d * speed, y: dy / d * speed };
  };
  const lead = (p, q, scale = 0.32) => ({ x: q.p.x + q.v.x * scale, y: q.p.y + q.v.y * scale });
  // Spec 10.1: pursue an estimated interception region, not the carrier's current position.
  // The pursuer leads the carrier by the time it needs to reach that point at its own speed.
  const interceptPoint = (p, q) => {
    const speed = clamp(7.0 + ((p.R.SPD ?? 70) - 70) * 0.06, 6.5, 9.5);
    let t = 0.4;
    let point = { x: q.p.x, y: q.p.y };
    for (let k = 0; k < 4; k++) {
      point = { x: q.p.x + q.v.x * t, y: q.p.y + q.v.y * t };
      t = Math.hypot(point.x - p.p.x, point.y - p.p.y) / speed;
    }
    return point;
  };

  // ------------------------------------------------------- block bookkeeping
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
      if (blocker.team === 'O') {
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

  // ------------------------------------------------------------- assignments
  const linemen = offense.filter((p) => ['LT', 'LG', 'C', 'RG', 'RT'].includes(p.slot));
  for (const p of offense) {
    if (linemen.includes(p)) setIntent(p, `pass set ${p.slot}`, 'protect the inside lane and pick up the nearest rusher');
    else if (p === te) setIntent(p, 'protect the edge', 'set on the edge rusher before releasing');
    else if (p === rb) setIntent(p, 'check protection then checkdown', 'scan the rush before releasing to the checkdown');
    else if (p === qb) setIntent(p, 'take the snap and drop', 'read separation and pressure after the drop');
    else if (p === z) setIntent(p, 'run the slant', 'stem vertically then break inside on the first read');
    else if (p === slotRec) setIntent(p, 'run the flat', 'release outside and work to the flat as the second read');
    else setIntent(p, 'clear out the backside', 'hold the backside safety with a vertical stem');
  }

  const manAssign = new Map();
  const zoneAssign = new Map();
  const coverageRole = (slot) => ({ LCB: 'left corner', RCB: 'right corner', NB: 'nickel', SS: 'strong safety', FS: 'free safety' })[slot] ?? slot;
  if (cfg.coverage === 'cover_1') {
    manAssign.set('LCB', xRec);
    manAssign.set('RCB', z);
    manAssign.set('NB', slotRec);
    manAssign.set('MIKE', rb);
    manAssign.set('WILL', te);
    for (const p of defense) {
      const target = manAssign.get(p.slot);
      if (target) setIntent(p, `cover ${target.slot} man`, 'mirror the receiver and stay over the top of the route');
      else if (p.slot === 'SS') setIntent(p, 'rob the intermediate middle', 'read the quarterback and drive on the throw');
      else if (p.slot === 'FS') setIntent(p, 'play the deep middle', 'stay behind every route until the ball is thrown');
      else setIntent(p, 'rush the passer', 'win your gap and get to the quarterback');
    }
  } else {
    zoneAssign.set('LCB', { depth: 12.5, l: -side * 17 });
    zoneAssign.set('RCB', { depth: 12.5, l: side * 17 });
    zoneAssign.set('FS', { depth: 15, l: -side * 3 });
    zoneAssign.set('NB', { depth: 6.5, l: side * 9 });
    zoneAssign.set('SS', { depth: 7.0, l: -side * 7 });
    zoneAssign.set('MIKE', { depth: 6.0, l: 0 });
    zoneAssign.set('WILL', { depth: 5.0, l: -side * 12 });
    for (const p of defense) {
      const zone = zoneAssign.get(p.slot);
      if (zone) setIntent(p, `cover the ${coverageRole(p.slot)} zone`, 'carry the zone landmark and break on the throw');
      else setIntent(p, 'rush the passer', 'win your gap and get to the quarterback');
    }
  }

  // ---------------------------------------------------------------- runtime
  const samples = new Map(roster.map((r) => [r.id, []]));
  const frames = [];
  let nextRecord = 0;
  let snapped = false, received = false, handedOff = false;
  let carrier = null, carrierSince = null;
  let possession = 'O';
  let throwInfo = null;
  let resolveAttempt = null;
  // One catch opportunity per pass: a failed contest must not roll again as the ball falls through the catch band.
  let contestUsed = false;
  let sack = null, tackle = null, terminal = null;
  let maxForward = null;
  let lastInBounds = { x: ballAtSnap.x, y: ballAtSnap.y };
  let dropDepth = -7.6;
  const catches = [];

  function record(at = W.t) {
    const f = new Float32Array(roster.length * 6 + 6);
    let o = 0;
    for (const p of W.players) {
      f[o++] = p.p.x / YD; f[o++] = p.p.y / YD; f[o++] = p.h;
      f[o++] = p.speed; f[o++] = p.down ? POSE.DOWN : p.pose; f[o++] = p.hasBall ? 1 : 0;
      samples.get(p.id).push({
        t: at, x: p.p.x / YD, y: p.p.y / YD, vx: p.v.x / YD, vy: p.v.y / YD,
        heading: p.h, speed: p.speed / YD, hasBall: p.hasBall,
        assignment: p.ai.assignment, decision: p.ai.decision,
        target_id: p.ai.targetId ?? null,
        engaged_with: p.engaged?.roleKey ?? null,
      });
    }
    const b = W.ball;
    f[o++] = b.x / YD; f[o++] = b.y / YD; f[o++] = b.z;
    f[o++] = b.spin;
    f[o++] = b.state === 'air' ? Math.atan2(b.vy, b.vx) : b.rot || 0;
    f[o++] = b.state === 'air' ? Math.atan2(b.vz, Math.hypot(b.vx, b.vy)) : 0;
    frames.push(f);
  }

  const visible = (p) => p.team === possession ? offense : defense;

  function chooseBlockTarget(p) {
    const pool = defense.filter((q) => !q.down && q.info.group === 'DL' && (!q.engaged || q.engaged === p));
    const free = pool.filter((q) => !q.engaged);
    const options = free.length ? free : pool;
    if (!options.length) return null;
    // Protect the inside first: nearest rusher to the quarterback, then nearest to the blocker.
    const scored = options.map((q) => [d2(q, qb) * 0.55 + d2(q, p) * 0.45, q])
      .sort((a, b) => a[0] - b[0] || a[1].id.localeCompare(b[1].id));
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
    if (blocker.team !== 'O') return;
    const attack = d.info.group === 'DL' ? Math.max(d.R.PMV ?? 50, d.R.FMV ?? 50, d.R.BSH ?? 50) : d.R.BSH ?? 50;
    const block = blocker.R.PBK ?? blocker.R.RBK ?? 50;
    const rate = clamp(0.34 * Math.exp((attack - block) / 22), 0.05, 3);
    if (rand() < rate * DT) W.disengage(e, d);
  }

  function nearestDefenderTo(p) {
    let best = null, bestD = Infinity;
    for (const q of defense) {
      if (q.down) continue;
      const d = d2(q, p);
      if (d < bestD) { best = q; bestD = d; }
    }
    return { player: best, distance: bestD };
  }

  function nearestRusherToQb() {
    let best = null, bestD = Infinity;
    for (const q of defense) {
      if (q.down || q.info.group !== 'DL') continue;
      const d = d2(q, qb);
      if (d < bestD) { best = q; bestD = d; }
    }
    return { player: best, distance: bestD };
  }

  function routeTarget(p) {
    const t = W.t - (throwInfo?.snapT ?? 0);
    if (p === z) {
      // Slant: vertical stem, then a 45-degree break inside.
      const stem = at(2.6, side * 17);
      if (fOf(p) < 2.4) return stem;
      return { x: p.p.x + dir * 1.6 * YD, y: p.p.y - dir * side * 1.6 * YD };
    }
    if (p === slotRec) {
      // Flat: burst outside to the boundary, staying shallow.
      const settle = at(2.4, side * 15);
      if (Math.abs(lOf(p)) < 14) return settle;
      return { x: p.p.x + dir * 0.2 * YD, y: (cfg.ballY + dir * side * 18) * YD };
    }
    if (p === xRec) {
      // Backside clear-out: stem vertical and hold the safety.
      return { x: p.p.x + dir * 1.4 * YD, y: (cfg.ballY + dir * (-side * 15)) * YD };
    }
    if (p === rb && t >= 0.9) {
      return at(1.6, side * 3.2);
    }
    return null;
  }

  // ------------------------------------------------------------ quarterback
  function readOptions() {
    const throwers = [z, slotRec, rb].filter((p) => p && !p.down);
    return throwers.map((rec) => {
      const flight = clamp(d2(qb, rec) / (16 * YD), 0.32, 1.25);
      const aim = { x: rec.p.x + rec.v.x * flight * 0.75, y: rec.p.y + rec.v.y * flight * 0.75 };
      const nearest = nearestDefenderTo(rec);
      const separation = nearest.distance / YD;
      // Defenders sitting on the throwing line are the interception risk.
      let lane = 0;
      const ux = aim.x - qb.p.x, uy = aim.y - qb.p.y;
      const len = Math.hypot(ux, uy) || 1;
      for (const q of defense) {
        if (q.down || q === nearest.player) continue;
        const rx = q.p.x - qb.p.x, ry = q.p.y - qb.p.y;
        const along = (rx * ux + ry * uy) / len;
        if (along <= 0.4 || along >= len) continue;
        const perp = Math.abs(rx * uy - ry * ux) / len;
        if (perp < 1.0 * YD) lane += 1 - perp / (1.0 * YD);
      }
      const pressure = nearestRusherToQb().distance / YD;
      const open = clamp((separation - 0.7) / 2.2, 0, 1);
      // Expected forward value (spec 12.2): downfield yards are worth more than dump-offs.
      const forward = clamp(((rec.p.x - qb.p.x) * dir) / YD / 15, -0.4, 1);
      const utility = open * 1.6 + forward * 1.0 + (1 - clamp(lane / 2.4, 0, 1)) * 0.75
        - clamp(lane * 0.55, 0, 1.35) - clamp((1.6 - pressure) * 0.45, 0, 0.9)
        - clamp(d2(qb, rec) / (28 * YD), 0, 0.5);
      const readiness = 0;
      // Window at arrival: where the receiver and the nearest defender will be when the ball gets there.
      const arrivalRec = { x: rec.p.x + rec.v.x * flight, y: rec.p.y + rec.v.y * flight };
      let arrivalSep = Infinity;
      for (const q of defense) {
        if (q.down) continue;
        const arrivalQ = { x: q.p.x + q.v.x * flight, y: q.p.y + q.v.y * flight };
        arrivalSep = Math.min(arrivalSep, Math.hypot(arrivalRec.x - arrivalQ.x, arrivalRec.y - arrivalQ.y) / YD);
      }
      return { receiver: rec, aim, flight, separation, arrivalSep, lane, pressure, utility, readyAt: readiness };
    }).sort((a, b) => b.utility - a.utility || a.receiver.id.localeCompare(b.receiver.id));
  }

  function launchPass(best) {
    const from = { x: W.ball.x, y: W.ball.y, z: 1.45 };
    // Location error is the quarterback's, not the receiver's: it grows with
    // throw distance and pressure and shrinks with accuracy.
    const accuracy = qb.R.ACC ?? qb.R.THN ?? qb.R.AWR ?? 70;
    const distanceYd = Math.hypot(best.aim.x - qb.p.x, best.aim.y - qb.p.y) / YD;
    const sigma = clamp(0.28 + distanceYd * 0.026 + clamp(2.0 - best.pressure, 0, 1.6) * 0.30
      + clamp((72 - accuracy) * 0.012, -0.12, 0.35), 0.12, 1.5);
    const to = {
      x: best.aim.x + rand.normal() * sigma * YD,
      y: best.aim.y + rand.normal() * sigma * YD,
      z: 1.5,
    };
    const flight = solveLaunch(from, to, Math.max(0.32, best.flight), AERO.spiral);
    Object.assign(W.ball, {
      state: 'air', holder: null, x: from.x, y: from.y, z: from.z,
      vx: flight.vx, vy: flight.vy, vz: flight.vz, k: flight.k,
    });
    qb.hasBall = false;
    W.ball.thrower = qb;
    W.ball.target = best.receiver;
    W.ball.landing = { x: to.x, y: to.y };
    W.ball.thrownAt = W.t;
    W.event('throw', {
      quarterback_id: qb.id, target_id: best.receiver.id,
      separation_yards: best.separation, lane_risk: best.lane,
      pressure_yards: best.pressure, flight_seconds: best.flight,
    });
    setIntent(qb, 'throw to the open read', `release to ${best.receiver.slot} with ${best.separation.toFixed(1)} yd separation`);
  }

  // Observable route development: a receiver is readable once its route has
  // developed, and the back once he has released from protection.
  function routeReady(p) {
    if (p === z) return fOf(p) >= 2.4;
    if (p === slotRec) return Math.abs(lOf(p)) >= 5.5;
    if (p === rb) return !p.engaged && W.t >= 0.9;
    return true;
  }

  function escapeLane(rusher) {
    const away = unit(qb.p.x - rusher.p.x, qb.p.y - rusher.p.y);
    const spot = { x: qb.p.x + away.x * 2.5 * YD, y: qb.p.y + away.y * 2.5 * YD };
    const open = !W.players.some((d) => d.team !== 'O' && !d.down && Math.hypot(d.p.x - spot.x, d.p.y - spot.y) < 2.0 * YD);
    return { away, open };
  }

  // Decision thresholds are causal reading rules, not outcome targets.
  const T_THROW = 0.62;   // a read is viable for a throw
  const T_CHECK = 0.34;   // the back is viable as a checkdown under pressure
  const P_PRESS = 1.8;    // yards: pressure that sends the QB to the checkdown
  const P_SCRAMBLE = 1.1; // yards: pressure that forces a move

  function qbDecision() {
    if (!received || W.ball.holder !== qb) return;
    const elapsed = W.t - (W.ball.receivedAt ?? 0);
    // A three-step drop from the gun takes about 0.8 s before the first read is live.
    if (elapsed < 0.75) { setIntent(qb, 'complete the drop', 'get to the top of the drop before reading'); return; }
    const options = readOptions().filter((o) => routeReady(o.receiver));
    // Observation: the quarterback sees rushers in front of him; a rusher from behind is felt only when he is on top of him.
    const facing = { x: Math.cos(qb.h), y: Math.sin(qb.h) };
    let perceived = null, rusher = nearestRusherToQb().player;
    for (const d of W.players) {
      if (d.team === 'O' || d.down) continue;
      const dx = d.p.x - qb.p.x, dy = d.p.y - qb.p.y;
      const dist = Math.hypot(dx, dy);
      const seen = (dx * facing.x + dy * facing.y) / (dist || 1) >= -0.2 || dist < 1.3 * YD;
      if (seen && (!perceived || dist < perceived.dist)) perceived = { dist, player: d };
    }
    const pressure = perceived ? perceived.dist / YD : 99;
    if (perceived) rusher = perceived.player;
    const prev = qb.ai.pressureSample;
    const dt = prev ? W.t - prev.t : 0;
    const closing = prev && dt > 1e-3 ? (prev.p - pressure) / dt : 0;
    qb.ai.pressureSample = { t: W.t, p: pressure };
    const contactIn = pressure / Math.max(closing, 0.5);

    const primary = options.find((o) => o.receiver === z);
    const secondary = options.find((o) => o.receiver === slotRec);
    const back = options.find((o) => o.receiver === rb);
    // Read order (spec 12.2): first option, second option, then the checkdown under pressure.
    // A read is viable only when the receiver has a window: enough separation and a clear lane.
    const viable = (o) => o && o.arrivalSep >= 1.8 && o.lane < 0.6 && o.utility >= T_THROW;
    if (viable(primary)) { launchPass(primary); return; }
    if (viable(secondary)) { launchPass(secondary); return; }
    if (pressure < P_PRESS && back && back.utility >= T_CHECK) { launchPass(back); return; }

    const lane = escapeLane(rusher);
    if (pressure < P_SCRAMBLE && lane.open) {
      qb.ai.escape = { x: lane.away.x, y: lane.away.y };
      setIntent(qb, 'scramble away from pressure', `move off ${rusher.slot} into open space`);
      return;
    }
    // Pocket awareness decides how late the quarterback can still throw the ball away.
    const awarenessWindow = clamp(0.35 + (75 - (qb.R.AWR ?? 70)) * 0.02, 0.15, 0.8);
    if (contactIn < awarenessWindow || elapsed > 4.5) {
      const target = at(-1.0, side * 22);
      const flight = solveLaunch({ x: W.ball.x, y: W.ball.y, z: 1.4 }, { x: target.x, y: target.y, z: 0.2 }, 0.9, AERO.spiral);
      Object.assign(W.ball, { state: 'air', holder: null, vx: flight.vx, vy: flight.vy, vz: flight.vz, k: flight.k });
      qb.hasBall = false;
      W.ball.thrower = qb;
      W.ball.intentionalGround = true;
      W.event('throw_away', { quarterback_id: qb.id });
      return;
    }
    if (options.length) {
      W.event('qb_read', {
        quarterback_id: qb.id, target_id: options[0].receiver.id, utility: Number(options[0].utility.toFixed(3)),
        separation_yards: Number(options[0].separation.toFixed(2)), pressure_yards: Number(pressure.toFixed(2)),
      });
    }
    setIntent(qb, 'hold and keep reading', 'no viable throw yet; the protection and the reads continue');
  }

  // ------------------------------------------------------------ ball contest
  function catchCandidates() {
    const b = W.ball;
    const out = [];
    for (const p of W.players) {
      if (p.down) continue;
      // Only eligible receivers take a forward pass; only linebackers and defensive backs contest it.
      const eligible = p.team === 'O'
        ? ['WR', 'TE', 'RB'].includes(p.info.group) && p !== qb
        : ['DB', 'LB'].includes(p.info.group);
      if (!eligible) continue;
      const planar = Math.hypot(p.p.x - b.x, p.p.y - b.y) / YD;
      const reach = 1.15 + p.r / YD;
      if (planar > reach) continue;
      if (b.z < 0.35 || b.z > 2.75) continue;
      out.push({ player: p, planar });
    }
    return out.sort((a, b2) => a.planar - b2.planar || a.player.id.localeCompare(b2.player.id));
  }

  // Resolve the first player able to play the ball. The receiver wins the ball
  // on his own merits; an interception needs a defender who is genuinely at
  // the catch point, which is why most failed catches are simply incomplete.
  // A defender perceives a thrown ball only after a reaction delay, from its observed flight, with noise set by awareness.
  // The exact landing spot is never read; the perceived point is a defender's estimate.
  function perceivedLanding(p) {
    const b = W.ball;
    if (b.state !== 'air' || b.thrownAt == null) return null;
    const reaction = clamp(0.22 + (70 - (p.R.PRC ?? p.R.AWR ?? 70)) * 0.004, 0.16, 0.42);
    if (W.t - b.thrownAt < reaction) return null;
    if (!p.ai.perception || p.ai.perception.throwAt !== b.thrownAt) {
      const z = Math.max(b.z, 0);
      const flightLeft = (b.vz + Math.sqrt(b.vz * b.vz + 2 * G * z)) / G;
      const noise = clamp((85 - (p.R.AWR ?? 70)) * 0.02, 0.1, 1.0) * YD;
      p.ai.perception = {
        throwAt: b.thrownAt,
        point: { x: b.x + b.vx * flightLeft + rand.normal() * noise, y: b.y + b.vy * flightLeft + rand.normal() * noise },
      };
    }
    return p.ai.perception.point;
  }

  function resolveContest() {
    const candidates = catchCandidates();
    if (!candidates.length) return;
    const receiver = candidates.find((c) => c.player.team === 'O');
    const defender = candidates.find((c) => c.player.team !== 'O');
    const separation = receiver && defender
      ? d2(receiver.player, defender.player) / YD
      : receiver ? 6 : 0;
    const ballZ = W.ball.z;

    if (receiver) {
      const skill = ((receiver.player.R.CTH ?? receiver.player.R.CAR ?? 70) * 0.7
        + (receiver.player.R.AWR ?? 60) * 0.3);
      const traffic = defender ? clamp(1.8 - separation, 0, 1.8) : 0;
      const chance = clamp(0.9 + (skill - 70) * 0.005 - traffic * 0.16
        - clamp(Math.abs(ballZ - 1.6) * 0.12, 0, 0.2), 0.35, 0.97);
      W.event('catch_contest', {
        player_id: receiver.player.id, team: receiver.player.team, chance: Number(chance.toFixed(3)),
        separation_yards: Number(separation.toFixed(2)), ball_z: Number(ballZ.toFixed(2)),
      });
      if (rand() < chance) { secure(receiver.player, receiver.planar); return; }
      // Contested and not caught: only a defender on top of the ball picks it.
      const interceptionChance = defender
        ? clamp(0.045 - separation * 0.03 + ((defender.player.R.PRC ?? 60) - 60) * 0.0005, 0.005, 0.05)
        : 0;
      if (defender && rand() < interceptionChance) { secure(defender.player, defender.planar); return; }
      knockDown(defender?.player ?? receiver.player);
      return;
    }

    // Nobody on offence is at the ball: a defender can only catch what he can reach.
    const interceptionChance = clamp(0.10 - (defender?.planar ?? 2) * 0.04
      + ((defender?.player.R.PRC ?? 60) - 60) * 0.001, 0.01, 0.12);
    if (defender && rand() < interceptionChance) { secure(defender.player, defender.planar); return; }
    knockDown(defender?.player ?? null);
  }

  function knockDown(by) {
    W.ball.vz = -Math.abs(W.ball.vz) * 0.4 - 1.2;
    W.ball.vx *= 0.3; W.ball.vy *= 0.3;
    W.event('pass_deflected', { by: by?.id ?? null });
    resolveAttempt = null;
  }

  function secure(player, planar = null) {
    const b = W.ball;
    b.state = 'held';
    b.holder = player;
    b.hand = 'chest';
    player.hasBall = true;
    player.pose = POSE.CATCH;
    possession = player.team;
    const interception = player.team !== 'O';
    W.event(interception ? 'interception' : 'catch', {
      player_id: player.id, at: { x: b.x / YD, y: b.y / YD }, time: W.t,
      reach_yards: planar == null ? null : Number(planar.toFixed(3)),
    });
    catches.push({ player_id: player.id, team: player.team, t: W.t, x: b.x / YD, y: b.y / YD });
    if (interception) {
      setIntent(player, 'return the interception', 'secure the ball and find the nearest open grass');
    } else {
      setIntent(player, 'run after the catch', 'protect the ball and gain what the blocking allows');
    }
    carrier = player;
    carrierSince = W.t;
    pCarrierReset();
    resolveAttempt = null;
    throwInfo = null;
    W.ball.thrower = null;
    W.ball.target = null;
  }

  function pCarrierReset() {
    W.ball.x = carrier.p.x + Math.cos(carrier.h) * carrier.r * 0.6;
    W.ball.y = carrier.p.y + Math.sin(carrier.h) * carrier.r * 0.6;
    W.ball.z = 1.05;
  }

  W.onBallGround = () => {
    if (W.ball.state !== 'air') return;
    W.event('incomplete', { thrown_at: W.ball.thrownAt, target_id: W.ball.target?.id ?? null, time: W.t });
    finish('incomplete', { x: ballAtSnap.x, y: ballAtSnap.y });
  };

  // ---------------------------------------------------------------- contact
  function startTackle(d) {
    if (terminal || tackle || !carrier || d.team === carrier.team) return;
    const closing = Math.hypot(d.v.x - carrier.v.x, d.v.y - carrier.v.y) / YD;
    const tak = d.R.TAK ?? 60;
    const btk = Math.max(carrier.R.BTK ?? 55, carrier.R.ELU ?? 55);
    const strength = (d.R.STR ?? 55) - (carrier.R.STR ?? 55);
    const finishChance = clamp(0.43 + (tak - btk) * 0.006 + strength * 0.0015 + closing * 0.027, 0.08, 0.92);
    d.ai.lastTackleAttempt = W.t;
    if (rand() < finishChance) {
      tackle = { tackler: d, carrier, t0: W.t };
      d.mode = 'tackling'; carrier.mode = 'tackled';
      d.pose = POSE.WRAP; carrier.pose = POSE.WRAP;
      W.wrap(d, carrier, { fall: 0.48, keepCarrier: 0.25 });
      setIntent(d, 'finish the tackle', 'wrap and drive through the carrier');
      setIntent(carrier, 'protect the football', 'fight for forward progress');
      W.event('tackle_attempt', { defender_id: d.id, carrier_id: carrier.id, closing_speed: Number(closing.toFixed(2)), chance: Number(finishChance.toFixed(3)) });
    } else {
      d.stumble = 0.24;
      d.ai.missUntil = W.t + 1.0;
      carrier.stumble = 0.10;
      W.event('broken_tackle', { defender_id: d.id, carrier_id: carrier.id, closing_speed: Number(closing.toFixed(2)) });
      setIntent(d, 'recover the pursuit angle', 'regain balance after the carrier escaped');
    }
  }

  W.onTouch = (a, b) => {
    if (!carrier || tackle || terminal || (a !== carrier && b !== carrier)) return;
    const d = a === carrier ? b : a;
    if (d.team !== carrier.team && !d.down && (d.ai.missUntil ?? 0) <= W.t) startTackle(d);
  };

  function rushPasser(d) {
    if (d.engaged) {
      tryShed(d);
      if (d.engaged) {
        const toward = unit(qb.p.x - d.p.x, qb.p.y - d.p.y);
        d.dv = { x: toward.x * 1.8, y: toward.y * 1.8 };
        d.face = Math.atan2(toward.y, toward.x);
        return;
      }
    }
    if (W.ball.holder === qb) {
      d.dv = seek(d, lead(d, qb, 0.12), 1, 22);
      d.face = Math.atan2(qb.p.y - d.p.y, qb.p.x - d.p.x);
      if (d2(d, qb) < d.r + qb.r + 0.2) {
        W.event('sack', { defender_id: d.id, quarterback_id: qb.id, time: W.t });
        sack = { defender: d, t0: W.t };
        d.pose = POSE.WRAP;
        carrier = qb; // the quarterback is a ball carrier for contact purposes
        tackle = { tackler: d, carrier: qb, t0: W.t };
        W.wrap(d, qb, { fall: 0.5, keepCarrier: 0.1 });
        finish('sack', { x: W.ball.x, y: W.ball.y });
      }
    } else {
      d.dv = seek(d, at(0.8, d.ai.gapL ?? 0), 0.5, 8);
    }
  }

  // -------------------------------------------------------------- agent brain
  // After a turnover the offense becomes the defence: they pursue the returner
  // from live positions instead of continuing their routes.
  function pursuerBrain(p) {
    if (p.engaged) {
      tryShed(p);
      if (p.engaged) {
        const toward = unit(carrier.p.x - p.p.x, carrier.p.y - p.p.y);
        p.dv = { x: toward.x * 1.7, y: toward.y * 1.7 };
        p.face = Math.atan2(toward.y, toward.x);
        setIntent(p, 'shed the block', 'get free and close on the returner');
        return;
      }
    }
    const leadScale = clamp(0.22 + (p.R.PUR ?? p.R.AWR ?? 60) * 0.0012, 0.24, 0.36);
    p.dv = seek(p, interceptPoint(p, carrier), 0.98, 20);
    p.face = Math.atan2(carrier.p.y - p.p.y, carrier.p.x - p.p.x);
    setIntent(p, 'pursue the returner', 'take the interception angle from the live carrier position');
  }

  function offenseBrain(p) {
    if (!snapped) { p.dv = { x: 0, y: 0 }; p.face = dir > 0 ? 0 : Math.PI; return; }
    if (carrier && p === carrier) { carrierBrain(p); return; }
    if (carrier && p.team !== carrier.team) { pursuerBrain(p); return; }
    if (p === qb) {
      if (!received) { p.dv = { x: 0, y: 0 }; return; }
      if (W.ball.holder !== qb) { p.dv = { x: 0, y: 0 }; setIntent(p, 'follow the throw', 'watch the ball and stay available'); return; }
      if (p.ai.escape) {
        p.dv = { x: p.ai.escape.x * p.vmax * 0.85, y: p.ai.escape.y * p.vmax * 0.85 };
        p.face = Math.atan2(p.ai.escape.y, p.ai.escape.x);
        return;
      }
      const drop = at(dropDepth, 0);
      const elapsed = W.t - (W.ball.receivedAt ?? 0);
      if (elapsed < 1.25) {
        p.dv = seek(p, drop, 0.8, 9);
        p.face = dir > 0 ? 0 : Math.PI;
        setIntent(p, 'drop from the gun', 'set the feet and keep the eyes downfield');
      } else {
        const drift = closestRusherSide();
        p.dv = seek(p, { x: p.p.x + dir * 0.4 * YD, y: p.p.y + drift * 0.5 * YD }, 0.32, 6);
        p.face = dir > 0 ? 0 : Math.PI;
      }
      return;
    }
    if (['LT', 'LG', 'C', 'RG', 'RT', 'TE'].includes(p.slot)) {
      if (p.engaged) {
        const d = p.engaged;
        const toward = unit(qb.p.x - p.p.x, qb.p.y - p.p.y);
        p.dv = { x: toward.x * 1.6, y: toward.y * 1.6 };
        p.face = Math.atan2(d.p.y - p.p.y, d.p.x - p.p.x);
        p.pose = POSE.BLOCK;
        setIntent(p, p.ai.assignment, `anchor against ${d.slot} and keep the pocket`);
        return;
      }
      if (p.ai.nextTargetAt == null || W.t >= p.ai.nextTargetAt || !p.ai.blockOn || p.ai.blockOn.down || p.ai.blockOn.engaged) {
        p.ai.blockOn = chooseBlockTarget(p);
        p.ai.nextTargetAt = W.t + 0.15;
      }
      const d = p.ai.blockOn;
      if (d) {
        p.ai.blockOn = d;
        p.dv = seek(p, lead(p, d, 0.12), 0.9, 14);
        p.face = Math.atan2(d.p.y - p.p.y, d.p.x - p.p.x);
        engageBlocker(p, d);
      } else {
        p.dv = seek(p, at(-1.0, p.ai.zoneL ?? lOf(p) * 0.5), 0.5, 8);
      }
      return;
    }
    // Receivers and the back follow their route landmarks from live positions.
    if (p === rb) {
      const elapsed = W.t - (W.ball.receivedAt ?? 0);
      if (elapsed < 0.9 && !p.engaged && !throwInfo) {
        // Scan the rush before releasing.
        const threat = defense.filter((q) => q.info.group === 'DL' && !q.down)
          .sort((a, b) => d2(a, qb) - d2(b, qb))[0];
        if (threat && d2(threat, qb) < 3.2 * YD) {
          p.dv = seek(p, lead(p, threat, 0.1), 0.75, 12);
          engageBlocker(p, threat);
          setIntent(p, 'check protection', 'step into the nearest pressure before releasing');
          return;
        }
      }
    }
    const target = routeTarget(p);
    if (target) {
      p.dv = seek(p, target, 0.95, 11);
      p.face = Math.atan2(dir * (target.y - p.p.y) * 0 + (target.y - p.p.y), target.x - p.p.x);
    } else {
      p.dv = seek(p, at(4, lOf(p)), 0.5, 8);
    }
    if (throwInfo) {
      // Attack the ball once it has been perceived; the exact landing spot is never read.
      const perceived = perceivedLanding(p);
      if (perceived) p.dv = seek(p, perceived, 1, 14);
    }
  }

  function closestRusherSide() {
    const r = nearestRusherToQb().player;
    if (!r) return 0;
    return Math.sign(lOf(r) || 1);
  }

  function carrierBrain(p) {
    if (tackle) { p.dv = { x: p.v.x, y: p.v.y }; return; }
    const forwards = p.team === 'O' ? dir : -dir;
    // Aim at open grass: step away from the nearest defender while keeping forward.
    let nearest = null, nearestD = Infinity;
    for (const q of W.players) {
      if (q.team === p.team || q.down) continue;
      const d = d2(q, p);
      if (d < nearestD) { nearest = q; nearestD = d; }
    }
    let avoid = { x: 0, y: 0 };
    if (nearest && nearestD < 3.2 * YD) {
      const away = unit(p.p.x - nearest.p.x, p.p.y - nearest.p.y);
      avoid = { x: away.x * 0.9, y: away.y * 0.9 };
    }
    const ahead = { x: p.p.x + forwards * 3.0 * YD, y: p.p.y + (avoid.y * 3 + p.v.y * 0.15) };
    collectBall(p);
    p.dv = seek(p, ahead, 0.98, 10);
    p.face = Math.atan2(p.dv.y, p.dv.x);
    setIntent(p, p.team === 'O' ? 'run after the catch' : 'return the interception', 'take the open grass and make the first defender miss');
  }

  function collectBall(p) {
    if (W.ball.holder !== p) {
      W.ball.holder = p;
      W.ball.state = 'held';
      W.ball.hand = 'carry';
      p.hasBall = true;
    }
  }

  function defenseBrain(p) {
    if (!snapped) { p.dv = { x: 0, y: 0 }; p.face = dir > 0 ? Math.PI : 0; return; }
    if (carrier && p.team !== carrier.team) {
      if (p.engaged) {
        tryShed(p);
        if (p.engaged) {
          const toward = unit(carrier.p.x - p.p.x, carrier.p.y - p.p.y);
          p.dv = { x: toward.x * 1.7, y: toward.y * 1.7 };
          p.face = Math.atan2(toward.y, toward.x);
          setIntent(p, `shed ${p.engaged.slot}`, 'get free and close on the carrier');
          return;
        }
      }
      const pursuitDelay = clamp(0.34 - (p.R.PUR ?? p.R.AWR ?? 60) * 0.0026, 0.12, 0.30);
      const readyAt = carrierSince + pursuitDelay;
      if (W.t < readyAt) {
        p.dv = seek(p, at(2.0, lOf(p)), 0.5, 8);
        setIntent(p, p.ai.assignment, 'hold leverage until the ball is secured');
        return;
      }
      const leadScale = clamp(0.22 + (p.R.PUR ?? 60) * 0.0012, 0.24, 0.36);
      p.dv = seek(p, interceptPoint(p, carrier), 0.98, 20);
      p.face = Math.atan2(carrier.p.y - p.p.y, carrier.p.x - p.p.x);
      setIntent(p, 'pursue the carrier', 'take the interception angle from the live carrier position');
      return;
    }
    if (p.info.group === 'DL') { rushPasser(p); return; }
    const perceived = throwInfo && W.ball.state === 'air' ? perceivedLanding(p) : null;
    if (perceived) {
      p.dv = seek(p, perceived, 1, 16);
      p.face = Math.atan2(perceived.y - p.p.y, perceived.x - p.p.x);
      setIntent(p, 'break on the thrown ball', 'drive toward the perceived landing spot');
      return;
    }
    if (cfg.coverage === 'cover_1') {
      const target = manAssign.get(p.slot);
      if (target) {
        const leverage = { x: target.p.x + dir * 0.7 * YD, y: target.p.y - dir * side * 0.6 * YD };
        p.dv = seek(p, lead(p, target, 0.18), 0.95, 16);
        p.face = Math.atan2(target.p.y - p.p.y, target.p.x - p.p.x);
        setIntent(p, `cover ${target.slot} man`, 'stay in phase and squeeze the route');
      } else if (p.slot === 'FS') {
        const deep = at(16, -side * 3);
        p.dv = seek(p, deep, 0.8, 10);
        setIntent(p, 'play the deep middle', 'stay over the top of both inside routes');
      } else if (p.slot === 'SS') {
        const spot = at(8, -side * 4);
        p.dv = seek(p, spot, 0.8, 12);
        setIntent(p, 'rob the middle', 'read the quarterback and drive on the slant');
      } else {
        p.dv = seek(p, at(1.0, lOf(p)), 0.5, 10);
      }
      return;
    }
    const zone = zoneAssign.get(p.slot);
    if (zone) {
      const landmark = at(zone.depth, zone.l);
      const reached = d2(p, { p: landmark }) < 1.2 * YD;
      if (!reached) {
        p.dv = seek(p, landmark, p.slot.startsWith('L') || p.slot === 'FS' ? 0.9 : 0.75, 12);
        p.face = dir > 0 ? 0 : Math.PI;
        setIntent(p, p.ai.assignment, 'carry the zone landmark');
      } else {
        // Sit in the zone and read the quarterback's eyes.
        p.dv = seek(p, landmark, 0.35, 6);
        p.face = Math.atan2(qb.p.y - p.p.y, qb.p.x - p.p.x);
      }
    }
  }

  // ---------------------------------------------------------------- schedule
  const brains = (p) => {
    if (W.t + 1e-9 >= (p.ai.nextDecision ?? 0)) {
      p.ai.nextDecision = W.t + 1 / DECISION_HZ;
      if (!p.down) {
        if (p === qb && received) qbDecision();
        if (p.team === 'O') offenseBrain(p);
        else defenseBrain(p);
        return;
      }
    }
    if (p.down) { p.dv = { x: 0, y: 0 }; return; }
    // Between decisions the player keeps executing the latest intent; only the
    // continuous steering loop refreshes, not the chosen action.
    if (p.team === 'O') offenseBrain(p);
    else defenseBrain(p);
  };

  // ------------------------------------------------------------------ finish
  function finish(reason, spot) {
    if (terminal) return;
    terminal = { reason, spot: { x: spot.x / YD, y: clamp(spot.y / YD, 0, FIELD_W_YD) }, time: W.t };
    if ((reason === 'tackle' || reason === 'sack') && tackle) {
      const victim = tackle.carrier;
      victim.down = true; victim.pose = POSE.DOWN; victim.downT = W.t;
      tackle.tackler.down = true; tackle.tackler.pose = POSE.DOWN; tackle.tackler.downT = W.t;
    }
    if (reason === 'incomplete') {
      W.ball.state = 'dead';
    }
    for (const engagement of [...W.engagements]) W.disengage(engagement);
    if (W.ball.holder) W.ball.holder = null;
    if (reason !== 'incomplete') {
      W.ball.state = 'held'; W.ball.x = spot.x; W.ball.y = spot.y; W.ball.z = 0.15;
    }
    W.event('whistle', { reason, ball_spot: { x: W.ball.x / YD, y: W.ball.y / YD }, time: W.t });
  }

  function trackLive() {
    const b = W.ball;
    if (b.state === 'air') {
      if (!contestUsed && b.z <= 2.4 && b.vz < 0 && catchCandidates().length) {
        contestUsed = true;
        resolveContest();
      }
      // Out-of-bounds flight is not a rule violation until the ball lands.
    }
    if (carrier && W.ball.holder === carrier) {
      const f = (W.ball.x / YD - cfg.los) * dir;
      if (!maxForward || f > maxForward.f) maxForward = { f, x: W.ball.x, y: W.ball.y };
      const x = W.ball.x / YD;
      // A returner scores at the goal the returner's team attacks, which is the opposite end after an interception.
      const attack = carrier.team === 'O' ? dir : -dir;
      if ((attack > 0 && x >= 100) || (attack < 0 && x <= 0)) {
        const goalX = (attack > 0 ? 100 : 0) * YD;
        W.event('touchdown', { carrier_id: carrier.id, spot: { x: goalX / YD, y: W.ball.y / YD } });
        finish('touchdown', { x: goalX, y: W.ball.y });
        return;
      }
      if (W.ball.y < 0 || W.ball.y > FIELD_W_YD * YD) {
        const boundaryY = W.ball.y < 0 ? 0 : FIELD_W_YD * YD;
        const dy = W.ball.y - lastInBounds.y;
        const fraction = Math.abs(dy) > 1e-9 ? clamp((boundaryY - lastInBounds.y) / dy, 0, 1) : 0;
        finish('out_of_bounds', { x: lastInBounds.x + (W.ball.x - lastInBounds.x) * fraction, y: boundaryY });
        return;
      }
      lastInBounds = { x: W.ball.x, y: W.ball.y };
      if ((attack > 0 && x < 0) || (attack < 0 && x > 100)) finish('safety', { x: W.ball.x, y: W.ball.y });
    }
  }

  // --------------------------------------------------------------- main loop
  record();
  nextRecord = 1 / REC_HZ;
  while (W.t < MAX_SECONDS && !terminal) {
    if (!snapped) {
      snapped = true;
      for (const p of W.players) if (p.pose === POSE.STANCE) p.pose = POSE.RUN;
      const from = { x: W.ball.x, y: W.ball.y, z: 0.35 };
      const to = { x: qb.p.x + Math.cos(qb.h) * 0.55, y: qb.p.y + Math.sin(qb.h) * 0.55, z: 1.35 };
      const flight = solveLaunch(from, to, 0.16, AERO.spiral);
      Object.assign(W.ball, {
        state: 'snap', holder: null, x: from.x, y: from.y, z: from.z,
        vx: flight.vx, vy: flight.vy, vz: flight.vz, k: flight.k,
      });
      const snapArrive = W.t + 0.16;
      W.event('snap', { play_call: 'slant_flat', concept: cfg.concept, direction: cfg.direction, front: cfg.front, coverage: cfg.coverage, to: qb.id });
      W.ball.snapArrive = snapArrive;
    }
    if (W.ball.state === 'snap' && W.t >= W.ball.snapArrive) {
      W.ball.state = 'held';
      W.ball.holder = qb;
      W.ball.hand = 'chest';
      W.ball.receivedAt = W.t;
      center.hasBall = false;
      qb.hasBall = true;
      received = true;
      W.event('snap_receive', { quarterback_id: qb.id, time: W.t });
    }
    if (received && !carrier && W.ball.state === 'air') throwInfo = { snapT: W.ball.receivedAt, thrownAt: W.t };
    if (received && carrier) throwInfo = null;

    W.step(DT, brains);
    for (const row of activeBlock.values()) {
      row.minDefF = Math.min(row.minDefF, fOf(row.defender));
      row.maxDefF = Math.max(row.maxDefF, fOf(row.defender));
    }
    trackLive();
    if (!terminal && tackle && W.t - tackle.t0 >= 0.48) {
      const spot = maxForward || { x: W.ball.x, y: W.ball.y };
      finish(tackle === sack ? 'sack' : 'tackle', spot);
    }
    if (!terminal && W.t >= nextRecord - 1e-9) {
      record();
      nextRecord += 1 / REC_HZ;
    }
  }

  // A wrap that started before the cap is real contact, not a truncated play:
  // resolve it at the cap rather than reporting a technical failure.
  if (!terminal && tackle) {
    const spot = maxForward || { x: W.ball.x, y: W.ball.y };
    finish(tackle === sack ? 'sack' : 'tackle', spot);
  }
  if (!terminal) {
    for (const engagement of [...W.engagements]) W.disengage(engagement);
    W.event('simulation_failure', { reason: 'simulation_time_cap', time_limit_seconds: MAX_SECONDS });
  }
  // The final frame belongs to the instant of the whistle, not to the step
  // that finished integrating after the ball went dead.
  if (frames.length === 0 || W.t - ((frames.length - 1) / REC_HZ) > 1e-6) record(terminal?.time ?? W.t);
  for (const row of activeBlock.values()) row.end = W.t;

  const spot = terminal?.spot ?? null;
  const yardsGained = spot ? (spot.x - cfg.los) * dir : null;
  const blockers = offense.filter((p) => ['LT', 'LG', 'C', 'RG', 'RT', 'TE'].includes(p.slot)).map((p) => {
    const rows = blockRows.filter((row) => row.blocker === p);
    const best = rows.map((row) => ({
      defender_id: row.defender.id,
      engaged_seconds: Math.max(0, (row.end ?? W.t) - row.start),
      defender_min_yards_from_los: row.minDefF,
      won: (row.end ?? W.t) - row.start >= 0.3 && row.minDefF <= 1.2,
    })).sort((a, b) => Number(b.won) - Number(a.won) || b.engaged_seconds - a.engaged_seconds)[0] ?? null;
    return { player_id: p.id, role: p.roleKey, won: !!best?.won, engagement: best };
  });
  const trajectories = Object.fromEntries([...samples].map(([id, path]) => [id, path]));
  const topSpeed = W.players.reduce((best, p) => p.speed > best.topSpeed ? { player_id: p.id, topSpeed: p.speed } : best, { player_id: null, topSpeed: 0 });
  const throwEvent = W.events.find((e) => e.type === 'throw') ?? null;

  return {
    schema_version: 'gridiron.autonomous-pass.v1', mode: 'autonomous', play_call: 'slant_flat',
    seed: String(cfg.seed), front: cfg.front, coverage: cfg.coverage, direction: cfg.direction, dir,
    line_of_scrimmage: cfg.los, ball_y: cfg.ballY, roster, hz: REC_HZ, t0: 0,
    stride: roster.length * 6 + 6, frames, trajectories,
    events: W.events,
    terminal: terminal ? { ...terminal, yards_gained: yardsGained, touchdown: terminal.reason === 'touchdown' } : null,
    resolved: !!terminal,
    carrier_id: carrier?.id ?? null,
    possession_team: possession,
    throw: throwEvent ? { quarterback_id: throwEvent.quarterback_id, target_id: throwEvent.target_id } : null,
    catches,
    failure: terminal ? null : { reason: 'simulation_time_cap', time_limit_seconds: MAX_SECONDS },
    tackle_id: terminal && (terminal.reason === 'tackle' || terminal.reason === 'sack') ? tackle?.tackler.id ?? null : null,
    sack_id: terminal?.reason === 'sack' ? sack?.defender.id ?? null : null,
    interception_id: catches.find((c) => c.team === 'D')?.player_id ?? null,
    blockers, topSpeed,
    provenance: {
      execution: 'snap-to-whistle player decisions and ball flight generated by the simulation',
      initial_profiles: 'authored physical archetypes adjusted by declared ratings',
      allowed_decision_inputs: ['declared formation and play call', 'declared front, coverage and direction', 'player roles, physical profiles, ratings and snap positions', 'current simulated player and ball state'],
      outcome_inputs: [],
    },
  };
}
