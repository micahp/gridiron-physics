import initJolt from 'jolt-physics';
import RAPIER from '@dimforge/rapier3d-compat';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { BODY_LAYOUT, DT, contactSweepScenario } from './scenarios.js';

const CELLS = [[60, 6], [30, 8]];
const ENGINES = ['rapier3d-compat', 'jolt-physics-js'];
const G = 9.81;
const GRAVITY = [0, -G, 0];
const CONTACT_EPSILON_NS = 1e-7;
const NO_CONTACT_ENERGY_BOUND_J_PER_STEP = 0.05;

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const magnitude = (a) => Math.hypot(...a);
const asArray = (v) => Array.isArray(v) ? v : [v.x, v.y, v.z];
const quatArray = (q) => Array.isArray(q) ? q : [q.x, q.y, q.z, q.w];
const normalizeQuat = ([x, y, z, w]) => {
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
};
const quatConjugate = ([x, y, z, w]) => [-x, -y, -z, w];

function quatMultiply(a, b) {
  const [x1, y1, z1, w1] = a, [x2, y2, z2, w2] = b;
  return normalizeQuat([
    w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
    w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
    w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
  ]);
}

function rotate(v, qInput) {
  const [qx, qy, qz, qw] = normalizeQuat(qInput);
  const qv = [qx, qy, qz];
  const t = scale(cross(qv, v), 2);
  return add(v, add(scale(t, qw), cross(qv, t)));
}

function bodyEnergy(state, referenceY) {
  const linearKEJ = 0.5 * state.massKg * dot(state.linearVelocityMps, state.linearVelocityMps);
  const principalOrientation = quatMultiply(state.rotation, state.inertiaLocalRotation);
  const principalAngularVelocity = rotate(state.angularVelocityRadPerSec, quatConjugate(principalOrientation));
  const rotationalKEJ = 0.5 * dot(state.principalInertiaKgM2,
    principalAngularVelocity.map((component) => component * component));
  const gravitationalPEJ = state.massKg * G * (state.centerOfMassM[1] - referenceY);
  return {
    linearKEJ,
    rotationalKEJ,
    gravitationalPEJ,
    totalMechanicalEnergyJ: linearKEJ + rotationalKEJ + gravitationalPEJ,
  };
}

function pointVelocity(state, point) {
  return add(state.linearVelocityMps, cross(state.angularVelocityRadPerSec, sub(point, state.centerOfMassM)));
}

function normalizePairNormal(normalInput, stateA, stateB) {
  const normal = scale(normalInput, 1 / (magnitude(normalInput) || 1));
  return dot(normal, sub(stateB.centerOfMassM, stateA.centerOfMassM)) >= 0 ? normal : scale(normal, -1);
}

function impulseWork(impulseNs, normal, point, beforeA, afterA, beforeB, afterB) {
  const velocityA = scale(add(pointVelocity(beforeA, point), pointVelocity(afterA, point)), 0.5);
  const velocityB = scale(add(pointVelocity(beforeB, point), pointVelocity(afterB, point)), 0.5);
  return impulseNs * dot(sub(velocityB, velocityA), normal);
}

function energySnapshot(state, referenceY) {
  const { linearKEJ, rotationalKEJ, gravitationalPEJ, totalMechanicalEnergyJ } = bodyEnergy(state, referenceY);
  return {
    worldCenterOfMassM: state.centerOfMassM,
    linearVelocityMps: state.linearVelocityMps,
    angularVelocityRadPerSec: state.angularVelocityRadPerSec,
    linearKEJ,
    rotationalKEJ,
    gravitationalPEJ,
    totalMechanicalEnergyJ,
  };
}

