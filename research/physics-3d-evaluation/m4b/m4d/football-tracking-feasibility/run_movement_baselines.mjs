import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import readline from 'node:readline';

const engineRoot = process.env.GRIDIRON_PHYSICS_ROOT ?? '/root/gridiron-physics';
const { Player } = await import(pathToFileURL(path.join(engineRoot, 'engine/world.js')).href);
const DT = 1 / 120;
const TRACK_DT = 0.1;
const RESPONSE_SECONDS = 0.12;
const REFERENCE = {
  vmaxMps: 9.0,
  f0N: 1100.0,
  lateralAccelerationMps2: 6.5,
  frictionCoefficient: 0.95,
  carrierSpeedCapFactor: 0.97,
};

function norm(v) {
  return Math.hypot(v[0], v[1]);
}

function deriveHistory(actor) {
  if (actor.historyPositionsM?.length === 6) {
    const velocities = actor.historyPositionsM.slice(1).map((p, i) => [
      (p[0] - actor.historyPositionsM[i][0]) / TRACK_DT,
      (p[1] - actor.historyPositionsM[i][1]) / TRACK_DT,
    ]);
    const meanIndex = (velocities.length - 1) / 2;
    const denominator = velocities.reduce((sum, _, i) => sum + (i - meanIndex) ** 2, 0);
    const acceleration = [0, 1].map((axis) => {
      const mean = velocities.reduce((sum, v) => sum + v[axis], 0) / velocities.length;
      return velocities.reduce((sum, v, i) => sum + (i - meanIndex) * (v[axis] - mean), 0)
        / (denominator * TRACK_DT);
    });
    return {
      p0: actor.historyPositionsM.at(-1),
      v0: velocities.at(-1),
      acceleration,
    };
  }
  if (actor.originM && actor.velocityMps && actor.accelerationProposalMps2) {
    return { p0: actor.originM, v0: actor.velocityMps, acceleration: actor.accelerationProposalMps2 };
  }
  throw new Error(`Actor ${actor.id ?? actor.key ?? '?'} needs six history positions or a complete legacy state`);
}

function stateAt(p0, v0, t, acceleration = [0, 0]) {
  return {
    p: [p0[0] + v0[0] * t + 0.5 * acceleration[0] * t * t,
      p0[1] + v0[1] * t + 0.5 * acceleration[1] * t * t],
    v: [v0[0] + acceleration[0] * t, v0[1] + acceleration[1] * t],
  };
}

function runBoundedAcceleration(actor, start, sampleSteps, maxStep) {
  const massKg = actor.massKg;
  const maxAcceleration = Math.min(REFERENCE.lateralAccelerationMps2, REFERENCE.f0N / massKg);
  const accelerationMagnitude = norm(start.acceleration);
  const a = accelerationMagnitude > maxAcceleration
    ? start.acceleration.map((v) => v * maxAcceleration / accelerationMagnitude)
    : start.acceleration;
  let p = [...start.p0];
  let v = [...start.v0];
  const output = new Map([[0, { p: [...p], v: [...v] }]]);
  for (let step = 1; step <= maxStep; step++) {
    p = [p[0] + v[0] * DT + 0.5 * a[0] * DT * DT,
      p[1] + v[1] * DT + 0.5 * a[1] * DT * DT];
    v = [v[0] + a[0] * DT, v[1] + a[1] * DT];
    if (sampleSteps.has(step)) output.set(step, { p: [...p], v: [...v] });
  }
  return output;
}

function runLocomotion(actor, start, sampleSteps, maxStep) {
  const player = new Player({
    id: actor.id ?? actor.nflId ?? actor.key,
    ratings: {},
    physics: {
      mass: actor.massKg,
      radius: 0.3,
      vmax: REFERENCE.vmaxMps,
      f0: REFERENCE.f0N,
      drive: 0,
      alat: REFERENCE.lateralAccelerationMps2,
      reach: 0,
    },
  }, actor.team ?? actor.role ?? 'unknown', actor.position ?? 'unknown');
  player.p = { x: start.p0[0], y: start.p0[1] };
  player.v = { x: start.v0[0], y: start.v0[1] };
  player.h = norm(start.v0) > 1e-6 ? Math.atan2(start.v0[1], start.v0[0]) : 0;
  player.hasBall = actor.hasBall === true;
  const output = new Map([[0, { p: [...start.p0], v: [...start.v0] }]]);
  for (let step = 1; step <= maxStep; step++) {
    player.dv = {
      x: player.v.x + start.acceleration[0] * RESPONSE_SECONDS,
      y: player.v.y + start.acceleration[1] * RESPONSE_SECONDS,
    };
    player.locomote(DT);
    if (sampleSteps.has(step)) {
      output.set(step, { p: [player.p.x, player.p.y], v: [player.v.x, player.v.y] });
    }
  }
  return output;
}

function processRecord(record) {
  const actors = record.actors ?? record.players.map((player) => ({
    ...player,
    id: player.nflId,
    key: player.nflId,
    massKg: player.massKg ?? player.weightKg,
    historyPositionsM: player.inputPositionsM,
    hasBall: false,
  }));
  const sampleTimes = record.sampleTimes ?? [0, 0.1, 0.2, 0.3, 0.4, 0.5, 1.0];
  const sampleSteps = new Set(sampleTimes.map((t) => Math.round(t / DT)));
  const maxStep = Math.max(...sampleSteps);
  if (Math.abs(maxStep * DT - Math.max(...sampleTimes)) > 1e-7) {
    throw new Error('Requested samples must align to the 120 Hz simulation step');
  }
  const models = {
    constantVelocity: {},
    constantAcceleration: {},
    boundedAcceleration: {},
    locomotionController: {},
  };

  for (const actor of actors) {
    const start = deriveHistory(actor);
    const key = actor.key ?? actor.id ?? actor.nflId;
    for (const t of sampleTimes) {
      const step = Math.round(t / DT);
      models.constantVelocity[key] ??= [];
      models.constantAcceleration[key] ??= [];
      models.constantVelocity[key].push({ t, ...stateAt(start.p0, start.v0, t) });
      models.constantAcceleration[key].push({ t, ...stateAt(start.p0, start.v0, t, start.acceleration) });
    }
    const bounded = runBoundedAcceleration(actor, start, sampleSteps, maxStep);
    const locomotion = runLocomotion(actor, start, sampleSteps, maxStep);
    for (const model of (['boundedAcceleration', 'locomotionController'])) {
      const states = model === 'boundedAcceleration' ? bounded : locomotion;
      models[model][key] = sampleTimes.map((t) => ({ t, ...states.get(Math.round(t / DT)) }));
    }
  }
  return { id: record.id ?? `${record.week}-${record.gameId}-${record.playId}`, sampleTimes, models };
}

if (process.argv.includes('--ndjson')) {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line) continue;
    try {
      process.stdout.write(JSON.stringify(processRecord(JSON.parse(line))) + '\n');
    } catch (error) {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
      break;
    }
  }
} else {
  const request = JSON.parse(readFileSync(0, 'utf8'));
  process.stdout.write(JSON.stringify({
    referencePhysics: REFERENCE,
    output: request.cases.map(processRecord),
  }));
}
