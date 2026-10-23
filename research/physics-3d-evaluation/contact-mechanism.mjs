import initJolt from 'jolt-physics';
import RAPIER from '@dimforge/rapier3d-compat';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { BODY_LAYOUT, DT, contactSweepScenario } from './scenarios.js';

const CELLS = [[60, 4], [60, 6], [60, 8], [30, 8]];
const ENGINES = ['rapier3d-compat', 'jolt-physics-js'];
const GROUPS = ['carrierDefender', 'carrierGround', 'defenderGround'];
const GRAVITY = [0, -9.81, 0];

const vec3 = (v) => [v.x, v.y, v.z];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (x) => Math.max(-1, Math.min(1, x));
const toDeg = (rad) => rad * 180 / Math.PI;
const tiltDeg = (q) => toDeg(Math.acos(clamp(1 - 2 * (q.x * q.x + q.z * q.z))));

function peakFrame(frames) {
  let peak = null;
  for (const frame of frames) {
    if (!peak || frame.carrierTiltDeg > peak.carrierTiltDeg) peak = frame;
  }
  return peak;
}

function groupRecord(pairId, manifolds, impulseSource) {
  const active = manifolds.length > 0;
  return {
    pairCount: active ? 1 : 0,
    manifoldCount: manifolds.length,
    contactPointCount: manifolds.reduce((sum, manifold) => sum + manifold.contactPoints.length, 0),
    normalImpulseNs: manifolds.reduce((sum, manifold) => sum + manifold.normalImpulseNs, 0),
    normalImpulseSource: impulseSource,
    maximumPenetrationDepthM: active
      ? Math.max(...manifolds.map((manifold) => manifold.penetrationDepthM))
      : null,
    contactActive: active,
    separated: !active,
    pairs: active ? [{
      pairId,
      manifolds,
      normalImpulseNs: manifolds.reduce((sum, manifold) => sum + manifold.normalImpulseNs, 0),
      maximumPenetrationDepthM: Math.max(...manifolds.map((manifold) => manifold.penetrationDepthM)),
    }] : [],
  };
}

function phaseAtPeak(frame) {
  const tackle = frame.contacts.carrierDefender.contactActive;
  const carrierGround = frame.contacts.carrierGround.contactActive;
  const defenderGround = frame.contacts.defenderGround.contactActive;
  return {
    label: tackle
      ? 'during_carrier_defender_contact'
      : carrierGround || defenderGround
        ? 'after_separation_with_ground_contacts_only'
        : 'after_separation_without_ground_contact',
    carrierDefenderContactActive: tackle,
    carrierGroundContactActive: carrierGround,
    defenderGroundContactActive: defenderGround,
  };
}

function makeStepRecord(tick, carrierTilt, manifolds, impulseSource) {
  const contacts = Object.fromEntries(GROUPS.map((group) => [
    group,
    groupRecord(group, manifolds[group], impulseSource),
  ]));
  return {
    tick,
    timeSeconds: tick * DT,
    carrierTiltDeg: carrierTilt,
    contactPairCount: Object.values(contacts).reduce((sum, record) => sum + record.pairCount, 0),
    contactPointCount: Object.values(contacts).reduce((sum, record) => sum + record.contactPointCount, 0),
    contacts,
  };
}

function summarizeMode(mode, frames, trace = null) {
  const peak = peakFrame(frames);
  const peakPhase = phaseAtPeak(peak);
  const summary = {
    defenderMotion: mode,
    carrierPeakTiltDeg: peak.carrierTiltDeg,
    peakTick: peak.tick,
    peakTimeSeconds: peak.timeSeconds,
    peakPhase,
    frames,
  };
  if (trace) {
    summary.tiltTraceReference = {
      file: 'results/tilt-traces.json',
      engine: trace.engine,
      approachAngleDeg: trace.approachAngleDeg,
      closingSpeedMps: trace.closingSpeedMps,
      peakTick: trace.carrier.peakTick,
      peakTimeSeconds: trace.carrier.peakTimeSeconds,
      peakTiltDeg: trace.carrier.peakTiltDeg,
      traceFrameAtPeak: trace.frames.find((frame) => frame.tick === trace.carrier.peakTick),
      replayPeakMatchesTracePeak: peak.tick === trace.carrier.peakTick,
      peakTiltDeltaDeg: peak.carrierTiltDeg - trace.carrier.peakTiltDeg,
      traceFrameContactGround: trace.frames.find((frame) => frame.tick === trace.carrier.peakTick)?.players.carrier.groundContact,
    };
  }
  return summary;
}

