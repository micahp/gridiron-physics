import RAPIER from '@dimforge/rapier3d-compat';
import { AERO, dragK, solveLaunch } from '../../engine/ball.js';
import { BALL_MASS, G } from '../../engine/constants.js';
import { BODY_LAYOUT, DT, PASS_SCENARIO, TACKLE_SCENARIOS } from './scenarios.js';

let initialized;
const init = () => initialized ??= RAPIER.init();
const v3 = ([x, y, z]) => ({ x, y, z });
const quat = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w });

function attachHumanoid(world, body, mass) {
  const parts = [];
  for (const part of BODY_LAYOUT) {
    let desc;
    if (part.shape === 'sphere') desc = RAPIER.ColliderDesc.ball(part.radius);
    else desc = RAPIER.ColliderDesc.capsule(part.halfHeight, part.radius);
    const rotation = part.axis === 'x' ? quat(0, 0, Math.SQRT1_2, Math.SQRT1_2) : quat();
    desc.setTranslation(...part.pos).setRotation(rotation).setMass(mass * part.massShare).setFriction(0.82).setRestitution(0.03).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = world.createCollider(desc, body);
    parts.push(collider);
  }
  return parts;
}

function createPlayer(world, spec, label) {
  const yaw = spec.yawRad ?? 0;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(...spec.p)
    .setRotation(quat(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)))
    .setLinvel(...spec.v)
    .setLinearDamping(0.04)
    .setAngularDamping(0.18)
    .setCcdEnabled(true)
    .setCanSleep(false));
  const colliders = attachHumanoid(world, body, spec.mass);
  return { label, spec, body, colliders };
}

function ground(world) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.2, 30).setTranslation(0, -0.2, 0).setFriction(0.95), body);
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

export async function runRapier22PlayerBenchmark({ simulations = 1000, stepsPerSimulation = 30 } = {}) {
  await init();
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  world.integrationParameters.numSolverIterations = 6;
  ground(world);
  const specs = formation22();
  if (specs.length !== 22) throw new Error(`Expected 22 benchmark players; got ${specs.length}`);
  const players = specs.map((spec) => createPlayer(world, spec, 'benchmark-player'));
  const eventQueue = new RAPIER.EventQueue(true);
  for (let trial = 0; trial < 20; trial++) {
    for (let i = 0; i < players.length; i++) {
      const body = players[i].body, p = specs[i].p;
      body.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.setLinvel({ x: specs[i].v[0], y: 0, z: specs[i].v[2] }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true); body.resetForces(true);
    }
    for (let tick = 0; tick < stepsPerSimulation; tick++) { world.step(eventQueue); eventQueue.drainCollisionEvents(() => {}); }
  }
  const start = performance.now();
  let finite = true;
  let contacts = 0;
  for (let trial = 0; trial < simulations; trial++) {
    for (let i = 0; i < players.length; i++) {
      const body = players[i].body;
      const p = specs[i].p;
      body.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.setLinvel({ x: specs[i].v[0], y: 0, z: specs[i].v[2] }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.resetForces(true);
    }
    for (let tick = 0; tick < stepsPerSimulation; tick++) {
      world.step(eventQueue);
      eventQueue.drainCollisionEvents((_a, _b, started) => { if (trial === 0 && started) contacts++; });
    }
    if (trial === 0 && contacts === 0) {
      for (let i = 0; i < players.length; i++) for (const other of players.slice(i + 1)) {
        for (const a of players[i].colliders) for (const b of other.colliders) {
          world.contactPair(a, b, (manifold) => { if (manifold.numContacts() > 0) contacts++; });
        }
      }
    }
    if (trial % 100 === 99 || trial === simulations - 1) {
      for (const { body } of players) {
        const p = body.translation(), v = body.linvel();
        finite &&= Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z);
      }
    }
  }
  const elapsedMs = performance.now() - start;
  eventQueue.free();
  world.free();
  return { engine: 'rapier3d-compat', simulations, warmupSimulations: 20, playerBodies: 22, colliders: 22 * BODY_LAYOUT.length, stepsPerSimulation, simulatedSecondsPerEpisode: stepsPerSimulation * DT, elapsedMs, msPerSimulation: elapsedMs / simulations, projected1000SimulationsMs: elapsedMs / simulations * 1000, startedColliderContactsFirstEpisode: contacts, finite };
}

