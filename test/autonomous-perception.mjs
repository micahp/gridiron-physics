import assert from 'node:assert/strict';
import { createQbEyes, expectFormation, observe, perceive } from '../engine/autonomous/perception.js';

// Meters, as in the engine. The quarterback faces +x (downfield).
const DT = 1 / 120;
const player = (id, x, y, group = 'DL', vx = 0, vy = 0) => ({ id, p: { x, y }, v: { x: vx, y: vy }, r: 0.35, down: false, info: { group } });
const qb = { id: 'qb', p: { x: 0, y: 0 }, v: { x: 0, y: 0 }, h: 0, r: 0.3, down: false, info: { group: 'QB' } };

// Advance motion and perception together for `seconds`, starting at time `from`.
function run(eyes, players, from, seconds) {
  let t = from;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    t += DT;
    for (const q of players) q.p = { x: q.p.x + q.v.x * DT, y: q.p.y + q.v.y * DT };
    observe(eyes, players, t, DT, null);
  }
  return t;
}

// A defender behind the quarterback is never read from his true position.
{
  const behind = player('d1', -4, 0);
  const players = [qb, behind];
  const eyes = createQbEyes(qb);
  let t = run(eyes, players, 0, 1);
  assert.equal(perceive(eyes, behind, t), null, 'a defender out of view is unknown');
  behind.v = { x: -3, y: 0 };
  t = run(eyes, players, t, 1);
  assert.equal(perceive(eyes, behind, t), null, 'moving out of view does not reveal him');
}

// A defender in view is felt only after the reaction delay.
{
  const front = player('d2', 6, 0);
  const players = [qb, front];
  const eyes = createQbEyes(qb);
  let t = run(eyes, players, 0, 0.1);
  assert.equal(perceive(eyes, front, t), null, 'no read inside the reaction delay');
  t = run(eyes, players, t, 0.4);
  const est = perceive(eyes, front, t);
  assert.ok(est, 'a defender in view is known after the delay');
  assert.ok(Math.abs(est.x - 6) < 1e-9 && Math.abs(est.y) < 1e-9, 'the estimate is his position');
}

// A lineman standing on the sightline hides the defender behind him.
{
  const hidden = player('d3', 10, 0);
  const blocker = player('o1', 4, 0.1, 'OL');
  const players = [qb, hidden, blocker];
  const eyes = createQbEyes(qb);
  const t = run(eyes, players, 0, 1);
  assert.equal(perceive(eyes, hidden, t), null, 'a body on the sightline occludes the defender');
  assert.ok(perceive(eyes, blocker, t), 'the blocker himself is in view');
}

// Last-seen memory carries forward at the last-seen velocity and loses confidence as it ages.
{
  const runner = player('d4', 6, 0, 'DL', 0, 8);
  const players = [qb, runner];
  const eyes = createQbEyes(qb);
  let t = run(eyes, players, 0, 2.5);
  // He leaves the view on the way up, then plants his feet out of sight.
  runner.v = { x: 0, y: 0 };
  t = run(eyes, players, t, 1.5);
  const est = perceive(eyes, runner, t);
  assert.ok(est, 'a defender he saw recently is still remembered');
  assert.ok(est.age > 1, `the memory has aged (${est.age.toFixed(2)} s)`);
  assert.ok(est.uncertainty > 1.5, 'uncertainty grows with age');
  assert.ok(est.y - runner.p.y > 2, 'the estimate follows the old velocity, not the defender who stopped');
}

// A body in contact is always felt, even from behind.
{
  const grab = player('d5', -0.9, 0);
  const players = [qb, grab];
  const eyes = createQbEyes(qb);
  observe(eyes, players, 0.01, DT, null);
  assert.ok(perceive(eyes, grab, 0.01), 'contact is felt without visual awareness');
}

// The called formation is a prior, not an absence: an unseen defender is expected at his alignment,
// with more uncertainty than a defender the quarterback has actually seen.
{
  const unseen = player('d6', -3, 0);
  const seen = player('d7', 6, 0);
  const players = [qb, unseen, seen];
  const eyes = createQbEyes(qb);
  expectFormation(eyes, new Map([[unseen.id, { x: -3, y: 0 }], [seen.id, { x: 6, y: 0 }]]), 0);
  const prior = perceive(eyes, unseen, 0);
  assert.ok(prior, 'an unseen defender is still expected at his alignment');
  assert.equal(prior.x, -3);
  run(eyes, players, 0, 0.5);
  const confirmed = perceive(eyes, seen, 0.5);
  assert.ok(confirmed.uncertainty < perceive(eyes, unseen, 0.5).uncertainty, 'a confirmed sighting is tighter than the prior');
}

console.log('autonomous perception ok: view, reaction delay, occlusion, memory decay, contact, formation prior');