function newManifoldGroups() {
  return { carrierDefender: [], carrierGround: [], defenderGround: [] };
}

function rotationForYaw(yaw) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

async function rapierRun(angleDeg, speedMps, defenderMotion) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: GRAVITY[1], z: 0 });
  world.timestep = DT;
  world.integrationParameters.numSolverIterations = 8;

  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const groundCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(30, 0.2, 30).setTranslation(0, -0.2, 0).setFriction(0.95),
    groundBody,
  );
  const scenario = contactSweepScenario(angleDeg, speedMps);
  const direction = [Math.cos(angleDeg * Math.PI / 180), 0, Math.sin(angleDeg * Math.PI / 180)];
  const specs = {
    carrier: { ...scenario.carrier, v: defenderMotion === 'dynamic' ? scenario.carrier.v : [0, 0, 0] },
    defender: {
      ...scenario.defender,
      v: defenderMotion === 'dynamic'
        ? scenario.defender.v
        : [-speedMps * direction[0], 0, -speedMps * direction[2]],
    },
  };

  const addPlayer = (spec, isKinematic) => {
    const descriptor = isKinematic
      ? RAPIER.RigidBodyDesc.kinematicPositionBased()
      : RAPIER.RigidBodyDesc.dynamic().setLinvel(...spec.v).setCcdEnabled(true);
    const body = world.createRigidBody(descriptor
      .setTranslation(...spec.p)
      .setRotation(rotationForYaw(spec.yawRad ?? 0))
      .setLinearDamping(0.04)
      .setAngularDamping(0.18)
      .setCanSleep(false));
    const colliders = BODY_LAYOUT.map((part) => {
      const collider = part.shape === 'sphere'
        ? RAPIER.ColliderDesc.ball(part.radius)
        : RAPIER.ColliderDesc.capsule(part.halfHeight, part.radius);
      const rotation = part.axis === 'x' ? { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } : { x: 0, y: 0, z: 0, w: 1 };
      collider.setTranslation(...part.pos).setRotation(rotation)
        .setMass(spec.mass * part.massShare).setFriction(0.82).setRestitution(0.03);
      return world.createCollider(collider, body);
    });
    return { body, colliders, spec, isKinematic };
  };

  const carrier = addPlayer(specs.carrier, false);
  const defender = addPlayer(specs.defender, defenderMotion === 'kinematic');
  const pairs = [
    { id: 'carrier-defender', group: 'carrierDefender', a: carrier.colliders, b: defender.colliders },
    { id: 'carrier-ground', group: 'carrierGround', a: carrier.colliders, b: [groundCollider] },
    { id: 'defender-ground', group: 'defenderGround', a: defender.colliders, b: [groundCollider] },
  ];
  const frames = [];
  const steps = Math.ceil(scenario.duration / DT);
  for (let tick = 1; tick <= steps; tick++) {
    if (defender.isKinematic) {
      const current = defender.body.translation();
      defender.body.setNextKinematicTranslation({
        x: current.x + specs.defender.v[0] * DT,
        y: current.y,
        z: current.z + specs.defender.v[2] * DT,
      });
    }
    world.step();
    const grouped = newManifoldGroups();
    for (const pair of pairs) {
      for (const [aIndex, a] of pair.a.entries()) for (const [bIndex, b] of pair.b.entries()) {
        world.contactPair(a, b, (manifold, flipped) => {
          const solverContactCount = manifold.numSolverContacts();
          if (!manifold.numContacts() || !solverContactCount) return;
          const n = manifold.normal({ x: 0, y: 0, z: 0 });
          const points = [];
          let impulse = 0;
          let deepest = 0;
          for (let i = 0; i < solverContactCount; i++) {
            const distance = manifold.solverContactDist(i);
            const point = manifold.solverContactPoint(i, { x: 0, y: 0, z: 0 });
            points.push({
              pointWorldM: point ? vec3(point) : null,
              penetrationDepthM: Math.max(0, -distance),
              normalImpulseNs: manifold.contactImpulse(i),
            });
            impulse += manifold.contactImpulse(i);
            deepest = Math.max(deepest, Math.max(0, -distance));
          }
          grouped[pair.group].push({
            colliderPair: [aIndex, bIndex],
            manifoldCount: 1,
            contactPoints: points,
            worldNormalFromFirstShape: vec3(n),
            flippedManifold: flipped,
            normalImpulseNs: impulse,
            penetrationDepthM: deepest,
          });
        });
      }
    }
    const rotation = carrier.body.rotation();
    frames.push(makeStepRecord(tick, tiltDeg(rotation), grouped, 'rapier_solver_contactImpulse'));
  }
  const out = summarizeMode(defenderMotion, frames);
  world.free();
  return out;
}

