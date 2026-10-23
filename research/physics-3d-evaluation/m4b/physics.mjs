import RAPIER from '@dimforge/rapier3d-compat';
import initJolt from 'jolt-physics';
import { BODY_LAYOUT, DT } from '../scenarios.js';

const G = 9.81;
let rapierInit;
let joltInit;
let joltModule;
const v3 = (v) => ({ x: v[0], y: v[1], z: v[2] });
const quat = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const scale = (a, s) => a.map((v) => v * s);
export const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.hypot(...a);
export const normalize = (a) => scale(a, 1 / (length(a) || 1));
export const qNormalize = (q) => scale(q, 1 / (Math.hypot(...q) || 1));
export const qConjugate = ([x, y, z, w]) => [-x, -y, -z, w];
export function qMultiply(a, b) {
  const [x1, y1, z1, w1] = a, [x2, y2, z2, w2] = b;
  return qNormalize([w1*x2 + x1*w2 + y1*z2 - z1*y2, w1*y2 - x1*z2 + y1*w2 + z1*x2,
    w1*z2 + x1*y2 - y1*x2 + z1*w2, w1*w2 - x1*x2 - y1*y2 - z1*z2]);
}
export function qRotate(v, qIn) {
  const [x, y, z, w] = qNormalize(qIn), u = [x, y, z];
  const t = scale(cross(u, v), 2);
  return add(v, add(scale(t, w), cross(u, t)));
}
export function tiltDeg(q) {
  const up = qRotate([0, 1, 0], q);
  return Math.acos(Math.max(-1, Math.min(1, up[1]))) * 180 / Math.PI;
}

function rapierQuaternion(q) { return { x: q[0], y: q[1], z: q[2], w: q[3] }; }
function rapierBodyState(body, label, mass) {
  const p = body.translation(), com = body.worldCom({ x: 0, y: 0, z: 0 }), v = body.linvel(), av = body.angvel({ x: 0, y: 0, z: 0 }), q = body.rotation();
  return {
    label, massKg: body.mass() || mass,
    positionM: [p.x, p.y, p.z], centerOfMassM: [com.x, com.y, com.z],
    linearVelocityMps: [v.x, v.y, v.z], angularVelocityRadPerSec: [av.x, av.y, av.z],
    rotation: [q.x, q.y, q.z, q.w],
  };
}

function rapierHumanoid(world, spec, label, material = {}, playerGeometry = 'compound') {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(...spec.p).setRotation(rapierQuaternion(quat(spec.yawRad ?? 0)))
    .setLinvel(...(spec.v ?? [0, 0, 0])).setAngvel(v3(spec.angular ?? [0, 0, 0]))
    .setLinearDamping(material.linearDamping ?? 0.025).setAngularDamping(material.angularDamping ?? 0.06)
    .setCcdEnabled(true).setCanSleep(false));
  const layout = playerGeometry === 'single-capsule'
    ? [{ part: 'player-capsule', shape: 'capsule', pos: [0, 0, 0], halfHeight: 0.55, radius: 0.27, massShare: 1 }]
    : BODY_LAYOUT;
  const colliders = layout.map((part) => {
    const desc = part.shape === 'sphere' ? RAPIER.ColliderDesc.ball(part.radius) : RAPIER.ColliderDesc.capsule(part.halfHeight, part.radius);
    const partRotation = part.axis === 'x' ? { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } : rapierQuaternion([0, 0, 0, 1]);
    desc.setTranslation(...part.pos).setRotation(partRotation).setMass(spec.mass * part.massShare)
      .setFriction(spec.friction ?? material.playerFriction ?? 0.72).setRestitution(spec.restitution ?? material.playerRestitution ?? 0.04);
    return world.createCollider(desc, body);
  });
  return { label, spec, mass: spec.mass, body, colliders };
}