function summarizeFrames(rawFrames, initialStates, engine, mode, angleDeg, speedMps) {
  const referenceY = Object.fromEntries(['carrier', 'defender'].map((role) => [role, rawFrames[0].states[role].centerOfMassM[1]]));
  const initial = Object.fromEntries(['carrier', 'defender'].map((role) => [
    role,
    energySnapshot(initialStates[role], referenceY[role]),
  ]));
  const frames = [];
  let previousStates = initialStates;
  let previousBodyEnergy = Object.fromEntries(['carrier', 'defender'].map((role) => [role,
    bodyEnergy(previousStates[role], referenceY[role])]));

  for (const raw of rawFrames) {
    const energies = Object.fromEntries(['carrier', 'defender'].map((role) => [
      role,
      energySnapshot(raw.states[role], referenceY[role]),
    ]));
    const totalEnergyJ = energies.carrier.totalMechanicalEnergyJ + energies.defender.totalMechanicalEnergyJ;
    const priorTotalEnergyJ = previousBodyEnergy.carrier.totalMechanicalEnergyJ + previousBodyEnergy.defender.totalMechanicalEnergyJ;
    const deltaTotalMechanicalEnergyJ = totalEnergyJ - priorTotalEnergyJ;
    const deltaKineticEnergyJ = energies.carrier.linearKEJ + energies.carrier.rotationalKEJ
      + energies.defender.linearKEJ + energies.defender.rotationalKEJ
      - previousBodyEnergy.carrier.linearKEJ - previousBodyEnergy.carrier.rotationalKEJ
      - previousBodyEnergy.defender.linearKEJ - previousBodyEnergy.defender.rotationalKEJ;
    const deltaPotentialEnergyJ = energies.carrier.gravitationalPEJ + energies.defender.gravitationalPEJ
      - previousBodyEnergy.carrier.gravitationalPEJ - previousBodyEnergy.defender.gravitationalPEJ;
    const gravityWorkOnKineticJ = ['carrier', 'defender'].reduce((sum, role) => sum
      + raw.states[role].massKg * dot(GRAVITY, sub(raw.states[role].centerOfMassM, previousStates[role].centerOfMassM)), 0);
    const normalImpulseWorkJ = raw.contactImpulses.reduce((sum, impulse) => sum + impulse.workJ, 0);
    const energyResidualAfterNormalImpulseJ = deltaTotalMechanicalEnergyJ - normalImpulseWorkJ;
    const totalNormalImpulseMagnitudeNs = raw.contactImpulses.reduce((sum, impulse) => sum + impulse.magnitudeNs, 0);
    const tackleImpulseNs = raw.contactImpulses
      .filter((impulse) => impulse.pairType === 'carrier_defender')
      .reduce((sum, impulse) => sum + impulse.magnitudeNs, 0);
    const anyContact = raw.contactPairCount > 0;
    const tackleContact = tackleImpulseNs > CONTACT_EPSILON_NS;
    const carrierDisplacementM = sub(raw.states.carrier.centerOfMassM, previousStates.carrier.centerOfMassM);
    const carrierVelocityIntegratedM = scale(raw.states.carrier.linearVelocityMps, DT);
    const carrierIntegrationResidualVectorM = sub(carrierDisplacementM, carrierVelocityIntegratedM);
    frames.push({
      tick: raw.tick,
      timeSeconds: raw.tick * DT,
      bodies: energies,
      carrierTiltDeg: raw.carrierTiltDeg,
      totalMechanicalEnergyJ: totalEnergyJ,
      deltaTotalMechanicalEnergyJ,
      deltaKineticEnergyJ,
      deltaPotentialEnergyJ,
      gravityWorkOnKineticJ,
      gravityPotentialChangeJ: deltaPotentialEnergyJ,
      normalImpulseMagnitudeNs: totalNormalImpulseMagnitudeNs,
      normalImpulseWorkJ,
      energyResidualAfterNormalImpulseJ,
      contactPairCount: raw.contactPairCount,
      contactStep: anyContact,
      tackleContactStep: tackleContact,
      contactEnergyChangeJ: anyContact ? deltaTotalMechanicalEnergyJ : 0,
      nonContactEnergyChangeJ: anyContact ? null : deltaTotalMechanicalEnergyJ,
      tackleNonContactEnergyChangeJ: tackleContact ? null : deltaTotalMechanicalEnergyJ,
      carrierDisplacementM,
      carrierVelocityIntegratedM,
      carrierIntegrationResidualVectorM,
      carrierIntegrationResidualM: magnitude(carrierIntegrationResidualVectorM),
      contactImpulseSummary: {
        pairTypes: [...new Set(raw.contactImpulses.map((impulse) => impulse.pairType))],
        impulseSources: [...new Set(raw.contactImpulses.map((impulse) => impulse.source))],
      },
    });
    previousStates = raw.states;
    previousBodyEnergy = Object.fromEntries(['carrier', 'defender'].map((role) => [role,
      bodyEnergy(raw.states[role], referenceY[role])]));
  }

  const peakFrame = frames.reduce((best, frame) => frame.carrierTiltDeg > best.carrierTiltDeg ? frame : best, frames[0]);
  const maxIntegrationResidualM = Math.max(...frames.map((frame) => frame.carrierIntegrationResidualM));
  const noTackleFrames = frames.filter((frame) => !frame.tackleContactStep);
  return {
    engine,
    approachAngleDeg: angleDeg,
    closingSpeedMps: speedMps,
    defenderMotion: mode,
    carrierMassKg: rawFrames[0].states.carrier.massKg,
    defenderMassKg: rawFrames[0].states.defender.massKg,
    initial,
    firstTickReferenceCOMY: referenceY,
    peakTiltDeg: peakFrame.carrierTiltDeg,
    peakTick: peakFrame.tick,
    peakTimeSeconds: peakFrame.timeSeconds,
    final: frames.at(-1),
    energySummary: {
      totalMechanicalEnergyStartJ: initial.carrier.totalMechanicalEnergyJ + initial.defender.totalMechanicalEnergyJ,
      totalMechanicalEnergyEndJ: frames.at(-1).totalMechanicalEnergyJ,
      netTotalMechanicalEnergyChangeJ: frames.at(-1).totalMechanicalEnergyJ
        - initial.carrier.totalMechanicalEnergyJ - initial.defender.totalMechanicalEnergyJ,
      summedContactStepEnergyChangeJ: frames.reduce((sum, frame) => sum + frame.contactEnergyChangeJ, 0),
      summedNonContactStepEnergyChangeJ: frames.reduce((sum, frame) => sum + (frame.nonContactEnergyChangeJ ?? 0), 0),
      summedTackleNonContactEnergyChangeJ: frames.reduce((sum, frame) => sum + (frame.tackleNonContactEnergyChangeJ ?? 0), 0),
      summedNormalImpulseMagnitudeNs: frames.reduce((sum, frame) => sum + frame.normalImpulseMagnitudeNs, 0),
      summedNormalImpulseWorkJ: frames.reduce((sum, frame) => sum + frame.normalImpulseWorkJ, 0),
      summedEnergyResidualAfterNormalImpulseJ: frames.reduce((sum, frame) => sum + frame.energyResidualAfterNormalImpulseJ, 0),
      maxAbsTackleNonContactStepEnergyResidualJ: Math.max(...noTackleFrames.map((frame) => Math.abs(frame.energyResidualAfterNormalImpulseJ))),
      nonTackleFrameCount: noTackleFrames.length,
      strictNoContactFrameCount: frames.filter((frame) => !frame.contactStep).length,
      maximumStrictNoContactEnergyDriftJ: Math.max(0, ...frames.filter((frame) => !frame.contactStep)
        .map((frame) => Math.abs(frame.deltaTotalMechanicalEnergyJ))),
      maximumCarrierVelocityIntegrationResidualM: maxIntegrationResidualM,
      carrierEnergyAtPeakTiltJ: peakFrame.bodies.carrier.totalMechanicalEnergyJ,
    },
    frames,
  };
}