function makeJoltWorld(J) {
  const staticLayer = 0, movingLayer = 1;
  const pairFilter = new J.ObjectLayerPairFilterTable(2);
  pairFilter.EnableCollision(staticLayer, staticLayer);
  pairFilter.EnableCollision(staticLayer, movingLayer);
  pairFilter.EnableCollision(movingLayer, movingLayer);
  const broad = new J.BroadPhaseLayerInterfaceTable(2, 2);
  const bp0 = new J.BroadPhaseLayer(0), bp1 = new J.BroadPhaseLayer(1);
  broad.MapObjectToBroadPhaseLayer(staticLayer, bp0);
  broad.MapObjectToBroadPhaseLayer(movingLayer, bp1);
  J.destroy(bp0); J.destroy(bp1);
  const vsBroad = new J.ObjectVsBroadPhaseLayerFilterTable(broad, 2, pairFilter, 2);
  const settings = new J.JoltSettings();
  settings.mMaxBodies = 96;
  settings.mMaxBodyPairs = 1024;
  settings.mMaxContactConstraints = 1024;
  settings.mMaxWorkerThreads = 0;
  settings.mBroadPhaseLayerInterface = broad;
  settings.mObjectLayerPairFilter = pairFilter;
  settings.mObjectVsBroadPhaseLayerFilter = vsBroad;
  const jolt = new J.JoltInterface(settings);
  J.destroy(settings);
  const physics = jolt.GetPhysicsSystem();
  physics.SetGravity(new J.Vec3(...GRAVITY));
  return { J, jolt, physics, bodyInterface: physics.GetBodyInterface(), bodies: [], staticLayer, movingLayer };
}

function joltShape(J, settings) {
  const result = settings.Create();
  if (!result.IsValid()) throw new Error(`Jolt shape creation failed: ${result.GetError()}`);
  const shape = result.Get();
  shape.AddRef();
  result.Clear();
  settings.Release();
  return shape;
}

function addJoltBody(world, shape, { p, yawRad = 0, mass, motionType, layer, friction = 0.82, restitution = 0.03 }) {
  const { J } = world;
  const pos = new J.RVec3(...p);
  const axis = new J.Vec3(0, 1, 0);
  const rot = J.Quat.prototype.sRotation(axis, yawRad);
  const settings = new J.BodyCreationSettings(shape, pos, rot, motionType, layer);
  settings.mFriction = friction;
  settings.mRestitution = restitution;
  settings.mLinearDamping = 0.04;
  settings.mAngularDamping = 0.18;
  settings.mAllowSleeping = false;
  if (motionType === J.EMotionType_Dynamic) {
    settings.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
    settings.mMassPropertiesOverride.mMass = mass;
  }
  shape.Release();
  const body = world.bodyInterface.CreateBody(settings);
  const id = body.GetID();
  world.bodyInterface.AddBody(id, J.EActivation_Activate);
  J.destroy(settings); J.destroy(pos); J.destroy(rot); J.destroy(axis);
  world.bodies.push({ id });
  return { body, id, mass, motionType };
}

function addJoltGround(world) {
  const { J } = world;
  const shape = joltShape(J, new J.BoxShapeSettings(new J.Vec3(30, 0.2, 30), 0.05, null));
  return addJoltBody(world, shape, { p: [0, -0.2, 0], layer: world.staticLayer, motionType: J.EMotionType_Static });
}

