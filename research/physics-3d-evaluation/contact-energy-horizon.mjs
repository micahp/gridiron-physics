import initJolt from 'jolt-physics';
import RAPIER from '@dimforge/rapier3d-compat';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { BODY_LAYOUT, DT, contactSweepScenario } from './scenarios.js';

const HORIZON_TICKS = 900;
const SAMPLE_TICKS = [180, 360, 600, 900];
const CELLS = [[60, 6], [30, 8]];
const ENGINES = ['rapier3d-compat', 'jolt-physics-js'];
const G = 9.81;
const GRAVITY = [0, -G, 0];
const SATURATION_WINDOW_TICKS = 100;
const SATURATION_DELTA_DEG = 0.05;
const GRAVITY_ONLY_STEP_DRIFT_BOUND_J = 0.75;
const GRAVITY_ONLY_CUMULATIVE_DRIFT_BOUND_J = 625;

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const magnitude = (a) => Math.hypot(...a);
const asArray = (v) => Array.isArray(v) ? v : [v.x, v.y, v.z];
const clamp = (x) => Math.max(-1, Math.min(1, x));
const tiltDeg = (q) => Math.acos(clamp(1 - 2 * (q[0] ** 2 + q[2] ** 2))) * 180 / Math.PI;
const quatArray = (q) => [q.x, q.y, q.z, q.w];
const qConjugate = ([x, y, z, w]) => [-x, -y, -z, w];

function qMultiply([x1, y1, z1, w1], [x2, y2, z2, w2]) {
  return [
    w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
    w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
    w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
  ];
}

function rotate([x, y, z], [qx, qy, qz, qw]) {
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx];
}

function rapierMassProps(body, nominalMass) {
  const principal = asArray(body.principalInertia({ x: 0, y: 0, z: 0 }));
  const frame = quatArray(body.principalInertiaLocalFrame({ x: 0, y: 0, z: 0, w: 1 }));
  return {
    massKg: body.mass() > 0 ? body.mass() : nominalMass,
    principalInertiaKgM2: principal.map((x) => Number.isFinite(x) && x > 0 ? x : 0),
    inertiaLocalRotation: frame,
  };
}

function rapierBodyState(body, props) {
  const p = body.worldCom({ x: 0, y: 0, z: 0 });
  const v = body.linvel(), w = body.angvel();
  return {
    ...props,
    positionM: asArray(p),
    linearVelocityMps: asArray(v),
    angularVelocityRadPerSec: asArray(w),
    rotation: quatArray(body.rotation()),
  };
}

function kineticEnergy(state) {
  const linearKEJ = 0.5 * state.massKg * dot(state.linearVelocityMps, state.linearVelocityMps);
  const principalFrame = qMultiply(state.rotation, state.inertiaLocalRotation);
  const omegaLocal = rotate(state.angularVelocityRadPerSec, qConjugate(principalFrame));
  const rotationalKEJ = 0.5 * dot(state.principalInertiaKgM2, omegaLocal.map((x) => x * x));
  return { linearKEJ, rotationalKEJ, totalKEJ: linearKEJ + rotationalKEJ };
}

function makeSpecs(angleDeg, speedMps, mode) {
  const source = contactSweepScenario(angleDeg, speedMps);
  const direction = [Math.cos(angleDeg * Math.PI / 180), 0, Math.sin(angleDeg * Math.PI / 180)];
  return {
    carrier: { ...source.carrier, v: mode === 'dynamic' ? source.carrier.v : [0, 0, 0] },
    defender: {
      ...source.defender,
      v: mode === 'dynamic' ? source.defender.v : [-speedMps * direction[0], 0, -speedMps * direction[2]],
    },
  };
}

