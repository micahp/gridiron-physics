import initJolt from 'jolt-physics';
import RAPIER from '@dimforge/rapier3d-compat';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { BODY_LAYOUT, DT, contactSweepScenario } from './scenarios.js';

const SEED = 20261022;
const TRACE_CELLS = [
  [60, 4], [60, 6], [60, 8], [30, 8],
];
const PROBE_IMPULSES_NS = [120, 180, 240, 300];

const clamp = (x) => Math.max(-1, Math.min(1, x));
const toDeg = (radians) => radians * 180 / Math.PI;
const tiltFromUpY = (upY) => toDeg(Math.acos(clamp(upY)));

function rotateByQuat([x, y, z], [qx, qy, qz, qw]) {
  const norm = Math.hypot(qx, qy, qz, qw) || 1;
  qx /= norm; qy /= norm; qz /= norm; qw /= norm;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

function quaternionMeasures(q) {
  const [x, y, z, w] = q;
  const legacyUpY = 1 - 2 * (x * x + z * z);
  const rotatedUp = rotateByQuat([0, 1, 0], q);
  return {
    quaternionUpVectorFormulaDeg: tiltFromUpY(legacyUpY),
    rotatedLocalUpDotWorldUpDeg: tiltFromUpY(rotatedUp[1]),
    upYDelta: Math.abs(legacyUpY - rotatedUp[1]),
  };
}

function colliderLocalLongAxis(part) {
  if (part.shape === 'sphere') return null;
  // Capsules are authored along local +Y. The x-axis arm capsules carry the
  // same 90-degree Z rotation used by both frozen engine adapters.
  return part.axis === 'x' ? [-1, 0, 0] : [0, 1, 0];
}

function colliderTilts(q) {
  return Object.fromEntries(BODY_LAYOUT.map((part) => {
    const axis = colliderLocalLongAxis(part);
    if (!axis) return [part.part, null];
    const worldAxis = rotateByQuat(axis, q);
    return [part.part, tiltFromUpY(Math.abs(worldAxis[1]))];
  }));
}

function peakOf(frames, selector) {
  let peak = null;
  for (const frame of frames) {
    const value = selector(frame);
    if (value !== null && (!peak || value > peak.valueDeg)) {
      peak = { valueDeg: value, tick: frame.tick, timeSeconds: frame.timeSeconds };
    }
  }
  return peak;
}

function traceSummary(frames, player) {
  const peak = peakOf(frames, (f) => f.players[player].tiltDeg);
  const atPeak = frames.find((f) => f.tick === peak.tick);
  const colliderPeaks = Object.fromEntries(BODY_LAYOUT.map((part) => [
    part.part,
    part.shape === 'sphere'
      ? { orientationDefined: false, peakTiltDeg: null }
      : { orientationDefined: true, ...peakOf(frames, (f) => f.players[player].colliderAxisTiltDeg[part.part]) },
  ]));
  const perColliderRigidBodyPeak = Object.fromEntries(BODY_LAYOUT.map((part) => [part.part, {
    peakTiltDeg: peak.valueDeg,
    tick: peak.tick,
    timeSeconds: peak.timeSeconds,
    rigidlySharedWithOtherParts: true,
  }]));
  return {
    peakTiltDeg: peak.valueDeg,
    peakTick: peak.tick,
    peakTimeSeconds: peak.timeSeconds,
    angularVelocityRadPerSecAtPeak: atPeak.players[player].angularVelocityRadPerSec,
    angularSpeedRadPerSecAtPeak: Math.hypot(...atPeak.players[player].angularVelocityRadPerSec),
    groundContactAtPeak: atPeak.players[player].groundContact,
    perColliderRigidBodyPeakTilt: perColliderRigidBodyPeak,
    perColliderLongAxisPeakTilt: colliderPeaks,
  };
}

function joltWorld(J) {
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
  physics.SetGravity(new J.Vec3(0, -9.81, 0));
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

function addJoltBody(world, shape, { p, v = [0, 0, 0], yawRad = 0, mass, dynamic, layer, friction = 0.82, restitution = 0.03 }) {
  const { J } = world;
  const pos = new J.RVec3(...p);
  const axis = new J.Vec3(0, 1, 0);
  const rot = J.Quat.prototype.sRotation(axis, yawRad);
  const settings = new J.BodyCreationSettings(shape, pos, rot, dynamic ? J.EMotionType_Dynamic : J.EMotionType_Static, layer);
  settings.mFriction = friction;
  settings.mRestitution = restitution;
  settings.mLinearDamping = 0.04;
  settings.mAngularDamping = 0.18;
  settings.mAllowSleeping = false;
  if (dynamic) {
    settings.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
    settings.mMassPropertiesOverride.mMass = mass;
    settings.mLinearVelocity = new J.Vec3(...v);
  }
  shape.Release();
  const body = world.bodyInterface.CreateBody(settings);
  const id = body.GetID();
  world.bodyInterface.AddBody(id, J.EActivation_Activate);
  J.destroy(settings); J.destroy(pos); J.destroy(rot); J.destroy(axis);
  world.bodies.push({ id });
  return { body, id, mass };
}

function addJoltGround(world) {
  const { J } = world;
  const shape = joltShape(J, new J.BoxShapeSettings(new J.Vec3(30, 0.2, 30), 0.05, null));
  return addJoltBody(world, shape, { p: [0, -0.2, 0], layer: world.staticLayer, dynamic: false });
}

function addJoltHumanoid(world, spec) {
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
    p: spec.p, v: spec.v, yawRad: spec.yawRad ?? 0, mass: spec.mass, dynamic: true, layer: world.movingLayer,
  });
}

