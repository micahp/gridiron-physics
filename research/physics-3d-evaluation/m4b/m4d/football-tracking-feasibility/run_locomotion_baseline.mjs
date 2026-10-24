import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const engineRoot = process.env.GRIDIRON_PHYSICS_ROOT ?? '/root/gridiron-physics';
const { Player } = await import(pathToFileURL(path.join(engineRoot, 'engine/world.js')).href);
const request = JSON.parse(readFileSync(0, 'utf8'));
const dt = 1 / 120;
const responseSeconds = 0.12;
const horizonSeconds = 0.5;
const steps = Math.round(horizonSeconds / dt);
const sampleEvery = Math.round(0.1 / dt);

function runActor(actor, model) {
  if (model !== 'constantAccelerationProposal') throw new Error(`Unknown movement arm: ${model}`);
  const p = new Player({
    id: actor.id,
    ratings: {},
    physics: {
      mass: actor.massKg,
      radius: 0.3,
      vmax: request.referencePhysics.vmaxMps,
      f0: request.referencePhysics.f0N,
      drive: 0,
      alat: request.referencePhysics.lateralAccelerationMps2,
      reach: 0,
    },
  }, actor.team, actor.role);
  p.p = { x: actor.originM[0], y: actor.originM[1] };
  p.v = { x: actor.velocityMps[0], y: actor.velocityMps[1] };
  p.h = Math.hypot(...actor.velocityMps) > 1e-6
    ? Math.atan2(actor.velocityMps[1], actor.velocityMps[0]) : 0;
  p.hasBall = actor.hasBall;
  const samples = [{ t: 0, p: [p.p.x, p.p.y], v: [p.v.x, p.v.y] }];

  for (let step = 1; step <= steps; step++) {
    p.dv = {
      x: p.v.x + actor.accelerationProposalMps2[0] * responseSeconds,
      y: p.v.y + actor.accelerationProposalMps2[1] * responseSeconds,
    };
    p.locomote(dt);
    if (step % sampleEvery === 0) {
      samples.push({ t: Number((step * dt).toFixed(8)), p: [p.p.x, p.p.y], v: [p.v.x, p.v.y] });
    }
  }
  return samples;
}

const output = request.cases.map((item) => ({
  id: item.id,
  actors: Object.fromEntries(Object.entries(item.actors).map(([role, actor]) => [
    role, runActor({ ...actor, role, hasBall: role === 'carrier' }, 'constantAccelerationProposal'),
  ])),
}));
process.stdout.write(JSON.stringify({ dtSeconds: dt, horizonSeconds, output }));