function addJoltHumanoid(world, spec, motionType) {
  const { J } = world;
  const compound = new J.StaticCompoundShapeSettings();
  for (const part of BODY_LAYOUT) {
    const child = part.shape === 'sphere'
      ? new J.SphereShapeSettings(part.radius, null)
      : new J.CapsuleShapeSettings(part.halfHeight, part.radius, null);
    const pos = new J.Vec3(...part.pos);
    const rot = part.axis === 'x'
      ? J.Quat.prototype.sRotation(J.Vec3.prototype.sAxisZ(), Math.PI / 2)
      : J.Quat.prototype.sIdentity();
    compound.AddShapeShapeSettings(pos, rot, child, 0);
    J.destroy(pos); J.destroy(rot);
  }
  return addJoltBody(world, joltShape(J, compound), {
    p: spec.p, yawRad: spec.yawRad ?? 0, mass: spec.mass, motionType, layer: world.movingLayer,
  });
}

function joltBodyKey(bodyId) {
  return bodyId.GetIndexAndSequenceNumber();
}

function joltReadVec(v) {
  return [v.GetX(), v.GetY(), v.GetZ()];
}

function destroyJolt(world, listener) {
  for (const { id } of world.bodies.reverse()) {
    world.bodyInterface.RemoveBody(id);
    world.bodyInterface.DestroyBody(id);
  }
  world.J.destroy(world.jolt);
  world.J.destroy(listener);
}

function joltPointVelocity(state, point) {
  return [
    state.velocity[0] + cross(state.angularVelocity, subtract(point, state.center))[0],
    state.velocity[1] + cross(state.angularVelocity, subtract(point, state.center))[1],
    state.velocity[2] + cross(state.angularVelocity, subtract(point, state.center))[2],
  ];
}

function bodyState(body) {
  const p = body.GetCenterOfMassPosition();
  const v = body.GetLinearVelocity();
  const w = body.GetAngularVelocity();
  const state = { center: joltReadVec(p), velocity: joltReadVec(v), angularVelocity: joltReadVec(w) };
  return state;
}

function estimateJoltPairImpulse(J, world, manifoldRecord, preStates, bodyIds) {
  const state1 = preStates.get(manifoldRecord.body1Key);
  const state2 = preStates.get(manifoldRecord.body2Key);
  if (!state1 || !state2 || !manifoldRecord.contactPoints.length) return 0;
  const body1 = bodyIds.get(manifoldRecord.body1Key);
  const body2 = bodyIds.get(manifoldRecord.body2Key);
  const inverseMass1 = body1.IsDynamic() ? body1.GetMotionProperties().GetInverseMass() : 0;
  const inverseMass2 = body2.IsDynamic() ? body2.GetMotionProperties().GetInverseMass() : 0;
  const inverseMass = inverseMass1 + inverseMass2;
  if (inverseMass <= 0) return 0;

  const normal = manifoldRecord.worldNormalFromBody1ToBody2;
  const point = manifoldRecord.contactPoints.reduce((acc, item) => [
    acc[0] + item.pointWorldM[0] / manifoldRecord.contactPoints.length,
    acc[1] + item.pointWorldM[1] / manifoldRecord.contactPoints.length,
    acc[2] + item.pointWorldM[2] / manifoldRecord.contactPoints.length,
  ], [0, 0, 0]);
  const beforeRelative = subtract(joltPointVelocity(state2, point), joltPointVelocity(state1, point));
  const worldPoint = new J.RVec3(...point);
  const afterVelocity1 = world.bodyInterface.GetPointVelocity(bodyIds.get(manifoldRecord.body1Key).GetID(), worldPoint);
  const afterVelocity2 = world.bodyInterface.GetPointVelocity(bodyIds.get(manifoldRecord.body2Key).GetID(), worldPoint);
  const after1 = joltReadVec(afterVelocity1);
  const after2 = joltReadVec(afterVelocity2);
  J.destroy(worldPoint);
  const afterRelative = subtract(after2, after1);
  const relativeGravity = [
    (body2.IsDynamic() ? GRAVITY[0] : 0) - (body1.IsDynamic() ? GRAVITY[0] : 0),
    (body2.IsDynamic() ? GRAVITY[1] : 0) - (body1.IsDynamic() ? GRAVITY[1] : 0),
    (body2.IsDynamic() ? GRAVITY[2] : 0) - (body1.IsDynamic() ? GRAVITY[2] : 0),
  ];
  const velocityDeltaAlongNormal = dot(subtract(afterRelative, beforeRelative), normal)
    - dot(relativeGravity, normal) * DT;
  // This is a pair-attributed linear effective-mass estimate, not Jolt's
  // unavailable solved contact lambda. Angular effective mass and interference
  // from other simultaneous manifolds are intentionally not inferred.
  return Math.max(0, velocityDeltaAlongNormal / inverseMass);
}