function makeRapierWorld({ ground = true, gravity = -G, material = {}, solverIterations = 8, timestep = DT, playerGeometry = 'compound' } = {}) {
  const world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
  world.timestep = timestep;
  world.integrationParameters.numSolverIterations = solverIterations;
  let groundBody = null, groundCollider = null;
  if (ground) {
    groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    groundCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(80, 0.2, 40)
      .setTranslation(0, -0.2, 0).setFriction(material.groundFriction ?? 0.82)
      .setRestitution(material.groundRestitution ?? 0.04), groundBody);
  }
  const players = [];
  const forceBodies = [];
  const adapter = {
    engine: 'rapier3d-compat',
    async addPlayer(spec, label) {
      const player = rapierHumanoid(world, spec, label, material, playerGeometry);
      players.push(player); forceBodies.push(player.body); return player;
    },
    addBallisticBody({ p, v, angular = [0, 0, 0], yawRad = 0, mass = 10, shape = 'box', halfExtents = [0.3, 0.2, 0.25], label = 'ballistic-body', material: bodyMat = {} }) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...p).setRotation(rapierQuaternion(quat(yawRad))).setLinvel(...v).setAngvel(v3(angular))
        .setLinearDamping(bodyMat.linearDamping ?? 0).setAngularDamping(bodyMat.angularDamping ?? 0).setCanSleep(false));
      let colliderDesc = shape === 'sphere' ? RAPIER.ColliderDesc.ball(halfExtents[0])
        : shape === 'football' ? RAPIER.ColliderDesc.roundCuboid(...halfExtents, 0.035)
          : RAPIER.ColliderDesc.cuboid(...halfExtents);
      colliderDesc.setMass(mass).setFriction(bodyMat.friction ?? material.groundFriction ?? 0.82)
        .setRestitution(bodyMat.restitution ?? material.groundRestitution ?? 0.04);
      const collider = world.createCollider(colliderDesc, body);
      forceBodies.push(body);
      return { body, colliders: [collider], mass, label };
    },
    async step() {
      world.step();
      for (const body of forceBodies) { body.resetForces(true); body.resetTorques(true); }
    },
    state(player) { return rapierBodyState(player.body, player.label, player.mass); },
    grounded(player) {
      if (!groundCollider) return false;
      let active = false;
      for (const collider of player.colliders) world.contactPair(collider, groundCollider, (manifold) => { if (manifold.numContacts() > 0) active = true; });
      return active;
    },
    touching(a, b) {
      let active = false;
      for (const ca of a.colliders) for (const cb of b.colliders) world.contactPair(ca, cb, (m) => { if (m.numContacts() > 0) active = true; });
      return active;
    },
    contactPoints(a, b) {
      const points = [];
      for (const ca of a.colliders) for (const cb of b.colliders) world.contactPair(ca, cb, (m) => {
        for (let i = 0; i < m.numContacts(); i++) {
          const p = m.solverContactPoint(i);
          if (p) points.push([p.x, p.y, p.z]);
        }
      });
      return points;
    },
    contactStats(a, b) {
      let maxPenetration = 0, pairCount = 0;
      for (const ca of a.colliders) for (const cb of b.colliders) world.contactPair(ca, cb, (m) => {
        if (m.numContacts() > 0) pairCount++;
        for (let i = 0; i < m.numSolverContacts(); i++) maxPenetration = Math.max(maxPenetration, -m.solverContactDist(i));
      });
      return { colliderPairCount: pairCount, maximumPenetrationDepthM: pairCount ? Math.max(0, maxPenetration) : null,
        penetrationSource: 'Rapier solver contact distance' };
    },
    contactImpulseNs(a, b) {
      let total = 0;
      for (const ca of a.colliders) for (const cb of b.colliders) world.contactPair(ca, cb, (m) => {
        for (let i = 0; i < m.numSolverContacts(); i++) total += Math.abs(m.contactImpulse(i));
      });
      return total;
    },
    contactSnapshot(a, b) {
      let maximumPenetrationDepthM = 0, normalImpulseNs = 0, colliderPairCount = 0;
      const points = []; let normalWorld = null;
      for (const ca of a.colliders) for (const cb of b.colliders) world.contactPair(ca, cb, (m) => {
        if (m.numContacts() > 0) colliderPairCount++;
        if (!normalWorld && m.numContacts() > 0) { const n = m.normal(); normalWorld = [n.x, n.y, n.z]; }
        for (let i = 0; i < m.numSolverContacts(); i++) {
          maximumPenetrationDepthM = Math.max(maximumPenetrationDepthM, -m.solverContactDist(i));
          normalImpulseNs += Math.abs(m.contactImpulse(i));
          const p = m.solverContactPoint(i);
          if (p) points.push([p.x, p.y, p.z]);
        }
      });
      return { touching: colliderPairCount > 0, colliderPairCount, pointsM: points,
        normalWorld,
        maximumPenetrationDepthM: colliderPairCount ? Math.max(0, maximumPenetrationDepthM) : null,
        normalImpulseNs: colliderPairCount ? normalImpulseNs : null,
        impulseSource: 'Rapier solver contact manifold normal impulses',
        penetrationSource: 'Rapier solver contact distance' };
    },
    applyForce(player, force, point = null) {
      const f = v3(force);
      player.body.addForce(f, true);
      if (point) {
        const s = this.state(player);
        player.body.addTorque(v3(cross(sub(point, s.centerOfMassM), force)), true);
      }
    },
    applyTorque(player, torque) { player.body.addTorque(v3(torque), true); },
    applyImpulse(player, impulse, point = null) {
      const s = this.state(player);
      player.body.applyImpulse(v3(impulse), true);
      if (point) player.body.applyTorqueImpulse(v3(cross(sub(point, s.centerOfMassM), impulse)), true);
    },
    setVelocity(player, linearVelocity, angularVelocity = null) {
      player.body.setLinvel(v3(linearVelocity), true);
      if (angularVelocity) player.body.setAngvel(v3(angularVelocity), true);
    },
    energyProps(player) {
      const inertia = player.body.principalInertia({ x: 0, y: 0, z: 0 });
      const frame = player.body.principalInertiaLocalFrame({ x: 0, y: 0, z: 0, w: 1 });
      return { massKg: player.body.mass(), principalInertiaKgM2: [inertia.x, inertia.y, inertia.z], inertiaLocalRotation: [frame.x, frame.y, frame.z, frame.w] };
    },
    groundEntity: groundCollider ? { body: groundBody, colliders: [groundCollider], label: 'ground' } : null,
    rapierWorld: world,
    destroy() { world.free(); },
  };
  return adapter;
}

