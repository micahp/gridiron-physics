#!/usr/bin/env node
import fs from 'node:fs';
import { Player } from '../../engine/world.js';
import { DT } from '../../engine/constants.js';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error('usage: node run_team_movement_seed.mjs <priors.json> <output.json>');
}

const scene = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (scene.players.length !== 22) throw new Error(`expected 22 players, got ${scene.players.length}`);
const actors = scene.players.map((player, index) => {
  const body = new Player({ id: player.id, ratings: player.ratings, physics: player.physics }, player.side, index);
  body.p = { x: player.snap[0], y: player.snap[1] };
  const initial = player.initial_velocity_mps;
  const initialSpeed = Math.hypot(initial[0], initial[1]);
  const scale = initialSpeed > body.vmax ? body.vmax / initialSpeed : 1;
  body.v = { x: initial[0] * scale, y: initial[1] * scale };
  return { player, body, initialPosition: [body.p.x, body.p.y], points: {} };
});

function waypoint(actor, t) {
  const start = actor.initialPosition;
  const half = actor.player.predicted_position_relative_to_snap_m['0.5s'].role_prior_m;
  const end = actor.player.predicted_position_relative_to_snap_m['1.0s'].role_prior_m;
  const a = t <= 0.5 ? start : half;
  const b = t <= 0.5 ? half : end;
  const begin = t <= 0.5 ? 0 : 0.5;
  const fraction = Math.max(0, Math.min(1, (t - begin) / 0.5));
  return { x: a[0] + (b[0] - a[0]) * fraction, y: a[1] + (b[1] - a[1]) * fraction };
}

for (const actor of actors) actor.points['0.0s'] = [actor.body.p.x, actor.body.p.y];
const steps = Math.round(1 / DT);
for (let i = 1; i <= steps; i++) {
  const t = i * DT;
  for (const actor of actors) {
    const target = waypoint(actor, t);
    // Track the learned, relative role waypoint. The existing Player
    // controller applies this roster member's force, speed, turn and traction
    // limits at every 120 Hz step.
    actor.body.dv = {
      x: (target.x - actor.body.p.x) / 0.12,
      y: (target.y - actor.body.p.y) / 0.12,
    };
    actor.body.locomote(DT);
  }
  if (i === Math.round(0.5 / DT) || i === steps) {
    const key = i === steps ? '1.0s' : '0.5s';
    for (const actor of actors) actor.points[key] = [actor.body.p.x, actor.body.p.y];
  }
}

for (const actor of actors) {
  actor.player.execution = {
    controller: 'existing Player.locomote()',
    frequency_hz: 120,
    roster_physics_profile: actor.player.physics,
    collision_response: 'not run in this seed',
    positions_relative_to_snap_m: Object.fromEntries(
      Object.entries(actor.points).map(([key, value]) => [key, value.map((n) => Number(n.toFixed(4)))]),
    ),
  };
}
scene.execution = {
  controller: 'existing Player.locomote()',
  frequency_hz: 120,
  player_to_player_collisions: false,
  ball_future: 'not modeled',
  outcome: 'unchanged; no outcome generated',
};
fs.writeFileSync(outputPath, `${JSON.stringify(scene, null, 2)}\n`);