function qRapier(q) { return [q.x, q.y, q.z, q.w]; }

function rapierMassProps(body, nominalMass) {
  const principal = body.principalInertia({ x: 0, y: 0, z: 0 });
  const principalFrame = body.principalInertiaLocalFrame({ x: 0, y: 0, z: 0, w: 1 });
  const inertias = asArray(principal);
  return {
    massKg: body.mass() > 0 ? body.mass() : nominalMass,
    principalInertiaKgM2: inertias.map((value) => Number.isFinite(value) && value > 0 ? value : 0),
    inertiaLocalRotation: qRapier(principalFrame),
  };
}

function rapierState(player, props) {
  const com = player.body.worldCom({ x: 0, y: 0, z: 0 });
  const velocity = player.body.linvel();
  const angular = player.body.angvel();
  const rotation = player.body.rotation();
  return {
    ...props,
    centerOfMassM: asArray(com),
    linearVelocityMps: asArray(velocity),
    angularVelocityRadPerSec: asArray(angular),
    rotation: qRapier(rotation),
  };
}

async function runRapier(angleDeg, speedMps, mode) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  world.integrationParameters.numSolverIterations = 8;
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const ground = world.createCollider(
    RAPIER.ColliderDesc.cuboid(30, 0.2, 30).setTranslation(0, -0.2, 0).setFriction(0.95), groundBody,
  );
  const scenario = contactSweepScenario(angleDeg, speedMps);
  const direction = [Math.cos(angleDeg * Math.PI / 180), 0, Math.sin(angleDeg * Math.PI / 180)];
  const specs = {
    carrier: { ...scenario.carrier, v: mode === 'dynamic' ? scenario.carrier.v : [0, 0, 0] },
    defender: { ...scenario.defender, v: mode === 'dynamic' ? scenario.defender.v : [-speedMps * direction[0], 0, -speedMps * direction[2]] },
  };
  const makePlayer = (role) => {
    const spec = specs[role];
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(...spec.p)
      .setRotation({ x: 0, y: Math.sin((spec.yawRad ?? 0) / 2), z: 0, w: Math.cos((spec.yawRad ?? 0) / 2) })
      .setLinvel(...spec.v)
      .setLinearDamping(0.04).setAngularDamping(0.18).setCcdEnabled(true).setCanSleep(false));
    const colliders = BODY_LAYOUT.map((part) => {
      const desc = part.shape === 'sphere' ? RAPIER.ColliderDesc.ball(part.radius) : RAPIER.ColliderDesc.capsule(part.halfHeight, part.radius);
      desc.setTranslation(...part.pos)
        .setRotation(part.axis === 'x' ? { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } : { x: 0, y: 0, z: 0, w: 1 })
        .setMass(spec.mass * part.massShare).setFriction(0.82).setRestitution(0.03);
      return world.createCollider(desc, body);
    });
    const player = { body, colliders, spec, role };
    player.energyProps = rapierMassProps(body, spec.mass);
    if (role === 'defender' && mode === 'kinematic') body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    return player;
  };
  const carrier = makePlayer('carrier'), defender = makePlayer('defender');
  const players = { carrier, defender };
  const initial = Object.fromEntries(Object.entries(players).map(([role, player]) => [role, rapierState(player, player.energyProps)]));
  const rawFrames = [];
  const pairs = [
    { pairType: 'carrier_defender', roleA: 'carrier', roleB: 'defender', a: carrier.colliders, b: defender.colliders },
    { pairType: 'carrier_ground', roleA: 'carrier', roleB: 'ground', a: carrier.colliders, b: [ground] },
    { pairType: 'defender_ground', roleA: 'defender', roleB: 'ground', a: defender.colliders, b: [ground] },
  ];
  for (let tick = 1; tick <= 180; tick++) {
    if (mode === 'kinematic') {
      const p = defender.body.translation();
      defender.body.setNextKinematicTranslation({ x: p.x + specs.defender.v[0] * DT, y: p.y, z: p.z + specs.defender.v[2] * DT });
    }
    const before = Object.fromEntries(Object.entries(players).map(([role, player]) => [role, rapierState(player, player.energyProps)]));
    world.step();
    const after = Object.fromEntries(Object.entries(players).map(([role, player]) => [role, rapierState(player, player.energyProps)]));
    const contactImpulses = [];
    let contactPairCount = 0;
    for (const pair of pairs) {
      const aState = pair.roleA === 'ground' ? null : before[pair.roleA];
      const bState = pair.roleB === 'ground' ? null : before[pair.roleB];
      const aAfter = pair.roleA === 'ground' ? null : after[pair.roleA];
      const bAfter = pair.roleB === 'ground' ? null : after[pair.roleB];
      let pairActive = false;
      for (const [i, colliderA] of pair.a.entries()) for (const [j, colliderB] of pair.b.entries()) {
        world.contactPair(colliderA, colliderB, (manifold) => {
          const count = manifold.numSolverContacts();
          if (!count) return;
          pairActive = true;
          const rawNormal = asArray(manifold.normal({ x: 0, y: 0, z: 0 }));
          const proxyA = aState ?? { centerOfMassM: [0, -0.2, 0], linearVelocityMps: [0, 0, 0], angularVelocityRadPerSec: [0, 0, 0] };
          const proxyB = bState ?? { centerOfMassM: [0, -0.2, 0], linearVelocityMps: [0, 0, 0], angularVelocityRadPerSec: [0, 0, 0] };
          const normal = normalizePairNormal(rawNormal, proxyA, proxyB);
          for (let k = 0; k < count; k++) {
            const pointObject = manifold.solverContactPoint(k, { x: 0, y: 0, z: 0 });
            const point = asArray(pointObject);
            const impulse = Math.max(0, manifold.contactImpulse(k));
            contactImpulses.push({
              pairType: pair.pairType,
              magnitudeNs: impulse,
              workJ: impulseWork(impulse, normal, point,
                aState ?? staticState(), aAfter ?? staticState(), bState ?? staticState(), bAfter ?? staticState()),
              source: 'rapier_solver_contactImpulse',
            });
          }
        });
      }
      if (pairActive) contactPairCount++;
    }
    rawFrames.push({ tick, states: after, contactImpulses, contactPairCount, carrierTiltDeg: tiltFromQuaternion(after.carrier.rotation) });
  }
  const result = summarizeFrames(rawFrames, initial, 'rapier3d-compat', mode, angleDeg, speedMps);
  world.free();
  return result;
}

