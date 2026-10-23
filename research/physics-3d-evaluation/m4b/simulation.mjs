import {
  add, createPhysics, cross, dot, length, normalize, qConjugate, qMultiply, qRotate, scale, sub, tiltDeg,
  FIXED_TIMESTEP_SECONDS as DT, GRAVITY_MPS2 as GRAVITY,
} from './physics.mjs';
import { BODY_LAYOUT } from '../scenarios.js';

export const ENGINE_IDS = Object.freeze(['rapier3d-compat', 'jolt-physics-js']);
export const BALANCE = Object.freeze({ kp: 1050, kd: 220, comNmPerM: 2600, maxTorqueNm: 2400 });
export const GRAVITY_VECTOR = Object.freeze([0, -GRAVITY, 0]);
const MATERIALS = Object.freeze({ groundFriction: 0.82, groundRestitution: 0.04, playerFriction: 0.72, playerRestitution: 0.04,
  linearDamping: 0.025, angularDamping: 0.06 });
export const CONTACT_OPPORTUNITY_GAP_M = 0.10;

const capVector = (v, limit) => length(v) > limit ? scale(v, limit / length(v)) : v;
const ticks = (seconds, timestep = DT) => Math.ceil(seconds / timestep);
const bodyPointVelocity = (state, point) => add(state.linearVelocityMps, cross(state.angularVelocityRadPerSec, sub(point, state.centerOfMassM)));
const worldAnchor = (state, local) => add(state.positionM, qRotate(local, state.rotation));
const localAnchor = (state, point) => qRotate(sub(point, state.positionM), qConjugate(state.rotation));

function forceControllerTorque(state, strength = 80, balanceScale = 0.8, grounded = true) {
  if (!grounded) return [0, 0, 0];
  const bodyUp = qRotate([0, 1, 0], state.rotation);
  const tiltError = cross(bodyUp, [0, 1, 0]);
  const comOffset = sub(state.centerOfMassM, state.positionM);
  const angular = state.angularVelocityRadPerSec;
  const gain = (0.55 + strength / 120) * balanceScale;
  return capVector([
    BALANCE.kp * tiltError[0] + BALANCE.comNmPerM * comOffset[2] - BALANCE.kd * angular[0],
    0,
    BALANCE.kp * tiltError[2] + BALANCE.comNmPerM * comOffset[0] - BALANCE.kd * angular[2],
  ].map((v) => v * gain), BALANCE.maxTorqueNm * gain);
}

function round(value, digits = 5) {
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
  if (Array.isArray(value)) return value.map((item) => round(item, digits));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, round(item, digits)]));
  return value;
}

function energyOf(state, props) {
  const linear = 0.5 * props.massKg * dot(state.linearVelocityMps, state.linearVelocityMps);
  const q = state.rotation;
  const principalRotation = multiplyQuat(q, props.inertiaLocalRotation);
  const omega = qRotate(state.angularVelocityRadPerSec, qConjugate(principalRotation));
  const rotational = 0.5 * dot(props.principalInertiaKgM2, omega.map((value) => value * value));
  const potential = props.massKg * GRAVITY * state.centerOfMassM[1];
  return { linearKineticJ: linear, rotationalKineticJ: rotational, gravitationalPotentialJ: potential,
    totalMechanicalJ: linear + rotational + potential };
}

function multiplyQuat(a, b) {
  const [x1, y1, z1, w1] = a, [x2, y2, z2, w2] = b;
  const out = [w1*x2 + x1*w2 + y1*z2 - z1*y2, w1*y2 - x1*z2 + y1*w2 + z1*x2,
    w1*z2 + x1*y2 - y1*x2 + z1*w2, w1*w2 - x1*x2 - y1*y2 - z1*z2];
  const norm = Math.hypot(...out) || 1;
  return out.map((value) => value / norm);
}

function gripLoad(grip, runner, holder) {
  const runnerPoint = worldAnchor(runner, grip.runnerAnchorLocalM);
  const holderPoint = worldAnchor(holder, grip.holderAnchorLocalM);
  const separation = sub(holderPoint, runnerPoint);
  const relativeVelocity = sub(bodyPointVelocity(holder, holderPoint), bodyPointVelocity(runner, runnerPoint));
  const requested = add(scale(separation, grip.springNPerM), scale(relativeVelocity, grip.damperNsPerM));
  return { runnerPoint, holderPoint, separationM: length(separation), requestedForceN: requested, requestedLoadN: length(requested) };
}

function finiteTree(value, path = 'root', issues = []) {
  if (typeof value === 'number' && !Number.isFinite(value)) issues.push(path);
  else if (Array.isArray(value)) value.forEach((child, i) => finiteTree(child, `${path}[${i}]`, issues));
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) finiteTree(child, `${path}.${key}`, issues);
  return issues;
}

function closestSegmentDistance(a0, a1, b0, b1) {
  const u = sub(a1, a0), v = sub(b1, b0), w = sub(a0, b0);
  const aa = dot(u, u), bb = dot(u, v), cc = dot(v, v), dd = dot(u, w), ee = dot(v, w);
  const denom = aa * cc - bb * bb;
  let s = denom < 1e-12 ? 0 : Math.max(0, Math.min(1, (bb * ee - cc * dd) / denom));
  let t = cc < 1e-12 ? 0 : Math.max(0, Math.min(1, (bb * s + ee) / cc));
  s = aa < 1e-12 ? 0 : Math.max(0, Math.min(1, (bb * t - dd) / aa));
  t = cc < 1e-12 ? 0 : Math.max(0, Math.min(1, (bb * s + ee) / cc));
  return length(sub(add(a0, scale(u, s)), add(b0, scale(v, t))));
}

function estimateInitialPlayerPenetration(players, playerGeometry, playerScale = 1) {
  const parts = players.map((player) => {
    const rotation = [0, Math.sin((player.yawRad ?? 0) / 2), 0, Math.cos((player.yawRad ?? 0) / 2)];
    const layout = playerGeometry === 'single-capsule'
      ? [{ pos: [0, 0, 0], halfHeight: 0.55, radius: 0.27 }]
      : BODY_LAYOUT;
    return { id: player.id, parts: layout.map((part) => {
      const axisRotation = part.axis === 'x' ? [0, 0, Math.SQRT1_2, Math.SQRT1_2] : [0, 0, 0, 1];
      const center = add(player.p, qRotate(scale(part.pos, playerScale), rotation));
      const axis = qRotate(qRotate([0, (part.halfHeight ?? 0) * playerScale, 0], axisRotation), rotation);
      return { a: sub(center, axis), b: add(center, axis), radius: part.radius * playerScale };
    }) };
  });
  let maximum = 0;
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    for (const a of parts[i].parts) for (const b of parts[j].parts) {
      maximum = Math.max(maximum, a.radius + b.radius - closestSegmentDistance(a.a, a.b, b.a, b.b));
    }
  }
  return Math.max(0, maximum);
}

function minimumBodySurfaceGap(stateA, stateB, playerGeometry, playerScale) {
  const layout = playerGeometry === 'single-capsule'
    ? [{ pos: [0, 0, 0], halfHeight: 0.55, radius: 0.27 }]
    : BODY_LAYOUT;
  const parts = (state) => layout.map((part) => {
    const axisRotation = part.axis === 'x' ? [0, 0, Math.SQRT1_2, Math.SQRT1_2] : [0, 0, 0, 1];
    const center = add(state.positionM, qRotate(scale(part.pos, playerScale), state.rotation));
    const axis = qRotate(qRotate([0, (part.halfHeight ?? 0) * playerScale, 0], axisRotation), state.rotation);
    return { a: sub(center, axis), b: add(center, axis), radius: part.radius * playerScale };
  });
  let minGap = Infinity;
  for (const a of parts(stateA)) for (const b of parts(stateB)) {
    minGap = Math.min(minGap, closestSegmentDistance(a.a, a.b, b.a, b.b) - a.radius - b.radius);
  }
  return minGap;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index), high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