function joltRead(body, groundId, physics) {
  const p = body.GetPosition(), q = body.GetRotation(), v = body.GetLinearVelocity(), av = body.GetAngularVelocity();
  const rotation = [q.GetX(), q.GetY(), q.GetZ(), q.GetW()];
  const measures = quaternionMeasures(rotation);
  return {
    position: [p.GetX(), p.GetY(), p.GetZ()],
    rotation,
    velocity: [v.GetX(), v.GetY(), v.GetZ()],
    angularVelocityRadPerSec: [av.GetX(), av.GetY(), av.GetZ()],
    tiltDeg: measures.quaternionUpVectorFormulaDeg,
    alternateTiltDeg: measures.rotatedLocalUpDotWorldUpDeg,
    tiltFormulaDeltaDeg: Math.abs(measures.quaternionUpVectorFormulaDeg - measures.rotatedLocalUpDotWorldUpDeg),
    colliderAxisTiltDeg: colliderTilts(rotation),
    groundContact: physics.WereBodiesInContact(body.GetID(), groundId),
  };
}

function destroyJolt(world) {
  for (const { id } of world.bodies.reverse()) {
    world.bodyInterface.RemoveBody(id);
    world.bodyInterface.DestroyBody(id);
  }
  world.J.destroy(world.jolt);
}

async function joltTrace(angleDeg, speedMps, J) {
  const world = joltWorld(J);
  const ground = addJoltGround(world);
  const scenario = contactSweepScenario(angleDeg, speedMps);
  const carrier = addJoltHumanoid(world, scenario.carrier);
  const defender = addJoltHumanoid(world, scenario.defender);
  const frames = [];
  for (let tick = 1; tick <= Math.ceil(scenario.duration / DT); tick++) {
    world.jolt.Step(DT, 1);
    frames.push({ tick, timeSeconds: tick * DT, players: {
      carrier: joltRead(carrier.body, ground.id, world.physics),
      defender: joltRead(defender.body, ground.id, world.physics),
    } });
  }
  const out = { engine: 'jolt-physics-js', engineVersion: '1.1.0', approachAngleDeg: angleDeg, closingSpeedMps: speedMps, carrier: traceSummary(frames, 'carrier'), defender: traceSummary(frames, 'defender'), frames };
  destroyJolt(world);
  return out;
}

async function joltSingleProbe({ mode, impulseNs = null }, J) {
  const world = joltWorld(J);
  const ground = addJoltGround(world);
  const body = addJoltHumanoid(world, { p: [0, mode === 'drop' ? 3.0 : 0.845, 0], v: [0, 0, 0], mass: 96 });
  const frames = [];
  const settleTicks = mode === 'impulse' ? 24 : 0;
  for (let tick = 1; tick <= 240; tick++) {
    if (mode === 'impulse' && tick === settleTicks + 1) {
      const impulse = new J.Vec3(impulseNs, 0, 0);
      const point = new J.RVec3(0, 0.845 + 0.6, 0);
      world.bodyInterface.AddImpulse(body.id, impulse, point);
      J.destroy(impulse); J.destroy(point);
    }
    world.jolt.Step(DT, 1);
    const state = joltRead(body.body, ground.id, world.physics);
    frames.push({ tick, timeSeconds: tick * DT, ...state });
  }
  const peak = peakOf(frames, (f) => f.tiltDeg);
  const atPeak = frames.find((f) => f.tick === peak.tick);
  const out = {
    mode, ...(impulseNs === null ? {} : { impulseNs, applicationPointWorldM: [0, 1.445, 0] }),
    peakTiltDeg: peak.valueDeg, peakTick: peak.tick, peakTimeSeconds: peak.timeSeconds,
    angularVelocityRadPerSecAtPeak: atPeak.angularVelocityRadPerSec,
    angularSpeedRadPerSecAtPeak: Math.hypot(...atPeak.angularVelocityRadPerSec),
    groundContactAtPeak: atPeak.groundContact,
    finalPositionM: frames.at(-1).position,
    finite: frames.every((f) => [...f.position, ...f.velocity, ...f.angularVelocityRadPerSec, f.tiltDeg].every(Number.isFinite)),
  };
  destroyJolt(world);
  return out;
}