function summarizeHorizon(engine, angleDeg, speedMps, mode, tick0, frames) {
  const tiltTrace = frames.map((frame) => frame.carrierTiltDeg);
  const defenderKineticTrace = frames.map((frame) => frame.defenderKineticEnergyJ);
  const tackleContactTrace = frames.map((frame) => frame.tackleContactActive);
  const anchorTiltDeg = Object.fromEntries(SAMPLE_TICKS.map((tick) => [tick, tiltTrace[tick - 1]]));
  const windows = [];
  for (let endTick = SATURATION_WINDOW_TICKS; endTick <= HORIZON_TICKS; endTick += SATURATION_WINDOW_TICKS) {
    const startTiltDeg = endTick === SATURATION_WINDOW_TICKS ? tick0.carrierTiltDeg : tiltTrace[endTick - SATURATION_WINDOW_TICKS - 1];
    const endTiltDeg = tiltTrace[endTick - 1];
    windows.push({ startTick: endTick - SATURATION_WINDOW_TICKS, endTick, deltaTiltDeg: endTiltDeg - startTiltDeg });
  }
  let peakTick = 0, peakTiltDeg = tick0.carrierTiltDeg;
  for (const frame of frames) {
    if (frame.carrierTiltDeg > peakTiltDeg) {
      peakTiltDeg = frame.carrierTiltDeg;
      peakTick = frame.tick;
    }
  }
  const activeIndices = frames.filter((frame) => frame.tackleContactActive).map((frame) => frame.tick);
  let contactWindow = null;
  if (activeIndices.length) {
    const firstTick = activeIndices[0], lastTick = activeIndices.at(-1);
    const beforeFirst = firstTick === 1 ? tick0.defenderKineticEnergyJ : defenderKineticTrace[firstTick - 2];
    const afterLast = defenderKineticTrace[lastTick - 1];
    const activeFrames = frames.filter((frame) => frame.tackleContactActive);
    const maximumActiveFrame = activeFrames.reduce((best, frame) => frame.defenderKineticEnergyJ > best.defenderKineticEnergyJ ? frame : best);
    let summedActiveStepDeltaJ = 0, positiveActiveStepGainJ = 0, negativeActiveStepChangeJ = 0;
    for (const frame of activeFrames) {
      const before = frame.tick === 1 ? tick0.defenderKineticEnergyJ : defenderKineticTrace[frame.tick - 2];
      const change = frame.defenderKineticEnergyJ - before;
      summedActiveStepDeltaJ += change;
      if (change > 0) positiveActiveStepGainJ += change;
      else negativeActiveStepChangeJ += change;
    }
    contactWindow = {
      firstActiveTick: firstTick,
      lastActiveTick: lastTick,
      activeTickCount: activeIndices.length,
      defenderKineticEnergyBeforeFirstContactJ: beforeFirst,
      defenderKineticEnergyAfterLastContactJ: afterLast,
      netDefenderKineticChangeAcrossContactSpanJ: afterLast - beforeFirst,
      maximumDefenderKineticEnergyOnAnActiveContactTickJ: maximumActiveFrame.defenderKineticEnergyJ,
      maximumActiveContactTick: maximumActiveFrame.tick,
      maximumActiveTickGainVsPreContactJ: maximumActiveFrame.defenderKineticEnergyJ - beforeFirst,
      summedDefenderKineticChangeOnActiveTicksJ: summedActiveStepDeltaJ,
      positiveDefenderKineticChangesOnActiveTicksJ: positiveActiveStepGainJ,
      negativeDefenderKineticChangesOnActiveTicksJ: negativeActiveStepChangeJ,
    };
  }
  return {
    engine,
    approachAngleDeg: angleDeg,
    closingSpeedMps: speedMps,
    defenderMotion: mode,
    horizonTicks: HORIZON_TICKS,
    horizonSeconds: HORIZON_TICKS * DT,
    tick0: {
      carrierTiltDeg: tick0.carrierTiltDeg,
      defenderKineticEnergyJ: tick0.defenderKineticEnergyJ,
    },
    tiltAtTicksDeg: anchorTiltDeg,
    terminalSaturation: {
      definition: `absolute tilt change from tick ${HORIZON_TICKS - SATURATION_WINDOW_TICKS} to ${HORIZON_TICKS} is less than ${SATURATION_DELTA_DEG} degrees`,
      finalWindowDeltaDeg: windows.at(-1).deltaTiltDeg,
      saturated: Math.abs(windows.at(-1).deltaTiltDeg) < SATURATION_DELTA_DEG,
    },
    each100TickTiltChange: windows,
    observedMaximum: {
      tiltDeg: peakTiltDeg,
      tick: peakTick,
      atHorizonBoundary: peakTick === HORIZON_TICKS,
      interiorMaximumTick: peakTick > 0 && peakTick < HORIZON_TICKS ? peakTick : null,
    },
    tackleContactWindow: contactWindow,
    traces: {
      carrierTiltDeg: tiltTrace,
      defenderKineticEnergyJ: defenderKineticTrace,
      tackleContactActive: tackleContactTrace,
    },
  };
}

