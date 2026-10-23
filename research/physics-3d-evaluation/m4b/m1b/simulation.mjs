import { createPhysics, FIXED_TIMESTEP_SECONDS as DT, GRAVITY_MPS2 as G, add, sub, scale, dot, cross, length, normalize, qRotate, qConjugate, tiltDeg } from '../physics.mjs';

export const ENGINE_IDS = ['rapier3d-compat', 'jolt-physics-js'];
export const BALANCE_GAINS = Object.freeze({ proportionalNmPerRad: 1050, derivativeNmsPerRad: 220, maxTorqueNm: 2400 });
export const GRIP_MODEL = Object.freeze({ springNPerM: 1800, damperNsPerM: 210, releaseOverloadSteps: 2, extensionLimitM: 0.58 });

export const DEMOS = [
  {
    id: 'successful-tackle', kind: 'tackle', durationSeconds: 2.6, gripCapacityN: 5000, tackleDriveSeconds: 1.5,
    gripParameters: { springNPerM: 6000, damperNsPerM: 700 },
    carrier: { p: [0, 0.845, 0], v: [7.0, 0, 0], mass: 86, strength: 70, driveForceN: 100, balanceScale: 0.18 },
    defender: { p: [1.7, 0.845, 0], v: [-5.0, 0, 0], mass: 120, strength: 95, driveForceN: 2200, yawRad: Math.PI, balanceScale: 0.75 },
    policy: { wrapEnabled: true, wrapMinHeightM: 0.35, wrapMaxHeightM: 1.38, gripAnchorHeightOffsetM: 0.42 },
  },
  {
    id: 'broken-tackle', kind: 'tackle', durationSeconds: 2.7, gripCapacityN: 90, tackleDriveSeconds: 1.3,
    gripParameters: { springNPerM: 3000, damperNsPerM: 300 },
    carrier: { p: [0, 0.845, 0], v: [3.0, 0, 0], mass: 108, strength: 94, driveForceN: 1800, balanceScale: 2.5 },
    defender: { p: [1.15, 0.845, 0], v: [-0.5, 0, 0], mass: 88, strength: 74, driveForceN: 0, yawRad: Math.PI, balanceScale: 0.78 },
    policy: { wrapEnabled: true, wrapMinHeightM: 0.35, wrapMaxHeightM: 1.38, gripAnchorHeightOffsetM: 0.16 },
  },
  {
    id: 'missed-tackle', kind: 'tackle', durationSeconds: 2.4, gripCapacityN: 1500,
    carrier: { p: [0, 0.845, 0], v: [4.0, 0, 0], mass: 96, strength: 80, driveForceN: 320, driveFromStart: true, balanceScale: 1 },
    defender: { p: [1.5, 0.845, 1.62], v: [-1.5, 0, 0], mass: 102, strength: 86, driveForceN: 0, yawRad: Math.PI, balanceScale: 1 },
    policy: { wrapEnabled: true, wrapMinHeightM: 0.35, wrapMaxHeightM: 1.38, gripAnchorHeightOffsetM: 0.05 },
  },
  {
    id: 'stumble-recovery', kind: 'balance', durationSeconds: 2.5,
    player: { p: [0, 0.845, 0], v: [1.2, 0, 0], mass: 96, strength: 84, balanceScale: 1 },
    disturbance: { startSeconds: 0.32, durationSeconds: 0.075, forceN: [0, 0, 2450], localPointM: [0, 0.56, 0] },
  },
];

const tackleBase = DEMOS[0];
export const TACKLE_VARIANTS = [
  { ...tackleBase, id: 'angle-glancing-30deg', carrier: { ...tackleBase.carrier, p: [0, 0.845, 0], v: [6.06, 0, 3.5] },
    defender: { ...tackleBase.defender, p: [1.55, 0.845, 0.35], v: [-4.33, 0, -2.5] } },
  { ...tackleBase, id: 'closing-speed-low', carrier: { ...tackleBase.carrier, v: [3.5, 0, 0] }, defender: { ...tackleBase.defender, v: [-2.0, 0, 0] } },
  { ...tackleBase, id: 'closing-speed-high', carrier: { ...tackleBase.carrier, v: [9.0, 0, 0] }, defender: { ...tackleBase.defender, v: [-6.0, 0, 0] } },
  { ...tackleBase, id: 'carrier-mass-light', carrier: { ...tackleBase.carrier, mass: 74 } },
  { ...tackleBase, id: 'carrier-mass-heavy', carrier: { ...tackleBase.carrier, mass: 122 } },
  { ...tackleBase, id: 'relative-strength-disadvantage', gripCapacityN: 1100,
    carrier: { ...tackleBase.carrier, strength: 61, balanceScale: 0.58 }, defender: { ...tackleBase.defender, strength: 96, driveForceN: 1700 } },
  { ...tackleBase, id: 'low-contact-height', policy: { ...tackleBase.policy, gripAnchorHeightOffsetM: 0.04 } },
  { ...tackleBase, id: 'weak-grip-capacity', gripCapacityN: 90, carrier: { ...tackleBase.carrier, driveForceN: 1600, balanceScale: 1.4 } },
  { ...tackleBase, id: 'strong-runner-balance-and-drive', carrier: { ...tackleBase.carrier, strength: 96, balanceScale: 1.7, driveForceN: 1100 } },
];