function tiltFromQuaternion([x, y, z, w]) {
  return Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (x * x + z * z)))) * 180 / Math.PI;
}

function staticState() {
  return { centerOfMassM: [0, 0, 0], linearVelocityMps: [0, 0, 0], angularVelocityRadPerSec: [0, 0, 0] };
}

function joltReadVec(v) { return [v.GetX(), v.GetY(), v.GetZ()]; }
function joltReadQuat(q) { return [q.GetX(), q.GetY(), q.GetZ(), q.GetW()]; }
function joltBodyKey(id) { return id.GetIndexAndSequenceNumber(); }

function makeJoltWorld(J) {
  const staticLayer = 0, movingLayer = 1;
  const pairFilter = new J.ObjectLayerPairFilterTable(2);
  pairFilter.EnableCollision(staticLayer, staticLayer);
  pairFilter.EnableCollision(staticLayer, movingLayer);
  pairFilter.EnableCollision(movingLayer, movingLayer);
  const broad = new J.BroadPhaseLayerInterfaceTable(2, 2);
  const bp0 = new J.BroadPhaseLayer(0), bp1 = new J.BroadPhaseLayer(1);
  broad.MapObjectToBroadPhaseLayer(staticLayer, bp0); broad.MapObjectToBroadPhaseLayer(movingLayer, bp1);
  J.destroy(bp0); J.destroy(bp1);
  const vsBroad = new J.ObjectVsBroadPhaseLayerFilterTable(broad, 2, pairFilter, 2);
  const settings = new J.JoltSettings();
  settings.mMaxBodies = 96; settings.mMaxBodyPairs = 1024; settings.mMaxContactConstraints = 1024;
  settings.mMaxWorkerThreads = 0; settings.mBroadPhaseLayerInterface = broad;
  settings.mObjectLayerPairFilter = pairFilter; settings.mObjectVsBroadPhaseLayerFilter = vsBroad;
  const jolt = new J.JoltInterface(settings); J.destroy(settings);
  const physics = jolt.GetPhysicsSystem(); physics.SetGravity(new J.Vec3(...GRAVITY));
  return { J, jolt, physics, bodyInterface: physics.GetBodyInterface(), bodies: [], staticLayer, movingLayer };
}

