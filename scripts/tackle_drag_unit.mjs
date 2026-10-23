// Two-body unit test of the tackle hold: no decisions, no odds, only the physics.
//
// A tackler and a ball carrier meet at the wrap with identical bodies in every run. The brains are inert, so
// nothing but wrapForces() moves the carrier after contact. We vary only the hold factors (grip from the tackler's
// TAK, resist from the carrier's BTK or ELU) and measure how far the carrier is dragged in the second after the wrap.
//
// Usage: node scripts/tackle_drag_unit.mjs --out path.json
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { World, Player } from '../engine/world.js';
import { rng } from '../engine/rng.js';
import { DT } from '../engine/constants.js';

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

function body(id, mass, vmax, x, vx) {
  const info = {
    id, ratings: {},
    physics: { mass, radius: 0.3, vmax, f0: mass * vmax * 1.2, drive: 900, alat: 6, reach: 2.2 },
  };
  const p = new Player(info, 'T', id);
  p.p = { x, y: 0 };
  p.v = { x: vx, y: 0 };
  return p;
}

function dragAfterWrap(grip, resist, seconds = 1.0) {
  const world = new World(rng(7));
  const tackler = world.add(body('tackler', 115, 7.5, 0, 6.0));
  const carrier = world.add(body('carrier', 98, 8.5, 0.8, 4.0));
  world.wrap(tackler, carrier, { fall: 0.5, grip, resist });
  const inert = () => {};
  const x0 = carrier.p.x, y0 = carrier.p.y;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) world.step(DT, inert);
  return Math.hypot(carrier.p.x - x0, carrier.p.y - y0);
}

const levels = [0.7, 1.0, 1.3];
const grid = {};
for (const g of levels) {
  for (const r of levels) {
    grid[`grip${g}_resist${r}`] = Number(dragAfterWrap(g, r).toFixed(4));
  }
}
// Sensitivity: grip-only and resist-only sweeps around the neutral point.
const gripSweep = levels.map((g) => [g, Number(dragAfterWrap(g, 1.0).toFixed(4))]);
const resistSweep = levels.map((r) => [r, Number(dragAfterWrap(1.0, r).toFixed(4))]);
const out = { dt: DT, seconds: 1.0, grid, grip_sweep_at_resist_1: gripSweep, resist_sweep_at_grip_1: resistSweep };
console.log(JSON.stringify(out, null, 1));
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
void ROOT;