export const BALANCE_CASES = [
  { id: 'upright-standing', durationSeconds: 2.0, player: { p: [0, 0.845, 0], v: [0, 0, 0], mass: 96, strength: 84 } },
  { id: 'small-disturbance-recovery', durationSeconds: 2.4, player: { p: [0, 0.845, 0], v: [0, 0, 0], mass: 96, strength: 84 }, disturbance: { startSeconds: 0.3, durationSeconds: 0.07, forceN: [0, 0, 1750], localPointM: [0, 0.55, 0] } },
  { id: 'large-disturbance-fall', durationSeconds: 2.4, player: { p: [0, 0.845, 0], v: [0, 0, 0], mass: 96, strength: 74, balanceScale: 0.18 }, disturbance: { startSeconds: 0.3, durationSeconds: 0.12, forceN: [0, 0, 6500], localPointM: [0, 0.6, 0] } },
  { id: 'glancing-contact-recovery', durationSeconds: 2.2, players: [
    { label: 'carrier', p: [0, 0.845, 0], v: [3.0, 0, 0], mass: 96, strength: 84, balanceScale: 1.15 },
    { label: 'defender', p: [1.14, 0.845, 0.65], v: [-0.35, 0, -2.25], mass: 100, strength: 86, yawRad: Math.PI / 2, balanceScale: 0.9 },
  ] },
  { id: 'asymmetric-fall-and-stand', durationSeconds: 2.2, players: [
    { label: 'carrier', p: [0, 0.845, 0], v: [4.6, 0, 0], mass: 92, strength: 76, balanceScale: 0.35 },
    { label: 'defender', p: [1.55, 0.845, 0], v: [-2.6, 0, 0], mass: 118, strength: 94, yawRad: Math.PI, balanceScale: 1.7 },
  ], contactForce: { forceOnCarrierN: [-2600, 0, 0], durationSeconds: 0.18, heightOffsetM: 0.45 } },
  { id: 'two-player-push', durationSeconds: 2.4, players: [
    { label: 'carrier', p: [-0.72, 0.845, 0], v: [0, 0, 0], mass: 104, strength: 91, yawRad: 0, pushForceN: 900 },
    { label: 'defender', p: [0.72, 0.845, 0], v: [0, 0, 0], mass: 110, strength: 93, yawRad: Math.PI, pushForceN: 860 },
  ], pushSeconds: 0.75 },
];

const ticks = (seconds) => Math.ceil(seconds / DT);
const capVector = (v, limit) => length(v) > limit ? scale(v, limit / length(v)) : v;

function worldAnchor(state, local) {
  return add(state.positionM, qRotate(local, state.rotation));
}
function pointVelocity(state, point) {
  return add(state.linearVelocityMps, cross(state.angularVelocityRadPerSec, sub(point, state.centerOfMassM)));
}
function localAnchor(state, worldPoint) {
  return qRotate(sub(worldPoint, state.positionM), qConjugate(state.rotation));
}
function balanceTorque(state, strength, balanceScale, grounded) {
  if (!grounded) return [0, 0, 0];
  const up = qRotate([0, 1, 0], state.rotation);
  const errorAxis = cross(up, [0, 1, 0]);
  const comOffset = sub(state.centerOfMassM, state.positionM);
  const angular = state.angularVelocityRadPerSec;
  const scaleByStrength = (0.55 + strength / 120) * (balanceScale ?? 1);
  const requested = [
    BALANCE_GAINS.proportionalNmPerRad * errorAxis[0] + 2600 * comOffset[2] - BALANCE_GAINS.derivativeNmsPerRad * angular[0],
    0,
    BALANCE_GAINS.proportionalNmPerRad * errorAxis[2] + 2600 * comOffset[0] - BALANCE_GAINS.derivativeNmsPerRad * angular[2],
  ];
  return capVector(scale(requested, scaleByStrength), BALANCE_GAINS.maxTorqueNm * scaleByStrength);
}
function energyOf(state, props, referenceY) {
  const qBody = state.rotation, qPrincipal = qMultiply(qBody, props.inertiaLocalRotation);
  const omegaPrincipal = qRotate(state.angularVelocityRadPerSec, qConjugate(qPrincipal));
  const linearKineticJ = 0.5 * props.massKg * dot(state.linearVelocityMps, state.linearVelocityMps);
  const rotationalKineticJ = 0.5 * dot(props.principalInertiaKgM2, omegaPrincipal.map((v) => v * v));
  const gravitationalPotentialJ = props.massKg * G * (state.centerOfMassM[1] - referenceY);
  return { linearKineticJ, rotationalKineticJ, gravitationalPotentialJ, totalMechanicalJ: linearKineticJ + rotationalKineticJ + gravitationalPotentialJ };
}
function qMultiply(a, b) {
  const [x1, y1, z1, w1] = a, [x2, y2, z2, w2] = b;
  const q = [w1*x2+x1*w2+y1*z2-z1*y2, w1*y2-x1*z2+y1*w2+z1*x2, w1*z2+x1*y2-y1*x2+z1*w2, w1*w2-x1*x2-y1*y2-z1*z2];
  return q.map((v) => v / (Math.hypot(...q) || 1));
}