function joltReadVec(v) { return [v.GetX(), v.GetY(), v.GetZ()]; }
function joltReadQuat(q) { return [q.GetX(), q.GetY(), q.GetZ(), q.GetW()]; }
function joltMakeShape(J, settings) {
  const result = settings.Create();
  if (!result.IsValid()) throw new Error(`Jolt shape creation failed: ${result.GetError()}`);
  const shape = result.Get(); shape.AddRef(); result.Clear(); settings.Release(); return shape;
}
function joltWorld({ ground = true, gravity = -G, material = {}, solverIterations = 8, timestep = DT, playerGeometry = 'compound' } = {}) {
  const J = joltModule;
  const staticLayer = 0, movingLayer = 1;
  const pairFilter = new J.ObjectLayerPairFilterTable(2);
  pairFilter.EnableCollision(staticLayer, staticLayer); pairFilter.EnableCollision(staticLayer, movingLayer); pairFilter.EnableCollision(movingLayer, movingLayer);
  const broad = new J.BroadPhaseLayerInterfaceTable(2, 2);
  const bp0 = new J.BroadPhaseLayer(0), bp1 = new J.BroadPhaseLayer(1);
  broad.MapObjectToBroadPhaseLayer(staticLayer, bp0); broad.MapObjectToBroadPhaseLayer(movingLayer, bp1);
  J.destroy(bp0); J.destroy(bp1);
  const vsBroad = new J.ObjectVsBroadPhaseLayerFilterTable(broad, 2, pairFilter, 2);
  const settings = new J.JoltSettings();
  settings.mMaxBodies = 128; settings.mMaxBodyPairs = 2048; settings.mMaxContactConstraints = 2048; settings.mMaxWorkerThreads = 0;
  settings.mBroadPhaseLayerInterface = broad; settings.mObjectLayerPairFilter = pairFilter; settings.mObjectVsBroadPhaseLayerFilter = vsBroad;
  const jolt = new J.JoltInterface(settings); J.destroy(settings);
  const physics = jolt.GetPhysicsSystem();
  physics.SetGravity(new J.Vec3(0, gravity, 0));
  const bodyInterface = physics.GetBodyInterface(), bodies = [], bodyLabels = new Map();
  let frameContacts = new Map();
  const bodyKey = (body) => {
    const id = body.GetID ? body.GetID() : body;
    if (id?.ToString) return id.ToString();
    return String(id);
  };
  const contactListener = new J.ContactListenerJS();
  const recordContact = (body1Pointer, body2Pointer, manifoldPointer) => {
    const body1 = J.wrapPointer(body1Pointer, J.Body), body2 = J.wrapPointer(body2Pointer, J.Body);
    const manifold = J.wrapPointer(manifoldPointer, J.ContactManifold);
    const id1 = bodyKey(body1), id2 = bodyKey(body2);
    const label1 = bodyLabels.get(id1) ?? id1, label2 = bodyLabels.get(id2) ?? id2;
    const ordered = [label1, label2].sort(); const pairId = ordered.join('::');
    const pointsM = [];
    const relativePoints = manifold.mRelativeContactPointsOn1;
    for (let i = 0; i < relativePoints.size(); i++) {
      const point = manifold.GetWorldSpaceContactPointOn1(i);
      pointsM.push(joltReadVec(point)); J.destroy(point);
    }
    const normalVector = manifold.mWorldSpaceNormal;
    const normal = joltReadVec(normalVector);
    const entry = frameContacts.get(pairId) ?? { pairId, bodies: ordered, pointsM: [], maximumPenetrationDepthM: 0,
      normalWorld: normal, normalFrom: label1, normalTo: label2 };
    entry.pointsM.push(...pointsM);
    entry.maximumPenetrationDepthM = Math.max(entry.maximumPenetrationDepthM, manifold.mPenetrationDepth);
    entry.normalWorld = normal;
    entry.normalFrom = label1; entry.normalTo = label2;
    frameContacts.set(pairId, entry);
  };
  contactListener.OnContactValidate = () => J.ValidateResult_AcceptAllContactsForThisBodyPair;
  contactListener.OnContactAdded = recordContact;
  contactListener.OnContactPersisted = recordContact;
  contactListener.OnContactRemoved = () => {};
  physics.SetContactListener(contactListener);
  const makeBody = (shape, { p, v = [0, 0, 0], angular = [0, 0, 0], yawRad = 0, mass, dynamic = true, friction, restitution, linearDamping, angularDamping }) => {
    const pos = new J.RVec3(...p), yawAxis = new J.Vec3(0, 1, 0), rot = J.Quat.prototype.sRotation(yawAxis, yawRad);
    const bodySettings = new J.BodyCreationSettings(shape, pos, rot, dynamic ? J.EMotionType_Dynamic : J.EMotionType_Static, dynamic ? 1 : 0);
    bodySettings.mFriction = friction ?? material.playerFriction ?? 0.72;
    bodySettings.mRestitution = restitution ?? material.playerRestitution ?? 0.04;
    bodySettings.mLinearDamping = linearDamping ?? material.linearDamping ?? 0.025;
    bodySettings.mAngularDamping = angularDamping ?? material.angularDamping ?? 0.06;
    bodySettings.mAllowSleeping = false;
    if (dynamic) {
      bodySettings.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
      bodySettings.mMassPropertiesOverride.mMass = mass;
      bodySettings.mLinearVelocity = new J.Vec3(...v); bodySettings.mAngularVelocity = new J.Vec3(...angular);
    }
    shape.Release();
    const body = bodyInterface.CreateBody(bodySettings), id = body.GetID();
    bodyInterface.AddBody(id, J.EActivation_Activate);
    J.destroy(bodySettings); J.destroy(pos); J.destroy(rot); J.destroy(yawAxis);
    bodies.push({ body, id });
    return { body, id, mass };
  };
  let groundBody = null;
  if (ground) {
    const shape = joltMakeShape(J, new J.BoxShapeSettings(new J.Vec3(80, 0.2, 40), 0.05, null));
    groundBody = makeBody(shape, { p: [0, -0.2, 0], dynamic: false, friction: material.groundFriction ?? 0.82, restitution: material.groundRestitution ?? 0.04 });
    groundBody.label = 'ground';
    bodyLabels.set(groundBody.id.ToString(), 'ground');
  }
  const players = [];
  const createCompoundPlayer = (spec, label) => {
    let shape;
    if (playerGeometry === 'single-capsule') shape = joltMakeShape(J, new J.CapsuleShapeSettings(0.55, 0.27, null));
    else {
      const compound = new J.StaticCompoundShapeSettings();
      for (const part of BODY_LAYOUT) {
        const child = part.shape === 'sphere' ? new J.SphereShapeSettings(part.radius, null) : new J.CapsuleShapeSettings(part.halfHeight, part.radius, null);
        const pos = new J.Vec3(...part.pos);
        const rot = part.axis === 'x' ? J.Quat.prototype.sRotation(J.Vec3.prototype.sAxisZ(), Math.PI / 2) : J.Quat.prototype.sIdentity();
        compound.AddShapeShapeSettings(pos, rot, child, 0); J.destroy(pos); J.destroy(rot);
      }
      shape = joltMakeShape(J, compound);
    }
    const player = makeBody(shape, { p: spec.p, v: spec.v, angular: spec.angular, yawRad: spec.yawRad ?? 0, mass: spec.mass,
      friction: spec.friction, restitution: spec.restitution });
    Object.assign(player, { label, spec, colliders: null }); bodyLabels.set(player.id.ToString(), label); players.push(player); return player;
  };
  const adapter = {
    engine: 'jolt-physics-js',
    async addPlayer(spec, label) { return createCompoundPlayer(spec, label); },
    addBallisticBody({ p, v, angular = [0, 0, 0], yawRad = 0, mass = 10, shape = 'box', halfExtents = [0.3, 0.2, 0.25], label = 'ballistic-body', material: bodyMat = {} }) {
      let settings;
      if (shape === 'sphere') settings = new J.SphereShapeSettings(halfExtents[0], null);
      else settings = new J.BoxShapeSettings(new J.Vec3(...halfExtents), shape === 'football' ? 0.035 : 0.0, null);
      const body = makeBody(joltMakeShape(J, settings), {
        p, v, angular, yawRad, mass, friction: bodyMat.friction ?? material.groundFriction ?? 0.82,
        restitution: bodyMat.restitution ?? material.groundRestitution ?? 0.04,
        linearDamping: bodyMat.linearDamping ?? 0, angularDamping: bodyMat.angularDamping ?? 0,
      });
      Object.assign(body, { label, colliders: null }); bodyLabels.set(body.id.ToString(), body.label); return body;
    },
    async step() { frameContacts = new Map(); jolt.Step(timestep, 1); },
    state(player) {
      const p = player.body.GetPosition(), q = player.body.GetRotation(), v = player.body.GetLinearVelocity(), av = player.body.GetAngularVelocity();
      const motion = player.body.GetMotionProperties();
      const massKg = motion.GetInverseMass() ? 1 / motion.GetInverseMass() : player.mass;
      return { label: player.label, massKg, positionM: joltReadVec(p), centerOfMassM: joltReadVec(player.body.GetCenterOfMassPosition()), linearVelocityMps: joltReadVec(v), angularVelocityRadPerSec: joltReadVec(av), rotation: joltReadQuat(q) };
    },
    grounded(player) { return Boolean(groundBody && physics.WereBodiesInContact(player.id, groundBody.id)); },
    touching(a, b) { return Boolean(physics.WereBodiesInContact(a.id, b.id)); },
    contactPoints(a, b) { return this.contactSnapshot(a, b).pointsM; },
    contactStats(a, b) {
      const value = this.contactSnapshot(a, b);
      return { colliderPairCount: value.touching ? 1 : 0, maximumPenetrationDepthM: value.maximumPenetrationDepthM,
        penetrationSource: value.penetrationSource };
    },
    contactSnapshot(a, b) {
      const key = [a.label, b.label].sort().join('::'); const value = frameContacts.get(key);
    return value ? { ...value, touching: true, colliderPairCount: 1, normalImpulseNs: null,
        impulseSource: 'not exposed by Jolt JS ContactListener', penetrationSource: 'Jolt contact manifold penetration depth' }
        : { pairId: key, bodies: [a.label, b.label], touching: Boolean(physics.WereBodiesInContact(a.id, b.id)),
          pointsM: [], maximumPenetrationDepthM: null, normalImpulseNs: null,
          impulseSource: 'not exposed by Jolt JS ContactListener', penetrationSource: 'Jolt contact manifold penetration depth' };
    },
    contactsThisStep() { return [...frameContacts.values()]; },
    contactImpulseNs() { return null; },
    applyForce(player, force, point = null) {
      const f = new J.Vec3(...force); bodyInterface.AddForce(player.id, f); J.destroy(f);
      if (point) {
        const s = this.state(player), torque = new J.Vec3(...cross(sub(point, s.centerOfMassM), force));
        bodyInterface.AddTorque(player.id, torque); J.destroy(torque);
      }
    },
    applyTorque(player, torque) { const t = new J.Vec3(...torque); bodyInterface.AddTorque(player.id, t); J.destroy(t); },
    applyImpulse(player, impulse, point = null) {
      const dv = new J.Vec3(...scale(impulse, 1 / player.mass)); bodyInterface.AddLinearVelocity(player.id, dv); J.destroy(dv);
      if (point) {
        const state = this.state(player), angularImpulse = cross(sub(point, state.centerOfMassM), impulse);
        const motion = player.body.GetMotionProperties();
        const inverseInertia = joltReadVec(motion.GetInverseInertiaDiagonal());
        const principalRotation = qMultiply(state.rotation, joltReadQuat(motion.GetInertiaRotation()));
        const local = qRotate(angularImpulse, qConjugate(principalRotation));
        const deltaOmega = local.map((v, i) => v * inverseInertia[i]);
        const worldDelta = qRotate(deltaOmega, principalRotation);
        const newAngularVelocity = add(state.angularVelocityRadPerSec, worldDelta);
        const omega = new J.Vec3(...newAngularVelocity); bodyInterface.SetAngularVelocity(player.id, omega); J.destroy(omega);
      }
    },
    setVelocity(player, linearVelocity, angularVelocity = null) {
      const v = new J.Vec3(...linearVelocity); bodyInterface.SetLinearVelocity(player.id, v); J.destroy(v);
      if (angularVelocity) { const w = new J.Vec3(...angularVelocity); bodyInterface.SetAngularVelocity(player.id, w); J.destroy(w); }
    },
    energyProps(player) {
      const motion = player.body.GetMotionProperties();
      const inverse = joltReadVec(motion.GetInverseInertiaDiagonal());
      return { massKg: motion.GetInverseMass() > 0 ? 1 / motion.GetInverseMass() : player.mass,
        principalInertiaKgM2: inverse.map((v) => v > 0 ? 1 / v : 0), inertiaLocalRotation: joltReadQuat(motion.GetInertiaRotation()) };
    },
    groundEntity: groundBody,
    destroy() {
      for (const { id } of bodies.reverse()) { bodyInterface.RemoveBody(id); bodyInterface.DestroyBody(id); }
      J.destroy(contactListener); J.destroy(jolt);
    },
  };
  return adapter;
}

export async function createPhysics(engine, options) {
  if (engine === 'rapier3d-compat' || engine === 'rapier') {
    rapierInit ??= RAPIER.init(); await rapierInit;
    return makeRapierWorld(options);
  }
  if (engine === 'jolt-physics-js' || engine === 'jolt') {
    joltInit ??= initJolt();
    joltModule = await joltInit;
    return joltWorld(options);
  }
  throw new Error(`Unknown physics engine: ${engine}`);
}

export const FIXED_TIMESTEP_SECONDS = DT;
export const GRAVITY_MPS2 = G;
