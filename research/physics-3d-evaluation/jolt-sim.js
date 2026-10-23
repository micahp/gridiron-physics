import initJolt from 'jolt-physics';
import { AERO, dragK, solveLaunch } from '../../engine/ball.js';
import { BALL_MASS, G } from '../../engine/constants.js';
import { BODY_LAYOUT, DT, PASS_SCENARIO } from './scenarios.js';

let initPromise;
const init = () => initPromise ??= initJolt();

function createWorld(J) {
  const staticLayer = 0, movingLayer = 1, broadStatic = 0, broadMoving = 1;
  const pairFilter = new J.ObjectLayerPairFilterTable(2);
  pairFilter.EnableCollision(staticLayer, staticLayer);
  pairFilter.EnableCollision(staticLayer, movingLayer);
  pairFilter.EnableCollision(movingLayer, movingLayer);
  const broad = new J.BroadPhaseLayerInterfaceTable(2, 2);
  const bp0 = new J.BroadPhaseLayer(broadStatic), bp1 = new J.BroadPhaseLayer(broadMoving);
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
  physics.SetGravity(new J.Vec3(0, -G, 0));
  const bodyInterface = physics.GetBodyInterface();
  const bodies = [];
  return { J, jolt, physics, bodyInterface, bodies, staticLayer, movingLayer };
}

function makeShape(J, shapeSettings) {
  const result = shapeSettings.Create();
  if (!result.IsValid()) throw new Error(`Jolt shape creation failed: ${result.GetError()}`);
  const shape = result.Get();
  shape.AddRef();
  result.Clear();
  shapeSettings.Release();
  return shape;
}

function addBody(w, shape, { p, v = [0, 0, 0], angular = [0, 0, 0], mass, dynamic, layer, friction = 0.82, restitution = 0.03 }) {
  const { J } = w;
  const pos = new J.RVec3(...p);
  const rot = J.Quat.prototype.sIdentity();
  const settings = new J.BodyCreationSettings(shape, pos, rot, dynamic ? J.EMotionType_Dynamic : J.EMotionType_Static, layer);
  settings.mFriction = friction;
  settings.mRestitution = restitution;
  settings.mLinearDamping = 0.04;
  settings.mAngularDamping = 0.18;
  settings.mAllowSleeping = false;
  if (dynamic) {
    settings.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
    const props = settings.mMassPropertiesOverride;
    props.mMass = mass;
    settings.mLinearVelocity = new J.Vec3(...v);
    settings.mAngularVelocity = new J.Vec3(...angular);
  }
  shape.Release();
  const body = w.bodyInterface.CreateBody(settings);
  const id = body.GetID();
  w.bodyInterface.AddBody(id, J.EActivation_Activate);
  J.destroy(settings); J.destroy(pos); J.destroy(rot);
  w.bodies.push({ body, id });
  return { body, id, mass };
}

function makeGround(w) {
  const { J } = w;
  const settings = new J.BoxShapeSettings(new J.Vec3(30, 0.2, 30), 0.05, null);
  const shape = makeShape(J, settings);
  return addBody(w, shape, { p: [0, -0.2, 0], layer: w.staticLayer, dynamic: false });
}

function formation22() {
  const offensive = [
    ...[-2, -1, 0, 1, 2].map((slot, i) => ({ p: [-0.45, 0.845, slot * 0.56], v: [0.65, 0, 0], mass: 128 + (i % 3) * 4 })),
    { p: [-2.45, 0.845, 0], v: [0.5, 0, 0], mass: 101 },
    { p: [-3.35, 0.845, 0], v: [0.75, 0, 0], mass: 95 },
    ...[-4.5, -3.0, 3.0, 4.5].map((z, i) => ({ p: [-2.8, 0.845, z], v: [1.2, 0, 0], mass: 88 + i })),
  ];
  const defense = [
    ...[-1.5, -0.5, 0.5, 1.5].map((slot, i) => ({ p: [0.45, 0.845, slot], v: [-0.65, 0, 0], mass: 135 + (i % 2) * 3 })),
    ...[-1.5, 0, 1.5].map((z, i) => ({ p: [1.75, 0.845, z], v: [-0.35, 0, 0], mass: 104 + i * 3 })),
    ...[-4.2, -2.2, 2.2, 4.2].map((z, i) => ({ p: [3.8, 0.845, z], v: [-0.1, 0, 0], mass: 89 + i })),
  ];
  return [...offensive, ...defense];
}