function createGrip(contactPoint, runnerState, defenderState, capacityN, parameters = {}) {
  return {
    runnerAnchorLocalM: localAnchor(runnerState, contactPoint),
    defenderAnchorLocalM: localAnchor(defenderState, contactPoint),
    capacityN, overloadTicks: 0, maximumDemandN: 0, maximumAppliedN: 0,
    springNPerM: parameters.springNPerM ?? GRIP_MODEL.springNPerM,
    damperNsPerM: parameters.damperNsPerM ?? GRIP_MODEL.damperNsPerM,
  };
}

function gripLoad(grip, runner, defender) {
  const runnerAnchor = worldAnchor(runner, grip.runnerAnchorLocalM);
  const defenderAnchor = worldAnchor(defender, grip.defenderAnchorLocalM);
  const separation = sub(defenderAnchor, runnerAnchor);
  const relativeVelocity = sub(pointVelocity(defender, defenderAnchor), pointVelocity(runner, runnerAnchor));
  const requested = add(scale(separation, grip.springNPerM), scale(relativeVelocity, grip.damperNsPerM));
  return { runnerAnchor, defenderAnchor, separationM: length(separation), requestedForceN: requested, requestedTensionN: length(requested) };
}

function composeFrame(tick, states, contacts, controlTorques, groundFlags, gripState = null, disturbance = null, appliedContactForce = null, appliedControlForces = {}) {
  return {
    tick, timeSeconds: tick * DT,
    players: Object.fromEntries(states.map((s) => [s.label, {
      positionM: s.positionM, centerOfMassM: s.centerOfMassM,
      linearVelocityMps: s.linearVelocityMps, angularVelocityRadPerSec: s.angularVelocityRadPerSec,
      rotation: s.rotation, tiltDeg: tiltDeg(s.rotation),
      grounded: groundFlags[s.label], appliedBalanceTorqueNm: controlTorques[s.label] ?? [0, 0, 0],
    }])),
    bodyContact: contacts.active, contactPointsM: contacts.points, contactStats: contacts.stats,
    grip: gripState, disturbance, appliedContactForce, appliedControlForcesNByPlayer: appliedControlForces,
  };
}