const q4 = ([x, y, z, w]) => ({ x, y, z, w });

function addRapierGround(world) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  return world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.2, 30).setTranslation(0, -0.2, 0).setFriction(0.95), body);
}

function addRapierHumanoid(world, spec) {
  const yaw = spec.yawRad ?? 0;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(...spec.p).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
    .setLinvel(...spec.v).setLinearDamping(0.04).setAngularDamping(0.18).setCcdEnabled(true).setCanSleep(false));
  const colliders = BODY_LAYOUT.map((part) => {
    const desc = part.shape === 'sphere' ? RAPIER.ColliderDesc.ball(part.radius) : RAPIER.ColliderDesc.capsule(part.halfHeight, part.radius);
    const rotation = part.axis === 'x' ? q4([0, 0, Math.SQRT1_2, Math.SQRT1_2]) : q4([0, 0, 0, 1]);
    desc.setTranslation(...part.pos).setRotation(rotation).setMass(spec.mass * part.massShare).setFriction(0.82).setRestitution(0.03).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    return world.createCollider(desc, body);
  });
  return { body, colliders, mass: spec.mass };
}

function rapierGroundContact(world, colliders, groundCollider) {
  for (const collider of colliders) {
    let touching = false;
    world.contactPair(collider, groundCollider, (manifold) => { if (manifold.numContacts() > 0) touching = true; });
    if (touching) return true;
  }
  return false;
}

function rapierRead(player, groundCollider, world) {
  const p = player.body.translation(), q = player.body.rotation(), v = player.body.linvel(), av = player.body.angvel();
  const rotation = [q.x, q.y, q.z, q.w];
  const measures = quaternionMeasures(rotation);
  return {
    position: [p.x, p.y, p.z], rotation, velocity: [v.x, v.y, v.z], angularVelocityRadPerSec: [av.x, av.y, av.z],
    tiltDeg: measures.quaternionUpVectorFormulaDeg,
    alternateTiltDeg: measures.rotatedLocalUpDotWorldUpDeg,
    tiltFormulaDeltaDeg: Math.abs(measures.quaternionUpVectorFormulaDeg - measures.rotatedLocalUpDotWorldUpDeg),
    colliderAxisTiltDeg: colliderTilts(rotation),
    groundContact: rapierGroundContact(world, player.colliders, groundCollider),
  };
}

async function rapierTrace(angleDeg, speedMps) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.integrationParameters.numSolverIterations = 8;
  const ground = addRapierGround(world);
  const scenario = contactSweepScenario(angleDeg, speedMps);
  const carrier = addRapierHumanoid(world, scenario.carrier);
  const defender = addRapierHumanoid(world, scenario.defender);
  const frames = [];
  for (let tick = 1; tick <= Math.ceil(scenario.duration / DT); tick++) {
    world.step();
    frames.push({ tick, timeSeconds: tick * DT, players: {
      carrier: rapierRead(carrier, ground, world), defender: rapierRead(defender, ground, world),
    } });
  }
  const out = { engine: 'rapier3d-compat', engineVersion: '0.21.0', approachAngleDeg: angleDeg, closingSpeedMps: speedMps, carrier: traceSummary(frames, 'carrier'), defender: traceSummary(frames, 'defender'), frames };
  world.free();
  return out;
}