async function runRapierHorizon(angleDeg, speedMps, mode) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  world.integrationParameters.numSolverIterations = 8;
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const ground = world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.2, 30)
    .setTranslation(0, -0.2, 0).setFriction(0.95), groundBody);
  const specs = makeSpecs(angleDeg, speedMps, mode);
  const makePlayer = (role) => {
    const spec = specs[role];
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(...spec.p)
      .setRotation({ x: 0, y: Math.sin((spec.yawRad ?? 0) / 2), z: 0, w: Math.cos((spec.yawRad ?? 0) / 2) })
      .setLinvel(...spec.v)
      .setLinearDamping(0.04).setAngularDamping(0.18).setCcdEnabled(true).setCanSleep(false));
    const colliders = BODY_LAYOUT.map((part) => {
      const desc = part.shape === 'sphere' ? RAPIER.ColliderDesc.ball(part.radius)
        : RAPIER.ColliderDesc.capsule(part.halfHeight, part.radius);
      desc.setTranslation(...part.pos)
        .setRotation(part.axis === 'x' ? { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } : { x: 0, y: 0, z: 0, w: 1 })
        .setMass(spec.mass * part.massShare).setFriction(0.82).setRestitution(0.03);
      return world.createCollider(desc, body);
    });
    const stateProps = rapierMassProps(body, spec.mass);
    if (role === 'defender' && mode === 'kinematic') body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    return { body, colliders, spec, stateProps };
  };
  const carrier = makePlayer('carrier'), defender = makePlayer('defender');
  const state = (player) => rapierBodyState(player.body, player.stateProps);
  const initial = { carrier: state(carrier), defender: state(defender) };
  const tick0 = {
    carrierTiltDeg: tiltDeg(initial.carrier.rotation),
    defenderKineticEnergyJ: kineticEnergy(initial.defender).totalKEJ,
  };
  const frames = [];
  for (let tick = 1; tick <= HORIZON_TICKS; tick++) {
    if (mode === 'kinematic') {
      const p = defender.body.translation();
      defender.body.setNextKinematicTranslation({
        x: p.x + specs.defender.v[0] * DT,
        y: p.y + specs.defender.v[1] * DT,
        z: p.z + specs.defender.v[2] * DT,
      });
    }
    world.step();
    let tackleContactActive = false;
    for (const a of carrier.colliders) for (const b of defender.colliders) {
      world.contactPair(a, b, (manifold) => {
        if (manifold.numSolverContacts() > 0) tackleContactActive = true;
      });
    }
    const carrierState = state(carrier), defenderState = state(defender);
    frames.push({
      tick,
      carrierTiltDeg: tiltDeg(carrierState.rotation),
      defenderKineticEnergyJ: kineticEnergy(defenderState).totalKEJ,
      tackleContactActive,
    });
  }
  const result = summarizeHorizon('rapier3d-compat', angleDeg, speedMps, mode, tick0, frames);
  world.free();
  return result;
}

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
  const physics = jolt.GetPhysicsSystem();
  const gravity = new J.Vec3(...GRAVITY); physics.SetGravity(gravity); J.destroy(gravity);
  return { J, jolt, physics, bodyInterface: physics.GetBodyInterface(), staticLayer, movingLayer, bodies: [] };
}

function makeJoltShape(J, settings) {
  const result = settings.Create();
  if (!result.IsValid()) throw new Error(`Jolt shape creation failed: ${result.GetError()}`);
  const shape = result.Get(); shape.AddRef(); result.Clear(); settings.Release();
  return shape;
}

function addJoltBody(world, shape, { p, yawRad = 0, mass = 0, motionType, layer, linearDamping = 0.04, angularDamping = 0.18 }) {
  const { J } = world;
  const position = new J.RVec3(...p), axis = new J.Vec3(0, 1, 0), rotation = J.Quat.prototype.sRotation(axis, yawRad);
  const settings = new J.BodyCreationSettings(shape, position, rotation, motionType, layer);
  settings.mFriction = 0.82; settings.mRestitution = 0.03;
  settings.mLinearDamping = linearDamping; settings.mAngularDamping = angularDamping; settings.mAllowSleeping = false;
  if (motionType === J.EMotionType_Dynamic) {
    settings.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
    settings.mMassPropertiesOverride.mMass = mass;
  }
  shape.Release();
  const body = world.bodyInterface.CreateBody(settings), id = body.GetID();
  world.bodyInterface.AddBody(id, J.EActivation_Activate);
  J.destroy(settings); J.destroy(position); J.destroy(axis); J.destroy(rotation);
  world.bodies.push(id);
  return { body, id, mass };
}