export async function runTackleScenario(engine, scenario, { recordFrames = true } = {}) {
  const world = await createPhysics(engine, { ground: true, material: { groundFriction: 0.82, groundRestitution: 0.04, playerFriction: 0.72, playerRestitution: 0.04, linearDamping: 0.025, angularDamping: 0.06 }, solverIterations: 8 });
  const runner = await world.addPlayer(scenario.carrier, 'carrier');
  const defender = await world.addPlayer(scenario.defender, 'defender');
  const frames = [], events = [{ type: 'tackle_attempt', timeSeconds: 0, policy: 'geometry contact gate plus breakable compliant attachment' }];
  let contactTick = null, grip = null, gripBroken = false, overloadedTicks = 0;
  let maxTilt = { carrier: 0, defender: 0 }, fallTicks = { carrier: null, defender: null }, recoveredTicks = { carrier: null, defender: null };
  let lastGripTelemetry = null, carrierXAtContact = null, peakGripDemandN = 0, peakGripAppliedN = 0;
  let solverReportedContactImpulseNs = null;
  const carrierStartX = scenario.carrier.p[0];
  const totalSteps = ticks(scenario.durationSeconds);
  for (let tick = 0; tick < totalSteps; tick++) {
    const preRunner = world.state(runner), preDefender = world.state(defender);
    const runnerGrounded = world.grounded(runner), defenderGrounded = world.grounded(defender);
    const torques = {
      carrier: balanceTorque(preRunner, scenario.carrier.strength, scenario.carrier.balanceScale, runnerGrounded),
      defender: balanceTorque(preDefender, scenario.defender.strength, scenario.defender.balanceScale, defenderGrounded),
    };
    const appliedForces = { carrier: [], defender: [] };
    const applyRecordedForce = (player, label, force, point, source) => {
      world.applyForce(player, force, point);
      appliedForces[label].push({ forceN: force, applicationPointWorldM: point, source });
    };
    world.applyTorque(runner, torques.carrier); world.applyTorque(defender, torques.defender);
    const currentTime = tick * DT;
    if (scenario.carrier.driveFromStart && currentTime < (scenario.carrier.driveSeconds ?? scenario.durationSeconds)) {
      applyRecordedForce(runner, 'carrier', [scenario.carrier.driveForceN ?? 0, 0, 0], null, 'runner forward-drive controller');
    } else if (contactTick !== null && currentTime < contactTick * DT + (scenario.tackleDriveSeconds ?? 0.78)) {
      applyRecordedForce(runner, 'carrier', [scenario.carrier.driveForceN ?? 0, 0, 0], null, 'runner forward-drive controller');
    }
    if (contactTick !== null && !gripBroken && currentTime < contactTick * DT + (scenario.tackleDriveSeconds ?? 0.78)) {
      applyRecordedForce(defender, 'defender', [-(scenario.defender.driveForceN ?? 0), 0, 0], null, 'defender tackle-drive controller');
    }
    if (grip && !gripBroken) {
      const load = gripLoad(grip, preRunner, preDefender);
      grip.maximumDemandN = Math.max(grip.maximumDemandN, load.requestedTensionN);
      peakGripDemandN = Math.max(peakGripDemandN, load.requestedTensionN);
      overloadedTicks = load.requestedTensionN > grip.capacityN || load.separationM > GRIP_MODEL.extensionLimitM ? overloadedTicks + 1 : 0;
      if (overloadedTicks >= GRIP_MODEL.releaseOverloadSteps) {
        gripBroken = true;
        const reason = load.separationM > GRIP_MODEL.extensionLimitM ? 'attachment_extension_limit' : 'controller_load_exceeded_capacity';
        events.push({ type: 'grip_broken', timeSeconds: currentTime, reason, requestedLoadN: load.requestedTensionN, capacityN: grip.capacityN, separationM: load.separationM });
      } else {
        const appliedForce = capVector(load.requestedForceN, grip.capacityN);
        const appliedTension = length(appliedForce);
        grip.maximumAppliedN = Math.max(grip.maximumAppliedN, appliedTension);
        peakGripAppliedN = Math.max(peakGripAppliedN, appliedTension);
        applyRecordedForce(runner, 'carrier', appliedForce, load.runnerAnchor, 'grip spring-damper constraint');
        applyRecordedForce(defender, 'defender', scale(appliedForce, -1), load.defenderAnchor, 'grip spring-damper constraint');
        lastGripTelemetry = { runnerAnchorM: load.runnerAnchor, defenderAnchorM: load.defenderAnchor, separationM: load.separationM,
          requestedLoadN: load.requestedTensionN, appliedLoadN: appliedTension, capacityN: grip.capacityN, loadSource: 'explicit spring-damper force law; not solver-reported' };
      }
    }
    await world.step();
    const runnerState = world.state(runner), defenderState = world.state(defender);
    const touching = world.touching(runner, defender);
    let points = world.contactPoints(runner, defender);
    if (!touching) points = [];
    const contactStats = touching ? world.contactStats(runner, defender) : { maximumPenetrationDepthM: null, penetrationSource: world.engine.startsWith('jolt') ? 'not exposed' : 'no active contact' };
    if (touching && contactTick === null) {
      contactTick = tick + 1; carrierXAtContact = runnerState.positionM[0];
      solverReportedContactImpulseNs = world.contactImpulseNs(runner, defender);
      const eventContactPoints = points.length ? points : [[(runnerState.positionM[0] + defenderState.positionM[0]) / 2,
        (runnerState.positionM[1] + defenderState.positionM[1]) / 2, (runnerState.positionM[2] + defenderState.positionM[2]) / 2]];
      events.push({ type: 'meaningful_body_contact', timeSeconds: contactTick * DT,
        solverReportedNormalImpulseNs: solverReportedContactImpulseNs,
        impulseSource: solverReportedContactImpulseNs === null ? 'not exposed by this Jolt JS adapter' : 'Rapier contact manifold solver impulses',
        contactPointsM: eventContactPoints, contactStats,
        contactPositionSource: points.length ? 'Rapier solver manifold' : 'Jolt body-contact state; body-center midpoint estimate' });
      const runnerOrigin = runnerState.positionM, defenderOrigin = defenderState.positionM;
      const contactPoint = [(runnerOrigin[0] + defenderOrigin[0]) / 2, (runnerOrigin[1] + defenderOrigin[1]) / 2 + (scenario.policy.gripAnchorHeightOffsetM ?? 0.05), (runnerOrigin[2] + defenderOrigin[2]) / 2];
      const qualifyingHeight = contactPoint[1] >= scenario.policy.wrapMinHeightM && contactPoint[1] <= scenario.policy.wrapMaxHeightM;
      const closingSpeed = Math.max(0, dot(sub(runnerState.linearVelocityMps, defenderState.linearVelocityMps), normalize(sub(defenderOrigin, runnerOrigin))));
      const permittedClosingSpeed = closingSpeed <= (scenario.policy.maxWrapClosingSpeedMps ?? 8.5);
      if (scenario.policy.wrapEnabled && qualifyingHeight && permittedClosingSpeed) {
        grip = createGrip(contactPoint, runnerState, defenderState, scenario.gripCapacityN, scenario.gripParameters);
        events.push({ type: 'grip_established', timeSeconds: contactTick * DT, contactHeightM: contactPoint[1], closingSpeedMps: closingSpeed,
          attachmentModel: 'compliant point-to-point spring-damper, equal-and-opposite body forces', gripCapacityN: grip.capacityN,
          anchorWorldM: contactPoint, biomechanicalProxy: 'single torso-level attachment; no arm articulation or hand clasp' });
      } else {
        events.push({ type: 'wrap_attempt_failed', timeSeconds: contactTick * DT, qualifyingHeight, permittedClosingSpeed, closingSpeedMps: closingSpeed });
      }
    }
    for (const [label, state] of [['carrier', runnerState], ['defender', defenderState]]) {
      const tilt = tiltDeg(state.rotation); maxTilt[label] = Math.max(maxTilt[label], tilt);
      if (tilt > 58 && fallTicks[label] === null) { fallTicks[label] = tick + 1; events.push({ type: `${label}_fall_started`, timeSeconds: (tick + 1) * DT, tiltDeg: tilt }); }
      if (fallTicks[label] !== null && recoveredTicks[label] === null && tilt < 30 && world.grounded(label === 'carrier' ? runner : defender)) {
        recoveredTicks[label] = tick + 1; events.push({ type: `${label}_recovered_upright`, timeSeconds: (tick + 1) * DT, tiltDeg: tilt });
      }
    }
    const gripFrame = grip ? {
      active: !gripBroken, runnerAnchorM: lastGripTelemetry?.runnerAnchorM ?? worldAnchor(runnerState, grip.runnerAnchorLocalM),
      defenderAnchorM: lastGripTelemetry?.defenderAnchorM ?? worldAnchor(defenderState, grip.defenderAnchorLocalM),
      separationM: lastGripTelemetry?.separationM ?? length(sub(worldAnchor(defenderState, grip.defenderAnchorLocalM), worldAnchor(runnerState, grip.runnerAnchorLocalM))),
      requestedLoadN: lastGripTelemetry?.requestedLoadN ?? 0, appliedLoadN: lastGripTelemetry?.appliedLoadN ?? 0,
      capacityN: grip.capacityN, loadSource: 'explicit spring-damper law',
    } : null;
    if (recordFrames) frames.push(composeFrame(tick + 1, [runnerState, defenderState], { active: touching, points, stats: contactStats }, torques,
      { carrier: world.grounded(runner), defender: world.grounded(defender) }, gripFrame, null, null, appliedForces));
  }
  const finalRunner = world.state(runner), finalDefender = world.state(defender);
  const carrierFell = fallTicks.carrier !== null && recoveredTicks.carrier === null;
  const carrierRecovered = recoveredTicks.carrier !== null;
  const movedAfterContactM = contactTick === null ? null : finalRunner.positionM[0] - carrierXAtContact;
  const distanceAfterAttemptM = finalRunner.positionM[0] - carrierStartX;
  const outcome = gripBroken && !carrierFell && movedAfterContactM > 0.5 ? 'broken_tackle'
    : grip && !gripBroken && carrierFell ? 'successful_tackle'
      : !grip ? 'missed_tackle' : 'inconclusive';
  if (outcome === 'missed_tackle') events.push({ type: 'missed_tackle', timeSeconds: scenario.durationSeconds, reason: contactTick === null ? 'no_body_contact' : 'no_qualifying_grip' });
  if (outcome === 'missed_tackle') events.push({ type: 'runner_continued', timeSeconds: scenario.durationSeconds, distanceFromStartM: distanceAfterAttemptM, noHoldEstablished: true });
  if (outcome === 'broken_tackle') events.push({ type: 'runner_escaped', timeSeconds: scenario.durationSeconds, postContactDistanceM: movedAfterContactM, uprightOrRecovered: true });
  if (outcome === 'successful_tackle') events.push({ type: 'carrier_down', timeSeconds: scenario.durationSeconds, cause: 'persistent fall after retained physical grip' });
  if (contactTick !== null && outcome !== 'missed_tackle') events.push({ type: 'post_contact_distance', timeSeconds: scenario.durationSeconds, distanceM: movedAfterContactM });
  const result = {
    engine: world.engine, scenario: scenario.id, outcome, durationSeconds: scenario.durationSeconds, timestepSeconds: DT,
    contact: { occurred: contactTick !== null, tick: contactTick, timeSeconds: contactTick === null ? null : contactTick * DT,
      solverReportedNormalImpulseNs: solverReportedContactImpulseNs,
      momentumChangeImpulseEstimateNs: null, maximumPenetrationDepthM: contactTick === null ? null : events.find((e) => e.type === 'meaningful_body_contact')?.contactStats.maximumPenetrationDepthM ?? null },
    grip: { established: grip !== null, broken: gripBroken, capacityN: scenario.gripCapacityN,
      peakRequestedLoadN: peakGripDemandN, peakAppliedLoadN: peakGripAppliedN,
      loadMeasure: 'explicit spring-damper force law; not a solver-reported constraint force',
      breakEvents: events.filter((e) => e.type === 'grip_broken') },
    balance: { controller: BALANCE_GAINS, maxTiltDeg: maxTilt, carrierFallTick: fallTicks.carrier, carrierRecoveredTick: recoveredTicks.carrier,
      carrierFellAtEnd: carrierFell, carrierRecovered, defenderFellAtEnd: fallTicks.defender !== null && recoveredTicks.defender === null },
    distanceAfterContactM: movedAfterContactM,
    distanceAfterAttemptM,
    players: { carrier: finalRunner, defender: finalDefender },
    events, frames,
    finite: [finalRunner, finalDefender].every((state) => [...state.positionM, ...state.centerOfMassM, ...state.linearVelocityMps, ...state.angularVelocityRadPerSec, ...state.rotation].every(Number.isFinite)),
  };
  world.destroy();
  return result;
}

