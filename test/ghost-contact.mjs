// Players listed as ghosts of each other never collide (the FG kicker and holder end up a hand's width apart).
import assert from 'node:assert/strict';
import { World, Player } from '../engine/world.js';

const info = (id) => ({ id, ratings: {}, physics: { mass: 90, radius: 0.35, vmax: 9, f0: 900, drive: 500, alat: 6, reach: 1 } });
const make = (ghost) => {
  const w = new World(() => 0.5);
  const a = w.add(new Player(info('a'), 'T1', 'K')), b = w.add(new Player(info('b'), 'T1', 'H'));
  a.p = { x: 0, y: 0 }; b.p = { x: 0.3, y: 0 };      // overlapping discs
  if (ghost) { a.ghosts = new Set([b]); b.ghosts = new Set([a]); }
  w.collide();
  return Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y);
};
assert.ok(make(false) > 0.6, 'without ghosts, overlapping players are pushed apart');
assert.ok(Math.abs(make(true) - 0.3) < 1e-9, 'ghosts are left alone');
console.log('ghost contact ok');