function joltShape(J, settings) {
  const result = settings.Create();
  if (!result.IsValid()) throw new Error(`Jolt shape creation failed: ${result.GetError()}`);
  const shape = result.Get(); shape.AddRef(); result.Clear(); settings.Release();
  return shape;
}

function addJoltBody(world, shape, { p, yawRad = 0, mass = 0, motionType, layer, friction = 0.82, restitution = 0.03 }) {
  const { J } = world;
  const pos = new J.RVec3(...p), axis = new J.Vec3(0, 1, 0), rot = J.Quat.prototype.sRotation(axis, yawRad);
  const settings = new J.BodyCreationSettings(shape, pos, rot, motionType, layer);
  settings.mFriction = friction; settings.mRestitution = restitution;
  settings.mLinearDamping = 0.04; settings.mAngularDamping = 0.18; settings.mAllowSleeping = false;
  if (motionType === J.EMotionType_Dynamic) {
    settings.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
    settings.mMassPropertiesOverride.mMass = mass;
  }
  shape.Release();
  const body = world.bodyInterface.CreateBody(settings), id = body.GetID();
  world.bodyInterface.AddBody(id, J.EActivation_Activate);
  J.destroy(settings); J.destroy(pos); J.destroy(axis); J.destroy(rot);
  world.bodies.push({ id });
  return { body, id, mass, motionType };
}

function addJoltGround(world) {
  const { J } = world;
  const shape = joltShape(J, new J.BoxShapeSettings(new J.Vec3(30, 0.2, 30), 0.05, null));
  return addJoltBody(world, shape, { p: [0, -0.2, 0], layer: world.staticLayer, motionType: J.EMotionType_Static });
}

function addJoltPlayer(world, spec) {
  const { J } = world;
  const compound = new J.StaticCompoundShapeSettings();
  for (const part of BODY_LAYOUT) {
    const child = part.shape === 'sphere' ? new J.SphereShapeSettings(part.radius, null)
      : new J.CapsuleShapeSettings(part.halfHeight, part.radius, null);
    const pos = new J.Vec3(...part.pos);
    const rot = part.axis === 'x' ? J.Quat.prototype.sRotation(J.Vec3.prototype.sAxisZ(), Math.PI / 2) : J.Quat.prototype.sIdentity();
    compound.AddShapeShapeSettings(pos, rot, child, 0); J.destroy(pos); J.destroy(rot);
  }
  return addJoltBody(world, joltShape(J, compound), {
    p: spec.p, yawRad: spec.yawRad ?? 0, mass: spec.mass,
    motionType: J.EMotionType_Dynamic, layer: world.movingLayer,
  });
}

function joltMassProps(body, nominalMass) {
  const motion = body.GetMotionProperties();
  const inverse = motion.GetInverseInertiaDiagonal();
  const inertiaRotation = motion.GetInertiaRotation();
  const inverseValues = joltReadVec(inverse);
  return {
    massKg: motion.GetInverseMass() > 0 ? 1 / motion.GetInverseMass() : nominalMass,
    principalInertiaKgM2: inverseValues.map((value) => value > 0 ? 1 / value : 0),
    inertiaLocalRotation: joltReadQuat(inertiaRotation),
  };
}

function joltState(body, props) {
  return {
    ...props,
    centerOfMassM: joltReadVec(body.GetCenterOfMassPosition()),
    linearVelocityMps: joltReadVec(body.GetLinearVelocity()),
    angularVelocityRadPerSec: joltReadVec(body.GetAngularVelocity()),
    rotation: joltReadQuat(body.GetRotation()),
  };
}

function joltImpulseEstimate(J, record, before, after, bodyMass) {
  const aBefore = record.roleA === 'ground' ? staticState() : before[record.roleA];
  const bBefore = record.roleB === 'ground' ? staticState() : before[record.roleB];
  const aAfter = record.roleA === 'ground' ? staticState() : after[record.roleA];
  const bAfter = record.roleB === 'ground' ? staticState() : after[record.roleB];
  if (!record.contactPoints.length) return { magnitudeNs: 0, workJ: 0 };
  const normal = normalizePairNormal(record.normal, aBefore, bBefore);
  const point = record.contactPoints.reduce((sum, p) => add(sum, scale(p, 1 / record.contactPoints.length)), [0, 0, 0]);
  const relativeBefore = sub(pointVelocity(bBefore, point), pointVelocity(aBefore, point));
  const relativeAfter = sub(pointVelocity(bAfter, point), pointVelocity(aAfter, point));
  const invMassA = record.roleA === 'ground' || record.roleA === 'defender' && bodyMass.kinematic ? 0 : 1 / before[record.roleA].massKg;
  const invMassB = record.roleB === 'ground' || record.roleB === 'defender' && bodyMass.kinematic ? 0 : 1 / before[record.roleB].massKg;
  const inverseMass = invMassA + invMassB;
  const relativeGravity = sub(
    record.roleB === 'ground' ? [0, 0, 0] : GRAVITY,
    record.roleA === 'ground' ? [0, 0, 0] : GRAVITY,
  );
  const impulse = inverseMass > 0
    ? Math.max(0, (dot(sub(relativeAfter, relativeBefore), normal) - dot(relativeGravity, normal) * DT) / inverseMass)
    : 0;
  const workJ = impulseWork(impulse, normal, point, aBefore, aAfter, bBefore, bAfter);
  return { magnitudeNs: impulse, workJ };
}