function makeJoltHumanoid(world, spec, options = {}) {
  const { J } = world;
  const compound = new J.StaticCompoundShapeSettings();
  for (const part of BODY_LAYOUT) {
    const child = part.shape === 'sphere' ? new J.SphereShapeSettings(part.radius, null)
      : new J.CapsuleShapeSettings(part.halfHeight, part.radius, null);
    const position = new J.Vec3(...part.pos);
    const rotation = part.axis === 'x' ? J.Quat.prototype.sRotation(J.Vec3.prototype.sAxisZ(), Math.PI / 2)
      : J.Quat.prototype.sIdentity();
    compound.AddShapeShapeSettings(position, rotation, child, 0);
    J.destroy(position); J.destroy(rotation);
  }
  return addJoltBody(world, makeJoltShape(J, compound), {
    p: spec.p, yawRad: spec.yawRad ?? 0, mass: spec.mass,
    motionType: J.EMotionType_Dynamic, layer: world.movingLayer, ...options,
  });
}

function readJoltVec(v) { return [v.GetX(), v.GetY(), v.GetZ()]; }
function readJoltQuat(q) { return [q.GetX(), q.GetY(), q.GetZ(), q.GetW()]; }
function joltBodyKey(id) { return id.GetIndexAndSequenceNumber(); }

function joltMassProps(body, nominalMass) {
  const motion = body.GetMotionProperties();
  const inverse = readJoltVec(motion.GetInverseInertiaDiagonal());
  return {
    massKg: motion.GetInverseMass() > 0 ? 1 / motion.GetInverseMass() : nominalMass,
    principalInertiaKgM2: inverse.map((x) => x > 0 ? 1 / x : 0),
    inertiaLocalRotation: readJoltQuat(motion.GetInertiaRotation()),
  };
}

function joltBodyState(body, props) {
  return {
    ...props,
    positionM: readJoltVec(body.GetCenterOfMassPosition()),
    linearVelocityMps: readJoltVec(body.GetLinearVelocity()),
    angularVelocityRadPerSec: readJoltVec(body.GetAngularVelocity()),
    rotation: readJoltQuat(body.GetRotation()),
  };
}

function destroyJoltWorld(world, listener = null) {
  for (const id of world.bodies.reverse()) {
    world.bodyInterface.RemoveBody(id);
    world.bodyInterface.DestroyBody(id);
  }
  if (listener) world.J.destroy(listener);
  world.J.destroy(world.jolt);
}

async function runJoltHorizon(angleDeg, speedMps, mode) {
  const J = await initJolt();
  const world = makeJoltWorld(J);
  const groundShape = makeJoltShape(J, new J.BoxShapeSettings(new J.Vec3(30, 0.2, 30), 0.05, null));
  const ground = addJoltBody(world, groundShape, { p: [0, -0.2, 0], motionType: J.EMotionType_Static, layer: world.staticLayer });
  const specs = makeSpecs(angleDeg, speedMps, mode);
  const carrier = makeJoltHumanoid(world, specs.carrier);
  const defender = makeJoltHumanoid(world, specs.defender);
  const props = {
    carrier: joltMassProps(carrier.body, specs.carrier.mass),
    defender: joltMassProps(defender.body, specs.defender.mass),
  };
  if (mode === 'kinematic') world.bodyInterface.SetMotionType(defender.id, J.EMotionType_Kinematic, J.EActivation_Activate);
  else {
    const cv = new J.Vec3(...specs.carrier.v), dv = new J.Vec3(...specs.defender.v);
    world.bodyInterface.SetLinearVelocity(carrier.id, cv); world.bodyInterface.SetLinearVelocity(defender.id, dv);
    J.destroy(cv); J.destroy(dv);
  }
  const initialCarrier = joltBodyState(carrier.body, props.carrier);
  const initialDefender = joltBodyState(defender.body, props.defender);
  const tick0 = {
    carrierTiltDeg: tiltDeg(initialCarrier.rotation),
    defenderKineticEnergyJ: kineticEnergy(initialDefender).totalKEJ,
  };
  const frames = [];
  for (let tick = 1; tick <= HORIZON_TICKS; tick++) {
    if (mode === 'kinematic') {
      const current = world.bodyInterface.GetPosition(defender.id), rotation = world.bodyInterface.GetRotation(defender.id);
      const target = new J.RVec3(
        current.GetX() + specs.defender.v[0] * DT,
        current.GetY() + specs.defender.v[1] * DT,
        current.GetZ() + specs.defender.v[2] * DT,
      );
      world.bodyInterface.MoveKinematic(defender.id, target, rotation, DT);
      J.destroy(target);
    }
    world.jolt.Step(DT, 1);
    const carrierState = joltBodyState(carrier.body, props.carrier);
    const defenderState = joltBodyState(defender.body, props.defender);
    frames.push({
      tick,
      carrierTiltDeg: tiltDeg(carrierState.rotation),
      defenderKineticEnergyJ: kineticEnergy(defenderState).totalKEJ,
      tackleContactActive: world.physics.WereBodiesInContact(carrier.id, defender.id),
    });
  }
  const result = summarizeHorizon('jolt-physics-js', angleDeg, speedMps, mode, tick0, frames);
  destroyJoltWorld(world);
  return result;
}

