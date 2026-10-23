import {
  add, createPhysics, cross, dot, length, normalize, qConjugate, qRotate, scale, sub, tiltDeg,
  FIXED_TIMESTEP_SECONDS as DT, GRAVITY_MPS2 as GRAVITY,
} from './physics.mjs';

export const ENGINE_IDS = Object.freeze(['rapier3d-compat', 'jolt-physics-js']);
export const BALANCE = Object.freeze({ kp: 1050, kd: 220, comNmPerM: 2600, maxTorqueNm: 2400 });
export const GRAVITY_VECTOR = Object.freeze([0, -GRAVITY, 0]);
const MATERIALS = Object.freeze({ groundFriction: 0.82, groundRestitution: 0.04, playerFriction: 0.72, playerRestitution: 0.04,
  linearDamping: 0.025, angularDamping: 0.06 });

const capVector = (v, limit) => length(v) > limit ? scale(v, limit / length(v)) : v;
const ticks = (seconds) => Math.ceil(seconds / DT);
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

export async function runScenario(engine, scenario, { playerGeometry = 'compound', recordFrames = true, recordStride = 1 } = {}) {
  const startedAt = performance.now();
  const heapBeforeBytes = process.memoryUsage().heapUsed;
  const materials = { ...MATERIALS, ...(scenario.groundMaterial?.friction !== undefined ? { groundFriction: scenario.groundMaterial.friction } : {}) };
  const world = await createPhysics(engine, { ...materials, material: materials, ground: true, gravity: -GRAVITY,
    solverIterations: 8, timestep: DT, playerGeometry });
  const players = new Map();
  for (const spec of scenario.players) players.set(spec.id, await world.addPlayer(spec, spec.id));
  const carrierId = scenario.carrierId ?? (players.has('carrier') ? 'carrier' : scenario.sackTargetId ?? 'quarterback');
  const carrier = players.get(carrierId);
  if (!carrier) throw new Error(`${scenario.id}: carrierId ${carrierId} does not name a player`);
  const ballSpec = scenario.carriedBall;
  const ballOwnerId = scenario.ballOriginId ?? carrierId;
  let ballAttachedToId = ballOwnerId;
  let ball = null, ballAttached = Boolean(ballSpec), ballStatus = ballSpec ? 'carried_by_model_constraint' : 'not_present';
  if (ballSpec) {
    const ballOwner = players.get(ballOwnerId);
    if (!ballOwner) throw new Error(`${scenario.id}: ballOriginId ${ballOwnerId} does not name a player`);
    const ownerState = world.state(ballOwner);
    const ballPosition = worldAnchor(ownerState, ballSpec.localOffsetM);
    ball = world.addBallisticBody({ p: ballPosition, v: ownerState.linearVelocityMps, angular: ownerState.angularVelocityRadPerSec,
      yawRad: 0, mass: ballSpec.mass, shape: ballSpec.shape, halfExtents: ballSpec.halfExtents, label: 'football',
      material: { friction: 0.58, restitution: 0.32, linearDamping: 0.015, angularDamping: 0.02 } });
  }

  const events = [{ type: 'scenario_started', timeSeconds: 0, scenarioId: scenario.id, seed: scenario.seed,
    proxyModel: playerGeometry === 'single-capsule' ? 'one rigid vertical capsule' : 'five-part rigid compound; parts are not articulated' }];
  const firstContactByPair = new Map();
  const activeContactPairs = new Set();
  const gripByHolder = new Map();
  const gripMaxima = new Map();
  const fallState = new Map([...players.keys()].map((id) => [id, { fellAtSeconds: null, recoveredAtSeconds: null, maxTiltDeg: 0 }]));
  const physicalContributors = new Map();
  const sampledFrames = [];
  let maxPenetrationM = 0;
  let maxObservedPlayerCount = players.size;
  let ballReleaseAt = null, ballReleaseReason = null;
  let sackCompletedAt = null;
  let lastBallPosition = ball ? world.state(ball).positionM : null;
  let maxCarrierX = carrier ? world.state(carrier).positionM[0] : 0;
  let maxPossessedBallX = ball ? world.state(ball).positionM[0] : null;
  let recoveryTouchEvents = 0;
  let stepsCompleted = 0;
  const steps = ticks(scenario.durationSeconds);
  const frameStride = Math.max(1, Math.floor(recordStride));

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
    const holderSpec = scenario.players.find((row) => row.id === holderId);
    if (!holderSpec?.wrap || gripByHolder.has(holderId)) return;
    const runnerState = world.state(carrier), holderState = world.state(players.get(holderId));
    const contactPoint = contact.pointsM?.[0] ?? [
      (runnerState.positionM[0] + holderState.positionM[0]) / 2,
      (runnerState.positionM[1] + holderState.positionM[1]) / 2 + 0.12,
      (runnerState.positionM[2] + holderState.positionM[2]) / 2,
    ];
    const config = holderSpec.wrap;
    const grip = { holderId, runnerAnchorLocalM: localAnchor(runnerState, contactPoint), holderAnchorLocalM: localAnchor(holderState, contactPoint),
      capacityN: config.capacityN, springNPerM: config.springNPerM ?? 4200, damperNsPerM: config.damperNsPerM ?? 440,
      extensionLimitM: config.extensionLimitM ?? 0.72, releaseOverloadTicks: config.releaseOverloadTicks ?? 2,
      overloadTicks: 0, maximumRequestedLoadN: 0, maximumAppliedLoadN: 0, active: true };
    gripByHolder.set(holderId, grip); gripMaxima.set(holderId, grip);
    events.push({ type: 'wrap_proxy_established', timeSeconds: stepsCompleted * DT, players: [carrierId, holderId],
      contactPointM: contactPoint, contactPointSource: contact.pointsM?.length ? 'solver contact manifold' : 'body-center midpoint estimate',
      model: 'torso-anchor spring-damper with equal-and-opposite forces; no articulated arm or hand grasp', capacityN: grip.capacityN });
  };
  const releaseBall = (timeSeconds, reason, impulseNs = null) => {
    if (!ball || !ballAttached) return;
    const releasingFrom = players.get(ballAttachedToId);
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

  const recordFrame = (tick, contacts, ballContacts, groundContacts, appliedForces, appliedTorques, constraints) => {
    if (!recordFrames || (tick !== 0 && tick !== steps && tick % frameStride !== 0)) return;
    const states = snapshotStates();
    const playerRows = Object.fromEntries([...states].map(([id, state]) => [id, {
      positionM: state.positionM, centerOfMassM: state.centerOfMassM, linearVelocityMps: state.linearVelocityMps,
      angularVelocityRadPerSec: state.angularVelocityRadPerSec, rotation: state.rotation, tiltDeg: tiltDeg(state.rotation),
      grounded: world.grounded(players.get(id)),
    }]));
    const ballState = ball ? world.state(ball) : null;
    const currentCarrier = states.get(carrierId);
    const energy = [...states].map(([id, state]) => ({ id, ...energyOf(state, world.energyProps(players.get(id))) }));
    if (ballState) energy.push({ id: 'football', ...energyOf(ballState, world.energyProps(ball)) });
    sampledFrames.push(round({ tick, timeSeconds: tick * DT, players: playerRows,
      football: ballState ? { positionM: ballState.positionM, centerOfMassM: ballState.centerOfMassM,
        linearVelocityMps: ballState.linearVelocityMps, angularVelocityRadPerSec: ballState.angularVelocityRadPerSec,
        rotation: ballState.rotation, status: ballStatus, controlledBy: ballAttached ? ballAttachedToId : null } : null,
      contacts, ballContacts, groundContacts, forcesNByPlayer: appliedForces, torquesNmByPlayer: appliedTorques,
      grips: constraints, diagnostics: { mechanicalEnergyByBodyJ: energy, totalMechanicalEnergyJ: energy.reduce((sum, row) => sum + row.totalMechanicalJ, 0) },
      rawProgress: { carrierPositionXM: currentCarrier.positionM[0], footballPositionXM: ballState?.positionM[0] ?? null,
        possessionControlled: ballAttached } }));
  };

  recordFrame(0, [], [], [], {}, {}, []);
  for (let tick = 0; tick < steps; tick++) {
    const timeSeconds = tick * DT;
    const appliedForces = {}, appliedTorques = {};
    const preStates = snapshotStates();
    const preBallState = ball ? world.state(ball) : null;
    const carrierState = preStates.get(carrierId);

    if (scenario.snapAtSeconds !== undefined && ballAttached && timeSeconds >= scenario.snapAtSeconds) releaseBall(timeSeconds, 'snap');
    if (scenario.throwAtSeconds !== undefined && ballAttached && timeSeconds >= scenario.throwAtSeconds && sackCompletedAt === null) {
      releaseBall(timeSeconds, 'throw');
    }
    if (scenario.fumbleOnFirstContact && ballAttached && tick > 0) {
      const opponentAlreadyTouching = scenario.players.some((spec) => spec.team !== scenario.players.find((row) => row.id === carrierId)?.team
        && world.touching(carrier, players.get(spec.id)));
      if (opponentAlreadyTouching) releaseBall(timeSeconds, 'fumble', scenario.fumbleImpulseNs ?? null);
    }

    for (const [id, body] of players) {
      const spec = scenario.players.find((row) => row.id === id);
      const state = preStates.get(id);
      const torque = forceControllerTorque(state, spec.strength ?? 80, spec.balanceScale ?? 0.8, world.grounded(body));
      if (length(torque) > 0.01) pushTorque(body, id, torque, appliedTorques);
      const drive = spec.drive;
      if (drive && timeSeconds >= (drive.startSeconds ?? 0) && timeSeconds < (drive.endSeconds ?? scenario.durationSeconds)) {
        const point = drive.applicationLocalM ? worldAnchor(state, drive.applicationLocalM) : null;
        pushForce(body, id, drive.forceN, point, 'configured player drive force', appliedForces);
      }
    }

    for (const grip of gripByHolder.values()) {
      if (!grip.active) continue;
      const runnerState = preStates.get(carrierId), holderState = preStates.get(grip.holderId);
      const load = gripLoad(grip, runnerState, holderState);
      grip.maximumRequestedLoadN = Math.max(grip.maximumRequestedLoadN, load.requestedLoadN);
      grip.overloadTicks = load.requestedLoadN > grip.capacityN || load.separationM > grip.extensionLimitM ? grip.overloadTicks + 1 : 0;
      if (grip.overloadTicks >= grip.releaseOverloadTicks) {
        grip.active = false;
        events.push({ type: 'wrap_proxy_released', timeSeconds, players: [carrierId, grip.holderId], requestedLoadN: load.requestedLoadN,
          capacityN: grip.capacityN, separationM: load.separationM, reason: load.separationM > grip.extensionLimitM ? 'extension_limit' : 'configured_load_limit' });
        continue;
      }
      const force = capVector(load.requestedForceN, grip.capacityN);
      grip.maximumAppliedLoadN = Math.max(grip.maximumAppliedLoadN, length(force));
      pushForce(carrier, carrierId, force, load.runnerPoint, `wrap proxy against ${grip.holderId}`, appliedForces);
      pushForce(players.get(grip.holderId), grip.holderId, scale(force, -1), load.holderPoint, `wrap proxy against ${carrierId}`, appliedForces);
    }

    if (ball && ballAttached) {
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
    const now = new Set();
    const playerSpecs = scenario.players;
    for (let i = 0; i < playerSpecs.length; i++) for (let j = i + 1; j < playerSpecs.length; j++) {
      const aSpec = playerSpecs[i], bSpec = playerSpecs[j];
      const a = players.get(aSpec.id), b = players.get(bSpec.id);
      const contact = contactSnapshot(a, b);
      if (!contact.touching) continue;
      const pairId = [aSpec.id, bSpec.id].sort().join('::'); now.add(pairId);
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
        penetrationSource: contact.penetrationSource, contactForceEstimateN: impulseUsed / DT };
      frameContacts.push(contactRow);
      if (contact.maximumPenetrationDepthM !== null) maxPenetrationM = Math.max(maxPenetrationM, contact.maximumPenetrationDepthM);
      if (!activeContactPairs.has(pairId)) {
        const startTime = (tick + 1) * DT;
        const contactNumber = (firstContactByPair.get(pairId)?.count ?? 0) + 1;
        firstContactByPair.set(pairId, { firstTimeSeconds: firstContactByPair.get(pairId)?.firstTimeSeconds ?? startTime, count: contactNumber });
        events.push({ type: 'player_contact_started', timeSeconds: startTime, pair: [aSpec.id, bSpec.id], contactNumber,
          pointsM: contact.pointsM ?? [], penetrationM: contact.maximumPenetrationDepthM, normalImpulseNs: contact.normalImpulseNs,
          estimatedNormalImpulseNs: hasSolverImpulse ? null : estimatedImpulse, impulseSource, forceEstimateN: impulseUsed / DT });
      }
      const carrierContact = (aSpec.id === carrierId && bSpec.team !== aSpec.team) || (bSpec.id === carrierId && aSpec.team !== bSpec.team);
      if (carrierContact) {
        const other = aSpec.id === carrierId ? bSpec : aSpec;
        physicalContributors.set(other.id, physicalContributors.get(other.id) ?? startContactRecord(firstContactByPair.get(pairId).firstTimeSeconds, contact));
        createGrip(other.id, contact);
      }
      if (ball && !ballAttached && (aSpec.id === carrierId || bSpec.id === carrierId) && (aSpec.team !== bSpec.team)) {
        // Ball status is independent from a player-body collision; recovery remains unresolved without a hand-control model.
      }
    }
    activeContactPairs.clear(); for (const pair of now) activeContactPairs.add(pair);

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
        }
      }
    }
    if (ball && world.touching(ball, world.groundEntity)) {
      const groundSnapshot = contactSnapshot(ball, world.groundEntity);
      groundContacts.push({ body: 'football', pointsM: groundSnapshot.pointsM ?? [], normalWorld: groundSnapshot.normalWorld ?? null,
        maximumPenetrationDepthM: groundSnapshot.maximumPenetrationDepthM,
        normalImpulseNs: groundSnapshot.normalImpulseNs, impulseSource: groundSnapshot.impulseSource });
    }

    if (ball) {
      const ballState = world.state(ball);
      lastBallPosition = ballState.positionM;
      if (ballAttached) maxPossessedBallX = Math.max(maxPossessedBallX ?? -Infinity, ballState.positionM[0]);
      for (const [id, body] of players) {
        if (ballAttached && id === ballAttachedToId) continue;
        const contact = contactSnapshot(ball, body);
        if (!contact.touching) continue;
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
          contactForceEstimateN: impulseUsed / DT };
        frameBallContacts.push(row);
        if (contact.maximumPenetrationDepthM !== null) maxPenetrationM = Math.max(maxPenetrationM, contact.maximumPenetrationDepthM);
        const eventKey = `football::${id}`;
        if (!physicalContributors.has(eventKey)) {
          const targetContact = ballReleaseReason === 'snap' && id === scenario.snapTargetId;
          physicalContributors.set(eventKey, { firstTimeSeconds: (tick + 1) * DT,
            source: ballAttached ? 'carried football body contact' : 'released-ball body contact; not possession' });
          events.push({ type: ballAttached ? 'carried_ball_body_contact' : targetContact ? 'snap_arrival_body_contact'
            : 'released_ball_player_contact', timeSeconds: (tick + 1) * DT,
            player: id, pointsM: contact.pointsM ?? [], normalImpulseNs: contact.normalImpulseNs, estimatedNormalImpulseNs: row.estimatedNormalImpulseNs,
            interpretation: ballAttached ? 'football rigid-body contact; does not establish tackle attribution'
              : targetContact ? 'snap reached target body; controlled catch remains unresolved without hand mechanics'
                : 'physical touch recorded; secure recovery unresolved without articulated hands/control' });
          if (!ballAttached && ballReleaseReason === 'snap' && id === scenario.snapTargetId) events.push({
            type: 'snap_reception_unresolved', timeSeconds: (tick + 1) * DT,
            reason: 'Ball body contact with quarterback is not secure possession; no catch controller is present.',
          });
          if (!ballAttached && ballReleaseReason === 'fumble') recoveryTouchEvents++;
        }
      }
      if (recoveryTouchEvents > 0 && !events.some((event) => event.type === 'recovery_unresolved')) events.push({ type: 'recovery_unresolved',
        timeSeconds: (tick + 1) * DT, reason: 'Rigid-body body contact cannot establish secure hand possession; no nearest-player or random winner assigned.' });
    }

    for (const [id, state] of postStates) {
      const row = fallState.get(id);
      const tilt = tiltDeg(state.rotation); row.maxTiltDeg = Math.max(row.maxTiltDeg, tilt);
      const grounded = world.grounded(players.get(id));
      if (tilt >= 58 && row.fellAtSeconds === null) {
        row.fellAtSeconds = (tick + 1) * DT;
        events.push({ type: 'player_fall_started', timeSeconds: row.fellAtSeconds, player: id, tiltDeg: tilt });
        if (id === scenario.sackTargetId) {
          sackCompletedAt = row.fellAtSeconds;
          const contributors = [...physicalContributors.entries()].filter(([key]) => key !== id && players.has(key))
            .map(([playerId, data]) => ({ playerId, firstContactTimeSeconds: data.firstTimeSeconds }));
          events.push({ type: 'physical_sack_takedown', timeSeconds: sackCompletedAt, quarterback: id, physicalContributors: contributors,
            officialScoring: 'not assigned; rules/scoring attribution is a separate interpretation' });
        }
      }
      if (row.fellAtSeconds !== null && row.recoveredAtSeconds === null && grounded && tilt < 30) {
        row.recoveredAtSeconds = (tick + 1) * DT;
        events.push({ type: 'player_recovered_upright', timeSeconds: row.recoveredAtSeconds, player: id, tiltDeg: tilt });
      }
      maxCarrierX = Math.max(maxCarrierX, state.positionM[0]);
    }

    const framesGrips = gripRows().map((row) => {
      const grip = gripByHolder.get(row.holderId);
      return { ...row, maximumRequestedLoadN: grip.maximumRequestedLoadN, maximumAppliedLoadN: grip.maximumAppliedLoadN,
        loadSource: 'explicit spring-damper force law; not solver constraint force' };
    });
    recordFrame(tick + 1, frameContacts, frameBallContacts, groundContacts, appliedForces, appliedTorques, framesGrips);
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
  if (ball && !ballAttached) ballStatus = ballReleaseReason === 'throw' ? 'pass_in_flight_reception_unresolved'
    : ballReleaseReason === 'snap' ? 'snap_reception_unresolved' : 'loose_live_recovery_unresolved';
  const contactList = [...firstContactByPair.entries()].map(([pairId, data]) => ({ pairId, ...data }));
  const result = {
    schemaVersion: 1, scenarioId: scenario.id, scenarioTitle: scenario.title, category: scenario.category,
    seed: scenario.seed, engine, playerGeometry, playerGeometryDescription: playerGeometry === 'single-capsule'
      ? 'single dynamic capsule; not an articulated player' : 'five fixed shapes on one rigid body; not an articulated player',
    timestepSeconds: DT, recordedFrameStrideTicks: frameStride, gravityMps2: GRAVITY_VECTOR, durationSeconds: steps * DT, stepsCompleted,
    ratingsSnapshot: scenario.ratingsSnapshot ?? 'none; masses and controls are explicit fixture inputs',
    outcome: {
      physicalContributors: [...physicalContributors.entries()].filter(([key]) => players.has(key)).map(([playerId, data]) => ({ playerId, ...data })),
      wrapResults: gripResults, activeWrapHoldersAtEnd: activeAtEnd,
      sack: scenario.sackTargetId ? { target: scenario.sackTargetId, completedAtSeconds: sackCompletedAt,
        contributors: [...physicalContributors.entries()].filter(([key]) => players.has(key) && key !== scenario.sackTargetId)
          .map(([playerId, data]) => ({ playerId, firstContactTimeSeconds: data.firstTimeSeconds })),
        officialHalfSackCredit: 'not assigned by physics; evaluate separately in game-state/scoring rules' } : null,
      football: ball ? { status: ballStatus, controlledBy: ballAttached ? ballAttachedToId : null,
        releaseAtSeconds: ballReleaseAt, releaseReason: ballReleaseReason, finalPositionM: currentBall.positionM, maxPossessedBallX,
        recovery: ballAttached ? 'still attached by explicit carry-cradle proxy'
          : ballReleaseReason === 'throw' || ballReleaseReason === 'snap' ? 'unresolved; no catch/receiver possession controller'
            : 'unresolved; physical contact is not secure possession' } : null,
      rawProgress: { carrierId, maximumCarrierOriginXM: maxCarrierX, maximumPossessedFootballXM: maxPossessedBallX,
        finalCarrierPositionXM: players.get(carrierId) ? world.state(players.get(carrierId)).positionM[0] : null,
        finalFootballPositionXM: currentBall?.positionM[0] ?? null,
        interpretation: 'raw carrier and football trajectories; no first-down, touchdown, down, or official spot is assigned' },
    },
    contacts: contactList, events,
    diagnostics: { finite: finiteTree({ playerResults, events, sampledFrames }) .length === 0,
      nonFinitePaths: finiteTree({ playerResults, events, sampledFrames }), maximumPenetrationDepthM: maxPenetrationM,
      solverInstability: 'No universal instability threshold is asserted. Finite-value, contact penetration, and repeatability diagnostics are recorded separately.',
      solverImpulseAvailability: engine === 'rapier3d-compat' ? 'Rapier solver manifold normal impulses' : 'Jolt exposes manifold points and penetration here; solver impulses are unavailable through the tested JS wrapper',
      energyInterpretation: 'Kinetic and gravitational potential energies are sampled. Applied controller forces are serialized; friction, contacts, gravity, and force work are not collapsed into a false conservation claim.',
      memoryHeapBeforeBytes: heapBeforeBytes, memoryHeapAfterBytes: process.memoryUsage().heapUsed,
      playerCount: players.size, maxObservedPlayerCount, framesRecorded: sampledFrames.length,
      activeWrapHoldersAtEnd: activeAtEnd, physicalLooseBallTouchCount: recoveryTouchEvents },
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
    sampledTransforms: result.frames.filter((frame) => frame.tick % 30 === 0 || frame.tick === result.stepsCompleted)
      .map((frame) => ({ tick: frame.tick, players: frame.players, football: frame.football })),
  });
  return signature(a) === signature(b);
}

export { DT as FIXED_TIMESTEP_SECONDS, MATERIALS as PHYSICS_MATERIALS };