async function runJolt(angleDeg, speedMps, mode) {
  const J = await initJolt();
  const world = makeJoltWorld(J), ground = addJoltGround(world);
  const scenario = contactSweepScenario(angleDeg, speedMps);
  const direction = [Math.cos(angleDeg * Math.PI / 180), 0, Math.sin(angleDeg * Math.PI / 180)];
  const specs = {
    carrier: { ...scenario.carrier, v: mode === 'dynamic' ? scenario.carrier.v : [0, 0, 0] },
    defender: { ...scenario.defender, v: mode === 'dynamic' ? scenario.defender.v : [-speedMps * direction[0], 0, -speedMps * direction[2]] },
  };
  const carrier = addJoltPlayer(world, specs.carrier), defender = addJoltPlayer(world, specs.defender);
  const carrierProps = joltMassProps(carrier.body, specs.carrier.mass);
  const defenderProps = joltMassProps(defender.body, specs.defender.mass);
  if (mode === 'kinematic') world.bodyInterface.SetMotionType(defender.id, J.EMotionType_Kinematic, J.EActivation_Activate);
  else {
    const vCarrier = new J.Vec3(...specs.carrier.v), vDefender = new J.Vec3(...specs.defender.v);
    world.bodyInterface.SetLinearVelocity(carrier.id, vCarrier); world.bodyInterface.SetLinearVelocity(defender.id, vDefender);
    J.destroy(vCarrier); J.destroy(vDefender);
  }
  const roleByKey = new Map([
    [joltBodyKey(carrier.id), 'carrier'], [joltBodyKey(defender.id), 'defender'], [joltBodyKey(ground.id), 'ground'],
  ]);
  const bodyIds = new Map([[joltBodyKey(carrier.id), carrier.body], [joltBodyKey(defender.id), defender.body], [joltBodyKey(ground.id), ground.body]]);
  let liveContacts = [];
  const listener = new J.ContactListenerJS();
  listener.OnContactValidate = () => J.ValidateResult_AcceptAllContactsForThisBodyPair;
  listener.OnContactAdded = (body1Ptr, body2Ptr, manifoldPtr) => {
    const b1 = J.wrapPointer(body1Ptr, J.Body), b2 = J.wrapPointer(body2Ptr, J.Body);
    const id1 = joltBodyKey(b1.GetID()), id2 = joltBodyKey(b2.GetID());
    const roleA = roleByKey.get(id1), roleB = roleByKey.get(id2);
    const pairType = roleA === 'carrier' && roleB === 'defender' || roleA === 'defender' && roleB === 'carrier'
      ? 'carrier_defender'
      : roleA === 'carrier' || roleB === 'carrier' ? 'carrier_ground' : 'defender_ground';
    const manifold = J.wrapPointer(manifoldPtr, J.ContactManifold);
    const points = [];
    const relativePoints = manifold.get_mRelativeContactPointsOn1();
    for (let i = 0; i < relativePoints.size(); i++) {
      const p1 = manifold.GetWorldSpaceContactPointOn1(i), p2 = manifold.GetWorldSpaceContactPointOn2(i);
      const a = joltReadVec(p1), b = joltReadVec(p2);
      points.push(scale(add(a, b), 0.5));
    }
    liveContacts.push({
      roleA, roleB, pairType,
      normal: joltReadVec(manifold.get_mWorldSpaceNormal()),
      contactPoints: points,
      penetrationDepthM: Math.max(0, manifold.get_mPenetrationDepth()),
      source: 'jolt_relative_velocity_inverse_mass_estimate',
    });
  };
  listener.OnContactPersisted = listener.OnContactAdded;
  listener.OnContactRemoved = () => {};
  world.physics.SetContactListener(listener);
  const props = { carrier: carrierProps, defender: defenderProps };
  const players = { carrier: carrier.body, defender: defender.body };
  const initial = Object.fromEntries(Object.entries(players).map(([role, body]) => [role, joltState(body, props[role])]));
  const rawFrames = [];
  const massMeta = { kinematic: mode === 'kinematic' };
  for (let tick = 1; tick <= 180; tick++) {
    const before = Object.fromEntries(Object.entries(players).map(([role, body]) => [role, joltState(body, props[role])]));
    if (mode === 'kinematic') {
      const current = world.bodyInterface.GetPosition(defender.id), rotation = world.bodyInterface.GetRotation(defender.id);
      const target = new J.RVec3(current.GetX() + specs.defender.v[0] * DT, current.GetY(), current.GetZ() + specs.defender.v[2] * DT);
      world.bodyInterface.MoveKinematic(defender.id, target, rotation, DT);
      J.destroy(target);
    }
    liveContacts = [];
    world.jolt.Step(DT, 1);
    const after = Object.fromEntries(Object.entries(players).map(([role, body]) => [role, joltState(body, props[role])]));
    const contactImpulses = liveContacts.map((contact) => ({
      pairType: contact.pairType,
      ...joltImpulseEstimate(J, contact, before, after, massMeta),
      source: contact.source,
    }));
    const activePairs = new Set(liveContacts.map((contact) => contact.pairType));
    rawFrames.push({
      tick,
      states: after,
      contactImpulses,
      contactPairCount: activePairs.size,
      carrierTiltDeg: tiltFromQuaternion(after.carrier.rotation),
    });
  }
  for (const id of [carrier.id, defender.id, ground.id]) {
    world.bodyInterface.RemoveBody(id); world.bodyInterface.DestroyBody(id);
  }
  J.destroy(world.jolt); J.destroy(listener);
  return summarizeFrames(rawFrames, initial, 'jolt-physics-js', mode, angleDeg, speedMps);
}