function makeHumanoid(w, spec) {
  const { J } = w;
  const compound = new J.StaticCompoundShapeSettings();
  for (const part of BODY_LAYOUT) {
    let child;
    if (part.shape === 'sphere') child = new J.SphereShapeSettings(part.radius, null);
    else child = new J.CapsuleShapeSettings(part.halfHeight, part.radius, null);
    const pos = new J.Vec3(...part.pos);
    const rotation = part.axis === 'x'
      ? J.Quat.prototype.sRotation(J.Vec3.prototype.sAxisZ(), Math.PI / 2)
      : J.Quat.prototype.sIdentity();
    compound.AddShapeShapeSettings(pos, rotation, child, 0);
    // AddShapeShapeSettings transfers its settings object to the compound.
    J.destroy(pos); J.destroy(rotation);
  }
  const shape = makeShape(J, compound);
  return addBody(w, shape, { p: spec.p, v: spec.v, mass: spec.mass, dynamic: true, layer: w.movingLayer });
}

function readBody(w, body, mass) {
  const { J } = w;
  const p = body.GetPosition(), q = body.GetRotation(), v = body.GetLinearVelocity(), av = body.GetAngularVelocity();
  const pos = [p.GetX(), p.GetY(), p.GetZ()];
  const rotation = [q.GetX(), q.GetY(), q.GetZ(), q.GetW()];
  const velocity = [v.GetX(), v.GetY(), v.GetZ()];
  const angularVelocity = [av.GetX(), av.GetY(), av.GetZ()];
  const upY = 1 - 2 * (rotation[0] ** 2 + rotation[2] ** 2);
  // These accessors return borrowed/value wrappers in the Emscripten binding;
  // explicit destruction here can invalidate an internal Jolt object.
  const inverseMass = body.GetMotionProperties().GetInverseMass();
  return { position: pos, velocity, angularVelocity, rotation, tiltDeg: Math.acos(Math.max(-1, Math.min(1, upY))) * 180 / Math.PI, mass, engineMassKg: inverseMass ? 1 / inverseMass : null };
}

function estimateContactPoint(carrierState, defenderState) {
  const direction = carrierState.position.map((v, i) => defenderState.position[i] - v);
  const length = Math.hypot(...direction) || 1;
  const n = direction.map((v) => v / length);
  // Support point on an ellipsoid enclosing the compound body. This is explicitly
  // an estimate: Jolt's JS wrapper does not expose manifold points in this harness.
  const radius = 1 / Math.sqrt((n[0] / 0.48) ** 2 + (n[1] / 0.76) ** 2 + (n[2] / 0.48) ** 2);
  return carrierState.position.map((v, i) => v + n[i] * radius);
}

function closeWorld(w) {
  for (const { id } of w.bodies.reverse()) {
    w.bodyInterface.RemoveBody(id);
    w.bodyInterface.DestroyBody(id);
    // GetID returns a borrowed value wrapper in this build; destroying it corrupts
    // the body-ID table (see the package's generated WASM bindings).
  }
  w.J.destroy(w.jolt);
}

