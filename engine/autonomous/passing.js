// Autonomous quick passing: slant-flat against Cover 1 and Cover 3.
//
// Same rules as the rushing executor: the play call names routes, protection
// and coverage, but nothing about the result. The quarterback reads live
// separation, throwing lanes and pressure; the ball is launched with the real
// flight model; receivers and defenders contest it from their simulated
// positions. Nothing here imports the historical play director.
import { BALL_R, FIELD_W_YD, G, REC_HZ, YD } from '../constants.js';
import { rng } from '../rng.js';
import { AERO, solveLaunch } from '../ball.js';
import { Player, POSE, World } from '../world.js';
import { createInsideZoneRoster } from '../autonomous-run.js';
import { estimateBallCatchPoint, estimateBallLanding, ObservationMemory, turnHeadingToward } from './perception.js';
import { routeOffsets } from '../routes.js';
import { validateAssignments } from './assignments.js';
import { engagementHazardUniform, hazardDeadline, retroDecisionInterval } from './retro-cadence.js';
import { serializeReturnGeometry } from './field-geometry.js';
import { makeLiveProgressTracker } from './live-progress.js';
import { nextRecoveryAttempt } from './contact-attempts.js';

export function pruneExitedContactAttempts(attempted, activePlayerIds) {
  const active = new Set(activePlayerIds);
  for (const playerId of attempted) if (!active.has(playerId)) attempted.delete(playerId);
  return attempted;
}

export function firstUnattemptedContact(candidates, attempted, playerId = (candidate) => candidate.player.id) {
  return candidates.find((candidate) => !attempted.has(playerId(candidate))) ?? candidates[0] ?? null;
}

// Proactive catch attempts require an active receiving assignment. Accidental
// tips off protection players are not a modeled receiving action.
export function receivingAssignmentActive(task, released, engaged = false) {
  return task?.kind === 'route' && !engaged && (!task.check_release || released === true);
}

// Coverage defenders cannot intentionally play a pass before their controller
// has recognized it. Rushers retain the existing separate line-tip path;
// accidental body impacts are not yet modeled by this eligibility check.
export function coverageContestActive(task, recognized) {
  return !task || task.kind === 'rush' || recognized === true;
}

export function compareBallContact(a, b) {
  return a.planar - b.planar || a.player.id.localeCompare(b.player.id);
}

const MAX_SECONDS = 12; // pre-possession/pass-decision budget
const HARD_MAX_SECONDS = 36; // live returns and loose-ball recovery, matching run executor
const NO_PROGRESS_SECONDS = 3.5;
const DECISION_HZ = 10;
const QB_FIELD_OF_VIEW = 220 * Math.PI / 180;
const DEFENDER_FIELD_OF_VIEW = 190 * Math.PI / 180;
const RECEIVER_FIELD_OF_VIEW = DEFENDER_FIELD_OF_VIEW;
const PLAYER_GAZE_TURN_RATE = 5.5;
const QB_REACTION_DELAY_SECONDS = 0.18;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (x, y) => {
  const n = Math.hypot(x, y);
  return n > 1e-9 ? { x: x / n, y: y / n } : { x: 0, y: 0 };
};

export function passInterferenceContactEligible({ downfieldYards, ballDistanceYards,
  landingDistanceYards, receiverReachYards, closingSpeedMps = null }) {
  return downfieldYards >= 5 && ballDistanceYards >= 2.5
    && landingDistanceYards <= receiverReachYards
    && !(closingSpeedMps != null && closingSpeedMps <= 2.5);
}

export function tackleFinishChance({ tak, btk, strength, closing }) {
  return clamp(0.43 + (tak - btk) * 0.006 + strength * 0.0015 + closing * 0.027, 0.08, 0.92);
}

// A coverage defender can break only on an observed, reachable ball that
// threatens the assigned zone. Man defenders retain their receiver unless
// the estimated catch point is physically reachable before the ball arrives.
export function coverageBallOpportunity({ task, estimate, position, los, ballY, direction, speed }) {
  if (!estimate || !Number.isFinite(estimate.flightSeconds) || estimate.flightSeconds < 0) return false;
  const distance = Math.hypot(estimate.x - position.x, estimate.y - position.y);
  const reach = Math.max(0, speed) * estimate.flightSeconds + 1.5 * YD;
  if (distance > reach) return false;
  if (task.kind !== 'zone') return task.kind === 'man' || task.kind === 'read';
  const f = (estimate.x / YD - los) * direction;
  const l = (estimate.y / YD - ballY) * direction;
  const [f0, f1, l0, l1] = task.bounds;
  return f >= f0 - 3 && f <= f1 + 3 && l >= l0 - 3 && l <= l1 + 3;
}

// Contract defensive slots -> the roster slots the physics front knows.
const DEFENSE_SLOT_MAP = { LEDGE: 'LDE', REDGE: 'RDE', MLB: 'MIKE', WLB: 'WILL' };
const FRONT_TO_ROSTER = { nickel_over: 'nickel', nickel_under: 'nickel', nickel: 'nickel' };