export async function runBalanceScenario(engine, scenario, { recordFrames = true } = {}) {
  const world = await createPhysics(engine, { ground: true, material: { groundFriction: 0.82, groundRestitution: 0.04, playerFriction: 0.72, playerRestitution: 0.04, linearDamping: 0.025, angularDamping: 0.06 }, solverIterations: 8 });
  const specs = scenario.players ?? [scenario.player];
  const players = [];
  for (let i = 0; i < specs.length; i++) players.push(await world.addPlayer(specs[i], specs[i].label ?? (i === 0 ? 'carrier' : 'defender')));
  const frames = [], events = [];
  const maxTilt = Object.fromEntries(players.map((p) => [p.label, 0]));
  const fallTick = Object.fromEntries(players.map((p) => [p.label, null]));
  const recoveredTick = Object.fromEntries(players.map((p) => [p.label, null]));
  let firstContactTick = null;
  let disturbanceStarted = false;
  for (let tick = 0; tick < ticks(scenario.durationSeconds); tick++) {
    const time = tick * DT;
    const states = players.map((p) => world.state(p));
    const torques = {};
    const appliedForces = Object.fromEntries(players.map((player) => [player.label, []]));
    const applyRecordedForce = (player, force, point, source) => {
      world.applyForce(player, force, point);
      appliedForces[player.label].push({ forceN: force, applicationPointWorldM: point, source });
    };
    let appliedContactForce = null;
    for (let i = 0; i < players.length; i++) {
      const player = players[i], state = states[i], spec = specs[i];
      const grounded = world.grounded(player);
      torques[player.label] = balanceTorque(state, spec.strength, spec.balanceScale, grounded);
      world.applyTorque(player, torques[player.label]);
      if (spec.pushForceN && time < (scenario.pushSeconds ?? 0)) {
        const direction = qRotate([1, 0, 0], state.rotation);
        applyRecordedForce(player, scale(direction, spec.pushForceN), null, 'opposing-player push policy');
      }
      if (scenario.disturbance && player === players[0]) {
        const start = scenario.disturbance.startSeconds, stop = start + scenario.disturbance.durationSeconds;
        if (time >= start && time < stop) {
          const point = add(state.positionM, qRotate(scenario.disturbance.localPointM, state.rotation));
          applyRecordedForce(player, scenario.disturbance.forceN, point, 'controlled lateral disturbance');
          if (!disturbanceStarted) {
            disturbanceStarted = true;
            events.push({ type: 'balance_disturbance_started', timeSeconds: time, forceN: scenario.disturbance.forceN, applicationPointWorldM: point });
          }
        }
      }
    }
    if (scenario.contactForce && firstContactTick !== null
      && time < firstContactTick * DT + scenario.contactForce.durationSeconds) {
      const point = [(states[0].positionM[0] + states[1].positionM[0]) / 2,
        (states[0].positionM[1] + states[1].positionM[1]) / 2 + scenario.contactForce.heightOffsetM,
        (states[0].positionM[2] + states[1].positionM[2]) / 2];
      const force = scenario.contactForce.forceOnCarrierN;
      applyRecordedForce(players[0], force, point, 'equal-and-opposite contact policy force');
      applyRecordedForce(players[1], scale(force, -1), point, 'equal-and-opposite contact policy force');
      appliedContactForce = { worldPointM: point, forceOnCarrierN: force, forceOnDefenderN: scale(force, -1), source: 'equal-and-opposite contact policy force; solver resolves resulting body motion' };
      if (!events.some((event) => event.type === 'contact_policy_force_started')) events.push({ type: 'contact_policy_force_started', timeSeconds: time,
        ...appliedContactForce, durationSeconds: scenario.contactForce.durationSeconds });
    }
    await world.step();
    const post = players.map((p) => world.state(p));
    const touching = players.length > 1 && world.touching(players[0], players[1]);
    let contactPoints = touching ? world.contactPoints(players[0], players[1]) : [];
    if (touching && contactPoints.length === 0) contactPoints = [[(post[0].positionM[0] + post[1].positionM[0]) / 2,
      (post[0].positionM[1] + post[1].positionM[1]) / 2, (post[0].positionM[2] + post[1].positionM[2]) / 2]];
    const contactStats = touching ? world.contactStats(players[0], players[1]) : { maximumPenetrationDepthM: null, penetrationSource: world.engine.startsWith('jolt') ? 'not exposed' : 'no active contact' };
    if (touching && firstContactTick === null) { firstContactTick = tick + 1; events.push({ type: 'physical_contact', timeSeconds: (tick + 1) * DT, contactPointsM: contactPoints, contactStats }); }
    for (let i = 0; i < post.length; i++) {
      const label = players[i].label, tilt = tiltDeg(post[i].rotation); maxTilt[label] = Math.max(maxTilt[label], tilt);
      if (tilt > 58 && fallTick[label] === null) { fallTick[label] = tick + 1; events.push({ type: `${label}_fall_started`, timeSeconds: (tick + 1) * DT, tiltDeg: tilt }); }
      if (fallTick[label] !== null && recoveredTick[label] === null && tilt < 30 && world.grounded(players[i])) {
        recoveredTick[label] = tick + 1; events.push({ type: `${label}_recovered_upright`, timeSeconds: (tick + 1) * DT, tiltDeg: tilt });
      }
    }
    if (recordFrames) frames.push(composeFrame(tick + 1, post, { active: touching, points: contactPoints, stats: contactStats }, torques,
      Object.fromEntries(players.map((p) => [p.label, world.grounded(p)])), null,
      scenario.disturbance && time >= scenario.disturbance.startSeconds && time < scenario.disturbance.startSeconds + scenario.disturbance.durationSeconds ? { forceN: scenario.disturbance.forceN } : null,
      appliedContactForce, appliedForces));
  }
  const finalStates = players.map((p) => world.state(p));
  for (const state of finalStates) {
    const label = state.label, finalTilt = tiltDeg(state.rotation);
    if (maxTilt[label] > 10 && finalTilt < 30 && finalTilt < Math.max(5, maxTilt[label] * 0.72)) {
      events.push({ type: 'upright_stabilized_after_disturbance', timeSeconds: scenario.durationSeconds, label, peakTiltDeg: maxTilt[label], finalTiltDeg: finalTilt });
    }
  }
  const results = finalStates.map((state) => ({ label: state.label, final: state, maxTiltDeg: maxTilt[state.label], fallTick: fallTick[state.label], recoveredTick: recoveredTick[state.label], fellAtEnd: fallTick[state.label] !== null && recoveredTick[state.label] === null }));
  world.destroy();
  return { engine: world.engine, scenario: scenario.id, durationSeconds: scenario.durationSeconds, timestepSeconds: DT, results, firstContactTick, events, frames,
    appliedControlTorqueModel: BALANCE_GAINS, finite: finalStates.every((state) => [...state.positionM, ...state.centerOfMassM, ...state.linearVelocityMps, ...state.angularVelocityRadPerSec, ...state.rotation].every(Number.isFinite)) };
}