function summarizeVerdict(cells) {
  const target = cells.find((cell) => cell.engine === 'jolt-physics-js' && cell.approachAngleDeg === 60 && cell.closingSpeedMps === 6);
  const dynamic = target.modes.dynamic.energySummary;
  const peakFrame = target.modes.dynamic.frames.find((frame) => frame.tick === target.modes.dynamic.peakTick);
  const firstFrame = target.modes.dynamic.frames[0];
  const defenderAtPeak = peakFrame.bodies.defender;
  const carrierAtPeak = peakFrame.bodies.carrier;
  const normalWorkMagnitudeJ = Math.abs(dynamic.summedNormalImpulseWorkJ);
  const unexplainedResidualJ = Math.abs(dynamic.summedEnergyResidualAfterNormalImpulseJ);
  const defenderKineticIncreaseJ = Math.max(0,
    defenderAtPeak.linearKEJ + defenderAtPeak.rotationalKEJ
      - firstFrame.bodies.defender.linearKEJ - firstFrame.bodies.defender.rotationalKEJ);
  const defenderPotentialEnergyReleasedJ = Math.max(0,
    firstFrame.bodies.defender.gravitationalPEJ - defenderAtPeak.gravitationalPEJ);
  const divertedEnergyJ = defenderKineticIncreaseJ + defenderPotentialEnergyReleasedJ;
  const energyChangeFraction = unexplainedResidualJ / Math.max(normalWorkMagnitudeJ, Math.abs(dynamic.netTotalMechanicalEnergyChangeJ), 1);
  const verdict = divertedEnergyJ > unexplainedResidualJ
    ? 'energy_diverted_into_defender_motion'
    : 'nonphysical_energy_change_at_contact';
  return {
    centralCell: { engine: target.engine, approachAngleDeg: 60, closingSpeedMps: 6, peakTiltDeg: target.modes.dynamic.peakTiltDeg, peakTick: target.modes.dynamic.peakTick },
    rule: 'Compare defender kinetic-energy increase plus gravitational potential energy released by descent at the carrier-tilt peak with the absolute whole-system residual after normal-impulse work; this is a diagnostic bookkeeping comparison, not a calibrated physicality threshold.',
    peakEnergyJ: {
      carrierTotalMechanicalEnergyJ: carrierAtPeak.totalMechanicalEnergyJ,
      carrierLinearKEJ: carrierAtPeak.linearKEJ,
      carrierRotationalKEJ: carrierAtPeak.rotationalKEJ,
      carrierGravitationalPEJ: carrierAtPeak.gravitationalPEJ,
      defenderTotalMechanicalEnergyJ: defenderAtPeak.totalMechanicalEnergyJ,
      defenderLinearKEJ: defenderAtPeak.linearKEJ,
      defenderRotationalKEJ: defenderAtPeak.rotationalKEJ,
      defenderGravitationalPEJ: defenderAtPeak.gravitationalPEJ,
      defenderKineticEnergyIncreaseFromFirstLoggedTickJ: defenderKineticIncreaseJ,
      defenderGravitationalPotentialEnergyReleasedByDescentJ: defenderPotentialEnergyReleasedJ,
      defenderMotionEnergyActivityJ: divertedEnergyJ,
    },
    wholeSystemLedgerJ: {
      netMechanicalEnergyChange: dynamic.netTotalMechanicalEnergyChangeJ,
      measuredNormalImpulseWork: dynamic.summedNormalImpulseWorkJ,
      residualAfterNormalImpulseWork: dynamic.summedEnergyResidualAfterNormalImpulseJ,
      summedNormalImpulseMagnitudeNs: dynamic.summedNormalImpulseMagnitudeNs,
      residualToWorkOrNetChangeRatio: energyChangeFraction,
    },
    verdict,
    interpretation: verdict === 'energy_diverted_into_defender_motion'
      ? 'The defender kinetic-energy increase plus potential energy released by descent exceeds the whole-system residual after measured normal-impulse work. This supports two-body energy transfer in this probe, but does not establish that the contact model is physically accurate.'
      : 'The whole-system energy residual after measured normal-impulse work is at least as large as the defender kinetic-energy increase plus potential energy released by descent. The ledger favors unexplained energy change; unmeasured tangential friction work, damping, positional correction, and Jolt impulse estimation remain confounds, so this does not prove a solver artifact.',
    matchedDynamicCellVerdicts: cells.filter((cell) => cell.modes.dynamic).map((cell) => {
      const mode = cell.modes.dynamic;
      const peak = mode.frames.find((frame) => frame.tick === mode.peakTick);
      const first = mode.frames[0];
      const kineticIncrease = Math.max(0,
        peak.bodies.defender.linearKEJ + peak.bodies.defender.rotationalKEJ
          - first.bodies.defender.linearKEJ - first.bodies.defender.rotationalKEJ);
      const potentialRelease = Math.max(0, first.bodies.defender.gravitationalPEJ - peak.bodies.defender.gravitationalPEJ);
      const motionActivity = kineticIncrease + potentialRelease;
      const residual = Math.abs(mode.energySummary.summedEnergyResidualAfterNormalImpulseJ);
      return {
        engine: cell.engine,
        approachAngleDeg: cell.approachAngleDeg,
        closingSpeedMps: cell.closingSpeedMps,
        peakTiltDeg: mode.peakTiltDeg,
        peakTick: mode.peakTick,
        defenderKineticIncreaseJ: kineticIncrease,
        defenderPotentialEnergyReleasedByDescentJ: potentialRelease,
        defenderMotionEnergyActivityJ: motionActivity,
        residualAfterNormalImpulseWorkJ: residual,
        verdict: motionActivity > residual ? 'energy_diverted_into_defender_motion' : 'nonphysical_energy_change_at_contact',
      };
    }),
    comparisonCellIds: cells.map((cell) => `${cell.engine}:${cell.approachAngleDeg}deg:${cell.closingSpeedMps}mps`),
  };
}