function rapierPlayer(world, spec, damping = 0.04) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(...spec.p).setLinvel(...spec.v)
    .setLinearDamping(damping).setAngularDamping(damping).setCanSleep(false));
  const colliders = BODY_LAYOUT.map((part) => {
    const desc = part.shape === 'sphere' ? RAPIER.ColliderDesc.ball(part.radius)
      : RAPIER.ColliderDesc.capsule(part.halfHeight, part.radius);
    desc.setTranslation(...part.pos)
      .setRotation(part.axis === 'x' ? { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } : { x: 0, y: 0, z: 0, w: 1 })
      .setMass(spec.mass * part.massShare).setFriction(0).setRestitution(0);
    return world.createCollider(desc, body);
  });
  return { body, colliders };
}

function rapierNoContact(world, a, b) {
  let contact = false;
  for (const ca of a.colliders) for (const cb of b.colliders) {
    world.contactPair(ca, cb, (manifold) => { if (manifold.numContacts() > 0) contact = true; });
  }
  return contact;
}

function gravityEnergy(massKg, y, vy, yReference) {
  return 0.5 * massKg * vy * vy + massKg * G * (y - yReference);
}

async function runRapierGravityOnly() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 }); world.timestep = DT;
  const a = rapierPlayer(world, { p: [0, 100, 0], v: [0, -0.75, 0], mass: 96 }, 0);
  const b = rapierPlayer(world, { p: [20, 120, 0], v: [0, 1.1, 0], mass: 108 }, 0);
  const states = [a, b].map(({ body }) => ({ mass: body.mass(), y0: body.worldCom({ x: 0, y: 0, z: 0 }).y }));
  const state = (player, info) => {
    const p = player.body.worldCom({ x: 0, y: 0, z: 0 }), v = player.body.linvel();
    return gravityEnergy(info.mass, p.y, v.y, info.y0);
  };
  const energyTraceJ = [state(a, states[0]) + state(b, states[1])];
  const contactTrace = [];
  let maximumAngularSpeedRadPerSec = 0;
  for (let tick = 1; tick <= HORIZON_TICKS; tick++) {
    world.step();
    contactTrace.push(rapierNoContact(world, a, b));
    for (const player of [a, b]) maximumAngularSpeedRadPerSec = Math.max(maximumAngularSpeedRadPerSec, magnitude(asArray(player.body.angvel())));
    energyTraceJ.push(state(a, states[0]) + state(b, states[1]));
  }
  world.free();
  return summarizeGravityOnly('rapier3d-compat', energyTraceJ, contactTrace, maximumAngularSpeedRadPerSec);
}