export async function runJoltTackle(scenario, seed = 1) {
  const J = await init();
  const w = createWorld(J); makeGround(w);
  const carrier = makeHumanoid(w, scenario.carrier);
  const defender = makeHumanoid(w, scenario.defender);
  let firstContact = null, contactTick = null, carrierImpulseOnContact = null;
  let maxTiltCarrier = 0, maxTiltDefender = 0;
  const steps = Math.ceil(scenario.duration / DT);
  const driveN = (scenario.carrier.postContactDrivePerStrengthN ?? 0) * scenario.carrier.strength;
  for (let tick = 0; tick < steps; tick++) {
    const beforeCarrier = readBody(w, carrier.body, carrier.mass);
    const beforeDefender = readBody(w, defender.body, defender.mass);
    if (driveN && contactTick !== null && tick * DT < contactTick * DT + 0.55) {
      const force = new J.Vec3(driveN, 0, 0);
      w.bodyInterface.AddForce(carrier.id, force, J.EActivation_Activate);
      J.destroy(force);
    }
    w.jolt.Step(DT, 1);
    if (!firstContact && w.physics.WereBodiesInContact(carrier.id, defender.id)) {
      contactTick = tick + 1;
      const afterCarrier = readBody(w, carrier.body, carrier.mass);
      const afterDefender = readBody(w, defender.body, defender.mass);
      const impulse = beforeCarrier.velocity.map((v, i) => carrier.mass * (afterCarrier.velocity[i] - v - (i === 1 ? -G * DT : 0)));
      const momentumBefore = beforeCarrier.velocity.map((v, i) => carrier.mass * v + defender.mass * beforeDefender.velocity[i]);
      const momentumAfterGravityAdjusted = afterCarrier.velocity.map((v, i) => carrier.mass * (v - (i === 1 ? -G * DT : 0)) + defender.mass * (afterDefender.velocity[i] - (i === 1 ? -G * DT : 0)));
      firstContact = { positionEstimate: estimateContactPoint(afterCarrier, afterDefender), impulseEstimateNs: Math.hypot(...impulse), carrierMomentumImpulseNs: impulse, momentumBefore, momentumAfterGravityAdjusted };
    }
    maxTiltCarrier = Math.max(maxTiltCarrier, readBody(w, carrier.body, carrier.mass).tiltDeg);
    maxTiltDefender = Math.max(maxTiltDefender, readBody(w, defender.body, defender.mass).tiltDeg);
  }
  const carrierState = readBody(w, carrier.body, carrier.mass);
  const defenderState = readBody(w, defender.body, defender.mass);
  const engineMassKg = {
    carrier: carrierState.engineMassKg,
    defender: defenderState.engineMassKg,
  };
  const finite = [carrierState, defenderState].every((p) => [
    ...p.position, ...p.velocity, ...p.angularVelocity, ...p.rotation, p.tiltDeg, p.mass, p.engineMassKg,
  ].every(Number.isFinite));
  const out = {
    engine: 'jolt-physics-js', scenario: scenario.id, seed,
    policy: driveN ? `carrier forward drive ${driveN} N (${scenario.carrier.strength} strength × ${scenario.carrier.postContactDrivePerStrengthN} N/strength) after contact for 0.55s; deterministic motor policy` : 'initial approach velocities only; no post-launch motor force',
    contact: firstContact ? { occurred: true, tick: contactTick, timeSeconds: contactTick * DT, ...firstContact } : { occurred: false },
    players: { carrier: carrierState, defender: defenderState },
    engineMassKg,
    maxTiltDeg: { carrier: maxTiltCarrier, defender: maxTiltDefender },
    falling: { carrier: maxTiltCarrier > 55, defender: maxTiltDefender > 55 },
    finite,
  };
  closeWorld(w);
  return out;
}

function makeBallShape(J) {
  const child = new J.CapsuleShapeSettings(0.19, 0.075, null);
  const compound = new J.StaticCompoundShapeSettings();
  const rot = J.Quat.prototype.sRotation(J.Vec3.prototype.sAxisZ(), Math.PI / 2);
  compound.AddShapeShapeSettings(new J.Vec3(0, 0, 0), rot, child, 0);
  J.destroy(rot);
  return makeShape(J, compound);
}