async function joltRun(angleDeg, speedMps, defenderMotion) {
  const J = await initJolt();
  const world = makeJoltWorld(J);
  const ground = addJoltGround(world);
  const scenario = contactSweepScenario(angleDeg, speedMps);
  const direction = [Math.cos(angleDeg * Math.PI / 180), 0, Math.sin(angleDeg * Math.PI / 180)];
  const specs = {
    carrier: { ...scenario.carrier, v: defenderMotion === 'dynamic' ? scenario.carrier.v : [0, 0, 0] },
    defender: {
      ...scenario.defender,
      v: defenderMotion === 'dynamic'
        ? scenario.defender.v
        : [-speedMps * direction[0], 0, -speedMps * direction[2]],
    },
  };
  const carrier = addJoltHumanoid(world, specs.carrier, J.EMotionType_Dynamic);
  const defender = addJoltHumanoid(world, specs.defender,
    defenderMotion === 'dynamic' ? J.EMotionType_Dynamic : J.EMotionType_Kinematic);
  if (defenderMotion === 'dynamic') {
    const cv = new J.Vec3(...specs.carrier.v), dv = new J.Vec3(...specs.defender.v);
    world.bodyInterface.SetLinearVelocity(carrier.id, cv);
    world.bodyInterface.SetLinearVelocity(defender.id, dv);
    J.destroy(cv); J.destroy(dv);
  }

  const roleByBodyKey = new Map([
    [joltBodyKey(carrier.id), 'carrier'],
    [joltBodyKey(defender.id), 'defender'],
    [joltBodyKey(ground.id), 'ground'],
  ]);
  const bodyByKey = new Map([
    [joltBodyKey(carrier.id), carrier.body],
    [joltBodyKey(defender.id), defender.body],
    [joltBodyKey(ground.id), ground.body],
  ]);
  let currentContacts = [];
  const listener = new J.ContactListenerJS();
  listener.OnContactValidate = () => J.ValidateResult_AcceptAllContactsForThisBodyPair;
  listener.OnContactAdded = (body1Ptr, body2Ptr, manifoldPtr) => {
    const body1 = J.wrapPointer(body1Ptr, J.Body);
    const body2 = J.wrapPointer(body2Ptr, J.Body);
    const manifold = J.wrapPointer(manifoldPtr, J.ContactManifold);
    const key1 = joltBodyKey(body1.GetID()), key2 = joltBodyKey(body2.GetID());
    const role1 = roleByBodyKey.get(key1), role2 = roleByBodyKey.get(key2);
    const group = role1 === 'carrier' && role2 === 'defender' || role1 === 'defender' && role2 === 'carrier'
      ? 'carrierDefender'
      : role1 === 'carrier' && role2 === 'ground' || role1 === 'ground' && role2 === 'carrier'
        ? 'carrierGround'
        : role1 === 'defender' && role2 === 'ground' || role1 === 'ground' && role2 === 'defender'
          ? 'defenderGround'
          : null;
    if (!group) return;
    const normal = manifold.get_mWorldSpaceNormal();
    const points = [];
    const relativePoints = manifold.get_mRelativeContactPointsOn1();
    for (let index = 0; index < relativePoints.size(); index++) {
      const p1 = manifold.GetWorldSpaceContactPointOn1(index);
      const p2 = manifold.GetWorldSpaceContactPointOn2(index);
      const a = joltReadVec(p1), b = joltReadVec(p2);
      points.push({ pointWorldM: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] });
    }
    currentContacts.push({
      group,
      body1Key: key1,
      body2Key: key2,
      worldNormalFromBody1ToBody2: joltReadVec(normal),
      penetrationDepthM: Math.max(0, manifold.get_mPenetrationDepth()),
      contactPoints: points,
    });
  };
  listener.OnContactPersisted = listener.OnContactAdded;
  listener.OnContactRemoved = () => {};
  world.physics.SetContactListener(listener);

  const frames = [];
  const steps = Math.ceil(scenario.duration / DT);
  for (let tick = 1; tick <= steps; tick++) {
    const preStates = new Map();
    for (const [key, body] of bodyByKey) preStates.set(key, bodyState(body));
    if (defenderMotion === 'kinematic') {
      const current = world.bodyInterface.GetPosition(defender.id);
      const rotation = world.bodyInterface.GetRotation(defender.id);
      const target = new J.RVec3(
        current.GetX() + specs.defender.v[0] * DT,
        current.GetY(),
        current.GetZ() + specs.defender.v[2] * DT,
      );
      world.bodyInterface.MoveKinematic(defender.id, target, rotation, DT);
      J.destroy(target);
    }
    currentContacts = [];
    world.jolt.Step(DT, 1);
    const grouped = newManifoldGroups();
    for (const contact of currentContacts) {
      contact.normalImpulseNs = estimateJoltPairImpulse(J, world, contact, preStates, bodyByKey);
      for (const p of contact.contactPoints) p.penetrationDepthM = contact.penetrationDepthM;
      grouped[contact.group].push({
        bodyPair: [roleByBodyKey.get(contact.body1Key), roleByBodyKey.get(contact.body2Key)],
        manifoldCount: 1,
        contactPoints: contact.contactPoints,
        worldNormalFromBody1ToBody2: contact.worldNormalFromBody1ToBody2,
        penetrationDepthM: contact.penetrationDepthM,
        normalImpulseNs: contact.normalImpulseNs,
      });
    }
    const rotation = carrier.body.GetRotation();
    frames.push(makeStepRecord(tick, tiltDeg({ x: rotation.GetX(), y: rotation.GetY(), z: rotation.GetZ(), w: rotation.GetW() }), grouped,
      'jolt_relative_point_velocity_linear_estimate'));
  }
  const out = summarizeMode(defenderMotion, frames);
  destroyJolt(world, listener);
  return out;
}