function summarizeGravityOnly(engine, energyTraceJ, contactTrace, maximumAngularSpeedRadPerSec) {
  const stepDeltasJ = energyTraceJ.slice(1).map((energy, index) => energy - energyTraceJ[index]);
  return {
    engine,
    scenario: 'two airborne player proxies at 100 m and 120 m, 20 m horizontal separation, no ground collider, zero damping, gravity only',
    horizonTicks: HORIZON_TICKS,
    horizonSeconds: HORIZON_TICKS * DT,
    contactCount: contactTrace.filter(Boolean).length,
    contactTrace,
    initialMechanicalEnergyJ: energyTraceJ[0],
    finalMechanicalEnergyJ: energyTraceJ.at(-1),
    netMechanicalEnergyDriftJ: energyTraceJ.at(-1) - energyTraceJ[0],
    maximumAbsolutePerStepDriftJ: Math.max(...stepDeltasJ.map(Math.abs)),
    maximumAbsoluteCumulativeDriftJ: Math.max(...energyTraceJ.map((energy) => Math.abs(energy - energyTraceJ[0]))),
    maximumAngularSpeedRadPerSec,
    perStepMechanicalEnergyJ: energyTraceJ,
  };
}

async function runJoltGravityOnly() {
  const J = await initJolt();
  const world = makeJoltWorld(J);
  const a = makeJoltHumanoid(world, { p: [0, 100, 0], v: [0, -0.75, 0], mass: 96 }, { linearDamping: 0, angularDamping: 0 });
  const b = makeJoltHumanoid(world, { p: [20, 120, 0], v: [0, 1.1, 0], mass: 108 }, { linearDamping: 0, angularDamping: 0 });
  const velocityA = new J.Vec3(0, -0.75, 0), velocityB = new J.Vec3(0, 1.1, 0);
  world.bodyInterface.SetLinearVelocity(a.id, velocityA); world.bodyInterface.SetLinearVelocity(b.id, velocityB);
  J.destroy(velocityA); J.destroy(velocityB);
  const initialA = joltBodyState(a.body, joltMassProps(a.body, 96));
  const initialB = joltBodyState(b.body, joltMassProps(b.body, 108));
  const state = (player, initial) => {
    const position = readJoltVec(player.body.GetCenterOfMassPosition());
    const velocity = readJoltVec(player.body.GetLinearVelocity());
    return gravityEnergy(initial.massKg, position[1], velocity[1], initial.positionM[1]);
  };
  const energyTraceJ = [state(a, initialA) + state(b, initialB)];
  const contactTrace = [];
  let maximumAngularSpeedRadPerSec = 0;
  for (let tick = 1; tick <= HORIZON_TICKS; tick++) {
    world.jolt.Step(DT, 1);
    contactTrace.push(world.physics.WereBodiesInContact(a.id, b.id));
    for (const player of [a, b]) maximumAngularSpeedRadPerSec = Math.max(maximumAngularSpeedRadPerSec,
      magnitude(readJoltVec(player.body.GetAngularVelocity())));
    energyTraceJ.push(state(a, initialA) + state(b, initialB));
  }
  const result = summarizeGravityOnly('jolt-physics-js', energyTraceJ, contactTrace, maximumAngularSpeedRadPerSec);
  destroyJoltWorld(world);
  return result;
}