export async function runContactEnergy() {
  const versions = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  const cells = [];
  for (const [approachAngleDeg, closingSpeedMps] of CELLS) {
    for (const engine of ENGINES) {
      const modes = {};
      for (const mode of ['dynamic', 'kinematic']) {
        modes[mode] = engine === 'rapier3d-compat'
          ? await runRapier(approachAngleDeg, closingSpeedMps, mode)
          : await runJolt(approachAngleDeg, closingSpeedMps, mode);
      }
      cells.push({
        engine,
        engineVersion: versions.packages[engine === 'rapier3d-compat' ? 'node_modules/@dimforge/rapier3d-compat' : 'node_modules/jolt-physics'].version,
        approachAngleDeg,
        closingSpeedMps,
        timestepSeconds: DT,
        framesPerMode: 180,
        energyModel: {
          carrierAndDefenderNominalMassKg: [96, 108],
          kinematicEnergyNote: 'Kinematic defender KE/PE uses cached nominal dynamic mass and inertia for comparison; the prescribed body is an external motion/energy reservoir and is excluded from claims of closed-system conservation.',
          potentialReference: 'Each body potential is zero at its first post-step COM height.',
        },
        modes,
      });
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model },
    method: {
      timestepSeconds: DT,
      cells: CELLS.map(([approachAngleDeg, closingSpeedMps]) => ({ approachAngleDeg, closingSpeedMps })),
      modeLabels: { dynamic: 'both players dynamic; existing carrier-moving contact sweep', kinematic: 'stationary carrier and kinematic defender moving at matched relative closing speed' },
      rotationalEnergy: '0.5 times angular velocity squared in the composed world/principal-inertia frame, weighted by the engine-reported principal moments.',
      contactWork: 'Normal impulse work is impulse magnitude multiplied by the average pre/post relative point velocity projected on the contact normal. Rapier uses solver impulses; Jolt infers each pair impulse from pre/post relative normal point velocity and inverse mass, without direct solver-lambda access.',
      contactStepDefinition: 'contactStep means at least one player-player or player-ground manifold is active. tackleContactStep means a nonzero carrier-defender normal impulse. Ground support and player damping are present in nominally non-tackle-contact steps.',
      energyConservationLimit: `Strictly contact-free gravity-only frames are checked against ${NO_CONTACT_ENERGY_BOUND_J_PER_STEP} J per step when present. These grounded scenarios currently have zero such frames, so the gravity-only conservation assertion has no empirical coverage. Non-tackle steps still include ground support, friction, damping, and measured normal impulses.`,
      positionIntegration: 'Logged displacement is compared with post-step COM velocity times fixed dt; maximum accepted per-step residual is 0.05 m.',
      randomOutcomeDraw: false,
    },
    acceptanceBounds: {
      maximumCarrierIntegrationResidualM: 0.05,
      maximumStrictNoContactEnergyDriftJPerStep: NO_CONTACT_ENERGY_BOUND_J_PER_STEP,
    },
    cells,
    centralVerdict: summarizeVerdict(cells),
  };
}

if (process.argv[1]?.endsWith('/contact-energy.mjs')) {
  const result = await runContactEnergy();
  const path = new URL('./results/contact-energy.json', import.meta.url);
  await mkdir(new URL('./results/', import.meta.url), { recursive: true });
  await writeFile(path, `${JSON.stringify(result)}\n`);
  console.log(JSON.stringify({ output: path.pathname, cells: result.cells.length, verdict: result.centralVerdict }, null, 2));
}