const ALLOWED = new Set([
  'seed', 'los', 'dir', 'ballY', 'concept', 'direction', 'front', 'coverage',
  'ratingOverrides', 'playerIds', 'massOverrides', 'offenseTeam', 'defenseTeam',
  'assignments', 'behaviorMode', 'playerEvaluationMode', 'resultOnly', 'contestDiagnostics', 'physicsHz',
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
    assignments: input.assignments ?? null,
    behaviorMode: input.behaviorMode ?? (input.assignments ? 'retro' : 'detailed'),
    playerEvaluationMode: input.playerEvaluationMode ?? 'legacy_sequential',
    resultOnly: input.resultOnly ?? false,
    contestDiagnostics: input.contestDiagnostics ?? false,
    physicsHz: input.physicsHz ?? 120,
  };
  if (typeof cfg.resultOnly !== 'boolean') throw new TypeError('resultOnly must be boolean');
  if (typeof cfg.contestDiagnostics !== 'boolean') throw new TypeError('contestDiagnostics must be boolean');
  if (![60, 120, 240].includes(cfg.physicsHz)) throw new RangeError('physicsHz must be 60, 120, or 240');
  if (!['slant_flat', 'assigned'].includes(cfg.concept)) throw new RangeError(`unsupported passing concept: ${cfg.concept}`);
  if ((cfg.concept === 'assigned') !== (cfg.assignments != null)) throw new RangeError('assigned concept requires assignments');
  if (cfg.assignments) validateAssignments(cfg.assignments, { executable: true });
  if (!['retro', 'detailed'].includes(cfg.behaviorMode)) throw new RangeError('unsupported behavior mode');
  if (!['legacy_sequential', 'shared_snapshot'].includes(cfg.playerEvaluationMode)) {
    throw new RangeError('unsupported player evaluation mode');
  }
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
  const sharedSnapshot = cfg.playerEvaluationMode === 'shared_snapshot';
  const rosterInfo = createPassRoster(cfg);
  const W = new World(rand);
  const originalEvent = W.event.bind(W);
  const pendingCallbackEvents = [];
  let collectingCallbackEvents = false;
  const stableEventValue = (value) => {
    if (Array.isArray(value)) return `[${value.map(stableEventValue).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${stableEventValue(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  };
  W.event = (type, data = {}) => {
    if (sharedSnapshot && collectingCallbackEvents) pendingCallbackEvents.push({ type, data });
    else originalEvent(type, data);
  };
  const physicsDt = 1 / cfg.physicsHz;
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
    p.ai.routeStart = spot;
    p.p = { x: at(spot.f, spot.l).x, y: at(spot.f, spot.l).y };
    p.h = info.team === 'O' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI : 0);
    const blockRating = info.team === 'O' ? (p.R.PBK ?? p.R.RBK ?? 60) : (p.R.BSH ?? Math.max(p.R.PMV ?? 50, p.R.FMV ?? 50));
    p.engageMul = (0.75 + (0.5 * ((blockRating ?? 60) - 50)) / 50) * (0.8 + 0.2 * (p.R.STR ?? 60) / 80);
    p.ai.assignment = 'align';
    p.ai.decision = 'read snap';
    if (cfg.assignments) {
      const task = cfg.assignments[info.team === 'O' ? 'offense' : 'defense'][p.slot];
      if (!task) throw new RangeError(`missing pass assignment for ${info.team}.${p.slot}`);
      p.ai.playAssignment = task;
      W.event('assignment_executed', { player_id: p.id, role: p.roleKey, task });
    }
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
  const lastSeenMemory = new ObservationMemory({ reactionDelaySeconds: QB_REACTION_DELAY_SECONDS });
  const routeReceivers = cfg.assignments ? offense.filter((p) => cfg.assignments.offense[p.slot].kind === 'route') : [z, slotRec, rb];
  const qbObservationTargets = [...new Set([...routeReceivers, ...defense].filter(Boolean))];
  const defenderBallObservations = new Map();
  const receiverBallObservations = new Map();
  qb.ai.gazeHeading = dir > 0 ? 0 : Math.PI;
  let observedDefenderBallPredictions = 0;
  let observedReceiverBallPredictions = 0;
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
    const task = cfg.assignments?.offense[p.slot];
    if (task?.kind === 'route') setIntent(p, `run ${task.route} route`, task.check_release ? 'check protection before releasing' : 'follow route landmarks');
    else if (task?.kind === 'block') setIntent(p, `pass set ${p.slot}`, 'protect the pocket');
    else if (linemen.includes(p)) setIntent(p, `pass set ${p.slot}`, 'protect the inside lane and pick up the nearest rusher');
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
  if (cfg.assignments) {
    for (const p of defense) {
      const task = cfg.assignments.defense[p.slot];
      const description = task.kind === 'man' ? `cover ${task.target_slot} man` :
        task.kind === 'zone' ? 'cover assigned zone' : task.kind === 'rush' ? 'rush the passer' : 'read the play';
      setIntent(p, description, 'execute assigned responsibility');
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
  let throwSequence = 0;
  let currentThrowDiagnostics = null;
  let activeContactOpportunities = new Map();
  let activePhysicalOpportunities = new Map();
  let attemptedReceiverContacts = new Set();
  let attemptedDefenderContacts = new Set();
  let currentPhysicalOpportunityId = null;
  let physicalOpportunitySequence = 0;
  const contestDiagnostics = cfg.contestDiagnostics ? { throws: [], by_player: {} } : null;
  let sack = null, tackle = null, terminal = null, fumble = null, fumbleRecovery = null;
  const fumbleRecoveryAttempts = new Set();
  let pendingPass = null, pendingThrowaway = false;
  const pendingSackCandidates = new Set();
  const pendingBlockRequests = new Map();
  const pendingShedRequests = new Map();
  const pendingFumbleEngagements = new Map();
  let tickEngagementSnapshot = null;
  let fumbleRecoverySpot = null;
  let passInterference = null;
  let maxForward = null;
  let lastInBounds = { x: ballAtSnap.x, y: ballAtSnap.y };
  let lastCarrierX = null;
  let interceptionPossession = null;
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

  function protectionThreat(q) {
    if (q.down) return false;
    if (q.info.group === 'DL') return true;
    // Recognize a rusher from movement and position, not the defensive call.
    return fOf(q) <= 1.5 && (q.v.x * dir < -0.25 || d2(q, qb) < 3.2 * YD);
  }

  function rankBlockTargets(p) {
    const engagedAtTick = (q) => tickEngagementSnapshot?.has(q.id)
      ? tickEngagementSnapshot.get(q.id) : q.engaged;
    const area = cfg.assignments?.offense[p.slot]?.protection_area;
    const pool = defense.filter((q) => (cfg.assignments ? protectionThreat(q) : !q.down && q.info.group === 'DL')
      && (!area || (lOf(q) >= area[0] && lOf(q) <= area[1]))
      && (!engagedAtTick(q) || engagedAtTick(q) === p));
    const free = pool.filter((q) => !engagedAtTick(q));
    const options = free.length ? free : pool;
    if (!options.length) return [];
    // Protect the inside first: nearest rusher to the quarterback, then nearest to the blocker.
    return options.map((q) => [d2(q, qb) * 0.55 + d2(q, p) * 0.45, q])
      .sort((a, b) => a[0] - b[0] || a[1].id.localeCompare(b[1].id))
      .map(([, target]) => target);
  }

  function chooseBlockTarget(p) {
    if (!sharedSnapshot && !cfg.assignments) {
      const pool = defense.filter((q) => (cfg.assignments ? protectionThreat(q) : !q.down && q.info.group === 'DL') && (!q.engaged || q.engaged === p));
      const free = pool.filter((q) => !q.engaged);
      const options = free.length ? free : pool;
      if (!options.length) return null;
      const scored = options.map((q) => [d2(q, qb) * 0.55 + d2(q, p) * 0.45, q])
        .sort((a, b) => a[0] - b[0] || a[1].id.localeCompare(b[1].id));
      return scored[0][1];
    }
    return rankBlockTargets(p)[0] ?? null;
  }

  function engageBlocker(p, d, mode = 'pass_set') {
    if (!d || p.engaged || d.engaged || p.down || d.down) return;
    if (d2(p, d) > p.r + d.r + 0.15) return;
    if (!sharedSnapshot) {
      W.engage(p, d);
      return;
    }
    const candidates = (mode === 'check_release' ? [d] : rankBlockTargets(p))
      .filter((candidate) => !candidate.down
        && d2(p, candidate) <= p.r + candidate.r + 0.15
        && (candidate.shedCD ?? 0) <= 0);
    pendingBlockRequests.set(p.id, { blocker: p, preferred: d, candidates, mode });
  }

  function resolveBlockRequests() {
    const requests = [...pendingBlockRequests.values()]
      .sort((a, b) => W.players.indexOf(a.blocker) - W.players.indexOf(b.blocker));
    pendingBlockRequests.clear();
    for (const request of requests) {
      const { blocker, mode } = request;
      if (blocker.down || blocker.engaged) continue;
      const target = request.candidates.find((candidate) => !candidate.down && !candidate.engaged
        && (candidate.shedCD ?? 0) <= 0
        && d2(blocker, candidate) <= blocker.r + candidate.r + 0.15);
      if (!target || target.engaged) continue;
      blocker.ai.blockOn = target;
      if (mode === 'check_release') {
        blocker.dv = seek(blocker, lead(blocker, target, 0.1), 0.75, 12);
      } else {
        blocker.dv = seek(blocker, lead(blocker, target, 0.12), 0.9, 14);
        blocker.face = Math.atan2(target.p.y - blocker.p.y, target.p.x - blocker.p.x);
      }
      W.engage(blocker, target);
    }
  }

  function resolveFumbleEngagements() {
    const requests = [...pendingFumbleEngagements.values()]
      .sort((a, b) => W.players.indexOf(a.blocker) - W.players.indexOf(b.blocker));
    pendingFumbleEngagements.clear();
    for (const { blocker, defender } of requests) {
      if (blocker.down || defender.down || blocker.engaged || defender.engaged
          || d2(blocker, defender) >= 1.0) continue;
      W.engage(blocker, defender);
    }
  }

  const shedDeadlines = new WeakMap();
  const shedOrdinals = new Map();
  function shedUniform(engagement) {
    const pairKey = [engagement.a.id, engagement.b.id].sort().join('|');
    const ordinal = shedOrdinals.get(pairKey) ?? 0;
    shedOrdinals.set(pairKey, ordinal + 1);
    return engagementHazardUniform(cfg.seed, pairKey, ordinal);
  }
  function shedDue(defender, engagement, blocker) {
    const attack = defender.info.group === 'DL'
      ? Math.max(defender.R.PMV ?? 50, defender.R.FMV ?? 50, defender.R.BSH ?? 50)
      : defender.R.BSH ?? 50;
    const block = blocker.R.PBK ?? blocker.R.RBK ?? 50;
    const rate = clamp(0.34 * Math.exp((attack - block) / 22), 0.05, 3);
    if (!shedDeadlines.has(engagement)) {
      shedDeadlines.set(engagement, hazardDeadline(engagement.t0, rate, shedUniform(engagement)));
    }
    return W.t >= shedDeadlines.get(engagement);
  }

  function tryShed(d) {
    const e = W.engagements.find((x) => x.a === d || x.b === d);
    if (!e) return;
    const blocker = e.a === d ? e.b : e.a;
    if (blocker.team !== 'O') return;
    if (!sharedSnapshot) {
      if (cfg.assignments) {
        if (shedDue(d, e, blocker)) W.disengage(e, d);
        return;
      }
      const attack = d.info.group === 'DL' ? Math.max(d.R.PMV ?? 50, d.R.FMV ?? 50, d.R.BSH ?? 50) : d.R.BSH ?? 50;
      const block = blocker.R.PBK ?? blocker.R.RBK ?? 50;
      const rate = clamp(0.34 * Math.exp((attack - block) / 22), 0.05, 3);
      if (rand() < rate * physicsDt) W.disengage(e, d);
      return;
    }
    pendingShedRequests.set(d.id, { defender: d, engagement: e });
  }

  function resolveShedRequests() {
    const requests = [...pendingShedRequests.values()]
      .sort((a, b) => W.players.indexOf(a.defender) - W.players.indexOf(b.defender));
    pendingShedRequests.clear();
    for (const { defender, engagement } of requests) {
      if (!W.engagements.includes(engagement)
          || (engagement.a !== defender && engagement.b !== defender)) continue;
      const blocker = engagement.a === defender ? engagement.b : engagement.a;
      if (cfg.assignments) {
        if (shedDue(defender, engagement, blocker)) W.disengage(engagement, defender);
        continue;
      }
      if (shedDue(defender, engagement, blocker)) W.disengage(engagement, defender);
    }
  }

  function routeTarget(p) {
    const t = W.t - (throwInfo?.snapT ?? 0);
    if (cfg.assignments) {
      const task = cfg.assignments.offense[p.slot];
      if (task.kind !== 'route') return null;
      if (task.check_release && !p.ai.protectionReleased) return null;
      const start = p.ai.routeStart;
      const offsets = routeOffsets(task.route, start.l || side);
      const points = offsets.map(([f, l]) => at(start.f + f, start.l + l));
      let index = p.ai.routeIndex ?? 0;
      if (index < points.length - 1 && dist(p.p, points[index]) < 0.8 * YD) {
        index++;
        W.event('route_break', { player_id: p.id, role: p.roleKey, route: task.route, waypoint: index });
      }
      p.ai.routeIndex = index;
      return points[index];
    }
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
  function updateQbPerception(elapsed) {
    if (cfg.behaviorMode === 'retro') return;
    // Route knowledge sets gaze; field of view and player-body occlusion still gate sensed locations.
    const readOrder = cfg.assignments?.offense.QB.read_order;
    const readStart = 0.75 + (cfg.assignments?.offense.QB.decision_delay_seconds ?? 0);
    const readSlot = readOrder?.[Math.min(readOrder.length - 1, Math.max(0, Math.floor((elapsed - readStart) / 0.35)))];
    const read = readOrder ? get(`O.${readSlot}`)
      : cfg.assignments && routeReceivers[Math.floor(elapsed / 0.5) % routeReceivers.length];
    const lookPoint = read ? read.p : elapsed < 1.2 ? at(2.6, side * 17)
      : elapsed < 1.65 ? at(2.4, side * 15) : at(1.6, side * 3.2);
    const desiredGaze = Math.atan2(lookPoint.y - qb.p.y, lookPoint.x - qb.p.x);
    qb.ai.gazeHeading = turnHeadingToward(qb.ai.gazeHeading ?? qb.h, desiredGaze,
      PLAYER_GAZE_TURN_RATE / DECISION_HZ);
    for (const target of qbObservationTargets) {
      lastSeenMemory.capture(qb, target, W.players, W.t, {
        heading: qb.ai.gazeHeading, fieldOfView: QB_FIELD_OF_VIEW, maxDistance: 38 * YD,
        observerEyeHeight: 1.72, targetEyeHeight: 1.65,
      });
    }
    lastSeenMemory.advance(W.t);
  }

  // Retro mode uses present relevant positions, with no gaze cone or delayed-memory model.
  const observe = (p) => cfg.behaviorMode === 'retro'
    ? { position: { ...p.p }, velocity: { ...p.v }, down: p.down,
        confidence: 1, uncertaintyMeters: 0, ageSeconds: 0 }
    : lastSeenMemory.estimate(p.id, W.t);

  function nearestObservedRusher() {
    return defense.filter((player) => player.info.group === 'DL')
      .map((player) => ({ player, estimate: observe(player) }))
      .filter((item) => item.estimate && !item.estimate.down && item.estimate.confidence > 0.08)
      .map((item) => ({ ...item, distance: Math.hypot(item.estimate.position.x - qb.p.x,
        item.estimate.position.y - qb.p.y) }))
      .sort((a, b) => a.distance - b.distance || a.player.id.localeCompare(b.player.id))[0] ?? null;
  }

  // Pressure is a coarse contact cue. Exact unseen rusher coordinates stay inside physics.
  function sensedPressure() {
    if (qb.engaged || defense.some((player) => !player.down && d2(player, qb) <= qb.r + player.r + 0.35 * YD)) {
      return { level: 'contact', distance: 0.65 };
    }
    if (defense.some((player) => !player.down && d2(player, qb) <= 2.4 * YD)) {
      return { level: 'nearby', distance: 1.65 };
    }
    return { level: 'none', distance: 4.5 };
  }

  function readOptions() {
    const throwers = routeReceivers.filter(Boolean);
    const gaze = qb.ai.gazeHeading;
    // Read only delayed observations and their confidence/uncertainty, never a target's live position.
    return throwers.flatMap((rec) => {
      if (cfg.assignments && !receivingAssignmentActive(cfg.assignments.offense[rec.slot],
        rec.ai.protectionReleased, !!rec.engaged)) return [];
      const receiver = observe(rec);
      if (!receiver || receiver.down || receiver.confidence < 0.12) return [];
      const flight = clamp(Math.hypot(receiver.position.x - qb.p.x, receiver.position.y - qb.p.y) / (16 * YD), 0.32, 1.25);
      const aim = { x: receiver.position.x + receiver.velocity.x * flight * 0.75,
        y: receiver.position.y + receiver.velocity.y * flight * 0.75 };
      const defendersSeen = defense
        .map((player) => ({ player, estimate: observe(player) }))
        .filter((item) => item.estimate && !item.estimate.down && item.estimate.confidence > 0.08)
        .map((item) => ({ ...item, distance: Math.hypot(item.estimate.position.x - receiver.position.x,
          item.estimate.position.y - receiver.position.y) }))
        .sort((a, b) => a.distance - b.distance || a.player.id.localeCompare(b.player.id));
      const nearest = defendersSeen[0] ?? null;
      // Unknown coverage is conservative; uncertainty widens each perceived defender's radius.
      const separation = nearest
        ? Math.max(0, nearest.distance - receiver.uncertaintyMeters - nearest.estimate.uncertaintyMeters) / YD
        : 1.2;
      // Defenders sitting on the throwing line are the interception risk.
      let lane = nearest ? 0 : 0.45;
      const ux = aim.x - qb.p.x, uy = aim.y - qb.p.y;
      const len = Math.hypot(ux, uy) || 1;
      for (const item of defendersSeen) {
        if (nearest && item.player === nearest.player) continue;
        const rx = item.estimate.position.x - qb.p.x, ry = item.estimate.position.y - qb.p.y;
        const along = (rx * ux + ry * uy) / len;
        if (along <= 0.4 || along >= len) continue;
        const perp = Math.abs(rx * uy - ry * ux) / len;
        const laneRadius = YD + item.estimate.uncertaintyMeters + receiver.uncertaintyMeters;
        if (perp < laneRadius) lane += (1 - perp / laneRadius) * item.estimate.confidence;
      }
      const pressure = sensedPressure().distance;
      const open = clamp((separation - 0.7) / 2.2, 0, 1) * receiver.confidence;
      const utility = open * 1.6 + (1 - clamp(lane / 2.4, 0, 1)) * 0.75
        - clamp(lane * 0.55, 0, 1.35) - clamp((1.6 - pressure) * 0.45, 0, 0.9)
        - clamp(Math.hypot(receiver.position.x - qb.p.x, receiver.position.y - qb.p.y) / (28 * YD), 0, 0.5)
        - receiver.uncertaintyMeters / YD * 0.08;
      const order = cfg.assignments?.offense.QB.read_order;
      const readiness = order ? 0.75 + (cfg.assignments.offense.QB.decision_delay_seconds ?? 0) + order.indexOf(rec.slot) * 0.35
        : cfg.assignments ? 0.5 + routeReceivers.indexOf(rec) * 0.15 : rec === z ? 0.35 : rec === slotRec ? 0.55 : 1.05;
      return [{ receiver: rec, aim, flight, separation, lane, pressure, utility, readyAt: readiness,
        observationAge: receiver.ageSeconds, observationConfidence: receiver.confidence,
        observationUncertainty: receiver.uncertaintyMeters, gazeHeading: gaze }];
    }).sort((a, b) => b.utility - a.utility || a.receiver.id.localeCompare(b.receiver.id));
  }

  function beginAirborneThrow({ type, targetId = null, targetSeparation = null, laneRisk = null,
    pressure = null, accuracy = null, sigma = null, flightSeconds, landing }) {
    resolveAttempt = null;
    attemptedReceiverContacts = new Set();
    attemptedDefenderContacts = new Set();
    activeContactOpportunities = new Map();
    activePhysicalOpportunities = new Map();
    currentPhysicalOpportunityId = null;
    physicalOpportunitySequence = 0;
    if (!contestDiagnostics) return;
    currentThrowDiagnostics = {
      throw_id: ++throwSequence,
      type,
      quarterback_id: qb.id,
      target_id: targetId,
      target_separation_yards: targetSeparation,
      lane_risk: laneRisk,
      pressure_yards: pressure,
      accuracy_rating: accuracy,
      accuracy_sigma_yards: sigma,
      flight_seconds: flightSeconds,
      landing,
      resolve_attempts: 0,
      no_candidate_attempts: 0,
      receiver_candidate_ticks: 0,
      defender_candidate_ticks: 0,
      target_min_planar_yards: null,
      receiver_min_planar_yards: null,
      defender_min_planar_yards: null,
      target_reachable_ticks: 0,
      receiver_reachable_ticks: 0,
      defender_reachable_ticks: 0,
      probability_draws: 0,
      draws_by_player: {},
      probability_draw_trace: [],
      contact_opportunities: [],
      physical_opportunities: [],
    };
    contestDiagnostics.throws.push(currentThrowDiagnostics);
  }

  function preparePassLaunch(best) {
    const from = { x: W.ball.x, y: W.ball.y, z: 1.45 };
    // Location error is the quarterback's, not the receiver's: it grows with
    // throw distance and pressure and shrinks with accuracy.
    const accuracy = cfg.assignments ? (qb.R.THA ?? 70) : (qb.R.ACC ?? qb.R.THN ?? qb.R.AWR ?? 70);
    const distanceYd = Math.hypot(best.aim.x - qb.p.x, best.aim.y - qb.p.y) / YD;
    const sigma = clamp(0.28 + distanceYd * 0.026 + clamp(2.0 - best.pressure, 0, 1.6) * 0.30
      + clamp((72 - accuracy) * 0.012, -0.12, 0.35), 0.12, 1.5);
    const to = {
      x: best.aim.x + rand.normal() * sigma * YD,
      y: best.aim.y + rand.normal() * sigma * YD,
      z: 1.5,
    };
    const flight = solveLaunch(from, to, Math.max(0.32, best.flight), AERO.spiral);
    W.auditDecision?.('qb_launch',{player_id:qb.id,target_id:best.receiver.id,from,to,
      aim:best.aim,flight_s:best.flight,target_position_m:{...best.receiver.p},
      target_velocity_mps:{...best.receiver.v},accuracy,sigma,utility:best.utility});
    return { best, from, to, flight, accuracy, sigma };
  }

  function launchPass(prepared) {
    const { best, from, to, flight, accuracy, sigma } = prepared;
    Object.assign(W.ball, {
      state: 'air', holder: null, x: from.x, y: from.y, z: from.z,
      vx: flight.vx, vy: flight.vy, vz: flight.vz, k: flight.k,
    });
    beginAirborneThrow({ type: 'pass', targetId: best.receiver.id,
      targetSeparation: best.separation, laneRisk: best.lane, pressure: best.pressure,
      accuracy, sigma, flightSeconds: best.flight, landing: { x: to.x / YD, y: to.y / YD } });
    if (currentThrowDiagnostics) {
      currentThrowDiagnostics.accuracy_offset_yards = Math.hypot(to.x - best.aim.x, to.y - best.aim.y) / YD;
    }
    qb.hasBall = false;
    W.ball.thrower = qb;
    W.ball.target = best.receiver;
    W.ball.landing = { x: to.x, y: to.y };
    W.ball.thrownAt = W.t;
    W.event('throw', {
      quarterback_id: qb.id, target_id: best.receiver.id,
      ...(cfg.assignments ? { accuracy_rating: accuracy, accuracy_sigma_yards: sigma } : {}),
      separation_yards: best.separation, lane_risk: best.lane,
      pressure_yards: best.pressure, flight_seconds: best.flight,
      target_observation_age_seconds: best.observationAge,
      target_observation_confidence: best.observationConfidence,
      target_observation_uncertainty_meters: best.observationUncertainty,
      gaze_heading: best.gazeHeading,
    });
    setIntent(qb, 'throw to the open read', `release to ${best.receiver.slot} with ${best.separation.toFixed(1)} yd separation`);
  }

  function qbDecision() {
    if (!received || W.ball.holder !== qb) return;
    const elapsed = W.t - (W.ball.receivedAt ?? 0);
    updateQbPerception(elapsed);
    // A three-step drop from the gun takes about 0.8 s before the first read is live.
    if (elapsed < 0.75 + (cfg.assignments?.offense.QB.decision_delay_seconds ?? 0)) { setIntent(qb, 'complete the drop', 'get to the top of the drop before reading'); return; }
    const allOptions = readOptions();
    const availableOptions = allOptions.filter((o) => elapsed >= o.readyAt);
    W.auditDecision?.('qb_options',{player_id:qb.id,elapsed_s:elapsed,
      candidates:allOptions.map(({receiver,...rest})=>({id:receiver.id,role:receiver.roleKey,ready:elapsed>=rest.readyAt,...rest}))});
    const pressureCue = sensedPressure();
    const pressure = pressureCue.distance;
    if (cfg.assignments && qb.ai.escape && qb.ai.escapeReason !== 'illegal_throwaway'
        && pressureCue.level === 'none') {
      qb.ai.escape = null;
      qb.ai.escapeReason = null;
      qb.ai.quarterbackState = 'read';
      W.event('quarterback_state', { player_id: qb.id, state: 'read', reason: 'pressure_cleared' });
    }
    const progression = cfg.assignments?.offense.QB.read_order;
    const developedOptions = cfg.assignments && !progression
      ? availableOptions.filter((option) => fOf(option.receiver) >= 5)
      : availableOptions;
    const options = developedOptions.length ? developedOptions : availableOptions;
    if (progression) options.sort((a, b) => progression.indexOf(a.receiver.slot) - progression.indexOf(b.receiver.slot));
    if (cfg.assignments && !progression && !developedOptions.length && elapsed < 1.35 && pressure >= 1.1) {
      setIntent(qb, 'let routes develop', 'hold the pocket until a route clears the five-yard contact zone');
      return;
    }
    if (options.length) {
      const best = progression ? options.find((option) => option.utility > 0.62
        || (pressure < 1.5 && option.utility > 0.34)) ?? options[0] : options[0];
      if (best.utility > 0.62 || (pressure < 1.5 && best.utility > 0.34)) {
        // Draw the throw's error at the QB's decision point, but hold the ball
        // transition until every player has observed the same held-ball snapshot.
        const prepared = preparePassLaunch(best);
        if (sharedSnapshot) pendingPass = prepared;
        else launchPass(prepared);
        return;
      }
      W.event('qb_read', {
        quarterback_id: qb.id,
        target_id: best.receiver.id,
        utility: Number(best.utility.toFixed(3)),
        separation_yards: Number(best.separation.toFixed(2)),
        pressure_yards: Number(pressure.toFixed(2)),
        target_observation_age_seconds: best.observationAge,
        target_observation_confidence: best.observationConfidence,
      });
    }
    if (pressure < 1.1 && elapsed < 3.0) {
      // Escape from remembered pressure direction; a tactile cue alone does not reveal exact coordinates.
      const rusher = nearestObservedRusher();
      const away = rusher ? unit(qb.p.x - rusher.estimate.position.x, qb.p.y - rusher.estimate.position.y)
        : unit(-dir * 0.25, -side);
      qb.ai.escape = { x: away.x, y: away.y };
      if (cfg.assignments && qb.ai.quarterbackState !== 'escape') {
        qb.ai.quarterbackState = 'escape';
        W.event('quarterback_state', { player_id: qb.id, state: 'escape', reason: 'pressure' });
      }
      setIntent(qb, 'scramble away from pressure', rusher
        ? `move away from remembered pressure by ${rusher.player.slot}` : 'use a pressure cue and remembered pocket space');
    } else if (elapsed > 3.0) {
      const target = legalThrowawayTarget();
      if (target) {
        if (sharedSnapshot) pendingThrowaway = true;
        else launchThrowaway(target);
      } else {
        const lateralSide = Math.sign(lOf(qb)) || side;
        const escape = unit(dir * 0.2, dir * lateralSide);
        qb.ai.escape = escape;
        qb.ai.escapeReason = 'illegal_throwaway';
        if (qb.ai.quarterbackState !== 'escape') {
          qb.ai.quarterbackState = 'escape';
          W.event('quarterback_state', { player_id: qb.id, state: 'escape', reason: 'throwaway_not_legal_from_pocket' });
        }
        setIntent(qb, 'scramble away from pressure', 'keep the ball and move outside the pocket before throwing it away');
      }
    }
  }

  function legalThrowawayTarget() {
    // The pocket extends five yards laterally from the center. An outside
    // throwaway must also carry the ball beyond the line of scrimmage.
    if (Math.abs(lOf(qb)) <= 5) return null;
    const target = at(1.0, (Math.sign(lOf(qb)) || side) * 22);
    const forwardYards = (target.x / YD - cfg.los) * dir;
    if (forwardYards < 0 || target.y < YD || target.y > (FIELD_W_YD - 1) * YD) return null;
    return target;
  }

  function launchThrowaway(target = legalThrowawayTarget()) {
    if (!target) return false;
    const flight = solveLaunch({ x: W.ball.x, y: W.ball.y, z: 1.4 }, { x: target.x, y: target.y, z: 0.2 }, 0.9, AERO.spiral);
    Object.assign(W.ball, { state: 'air', holder: null, vx: flight.vx, vy: flight.vy, vz: flight.vz, k: flight.k });
    W.ball.intentionalGround = true;
    W.ball.thrower = qb;
    W.ball.target = null;
    W.ball.landing = { x: target.x, y: target.y };
    W.ball.thrownAt = W.t;
    beginAirborneThrow({ type: 'throwaway', flightSeconds: 0.9,
      landing: { x: target.x / YD, y: target.y / YD } });
    qb.hasBall = false;
    W.event('throw_away', { quarterback_id: qb.id });
    return true;
  }

  // ------------------------------------------------------------ ball contest
  function catchCandidates() {
    const b = W.ball;
    const out = [];
    for (const p of W.players) {
      if (p.down) continue;
      if (cfg.assignments && p.team === 'O' && !receivingAssignmentActive(cfg.assignments.offense[p.slot],
        p.ai.protectionReleased, !!p.engaged)) continue;
      const planar = Math.hypot(p.p.x - b.x, p.p.y - b.y) / YD;
      const reach = 1.15 + p.r / YD;
      if (planar > reach) continue;
      if (b.z < 0.35 || b.z > 2.75) continue;
      out.push({ player: p, planar });
    }
    return out.sort(compareBallContact);
  }

  function recordAirborneReachability() {
    if (!contestDiagnostics || !currentThrowDiagnostics || W.ball.state !== 'air') return;
    const eligibleReceivers = offense.filter((p) => !p.down
      && (!cfg.assignments || receivingAssignmentActive(cfg.assignments.offense[p.slot],
        p.ai.protectionReleased, !!p.engaged)));
    const availableDefenders = defense.filter((p) => !p.down);
    const distance = (p) => Math.hypot(p.p.x - W.ball.x, p.p.y - W.ball.y) / YD;
    const receiverDistances = eligibleReceivers.map((p) => ({ p, d: distance(p) }));
    const defenderDistances = availableDefenders.map((player) => ({ p: player, d: distance(player) }));
    const targetDistance = receiverDistances.find(({ p }) => p.id === currentThrowDiagnostics.target_id)?.d;
    const receiverMin = Math.min(...receiverDistances.map(({ d }) => d), Infinity);
    const defenderMin = Math.min(...defenderDistances.map(({ d }) => d), Infinity);
    if (Number.isFinite(targetDistance)) currentThrowDiagnostics.target_min_planar_yards = Math.min(
      currentThrowDiagnostics.target_min_planar_yards ?? targetDistance, targetDistance);
    if (Number.isFinite(receiverMin)) currentThrowDiagnostics.receiver_min_planar_yards = Math.min(
      currentThrowDiagnostics.receiver_min_planar_yards ?? receiverMin, receiverMin);
    if (Number.isFinite(defenderMin)) currentThrowDiagnostics.defender_min_planar_yards = Math.min(
      currentThrowDiagnostics.defender_min_planar_yards ?? defenderMin, defenderMin);
    if (W.ball.z >= 0.35 && W.ball.z <= 2.75) {
      const target = eligibleReceivers.find((p) => p.id === currentThrowDiagnostics.target_id);
      if (target && targetDistance <= 1.15 + target.r / YD) {
        currentThrowDiagnostics.target_reachable_ticks += 1;
      }
      if (receiverDistances.some(({ p, d }) => d <= 1.15 + p.r / YD)) {
        currentThrowDiagnostics.receiver_reachable_ticks += 1;
      }
      if (defenderDistances.some(({ p, d }) => d <= 1.15 + p.r / YD)) {
        currentThrowDiagnostics.defender_reachable_ticks += 1;
      }
    }
  }

  // Resolve the first player able to play the ball. The receiver wins the ball
  // on his own merits; an interception needs a defender who is genuinely at
  // the catch point, which is why most failed catches are simply incomplete.
  function resolveContest() {
    const geometricCandidates = catchCandidates();
    const candidates = geometricCandidates.filter(({player:p,planar}) => {
      const eligible = !cfg.assignments || p.team !== 'D' ||
        coverageContestActive(cfg.assignments.defense[p.slot], p.ai.ballContestRecognized);
      if (!eligible) W.auditDecision?.('coverage_contact_rejected',{player_id:p.id,role:p.roleKey,
        planar_yards:planar,ball_z:W.ball.z,reason:'pass_not_recognized'});
      return eligible;
    });
    W.auditDecision?.('catch_candidates',{ball:{x:W.ball.x,y:W.ball.y,z:W.ball.z},candidates:candidates.map(c=>({id:c.player.id,role:c.player.roleKey,team:c.player.team,planar_yards:c.planar,engaged:c.player.engaged?.id??null,heading:c.player.h,
      assignment:c.player.ai.playAssignment??null,recognized:c.player.ai.ballContestRecognized??null}))});
    const offenseCandidates = candidates.filter((candidate) => candidate.player.team === 'O');
    const defenseCandidates = candidates.filter((candidate) => candidate.player.team !== 'O');
    // Losing recognition does not end an uninterrupted physical opportunity.
    // Only geometric separation can re-arm a contact's probability draw.
    const activeCandidateIds = new Set(geometricCandidates.map((candidate) => candidate.player.id));
    pruneExitedContactAttempts(attemptedReceiverContacts,
      geometricCandidates.filter(c=>c.player.team==='O').map(c=>c.player.id));
    pruneExitedContactAttempts(attemptedDefenderContacts,
      geometricCandidates.filter(c=>c.player.team!=='O').map(c=>c.player.id));
    if (contestDiagnostics && currentThrowDiagnostics) {
      currentThrowDiagnostics.resolve_attempts += 1;
      if (candidates.length === 0) currentThrowDiagnostics.no_candidate_attempts += 1;
      currentThrowDiagnostics.receiver_candidate_ticks += offenseCandidates.length;
      currentThrowDiagnostics.defender_candidate_ticks += defenseCandidates.length;
      for (const id of activeContactOpportunities.keys()) {
        if (!activeCandidateIds.has(id)) activeContactOpportunities.delete(id);
      }
      for (const id of activePhysicalOpportunities.keys()) {
        if (!activeCandidateIds.has(id)) activePhysicalOpportunities.delete(id);
      }
      for (const candidate of geometricCandidates) {
        const playerId = candidate.player.id;
        let opportunity = activeContactOpportunities.get(playerId);
        if (!opportunity) {
          opportunity = {
            opportunity_id: `${currentThrowDiagnostics.throw_id}:${playerId}:${currentThrowDiagnostics.contact_opportunities.length + 1}`,
            player_id: playerId,
            first_time_seconds: Number(W.t.toFixed(4)),
            last_time_seconds: Number(W.t.toFixed(4)),
            first_planar_yards: Number(candidate.planar.toFixed(4)),
            last_planar_yards: Number(candidate.planar.toFixed(4)),
            min_planar_yards: Number(candidate.planar.toFixed(4)),
            max_planar_yards: Number(candidate.planar.toFixed(4)),
            resolve_attempts: 0,
            probability_draws: 0,
            draw_types: {},
          };
          activeContactOpportunities.set(playerId, opportunity);
          currentThrowDiagnostics.contact_opportunities.push(opportunity);
        }
        opportunity.resolve_attempts += 1;
        opportunity.last_time_seconds = Number(W.t.toFixed(4));
        opportunity.last_planar_yards = Number(candidate.planar.toFixed(4));
        opportunity.min_planar_yards = Math.min(opportunity.min_planar_yards, candidate.planar);
        opportunity.max_planar_yards = Math.max(opportunity.max_planar_yards, candidate.planar);
        let physicalOpportunity = activePhysicalOpportunities.get(playerId);
        if (!physicalOpportunity) {
          physicalOpportunity = {
            opportunity_id: `${currentThrowDiagnostics.throw_id}:contact:${++physicalOpportunitySequence}`,
            player_id: playerId,
            team: candidate.player.team,
            first_time_seconds: Number(W.t.toFixed(4)),
            last_time_seconds: Number(W.t.toFixed(4)),
            resolve_attempts: 0,
            probability_draws: 0,
            draw_types: {},
          };
          activePhysicalOpportunities.set(playerId, physicalOpportunity);
          currentThrowDiagnostics.physical_opportunities.push(physicalOpportunity);
        }
        physicalOpportunity.resolve_attempts += 1;
        physicalOpportunity.last_time_seconds = Number(W.t.toFixed(4));
      }
    }
    if (!candidates.length) return;

    const receiver = firstUnattemptedContact(offenseCandidates, attemptedReceiverContacts);
    const defender = firstUnattemptedContact(defenseCandidates, attemptedDefenderContacts);
    const separation = receiver && defender
      ? d2(receiver.player, defender.player) / YD
      : receiver ? 6 : 0;
    const ballZ = W.ball.z;

    // At a simultaneous reach, the closer unattempted player has the first
    // physical opportunity. A defender already touching the ball must not
    // pre-empt a newly arriving receiver with another probability draw.
    if (cfg.assignments && receiver && defender && compareBallContact(defender, receiver) < 0
        && !attemptedDefenderContacts.has(defender.player.id)) {
      attemptedDefenderContacts.add(defender.player.id);
      currentPhysicalOpportunityId = defender.player.id;
      const chance = clamp(0.045 - separation * 0.03
        + ((defender.player.R.PRC ?? 60) - 60) * 0.0005, 0.005, 0.05);
      W.event('catch_contest', { player_id: defender.player.id, team: defender.player.team,
        chance: Number(chance.toFixed(3)), separation_yards: Number(separation.toFixed(2)),
        ball_z: Number(ballZ.toFixed(2)) });
      if (contestRoll('contested_interception', defender.player, chance) < chance) {
        secure(defender.player); return;
      }
      knockDown(defender.player);
      return;
    }

    if (receiver) {
      let resolvedInteraction = false;
      if (!attemptedReceiverContacts.has(receiver.player.id)) {
        attemptedReceiverContacts.add(receiver.player.id);
        currentPhysicalOpportunityId = receiver.player.id;
        const skill = ((receiver.player.R.CTH ?? receiver.player.R.CAR ?? 70) * 0.7
          + (receiver.player.R.AWR ?? 60) * 0.3);
        const traffic = defender ? clamp(1.8 - separation, 0, 1.8) : 0;
        const chance = clamp(0.9 + (skill - 70) * 0.005 - traffic * 0.16
          - clamp(Math.abs(ballZ - 1.6) * 0.12, 0, 0.2), 0.35, 0.97);
        W.event('catch_contest', {
          player_id: receiver.player.id, team: receiver.player.team, chance: Number(chance.toFixed(3)),
          separation_yards: Number(separation.toFixed(2)), ball_z: Number(ballZ.toFixed(2)),
        });
        resolvedInteraction = true;
        if (contestRoll('receiver_catch', receiver.player, chance) < chance) { secure(receiver.player); return; }
      }
      // A defender's chance belongs to that defender's uninterrupted contact
      // with the ball. A changing nearest receiver does not create a new draw.
      const interceptionChance = defender
        ? clamp(0.045 - separation * 0.03 + ((defender.player.R.PRC ?? 60) - 60) * 0.0005, 0.005, 0.05)
        : 0;
      if (defender && !attemptedDefenderContacts.has(defender.player.id)) {
        attemptedDefenderContacts.add(defender.player.id);
        currentPhysicalOpportunityId = defender.player.id;
        resolvedInteraction = true;
        if (contestRoll('contested_interception', defender.player, interceptionChance) < interceptionChance) {
          secure(defender.player); return;
        }
      }
      if (resolvedInteraction) knockDown(defender?.player ?? receiver.player);
      return;
    }

    // Nobody on offence is at the ball: a defender can only catch what he can reach.
    if (!defender || attemptedDefenderContacts.has(defender.player.id)) return;
    attemptedDefenderContacts.add(defender.player.id);
    currentPhysicalOpportunityId = defender.player.id;
    const interceptionChance = clamp(0.10 - defender.planar * 0.04
      + ((defender.player.R.PRC ?? 60) - 60) * 0.001, 0.01, 0.12);
    if (contestRoll('uncontested_interception', defender.player, interceptionChance) < interceptionChance) {
      secure(defender.player); return;
    }
    knockDown(defender.player);
  }

  // Count existing probability draws without consuming any additional random
  // values. Contact opportunities are uninterrupted frames where a player is
  // physically within the ball's catchable reach; leaving that envelope ends
  // the opportunity, so a later re-entry gets a new id.
  function contestRoll(kind, player, chance) {
    const value = rand();
    W.auditDecision?.('contest_draw',{player_id:player.id,kind,chance,value,
      assignment:player.ai.playAssignment??null,recognized:player.ai.ballContestRecognized??null});
    if (!contestDiagnostics || !currentThrowDiagnostics) return value;
    currentThrowDiagnostics.probability_draws += 1;
    const playerId = player.id;
    const playerRow = contestDiagnostics.by_player[playerId] ??= {
      probability_draws: 0, draw_types: {},
    };
    playerRow.probability_draws += 1;
    playerRow.draw_types[kind] = (playerRow.draw_types[kind] ?? 0) + 1;
    const throwPlayerRow = currentThrowDiagnostics.draws_by_player[playerId] ??= {
      probability_draws: 0, draw_types: {},
    };
    throwPlayerRow.probability_draws += 1;
    throwPlayerRow.draw_types[kind] = (throwPlayerRow.draw_types[kind] ?? 0) + 1;
    const playerOpportunity = activeContactOpportunities.get(playerId);
    const physicalOpportunity = activePhysicalOpportunities.get(currentPhysicalOpportunityId);
    const opportunityId = physicalOpportunity?.opportunity_id ?? null;
    if (playerOpportunity) {
      playerOpportunity.probability_draws += 1;
      playerOpportunity.draw_types[kind] = (playerOpportunity.draw_types[kind] ?? 0) + 1;
    }
    if (physicalOpportunity) {
      physicalOpportunity.probability_draws += 1;
      physicalOpportunity.draw_types[kind] = (physicalOpportunity.draw_types[kind] ?? 0) + 1;
    }
    currentThrowDiagnostics.probability_draw_trace.push({
      time_seconds: Number(W.t.toFixed(4)), kind, player_id: playerId,
      opportunity_id: opportunityId, chance: Number(chance.toFixed(6)),
      random_value: Number(value.toFixed(9)), outcome: value < chance ? 'success' : 'failure',
      planar_yards: playerOpportunity?.last_planar_yards ?? null,
      ball_z: Number(W.ball.z.toFixed(4)),
    });
    return value;
  }

  function knockDown(by) {
    W.ball.vz = -Math.abs(W.ball.vz) * 0.4 - 1.2;
    W.ball.vx *= 0.3; W.ball.vy *= 0.3;
    W.event('pass_deflected', { by: by?.id ?? null });
  }

  function secure(player) {
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
    });
    catches.push({ player_id: player.id, team: player.team, t: W.t, x: b.x / YD, y: b.y / YD });
    if (interception) {
      setIntent(player, 'return the interception', 'secure the ball and find the nearest open grass');
    } else {
      setIntent(player, 'run after the catch', 'protect the ball and gain what the blocking allows');
    }
    carrier = player;
    carrierSince = W.t;
    const catchX = b.x / YD;
    if (interception) {
      const ownGoal = dir === 1 ? 100 : 0;
      interceptionPossession = { ownGoal, acquiredInEndZone: dir === 1 ? catchX >= 100 : catchX <= 0,
        establishedInField: catchX > 0 && catchX < 100 };
    }
    const carrierDir = player.team === 'O' ? dir : -dir;
    maxForward = { f: (catchX - cfg.los) * carrierDir, x: b.x, y: b.y, direction: carrierDir };
    lastCarrierX = catchX;
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
  function attemptForcedFumble(d, victim, closing) {
    if (fumble || !victim || W.ball.holder !== victim) return false;
    const force = 0.55 * (d.R.TAK ?? 60) + 0.45 * (d.R.STR ?? 60) + closing * 1.4;
    const security = victim.R.CAR ?? 65;
    const chance = clamp(0.012 + (force - security) * 0.0014, 0.003, 0.14);
    if (rand() >= chance) return false;
    const spot = { x: W.ball.x, y: W.ball.y };
    fumble = { fumbler: victim, forcedBy: d, spot };
    victim.hasBall = false; victim.mode = 'loose_ball';
    W.ball.state = 'loose'; W.ball.holder = null; W.ball.hand = 'carry';
    const away = unit(victim.p.x - d.p.x, victim.p.y - d.p.y);
    W.ball.x = spot.x; W.ball.y = spot.y; W.ball.z = 0.72;
    W.ball.vx = victim.v.x * 0.34 + away.x * 2.2;
    W.ball.vy = victim.v.y * 0.34 + away.y * 1.6;
    W.ball.vz = 1.4; W.ball.k = 0.28; W.ball.tumble = true;
    carrier = null; tackle = null; maxForward = null; lastCarrierX = null;
    W.event('fumble', { fumbler_id: victim.id, forced_by_id: d.id,
      ball_spot: { x: spot.x / YD, y: spot.y / YD }, chance: Number(chance.toFixed(4)) });
    return true;
  }

  function looseBallBrain(p) {
    if (p.down) { p.dv = { x: 0, y: 0 }; return; }
    const awareness = p.team === 'D' ? (p.R.PRC ?? p.R.AWR ?? 60) : (p.R.AWR ?? 60);
    p.dv = seek(p, { x: W.ball.x, y: W.ball.y },
      clamp(0.76 + (awareness - 60) * 0.003, 0.58, 0.94), 22);
    p.face = Math.atan2(W.ball.y - p.p.y, W.ball.x - p.p.x);
    setIntent(p, 'pursue the loose football', 'read its current bounce and close to recover');
  }

  function fumbleReturnBrain(p, possessionTransition = false) {
    if (p.down) { p.dv = { x: 0, y: 0 }; return; }
    if (p === carrier) {
      const attack = p.team === 'O' ? dir : -dir;
      p.dv = seek(p, { x: p.p.x + attack * 4.5 * YD,
        y: clamp(p.p.y + (FIELD_W_YD / 2 * YD - p.p.y) * 0.12, 1.2 * YD,
                 (FIELD_W_YD - 1.2) * YD) }, 0.94, 8.5);
      setIntent(p, possessionTransition ? 'advance the return' : 'advance the recovered fumble', 'protect the ball and attack open field ahead');
      return;
    }
    if (p.team !== carrier.team) {
      p.dv = seek(p, lead(p, carrier, 0.18), 0.96, 18);
      setIntent(p, possessionTransition ? 'pursue the returner' : 'pursue the fumble returner', 'close on the current carrier and attempt a tackle');
      return;
    }
    const threat = W.players.filter((q) => q.team !== carrier.team && !q.down)
      .sort((a, b) => d2(p, a) - d2(p, b) || a.id.localeCompare(b.id))[0];
    if (threat && d2(threat, p) < 1.0 && !p.engaged && !threat.engaged) {
      if (sharedSnapshot) pendingFumbleEngagements.set(p.id, { blocker: p, defender: threat });
      else W.engage(p, threat);
    }
    const attack = p.team === 'O' ? dir : -dir;
    p.dv = seek(p, { x: carrier.p.x - attack * 2.0 * YD,
      y: carrier.p.y + (((p.ai.index ?? 0) % 3) - 1) * 1.0 * YD }, 0.82, 12);
    setIntent(p, possessionTransition ? 'escort the carrier' : 'escort the fumble return', 'screen the nearest pursuit player');
  }

  function recoverFumble() {
    if (!fumble || fumbleRecovery || W.ball.state !== 'loose') return;
    if (W.ball.z > 0.24) { fumbleRecoveryAttempts.clear(); return; }
    const candidates = W.players.filter((p) => !p.down
      && d2(p, { p: { x: W.ball.x, y: W.ball.y } }) <= 0.86 * YD)
      .sort((a, b) => d2(a, { p: { x: W.ball.x, y: W.ball.y } })
        - d2(b, { p: { x: W.ball.x, y: W.ball.y } }) || a.id.localeCompare(b.id));
    const p = nextRecoveryAttempt(fumbleRecoveryAttempts, candidates);
    if (!p) return;
    const awareness = p.team === 'D' ? (p.R.PRC ?? p.R.AWR ?? 60) : (p.R.AWR ?? 60);
    const chance = clamp(0.58 + (awareness - 60) * 0.005, 0.28, 0.94);
    W.event('loose_ball_recovery_attempt', { player_id: p.id, chance });
    if (rand() >= chance) return;
    fumbleRecovery = p; fumbleRecoverySpot = { x: W.ball.x, y: W.ball.y };
    interceptionPossession = null; // a new recovery needs its own possession/impetus ruling
    carrier = p; carrierSince = W.t; possession = p.team;
    p.hasBall = true; p.mode = 'carry';
    W.ball.state = 'held'; W.ball.holder = p; W.ball.hand = 'carry';
    maxForward = { f: (W.ball.x / YD - cfg.los) * (p.team === 'O' ? dir : -dir),
      x: W.ball.x, y: W.ball.y, direction: p.team === 'O' ? dir : -dir };
    lastCarrierX = W.ball.x / YD;
    W.event('fumble_recovery', { fumbler_id: fumble.fumbler.id, recoverer_id: p.id,
      team: p.team, recovery_spot: { x: W.ball.x / YD, y: W.ball.y / YD } });
  }

  function startTackle(d) {
    if (terminal || tackle || !carrier || d.team === carrier.team) return;
    const closing = Math.hypot(d.v.x - carrier.v.x, d.v.y - carrier.v.y) / YD;
    const tak = d.R.TAK ?? 60;
    const btk = Math.max(carrier.R.BTK ?? 55, carrier.R.ELU ?? 55);
    const strength = (d.R.STR ?? 55) - (carrier.R.STR ?? 55);
    const finishChance = tackleFinishChance({ tak, btk, strength, closing });
    d.ai.lastTackleAttempt = W.t;
    if (attemptForcedFumble(d, carrier, closing)) return;
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

  function recordPassInterference(a, b, closingSpeed = null) {
    if (passInterference || W.ball.state !== 'air' || !W.ball.target) return;
    const receiver = W.ball.target;
    const defender = a === receiver ? b : b === receiver ? a : null;
    if (!defender || receiver.team !== 'O' || defender.team !== 'D' || defender.down) return;
    const ballDistance = dist(receiver.p, W.ball) / YD;
    // Downfield contact while the pass is still travelling is the observable
    // foul fact. Contact near the line or at the catch point remains legal
    // coverage/catch contention and never becomes an inferred penalty.
    const landing = W.ball.landing;
    const planarSpeed = Math.max(1, Math.hypot(W.ball.vx, W.ball.vy));
    const remainingFlight = landing
      ? clamp(dist(W.ball, landing) / planarSpeed, 0, 1.25)
      : 0;
    const receiverReach = receiver.vmax * remainingFlight / YD + 1.25;
    const landingDistance = landing ? dist(receiver.p, landing) / YD : Infinity;
    if (!passInterferenceContactEligible({ downfieldYards: fOf(receiver), ballDistanceYards: ballDistance,
      landingDistanceYards: landingDistance, receiverReachYards: receiverReach,
      closingSpeedMps: closingSpeed })) return;
    passInterference = { defender, receiver, x: receiver.p.x / YD, y: receiver.p.y / YD };
    W.event('pass_interference', {
      defender_id: defender.id, receiver_id: receiver.id,
      spot: { x: passInterference.x, y: passInterference.y },
      ball_distance_yards: Number(ballDistance.toFixed(2)),
      closing_speed_mps: closingSpeed == null ? null : Number(closingSpeed.toFixed(2)),
    });
    // Record the foul while the ball remains live. The pass, catch, interception,
    // return, and whistle still resolve through the ordinary execution path;
    // the rules adapter evaluates acceptance after those live facts exist.
  }

  W.onTouch = (a, b) => {
    recordPassInterference(a, b);
    if (!carrier || tackle || terminal || (a !== carrier && b !== carrier)) return;
    const d = a === carrier ? b : a;
    if (d.team !== carrier.team && !d.down && (d.ai.missUntil ?? 0) <= W.t) startTackle(d);
  };

  W.onContact = (a, b, closingSpeed) => {
    recordPassInterference(a, b, closingSpeed);
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
      const outside = cfg.assignments?.defense[d.slot]?.rush_lane === 'outside';
      const target = lead(d, qb, 0.12);
      if (outside) {
        const lateralSide = Math.sign(d.ai.routeStart.l) || 1;
        target.y += dir * lateralSide * 1.5 * YD;
        setIntent(d, 'contain the passer', 'rush while preserving outside leverage');
      }
      d.dv = seek(d, target, 1, 22);
      d.face = Math.atan2(qb.p.y - d.p.y, qb.p.x - d.p.x);
      if (d2(d, qb) < d.r + qb.r + 0.2) {
        if (sharedSnapshot) {
          // Resolve a same-tick sack after all player decisions, before the
          // deferred QB release is committed.
          pendingSackCandidates.add(d);
        } else {
          W.event('sack', { defender_id: d.id, quarterback_id: qb.id, time: W.t });
          sack = { defender: d, t0: W.t };
          carrier = qb;
          const closing = Math.hypot(d.v.x - qb.v.x, d.v.y - qb.v.y) / YD;
          if (attemptForcedFumble(d, qb, closing)) return;
          d.pose = POSE.WRAP;
          tackle = { tackler: d, carrier: qb, t0: W.t };
          W.wrap(d, qb, { fall: 0.5, keepCarrier: 0.1 });
          finish('sack', { x: W.ball.x, y: W.ball.y });
        }
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
    p.dv = seek(p, lead(p, carrier, leadScale), 0.98, 20);
    p.face = Math.atan2(carrier.p.y - p.p.y, carrier.p.x - p.p.x);
    setIntent(p, 'pursue the returner', 'take the interception angle from the live carrier position');
  }

  function offenseBrain(p) {
    if (!snapped) { p.dv = { x: 0, y: 0 }; p.face = dir > 0 ? 0 : Math.PI; return; }
    if (carrier && p === carrier) { carrierBrain(p); return; }
    if (carrier && p.team !== carrier.team) { pursuerBrain(p); return; }
    if (cfg.assignments && carrier && p.team === carrier.team) { fumbleReturnBrain(p, true); return; }
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
    if (cfg.assignments ? cfg.assignments.offense[p.slot].kind === 'block' || (cfg.assignments.offense[p.slot].check_release && p.engaged) : ['LT', 'LG', 'C', 'RG', 'RT', 'TE'].includes(p.slot)) {
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
        const area = cfg.assignments?.offense[p.slot]?.protection_area;
        p.dv = seek(p, at(-1.0, area ? clamp(p.ai.routeStart.l, area[0], area[1]) : p.ai.zoneL ?? lOf(p) * 0.5), 0.5, 8);
      }
      return;
    }
    // Receivers and the back follow their route landmarks from live positions.
    if (cfg.assignments?.offense[p.slot].check_release && !p.ai.protectionReleased) {
      const elapsed = W.t - (W.ball.receivedAt ?? W.t);
      const threat = defense.filter((q) => protectionThreat(q) && !q.engaged && d2(q, qb) < 3.2 * YD)
        .sort((a, b) => d2(a, qb) - d2(b, qb) || a.id.localeCompare(b.id))[0];
      if (threat) {
        p.dv = seek(p, lead(p, threat, 0.1), 0.75, 12);
        engageBlocker(p, threat, 'check_release');
        setIntent(p, 'check protection', 'protect against the observed pressure');
        return;
      }
      if (!received || elapsed < 0.9) {
        p.dv = seek(p, at(-1.5, p.ai.routeStart.l), 0.5, 8);
        setIntent(p, 'check protection', 'hold in protection while reading the rush');
        return;
      }
      p.ai.protectionReleased = true;
      W.event('protection_release', { player_id: p.id, role: p.roleKey });
    }
    if (!cfg.assignments && p === rb) {
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
      if (W.ball.state === 'air') {
        if (!cfg.assignments && cfg.behaviorMode === 'detailed') {
          // Preserve the unassigned detailed replay as a legacy comparison.
          // V1 Complete always supplies assignments and follows the causal path.
          legacyDetailedReceiverPursuit(p);
        } else {
          // Estimate the landing point from the ball's currently observable state.
          // The simulator's exact future landing coordinate is private physics state.
          const passerHeading = Math.atan2(qb.p.y - p.p.y, qb.p.x - p.p.x);
          p.ai.gazeHeading = turnHeadingToward(p.ai.gazeHeading ?? p.h, passerHeading,
            PLAYER_GAZE_TURN_RATE / DECISION_HZ);
          const estimate = estimateObservedBallCatchPoint(p);
          W.auditDecision?.('receiver_ball_read',{player_id:p.id,estimate:estimate??null,
            gaze:p.ai.gazeHeading,route_index:p.ai.routeIndex??null});
          if (estimate) {
            p.dv = seek(p, estimate, 1, 14);
            setIntent(p, 'adjust to observed pass', 'pursue the estimated catch point from the live ball trajectory');
          }
        }
      }
    }
  }

  function legacyDetailedReceiverPursuit(p) {
    const ball = W.ball;
    p.dv = seek(p, { x: ball.landing?.x ?? ball.x, y: ball.landing?.y ?? ball.y }, 1, 14);
  }

  function closestRusherSide() {
    const r = nearestObservedRusher();
    if (!r) return 0;
    return Math.sign((r.estimate.position.y - qb.p.y) * dir || 1);
  }

  function captureObservedBall(p, observations, heading, fieldOfView) {
    if (!observations.has(p.id)) {
      observations.set(p.id, new ObservationMemory({ reactionDelaySeconds: 0.14,
        maxMemorySeconds: 0.9, maxPredictionSeconds: 0.18, confidenceDecaySeconds: 0.45,
        uncertaintyGrowthMetersPerSecond: 1.5 }));
    }
    const memory = observations.get(p.id);
    const ballObservation = { id: 'ball', p: { x: W.ball.x, y: W.ball.y },
      v: { x: W.ball.vx, y: W.ball.vy }, z: W.ball.z, vz: W.ball.vz, r: BALL_R };
    memory.capture(p, ballObservation, W.players, W.t, {
      heading, fieldOfView, maxDistance: 55 * YD,
      observerEyeHeight: 1.72, targetEyeHeight: Math.max(0.2, W.ball.z), defaultBlockerHeight: 1.9,
    });
    memory.advance(W.t);
    const estimate = memory.estimate('ball', W.t);
    if (!estimate || estimate.confidence < 0.12) return null;
    return { estimate, observation: memory.lastSeen.get('ball') };
  }

  function estimateObservedBallLanding(p) {
    if (cfg.behaviorMode === 'retro' && !cfg.assignments) {
      return estimateBallLanding({ position: { x: W.ball.x, y: W.ball.y }, velocity: { x: W.ball.vx, y: W.ball.vy },
        z: W.ball.z, vz: W.ball.vz, uncertaintyMeters: 0 }, G);
    }
    const sighting = captureObservedBall(p, defenderBallObservations, p.h, DEFENDER_FIELD_OF_VIEW);
    if (!sighting) return null;
    observedDefenderBallPredictions++;
    // Assigned defenders pursue an observable catch-height interception point,
    // not the ground landing of an untouched pass. Use the same drag-aware
    // estimator and observation age as the receiver, with independent memory.
    if (cfg.assignments) {
      const { estimate, observation } = sighting;
      return estimateBallCatchPoint({ position: observation.position, velocity: observation.velocity,
        z: observation.z, vz: observation.vz, ageSeconds: estimate.ageSeconds,
        uncertaintyMeters: estimate.uncertaintyMeters }, AERO.spiral);
    }
    return estimateBallLanding(sighting.estimate, G);
  }

  function estimateObservedBallCatchPoint(p) {
    if (cfg.behaviorMode === 'retro' && !cfg.assignments) {
      return estimateBallCatchPoint({ position: { x: W.ball.x, y: W.ball.y }, velocity: { x: W.ball.vx, y: W.ball.vy },
        z: W.ball.z, vz: W.ball.vz, uncertaintyMeters: 0 }, AERO.spiral);
    }
    const sighting = captureObservedBall(p, receiverBallObservations,
      p.ai.gazeHeading ?? p.h, RECEIVER_FIELD_OF_VIEW);
    if (!sighting) return null;
    observedReceiverBallPredictions++;
    const { estimate, observation: observedBall } = sighting;
    const landing = estimateBallCatchPoint({
      position: observedBall.position, velocity: observedBall.velocity,
      z: observedBall.z, vz: observedBall.vz,
      ageSeconds: estimate.ageSeconds, uncertaintyMeters: estimate.uncertaintyMeters,
    }, AERO.spiral);
    return landing;
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
    if (cfg.assignments && carrier && p.team === carrier.team) { fumbleReturnBrain(p, true); return; }
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
      p.dv = seek(p, lead(p, carrier, leadScale), 0.98, 20);
      p.face = Math.atan2(carrier.p.y - p.p.y, carrier.p.x - p.p.x);
      setIntent(p, 'pursue the carrier', 'take the interception angle from the live carrier position');
      return;
    }
    if (cfg.assignments && cfg.assignments.defense[p.slot].kind === 'rush') { rushPasser(p); return; }
    if (!cfg.assignments && p.info.group === 'DL') { rushPasser(p); return; }
    if (W.ball.state === 'air') {
      const estimate = estimateObservedBallLanding(p);
      const task = cfg.assignments?.defense[p.slot];
      if (estimate && task) p.ai.throwCueAt ??= W.t;
      const recognitionDelay = clamp(0.34 - (p.R.PRC ?? p.R.AWR ?? 60) * 0.0026, 0.08, 0.30);
      const recognized = !task || (p.ai.throwCueAt != null && W.t - p.ai.throwCueAt >= recognitionDelay);
      // This is the actual controller decision, not a fresh omniscient read
      // from the catch resolver. It is refreshed on the existing cadence.
      if (task) p.ai.ballContestRecognized = !!estimate && recognized;
      if (W.auditDecision) W.auditDecision('coverage_ball_read',{player_id:p.id,task,
        estimate:estimate??null,recognized,recognition_delay_s:recognitionDelay,
        cue_at_s:p.ai.throwCueAt??null,eligible:!!estimate&&(!task||coverageBallOpportunity({task,estimate,
          position:p.p,los:cfg.los,ballY:cfg.ballY,direction:dir,speed:p.vmax}))});
      if (estimate && recognized && (!task || coverageBallOpportunity({ task, estimate,
        position: p.p, los: cfg.los, ballY: cfg.ballY, direction: dir,
        speed: p.vmax }))) {
        p.dv = seek(p, estimate, 1, 16);
        p.face = Math.atan2(estimate.y - p.p.y, estimate.x - p.p.x);
        setIntent(p, 'break on the thrown ball', 'attack the reachable ball from an observed trajectory');
        return;
      }
    }
    if (cfg.assignments) {
      const task = cfg.assignments.defense[p.slot];
      if (task.kind === 'man') {
        const target = get(`O.${task.target_slot}`);
        p.dv = seek(p, lead(p, target, 0.18), 0.95, 16);
        p.face = Math.atan2(target.p.y - p.p.y, target.p.x - p.p.x);
        setIntent(p, `cover ${target.slot} man`, 'stay in phase and squeeze the route');
      } else {
        const bounds = task.kind === 'zone' ? task.bounds : [3, 7, p.ai.routeStart.l - 1, p.ai.routeStart.l + 1];
        const landmark = at((bounds[0] + bounds[1]) / 2, (bounds[2] + bounds[3]) / 2);
        p.dv = seek(p, landmark, 0.8, 12);
        p.face = Math.atan2(qb.p.y - p.p.y, qb.p.x - p.p.x);
        setIntent(p, task.kind === 'zone' ? 'cover assigned zone' : 'read the play', 'maintain responsibility and observe the quarterback');
      }
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
    if (fumble) {
      fumbleRecovery ? fumbleReturnBrain(p) : looseBallBrain(p);
      return;
    }
    if (cfg.assignments && cfg.behaviorMode === 'retro') {
      if (p.down) { p.dv = { x: 0, y: 0 }; return; }
      // Strategic decisions use a countdown. Physics keeps integrating the last
      // intent on every step. Possession, snap and ball-phase transitions wake
      // every player immediately; the terminal loop stops at the whistle.
      const phase = `${snapped}:${received}:${W.ball.state}:${carrier?.id ?? ''}:${!!tackle}`;
      const interrupted = p.ai.lastPhase !== phase;
      if (interrupted || W.t + 1e-9 >= (p.ai.nextDecision ?? 0)) {
        const awareness = p.team === 'D' ? (p.R.PRC ?? p.R.AWR ?? 60) : (p.R.AWR ?? 60);
        const interval = retroDecisionInterval(awareness);
        p.ai.lastPhase = phase;
        p.ai.nextDecision = W.t + interval;
        p.ai.tickCount = (p.ai.tickCount ?? 0) + 1;
        p.ai.interruptCount = (p.ai.interruptCount ?? 0) + (interrupted ? 1 : 0);
        if (p === qb && received) qbDecision();
        if (p.team === 'O') offenseBrain(p);
        else defenseBrain(p);
      }
      return;
    }
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

  function resolveTickActions() {
    if (!sharedSnapshot) return;
    pendingCallbackEvents.sort((a, b) => stableEventValue([a.type, a.data])
      .localeCompare(stableEventValue([b.type, b.data])));
    for (const row of pendingCallbackEvents.splice(0)) originalEvent(row.type, row.data);
    resolveShedRequests();
    resolveBlockRequests();
    resolveFumbleEngagements();
    if (!terminal && received && W.ball.holder === qb && pendingSackCandidates.size > 0) {
      const defender = [...pendingSackCandidates].filter((candidate) => !candidate.engaged)
        .sort((a, b) => d2(a, qb) - d2(b, qb)
        || a.id.localeCompare(b.id))[0];
      if (defender) {
        W.event('sack', { defender_id: defender.id, quarterback_id: qb.id, time: W.t });
        sack = { defender, t0: W.t };
        carrier = qb;
        const closing = Math.hypot(defender.v.x - qb.v.x, defender.v.y - qb.v.y) / YD;
        if (!attemptForcedFumble(defender, qb, closing)) {
          defender.pose = POSE.WRAP;
          tackle = { tackler: defender, carrier: qb, t0: W.t };
          W.wrap(defender, qb, { fall: 0.5, keepCarrier: 0.1 });
          finish('sack', { x: W.ball.x, y: W.ball.y });
        }
      }
    }
    pendingSackCandidates.clear();
    if (terminal || W.ball.holder !== qb) {
      pendingPass = null;
      pendingThrowaway = false;
      return;
    }
    if (pendingPass) launchPass(pendingPass);
    else if (pendingThrowaway) launchThrowaway();
    pendingPass = null;
    pendingThrowaway = false;
  }

  // ------------------------------------------------------------------ finish
  function finish(reason, spot) {
    if (terminal) return;
    const physicalReason = reason;
    if (carrier?.team === 'D' && interceptionPossession && !fumble) {
      const ownGoal = interceptionPossession.ownGoal;
      const inOwnEndZone = ownGoal === 100 ? spot.x / YD >= 100 : spot.x / YD <= 0;
      if (inOwnEndZone && interceptionPossession.acquiredInEndZone
          && !interceptionPossession.establishedInField && ['tackle', 'out_of_bounds', 'safety'].includes(reason)) {
        reason = 'touchback';
        spot = { ...spot, x: ownGoal * YD };
        W.event('touchback', { player_id: carrier.id, team: 'D', spot: { x: ownGoal, y: spot.y / YD },
          basis: 'interception_in_own_end_zone_never_established_in_field' });
      } else if (inOwnEndZone && interceptionPossession.establishedInField
          && ['tackle', 'out_of_bounds'].includes(reason)) {
        // Retain the physical dead-ball event. The LP rules layer must decide
        // whether the defender supplied the impetus or a momentum exception applies.
        W.event('defensive_end_zone_dead_ball', { player_id: carrier.id, team: 'D',
          spot: { x: spot.x / YD, y: spot.y / YD }, physical_reason: reason });
      }
    }
    terminal = { reason, spot: { x: spot.x / YD, y: clamp(spot.y / YD, 0, FIELD_W_YD) }, time: W.t };
    if (reason === 'safety') {
      W.event('safety', { carrier_id: carrier.id, team: carrier.team === 'O' ? 'D' : 'O',
        spot: terminal.spot });
    }
    if ((physicalReason === 'tackle' || physicalReason === 'sack') && tackle) {
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
      recordAirborneReachability();
      if (!resolveAttempt && b.z <= 2.4 && b.vz < 0) resolveAttempt = true;
      if (resolveAttempt) resolveContest();
      // Out-of-bounds flight is not a rule violation until the ball lands.
    }
    if (carrier && W.ball.holder === carrier) {
      const x = W.ball.x / YD;
      if (interceptionPossession && !interceptionPossession.establishedInField && x > 0 && x < 100) {
        interceptionPossession.establishedInField = true;
        W.event('interception_possession_established_in_field', { player_id: carrier.id,
          spot: { x, y: W.ball.y / YD } });
      }
      const carrierDir = carrier.team === 'O' ? dir : -dir;
      const f = (x - cfg.los) * carrierDir;
      if (!maxForward || maxForward.direction !== carrierDir || f > maxForward.f) {
        maxForward = { f, x: W.ball.x, y: W.ball.y, direction: carrierDir };
      }
      const previousX = lastCarrierX ?? x;
      if ((carrierDir > 0 && x >= 100) || (carrierDir < 0 && x <= 0)) {
        const goalX = (carrierDir > 0 ? 100 : 0) * YD;
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
      if (interceptionPossession && carrier.team === 'D'
          && ((carrierDir > 0 && x <= -10) || (carrierDir < 0 && x >= 110))) {
        finish('out_of_bounds', { x: (carrierDir > 0 ? 0 : 100) * YD, y: W.ball.y });
        return;
      }
      if (!interceptionPossession && ((carrierDir > 0 && previousX >= 0 && x < 0)
          || (carrierDir < 0 && previousX <= 100 && x > 100))) {
        finish('safety', { x: (carrierDir > 0 ? 0 : 100) * YD, y: W.ball.y });
        return;
      }
      lastCarrierX = x;
    }
  }

  // --------------------------------------------------------------- main loop
  if (!cfg.resultOnly) record();
  nextRecord = 1 / REC_HZ;
  const progress = makeLiveProgressTracker({ time: W.t, x: W.ball.x, y: W.ball.y,
    phase: W.ball.state, distance: 0.25 * YD });
  let failureReason = null;
  while (!terminal && (W.t < HARD_MAX_SECONDS || (tackle && W.t < HARD_MAX_SECONDS + 0.5))) {
    if (W.t >= MAX_SECONDS && !carrier && !fumble && W.ball.state !== 'air' && !tackle) {
      failureReason = 'simulation_time_cap';
      break;
    }
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
      W.event('snap', { play_call: cfg.concept, concept: cfg.concept, direction: cfg.direction, front: cfg.front, coverage: cfg.coverage, to: qb.id });
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
    // Once the quarterback crosses the line while holding the ball, the play
    // has become a run; subsequent decisions use the ordinary carrier path.
    if (cfg.assignments && received && !carrier && W.ball.holder === qb && fOf(qb) >= 0) {
      carrier = qb;
      carrierSince = W.t;
      qb.ai.escape = null;
      qb.ai.quarterbackState = 'carry';
      W.ball.hand = 'carry';
      W.event('quarterback_state', { player_id: qb.id, state: 'carry', reason: 'crossed_line' });
    }
    if (received && !carrier && W.ball.state === 'air') throwInfo = { snapT: W.ball.receivedAt, thrownAt: W.t };
    if (received && carrier) throwInfo = null;

    tickEngagementSnapshot = sharedSnapshot
      ? new Map(W.players.map((player) => [player.id, player.engaged])) : null;
    const tickBrains = sharedSnapshot ? (player) => {
      collectingCallbackEvents = true;
      try { brains(player); } finally { collectingCallbackEvents = false; }
    } : brains;
    W.step(physicsDt, tickBrains, resolveTickActions);
    for (const row of activeBlock.values()) {
      row.minDefF = Math.min(row.minDefF, fOf(row.defender));
      row.maxDefF = Math.max(row.maxDefF, fOf(row.defender));
    }
    recoverFumble();
    trackLive();
    const liveActor = carrier ?? W.ball.holder;
    const livePosition = liveActor?.p ?? { x: W.ball.x, y: W.ball.y };
    const secondsWithoutProgress = progress.observe({ time: W.t, ...livePosition,
      phase: W.ball.state + ':' + (liveActor?.id ?? '') });
    if (!terminal && !tackle && carrier) {
      // Use the same physical arm-reach opportunity as the run executor.
      // This catches contact missed by the collision callback without enlarging the reach.
      for (const defender of W.players) {
        if (!carrier || tackle) break;
        if (defender.team === carrier.team || defender.down || defender.engaged
            || (defender.ai.missUntil ?? 0) > W.t) continue;
        if (d2(defender, carrier) <= defender.r + carrier.r + 0.12) startTackle(defender);
      }
    }
    if (!terminal && !tackle && (carrier || fumble) && secondsWithoutProgress >= NO_PROGRESS_SECONDS) {
      failureReason = 'live_play_no_progress';
      break;
    }
    if (!terminal && tackle && W.t - tackle.t0 >= 0.48) {
      let spot = maxForward || { x: W.ball.x, y: W.ball.y };
      if (carrier?.team === 'D') {
        const carrierDir = -dir;
        const ownGoalX = carrierDir > 0 ? 0 : 100;
        if ((carrierDir > 0 && spot.x / YD < ownGoalX)
            || (carrierDir < 0 && spot.x / YD > ownGoalX)) spot = { ...spot, x: ownGoalX * YD };
      }
      finish(tackle === sack ? 'sack' : 'tackle', spot);
    }
    if (!cfg.resultOnly && !terminal && W.t >= nextRecord - 1e-9) {
      record();
      nextRecord += 1 / REC_HZ;
    }
  }

  // No artificial tackle or whistle at a watchdog deadline.
  const failureState = !terminal ? {
    elapsed_seconds: W.t,
    ball: { state: W.ball.state, x_yards: W.ball.x / YD, y_yards: W.ball.y / YD,
      height: W.ball.z, holder_id: W.ball.holder?.id ?? null },
    carrier_id: carrier?.id ?? null,
    last_transition: W.events.at(-1) ?? null,
    active_assignments: W.players.map((p) => ({ player_id: p.id, team: p.team,
      role: p.roleKey, assignment: p.ai.assignment ?? null, decision: p.ai.decision ?? null,
      position: { x_yards: p.p.x / YD, y_yards: p.p.y / YD },
      velocity: { x_yards_per_second: p.v.x / YD, y_yards_per_second: p.v.y / YD },
      pose: p.pose, has_ball: p.hasBall, engaged_with: p.engaged?.id ?? null })),
    active_engagements: W.engagements.map((e) => ({ a: e.a.id, b: e.b.id, since: e.t0 })),
    last_contact_attempt: [...W.events].reverse().find((e) =>
      ['tackle_attempt', 'pass_contest', 'catch_attempt', 'fumble', 'fumble_recovery'].includes(e.type)) ?? null,
  } : null;
  if (!terminal) {
    for (const engagement of [...W.engagements]) W.disengage(engagement);
    failureReason ??= 'simulation_hard_time_cap';
    W.event('simulation_failure', { reason: failureReason, time_limit_seconds: failureReason === 'simulation_time_cap' ? MAX_SECONDS : HARD_MAX_SECONDS,
      no_progress_limit_seconds: NO_PROGRESS_SECONDS });
  }
  // The final frame belongs to the instant of the whistle, not to the step
  // that finished integrating after the ball went dead.
  if (!cfg.resultOnly && (frames.length === 0 || W.t - ((frames.length - 1) / REC_HZ) > 1e-6)) record(terminal?.time ?? W.t);
  for (const row of activeBlock.values()) row.end = W.t;

  const spot = terminal?.spot ?? null;
  // Geometry remains continuous. Box-score return yards are the difference
  // between the two whole-yard spots in one snap-offense frame, matching the
  // SLC event adapter's yardline conversion instead of rounding the continuous
  // displacement independently.
  const yardsGained = spot ? (spot.x - cfg.los) * dir : null;
  const blockers = offense.filter((p) => cfg.assignments
    ? cfg.assignments.offense[p.slot].kind === 'block' || cfg.assignments.offense[p.slot].check_release
    : ['LT', 'LG', 'C', 'RG', 'RT', 'TE'].includes(p.slot)).map((p) => {
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
    schema_version: 'gridiron.autonomous-pass.v1', mode: 'autonomous', play_call: cfg.concept,
    seed: String(cfg.seed), front: cfg.front, coverage: cfg.coverage, direction: cfg.direction, dir,
    line_of_scrimmage: cfg.los, ball_y: cfg.ballY, roster, hz: REC_HZ, t0: 0,
    stride: roster.length * 6 + 6, frames: cfg.resultOnly ? null : frames, trajectories,
    events: W.events,
    terminal: terminal ? { ...terminal, yards_gained: yardsGained, touchdown: terminal.reason === 'touchdown' } : null,
    resolved: !!terminal,
    carrier_id: carrier?.id ?? null,
    possession_team: possession,
    throw: throwEvent ? { quarterback_id: throwEvent.quarterback_id, target_id: throwEvent.target_id } : null,
    catches,
    failure: terminal ? null : { reason: failureReason, time_limit_seconds: failureReason === 'simulation_time_cap' ? MAX_SECONDS : HARD_MAX_SECONDS,
      no_progress_limit_seconds: NO_PROGRESS_SECONDS },
    tackle_id: terminal && (terminal.reason === 'tackle' || terminal.reason === 'sack') ? tackle?.tackler.id ?? null : null,
    sack_id: sack?.defender.id ?? null,
    fumble: fumble && fumbleRecovery ? {
      fumbler_id: fumble.fumbler.id, forced_by_id: fumble.forcedBy.id,
      fumble_spot: { x: fumble.spot.x / YD, y: fumble.spot.y / YD },
      recovery_team: fumbleRecovery.team, recoverer_id: fumbleRecovery.id,
      returner_id: carrier?.id ?? null,
      recovery_spot: { x: fumbleRecoverySpot.x / YD, y: fumbleRecoverySpot.y / YD },
      dead_ball_spot: terminal?.spot ?? null,
      ...(terminal && carrier ? serializeReturnGeometry({ recoveryX: fumbleRecoverySpot.x / YD,
        deadBallX: terminal.spot.x, direction: dir, carrierTeam: carrier.team })
        : { return_yards: null, return_displacement_yards: null }),
    } : null,
    interception_id: catches.find((c) => c.team === 'D')?.player_id ?? null,
    blockers, topSpeed,
    diagnostics: {
      ...(failureState ? { failure_state: failureState } : {}),
      ...(contestDiagnostics ? { pass_contests: contestDiagnostics } : {}),
      ...(sharedSnapshot ? { player_evaluation_mode: 'shared_snapshot' } : {}),
      ...(cfg.assignments ? { behavior_mode: cfg.behaviorMode } : {}),
      ...(cfg.assignments && cfg.behaviorMode === 'retro' ? { cadence: Object.fromEntries(W.players.map((p) => [p.id,
        { ticks: p.ai.tickCount ?? 0, interrupts: p.ai.interruptCount ?? 0,
          interval_seconds: retroDecisionInterval(p.team === 'D' ? (p.R.PRC ?? p.R.AWR ?? 60) : (p.R.AWR ?? 60)) }])) } : {}),
      qb_perception: {
        body_heading: qb.h, gaze_heading: qb.ai.gazeHeading,
        reaction_delay_seconds: lastSeenMemory.reactionDelaySeconds,
        observations: { ...lastSeenMemory.counts },
        last_seen: [...lastSeenMemory.lastSeen.entries()].map(([player_id, observation]) => ({
          player_id, age_seconds: Math.max(0, W.t - observation.observedAt),
        })).sort((a, b) => a.player_id.localeCompare(b.player_id)),
      },
      defender_ball_perception: {
        observers: defenderBallObservations.size,
        trajectory_estimates: observedDefenderBallPredictions,
        observations: Object.fromEntries([...defenderBallObservations].map(([playerId, memory]) =>
          [playerId, { ...memory.counts }])),
      },
      ...(cfg.assignments || cfg.behaviorMode === 'retro' ? { receiver_ball_perception: {
        observers: receiverBallObservations.size,
        trajectory_estimates: observedReceiverBallPredictions,
        observations: Object.fromEntries([...receiverBallObservations].map(([playerId, memory]) =>
          [playerId, { ...memory.counts }])),
      } } : {}),
    },
    provenance: {
      execution: 'snap-to-whistle player decisions and ball flight generated by the simulation',
      initial_profiles: 'authored physical archetypes adjusted by declared ratings',
      allowed_decision_inputs: ['declared formation and play call', 'declared front, coverage and direction', 'player roles, physical profiles, ratings and snap positions', cfg.behaviorMode === 'retro' ? 'current relevant player and ball positions and contact cues' : 'self state, physical contact cues, and delayed visible player/ball observations with uncertainty'],
      outcome_inputs: [],
    },
  };
}