function rotTilt(rotation) {
  const upY = 1 - 2 * (rotation.x ** 2 + rotation.z ** 2);
  return Math.acos(Math.max(-1, Math.min(1, upY))) * 180 / Math.PI;
}

function contactInfo(world, a, b) {
  let impulse = 0;
  let point = null;
  for (const ca of a.colliders) for (const cb of b.colliders) {
    world.contactPair(ca, cb, (manifold) => {
      for (let i = 0; i < manifold.numSolverContacts(); i++) {
        impulse += manifold.contactImpulse(i);
        point ??= manifold.solverContactPoint(i);
      }
    });
  }
  return point ? { point: [point.x, point.y, point.z], impulse } : null;
}

function playerState(p) {
  const pos = p.body.translation();
  const rot = p.body.rotation();
  const vel = p.body.linvel();
  return { position: [pos.x, pos.y, pos.z], velocity: [vel.x, vel.y, vel.z], tiltDeg: rotTilt(rot), rotation: [rot.x, rot.y, rot.z, rot.w] };
}

export async function runRapierTackle(scenario, seed = 1) {
  await init();
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  world.integrationParameters.numSolverIterations = 8;
  ground(world);
  const carrier = createPlayer(world, scenario.carrier, 'carrier');
  const defender = createPlayer(world, scenario.defender, 'defender');
  const before = (p) => p.body.linvel();
  let firstContact = null;
  let maxTilt = { carrier: 0, defender: 0 };
  let contactTick = null;
  let carrierImpulseOnContact = null;
  const steps = Math.ceil(scenario.duration / DT);
  const driveN = (scenario.carrier.postContactDrivePerStrengthN ?? 0) * scenario.carrier.strength;
  for (let tick = 0; tick < steps; tick++) {
    const preCarrier = before(carrier);
    const preDefender = before(defender);
    // Explicit ball-carrier policy, active only after physical contact.
    if (driveN && contactTick !== null && tick * DT < contactTick * DT + 0.55) {
      carrier.body.addForce({ x: driveN, y: 0, z: 0 }, true);
    }
    world.step();
    carrier.body.resetForces(true);
    defender.body.resetForces(true);
    const hit = contactInfo(world, carrier, defender);
    if (hit && contactTick === null) {
      contactTick = tick + 1;
      firstContact = hit;
      const postCarrier = carrier.body.linvel();
      const postDefender = defender.body.linvel();
      const mi = carrier.spec.mass;
      carrierImpulseOnContact = [
        mi * (postCarrier.x - preCarrier.x),
        mi * (postCarrier.y - preCarrier.y + G * DT),
        mi * (postCarrier.z - preCarrier.z),
      ];
      // Retain both bodies' pre/post momentum for auditability.
      firstContact.momentumBefore = [mi * preCarrier.x + defender.spec.mass * preDefender.x,
        mi * preCarrier.y + defender.spec.mass * preDefender.y,
        mi * preCarrier.z + defender.spec.mass * preDefender.z];
      firstContact.momentumAfterGravityAdjusted = [mi * postCarrier.x + defender.spec.mass * postDefender.x,
        mi * (postCarrier.y + G * DT) + defender.spec.mass * (postDefender.y + G * DT),
        mi * postCarrier.z + defender.spec.mass * postDefender.z];
    }
    maxTilt.carrier = Math.max(maxTilt.carrier, rotTilt(carrier.body.rotation()));
    maxTilt.defender = Math.max(maxTilt.defender, rotTilt(defender.body.rotation()));
  }
  const out = {
    engine: 'rapier3d-compat', scenario: scenario.id, seed,
    policy: driveN ? `carrier forward drive ${driveN} N (${scenario.carrier.strength} strength × ${scenario.carrier.postContactDrivePerStrengthN} N/strength) after contact for 0.55s; deterministic motor policy` : 'initial approach velocities only; no post-launch motor force',
    contact: firstContact ? { occurred: true, tick: contactTick, timeSeconds: contactTick * DT, position: firstContact.point, contactImpulseEstimateNs: firstContact.impulse, carrierMomentumImpulseNs: carrierImpulseOnContact, momentumBefore: firstContact.momentumBefore, momentumAfterGravityAdjusted: firstContact.momentumAfterGravityAdjusted } : { occurred: false },
    players: { carrier: playerState(carrier), defender: playerState(defender) },
    engineMassKg: { carrier: carrier.body.mass(), defender: defender.body.mass() },
    maxTiltDeg: maxTilt,
    falling: { carrier: maxTilt.carrier > 55, defender: maxTilt.defender > 55 },
    finite: [carrier, defender].every((p) => Object.values(playerState(p)).flat().every((n) => Number.isFinite(n))),
  };
  world.free();
  return out;
}