function reversalSignature(modeResults) {
  const bySpeed = new Map(modeResults.filter((cell) => cell.approachAngleDeg === 60)
    .map((cell) => [cell.closingSpeedMps, cell.modes.dynamic.carrierPeakTiltDeg]));
  return bySpeed.has(4) && bySpeed.has(6) && bySpeed.has(8)
    && bySpeed.get(4) > bySpeed.get(6) && bySpeed.get(8) > bySpeed.get(6);
}

function engineTraces(traces, engine, angle, speed) {
  return traces.find((trace) => trace.engine === engine
    && trace.approachAngleDeg === angle && trace.closingSpeedMps === speed);
}

export async function runContactMechanism() {
  const tiltTraces = JSON.parse(await readFile(new URL('./results/tilt-traces.json', import.meta.url), 'utf8'));
  const versions = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  const cells = [];
  for (const [angleDeg, speedMps] of CELLS) {
    for (const engine of ENGINES) {
      const [dynamic, kinematic] = engine === 'rapier3d-compat'
        ? await Promise.all([
          rapierRun(angleDeg, speedMps, 'dynamic'),
          rapierRun(angleDeg, speedMps, 'kinematic'),
        ])
        : await Promise.all([
          joltRun(angleDeg, speedMps, 'dynamic'),
          joltRun(angleDeg, speedMps, 'kinematic'),
        ]);
      if (dynamic.frames.length !== 180 || kinematic.frames.length !== 180) {
        throw new Error(`Expected 180 frames in ${engine} ${angleDeg}°/${speedMps} m/s`);
      }
      const trace = engineTraces(tiltTraces.traces, engine, angleDeg, speedMps);
      const dynamicSummary = summarizeMode('dynamic', dynamic.frames, trace);
      cells.push({
        engine,
        engineVersion: versions.packages[`node_modules/${engine === 'rapier3d-compat' ? '@dimforge/rapier3d-compat' : 'jolt-physics'}`].version,
        approachAngleDeg: angleDeg,
        closingSpeedMps: speedMps,
        relativeClosingSpeedPreservedMps: speedMps,
        setup: {
          geometrySource: 'scenarios.js contactSweepScenario and BODY_LAYOUT (frozen)',
          dynamic: 'carrier moves at the sweep speed; defender is dynamic and stationary at start, matching tilt-traces.json',
          kinematic: 'carrier starts stationary; defender is a position-based kinematic body moved toward carrier at the sweep closing speed; same initial geometry and orientation',
          solverSettingsChanged: false,
        },
        modes: { dynamic: dynamicSummary, kinematic },
        comparison: {
          dynamicCarrierPeakTiltDeg: dynamicSummary.carrierPeakTiltDeg,
          kinematicCarrierPeakTiltDeg: kinematic.carrierPeakTiltDeg,
          dynamicMinusKinematicPeakTiltDeg: dynamicSummary.carrierPeakTiltDeg - kinematic.carrierPeakTiltDeg,
        },
      });
    }
  }

  const joltCells = cells.filter((cell) => cell.engine === 'jolt-physics-js');
  const reversalReproducesWithKinematic = (() => {
    const values = new Map(joltCells.filter((cell) => cell.approachAngleDeg === 60)
      .map((cell) => [cell.closingSpeedMps, cell.modes.kinematic.carrierPeakTiltDeg]));
    return values.has(4) && values.has(6) && values.has(8)
      && values.get(4) > values.get(6) && values.get(8) > values.get(6);
  })();
  const dynamicReversalReproduced = reversalSignature(joltCells);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model },
    method: {
      timestepSeconds: DT,
      framesPerMode: 180,
      sweepCells: CELLS.map(([approachAngleDeg, closingSpeedMps]) => ({ approachAngleDeg, closingSpeedMps })),
      contactGroups: {
        carrierDefender: 'logical body-pair contact between carrier and defender',
        carrierGround: 'logical body-pair contact between carrier and ground',
        defenderGround: 'logical body-pair contact between defender and ground',
      },
      pairCountDefinition: 'One logical body pair counts as one pair even when Rapier reports multiple collider-pair manifolds. manifoldCount and contactPointCount preserve lower-level multiplicity.',
      rapierImpulse: 'Exact solver-reported normal contact impulse summed over contact points using TempContactManifold.contactImpulse(i).',
      joltImpulse: 'Estimate from pre/post relative contact-point velocity change divided by linear inverse-mass sum, with gravity delta removed. Jolt JS exposes manifold geometry in callbacks but not its solved normal lambda; this estimate excludes angular effective mass and cannot separate simultaneous contact contributions. Treat it as a diagnostic estimate, not a solver impulse.',
      contactTiming: 'Rapier manifolds are queried after each fixed step. Jolt OnContactAdded/OnContactPersisted callbacks capture the current step manifold.',
      kinematicControl: 'The kinematic defender has the same initial pose and geometry. The carrier starts at rest and the defender moves toward it at the requested relative closing speed; dynamic mode exactly matches the carrier-moving sweep setup.',
      peakPhase: 'The dynamic mode peak tick/tilt is compared with the corresponding existing tilt-traces.json frame. The contact phase is read from this probe at the same tick.',
      reversalRule: 'For Jolt at 60°, reversal means carrier peak tilt at 4 m/s > 6 m/s and 8 m/s > 6 m/s.',
      randomOutcomeDraw: false,
    },
    cells,
    verdict: {
      joltDynamicReversalReproduced: dynamicReversalReproduced,
      joltKinematicDefenderReversalReproduced: reversalReproducesWithKinematic,
      kinematicVerdict: reversalReproducesWithKinematic
        ? 'PASS: the 60-degree 4/6/8 m/s reversal remains with a kinematic defender; dynamic defender response is not required for this reversal in this control.'
        : 'FAIL: the 60-degree 4/6/8 m/s reversal does not remain with a kinematic defender; the dynamic two-body coupling is implicated, while carrier-ground interaction remains present.',
      reversalDefinition: 'At 60 degrees, 4 m/s peak tilt exceeds 6 m/s and 8 m/s peak tilt exceeds 6 m/s.',
    },
  };
}

if (process.argv[1]?.endsWith('/contact-mechanism.mjs')) {
  const result = await runContactMechanism();
  const path = new URL('./results/contact-mechanism.json', import.meta.url);
  await mkdir(new URL('./results/', import.meta.url), { recursive: true });
  await writeFile(path, `${JSON.stringify(result)}\n`);
  console.log(JSON.stringify({ output: path.pathname, cells: result.cells.length, verdict: result.verdict }, null, 2));
}