async function rapierSingleProbe({ mode, impulseNs = null }) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.integrationParameters.numSolverIterations = 8;
  const ground = addRapierGround(world);
  const player = addRapierHumanoid(world, { p: [0, mode === 'drop' ? 3.0 : 0.845, 0], v: [0, 0, 0], mass: 96 });
  const frames = [];
  const settleTicks = mode === 'impulse' ? 24 : 0;
  for (let tick = 1; tick <= 240; tick++) {
    if (mode === 'impulse' && tick === settleTicks + 1) player.body.applyImpulseAtPoint({ x: impulseNs, y: 0, z: 0 }, { x: 0, y: 1.445, z: 0 }, true);
    world.step();
    frames.push({ tick, timeSeconds: tick * DT, ...rapierRead(player, ground, world) });
  }
  const peak = peakOf(frames, (f) => f.tiltDeg);
  const atPeak = frames.find((f) => f.tick === peak.tick);
  const out = {
    mode, ...(impulseNs === null ? {} : { impulseNs, applicationPointWorldM: [0, 1.445, 0] }),
    peakTiltDeg: peak.valueDeg, peakTick: peak.tick, peakTimeSeconds: peak.timeSeconds,
    angularVelocityRadPerSecAtPeak: atPeak.angularVelocityRadPerSec,
    angularSpeedRadPerSecAtPeak: Math.hypot(...atPeak.angularVelocityRadPerSec),
    groundContactAtPeak: atPeak.groundContact,
    finalPositionM: frames.at(-1).position,
    finite: frames.every((f) => [...f.position, ...f.velocity, ...f.angularVelocityRadPerSec, f.tiltDeg].every(Number.isFinite)),
  };
  world.free();
  return out;
}

async function engineVersions() {
  const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  return {
    'rapier3d-compat': lock.packages['node_modules/@dimforge/rapier3d-compat'].version,
    'jolt-physics-js': lock.packages['node_modules/jolt-physics'].version,
  };
}

export async function runTiltDiagnosis() {
  const versions = await engineVersions();
  const J = await initJolt();
  const traces = [];
  for (const [angle, speed] of TRACE_CELLS) {
    traces.push(await rapierTrace(angle, speed));
    traces.push(await joltTrace(angle, speed, J));
  }
  const drop = [];
  const impulseResponses = [];
  for (const engine of ['rapier3d-compat', 'jolt-physics-js']) {
    drop.push(engine === 'rapier3d-compat'
      ? { engine, ...(await rapierSingleProbe({ mode: 'drop' })) }
      : { engine, ...(await joltSingleProbe({ mode: 'drop' }, J)) });
    for (const impulseNs of PROBE_IMPULSES_NS) {
      impulseResponses.push(engine === 'rapier3d-compat'
        ? { engine, ...(await rapierSingleProbe({ mode: 'impulse', impulseNs })) }
        : { engine, ...(await joltSingleProbe({ mode: 'impulse', impulseNs }, J)) });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, engineVersions: versions },
    method: {
      timestepSeconds: DT,
      sweepCells: TRACE_CELLS.map(([approachAngleDeg, closingSpeedMps]) => ({ approachAngleDeg, closingSpeedMps })),
      tiltDefinition: 'Angle between world-up and the rigid body local +Y axis. Sweep value is acos(1 - 2(x² + z²)) from the engine quaternion; an independent normalized quaternion-vector rotation computes the same angle per frame.',
      secondTiltDefinitionFinding: 'The Jolt ellipsoid/body-center function estimates a contact point from the line between body centers; it is not a tilt estimator and returns no tilt value. No second proxy-surface tilt is defined in the frozen harness.',
      colliderTiltDefinition: 'All five collision shapes are rigidly attached to one body, so each receives the same per-collider rigid-body peak tilt. Separately, perColliderLongAxisPeakTilt is each capsule long-axis inclination to world-up after child and body rotations; absolute axis dot handles the unoriented capsule axis. The spherical head has no orientation-defined long axis.',
      singleBodyProbe: {
        geometry: 'same five-collider 96 kg player proxy and ground box as the sweep',
        drop: 'upright body released from rest with center at y=3.0 m; 2 seconds simulated',
        impulse: 'after 24 settle steps, apply horizontal +x impulse at world point [0, 1.445, 0] m; 2 seconds simulated',
        impulseMagnitudesNs: PROBE_IMPULSES_NS,
        magnitudeContext: '120–300 N·s brackets the 121.9–309.3 N·s Rapier sweep contact-impulse estimates; Jolt sweep values are carrier momentum-change estimates including support impulses, so this is a scale comparison, not an equal-contact-impulse replay.',
        rapierSolverIterations: 8,
        joltStepsPerUpdate: 1,
      },
      deterministicSeed: SEED,
      randomOutcomeDraw: false,
    },
    traces,
    singleBody: { drop, impulseResponses },
  };
}

if (process.argv[1]?.endsWith('/tilt-diagnosis.mjs')) {
  const result = await runTiltDiagnosis();
  const path = new URL('./results/tilt-traces.json', import.meta.url);
  await mkdir(new URL('./results/', import.meta.url), { recursive: true });
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ output: path.pathname, traces: result.traces.length, frameCountPerTrace: result.traces[0].frames.length, dropProbes: result.singleBody.drop.length, impulseProbes: result.singleBody.impulseResponses.length }, null, 2));
}