async function buildLegacyAttribution() {
  const legacy = JSON.parse(await readFile(new URL('./results/contact-energy.json', import.meta.url), 'utf8'));
  const cell = legacy.cells.find((entry) => entry.engine === 'jolt-physics-js'
    && entry.approachAngleDeg === 60 && entry.closingSpeedMps === 6);
  const mode = cell.modes.dynamic;
  const first = mode.frames[0], at180 = mode.frames[179];
  const defenderKE = (frame) => frame.bodies.defender.linearKEJ + frame.bodies.defender.rotationalKEJ;
  const activeFrames = mode.frames.filter((frame) => frame.tackleContactStep);
  const firstContact = activeFrames[0], lastContact = activeFrames.at(-1);
  const beforeFirstContact = mode.frames[firstContact.tick - 2];
  const beforeContactKE = defenderKE(beforeFirstContact);
  const contactSpanPeak = activeFrames.reduce((best, frame) => defenderKE(frame) > defenderKE(best) ? frame : best);
  const deltaStepsJ = mode.frames.reduce((sum, frame) => sum + frame.deltaTotalMechanicalEnergyJ, 0);
  const tick0TotalJ = mode.energySummary.totalMechanicalEnergyStartJ;
  const tick1TotalJ = first.totalMechanicalEnergyJ;
  const tick180TotalJ = at180.totalMechanicalEnergyJ;
  const firstTo180StepSumJ = mode.frames.slice(1).reduce((sum, frame) => sum + frame.deltaTotalMechanicalEnergyJ, 0);
  const defenderPotentialReleaseJ = first.bodies.defender.gravitationalPEJ - at180.bodies.defender.gravitationalPEJ;
  const defenderKineticChangeTick1To180J = defenderKE(at180) - defenderKE(first);
  const contactSpanNetKineticChangeJ = defenderKE(lastContact) - beforeContactKE;
  const activeFramePeakGainJ = defenderKE(contactSpanPeak) - beforeContactKE;
  const oldResidualJ = mode.energySummary.summedEnergyResidualAfterNormalImpulseJ;
  return {
    sourceArtifact: 'results/contact-energy.json (frozen at base ba5661a)',
    centralCell: { engine: cell.engine, approachAngleDeg: cell.approachAngleDeg, closingSpeedMps: cell.closingSpeedMps },
    observedAtTick180: {
      defenderKineticEnergyAtFirstLoggedTickJ: defenderKE(first),
      defenderKineticEnergyAtTick180J: defenderKE(at180),
      defenderKineticChangeTick1To180J,
      defenderPotentialEnergyReleasedFromTick1To180J: defenderPotentialReleaseJ,
      wholeSystemNetEnergyChangeTick0To180J: mode.energySummary.netTotalMechanicalEnergyChangeJ,
      normalImpulseWorkJ: mode.energySummary.summedNormalImpulseWorkJ,
      residualAfterImpulseWorkJ: oldResidualJ,
    },
    activeTackleContactWindow: {
      firstTackleContactTick: firstContact.tick,
      lastTackleContactTick: lastContact.tick,
      activeTackleContactTickCount: activeFrames.length,
      defenderKineticEnergyBeforeFirstContactJ: beforeContactKE,
      netDefenderKineticChangeBeforeFirstToAfterLastContactJ: contactSpanNetKineticChangeJ,
      largestDefenderKineticEnergyDuringActiveContactJ: defenderKE(contactSpanPeak),
      largestActiveContactTick: contactSpanPeak.tick,
      largestActiveContactFrameGainVsPreContactJ: activeFramePeakGainJ,
      meaning: 'These contact-window kinetic values are reported separately from descent; ground contact and gravity overlap, so the transient rise alone is not a gravity-corrected carrier-to-defender transfer estimate.',
    },
    revisedVerdict: 'not_distinguishable_by_this_ledger',
    revisedRule: 'Do not treat defender gravitational potential energy release as energy transferred from the carrier. A transfer label requires a positive defender kinetic-energy gain attributable to player-player contact after gravity and ground effects are separated; the current 180-tick ledger does not isolate those contributions.',
    verdictReason: defenderKineticChangeTick1To180J <= 0
      ? 'The first-logged-tick to tick-180 defender kinetic-energy change is nonpositive; the 589.812 J descent term is gravitational potential release. A transient contact-frame kinetic rise exists, but it is not separated from gravity and simultaneous ground contact.'
      : 'The endpoint kinetic-energy change alone is not sufficient to attribute energy transfer without separating gravity and ground effects.',
    previousEnergyResidualJ: oldResidualJ,
    conservationBoundClaim: 'not_applicable_to_tackle_run; use the independent gravity-only control below for conservation coverage',
    deltaTelescopingAudit: {
      startingState: 'pre-step tick 0 state from energySummary.totalMechanicalEnergyStartJ',
      firstLoggedState: 'post-step tick 1 totalMechanicalEnergyJ',
      finalState: 'post-step tick 180 totalMechanicalEnergyJ',
      tick0ToTick1EnergyChangeJ: tick1TotalJ - tick0TotalJ,
      sumOfTick0Through180StepChangesJ: deltaStepsJ,
      tick0ToTick180EndpointChangeJ: tick180TotalJ - tick0TotalJ,
      telescopeErrorJ: deltaStepsJ - (tick180TotalJ - tick0TotalJ),
      tick1ToTick180EndpointChangeJ: tick180TotalJ - tick1TotalJ,
      sumOfOnlyTick1Through180StepChangesJ: firstTo180StepSumJ,
      reportedGapFromMismatchedBaselineJ: (deltaStepsJ - firstTo180StepSumJ),
      explanation: 'There is no missing 1.833 J term: the per-step sum includes the pre-step tick 0 to first logged post-step tick 1 change (-1.833409852 J), while the quoted last-minus-first comparison starts at tick 1. From the same tick 0 baseline, per-step changes telescope to the endpoint delta within floating-point roundoff.',
    },
  };
}