export async function runScenario(engine, scenario, { playerGeometry = 'compound', recordFrames = true, recordStride = 1,
  behaviorVersion = 'm4b', timestepSeconds = DT, solverIterations = 8, joltCollisionSteps = 1, playerScale = 1,
  rapierContactSkinM = 0, materialOverrides = {}, balanceControllerEnabled = true, balanceTorqueScale = 1,
  playerMassScale = 1, playerTeamMassScales = {}, playerDriveScale = 1, gripStrengthScale = 1, gripStiffnessScale = 1,
  ballControlEnabled = true } = {}) {
  const startedAt = performance.now();
  const heapBeforeBytes = process.memoryUsage().heapUsed;
  const dt = timestepSeconds;
  if (!(dt > 0) || !(playerScale > 0) || !(playerMassScale > 0)
    || Object.values(playerTeamMassScales).some((scale) => !(scale > 0))) {
    throw new Error('timestepSeconds, playerScale, and all player mass scales must be positive');
  }
  const materials = { ...MATERIALS, ...(scenario.groundMaterial?.friction !== undefined ? { groundFriction: scenario.groundMaterial.friction } : {}), ...materialOverrides };
  const playerSpecs = scenario.players.map((spec) => ({ ...spec,
    mass: spec.mass * playerMassScale * (playerTeamMassScales[spec.team] ?? 1) }));
  const world = await createPhysics(engine, { ...materials, material: materials, ground: true, gravity: -GRAVITY,
    solverIterations, timestep: dt, joltCollisionSteps, playerGeometry, playerScale, rapierContactSkinM });
  const players = new Map();
  for (const spec of playerSpecs) players.set(spec.id, await world.addPlayer(spec, spec.id));
  const carrierId = scenario.carrierId ?? (players.has('carrier') ? 'carrier' : scenario.sackTargetId ?? (players.has('quarterback') ? 'quarterback' : scenario.players[0].id));
  const carrier = players.get(carrierId);
  if (!carrier) throw new Error(`${scenario.id}: carrierId ${carrierId} does not name a player`);
  const ballSpec = scenario.carriedBall ?? scenario.looseBall ?? null;
  const ballOwnerId = scenario.ballOriginId ?? carrierId;
  let ballAttachedToId = ballOwnerId;
  let ball = null, ballAttached = Boolean(scenario.carriedBall), ballStatus = ballSpec ? 'carried_by_model_constraint' : 'not_present';
  const possessionByPlayer = new Map();
  const possessionHistory = new Map();
  const activeBallContactPairs = new Set();
  const oneShotRecoveryAttempts = new Set();
  const penetrationSamples = [];
  if (ballSpec) {
    const ballOwner = players.get(ballOwnerId);
    if (!ballOwner && !scenario.looseBall) throw new Error(`${scenario.id}: ballOriginId ${ballOwnerId} does not name a player`);
    const ownerState = ballOwner ? world.state(ballOwner) : null;
    const ballPosition = scenario.looseBall?.p ?? worldAnchor(ownerState, ballSpec.localOffsetM);
    const ballVelocity = scenario.looseBall?.v ?? ownerState.linearVelocityMps;
    ball = world.addBallisticBody({ p: ballPosition, v: ballVelocity, angular: scenario.looseBall?.angular ?? ownerState?.angularVelocityRadPerSec ?? [0, 0, 0],
      yawRad: ownerState ? playerSpecs.find((row) => row.id === ballOwnerId)?.yawRad ?? 0 : scenario.looseBall?.yawRad ?? 0,
      mass: ballSpec.mass, shape: ballSpec.shape, halfExtents: ballSpec.halfExtents, label: 'football',
      material: { friction: 0.58, restitution: 0.32, linearDamping: 0.015, angularDamping: 0.02 } });
    if (scenario.looseBall) { ballAttached = false; ballAttachedToId = null; ballStatus = 'loose_live'; }
  }

  const events = [{ type: 'scenario_started', timeSeconds: 0, scenarioId: scenario.id, seed: scenario.seed,
    proxyModel: playerGeometry === 'single-capsule' ? 'one rigid vertical capsule' : 'five-part rigid compound; parts are not articulated' }];
  const firstContactByPair = new Map();
  const activeContactPairs = new Set();
  const contactOpportunityByPair = new Map();
  const activeContactOpportunityPairs = new Set();
  const gripByHolder = new Map();
  const gripMaxima = new Map();
  const fallState = new Map([...players.keys()].map((id) => [id, { fellAtSeconds: null, recoveredAtSeconds: null,
    maxTiltDeg: 0, sustainedDownTicks: 0 }]));
  const physicalContributors = new Map();
  const contributionLedger = new Map();
  const sampledFrames = [];
  let maxPenetrationM = 0;
  let maxObservedPlayerCount = players.size;
  let ballReleaseAt = null, ballReleaseReason = null;
  let snapReleased = false, throwReleased = false;
  let sackCompletedAt = null;
  let lastBallPosition = ball ? world.state(ball).positionM : null;
  let maxCarrierX = carrier ? world.state(carrier).positionM[0] : 0;
  let maxPossessedBallX = ball ? world.state(ball).positionM[0] : null;
  let recoveryTouchEvents = 0;
  let stepsCompleted = 0;
  const steps = ticks(scenario.durationSeconds, dt);
  const frameStride = Math.max(1, Math.floor(recordStride));
  const initialPlayerPenetrationM = estimateInitialPlayerPenetration(playerSpecs, playerGeometry, playerScale);

  const snapshotStates = () => new Map([...players].map(([id, body]) => [id, world.state(body)]));
  const pushForce = (body, id, forceN, point, source, appliedForces) => {
    world.applyForce(body, forceN, point ?? null);
    (appliedForces[id] ??= []).push({ forceN, applicationPointWorldM: point, source });
  };
  const pushTorque = (body, id, torqueNm, appliedTorques) => {
    world.applyTorque(body, torqueNm);
    (appliedTorques[id] ??= []).push({ torqueNm, source: 'bounded upright balance controller' });
  };
  const contactSnapshot = (a, b) => world.contactSnapshot ? world.contactSnapshot(a, b) : {
    touching: world.touching(a, b), pointsM: world.contactPoints(a, b), maximumPenetrationDepthM: null, normalImpulseNs: null,
    impulseSource: 'adapter does not expose solver impulses', penetrationSource: 'not exposed',
  };
  const createGrip = (holderId, contact) => {
    const holderSpec = playerSpecs.find((row) => row.id === holderId);
    if (!holderSpec?.wrap || gripByHolder.has(holderId)) return;
    const runnerState = world.state(carrier), holderState = world.state(players.get(holderId));
    const contactPoint = contact.pointsM?.[0] ?? [
      (runnerState.positionM[0] + holderState.positionM[0]) / 2,
      (runnerState.positionM[1] + holderState.positionM[1]) / 2 + 0.12,
      (runnerState.positionM[2] + holderState.positionM[2]) / 2,
    ];
    const config = holderSpec.wrap;
    const grip = { holderId, runnerAnchorLocalM: localAnchor(runnerState, contactPoint), holderAnchorLocalM: localAnchor(holderState, contactPoint),
      capacityN: config.capacityN * gripStrengthScale, springNPerM: (config.springNPerM ?? 4200) * gripStiffnessScale,
      damperNsPerM: (config.damperNsPerM ?? 440) * gripStiffnessScale,
      extensionLimitM: config.extensionLimitM ?? 0.72, releaseOverloadTicks: config.releaseOverloadTicks ?? 2,
      overloadTicks: 0, maximumRequestedLoadN: 0, maximumAppliedLoadN: 0, active: true };
    gripByHolder.set(holderId, grip); gripMaxima.set(holderId, grip);
    events.push({ type: 'wrap_proxy_established', timeSeconds: stepsCompleted * dt, players: [carrierId, holderId],
      contactPointM: contactPoint, contactPointSource: contact.pointsM?.length ? 'solver contact manifold' : 'body-center midpoint estimate',
      model: 'torso-anchor spring-damper with equal-and-opposite forces; no articulated arm or hand grasp', capacityN: grip.capacityN });
  };
  const possessionControlPoints = (spec) => spec.controlPointsLocalM ?? [[0, 0, -0.06], [0, 0, 0.06]];
  const createPossessionGrip = (holderId, atSeconds, source, ownerAnchorBaseM = null, captureAtContact = false, configOverrides = {}) => {
    const ownerState = world.state(players.get(holderId));
    const offsets = possessionControlPoints(ballSpec);
    const ownerBase = ownerAnchorBaseM ?? ballSpec.localOffsetM ?? [0, 0.25, 0];
    const ballState = ball ? world.state(ball) : null;
    const controlConfig = { ...ballSpec, ...configOverrides };
    const grip = { holderId, source, establishedAtSeconds: atSeconds,
      ownerAnchorsLocalM: captureAtContact && ballState
        ? offsets.map((offset) => localAnchor(ownerState, worldAnchor(ballState, offset)))
        : offsets.map((offset) => add(ownerBase, offset)),
      ballAnchorsLocalM: offsets.map((offset) => offset.slice()),
      springNPerM: (controlConfig.springNPerM ?? 1450) * gripStiffnessScale,
      damperNsPerM: (controlConfig.damperNsPerM ?? 48) * gripStiffnessScale,
      capacityN: (controlConfig.gripCapacityN ?? 500) * gripStrengthScale,
      pointCapacityN: (controlConfig.pointCapacityN ?? 320) * gripStrengthScale,
      extensionLimitM: controlConfig.extensionLimitM ?? 0.34, releaseOverloadTicks: controlConfig.releaseOverloadTicks ?? 2,
      overloadTicks: 0, maximumRequestedLoadN: 0, maximumAppliedLoadN: 0, maximumExtensionM: 0,
      active: true, controlPoints: offsets.length };
    possessionByPlayer.set(holderId, grip);
    const history = possessionHistory.get(holderId) ?? { source, establishedAtSeconds: atSeconds,
      capacityN: grip.capacityN, maximumLoadN: 0 };
    history.grip = grip;
    possessionHistory.set(holderId, history);
    ballAttached = true;
    ballAttachedToId = possessionByPlayer.size === 1 ? holderId : null;
    ballStatus = possessionByPlayer.size > 1 ? 'contested_control' : source === 'initial_state' ? 'held_by_two_point_cradle' : 'control_attempt_established';
    events.push({ type: source === 'recovery' ? 'recovery_grip_attempt_started' : source === 'snap' ? 'snap_grip_attempt_started'
      : 'ball_control_initialized', timeSeconds: atSeconds, player: holderId, controlPoints: offsets.length, source,
      model: 'two-point rigid-body cradle; equal-and-opposite spring-damper forces; no articulated fingers' });
    return grip;
  };
  if (behaviorVersion === 'm4c' && scenario.carriedBall && ballControlEnabled) createPossessionGrip(ballOwnerId, 0, 'initial_state');
  else if (behaviorVersion === 'm4c' && scenario.carriedBall) {
    ballAttached = false; ballAttachedToId = null; ballStatus = 'control_disabled_free_ball';
  }
  const releaseBall = (timeSeconds, reason, impulseNs = null) => {
    if (!ball || !ballAttached) return;
    const releasingFrom = players.get(ballAttachedToId);
    possessionByPlayer.clear();
    ballAttached = false; ballAttachedToId = null; ballStatus = reason === 'fumble' ? 'loose_fumble'
      : reason === 'snap' ? 'snap_in_flight' : 'pass_in_flight';
    ballReleaseAt = timeSeconds; ballReleaseReason = reason;
    const state = world.state(ball);
    if (impulseNs) {
      world.applyImpulse(ball, impulseNs, state.centerOfMassM);
      events.push({ type: 'scenario_impulse', timeSeconds, target: 'football', impulseNs, source: 'configured deterministic fumble impulse; external input' });
    }
    if (reason === 'throw' || reason === 'snap') {
      const releaseBodyState = world.state(releasingFrom);
      const velocity = reason === 'snap' ? (scenario.snapVelocityMps ?? [-2.8, 0.6, 0]) : (scenario.throwVelocityMps ?? [18, 5.5, 0.5]);
      world.setVelocity(ball, add(releaseBodyState.linearVelocityMps, velocity), reason === 'snap' ? [0, 0.3, 0] : [0, 2.5, 0]);
    }
    events.push({ type: reason === 'throw' ? 'quarterback_pass_release' : reason === 'snap' ? 'football_snap_release' : 'ball_released', timeSeconds,
      reason: reason === 'fumble' ? 'first physical opponent contact under configured fumble scenario' : reason,
      ballPositionM: state.positionM, releaseVelocityMps: world.state(ball).linearVelocityMps,
      releaseModel: reason === 'fumble' ? 'inherited carry-proxy rigid-body state' : `${reason} launch velocity is a configured fixture input; subsequent ball flight is solver-resolved` });
  };
  const gripRows = () => [...gripByHolder.values()].map((grip) => {
    const load = gripLoad(grip, world.state(carrier), world.state(players.get(grip.holderId)));
    return { holderId: grip.holderId, active: grip.active, runnerAnchorM: worldAnchor(world.state(carrier), grip.runnerAnchorLocalM),
      holderAnchorM: worldAnchor(world.state(players.get(grip.holderId)), grip.holderAnchorLocalM), separationM: load.separationM,
      requestedLoadN: load.requestedLoadN, capacityN: grip.capacityN };
  });

  const recordFrame = (tick, contacts, ballContacts, groundContacts, appliedForces, appliedTorques, constraints,
    pairStepDiagnostics = null, controllerTorqueRequests = {}, gripLoadInputs = [], possessionGripLoadInputs = []) => {
    if (!recordFrames || (tick !== 0 && tick !== steps && tick % frameStride !== 0)) return;
    const states = snapshotStates();
    const pairSurfaceGaps = pairStepDiagnostics ?? playerSpecs.flatMap((aSpec, i) => playerSpecs.slice(i + 1).map((bSpec) => {
      const minimumSurfaceGapM = minimumBodySurfaceGap(states.get(aSpec.id), states.get(bSpec.id), playerGeometry, playerScale);
      return { pairId: [aSpec.id, bSpec.id].sort().join('::'), bodies: [aSpec.id, bSpec.id], minimumSurfaceGapM,
        contactOpportunity: minimumSurfaceGapM <= CONTACT_OPPORTUNITY_GAP_M, physicalContact: false,
        maximumPenetrationDepthM: null, physicalContactDetection: 'initial pre-solver sample' };
    }));
    const playerRows = Object.fromEntries([...states].map(([id, state]) => [id, {
      positionM: state.positionM, centerOfMassM: state.centerOfMassM, linearVelocityMps: state.linearVelocityMps,
      angularVelocityRadPerSec: state.angularVelocityRadPerSec, rotation: state.rotation, tiltDeg: tiltDeg(state.rotation),
      grounded: world.grounded(players.get(id)),
    }]));
    const ballState = ball ? world.state(ball) : null;
    const currentCarrier = states.get(carrierId);
    const possessionControls = [...possessionByPlayer.values()].map((grip) => ({ playerId: grip.holderId,
      source: grip.source, active: grip.active, maximumRequestedLoadN: grip.maximumRequestedLoadN,
      capacityN: grip.capacityN, controlPoints: grip.ownerAnchorsLocalM.map((ownerLocal, index) => ({
        playerAnchorM: worldAnchor(states.get(grip.holderId), ownerLocal),
        ballAnchorM: ballState ? worldAnchor(ballState, grip.ballAnchorsLocalM[index]) : null,
      })) }));
    const energy = [...states].map(([id, state]) => ({ id, ...energyOf(state, world.energyProps(players.get(id))) }));
    if (ballState) energy.push({ id: 'football', ...energyOf(ballState, world.energyProps(ball)) });
    const bodyStates = [...states].map(([id, state]) => [id, state, players.get(id)]);
    if (ballState) bodyStates.push(['football', ballState, ball]);
    const momentumByBody = bodyStates.map(([id, state, body]) => {
      const properties = world.energyProps(body);
      const linearMomentum = scale(state.linearVelocityMps, properties.massKg);
      const principalOrientation = qMultiply(state.rotation, properties.inertiaLocalRotation);
      const angularVelocityLocal = qRotate(state.angularVelocityRadPerSec, qConjugate(principalOrientation));
      const spinMomentumLocal = angularVelocityLocal.map((value, axis) => value * properties.principalInertiaKgM2[axis]);
      const spinMomentum = qRotate(spinMomentumLocal, principalOrientation);
      const orbitalMomentum = cross(state.centerOfMassM, linearMomentum);
      return { id, massKg: properties.massKg, linearMomentumKgMps: linearMomentum,
        orbitalAngularMomentumKgM2PerSec: orbitalMomentum, spinAngularMomentumKgM2PerSec: spinMomentum,
        angularMomentumAboutOriginKgM2PerSec: add(orbitalMomentum, spinMomentum) };
    });
    const sumMomentum = (field) => momentumByBody.reduce((sum, row) => add(sum, row[field]), [0, 0, 0]);
    const gravityForceNByBody = Object.fromEntries(momentumByBody.map((row) => [row.id, scale(GRAVITY_VECTOR, row.massKg)]));
    sampledFrames.push(round({ tick, timeSeconds: tick * dt, players: playerRows,
      football: ballState ? { positionM: ballState.positionM, centerOfMassM: ballState.centerOfMassM,
        linearVelocityMps: ballState.linearVelocityMps, angularVelocityRadPerSec: ballState.angularVelocityRadPerSec,
        rotation: ballState.rotation, status: ballStatus, controlledBy: possessionByPlayer.size === 1 ? [...possessionByPlayer.keys()][0] : null,
        controlPlayers: [...possessionByPlayer.keys()] } : null,
      contacts, ballContacts, groundContacts, possessionControls, pairSurfaceGaps,
      forcesNByPlayer: appliedForces, torquesNmByPlayer: appliedTorques,
      controllerTorqueRequestsNmByPlayer: controllerTorqueRequests,
      grips: constraints, gripLoadInputs, possessionGripLoadInputs,
      diagnostics: { mechanicalEnergyByBodyJ: energy, totalMechanicalEnergyJ: energy.reduce((sum, row) => sum + row.totalMechanicalJ, 0),
        momentumByBody, totalLinearMomentumKgMps: sumMomentum('linearMomentumKgMps'),
        totalAngularMomentumAboutOriginKgM2PerSec: sumMomentum('angularMomentumAboutOriginKgM2PerSec'),
        knownForceInputs: { gravityForceNByBody, appliedForceRecordsByBody: appliedForces, appliedTorqueRecordsByBody: appliedTorques,
          groundContactBodies: groundContacts.map((row) => row.body) },
        momentumInterpretation: 'Instantaneous system momentum; gravity, ground reactions, configured controllers, and scenario impulses are external inputs. Force records retain their source labels; equal-and-opposite wrap and carry proxies remain identifiable.' },
      rawProgress: { carrierPositionXM: currentCarrier.positionM[0], footballPositionXM: ballState?.positionM[0] ?? null,
        possessionControlled: ballAttached } }));
  };

  recordFrame(0, [], [], [], {}, {}, []);
  for (let tick = 0; tick < steps; tick++) {
    const timeSeconds = tick * dt;
    const appliedForces = {}, appliedTorques = {}, controllerTorqueRequests = {};
    const gripLoadInputs = [], possessionGripLoadInputs = [];
    const stepContactPenetrations = [];
    const preStates = snapshotStates();
    const preBallState = ball ? world.state(ball) : null;
    const carrierState = preStates.get(carrierId);

    if (!snapReleased && scenario.snapAtSeconds !== undefined && ballAttached && timeSeconds >= scenario.snapAtSeconds) {
      snapReleased = true; releaseBall(timeSeconds, 'snap');
    }
    if (!throwReleased && scenario.throwAtSeconds !== undefined && ballAttached && timeSeconds >= scenario.throwAtSeconds && sackCompletedAt === null) {
      throwReleased = true;
      releaseBall(timeSeconds, 'throw');
    }
    if (behaviorVersion === 'm4b' && scenario.fumbleOnFirstContact && ballAttached && tick > 0) {
      const opponentAlreadyTouching = playerSpecs.some((spec) => spec.team !== playerSpecs.find((row) => row.id === carrierId)?.team
        && world.touching(carrier, players.get(spec.id)));
      if (opponentAlreadyTouching) releaseBall(timeSeconds, 'fumble', scenario.fumbleImpulseNs ?? null);
    }

    for (const [id, body] of players) {
      const spec = playerSpecs.find((row) => row.id === id);
      const state = preStates.get(id);
      const torque = balanceControllerEnabled ? scale(forceControllerTorque(state, spec.strength ?? 80, spec.balanceScale ?? 0.8, world.grounded(body)), balanceTorqueScale) : [0, 0, 0];
      controllerTorqueRequests[id] = torque;
      if (length(torque) > 0.01) pushTorque(body, id, torque, appliedTorques);
      const drive = spec.drive;
      if (drive && timeSeconds >= (drive.startSeconds ?? 0) && timeSeconds < (drive.endSeconds ?? scenario.durationSeconds)) {
        const point = drive.applicationLocalM ? worldAnchor(state, drive.applicationLocalM) : null;
        pushForce(body, id, scale(drive.forceN, playerDriveScale), point, 'configured player drive force', appliedForces);
      }
    }

    for (const grip of gripByHolder.values()) {
      if (!grip.active) continue;
      const runnerState = preStates.get(carrierId), holderState = preStates.get(grip.holderId);
      const load = gripLoad(grip, runnerState, holderState);
      const stepGripLoad = { holderId: grip.holderId, activeBeforeStep: grip.active, separationM: load.separationM,
        requestedLoadN: load.requestedLoadN, capacityN: grip.capacityN, appliedForceN: 0, applied: false, released: false,
        loadSource: 'explicit spring-damper force law; not solver constraint force' };
      grip.maximumRequestedLoadN = Math.max(grip.maximumRequestedLoadN, load.requestedLoadN);
      grip.overloadTicks = load.requestedLoadN > grip.capacityN || load.separationM > grip.extensionLimitM ? grip.overloadTicks + 1 : 0;
      if (grip.overloadTicks >= grip.releaseOverloadTicks) {
        grip.active = false;
        stepGripLoad.released = true;
        gripLoadInputs.push(stepGripLoad);
        events.push({ type: 'wrap_proxy_released', timeSeconds, players: [carrierId, grip.holderId], requestedLoadN: load.requestedLoadN,
          capacityN: grip.capacityN, separationM: load.separationM, reason: load.separationM > grip.extensionLimitM ? 'extension_limit' : 'configured_load_limit' });
        continue;
      }
      const force = capVector(load.requestedForceN, grip.capacityN);
      stepGripLoad.appliedForceN = length(force);
      stepGripLoad.applied = true;
      gripLoadInputs.push(stepGripLoad);
      grip.maximumAppliedLoadN = Math.max(grip.maximumAppliedLoadN, length(force));
      const ledger = contributionLedger.get(grip.holderId);
      if (ledger) {
        ledger.maximumGripLoadN = Math.max(ledger.maximumGripLoadN ?? 0, load.requestedLoadN);
        ledger.cumulativeGripImpulseNs = (ledger.cumulativeGripImpulseNs ?? 0) + length(force) * dt;
        ledger.gripCapacityN = grip.capacityN;
      }
      pushForce(carrier, carrierId, force, load.runnerPoint, `wrap proxy against ${grip.holderId}`, appliedForces);
      pushForce(players.get(grip.holderId), grip.holderId, scale(force, -1), load.holderPoint, `wrap proxy against ${carrierId}`, appliedForces);
    }

    if (ball && ballAttached && behaviorVersion === 'm4c') {
      const ballState = preBallState;
      const releases = [];
      for (const grip of possessionByPlayer.values()) {
        if (!grip.active) continue;
        const ownerState = preStates.get(grip.holderId);
        const requestedForces = grip.ballAnchorsLocalM.map((ballLocal, index) => {
          const ballPoint = worldAnchor(ballState, ballLocal);
          const ownerPoint = worldAnchor(ownerState, grip.ownerAnchorsLocalM[index]);
          const relativeVelocity = sub(bodyPointVelocity(ownerState, ownerPoint), bodyPointVelocity(ballState, ballPoint));
          return { ballPoint, ownerPoint, force: add(scale(sub(ownerPoint, ballPoint), grip.springNPerM), scale(relativeVelocity, grip.damperNsPerM)) };
        });
        const requestedLoadN = requestedForces.reduce((sum, row) => sum + length(row.force), 0);
        const maximumExtensionM = Math.max(...requestedForces.map((row) => length(sub(row.ownerPoint, row.ballPoint))));
        const stepPossessionGripLoad = { holderId: grip.holderId, activeBeforeStep: grip.active, requestedLoadN,
          maximumExtensionM, capacityN: grip.capacityN, appliedLoadN: 0, overloadTicks: grip.overloadTicks,
          released: false, loadSource: 'two-point spring-damper force law; not solver constraint force' };
        grip.maximumRequestedLoadN = Math.max(grip.maximumRequestedLoadN, requestedLoadN);
        grip.maximumExtensionM = Math.max(grip.maximumExtensionM, maximumExtensionM);
        const history = possessionHistory.get(grip.holderId);
        history.maximumLoadN = Math.max(history.maximumLoadN, requestedLoadN);
        grip.overloadTicks = requestedLoadN > grip.capacityN || maximumExtensionM > grip.extensionLimitM
          ? grip.overloadTicks + 1 : 0;
        if (grip.overloadTicks >= grip.releaseOverloadTicks) {
          grip.active = false;
          stepPossessionGripLoad.released = true;
          stepPossessionGripLoad.overloadTicks = grip.overloadTicks;
          possessionGripLoadInputs.push(stepPossessionGripLoad);
          releases.push({ holderId: grip.holderId, requestedLoadN, maximumExtensionM, overloadTicks: grip.overloadTicks,
            overloadDurationSeconds: grip.overloadTicks * dt,
            reason: maximumExtensionM > grip.extensionLimitM ? 'cradle_extension_limit' : 'attachment_force_capacity_exceeded' });
          continue;
        }
        const aggregateScale = requestedLoadN > grip.capacityN ? grip.capacityN / requestedLoadN : 1;
        let appliedLoadN = 0;
        for (const row of requestedForces) {
          const force = capVector(scale(row.force, aggregateScale), grip.pointCapacityN);
          appliedLoadN += length(force);
          pushForce(ball, 'football', force, row.ballPoint, `two-point cradle against ${grip.holderId}`, appliedForces);
          pushForce(players.get(grip.holderId), grip.holderId, scale(force, -1), row.ownerPoint,
            'equal-and-opposite two-point football cradle', appliedForces);
        }
        stepPossessionGripLoad.appliedLoadN = appliedLoadN;
        stepPossessionGripLoad.overloadTicks = grip.overloadTicks;
        possessionGripLoadInputs.push(stepPossessionGripLoad);
        grip.maximumAppliedLoadN = Math.max(grip.maximumAppliedLoadN, appliedLoadN);
      }
      for (const release of releases) {
        possessionByPlayer.delete(release.holderId);
        events.push({ type: 'possession_grip_overloaded', timeSeconds, player: release.holderId,
          requestedLoadN: release.requestedLoadN, capacityN: possessionHistory.get(release.holderId)?.capacityN ?? null,
          maximumExtensionM: release.maximumExtensionM, overloadTicks: release.overloadTicks,
          overloadDurationSeconds: release.overloadDurationSeconds, reason: release.reason,
          loadSource: 'two-point spring-damper force law; not a solver constraint impulse' });
      }
      ballAttached = possessionByPlayer.size > 0;
      ballAttachedToId = possessionByPlayer.size === 1 ? [...possessionByPlayer.keys()][0] : null;
      if (possessionByPlayer.size === 0 && releases.length) {
        ballStatus = 'loose_fumble'; ballReleaseAt = timeSeconds; ballReleaseReason = 'grip_overload';
        events.push({ type: 'ball_released', timeSeconds, reason: 'holding cradle exceeded its force or extension limit',
          players: releases.map((row) => row.holderId), ballPositionM: ballState.positionM,
          releaseVelocityMps: ballState.linearVelocityMps, releaseModel: 'solver-resolved rigid-body state after physical cradle overload' });
      } else if (possessionByPlayer.size > 1) ballStatus = 'contested_control';
      else if (possessionByPlayer.size === 1) ballStatus = 'held_by_two_point_cradle';
    } else if (ball && ballAttached) {
      const ballState = preBallState;
      const attachedOwner = preStates.get(ballAttachedToId);
      const target = worldAnchor(attachedOwner, ballSpec.localOffsetM);
      const ownerPointVelocity = bodyPointVelocity(attachedOwner, target);
      const force = add(scale(sub(target, ballState.positionM), ballSpec.springNPerM),
        scale(sub(ownerPointVelocity, ballState.linearVelocityMps), ballSpec.damperNsPerM));
      const bounded = capVector(force, ballSpec.maxForceN);
      pushForce(ball, 'football', bounded, ballState.centerOfMassM, 'football carry cradle proxy', appliedForces);
      pushForce(players.get(ballAttachedToId), ballAttachedToId, scale(bounded, -1), target, 'equal-and-opposite football carry cradle proxy', appliedForces);
    }

    await world.step();
    stepsCompleted = tick + 1;
    const frameContacts = [];
    const frameBallContacts = [];
    const postStates = snapshotStates();
    const pairStepDiagnostics = [];
    const now = new Set();
    const opportunitiesNow = new Set();
    for (let i = 0; i < playerSpecs.length; i++) for (let j = i + 1; j < playerSpecs.length; j++) {
      const aSpec = playerSpecs[i], bSpec = playerSpecs[j];
      const a = players.get(aSpec.id), b = players.get(bSpec.id);
      const pairId = [aSpec.id, bSpec.id].sort().join('::');
      const surfaceGapM = minimumBodySurfaceGap(postStates.get(aSpec.id), postStates.get(bSpec.id), playerGeometry, playerScale);
      const pairDiagnostic = { pairId, bodies: [aSpec.id, bSpec.id], minimumSurfaceGapM: surfaceGapM,
        contactOpportunity: surfaceGapM <= CONTACT_OPPORTUNITY_GAP_M, physicalContact: false,
        maximumPenetrationDepthM: null, normalImpulseNs: null,
        physicalContactDetection: engine === 'rapier3d-compat'
          ? 'Rapier active contact-pair snapshot after fixed step'
          : 'Jolt body touching state after fixed step' };
      pairStepDiagnostics.push(pairDiagnostic);
      if (surfaceGapM <= CONTACT_OPPORTUNITY_GAP_M) {
        opportunitiesNow.add(pairId);
        const opportunity = contactOpportunityByPair.get(pairId) ?? {
          pairId, bodies: [aSpec.id, bSpec.id], firstOpportunityTimeSeconds: (tick + 1) * dt,
          closestSurfaceGapM: surfaceGapM, sampledOpportunitySteps: 0, physicalContactObserved: false,
        };
        opportunity.closestSurfaceGapM = Math.min(opportunity.closestSurfaceGapM, surfaceGapM);
        opportunity.sampledOpportunitySteps++;
        contactOpportunityByPair.set(pairId, opportunity);
        if (!activeContactOpportunityPairs.has(pairId)) events.push({ type: 'contact_opportunity_started',
          timeSeconds: (tick + 1) * dt, pair: [aSpec.id, bSpec.id], analyticSurfaceGapM: surfaceGapM,
          opportunityDistanceM: CONTACT_OPPORTUNITY_GAP_M,
          interpretation: 'capsule/sphere geometry came within 0.10 m; this is an opportunity metric, not solver contact' });
      }
      const contact = contactSnapshot(a, b);
      if (!contact.touching) continue;
      pairDiagnostic.physicalContact = true;
      pairDiagnostic.maximumPenetrationDepthM = contact.maximumPenetrationDepthM;
      pairDiagnostic.normalImpulseNs = contact.normalImpulseNs;
      now.add(pairId);
      const preA = preStates.get(aSpec.id), preB = preStates.get(bSpec.id);
      const postA = postStates.get(aSpec.id), postB = postStates.get(bSpec.id);
      let normalWorld = contact.normalWorld ?? normalize(sub(postB.positionM, postA.positionM));
      if (contact.normalFrom && contact.normalFrom !== aSpec.id) normalWorld = scale(normalWorld, -1);
      const relativeBefore = dot(sub(preB.linearVelocityMps, preA.linearVelocityMps), normalWorld);
      const relativeAfter = dot(sub(postB.linearVelocityMps, postA.linearVelocityMps), normalWorld);
      const reducedMass = 1 / (1 / postA.massKg + 1 / postB.massKg);
      const estimatedImpulse = Math.max(0, (relativeAfter - relativeBefore) * reducedMass);
      const hasSolverImpulse = contact.normalImpulseNs !== null && contact.normalImpulseNs > 0;
      const impulseUsed = hasSolverImpulse ? contact.normalImpulseNs : estimatedImpulse;
      const impulseSource = hasSolverImpulse ? contact.impulseSource
        : 'relative-velocity/reduced-mass estimate; simultaneous contacts, ground, and controls can confound attribution';
      const contactRow = { pairId, bodies: [aSpec.id, bSpec.id], pointsM: contact.pointsM ?? [], normalWorld,
        maximumPenetrationDepthM: contact.maximumPenetrationDepthM, normalImpulseNs: contact.normalImpulseNs,
        estimatedNormalImpulseNs: hasSolverImpulse ? null : estimatedImpulse, impulseSource,
        penetrationSource: contact.penetrationSource, contactForceEstimateN: impulseUsed / dt };
      frameContacts.push(contactRow);
      if (contact.maximumPenetrationDepthM !== null) {
        maxPenetrationM = Math.max(maxPenetrationM, contact.maximumPenetrationDepthM);
        stepContactPenetrations.push(contact.maximumPenetrationDepthM);
      }
      if (!activeContactPairs.has(pairId)) {
        const startTime = (tick + 1) * dt;
        const contactNumber = (firstContactByPair.get(pairId)?.count ?? 0) + 1;
        firstContactByPair.set(pairId, { firstTimeSeconds: firstContactByPair.get(pairId)?.firstTimeSeconds ?? startTime, count: contactNumber });
        events.push({ type: 'player_contact_started', timeSeconds: startTime, pair: [aSpec.id, bSpec.id], contactNumber,
          pointsM: contact.pointsM ?? [], penetrationM: contact.maximumPenetrationDepthM, normalImpulseNs: contact.normalImpulseNs,
          estimatedNormalImpulseNs: hasSolverImpulse ? null : estimatedImpulse, impulseSource, forceEstimateN: impulseUsed / dt });
      }
      const carrierContact = (aSpec.id === carrierId && bSpec.team !== aSpec.team) || (bSpec.id === carrierId && aSpec.team !== bSpec.team);
      if (contactOpportunityByPair.has(pairId)) contactOpportunityByPair.get(pairId).physicalContactObserved = true;
      if (carrierContact) {
        const other = aSpec.id === carrierId ? bSpec : aSpec;
        physicalContributors.set(other.id, physicalContributors.get(other.id) ?? startContactRecord(firstContactByPair.get(pairId).firstTimeSeconds, contact));
        const contributor = contributionLedger.get(other.id) ?? { playerId: other.id,
          firstContactTimeSeconds: firstContactByPair.get(pairId).firstTimeSeconds, lastContactTimeSeconds: (tick + 1) * dt,
          contactPairSamples: 0, cumulativeNormalImpulseNs: 0, peakNormalImpulseNs: 0,
          cumulativeCarrierVelocityChangeMps: [0, 0, 0], peakPenetrationM: 0 };
        contributor.lastContactTimeSeconds = (tick + 1) * dt;
        contributor.contactPairSamples++;
        contributor.cumulativeNormalImpulseNs += impulseUsed;
        contributor.peakNormalImpulseNs = Math.max(contributor.peakNormalImpulseNs, impulseUsed);
        contributor.cumulativeCarrierVelocityChangeMps = add(contributor.cumulativeCarrierVelocityChangeMps,
          sub(aSpec.id === carrierId ? postA.linearVelocityMps : postB.linearVelocityMps,
            aSpec.id === carrierId ? preA.linearVelocityMps : preB.linearVelocityMps));
        contributor.peakPenetrationM = Math.max(contributor.peakPenetrationM, contact.maximumPenetrationDepthM ?? 0);
        contributionLedger.set(other.id, contributor);
        createGrip(other.id, contact);
      }
      if (ball && !ballAttached && (aSpec.id === carrierId || bSpec.id === carrierId) && (aSpec.team !== bSpec.team)) {
        // Ball status is independent from a player-body collision; recovery remains unresolved without a hand-control model.
      }
    }
    activeContactPairs.clear(); for (const pair of now) activeContactPairs.add(pair);
    activeContactOpportunityPairs.clear(); for (const pair of opportunitiesNow) activeContactOpportunityPairs.add(pair);

    const groundContacts = [];
    for (const [id, body] of players) {
      const grounded = world.grounded(body);
      if (grounded) {
        const groundSnapshot = world.groundEntity ? contactSnapshot(body, world.groundEntity) : null;
        groundContacts.push({ body: id, pointsM: groundSnapshot?.pointsM ?? [], normalWorld: groundSnapshot?.normalWorld ?? null,
          maximumPenetrationDepthM: groundSnapshot?.maximumPenetrationDepthM ?? null,
          normalImpulseNs: groundSnapshot?.normalImpulseNs ?? null, impulseSource: groundSnapshot?.impulseSource ?? 'not exposed' });
        if (groundSnapshot?.maximumPenetrationDepthM !== null && groundSnapshot?.maximumPenetrationDepthM !== undefined) {
          maxPenetrationM = Math.max(maxPenetrationM, groundSnapshot.maximumPenetrationDepthM);
          stepContactPenetrations.push(groundSnapshot.maximumPenetrationDepthM);
        }
      }
    }
    if (ball && world.touching(ball, world.groundEntity)) {
      const groundSnapshot = contactSnapshot(ball, world.groundEntity);
      groundContacts.push({ body: 'football', pointsM: groundSnapshot.pointsM ?? [], normalWorld: groundSnapshot.normalWorld ?? null,
        maximumPenetrationDepthM: groundSnapshot.maximumPenetrationDepthM,
        normalImpulseNs: groundSnapshot.normalImpulseNs, impulseSource: groundSnapshot.impulseSource });
      if (groundSnapshot.maximumPenetrationDepthM !== null) stepContactPenetrations.push(groundSnapshot.maximumPenetrationDepthM);
    }

    if (ball) {
      const ballState = world.state(ball);
      lastBallPosition = ballState.positionM;
      if (ballAttached) maxPossessedBallX = Math.max(maxPossessedBallX ?? -Infinity, ballState.positionM[0]);
      const ballContactsNow = new Set();
      for (const [id, body] of players) {
        if (behaviorVersion === 'm4b' && ballAttached && id === ballAttachedToId) continue;
        const contact = contactSnapshot(ball, body);
        if (!contact.touching) continue;
        const pairId = `football::${id}`;
        ballContactsNow.add(pairId);
        const playerState = postStates.get(id);
        let normalWorld = contact.normalWorld ?? normalize(sub(playerState.positionM, ballState.positionM));
        if (contact.normalFrom && contact.normalFrom !== 'football') normalWorld = scale(normalWorld, -1);
        const perBodyEstimate = Math.max(0, dot(sub(playerState.linearVelocityMps, preStates.get(id).linearVelocityMps), normalWorld) * playerState.massKg);
        const hasSolverImpulse = contact.normalImpulseNs !== null && contact.normalImpulseNs > 0;
        const impulseUsed = hasSolverImpulse ? contact.normalImpulseNs : perBodyEstimate;
        const row = { pairId: `football::${id}`, bodies: ['football', id], pointsM: contact.pointsM ?? [], normalWorld,
          maximumPenetrationDepthM: contact.maximumPenetrationDepthM, normalImpulseNs: contact.normalImpulseNs,
          estimatedNormalImpulseNs: hasSolverImpulse ? null : perBodyEstimate,
          impulseSource: hasSolverImpulse ? contact.impulseSource : 'per-body momentum-change estimate; includes other contacts and configured forces',
          contactForceEstimateN: impulseUsed / dt };
        frameBallContacts.push(row);
        if (contact.maximumPenetrationDepthM !== null) {
          maxPenetrationM = Math.max(maxPenetrationM, contact.maximumPenetrationDepthM);
          stepContactPenetrations.push(contact.maximumPenetrationDepthM);
        }
        const eventKey = `football::${id}`;
        const contactStarted = !activeBallContactPairs.has(pairId);
        if (!physicalContributors.has(eventKey)) {
          const targetContact = ballReleaseReason === 'snap' && id === scenario.snapTargetId;
          physicalContributors.set(eventKey, { firstTimeSeconds: (tick + 1) * dt,
            source: ballAttached ? 'carried football body contact' : 'released-ball body contact; not possession' });
          events.push({ type: ballAttached ? 'carried_ball_body_contact' : targetContact ? 'snap_arrival_body_contact'
            : 'released_ball_player_contact', timeSeconds: (tick + 1) * dt,
            player: id, pointsM: contact.pointsM ?? [], normalImpulseNs: contact.normalImpulseNs, estimatedNormalImpulseNs: row.estimatedNormalImpulseNs,
            interpretation: ballAttached ? 'football rigid-body contact; does not establish tackle attribution'
              : targetContact ? 'snap reached target body; controlled catch remains unresolved without hand mechanics'
                : 'physical touch recorded; secure recovery unresolved without articulated hands/control' });
          if (behaviorVersion === 'm4b' && !ballAttached && ballReleaseReason === 'snap' && id === scenario.snapTargetId) events.push({
            type: 'snap_reception_unresolved', timeSeconds: (tick + 1) * dt,
            reason: 'Ball body contact with quarterback is not secure possession; no catch controller is present.',
          });
          if (!ballAttached && ballReleaseReason === 'fumble') recoveryTouchEvents++;
        }
        if (behaviorVersion === 'm4c' && ballControlEnabled && contactStarted) {
          const policy = { ...(scenario.recoveryPolicy ?? {}), ...(playerSpecs.find((spec) => spec.id === id)?.recovery ?? {}) };
          const isSnapTarget = ballReleaseReason === 'snap' && id === scenario.snapTargetId;
          const mayContest = Boolean(policy.allowContestedRecovery || scenario.allowContestedRecovery);
          const canAttempt = !ballAttached || mayContest || isSnapTarget;
          const snapTargetOnly = ballReleaseReason === 'snap' && scenario.snapTargetId && !isSnapTarget;
          if (canAttempt) events.push({ type: 'loose_ball_physical_contact', timeSeconds: (tick + 1) * dt, player: id,
            pointsM: contact.pointsM ?? [], relativeSpeedMps: length(sub(ballState.linearVelocityMps, playerState.linearVelocityMps)),
            normalImpulseNs: contact.normalImpulseNs, estimatedNormalImpulseNs: row.estimatedNormalImpulseNs,
            interpretation: 'Rigid-body contact is required before a recovery grip attempt; contact alone does not grant possession.' });
          const isLoose = possessionByPlayer.size === 0;
          const oneShotDone = oneShotRecoveryAttempts.has(id);
          if (!snapTargetOnly && canAttempt && !possessionByPlayer.has(id) && (isLoose || mayContest)
            && !(policy.singleAttempt && oneShotDone)) {
            const contactPoint = contact.pointsM?.[0] ?? ballState.positionM;
            const handAnchor = worldAnchor(playerState, policy.handAnchorLocalM ?? [0.34, 0.28, 0]);
            const reachDistanceM = length(sub(contactPoint, handAnchor));
            const relativeSpeedMps = length(sub(ballState.linearVelocityMps, playerState.linearVelocityMps));
            const maximumReachM = policy.maximumReachM ?? 0.62;
            const maximumContactSpeedMps = policy.maximumContactSpeedMps ?? 2.8;
            const attemptSource = isSnapTarget ? 'snap' : 'recovery';
            if (reachDistanceM <= maximumReachM && relativeSpeedMps <= maximumContactSpeedMps) {
              const ownerAnchorBaseM = policy.ownerGripAnchorLocalM ?? (isSnapTarget
                ? [0.20, 0.24, 0] : policy.handAnchorLocalM ?? [0.08, -0.48, 0]);
              const grip = createPossessionGrip(id, (tick + 1) * dt, attemptSource, ownerAnchorBaseM, true,
                isSnapTarget ? {} : policy);
              grip.readyAtSeconds = (tick + 1) * dt + (policy.gripEstablishmentSeconds ?? 0.08);
              grip.secureAfterSeconds = policy.secureAfterSeconds ?? (isSnapTarget ? 0.25 : 0.50);
              grip.reachDistanceM = reachDistanceM;
              recoveryTouchEvents++;
              if (policy.singleAttempt) oneShotRecoveryAttempts.add(id);
              events.push({ type: 'ball_control_candidate', timeSeconds: (tick + 1) * dt, player: id,
                source: attemptSource, reachDistanceM, relativeSpeedMps, contactPointM: contactPoint,
                controlPoints: grip.controlPoints, physicalGate: 'player-football rigid-body contact and hand-reach/relative-speed capture gate',
                capturedWorldAnchorsM: grip.ownerAnchorsLocalM.map((local) => worldAnchor(playerState, local)) });
            } else {
              recoveryTouchEvents++;
              if (policy.singleAttempt) oneShotRecoveryAttempts.add(id);
              events.push({ type: isSnapTarget ? 'snap_reception_failed' : 'recovery_attempt_failed',
                timeSeconds: (tick + 1) * dt, player: id, reachDistanceM, maximumReachM,
                relativeSpeedMps, maximumContactSpeedMps,
                reason: reachDistanceM > maximumReachM ? 'physical contact outside cradle reach' : 'impact speed exceeds cradle capture limit' });
            }
          }
        }
      }
      activeBallContactPairs.clear(); for (const pair of ballContactsNow) activeBallContactPairs.add(pair);
      if (behaviorVersion === 'm4b' && recoveryTouchEvents > 0 && !events.some((event) => event.type === 'recovery_unresolved')) events.push({ type: 'recovery_unresolved',
        timeSeconds: (tick + 1) * dt, reason: 'Rigid-body body contact cannot establish secure hand possession; no nearest-player or random winner assigned.' });
    }

    if (behaviorVersion === 'm4c' && ball) {
      for (const grip of possessionByPlayer.values()) {
        const heldSeconds = (tick + 1) * dt - grip.establishedAtSeconds;
        if (heldSeconds >= (grip.readyAtSeconds === undefined ? 0.08 : grip.readyAtSeconds - grip.establishedAtSeconds)
          && !grip.controlEstablished) {
          grip.controlEstablished = true;
          events.push({ type: grip.source === 'recovery' ? 'recovery_control_established' : grip.source === 'snap'
            ? 'snap_control_established' : 'ball_control_stabilized', timeSeconds: (tick + 1) * dt,
          player: grip.holderId, heldSeconds, controlPoints: grip.controlPoints,
          physicalEvidence: 'two-point attachment remained within force and extension limits after rigid-body contact' });
        }
        if (possessionByPlayer.size === 1 && grip.controlEstablished && !grip.secureEventRecorded
          && heldSeconds >= (grip.secureAfterSeconds ?? 1.0)) {
          grip.secureEventRecorded = true;
          const eventType = grip.source === 'recovery' ? 'secure_ball_recovery'
            : grip.source === 'snap' ? 'snap_reception_completed' : 'ball_possession_retained';
          events.push({ type: eventType, timeSeconds: (tick + 1) * dt, player: grip.holderId, heldSeconds,
            controlPoints: grip.controlPoints, competingControllers: 0,
            qualification: 'physical contact followed by continuous two-point cradle control for the preregistered interval' });
        }
      }
      ballAttached = possessionByPlayer.size > 0;
      ballAttachedToId = possessionByPlayer.size === 1 ? [...possessionByPlayer.keys()][0] : null;
      if (possessionByPlayer.size > 1) ballStatus = 'contested_control';
      else if (possessionByPlayer.size === 1) ballStatus = 'held_by_two_point_cradle';
      else if (!ballControlEnabled) ballStatus = 'control_disabled_free_ball';
      else if (ballReleaseReason === 'snap') ballStatus = 'snap_reception_unresolved';
      else if (ballReleaseReason === 'throw') ballStatus = 'pass_in_flight_reception_unresolved';
      else ballStatus = 'loose_live_recovery_unresolved';
    }

    for (const [id, state] of postStates) {
      const row = fallState.get(id);
      const tilt = tiltDeg(state.rotation); row.maxTiltDeg = Math.max(row.maxTiltDeg, tilt);
      const grounded = world.grounded(players.get(id));
      const physicallyDown = tilt >= 58 && grounded && state.centerOfMassM[1] <= 0.85;
      row.sustainedDownTicks = physicallyDown ? row.sustainedDownTicks + 1 : 0;
      if (row.sustainedDownTicks >= ticks(0.20, dt) && row.fellAtSeconds === null) {
        row.fellAtSeconds = Math.max(0, (tick + 1) * dt - 0.20);
        events.push({ type: 'player_fall_started', timeSeconds: row.fellAtSeconds, player: id, tiltDeg: tilt,
          groundContact: grounded, centerOfMassHeightM: state.centerOfMassM[1], sustainedDownSeconds: 0.20,
          terminalCondition: 'tilt, ground contact, low center of mass, and sustained duration' });
        if (id === scenario.sackTargetId) {
          sackCompletedAt = (tick + 1) * dt;
          const contributors = [...physicalContributors.entries()].filter(([key]) => key !== id && players.has(key))
            .map(([playerId, data]) => ({ playerId, firstContactTimeSeconds: data.firstTimeSeconds,
              contribution: contributionLedger.get(playerId) ?? null }));
          events.push({ type: 'physical_sack_takedown', timeSeconds: sackCompletedAt, quarterback: id, physicalContributors: contributors,
            groundContact: grounded, centerOfMassHeightM: state.centerOfMassM[1], sustainedDownSeconds: 0.20,
            officialScoring: 'not assigned; rules/scoring attribution is a separate interpretation' });
        }
      }
      if (row.fellAtSeconds !== null && row.recoveredAtSeconds === null && grounded && tilt < 30) {
        row.recoveredAtSeconds = (tick + 1) * dt;
        events.push({ type: 'player_recovered_upright', timeSeconds: row.recoveredAtSeconds, player: id, tiltDeg: tilt });
      }
      maxCarrierX = Math.max(maxCarrierX, state.positionM[0]);
    }

    const framesGrips = gripRows().map((row) => {
      const grip = gripByHolder.get(row.holderId);
      return { ...row, maximumRequestedLoadN: grip.maximumRequestedLoadN, maximumAppliedLoadN: grip.maximumAppliedLoadN,
        loadSource: 'explicit spring-damper force law; not solver constraint force' };
    });
    const stepMaximumPenetrationM = Math.max(0, ...stepContactPenetrations);
    penetrationSamples.push({ tick: tick + 1, timeSeconds: (tick + 1) * dt,
      maximumPenetrationM: stepMaximumPenetrationM, activeContactPairs: stepContactPenetrations.length,
      contactPenetrationsM: stepContactPenetrations });
    recordFrame(tick + 1, frameContacts, frameBallContacts, groundContacts, appliedForces, appliedTorques, framesGrips,
      pairStepDiagnostics, controllerTorqueRequests, gripLoadInputs, possessionGripLoadInputs);
  }

  const activeAtEnd = [...gripByHolder.values()].filter((row) => row.active).map((row) => row.holderId);
  const gripResults = [...gripByHolder.values()].map((row) => ({ holderId: row.holderId, released: !row.active, capacityN: row.capacityN,
    maximumRequestedLoadN: row.maximumRequestedLoadN, maximumAppliedLoadN: row.maximumAppliedLoadN,
    terminalSeparationM: gripLoad(row, world.state(carrier), world.state(players.get(row.holderId))).separationM }));
  const playerResults = [...players].map(([id, body]) => {
    const state = world.state(body), history = fallState.get(id);
    return { id, massKg: state.massKg, maxTiltDeg: history.maxTiltDeg, fellAtSeconds: history.fellAtSeconds,
      recoveredAtSeconds: history.recoveredAtSeconds, final: state };
  });
  const currentBall = ball ? world.state(ball) : null;
  if (ball && !ballAttached) ballStatus = behaviorVersion === 'm4c' && !ballControlEnabled ? 'control_disabled_free_ball'
    : ballReleaseReason === 'throw' ? 'pass_in_flight_reception_unresolved'
      : ballReleaseReason === 'snap' ? 'snap_reception_unresolved' : 'loose_live_recovery_unresolved';
  const contactList = [...firstContactByPair.entries()].map(([pairId, data]) => ({ pairId, ...data }));
  const perStepPenetration = penetrationSamples.map((row) => row.maximumPenetrationM);
  const contactPenetrationValues = penetrationSamples.flatMap((row) => row.contactPenetrationsM);
  const penetrationThresholds = [0.01, 0.05, 0.10, 0.15].map((thresholdM) => ({ thresholdM,
    contactPairSamplesExceeding: contactPenetrationValues.filter((value) => value > thresholdM).length,
    durationSecondsAboveThreshold: penetrationSamples.filter((row) => row.maximumPenetrationM > thresholdM).length * dt,
    fractionOfSimulationAboveThreshold: penetrationSamples.filter((row) => row.maximumPenetrationM > thresholdM).length / Math.max(1, penetrationSamples.length),
  }));
  const durationWeightedMeanPenetrationM = perStepPenetration.reduce((sum, value) => sum + value * dt, 0)
    / Math.max(dt, penetrationSamples.length * dt);
  const possessionResults = [...possessionHistory.entries()].map(([playerId, history]) => {
    const active = possessionByPlayer.get(playerId), grip = history.grip;
    const { grip: historicalGrip, ...historyRow } = history;
    return { playerId, ...historyRow, active: Boolean(active), controlPoints: active?.controlPoints ?? 2,
      maximumRequestedLoadN: grip?.maximumRequestedLoadN ?? history.maximumLoadN,
      maximumAppliedLoadN: grip?.maximumAppliedLoadN ?? null,
      maximumExtensionM: grip?.maximumExtensionM ?? null,
      secureEventRecorded: Boolean(grip?.secureEventRecorded) };
  });
  const contributionRows = [...contributionLedger.values()].map((row) => ({ ...row,
    cumulativeCarrierVelocityChangeMps: row.cumulativeCarrierVelocityChangeMps.map((value) => Number(value.toFixed(5))),
    impulseInterpretation: engine === 'rapier3d-compat' ? 'summed solver contact-normal impulses plus separate modeled grip-force integral'
      : 'relative-velocity/reduced-mass contact estimate, confounded by simultaneous contacts/controls, plus separate modeled grip-force integral' }))
    .sort((a, b) => a.firstContactTimeSeconds - b.firstContactTimeSeconds || a.playerId.localeCompare(b.playerId));
  const contactOpportunities = [...contactOpportunityByPair.values()].map((row) => ({ ...row,
    opportunityDurationSeconds: row.sampledOpportunitySteps * dt,
    firstPhysicalContactTimeSeconds: firstContactByPair.get(row.pairId)?.firstTimeSeconds ?? null,
    physicalContactCount: firstContactByPair.get(row.pairId)?.count ?? 0,
  })).sort((a, b) => a.firstOpportunityTimeSeconds - b.firstOpportunityTimeSeconds || a.pairId.localeCompare(b.pairId));
  const result = {
    schemaVersion: 1, scenarioId: scenario.id, scenarioTitle: scenario.title, category: scenario.category,
    seed: scenario.seed, engine, playerGeometry, physicsParameters: { timestepSeconds: dt,
      solverIterations: engine === 'rapier3d-compat' ? solverIterations : 'package default; not exposed by tested JS wrapper',
      joltCollisionSteps: engine === 'jolt-physics-js' ? joltCollisionSteps : 'not applicable', playerScale,
      rapierContactSkinM: engine === 'rapier3d-compat' ? rapierContactSkinM : 'unsupported by tested Jolt JS shape API',
      materialOverrides, balanceControllerEnabled, balanceTorqueScale, playerMassScale, playerTeamMassScales, playerDriveScale,
      gripStrengthScale, gripStiffnessScale, ballControlEnabled }, playerGeometryDescription: playerGeometry === 'single-capsule'
      ? 'single dynamic capsule; not an articulated player' : 'five fixed shapes on one rigid body; not an articulated player',
    timestepSeconds: dt, recordedFrameStrideTicks: frameStride, gravityMps2: GRAVITY_VECTOR, durationSeconds: steps * dt, stepsCompleted,
    ratingsSnapshot: scenario.ratingsSnapshot ?? 'none; masses and controls are explicit fixture inputs',
    outcome: {
      physicalContributors: [...physicalContributors.entries()].filter(([key]) => players.has(key)).map(([playerId, data]) => ({ playerId, ...data })),
      defenderContributionLedger: contributionRows,
      playerTerminalStates: playerResults.map((row) => ({ id: row.id, maxTiltDeg: row.maxTiltDeg,
        fellAtSeconds: row.fellAtSeconds, recoveredAtSeconds: row.recoveredAtSeconds,
        finalPositionM: row.final.positionM, finalCenterOfMassM: row.final.centerOfMassM,
        finalLinearVelocityMps: row.final.linearVelocityMps })),
      wrapResults: gripResults, activeWrapHoldersAtEnd: activeAtEnd,
      sack: scenario.sackTargetId ? { target: scenario.sackTargetId, completedAtSeconds: sackCompletedAt,
        contributors: [...physicalContributors.entries()].filter(([key]) => players.has(key) && key !== scenario.sackTargetId)
          .map(([playerId, data]) => ({ playerId, firstContactTimeSeconds: data.firstTimeSeconds })),
        officialHalfSackCredit: 'not assigned by physics; evaluate separately in game-state/scoring rules' } : null,
      football: ball ? { status: ballStatus, controlledBy: ballAttached ? ballAttachedToId : null,
        releaseAtSeconds: ballReleaseAt, releaseReason: ballReleaseReason, finalPositionM: currentBall.positionM, maxPossessedBallX,
        possessionControllers: [...possessionByPlayer.keys()], possessionGrips: possessionResults,
        physicallySecureRecovery: events.some((event) => event.type === 'secure_ball_recovery'),
        recovery: events.some((event) => event.type === 'secure_ball_recovery') ? 'secure recovery supported by sustained two-point control'
          : behaviorVersion === 'm4c' && possessionByPlayer.size > 0 ? 'held by active two-point rigid-body cradle'
          : ballAttached ? 'still attached by explicit carry-cradle proxy'
          : ballReleaseReason === 'throw' || ballReleaseReason === 'snap' ? 'unresolved; no catch/receiver possession controller'
            : 'unresolved; physical contact is not secure possession' } : null,
      fixtureAssertions: { contactOpportunityPairs: contactOpportunities.map((row) => row.pairId),
        physicalContactPairs: contactList.map((row) => row.pairId),
        establishedTackleGrips: gripResults.filter((row) => row.maximumRequestedLoadN > 0).map((row) => row.holderId),
        playersFallen: playerResults.filter((row) => row.fellAtSeconds !== null).map((row) => row.id),
        completedSack: sackCompletedAt !== null, ballReleaseReason: ballReleaseReason,
        ballControlCandidates: events.filter((event) => event.type === 'ball_control_candidate').map((event) => event.player),
        secureRecoveryPlayers: events.filter((event) => event.type === 'secure_ball_recovery').map((event) => event.player),
        sustainedControlPlayers: possessionResults.filter((row) => row.controlEstablished && row.active).map((row) => row.playerId) },
      rawProgress: { carrierId, maximumCarrierOriginXM: maxCarrierX, maximumPossessedFootballXM: maxPossessedBallX,
        finalCarrierPositionXM: players.get(carrierId) ? world.state(players.get(carrierId)).positionM[0] : null,
        finalFootballPositionXM: currentBall?.positionM[0] ?? null,
        interpretation: 'raw carrier and football trajectories; no first-down, touchdown, down, or official spot is assigned' },
    },
    contacts: contactList,
    contactOpportunities: { analyticGapThresholdM: CONTACT_OPPORTUNITY_GAP_M,
      measurement: 'minimum surface separation of transformed player capsule/sphere proxies; an opportunity is not solver contact', rows: contactOpportunities },
    events,
    diagnostics: { finite: finiteTree({ playerResults, events, sampledFrames }) .length === 0,
      nonFinitePaths: finiteTree({ playerResults, events, sampledFrames }), maximumPenetrationDepthM: maxPenetrationM,
      solverInstability: 'No universal instability threshold is asserted. Finite-value, contact penetration, and repeatability diagnostics are recorded separately.',
      solverImpulseAvailability: engine === 'rapier3d-compat' ? 'Rapier solver manifold normal impulses' : 'Jolt exposes manifold points and penetration here; solver impulses are unavailable through the tested JS wrapper',
      energyInterpretation: 'Kinetic and gravitational potential energies are sampled. Applied controller forces are serialized; friction, contacts, gravity, and force work are not collapsed into a false conservation claim.',
      momentumInterpretation: 'System linear and angular momentum are sampled at replay frames. Gravity, ground reactions, controller forces, and configured scenario impulses are external inputs; momentum is not asserted to be conserved across them.',
      memoryHeapBeforeBytes: heapBeforeBytes, memoryHeapAfterBytes: process.memoryUsage().heapUsed,
      playerCount: players.size, maxObservedPlayerCount, framesRecorded: sampledFrames.length,
      activeWrapHoldersAtEnd: activeAtEnd, physicalLooseBallTouchCount: recoveryTouchEvents },
    penetration: { measurement: 'per-physics-step maximum across active player, football, and ground contact-pair snapshots; no-contact steps are zero',
      initialPlayerGeometryEstimateM: initialPlayerPenetrationM, firstStepMaximumM: penetrationSamples[0]?.maximumPenetrationM ?? 0,
      maximumDepthM: maxPenetrationM, p50PerStepMaximumM: percentile(perStepPenetration, 0.50),
      p95PerStepMaximumM: percentile(perStepPenetration, 0.95), durationWeightedMeanM: durationWeightedMeanPenetrationM,
      maximumAfterFirstStepM: Math.max(0, ...perStepPenetration.slice(1)), contactPairSamples: contactPenetrationValues.length,
      thresholdCounts: penetrationThresholds, samples: penetrationSamples },
    runtime: { wallTimeMs: performance.now() - startedAt, processRssBytes: process.memoryUsage().rss },
    frames: sampledFrames,
  };
  world.destroy();
  return result;
}

function startContactRecord(firstTimeSeconds, contact) {
  return { firstTimeSeconds, source: 'simulator body-contact state', firstContactPointsM: contact.pointsM ?? [],
    firstSolverImpulseNs: contact.normalImpulseNs ?? null, impulseSource: contact.impulseSource };
}

export function compactResult(result, { keepFrames = false } = {}) {
  const { frames, ...rest } = result;
  return keepFrames ? result : rest;
}

export function compareSignatures(a, b) {
  const signature = (result) => JSON.stringify({
    scenarioId: result.scenarioId, seed: result.seed, engine: result.engine, playerGeometry: result.playerGeometry,
    contacts: result.contacts, events: result.events, outcome: result.outcome,
    contactOpportunities: result.contactOpportunities, penetration: result.penetration,
    sampledTransforms: result.frames.filter((frame) => frame.tick % 30 === 0 || frame.tick === result.stepsCompleted)
      .map((frame) => ({ tick: frame.tick, players: frame.players, football: frame.football })),
  });
  return signature(a) === signature(b);
}

export { DT as FIXED_TIMESTEP_SECONDS, MATERIALS as PHYSICS_MATERIALS };