export async function runEnergyControls(engine) {
  const energyStepSeconds = 1 / 1200;
  const airborne = await createPhysics(engine, { ground: false, gravity: -G, timestep: energyStepSeconds });
  const body = airborne.addBallisticBody({ p: [0, 12, 0], v: [1.4, 2.2, -0.6], angular: [0.55, 0.35, -0.25], mass: 84,
    shape: 'box', halfExtents: [0.31, 0.23, 0.27], material: { friction: 0, restitution: 0, linearDamping: 0, angularDamping: 0 } });
  const props = airborne.energyProps(body), initialAirState = airborne.state(body), referenceY = initialAirState.centerOfMassM[1], frames = [];
  let anyContact = false;
  const steps = 2400;
  for (let tick = 0; tick < steps; tick++) {
    await airborne.step();
    const state = airborne.state(body), energy = energyOf(state, props, referenceY);
    frames.push({ tick: tick + 1, timeSeconds: (tick + 1) * energyStepSeconds, ...state, ...energy });
  }
  const initialEnergy = energyOf(initialAirState, props, referenceY);
  const driftJ = frames.at(-1).totalMechanicalJ - initialEnergy.totalMechanicalJ;
  const maxAbsFrameDriftJ = Math.max(...frames.map((f) => Math.abs(f.totalMechanicalJ - initialEnergy.totalMechanicalJ)));
  const maxRelativeFrameDrift = maxAbsFrameDriftJ / Math.max(1, initialEnergy.totalMechanicalJ);
  const airborneResult = { frames, contactFreeAssertion: !anyContact, measurementWorldHasOtherCollisionBodies: false, measuredFrames: frames.length, gravityOnly: true,
    additionalForceCount: 0, additionalTorqueCount: 0, damping: { linear: 0, angular: 0 }, timestepSeconds: energyStepSeconds, initialEnergyJ: initialEnergy.totalMechanicalJ,
    finalEnergyJ: frames.at(-1).totalMechanicalJ, netDriftJ: driftJ, maxAbsoluteFrameDriftJ: maxAbsFrameDriftJ,
    maxRelativeFrameDrift: maxRelativeFrameDrift, toleranceRelative: 0.04, passed: !anyContact && maxRelativeFrameDrift <= 0.04 };
  airborne.destroy();

  const groundWorld = await createPhysics(engine, { ground: true, gravity: -G, material: { groundFriction: 0.72, groundRestitution: 0.12, linearDamping: 0.025, angularDamping: 0.06 } });
  const dropped = groundWorld.addBallisticBody({ p: [0, 2.4, 0], v: [2.0, 0, 0], angular: [0.2, 0, 1.4], mass: 12,
    shape: 'box', halfExtents: [0.23, 0.13, 0.16], material: { friction: 0.72, restitution: 0.12, linearDamping: 0.025, angularDamping: 0.06 } });
  const groundProps = groundWorld.energyProps(dropped), initialGroundState = groundWorld.state(dropped), groundReferenceY = initialGroundState.centerOfMassM[1];
  const groundFrames = [];
  let firstContactTime = null, rapierSolverImpulseNs = 0, momentumChangeEstimateNs = 0, prev = groundWorld.state(dropped);
  const groundSteps = 210;
  for (let tick = 0; tick < groundSteps; tick++) {
    await groundWorld.step();
    const state = groundWorld.state(dropped), contact = groundWorld.grounded(dropped);
    if (contact && firstContactTime === null) firstContactTime = (tick + 1) * DT;
    const solverImpulse = engine.startsWith('rapier') ? groundWorld.contactImpulseNs(dropped, groundWorld.groundEntity) : null;
    if (solverImpulse !== null) rapierSolverImpulseNs += solverImpulse;
    const impulseEstimate = scale(sub(state.linearVelocityMps, add(prev.linearVelocityMps, [0, -G * DT, 0])), groundProps.massKg);
    if (contact && !engine.startsWith('rapier')) momentumChangeEstimateNs += length(impulseEstimate);
    groundFrames.push({ tick: tick + 1, timeSeconds: (tick + 1) * DT, ...state, ...energyOf(state, groundProps, groundReferenceY), groundContact: contact,
      solverReportedImpulseNs: solverImpulse, momentumChangeImpulseEstimateNs: !engine.startsWith('rapier') && contact ? length(impulseEstimate) : null });
    prev = state;
  }
  const initialGroundEnergy = energyOf(initialGroundState, groundProps, groundReferenceY);
  const groundResult = { frames: groundFrames, case: 'inelastic ground contact; total mechanical energy is not assumed conserved',
    material: { friction: 0.72, restitution: 0.12, linearDamping: 0.025, angularDamping: 0.06 }, firstContactTimeSeconds: firstContactTime,
    initialMechanicalEnergyJ: initialGroundEnergy.totalMechanicalJ, finalMechanicalEnergyJ: groundFrames.at(-1).totalMechanicalJ,
    mechanicalEnergyChangeJ: groundFrames.at(-1).totalMechanicalJ - initialGroundEnergy.totalMechanicalJ,
    solverReportedNormalImpulseNs: engine.startsWith('rapier') ? rapierSolverImpulseNs : null,
    solverReportedImpulseSource: engine.startsWith('rapier') ? 'Rapier contact manifold solver contacts; normal component' : null,
    momentumChangeEstimateNs: engine.startsWith('rapier') ? null : momentumChangeEstimateNs,
    momentumChangeEstimateSource: engine.startsWith('rapier') ? null : 'body momentum delta with gravity increment removed; may include tangential, damping and contact effects; not a solver impulse' };
  groundWorld.destroy();
  return { engine, timestepSeconds: DT, gravityMps2: G,
    airborne: { ...airborneResult, frames: frames.map(({ tick, timeSeconds, totalMechanicalJ, linearKineticJ, rotationalKineticJ, gravitationalPotentialJ }) => ({ tick, timeSeconds, totalMechanicalJ, linearKineticJ, rotationalKineticJ, gravitationalPotentialJ })) },
    ground: { ...groundResult, frames: groundFrames.map(({ tick, timeSeconds, totalMechanicalJ, groundContact, solverReportedImpulseNs, momentumChangeImpulseEstimateNs }) => ({ tick, timeSeconds, totalMechanicalJ, groundContact, solverReportedImpulseNs, momentumChangeImpulseEstimateNs })) } };
}