export async function runJoltPass(seed = 1, scenario = PASS_SCENARIO) {
  const J = await init();
  const w = createWorld(J); makeGround(w);
  const s = scenario;
  const qb = makeHumanoid(w, { ...s.quarterback, v: [0, 0, 0] });
  const receiver = makeHumanoid(w, s.receiver);
  const defender = makeHumanoid(w, s.defender);
  const launch = solveLaunch(s.launch, s.target, s.flightTime, AERO.spiral);
  const ballShape = makeBallShape(J);
  const ball = addBody(w, ballShape, { p: [s.launch.x, s.launch.z, s.launch.y], v: [launch.vx, launch.vz, launch.vy], mass: BALL_MASS, dynamic: true, layer: w.movingLayer, friction: 0.55, restitution: 0.08 });
  const k = dragK(AERO.spiral);
  const physicalContacts = new Set();
  const contactSamples = {};
  const trajectory = [];
  for (let tick = 0; tick < Math.ceil(s.duration / DT); tick++) {
    const v = readBody(w, ball.body, BALL_MASS).velocity;
    const speed = Math.hypot(...v);
    const force = new J.Vec3(...v.map((component) => -k * BALL_MASS * speed * component));
    w.bodyInterface.AddForce(ball.id, force, J.EActivation_Activate);
    J.destroy(force);
    w.jolt.Step(DT, 1);
    if (tick % 6 === 0) trajectory.push(readBody(w, ball.body, BALL_MASS).position.map((n) => Number(n.toFixed(4))));
    for (const [label, target] of [['quarterback', qb], ['receiver', receiver], ['defender', defender]]) {
      if (w.physics.WereBodiesInContact(ball.id, target.id)) {
        physicalContacts.add(label);
        if (!contactSamples[label]) contactSamples[label] = { tick: tick + 1, timeSeconds: (tick + 1) * DT, ballCenterAtContact: readBody(w, ball.body, BALL_MASS).position };
      }
    }
  }
  const ballFinal = readBody(w, ball.body, BALL_MASS);
  const out = {
    engine: 'jolt-physics-js', scenario: s.id, seed,
    launchVelocityCustomAxes: [launch.vx, launch.vy, launch.vz],
    trajectoryWorldXYZ: trajectory,
    physicalContacts: [...physicalContacts],
    contactSamples,
    catchFeasible: physicalContacts.has('receiver'), deflectionFeasible: physicalContacts.has('defender'),
    claim: 'Contact feasibility only. No catch, deflection, or possession is forced or inferred from proximity.',
    players: { quarterback: readBody(w, qb.body, s.quarterback.mass), receiver: readBody(w, receiver.body, s.receiver.mass), defender: readBody(w, defender.body, s.defender.mass) },
    ballFinal: { position: ballFinal.position, velocity: ballFinal.velocity },
    finite: [...ballFinal.position, ...ballFinal.velocity].every(Number.isFinite),
  };
  closeWorld(w);
  return out;
}

export async function runJolt22PlayerBenchmark({ simulations = 1000, stepsPerSimulation = 30 } = {}) {
  const J = await init();
  const w = createWorld(J); makeGround(w);
  const specs = formation22();
  if (specs.length !== 22) throw new Error(`Expected 22 benchmark players; got ${specs.length}`);
  const players = specs.map((spec) => makeHumanoid(w, spec));
  const resetBodies = () => {
    for (let i = 0; i < players.length; i++) {
      const p = specs[i].p;
      const position = new J.RVec3(...p), rotation = J.Quat.prototype.sIdentity();
      const velocity = new J.Vec3(...specs[i].v), angular = J.Vec3.prototype.sZero();
      w.bodyInterface.SetPositionRotationAndVelocity(players[i].id, position, rotation, velocity, angular);
      w.bodyInterface.ActivateBody(players[i].id);
      J.destroy(position); J.destroy(rotation); J.destroy(velocity); J.destroy(angular);
    }
  };
  for (let trial = 0; trial < 20; trial++) {
    resetBodies();
    for (let tick = 0; tick < stepsPerSimulation; tick++) w.jolt.Step(DT, 1);
  }
  const start = performance.now();
  let finite = true;
  let contactsInFirstEpisode = 0;
  for (let trial = 0; trial < simulations; trial++) {
    resetBodies();
    for (let tick = 0; tick < stepsPerSimulation; tick++) w.jolt.Step(DT, 1);
    if (trial === 0) for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
      if (w.physics.WereBodiesInContact(players[i].id, players[j].id)) contactsInFirstEpisode++;
    }
    if (trial % 100 === 99 || trial === simulations - 1) {
      for (const player of players) {
        const p = readBody(w, player.body, player.mass);
        finite &&= [...p.position, ...p.velocity, ...p.rotation].every(Number.isFinite);
      }
    }
  }
  const elapsedMs = performance.now() - start;
  closeWorld(w);
  return { engine: 'jolt-physics-js', simulations, warmupSimulations: 20, playerBodies: 22, colliders: 22 * BODY_LAYOUT.length, stepsPerSimulation, simulatedSecondsPerEpisode: stepsPerSimulation * DT, elapsedMs, msPerSimulation: elapsedMs / simulations, projected1000SimulationsMs: elapsedMs / simulations * 1000, bodyContactsFirstEpisode: contactsInFirstEpisode, finite };
}