export async function runContactEnergyHorizon() {
  const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  const cells = [];
  for (const [angleDeg, speedMps] of CELLS) {
    for (const engine of ENGINES) {
      const modes = {};
      for (const mode of ['dynamic', 'kinematic']) {
        modes[mode] = engine === 'rapier3d-compat'
          ? await runRapierHorizon(angleDeg, speedMps, mode)
          : await runJoltHorizon(angleDeg, speedMps, mode);
      }
      cells.push({
        engine,
        engineVersion: lock.packages[engine === 'rapier3d-compat'
          ? 'node_modules/@dimforge/rapier3d-compat' : 'node_modules/jolt-physics'].version,
        approachAngleDeg: angleDeg,
        closingSpeedMps: speedMps,
        timestepSeconds: DT,
        modes,
      });
    }
  }
  const gravityOnly = [await runRapierGravityOnly(), await runJoltGravityOnly()];
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model },
    method: {
      cells: CELLS.map(([approachAngleDeg, closingSpeedMps]) => ({ approachAngleDeg, closingSpeedMps })),
      engines: ENGINES,
      defenderModes: ['dynamic', 'kinematic'],
      horizonTicks: HORIZON_TICKS,
      horizonSeconds: HORIZON_TICKS * DT,
      timestepSeconds: DT,
      sampledTiltTicks: SAMPLE_TICKS,
      saturationRule: `terminal saturation means absolute tilt change from tick 800 to tick 900 is below ${SATURATION_DELTA_DEG} degrees; all 100-tick window changes are also serialized`,
      geometryAndSolver: 'Same frozen contactSweepScenario, BODY_LAYOUT, masses, ground geometry, friction, damping, CCD, and solver settings as contact-energy.mjs; only duration is extended to 900 ticks.',
      outcomeRandomDraw: false,
      attribution: 'A defender descent is gravitational potential release, not by itself evidence of carrier-to-defender transfer. The separate contact-window kinetic changes retain simultaneous ground/gravity confounds and are not promoted to a transfer claim.',
    },
    acceptanceBounds: {
      gravityOnlyMaximumAbsolutePerStepDriftJ: GRAVITY_ONLY_STEP_DRIFT_BOUND_J,
      gravityOnlyMaximumAbsoluteCumulativeDriftJ: GRAVITY_ONLY_CUMULATIVE_DRIFT_BOUND_J,
      priorUnexercisedBoundJPerStep: 0.05,
      explanation: 'The measured free-fall integration drift is nonzero: maxima are reported in the control artifact and must stay within 0.75 J per step and 625 J cumulatively over 900 steps for this 204 kg scene. These empirical envelopes test numerical stability, not exact conservation. The earlier 0.05 J limit was never exercised in a contact-free frame and is exceeded here.',
      terminalSaturationDeltaDegPer100Ticks: SATURATION_DELTA_DEG,
    },
    cells,
    revisedEnergyAttribution: await buildLegacyAttribution(),
    gravityOnlyControl: {
      method: 'Two separated humanoid proxies begin airborne at 100 m and 120 m, have zero damping and no ground collider, and fall only under gravity for 900 fixed steps. Their 20 m horizontal separation prevents body-body contact.',
      runs: gravityOnly,
    },
  };
}

if (process.argv[1]?.endsWith('/contact-energy-horizon.mjs')) {
  const result = await runContactEnergyHorizon();
  const path = new URL('./results/contact-energy-horizon.json', import.meta.url);
  await mkdir(new URL('./results/', import.meta.url), { recursive: true });
  await writeFile(path, `${JSON.stringify(result)}\n`);
  console.log(JSON.stringify({
    output: path.pathname,
    runs: result.cells.length * 2,
    gravityOnly: result.gravityOnlyControl.runs.map(({ engine, maximumAbsolutePerStepDriftJ, contactCount }) => ({ engine, maximumAbsolutePerStepDriftJ, contactCount })),
    verdict: result.revisedEnergyAttribution.revisedVerdict,
    horizon: result.method.horizonTicks,
  }, null, 2));
}