export async function runRapierPass(seed = 1, scenario = PASS_SCENARIO) {
  await init();
  const s = scenario;
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  world.integrationParameters.numSolverIterations = 8;
  ground(world);
  const qb = createPlayer(world, { ...s.quarterback, v: [0, 0, 0] }, 'quarterback');
  const receiver = createPlayer(world, { ...s.receiver }, 'receiver');
  const defender = createPlayer(world, { ...s.defender }, 'defender');
  const launch = solveLaunch(s.launch, s.target, s.flightTime, AERO.spiral);
  const ballBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(s.launch.x, s.launch.z, s.launch.y)
    .setLinvel(launch.vx, launch.vz, launch.vy)
    .setCcdEnabled(true).setLinearDamping(0).setAngularDamping(0.1).setCanSleep(false));
  const ballCollider = world.createCollider(RAPIER.ColliderDesc.capsule(0.19, 0.075)
    .setRotation(quat(0, 0, Math.SQRT1_2, Math.SQRT1_2))
    .setMass(BALL_MASS).setFriction(0.55).setRestitution(0.08), ballBody);
  const participants = [qb, receiver, defender];
  const hitSet = new Set();
  const contactSamples = {};
  let trajectory = [];
  const k = dragK(AERO.spiral);
  for (let tick = 0; tick < Math.ceil(s.duration / DT); tick++) {
    const vel = ballBody.linvel();
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    ballBody.addForce({ x: -k * BALL_MASS * speed * vel.x, y: -k * BALL_MASS * speed * vel.y, z: -k * BALL_MASS * speed * vel.z }, true);
    world.step();
    for (const participant of participants) participant.body.resetForces(true);
    ballBody.resetForces(true);
    const pos = ballBody.translation();
    if (tick % 6 === 0) trajectory.push([Number(pos.x.toFixed(4)), Number(pos.y.toFixed(4)), Number(pos.z.toFixed(4))]);
    for (const target of participants) {
      for (const collider of target.colliders) {
        world.contactPair(ballCollider, collider, (manifold) => {
          if (manifold.numContacts() > 0) {
            hitSet.add(target.label);
            if (!contactSamples[target.label]) {
              const point = manifold.solverContactPoint(0);
              contactSamples[target.label] = { tick: tick + 1, timeSeconds: (tick + 1) * DT, position: point ? [point.x, point.y, point.z] : null };
            }
          }
        });
      }
    }
  }
  const result = {
    engine: 'rapier3d-compat', scenario: s.id, seed,
    launchVelocityCustomAxes: [launch.vx, launch.vy, launch.vz],
    trajectoryWorldXYZ: trajectory,
    physicalContacts: [...hitSet],
    contactSamples,
    catchFeasible: hitSet.has('receiver'), deflectionFeasible: hitSet.has('defender'),
    claim: 'Contact feasibility only. No catch, deflection, or possession is forced or inferred from proximity.',
    players: { quarterback: playerState(qb), receiver: playerState(receiver), defender: playerState(defender) },
    ballFinal: { position: [ballBody.translation().x, ballBody.translation().y, ballBody.translation().z], velocity: [ballBody.linvel().x, ballBody.linvel().y, ballBody.linvel().z] },
    finite: [ballBody.translation(), ballBody.linvel()].flatMap(Object.values).every(Number.isFinite),
  };
  world.free();
  return result;
}