export async function run22PlayerBenchmark(engine, { steps = 600, repeats = 3 } = {}) {
  const samples = [], memoryBefore = globalThis.process?.memoryUsage?.() ?? null, warmupSteps = Math.min(120, steps);
  for (let repeat = 0; repeat < repeats; repeat++) {
    const world = await createPhysics(engine, { ground: true, material: { groundFriction: 0.82, groundRestitution: 0.04, playerFriction: 0.72, playerRestitution: 0.04, linearDamping: 0.025, angularDamping: 0.06 }, solverIterations: 8 });
    const players = [];
    for (let i = 0; i < 22; i++) {
      const side = i < 11 ? -1 : 1, slot = i % 11;
      const spec = { p: [side * (0.55 + (slot % 3) * 0.08), 0.845, (slot - 5) * 0.62],
        v: [-side * (1.0 + (slot % 4) * 0.08), 0, ((slot % 3) - 1) * 0.15], mass: 88 + (slot * 7) % 43, strength: 72 + (slot * 11) % 25,
        yawRad: side < 0 ? 0 : Math.PI, balanceScale: 0.8 + (slot % 4) * 0.12 };
      players.push(await world.addPlayer(spec, `player-${i + 1}`));
    }
    let start = null, contactSteps = 0, maxTilt = 0, finite = true;
    for (let tick = 0; tick < steps + warmupSteps; tick++) {
      for (const player of players) {
        const state = world.state(player);
        world.applyTorque(player, balanceTorque(state, player.spec.strength, player.spec.balanceScale, world.grounded(player)));
      }
      await world.step();
      let any = false;
      for (let i = 0; i < players.length; i++) {
        const state = world.state(players[i]);
        maxTilt = Math.max(maxTilt, tiltDeg(state.rotation));
        finite &&= [...state.positionM, ...state.centerOfMassM, ...state.linearVelocityMps, ...state.angularVelocityRadPerSec, ...state.rotation].every(Number.isFinite);
        if (!any && players.slice(i + 1).some((other) => world.touching(players[i], other))) any = true;
      }
      if (tick >= warmupSteps && any) contactSteps++;
      if (tick === warmupSteps - 1) start = performance.now();
    }
    const elapsedMs = performance.now() - start;
    samples.push({ repeat: repeat + 1, elapsedMs, msPerSimulatedSecond: elapsedMs / (steps * DT), contactSteps, maxTiltDeg: maxTilt, finite });
    world.destroy();
  }
  const sorted = samples.map((s) => s.elapsedMs / steps).sort((a, b) => a - b);
  const memoryAfter = globalThis.process?.memoryUsage?.() ?? null;
  return { engine, players: 22, colliderRepresentation: engine.startsWith('rapier') ? '5 attached colliders per player' : '1 compound collider per player', stepsPerRepeat: steps, timestepSeconds: DT, repeats,
    controllersEnabled: true, controller: BALANCE_GAINS, contactAndPushPolicies: 'matched initial opposing pursuit velocities; no scripted body pose resets',
    warmupStepsPerRepeat: warmupSteps, samples, medianMsPerStep: sorted[Math.floor(sorted.length / 2)], medianMsPerSimulatedSecond: sorted[Math.floor(sorted.length / 2)] / DT,
    residentMemoryDeltaBytes: memoryBefore && memoryAfter ? memoryAfter.rss - memoryBefore.rss : null,
    heapUsedDeltaBytes: memoryBefore && memoryAfter ? memoryAfter.heapUsed - memoryBefore.heapUsed : null,
    memoryMeasure: 'process-level Node RSS/heap delta around repeated scene creation and destruction; not per-engine peak WASM allocation',
    finite: samples.every((s) => s.finite) };
}
